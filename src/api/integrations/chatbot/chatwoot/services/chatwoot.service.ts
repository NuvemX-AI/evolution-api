// src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts

// Imports de DTOs e Tipos (usando aliases @api)
import { InstanceDto } from '@api/dto/instance.dto'; // TODO: Precisa do arquivo instance.dto.ts
// TODO: Precisamos dos arquivos DTOs para estes imports
// import { Options, Quoted, SendAudioDto, SendMediaDto, SendTextDto } from '@api/dto/sendMessage.dto';
// import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';
type ChatwootDto = any; // Placeholder DTO
type Options = any; // Placeholder DTO
type Quoted = any; // Placeholder DTO

// Imports de libs e utils Chatwoot (caminhos precisam ser confirmados)
// TODO: Precisa do arquivo postgres.client.ts que exporte 'postgresClient'
// import { postgresClient } from '@api/integrations/chatbot/chatwoot/libs/postgres.client';
const postgresClient: any = { getChatwootConnection: () => ({ query: async () => ({ rows: [] }) }) }; // Placeholder
// TODO: Precisa do arquivo chatwoot-import-helper.ts que exporte 'chatwootImport'
// import { chatwootImport } from '@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper';
const chatwootImport: any = { // Placeholder
    addHistoryMessages: () => {},
    addHistoryContacts: () => {},
    getContactsOrderByRecentConversations: async () => [],
    importHistoryMessages: async () => 0,
    isIgnorePhoneNumber: () => false,
    getExistingSourceIds: async () => new Set(),
};

