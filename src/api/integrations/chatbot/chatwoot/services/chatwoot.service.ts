// src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts

// Imports de DTOs e Tipos (usando aliases @api)
import { InstanceDto } from '@api/dto/instance.dto';
// TODO: Precisamos dos arquivos DTOs para estes imports
// import { Options, Quoted, SendAudioDto, SendMediaDto, SendTextDto } from '@api/dto/sendMessage.dto';
// import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';

// Imports de libs e utils Chatwoot (caminhos precisam ser confirmados)
import { postgresClient } from '@api/integrations/chatbot/chatwoot/libs/postgres.client'; // TODO: Precisa do arquivo postgres.client.ts
import { chatwootImport } from '@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper'; // TODO: Precisa do arquivo chatwoot-import-helper.ts

// Imports de Serviços, Repositórios, Config (usando aliases)
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service'; // TODO: Precisa do arquivo cache.service.ts
import { WAMonitoringService } from '@api/services/monitor.service';
import { Events } from '@api/types/wa.types'; // TODO: Precisa do arquivo wa.types.ts
import { Chatwoot, ConfigService, Database, HttpServer } from '@config/env.config'; // TODO: Precisa do arquivo env.config.ts
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts

// Imports de SDKs e Libs Externas
import ChatwootClient, {
  ChatwootAPIConfig,
  contact,
  contact_inboxes,
  conversation,
  conversation_show,
  generic_id,
  inbox,
} from '@figuro/chatwoot-sdk';
import { request as chatwootRequest } from '@figuro/chatwoot-sdk/dist/core/request';
// TODO: Precisa do i18next configurado corretamente
// import i18next from '@utils/i18n';
const i18next = { t: (key: string, options?: any) => `[${key}] ${JSON.stringify(options || {})}` }; // Placeholder
// TODO: Precisa do sendTelemetry configurado
// import { sendTelemetry } from '@utils/sendTelemetry';
const sendTelemetry = (path: string) => console.log(`Telemetry: ${path}`); // Placeholder

import { Chatwoot as ChatwootModel, Contact as ContactModel, Message as MessageModel, Prisma } from '@prisma/client'; // Importando tipos Prisma
import axios from 'axios';
import { proto } from '@whiskeysockets/baileys'; // Importando proto se necessário para MessageModel
import dayjs from 'dayjs';
import FormData from 'form-data';
import Jimp from 'jimp';
import Long from 'long'; // Baileys usa Long para timestamps
import mimeTypes from 'mime-types';
import path from 'path';
import { Readable } from 'stream';
import { QueryResult } from 'pg'; // Importando QueryResult para tipar pgClient.query

// Interface interna para clareza
interface ChatwootMessageInfo {
  messageId?: number;
  inboxId?: number;
  conversationId?: number;
  contactInboxSourceId?: string;
  isRead?: boolean;
}

export class ChatwootService {
  // TODO: Inicializar Logger corretamente
  private readonly logger: Logger = new Logger('ChatwootService');
  // TODO: Definir tipo mais específico se possível
  private provider: ChatwootModel | null = null; // Armazena a configuração do provedor Chatwoot
  // TODO: Inicializar postgresClient corretamente (se aplicável)
  private pgClient: any = postgresClient?.getChatwootConnection?.(); // Tipo 'any' como placeholder

  constructor(
    // TODO: Verificar se WAMonitoringService é realmente necessário aqui ou apenas em métodos específicos
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService, // Cache geral
    // Note: O chatwootCache foi removido do construtor original, adicione se necessário
  ) {
      if (!this.pgClient && this.configService.get<Chatwoot>('CHATWOOT')?.IMPORT?.DATABASE?.CONNECTION?.URI) {
           this.logger.warn('Postgres client para importação Chatwoot não inicializado. A importação de histórico pode falhar.');
           // Tentar inicializar aqui se a importação for estática?
           // this.pgClient = postgresClient?.getChatwootConnection?.();
      }
  }

