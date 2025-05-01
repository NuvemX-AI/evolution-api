// Arquivo: src/api/integrations/channel/meta/whatsapp.business.service.ts
// Correções v1: Corrigida herança, chamada super(), imports de config/wa.types,
//               logger calls, stateConnection, where clause, acesso a propriedades,
//               removida chamada a eventWhatsapp.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs (usando alias @api)
import { InstanceDto } from '@api/dto/instance.dto';
import { NumberBusiness } from '@api/dto/chat.dto'; // Verificar se 'numbers' existe neste DTO
import {
  Options, SendAudioDto, SendButtonsDto, SendContactDto, SendListDto,
  SendLocationDto, SendMediaDto, SendReactionDto, SendTemplateDto,
  SendTextDto, Button, SendMediaUrlDto // Adicionado SendMediaUrlDto
} from '@api/dto/sendMessage.dto';

// Imports de Serviços, Repositórios, Config (usando aliases)
import * as s3Service from '@integrations/storage/s3/libs/minio.server'; // Usar alias @integrations
import { ProviderFiles } from '@provider/sessions';
import { PrismaRepository } from '@repository/repository.service';
import { chatbotController } from '@api/server.module'; // Verificar se é necessário
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Importar WAMonitoringService
import { Events, wa } from '@api/types/wa.types';
// ** CORREÇÃO TS2305: Importar TODOS os tipos de config necessários de env.config **
import {
  ConfigService, WaBusinessConfig, S3Config, OpenaiConfig,
  ChatwootConfig, DatabaseConfig, HttpServerConfig, AuthConfig // Adicionado HttpServerConfig, AuthConfig
} from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { createJid } from '@utils/createJid'; // Usar alias @utils

// Imports de libs externas
import axios from 'axios';
import { isURL, isBase64 } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import mimeTypes from 'mime-types';
import * as path from 'path';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { Prisma } from '@prisma/client'; // Importar Prisma para tipos
import { join } from 'path';

// ** CORREÇÃO TS2415 / TS2610: Corrigir herança e override de 'token' **
export class BusinessStartupService extends ChannelStartupService {
  // --- Propriedades ---
  // ** CORREÇÃO TS2353: Inicialização correta (sem 'connection') **
  public stateConnection: wa.StateConnection = { status: 'CLOSE', lastDisconnect: undefined }; // Usar 'status'
  public mobile: boolean = false;
  // Propriedades herdadas: logger, instance, localSettings, localChatwoot, openaiService, chatwootService
  // ** CORREÇÃO TS2610: 'token' agora é uma propriedade normal, não conflita com getter/setter da base (se houver) **
  protected token: string | undefined; // Específico para Meta
  protected numberId: string | undefined; // Específico para Meta (ID do número de telefone)

  constructor(
    // Dependências da base
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly chatwootCache: CacheService,
    protected readonly waMonitor: WAMonitoringService, // Adicionado para base
    protected readonly baseLogger: Logger, // Adicionado para base
    chatwootService: ChatwootService, // Adicionado para base
    // Dependências específicas (se houver)
    public readonly cache: CacheService, // Assumindo que CacheService é necessário
    public readonly baileysCache: CacheService, // Não aplicável aqui?
    private readonly providerFiles: ProviderFiles, // Não aplicável aqui?
  ) {
    // ** CORREÇÃO TS2554: Passar TODOS os argumentos esperados pela base **
    super(configService, eventEmitter, prismaRepository, chatwootCache, waMonitor, baseLogger, chatwootService);
    // this.logger já inicializado na base
  }

  // Sobrescrevendo setInstance (mantido)
  public setInstance(instanceData: InstanceDto & { token?: string; number?: string }): void { /* ... (implementação anterior mantida) ... */ }


  // --- Getters (mantidos) ---
  public get connectionStatus(): wa.StateConnection { return this.stateConnection; }
  public get qrCode(): wa.QrCode { /* ... (implementação anterior mantida) ... */ }

  // --- Métodos Principais (corrigidos) ---
  public async closeClient(): Promise<void> {
    this.logger.info('Meta Channel: closeClient chamado (mudando estado para close).');
    // ** CORREÇÃO TS2353: Usar 'status' **
    this.stateConnection = { status: 'CLOSE', lastDisconnect: undefined };
    await this.sendDataWebhook(Events.STATUS_INSTANCE, { instance: this.instanceName, status: 'closed' });
  }
  public async logoutInstance(): Promise<void> { /* ... (implementação anterior mantida) ... */ }

