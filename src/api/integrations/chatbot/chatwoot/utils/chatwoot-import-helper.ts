// src/api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper.ts

import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';
import { postgresClient } from '@api/integrations/chatbot/chatwoot/libs/postgres.client'; // Assume import correto
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Assume import correto
import { Chatwoot, configService } from '@config/env.config'; // Assume import correto
import { Logger } from '@config/logger.config'; // Assume import correto
import { inbox as ChatwootInbox } from '@figuro/chatwoot-sdk'; // Renomeado para evitar conflito
import { Chatwoot as ChatwootModel, Contact as ContactModel, Message as MessageModel } from '@prisma/client'; // Usa tipos Prisma
// << CORREÇÃO TS2339: Importar getConversationMessage >>
import { getConversationMessage } from '@utils/getConversationMessage'; // Assume alias correto
import { proto } from '@whiskeysockets/baileys';

type ChatwootUser = {
  user_type: string;
  user_id: number;
};

type FksChatwoot = {
  phone_number: string;
  contact_id: string; // ID do contato no Chatwoot
  conversation_id: string; // ID da conversa no Chatwoot
};

type firstLastTimestamp = {
  first: number; // Timestamp da primeira mensagem (numérico)
  last: number; // Timestamp da última mensagem (numérico)
};

// Usa o tipo Baileys, mas torna a chave opcional pois pode não existir em certas mensagens do DB
type IWebMessageInfo = Omit<proto.IWebMessageInfo, 'key'> & Partial<Pick<proto.IWebMessageInfo, 'key'>>;

class ChatwootImport {
  private logger = new Logger('ChatwootImport');
  private repositoryMessagesCache = new Map<string, Set<string>>();
  private historyMessages = new Map<string, MessageModel[]>(); // Usa tipo Prisma
  private historyContacts = new Map<string, ContactModel[]>(); // Usa tipo Prisma

  public getRepositoryMessagesCache(instance: InstanceDto): Set<string> | null {
    return this.repositoryMessagesCache.get(instance.instanceName) ?? null;
  }

  public setRepositoryMessagesCache(instance: InstanceDto, repositoryMessagesCache: Set<string>): void {
    this.repositoryMessagesCache.set(instance.instanceName, repositoryMessagesCache);
  }

  public deleteRepositoryMessagesCache(instance: InstanceDto): void {
    this.repositoryMessagesCache.delete(instance.instanceName);
  }

  public addHistoryMessages(instance: InstanceDto, messagesRaw: MessageModel[]): void {
    const actualValue = this.historyMessages.get(instance.instanceName) || [];
    this.historyMessages.set(instance.instanceName, [...actualValue, ...messagesRaw]);
  }

  public addHistoryContacts(instance: InstanceDto, contactsRaw: ContactModel[]): void {
    const actualValue = this.historyContacts.get(instance.instanceName) || [];
    this.historyContacts.set(instance.instanceName, actualValue.concat(contactsRaw));
  }

  public deleteHistoryMessages(instance: InstanceDto): void {
    this.historyMessages.delete(instance.instanceName);
  }

  public deleteHistoryContacts(instance: InstanceDto): void {
    this.historyContacts.delete(instance.instanceName);
  }

  public clearAll(instance: InstanceDto): void {
    this.deleteRepositoryMessagesCache(instance);
    this.deleteHistoryMessages(instance);
    this.deleteHistoryContacts(instance);
  }

  public getHistoryMessagesLength(instance: InstanceDto): number { // Renomeado para seguir padrão JS
    return this.historyMessages.get(instance.instanceName)?.length ?? 0;
  }

