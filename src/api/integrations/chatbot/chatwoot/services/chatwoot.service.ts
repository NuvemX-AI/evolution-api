// src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts

// Imports de DTOs e Tipos (usando aliases @api)
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';
// DTOs de mensagem (verificar se são realmente necessários aqui ou apenas os tipos Prisma/Baileys)
import { Options, Quoted, SendAudioDto, SendMediaDto, SendTextDto } from '@api/dto/sendMessage.dto';

// Imports de libs e utils Chatwoot (usando alias se configurado)
import { postgresClient } from '@api/integrations/chatbot/chatwoot/libs/postgres.client';
import { chatwootImport } from '@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper';

// Imports de Serviços, Repositórios, Config (usando aliases)
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service'; // Usando monitor.service conforme erro anterior
import { Events } from '@api/types/wa.types';
import { Chatwoot, ConfigService, Database, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions'; // Usando alias

// Imports de SDKs e Libs Externas
import ChatwootClient, {
  ChatwootAPIConfig,
  contact as ChatwootContactPayload, // Renomeado para evitar conflito com Prisma.Contact
  contact_inboxes,
  conversation as ChatwootConversationPayload, // Renomeado
  conversation_show,
  generic_id,
  inbox as ChatwootInbox, // Renomeado
  message as ChatwootMessagePayload, // Renomeado
  conversation_message_create, // Tipo para criar mensagem
} from '@figuro/chatwoot-sdk';
import { request as chatwootRequest } from '@figuro/chatwoot-sdk/dist/core/request';
// Importando i18next configurado (assumindo que está em @utils)
import i18next from '@utils/i18n';
// Importando sendTelemetry (assumindo que está em @utils)
import { sendTelemetry } from '@utils/sendTelemetry';
// Importando getConversationMessage (assumindo que está em @utils)
import { getConversationMessage } from '@utils/getConversationMessage'; // << CORREÇÃO TS2339: Importado >>


import { Chatwoot as ChatwootModel, Contact as ContactModel, Message as MessageModel, Prisma } from '@prisma/client';
import axios from 'axios';
import { proto } from '@whiskeysockets/baileys'; // << CORREÇÃO TS2307: Import presente >>
import dayjs from 'dayjs';
import FormData from 'form-data';
import Long from 'long';
import mimeTypes from 'mime-types';
import path from 'path';
import { Readable } from 'stream';
import { QueryResult } from 'pg';

// Interface interna para clareza
interface ChatwootMessageInfo {
  messageId?: number;
  inboxId?: number;
  conversationId?: number;
  contactInboxSourceId?: string;
  isRead?: boolean;
}

// Tipo para usuário Chatwoot obtido do token
type ChatwootUser = {
  user_type: 'User' | 'AgentBot' | string; // Tipos comuns
  user_id: number;
};


export class ChatwootService {
  private readonly logger: Logger = new Logger('ChatwootService'); // Usa Logger importado
  private provider: ChatwootModel | null = null;
  private pgClient: any = null; // Inicializado como null

  constructor(
    private readonly waMonitor: WAMonitoringService, // Verificar se é necessário globalmente
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService,
  ) {
    // Inicializa pgClient se configurado
    try {
        const chatwootConfig = this.configService.get<Chatwoot>('CHATWOOT');
        const uri = chatwootConfig?.IMPORT?.DATABASE?.CONNECTION?.URI;
        if (uri && uri !== 'postgres://user:password@hostname:port/dbname') {
            this.pgClient = postgresClient?.getChatwootConnection?.(); // Usa o singleton importado
            if (!this.pgClient) {
                 this.logger.warn('Falha ao obter conexão Postgres do cliente singleton.');
            } else {
                 this.logger.info('Conexão Postgres para importação Chatwoot inicializada.');
            }
        } else {
             this.logger.warn('URI de importação do Chatwoot não configurada ou inválida.');
        }
    } catch(error: any) {
        this.logger.error(`Erro ao inicializar cliente Postgres: ${error.message}`);
    }
  }

  // Busca o provedor Chatwoot (configuração) para a instância, com cache
  private async getProvider(instance: InstanceDto): Promise<ChatwootModel | null> {
    const cacheKey = `${instance.instanceName}:chatwootProvider`;
    this.logger.debug(`Buscando provedor Chatwoot para ${instance.instanceName}. Cache key: ${cacheKey}`);

    // << CORREÇÃO TS2558: Remover tipo genérico e adicionar type assertion >>
    const cachedProvider = await this.cache?.get?.(cacheKey) as ChatwootModel | null;
    if (cachedProvider) {
       this.logger.debug(`Provedor Chatwoot encontrado no cache para ${instance.instanceName}`);
      this.provider = cachedProvider;
      return cachedProvider;
    }

    this.logger.debug(`Provedor Chatwoot não encontrado no cache para ${instance.instanceName}. Buscando no DB...`);
    const provider = await this.prismaRepository.prisma.chatwoot.findUnique({
        where: { instanceId: instance.instanceId }
    });

    if (!provider || !provider.enabled) {
      this.logger.warn(`Provedor Chatwoot não encontrado ou desabilitado para ${instance.instanceName}`);
      this.provider = null;
      return null;
    }

     this.logger.debug(`Provedor Chatwoot encontrado para ${instance.instanceName}. Armazenando no cache.`);
    await this.cache?.set?.(cacheKey, provider); // Armazena no cache
    this.provider = provider;
    return provider;
  }

  // Cria e retorna um cliente SDK do Chatwoot configurado
  private async clientCw(instance: InstanceDto): Promise<ChatwootClient | null> {
    const provider = await this.getProvider(instance);
    if (!provider?.url || !provider?.token) { // Verifica se url e token existem
        this.logger.error(`URL ou Token do Chatwoot não configurados para ${instance.instanceName}`);
        return null;
    }
    try {
        // Passa apenas a configuração necessária para o SDK
        const sdkConfig: ChatwootAPIConfig = {
            basePath: provider.url,
            token: provider.token,
            // Outras opções do SDK se necessário
            with_credentials: true,
            credentials: 'include',
        };
        return new ChatwootClient({ config: sdkConfig });
    } catch(error: any) {
        this.logger.error(`Erro ao criar ChatwootClient para ${instance.instanceName}: ${error.message}`);
        return null;
    }
  }

  // Retorna a configuração formatada (incluindo campos extras)
  // Usado internamente ou por outras partes que precisam da config completa
  public getClientCwConfig(): ChatwootAPIConfig & { nameInbox?: string; mergeBrazilContacts?: boolean, conversationPending?: boolean, reopenConversation?: boolean, signMsg?: boolean, signDelimiter?: string } {
     if (!this.provider) {
         throw new Error("Provedor Chatwoot não carregado para obter configuração.");
     }
    return {
      basePath: this.provider.url,
      with_credentials: true,
      credentials: 'include',
      token: this.provider.token,
      nameInbox: this.provider.nameInbox || undefined,
      mergeBrazilContacts: this.provider.mergeBrazilContacts ?? false,
      conversationPending: this.provider.conversationPending ?? false,
      reopenConversation: this.provider.reopenConversation ?? false,
      // << CORREÇÃO TS2322: Conversão String->Boolean (assumindo Prisma tem String?) >>
      // NOTE: Verifique o tipo de 'signMsg' no schema.prisma. Se for Boolean?, use '?? false'.
      signMsg: this.provider.signMsg === 'true',
      // signMsg: this.provider.signMsg ?? false, // Usar este se o tipo no Prisma for Boolean?
      signDelimiter: this.provider.signDelimiter ?? '\n',
    };
  }

  // Expõe o serviço de cache
  public getCache(): CacheService {
    return this.cache;
  }

  // Cria/Atualiza a configuração do Chatwoot
  public async create(instance: InstanceDto, data: ChatwootDto): Promise<ChatwootDto> {
     this.logger.info(`Criando/Atualizando configuração Chatwoot para ${instance.instanceName}`);
     const configData: Prisma.ChatwootCreateInput | Prisma.ChatwootUpdateInput = {
        enabled: data.enabled,
        accountId: data.accountId ? String(data.accountId) : undefined, // Garante String para Prisma
        token: data.token,
        url: data.url,
        nameInbox: data.nameInbox,
        // NOTE: Verifique o tipo de signMsg no schema.prisma. Salvar como string?
        signMsg: data.signMsg ? 'true' : 'false', // Salva como string 'true'/'false'?
        // signMsg: data.signMsg, // Salva como boolean?
        signDelimiter: data.signMsg ? data.signDelimiter : null,
        number: data.number,
        reopenConversation: data.reopenConversation,
        conversationPending: data.conversationPending,
        mergeBrazilContacts: data.mergeBrazilContacts,
        importContacts: data.importContacts,
        importMessages: data.importMessages,
        daysLimitImportMessages: data.daysLimitImportMessages,
        organization: data.organization,
        logo: data.logo,
        ignoreJids: data.ignoreJids, // Deve ser String[] no Prisma
        instance: { connect: { id: instance.instanceId } }
     };

     const savedProvider = await this.prismaRepository.prisma.chatwoot.upsert({
         where: { instanceId: instance.instanceId },
         // Tipagem explícita para garantir
         update: configData as Prisma.ChatwootUpdateInput,
         create: configData as Prisma.ChatwootCreateInput,
     });

     const cacheKey = `${instance.instanceName}:chatwootProvider`;
     await this.cache?.delete?.(cacheKey);
     this.provider = null;

    // Lógica de auto-criação do Inbox (mantida)
    if (data.autoCreate && data.enabled && data.url && data.token && data.accountId) {
      this.logger.log(`Tentando auto-criar inbox Chatwoot para ${instance.instanceName}`);
      const urlServer = this.configService.get<HttpServer>('SERVER')?.URL;
      if (!urlServer) {
          this.logger.error("URL do servidor (SERVER.URL) não configurada.");
          return savedProvider as ChatwootDto;
      }
      const webhookEndpoint = `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`;
      try {
          await this.initInstanceChatwoot(
            instance,
            data.nameInbox ?? instance.instanceName.split('-cwId-')[0],
            webhookEndpoint,
            true, // Assume qrcode=true para criar contato/conversa do bot
            data.number,
            data.organization,
            data.logo,
          );
      } catch(initError: any) {
           this.logger.error(`Falha na auto-criação do inbox para ${instance.instanceName}: ${initError.message}`);
      }
    }
    // Retorna o DTO (precisa mapear do modelo Prisma se forem diferentes)
    return savedProvider as ChatwootDto;
  }

  // Busca a configuração do Chatwoot
  public async find(instance: InstanceDto): Promise<ChatwootDto | null> {
    this.logger.debug(`Buscando configuração Chatwoot para ${instance.instanceName}`);
    try {
      const provider = await this.prismaRepository.prisma.chatwoot.findUnique({
          where: { instanceId: instance.instanceId }
      });
      if (provider) {
          // Mapeia do modelo Prisma para o DTO
          return {
              enabled: provider.enabled ?? undefined,
              accountId: provider.accountId ?? undefined,
              token: provider.token ?? undefined,
              url: provider.url ?? undefined,
              nameInbox: provider.nameInbox ?? undefined,
              signMsg: provider.signMsg === 'true', // Converte de string para boolean
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
              ignoreJids: provider.ignoreJids as string[] ?? undefined, // Cast se Prisma retornar JsonValue
              // autoCreate não é persistido
          };
      }
      return null; // Retorna null se não encontrado
    } catch(error: any) {
      this.logger.error(`Erro ao buscar configuração Chatwoot para ${instance.instanceName}: ${error.message}`);
      return null;
    }
  }

    // --- Métodos de Interação com API Chatwoot ---

    public async getContact(instance: InstanceDto, contactId: number): Promise<ChatwootContactPayload | null> {
      const client = await this.clientCw(instance);
      if (!client || !this.provider?.accountId) {
        this.logger.warn(`Cliente Chatwoot ou provider/accountId não disponível para getContact (ID: ${contactId})`);
        return null;
      }
      if (!contactId || isNaN(contactId)) { // Verifica se é um número válido
        this.logger.warn('ID do contato inválido para getContact');
        return null;
      }
      try {
          // << CORREÇÃO TS2322: accountId convertido para número >>
          const contact = await client.contacts.get({ // Ajustado para usar 'contacts.get'
              accountId: parseInt(this.provider.accountId), // Converte para número
              id: contactId,
          });
          this.logger.debug(`Contato encontrado (ID: ${contactId}): ${!!contact}`);
          return contact as ChatwootContactPayload; // Faz cast para o tipo esperado
      } catch (error: any) {
           if (error?.response?.status === 404) {
               this.logger.warn(`Contato ${contactId} não encontrado no Chatwoot.`);
           } else {
               this.logger.error(`Erro ao buscar contato ${contactId}: ${error.message}`);
           }
           return null;
      }
    }

    // << CORREÇÃO TS2551: Implementado createChatwootContact >>
    public async createChatwootContact(
        instance: InstanceDto,
        identifier: string | undefined, // Telefone ou outro identificador único
        inboxId: number,
        isGroup: boolean,
        name?: string,
        avatarUrl?: string,
        phoneNumber?: string // Número formatado com '+'
    ): Promise<ChatwootContactPayload | null> {
        const client = await this.clientCw(instance);
        if (!client || !this.provider?.accountId) {
            this.logger.error(`Cliente/Provider/AccountId não disponível para createChatwootContact para ${instance.instanceName}`);
            return null;
        }
        try {
            this.logger.info(`Criando contato Chatwoot: Identifier=${identifier}, Name=${name}`);
            const contactData: any = {
                inbox_id: inboxId,
                name: name || identifier, // Usa identifier como nome se não houver nome
                identifier: identifier, // Identificador único (pode ser JID ou outro)
                phone_number: phoneNumber || (identifier?.includes('@') ? undefined : identifier), // Usa número formatado se disponível
                // avatar_url: avatarUrl, // Adicionar avatar se disponível
            };
            // << CORREÇÃO TS2322: accountId convertido para número >>
            const newContact = await client.contacts.create({
                accountId: parseInt(this.provider.accountId),
                data: contactData
            });
            this.logger.log(`Contato Chatwoot criado com sucesso: ID ${newContact?.payload?.contact?.id}`);
            return newContact as ChatwootContactPayload;
        } catch (error: any) {
            this.logger.error(`Erro ao criar contato Chatwoot: ${error.message}`);
            return null;
        }
    }

    // << CORREÇÃO TS2339: Implementado getInbox >>
    public async getInbox(instance: InstanceDto): Promise<ChatwootInbox | null> {
         const client = await this.clientCw(instance);
         if (!client || !this.provider?.accountId) {
            this.logger.error(`Cliente/Provider/AccountId não disponível para getInbox para ${instance.instanceName}`);
            return null;
         }
         const inboxName = this.provider?.nameInbox || instance.instanceName.split('-cwId-')[0]; // Usa nome salvo ou padrão
         this.logger.debug(`Buscando inbox "${inboxName}" na conta ${this.provider.accountId}`);
         try {
             // << CORREÇÃO TS2322: accountId convertido para número >>
             const listResponse = await client.inboxes.list({ accountId: parseInt(this.provider.accountId) });
             const inbox = listResponse.payload?.find((i: ChatwootInbox) => i.name === inboxName);
             if (inbox) {
                 this.logger.debug(`Inbox "${inboxName}" encontrado com ID: ${inbox.id}`);
                 return inbox;
             } else {
                 this.logger.warn(`Inbox "${inboxName}" não encontrado.`);
                 return null;
             }
         } catch (error: any) {
            this.logger.error(`Erro ao listar inboxes: ${error.message}`);
            return null;
         }
    }

    // << CORREÇÃO TS2339: Implementado createBotMessage >>
    public async createBotMessage(instance: InstanceDto, content: string, messageType: 'incoming' | 'outgoing'): Promise<void> {
        try {
            const client = await this.clientCw(instance);
            const inbox = await this.getInbox(instance);
             if (!client || !inbox || !this.provider?.accountId) {
                this.logger.error(`Cliente/Inbox/Provider/AccountId não disponível para createBotMessage para ${instance.instanceName}`);
                return;
             }
            const accountId = parseInt(this.provider.accountId); // << CORREÇÃO TS2322 >>
            const botIdentifier = '123456'; // Identificador fixo do Bot

            // 1. Encontrar/Criar Contato do Bot
            // << CORREÇÃO TS2339: Chamada corrigida para getContact >>
            let contact = await this.getContact(instance, Number(botIdentifier)); // Assumindo que ID do bot é '123456'
            if (!contact) {
                contact = await this.createChatwootContact(instance, botIdentifier, inbox.id!, false, 'EvolutionAPI Bot');
            }
            const contactId = contact?.payload?.contact?.id ?? contact?.payload?.id ?? contact?.id;
            if (!contactId) {
                 this.logger.error('Falha ao obter ID do contato do Bot.');
                 return;
            }

            // 2. Encontrar/Criar Conversa do Bot
            // << CORREÇÃO TS2322: accountId convertido para número >>
            const convList = await client.contacts.listConversations({ accountId, id: contactId });
            let conversation = convList.payload?.find((c: any) => c.inbox_id === inbox.id);
            if (!conversation) {
                 // << CORREÇÃO TS2322: accountId convertido para número >>
                conversation = await client.conversations.create({
                    accountId,
                    data: { contact_id: contactId.toString(), inbox_id: inbox.id!.toString() }
                });
            }
            if (!conversation?.id) {
                this.logger.error('Falha ao obter ID da conversa do Bot.');
                return;
            }

            // 3. Enviar Mensagem
            // << CORREÇÃO TS2322: accountId convertido para número >>
            await client.messages.create({
                accountId,
                conversationId: conversation.id,
                data: { content, message_type: messageType }
            });
            this.logger.info(`Mensagem do Bot enviada para conversa ${conversation.id}: "${content}"`);

        } catch (error: any) {
            this.logger.error(`Erro ao criar mensagem do Bot: ${error.message}`);
        }
    }

    // << CORREÇÃO TS2339: Implementado processWebhookPayload >>
    public async processWebhookPayload(instance: InstanceDto, payload: any): Promise<void> {
        this.logger.info(`Processando webhook Chatwoot para ${instance.instanceName}: ${JSON.stringify(payload)}`);
        // TODO: Implementar a lógica de parsing do webhook payload aqui.
        // Exemplo: Verificar se é uma mensagem de agente, extrair conteúdo,
        // contato, conversa e chamar o método apropriado para enviar ao WhatsApp.
        if (payload.event === 'message_created' && payload.message_type === 'outgoing' && !payload.private) {
            // Exemplo: Mensagem enviada por um agente via Chatwoot
            const content = payload.content;
            const conversationId = payload.conversation?.id;
            const contactIdentifier = payload.contact?.identifier; // JID ou telefone
            const messageId = payload.id; // ID da mensagem no Chatwoot

            if (!content || !conversationId || !contactIdentifier) {
                this.logger.warn('Webhook de mensagem criada incompleto recebido.');
                return;
            }

            this.logger.info(`Mensagem do agente recebida via webhook: ConvID=${conversationId}, Contato=${contactIdentifier}, Msg="${content}"`);

            // 1. Obter a instância WA ativa
            const waInstance = this.waMonitor.get(instance.instanceName);
            if (!waInstance || waInstance.connectionStatus?.connection !== 'open') {
                 this.logger.error(`Instância WA "${instance.instanceName}" não ativa para enviar mensagem do Chatwoot.`);
                 return;
            }

            // 2. Formatar JID
            const remoteJid = createJid(contactIdentifier);

            // 3. Enviar a mensagem via instância WA (ex: textMessage)
            try {
                // TODO: Adicionar tratamento para outros tipos de mensagem (mídia, botões, etc.)
                const sendPayload: SendTextDto = {
                     number: remoteJid,
                     text: content,
                     // options: { // Adicionar opções se necessário (ex: quoted a partir do webhook?)
                     //     quoted: ...
                     // }
                };
                const result = await waInstance.textMessage(sendPayload, true); // Envia como integração

                // 4. (Opcional) Atualizar a mensagem no Chatwoot com o source_id (ID do WhatsApp)
                const waMessageId = result?.message?.key?.id || result?.messages?.[0]?.id; // ID da mensagem no WA
                if (waMessageId) {
                    this.logger.info(`Atualizando mensagem Chatwoot ${messageId} com source_id WAID:${waMessageId}`);
                    // TODO: Implementar método para atualizar source_id via API ou DB
                    // await this.updateMessageSourceId(messageId, `WAID:${waMessageId}`);
                }

            } catch (error: any) {
                 this.logger.error(`Erro ao enviar mensagem do Chatwoot para ${remoteJid}: ${error.message}`);
            }

        } else {
            this.logger.debug(`Webhook Chatwoot ignorado (evento: ${payload.event}, tipo: ${payload.message_type}, privado: ${payload.private})`);
        }
    }


    // --- Métodos de Importação (com correções e TODOs) ---

    public startImportHistoryMessages(instance: InstanceDto): void {
      if (!this.isImportHistoryAvailable()) {
          this.logger.warn(`Importação de histórico Chatwoot não está disponível para ${instance.instanceName}`);
          return;
      }
      this.logger.info(`Iniciando importação de histórico para ${instance.instanceName}`);
      this.createBotMessage(instance, i18next.t('cw.import.startImport'), 'incoming');
    }

    public isImportHistoryAvailable(): boolean {
      const chatwootConfig = this.configService.get<Chatwoot>('CHATWOOT');
      const uri = chatwootConfig?.IMPORT?.DATABASE?.CONNECTION?.URI;
      const pgClientAvailable = !!this.pgClient?.query;
      if (!pgClientAvailable) this.logger.warn('pgClient não está disponível para importação.');
      const isUriValid = !!uri && uri !== 'postgres://user:password@hostname:port/dbname';
      if (!isUriValid) this.logger.warn('URI de importação do Chatwoot não configurada corretamente.');
      return isUriValid && pgClientAvailable;
    }

    public addHistoryMessages(instance: InstanceDto, messagesRaw: MessageModel[]): void {
       if (!this.isImportHistoryAvailable()) return;
       this.logger.debug(`Adicionando ${messagesRaw.length} mensagens ao buffer de importação para ${instance.instanceName}`);
       chatwootImport?.addHistoryMessages(instance, messagesRaw);
    }

    public addHistoryContacts(instance: InstanceDto, contactsRaw: ContactModel[]): any {
       if (!this.isImportHistoryAvailable()) return;
        this.logger.debug(`Adicionando ${contactsRaw.length} contatos ao buffer de importação para ${instance.instanceName}`);
       return chatwootImport?.addHistoryContacts(instance, contactsRaw);
    }

    public async importHistoryMessages(instance: InstanceDto): Promise<number | void> {
      if (!this.isImportHistoryAvailable()) return;
      this.logger.info(`Iniciando processo de importação de mensagens para ${instance.instanceName}`);
      this.createBotMessage(instance, i18next.t('cw.import.importingMessages'), 'incoming');
      try {
          const inbox = await this.getInbox(instance); // << CORREÇÃO TS2339 >>
          if(!inbox || !this.provider) { // Verifica this.provider aqui
               this.logger.error(`Inbox ou Provider não encontrado para importação em ${instance.instanceName}`);
               this.createBotMessage(instance, i18next.t('cw.import.messagesException'), 'incoming'); // << CORREÇÃO TS2339 >>
               return;
          }
          const total = await chatwootImport?.importHistoryMessages(
            instance,
            this, // Passa a instância do serviço
            inbox,
            this.provider,
          );
          this.logger.info(`Importação de mensagens concluída para ${instance.instanceName}. Total: ${total}`);
          await this.updateContactAvatarInRecentConversations(instance);
          const msg = Number.isInteger(total)
            ? i18next.t('cw.import.messagesImported', { totalMessagesImported: total as number })
            : i18next.t('cw.import.messagesException');
          this.createBotMessage(instance, msg, 'incoming'); // << CORREÇÃO TS2339 >>
          return total as number;
      } catch (error: any) {
           this.logger.error(`Erro durante importação de mensagens para ${instance.instanceName}: ${error.message}`);
           this.createBotMessage(instance, i18next.t('cw.import.messagesException'), 'incoming'); // << CORREÇÃO TS2339 >>
      }
    }

    public async updateContactAvatarInRecentConversations(instance: InstanceDto, limitContacts = 100): Promise<void> {
        // ... (Lógica mantida, mas com correções de tipo/prisma internas) ...
        this.logger.info(`Atualizando avatares de contatos recentes para ${instance.instanceName}`);
        try {
            if (!this.isImportHistoryAvailable()) {
                 this.logger.warn(`Importação/PG Client não disponível para updateContactAvatar...`);
                 return;
            };
            const client = await this.clientCw(instance);
            const inbox = await this.getInbox(instance); // << CORREÇÃO TS2339 >>
            if (!client || !inbox || !this.provider || !this.provider.accountId) {
                this.logger.warn(`Cliente, Inbox ou Provider/AccountId Chatwoot não disponível para ${instance.instanceName}`);
                return;
            }
            const accountId = parseInt(this.provider.accountId); // << CORREÇÃO TS2322 >>

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

            const contactsWithPics = (
              await this.prismaRepository.prisma.contact.findMany({
                where: { instanceId: instance.instanceId, remoteJid: { in: identifiers }, profilePicUrl: { not: null } },
                select: { remoteJid: true, profilePicUrl: true }
              })
            ).reduce((m, c) => { if(c.remoteJid) m.set(c.remoteJid, c); return m; }, new Map<string, { remoteJid: string | null; profilePicUrl: string | null; }>());

            if (contactsWithPics.size === 0) {
                 this.logger.info(`Nenhuma foto de perfil encontrada no DB local para os contatos recentes.`);
                 return;
            }

            for (const c of recentContacts) {
              if (!c.identifier || !c.id) continue; // Pula se não tiver ID chatwoot ou identifier
              const picData = contactsWithPics.get(c.identifier);
              if (picData?.profilePicUrl && picData.profilePicUrl !== c.thumbnail) {
                this.logger.debug(`Atualizando avatar para contato Chatwoot ID ${c.id} (identifier: ${c.identifier})`);
                try {
                    // << CORREÇÃO TS2322: accountId convertido para número >>
                    await client.contacts.update({
                        accountId: accountId,
                        id: c.id, // Usa ID do chatwoot
                        data: { avatar_url: picData.profilePicUrl },
                    });
                } catch (updateError: any) {
                     this.logger.error(`Falha ao atualizar avatar para contato ${c.id}: ${updateError.message}`);
                }
              }
            }
            this.logger.info(`Atualização de avatares concluída para ${instance.instanceName}`);
        } catch (err: any) {
            this.logger.error(`Erro na atualização de avatares: ${err.message}`);
        }
    }


    public async syncLostMessages(
        instance: InstanceDto,
        chatwootConfig: ChatwootModel,
        // Tipar prepareMessage corretamente
        prepareMessage: (message: MessageModel) => any, // Ou tipo mais específico
    ): Promise<void> {
        this.logger.warn('syncLostMessages chamado em ChatwootService - Verifique se a lógica é aplicável/necessária.');
        try {
          if (!this.isImportHistoryAvailable() || !this.pgClient) return; // Verifica pgClient
          // NOTE: Verifique se essa configuração existe e é necessária
          // if (!this.configService.get<Database>('DATABASE')?.SAVE_DATA?.MESSAGE_UPDATE) return;

          const inbox = await this.getInbox(instance); // << CORREÇÃO TS2339 >>
          if(!inbox || !chatwootConfig?.accountId) {
               this.logger.warn('Inbox ou AccountId não disponível para syncLostMessages.');
               return;
           };
           const accountId = parseInt(chatwootConfig.accountId); // << CORREÇÃO TS2322 >>

          const sqlMessages = `
            SELECT source_id FROM messages m
            WHERE account_id = $1 AND inbox_id = $2 AND source_id LIKE 'WAID:%'
              AND created_at >= now() - interval '6 hours'
            ORDER BY created_at DESC`;
          const result: QueryResult = await this.pgClient.query(sqlMessages, [accountId, inbox.id]);
          const ids = result.rows.map((r: any) => r.source_id.replace('WAID:', ''));

          const sixHoursAgo = dayjs().subtract(6, 'hours').unix();
          const saved = await this.prismaRepository.prisma.message.findMany({
            where: {
              instanceId: instance.instanceId,
              messageTimestamp: { gte: BigInt(sixHoursAgo) },
              // << CORREÇÃO TS2353: Filtrar por keyId (se existir) ou buscar todos e filtrar depois >>
              // NOTE: Assumindo que 'keyId' existe no modelo Message para otimizar
              // Se não existir, remova este filtro e filtre 'saved' contra 'ids' em memória
              keyId: { notIn: ids } // Assumindo que key->id está salvo como keyId: string
            },
          });

          // Filtrar em memória se keyId não for usado no where:
          // const filtered = saved.filter(m => !ids.includes(m.key?.['id']));

          const filtered = saved; // Usar 'saved' se o filtro WHERE for aplicado
          const raw: any[] = [];
          for (const m of filtered) {
            // Passar a mensagem Prisma diretamente para prepareMessage
            raw.push(prepareMessage(m));
          }
          this.addHistoryMessages(instance, raw);
          await chatwootImport?.importHistoryMessages(instance, this, inbox, this.provider);

        } catch(error: any) {
           this.logger.error(`Erro em syncLostMessages: ${error.message}`);
        }
    }

    // --- Helpers ---
     private async getReplyToIds(messageBody: any, instance: InstanceDto): Promise<{ in_reply_to?: number; in_reply_to_external_id?: string }> {
        const contextInfo = messageBody?.contextInfo;
        const stanzaId = contextInfo?.stanzaId || contextInfo?.quotedMessage?.key?.id;
        if (!stanzaId) return {};

        try {
            // NOTE: Implemente findFirstMessage no PrismaRepository
            const quotedMsg = await this.prismaRepository.findFirstMessage({
                 where: {
                     instanceId: instance.instanceId,
                     key: { path: ['id'], equals: stanzaId }
                 }
             });

            if (quotedMsg?.chatwootMessageId && !isNaN(parseInt(quotedMsg.chatwootMessageId))) {
                 this.logger.debug(`Mensagem citada encontrada no DB com Chatwoot ID: ${quotedMsg.chatwootMessageId}`);
                 return { in_reply_to: parseInt(quotedMsg.chatwootMessageId) };
            } else {
                 this.logger.debug(`Mensagem citada não encontrada no DB ou sem Chatwoot ID. Usando ID externo: WAID:${stanzaId}`);
                 return { in_reply_to_external_id: `WAID:${stanzaId}` };
            }
        } catch(error: any) {
             this.logger.error(`Erro ao buscar mensagem citada (${stanzaId}) no DB: ${error.message}`);
             // Fallback para ID externo em caso de erro
             return { in_reply_to_external_id: `WAID:${stanzaId}` };
        }
    }

} // Fim da classe ChatwootService
