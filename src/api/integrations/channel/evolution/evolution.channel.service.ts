// src/api/integrations/channel/evolution/evolution.channel.service.ts

// Imports de DTOs e Tipos (usando aliases @api)
import { InstanceDto } from '@api/dto/instance.dto';
import {
  MediaMessage,
  Options, // Certifique-se que Options está definido em sendMessage.dto.ts ou importado de outro lugar
  SendAudioDto,
  SendButtonsDto,
  SendMediaDto,
  SendTextDto,
  Button, // Adicionado para tipo em buttonMessage
} from '@api/dto/sendMessage.dto';
import { Events, wa } from '@api/types/wa.types'; // TODO: Precisa do arquivo wa.types.ts

// Imports de Serviços, Repositórios, Config (usando aliases)
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server'; // Verifique se este é o caminho correto
import { PrismaRepository } from '@api/repository/repository.service';
import { chatbotController } from '@api/server.module'; // TODO: Precisa do arquivo server.module.ts
import { CacheService } from '@api/services/cache.service'; // TODO: Precisa do arquivo cache.service.ts
import { ChannelStartupService } from '@api/services/channel.service'; // TODO: Precisa do arquivo channel.service.ts
import { Chatwoot, ConfigService, Openai, S3, Database } from '@config/env.config'; // TODO: Precisa do arquivo env.config.ts para estes tipos
import { BadRequestException, InternalServerErrorException } from '@exceptions'; // Usando alias
import { createJid } from '@utils/createJid'; // TODO: Precisa do arquivo createJid.ts

// Imports de libs externas
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import mimeTypes from 'mime-types';
import { join } from 'path';
import { v4 } from 'uuid';
import { delay } from '@whiskeysockets/baileys'; // << CORREÇÃO TS2304: Importado delay

// TODO: Verificar/Implementar classe base 'ChannelStartupService' para corrigir erros TS2415
export class EvolutionStartupService extends ChannelStartupService {
  // --- Propriedades ---
  // TODO: Definir/Inicializar corretamente estas propriedades (provavelmente herdadas ou no construtor)
  public client: any = null; // Tipo 'any' como placeholder
  public stateConnection: any = { state: 'open' }; // Usando 'any' no lugar de wa.StateConnection
  public phoneNumber: string = '';
  public mobile: boolean = false;
  protected instance: any = {}; // Tipo 'any' como placeholder
  // protected instanceId: string = ''; // REMOVIDO - Causa erro TS2610 (deve ser herdado ou gerenciado de outra forma via getter/setter ou no construtor da base)

  // TODO: Definir/Inicializar estas propriedades (herdadas ou injetadas?)
  protected logger: any = console; // Placeholder - Usar Logger real quando disponível
  protected openaiService: any; // Placeholder para OpenaiService
  protected chatwootService: any; // Placeholder para ChatwootService
  protected localChatwoot?: { enabled: boolean; importContacts?: boolean }; // Placeholder
  protected localSettings: any = {}; // Placeholder para configurações locais

  // << CORREÇÃO TS2416: Assinatura ajustada para corresponder à classe base >>
  // Removida a inicialização aqui, a implementação (ou chamada a super) deve ocorrer na classe.
  // Se esta classe não deve implementar, remova a declaração; se deve, implemente corretamente.
  // protected sendDataWebhook: (event: string, data: any, bypass?: boolean, onlyIntegration?: string[]) => void = () => {}; // Placeholder REMOVIDO
  // Sobrescrevendo o método da classe base (exemplo de placeholder)
  public async sendDataWebhook<T = any>(event: Events, data: T, local = true, integration?: string[]): Promise<void> {
    this.logger?.debug?.(`Evolution Channel: sendDataWebhook placeholder chamado para evento: ${event}`);
    // Chamar super.sendDataWebhook(...) se quiser usar a lógica da classe base
    // Ou implementar lógica específica aqui.
    await super.sendDataWebhook(event, data, local, integration); // Exemplo chamando a base
  }