// Imports de Serviços, Repositórios, Config (usando aliases)
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service'; // TODO: Precisa do arquivo cache.service.ts
import { WAMonitoringService } from '@api/services/monitor.service';
import { Events } from '@api/types/wa.types'; // TODO: Precisa do arquivo wa.types.ts
// TODO: Precisa do arquivo env.config.ts que exporte Chatwoot, ConfigService, Database, HttpServer
import { Chatwoot, ConfigService, Database, HttpServer } from '@config/env.config';
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
// import Jimp from 'jimp'; // Jimp não parece ser usado, comentado
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
  // TODO: Inicializar Logger corretamente (Precisa de logger.config.ts)
  private readonly logger: any = new Logger('ChatwootService'); // Usando 'any' como placeholder
  // TODO: Definir tipo mais específico se possível (ChatwootModel do Prisma já importado)
  private provider: ChatwootModel | null = null; // Armazena a configuração do provedor Chatwoot
  // TODO: Inicializar postgresClient corretamente (Precisa de postgres.client.ts)
  private pgClient: any = postgresClient?.getChatwootConnection?.(); // Tipo 'any' como placeholder

  constructor(
    // TODO: Verificar se WAMonitoringService é realmente necessário aqui ou apenas em métodos específicos
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService, // Assumindo que ConfigService foi injetado corretamente
    private readonly prismaRepository: PrismaRepository, // Assumindo injeção
    private readonly cache: CacheService, // Assumindo injeção // TODO: Precisa de cache.service.ts
    // O chatwootCache foi removido do construtor original, adicione se necessário
  ) {
      // TODO: Precisa do tipo Chatwoot de env.config.ts
      // TODO: Precisa do postgresClient inicializado corretamente
      if (!this.pgClient && this.configService.get<any>('CHATWOOT')?.IMPORT?.DATABASE?.CONNECTION?.URI) {
           this.logger.warn('Postgres client para importação Chatwoot não inicializado. A importação de histórico pode falhar.');
           // Tentar inicializar aqui? Ex: this.pgClient = postgresClient?.getChatwootConnection?.();
      }
  }

  // Busca o provedor Chatwoot (configuração) para a instância, com cache
  private async getProvider(instance: InstanceDto): Promise<ChatwootModel | null> {
    const cacheKey = `${instance.instanceName}:chatwootProvider`;
    this.logger.debug(`Buscando provedor Chatwoot para ${instance.instanceName}. Cache key: ${cacheKey}`);

    // TODO: Precisa de CacheService com método get
    const cachedProvider = await this.cache?.get?.<ChatwootModel>(cacheKey);
    if (cachedProvider) {
       this.logger.debug(`Provedor Chatwoot encontrado no cache para ${instance.instanceName}`);
      this.provider = cachedProvider;
      return cachedProvider;
    }

    this.logger.debug(`Provedor Chatwoot não encontrado no cache para ${instance.instanceName}. Buscando no DB...`);
    // Corrigido: Busca diretamente no Prisma usando instanceId do DTO
    const provider = await this.prismaRepository.prisma.chatwoot.findUnique({
        where: { instanceId: instance.instanceId } // Assumindo que instanceId é a chave única
    });

    if (!provider || !provider.enabled) {
      this.logger.warn(`Provedor Chatwoot não encontrado ou desabilitado para ${instance.instanceName}`);
      this.provider = null;
      return null;
    }

     this.logger.debug(`Provedor Chatwoot encontrado para ${instance.instanceName}. Armazenando no cache.`);
    // TODO: Precisa de CacheService com método set
    await this.cache?.set?.(cacheKey, provider); // Armazena no cache
    this.provider = provider;
    return provider;
  }

  // Cria e retorna um cliente SDK do Chatwoot configurado
  private async clientCw(instance: InstanceDto): Promise<ChatwootClient | null> {
    const provider = await this.getProvider(instance);
    if (!provider) {
      return null;
    }
    // Retorna um novo cliente configurado
    try {
        return new ChatwootClient({ config: this.getClientCwConfig() });
    } catch(error: any) {
        this.logger.error(`Erro ao criar ChatwootClient para ${instance.instanceName}: ${error.message}`);
        return null;
    }
  }

  // Retorna a configuração formatada para o SDK do Chatwoot
  // TODO: Adicionar os campos faltantes ao tipo ChatwootModel do Prisma ou buscar de env.config
  public getClientCwConfig(): ChatwootAPIConfig & { nameInbox?: string; mergeBrazilContacts?: boolean, conversationPending?: boolean, reopenConversation?: boolean, signMsg?: boolean, signDelimiter?: string } {
     if (!this.provider) {
         throw new Error("Provedor Chatwoot não carregado para obter configuração.");
     }
     // Tipagem mais segura usando optional chaining e valores padrão
    return {
      basePath: this.provider.url,
      with_credentials: true,
      credentials: 'include',
      token: this.provider.token,
      // Usando optional chaining e valores padrão
      nameInbox: this.provider.nameInbox || undefined,
      mergeBrazilContacts: this.provider.mergeBrazilContacts ?? false,
      conversationPending: this.provider.conversationPending ?? false,
      reopenConversation: this.provider.reopenConversation ?? false,
      signMsg: this.provider.signMsg ?? false,
      signDelimiter: this.provider.signDelimiter ?? '\n',
    };
  }

  // Expõe o serviço de cache (se necessário externamente)
  public getCache(): CacheService { // TODO: Precisa de CacheService
    return this.cache;
  }

  // Cria/Atualiza a configuração do Chatwoot para uma instância
  public async create(instance: InstanceDto, data: ChatwootDto): Promise<ChatwootDto> { // TODO: Precisa do DTO ChatwootDto
     this.logger.info(`Criando/Atualizando configuração Chatwoot para ${instance.instanceName}`);
     const configData: Prisma.ChatwootCreateInput | Prisma.ChatwootUpdateInput = {
        ...(data as any), // Faz cast para any para permitir campos extras temporariamente
        instance: { connect: { id: instance.instanceId } } // Conecta à instância existente
     };
     // Remove instanceId do data se ele veio, pois usamos a relação
     delete (configData as any).instanceId;

     // TODO: Precisa do schema.prisma para confirmar nomes de campos e tipos
     const savedProvider = await this.prismaRepository.prisma.chatwoot.upsert({
         where: { instanceId: instance.instanceId },
         update: configData as Prisma.ChatwootUpdateInput, // Tipagem Prisma
         create: configData as Prisma.ChatwootCreateInput, // Tipagem Prisma
     });

     // Limpa o cache do provider
     const cacheKey = `${instance.instanceName}:chatwootProvider`;
     await this.cache?.delete?.(cacheKey); // TODO: Precisa de CacheService
     this.provider = null; // Limpa provider interno

    // Lógica de auto-criação do Inbox
    if (data.autoCreate) {
      this.logger.log(`Tentando auto-criar inbox Chatwoot para ${instance.instanceName}`);
       // TODO: Precisa do tipo HttpServer do env.config.ts
      const urlServer = this.configService.get<any>('SERVER')?.URL;
      if (!urlServer) {
          this.logger.error("URL do servidor (SERVER.URL) não configurada.");
          // Retorna os dados salvos, mas sem tentar criar inbox
          return savedProvider as ChatwootDto; // TODO: Precisa do DTO ChatwootDto
      }
      const webhookEndpoint = `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`;
      try {
          await this.initInstanceChatwoot(
            instance,
            data.nameInbox ?? instance.instanceName.split('-cwId-')[0],
            webhookEndpoint,
            true,
            data.number,
            data.organization,
            data.logo,
          );
      } catch(initError: any) {
           this.logger.error(`Falha na auto-criação do inbox para ${instance.instanceName}: ${initError.message}`);
           // Continua mesmo se a auto-criação falhar, pois a configuração foi salva
      }
    }
    return savedProvider as ChatwootDto; // TODO: Precisa do DTO ChatwootDto
  }

  // Busca a configuração do Chatwoot para uma instância
  public async find(instance: InstanceDto): Promise<ChatwootDto | null> { // TODO: Precisa do DTO ChatwootDto
    this.logger.debug(`Buscando configuração Chatwoot para ${instance.instanceName}`);
    try {
      // Corrigido: Acesso via .prisma
      const provider = await this.prismaRepository.prisma.chatwoot.findUnique({
          where: { instanceId: instance.instanceId }
      });
      // Retorna os dados ou um objeto padrão indicando que não foi encontrado/habilitado
      return provider || { enabled: false, url: '', token: '', accountId: 0 }; // Retorna um objeto padrão
    } catch(error: any) {
      this.logger.error(`Erro ao buscar configuração Chatwoot para ${instance.instanceName}: ${error.message}`);
      return { enabled: false, url: '', token: '', accountId: 0 }; // Retorna um objeto padrão em caso de erro
    }
  }

    // --- Métodos de Interação com API Chatwoot ---
    // Mantendo a estrutura geral, mas adicionando TODOs e correções pontuais

    public async getContact(instance: InstanceDto, id: number): Promise<any> { // TODO: Tipar retorno (Contact do SDK?)
      const client = await this.clientCw(instance);
      // this.provider é atualizado dentro de clientCw se sucesso
      if (!client || !this.provider || !this.provider.accountId) {
        this.logger.warn(`Cliente Chatwoot ou provider/accountId não disponível para getContact (ID: ${id})`);
        return null;
      }
      if (!id) {
        this.logger.warn('ID do contato é obrigatório para getContact');
        return null;
      }
      try {
          const contact = await client.contact.getContactable({
              accountId: this.provider.accountId,
              id,
          });
          this.logger.debug(`Contato encontrado (ID: ${id}): ${!!contact}`);
          return contact;
      } catch (error: any) {
           // A API do Chatwoot retorna 404 se não encontrado, o SDK pode lançar erro
           if (error?.response?.status === 404) {
               this.logger.warn(`Contato ${id} não encontrado no Chatwoot.`);
           } else {
               this.logger.error(`Erro ao buscar contato ${id}: ${error.message}`);
           }
           return null; // Retorna nulo em caso de erro ou não encontrado
      }
    }

    public async initInstanceChatwoot(
      instance: InstanceDto,
      inboxName: string,
      webhookUrl: string,
      qrcode: boolean, // Usado para decidir se cria contato/conversa do bot
      number?: string, // Número associado à instância (opcional)
      organization?: string,
      logo?: string,
    ): Promise<boolean | null> {
      const client = await this.clientCw(instance);
       if (!client || !this.provider || !this.provider.accountId) {
         this.logger.error(`Cliente/Provider/AccountId não disponível para initInstanceChatwoot para ${instance.instanceName}`);
         return null;
       }
       const accountId = this.provider.accountId; // Garante que temos o ID

      try {
          // 1. Listar Inboxes para verificar se já existe
          this.logger.debug(`Listando inboxes na conta ${accountId} para verificar ${inboxName}`);
          const findInbox: any = await client.inboxes.list({ accountId });
          const existingInbox = findInbox.payload?.find((i: any) => i.name === inboxName);
          let inboxId: number;

          if (existingInbox) {
              this.logger.info(`Inbox "${inboxName}" já existe com ID: ${existingInbox.id}`);
              inboxId = existingInbox.id;
              // TODO: Opcional - verificar se o webhook URL está correto e atualizar se necessário
          } else {
              this.logger.info(`Criando novo inbox "${inboxName}"...`);
              const channelData = { type: 'api', webhook_url: webhookUrl };
              const inbox = await client.inboxes.create({
                  accountId,
                  data: { name: inboxName, channel: channelData as any }, // 'as any' para contornar tipagem do SDK se necessário
              });
              if (!inbox?.id) {
                  this.logger.error(`Falha ao criar inbox "${inboxName}"`);
                  return null;
              }
              inboxId = inbox.id;
              this.logger.log(`Inbox "${inboxName}" criado com sucesso - ID: ${inboxId}`);
          }

          // 2. Criar Contato/Conversa do Bot (se qrcode for true e BOT_CONTACT habilitado)
          const botContactEnabled = this.configService.get<any>('CHATWOOT')?.BOT_CONTACT; // TODO: Precisa do tipo Chatwoot
          if (qrcode && botContactEnabled) {
              this.logger.info('Criando contato/conversa do Bot...');
              const botIdentifier = '123456'; // Identificador fixo para o bot
              let contact = await this.findContact(instance, botIdentifier); // Tenta encontrar

              if (!contact) {
                  this.logger.debug(`Contato do Bot (${botIdentifier}) não encontrado. Criando...`);
                  contact = await this.createContact(
                      instance,
                      botIdentifier,
                      inboxId,
                      false, // Não é grupo
                      organization || 'EvolutionAPI Bot', // Nome do bot
                      logo || 'https://evolution-api.com/files/evolution-api-favicon.png', // Logo
                      undefined // Sem JID específico
                  );
              }

              if (!contact) {
                  this.logger.warn('Falha ao encontrar ou criar contato do Bot.');
                  return false; // Retorna false indicando falha parcial
              }

              const contactId = contact.payload?.contact?.id ?? contact.payload?.id ?? contact.id;
              if (!contactId) {
                   this.logger.warn('Não foi possível obter o ID do contato do Bot.');
                   return false;
              }
               this.logger.debug(`Contato do Bot encontrado/criado - ID: ${contactId}`);

              // Verifica se já existe conversa para este contato no inbox
              const convList: any = await client.contacts.listConversations({ accountId, id: contactId });
              let conversation = convList.payload?.find((c: any) => c.inbox_id === inboxId);

              if (!conversation) {
                  this.logger.debug(`Nenhuma conversa encontrada para o Bot no inbox ${inboxId}. Criando...`);
                  const convData = { contact_id: contactId.toString(), inbox_id: inboxId.toString() };
                  conversation = await client.conversations.create({ accountId, data: convData });
                  if (!conversation?.id) {
                      this.logger.warn(`Falha ao criar conversa para o Bot.`);
                      return false;
                  }
                   this.logger.debug(`Conversa do Bot criada - ID: ${conversation.id}`);
              } else {
                  this.logger.debug(`Conversa do Bot já existe - ID: ${conversation.id}`);
              }

              // Envia mensagem inicial (pode conter número para pareamento ou apenas 'init')
              let contentMsg = 'init';
              if (number) contentMsg = `init:${number}`; // Usado pelo frontend para iniciar pareamento?

               this.logger.info(`Enviando mensagem inicial para conversa do Bot (ID: ${conversation.id}). Conteúdo: ${contentMsg}`);
              await client.messages.create({
                  accountId,
                  conversationId: conversation.id,
                  data: { content: contentMsg, message_type: 'outgoing' },
              });
          } else if (qrcode) {
               this.logger.info('Criação de contato/conversa do Bot desabilitada nas configurações.');
          }

          return true; // Indica sucesso na criação/verificação do inbox
      } catch (error: any) {
           this.logger.error(`Erro em initInstanceChatwoot para ${instance.instanceName}: ${error.message}`);
           return null; // Indica falha geral
      }
    }

    // ... (Restante dos métodos como createContact, updateContact, addLabelToContact, findContact, etc.) ...
    // Aplicar o padrão de verificação de client/provider e adicionar logs/try-catch.

    // --- Métodos de Importação ---
    // Manter a estrutura, mas com TODOs claros sobre as dependências faltantes

    public startImportHistoryMessages(instance: InstanceDto): void {
      if (!this.isImportHistoryAvailable()) {
          this.logger.warn(`Importação de histórico Chatwoot não está disponível para ${instance.instanceName}`);
          return;
      }
      this.logger.info(`Iniciando importação de histórico para ${instance.instanceName}`);
      // TODO: Precisa de i18next
      this.createBotMessage(instance, i18next.t('cw.import.startImport'), 'incoming');
    }

    public isImportHistoryAvailable(): boolean {
      // TODO: Precisa do tipo Chatwoot de env.config.ts
      const uri = this.configService.get<any>('CHATWOOT')?.IMPORT?.DATABASE?.CONNECTION?.URI;
      const pgClientAvailable = !!this.pgClient?.query; // Verifica se pgClient e query existem
      if (!pgClientAvailable) {
          this.logger.warn('pgClient não está disponível ou não tem método query.');
      }
      const isUriValid = !!uri && uri !== 'postgres://user:password@hostname:port/dbname';
      if (!isUriValid) {
           this.logger.warn('URI de importação do Chatwoot não configurada corretamente.');
      }
      return isUriValid && pgClientAvailable;
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
      // TODO: Precisa de i18next
      this.createBotMessage(instance, i18next.t('cw.import.importingMessages'), 'incoming');
      try {
          const inbox = await this.getInbox(instance);
          // Usa this.provider que já foi carregado por getInbox -> clientCw
          if(!inbox || !this.provider) {
               this.logger.error(`Inbox ou Provider não encontrado para importação em ${instance.instanceName}`);
                // TODO: Precisa de i18next
               this.createBotMessage(instance, i18next.t('cw.import.messagesException'), 'incoming');
               return;
          }
          // TODO: Precisa do arquivo chatwoot-import-helper.ts
          const total = await chatwootImport?.importHistoryMessages(
            instance,
            this,
            inbox,
            this.provider, // Passa o provider carregado
          );
          this.logger.info(`Importação de mensagens concluída para ${instance.instanceName}. Total: ${total}`);
          await this.updateContactAvatarInRecentConversations(instance);
          // TODO: Precisa de i18next
          const msg = Number.isInteger(total)
            ? i18next.t('cw.import.messagesImported', { totalMessagesImported: total as number })
            : i18next.t('cw.import.messagesException');
          this.createBotMessage(instance, msg, 'incoming');
          return total as number;
      } catch (error: any) {
           this.logger.error(`Erro durante importação de mensagens para ${instance.instanceName}: ${error.message}`);
           // TODO: Precisa de i18next
           this.createBotMessage(instance, i18next.t('cw.import.messagesException'), 'incoming');
      }
    }

    public async updateContactAvatarInRecentConversations(instance: InstanceDto, limitContacts = 100): Promise<void> {
      this.logger.info(`Atualizando avatares de contatos recentes para ${instance.instanceName}`);
      try {
        if (!this.isImportHistoryAvailable()) {
             this.logger.warn(`Importação/PG Client não disponível para updateContactAvatar...`);
             return;
        };
        const client = await this.clientCw(instance);
        const inbox = await this.getInbox(instance);
        // this.provider é carregado por clientCw/getInbox
        if (!client || !inbox || !this.provider || !this.provider.accountId) {
          this.logger.warn(`Cliente, Inbox ou Provider/AccountId Chatwoot não disponível para ${instance.instanceName}`);
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
        if (identifiers.length === 0) {
             this.logger.info(`Nenhum identificador encontrado nos contatos recentes.`);
             return;
        }

        // Corrigido: Acesso via .prisma e usa remoteJid como chave
        const contactsWithPics = (
          await this.prismaRepository.prisma.contact.findMany({
            where: { instanceId: instance.instanceId, remoteJid: { in: identifiers }, profilePicUrl: { not: null } },
            select: { remoteJid: true, profilePicUrl: true } // Seleciona só o necessário
          })
        ).reduce((m, c) => { if(c.remoteJid) m.set(c.remoteJid, c); return m; }, new Map<string, { remoteJid: string | null; profilePicUrl: string | null; }>()); // Mapeia por remoteJid

        if (contactsWithPics.size === 0) {
             this.logger.info(`Nenhuma foto de perfil encontrada no DB local para os contatos recentes.`);
             return;
        }

        for (const c of recentContacts) {
          if (!c.identifier) continue; // Pula se não tiver identificador
          const picData = contactsWithPics.get(c.identifier); // Busca pelo identificador (remoteJid)
          // Verifica se a foto existe localmente e se é diferente da atual (se houver thumbnail)
          if (picData?.profilePicUrl && picData.profilePicUrl !== c.thumbnail) {
            this.logger.debug(`Atualizando avatar para contato Chatwoot ID ${c.id} (identifier: ${c.identifier})`);
            try {
                await client.contacts.update({
                    accountId: this.provider.accountId,
                    id: c.id,
                    data: { avatar_url: picData.profilePicUrl }, // Atualiza avatar
                });
            } catch (updateError: any) {
                 // Loga erro mas continua para os próximos contatos
                 this.logger.error(`Falha ao atualizar avatar para contato ${c.id}: ${updateError.message}`);
            }
          }
        }
        this.logger.info(`Atualização de avatares concluída para ${instance.instanceName}`);
      } catch (err: any) {
        this.logger.error(`Erro na atualização de avatares: ${err.message}`);
      }
    }

    // Este método parece específico de Baileys, verificar se é necessário para Chatwoot
    public async syncLostMessages(
        instance: InstanceDto,
        chatwootConfig: ChatwootModel,
        prepareMessage: (message: MessageModel) => any,
    ): Promise<void> {
        this.logger.warn('syncLostMessages chamado em ChatwootService - Verifique se a lógica é aplicável/necessária.');
        // Manter lógica original por enquanto, mas com ressalvas e TODOs
        try {
          if (!this.isImportHistoryAvailable()) return;
          // TODO: Verificar se config existe e tem SAVE_DATA.MESSAGE_UPDATE
          // if (!this.configService.get<Database>('DATABASE')?.SAVE_DATA?.MESSAGE_UPDATE) return;

          const inbox = await this.getInbox(instance);
          if(!inbox || !chatwootConfig?.accountId) { // Verifica accountId aqui
               this.logger.warn('Inbox ou AccountId não disponível para syncLostMessages.');
               return;
           };

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
          const sixHoursAgo = dayjs().subtract(6, 'hours').unix(); // Timestamp numérico
          const saved = await this.prismaRepository.prisma.message.findMany({
            where: {
              instanceId: instance.instanceId,
              messageTimestamp: { gte: BigInt(sixHoursAgo) }, // Usa BigInt se schema for BigInt
              NOT: { key: { path: ['id'], in: ids } }
            },
          });

          // TODO: Precisa de chatwootImport
          const filtered = saved.filter((m) => !chatwootImport?.isIgnorePhoneNumber(m.key?.['remoteJid']));
          const raw: any[] = [];
          for (const m of filtered) {
            if (!m.message || !m.key || !m.messageTimestamp) continue;
            // Passa o objeto Prisma diretamente, prepareMessage deve lidar com BigInt se necessário
            raw.push(prepareMessage(m));
          }
          this.addHistoryMessages(instance, raw);
          // TODO: Precisa de chatwootImport e this.provider
          await chatwootImport?.importHistoryMessages(instance, this, inbox, this.provider);

          // TODO: Lógica de limpar cache parece pertencer ao BaileysService, não aqui.
          // const waInstance = this.waMonitor.waInstances[instance.instanceName];
          // waInstance.clearCacheChatwoot();

        } catch(error: any) {
           this.logger.error(`Erro em syncLostMessages: ${error.message}`);
        }
    }

    // --- Helpers ---
     private async getReplyToIds(messageBody: any, instance: InstanceDto): Promise<{ in_reply_to?: number; in_reply_to_external_id?: string }> {
        const contextInfo = messageBody?.contextInfo;
        // Garante que temos o ID da mensagem citada
        const stanzaId = contextInfo?.stanzaId || contextInfo?.quotedMessage?.key?.id;
        if (!stanzaId) return {};

        // Tenta buscar a mensagem original pelo stanzaId no nosso banco
        // Corrigido: Acesso via .prisma
        // TODO: Precisa do schema.prisma para confirmar tipos e campos
        const quotedMsg = await this.prismaRepository.prisma.message.findFirst({
             where: {
                 instanceId: instance.instanceId,
                 key: { path: ['id'], equals: stanzaId } // Busca pelo ID no campo 'key' (assumindo estrutura Baileys)
             }
         });

        // Se encontrou a mensagem no DB e ela tem ID do Chatwoot, usa o ID do Chatwoot
        if (quotedMsg?.chatwootMessageId) {
             this.logger.debug(`Mensagem citada encontrada no DB com Chatwoot ID: ${quotedMsg.chatwootMessageId}`);
             return { in_reply_to: Number(quotedMsg.chatwootMessageId) }; // ID interno do Chatwoot
        } else {
             // Senão, usa o ID externo (stanzaId) prefixado
             this.logger.debug(`Mensagem citada não encontrada no DB ou sem Chatwoot ID. Usando ID externo: WAID:${stanzaId}`);
             return { in_reply_to_external_id: `WAID:${stanzaId}` }; // ID externo do WhatsApp
        }
    }

} // Fim da classe ChatwootService