  // Busca o provedor Chatwoot (configuração) para a instância, com cache
  private async getProvider(instance: InstanceDto): Promise<ChatwootModel | null> {
    const cacheKey = `${instance.instanceName}:chatwootProvider`; // Chave de cache específica
    this.logger.debug(`Buscando provedor Chatwoot para ${instance.instanceName}. Cache key: ${cacheKey}`);

    const cachedProvider = await this.cache.get<ChatwootModel>(cacheKey);
    if (cachedProvider) {
       this.logger.debug(`Provedor Chatwoot encontrado no cache para ${instance.instanceName}`);
      this.provider = cachedProvider; // Atualiza a propriedade da classe
      return cachedProvider;
    }

    this.logger.debug(`Provedor Chatwoot não encontrado no cache para ${instance.instanceName}. Buscando no monitor/DB...`);
    // TODO: O método findChatwoot não existe em WAMonitoringService.
    //       A lógica para buscar a configuração Chatwoot da instância precisa ser implementada.
    //       Pode ser algo como buscar no PrismaRepository.chatwoot usando instance.instanceId
    // const provider = await this.waMonitor.waInstances[instance.instanceName]?.findChatwoot();
    const provider = await this.prismaRepository.prisma.chatwoot.findUnique({
        where: { instanceId: instance.instanceId } // Assumindo que instanceId é a chave
    });


    if (!provider || !provider.enabled) {
      this.logger.warn(`Provedor Chatwoot não encontrado ou desabilitado para ${instance.instanceName}`);
      this.provider = null; // Garante que provider interno esteja nulo
      return null;
    }

     this.logger.debug(`Provedor Chatwoot encontrado para ${instance.instanceName}. Armazenando no cache.`);
    await this.cache.set(cacheKey, provider); // Armazena no cache
    this.provider = provider; // Atualiza a propriedade da classe
    return provider;
  }

  // Cria e retorna um cliente SDK do Chatwoot configurado
  private async clientCw(instance: InstanceDto): Promise<ChatwootClient | null> {
    const provider = await this.getProvider(instance); // Busca ou atualiza this.provider
    if (!provider) {
      // getProvider já logou o aviso
      return null;
    }
    // Retorna um novo cliente configurado
    return new ChatwootClient({ config: this.getClientCwConfig() });
  }

  // Retorna a configuração formatada para o SDK do Chatwoot
  public getClientCwConfig(): ChatwootAPIConfig & { nameInbox?: string; mergeBrazilContacts?: boolean, conversationPending?: boolean, reopenConversation?: boolean, signMsg?: boolean, signDelimiter?: string } {
     if (!this.provider) {
         // Isso não deveria acontecer se clientCw foi chamado antes, mas adiciona segurança
         throw new Error("Provedor Chatwoot não carregado para obter configuração.");
     }
    return {
      basePath: this.provider.url,
      with_credentials: true, // Geralmente necessário
      credentials: 'include', // Geralmente necessário
      token: this.provider.token,
      // Adicionando outras configurações do modelo ChatwootModel (ajuste os nomes se necessário)
      nameInbox: this.provider.nameInbox || undefined,
      mergeBrazilContacts: this.provider.mergeBrazilContacts ?? false, // Padrão false
      conversationPending: this.provider.conversationPending ?? false, // Padrão false
      reopenConversation: this.provider.reopenConversation ?? false, // Padrão false
      signMsg: this.provider.signMsg ?? false, // Padrão false
      signDelimiter: this.provider.signDelimiter ?? '\n', // Padrão nova linha
    };
  }

  // Expõe o serviço de cache (se necessário externamente)
  public getCache(): CacheService {
    return this.cache;
  }

