// src/api/integrations/channel/meta/whatsapp.business.service.ts
// Correção Erro 61, 62: Garante importação correta de WAMonitoringService.
// Correção Erro (rel. 27/31): Corrige importação de ProviderFiles.
// Correção Erro 63: Remove chamada inexistente a this.eventHandler.
// Correção Erro 64: Altera waMonitor.remove para waMonitor.stop.
// Correção Erro 65: Importa v4 de uuid.
// Correção Erro 66, 67: Remove adição incorreta de 'context' em payloads específicos.

import { Injectable, OnModuleInit, OnModuleDestroy, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaRepository } from '@repository/repository.service'; // Use alias
import { CacheService } from '@api/services/cache.service'; // Use alias
import { Logger } from '@config/logger.config'; // Use alias
import { ChannelStartupService } from '@api/services/channel.service'; // Use alias
// ** Correção Erro 61/62: Usar import consistente com a base/correto **
import { WAMonitoringService } from '../../../services/monitor.service'; // Usar monitor.service
import { InstanceDto } from '@api/dto/instance.dto'; // Use alias
import { Events } from '@api/integrations/event/event.dto'; // Use alias
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Prisma, Message as MessageModel, Contact as ContactModel, proto } from '@prisma/client';
import Long from 'long';
import {
    SendContactDto,
    SendLinkDto,
    SendLocationDto,
    SendMediaDto,
    SendReactionDto,
    SendTextDto,
    SendMessageOptions,
    MessageKeyDto, // Para usar em quoted
} from '@api/dto/sendMessage.dto'; // Use alias
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Use alias
// ** Correção Erro (rel. 27/31): Usar path relativo para ProviderFiles **
// import { ProviderFiles } from '@provider/sessions'; // Original
import { ProviderFiles } from '../../../../provider/sessions'; // Path relativo
import { Multer } from 'multer';
interface UploadedFile extends Multer.File {}
// ** Correção Erro 65: Importar v4 **
import { v4 } from 'uuid';
import { S3 } from '@config/env.config'; // Importar tipo S3


// Interfaces para payloads da Meta API (simplificadas)
interface MetaMessageData {
    messaging_product: 'whatsapp';
    to: string;
    type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts' | 'interactive' | 'template' | 'reaction';
    text?: { body: string; preview_url?: boolean };
    image?: { id?: string; link?: string; caption?: string };
    audio?: { id?: string; link?: string };
    video?: { id?: string; link?: string; caption?: string };
    document?: { id?: string; link?: string; caption?: string; filename?: string };
    sticker?: { id?: string; link?: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: any[]; // Definir estrutura se necessário
    interactive?: any; // Para botões e listas
    template?: any; // Para templates
    reaction?: { message_id: string; emoji: string };
    context?: { message_id: string }; // Para respostas
}

interface MetaIncomingMessage {
    contacts?: any[];
    message: any;
    metadata: any;
}

interface MetaMessageStatus {
    status: any;
    metadata: any;
}


@Injectable({ scope: Scope.TRANSIENT })
export class BusinessStartupService extends ChannelStartupService implements OnModuleInit, OnModuleDestroy {
    private metaApi: AxiosInstance | null = null;
    private metaGraphUrl: string = 'https://graph.facebook.com/'; // Default, pode ser configurável
    private metaApiVersion: string = 'v19.0'; // Ou buscar da config
    private metaPhoneNumberId: string | null = null;
    private metaAccessToken: string | null = null;

    constructor(
        configService: ConfigService,
        eventEmitter: EventEmitter2,
        prismaRepository: PrismaRepository,
        cacheService: CacheService,
        waMonitor: WAMonitoringService, // Tipo já corrigido pela importação acima
        baseLogger: Logger,
        chatwootService: ChatwootService,
        providerFiles: ProviderFiles, // Tipo já corrigido pela importação acima
    ) {
        // ** Correção Erro 62: A compatibilidade depende da classe base usar a mesma importação de WAMonitoringService **
        super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, baseLogger, chatwootService);
    }