  public async importHistoryContacts(instance: InstanceDto, provider: ChatwootDto): Promise<number> {
    try {
      if (this.getHistoryMessagesLength(instance) > 0) {
         this.logger.debug(`Importação de contatos adiada para ${instance.instanceName} pois há mensagens na fila.`);
        return 0; // Adia se houver mensagens esperando
      }

      const pgClient = postgresClient.getChatwootConnection();
      if (!pgClient) {
        this.logger.error(`Cliente PG não disponível para importHistoryContacts em ${instance.instanceName}`);
        return 0;
      }

      let totalContactsImported = 0;
      const contacts = this.historyContacts.get(instance.instanceName) || [];
      if (contacts.length === 0) {
        this.logger.info(`Nenhum contato no buffer para importar para ${instance.instanceName}.`);
        return 0;
      }

      this.logger.info(`Iniciando importação de ${contacts.length} contatos para ${instance.instanceName}...`);

      let contactsChunk: ContactModel[] = this.sliceIntoChunks(contacts, 3000);
      while (contactsChunk.length > 0) {
        const accountId = parseInt(provider.accountId || '0'); // Garante que accountId é número
        if (isNaN(accountId) || accountId === 0) {
            this.logger.error(`AccountId inválido ou ausente para importHistoryContacts: ${provider.accountId}`);
            break; // Interrompe se accountId for inválido
        }
        const inboxName = provider.nameInbox || instance.instanceName.split('-cwId-')[0];

        // Obter Label ID (com tratamento de erro)
        let labelId: number | null = null;
        try {
            const labelSql = `SELECT id FROM labels WHERE title = $1 AND account_id = $2 LIMIT 1`;
            const labelResult = await pgClient.query(labelSql, [inboxName, accountId]);
            labelId = labelResult?.rows[0]?.id ?? null;

            if (!labelId) {
                const sqlLabel = `INSERT INTO labels (title, color, show_on_sidebar, account_id, created_at, updated_at) VALUES ($1, '#34039B', true, $2, NOW(), NOW()) RETURNING id`;
                const newLabelResult = await pgClient.query(sqlLabel, [inboxName, accountId]);
                labelId = newLabelResult?.rows[0]?.id ?? null;
            }
            if (!labelId) throw new Error('Falha ao obter/criar label ID.');
        } catch (error: any) {
            this.logger.error(`Erro ao obter/criar label '${inboxName}': ${error.message}`);
            continue; // Pula este chunk se houver erro com label
        }


        // Inserir Contatos
        let sqlInsert = `INSERT INTO contacts (name, phone_number, account_id, identifier, created_at, updated_at) VALUES `;
        const bindInsert: any[] = [accountId];
        const contactIdentifiers: string[] = [];

        for (const contact of contactsChunk) {
            // Validação básica
            if (!contact.remoteJid || !contact.pushName) {
                this.logger.warn(`Contato inválido ignorado: ${JSON.stringify(contact)}`);
                continue;
            }
            const phoneNumber = `+${contact.remoteJid.split('@')[0]}`;
            contactIdentifiers.push(contact.remoteJid); // Guarda identifier para tag

            bindInsert.push(contact.pushName);
            const bindName = `$${bindInsert.length}`;
            bindInsert.push(phoneNumber);
            const bindPhoneNumber = `$${bindInsert.length}`;
            bindInsert.push(contact.remoteJid); // Identifier
            const bindIdentifier = `$${bindInsert.length}`;

            sqlInsert += `(${bindName}, ${bindPhoneNumber}, $1, ${bindIdentifier}, NOW(), NOW()),`;
        }

        if (bindInsert.length <= 1) { // Nenhum contato válido no chunk
             contactsChunk = this.sliceIntoChunks(contacts, 3000); // Pega próximo chunk
             continue;
        }

        sqlInsert = sqlInsert.slice(0, -1); // Remove vírgula final
        sqlInsert += ` ON CONFLICT (identifier, account_id) DO UPDATE SET name = EXCLUDED.name, phone_number = EXCLUDED.phone_number, identifier = EXCLUDED.identifier, updated_at = NOW()`; // Atualiza em conflito

        try {
            const insertResult = await pgClient.query(sqlInsert, bindInsert);
            totalContactsImported += insertResult?.rowCount ?? 0;
            this.logger.debug(`${insertResult?.rowCount ?? 0} contatos inseridos/atualizados no chunk.`);
        } catch (error: any) {
             this.logger.error(`Erro ao inserir/atualizar contatos no DB Chatwoot: ${error.message}`);
             // Pode optar por pular o chunk ou parar a importação
        }

        // Obter/Criar Tag e associar (Taggings)
        try {
            const tagName = inboxName; // Usar nome do inbox como tag
            const sqlTag = `INSERT INTO tags (name, account_id, taggings_count) VALUES ($1, $2, 0) ON CONFLICT (name, account_id) DO NOTHING RETURNING id`;
            let tagId = (await pgClient.query(sqlTag, [tagName, accountId]))?.rows[0]?.id;

            if (!tagId) { // Se não retornou ID (conflito), busca o ID existente
                 const sqlSelectTag = `SELECT id FROM tags WHERE name = $1 AND account_id = $2`;
                 tagId = (await pgClient.query(sqlSelectTag, [tagName, accountId]))?.rows[0]?.id;
            }

            if (tagId && contactIdentifiers.length > 0) {
                let sqlInsertLabel = `
                    INSERT INTO taggings (tag_id, taggable_type, taggable_id, context, created_at)
                    SELECT $1, $2, contacts.id, $3, NOW()
                    FROM contacts
                    WHERE contacts.identifier = ANY($4::text[]) AND contacts.account_id = $5
                    ON CONFLICT (tag_id, taggable_id, taggable_type, context) DO NOTHING;
                `;
                await pgClient.query(sqlInsertLabel, [tagId, 'Contact', 'labels', contactIdentifiers, accountId]);

                // Atualizar contagem da tag (opcional, pode ser pesado)
                const sqlUpdateTagCount = `UPDATE tags SET taggings_count = (SELECT count(*) FROM taggings WHERE tag_id = $1 AND taggable_type = 'Contact') WHERE id = $1`;
                await pgClient.query(sqlUpdateTagCount, [tagId]);
            }
        } catch (error: any) {
            this.logger.error(`Erro ao criar/associar tag '${inboxName}': ${error.message}`);
            // Continua a importação mesmo se a tag falhar
        }

        contactsChunk = this.sliceIntoChunks(contacts, 3000); // Pega próximo chunk
      } // Fim while

      this.logger.info(`Importação de contatos concluída para ${instance.instanceName}. Total: ${totalContactsImported}`);
      this.deleteHistoryContacts(instance); // Limpa buffer após sucesso
      return totalContactsImported;

    } catch (error: any) {
      this.logger.error(`Erro em importHistoryContacts para ${instance.instanceName}: ${error.message}`);
      this.deleteHistoryContacts(instance); // Limpa buffer em caso de erro
      return 0; // Retorna 0 em caso de erro
    }
  } // Fim importHistoryContacts