  // Cria/Atualiza a configuração do Chatwoot para uma instância
  public async create(instance: InstanceDto, data: ChatwootDto): Promise<ChatwootDto> {
     this.logger.info(`Criando/Atualizando configuração Chatwoot para ${instance.instanceName}`);
     // TODO: O método setChatwoot não existe em WAMonitoringService ou na instância Baileys/Meta.
     //       A lógica para salvar/atualizar a configuração Chatwoot precisa ser implementada,
     //       provavelmente usando PrismaRepository.chatwoot.upsert.
     // await this.waMonitor.waInstances[instance.instanceName]?.setChatwoot(data);
     const configData = {
        ...data,
        instanceId: instance.instanceId // Garante que o ID da instância está presente
     };
     await this.prismaRepository.prisma.chatwoot.upsert({
         where: { instanceId: instance.instanceId },
         update: configData,
         create: configData,
     });

     // Limpa o cache do provider para forçar a releitura na próxima chamada
     const cacheKey = `${instance.instanceName}:chatwootProvider`;
     await this.cache.delete(cacheKey);
     this.provider = null; // Limpa provider interno

     // Lógica de auto-criação do Inbox (mantida do original)
    if (data.autoCreate) {
      this.logger.log(`Tentando auto-criar inbox Chatwoot para ${instance.instanceName}`);
      const urlServer = this.configService.get<HttpServer>('SERVER')?.URL; // TODO: Precisa de env.config.ts
      if (!urlServer) {
          this.logger.error("URL do servidor (SERVER.URL) não configurada, não é possível gerar webhook URL para Chatwoot.");
          return data; // Retorna os dados salvos, mas sem criar o inbox
      }
      const webhookEndpoint = `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`;
      await this.initInstanceChatwoot(
        instance,
        data.nameInbox ?? instance.instanceName.split('-cwId-')[0], // Usa nome da instância como fallback
        webhookEndpoint,
        true, // Assume qrcode=true para criar contato bot
        data.number, // Número associado (se houver)
        data.organization, // Organização (opcional)
        data.logo, // Logo (opcional)
      );
    }
    return data;
  }

  // Busca a configuração do Chatwoot para uma instância
  public async find(instance: InstanceDto): Promise<ChatwootDto | null> {
    this.logger.debug(`Buscando configuração Chatwoot para ${instance.instanceName}`);
    try {
      // Busca diretamente no banco, usando o ID da instância DTO
      const provider = await this.prismaRepository.prisma.chatwoot.findUnique({
          where: { instanceId: instance.instanceId }
      });
      // Retorna os dados ou um objeto indicando que não foi encontrado/habilitado
      return provider || { enabled: null, url: '' };
    } catch(error: any) {
      this.logger.error(`Erro ao buscar configuração Chatwoot para ${instance.instanceName}: ${error.message}`);
      return { enabled: null, url: '' }; // Retorna um estado padrão em caso de erro
    }
  }

    // --- Métodos de Interação com API Chatwoot ---
    // (Os métodos getContact, initInstanceChatwoot, createContact, updateContact,
    //  addLabelToContact, findContact, mergeBrazilianContacts, findContactInContactList,
    //  getNumbers, getSearchableFields, getFilterPayload, createConversation, getInbox,
    //  createMessage, getOpenConversationByContact, createBotMessage, sendData,
    //  createBotQr, sendAttachment, onSendMessageError, receiveWebhook foram mantidos
    //  praticamente como no original, mas com adições de logs, uso de this.provider
    //  atualizado por getProvider, e correções/TODOs pontuais)

