// Arquivo: src/api/integrations/channel/meta/whatsapp.business.service.ts
// Correções Gemini: Imports, implementação de métodos abstratos, chamadas de logger, acesso a propriedades, tipos Prisma, etc.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs
import { InstanceDto } from '@api/dto/instance.dto';
// CORREÇÃO TS2339: Importar WhatsAppNumberDto para whatsappNumber
import { WhatsAppNumberDto, NumberBusiness } from '@api/dto/chat.dto';
// CORREÇÃO TS2305/TS2724: Remover Options, SendAudioDto, SendMediaUrlDto. Usar SendMessageOptions.
import {
  SendMessageOptions, // Usar SendMessageOptions em vez de Options
  SendButtonsDto, SendContactDto, SendListDto,
  SendLocationDto, SendMediaDto, SendReactionDto, SendTemplateDto,
  SendTextDto, Button
} from '@api/dto/sendMessage.dto';
import { Prisma } from '@prisma/client'; // Importar Prisma para tipos

// Imports de Serviços, Repositórios, Config
// Assumindo alias @integrations, @provider, @repository, @api, @config, @exceptions, @utils
import * as s3Service from '@integrations/storage/s3/libs/minio.server';
import { ProviderFiles } from '@provider/sessions'; // Não usado pela Meta, mas pode ser exigido pela base
import { PrismaRepository } from '@repository/repository.service';
import { chatbotController } from '@api/server.module'; // Verificar export
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar monitor.service
// CORREÇÃO TS2305: Tipos WAMessage, etc., não exportados. Usar 'any' ou tipos Baileys/Prisma onde aplicável.
import { Events } from '@api/types/wa.types';
// CORREÇÃO TS2305: Tipos de config não exportados individualmente. Usar tipos das propriedades da interface Env.
import { ConfigService, Env, S3 as S3Config, Openai as OpenaiConfig, Chatwoot as ChatwootConfig } from '@config/env.config'; // Importar Env e tipos de propriedades
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
import { createJid } from '@utils/createJid';

// Imports de libs externas
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { isURL, isBase64 } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import mimeTypes from 'mime-types';
import * as path from 'path';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Necessário para construtor da base
import { join } from 'path';

// Tipo StateConnection para Meta API
type MetaStateConnection = { status: 'OPEN' | 'CLOSE' | 'CONNECTING' | 'DISCONNECTED', reason?: string };

// CORREÇÃO TS2655: Implementar membros abstratos
export class BusinessStartupService extends ChannelStartupService {
  // --- Propriedades ---
  // Corrigido tipo para MetaStateConnection
  public stateConnection: MetaStateConnection = { status: 'CLOSE' };
  public mobile: boolean = false;
  protected token: string | undefined;
  protected numberId: string | undefined; // ID do número de telefone da Meta