  private async post(message: any, endpoint: string = 'messages'): Promise<any> {
    try {
      const waBusinessConfig = this.configService.get<WaBusinessConfig>('WA_BUSINESS');
      // ... (validações de config, token, numberId mantidas) ...
      const urlServer = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${this.numberId}/${endpoint}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
      // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
      this.logger.debug({ url: urlServer, data: message, message: `POST Request to Meta API` });
      const result = await axios.post(urlServer, message, { headers });
      // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
      this.logger.debug({ response: result.data, message: `POST Response from Meta API` });
      return result.data;
    } catch (e: any) {
      const errorData = e?.response?.data?.error;
      // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
      this.logger.error({ err: errorData || e, message: `Erro na chamada POST para Meta API (${endpoint})` });
      return { error: errorData || { message: e.message, code: e.code || 500 } };
    }
  }

  private async getMedia(mediaId: string): Promise<{ buffer: Buffer; mimetype: string; fileName?: string }> {
    try {
       // ... (lógica mantida) ...
       if (contentDisposition) { /* ... */
          try { fileName = decodeURIComponent(match[1].replace(/['"]+/g, '')); }
          catch (decodeError) {
              // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
              this.logger.warn({ contentDisposition, message: 'Falha ao decodificar filename do content-disposition' });
              fileName = match[1].replace(/['"]+/g, '');
          }
       }
       // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
       this.logger.debug({ fileName, message: 'Nome do arquivo obtido do cabeçalho' });
       return { buffer, mimetype, fileName };
    } catch (e: any) {
      const errorData = e?.response?.data?.error;
      // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
      this.logger.error({ err: errorData || e, mediaId }, `Erro ao baixar mídia da Meta API`);
      throw new InternalServerErrorException(`Falha ao baixar mídia: ${errorData?.message || e.message}`);
    }
  }

  // Implementação de método abstrato
  public async connectToWhatsapp(webhookValue?: any): Promise<any> {
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ webhookValue: !!webhookValue, message: `Meta Channel: connectToWhatsapp/webhook recebido.` });
    if (!webhookValue || !webhookValue.object) { /* ... (lógica mantida) ... */
       // ** CORREÇÃO TS2353: Usar 'status' **
       this.stateConnection = { status: 'OPEN', lastDisconnect: undefined };
       return { status: 'Webhook Received (No Data)', state: this.stateConnection };
    }
    // ... (lógica de processamento de entry/changes mantida) ...
    if (webhookValue.entry && Array.isArray(webhookValue.entry)) { /* ... */ }
    return { status: 'Webhook Processed', state: this.stateConnection };
  }

  // Implementação de método abstrato
  public getStatus(): wa.StateConnection { return this.stateConnection; }

  protected async eventHandler(value: any): Promise<void> {
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.debug({ value, message: `Meta Channel: eventHandler processando` });
    try { /* ... (lógica mantida) ... */ }
    catch (error: any) { this.logger.error({ err: error, message: `Erro em eventHandler (Meta)` }); }
  }

  private async messageHandle(message: any, contactInfo: any, metadata: any): Promise<void> {
     // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
     this.logger.debug({ messageId: message.id, type: message.type, from: message.from, message: `Processando mensagem` });
     // ... (lógica de criação de key, pushName, messageContent, messageType mantida) ...

      if (message.system) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.info({ system: message.system, message: `Mensagem de sistema recebida` });
        // ** CORREÇÃO TS2339: Chamar método existente da base **
        await super.sendDataWebhook(Events.SYSTEM_MESSAGE, { instance: this.instanceName, system: message.system });
        return;
     } else if (message.errors) {
         // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
         this.logger.error({ errors: message.errors, message: `Erro reportado no webhook da Meta para mensagem ${message.id}` });
         return;
     } else if (!messageType.endsWith('Message') && messageType !== 'conversation' && messageType !== 'reactionMessage' && messageType !== 'unsupportedMessage' && messageType !== 'contactsArrayMessage' && messageType !== 'locationMessage') {
         // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.warn({ messageType: message.type, messageId: message.id, message: `Tipo de mensagem Meta não tratado` });
        messageContent = { conversation: `[Mensagem do tipo ${message.type} não suportada]` };
        messageType = 'unsupportedMessage';
     }

     // ** CORREÇÃO TS2694: Usar wa.WAMessage (se definido corretamente em wa.types.ts) ou any **
     const messageRaw: any = { // Usar 'any' se wa.WAMessage não estiver definido/exportado
       key, pushName, message: messageContent, messageType,
       messageTimestamp: parseInt(message.timestamp) || Math.round(Date.now() / 1000),
       source: 'meta_api', instanceId: this.instanceId,
     };

     // ... (Lógica de download/upload S3 mantida, com logger corrigido) ...
     if (mediaKey) { /* ... */
         try { /* ... download/upload ... */ }
         catch (error: any) { this.logger.error({ err: error, mediaId, message: `Falha no download/upload de mídia` }); /* ... */ }
     }

     // ... (Lógica OpenAI mantida) ...
     // ** CORREÇÃO TS2304: Definir mediaMsg ou ajustar lógica **
     // let mediaMsg: any = null; // Definir mediaMsg se a lógica OpenAI for mantida
     // if (mediaKey) mediaMsg = messageContent[mediaKey];
     // if (this.configService.get<OpenaiConfig>('OPENAI')?.ENABLED && messageType === 'audioMessage' && mediaMsg?.url && !mediaMsg.url.startsWith('media:')) { /* ... */ }

     // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
     this.logger.log({ messageRaw, message: 'Mensagem processada (Meta)' });

     await super.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw); // Chama método da base
     await chatbotController?.emit?.({ /* ... */ });

     // ** CORREÇÃO TS2339: Remover chamada a eventWhatsapp (não existe em ChatwootService) **
     if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        this.logger.info(`Enviando mensagem ${message.id} para Chatwoot (implementação pendente em ChatwootService)...`);
         // const chatwootSentMessage = await this.chatwootService?.ALGUM_METODO_PARA_ENVIAR_MSG?.(
         //    { instanceName: this.instanceName, instanceId: this.instanceId }, messageRaw,
         // );
         // if (chatwootSentMessage?.id) { /* ... atualizar IDs ... */ }
     }

     try { await this.prismaRepository.createMessage({ data: { /* ... mapear messageRaw ... */ } as any }); }
     catch (dbError: any) { this.logger.error({ err: dbError, messageId: message.id, message: `Erro ao salvar mensagem no banco` }); }

     if (!fromMe) { await this.updateContact({ remoteJid: key.remoteJid, pushName: pushName }); }
  }


  private async updateContact(data: { remoteJid: string; pushName?: string; profilePicUrl?: string }): Promise<void> {
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ contact: data, message: `Atualizando contato (Meta)` });
    // ** CORREÇÃO TS2694: Usar wa.ContactPayload (se definido) ou Partial<any> **
    const contactRaw: Partial<any> = { // Usar 'any' se wa.ContactPayload não estiver definido/exportado
      remoteJid: data.remoteJid, pushName: data.pushName || data.remoteJid.split('@')[0],
      instanceId: this.instanceId, profilePicUrl: data?.profilePicUrl,
    };

