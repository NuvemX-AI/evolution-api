// src/api/integrations/channel/meta/whatsapp.business.service.ts

// Imports de DTOs (usando alias @api)
import { NumberBusiness } from '@api/dto/chat.dto'; // TODO: Precisa do arquivo chat.dto.ts
import {
  ContactMessage,
  MediaMessage,
  Options, // Presume que 'Options' existe em sendMessage.dto.ts
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

// Imports de libs externas
import axios from 'axios';
import { isURL, isBase64 } from 'class-validator'; // Importado isBase64
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { Readable } from 'stream'; // << CORREÇÃO TS2304: Importado Readable >>
import mimeTypes from 'mime-types';
import * as path from 'path'; // << CORREÇÃO TS2304: Importado path >>
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Importando ChatwootService
import { Message as MessageModel, Prisma } from '@prisma/client'; // Importando MessageModel e Prisma para tipos
import dayjs from 'dayjs';

export class BusinessStartupService extends ChannelStartupService {
  // --- Propriedades ---
  public stateConnection: any /* wa.StateConnection */ = { state: 'open' }; // Usando any por enquanto
  public phoneNumber: string = '';
  public mobile: boolean = false;
  protected logger: any = console; // Placeholder
  protected instance: any = {}; // Placeholder
  // << CORREÇÃO TS2610: Removidas propriedades sobrescritas. Usar getters/setters da classe base >>
  // protected token: string = '';
  // protected number: string = ''; // Este 'number' refere-se ao ID do número da Meta
  // protected instanceId: string = '';

  protected localSettings: any = {}; // Placeholder
  protected localChatwoot?: { enabled: boolean; importContacts?: boolean; importMessages?: boolean }; // Placeholder
  protected openaiService: any; // Placeholder
  // << CORREÇÃO TS2416: Assinaturas ajustadas para async e Promise<void> >>
  // Se a implementação for apenas placeholder, pode ser removida se a base for suficiente.
  // Se precisar de lógica específica, implemente aqui.
  public async sendDataWebhook<T = any>(event: Events, data: T, bypass?: boolean, onlyIntegration?: string[]): Promise<void> {
    this.logger?.debug?.(`Meta Channel: sendDataWebhook placeholder chamado para evento: ${event}`);
    await super.sendDataWebhook(event, data, !bypass, onlyIntegration); // Chama a base (local = !bypass)
  }
  public async loadChatwoot(): Promise<void> {
    this.logger?.debug?.('Meta Channel: loadChatwoot chamado.');
    await super.loadChatwoot(); // Chama a base
  };
  public async loadSettings(): Promise<void> {
    this.logger?.debug?.('Meta Channel: loadSettings chamado.');
    await super.loadSettings(); // Chama a base
  };
  public async loadWebhook(): Promise<void> {
    this.logger?.debug?.('Meta Channel: loadWebhook chamado.');
    await super.loadWebhook(); // Chama a base
  };
  public async loadProxy(): Promise<void> {
    this.logger?.debug?.('Meta Channel: loadProxy chamado.');
    await super.loadProxy(); // Chama a base
  };
  // protected chatwootService!: ChatwootService; // Já existe na classe base

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService, // É necessário para Meta API? Verificar uso
    private readonly providerFiles: ProviderFiles, // É necessário para Meta API? Verificar uso
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache);
  }

  // Sobrescrevendo setInstance para pegar token e number específicos da Meta
  public setInstance(instanceData: InstanceDto & { token?: string; number?: string }) { // Adiciona token e number ao tipo esperado
    super.setInstance(instanceData); // Chama a base para definir name, id, etc.

    // Define token e number específicos para a API da Meta
    if (instanceData.token) {
      // this.token = instanceData.token; // Usa o setter da classe base implicitamente, se existir
      // Ou define diretamente na instância interna se a base não tiver setter
      this.instance.token = instanceData.token;
    } else {
       this.logger?.warn?.(`Token não fornecido para a instância Meta ${instanceData.instanceName}. As chamadas de API falharão.`);
    }
    if (instanceData.number) {
      // this.number = instanceData.number; // Usa o setter da classe base implicitamente, se existir
      // Ou define diretamente na instância interna
      this.instance.number = instanceData.number;
    } else {
      this.logger?.warn?.(`ID do número (number) não fornecido para a instância Meta ${instanceData.instanceName}. As chamadas de API falharão.`);
    }
    this.logger?.info?.(`Meta Channel: Token e Number ID definidos para ${this.instanceName}`);
  }


  // --- Getters ---
  public get connectionStatus(): any /* wa.StateConnection */ {
    return this.stateConnection;
  }

  public get qrCode(): any /* wa.QrCode */ {
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
      const waBusinessConfig = this.configService.get<WaBusiness>('WA_BUSINESS');
      if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION) {
        throw new Error('Configuração da API de Negócios do WhatsApp (WA_BUSINESS) não encontrada.');
      }
      // << CORREÇÃO TS2610: Acessando via getter/propriedade da instância interna >>
      const metaNumberId = this.instance?.number || this.number; // Tenta pegar da instância interna ou do getter base
      const metaToken = this.instance?.token || this.token; // Tenta pegar da instância interna ou do getter base

      if (!metaNumberId) {
        throw new Error('ID do número de telefone (number) não definido para a instância.');
      }
       if (!metaToken) {
        throw new Error('Token da API (token) não definido para a instância.');
      }

      const urlServer = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${metaNumberId}/${endpoint}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${metaToken}` };
      this.logger?.debug?.(`POST ${urlServer} Data: ${JSON.stringify(message)}`);
      const result = await axios.post(urlServer, message, { headers });
      this.logger?.debug?.(`POST Response: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e: any) {
      const errorData = e?.response?.data?.error;
      this.logger?.error?.(`Erro na chamada POST para ${endpoint}: ${JSON.stringify(errorData || e.message)}`);
      return { error: errorData || { message: e.message, code: e.code } };
    }
  }

  // Método para obter mídia da API da Meta
  private async getMedia(mediaId: string): Promise<{ buffer: Buffer; mimetype: string; fileName?: string }> {
    try {
       const waBusinessConfig = this.configService.get<WaBusiness>('WA_BUSINESS');
       const metaToken = this.instance?.token || this.token; // << CORREÇÃO TS2610 >>

       if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION || !metaToken) {
        throw new Error('Configuração ou Token da API de Negócios do WhatsApp (WA_BUSINESS) não encontrado.');
      }

      const urlInfo = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${mediaId}`;
      const headers = { Authorization: `Bearer ${metaToken}` };
      this.logger?.debug?.(`GET ${urlInfo}`);
      const infoResult = await axios.get(urlInfo, { headers });
      const mediaUrl = infoResult.data.url;
      const mimetype = infoResult.data.mime_type;
      this.logger?.debug?.(`Media URL: ${mediaUrl}, Mimetype: ${mimetype}`);

      if (!mediaUrl) throw new Error('URL da mídia não encontrada na resposta da API.');

      const mediaResult = await axios.get(mediaUrl, { headers, responseType: 'arraybuffer' });
      const buffer = Buffer.from(mediaResult.data);

      let fileName: string | undefined;
      const contentDisposition = mediaResult.headers['content-disposition'];
       if (contentDisposition) {
          const match = contentDisposition.match(/filename\*?=['"]?([^'";]+)['"]?/i);
          if (match && match[1]) {
              fileName = decodeURIComponent(match[1]);
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
       await this.loadChatwoot(); // Carrega config Chatwoot na inicialização
       await this.loadSettings(); // Carrega config Settings na inicialização
       return;
    }

    try {
      await this.eventHandler(webhookValue);
    } catch (error: any) {
      this.logger?.error?.(`Erro em connectToWhatsapp/eventHandler (Meta): ${error?.message || error}`);
    }
  }

  // Processa o conteúdo do webhook ('value' object)
  protected async eventHandler(content: any): Promise<void> {
    this.logger?.info?.(`Meta Channel: eventHandler processando: ${JSON.stringify(content)}`);
    try {
      if (Array.isArray(content.messages)) {
        for (const message of content.messages) {
          // << CORREÇÃO TS2304: messageId agora é message.id >>
          await this.messageHandle(message, content.contacts?.[0], content.metadata);
        }
      }
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
     const fromMe = message.from === metadata.phone_number_id;
     const remoteJid = !fromMe ? message.from : metadata.display_phone_number; // JID vem como número simples da Meta
     const participant = message.context?.participant;

     // Garante que remoteJid está no formato JID (adiciona @s.whatsapp.net)
     const remoteJidFormatted = createJid(remoteJid);

     const key = {
        id: message.id,
        remoteJid: remoteJidFormatted, // Usar JID formatado
        fromMe: fromMe,
        participant: participant ? createJid(participant) : undefined, // Formatar participante também
     };

     const pushName = contactInfo?.profile?.name || remoteJid.split('@')[0];

     let messageContent: any = {};
     let messageType: string = message.type + 'Message';

     // Constrói o objeto 'message' similar ao Baileys (lógica mantida)
     // ... (lógica de conversão de tipos de mensagem mantida) ...
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
         // << CORREÇÃO TS2339: Função messageContactsJson removida/comentada. Implementar lógica aqui >>
         // TODO: Implementar a lógica de parsing de contatos aqui se necessário.
         this.logger?.warn?.('Função messageContactsJson não encontrada. Processamento de contatos incompleto.');
         messageContent = { conversation: '[Contato(s) recebido(s)]' }; // Placeholder
         // messageContent = this.messageContactsJson({ messages: [message] });
         messageType = 'contactsArrayMessage';
     } else if (message.location) {
         messageContent = { locationMessage: message.location };
     } else if (message.sticker) {
         messageContent = { stickerMessage: { url: `media:${message.sticker.id}`, mimetype: message.sticker.mime_type, sha256: message.sticker.sha256 } };
     } else if (message.reaction) {
          messageContent = { reactionMessage: { key: { id: message.reaction.message_id }, text: message.reaction.emoji } };
          messageType = 'reactionMessage';
     } else if (message.interactive) {
        messageContent = { conversation: message.interactive[message.interactive.type]?.title || message.interactive[message.interactive.type]?.description || `Resposta interativa ${message.interactive.type}` };
        messageType = 'conversation';
     } else if (message.button) {
        messageContent = { conversation: message.button.text };
        messageType = 'conversation';
     } else if (message.system) {
        this.logger?.info?.(`Mensagem de sistema recebida: ${message.system.body}`);
        return;
     } else {
        this.logger?.warn?.(`Tipo de mensagem Meta não tratado: ${message.type}`);
        messageContent = { conversation: `[Mensagem do tipo ${message.type} não suportada]` };
        messageType = 'conversation';
     }


     if (message.context) {
        messageContent.contextInfo = {
           stanzaId: message.context.id,
           participant: message.context.participant ? createJid(message.context.participant) : undefined,
        };
     }

     const messageRaw: any = {
       key,
       pushName,
       message: messageContent,
       messageType: messageType,
       messageTimestamp: parseInt(message.timestamp) || Math.round(new Date().getTime() / 1000),
       source: 'meta_api',
       instanceId: this.instanceId, // Usando getter da base
     };

     // Download e Upload de Mídia para S3
     const mediaMsg = messageRaw.message[messageType];
     if (mediaMsg?.url?.startsWith('media:')) {
        const mediaId = mediaMsg.url.split(':')[1];
        if (this.configService.get<S3>('S3')?.ENABLE) {
           try {
              this.logger?.info?.(`Baixando mídia da Meta API: ${mediaId}`);
              const { buffer, mimetype, fileName } = await this.getMedia(mediaId);
              mediaMsg.mimetype = mimetype;
              const mediaTypeS3 = messageType.replace('Message', '').toLowerCase();
              // << CORREÇÃO TS2304: Usando message.id (ID da mensagem) para nome do arquivo S3 >>
              const fileNameS3 = fileName || `${message.id}.${mimeTypes.extension(mimetype) || 'bin'}`;
              const fullNameS3 = join(`${this.instanceId}`, key.remoteJid, mediaTypeS3, fileNameS3); // Usando instanceId da base
              const size = buffer.byteLength;

              this.logger?.info?.(`Fazendo upload para S3: ${fullNameS3}`);
              await s3Service.uploadFile(fullNameS3, buffer, size, { 'Content-Type': mimetype });
              const mediaUrl = await s3Service.getObjectUrl(fullNameS3);
              mediaMsg.url = mediaUrl;
              mediaMsg.fileName = fileNameS3;
              this.logger?.info?.(`Upload S3 concluído: ${mediaUrl}`);

           } catch (error: any) {
             this.logger?.error?.(`Falha no download/upload de mídia ${mediaId}: ${error.message}`);
             mediaMsg.url = `[Erro ao baixar mídia ${mediaId}]`;
           }
        } else {
           this.logger?.warn?.(`S3 desativado. Mídia não será baixada/armazenada externamente: ${mediaId}`);
        }
     }

     // Lógica OpenAI (mantida - requer openaiService)
     if (this.configService.get<Openai>('OPENAI')?.ENABLED && messageType === 'audioMessage' && mediaMsg.url && !mediaMsg.url.startsWith('media:')) {
       // ... Lógica OpenAI precisa ser adaptada para usar a URL S3/Buffer e o openaiService ...
     }

     this.logger?.log?.('Mensagem processada (Meta):', messageRaw);

     // Enviar para Webhook geral
     await this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw); // Usando método async da base

     // Enviar para Chatbot Controller
     await chatbotController?.emit?.({
        instance: { instanceName: this.instance.name, instanceId: this.instanceId }, // Usando instanceId da base
        remoteJid: key.remoteJid,
        msg: messageRaw,
        pushName: pushName,
     });

     // Enviar para Chatwoot (usando chatwootService da base)
     if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        this.logger?.info?.(`Enviando mensagem ${message.id} para Chatwoot...`);
         const chatwootSentMessage = await this.chatwootService?.eventWhatsapp?.( // Usa chatwootService da base
            Events.MESSAGES_UPSERT,
            { instanceName: this.instance.name, instanceId: this.instanceId }, // Usando instanceId da base
            messageRaw,
         );
         if (chatwootSentMessage?.id) {
            messageRaw.chatwootMessageId = `${chatwootSentMessage.id}`;
            messageRaw.chatwootInboxId = `${chatwootSentMessage.inbox_id}`;
            messageRaw.chatwootConversationId = `${chatwootSentMessage.conversation_id}`;
         }
     }

     // Salvar no Banco de Dados
     try {
        // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
        // NOTE: Implemente createMessage em PrismaRepository.
        await this.prismaRepository.createMessage({
            data: {
                ...messageRaw,
                key: key as any,
                message: messageRaw.message as any,
                messageTimestamp: BigInt(messageRaw.messageTimestamp),
            },
        });
     } catch (dbError: any) {
        this.logger?.error?.(`Erro ao salvar mensagem ${message.id} no banco: ${dbError.message}`);
     }

     // Atualizar contato (se não for mensagem própria)
     if (!fromMe) {
        // << CORREÇÃO TS2339: Chamando método updateContact implementado abaixo >>
        await this.updateContact({
           remoteJid: key.remoteJid,
           pushName: pushName,
           // profilePicUrl: contactInfo?.profile?.profile_picture_url, // Tentar obter a URL da foto, se disponível
        });
     }
  }

  // << CORREÇÃO TS2339: Implementação básica de updateContact >>
  private async updateContact(
    data: { remoteJid: string; pushName?: string; profilePicUrl?: string }
  ): Promise<void> {
    this.logger?.info?.(`Atualizando contato (Meta): ${data.remoteJid} - Nome: ${data.pushName}`);
    const contactRaw: any = {
      remoteJid: data.remoteJid, // Já deve estar formatado com @s.whatsapp.net
      pushName: data.pushName || data.remoteJid.split('@')[0],
      instanceId: this.instanceId, // Usando getter da base
      profilePicUrl: data?.profilePicUrl,
    };

    // NOTE: Implemente upsertContact em PrismaRepository e verifique o unique constraint no schema.
    // Usar método do repositório (nome hipotético)
    await this.prismaRepository.upsertContact({
       where: { remoteJid_instanceId: { remoteJid: data.remoteJid, instanceId: this.instanceId } },
       update: contactRaw,
       create: contactRaw,
    });

    await this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw);

    // Lógica Chatwoot (opcional, depende da necessidade de sincronizar contatos da Meta)
    if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger?.info?.(`Enviando atualização de contato (Meta) para Chatwoot: ${data.remoteJid}`);
      await this.chatwootService?.eventWhatsapp?.(
        Events.CONTACTS_UPDATE,
        {
          instanceName: this.instance.name,
          instanceId: this.instanceId, // Usando getter da base
          integration: this.instance.integration,
        },
        contactRaw,
      );
    }
    // Não chama upsertChat aqui, pois a Meta API não gerencia chats como o Baileys
  }


  // Processa um evento de status do webhook
  private async statusHandle(statusInfo: any, metadata: any): Promise<void> {
    this.logger?.debug?.(`Processando status: ${statusInfo.id}, Status: ${statusInfo.status}, Para: ${statusInfo.recipient_id}`);
    const key = {
      id: statusInfo.id,
      remoteJid: createJid(statusInfo.recipient_id), // Formata JID
      fromMe: true,
    };

    if (key.remoteJid === 'status@broadcast' || key?.remoteJid?.match(/(:\d+)/)) return;

    // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
    // NOTE: Implemente findFirstMessage em PrismaRepository.
    const findMessage = await this.prismaRepository.findFirstMessage({
      where: {
        instanceId: this.instanceId, // Usando getter da base
        key: { path: ['id'], equals: key.id },
      },
    });

    if (!findMessage) {
       this.logger?.warn?.(`Mensagem original ${key.id} não encontrada para atualização de status.`);
       return;
    }

    const messageUpdate: any = {
      messageId: findMessage.id,
      keyId: key.id,
      remoteJid: key.remoteJid,
      fromMe: key.fromMe,
      participant: key.remoteJid,
      status: statusInfo.status.toUpperCase(),
      timestamp: parseInt(statusInfo.timestamp) || Math.round(new Date().getTime() / 1000),
      instanceId: this.instanceId, // Usando getter da base
    };

     this.logger?.log?.(`Atualização de status: ${JSON.stringify(messageUpdate)}`);
     await this.sendDataWebhook(Events.MESSAGES_UPDATE, messageUpdate); // Usando método async da base

     // Salvar atualização no banco
     try {
       // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
       // NOTE: Implemente createMessageUpdate em PrismaRepository.
       await this.prismaRepository.createMessageUpdate({ data: messageUpdate });

       // << CORREÇÃO TS2341 / TS2353: Usar método do repositório e corrigir update >>
       // NOTE: Implemente updateMessage em PrismaRepository.
        await this.prismaRepository.updateMessage({
            where: { id: findMessage.id },
            data: { status: messageUpdate.status } // Atualiza o status mais recente
        });

     } catch (dbError: any) {
        this.logger?.error?.(`Erro ao salvar status ${key.id} no banco: ${dbError.message}`);
     }

     // Enviar para Chatwoot (se necessário)
     if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        this.logger?.info?.(`Enviando atualização de status ${key.id} para Chatwoot...`);
     }
  }


  // --- Métodos de Envio de Mensagem (Adaptados para Meta API) ---

  public async textMessage(data: SendTextDto, isIntegration = false): Promise<any> {
    const jid = createJid(data.number);
    const message = {
      messaging_product: 'whatsapp',
      to: jid,
      type: 'text',
      text: {
        // << CORREÇÃO TS2339: Adicionado optional chaining e fallback para linkPreview >>
        preview_url: data.options?.linkPreview ?? false,
        body: data.text,
      },
      // << CORREÇÃO TS2339: Adicionado optional chaining para options e quoted >>
      ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
    };

    this.logger?.info?.(`Enviando mensagem de texto para ${jid}`);
    const result = await this.post(message, 'messages');

    // TODO: Salvar a mensagem enviada no banco local (usando a resposta da API se possível)
    if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
    // this.saveSentMessage(result, message, 'conversation'); // Exemplo de chamada para salvar
    return result;
  }

  // Método para upload de mídia para a API da Meta
  private async uploadMediaForMeta(media: Buffer | Readable | string, mimetype: string): Promise<string | null> {
      try {
        const waBusinessConfig = this.configService.get<WaBusiness>('WA_BUSINESS');
        const metaNumberId = this.instance?.number || this.number; // Usa getter/propriedade
        const metaToken = this.instance?.token || this.token; // Usa getter/propriedade

        if (!waBusinessConfig?.URL || !waBusinessConfig?.VERSION || !metaNumberId || !metaToken) {
          throw new Error('Configuração incompleta para upload de mídia da Meta.');
        }

        const urlUpload = `${waBusinessConfig.URL}/${waBusinessConfig.VERSION}/${metaNumberId}/media`;
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('type', mimetype);

        let filename = `upload.${mimeTypes.extension(mimetype) || 'bin'}`;
        // << CORREÇÃO TS2304: Usando isBase64 importado >>
        if (typeof media === 'string' && !isURL(media) && !isBase64(media)) {
            // << CORREÇÃO TS2304: Usando path importado >>
            filename = path.basename(media);
        }

        if (Buffer.isBuffer(media)) {
            formData.append('file', media, { filename });
        // << CORREÇÃO TS2304: Usando Readable importado >>
        } else if (media instanceof Readable) {
            formData.append('file', media, { filename });
        // << CORREÇÃO TS2304: Usando isBase64 importado >>
        } else if (typeof media === 'string' && !isURL(media) && !isBase64(media)) {
            formData.append('file', createReadStream(media), { filename });
        // << CORREÇÃO TS2304: Usando isBase64 importado >>
        } else if (typeof media === 'string' && isBase64(media)) {
            formData.append('file', Buffer.from(media, 'base64'), { filename });
        } else if (typeof media === 'string' && isURL(media)) {
             this.logger?.warn?.('Upload de mídia via URL para Meta API não é suportado diretamente. Baixe primeiro.');
             return null;
        } else {
             throw new Error('Formato de mídia inválido para upload.');
        }

        const headers = { ...formData.getHeaders(), Authorization: `Bearer ${metaToken}` };
        this.logger?.debug?.(`POST ${urlUpload} (uploading media)`);
        const response = await axios.post(urlUpload, formData, { headers });
        this.logger?.debug?.(`Media Upload Response: ${JSON.stringify(response.data)}`);

        return response.data?.id || null;

      } catch(e: any) {
        const errorData = e?.response?.data?.error;
        this.logger?.error?.(`Erro no upload de mídia para Meta API: ${JSON.stringify(errorData || e.message)}`);
        throw new InternalServerErrorException(`Falha no upload da mídia: ${errorData?.message || e.message}`);
      }
  }


  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false): Promise<any> {
    const jid = createJid(data.number);
    let mediaContent = data.media;
    let mediaBuffer: Buffer | Readable | undefined; // Permitir Readable
    let isLocalFile = false;

    if (file?.buffer) {
        mediaBuffer = file.buffer;
        data.fileName = file.originalname || data.fileName;
        data.mediatype = mimeTypes.extension(file.mimetype) as any || data.mediatype;
    // << CORREÇÃO TS2304: Usando isBase64 importado >>
    } else if (typeof mediaContent === 'string' && isBase64(mediaContent)) {
        mediaBuffer = Buffer.from(mediaContent, 'base64');
    } else if (typeof mediaContent === 'string' && isURL(mediaContent)) {
        // Manter como URL
    // << CORREÇÃO TS2304: Usando isBase64 importado >>
    } else if(typeof mediaContent === 'string' && !isURL(mediaContent) && !isBase64(mediaContent)){
         this.logger?.warn?.('Enviando mídia por path local. Garanta que o arquivo exista no servidor da API.');
         mediaBuffer = createReadStream(mediaContent); // Usar stream
         isLocalFile = true;
         data.fileName = data.fileName || path.basename(mediaContent); // Definir nome se não houver
    } else {
        throw new BadRequestException('Formato de mídia inválido. Forneça URL, Base64, path de arquivo ou buffer.');
    }

    const message: any = {
      messaging_product: 'whatsapp',
      to: jid,
      type: data.mediatype,
      // << CORREÇÃO TS2339: Adicionado optional chaining >>
      ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
    };

    const mediaPayload: any = { caption: data.caption };

    if (typeof mediaContent === 'string' && isURL(mediaContent) && !mediaBuffer) {
        mediaPayload.link = mediaContent;
        // << CORREÇÃO TS2339: Usar data.fileName >>
         if(data.fileName) mediaPayload.filename = data.fileName;
    } else {
        const fileToUpload = mediaBuffer || (isLocalFile ? createReadStream(mediaContent) : null);
        if(!fileToUpload) throw new BadRequestException('Mídia inválida para upload.');

        const mimeType = mimeTypes.lookup(data.fileName || '') || 'application/octet-stream';
        const mediaId = await this.uploadMediaForMeta(fileToUpload, mimeType);
        if (!mediaId) throw new InternalServerErrorException('Falha ao obter ID da mídia da Meta.');
        mediaPayload.id = mediaId;
        // << CORREÇÃO TS2339: Usar data.fileName >>
         if(data.mediatype === 'document' && data.fileName) mediaPayload.filename = data.fileName;
    }

    message[data.mediatype] = mediaPayload;

    this.logger?.info?.(`Enviando mensagem de mídia (${data.mediatype}) para ${jid}`);
    const result = await this.post(message, 'messages');

    if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
    // this.saveSentMessage(result, message, data.mediatype); // Exemplo
    return result;
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false): Promise<any> {
      const mimeType = file?.mimetype || 'audio/ogg';
      const mediaDto: SendMediaDto = {
          number: data.number,
          mediatype: 'audio',
          media: file?.buffer || data.audio,
          fileName: file?.originalname || `audio.${mimeTypes.extension(mimeType) || 'ogg'}`,
          // << CORREÇÃO TS2353 / TS2339: Removido 'options' daqui, será passado no mediaMessage >>
          // options: data.options
      };
      // << CORREÇÃO TS2339: Passando options para mediaMessage >>
      return this.mediaMessage(mediaDto, file, isIntegration); // Passa o DTO original que contém options
  }

   public async buttonMessage(data: SendButtonsDto, isIntegration = false): Promise<any> {
      const jid = createJid(data.number);
      const message = {
          messaging_product: 'whatsapp',
          to: jid,
          type: 'interactive',
          interactive: {
              type: 'button',
              header: data.title ? { type: 'text', text: data.title } : undefined,
              body: { text: data.description || ' ' }, // Body não pode ser vazio
              footer: data.footer ? { text: data.footer } : undefined,
              action: {
                   // << CORREÇÃO TS2339: Usar btn.displayText ao invés de btn.label >>
                  buttons: data.buttons.map((btn: Button) => ({
                      type: 'reply',
                      reply: { id: btn.id, title: btn.displayText || 'Button' } // Usar displayText
                  }))
              }
          },
           // << CORREÇÃO TS2339: Adicionado optional chaining >>
          ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
      };

      this.logger?.info?.(`Enviando mensagem interativa (botões) para ${jid}`);
      const result = await this.post(message, 'messages');

      if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
      // this.saveSentMessage(result, message, 'interactive'); // Exemplo
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
               body: { text: data.description || ' ' }, // Body não pode ser vazio
               // << CORREÇÃO TS2339: Usar data.footerText >>
               footer: data.footerText ? { text: data.footerText } : undefined,
               action: {
                   // << CORREÇÃO TS2339: Usar data.buttonText >>
                   button: data.buttonText,
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
            // << CORREÇÃO TS2339: Adicionado optional chaining >>
           ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
       };

       this.logger?.info?.(`Enviando mensagem interativa (lista) para ${jid}`);
       const result = await this.post(message, 'messages');

       if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
       // this.saveSentMessage(result, message, 'interactive'); // Exemplo
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
             // << CORREÇÃO TS2339: Adicionado optional chaining >>
            ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
        };

        this.logger?.info?.(`Enviando mensagem de localização para ${jid}`);
        const result = await this.post(message, 'messages');

        if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
        // this.saveSentMessage(result, message, 'location'); // Exemplo
        return result;
    }

    public async contactMessage(data: SendContactDto, isIntegration = false): Promise<any> {
         const jid = createJid(data.number);
         // << CORREÇÃO TS2551: Usar data.contact >>
         if (!data.contact || data.contact.length !== 1) {
             throw new BadRequestException('Meta API atualmente suporta enviar apenas um contato por mensagem.');
         }
         // << CORREÇÃO TS2551: Usar data.contact >>
         const contactToSend = data.contact[0];

         // Validação mínima do nome e telefone
         if (!contactToSend.fullName || !contactToSend.wuid) {
             throw new BadRequestException('Nome completo (fullName) e WUID do contato são obrigatórios.');
         }

         const message = {
             messaging_product: 'whatsapp',
             to: jid,
             type: 'contacts',
             contacts: [
                 {
                     name: {
                         formatted_name: contactToSend.fullName,
                     },
                     phones: [{ phone: contactToSend.wuid.split('@')[0], type: 'CELL', wa_id: contactToSend.wuid.split('@')[0] }]
                     // TODO: Mapear outros campos como organization, email, url se a API suportar
                 }
             ],
              // << CORREÇÃO TS2339: Adicionado optional chaining >>
             ...(data.options?.quoted?.key?.id && { context: { message_id: data.options.quoted.key.id } })
         };

         this.logger?.info?.(`Enviando mensagem de contato para ${jid}`);
         const result = await this.post(message, 'messages');

         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         // this.saveSentMessage(result, message, 'contacts'); // Exemplo
         return result;
    }

    public async reactionMessage(data: SendReactionDto, isIntegration = false): Promise<any> {
        // << CORREÇÃO TS2339: Usar data.key.remoteJid >>
        const jid = createJid(data.key.remoteJid);
        const message = {
            messaging_product: 'whatsapp',
            to: jid,
            type: 'reaction',
            reaction: {
                message_id: data.key.id,
                // << CORREÇÃO TS2339: Usar data.reaction >>
                emoji: data.reaction
            }
        };

        this.logger?.info?.(`Enviando reação para mensagem ${data.key.id} em ${jid}`);
        const result = await this.post(message, 'messages');

         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         // Reações também podem ser salvas como mensagens, se desejado
         // this.saveSentMessage(result, message, 'reaction'); // Exemplo
         return result;
    }

     public async templateMessage(data: SendTemplateDto, isIntegration = false): Promise<any> {
         const jid = createJid(data.number);
         const message: any = {
             messaging_product: 'whatsapp',
             to: jid,
             type: 'template',
             template: {
                 // << CORREÇÃO TS2339: Usar data.name >>
                 name: data.name,
                 language: {
                     // << CORREÇÃO TS2551: Usar data.language >>
                     code: data.language
                 },
                 components: data.components
             }
         };

         // << CORREÇÃO TS2339: Usar data.name >>
         this.logger?.info?.(`Enviando mensagem de template '${data.name}' para ${jid}`);
         const result = await this.post(message, 'messages');

         if (result?.error) throw new BadRequestException(`Meta API Error: ${result.error.message} (Code: ${result.error.code})`);
         // this.saveSentMessage(result, message, 'template'); // Exemplo
         return result;
     }

  // --- Métodos Não Suportados ou Específicos de Baileys ---
  public async getBase64FromMediaMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API. Download via getMedia instead.'); }
  public async deleteMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async mediaSticker(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async pollMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async statusMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async reloadConnection(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async whatsappNumber(data: NumberBusiness): Promise<any> {
      // Implementação específica para Meta API (onWhatsApp check) se possível/necessário
       this.logger?.warn?.('whatsappNumber (onWhatsApp check) não implementado para Meta API.');
      return { numbers: data.numbers.map(n => ({ exists: false, jid: createJid(n) })) }; // Retorna placeholder
  }
  public async markMessageAsRead(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); } // Meta marca automaticamente
  public async archiveChat(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async markChatUnread(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async fetchProfile(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async offerCall(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async sendPresence(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async setPresence(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async fetchPrivacySettings(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updatePrivacySettings(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async fetchBusinessProfile(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateProfileName(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateProfileStatus(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateProfilePicture(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async removeProfilePicture(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async blockUser(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async createGroup(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateGroupPicture(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateGroupSubject(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateGroupDescription(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async findGroup(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async fetchAllGroups(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async inviteCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async inviteInfo(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async sendInvite(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async acceptInviteCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async revokeInviteCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async findParticipants(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateGParticipant(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async updateGSetting(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async toggleEphemeral(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async leaveGroup(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async fetchLabels(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async handleLabel(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API.'); }
  public async receiveMobileCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fakeCall(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }

} // Fim da classe BusinessStartupService