  // TODO: O construtor deve receber CacheService e possivelmente outros via DI
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService, // Adicionado
    public readonly chatwootCache: CacheService, // Adicionado
  ) {
    // TODO: Verificar assinatura do construtor de ChannelStartupService (TS2415)
    // A chamada super() deve passar os argumentos esperados pela classe base.
    // A base ChannelStartupService espera (configService, eventEmitter, prismaRepository, chatwootCache)
    super(configService, eventEmitter, prismaRepository, chatwootCache);
    this.client = null; // Exemplo de inicialização placeholder
    // this.instanceId = ''; // InstanceId deve ser gerenciado pela classe base ou setInstance
  }

  // --- Getters ---
  public get connectionStatus(): any /* wa.StateConnection */ {
    return this.stateConnection;
  }

  public get qrCode(): any /* wa.QrCode */ {
    // Mantendo a lógica original, mas 'instance' precisa ser definido/tipado corretamente
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count,
    };
  }

  // --- Métodos Principais ---
  public async closeClient(): Promise<void> {
    this.logger?.info?.('Evolution Channel: closeClient chamado.');
    this.stateConnection = { state: 'close' };
    // TODO: Implementar lógica específica de fechamento para o canal "Evolution", se houver.
  }

  public async logoutInstance(): Promise<void> {
    this.logger?.info?.('Evolution Channel: logoutInstance chamado.');
    await this.closeClient();
    // TODO: Implementar lógica específica de logout para o canal "Evolution", se houver.
  }

  // TODO: Ajustar 'instanceData' para um tipo mais específico se possível
  public setInstance(instanceData: any): void {
    // Chama o método da classe base para consistência, se ele existir e fizer sentido
    super.setInstance(instanceData);

    this.logger?.setInstance?.(instanceData.instanceId); // Assumindo que logger tem setInstance

    // A classe base já deve definir this.instance.name, this.instanceId, etc.
    // Redefinir aqui pode ser redundante ou causar conflito.
    // this.instance.name = instanceData.instanceName;
    // this.instance.id = instanceData.instanceId;
    // this.instance.integration = instanceData.integration;
    // this.instance.number = instanceData.number;
    // this.instance.token = instanceData.token;
    // this.instance.businessId = instanceData.businessId;
    // this.instanceId = instanceData.instanceId; // Definindo instanceId aqui - CUIDADO, verificar classe base

    this.logger?.info?.(`Evolution Channel: Instância ${instanceData.instanceName} (${instanceData.instanceId}) definida.`);

    // Lógica Chatwoot mantida, mas depende de `localChatwoot` e `chatwootService`
    // (A classe base ChannelStartupService já tem chatwootService)
    if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger?.info?.(`Enviando status ${Events.STATUS_INSTANCE} para Chatwoot`);
      this.chatwootService?.eventWhatsapp?.(
        Events.STATUS_INSTANCE,
        {
          instanceName: this.instance.name,
          instanceId: this.instance.id,
          integration: instanceData.integration, // Usar integration daqui
        },
        {
          instance: this.instance.name,
          status: 'created',
        },
      );
    }
  }

  // Este método parece simular a conexão, mas lida com a chegada de eventos/webhooks
  public async connectToWhatsapp(data?: any): Promise<any> {
    this.logger?.info?.(`Evolution Channel: connectToWhatsapp chamado com dados: ${data ? 'Sim' : 'Não'}`);
    if (!data) {
      // this.loadChatwoot?.(); // Herdado da base
      await this.loadChatwoot(); // Carregar configurações ao inicializar
      await this.loadSettings(); // Carregar configurações ao inicializar
      this.logger?.info?.('Configurações Chatwoot e Settings carregadas.');
      return;
    }

    try {
      await this.eventHandler(data); // Processa o evento/webhook recebido
    } catch (error: any) {
      this.logger?.error?.(`Erro em connectToWhatsapp/eventHandler: ${error?.message || error}`);
    }
  }

  // --- Processamento de Eventos ---
  protected async eventHandler(received: any): Promise<void> {
    this.logger?.info?.(`Evolution Channel: eventHandler processando: ${JSON.stringify(received)}`);
    try {
      let messageRaw: any;

      if (received.message) {
        const key = {
          id: received.key?.id || v4(),
          remoteJid: received.key?.remoteJid,
          fromMe: received.key?.fromMe || false,
          participant: received.key?.participant,
        };

        if (!key.remoteJid) {
          this.logger?.warn?.('Mensagem recebida sem remoteJid no evento:', received);
          return;
        }

        messageRaw = {
          key,
          pushName: received.pushName || 'Unknown',
          message: received.message,
          messageType: received.messageType || 'conversation',
          messageTimestamp: received.messageTimestamp || Math.round(new Date().getTime() / 1000),
          source: 'evolution_channel',
          instanceId: this.instanceId, // Usando o getter da classe base ou a propriedade local
        };

        const isAudio = messageRaw.messageType === 'audioMessage';

        // Lógica OpenAI
        if (this.configService.get<Openai>('OPENAI')?.ENABLED && isAudio) {
          // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
          // << CORREÇÃO TS2353: Corrigido 'where' e 'include' (assumindo schema) >>
          // NOTE: Confirme o nome do campo `instance_id` e a relação `openaiCreds` no schema Prisma.
          const openAiDefaultSettings = await this.prismaRepository.findFirstOpenaiSetting({
            where: { instance_id: this.instanceId }, // Corrigido para nome de campo provável
            include: { openaiCreds: true }, // Mantido, verificar nome da relação
          });

          // << CORREÇÃO TS2339: Adicionado optional chaining (?) >>
          if (
            openAiDefaultSettings &&
            openAiDefaultSettings.openaiCredsId &&
            openAiDefaultSettings.speechToText &&
            messageRaw.message?.audioMessage
          ) {
             this.logger?.info?.('Tentando Speech-to-Text com OpenAI...');
            // NOTE: Verifica se openaiService e speechToText existem antes de chamar
            messageRaw.message.speechToText = await this.openaiService?.speechToText?.(
              openAiDefaultSettings.openaiCreds, // Passando a relação (pode precisar de ajuste)
              received,
              () => {}, // Função placeholder para updateMediaMessage
            );
          }
        }

        this.logger?.log?.('Mensagem processada:', messageRaw);

        // Envia para webhooks configurados (usando método da classe base)
        await this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

        // Emite evento para chatbots
        await chatbotController?.emit?.({
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
        });

        // Lógica Chatwoot
        if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
          this.logger?.info?.('Enviando mensagem para Chatwoot...');
          const chatwootSentMessage = await this.chatwootService?.eventWhatsapp?.(
            Events.MESSAGES_UPSERT,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            messageRaw,
          );
          if (chatwootSentMessage?.id) {
             this.logger?.info?.(`Mensagem salva no Chatwoot com ID: ${chatwootSentMessage.id}`);
            messageRaw.chatwootMessageId = `${chatwootSentMessage.id}`;
            messageRaw.chatwootInboxId = `${chatwootSentMessage.inbox_id}`;
            messageRaw.chatwootConversationId = `${chatwootSentMessage.conversation_id}`;
          }
        }

        // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
        // NOTE: Implemente `createMessage` em PrismaRepository.
        await this.prismaRepository.createMessage({
          data: {
            ...messageRaw,
            key: messageRaw.key as any,
            message: messageRaw.message as any,
            messageTimestamp: BigInt(messageRaw.messageTimestamp),
          },
        });

        // Atualiza contato
        await this.updateContact({
          remoteJid: messageRaw.key.remoteJid,
          pushName: messageRaw.pushName,
          profilePicUrl: received.profilePicUrl,
        });
      } else {
        this.logger?.warn?.('Evento recebido não contém uma estrutura de mensagem esperada:', received);
      }
    } catch (error: any) {
      this.logger?.error?.(`Erro em eventHandler: ${error?.message || error}`, error?.stack);
    }
  }

  // --- Atualização de Contato e Chat ---
  private async updateContact(
    data: { remoteJid: string; pushName?: string; profilePicUrl?: string }
  ): Promise<void> {
    this.logger?.info?.(`Atualizando contato: ${data.remoteJid} - Nome: ${data.pushName}`);
    const contactRaw: any = {
      remoteJid: data.remoteJid,
      pushName: data.pushName || data.remoteJid.split('@')[0],
      instanceId: this.instanceId,
      profilePicUrl: data?.profilePicUrl,
    };

    // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
    // << CORREÇÃO TS2353: 'where' corrigido (assumindo índice único 'remoteJid_instanceId' existe) >>
    // NOTE: Implemente `upsertContact` em PrismaRepository e verifique o unique constraint no schema.
    await this.prismaRepository.upsertContact({
       where: { remoteJid_instanceId: { remoteJid: data.remoteJid, instanceId: this.instanceId } },
       update: contactRaw,
       create: contactRaw,
    });

    // Usando método da classe base
    await this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw);

    // Lógica Chatwoot
    if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger?.info?.(`Enviando atualização de contato para Chatwoot: ${data.remoteJid}`);
      await this.chatwootService?.eventWhatsapp?.(
        Events.CONTACTS_UPDATE,
        {
          instanceName: this.instance.name,
          instanceId: this.instanceId,
          integration: this.instance.integration,
        },
        contactRaw,
      );
    }

    await this.upsertChat(data.remoteJid);
  }

  private async upsertChat(remoteJid: string): Promise<void> {
    const chatRaw: any = {
      remoteJid: remoteJid,
      instanceId: this.instanceId,
    };

    // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
    // << CORREÇÃO TS2353: 'where' corrigido (assumindo índice 'instanceId_remoteJid') >>
    // << CORREÇÃO TS2353: Removido 'updatedAt' explícito do 'update' >>
    // NOTE: Implemente `upsertChat` em PrismaRepository e verifique o unique constraint no schema.
    const chat = await this.prismaRepository.upsertChat({
        where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: remoteJid } },
        update: { /* Campos a atualizar se necessário, exceto updatedAt */ },
        create: chatRaw,
     });

     if (chat) {
       await this.sendDataWebhook(Events.CHATS_UPSERT, chatRaw); // Usando método da classe base
     }
  }

  // --- Envio de Mensagens ---
  protected async sendMessageWithTyping(
    number: string,
    messageContent: any,
    options?: Options, // << CORREÇÃO TS2339: Adicionado optional chaining ao usar options >>
    file?: any,
    isIntegration = false,
  ): Promise<any> {
    this.logger?.info?.(`Evolution Channel: Preparando sendMessageWithTyping para ${number}`);
    try {
      const messageId = v4();
      const remoteJid = createJid(number);
      let quoted: any = undefined;
      let messageType = 'conversation';

      // << CORREÇÃO TS2339: Adicionado optional chaining para options >>
      if (options?.quoted?.key) {
        quoted = options.quoted.key;
        messageContent.contextInfo = { ...(messageContent.contextInfo || {}), quotedMessage: options.quoted.message, stanzaId: options.quoted.key.id };
      }

      const messageRaw: any = {
        key: { fromMe: true, id: messageId, remoteJid },
        message: messageContent,
        messageType: 'unknown',
        messageTimestamp: Math.round(new Date().getTime() / 1000),
        webhookUrl: options?.webhookUrl, // << CORREÇÃO TS2339: Adicionado optional chaining >>
        source: 'evolution_channel',
        instanceId: this.instanceId,
        status: 'PENDING',
      };

      // Adapta a estrutura da mensagem com base no tipo (lógica mantida)
      // ... (lógica de definição de messageType e messageRaw.message mantida) ...
       if (messageContent.conversation) {
        messageType = 'conversation';
        messageRaw.message = { conversation: messageContent.conversation };
      } else if (messageContent.extendedTextMessage) {
         messageType = 'extendedTextMessage';
         messageRaw.message = { extendedTextMessage: messageContent.extendedTextMessage };
      } else if (messageContent.imageMessage || messageContent.mediaType === 'image') {
        messageType = 'imageMessage';
        messageRaw.message = { imageMessage: { caption: messageContent.caption, mimetype: messageContent.mimetype, ...messageContent.imageMessage } };
      } else if (messageContent.videoMessage || messageContent.mediaType === 'video') {
        messageType = 'videoMessage';
        messageRaw.message = { videoMessage: { caption: messageContent.caption, mimetype: messageContent.mimetype, ...messageContent.videoMessage } };
      } else if (messageContent.audioMessage || messageContent.mediaType === 'audio') {
        messageType = 'audioMessage';
        // << CORREÇÃO TS2339: Adicionado optional chaining ptt >>
        messageRaw.message = { audioMessage: { mimetype: messageContent.mimetype, ptt: messageContent.ptt ?? false, ...messageContent.audioMessage } };
      } else if (messageContent.documentMessage || messageContent.mediaType === 'document') {
        messageType = 'documentMessage';
        messageRaw.message = { documentMessage: { mimetype: messageContent.mimetype, fileName: messageContent.fileName, ...messageContent.documentMessage } };
      } else if (messageContent.buttonMessage) {
         messageType = 'buttonsMessage';
         messageRaw.message = { buttonsMessage: messageContent.buttonMessage };
      } else if (messageContent.listMessage) {
         messageType = 'listMessage';
         messageRaw.message = { listMessage: messageContent.listMessage };
      } else {
        this.logger?.warn?.(`Tipo de mensagem não explicitamente tratado em sendMessageWithTyping: ${JSON.stringify(messageContent)}. Tratando como 'conversation'.`);
        messageRaw.message = { conversation: JSON.stringify(messageContent) }; // Fallback
        messageType = 'conversation'; // Ajusta o tipo para o fallback
      }
      messageRaw.messageType = messageType;


      if (messageContent.contextInfo) {
        messageRaw.contextInfo = messageContent.contextInfo;
      }

      // Processamento de Mídia (lógica mantida)
      // ... (lógica de upload S3 mantida) ...
      const mediaContent = messageRaw.message[messageType];
      if (mediaContent && (file || isBase64(mediaContent.media) || isURL(mediaContent.media))) {
        if (this.configService.get<S3>('S3')?.ENABLE) {
          try {
            let buffer: Buffer | undefined = undefined;
            let originalFilename = file?.originalname || mediaContent.fileName || `${messageId}.${mimeTypes.extension(mediaContent.mimetype || 'bin') || 'bin'}`;
            let mimetype = file?.mimetype || mediaContent.mimetype || 'application/octet-stream';

            if (file?.buffer) {
              buffer = file.buffer;
            } else if (typeof mediaContent.media === 'string' && isBase64(mediaContent.media)) {
              buffer = Buffer.from(mediaContent.media, 'base64');
              delete mediaContent.media;
            } else if (typeof mediaContent.media === 'string' && isURL(mediaContent.media)) {
              // Download logic remains the same
              const response = await axios.get(mediaContent.media, { responseType: 'arraybuffer' });
              buffer = Buffer.from(response.data);
              mimetype = response.headers['content-type'] || mimetype;
              try { originalFilename = new URL(mediaContent.media).pathname.split('/').pop() || originalFilename; } catch { /* ignore */ }
              mediaContent.mediaUrl = mediaContent.media;
              delete mediaContent.media;
            }

            if (buffer) {
              const mediaTypeS3 = messageType.replace('Message', '').toLowerCase();
              const fileNameS3 = `${messageId}.${mimeTypes.extension(mimetype) || 'bin'}`;
              const fullNameS3 = join(`${this.instanceId}`, remoteJid, mediaTypeS3, fileNameS3);
              const size = buffer.byteLength;

              this.logger?.info?.(`Fazendo upload para S3: ${fullNameS3} (${mimetype})`);
              await s3Service.uploadFile(fullNameS3, buffer, size, { 'Content-Type': mimetype });
              const mediaUrl = await s3Service.getObjectUrl(fullNameS3);
              mediaContent.url = mediaUrl;
              mediaContent.mimetype = mimetype;
              mediaContent.fileName = originalFilename;
              this.logger?.info?.(`Upload S3 concluído: ${mediaUrl}`);
            }
          } catch (error: any) {
            this.logger?.error?.(`Erro no upload S3: ${error?.message}`, error?.stack);
          }
        } else if (typeof mediaContent.media === 'string' && isBase64(mediaContent.media)) {
             this.logger?.warn?.('S3 desativado, mídia em base64 não será salva externamente.');
             mediaContent.base64 = mediaContent.media;
             delete mediaContent.media;
        } else if (typeof mediaContent.media === 'string' && isURL(mediaContent.media)) {
            mediaContent.url = mediaContent.media;
            delete mediaContent.media;
        }
      }


      this.logger?.log?.('Mensagem preparada para envio (Evolution):', messageRaw);
      await this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw); // Usando método da classe base

      // TODO: Implementar a lógica REAL de envio para o "Evolution Channel" aqui.
      this.logger?.warn?.('Lógica de envio real para Evolution Channel não implementada!');
      await delay(options?.delay || 50); // << CORREÇÃO TS2339/TS2304: Adicionado optional chaining e delay importado >>
      messageRaw.status = 'SENT';
      messageRaw.key.fromMe = true;

      // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
      // NOTE: Implemente `createMessage` em PrismaRepository.
      await this.prismaRepository.createMessage({
        data: {
          ...messageRaw,
          key: messageRaw.key as any,
          message: messageRaw.message as any,
          messageTimestamp: BigInt(messageRaw.messageTimestamp),
        },
      });

      // Lógica Chatwoot
      if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled && !isIntegration) {
        this.logger?.info?.('Enviando mensagem enviada para Chatwoot...');
        this.chatwootService?.eventWhatsapp?.(
          Events.SEND_MESSAGE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );
      }

      // Emite evento para chatbot se for integração
      if (isIntegration) {
        await chatbotController?.emit?.({
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
        });
      }

      return messageRaw;
    } catch (error: any) {
      this.logger?.error?.(`Erro em sendMessageWithTyping: ${error?.message || error}`, error.stack);
      throw new BadRequestException(`Erro ao enviar mensagem: ${error.toString()}`);
    }
  }


  // --- Implementações dos Métodos de Envio ---

  public async textMessage(data: SendTextDto, isIntegration = false): Promise<any> {
    const content = {
      conversation: data.text,
    };
    // << CORREÇÃO TS2339: Acesso a data.options está correto pois sendMessageWithTyping aceita options >>
    return this.sendMessageWithTyping(data.number, content, data.options, null, isIntegration);
  }

  // NOTE: MediaMessage é um tipo local ou DTO? Certifique-se que a definição inclui 'ptt'.
  protected async prepareMediaMessage(mediaMessage: MediaMessage & { ptt?: boolean }): Promise<any> {
    this.logger?.info?.(`Preparando mídia: ${mediaMessage.mediatype}, ${mediaMessage.fileName || (typeof mediaMessage.media === 'string' ? mediaMessage.media.substring(0, 30) : 'Buffer/Data')}`);
    try {
      const mediaType = mediaMessage.mediatype;
      const messageStructure: any = {
          caption: mediaMessage?.caption,
          mimetype: mimeTypes.lookup(mediaMessage.fileName || (typeof mediaMessage.media === 'string' ? mediaMessage.media : '')) || 'application/octet-stream',
          fileName: mediaMessage.fileName,
          media: mediaMessage.media,
      };

       if (mediaType === 'document' && !messageStructure.fileName) {
           messageStructure.fileName = `documento.${mimeTypes.extension(messageStructure.mimetype) || 'bin'}`;
       } else if (mediaType === 'image' && !messageStructure.fileName) {
           messageStructure.fileName = `imagem.${mimeTypes.extension(messageStructure.mimetype) || 'jpg'}`;
       } else if (mediaType === 'video' && !messageStructure.fileName) {
           messageStructure.fileName = `video.${mimeTypes.extension(messageStructure.mimetype) || 'mp4'}`;
       } else if (mediaType === 'audio') {
            // << CORREÇÃO TS2339: Adicionado optional chaining e fallback para ptt >>
            messageStructure.ptt = mediaMessage.ptt ?? false;
            if (!messageStructure.fileName) {
              messageStructure.fileName = `audio.${mimeTypes.extension(messageStructure.mimetype) || 'ogg'}`;
            }
       }

      const finalMessage: any = { mediaType };
      finalMessage[`${mediaType}Message`] = messageStructure;

      return finalMessage;

    } catch (error: any) {
      this.logger?.error?.(`Erro ao preparar mídia: ${error?.message || error}`);
      throw new InternalServerErrorException(`Erro ao preparar mídia: ${error?.toString() || error}`);
    }
  }

  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false): Promise<any> {
    const mediaData: SendMediaDto = { ...data };
    if (file?.buffer) {
        mediaData.media = file.buffer.toString('base64');
        mediaData.fileName = file.originalname || mediaData.fileName;
    }
    const message = await this.prepareMediaMessage(mediaData);
    // << CORREÇÃO TS2339: Acesso a data.options está correto >>
    return this.sendMessageWithTyping(data.number, message, data.options, file, isIntegration);
  }

  public async processAudio(audio: string, number: string, file?: any): Promise<any> {
     this.logger?.warn?.('Processamento de áudio (conversão externa) não implementado/necessário para Evolution Channel por padrão.');
     const fileName = file?.originalname || `audio-${v4()}.mp3`;
     const mimetype = file?.mimetype || mimeTypes.lookup(fileName) || 'audio/mpeg';
     return {
         fileName,
         mediaType: 'audio',
         media: audio,
         mimetype,
         ptt: false,
     };
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false): Promise<any> {
    const mediaData: SendAudioDto = { ...data };
    let audioContent = data.audio;

    if (file?.buffer) {
      audioContent = file.buffer.toString('base64');
    } else if (!isURL(audioContent) && !isBase64(audioContent)) {
      throw new BadRequestException('Formato de áudio inválido. Forneça URL, Base64 ou um arquivo.');
    }

    const message = await this.processAudio(audioContent, data.number, file);
    // << CORREÇÃO TS2339: Acesso a data.ptt está correto (assumindo que existe em SendAudioDto) >>
    message.ptt = data.ptt ?? false;

    // << CORREÇÃO TS2339: Acesso a data.options está correto >>
    // Ajuste na estrutura da mensagem para separar audioMessage e ptt
    const messagePayload = { audioMessage: message };
    return this.sendMessageWithTyping(data.number, messagePayload, data.options, file, isIntegration);
  }

  public async buttonMessage(data: SendButtonsDto, isIntegration = false): Promise<any> {
    // NOTE: Verifique a definição do tipo Button importado. Assumindo que tem 'id' e 'label'.
    const messageContent = {
      buttonMessage: {
        contentText: data.description,
        footerText: data.footer,
        // << CORREÇÃO TS2339: Acesso a b.label está correto (assumindo que existe em Button) >>
        buttons: data.buttons.map((b: Button) => ({ buttonId: b.id, buttonText: { displayText: b.label }, type: 1 })),
        headerType: 1,
        text: data.title,
      },
    };
     this.logger?.warn?.('Estrutura de buttonMessage para Evolution Channel é hipotética. Verifique o formato correto.');
     // << CORREÇÃO TS2339: Acesso a data.options está correto >>
    return this.sendMessageWithTyping(data.number, messageContent, data.options, null, isIntegration);
  }

  // --- Métodos Não Suportados (Mantidos) ---
  // ... (todos os métodos que lançam "Method not available" mantidos) ...
  public async locationMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async listMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async templateMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async contactMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async reactionMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async getBase64FromMediaMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async deleteMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async mediaSticker(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async pollMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async statusMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async reloadConnection(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async whatsappNumber(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async markMessageAsRead(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async archiveChat(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async markChatUnread(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async fetchProfile(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async offerCall(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async sendPresence(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async setPresence(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async fetchPrivacySettings(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updatePrivacySettings(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async fetchBusinessProfile(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateProfileName(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateProfileStatus(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateProfilePicture(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async removeProfilePicture(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async blockUser(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateMessage(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async createGroup(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateGroupPicture(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateGroupSubject(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateGroupDescription(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async findGroup(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async fetchAllGroups(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async inviteCode(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async inviteInfo(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async sendInvite(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async acceptInviteCode(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async revokeInviteCode(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async findParticipants(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateGParticipant(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async updateGSetting(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async toggleEphemeral(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async leaveGroup(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async fetchLabels(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async handleLabel(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async receiveMobileCode(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }
  public async fakeCall(): Promise<never> { throw new BadRequestException('Method not available on Evolution Channel'); }

} // Fim da classe EvolutionStartupService
