// src/api/integrations/channel/meta/whatsapp.business.service.ts

// Imports de DTOs (usando alias @api)
import { NumberBusiness } from '@api/dto/chat.dto'; // TODO: Precisa do arquivo chat.dto.ts
import {
  ContactMessage, MediaMessage, Options, SendAudioDto, SendButtonsDto,
  SendContactDto, SendListDto, SendLocationDto, SendMediaDto, SendReactionDto,
  SendTemplateDto, SendTextDto,
} from '@api/dto/sendMessage.dto'; // TODO: Precisa do arquivo sendMessage.dto.ts

// Imports de Serviços, Repositórios, Config (usando aliases)
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server'; // Verifique se o caminho está correto
import { ProviderFiles } from '@api/provider/sessions'; // TODO: Precisa do arquivo sessions.ts
import { PrismaRepository } from '@api/repository/repository.service';
import { chatbotController } from '@api/server.module'; // TODO: Precisa do arquivo server.module.ts
import { CacheService } from '@api/services/cache.service'; // TODO: Precisa do arquivo cache.service.ts
import { ChannelStartupService } from '@api/services/channel.service'; // TODO: Precisa do arquivo channel.service.ts
import { Events, wa } from '@api/types/wa.types'; // TODO: Precisa do arquivo wa.types.ts
import { Chatwoot, ConfigService, Database, Openai, S3, WaBusiness } from '@config/env.config'; // TODO: Precisa do arquivo env.config.ts
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts
import { BadRequestException, InternalServerErrorException } from '@exceptions'; // Usando alias
import { createJid } from '@utils/createJid'; // TODO: Precisa do arquivo createJid.ts
// import { status } from '@utils/renderStatus'; // TODO: Precisa do arquivo renderStatus.ts -> Removido temporariamente pois 'status' não era usado neste arquivo

// Imports de libs externas
import axios from 'axios';
import { isURL } from 'class-validator'; // Removido arrayUnique não utilizado
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import mimeTypes from 'mime-types';
import { join } from 'path';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Importando ChatwootService
import { Message as MessageModel, Prisma } from '@prisma/client'; // Importando MessageModel e Prisma para tipos
import dayjs from 'dayjs'; // Importando dayjs usado em syncLostMessages

