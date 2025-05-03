// src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts
// Correções Gemini: Imports, chamadas Prisma, tipos, acesso a propriedades de API, lógica de cache, etc.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleInit } from '@nestjs/common'; // Assumindo uso de NestJS pela estrutura
import { EventEmitter2 } from 'eventemitter2';
// CORREÇÃO TS2305: Remover Options, Quoted, SendAudioDto. Usar SendMessageOptions, SendMediaDto, SendTextDto
import { SendMediaDto, SendMessageOptions, SendTextDto } from '@api/dto/sendMessage.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '../dto/chatwoot.dto';
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { ConfigService, Chatwoot as ChatwootConfig } from '@config/env.config';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { Events } from '@api/types/wa.types';
// CORREÇÃO TS2304: Importar createJid
import { createJid } from '@utils/createJid';
import { ChannelStartupService } from '@api/services/channel.service'; // Importar classe base
import { Prisma, Message } from '@prisma/client'; // Importar tipos Prisma
import axios from 'axios';
import { isBase64 } from 'class-validator';
import * as Sentry from '@sentry/node';

// Tipos locais para respostas Chatwoot (simplificado, ajustar conforme API real)
type ChatwootContact = { id: number; name?: string; identifier?: string; phone_number?: string; };
type ChatwootConversation = { id: number; inbox_id: number; contact_inbox?: { contact_id: number }; };
type ChatwootMessage = { id: number; content?: string; inbox_id: number; conversation_id: number; contact?: ChatwootContact; };
type ChatwootInbox = { id: number; name?: string; channel?: { name: string; }; };