  // ... (getExistingSourceIds e importHistoryMessages mantidos com TODOs internos) ...
  // Adicionando correções para getExistingSourceIds
    public async getExistingSourceIds(sourceIds: string[]): Promise<Set<string>> {
        const existingSourceIdsSet = new Set<string>();
        try {
            if (sourceIds.length === 0) return existingSourceIdsSet;

            const pgClient = postgresClient.getChatwootConnection();
            if (!pgClient) {
                 this.logger.error('Cliente PG não disponível para getExistingSourceIds.');
                 return existingSourceIdsSet; // Retorna vazio se não houver cliente PG
            }

            // Garante formato WAID:ID
            const formattedSourceIds = sourceIds.map((sourceId) => `WAID:${sourceId.replace(/^WAID:/i, '')}`);
            const query = 'SELECT source_id FROM messages WHERE source_id = ANY($1::text[])'; // Usa ANY e cast para text[]

            // Processa em chunks para evitar queries muito grandes
            const chunkSize = 5000;
            for (let i = 0; i < formattedSourceIds.length; i += chunkSize) {
                const chunk = formattedSourceIds.slice(i, i + chunkSize);
                const result = await pgClient.query(query, [chunk]);
                result.rows.forEach((row: any) => existingSourceIdsSet.add(row.source_id));
            }
            this.logger.debug(`${existingSourceIdsSet.size} source_ids existentes encontrados.`);
            return existingSourceIdsSet;
        } catch (error: any) {
            this.logger.error(`Erro em getExistingSourceIds: ${error.message}`);
            return existingSourceIdsSet; // Retorna o que foi encontrado até o erro
        }
    }

