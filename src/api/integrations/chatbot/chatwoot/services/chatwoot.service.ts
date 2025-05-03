// src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts
// Correções Gemini: Imports, chamadas Prisma, tipos, acesso a propriedades de API, lógica de cache, etc.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
// CORREÇÃO TS2305: Usar DTOs corretos
import { SendMediaDto, SendMessageOptions, SendTextDto } from '@api/dto/sendMessage.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '../dto/chatwoot.dto';
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { ConfigService, Chatwoot as ChatwootConfig } from '@config/env.config';
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar monitor.service
import { Logger } from '@config/logger.config';
import { Events } from '@api/types/wa.types';
// CORREÇÃO TS2304: Importar createJid
import { createJid } from '@utils/createJid';
import { ChannelStartupService } from '@api/services/channel.service';
import { Prisma, Message } from '@prisma/client'; // Importar tipos Prisma
import axios from 'axios';
import { isBase64 } from 'class-validator';
import * as Sentry from '@sentry/node';

// Tipos locais para respostas Chatwoot (simplificado)
type ChatwootContact = { id: number; name?: string; identifier?: string; phone_number?: string; };
type ChatwootConversation = { id: number; inbox_id: number; contact_inbox?: { contact_id: number }; };
type ChatwootMessage = { id: number; content?: string; inbox_id: number; conversation_id: number; contact?: ChatwootContact; };
type ChatwootInbox = { id: number; name?: string; channel?: { name: string; }; };