    async onModuleInit() { }
    async onModuleDestroy() {
        this.logger.log(`[${this.instanceName}] Encerrando serviço do canal Meta.`);
    }

    public async init(instanceData: InstanceDto): Promise<void> {
        super.init(instanceData);
        this.logger.log(`[${this.instanceName}] Inicializando canal Meta.`);

        // Obter credenciais Meta (Phone Number ID, Access Token, WABA ID) da instância no DB
        // Exemplo: Assumindo que estão armazenadas em campos específicos da tabela Instance ou uma tabela relacionada
        const instanceConfig = await this.prismaRepository.instance.findUnique({
             where: { id: this.instanceId }
             // select: { metaPhoneNumberId: true, metaAccessToken: true } // Selecionar campos necessários
        });

        // ** Atenção: Adapte os nomes dos campos abaixo conforme seu schema Prisma **
        // this.metaPhoneNumberId = instanceConfig?.metaPhoneNumberId;
        // this.metaAccessToken = instanceConfig?.metaAccessToken;
        // this.metaGraphUrl = this.configService.get('META_GRAPH_URL', this.metaGraphUrl);
        // this.metaApiVersion = this.configService.get('META_API_VERSION', this.metaApiVersion);


        if (!this.metaPhoneNumberId || !this.metaAccessToken) {
            this.logger.error(`[${this.instanceName}] Credenciais Meta (Phone Number ID ou Access Token) não configuradas.`);
            this.connectionState = { connection: 'close', error: new Error('Meta credentials not configured.') };
            this.emitConnectionUpdate();
            return;
        }

        this.metaApi = axios.create({
            baseURL: `${this.metaGraphUrl}${this.metaApiVersion}/`,
            headers: {
                'Authorization': `Bearer ${this.metaAccessToken}`,
                'Content-Type': 'application/json'
            }
        });

        this.logger.log(`[${this.instanceName}] Canal Meta configurado para Phone Number ID: ${this.metaPhoneNumberId}`);
        // Considerar estado 'open' assim que configurado, pois é baseado em webhook
        this.connectionState = { connection: 'open' };
        this.emitConnectionUpdate();
    }