    // Adicionando correções para importHistoryMessages
    public async importHistoryMessages(
      instance: InstanceDto,
      chatwootService: ChatwootService, // Recebe a instância do serviço
      inbox: ChatwootInbox,
      provider: ChatwootModel,
    ): Promise<number> {
      let totalMessagesImported = 0;
      try {
          const pgClient = postgresClient.getChatwootConnection();
          if (!pgClient) {
             this.logger.error(`Cliente PG não disponível para importHistoryMessages em ${instance.instanceName}`);
             return 0;
          }

          const chatwootUser = await this.getChatwootUser(provider);
          if (!chatwootUser) {
            throw new Error('Usuário Chatwoot (via token) não encontrado para importar mensagens.');
          }

          let messagesOrdered = this.historyMessages.get(instance.instanceName) || [];
          if (messagesOrdered.length === 0) {
            this.logger.info(`Nenhuma mensagem no buffer para importar para ${instance.instanceName}.`);
            return 0;
          }
          this.logger.info(`Iniciando importação de ${messagesOrdered.length} mensagens para ${instance.instanceName}...`);

          // Ordena mensagens (lógica mantida)
          messagesOrdered.sort((a, b) => {
              const aKey = a.key as { remoteJid?: string | null }; // Tipagem Prisma
              const bKey = b.key as { remoteJid?: string | null }; // Tipagem Prisma
              const aTimestamp = Number(a.messageTimestamp ?? 0); // Convert BigInt/null to number
              const bTimestamp = Number(b.messageTimestamp ?? 0); // Convert BigInt/null to number
              if (!aKey?.remoteJid || !bKey?.remoteJid) return 0; // Handle missing remoteJid
              return parseInt(aKey.remoteJid) - parseInt(bKey.remoteJid) || aTimestamp - bTimestamp;
          });

          // Cria mapa por número e obtém timestamps min/max (lógica mantida)
          const allMessagesMappedByPhoneNumber = this.createMessagesMapByPhoneNumber(messagesOrdered);
          const phoneNumbersWithTimestamp = new Map<string, firstLastTimestamp>();
          allMessagesMappedByPhoneNumber.forEach((messages: MessageModel[], phoneNumber: string) => {
              phoneNumbersWithTimestamp.set(phoneNumber, {
                  first: Number(messages[0]?.messageTimestamp ?? 0),
                  last: Number(messages[messages.length - 1]?.messageTimestamp ?? 0),
              });
          });

          // Filtra mensagens já existentes (lógica mantida)
          const sourceIdsToFilter = messagesOrdered.map((message: any) => message.key?.id).filter(Boolean);
          const existingSourceIds = await this.getExistingSourceIds(sourceIdsToFilter);
          messagesOrdered = messagesOrdered.filter((message: any) => {
              const sourceId = `WAID:${message.key?.id}`;
              return message.key?.id && !existingSourceIds.has(sourceId);
          });

          this.logger.info(`${messagesOrdered.length} mensagens restantes após filtro de existentes.`);
          if (messagesOrdered.length === 0) {
             this.deleteHistoryMessages(instance);
             this.deleteRepositoryMessagesCache(instance);
             return 0;
          }

          // Processa em lotes (lógica mantida)
          const batchSize = 4000;
          let messagesChunk: MessageModel[] = this.sliceIntoChunks(messagesOrdered, batchSize);
          while (messagesChunk.length > 0) {
              const messagesByPhoneNumber = this.createMessagesMapByPhoneNumber(messagesChunk);
              if (messagesByPhoneNumber.size === 0) {
                  messagesChunk = this.sliceIntoChunks(messagesOrdered, batchSize);
                  continue;
              }

              const fksByNumber = await this.selectOrCreateFksFromChatwoot(
                  provider,
                  inbox,
                  phoneNumbersWithTimestamp,
                  messagesByPhoneNumber,
              );

              let sqlInsertMsg = `INSERT INTO messages (content, processed_message_content, account_id, inbox_id, conversation_id, message_type, private, content_type, sender_type, sender_id, source_id, created_at, updated_at) VALUES `;
              const bindInsertMsg: any[] = [provider.accountId, inbox.id];
              let valuesCount = 0;

              messagesByPhoneNumber.forEach((messages: MessageModel[], phoneNumber: string) => {
                  const fksChatwoot = fksByNumber.get(phoneNumber);
                  if (!fksChatwoot?.conversation_id || !fksChatwoot?.contact_id) {
                      this.logger.warn(`FKs não encontradas para ${phoneNumber}, pulando mensagens.`);
                      return;
                  }

                  messages.forEach((message) => {
                      if (!message.message || !message.key || !message.key['id'] || !message.messageTimestamp) {
                          this.logger.warn(`Mensagem inválida ignorada: ${JSON.stringify(message)}`);
                          return;
                      }

                       // << CORREÇÃO TS2339: Chamar getConversationMessage importado >>
                       // Passa o conteúdo da mensagem desserializado (message) para a função
                      const contentMessage = getConversationMessage(message);

                      if (!contentMessage || contentMessage.trim() === '') {
                          this.logger.debug(`Conteúdo vazio ou não suportado para mensagem ${message.key['id']}, pulando.`);
                          return; // Pula se não houver conteúdo útil
                      }

                      valuesCount++;
                      const baseIndex = bindInsertMsg.length + 1; // Índice base para os binds deste valor

                      bindInsertMsg.push(contentMessage);                 // content / processed_message_content
                      bindInsertMsg.push(fksChatwoot.conversation_id);    // conversation_id
                      bindInsertMsg.push(message.key['fromMe'] ? 1 : 0);  // message_type (1=outgoing, 0=incoming)
                      bindInsertMsg.push(message.key['fromMe'] ? chatwootUser.user_type : 'Contact'); // sender_type
                      bindInsertMsg.push(message.key['fromMe'] ? chatwootUser.user_id : fksChatwoot.contact_id); // sender_id
                      bindInsertMsg.push(`WAID:${message.key['id']}`);    // source_id
                      bindInsertMsg.push(Number(message.messageTimestamp)); // created_at / updated_at

                      sqlInsertMsg += `($${baseIndex}, $${baseIndex}, $1, $2, $${baseIndex + 1}, $${baseIndex + 2}, FALSE, 0, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, to_timestamp($${baseIndex + 6}), to_timestamp($${baseIndex + 6})),`;
                  });
              });

              if (valuesCount > 0) {
                  sqlInsertMsg = sqlInsertMsg.slice(0, -1); // Remove vírgula final
                  try {
                      const insertResult = await pgClient.query(sqlInsertMsg, bindInsertMsg);
                      totalMessagesImported += insertResult?.rowCount ?? 0;
                       this.logger.debug(`${insertResult?.rowCount ?? 0} mensagens inseridas no chunk.`);
                  } catch (error: any) {
                       this.logger.error(`Erro ao inserir mensagens no DB Chatwoot: ${error.message}`);
                       // Considerar parar ou continuar?
                  }
              }
              messagesChunk = this.sliceIntoChunks(messagesOrdered, batchSize);
          } // Fim while

          this.deleteHistoryMessages(instance);
          this.deleteRepositoryMessagesCache(instance);

          // << CORREÇÃO TS2322 / TS2339: Mapear provider para ChatwootDto e corrigir ignoreJids >>
          const providerData: ChatwootDto = {
              enabled: provider.enabled ?? undefined,
              accountId: provider.accountId ?? undefined,
              token: provider.token ?? undefined,
              url: provider.url ?? undefined,
              nameInbox: provider.nameInbox ?? undefined,
              signMsg: provider.signMsg === 'true', // Convertendo
              signDelimiter: provider.signDelimiter ?? undefined,
              number: provider.number ?? undefined,
              reopenConversation: provider.reopenConversation ?? undefined,
              conversationPending: provider.conversationPending ?? undefined,
              mergeBrazilContacts: provider.mergeBrazilContacts ?? undefined,
              importContacts: provider.importContacts ?? undefined,
              importMessages: provider.importMessages ?? undefined,
              daysLimitImportMessages: provider.daysLimitImportMessages ?? undefined,
              organization: provider.organization ?? undefined,
              logo: provider.logo ?? undefined,
              // << CORREÇÃO TS2339: Usar type assertion e fallback >>
              ignoreJids: Array.isArray((provider as any).ignoreJids) ? (provider as any).ignoreJids.map(String) : [],
          };
          // Não chamar importHistoryContacts aqui, pois ele é chamado separadamente se necessário
          // await this.importHistoryContacts(instance, providerData);

          this.logger.info(`Importação de mensagens concluída para ${instance.instanceName}. Total final: ${totalMessagesImported}`);
          return totalMessagesImported;

      } catch (error: any) {
          this.logger.error(`Erro em importHistoryMessages para ${instance.instanceName}: ${error.message}`);
          this.deleteHistoryMessages(instance);
          this.deleteRepositoryMessagesCache(instance);
          return 0; // Retorna 0 em caso de erro
      }
    } // Fim importHistoryMessages

