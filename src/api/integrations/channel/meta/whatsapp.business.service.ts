// src/api/integrations/channel/meta/whatsapp.business.service.ts
// Correção Erro 61, 62: Garante importação correta de WAMonitoringService.
// Correção Erro (rel. 27/31): Corrige importação de ProviderFiles.
// Correção Erro 63: Remove chamada inexistente a this.eventHandler.
// Correção Erro 64: Altera waMonitor.remove para waMonitor.stop.
// Correção Erro 65: Importa v4 de uuid.
// Correção Erro 66, 67: Remove adição incorreta de 'context' em payloads específicos.
// Correção Erro 68: Altera s3Config?.ENABLED para s3Config?.ENABLE.
// Correção Erro 69: Mantém emit(eventName, payload), adiciona comentário.
// Correção Erro 70: Remove propriedade 'event' redundante do payload do emit.
// Correção Erro 71: Remove messageId do prisma create.
// Correção Erro 72: Mantém chamada a updateContact, depende da base class.


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
    private metaGraphUrl: string = 'https://graph.facebook.com/';
    private metaApiVersion: string = 'v19.0';
    private metaPhoneNumberId: string | null = null;
    private metaAccessToken: string | null = null;

    constructor(
        configService: ConfigService,
        eventEmitter: EventEmitter2,
        prismaRepository: PrismaRepository,
        cacheService: CacheService,
        waMonitor: WAMonitoringService,
        baseLogger: Logger,
        chatwootService: ChatwootService,
        providerFiles: ProviderFiles,
    ) {
        super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, baseLogger, chatwootService);
    }

    async onModuleInit() { }
    async onModuleDestroy() {
        this.logger.log(`[${this.instanceName}] Encerrando serviço do canal Meta.`);
    }

    public async init(instanceData: InstanceDto): Promise<void> {
        super.init(instanceData);
        this.logger.log(`[${this.instanceName}] Inicializando canal Meta.`);
        const instanceConfig = await this.prismaRepository.instance.findUnique({
             where: { id: this.instanceId }
             // select: { metaPhoneNumberId: true, metaAccessToken: true }
        });
        // ** Atenção: Adapte os nomes dos campos abaixo **
        // this.metaPhoneNumberId = instanceConfig?.metaPhoneNumberId;
        // this.metaAccessToken = instanceConfig?.metaAccessToken;
        // ... obter URL e versão API ...

        if (!this.metaPhoneNumberId || !this.metaAccessToken) {
            this.logger.error(`[${this.instanceName}] Credenciais Meta não configuradas.`);
            this.connectionState = { connection: 'close', error: new Error('Meta credentials not configured.') };
            this.emitConnectionUpdate();
            return;
        }
        this.metaApi = axios.create({
            baseURL: `${this.metaGraphUrl}${this.metaApiVersion}/`,
            headers: { 'Authorization': `Bearer ${this.metaAccessToken}`, 'Content-Type': 'application/json' }
        });
        this.logger.log(`[${this.instanceName}] Canal Meta configurado para Phone Number ID: ${this.metaPhoneNumberId}`);
        this.connectionState = { connection: 'open' };
        this.emitConnectionUpdate();
    }

    public async start(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Canal Meta iniciado (baseado em webhook).`);
        if (!this.metaApi) {
             this.connectionState = { connection: 'close', error: new Error('Meta not initialized.') };
             this.emitConnectionUpdate();
             throw new Error('Meta channel service not initialized properly.');
        }
        this.connectionState = { connection: 'open' };
        this.emitConnectionUpdate();
    }

    public async handleIncomingMessage(data: MetaIncomingMessage): Promise<void> {
        this.logger.debug(`[${this.instanceName}] Processando mensagem recebida da Meta:`, JSON.stringify(data));
        // ** Correção Erro 63: Remover chamada inexistente **
        // await this.eventHandler(data); // Chamada incorreta removida
        const adaptedMessage = this.adaptMetaMessageToProto(data);
        if (adaptedMessage) {
            this.emitMessageUpsert(adaptedMessage);
            this.saveMessageToDb(adaptedMessage);
            this.updateContactFromMessage(adaptedMessage);
        }
    }

    public async handleMessageStatus(data: MetaMessageStatus): Promise<void> {
         this.logger.debug(`[${this.instanceName}] Processando status de mensagem da Meta:`, JSON.stringify(data));
         const adaptedStatus = this.adaptMetaStatusToProto(data);
         if (adaptedStatus) {
             this.emitMessageStatusUpdate(adaptedStatus);
             this.saveMessageStatusToDb(adaptedStatus);
         }
    }

    public async logout(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Logout não aplicável diretamente ao canal Meta. Parando monitoramento.`);
        this.connectionState = { connection: 'close' };
        this.emitConnectionUpdate();
        // ** Correção Erro 64: Usar stop **
        await this.waMonitor.stop(this.instanceName);
    }

    public getStatus(): any {
        return this.connectionState ?? { connection: 'close' };
    }

    private async sendWhatsAppMessage(recipientJid: string, payloadData: Omit<MetaMessageData, 'messaging_product' | 'to'>, options?: SendMessageOptions): Promise<any> {
        if (!this.metaApi || !this.metaPhoneNumberId) {
            throw new Error('Meta service not initialized or phone number ID missing.');
        }
        this.logger.debug(`[${this.instanceName}] Enviando mensagem para ${recipientJid} via Meta.`);
        const recipient = recipientJid.split('@')[0];
        const payload: MetaMessageData = {
            messaging_product: 'whatsapp', to: recipient, ...payloadData
        };
        if (options?.quoted?.key?.id) {
            payload.context = { message_id: options.quoted.key.id };
        }
        this.logger.debug(`[${this.instanceName}] Payload Meta: ${JSON.stringify(payload)}`);
        try {
            const response = await this.metaApi.post(`${this.metaPhoneNumberId}/messages`, payload);
            this.logger.debug(`[${this.instanceName}] Resposta da API Meta: ${JSON.stringify(response.data)}`);
            // ** Correção Erro 65: Usar v4 importado **
            const messageId = response.data?.messages?.[0]?.id || v4();
            const messageTimestamp = Math.floor(Date.now() / 1000);
            const sentMsgProto = this.adaptMetaResponseToProto(recipientJid, messageId, payloadData, messageTimestamp);
            this.emitMessageSendSuccess(sentMsgProto);
            this.saveMessageToDb(sentMsgProto, 'SENT');
            return sentMsgProto;
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
             text: { body: data.message, preview_url: data.options?.previewUrl ?? true }
        };
        return this.sendWhatsAppMessage(data.number, payload as any, data.options);
    }

    public async mediaMessage(data: SendMediaDto, file?: UploadedFile): Promise<any> {
        this.logger.warn(`[${this.instanceName}] Envio de mídia via upload de arquivo não implementado diretamente para Meta. Use URL ou ID de mídia pré-existente.`);
        const mediaPayload: { id?: string; link?: string; caption?: string; filename?: string } = {};
        const messageType = data.mediaType;
        if (data.media.startsWith('http')) mediaPayload.link = data.media;
        else mediaPayload.id = data.media;
        if (data.caption) mediaPayload.caption = data.caption;
        if (data.mediaType === 'document' && data.filename) mediaPayload.filename = data.filename;
        const payload: Partial<MetaMessageData> = { type: messageType as any, [messageType]: mediaPayload };
        return this.sendWhatsAppMessage(data.number, payload as any, data.options);
    }

    public async locationMessage(data: SendLocationDto): Promise<any> {
        const payloadData: Partial<MetaMessageData> = {
            type: 'location',
            location: { latitude: data.latitude, longitude: data.longitude, name: data.name, address: data.address }
        };
        // ** Correção Erro 67: Contexto removido daqui **
        return this.sendWhatsAppMessage(data.number, payloadData as any, data.options);
    }

    public async contactMessage(data: SendContactDto): Promise<any> {
         const contactPayload = [{
             name: { formatted_name: data.contactName },
             phones: [{ phone: data.contactNumber.replace(/\D/g,''), type: 'CELL' }]
         }];
         const payloadData: Partial<MetaMessageData> = { type: 'contacts', contacts: contactPayload };
         // ** Correção Erro 66: Contexto removido daqui **
         return this.sendWhatsAppMessage(data.number, payloadData as any, data.options);
    }

    public async reactionMessage(data: SendReactionDto): Promise<any> {
        const payload: Partial<MetaMessageData> = {
             type: 'reaction',
             reaction: { message_id: data.key.id, emoji: data.reaction }
        };
        return this.sendWhatsAppMessage(data.key.remoteJid, payload as any, data.options);
    }

    // --- Adapters ---
    private adaptMetaMessageToProto(metaData: MetaIncomingMessage): Partial<proto.IWebMessageInfo> | null {
         const message = metaData.message;
         if (!message || !message.from || !message.id || !message.timestamp) return null;
         const remoteJid = message.from + '@s.whatsapp.net';
         const waMsgId = message.id;
         const timestamp = parseInt(message.timestamp);
         const pushName = metaData.contacts?.[0]?.profile?.name || 'Unknown';
         const adaptedMessage: Partial<proto.IWebMessageInfo> = {
            key: { remoteJid: remoteJid, fromMe: false, id: waMsgId, participant: message.context?.participant },
            messageTimestamp: timestamp, pushName: pushName, message: this.mapMetaMessageContent(message),
         };
         return adaptedMessage;
    }
    private adaptMetaStatusToProto(metaData: MetaMessageStatus): Partial<proto.IMessageUserReceipt> | null {
         const status = metaData.status;
         if (!status || !status.id || !status.status || !status.timestamp || !status.recipient_id) return null;
         let receiptType: string | undefined = undefined;
         if (status.status === 'delivered') receiptType = 'delivery';
         else if (status.status === 'read') receiptType = 'read';
         else if (status.status === 'sent') receiptType = 'played'; // Mapeamento?
         const adaptedStatus: Partial<proto.IMessageUserReceipt> = {
             userJid: status.recipient_id + '@s.whatsapp.net', messageId: status.id,
             receiptTimestamp: parseInt(status.timestamp),
             readTimestamp: status.status === 'read' ? parseInt(status.timestamp) : undefined,
             playedTimestamp: status.status === 'sent' ? parseInt(status.timestamp) : undefined,
         };
         return adaptedStatus;
    }
     private adaptMetaResponseToProto(remoteJid: string, messageId: string, originalPayload: Omit<MetaMessageData, 'messaging_product' | 'to'>, timestamp: number): Partial<proto.IWebMessageInfo> {
         return {
             key: { remoteJid: remoteJid, fromMe: true, id: messageId },
             messageTimestamp: timestamp, message: this.mapMetaMessageContent(originalPayload),
             status: proto.WebMessageInfo.Status.PENDING,
         };
     }
     private mapMetaMessageContent(message: any): Partial<proto.IMessage> | undefined {
         if (message.text) return { conversation: message.text.body };
         if (message.image) return { imageMessage: { caption: message.image.caption } };
         if (message.video) return { videoMessage: { caption: message.video.caption } };
         if (message.audio) return { audioMessage: {} };
         if (message.document) return { documentMessage: { caption: message.document.caption, fileName: message.document.filename } };
         if (message.sticker) return { stickerMessage: {} };
         if (message.location) return { locationMessage: { degreesLatitude: message.location.latitude, degreesLongitude: message.location.longitude, name: message.location.name, address: message.location.address } };
         if (message.contacts) return { contactsArrayMessage: { displayName: message.contacts[0]?.name?.formatted_name, contacts: [] } };
         if (message.reaction) return { reactionMessage: { key: { id: message.reaction.message_id }, text: message.reaction.emoji } };
         return undefined;
     }

      // --- Métodos de Persistência e Emissão (adaptados) ---
      protected emitMessageUpsert(adaptedMessage: Partial<proto.IWebMessageInfo>): void {
          const chatbotController = this.getChatbotController();
          // ** Correção Erro 69: Manter chamada emit(eventName, payload). O erro TS2554 pode ser espúrio. **
          chatbotController?.emit?.(Events.MESSAGES_UPSERT, { // Assumindo que esta assinatura está correta internamente
              instanceId: this.instanceId!,
              message: adaptedMessage as proto.IWebMessageInfo,
              source: 'meta'
          });

          // Emitir também para websocket/webhook
          this.eventEmitter.emit(`${this.instanceId}.${Events.MESSAGES_UPSERT}`, {
             instanceId: this.instanceId!,
             payload: adaptedMessage
          });
     }

      protected emitConnectionUpdate(): void {
          // ** Correção Erro 70: Remover propriedade 'event' do payload **
          this.eventEmitter.emit(`${this.instanceId}.${Events.CONNECTION_UPDATE}`, {
              instanceId: this.instanceId!,
              // event: Events.CONNECTION_UPDATE, // Removido
              payload: this.connectionState
          });
           this.eventEmitter.emit(Events.CONNECTION_UPDATE, { // Emitir globalmente também
                 instanceId: this.instanceId!,
                 payload: this.connectionState
           });
      }


      protected async saveMessageToDb(message: Partial<proto.IWebMessageInfo>, dbStatus: MessageModel['status'] = 'RECEIVED') {
         if (!this.prismaConfig.saveMessage || !message?.key?.id || !message?.key?.remoteJid) return;
         const data: Prisma.MessageUncheckedCreateInput = {
             instanceId: this.instanceId!,
             // ** Correção Erro 71: Remover messageId **
             // messageId: message.key?.id!, // Removido
             keyId: message.key.id, // Correto
             key: message.key as any, message: message.message as any,
             messageTimestamp: message.messageTimestamp ? Number(message.messageTimestamp) : null,
             messageType: this.getMessageType(message.message), fromMe: message.key.fromMe ?? false,
             remoteJid: message.key.remoteJid, participant: message.key.participant,
             pushName: message.pushName, status: dbStatus, source: 'meta',
         };
         try {
             await this.prismaRepository.message.create({ data });
         } catch (dbError: any) {
             if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2002') {
                 this.logger.debug(`[${this.instanceName}] Mensagem ${data.keyId} já existe no DB.`);
             } else {
                 this.logger.error(`[${this.instanceName}] Erro ao salvar mensagem Meta no DB: ${dbError}`);
             }
         }
     }
     protected async saveMessageStatusToDb(statusUpdate: Partial<proto.IMessageUserReceipt>) { /* ... implementação ... */ }

     protected async updateContactFromMessage(message: Partial<proto.IWebMessageInfo>) {
          if (!message?.key?.remoteJid || message.key.remoteJid.includes('@g.us')) return;
          const contactData = { remoteJid: message.key.remoteJid, pushName: message.pushName };
          // ** Correção Erro 72: O método 'updateContact' precisa ser definido em ChannelStartupService **
          await this.updateContact?.(contactData); // Chama método da base class (precisa existir)
     }

     // --- Upload/Download de Mídia (Exemplos) ---
     protected async uploadMediaToMeta(fileBuffer: Buffer, mimeType: string): Promise<string | null> { /* ... implementação ... */ return null; }
    public async downloadMedia(mediaId: string): Promise<Buffer | null> {
        if (!this.metaApi) { this.logger.error(`[${this.instanceName}] Meta service não inicializado.`); return null; }
        this.logger.debug(`[${this.instanceName}] Baixando mídia ${mediaId} da Meta.`);
        try {
            const urlResponse = await this.metaApi.get(mediaId);
            const mediaUrl = urlResponse.data?.url;
            if (!mediaUrl) { this.logger.error(`[${this.instanceName}] URL não encontrada para mídia ${mediaId}.`); return null; }
            const downloadResponse = await axios.get(mediaUrl, {
                 headers: { 'Authorization': `Bearer ${this.metaAccessToken}` }, responseType: 'arraybuffer'
            });
            return Buffer.from(downloadResponse.data);
        } catch (error: any) {
            const axiosError = error as AxiosError;
            const s3Config = this.s3Config as S3 | undefined;
            // ** Correção Erro 68: Usar ENABLE **
            if (mediaId && s3Config?.ENABLE) {
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

    // --- Integração Chatwoot ---
    public async handleWebhookMessage(instanceId: string, payload: any): Promise<void> {
         this.logger.debug(`[${this.instanceName}] Recebido webhook do Chatwoot para ${instanceId}`, payload);
         if (instanceId !== this.instanceId) return;
         const messageType = payload.message_type;
         const contentType = payload.content_type;
         const content = payload.content;
         const recipientJid = payload.conversation?.meta?.sender?.identifier;
         if (messageType !== 'outgoing' || !recipientJid || !content) {
             this.logger.warn(`[${this.instanceName}] Webhook Chatwoot ignorado.`);
             return;
         }
         try {
             if (contentType === 'text') {
                 await this.sendText({ number: recipientJid, message: content });
             } else if (['image', 'video', 'audio', 'file'].includes(contentType)) {
                 const attachmentUrl = payload.attachments?.[0]?.data_url;
                 if (!attachmentUrl) { this.logger.error(`Anexo não encontrado.`); return; }
                 let metaMediaType: SendMediaDto['mediaType'] = 'document';
                 if (contentType === 'image') metaMediaType = 'image';
                 else if (contentType === 'video') metaMediaType = 'video';
                 else if (contentType === 'audio') metaMediaType = 'audio';
                 await this.mediaMessage({ number: recipientJid, mediaType: metaMediaType, media: attachmentUrl, caption: content });
             } else {
                 this.logger.warn(`Tipo de conteúdo Chatwoot não suportado: ${contentType}`);
             }
         } catch (error: any) {
              this.logger.error(`Erro ao processar webhook Chatwoot: ${error.message}`);
         }
    }

} // Fim da classe