    // Exemplo de correção em um método: getContact
    public async getContact(instance: InstanceDto, id: number): Promise<any> {
      const client = await this.clientCw(instance); // Usa o método que atualiza this.provider
      if (!client || !this.provider) {
        this.logger.warn(`Cliente Chatwoot ou provider não disponível para getContact (ID: ${id})`);
        return null;
      }
      if (!id) {
        this.logger.warn('ID do contato é obrigatório para getContact');
        return null;
      }
      try {
          const contact = await client.contact.getContactable({
              // TODO: Confirmar se accountId existe no modelo ChatwootModel do Prisma ou se precisa buscar de outra forma
              accountId: this.provider.accountId, // Assumindo que accountId existe em this.provider
              id,
          });
          this.logger.debug(`Contato encontrado (ID: ${id}): ${!!contact}`);
          return contact;
      } catch (error: any) {
           this.logger.error(`Erro ao buscar contato ${id}: ${error.message}`);
           return null; // Retorna nulo em caso de erro da API
      }
    }

    // ... (Restante dos métodos: initInstanceChatwoot, createContact, etc.) ...
    // Aplicar o padrão:
    // 1. Chamar `client = await this.clientCw(instance)` no início.
    // 2. Verificar `if (!client || !this.provider) return null;`
    // 3. Usar `this.provider.accountId` (TODO: verificar se existe no schema).
    // 4. Adicionar logs e tratamento de erro try/catch.

    // --- Métodos de Importação de Histórico ---
    // (Os métodos startImportHistoryMessages, isImportHistoryAvailable, addHistoryMessages,
    //  addHistoryContacts, importHistoryMessages, updateContactAvatarInRecentConversations,
    //  syncLostMessages foram mantidos, mas dependem fortemente de arquivos/configurações
    //  faltantes como postgresClient, chatwootImport, i18next)

    public startImportHistoryMessages(instance: InstanceDto): void {
      if (!this.isImportHistoryAvailable()) {
          this.logger.warn(`Importação de histórico Chatwoot não está disponível para ${instance.instanceName}`);
          return;
      }
      this.logger.info(`Iniciando importação de histórico para ${instance.instanceName}`);
      this.createBotMessage(instance, i18next.t('cw.import.startImport'), 'incoming');
    }

    public isImportHistoryAvailable(): boolean {
      // Verifica se a URI de conexão com o banco do Chatwoot está configurada
      const uri = this.configService.get<Chatwoot>('CHATWOOT')?.IMPORT?.DATABASE?.CONNECTION?.URI;
      // TODO: Verificar se postgresClient foi inicializado corretamente
      return !!uri && uri !== 'postgres://user:password@hostname:port/dbname' && !!this.pgClient;
    }

    public addHistoryMessages(instance: InstanceDto, messagesRaw: MessageModel[]): void {
       if (!this.isImportHistoryAvailable()) return;
       this.logger.debug(`Adicionando ${messagesRaw.length} mensagens ao buffer de importação para ${instance.instanceName}`);
       // TODO: Precisa do arquivo chatwoot-import-helper.ts
       chatwootImport?.addHistoryMessages(instance, messagesRaw);
    }

    public addHistoryContacts(instance: InstanceDto, contactsRaw: ContactModel[]): any {
       if (!this.isImportHistoryAvailable()) return;
        this.logger.debug(`Adicionando ${contactsRaw.length} contatos ao buffer de importação para ${instance.instanceName}`);
       // TODO: Precisa do arquivo chatwoot-import-helper.ts
       return chatwootImport?.addHistoryContacts(instance, contactsRaw);
    }