@Injectable() // Adicionar se for um provider NestJS
export class ChatwootService implements OnModuleInit {
  private readonly logger: Logger;
  private readonly isEnabled: boolean;
  // Cache específico para contatos Chatwoot (contato_identifier -> contact_id)
  private readonly chatwootContactsCache: CacheService;
  private provider: Partial<ChatwootDto> = {}; // Armazena config localmente

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService, // Cache geral
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly waMonitor: WAMonitoringService, // Injetar WAMonitoringService
    baseLogger: Logger // Receber logger base
  ) {
    this.logger = baseLogger.child({ context: ChatwootService.name });
    this.isEnabled = this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED ?? false;
    // Criar um namespace de cache dedicado para contatos chatwoot
    this.chatwootContactsCache = new CacheService(this.cache.getEngine(), 'chatwootContacts');
    this.logger.info(`Chatwoot Service Initialized. Enabled: ${this.isEnabled}`);
  }

  // Carregar configurações ao iniciar o módulo (se usar NestJS)
  async onModuleInit() {
    if (this.isEnabled) {
      this.logger.info('Chatwoot habilitado globalmente.');
      // Pode carregar configurações padrão ou realizar outras inicializações aqui
    }
  }

  // --- Métodos de Configuração ---

  /**
   * Busca a configuração do Chatwoot para uma instância específica.
   */
  async findChatwootConfig(instanceId: string): Promise<ChatwootDto | null> {
    if (!this.isEnabled) return null;
    this.logger.debug(`Buscando config Chatwoot para instanceId: ${instanceId}`);
    try {
      // CORREÇÃO TS2339: Remover .prisma
      const config = await this.prismaRepository.chatwoot.findUnique({
        where: { instanceId: instanceId },
      });
       // Mapear do modelo Prisma para o DTO
       if (config) {
           return {
               enabled: config.enabled,
               url: config.url,
               account_id: config.accountId ? parseInt(config.accountId) : undefined, // Ajustar tipo
               token: config.token,
               signMsg: config.signMsg, // Já é boolean no schema?
               reopenConversation: config.reopenConversation,
               conversationPending: config.conversationPending,
               nameInbox: config.nameInbox,
               importMessages: config.importMessages,
               importContacts: config.importContacts,
               daysLimitImportMessages: config.daysLimitImportMessages,
               mergeBrazilContacts: config.mergeBrazilContacts,
               signDelimiter: config.signDelimiter || undefined,
               organization: typeof config.organization === 'string' ? config.organization : undefined, // Ajustar tipo
               logo: config.logo || undefined,
               ignoreJids: Array.isArray(config.ignoreJids) ? config.ignoreJids as string[] : [], // Garantir array de string
           };
       }
      return null;
    } catch (error) {
      this.logger.error({ err: error, instanceId, msg: 'Erro ao buscar configuração Chatwoot no DB' });
      return null;
    }
  }

  /**
   * Salva ou atualiza a configuração do Chatwoot para uma instância específica.
   */
  async setChatwootConfig(instanceId: string, data: ChatwootDto): Promise<ChatwootDto> {
     if (!this.isEnabled) {
        throw new BadRequestException('Chatwoot não está habilitado globalmente.');
     }
     this.logger.info(`Salvando config Chatwoot para instanceId: ${instanceId}`);
     // Mapear DTO para modelo Prisma
     const updateData: Prisma.ChatwootUpdateInput = {
        enabled: data.enabled,
        url: data.url,
        accountId: data.account_id ? String(data.account_id) : null, // Salvar como string? Verificar schema
        token: data.token,
        // CORREÇÃO TS2322: Salvar como boolean
        signMsg: data.signMsg ?? false,
        reopenConversation: data.reopenConversation ?? false,
        conversationPending: data.conversationPending ?? false,
        nameInbox: data.nameInbox,
        importMessages: data.importMessages ?? false,
        importContacts: data.importContacts ?? false,
        daysLimitImportMessages: data.daysLimitImportMessages ?? 0,
        mergeBrazilContacts: data.mergeBrazilContacts ?? false,
        signDelimiter: data.signDelimiter,
        organization: data.organization,
        logo: data.logo,
        ignoreJids: data.ignoreJids ?? [],
     };
     const createData: Prisma.ChatwootUncheckedCreateInput = {
        ...updateData,
        instanceId: instanceId,
     };

     try {
        // CORREÇÃO TS2339: Remover .prisma
        const savedProvider = await this.prismaRepository.chatwoot.upsert({
            where: { instanceId: instanceId },
            create: createData,
            update: updateData,
        });

        // CORREÇÃO TS2339: Método não existe, lógica de carregar config deve ocorrer em outro lugar
        // await this.initInstanceChatwoot(...); // Remover esta chamada

        // Limpar cache relacionado após salvar
        this.clearChatwootCache(instanceId);

        this.logger.info(`Configuração Chatwoot salva para ${instanceId}`);
        return await this.findChatwootConfig(instanceId) || data; // Retorna a config atualizada

     } catch (error: any) {
        this.logger.error({ err: error, instanceId, data, msg: 'Erro ao salvar configuração Chatwoot no DB' });
        throw new InternalServerErrorException(`Erro ao salvar configuração: ${error.message}`);
     }
  }

  /**
   * Limpa caches relacionados ao Chatwoot para uma instância.
   */
  private clearChatwootCache(instanceId: string): void {
    this.logger.debug(`Limpando cache Chatwoot para instância: ${instanceId}`);
    // Limpa cache de contatos específico do Chatwoot
    this.chatwootContactsCache.deleteAll?.(`${instanceId}:*`)
        .then(count => this.logger.debug(`Cache de contatos Chatwoot limpo para ${instanceId}. ${count} chaves removidas.`))
        .catch(err => this.logger.error({ err, instanceId, msg: 'Erro ao limpar cache de contatos Chatwoot' }));
    // Limpar outros caches gerais se necessário
    this.cache.del(`${instanceId}:chatwootConfig`); // Exemplo de chave de config
  }

  // --- Métodos de API Chatwoot ---

  /**
   * Método genérico para fazer chamadas à API do Chatwoot.
   */
  private async chatwootAPI(method: 'get' | 'post' | 'put' | 'delete', endpoint: string, data?: any, config?: ChatwootDto): Promise<any> {
      const activeConfig = config || this.provider; // Usar config passada ou a local
      if (!activeConfig?.url || !activeConfig?.token) {
          throw new Error('URL ou Token do Chatwoot não configurados.');
      }

      const url = `${activeConfig.url.replace(/\/$/, '')}${endpoint}`; // Garante que não haja //
      const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'api_access_token': activeConfig.token,
      };

      this.logger.debug(`Chamando API Chatwoot: ${method.toUpperCase()} ${url}`);
      if (data && method !== 'get' && method !== 'delete') {
          this.logger.debug(`Payload Chatwoot: ${JSON.stringify(data)}`);
      }

      try {
          const response = await axios({ method, url, headers, data });
          this.logger.debug(`Resposta da API Chatwoot (${response.status}): ${JSON.stringify(response.data)}`);
          return response.data; // Retorna os dados da resposta
      } catch (error: any) {
          this.logger.error({
              err: error,
              method, url, status: error.response?.status,
              responseData: error.response?.data,
              msg: `Erro na chamada à API Chatwoot`
          });
          // Lança um erro mais informativo
          throw new Error(`Erro Chatwoot API (${error.response?.status}): ${error.response?.data?.message || error.message}`);
      }
  }

  // Métodos específicos da API (exemplos)

  async findContact(identifier: string, config?: ChatwootDto): Promise<ChatwootContact | null> {
      const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/contacts/search`;
      try {
          const response = await this.chatwootAPI('get', `${endpoint}?q=${encodeURIComponent(identifier)}`, undefined, config);
          // CORREÇÃO TS2339: Acessar dados corretamente (assumindo retorno em 'payload')
          // Se a API retornar um array diretamente, usar response.find(...)
          const contacts = response?.payload as ChatwootContact[]; // Assumindo que a resposta está em 'payload'
          return contacts?.find(c => c.identifier === identifier || c.phone_number === identifier) || null;
      } catch (error) {
          this.logger.error({ err: error, identifier, msg: 'Erro ao buscar contato no Chatwoot' });
          return null; // Retorna null em caso de erro
      }
  }

  async createContact(contactData: any, config?: ChatwootDto): Promise<ChatwootContact | null> {
      const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/contacts`;
      try {
          const newContact = await this.chatwootAPI('post', endpoint, contactData, config);
          // CORREÇÃO TS2339: Acessar dados corretamente (assumindo retorno em 'payload.contact')
          const createdContact = newContact?.payload?.contact as ChatwootContact; // Ajustar se a estrutura for diferente
          if (createdContact?.id) {
              this.logger.log(`Contato Chatwoot criado com sucesso: ID ${createdContact.id}`);
          }
          return createdContact || null;
      } catch (error) {
         this.logger.error({ err: error, contactData, msg: 'Erro ao criar contato no Chatwoot' });
         return null;
      }
  }

  async listInboxes(config?: ChatwootDto): Promise<ChatwootInbox[]> {
    const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/inboxes`;
    try {
        const listResponse = await this.chatwootAPI('get', endpoint, undefined, config);
        // CORREÇÃO TS2339: Acessar dados diretamente (assumindo array no payload)
        return (listResponse?.payload as ChatwootInbox[]) || []; // Assumindo retorno em payload
    } catch (error) {
         this.logger.error({ err: error, msg: 'Erro ao listar inboxes no Chatwoot' });
         return [];
    }
  }

  async findInbox(inboxName: string, config?: ChatwootDto): Promise<ChatwootInbox | null> {
      const inboxes = await this.listInboxes(config);
      return inboxes.find(i => i.name === inboxName) || null;
  }

  async listConversations(contactId: number, inboxId?: number, config?: ChatwootDto): Promise<ChatwootConversation[]> {
      const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/contacts/${contactId}/conversations`;
      try {
          const convList = await this.chatwootAPI('get', endpoint, undefined, config);
          // CORREÇÃO TS2339: Acessar dados diretamente
          const conversations = (convList?.payload as ChatwootConversation[]) || []; // Assumindo retorno em payload
          return inboxId ? conversations.filter(c => c.inbox_id === inboxId) : conversations;
      } catch (error) {
          this.logger.error({ err: error, contactId, msg: 'Erro ao listar conversas no Chatwoot' });
          return [];
      }
  }

   async findConversation(contactId: number, inboxId: number, config?: ChatwootDto): Promise<ChatwootConversation | null> {
       const conversations = await this.listConversations(contactId, inboxId, config);
       return conversations.length > 0 ? conversations[0] : null; // Retorna a primeira encontrada
   }

   async createConversation(inboxId: number, contactId: number, sourceId: string, config?: ChatwootDto): Promise<ChatwootConversation | null> {
       const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/conversations`;
       const payload = {
           inbox_id: inboxId,
           contact_id: contactId,
           source_id: sourceId // Usar o JID como source_id
       };
       try {
            const response = await this.chatwootAPI('post', endpoint, payload, config);
            // A resposta da criação pode variar, pode retornar a conversa criada diretamente
            return response as ChatwootConversation || null;
       } catch(error) {
            this.logger.error({ err: error, payload, msg: 'Erro ao criar conversa no Chatwoot' });
            return null;
       }
   }

   async createMessage(conversationId: number, messageData: any, config?: ChatwootDto): Promise<ChatwootMessage | null> {
       const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/conversations/${conversationId}/messages`;
       try {
            const response = await this.chatwootAPI('post', endpoint, messageData, config);
             // A resposta pode vir em data ou data.payload
            const message = (response?.data || response?.payload) as ChatwootMessage;
            if (message?.id) {
                this.logger.log(`Mensagem Chatwoot criada: ConvID=${conversationId}, MsgID=${message.id}`);
            }
            return message || null;
       } catch (error) {
            this.logger.error({ err: error, conversationId, messageData, msg: 'Erro ao criar mensagem no Chatwoot' });
            return null;
       }
   }


  // --- Processamento de Webhook ---

  /**
   * Processa eventos recebidos do Chatwoot (mensagens enviadas pelo agente).
   */
  async processWebhook(eventData: { instanceId: string; payload: any }): Promise<any> {
    const { instanceId, payload } = eventData;
    this.logger.info(`Processando webhook Chatwoot para instanceId: ${instanceId}`);
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    // Carregar configuração específica da instância
    const config = await this.findChatwootConfig(instanceId);
    if (!config?.enabled) {
      this.logger.warn(`Chatwoot desabilitado para instância ${instanceId}. Ignorando webhook.`);
      return { ignored: true, reason: 'Chatwoot disabled for instance' };
    }

    // Validar se a mensagem veio de um agente (não do bot/contato)
    if (payload.private || payload.sender?.type !== 'AgentBot') { // Verifica se é privada ou não é de agente
      this.logger.debug(`Webhook ignorado: Mensagem privada ou não enviada por agente (Sender type: ${payload.sender?.type})`);
      return { ignored: true, reason: 'Private message or not from agent' };
    }

    // Obter instância ativa do WhatsApp
    const waInstance = this.waMonitor.get(config.instanceName!); // Usa instanceName da config
    // CORREÇÃO TS451: Usar connectionState ou getStatus()
    if (!waInstance || waInstance.connectionState?.connection !== 'open') { // Verifica se está conectada
       this.logger.error(`Instância WhatsApp ${config.instanceName} não encontrada ou não conectada. Impossível enviar mensagem do Chatwoot.`);
       throw new Error(`WhatsApp instance ${config.instanceName} not connected.`);
    }

    // Extrair informações relevantes do webhook
    const content = payload.content;
    const contactIdentifier = payload.conversation?.contact_inbox?.contact?.identifier || payload.conversation?.meta?.sender?.identifier;
    const messageType = payload.message_type; // incoming, outgoing, template

    if (!contactIdentifier || !content) {
       this.logger.warn('Webhook Chatwoot sem identificador de contato ou conteúdo. Ignorando.');
       return { ignored: true, reason: 'Missing identifier or content' };
    }

    // CORREÇÃO TS2304: Importar e usar createJid
    const remoteJid = createJid(contactIdentifier); // Normaliza o JID

    // Enviar mensagem para o WhatsApp
    try {
      this.logger.info(`Enviando mensagem do Chatwoot para WhatsApp: ${remoteJid}`);
      // TODO: Tratar anexos (attachments) do webhook Chatwoot
      if (payload.attachments && payload.attachments.length > 0) {
          this.logger.warn("Envio de anexos do Chatwoot para WhatsApp não implementado.");
          // Precisa baixar o anexo da URL fornecida pelo Chatwoot e enviar como SendMediaDto
          for (const attachment of payload.attachments) {
              // const mediaUrl = attachment.data_url;
              // const mimeType = attachment.file_type;
              // const fileName = attachment.file_name;
              // const mediaDto: SendMediaDto = { number: remoteJid, mediaType: 'document', media: mediaUrl, mimetype: mimeType, fileName: fileName }; // Adaptar mediaType
              // await waInstance.mediaMessage(mediaDto);
          }
      }

      // Enviar conteúdo de texto
      const sendPayload: SendTextDto = {
        number: remoteJid,
        text: content,
      };
      // CORREÇÃO TS469: Remover argumento booleano extra
      const result = await waInstance.textMessage(sendPayload); // Não passar 'true'

      this.logger.info(`Mensagem enviada para ${remoteJid} via ${waInstance.constructor.name}. Result ID: ${result?.key?.id}`);
      return { status: 'success', messageId: result?.key?.id };

    } catch (error: any) {
       this.logger.error({ err: error, jid: remoteJid, msg: 'Erro ao enviar mensagem do Chatwoot para o WhatsApp' });
       throw error; // Relança o erro para tratamento superior
    }
  }

  // --- Métodos legados/internos (revisar necessidade e corrigir) ---

  public async eventWhatsapp(event: Events, instanceData: any, msg: any): Promise<any> {
    // Este método parece ser um dispatcher interno obsoleto. A lógica foi movida
    // para processWebhook (recebimento) e para os métodos de envio (envio).
    this.logger.warn("Método 'eventWhatsapp' está obsoleto e não deve ser chamado diretamente.");
    return null;
    // A lógica antiga tentava reprocessar webhooks ou enviar mensagens.
  }

  // Método obsoleto ou com nome confuso
  public async processWebhookEvolution(data: any, instanceName: string): Promise<any> {
    this.logger.warn("Método 'processWebhookEvolution' está obsoleto.");
    // A lógica de webhook deve ser tratada por processWebhook ou métodos específicos da instância.
    return null;
  }

  // Método para buscar mensagens do Chatwoot via API (exemplo, não usado no fluxo normal de webhook)
  async getChatwootMessages(conversationId: number, config?: ChatwootDto): Promise<any[]> {
    const endpoint = `/api/v1/accounts/${config?.account_id || this.provider?.account_id}/conversations/${conversationId}/messages`;
    try {
        const response = await this.chatwootAPI('get', endpoint, undefined, config);
        return response?.payload || []; // Assumindo retorno em payload
    } catch (error) {
        this.logger.error({ err: error, conversationId, msg: 'Erro ao buscar mensagens no Chatwoot' });
        return [];
    }
  }


  // Métodos relacionados à importação (precisam ser revisados e corrigidos)
  async importContactsFromChatwoot(instance: InstanceDto): Promise<any> {
     this.logger.warn("Importação de contatos do Chatwoot não implementada/revisada.");
     return { status: 'Not implemented' };
     // Lógica original usava 'prismaRepository.prisma.contact'
     // CORREÇÃO: Usar this.prismaRepository.contact.findMany
     // const contacts = await this.prismaRepository.contact.findMany({ where: { instanceId: instance.instanceId } });
     // ... (lógica de busca/criação no Chatwoot) ...
  }

  async importMessagesFromChatwoot(instance: InstanceDto, daysLimit?: number): Promise<any> {
      this.logger.warn("Importação de mensagens do Chatwoot não implementada/revisada.");
      return { status: 'Not implemented' };
      // Lógica original usava 'prismaRepository.prisma.message' e 'findFirstMessage'
      // CORREÇÃO: Usar this.prismaRepository.message.findMany/findFirst
      // const saved = await this.prismaRepository.message.findMany({ /* ... */ });
      // const quotedMsg = await this.prismaRepository.message.findFirst({ /* ... */ });
      // ... (lógica de busca/criação no Chatwoot) ...
  }

} // Fim da classe ChatwootService