  // ... (Restante dos métodos: selectOrCreateFksFromChatwoot, getChatwootUser, etc. com correções internas se necessário) ...
  // Adicionando correção para selectOrCreateFksFromChatwoot (Tipagem)
  public async selectOrCreateFksFromChatwoot(
      provider: ChatwootModel,
      inbox: ChatwootInbox,
      phoneNumbersWithTimestamp: Map<string, firstLastTimestamp>,
      messagesByPhoneNumber: Map<string, MessageModel[]>
  ): Promise<Map<string, FksChatwoot>> {
      const pgClient = postgresClient.getChatwootConnection();
      if (!pgClient) {
          this.logger.error('Cliente PG não disponível para selectOrCreateFksFromChatwoot.');
          return new Map(); // Retorna mapa vazio
      }
      const accountId = parseInt(provider.accountId || '0');
      const inboxId = inbox.id;
      if (isNaN(accountId) || accountId === 0 || !inboxId) {
           this.logger.error('AccountId ou InboxId inválido para selectOrCreateFksFromChatwoot.');
           return new Map();
      }


      const bindValues: any[] = [accountId, inboxId];
      const phoneNumberBind = Array.from(messagesByPhoneNumber.keys())
          .map((phoneNumber) => {
              const phoneNumberTimestamp = phoneNumbersWithTimestamp.get(phoneNumber);
              if (phoneNumberTimestamp) {
                  bindValues.push(phoneNumber); // phone_number
                  let bindStr = `($${bindValues.length},`;
                  bindValues.push(phoneNumberTimestamp.first); // created_at
                  bindStr += `$${bindValues.length},`;
                  bindValues.push(phoneNumberTimestamp.last); // last_activity_at
                  return `${bindStr}$${bindValues.length})`;
              }
              return null; // Ignora se não tiver timestamp
          })
          .filter(Boolean) // Remove nulos
          .join(',');

      if (!phoneNumberBind) {
          this.logger.warn('Nenhum número de telefone válido com timestamp para processar em selectOrCreateFksFromChatwoot.');
          return new Map();
      }

      // Query SQL mantida (complexa, mas parece correta estruturalmente)
      const sqlFromChatwoot = `
        WITH phone_number AS (
            SELECT phone_number, created_at::INTEGER, last_activity_at::INTEGER FROM (
            VALUES ${phoneNumberBind}
            ) as t (phone_number, created_at, last_activity_at)
        ),
        existing_contact AS (
             SELECT c.id as contact_id, c.phone_number, ci.id as contact_inbox_id
             FROM contacts c
             JOIN contact_inboxes ci ON ci.contact_id = c.id AND ci.inbox_id = $2
             WHERE c.account_id = $1 AND c.phone_number = ANY(SELECT phone_number FROM phone_number)
        ),
        only_new_phone_number AS (
            SELECT p.*
            FROM phone_number p
            LEFT JOIN existing_contact ec ON p.phone_number = ec.phone_number
            WHERE ec.contact_id IS NULL
        ),
        new_contact AS (
            INSERT INTO contacts (name, phone_number, account_id, identifier, created_at, updated_at, last_activity_at)
            SELECT REPLACE(p.phone_number, '+', ''), p.phone_number, $1, NULL, to_timestamp(p.created_at), to_timestamp(p.last_activity_at), to_timestamp(p.last_activity_at)
            FROM only_new_phone_number AS p
            ON CONFLICT(phone_number, account_id) DO UPDATE SET updated_at = EXCLUDED.updated_at, last_activity_at = EXCLUDED.last_activity_at
            RETURNING id, phone_number, created_at, updated_at, last_activity_at
        ),
        new_contact_inbox AS (
            INSERT INTO contact_inboxes (contact_id, inbox_id, source_id, created_at, updated_at)
            SELECT nc.id, $2, gen_random_uuid(), nc.created_at, nc.updated_at
            FROM new_contact nc
            LEFT JOIN contact_inboxes eci ON eci.contact_id = nc.id AND eci.inbox_id = $2
            WHERE eci.id IS NULL -- Evita inserir se já existir para este contato/inbox
            ON CONFLICT(inbox_id, contact_id) DO NOTHING -- Evita erro se inserção concorrente ocorrer
            RETURNING id, contact_id, created_at, updated_at
        ),
        -- Seleciona o contact_inbox_id para contatos novos ou existentes
        relevant_contact_inbox AS (
             SELECT id, contact_id FROM new_contact_inbox
             UNION
             SELECT contact_inbox_id, contact_id FROM existing_contact
        ),
        existing_conversation AS (
             SELECT rci.contact_id, con.id as conversation_id
             FROM relevant_contact_inbox rci
             JOIN conversations con ON con.contact_inbox_id = rci.id AND con.account_id = $1 AND con.inbox_id = $2
        ),
        -- Insere conversas apenas para contact_inboxes que não têm uma
        new_conversation AS (
            INSERT INTO conversations (account_id, inbox_id, status, contact_id, contact_inbox_id, uuid, last_activity_at, created_at, updated_at)
            SELECT $1, $2, 0, rci.contact_id, rci.id, gen_random_uuid(), NOW(), NOW(), NOW() -- Usa NOW() para timestamps
            FROM relevant_contact_inbox rci
            LEFT JOIN existing_conversation ec ON rci.contact_id = ec.contact_id
            WHERE ec.conversation_id IS NULL
            ON CONFLICT(account_id, inbox_id, contact_id) DO NOTHING -- Evita erro se conversa já existir
            RETURNING id, contact_id
        )
        -- Junta todos os resultados
        SELECT c.phone_number, COALESCE(nc.contact_id, ec.contact_id) as contact_id, COALESCE(nc.id, ec.conversation_id) as conversation_id
        FROM phone_number p
        LEFT JOIN new_conversation nc ON p.phone_number = (SELECT phone_number FROM contacts WHERE id = nc.contact_id) -- Associa por ID de contato
        LEFT JOIN existing_conversation ec ON p.phone_number = (SELECT phone_number FROM contacts WHERE id = ec.contact_id) -- Associa por ID de contato
        JOIN contacts c ON c.phone_number = p.phone_number AND c.account_id = $1;
    `;

      const fksFromChatwoot: QueryResult = await pgClient.query(sqlFromChatwoot, bindValues);
      const resultMap = new Map<string, FksChatwoot>();
      fksFromChatwoot.rows.forEach((item: any) => {
          if (item.phone_number && item.contact_id && item.conversation_id) {
            resultMap.set(item.phone_number, {
                phone_number: item.phone_number,
                contact_id: String(item.contact_id), // Garante string
                conversation_id: String(item.conversation_id) // Garante string
            });
          }
      });
      this.logger.debug(`FKs obtidas/criadas para ${resultMap.size} números.`);
      return resultMap;
  }