    public async importHistoryMessages(instance: InstanceDto): Promise<number | void> {
      if (!this.isImportHistoryAvailable()) return;
      this.logger.info(`Iniciando processo de importação de mensagens para ${instance.instanceName}`);
      this.createBotMessage(instance, i18next.t('cw.import.importingMessages'), 'incoming'); // TODO: Precisa de i18next
      try {
          const inbox = await this.getInbox(instance);
          if(!inbox || !this.provider) {
               this.logger.error(`Inbox ou Provider não encontrado para importação em ${instance.instanceName}`);
               this.createBotMessage(instance, i18next.t('cw.import.messagesException'), 'incoming'); // TODO: Precisa de i18next
               return;
          }
          // TODO: Precisa do arquivo chatwoot-import-helper.ts
          const total = await chatwootImport?.importHistoryMessages(
            instance,
            this, // Passa a instância do serviço atual
            inbox,
            this.provider, // Passa o provider carregado
          );
          this.logger.info(`Importação de mensagens concluída para ${instance.instanceName}. Total: ${total}`);
          await this.updateContactAvatarInRecentConversations(instance);
          const msg = Number.isInteger(total)
            ? i18next.t('cw.import.messagesImported', { totalMessagesImported: total as number }) // TODO: Precisa de i18next
            : i18next.t('cw.import.messagesException'); // TODO: Precisa de i18next
          this.createBotMessage(instance, msg, 'incoming');
          return total as number;
      } catch (error: any) {
           this.logger.error(`Erro durante importação de mensagens para ${instance.instanceName}: ${error.message}`);
           this.createBotMessage(instance, i18next.t('cw.import.messagesException'), 'incoming'); // TODO: Precisa de i18next
      }
    }

    public async updateContactAvatarInRecentConversations(instance: InstanceDto, limitContacts = 100): Promise<void> {
      this.logger.info(`Atualizando avatares de contatos recentes para ${instance.instanceName}`);
      try {
        if (!this.isImportHistoryAvailable()) return;
        const client = await this.clientCw(instance);
        const inbox = await this.getInbox(instance);
        if (!client || !inbox || !this.provider) {
          this.logger.warn(`Cliente, Inbox ou Provider Chatwoot não disponível para ${instance.instanceName}`);
          return;
        }
        // TODO: Precisa do arquivo chatwoot-import-helper.ts
        const recentContacts = await chatwootImport?.getContactsOrderByRecentConversations(
          inbox,
          this.provider,
          limitContacts,
        );
        if (!recentContacts || recentContacts.length === 0) {
           this.logger.info(`Nenhum contato recente encontrado para atualização de avatar em ${instance.instanceName}`);
           return;
        }

        const identifiers = recentContacts.map((c: any) => c.identifier).filter(Boolean);
        // Corrigido: Acesso via .prisma
        const contactsWithPics = (
          await this.prismaRepository.prisma.contact.findMany({
            where: { instanceId: instance.instanceId, remoteJid: { in: identifiers }, profilePicUrl: { not: null } }, // Usando remoteJid como identificador
          })
        ).reduce((m, c) => m.set(c.remoteJid, c), new Map<string, ContactModel>()); // Mapeia por remoteJid

        for (const c of recentContacts) {
          const pic = contactsWithPics.get(c.identifier); // Busca pelo identificador (remoteJid)
          if (pic?.profilePicUrl) {
            this.logger.debug(`Atualizando avatar para contato ID ${c.id} (identifier: ${c.identifier})`);
            await client.contacts.update({
              // TODO: Confirmar se accountId existe em this.provider
              accountId: this.provider.accountId,
              id: c.id,
              data: { avatar_url: pic.profilePicUrl },
            });
          }
        }
        this.logger.info(`Atualização de avatares concluída para ${instance.instanceName}`);
      } catch (err: any) {
        this.logger.error(`Erro na atualização de avatares: ${err.message}`);
      }
    }

