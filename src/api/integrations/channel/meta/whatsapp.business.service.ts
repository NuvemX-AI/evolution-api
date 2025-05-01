// Arquivo: src/api/integrations/channel/meta/whatsapp.business.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs (usando alias @api)
import { InstanceDto } from '@api/dto/instance.dto'; // CORREÇÃO TS2304: Importar InstanceDto
import { NumberBusiness } from '@api/dto/chat.dto';
import {
  // ContactMessage, // Não usado diretamente aqui
  // MediaMessage, // Não usado diretamente aqui
  Options, // Presume que 'Options' existe e será adicionado em sendMessage.dto.ts
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendTemplateDto,
  SendTextDto,
  Button, // Importado para tipagem correta
} from '@api/dto/sendMessage.dto';

// Imports de Serviços, Repositórios, Config (usando aliases)
import * as s3Service from '@integrations/storage/s3/libs/minio.server'; // Usar alias @integrations
import { ProviderFiles } from '@provider/sessions'; // Usar alias @provider
import { PrismaRepository } from '@repository/repository.service'; // Usar alias canônico @repository
import { chatbotController } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { Events, wa } from '@api/types/wa.types'; // Usar alias @api
// CORREÇÃO TS2305: Importar tipos corretamente de env.config
import { ConfigService, WaBusinessConfig, S3Config, OpenaiConfig, ChatwootConfig, DatabaseConfig } from '@config/env.config';
import { Logger } from '@config/logger.config'; // Usar alias @config
import { BadRequestException, InternalServerErrorException } from '@exceptions'; // Usar alias @exceptions
import { createJid } from '@utils/createJid'; // Usar alias @utils

// Imports de libs externas
import axios from 'axios';
import { isURL, isBase64 } from 'class-validator'; // Importado isBase64
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { Readable } from 'stream'; // Importado Readable
import mimeTypes from 'mime-types';
import * as path from 'path'; // CORREÇÃO TS2304: Importar path
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Usar alias @integrations
// import { Message as MessageModel, Prisma } from '@prisma/client'; // Importar apenas se necessário
import { join } from 'path'; // CORREÇÃO TS2304: Importar join

// CORREÇÃO TS2415: Garantir compatibilidade com ChannelStartupService (logger deve ser protected ou public na base)
export class BusinessStartupService extends ChannelStartupService {
  // --- Propriedades ---
  public stateConnection: wa.StateConnection = { connection: 'open', lastDisconnect: undefined }; // Usar tipo wa.StateConnection
  // public phoneNumber: string = ''; // Herdado da base
  public mobile: boolean = false;
  // protected logger: Logger; // Herdado da base
  // protected instance: InstanceDto; // Herdado da base
  protected token: string | undefined; // Específico para Meta
  protected numberId: string | undefined; // Específico para Meta (ID do número de telefone)