    public async start(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Canal Meta iniciado (baseado em webhook).`);
        // Para Meta, 'start' pode apenas confirmar que está pronto para receber webhooks
        if (!this.metaApi) {
             this.connectionState = { connection: 'close', error: new Error('Meta not initialized.') };
             this.emitConnectionUpdate();
             throw new Error('Meta channel service not initialized properly.');
        }
        this.connectionState = { connection: 'open' };
        this.emitConnectionUpdate();
    }

    // Handler para mensagens recebidas via webhook
    public async handleIncomingMessage(data: MetaIncomingMessage): Promise<void> {
        this.logger.debug(`[${this.instanceName}] Processando mensagem recebida da Meta:`, JSON.stringify(data));
        // ** Correção Erro 63: Remover chamada inexistente **
        // await this.eventHandler(data); // Chamada incorreta removida
        // TODO: Adaptar o payload 'data.message' da Meta para o formato proto.IWebMessageInfo esperado internamente
        // Extrair remoteJid, messageId, content, timestamp, pushName, etc.
        const adaptedMessage = this.adaptMetaMessageToProto(data);
        if (adaptedMessage) {
            this.emitMessageUpsert(adaptedMessage); // Emitir evento interno para chatbot/armazenamento
            this.saveMessageToDb(adaptedMessage); // Salvar no DB
            this.updateContactFromMessage(adaptedMessage); // Atualizar contato
        }
    }

    // Handler para status de mensagens recebidos via webhook
    public async handleMessageStatus(data: MetaMessageStatus): Promise<void> {
         this.logger.debug(`[${this.instanceName}] Processando status de mensagem da Meta:`, JSON.stringify(data));
         const adaptedStatus = this.adaptMetaStatusToProto(data);
         if (adaptedStatus) {
             this.emitMessageStatusUpdate(adaptedStatus); // Emitir evento interno
             this.saveMessageStatusToDb(adaptedStatus); // Salvar no DB
         }
    }


    public async logout(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Logout não aplicável diretamente ao canal Meta (é baseado em token/webhook). Parando monitoramento.`);
        // Limpar estado e remover do monitor
        this.connectionState = { connection: 'close' };
        this.emitConnectionUpdate();
        // ** Correção Erro 64: Usar stop **
        await this.waMonitor.stop(this.instanceName);
    }

    public getStatus(): any {
        // Para Meta, o status pode ser simplesmente 'open' se configurado, ou 'close' se não.
        return this.connectionState ?? { connection: 'close' };
    }

    // --- Métodos de Envio ---

    // Método genérico para enviar via API da Meta
    private async sendWhatsAppMessage(recipientJid: string, payloadData: Omit<MetaMessageData, 'messaging_product' | 'to'>, options?: SendMessageOptions): Promise<any> {
        if (!this.metaApi || !this.metaPhoneNumberId) {
            throw new Error('Meta service not initialized or phone number ID missing.');
        }
        this.logger.debug(`[${this.instanceName}] Enviando mensagem para ${recipientJid} via Meta.`);

        const recipient = recipientJid.split('@')[0]; // Meta usa apenas o número

        const payload: MetaMessageData = {
            messaging_product: 'whatsapp',
            to: recipient,
            ...payloadData // Inclui type e o objeto específico (text, image, etc.)
        };

        // Adiciona contexto se for uma resposta
        if (options?.quoted?.key?.id) {
            payload.context = { message_id: options.quoted.key.id };
        }

        this.logger.debug(`[${this.instanceName}] Payload Meta: ${JSON.stringify(payload)}`);

        try {
            const response = await this.metaApi.post(`${this.metaPhoneNumberId}/messages`, payload);
            this.logger.debug(`[${this.instanceName}] Resposta da API Meta: ${JSON.stringify(response.data)}`);

            // Adaptar resposta da Meta para o formato esperado (similar a Baileys)
            // ** Correção Erro 65: Usar v4 importado **
            const messageId = response.data?.messages?.[0]?.id || v4(); // ID da mensagem da Meta ou gerar um
            const messageTimestamp = Math.floor(Date.now() / 1000);

            const sentMsgProto = this.adaptMetaResponseToProto(recipientJid, messageId, payloadData, messageTimestamp);

            // Emitir evento de sucesso e salvar no DB (simulando envio local)
            this.emitMessageSendSuccess(sentMsgProto);
            this.saveMessageToDb(sentMsgProto, 'SENT'); // Marcar como SENT

            return sentMsgProto; // Retorna a mensagem adaptada

        } catch (error: any) {
            const axiosError = error as AxiosError;
            const errorData = axiosError.response?.data;
            this.logger.error(`[${this.instanceName}] Erro ao enviar mensagem via Meta API: ${axiosError.message}`, errorData || '');
            throw new Error(`Meta API Error: ${errorData?.error?.message || axiosError.message}`);
        }
    }


    public async sendText(data: SendTextDto): Promise<any> {
        const payload: Partial<MetaMessageData> = {
             type: 'text',
             text: { body: data.message, preview_url: data.options?.previewUrl ?? true } // Assumindo previewUrl em options
        };
        return this.sendWhatsAppMessage(data.number, payload as any, data.options);
    }

     public async mediaMessage(data: SendMediaDto, file?: UploadedFile): Promise<any> {
        this.logger.warn(`[${this.instanceName}] Envio de mídia via upload de arquivo não implementado diretamente para Meta. Use URL ou ID de mídia pré-existente.`);
        // Meta geralmente requer upload prévio da mídia para obter um ID, ou usar uma URL pública.
        // Este método precisaria:
        // 1. Se 'file' existe, fazer upload para Meta -> obter ID.
        // 2. Se 'data.media' é URL, usar diretamente.
        // 3. Se 'data.media' é ID, usar diretamente.

        const mediaPayload: { id?: string; link?: string; caption?: string; filename?: string } = {};
        const messageType = data.mediaType; // image, video, audio, document, sticker

        if (data.media.startsWith('http')) {
            mediaPayload.link = data.media;
        } else {
             // Assumir que data.media é um ID pré-existente se não for URL
             // Em um cenário real, verificar formato do ID
            mediaPayload.id = data.media;
        }
         if (data.caption) mediaPayload.caption = data.caption;
         if (data.mediaType === 'document' && data.filename) mediaPayload.filename = data.filename;

        const payload: Partial<MetaMessageData> = {
            type: messageType as any, // Cast para tipo esperado pela Meta
            [messageType]: mediaPayload // Atribui ao campo correspondente (image, video, etc.)
        };

        return this.sendWhatsAppMessage(data.number, payload as any, data.options);
    }

    public async locationMessage(data: SendLocationDto): Promise<any> {
        const payloadData: Partial<MetaMessageData> = {
            type: 'location',
            location: {
                latitude: data.latitude,
                longitude: data.longitude,
                name: data.name,
                address: data.address
            }
        };
         // ** Correção Erro 67: Remover adição de context aqui **
         // if (data.options?.quoted?.key?.id) {
         //    payload.context = { message_id: data.options.quoted.key.id }; // REMOVIDO
         // }
        return this.sendWhatsAppMessage(data.number, payloadData as any, data.options);
    }

    public async contactMessage(data: SendContactDto): Promise<any> {
         // Meta espera um formato específico para contatos
         // Ref: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#contacts-object
         const contactPayload = [{
             name: { formatted_name: data.contactName, /*... outros campos de nome ...*/ },
             phones: [{ phone: data.contactNumber.replace(/\D/g,''), type: 'CELL' /* ou HOME, WORK */ }]
             // Adicionar emails, org, etc. se necessário
         }];

         const payloadData: Partial<MetaMessageData> = {
             type: 'contacts',
             contacts: contactPayload
         };
         // ** Correção Erro 66: Remover adição de context aqui **
         // if (data.options?.quoted?.key?.id) {
         //     payload.context = { message_id: data.options.quoted.key.id }; // REMOVIDO
         // }
         return this.sendWhatsAppMessage(data.number, payloadData as any, data.options);
    }

    public async reactionMessage(data: SendReactionDto): Promise<any> {
        const payload: Partial<MetaMessageData> = {
             type: 'reaction',
             reaction: { message_id: data.key.id, emoji: data.reaction }
        };
        return this.sendWhatsAppMessage(data.key.remoteJid, payload as any, data.options);
    }


    // --- Adapters (Exemplos, precisam ser detalhados) ---

    // Adapta mensagem recebida da Meta para o formato proto.IWebMessageInfo
    private adaptMetaMessageToProto(metaData: MetaIncomingMessage): Partial<proto.IWebMessageInfo> | null {
         const message = metaData.message;
         if (!message || !message.from || !message.id || !message.timestamp) return null;

         const remoteJid = message.from + '@s.whatsapp.net'; // Adicionar sufixo
         const waMsgId = message.id;
         const timestamp = parseInt(message.timestamp);
         const pushName = metaData.contacts?.[0]?.profile?.name || 'Unknown'; // Nome do contato

         const adaptedMessage: Partial<proto.IWebMessageInfo> = {
            key: {
                remoteJid: remoteJid,
                fromMe: false, // Mensagem recebida
                id: waMsgId,
                participant: message.context?.participant, // Se for de grupo
            },
            messageTimestamp: timestamp,
            pushName: pushName,
             // Mapear o conteúdo da mensagem (text, image, etc.) para a estrutura proto.IMessage
             message: this.mapMetaMessageContent(message),
         };
         return adaptedMessage;
    }

    // Adapta status de mensagem da Meta para o formato proto.MessageUserReceipt
    private adaptMetaStatusToProto(metaData: MetaMessageStatus): Partial<proto.IMessageUserReceipt> | null {
         const status = metaData.status;
         if (!status || !status.id || !status.status || !status.timestamp || !status.recipient_id) return null;

         // Mapear status da Meta (sent, delivered, read) para os de Baileys/proto se necessário
         let receiptType: string | undefined = undefined;
         if (status.status === 'delivered') receiptType = 'delivery';
         else if (status.status === 'read') receiptType = 'read';
         else if (status.status === 'sent') receiptType = 'played'; // Ou 'inactive'? 'sent' não é um receipt comum

         const adaptedStatus: Partial<proto.IMessageUserReceipt> = {
             userJid: status.recipient_id + '@s.whatsapp.net',
             messageId: status.id,
             receiptTimestamp: parseInt(status.timestamp),
             readTimestamp: status.status === 'read' ? parseInt(status.timestamp) : undefined,
             playedTimestamp: status.status === 'sent' ? parseInt(status.timestamp) : undefined, // Mapeamento 'sent' -> 'played'
             // O tipo de recibo (delivery, read) pode precisar ser inferido ou vir de outro campo
         };
         return adaptedStatus;
    }

     // Adapta resposta da Meta para o formato proto.IWebMessageInfo
     private adaptMetaResponseToProto(remoteJid: string, messageId: string, originalPayload: Omit<MetaMessageData, 'messaging_product' | 'to'>, timestamp: number): Partial<proto.IWebMessageInfo> {
         return {
             key: {
                 remoteJid: remoteJid,
                 fromMe: true,
                 id: messageId,
             },
             messageTimestamp: timestamp,
             // Mapear o payload enviado para a estrutura proto.IMessage
             message: this.mapMetaMessageContent(originalPayload),
             status: proto.WebMessageInfo.Status.PENDING, // Status inicial após envio via API
         };
     }

     // Mapeia conteúdo da mensagem Meta para proto.IMessage (Exemplo simplificado)
     private mapMetaMessageContent(message: any): Partial<proto.IMessage> | undefined {
         if (message.text) return { conversation: message.text.body };
         if (message.image) return { imageMessage: { caption: message.image.caption, /* ...outros campos media... */ } };
         if (message.video) return { videoMessage: { caption: message.video.caption, /* ...outros campos media... */ } };
         if (message.audio) return { audioMessage: { /* ...outros campos media... */ } };
         if (message.document) return { documentMessage: { caption: message.document.caption, fileName: message.document.filename, /* ... */ } };
         if (message.sticker) return { stickerMessage: { /* ...outros campos media... */ } };
         if (message.location) return { locationMessage: { degreesLatitude: message.location.latitude, degreesLongitude: message.location.longitude, name: message.location.name, address: message.location.address } };
         if (message.contacts) return { contactsArrayMessage: { displayName: message.contacts[0]?.name?.formatted_name, contacts: [ /* ...mapear contatos... */ ] } };
         if (message.reaction) return { reactionMessage: { key: { id: message.reaction.message_id }, text: message.reaction.emoji } };
         // Mapear interactive (buttons, list), template, etc.
         return undefined; // Ou { extendedTextMessage: { text: JSON.stringify(message) } } como fallback
     }

      // --- Métodos de Persistência e Emissão de Eventos (herdado/adaptado de ChannelStartupService) ---

      protected async saveMessageToDb(message: Partial<proto.IWebMessageInfo>, dbStatus: MessageModel['status'] = 'RECEIVED') {
         if (!this.prismaConfig.saveMessage || !message?.key?.id || !message?.key?.remoteJid) return;

         const data: Prisma.MessageUncheckedCreateInput = {
             instanceId: this.instanceId!,
             keyId: message.key.id,
             key: message.key as any,
             message: message.message as any,
             messageTimestamp: message.messageTimestamp ? Number(message.messageTimestamp) : null,
             messageType: this.getMessageType(message.message),
             fromMe: message.key.fromMe ?? false,
             remoteJid: message.key.remoteJid,
             participant: message.key.participant,
             pushName: message.pushName,
             status: dbStatus, // Usar status passado
             source: 'meta', // Indicar origem
             // mediaId: // Extrair se houver mídia
         };

         try {
             await this.prismaRepository.message.create({ data });
         } catch (dbError: any) {
             if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2002') {
                 // Ignorar erro de chave duplicada (mensagem já existe)
                 this.logger.debug(`[${this.instanceName}] Mensagem ${data.keyId} já existe no DB.`);
             } else {
                 this.logger.error(`[${this.instanceName}] Erro ao salvar mensagem Meta no DB: ${dbError}`);
             }
         }
     }

     protected async saveMessageStatusToDb(statusUpdate: Partial<proto.IMessageUserReceipt>) {
          if (!this.prismaConfig.saveMessage || !statusUpdate?.messageId || !statusUpdate?.userJid) return;

          // Mapear status Baileys/Proto para status string do Prisma ('SENT', 'DELIVERED', 'READ', 'ERROR', 'PENDING')
          let prismaStatus: MessageModel['status'] = 'SENT'; // Default
          if(statusUpdate.readTimestamp) prismaStatus = 'READ';
          else if(statusUpdate.receiptTimestamp) prismaStatus = 'DELIVERED'; // Assumindo receipt é delivered
          // Precisamos mapear 'played' (sent da Meta) se necessário

          const data: Prisma.MessageUpdateUncheckedCreateInput = {
               instanceId: this.instanceId!,
               messageKeyId: statusUpdate.messageId,
               status: prismaStatus,
               userJid: statusUpdate.userJid,
               timestamp: statusUpdate.readTimestamp || statusUpdate.receiptTimestamp || statusUpdate.playedTimestamp || Math.floor(Date.now() / 1000),
          };

          try {
               await this.prismaRepository.messageUpdate.create({ data });
               // Opcional: Atualizar também o status na tabela Message principal?
                await this.prismaRepository.message.updateMany({
                     where: { instanceId: this.instanceId!, keyId: statusUpdate.messageId },
                     data: { status: prismaStatus }
                });
          } catch (dbError: any) {
              this.logger.error(`[${this.instanceName}] Erro ao salvar status de mensagem Meta no DB: ${dbError}`);
          }
     }

     protected async updateContactFromMessage(message: Partial<proto.IWebMessageInfo>) {
          if (!message?.key?.remoteJid || message.key.remoteJid.includes('@g.us')) return;

          const contactData = {
               remoteJid: message.key.remoteJid,
               pushName: message.pushName,
               // Tentar obter foto de perfil se disponível no payload da Meta (pode não vir sempre)
               // profilePicUrl: ???
          };
          await this.updateContact?.(contactData); // Chama método da base class (precisa existir)
     }


     // --- Upload de Mídia para Meta (Exemplo de como poderia ser) ---
     protected async uploadMediaToMeta(fileBuffer: Buffer, mimeType: string): Promise<string | null> {
         if (!this.metaApi || !this.metaPhoneNumberId) {
            this.logger.error(`[${this.instanceName}] Meta service não inicializado para upload.`);
            return null;
         }
         this.logger.debug(`[${this.instanceName}] Fazendo upload de mídia para Meta.`);
         try {
             const formData = new FormData();
             formData.append('messaging_product', 'whatsapp');
             formData.append('file', new Blob([fileBuffer], { type: mimeType }), 'media'); // Nome do arquivo pode ser necessário

             const response = await this.metaApi.post(`${this.metaPhoneNumberId}/media`, formData, {
                 headers: { 'Content-Type': 'multipart/form-data' } // Header para FormData
             });

             const mediaId = response.data?.id;
             if (!mediaId) {
                 this.logger.error(`[${this.instanceName}] Falha ao obter ID da mídia após upload para Meta.`);
                 return null;
             }
             this.logger.debug(`[${this.instanceName}] Mídia enviada para Meta com ID: ${mediaId}`);
             return mediaId;
         } catch (error: any) {
             const axiosError = error as AxiosError;
             this.logger.error(`[${this.instanceName}] Erro ao fazer upload de mídia para Meta: ${axiosError.message}`, axiosError.response?.data || '');
             return null;
         }
     }


    // --- Download de Mídia da Meta (Exemplo) ---
    public async downloadMedia(mediaId: string): Promise<Buffer | null> {
        if (!this.metaApi) {
            this.logger.error(`[${this.instanceName}] Meta service não inicializado para download.`);
            return null;
        }
        this.logger.debug(`[${this.instanceName}] Baixando mídia ${mediaId} da Meta.`);
        try {
            // 1. Obter URL da mídia
            const urlResponse = await this.metaApi.get(mediaId); // Endpoint para obter info da mídia
            const mediaUrl = urlResponse.data?.url;
            if (!mediaUrl) {
                 this.logger.error(`[${this.instanceName}] URL não encontrada para mídia ${mediaId}.`);
                 return null;
            }

            // 2. Baixar a mídia da URL obtida (requer token de acesso)
             const downloadResponse = await axios.get(mediaUrl, {
                 headers: { 'Authorization': `Bearer ${this.metaAccessToken}` },
                 responseType: 'arraybuffer' // Obter como buffer
             });

             return Buffer.from(downloadResponse.data);

        } catch (error: any) {
            const axiosError = error as AxiosError;
             // ** Correção Erro 77: Verificar tipo de s3Config e propriedade ENABLE **
             // Acessar via this.s3Config que é inicializado no construtor da classe base
             const s3Config = this.s3Config as S3 | undefined; // Fazer type assertion se necessário
             if (mediaId && s3Config?.ENABLE) { // Corrigido para ENABLE
                 // Tentar buscar do S3 como fallback
                 this.logger.warn(`[${this.instanceName}] Falha ao baixar mídia ${mediaId} da Meta, tentando S3...`);
                 try {
                      const s3Buffer = await this.getMediaFromS3(mediaId);
                      if (s3Buffer) return s3Buffer;
                 } catch (s3Error: any) {
                     this.logger.error(`[${this.instanceName}] Erro ao buscar mídia ${mediaId} do S3: ${s3Error.message}`);
                 }
             }
            this.logger.error(`[${this.instanceName}] Erro ao baixar mídia ${mediaId} da Meta: ${axiosError.message}`, axiosError.response?.data || '');
            return null;
        }
    }

    // --- Chatwoot Integration (handleWebhookMessage) ---
    // Adapta e envia mensagens recebidas do Chatwoot para o WhatsApp via Meta API
    public async handleWebhookMessage(instanceId: string, payload: any): Promise<void> {
         this.logger.debug(`[${this.instanceName}] Recebido webhook do Chatwoot para ${instanceId}`, payload);
         if (instanceId !== this.instanceId) return; // Ignora se não for desta instância

         // Adaptar payload do Chatwoot para envio via Meta
         const messageType = payload.message_type; // incoming, outgoing
         const contentType = payload.content_type; // text, image, etc.
         const content = payload.content;
         const recipientJid = payload.conversation?.meta?.sender?.identifier; // JID do contato

         if (messageType !== 'outgoing' || !recipientJid || !content) {
             this.logger.warn(`[${this.instanceName}] Webhook Chatwoot ignorado (não é outgoing ou faltam dados).`);
             return;
         }

         try {
             if (contentType === 'text') {
                 await this.sendText({ number: recipientJid, message: content });
             } else if (['image', 'video', 'audio', 'file'].includes(contentType)) {
                 // Se for mídia, o payload Chatwoot deve conter a URL do anexo
                 const attachmentUrl = payload.attachments?.[0]?.data_url;
                 if (!attachmentUrl) {
                     this.logger.error(`[${this.instanceName}] Anexo não encontrado no webhook Chatwoot para tipo ${contentType}.`);
                     return;
                 }
                 // Mapear tipo Chatwoot para tipo Meta
                 let metaMediaType: SendMediaDto['mediaType'] = 'document';
                 if (contentType === 'image') metaMediaType = 'image';
                 else if (contentType === 'video') metaMediaType = 'video';
                 else if (contentType === 'audio') metaMediaType = 'audio';

                 await this.mediaMessage({
                     number: recipientJid,
                     mediaType: metaMediaType,
                     media: attachmentUrl, // Envia a URL diretamente
                     caption: content // Legenda pode estar no content ou separado
                 });

             } else {
                 this.logger.warn(`[${this.instanceName}] Tipo de conteúdo Chatwoot não suportado para envio via Meta: ${contentType}`);
             }
         } catch (error: any) {
              this.logger.error(`[${this.instanceName}] Erro ao processar webhook Chatwoot para envio via Meta: ${error.message}`);
         }
    }

} // Fim da classe
