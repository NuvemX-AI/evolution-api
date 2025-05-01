// Arquivo: src/api/integrations/channel/meta/whatsapp.business.service.ts
// Correções aplicadas com base na análise dos erros TS1109.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs
import { InstanceDto } from '@api/dto/instance.dto';
import { NumberBusiness } from '@api/dto/chat.dto';
import {
  Options, SendAudioDto, SendButtonsDto, SendContactDto, SendListDto,
  SendLocationDto, SendMediaDto, SendReactionDto, SendTemplateDto,
  SendTextDto, Button, SendMediaUrlDto
} from '@api/dto/sendMessage.dto';

// Imports de Serviços, Repositórios, Config
import * as s3Service from '@integrations/storage/s3/libs/minio.server';
import { ProviderFiles } from '@provider/sessions'; // ** CORREÇÃO v3: Mantido mas verificar se é usado pela Meta **
import { PrismaRepository } from '@repository/repository.service';
import { chatbotController } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
import { Events, wa, WAMessage, ContactPayload, MessageUpdate } from '@api/types/wa.types'; // ** CORREÇÃO v3: Usar 'any' como fallback se tipos não exportados **
import {
  ConfigService, WaBusinessConfig, S3Config, OpenaiConfig,
  ChatwootConfig, DatabaseConfig, HttpServerConfig, AuthConfig
} from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { createJid } from '@utils/createJid';

// Imports de libs externas
import axios from 'axios';
import { isURL, isBase64 } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import mimeTypes from 'mime-types';
import * as path from 'path';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // ** CORREÇÃO v3: Mantido mas verificar se é usado pela Meta **
import { Prisma } from '@prisma/client';
import { join } from 'path';

// Tipo StateConnection corrigido
type MetaStateConnection = { status: 'OPEN' | 'CLOSE', lastDisconnect?: any };