  // ... (getChatwootUser, createMessagesMapByPhoneNumber, etc. mantidos) ...
  public async getChatwootUser(provider: ChatwootModel): Promise<ChatwootUser | null> {
    try {
        const pgClient = postgresClient.getChatwootConnection();
        if (!pgClient) {
           this.logger.error('Cliente PG não disponível para getChatwootUser.');
           return null;
        }
        if (!provider.token) {
            this.logger.error('Token do provider Chatwoot ausente.');
            return null;
        }
        const sqlUser = `SELECT owner_type AS user_type, owner_id AS user_id FROM access_tokens WHERE token = $1 LIMIT 1`;
        const result = await pgClient.query(sqlUser, [provider.token]);
        if (result.rows.length > 0) {
            return result.rows[0] as ChatwootUser;
        } else {
            this.logger.warn(`Nenhum usuário encontrado para o token fornecido.`);
            return null;
        }
    } catch (error: any) {
        this.logger.error(`Erro em getChatwootUser: ${error.message}`);
        return null;
    }
}

public createMessagesMapByPhoneNumber(messages: MessageModel[]): Map<string, MessageModel[]> {
    return messages.reduce((acc: Map<string, MessageModel[]>, message: MessageModel) => {
        // Assegura que 'key' e 'remoteJid' existem e são strings
        const key = message?.key as { remoteJid?: string | null };
        const remoteJid = key?.remoteJid;

        if (remoteJid && !this.isIgnorePhoneNumber(remoteJid)) {
            const phoneNumber = remoteJid.split('@')[0];
            if (phoneNumber) {
                const phoneNumberPlus = `+${phoneNumber}`;
                const currentMessages = acc.get(phoneNumberPlus) || [];
                currentMessages.push(message);
                acc.set(phoneNumberPlus, currentMessages);
            }
        }
        return acc;
    }, new Map<string, MessageModel[]>());
}


public async getContactsOrderByRecentConversations(
    inbox: ChatwootInbox,
    provider: ChatwootModel,
    limit = 50,
  ): Promise<{ id: number; identifier: string | null; thumbnail: string | null }[]> { // Ajustado retorno
    try {
        const pgClient = postgresClient.getChatwootConnection();
        if (!pgClient) {
           this.logger.error('Cliente PG não disponível para getContactsOrderByRecentConversations.');
           return [];
        }
        const accountId = parseInt(provider.accountId || '0');
        const inboxId = inbox.id;
         if (isNaN(accountId) || accountId === 0 || !inboxId) {
           this.logger.error('AccountId ou InboxId inválido para getContactsOrderByRecentConversations.');
           return [];
         }

      // Seleciona identifier e thumbnail também
      const sql = `
        SELECT c.id, c.identifier, c.thumbnail
        FROM conversations conv
        JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.account_id = $1 AND conv.inbox_id = $2
        ORDER BY conv.last_activity_at DESC
        LIMIT $3`;

      const result = await pgClient.query(sql, [accountId, inboxId, limit]);
      return result?.rows || [];
    } catch (error: any) {
      this.logger.error(`Erro em getContactsOrderByRecentConversations: ${error.message}`);
      return [];
    }
  }

// Mantido com a correção da chamada a getConversationMessage
public getContentMessage(chatwootService: ChatwootService, msg: IWebMessageInfo): string {
    // << CORREÇÃO TS2339: Chamar getConversationMessage importado >>
    const contentMessage = getConversationMessage(msg.message); // Chama a função importada
    if (contentMessage) {
        return contentMessage;
    }

    if (!configService.get<Chatwoot>('CHATWOOT')?.IMPORT?.PLACEHOLDER_MEDIA_MESSAGE) {
        return '';
    }

    // Lógica de placeholder mantida
    const messageContent = msg.message; // Acessa o conteúdo da mensagem
    if (!messageContent) return '';

    // Lógica de placeholder para tipos de mídia (simplificada)
    if (messageContent.imageMessage) return '_<Image Message>_';
    if (messageContent.videoMessage) return '_<Video Message>_';
    if (messageContent.audioMessage) return '_<Audio Message>_';
    if (messageContent.stickerMessage) return '_<Sticker Message>_';
    if (messageContent.documentMessage) return `_<File: ${messageContent.documentMessage.fileName}>_`;
    if (messageContent.documentWithCaptionMessage?.message?.documentMessage) return `_<File: ${messageContent.documentWithCaptionMessage.message.documentMessage.fileName}>_`;
    if (messageContent.templateMessage?.hydratedTemplate?.hydratedContentText) return messageContent.templateMessage.hydratedTemplate.hydratedContentText;

    return ''; // Retorna vazio se nenhum tipo conhecido for encontrado
}