// TODO: Verificar/Implementar classe base 'ChannelStartupService' para corrigir erros TS2415
export class BusinessStartupService extends ChannelStartupService {
  // --- Propriedades ---
  public stateConnection: any /* wa.StateConnection */ = { state: 'open' }; // Usando any por enquanto
  public phoneNumber: string = ''; // Telefone associado à instância (ex: ID do número da Meta)
  public mobile: boolean = false; // Meta API não é 'mobile'
  // TODO: Definir/Inicializar corretamente estas propriedades (provavelmente herdadas ou no construtor)
  protected logger: any = console; // Placeholder
  protected instance: any = {}; // Placeholder
  protected token: string = ''; // Token da API da Meta (provavelmente vem da instância)
  protected number: string = ''; // ID do número da Meta (provavelmente vem da instância)
  protected instanceId: string = ''; // ID da instância no seu sistema
  protected localSettings: any = {}; // Placeholder
  protected localChatwoot?: { enabled: boolean; importContacts?: boolean; importMessages?: boolean }; // Placeholder
  protected openaiService: any; // Placeholder
  protected sendDataWebhook: (event: string, data: any, bypass?: boolean, onlyIntegration?: string[]) => void = () => {}; // Placeholder
  protected chatwootService!: ChatwootService; // Declarado como definido, mas precisa ser injetado/inicializado
  protected findSettings: () => Promise<any> = async () => ({}); // Placeholder
  protected loadChatwoot: () => void = () => {}; // Placeholder
  protected loadSettings: () => void = () => {}; // Placeholder
  protected loadWebhook: () => void = () => {}; // Placeholder
  protected loadProxy: () => void = () => {}; // Placeholder

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService, // Adicionado
    public readonly chatwootCache: CacheService, // Adicionado
    public readonly baileysCache: CacheService, // Adicionado - É necessário para Meta API?
    private readonly providerFiles: ProviderFiles, // Adicionado - É necessário para Meta API?
  ) {
    // TODO: Verificar assinatura do construtor de ChannelStartupService (TS2415)
    super(configService, eventEmitter, prismaRepository, chatwootCache);
    // Inicializações específicas do BusinessStartupService podem vir aqui
    // Ex: this.logger = new Logger('BusinessStartupService'); // Se Logger for uma classe
    //     this.chatwootService = new ChatwootService(...) // Se não usar DI
  }

  // --- Getters ---
  public get connectionStatus(): any /* wa.StateConnection */ {
    return this.stateConnection;
  }

  public get qrCode(): any /* wa.QrCode */ {
    // Meta API não usa QR Code para conexão normal
    return { code: null, base64: null, count: 0, pairingCode: null };
  }

  // --- Métodos Principais ---
  public async closeClient(): Promise<void> {
    this.logger?.info?.('Meta Channel: closeClient chamado (nenhuma ação necessária).');
    this.stateConnection = { state: 'close' };
  }

  public async logoutInstance(): Promise<void> {
    this.logger?.info?.('Meta Channel: logoutInstance chamado (nenhuma ação real, apenas muda estado).');
    await this.closeClient();
  }

  // Método para fazer chamadas à API da Meta
  private async post(message: any, endpoint: string): Promise<any> {
    try {
      const waBusinessConfig = this.configService.get<WaBusiness>('WA_BUSINESS'); // TODO: Precisa de env.config.ts
      if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION) {
        throw new Error('Configuração da API de Negócios do WhatsApp (WA_BUSINESS) não encontrada.');
      }
      if (!this.number) {
        throw new Error('ID do número de telefone (this.number) não definido para a instância.');
      }
       if (!this.token) {
        throw new Error('Token da API (this.token) não definido para a instância.');
      }

      const urlServer = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${this.number}/${endpoint}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
      this.logger?.debug?.(`POST ${urlServer} Data: ${JSON.stringify(message)}`);
      const result = await axios.post(urlServer, message, { headers });
      this.logger?.debug?.(`POST Response: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e: any) {
      const errorData = e?.response?.data?.error;
      this.logger?.error?.(`Erro na chamada POST para ${endpoint}: ${JSON.stringify(errorData || e.message)}`);
      // Retorna o erro da API da Meta se disponível
      return { error: errorData || { message: e.message, code: e.code } };
    }
  }

  // Método para obter mídia da API da Meta
  private async getMedia(mediaId: string): Promise<{ buffer: Buffer; mimetype: string; fileName?: string }> {
    try {
       const waBusinessConfig = this.configService.get<WaBusiness>('WA_BUSINESS'); // TODO: Precisa de env.config.ts
      if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION) {
        throw new Error('Configuração da API de Negócios do WhatsApp (WA_BUSINESS) não encontrada.');
      }
       if (!this.token) {
        throw new Error('Token da API (this.token) não definido para a instância.');
      }

      // 1. Obter URL da mídia
      const urlInfo = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${mediaId}`;
      const headers = { Authorization: `Bearer ${this.token}` };
      this.logger?.debug?.(`GET ${urlInfo}`);
      const infoResult = await axios.get(urlInfo, { headers });
      const mediaUrl = infoResult.data.url;
      const mimetype = infoResult.data.mime_type; // Mimetype fornecido pela Meta
      this.logger?.debug?.(`Media URL: ${mediaUrl}, Mimetype: ${mimetype}`);

      if (!mediaUrl) throw new Error('URL da mídia não encontrada na resposta da API.');

      // 2. Baixar a mídia da URL obtida
      const mediaResult = await axios.get(mediaUrl, { headers, responseType: 'arraybuffer' });
      const buffer = Buffer.from(mediaResult.data);

      // Tentar obter nome do arquivo do cabeçalho content-disposition (se existir)
      let fileName: string | undefined;
      const contentDisposition = mediaResult.headers['content-disposition'];
       if (contentDisposition) {
          const match = contentDisposition.match(/filename\*?=['"]?([^'";]+)['"]?/i);
          if (match && match[1]) {
              fileName = decodeURIComponent(match[1]); // Decodifica se necessário
          }
       }

      return { buffer, mimetype, fileName };
    } catch (e: any) {
      this.logger?.error?.(`Erro ao baixar mídia ${mediaId}: ${e?.response?.data?.error?.message || e.message}`);
      throw new InternalServerErrorException(`Falha ao baixar mídia: ${e?.response?.data?.error?.message || e.message}`);
    }
  }

  // Este método é chamado pelo MetaController para processar webhooks
  public async connectToWhatsapp(webhookValue?: any): Promise<any> {
    this.logger?.info?.(`Meta Channel: connectToWhatsapp/webhook recebido: ${JSON.stringify(webhookValue)}`);
    if (!webhookValue) {
       this.logger?.warn?.('connectToWhatsapp chamado sem dados (webhookValue), nenhuma ação tomada.');
       return; // Nenhuma ação se não houver dados (não é uma conexão real)
    }

    try {
      // Carrega configurações relevantes (se necessário a cada evento)
      // this.loadChatwoot(); // TODO: Verificar necessidade
      // const settings = await this.findSettings(); // TODO: Verificar necessidade

      // Processa o evento recebido
      await this.eventHandler(webhookValue);
    } catch (error: any) {
      this.logger?.error?.(`Erro em connectToWhatsapp/eventHandler (Meta): ${error?.message || error}`);
      // Não relançar erro aqui, pois é um webhook. Log é suficiente.
    }
  }

  // Processa o conteúdo do webhook ('value' object)
  protected async eventHandler(content: any): Promise<void> {
    this.logger?.info?.(`Meta Channel: eventHandler processando: ${JSON.stringify(content)}`);
    try {
      // Processar mensagens recebidas
      if (Array.isArray(content.messages)) {
        for (const message of content.messages) {
          await this.messageHandle(message, content.contacts?.[0], content.metadata);
        }
      }
      // Processar atualizações de status
      else if (Array.isArray(content.statuses)) {
        for (const status of content.statuses) {
          await this.statusHandle(status, content.metadata);
        }
      } else {
         this.logger?.warn?.(`Tipo de evento não tratado no webhook Meta: ${JSON.stringify(content)}`);
      }
    } catch (error: any) {
      this.logger?.error?.(`Erro em eventHandler (Meta): ${error?.message || error}`, error?.stack);
    }
  }

  // Processa uma única mensagem do webhook
  private async messageHandle(message: any, contactInfo: any, metadata: any): Promise<void> {
     this.logger?.debug?.(`Processando mensagem: ${message.id}, Tipo: ${message.type}, De: ${message.from}`);
     const fromMe = message.from === metadata.phone_number_id; // Verifica se a mensagem é nossa
     const remoteJid = !fromMe ? message.from : metadata.display_phone_number; // JID de destino ou origem
     const participant = message.context?.participant; // Participante em grupo

     const key = {
        id: message.id,
        remoteJid: remoteJid,
        fromMe: fromMe,
        participant: participant, // Adicionado participante
     };

     // Extrai nome do contato (se disponível)
     const pushName = contactInfo?.profile?.name || remoteJid.split('@')[0];

     let messageContent: any = {};
     let messageType: string = message.type + 'Message'; // Ex: textMessage, imageMessage

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
         messageContent = this.messageContactsJson({ messages: [message] }); // Reutiliza função de parsing
         messageType = 'contactsArrayMessage'; // Ou contactMessage se for só 1
     } else if (message.location) {
         messageContent = { locationMessage: message.location };
     } else if (message.sticker) {
         messageContent = { stickerMessage: { url: `media:${message.sticker.id}`, mimetype: message.sticker.mime_type, sha256: message.sticker.sha256 } };
     } else if (message.reaction) {
          messageContent = { reactionMessage: { key: { id: message.reaction.message_id }, text: message.reaction.emoji } };
          messageType = 'reactionMessage';
     } else if (message.interactive) { // Respostas a botões/listas
        // Extrair o texto da resposta pode variar dependendo do tipo (button_reply, list_reply)
        messageContent = { conversation: message.interactive[message.interactive.type]?.title || message.interactive[message.interactive.type]?.description || `Resposta interativa ${message.interactive.type}` };
        messageType = 'conversation'; // Tratar como texto simples por enquanto
     } else if (message.button) { // Resposta a botão legado (raro)
        messageContent = { conversation: message.button.text };
        messageType = 'conversation';
     } else if (message.system) { // Mudança de número, etc.
        this.logger?.info?.(`Mensagem de sistema recebida: ${message.system.body}`);
        // Pode querer tratar eventos de sistema separadamente
        return; // Ignorar por enquanto
     } else {
        this.logger?.warn?.(`Tipo de mensagem Meta não tratado: ${message.type}`);
        messageContent = { conversation: `[Mensagem do tipo ${message.type} não suportada]` };
        messageType = 'conversation';
     }

     // Adiciona Contexto (Mensagem Respondida)
     if (message.context) {
        messageContent.contextInfo = {
           stanzaId: message.context.id, // ID da mensagem original
           participant: message.context.participant, // Quem enviou a msg original em grupo
           // Para obter a mensagem citada, precisaríamos buscar pelo stanzaId no banco
           // quotedMessage: await this.findQuotedMessage(message.context.id)
        };
     }

     const messageRaw: any = {
       key,
       pushName,
       message: messageContent,
       messageType: messageType,
       messageTimestamp: parseInt(message.timestamp) || Math.round(new Date().getTime() / 1000),
       source: 'meta_api',
       instanceId: this.instanceId,
       // Campos Chatwoot serão preenchidos depois, se aplicável
     };

     // Download e Upload de Mídia para S3 (se habilitado)
     const mediaMsg = messageRaw.message[messageType];
     if (mediaMsg?.url?.startsWith('media:')) {
        const mediaId = mediaMsg.url.split(':')[1];
        if (this.configService.get<S3>('S3')?.ENABLE) {
           try {
              this.logger?.info?.(`Baixando mídia da Meta API: ${mediaId}`);
              const { buffer, mimetype, fileName } = await this.getMedia(mediaId);
              mediaMsg.mimetype = mimetype; // Atualiza com mimetype real
              const mediaTypeS3 = messageType.replace('Message', '').toLowerCase();
              const fileNameS3 = fileName || `${messageId}.${mimeTypes.extension(mimetype) || 'bin'}`;
              const fullNameS3 = join(`${this.instanceId}`, key.remoteJid, mediaTypeS3, fileNameS3);
              const size = buffer.byteLength;

              this.logger?.info?.(`Fazendo upload para S3: ${fullNameS3}`);
              await s3Service.uploadFile(fullNameS3, buffer, size, { 'Content-Type': mimetype });
              const mediaUrl = await s3Service.getObjectUrl(fullNameS3);
              mediaMsg.url = mediaUrl; // Substitui url placeholder pela URL S3
              mediaMsg.fileName = fileNameS3; // Adiciona nome do arquivo S3
              this.logger?.info?.(`Upload S3 concluído: ${mediaUrl}`);

           } catch (error: any) {
             this.logger?.error?.(`Falha no download/upload de mídia ${mediaId}: ${error.message}`);
             mediaMsg.url = `[Erro ao baixar mídia ${mediaId}]`; // Indica falha
           }
        } else {
           this.logger?.warn?.(`S3 desativado. Mídia não será baixada/armazenada externamente: ${mediaId}`);
           // Manter url placeholder ou remover? Depende se o frontend/webhook consegue lidar com 'media:ID'
           // delete mediaMsg.url;
        }
     }

     // TODO: Lógica de Speech-to-Text OpenAI (se aplicável e se tiver URL S3/Base64)
     if (this.configService.get<Openai>('OPENAI')?.ENABLED && messageType === 'audioMessage' && mediaMsg.url && !mediaMsg.url.startsWith('media:')) {
         // ... (lógica similar à do Baileys, mas usando a URL S3)
         // Precisa de OpenaiService e schema.prisma
     }

     this.logger?.log?.('Mensagem processada (Meta):', messageRaw);

     // Enviar para Webhook geral
     this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

     // Enviar para Chatbot Controller
     await chatbotController?.emit?.({
        instance: { instanceName: this.instance.name, instanceId: this.instanceId },
        remoteJid: key.remoteJid,
        msg: messageRaw,
        pushName: pushName,
     });

     // Enviar para Chatwoot
     if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        this.logger?.info?.(`Enviando mensagem ${message.id} para Chatwoot...`);
        // TODO: Verificar a necessidade e implementação correta do método 'eventWhatsapp'
        // A chamada abaixo provavelmente está incorreta ou o método não existe
         // const chatwootSentMessage = await this.chatwootService.eventWhatsapp(
         //    Events.MESSAGES_UPSERT,
         //    { instanceName: this.instance.name, instanceId: this.instanceId },
         //    messageRaw,
         // );
         // if (chatwootSentMessage?.id) {
         //    messageRaw.chatwootMessageId = `${chatwootSentMessage.id}`;
         //    messageRaw.chatwootInboxId = `${chatwootSentMessage.inbox_id}`;
         //    messageRaw.chatwootConversationId = `${chatwootSentMessage.conversation_id}`;
         // }
     }

     // Salvar no Banco de Dados
     try {
        // TODO: Precisa do schema.prisma
        await this.prismaRepository.prisma.message.create({
            data: {
                ...messageRaw,
                key: key as any, // Usar tipo correto do Prisma ou 'as any'
                message: messageRaw.message as any, // Usar tipo correto do Prisma ou 'as any'
                messageTimestamp: BigInt(messageRaw.messageTimestamp), // Usar BigInt se schema for BigInt
            },
        });
     } catch (dbError: any) {
        this.logger?.error?.(`Erro ao salvar mensagem ${message.id} no banco: ${dbError.message}`);
     }

     // Atualizar contato (se não for mensagem própria)
     if (!fromMe) {
        await this.updateContact({
           remoteJid: key.remoteJid,
           pushName: pushName,
           // TODO: Obter profilePicUrl se a API da Meta fornecer (não parece comum em webhooks)
        });
     }
  }

  // Processa um evento de status do webhook
  private async statusHandle(statusInfo: any, metadata: any): Promise<void> {
    this.logger?.debug?.(`Processando status: ${statusInfo.id}, Status: ${statusInfo.status}, Para: ${statusInfo.recipient_id}`);
    const key = {
      id: statusInfo.id,
      remoteJid: statusInfo.recipient_id, // Para quem a mensagem foi enviada
      fromMe: true, // Status são sempre de mensagens enviadas por nós
    };

    // Ignorar status de broadcast ou grupos se configurado
    // TODO: Adicionar configuração local 'groupsIgnore' se necessário
    // if (this.localSettings?.groups_ignore && key.remoteJid.includes('@g.us')) return;
    if (key.remoteJid === 'status@broadcast' || key?.remoteJid?.match(/(:\d+)/)) return;

    // TODO: Precisa do schema.prisma
    const findMessage = await this.prismaRepository.prisma.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: { path: ['id'], equals: key.id }, // Busca pelo ID da mensagem original
      },
    });

    if (!findMessage) {
       this.logger?.warn?.(`Mensagem original ${key.id} não encontrada para atualização de status.`);
       return; // Mensagem original não encontrada
    }

    const messageUpdate: any = {
      messageId: findMessage.id, // ID interno da mensagem no nosso DB
      keyId: key.id, // ID da mensagem no WhatsApp
      remoteJid: key.remoteJid,
      fromMe: key.fromMe,
      participant: key.remoteJid, // Para status, participante é o destinatário
      status: statusInfo.status.toUpperCase(), // delivered, read, sent, failed
      timestamp: parseInt(statusInfo.timestamp) || Math.round(new Date().getTime() / 1000), // Timestamp do evento de status
      instanceId: this.instanceId,
    };

     // Log e Webhook
     this.logger?.log?.(`Atualização de status: ${JSON.stringify(messageUpdate)}`);
     this.sendDataWebhook(Events.MESSAGES_UPDATE, messageUpdate); // TODO: Precisa de Events e sendDataWebhook

     // Salvar atualização no banco
     try {
       // TODO: Precisa do schema.prisma
       await this.prismaRepository.prisma.messageUpdate.create({ data: messageUpdate });

       // Atualizar status na mensagem principal (opcional, mas útil)
        await this.prismaRepository.prisma.message.updateMany({
            where: { id: findMessage.id },
            data: { status: messageUpdate.status } // Atualiza o status mais recente
        });

     } catch (dbError: any) {
        this.logger?.error?.(`Erro ao salvar status ${key.id} no banco: ${dbError.message}`);
     }

     // Enviar para Chatwoot (se necessário)
     if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        this.logger?.info?.(`Enviando atualização de status ${key.id} para Chatwoot...`);
        // TODO: Verificar/implementar lógica de envio de status para Chatwoot
        // this.chatwootService?.eventWhatsapp?.(...)
     }

     // Enviar para webhook específico da mensagem (se existir)
     // TODO: Precisa do schema.prisma para verificar 'webhookUrl' no modelo Message
     // if (findMessage.webhookUrl) {
     //    try {
     //        await axios.post(findMessage.webhookUrl, messageUpdate);
     //    } catch (hookError: any) {
     //        this.logger?.error?.(`Erro ao enviar status para webhook ${findMessage.webhookUrl}: ${hookError.message}`);
     //    }
     // }
  }


  // --- Métodos de Envio de Mensagem (Adaptados para Meta API) ---

  public async textMessage(data: SendTextDto, isIntegration = false): Promise<any> {
    const jid = createJid(data.number);
    const message = {
      messaging_product: 'whatsapp',
      to: jid,
      type: 'text',
      text: {
        preview_url: data.options?.linkPreview ?? false, // Controle de preview de link
        body: data.text,
      },
      // Adicionar contexto se for uma resposta
      ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
    };

    this.logger?.info?.(`Enviando mensagem de texto para ${jid}`);
    const result = await this.post(message, 'messages');

    // TODO: Salvar a mensagem enviada no banco local (usando a resposta da API se possível)
    //       e enviar webhooks/eventos internos como nos outros canais.

    if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
    return result; // Retorna a resposta da API da Meta
  }

    // Método para upload de mídia para a API da Meta
  private async uploadMediaForMeta(media: Buffer | Readable | string, mimetype: string): Promise<string | null> {
      try {
        const waBusinessConfig = this.configService.get<WaBusiness>('WA_BUSINESS');
        if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION || !this.number || !this.token) {
          throw new Error('Configuração incompleta para upload de mídia da Meta.');
        }

        const urlUpload = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${this.number}/media`;
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('type', mimetype); // Passa o mimetype correto

        // Determina o nome do arquivo para o FormData
        let filename = `upload.${mimeTypes.extension(mimetype) || 'bin'}`;
        if (typeof media === 'string' && !isURL(media) && !isBase64(media)) { // Assume ser um path de arquivo
            filename = path.basename(media);
        }

        // Adiciona o arquivo ao FormData
        if (Buffer.isBuffer(media)) {
            formData.append('file', media, { filename });
        } else if (media instanceof Readable) {
            formData.append('file', media, { filename });
        } else if (typeof media === 'string' && !isURL(media) && !isBase64(media)) { // Path de arquivo
            formData.append('file', createReadStream(media), { filename });
        } else if (typeof media === 'string' && isBase64(media)) { // Base64
            formData.append('file', Buffer.from(media, 'base64'), { filename });
        } else if (typeof media === 'string' && isURL(media)) { // URL - Meta não suporta upload direto de URL, precisa baixar primeiro
             this.logger?.warn?.('Upload de mídia via URL para Meta API não é suportado diretamente. Baixe primeiro.');
             // Poderia implementar o download aqui antes de anexar ao form-data
             return null;
        } else {
             throw new Error('Formato de mídia inválido para upload.');
        }

        const headers = { ...formData.getHeaders(), Authorization: `Bearer ${this.token}` };
        this.logger?.debug?.(`POST ${urlUpload} (uploading media)`);
        const response = await axios.post(urlUpload, formData, { headers });
        this.logger?.debug?.(`Media Upload Response: ${JSON.stringify(response.data)}`);

        return response.data?.id || null; // Retorna o ID da mídia da Meta

      } catch(e: any) {
        const errorData = e?.response?.data?.error;
        this.logger?.error?.(`Erro no upload de mídia para Meta API: ${JSON.stringify(errorData || e.message)}`);
        throw new InternalServerErrorException(`Falha no upload da mídia: ${errorData?.message || e.message}`);
      }
  }


  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false): Promise<any> {
    const jid = createJid(data.number);
    let mediaContent = data.media; // URL, Base64 ou Path (se adaptado)
    let mediaBuffer: Buffer | undefined;
    let isLocalFile = false;

    // Prioriza 'file' se existir (vem do upload via API)
    if (file?.buffer) {
        mediaBuffer = file.buffer;
        data.fileName = file.originalname || data.fileName; // Usa nome original
        data.mediatype = mimeTypes.extension(file.mimetype) as any || data.mediatype; // Usa mimetype do arquivo
    } else if (isBase64(mediaContent)) {
        mediaBuffer = Buffer.from(mediaContent, 'base64');
    } else if (isURL(mediaContent)) {
        // URL: A API da Meta geralmente requer o ID da mídia (após upload) ou a própria URL pública
    } else {
         // Assume ser um path local - CUIDADO: Isso só funciona se a API rodar no mesmo local dos arquivos
         this.logger?.warn?.('Enviando mídia por path local. Garanta que o arquivo exista no servidor da API.');
         mediaBuffer = createReadStream(mediaContent) as any; // Tratar como stream
         isLocalFile = true;
         // data.fileName = path.basename(mediaContent); // Definir nome do arquivo a partir do path
    }

    const message: any = {
      messaging_product: 'whatsapp',
      to: jid,
      type: data.mediatype, // image, video, audio, document
      // Adicionar contexto se for uma resposta
      ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
    };

    const mediaPayload: any = {
        caption: data.caption,
    };

    // Se temos URL pública, podemos tentar enviar diretamente
    if (isURL(mediaContent) && !mediaBuffer) {
        mediaPayload.link = mediaContent;
         if(data.fileName) mediaPayload.filename = data.fileName; // Adicionar filename para documentos/vídeos
    } else {
        // Se temos buffer/stream, precisamos fazer upload primeiro para obter o ID
        const fileToUpload = mediaBuffer || (isLocalFile ? createReadStream(mediaContent) : null);
        if(!fileToUpload) throw new BadRequestException('Mídia inválida para upload.');

        const mimeType = mimeTypes.lookup(data.fileName || '') || 'application/octet-stream'; // Determina mimetype
        const mediaId = await this.uploadMediaForMeta(fileToUpload, mimeType);
        if (!mediaId) throw new InternalServerErrorException('Falha ao obter ID da mídia da Meta.');
        mediaPayload.id = mediaId;
         if(data.mediatype === 'document' && data.fileName) mediaPayload.filename = data.fileName; // Adicionar filename para documentos
    }

    message[data.mediatype] = mediaPayload;

    this.logger?.info?.(`Enviando mensagem de mídia (${data.mediatype}) para ${jid}`);
    const result = await this.post(message, 'messages');

     // TODO: Salvar a mensagem enviada no banco local e enviar webhooks/eventos
    if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
    return result;
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false): Promise<any> {
      // A API da Meta trata áudio como 'document' ou 'audio'. 'audio' geralmente é para OGG Opus com codec específico.
      // Vamos tratar como 'audio' e fazer upload.
      const mimeType = file?.mimetype || 'audio/ogg'; // Ou o mimetype correto do seu áudio
      const mediaDto: SendMediaDto = {
          number: data.number,
          mediatype: 'audio',
          media: file?.buffer || data.audio, // Buffer ou Base64/URL
          fileName: file?.originalname || `audio.${mimeTypes.extension(mimeType) || 'ogg'}`,
          options: data.options
      };
      return this.mediaMessage(mediaDto, file, isIntegration);
  }

   public async buttonMessage(data: SendButtonsDto, isIntegration = false): Promise<any> {
      const jid = createJid(data.number);
      // API da Meta usa mensagens Interativas para botões
      const message = {
          messaging_product: 'whatsapp',
          to: jid,
          type: 'interactive',
          interactive: {
              type: 'button',
              header: data.title ? { type: 'text', text: data.title } : undefined, // Header opcional
              body: { text: data.description },
              footer: data.footer ? { text: data.footer } : undefined,
              action: {
                  buttons: data.buttons.map(btn => ({
                      type: 'reply',
                      reply: { id: btn.id, title: btn.label }
                  }))
              }
          },
           // Adicionar contexto se for uma resposta
          ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
      };

      this.logger?.info?.(`Enviando mensagem interativa (botões) para ${jid}`);
      const result = await this.post(message, 'messages');

      // TODO: Salvar mensagem e enviar webhooks
      if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
      return result;
   }

   public async listMessage(data: SendListDto, isIntegration = false): Promise<any> {
       const jid = createJid(data.number);
       const message = {
           messaging_product: 'whatsapp',
           to: jid,
           type: 'interactive',
           interactive: {
               type: 'list',
               header: data.title ? { type: 'text', text: data.title } : undefined,
               body: { text: data.description },
               footer: data.footer ? { text: data.footer } : undefined,
               action: {
                   button: data.buttonLabel,
                   sections: data.sections.map(section => ({
                       title: section.title,
                       rows: section.rows.map(row => ({
                           id: row.rowId,
                           title: row.title,
                           description: row.description
                       }))
                   }))
               }
           },
            // Adicionar contexto se for uma resposta
           ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
       };

       this.logger?.info?.(`Enviando mensagem interativa (lista) para ${jid}`);
       const result = await this.post(message, 'messages');

        // TODO: Salvar mensagem e enviar webhooks
       if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
       return result;
   }

    public async locationMessage(data: SendLocationDto, isIntegration = false): Promise<any> {
        const jid = createJid(data.number);
        const message = {
            messaging_product: 'whatsapp',
            to: jid,
            type: 'location',
            location: {
                latitude: data.latitude,
                longitude: data.longitude,
                name: data.name,
                address: data.address
            },
             // Adicionar contexto se for uma resposta
            ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
        };

        this.logger?.info?.(`Enviando mensagem de localização para ${jid}`);
        const result = await this.post(message, 'messages');

         // TODO: Salvar mensagem e enviar webhooks
        if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
        return result;
    }

    public async contactMessage(data: SendContactDto, isIntegration = false): Promise<any> {
         const jid = createJid(data.number);
         // A API da Meta formata contatos de forma diferente (ver documentação oficial)
         // https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#contacts-object
         // Simplificando para enviar um contato por vez
         if (data.contacts.length !== 1) {
             throw new BadRequestException('Meta API atualmente suporta enviar apenas um contato por mensagem.');
         }
         const contactToSend = data.contacts[0];

         const message = {
             messaging_product: 'whatsapp',
             to: jid,
             type: 'contacts',
             contacts: [
                 {
                     name: {
                         formatted_name: contactToSend.fullName,
                         // first_name: "optional", // Pode adicionar se tiver
                         // last_name: "optional",
                     },
                     // Adicionar outros campos se disponíveis (org, birthday, emails, phones, urls)
                     phones: contactToSend.wuid ? [{ phone: contactToSend.wuid.split('@')[0], type: 'CELL', wa_id: contactToSend.wuid.split('@')[0] }] : [] // Precisa formatar o telefone corretamente
                 }
             ],
              // Adicionar contexto se for uma resposta
             ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
         };

         this.logger?.info?.(`Enviando mensagem de contato para ${jid}`);
         const result = await this.post(message, 'messages');

          // TODO: Salvar mensagem e enviar webhooks
         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         return result;
    }

    public async reactionMessage(data: SendReactionDto, isIntegration = false): Promise<any> {
        const jid = createJid(data.number);
        const message = {
            messaging_product: 'whatsapp',
            to: jid,
            type: 'reaction',
            reaction: {
                message_id: data.key.id, // ID da mensagem a reagir
                emoji: data.text // Emoji da reação
            }
        };

        this.logger?.info?.(`Enviando reação para mensagem ${data.key.id} em ${jid}`);
        const result = await this.post(message, 'messages');

         // TODO: Salvar mensagem e enviar webhooks (reações são mensagens tbm)
        if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
        return result;
    }

     public async templateMessage(data: SendTemplateDto, isIntegration = false): Promise<any> {
         const jid = createJid(data.number);
         // A estrutura exata depende do seu template na Meta
         // Veja: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#template-messages
         const message: any = {
             messaging_product: 'whatsapp',
             to: jid,
             type: 'template',
             template: {
                 name: data.templateName,
                 language: {
                     code: data.languageCode // ex: 'pt_BR', 'en_US'
                 },
                 components: data.components // Array de componentes (header, body, footer, buttons)
             }
         };

         this.logger?.info?.(`Enviando mensagem de template '${data.templateName}' para ${jid}`);
         const result = await this.post(message, 'messages');

          // TODO: Salvar mensagem e enviar webhooks
         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         return result;
     }


  // --- Métodos Não Suportados ou Específicos de Baileys ---
  // Mantendo os métodos que lançam exceção para clareza
  public async getBase64FromMediaMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API. Download via getMedia instead.'); }
  public async deleteMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); } // Meta não suporta deletar msg via API
  // ... (outros métodos não suportados mantidos da versão anterior) ...

} // Fim da classe BusinessStartupService