  // CORREÇÃO TS2554: Construtor alinhado com ChannelStartupService
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cacheService: CacheService, // Cache geral
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
    chatwootService: ChatwootService, // Injetado pela base
    // Estes podem não ser usados pela Meta, mas são exigidos pelo construtor da base
    public readonly chatwootCache: CacheService, // Usar CacheService
    public readonly baileysCache: CacheService,  // Usar CacheService
    private readonly providerFiles: ProviderFiles, // Verificar necessidade
  ) {
    // Passa todas as dependências para o construtor da base
    super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, baseLogger, chatwootService);
    this.logger.setContext(BusinessStartupService.name); // Define contexto
    // Inicializar configurações Meta específicas
    this.loadSettings();
    this.loadWebhook();
    this.loadChatwoot();
    // Meta API geralmente está sempre 'OPEN' se configurada corretamente
    this.stateConnection = { status: 'OPEN' };
  }

  // --- Getters e Setters ---
  public setInstance(instanceData: InstanceDto & { token?: string; number?: string }): void {
      super.setInstance(instanceData); // Define instanceId, instanceName, etc.
      this.token = instanceData.token;
      this.numberId = instanceData.number; // Armazena o phone_number_id
      if (!this.token) { this.logger.warn(`Token não fornecido para a instância Meta ${this.instanceName}.`); }
      if (!this.numberId) { this.logger.warn(`ID do número (number) não fornecido para a instância Meta ${this.instanceName}.`); }
      this.logger.info(`Meta Channel: Token e Number ID definidos para ${this.instanceName}`);
      this.stateConnection = { status: 'OPEN' }; // Assume OPEN ao definir
  }

  public get connectionStatus(): MetaStateConnection { return this.stateConnection; }
  public get qrCode(): any { return { code: null, base64: null, count: 0, pairingCode: null }; } // Meta não usa QR Code

  // --- Implementação dos Métodos Abstratos ---

  public async connectToWhatsapp(data?: any): Promise<any> {
    this.logger.info(`Meta Channel: connectToWhatsapp chamado.`);
    if (!this.token || !this.numberId) {
        this.logger.error('Token ou Number ID não configurados para esta instância Meta.');
        this.stateConnection = { status: 'CLOSE', reason: 'Missing token or number ID' };
        throw new InternalServerErrorException('Token ou Number ID da Meta não configurados.');
    }
    if (data) {
      // Processa webhook/evento recebido
      this.logger.info('Processando dados recebidos (webhook)...');
      await this.eventHandler(data);
    } else {
      // Chamada inicial sem dados, apenas carrega configurações e define estado
      await this.loadSettings();
      await this.loadWebhook();
      await this.loadChatwoot();
      this.stateConnection = { status: 'OPEN' }; // Assume OPEN se configurado
      this.logger.info('Instância Meta configurada e pronta para receber webhooks.');
    }
  }

  public async logoutInstance(destroyClient = false): Promise<void> {
      this.logger.info(`Meta Channel: logoutInstance chamado (destroyClient: ${destroyClient}).`);
      this.stateConnection = { status: 'CLOSE', reason: 'Logout requested' };
      // Para Meta API, logout pode significar limpar o token localmente,
      // mas não há uma sessão para desconectar como no Baileys.
      // Se destroyClient for true, pode remover do monitor.
      if (destroyClient && this.instanceName) {
         await this.waMonitor.remove(this.instanceName);
      }
  }

  public getStatus(): MetaStateConnection {
      // A Meta API não tem um estado de conexão dinâmico como Baileys.
      // Se configurado, geralmente está 'OPEN' para receber webhooks.
      // Poderíamos adicionar uma verificação periódica de healthcheck na API da Meta se necessário.
      return this.connectionStatus;
  }

  // Implementação do método auxiliar de envio para a Meta Graph API
  protected async sendMessagePayload(recipientJid: string, payload: any): Promise<AxiosResponse<any>> {
    if (!this.token) throw new InternalServerErrorException('Token da API Meta não configurado.');
    if (!this.numberId) throw new InternalServerErrorException('ID do número de telefone da Meta não configurado.');

    const waBusinessConfig = this.configService.get<Env['WA_BUSINESS']>('WA_BUSINESS');
    const url = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${this.numberId}/messages`;
    const recipient = createJid(recipientJid).split('@')[0]; // Meta API usa apenas o número

    const config: AxiosRequestConfig = {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    };

    const body = {
      messaging_product: 'whatsapp',
      to: recipient,
      ...payload, // type: 'text', text: { body: '...' } OU type: 'template', template: { ... } etc.
    };

    this.logger.info(`Enviando para Meta API: ${url} -> ${recipient}`);
    this.logger.debug(`Payload Meta API: ${JSON.stringify(body)}`);

    try {
      const response = await axios.post(url, body, config);
      this.logger.info(`Resposta da Meta API: ${response.status}`);
      this.logger.debug(`Dados da resposta Meta API: ${JSON.stringify(response.data)}`);

      // Simular evento SEND_MESSAGE para webhooks locais/chatbots
      // O ID real virá do response.data.messages[0].id
      const messageId = response.data?.messages?.[0]?.id || v4();
      const messageRaw = {
          key: { fromMe: true, id: messageId, remoteJid: recipientJid },
          message: body, // Ou mapear de volta para um formato interno?
          messageTimestamp: Math.floor(Date.now() / 1000),
          messageType: body.type,
          status: 'SENT', // Ou 'DELIVERED'/'READ' baseado em webhooks futuros?
          instanceId: this.instanceId,
          source: 'meta_api'
      };
      this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);
      // Salvar no DB (opcional, mas recomendado)
      // await this.prismaRepository.createMessage(...)

      return response; // Retorna a resposta da API Meta
    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem via Meta API para ${recipient}: ${error.response?.status} ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      // Lançar exceção ou tratar o erro conforme necessário
      throw new InternalServerErrorException(`Erro Meta API (${error.response?.status}): ${error.response?.data?.error?.message || error.message}`);
    }
  }

  public async textMessage(data: SendTextDto, options?: SendMessageOptions): Promise<any> {
      const payload = {
          type: 'text',
          text: { body: data.text },
          // Adicionar context (reply) se presente em options
          ...(options?.quoted?.key?.id && {
              context: { message_id: options.quoted.key.id }
          })
      };
      return this.sendMessagePayload(data.number, payload);
  }

  public async mediaMessage(data: SendMediaDto | any, options?: SendMessageOptions): Promise<any> {
      // A Meta API envia mídia por ID (após upload) ou URL pública.
      // Upload não implementado aqui, assumindo URL pública ou ID pré-existente.
      const type = data.mediaType; // image, video, audio, document, sticker
      if (!type || !['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
          throw new BadRequestException(`Tipo de mídia inválido: ${type}`);
      }

      let mediaIdentifier: { link?: string, id?: string } = {};
      if (isURL(data.media)) {
          mediaIdentifier.link = data.media;
      } else {
          // Assumir que data.media é um ID se não for URL (requer upload prévio)
          mediaIdentifier.id = data.media;
      }

      if (!mediaIdentifier.link && !mediaIdentifier.id) {
           throw new BadRequestException(`Mídia inválida. Forneça 'link' (URL pública) ou 'id' (após upload)`);
      }

      const payload: any = { type };
      payload[type] = {
          ...mediaIdentifier,
          ...(type !== 'audio' && type !== 'sticker' && data.caption && { caption: data.caption }),
          ...(type === 'document' && data.fileName && { filename: data.fileName }),
      };

       // Adicionar context (reply)
       if (options?.quoted?.key?.id) {
           payload.context = { message_id: options.quoted.key.id };
       }

      return this.sendMessagePayload(data.number, payload);
  }

  public async buttonMessage(data: SendButtonsDto | SendListDto, options?: SendMessageOptions): Promise<any> {
      // A Meta API usa Mensagens Interativas (interactive messages) para botões e listas
      this.logger.warn("Envio de botões/listas via Meta API requer formatação 'interactive'. Implementação pendente.");
      // TODO: Implementar a criação do payload 'interactive' correto para Meta API
      // Exemplo de estrutura (simplificada):
      // const payload = {
      //     type: 'interactive',
      //     interactive: {
      //         type: 'button', // ou 'list'
      //         header: { type: 'text', text: data.headerText }, // ou image/video/document
      //         body: { text: data.bodyText },
      //         footer: { text: data.footerText },
      //         action: { buttons: data.buttons.map(...) } // ou { button: '...', sections: [...] } para listas
      //     }
      // };
      // return this.sendMessagePayload(data.number, payload);
      throw new BadRequestException("Envio de botões/listas interativas para Meta API não implementado.");
  }

  public async contactMessage(data: SendContactDto, options?: SendMessageOptions): Promise<any> {
      const payload = {
          type: 'contacts',
          contacts: data.contacts.map(c => ({ // Mapear para formato Meta API
              name: { formatted_name: c.fullName, first_name: c.firstName, last_name: c.lastName },
              // Adicionar phones, emails, org, etc. conforme necessário
              phones: [{ phone: c.phoneNumber.replace(/\D/g,''), type: 'CELL', wa_id: c.phoneNumber.replace(/\D/g,'') }]
          }))
      };
       // Adicionar context (reply)
       if (options?.quoted?.key?.id) {
        payload.context = { message_id: options.quoted.key.id };
       }
      return this.sendMessagePayload(data.number, payload);
  }

  public async locationMessage(data: SendLocationDto, options?: SendMessageOptions): Promise<any> {
      const payload = {
          type: 'location',
          location: {
              latitude: data.latitude,
              longitude: data.longitude,
              name: data.name,
              address: data.address
          }
      };
       // Adicionar context (reply)
       if (options?.quoted?.key?.id) {
        payload.context = { message_id: options.quoted.key.id };
       }
      return this.sendMessagePayload(data.number, payload);
  }

  public async reactionMessage(data: SendReactionDto, options?: SendMessageOptions): Promise<any> {
       const payload = {
          type: 'reaction',
          reaction: {
              message_id: data.messageId, // ID da mensagem a reagir
              emoji: data.reaction // Emoji
          }
      };
      // Reações não têm options (reply)
      return this.sendMessagePayload(data.number, payload);
  }

  public async templateMessage(data: SendTemplateDto, options?: SendMessageOptions): Promise<any> {
    const payload = {
        type: 'template',
        template: {
            name: data.name, // Nome do template
            language: { code: data.languageCode },
            components: data.components // Array de componentes (header, body, buttons) com parâmetros
        }
    };
     // Adicionar context (reply) - Templates geralmente não são respostas
     // if (options?.quoted?.key?.id) { payload.context = { message_id: options.quoted.key.id }; }
    return this.sendMessagePayload(data.number, payload);
  }

  // --- Fim Implementação Métodos Abstratos ---

  // CORREÇÃO TS2339: Implementar getMedia
  public async getMedia(mediaId: string): Promise<{ buffer: Buffer, mimetype: string }> {
      if (!this.token) throw new InternalServerErrorException('Token da API Meta não configurado.');

      const waBusinessConfig = this.configService.get<Env['WA_BUSINESS']>('WA_BUSINESS');
      let url = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${mediaId}`;
      const config: AxiosRequestConfig = { headers: { Authorization: `Bearer ${this.token}` } };

      try {
          // 1. Obter a URL real da mídia
          this.logger.info(`Buscando URL da mídia Meta ID: ${mediaId}`);
          const infoResponse = await axios.get(url, config);
          const mediaUrl = infoResponse.data?.url;
          const mimetype = infoResponse.data?.mime_type || 'application/octet-stream';

          if (!mediaUrl) {
              throw new Error('URL da mídia não encontrada na resposta da API Meta.');
          }
          this.logger.info(`URL da mídia obtida: ${mediaUrl}. Mimetype: ${mimetype}`);

          // 2. Baixar a mídia da URL obtida (requer novo request com token)
          this.logger.info(`Baixando mídia de: ${mediaUrl}`);
          const mediaResponse = await axios.get(mediaUrl, {
              ...config, // Reenviar token
              responseType: 'arraybuffer'
          });

          const buffer = Buffer.from(mediaResponse.data);
          this.logger.info(`Mídia baixada com sucesso (${buffer.length} bytes)`);
          return { buffer, mimetype };

      } catch (error: any) {
          this.logger.error(`Erro ao obter/baixar mídia Meta ID ${mediaId}: ${error.response?.status} ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
          throw new InternalServerErrorException(`Erro ao obter mídia da Meta API: ${error.response?.data?.error?.message || error.message}`);
      }
  }


  // Método messageHandle ajustado para maior clareza e correções
  protected async messageHandle(message: any, contactInfo: any, metadata: any): Promise<void> {
      // CORREÇÃO TS1117: Renomeada chave duplicada
      this.logger.debug({ messageData: message, contactInfo, metadata, logMessage: 'Recebido handle de mensagem (Meta)' });

      const fromMe = false; // Webhooks são para mensagens recebidas

      let messageContent: any = {};
      let messageType: string = message.type ? `${message.type}Message` : 'unknownMessage';

      // --- Mapeamento Detalhado ---
      if (message.type === 'text') {
          messageContent = { text: message.text?.body }; // Usar só text ou extendedTextMessage?
          messageType = 'conversation';
      } else if (message.type === 'image') {
          messageContent = { imageMessage: { caption: message.image?.caption, mimetype: message.image?.mime_type, id: message.image?.id } };
          messageType = 'imageMessage';
      } else if (message.type === 'audio') {
          messageContent = { audioMessage: { mimetype: message.audio?.mime_type, id: message.audio?.id, voice: message.audio?.voice } };
          messageType = 'audioMessage';
      } else if (message.type === 'video') {
          messageContent = { videoMessage: { caption: message.video?.caption, mimetype: message.video?.mime_type, id: message.video?.id } };
          messageType = 'videoMessage';
      } else if (message.type === 'document') {
           messageContent = { documentMessage: { title: message.document?.filename, mimetype: message.document?.mime_type, id: message.document?.id, caption: message.document?.caption } };
           messageType = 'documentMessage';
      } else if (message.type === 'location') {
          messageContent = { locationMessage: { degreesLatitude: message.location?.latitude, degreesLongitude: message.location?.longitude, name: message.location?.name, address: message.location?.address } };
          messageType = 'locationMessage';
      } else if (message.type === 'contacts') {
           messageContent = { contactsArrayMessage: { contacts: message.contacts /* Mapear */ } };
           messageType = 'contactsArrayMessage';
      } else if (message.type === 'sticker') {
           messageContent = { stickerMessage: { mimetype: message.sticker?.mime_type, id: message.sticker?.id } };
           messageType = 'stickerMessage';
      } else if (message.type === 'reaction') {
           messageContent = { reactionMessage: { text: message.reaction?.emoji, key: { id: message.reaction?.message_id } } };
           messageType = 'reactionMessage';
      } else if (message.type === 'interactive') {
            // Processar respostas de botões/listas
            if (message.interactive?.type === 'button_reply') {
                messageContent = { buttonsResponseMessage: { selectedButtonId: message.interactive.button_reply.id, selectedDisplayText: message.interactive.button_reply.title, contextInfo: { /* ... */ } }};
                messageType = 'buttonsResponseMessage';
            } else if (message.interactive?.type === 'list_reply') {
                messageContent = { listResponseMessage: { title: message.interactive.list_reply.title, selectedRowId: message.interactive.list_reply.id, description: message.interactive.list_reply.description, contextInfo: { /* ... */ } }};
                messageType = 'listResponseMessage';
            }
      } else if (message.type === 'button') { // Resposta de botão legada?
            messageContent = { buttonsResponseMessage: { selectedButtonId: message.button?.payload, selectedDisplayText: message.button?.text, contextInfo: { /* ... */ } }};
            messageType = 'buttonsResponseMessage';
      }
      // Tratar errors, system messages, etc.
      else if (message.type === 'errors') {
          this.logger.error({ metaError: message.errors, msg: "Erro reportado pela API Meta no webhook." });
          return; // Não processar como mensagem normal
      } else if (message.type === 'system') {
          this.logger.info({ systemMessage: message.system, msg: "Mensagem de sistema recebida da Meta."});
          // Tratar mudanças de número, etc.
          return;
      } else {
           this.logger.warn({ unknownMessageType: message.type, msg: `Tipo de mensagem não mapeado: ${message.type}`});
      }

      // --- Montagem do messageRaw ---
      const messageRaw: any = { // Usar tipo mais específico se possível
        key: {
          remoteJid: message.from,
          fromMe: fromMe,
          id: message.id,
          participant: message.context?.participant || undefined, // Contexto pode ter participante em grupos
        },
        pushName: contactInfo?.profile?.name || message.from.split('@')[0], // Usar nome do perfil ou parte do JID
        message: messageContent, // Objeto mapeado acima
        messageType: messageType,
        messageTimestamp: parseInt(message.timestamp) || Math.floor(Date.now() / 1000),
        source: 'meta_api',
        instanceId: this.instanceId,
        // Adicionar contexto (quoted message) se presente
        ...(message.context?.id && {
            quoted: { // Estrutura similar a proto.IWebMessageInfo (simplificada)
                key: { remoteJid: message.from, id: message.context.id, fromMe: message.context.from === this.numberId }, // Ajustar lógica fromMe
                // Precisaria buscar a mensagem original para preencher message.content
            }
        })
      };

      // --- Processamento de Mídia e OpenAI ---
      const mediaKey = Object.keys(messageContent).find(k => typeof messageContent[k] === 'object' && messageContent[k]?.id);
      const mediaObject = mediaKey ? messageContent[mediaKey] : null;
      const s3Config = this.configService.get<S3Config>('S3');
      const openaiConfig = this.configService.get<OpenaiConfig>('OPENAI');

      if (mediaObject?.id && s3Config?.ENABLED) {
          this.logger.info(`Processando mídia ID ${mediaObject.id} para S3.`);
          try {
              // CORREÇÃO TS2339: Chamar o método getMedia implementado
              const mediaData = await this.getMedia(mediaObject.id);
              const fileName = `${mediaObject.id}.${mimeTypes.extension(mediaData.mimetype) || 'bin'}`;
              const s3Path = join(this.instanceId!, messageType.replace('Message','').toLowerCase(), fileName); // Usar messageType como pasta
              // CORREÇÃO TS2339: Chamar s3Service.uploadFile
              const uploadResult = await s3Service.uploadFile(s3Path, mediaData.buffer, mediaData.buffer.length, { 'Content-Type': mediaData.mimetype });
              const s3Url = await s3Service.getObjectUrl(s3Path); // Obter URL após upload
              this.logger.info(`Mídia salva no S3: ${s3Url}`);
              mediaObject.url = s3Url; // Adiciona URL ao objeto da mensagem
              mediaObject.directPath = s3Path;
          } catch (s3Error) {
              this.logger.error({ err: s3Error, messageId: message.id, mediaId: mediaObject.id, msg: `Falha ao processar/salvar mídia no S3` });
          }
      }

      if (openaiConfig?.ENABLED && messageType === 'audioMessage' && mediaObject?.id) {
          this.logger.info(`Processando áudio ${mediaObject.id} com OpenAI.`);
          try {
              // CORREÇÃO TS2339: Chamar getMedia para obter buffer
              const mediaData = await this.getMedia(mediaObject.id);
              // Chamar serviço OpenAI (exemplo, requer implementação)
              // const transcription = await this.openaiService.speechToText(openaiCreds, mediaData.buffer, ...);
              // messageRaw.transcription = transcription;
              // messageRaw.message = { conversation: transcription }; // Ou adicionar ao texto existente
              // messageRaw.messageType = 'conversation';
          } catch (openaiError) {
              this.logger.error({ err: openaiError, messageId: message.id, mediaId: mediaObject.id, msg: `Erro no processamento OpenAI` });
          }
      }

      // --- Webhook, Chatbot, DB, Contato ---
      this.logger.log({ messageId: messageRaw.key?.id, type: messageType, msg: 'Mensagem processada (Meta), enviando para rotinas.' });
      await super.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw); // Webhook

      // CORREÇÃO TS2554: Passar evento e payload para emit
      await chatbotController?.emit?.(Events.MESSAGES_UPSERT, { // Passar nome do evento e payload
          instanceId: this.instanceId!,
          data: messageRaw,
          source: 'meta'
      });

      if (this.localChatwoot?.enabled) {
           this.logger.info(`Enviando mensagem ${messageRaw.key.id} para Chatwoot.`);
           await this.chatwootService?.processWebhook({ // Usa método genérico
               instanceId: this.instanceId!,
               event: Events.MESSAGES_UPSERT,
               payload: messageRaw
           });
      }

      try {
         // CORREÇÃO TS2561: Usar campos corretos do schema Prisma
         const dbData: Prisma.MessageUncheckedCreateInput = {
             instanceId: this.instanceId!,
             messageId: messageRaw.key?.id!,
             remoteJid: messageRaw.key?.remoteJid!,
             fromMe: messageRaw.key?.fromMe ?? false,
             messageType: messageRaw.messageType!,
             messageTimestamp: Number(messageRaw.messageTimestamp), // Garantir número
             jsonData: JSON.stringify(messageRaw), // Salvar o objeto completo
             textData: messageRaw.message?.text || messageRaw.message?.conversation || messageRaw.message?.extendedTextMessage?.text || null,
             mediaUrl: mediaObject?.url || null, // URL S3 ou original
             mediaMimetype: mediaObject?.mimetype || null,
             participant: messageRaw.key?.participant || null, // Salvar participante
             status: 'RECEIVED', // Status inicial para recebidas
             // Adicionar quotedMessageId se existir
             quotedMessageId: messageRaw.quoted?.key?.id || null,
         };
         await this.prismaRepository.createMessage({ data: dbData });
      } catch (dbError: any) {
         this.logger.error({ err: dbError, messageId: message.id, msg: `Erro ao salvar mensagem no banco` });
      }

      if (!fromMe && messageRaw.key?.remoteJid) {
          // CORREÇÃO TS2339: updateContact existe na classe base
          await this.updateContact({ remoteJid: messageRaw.key.remoteJid, pushName: messageRaw.pushName });
      }
  }

  // CORREÇÃO TS2339 (numbers): Alterar tipo para WhatsAppNumberDto
  public async whatsappNumber(data: WhatsAppNumberDto): Promise<any> {
      // CORREÇÃO TS2339: Acessar data.numbers
      if (!data || !Array.isArray(data.numbers)) {
         // CORREÇÃO TS2554: Logger com um argumento
         this.logger.error({ dataReceived: data, msg: 'Propriedade "numbers" inválida ou ausente no DTO WhatsAppNumberDto.' });
         throw new BadRequestException('A propriedade "numbers" deve ser um array de strings.');
      }
      // CORREÇÃO TS2339: Acessar data.numbers
      const jids = data.numbers.map(num => createJid(num));
      this.logger.warn('Verificação onWhatsApp (whatsappNumber) não é suportada diretamente pela Meta API.');
      return { numbers: jids.map(jid => ({ exists: false, jid: jid, status: 404, message: 'Verification not supported by Meta API' })) };
  }

  // Manter outros métodos não suportados
  // ...

} // Fim da classe BusinessStartupService