    try {
        // ** CORREÇÃO TS2353: Usar where correto (baseado no schema Prisma) **
        // Assumindo que a chave única é o índice composto:
        await this.prismaRepository.upsertContact({
           where: { remoteJid_instanceId: { remoteJid: data.remoteJid, instanceId: this.instanceId } },
           update: { pushName: contactRaw.pushName, profilePicUrl: contactRaw.profilePicUrl },
           create: { remoteJid: contactRaw.remoteJid!, instanceId: contactRaw.instanceId!, pushName: contactRaw.pushName, profilePicUrl: contactRaw.profilePicUrl },
        });
    } catch (dbError: any) {
         // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
         this.logger.error({ err: dbError, contactJid: data.remoteJid, message: `Erro ao salvar contato no banco` });
         return;
    }

    await super.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw); // Chama método da base

    // ** CORREÇÃO TS2339: Remover chamada a eventWhatsapp (não existe em ChatwootService) **
    if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger.info(`Enviando atualização de contato (Meta) para Chatwoot (implementação pendente em ChatwootService)...`);
       // await this.chatwootService?.ALGUM_METODO_PARA_ATUALIZAR_CONTATO?.(
       //   { instanceName: this.instanceName, instanceId: this.instanceId }, contactRaw,
       // );
    }
  }


  private async statusHandle(statusInfo: any, metadata: any): Promise<void> {
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.debug({ statusInfo, message: `Processando status` });
    // ... (lógica de key, ignorar status@broadcast mantida) ...
    // ** CORREÇÃO TS2339: Remover uso de this.logger.trace **
    if (key.remoteJid === 'status@broadcast' || key?.remoteJid?.includes(':')) {
        this.logger.debug(`Ignorando atualização de status para ${key.remoteJid}`); // Usar debug ou verbose
        return;
    }
    // ... (lógica de busca findMessage mantida) ...
    if (!findMessage) {
       // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
       this.logger.warn({ messageId: key.id, message: `Mensagem original não encontrada para atualização de status.` });
       return;
    }
    // ... (lógica de statusOrder mantida) ...

    // ** CORREÇÃO TS2694: Usar wa.MessageUpdate (se definido) ou any **
    const messageUpdate: Partial<any> = { // Usar 'any' se wa.MessageUpdate não estiver definido/exportado
      messageId: findMessage.id, keyId: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe,
      participant: key.remoteJid, status: normalizedStatus,
      timestamp: parseInt(statusInfo.timestamp) || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
    };

    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.log({ update: messageUpdate, message: `Atualização de status processada` });
    await super.sendDataWebhook(Events.MESSAGES_UPDATE, messageUpdate); // Chama método da base

     try { /* ... (lógica DB mantida) ... */ }
     catch (dbError: any) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: dbError, messageId: key.id, message: `Erro ao salvar status no banco` });
     }
     // ... (lógica Chatwoot mantida como comentário) ...
  }


  // --- Métodos de Envio de Mensagem (Corrigidos) ---

  public async textMessage(data: SendTextDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, message: `Enviando mensagem de texto` });
    // ...
  }

  private async uploadMediaForMeta(media: Buffer | Readable | string, mimetype: string): Promise<string | null> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    try { /* ... */
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.debug({ url: urlUpload, message: `POST (uploading media)` });
        // ...
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.debug({ response: response.data, message: `Media Upload Response` });
        return response.data?.id || null;
    } catch(e: any) {
        const errorData = e?.response?.data?.error;
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: errorData || e, message: `Erro no upload de mídia para Meta API` });
        throw new InternalServerErrorException(`Falha no upload da mídia: ${errorData?.message || e.message}`);
    }
  }

  public async mediaMessage(data: SendMediaDto | SendMediaUrlDto, file?: any, isIntegration = false): Promise<any> { /* ... (impl. v3 adaptada para usar SendMediaUrlDto, loggers corrigidos) ... */
      // ... lógica para determinar mediaContent, mediaBuffer, isLocalFile ...
      const mimeType = file?.mimetype || data.mimetype || mimeTypes.lookup(data.fileName || '') || 'application/octet-stream';

      if (typeof data.media === 'string' && isURL(data.media) && !mediaBuffer) {
          mediaPayload.link = data.media;
          if(data.mediatype === 'document' && data.fileName) mediaPayload.filename = data.fileName;
      } else {
          const fileToUpload = mediaBuffer || (isLocalFile ? createReadStream(data.media as string) : null);
          if(!fileToUpload) throw new BadRequestException('Mídia inválida para upload.');
          const mediaId = await this.uploadMediaForMeta(fileToUpload, mimeType); // Passa mimetype correto
          if (!mediaId) throw new InternalServerErrorException('Falha ao obter ID da mídia da Meta.');
          mediaPayload.id = mediaId;
           if(data.mediatype === 'document' && data.fileName) mediaPayload.filename = data.fileName;
      }
      // ...
      // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
      this.logger.info({ to: jid, type: data.mediatype, message: `Enviando mensagem de mídia` });
      // ...
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida) ... */ }

  public async buttonMessage(data: SendButtonsDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, message: `Enviando mensagem interativa (botões)` });
    // ...
  }

  public async listMessage(data: SendListDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, message: `Enviando mensagem interativa (lista)` });
    // ...
  }

  public async locationMessage(data: SendLocationDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, message: `Enviando mensagem de localização` });
    // ...
  }

  public async contactMessage(data: SendContactDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, count: contactsToSend.length, message: `Enviando mensagem de contato(s)` });
    // ...
  }

  public async reactionMessage(data: SendReactionDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, msgId: data.key.id, reaction: data.reaction || '(remover)', message: `Enviando reação` });
    // ...
  }

  public async templateMessage(data: SendTemplateDto, isIntegration = false): Promise<any> { /* ... (impl. v3 mantida, loggers corrigidos) ... */
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.info({ to: jid, template: data.name, message: `Enviando mensagem de template` });
    // ...
  }


  // --- Métodos Não Suportados (Mantidos) ---
  public async whatsappNumber(data: NumberBusiness): Promise<any> {
      // ** CORREÇÃO TS2339: Usar data.numbers **
      const jids = data.numbers.map(createJid); // Assumindo que NumberBusiness tem 'numbers'
      this.logger.warn('Verificação onWhatsApp não implementada para Meta API.');
      return { numbers: jids.map(jid => ({ exists: false, jid: jid })) };
  }
  // ... (restante dos métodos não suportados mantidos com throw new BadRequestException) ...

} // Fim da classe BusinessStartupService