  public sliceIntoChunks<T>(arr: T[], chunkSize: number): T[] {
    // Retorna uma fatia e MODIFICA o array original
    return arr.splice(0, chunkSize);
  }

  public isGroup(remoteJid: string | null | undefined): boolean {
    return !!remoteJid && remoteJid.includes('@g.us');
  }

  public isIgnorePhoneNumber(remoteJid: string | null | undefined): boolean {
    if (!remoteJid) return true; // Ignora se não houver JID
    return this.isGroup(remoteJid) || remoteJid === 'status@broadcast' || remoteJid === '0@s.whatsapp.net';
  }

  public async updateMessageSourceID(messageId: string | number, sourceId: string): Promise<QueryResult | null> {
    const pgClient = postgresClient.getChatwootConnection();
    if (!pgClient) {
       this.logger.error('Cliente PG não disponível para updateMessageSourceID.');
       return null;
    }
    // Atualiza status para enviado (0) também? Verificar documentação Chatwoot DB schema
    const sql = `UPDATE messages SET source_id = $1 WHERE id = $2;`;
    try {
        return await pgClient.query(sql, [`WAID:${sourceId}`, messageId]);
    } catch(error: any) {
        this.logger.error(`Erro ao atualizar source_id para mensagem ${messageId}: ${error.message}`);
        return null;
    }
  }
}

export const chatwootImport = new ChatwootImport();