export class BusinessStartupService extends ChannelStartupService {
  // --- Propriedades ---
  public stateConnection: MetaStateConnection = { status: 'CLOSE', lastDisconnect: undefined };
  public mobile: boolean = false; // Meta API não é mobile
  protected token: string | undefined;
  protected numberId: string | undefined;

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly chatwootCache: CacheService,
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
    chatwootService: ChatwootService,
    public readonly cache: CacheService,
    // Dependências não usadas pela Meta mas podem ser exigidas pela base:
    public readonly baileysCache: CacheService, // ** CORREÇÃO v3: Mantido mas verificar se é usado pela Meta **
    private readonly providerFiles: ProviderFiles, // ** CORREÇÃO v3: Mantido mas verificar se é usado pela Meta **
  ) {
    // Passa todos os 7 argumentos esperados pela base ChannelStartupService
    super(configService, eventEmitter, prismaRepository, chatwootCache, waMonitor, baseLogger, chatwootService);
  }

  // --- Métodos (com correções aplicadas) ---
  public setInstance(instanceData: InstanceDto & { token?: string; number?: string }): void {
      super.setInstance(instanceData);
      this.token = instanceData.token;
      this.numberId = instanceData.number;
      if (!this.token) { this.logger.warn(`Token não fornecido para a instância Meta ${instanceData.instanceName}.`); }
      if (!this.numberId) { this.logger.warn(`ID do número (number) não fornecido para a instância Meta ${instanceData.instanceName}.`); }
      this.logger.info(`Meta Channel: Token e Number ID definidos para ${this.instanceName}`);
  }
  public get connectionStatus(): MetaStateConnection { return this.stateConnection; }
  public get qrCode(): wa.QrCode { return { code: null, base64: null, count: 0, pairingCode: null }; } // Meta não usa QR Code

  // ... outros métodos como closeClient, post, getMedia, connectToWhatsapp, getStatus, eventHandler mantidos ...
  // (Certifique-se que os logs dentro deles estejam corretos como indicado nas correções v3)

  private async messageHandle(message: any, contactInfo: any, metadata: any): Promise<void> {
    // ** CORREÇÃO INICIADA **
    this.logger.debug({ message, contactInfo, metadata, message: 'Recebido handle de mensagem (Meta)' });

    // Determina se a mensagem é nossa (outgoing) ou recebida (incoming)
    // Na API da Meta, o webhook geralmente só notifica mensagens recebidas,
    // e o status 'delivered'/'read' para enviadas. Assumindo que este handle é para recebidas.
    const fromMe = false; // Para mensagens recebidas via webhook

    // Mapeamento básico inicial (AJUSTE NECESSÁRIO: conforme estrutura real da Meta API)
    let messageContent: any = {};
    let messageType: string = message.type ? `${message.type}Message` : 'unknownMessage';

    // Mapeamento de Tipos (simplificado, refinar conforme necessário)
    if (message.type === 'text') {
        messageContent = { text: message.text?.body, extendedTextMessage: { text: message.text?.body } };
        messageType = 'conversation'; // Ou 'extendedTextMessage' dependendo do formato esperado
    } else if (message.type === 'image') {
        messageContent = { imageMessage: { caption: message.image?.caption, mimetype: message.image?.mime_type, id: message.image?.id /* ...outros campos */ } };
        messageType = 'imageMessage';
    } else if (message.type === 'audio') {
        messageContent = { audioMessage: { mimetype: message.audio?.mime_type, id: message.audio?.id /* ...outros campos */ } };
        messageType = 'audioMessage';
    } else if (message.type === 'video') {
        messageContent = { videoMessage: { caption: message.video?.caption, mimetype: message.video?.mime_type, id: message.video?.id /* ...outros campos */ } };
        messageType = 'videoMessage';
    } else if (message.type === 'document') {
         messageContent = { documentMessage: { title: message.document?.filename, mimetype: message.document?.mime_type, id: message.document?.id /* ...outros campos */ } };
         messageType = 'documentMessage';
    } else if (message.type === 'location') {
        messageContent = { locationMessage: { degreesLatitude: message.location?.latitude, degreesLongitude: message.location?.longitude, name: message.location?.name, address: message.location?.address } };
        messageType = 'locationMessage';
    } else if (message.type === 'contacts') {
         messageContent = { contactsArrayMessage: { contacts: message.contacts /* ...mapear estrutura interna... */ } };
         messageType = 'contactsArrayMessage';
    } else if (message.type === 'sticker') {
         messageContent = { stickerMessage: { mimetype: message.sticker?.mime_type, id: message.sticker?.id /* ... */ } };
         messageType = 'stickerMessage';
    } else if (message.type === 'reaction') {
         // Reações podem vir de forma diferente, verificar documentação da Meta
         messageContent = { reactionMessage: { text: message.reaction?.emoji, key: { id: message.reaction?.message_id } } };
         messageType = 'reactionMessage';
    }
    // Adicionar mais mapeamentos conforme necessário (buttons_response, list_response, etc.)


    // ** CORREÇÃO Linha 107: Substituir placeholders por lógica real **
    const messageRaw: Partial<WAMessage | any> = { // Usar Partial<WAMessage> ou 'any'
      key: {
        remoteJid: message.from, // JID do remetente
        fromMe: fromMe,          // Geralmente false para webhooks de recebimento
        id: message.id,          // ID da mensagem da Meta
        // participant: message.author // Se for mensagem de grupo, pode vir aqui ou em 'from'
        // AJUSTE NECESSÁRIO: Validar estrutura exata da chave com base nos dados da Meta
      },
      pushName: contactInfo?.profile?.name ?? message.from, // Nome do perfil do contato ou fallback para JID
      // AJUSTE NECESSÁRIO: Verificar onde o nome do contato vem em 'contactInfo'
      message: messageContent,
      messageType: messageType,
      messageTimestamp: parseInt(message.timestamp) || Math.round(Date.now() / 1000),
      source: 'meta_api', // Indica a origem
      instanceId: this.instanceId,
      // Adicionar outros campos relevantes se disponíveis (quotedMessage, etc.)
    };

    // Lógica S3 (mantida, verificar compatibilidade com ID da Meta)
    // ** CORREÇÃO Linha 113: Substituir placeholder pela condição de busca da chave de mídia **
    const mediaKey = Object.keys(messageContent).find(k =>
        k !== 'text' && // Não é mensagem de texto simples
        k !== 'conversation' && // Não é mensagem de texto simples
        k !== 'extendedTextMessage' && // Não é mensagem de texto simples
        typeof messageContent[k] === 'object' && // O valor é um objeto
        messageContent[k] !== null && // Não é nulo
        (messageContent[k].id || messageContent[k].url) // Possui um 'id' (Meta) ou 'url' (se já baixado)
        // AJUSTE NECESSÁRIO: Refinar esta condição se a estrutura da mídia for diferente
    );

    if (mediaKey && this.configService.get<S3Config>('S3').ENABLED) {
      this.logger.info(`Tentando baixar mídia da Meta (ID: ${messageContent[mediaKey]?.id}) para S3`);
      try {
        const mediaData = await this.getMedia(messageContent[mediaKey].id);
        const fileName = `${messageContent[mediaKey].id}.${mimeTypes.extension(mediaData.mimetype) || 'bin'}`;
        const s3Path = join(this.instanceId!, 'media', messageType, fileName);

        // Assumindo que s3Service.uploadBuffer espera Buffer, nome e tipo MIME
        const s3Url = await s3Service.uploadBuffer(mediaData.buffer, s3Path, mediaData.mimetype);
        this.logger.info(`Mídia salva no S3: ${s3Url}`);
        // Adicionar URL do S3 ao objeto da mensagem se necessário para webhooks/bots
        if (messageContent[mediaKey]) {
          messageContent[mediaKey].url = s3Url; // Ou um campo específico como `s3Url`
          messageContent[mediaKey].directPath = s3Path; // Pode ser útil
        }
      } catch (s3Error) {
        this.logger.error({ err: s3Error, messageId: message.id, mediaId: messageContent[mediaKey]?.id, message: `Falha ao processar/salvar mídia no S3` });
      }
    }


    // Lógica OpenAI (mantida, verificar acesso a mediaMsgForOpenAI.url)
    let mediaMsgForOpenAI: any = null;
    if (mediaKey) mediaMsgForOpenAI = messageContent[mediaKey];

    // Certifique-se que 'url' exista e não seja um placeholder interno antes de chamar OpenAI
    if (this.configService.get<OpenaiConfig>('OPENAI')?.ENABLED &&
        messageType === 'audioMessage' &&
        mediaMsgForOpenAI?.id && // Usar o ID da Meta para buscar a mídia se necessário
        !mediaMsgForOpenAI.url?.startsWith('media:')) { // Evitar URLs internas se existirem

          this.logger.info(`Processando áudio com OpenAI (ID: ${mediaMsgForOpenAI.id})`);
          try {
              // Baixar a mídia se ainda não tiver a URL ou o buffer
              if (!mediaMsgForOpenAI.url && !mediaMsgForOpenAI.buffer) {
                 const mediaData = await this.getMedia(mediaMsgForOpenAI.id);
                 mediaMsgForOpenAI.buffer = mediaData.buffer; // Armazenar buffer temporariamente
                 mediaMsgForOpenAI.mimetype = mediaData.mimetype;
              }

              // Chamar o serviço OpenAI (IMPLEMENTAÇÃO PENDENTE NO CÓDIGO ORIGINAL)
              // const transcription = await this.openaiService.speechToText(mediaMsgForOpenAI.buffer, mediaMsgForOpenAI.mimetype);
              // this.logger.info(`Transcrição OpenAI: ${transcription}`);
              // messageRaw.transcription = transcription; // Adicionar transcrição ao payload
              // messageContent.text = transcription; // Adicionar como texto principal? Ou manter separado?
              // messageType = 'conversation'; // Mudar tipo para texto? Decidir fluxo.

          } catch (openaiError) {
             this.logger.error({ err: openaiError, messageId: message.id, message: `Erro no processamento OpenAI` });
          }
    }


    this.logger.log({ messageId: messageRaw?.key?.id, type: messageType, message: 'Mensagem processada (Meta)' });
    await super.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);
    // Emitir para chatbot interno (verificar formato esperado)
    await chatbotController?.emit?.(this.instanceId!, Events.MESSAGES_UPSERT, {
        instanceId: this.instanceId!,
        data: messageRaw,
        source: 'meta', // Ou 'meta_api'
    });

    // Lógica Chatwoot (mantida como pendente)
    if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
      this.logger.info(`Enviando mensagem ${message.id} para Chatwoot (implementação pendente)...`);
      // NECESSÁRIO IMPLEMENTAR ENVIO NO ChatwootService usando 'messageRaw'
      // await this.chatwootService.handleIncomingMessage(this.instanceId, messageRaw); // Exemplo
    }

    // Salvar no banco (adaptar mapeamento se necessário)
    try {
       const dbData: Prisma.MessageUncheckedCreateInput = {
           instanceId: this.instanceId!,
           messageId: messageRaw.key?.id!,
           remoteJid: messageRaw.key?.remoteJid!,
           fromMe: messageRaw.key?.fromMe ?? false,
           messageType: messageRaw.messageType!,
           messageTimestamp: Number(messageRaw.messageTimestamp) || Math.floor(Date.now() / 1000), // Garantir número
           jsonData: JSON.stringify(messageRaw), // Salvar o objeto completo como JSON
           textData: messageRaw.message?.conversation || messageRaw.message?.extendedTextMessage?.text || null, // Texto principal
           mediaUrl: mediaKey ? messageContent[mediaKey]?.url || null : null, // URL S3 ou original
           mediaMimetype: mediaKey ? messageContent[mediaKey]?.mimetype || null : null,
           // Adicionar outros campos relevantes do Prisma schema
       };
       await this.prismaRepository.createMessage({ data: dbData });
    } catch (dbError: any) {
       this.logger.error({ err: dbError, messageId: message.id, message: `Erro ao salvar mensagem no banco` });
    }

    // Atualizar contato (se não for mensagem nossa)
    if (!fromMe && messageRaw.key?.remoteJid) {
        await this.updateContact({ remoteJid: messageRaw.key.remoteJid, pushName: messageRaw.pushName });
    }
    // ** CORREÇÃO TERMINADA **
  }

  // ... outros métodos como updateContact, statusHandle, métodos de envio, whatsappNumber mantidos ...
  // (Certifique-se que a lógica interna deles, especialmente chamadas a Prisma e mapeamentos, esteja correta)

  // --- Métodos Não Suportados (Mantidos) ---
  public async whatsappNumber(data: NumberBusiness): Promise<any> {
      // ** CORREÇÃO v3: Acessar 'numbers' com segurança **
      if (!data || !Array.isArray(data.numbers)) {
         this.logger.error({ dataReceived: data }, 'Propriedade "numbers" inválida ou ausente no DTO NumberBusiness.');
         throw new BadRequestException('A propriedade "numbers" deve ser um array de strings.');
      }
      const jids = data.numbers.map(num => createJid(num)); // Usar createJid para normalizar
      this.logger.warn('Verificação onWhatsApp (whatsappNumber) não é suportada diretamente pela Meta API.');
      // Retorna um placeholder indicando que não foi possível verificar
      return { numbers: jids.map(jid => ({ exists: false, jid: jid, status: 404, message: 'Verification not supported by Meta API' })) };
  }

  public async getWhatsappProfile(data: NumberBusiness): Promise<any> {
      this.logger.warn('getWhatsappProfile não é suportado pela Meta API.');
      throw new BadRequestException('getWhatsappProfile is not supported by the Meta API.');
  }
  public async getContact(data: NumberBusiness): Promise<any> {
      this.logger.warn('getContact não é suportado pela Meta API da mesma forma que Baileys.');
      throw new BadRequestException('getContact is not supported by the Meta API.');
  }
  // ... (manter outros métodos não suportados lançando BadRequestException) ...

} // Fim da classe BusinessStartupService