@Injectable()
export class ChatwootService implements OnModuleInit {
  private readonly logger: Logger;
  private readonly isEnabled: boolean;
  private readonly chatwootContactsCache: CacheService;
  // Armazena a configuração localmente para evitar múltiplas buscas no DB
  // Mapeamento: instanceId -> ChatwootDto
  private instanceConfigs: Map<string, ChatwootDto> = new Map();

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService, // Cache geral
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly waMonitor: WAMonitoringService,
    baseLogger: Logger
  ) {
    this.logger = baseLogger.child({ context: ChatwootService.name });
    this.isEnabled = this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED ?? false;
    this.chatwootContactsCache = new CacheService(this.cache.getEngine(), 'chatwootContacts');
    this.logger.info(`Chatwoot Service Initialized. Enabled: ${this.isEnabled}`);
  }

  async onModuleInit() {
    if (this.isEnabled) {
      this.logger.info('Chatwoot habilitado globalmente.');
      // Pré-carregar configurações das instâncias ativas?
      // await this.loadAllInstanceConfigs();
    }
  }

  /**
   * Busca e armazena em cache a configuração do Chatwoot para uma instância.
   */
  private async getCachedConfig(instanceId: string): Promise<ChatwootDto | null> {
      if (!instanceId) return null;
      // Tenta pegar do cache Map local primeiro
      let config = this.instanceConfigs.get(instanceId);
      if (config !== undefined) { // Cache hit (pode ser null se já buscamos e não achamos)
          return config;
      }
      // Se não está no Map local, busca no DB
      config = await this.findChatwootConfigDB(instanceId);
      this.instanceConfigs.set(instanceId, config); // Cacheia o resultado (incluindo null)
      return config;
  }

  /**
   * Busca configuração diretamente do DB.
   */
  private async findChatwootConfigDB(instanceId: string): Promise<ChatwootDto | null> {
      this.logger.debug(`Buscando config Chatwoot no DB para instanceId: ${instanceId}`);
      try {
          // CORREÇÃO TS2339: Remover .prisma
          const configDb = await this.prismaRepository.chatwoot.findUnique({
              where: { instanceId: instanceId },
          });
          if (configDb) {
              const dto: ChatwootDto = { // Mapeamento DB -> DTO
                enabled: configDb.enabled,
                url: configDb.url,
                account_id: configDb.accountId ? parseInt(configDb.accountId) : undefined,
                token: configDb.token,
                // CORREÇÃO TS2367 (foi feita aqui antes, agora deve ser booleano direto do DB)
                signMsg: !!configDb.signMsg, // Garantir booleano
                reopenConversation: configDb.reopenConversation,
                conversationPending: configDb.conversationPending,
                nameInbox: configDb.nameInbox,
                importMessages: configDb.importMessages,
                importContacts: configDb.importContacts,
                daysLimitImportMessages: configDb.daysLimitImportMessages,
                mergeBrazilContacts: configDb.mergeBrazilContacts,
                signDelimiter: configDb.signDelimiter || undefined,
                organization: typeof configDb.organization === 'string' ? configDb.organization : undefined,
                logo: configDb.logo || undefined,
                ignoreJids: Array.isArray(configDb.ignoreJids) ? configDb.ignoreJids as string[] : [],
            };
              return dto;
          }
          return null;
      } catch (error) {
          this.logger.error({ err: error, instanceId, msg: 'Erro ao buscar configuração Chatwoot no DB' });
          return null;
      }
  }

   /**
    * Limpa o cache de configuração local para uma instância.
    */
   private clearConfigCache(instanceId: string): void {
        this.instanceConfigs.delete(instanceId);
        this.logger.debug(`Cache de configuração Chatwoot limpo para ${instanceId}`);
   }


  /**
   * Salva ou atualiza a configuração do Chatwoot para uma instância específica.
   */
  async setChatwootConfig(instanceId: string, data: ChatwootDto): Promise<ChatwootDto> {
     if (!this.isEnabled) {
        throw new BadRequestException('Chatwoot não está habilitado globalmente.');
     }
     this.logger.info(`Salvando config Chatwoot para instanceId: ${instanceId}`);

     const updateData: Prisma.ChatwootUpdateInput = {
        enabled: data.enabled, url: data.url, accountId: data.account_id ? String(data.account_id) : null, token: data.token,
        // CORREÇÃO TS2322: Salvar como boolean
        signMsg: data.signMsg ?? false,
        reopenConversation: data.reopenConversation ?? false, conversationPending: data.conversationPending ?? false,
        nameInbox: data.nameInbox, importMessages: data.importMessages ?? false, importContacts: data.importContacts ?? false,
        daysLimitImportMessages: data.daysLimitImportMessages ?? 0, mergeBrazilContacts: data.mergeBrazilContacts ?? false,
        signDelimiter: data.signDelimiter, organization: data.organization, logo: data.logo,
        ignoreJids: data.ignoreJids ?? [],
     };
     const createData: Prisma.ChatwootUncheckedCreateInput = {
        ...updateData, // Usa os mesmos dados mapeados
        instanceId: instanceId, // Adiciona instanceId obrigatório para create
     };

     try {
        // CORREÇÃO TS2339: Remover .prisma
        await this.prismaRepository.chatwoot.upsert({
            where: { instanceId: instanceId },
            create: createData,
            update: updateData,
        });

        // CORREÇÃO TS2339: Remover chamada a método inexistente
        // await this.initInstanceChatwoot(...);

        // Limpar caches após salvar
        this.clearConfigCache(instanceId);
        this.clearChatwootCache(instanceId); // Limpa cache de contatos também

        this.logger.info(`Configuração Chatwoot salva para ${instanceId}`);
        return await this.getCachedConfig(instanceId) || data; // Retorna a config atualizada do cache/DB

     } catch (error: any) {
        this.logger.error({ err: error, instanceId, data, msg: 'Erro ao salvar configuração Chatwoot no DB' });
        throw new InternalServerErrorException(`Erro ao salvar configuração: ${error.message}`);
     }
  }

   /**
    * Busca as configurações do Chatwoot para uma instância (usa cache).
    */
   public async findChatwootConfig(instanceId: string): Promise<ChatwootDto | null> {
       if (!this.isEnabled) return null;
       return this.getCachedConfig(instanceId);
   }

  /**
   * Limpa caches relacionados ao Chatwoot para uma instância.
   */
  private clearChatwootCache(instanceId: string): void {
    this.logger.debug(`Limpando cache de contatos Chatwoot para instância: ${instanceId}`);
    this.chatwootContactsCache.deleteAll?.(`${instanceId}:*`)
        .then(count => this.logger.debug(`Cache de contatos Chatwoot limpo para ${instanceId}. ${count} chaves removidas.`))
        .catch(err => this.logger.error({ err, instanceId, msg: 'Erro ao limpar cache de contatos Chatwoot' }));
  }

  // --- Métodos de API Chatwoot ---

  private async chatwootAPI(method: 'get' | 'post' | 'put' | 'delete', endpoint: string, instanceId: string, data?: any): Promise<any> {
      const config = await this.getCachedConfig(instanceId); // Busca config do cache
      if (!config?.enabled || !config?.url || !config?.token || !config?.account_id) {
          throw new Error(`Chatwoot não configurado ou desabilitado para a instância ${instanceId}.`);
      }

      const url = `${config.url.replace(/\/$/, '')}${endpoint}`;
      const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'api_access_token': config.token,
      };

      this.logger.debug(`Chamando API Chatwoot [${instanceId}]: ${method.toUpperCase()} ${url}`);
      if (data && method !== 'get' && method !== 'delete') {
          this.logger.debug(`Payload Chatwoot: ${JSON.stringify(data)}`);
      }

      try {
          const response = await axios({ method, url, headers, data });
          this.logger.debug(`Resposta da API Chatwoot (${response.status}) [${instanceId}]: ${JSON.stringify(response.data)}`);
          return response.data; // Retorna os dados da resposta
      } catch (error: any) {
          this.logger.error({
              err: error, instanceId, method, url, status: error.response?.status,
              responseData: error.response?.data,
              msg: `Erro na chamada à API Chatwoot`
          });
          throw new Error(`Erro Chatwoot API (${error.response?.status}) [${instanceId}]: ${error.response?.data?.message || error.message}`);
      }
  }

  // Métodos específicos da API (exemplos)

  async findContact(identifier: string, instanceId: string): Promise<ChatwootContact | null> {
      const config = await this.getCachedConfig(instanceId);
      if (!config) return null;
      const endpoint = `/api/v1/accounts/${config.account_id}/contacts/search`;
      try {
          const response = await this.chatwootAPI('get', `${endpoint}?q=${encodeURIComponent(identifier)}`, instanceId);
          // CORREÇÃO TS2339: Acessar dados diretamente (ou via 'data' se a API retornar assim)
          const contacts = response?.payload as ChatwootContact[]; // Assumindo payload
          return contacts?.find(c => c.identifier === identifier || c.phone_number === identifier) || null;
      } catch (error) {
          // Log já feito em chatwootAPI
          return null;
      }
  }

  async createContact(contactData: any, instanceId: string): Promise<ChatwootContact | null> {
       const config = await this.getCachedConfig(instanceId);
       if (!config) return null;
       const endpoint = `/api/v1/accounts/${config.account_id}/contacts`;
       try {
            const newContact = await this.chatwootAPI('post', endpoint, instanceId, contactData);
            // CORREÇÃO TS2339: Acessar dados corretamente
            const createdContact = newContact?.payload?.contact || newContact?.contact || newContact; // Tentar diferentes caminhos
            if (createdContact?.id) {
                this.logger.log(`Contato Chatwoot criado [${instanceId}]: ID ${createdContact.id}`);
            }
            return createdContact || null;
       } catch (error) {
          // Log já feito em chatwootAPI
          return null;
       }
  }

  async listInboxes(instanceId: string): Promise<ChatwootInbox[]> {
       const config = await this.getCachedConfig(instanceId);
       if (!config) return [];
       const endpoint = `/api/v1/accounts/${config.account_id}/inboxes`;
       try {
           const listResponse = await this.chatwootAPI('get', endpoint, instanceId);
           // CORREÇÃO TS2339: Acessar dados corretamente
           return (listResponse?.payload as ChatwootInbox[]) || []; // Assumindo payload
       } catch (error) {
            return [];
       }
  }

  async findInbox(inboxName: string, instanceId: string): Promise<ChatwootInbox | null> {
      const inboxes = await this.listInboxes(instanceId);
      return inboxes.find(i => i.name === inboxName) || null;
  }

  async listConversations(contactId: number, instanceId: string, inboxId?: number): Promise<ChatwootConversation[]> {
       const config = await this.getCachedConfig(instanceId);
       if (!config) return [];
       const endpoint = `/api/v1/accounts/${config.account_id}/contacts/${contactId}/conversations`;
       try {
           const convList = await this.chatwootAPI('get', endpoint, instanceId);
           // CORREÇÃO TS2339: Acessar dados corretamente
           const conversations = (convList?.payload as ChatwootConversation[]) || []; // Assumindo payload
           return inboxId ? conversations.filter(c => c.inbox_id === inboxId) : conversations;
       } catch (error) {
           return [];
       }
  }

   async findConversation(contactId: number, inboxId: number, instanceId: string): Promise<ChatwootConversation | null> {
       const conversations = await this.listConversations(contactId, instanceId, inboxId);
       return conversations.length > 0 ? conversations[0] : null;
   }

   async createConversation(inboxId: number, contactId: number, sourceId: string, instanceId: string): Promise<ChatwootConversation | null> {
       const config = await this.getCachedConfig(instanceId);
       if (!config) return null;
       const endpoint = `/api/v1/accounts/${config.account_id}/conversations`;
       const payload = { inbox_id: inboxId, contact_id: contactId, source_id: sourceId };
       try {
            const response = await this.chatwootAPI('post', endpoint, instanceId, payload);
            return response as ChatwootConversation || null; // Resposta pode ser a conversa diretamente
       } catch(error) {
            return null;
       }
   }

   async createMessage(conversationId: number, messageData: any, instanceId: string): Promise<ChatwootMessage | null> {
        const config = await this.getCachedConfig(instanceId);
        if (!config) return null;
        const endpoint = `/api/v1/accounts/${config.account_id}/conversations/${conversationId}/messages`;
        try {
             const response = await this.chatwootAPI('post', endpoint, instanceId, messageData);
             // A resposta pode vir em data ou data.payload
             const message = (response?.data || response?.payload) as ChatwootMessage;
             if (message?.id) {
                 this.logger.log(`Mensagem Chatwoot criada [${instanceId}]: ConvID=${conversationId}, MsgID=${message.id}`);
             }
             return message || null;
        } catch (error) {
             return null;
        }
   }

  // --- Processamento de Webhook ---

  async processWebhook(eventData: { instanceId: string; payload: any }): Promise<any> {
    const { instanceId, payload } = eventData;
    this.logger.info(`Processando webhook Chatwoot para instanceId: ${instanceId}`);
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    if (!this.isEnabled) {
      this.logger.warn(`Integração Chatwoot desabilitada globalmente. Webhook ignorado.`);
      return { ignored: true, reason: 'Chatwoot globally disabled.' };
    }

    const config = await this.getCachedConfig(instanceId);
    if (!config?.enabled) {
      this.logger.warn(`Chatwoot desabilitado para instância ${instanceId}. Ignorando webhook.`);
      return { ignored: true, reason: 'Chatwoot disabled for instance' };
    }

    // Ignora mensagens privadas ou não enviadas por Agente/Bot de Agente
    const senderType = payload?.sender?.type;
    if (payload.private || (senderType && senderType !== 'AgentBot' && senderType !== 'Agent')) {
      this.logger.debug(`Webhook ignorado [${instanceId}]: Mensagem privada ou não é de agente (Sender type: ${senderType})`);
      return { ignored: true, reason: 'Private message or not from agent' };
    }

    const waInstance = this.waMonitor.get(instanceId); // Busca instância pelo ID
    // CORREÇÃO TS451: Usar connectionState.connection
    if (!waInstance || waInstance.connectionState?.connection !== 'open') {
       this.logger.error(`Instância WhatsApp ${instanceId} não encontrada ou não conectada. Impossível enviar mensagem do Chatwoot.`);
       // Retornar erro ou status que indique falha no envio?
       return { ignored: false, status: 'error', reason: `WhatsApp instance ${instanceId} not connected.` };
    }

    const content = payload.content;
    // Tenta obter o identificador (JID) de diferentes locais no payload
    const contactIdentifier = payload.conversation?.contact_inbox?.contact?.identifier
                             || payload.conversation?.meta?.sender?.identifier
                             || payload.sender?.identifier; // Adicionado fallback para sender.identifier

    const messageType = payload.message_type; // incoming, outgoing, template

    if (!contactIdentifier || (content == null && !payload.attachments?.length)) { // Verifica se há conteúdo ou anexo
       this.logger.warn(`Webhook Chatwoot [${instanceId}] sem identificador de contato ou conteúdo/anexo. Ignorando. Payload: ${JSON.stringify(payload)}`);
       return { ignored: true, reason: 'Missing identifier or content/attachments' };
    }

    // CORREÇÃO TS2304: Usar createJid importado
    const remoteJid = createJid(contactIdentifier);

    try {
      this.logger.info(`Enviando mensagem do Chatwoot [${instanceId}] para WhatsApp: ${remoteJid}`);

      // Tratar anexos
      if (payload.attachments && payload.attachments.length > 0) {
          this.logger.info(`Processando ${payload.attachments.length} anexos do Chatwoot.`);
          for (const attachment of payload.attachments) {
              const mediaUrl = attachment.data_url;
              const mimeType = attachment.file_type; // Chatwoot usa file_type como mimetype? verificar
              const fileName = attachment.file_name;
              // Determinar mediaType baseado no mimeType
              let mediaType: SendMediaDto['mediaType'] = 'document';
              if (mimeType?.startsWith('image/')) mediaType = 'image';
              else if (mimeType?.startsWith('video/')) mediaType = 'video';
              else if (mimeType?.startsWith('audio/')) mediaType = 'audio';
              // TODO: Tratar stickers?

              if (!mediaUrl) {
                 this.logger.warn(`Anexo sem data_url no webhook Chatwoot: ${JSON.stringify(attachment)}`);
                 continue;
              }

              const mediaDto: SendMediaDto = {
                  number: remoteJid,
                  mediaType: mediaType,
                  media: mediaUrl, // Envia URL pública
                  mimetype: mimeType,
                  fileName: fileName,
                  caption: mediaType !== 'audio' ? content : undefined // Adiciona conteúdo como legenda (exceto áudio)
              };
              // Limpa content para não enviar texto duplicado se for legenda
              if (mediaType !== 'audio') content = null;
              await waInstance.mediaMessage(mediaDto, {}); // Passa options vazio
              await delay(settings?.delayMessage ?? 50); // Pequeno delay entre mídias
          }
      }

      // Enviar conteúdo de texto (se ainda existir após processar anexos)
      if (content != null && String(content).trim() !== '') {
          const sendPayload: SendTextDto = { number: remoteJid, text: content };
          // CORREÇÃO TS469: Remover argumento 'true'
          await waInstance.textMessage(sendPayload, {}); // Passa options vazio
      }

      this.logger.info(`Mensagem(ns) do Chatwoot enviada(s) para ${remoteJid} via ${waInstance.constructor.name}.`);
      return { status: 'success' };

    } catch (error: any) {
       this.logger.error({ err: error, jid: remoteJid, instanceId, msg: 'Erro ao enviar mensagem do Chatwoot para o WhatsApp' });
       // Retorna erro, mas Chatwoot pode tentar reenviar. Talvez retornar OK?
       return { status: 'error', message: `Failed to send message: ${error.message}` };
    }
  }

  // Métodos legados/internos (revisar/remover)
  // ...

  // Métodos de Importação (revisar/corrigir erros Prisma)
  async importContactsFromChatwoot(instance: InstanceDto): Promise<any> {
     this.logger.warn(`Importação de contatos do Chatwoot não implementada/revisada para ${instance.instanceName}.`);
     // CORREÇÃO TS2339: Remover .prisma
     // const contacts = await this.prismaRepository.contact.findMany({ where: { instanceId: instance.instanceId! } });
     return { status: 'Not implemented' };
  }

  async importMessagesFromChatwoot(instance: InstanceDto, daysLimit?: number): Promise<any> {
      this.logger.warn(`Importação de mensagens do Chatwoot não implementada/revisada para ${instance.instanceName}.`);
      // CORREÇÃO TS2339: Remover .prisma e usar método correto
      // const saved = await this.prismaRepository.message.findMany({ /* ... */ });
      // CORREÇÃO TS2339: Usar método correto
      // const quotedMsg = await this.prismaRepository.message.findFirst({ /* ... */ });
      return { status: 'Not implemented' };
  }

} // Fim da classe ChatwootService