  // protected localSettings: wa.LocalSettings; // Herdado da base
  // protected localChatwoot?: wa.ChatwootConfigLocal; // Herdado da base
  // protected openaiService: any; // Herdado da base (ou injetar)
  // protected chatwootService!: ChatwootService; // Herdado da base (injetado no construtor da base)

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles, // Não usado pela Meta API, mas mantido se a base exigir
    // ChatwootService é injetado na classe base
  ) {
    // Passar chatwootService explicitamente para o construtor da base
    super(configService, eventEmitter, prismaRepository, chatwootCache, null as any); // Passar null para chatwootService se ele for inicializado depois ou injetado de outra forma
    // this.logger já inicializado na base
  }

  // Sobrescrevendo setInstance para pegar token e numberId específicos da Meta
  public setInstance(instanceData: InstanceDto & { token?: string; number?: string }): void {
    super.setInstance(instanceData); // Chama a base para definir name, id, etc.

    this.token = instanceData.token;
    this.numberId = instanceData.number; // Armazena o ID do número

    if (!this.token) {
      this.logger.warn(`Token não fornecido para a instância Meta ${instanceData.instanceName}. As chamadas de API falharão.`);
    }
    if (!this.numberId) {
      this.logger.warn(`ID do número (number) não fornecido para a instância Meta ${instanceData.instanceName}. As chamadas de API falharão.`);
    }
    this.logger.info(`Meta Channel: Token e Number ID definidos para ${this.instanceName}`);
  }


  // --- Getters ---
  public get connectionStatus(): wa.StateConnection {
    return this.stateConnection;
  }

  public get qrCode(): wa.QrCode { // Meta API não usa QR Code
    return { code: null, base64: null, count: 0, pairingCode: null };
  }

  // --- Métodos Principais ---
  public async closeClient(): Promise<void> {
    this.logger.info('Meta Channel: closeClient chamado (mudando estado para close).');
    this.stateConnection = { connection: 'close', lastDisconnect: undefined };
    // Informar outros serviços/webhooks sobre a desconexão, se necessário
     await this.sendDataWebhook(Events.STATUS_INSTANCE, {
        instance: this.instanceName, status: 'closed',
      });
  }

  public async logoutInstance(): Promise<void> {
    this.logger.info('Meta Channel: logoutInstance chamado.');
    await this.closeClient();
    // Adicionar lógica para invalidar/remover token se aplicável
  }

  // Método para fazer chamadas à API da Meta
  private async post(message: any, endpoint: string = 'messages'): Promise<any> {
    try {
      // CORREÇÃO TS2305: Usar WaBusinessConfig importado
      const waBusinessConfig = this.configService.get<WaBusinessConfig>('WA_BUSINESS');
      if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION) {
        throw new Error('Configuração da API de Negócios do WhatsApp (WA_BUSINESS URL/VERSION) não encontrada.');
      }

      const metaNumberId = this.numberId; // Usa a propriedade da classe
      const metaToken = this.token; // Usa a propriedade da classe

      if (!metaNumberId) throw new Error('ID do número de telefone (numberId) não definido para a instância.');
      if (!metaToken) throw new Error('Token da API (token) não definido para a instância.');

      const urlServer = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${metaNumberId}/${endpoint}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${metaToken}` };
      this.logger.debug({ url: urlServer, data: message }, `POST Request to Meta API`);
      const result = await axios.post(urlServer, message, { headers });
      this.logger.debug({ response: result.data }, `POST Response from Meta API`);
      return result.data;
    } catch (e: any) {
      const errorData = e?.response?.data?.error;
      this.logger.error({ err: errorData || e }, `Erro na chamada POST para Meta API (${endpoint})`);
      // Retorna um objeto de erro padronizado
      return { error: errorData || { message: e.message, code: e.code || 500 } };
    }
  }

  // Método para obter mídia da API da Meta
  private async getMedia(mediaId: string): Promise<{ buffer: Buffer; mimetype: string; fileName?: string }> {
    try {
       const waBusinessConfig = this.configService.get<WaBusinessConfig>('WA_BUSINESS');
       const metaToken = this.token;

       if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION || !metaToken) {
        throw new Error('Configuração ou Token da API de Negócios do WhatsApp (WA_BUSINESS) não encontrado.');
      }

      const urlInfo = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${mediaId}`;
      const headers = { Authorization: `Bearer ${metaToken}` };
      this.logger.debug(`GET ${urlInfo}`);
      const infoResult = await axios.get(urlInfo, { headers });
      const mediaUrl = infoResult.data.url;
      const mimetype = infoResult.data.mime_type;
      this.logger.debug(`Media URL: ${mediaUrl}, Mimetype: ${mimetype}`);

      if (!mediaUrl) throw new Error('URL da mídia não encontrada na resposta da API.');

      const mediaResult = await axios.get(mediaUrl, { headers, responseType: 'arraybuffer' });
      const buffer = Buffer.from(mediaResult.data);

      let fileName: string | undefined;
      const contentDisposition = mediaResult.headers['content-disposition'];
       if (contentDisposition) {
          const match = contentDisposition.match(/filename\*?=['"]?([^'";]+)['"]?/i);
          if (match && match[1]) {
              try {
                 fileName = decodeURIComponent(match[1].replace(/['"]+/g, '')); // Decodifica e remove aspas extras
              } catch (decodeError) {
                   this.logger.warn({ contentDisposition }, 'Falha ao decodificar filename do content-disposition');
                   // Fallback para usar a parte não decodificada se falhar
                   fileName = match[1].replace(/['"]+/g, '');
              }
          }
       }
       this.logger.debug({ fileName }, 'Nome do arquivo obtido do cabeçalho');

      return { buffer, mimetype, fileName };
    } catch (e: any) {
      const errorData = e?.response?.data?.error;
      this.logger.error({ err: errorData || e, mediaId }, `Erro ao baixar mídia da Meta API`);
      throw new InternalServerErrorException(`Falha ao baixar mídia: ${errorData?.message || e.message}`);
    }
  }

  // Este método é chamado pelo MetaController para processar webhooks
  public async connectToWhatsapp(webhookValue?: any): Promise<any> {
    this.logger.info({ webhookValue: !!webhookValue }, `Meta Channel: connectToWhatsapp/webhook recebido.`);
    if (!webhookValue || !webhookValue.object) {
       this.logger.warn('Webhook Meta recebido sem dados válidos (object). Carregando configurações iniciais.');
       await this.loadChatwoot();
       await this.loadSettings();
       // Meta API não tem estado de conexão persistente como Baileys, sempre "open" se configurada.
       this.stateConnection = { connection: 'open', lastDisconnect: undefined };
       return { status: 'Webhook Received (No Data)', state: this.stateConnection };
    }

    // Processa cada entrada no webhook
    if (webhookValue.entry && Array.isArray(webhookValue.entry)) {
      for (const entry of webhookValue.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === 'messages' && change.value) {
               await this.eventHandler(change.value); // Processa mensagens e status
            } else {
               this.logger.warn({ change }, `Tipo de mudança não tratada no webhook Meta`);
            }
          }
        }
      }
    }

    return { status: 'Webhook Processed', state: this.stateConnection };
  }

  // Processa o conteúdo do webhook ('value' object)
  protected async eventHandler(value: any): Promise<void> {
    this.logger.debug({ value }, `Meta Channel: eventHandler processando`);
    try {
      // Processa mensagens recebidas
      if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
          await this.messageHandle(message, value.contacts?.[0], value.metadata);
        }
      }
      // Processa atualizações de status
      else if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          await this.statusHandle(status, value.metadata);
        }
      } else {
         this.logger.warn({ value }, `Tipo de evento não tratado no webhook Meta`);
      }
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro em eventHandler (Meta)`);
    }
  }

  // Processa uma única mensagem do webhook
  private async messageHandle(message: any, contactInfo: any, metadata: any): Promise<void> {
     this.logger.debug({ messageId: message.id, type: message.type, from: message.from }, `Processando mensagem`);
     const fromMe = message.from === metadata?.phone_number_id; // Verifica se veio do nosso número
     // CORREÇÃO: `to` da Meta é o nosso número, `from` é o remetente
     const remoteJid = createJid(message.from);
     const participant = message.context?.participant ? createJid(message.context.participant) : undefined;

     // Ignora mensagens próprias para evitar loops (a menos que seja de outro device?)
     // A Meta API geralmente não envia webhooks para mensagens enviadas pela própria API.
     // if (fromMe) {
     //    this.logger.info(`Ignorando mensagem própria (Meta): ${message.id}`);
     //    return;
     // }

     // O `key` do Baileys não se aplica diretamente. Criamos um similar.
     const key = {
        id: message.id,
        remoteJid: remoteJid,
        fromMe: fromMe,
        participant: participant,
     };

     const pushName = contactInfo?.profile?.name || remoteJid.split('@')[0];

     let messageContent: any = {};
     let messageType: string = message.type ? `${message.type}Message` : 'unknownMessage'; // Normaliza tipo

     // Constrói o objeto 'message' similar ao Baileys
     if (message.text) {
        messageContent = { conversation: message.text.body };
        messageType = 'conversation';
     } else if (message.image) {
        messageContent = { imageMessage: { caption: message.image.caption, mimetype: message.image.mime_type, url: `media:${message.image.id}`, sha256: message.image.sha256 } };
     } else if (message.video) {
        messageContent = { videoMessage: { caption: message.video.caption, mimetype: message.video.mime_type, url: `media:${message.video.id}`, sha256: message.video.sha256 } };
     } else if (message.audio) {
        messageContent = { audioMessage: { mimetype: message.audio.mime_type, url: `media:${message.audio.id}`, sha256: message.audio.sha256 } };
     } else if (message.document) {
        messageContent = { documentMessage: { fileName: message.document.filename, mimetype: message.document.mime_type, url: `media:${message.document.id}`, sha256: message.document.sha256 } };
     } else if (message.contacts) {
         messageContent = { contactsArrayMessage: message.contacts }; // Mantém array original por enquanto
         messageType = 'contactsArrayMessage';
         this.logger.warn('Processamento de contactsArrayMessage precisa de revisão.');
     } else if (message.location) {
         messageContent = { locationMessage: message.location };
     } else if (message.sticker) {
         messageContent = { stickerMessage: { url: `media:${message.sticker.id}`, mimetype: message.sticker.mime_type, sha256: message.sticker.sha256 } };
     } else if (message.reaction) {
          // A key da reação é a da mensagem original
          messageContent = { reactionMessage: { key: { id: message.reaction.message_id }, text: message.reaction.emoji } };
          messageType = 'reactionMessage';
     } else if (message.interactive) {
        // Simplifica mensagens interativas para conversation por enquanto
        const interactiveData = message.interactive[message.interactive.type];
        messageContent = { conversation: interactiveData?.title || interactiveData?.description || `Resposta: ${message.interactive.type}` };
        messageContent.contextInfo = { interactiveResponseMessage: message.interactive }; // Guarda dados originais no context
        messageType = 'conversation'; // Tratar como texto simples
     } else if (message.button) { // Resposta a botão simples (legado?)
        messageContent = { conversation: message.button.text };
        messageType = 'conversation';
     } else if (message.system) {
        this.logger.info({ system: message.system }, `Mensagem de sistema recebida`);
        // Pode ser útil processar system messages para mudanças de número, etc.
        await this.sendDataWebhook(Events.SYSTEM_MESSAGE, { instance: this.instanceName, system: message.system });
        return; // Não processa como mensagem normal
     } else if (message.errors) {
         this.logger.error({ errors: message.errors }, `Erro reportado no webhook da Meta para mensagem ${message.id}`);
         // TODO: Tratar erro? Notificar?
         return;
     } else {
        this.logger.warn({ messageType: message.type, messageId: message.id }, `Tipo de mensagem Meta não tratado`);
        messageContent = { conversation: `[Mensagem do tipo ${message.type} não suportada]` };
        messageType = 'unsupportedMessage';
     }

     // Adicionar ContextInfo (mensagem respondida)
     if (message.context) {
        messageContent.contextInfo = {
           ...(messageContent.contextInfo || {}), // Mantém contextInfo existente (ex: interactive)
           quotedMessage: { key: { id: message.context.id } }, // Guarda ID da msg original
           // A Meta não fornece o conteúdo da msg respondida, apenas o ID.
           // participant: message.context.from ? createJid(message.context.from) : undefined, // 'from' no context é quem mandou a original
           stanzaId: message.id, // ID da mensagem atual
           mentionedJid: message.context.mentioned_jid?.map(createJid), // Mapeia menções se houver
        };
     }

     // Construir o objeto WAMessage final
     const messageRaw: wa.WAMessage = { // Usar tipo WAMessage se definido
       key,
       pushName,
       message: messageContent,
       messageType: messageType,
       messageTimestamp: parseInt(message.timestamp) || Math.round(Date.now() / 1000),
       source: 'meta_api',
       instanceId: this.instanceId,
       // Adicionar participant se for mensagem de grupo (a Meta API não fornece info de grupo diretamente na msg)
       // participant: key.participant,
     };

     // Download e Upload de Mídia para S3
     const mediaKey = Object.keys(messageContent).find(k => k.toLowerCase().includes('message') && messageContent[k]?.url?.startsWith('media:'));
     if (mediaKey) {
        const mediaMsg = messageContent[mediaKey];
        const mediaId = mediaMsg.url.split(':')[1];
        // CORREÇÃO TS2305: Usar S3Config importado
        if (this.configService.get<S3Config>('S3')?.ENABLE) {
           try {
              this.logger.info(`Baixando mídia da Meta API: ${mediaId}`);
              const { buffer, mimetype, fileName } = await this.getMedia(mediaId);
              mediaMsg.mimetype = mimetype; // Atualiza mimetype correto
              const mediaTypeS3 = messageType.replace('Message', '').toLowerCase();
              const fileNameS3 = fileName || `${message.id}.${mimeTypes.extension(mimetype) || 'bin'}`;
              // CORREÇÃO TS2304: Usar join importado
              const fullNameS3 = join(this.instanceId, key.remoteJid, mediaTypeS3, fileNameS3);
              const size = buffer.byteLength;

              this.logger.info(`Fazendo upload para S3: ${fullNameS3}`);
              await s3Service.uploadFile(fullNameS3, buffer, size, { 'Content-Type': mimetype });
              const mediaUrl = await s3Service.getObjectUrl(fullNameS3);
              mediaMsg.url = mediaUrl; // Substitui 'media:id' pela URL S3
              // Adiciona filename ao payload se não existir (ex: audio, sticker)
              if (!mediaMsg.fileName && fileNameS3) mediaMsg.fileName = fileNameS3;
              this.logger.info(`Upload S3 concluído: ${mediaUrl}`);

           } catch (error: any) {
             this.logger.error({ err: error, mediaId }, `Falha no download/upload de mídia`);
             mediaMsg.url = `[Erro ao processar mídia ${mediaId}]`; // Indica erro
           }
        } else {
           this.logger.warn(`S3 desativado. Mídia não será baixada/armazenada externamente: ${mediaId}. URL permanecerá como 'media:${mediaId}'`);
        }
     }

     // Lógica OpenAI (mantida - requer adaptação para URL S3/Buffer)
     // CORREÇÃO TS2305: Usar OpenaiConfig importado
     if (this.configService.get<OpenaiConfig>('OPENAI')?.ENABLED && messageType === 'audioMessage' && mediaMsg?.url && !mediaMsg.url.startsWith('media:')) {
        this.logger.info('Processando áudio com OpenAI...');
       // ... (Lógica OpenAI precisa usar a URL S3 ou o buffer baixado) ...
     }

     this.logger.log({ messageRaw }, 'Mensagem processada (Meta)');

     // Enviar para Webhook geral
     await this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

     // Enviar para Chatbot Controller
     await chatbotController?.emit?.({
        instance: { instanceName: this.instanceName, instanceId: this.instanceId },
        remoteJid: key.remoteJid,
        msg: messageRaw,
        pushName: pushName,
     });

     // Enviar para Chatwoot (usando chatwootService herdado/injetado)
     // CORREÇÃO TS2305 / TS2339: Usar ChatwootConfig e chatwootService
     if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        this.logger.info(`Enviando mensagem ${message.id} para Chatwoot...`);
         // CORREÇÃO TS2339: Usar método eventWhatsapp (precisa existir em ChatwootService)
         const chatwootSentMessage = await this.chatwootService?.eventWhatsapp?.(
            Events.MESSAGES_UPSERT,
            { instanceName: this.instanceName, instanceId: this.instanceId },
            messageRaw,
         );
         // Atualizar IDs do Chatwoot se retornados
         if (chatwootSentMessage?.id) {
             // Adiciona IDs ao objeto messageRaw para salvar no banco
             messageRaw.chatwootMessageId = `${chatwootSentMessage.id}`;
             messageRaw.chatwootInboxId = `${chatwootSentMessage.inbox_id}`;
             messageRaw.chatwootConversationId = `${chatwootSentMessage.conversation_id}`;
         }
     }

     // Salvar no Banco de Dados
     try {
        // CORREÇÃO TS2341: Usar método do repositório
        await this.prismaRepository.createMessage({
            data: {
                ...messageRaw,
                key: key as any, // Cast se necessário
                message: messageRaw.message as any, // Cast se necessário
                messageTimestamp: BigInt(messageRaw.messageTimestamp),
                // Certifique-se que todos os campos do schema Message estão aqui
            },
        });
     } catch (dbError: any) {
        this.logger.error({ err: dbError, messageId: message.id }, `Erro ao salvar mensagem no banco`);
     }

     // Atualizar contato (se não for mensagem própria)
     if (!fromMe) {
        await this.updateContact({ remoteJid: key.remoteJid, pushName: pushName });
     }
  }


  private async updateContact(data: { remoteJid: string; pushName?: string; profilePicUrl?: string }): Promise<void> {
    this.logger.info({ contact: data }, `Atualizando contato (Meta)`);
    const contactRaw: Partial<wa.ContactPayload> = { // Usar Partial<ContactPayload>
      remoteJid: data.remoteJid, // Já formatado
      pushName: data.pushName || data.remoteJid.split('@')[0],
      instanceId: this.instanceId,
      profilePicUrl: data?.profilePicUrl,
    };

    try {
        // CORREÇÃO TS2341: Usar método do repositório
        await this.prismaRepository.upsertContact({
           where: { remoteJid_instanceId: { remoteJid: data.remoteJid, instanceId: this.instanceId } },
           // Passar apenas os dados relevantes para update/create
           update: { pushName: contactRaw.pushName, profilePicUrl: contactRaw.profilePicUrl },
           create: { remoteJid: contactRaw.remoteJid!, instanceId: contactRaw.instanceId!, pushName: contactRaw.pushName, profilePicUrl: contactRaw.profilePicUrl },
        });
    } catch (dbError: any) {
         this.logger.error({ err: dbError, contactJid: data.remoteJid }, `Erro ao salvar contato no banco`);
         return; // Aborta se falhar no DB
    }

    await this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw); // Envia upsert

    // Chatwoot
    // CORREÇÃO TS2305 / TS2339: Usar ChatwootConfig e chatwootService
    if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger.info(`Enviando atualização de contato (Meta) para Chatwoot: ${data.remoteJid}`);
       // CORREÇÃO TS2339: Usar método eventWhatsapp (precisa existir em ChatwootService)
      await this.chatwootService?.eventWhatsapp?.(
        Events.CONTACTS_UPDATE,
        { instanceName: this.instanceName, instanceId: this.instanceId, /* integration: this.instance.integration */ }, // Integration pode não estar disponível
        contactRaw,
      );
    }
  }


  // Processa um evento de status do webhook
  private async statusHandle(statusInfo: any, metadata: any): Promise<void> {
    this.logger.debug({ statusInfo }, `Processando status`);
    const key = {
      id: statusInfo.id,
      remoteJid: createJid(statusInfo.recipient_id),
      fromMe: true, // Status são sempre de mensagens enviadas
    };

    // Ignorar status de status broadcast ou JIDs com server/device
    if (key.remoteJid === 'status@broadcast' || key?.remoteJid?.includes(':')) {
        this.logger.trace(`Ignorando atualização de status para ${key.remoteJid}`);
        return;
    }

    // CORREÇÃO TS2341: Usar método do repositório
    const findMessage = await this.prismaRepository.findFirstMessage({
      where: { instanceId: this.instanceId, keyId: key.id }, // Buscar por keyId
      select: { id: true, status: true } // Selecionar apenas campos necessários
    });

    if (!findMessage) {
       this.logger.warn({ messageId: key.id }, `Mensagem original não encontrada para atualização de status.`);
       return;
    }

    // Mapear status da Meta para status do Baileys/App se necessário
    // Ex: delivered -> DELIVERED, read -> READ, sent -> SERVER_ACK, failed -> FAILED?
    const normalizedStatus = statusInfo.status.toUpperCase(); // Ex: DELIVERED, READ, SENT

    // Evita atualizar para status anterior (ex: de READ para DELIVERED)
    const statusOrder: { [key: string]: number } = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 0 };
    const currentStatusOrder = statusOrder[findMessage.status] ?? -1;
    const newStatusOrder = statusOrder[normalizedStatus] ?? -1;

    if (newStatusOrder <= currentStatusOrder && normalizedStatus !== 'FAILED') {
        this.logger.debug(`Ignorando atualização de status ${normalizedStatus} para msg ${key.id} (status atual: ${findMessage.status})`);
        return;
    }

    const messageUpdate: Partial<wa.MessageUpdate> = { // Usar tipo MessageUpdate se definido
      messageId: findMessage.id, // ID interno da mensagem no DB
      keyId: key.id, // ID da mensagem do WhatsApp
      remoteJid: key.remoteJid,
      fromMe: key.fromMe,
      participant: key.remoteJid, // Para status, participant é o destinatário
      status: normalizedStatus,
      timestamp: parseInt(statusInfo.timestamp) || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
    };

     this.logger.log({ update: messageUpdate }, `Atualização de status processada`);
     await this.sendDataWebhook(Events.MESSAGES_UPDATE, messageUpdate);

     // Salvar atualização no banco
     try {
       // CORREÇÃO TS2551: Usar getter messageUpdate do repo
       await this.prismaRepository.messageUpdate.create({ data: messageUpdate as any });

       // CORREÇÃO TS2341: Usar método do repositório
        await this.prismaRepository.updateMessage({
            where: { id: findMessage.id },
            data: { status: messageUpdate.status }
        });

     } catch (dbError: any) {
        this.logger.error({ err: dbError, messageId: key.id }, `Erro ao salvar status no banco`);
     }

     // Enviar para Chatwoot (se necessário)
     // CORREÇÃO TS2305 / TS2339: Usar ChatwootConfig e chatwootService
     if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        // TODO: Mapear e enviar atualização de status para Chatwoot se a integração suportar
        this.logger.debug(`Enviando atualização de status ${key.id} para Chatwoot...`);
     }
  }


  // --- Métodos de Envio de Mensagem (Corrigidos) ---

  public async textMessage(data: SendTextDto, isIntegration = false): Promise<any> {
    const jid = createJid(data.number);
    const message = {
      messaging_product: 'whatsapp', to: jid, type: 'text',
      text: {
        // CORREÇÃO TS2339: Acessar options com segurança
        preview_url: data.options?.linkPreview ?? false,
        body: data.text,
      },
      // CORREÇÃO TS2339: Acessar options e quoted com segurança
      ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
    };
    this.logger.info({ to: jid }, `Enviando mensagem de texto`);
    const result = await this.post(message);
    if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
    // TODO: Salvar mensagem enviada
    return result;
  }


  private async uploadMediaForMeta(media: Buffer | Readable | string, mimetype: string): Promise<string | null> {
      // Implementação corrigida anteriormente...
      try {
        const waBusinessConfig = this.configService.get<WaBusinessConfig>('WA_BUSINESS');
        const metaNumberId = this.numberId;
        const metaToken = this.token;

        if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION || !metaNumberId || !metaToken) {
          throw new Error('Configuração incompleta para upload de mídia da Meta.');
        }

        const urlUpload = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${metaNumberId}/media`;
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('type', mimetype);

        let filename = `upload.${mimeTypes.extension(mimetype) || 'bin'}`;
        if (typeof media === 'string' && !isURL(media) && !isBase64(media)) {
            filename = path.basename(media);
        }

        if (Buffer.isBuffer(media)) {
            formData.append('file', media, { filename });
        } else if (media instanceof Readable) {
            formData.append('file', media, { filename });
        } else if (typeof media === 'string' && !isURL(media) && !isBase64(media)) {
            formData.append('file', createReadStream(media), { filename });
        } else if (typeof media === 'string' && isBase64(media)) {
            formData.append('file', Buffer.from(media, 'base64'), { filename });
        } else if (typeof media === 'string' && isURL(media)) {
             this.logger.warn('Upload de mídia via URL para Meta API não é suportado diretamente. Baixe primeiro.');
             // TODO: Implementar download da URL para buffer antes de enviar
             throw new BadRequestException('Upload de mídia via URL externa não implementado para Meta API.');
        } else {
             throw new Error('Formato de mídia inválido para upload.');
        }

        const headers = { ...formData.getHeaders(), Authorization: `Bearer ${metaToken}` };
        this.logger.debug({ url: urlUpload }, `POST (uploading media)`);
        const response = await axios.post(urlUpload, formData, { headers });
        this.logger.debug({ response: response.data }, `Media Upload Response`);
        return response.data?.id || null;

      } catch(e: any) {
        const errorData = e?.response?.data?.error;
        this.logger.error({ err: errorData || e }, `Erro no upload de mídia para Meta API`);
        throw new InternalServerErrorException(`Falha no upload da mídia: ${errorData?.message || e.message}`);
      }
  }


  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false): Promise<any> {
    const jid = createJid(data.number);
    let mediaContent = data.media;
    let mediaBuffer: Buffer | Readable | undefined;
    let isLocalFile = false;

    if (file?.buffer) {
        mediaBuffer = file.buffer;
        data.fileName = file.originalname || data.fileName;
        data.mediatype = mimeTypes.extension(file.mimetype) as any || data.mediatype;
    } else if (typeof mediaContent === 'string' && isBase64(mediaContent)) {
        mediaBuffer = Buffer.from(mediaContent, 'base64');
    } else if (typeof mediaContent === 'string' && isURL(mediaContent)) {
        // Manter como URL - Meta API pode buscar a URL
    } else if(typeof mediaContent === 'string' && !isURL(mediaContent) && !isBase64(mediaContent)){
         this.logger.warn('Enviando mídia por path local. Garanta que o arquivo exista no servidor da API.');
         mediaBuffer = createReadStream(mediaContent); // Usar stream
         isLocalFile = true;
         data.fileName = data.fileName || path.basename(mediaContent);
    } else {
        throw new BadRequestException('Formato de mídia inválido. Forneça URL, Base64, path de arquivo ou buffer.');
    }

    const message: any = {
      messaging_product: 'whatsapp', to: jid, type: data.mediatype,
      // CORREÇÃO TS2339: Acessar options e quoted com segurança
      ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
    };

    const mediaPayload: any = { caption: data.caption };

    // Se for URL, passa o link. Senão, faz upload e passa o ID.
    if (typeof mediaContent === 'string' && isURL(mediaContent) && !mediaBuffer) {
        mediaPayload.link = mediaContent;
         if(data.fileName && data.mediatype === 'document') mediaPayload.filename = data.fileName; // Filename só para documentos com link? Verificar API Meta.
    } else {
        const fileToUpload = mediaBuffer || (isLocalFile ? createReadStream(mediaContent) : null);
        if(!fileToUpload) throw new BadRequestException('Mídia inválida para upload.');

        const mimeType = mimeTypes.lookup(data.fileName || '') || 'application/octet-stream';
        const mediaId = await this.uploadMediaForMeta(fileToUpload, mimeType);
        if (!mediaId) throw new InternalServerErrorException('Falha ao obter ID da mídia da Meta.');
        mediaPayload.id = mediaId; // Usa ID do upload
         if(data.mediatype === 'document' && data.fileName) mediaPayload.filename = data.fileName;
    }

    message[data.mediatype] = mediaPayload;

    this.logger.info({ to: jid, type: data.mediatype }, `Enviando mensagem de mídia`);
    const result = await this.post(message);

    if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
    // TODO: Salvar mensagem enviada
    return result;
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false): Promise<any> {
      const mimeType = file?.mimetype || mimeTypes.lookup(data.audio || '') || 'audio/ogg';
      const mediaDto: SendMediaDto = {
          number: data.number,
          mediatype: 'audio',
          media: file?.buffer || data.audio,
          fileName: file?.originalname || `audio.${mimeTypes.extension(mimeType) || 'ogg'}`,
          // Passa as opções originais do SendAudioDto
          options: data.options
      };
      // PTT não é suportado diretamente pela API oficial, será enviado como audio normal
      if (data.ptt) {
          this.logger.warn('Opção PTT (Push-to-Talk) ignorada para Meta API.');
      }
      return this.mediaMessage(mediaDto, file, isIntegration);
  }

   public async buttonMessage(data: SendButtonsDto, isIntegration = false): Promise<any> {
      const jid = createJid(data.number);
      // Limitar botões a 3 (limite da Meta API)
      if (data.buttons.length > 3) {
          this.logger.warn(`Número de botões excede o limite de 3 da Meta API. Usando apenas os 3 primeiros.`);
          data.buttons = data.buttons.slice(0, 3);
      }
      // Limitar tamanho do texto dos botões (20 chars)
      data.buttons.forEach(btn => {
          if (btn.displayText && btn.displayText.length > 20) {
              this.logger.warn(`Texto do botão "${btn.displayText}" excede 20 caracteres. Será truncado pela Meta API.`);
          }
      });


      const message = {
          messaging_product: 'whatsapp', to: jid, type: 'interactive',
          interactive: {
              type: 'button',
              header: data.title ? { type: 'text', text: data.title.substring(0, 60) } : undefined, // Limite header
              body: { text: data.description || ' ' },
              footer: data.footer ? { text: data.footer.substring(0, 60) } : undefined, // Limite footer
              action: {
                  buttons: data.buttons.map((btn: Button) => ({
                      type: 'reply',
                      reply: { id: btn.id.substring(0, 256), title: (btn.displayText || 'Button').substring(0, 20) } // Limites ID e title
                  }))
              }
          },
          // CORREÇÃO TS2339: Acessar options e quoted com segurança
          ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
      };

      this.logger.info({ to: jid }, `Enviando mensagem interativa (botões)`);
      const result = await this.post(message);

      if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
      // TODO: Salvar mensagem enviada
      return result;
   }

   public async listMessage(data: SendListDto, isIntegration = false): Promise<any> {
       const jid = createJid(data.number);
       // Validações da Meta API para listas
       if (data.sections.length === 0) throw new BadRequestException('Listas devem ter pelo menos uma seção.');
       if (data.sections.length > 10) this.logger.warn('Número de seções excede o limite de 10 da Meta API.');
       data.sections.forEach(sec => {
           if (!sec.title) throw new BadRequestException('Cada seção da lista deve ter um título.');
           if (sec.rows.length === 0) throw new BadRequestException(`Seção "${sec.title}" não pode ter linhas vazias.`);
           if (sec.rows.length > 10) this.logger.warn(`Número de linhas na seção "${sec.title}" excede o limite de 10 da Meta API.`);
           sec.rows.forEach(row => {
               if (!row.title) throw new BadRequestException('Cada linha da lista deve ter um título.');
               if (row.title.length > 24) this.logger.warn(`Título da linha "${row.title}" excede 24 caracteres.`);
               if (row.description && row.description.length > 72) this.logger.warn(`Descrição da linha "${row.title}" excede 72 caracteres.`);
           });
       });
       if (!data.buttonText || data.buttonText.length > 20) throw new BadRequestException('Texto do botão da lista é obrigatório e deve ter no máximo 20 caracteres.');

       const message = {
           messaging_product: 'whatsapp', to: jid, type: 'interactive',
           interactive: {
               type: 'list',
               header: data.title ? { type: 'text', text: data.title.substring(0, 60) } : undefined,
               body: { text: data.description || ' ' },
               footer: data.footerText ? { text: data.footerText.substring(0, 60) } : undefined,
               action: {
                   button: data.buttonText.substring(0, 20),
                   sections: data.sections.slice(0, 10).map(section => ({ // Limita seções
                       title: section.title.substring(0, 24), // Limita título da seção
                       rows: section.rows.slice(0, 10).map(row => ({ // Limita linhas
                           id: row.rowId.substring(0, 200), // Limita ID da linha
                           title: row.title.substring(0, 24), // Limita título da linha
                           description: row.description?.substring(0, 72) // Limita descrição
                       }))
                   }))
               }
           },
           // CORREÇÃO TS2339: Acessar options e quoted com segurança
           ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
       };

       this.logger.info({ to: jid }, `Enviando mensagem interativa (lista)`);
       const result = await this.post(message);

       if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
       // TODO: Salvar mensagem enviada
       return result;
   }

    public async locationMessage(data: SendLocationDto, isIntegration = false): Promise<any> {
        const jid = createJid(data.number);
        const message = {
            messaging_product: 'whatsapp', to: jid, type: 'location',
            location: {
                latitude: data.latitude, longitude: data.longitude,
                name: data.name, address: data.address
            },
            // CORREÇÃO TS2339: Acessar options e quoted com segurança
            ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
        };
        this.logger.info({ to: jid }, `Enviando mensagem de localização`);
        const result = await this.post(message);
        if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
        // TODO: Salvar mensagem enviada
        return result;
    }

    public async contactMessage(data: SendContactDto, isIntegration = false): Promise<any> {
         const jid = createJid(data.number);
         // CORREÇÃO TS2339: Usar data.contacts (plural) conforme DTO? Verificar definição DTO. Assumindo 'contacts'.
         if (!data.contacts || data.contacts.length === 0) {
             throw new BadRequestException('Nenhum contato fornecido para envio.');
         }
         // A API da Meta suporta múltiplos contatos
         const contactsToSend = data.contacts.map(contact => {
             if (!contact.fullName || !contact.wuid) {
                 throw new BadRequestException('Nome completo (fullName) e WUID do contato são obrigatórios.');
             }
             return {
                 name: { formatted_name: contact.fullName },
                 // Meta espera apenas o número, sem @s.whatsapp.net no 'phone' e 'wa_id'
                 phones: [{ phone: contact.wuid.split('@')[0], type: 'CELL', wa_id: contact.wuid.split('@')[0] }]
                 // TODO: Mapear organization, emails, urls se a API e o DTO suportarem
             };
         });

         const message = {
             messaging_product: 'whatsapp', to: jid, type: 'contacts',
             contacts: contactsToSend,
             // CORREÇÃO TS2339: Acessar options e quoted com segurança
             ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
         };
         this.logger.info({ to: jid, count: contactsToSend.length }, `Enviando mensagem de contato(s)`);
         const result = await this.post(message);
         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         // TODO: Salvar mensagem enviada
         return result;
    }

    public async reactionMessage(data: SendReactionDto, isIntegration = false): Promise<any> {
        const jid = createJid(data.key.remoteJid!); // Adicionar '!' se tiver certeza que existe
        const message = {
            messaging_product: 'whatsapp', to: jid, type: 'reaction',
            reaction: {
                message_id: data.key.id,
                emoji: data.reaction // Envia o emoji diretamente (ou string vazia para remover)
            }
        };
        this.logger.info({ to: jid, msgId: data.key.id, reaction: data.reaction || '(remover)' }, `Enviando reação`);
        const result = await this.post(message);
         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         // TODO: Salvar reação enviada
         return result;
    }

     public async templateMessage(data: SendTemplateDto, isIntegration = false): Promise<any> {
         const jid = createJid(data.number);
         const message: any = {
             messaging_product: 'whatsapp', to: jid, type: 'template',
             template: {
                 name: data.name,
                 language: { code: data.language },
                 components: data.components // Assume que data.components está no formato correto da Meta API
             }
         };
         this.logger.info({ to: jid, template: data.name }, `Enviando mensagem de template`);
         const result = await this.post(message);
         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         // TODO: Salvar mensagem enviada
         return result;
     }

  // --- Métodos Não Suportados ou Específicos de Baileys ---
  public async getBase64FromMediaMessage(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta. Use getMedia.'); }
  public async deleteMessage(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async mediaSticker(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }
  public async pollMessage(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }
  public async statusMessage(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }
  public async reloadConnection(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }
  public async whatsappNumber(data: NumberBusiness): Promise<any> {
      // CORREÇÃO TS2339: Usar data.numbers e createJid
      const jids = data.numbers.map(createJid);
      // A API da Meta não tem um endpoint direto "onWhatsApp". Poderia tentar enviar uma msg template ou verificar via DB/Cache.
      this.logger.warn('Verificação onWhatsApp não implementada para Meta API.');
      return { numbers: jids.map(jid => ({ exists: false, jid: jid })) }; // Retorna placeholder
  }
  public async markMessageAsRead(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async archiveChat(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async markChatUnread(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async fetchProfile(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async offerCall(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }
  public async sendPresence(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async setPresence(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async fetchPrivacySettings(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updatePrivacySettings(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async fetchBusinessProfile(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateProfileName(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateProfileStatus(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateProfilePicture(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async removeProfilePicture(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async blockUser(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  // public async updateMessage(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); } // Já corrigido acima
  public async createGroup(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateGroupPicture(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateGroupSubject(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateGroupDescription(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async findGroup(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async fetchAllGroups(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async inviteCode(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async inviteInfo(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async sendInvite(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async acceptInviteCode(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async revokeInviteCode(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async findParticipants(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateGParticipant(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async updateGSetting(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async toggleEphemeral(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async leaveGroup(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async fetchLabels(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async handleLabel(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta.'); }
  public async receiveMobileCode(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }
  public async fakeCall(): Promise<never> { throw new BadRequestException('Método não disponível na API Meta'); }

} // Fim da classe BusinessStartupService