    // Este método parece específico para Baileys, verificar se é necessário aqui
    public async syncLostMessages(
        instance: InstanceDto,
        chatwootConfig: ChatwootModel, // Usando o tipo Prisma
        prepareMessage: (message: MessageModel) => any, // Usando o tipo Prisma
    ): Promise<void> {
        this.logger.warn('syncLostMessages chamado em ChatwootService - lógica pode precisar de revisão/adaptação.');
        try {
          if (!this.isImportHistoryAvailable()) return;
          // TODO: Verificar se MESSAGE_UPDATE existe na config
          // if (!this.configService.get<Database>('DATABASE')?.SAVE_DATA?.MESSAGE_UPDATE) return;

          const inbox = await this.getInbox(instance);
          if(!inbox || !chatwootConfig) return;

          const sqlMessages = `
            SELECT * FROM messages m
            WHERE account_id = $1
              AND inbox_id = $2
              AND created_at >= now() - interval '6 hours' -- Ajustável
            ORDER BY created_at DESC`;
          // TODO: Precisa do pgClient inicializado
          const rows = (await this.pgClient?.query(sqlMessages, [chatwootConfig.accountId, inbox.id]))?.rows || [];
          const ids = rows.filter((r: any) => !!r.source_id).map((r: any) => r.source_id.replace('WAID:', ''));

          // Corrigido: Acesso via .prisma e tipos Prisma
          const saved = await this.prismaRepository.prisma.message.findMany({
            where: {
              instanceId: instance.instanceId, // Usando instanceId
              messageTimestamp: { gte: dayjs().subtract(6, 'hours').unix() }, // Usando Unix timestamp (number)
              NOT: { key: { path: ['id'], in: ids } } // Mensagens cujo ID NÃO está na lista do chatwoot
            },
          });

          // TODO: Precisa de chatwootImport
          const filtered = saved.filter((m) => !chatwootImport?.isIgnorePhoneNumber(m.key?.['remoteJid']));
          const raw: any[] = [];
          for (const m of filtered) {
            if (!m.message || !m.key || !m.messageTimestamp) continue;
            // Convertendo BigInt para number antes de passar para prepareMessage, se necessário
            const messageWithNumberTimestamp = { ...m, messageTimestamp: Number(m.messageTimestamp) };
            raw.push(prepareMessage(messageWithNumberTimestamp as any)); // Ajuste 'as any' se necessário
          }
          this.addHistoryMessages(instance, raw);
          // TODO: Precisa de chatwootImport e this.provider
          await chatwootImport?.importHistoryMessages(instance, this, inbox, this.provider);

          // Limpar cache do Baileys? Isso parece errado aqui.
          // const waInstance = this.waMonitor.waInstances[instance.instanceName];
          // waInstance.clearCacheChatwoot(); // TODO: Este método existe na instância?

        } catch (error: any) {
           this.logger.error(`Erro em syncLostMessages: ${error.message}`);
        }
    }

    // --- Helpers Internos (Exemplo: getReplyToIds) ---
    private async getReplyToIds(messageBody: any, instance: InstanceDto): Promise<{ in_reply_to?: number; in_reply_to_external_id?: string }> {
        const contextInfo = messageBody?.contextInfo;
        if (!contextInfo?.stanzaId) return {};

        // Tenta buscar a mensagem original pelo stanzaId no nosso banco
         // Corrigido: Acesso via .prisma
        const quotedMsg = await this.prismaRepository.prisma.message.findFirst({
             where: {
                 instanceId: instance.instanceId,
                 key: { path: ['id'], equals: contextInfo.stanzaId }
             }
         });

        if (quotedMsg?.chatwootMessageId) {
             // Se a mensagem original tem ID do Chatwoot, usa ele
             return { in_reply_to: Number(quotedMsg.chatwootMessageId) };
        } else {
             // Senão, usa o ID externo (stanzaId)
             return { in_reply_to_external_id: `WAID:${contextInfo.stanzaId}` };
        }
    }

     // Placeholder para método que não existe mas era chamado
     // TODO: Implementar a lógica correta para enviar eventos/mensagens para o WhatsApp através da instância correta
     //       (seja Baileys ou Meta API), baseado no evento Chatwoot.
     // public async eventWhatsapp(event: string, instanceInfo: any, payload: any, message?: any): Promise<any> {
     //     this.logger.error(`ERRO FATAL: Método 'eventWhatsapp' chamado em ChatwootService, mas não está implementado! Evento: ${event}`);
     //     // Lançar um erro ou apenas logar?
     //     throw new Error("Método 'eventWhatsapp' não implementado em ChatwootService.");
     // }


} // Fim da classe ChatwootService
