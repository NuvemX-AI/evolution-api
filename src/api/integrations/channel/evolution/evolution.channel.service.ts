// src/api/integrations/channel/evolution/evolution.channel.service.ts

// Imports de DTOs e Tipos (usando aliases @api)
import { InstanceDto } from '@api/dto/instance.dto';
import {
  MediaMessage,
  Options,
  SendAudioDto,
  SendButtonsDto,
  SendMediaDto,
  SendTextDto,
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

// TODO: Verificar/Implementar classe base 'ChannelStartupService' para corrigir erros TS2415
export class EvolutionStartupService extends ChannelStartupService {
  // --- Propriedades ---
  // TODO: Definir/Inicializar corretamente estas propriedades (provavelmente herdadas ou no construtor)
  public client: any = null; // Tipo 'any' como placeholder
  public stateConnection: any = { state: 'open' }; // Usando 'any' no lugar de wa.StateConnection
  public phoneNumber: string = '';
  public mobile: boolean = false;
  protected instance: any = {}; // Tipo 'any' como placeholder
  // protected instanceId: string = ''; // REMOVIDO - Causa erro TS2610 (deve ser herdado ou gerenciado de outra forma)

  // TODO: Definir/Inicializar estas propriedades (herdadas ou injetadas?)
  protected logger: any = console; // Placeholder - Usar Logger real quando disponível
  protected openaiService: any; // Placeholder para OpenaiService
  protected chatwootService: any; // Placeholder para ChatwootService
  protected localChatwoot?: { enabled: boolean; importContacts?: boolean }; // Placeholder
  protected localSettings: any = {}; // Placeholder para configurações locais
  protected sendDataWebhook: (event: string, data: any, bypass?: boolean, onlyIntegration?: string[]) => void = () => {}; // Placeholder

  // TODO: O construtor deve receber CacheService e possivelmente outros via DI
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService, // Adicionado
    public readonly chatwootCache: CacheService, // Adicionado
  ) {
    // TODO: Verificar assinatura do construtor de ChannelStartupService (TS2415)
    super(configService, eventEmitter, prismaRepository, chatwootCache);
    this.client = null; // Exemplo de inicialização placeholder
    this.instanceId = ''; // Inicialização placeholder, gerenciar corretamente
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
    this.logger?.setInstance?.(instanceData.instanceId); // Assumindo que logger tem setInstance

    this.instance.name = instanceData.instanceName;
    this.instance.id = instanceData.instanceId;
    this.instance.integration = instanceData.integration;
    this.instance.number = instanceData.number;
    this.instance.token = instanceData.token;
    this.instance.businessId = instanceData.businessId;
    this.instanceId = instanceData.instanceId; // Definindo instanceId aqui

    this.logger?.info?.(`Evolution Channel: Instância ${instanceData.instanceName} (${instanceData.instanceId}) definida.`);

    // Lógica Chatwoot mantida, mas depende de `localChatwoot` e `chatwootService`
    if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger?.info?.(`Enviando status ${Events.STATUS_INSTANCE} para Chatwoot`);
      this.chatwootService?.eventWhatsapp?.( // TODO: Verificar se 'eventWhatsapp' existe no ChatwootService
        Events.STATUS_INSTANCE,
        {
          instanceName: this.instance.name,
          instanceId: this.instance.id,
          integration: instanceData.integration,
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
      // this.loadChatwoot?.(); // TODO: Verificar se este método existe/é necessário
      this.logger?.info?.('Nenhum dado recebido, possivelmente apenas inicializando.');
      return;
    }

    try {
      await this.eventHandler(data); // Processa o evento/webhook recebido
    } catch (error: any) {
      this.logger?.error?.(`Erro em connectToWhatsapp/eventHandler: ${error?.message || error}`);
      // Não relançar InternalServerError aqui, pois pode ser um webhook
      // Apenas logar o erro. O chamador (MetaController) já lida com a resposta HTTP.
    }
  }

  // --- Processamento de Eventos ---
  // Este método parece ser o ponto central de entrada para webhooks/eventos simulados
  protected async eventHandler(received: any): Promise<void> {
    this.logger?.info?.(`Evolution Channel: eventHandler processando: ${JSON.stringify(received)}`);
    try {
      let messageRaw: any;

      // Assumindo uma estrutura de webhook onde 'message' indica uma mensagem recebida
      if (received.message) {
        const key = {
          id: received.key?.id || v4(), // Usa ID recebido ou gera um novo
          remoteJid: received.key?.remoteJid, // De onde veio a mensagem
          fromMe: received.key?.fromMe || false, // É minha? (Provavelmente false para webhook)
          participant: received.key?.participant, // Se for grupo
          // Adicionando profilePicUrl se disponível no payload do webhook
          // profilePicUrl: received.profilePicUrl,
        };

        // Validação mínima da chave
        if (!key.remoteJid) {
          this.logger?.warn?.('Mensagem recebida sem remoteJid no evento:', received);
          return;
        }

        messageRaw = {
          key,
          pushName: received.pushName || 'Unknown', // Nome de quem enviou
          message: received.message, // Conteúdo da mensagem (texto, mídia, etc.)
          messageType: received.messageType || 'conversation', // Tipo da mensagem
          // Usar timestamp do evento se disponível, senão o atual
          messageTimestamp: received.messageTimestamp || Math.round(new Date().getTime() / 1000),
          source: 'evolution_channel', // Indicando a origem
          instanceId: this.instanceId,
        };

        const isAudio = messageRaw.messageType === 'audioMessage'; // Verifica se é áudio

        // Lógica OpenAI (mantida, mas depende de OpenaiService e Prisma)
        if (this.configService.get<Openai>('OPENAI')?.ENABLED && isAudio) {
          // TODO: Precisa do schema.prisma para confirmar nomes e relações
          const openAiDefaultSettings = await this.prismaRepository.prisma.openaiSetting.findFirst({
            where: { instanceId: this.instanceId }, // Erro TS2353 aqui - 'instanceId' existe em OpenaiSettingWhereInput?
            include: { openaiCreds: true }, // Corrigido para nome de relação provável (lowercase) - Erro TS2353 aqui - 'openaiCreds' existe?
          });

          // TODO: Verificar os campos retornados por Prisma após generate
          if (
            openAiDefaultSettings &&
            openAiDefaultSettings.openaiCredsId && // Erro TS2339 aqui - Existe 'openaiCredsId'?
            openAiDefaultSettings.speechToText && // Erro TS2339 aqui - Existe 'speechToText'?
            messageRaw.message?.audioMessage // Garante que é uma mensagem de áudio
          ) {
             this.logger?.info?.('Tentando Speech-to-Text com OpenAI...');
            // TODO: Precisa da definição/implementação de OpenaiService
            messageRaw.message.speechToText = await this.openaiService?.speechToText?.(
              openAiDefaultSettings.openaiCreds, // Passando a relação corrigida
              received, // Passando o evento original? Ou messageRaw? Verificar o que speechToText espera
              // this.client?.updateMediaMessage, // 'client' provavelmente não existe/é diferente aqui
              () => {}, // Função placeholder para updateMediaMessage
            );
          }
        }

        this.logger?.log?.('Mensagem processada:', messageRaw);

        // Envia para webhooks configurados
        this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw); // TODO: Precisa da definição de Events e sendDataWebhook

        // Emite evento para chatbots
        await chatbotController?.emit?.({ // TODO: Precisa de chatbotController
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
        });

        // Lógica Chatwoot (mantida, mas depende de ChatwootService)
        if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
          this.logger?.info?.('Enviando mensagem para Chatwoot...');
          const chatwootSentMessage = await this.chatwootService?.eventWhatsapp?.( // TODO: Verificar se 'eventWhatsapp' existe
            Events.MESSAGES_UPSERT,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            messageRaw,
          );

          // Salva IDs do Chatwoot se a mensagem foi enviada
          if (chatwootSentMessage?.id) {
             this.logger?.info?.(`Mensagem salva no Chatwoot com ID: ${chatwootSentMessage.id}`);
            messageRaw.chatwootMessageId = `${chatwootSentMessage.id}`; // Garantir string
            messageRaw.chatwootInboxId = `${chatwootSentMessage.inbox_id}`; // Garantir string
            messageRaw.chatwootConversationId = `${chatwootSentMessage.conversation_id}`; // Garantir string
          }
        }

        // Salva mensagem no banco de dados
        // TODO: Precisa do schema.prisma - garantir que os campos/tipos correspondem
        await this.prismaRepository.prisma.message.create({
          data: {
            ...messageRaw,
            // Garantir que tipos complexos como 'key' e 'message' sejam tratados (podem precisar ser JSON)
            key: messageRaw.key as any, // Usar 'as any' ou tipo correto do Prisma
            message: messageRaw.message as any, // Usar 'as any' ou tipo correto do Prisma
            messageTimestamp: BigInt(messageRaw.messageTimestamp), // Converter para BigInt se o schema usar BigInt
          },
        });

        // Atualiza contato
        await this.updateContact({
          remoteJid: messageRaw.key.remoteJid,
          pushName: messageRaw.pushName,
          profilePicUrl: received.profilePicUrl, // Usando a URL do evento se disponível
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
      pushName: data.pushName || data.remoteJid.split('@')[0], // Nome padrão se ausente
      instanceId: this.instanceId,
      profilePicUrl: data?.profilePicUrl,
    };

    // TODO: Precisa do schema.prisma para confirmar nomes de campos e o índice unique (remoteJid_instanceId)
    await this.prismaRepository.prisma.contact.upsert({
       where: { remoteJid_instanceId: { remoteJid: data.remoteJid, instanceId: this.instanceId } },
       update: contactRaw,
       create: contactRaw,
    });


    this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw); // TODO: Precisa de Events e sendDataWebhook

    // Lógica Chatwoot
    if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
       this.logger?.info?.(`Enviando atualização de contato para Chatwoot: ${data.remoteJid}`);
      await this.chatwootService?.eventWhatsapp?.( // TODO: Verificar se 'eventWhatsapp' existe
        Events.CONTACTS_UPDATE,
        {
          instanceName: this.instance.name,
          instanceId: this.instanceId,
          integration: this.instance.integration,
        },
        contactRaw,
      );
    }

    // Atualiza ou cria chat relacionado
    await this.upsertChat(data.remoteJid);
  }

  private async upsertChat(remoteJid: string): Promise<void> {
    const chatRaw: any = {
      remoteJid: remoteJid,
      instanceId: this.instanceId,
      // Adicione outros campos do chat se necessário/disponível (name, unreadCount, etc.)
    };

    // TODO: Precisa do schema.prisma para confirmar índice unique (instanceId_remoteJid)
    const chat = await this.prismaRepository.prisma.chat.upsert({
        where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: remoteJid } },
        update: { updatedAt: new Date() }, // Apenas atualiza timestamp por exemplo
        create: chatRaw,
     });

     if (chat) { // Se o upsert resultou em criação ou atualização
       this.sendDataWebhook(Events.CHATS_UPSERT, chatRaw); // TODO: Precisa de Events e sendDataWebhook
     }
  }

  // --- Envio de Mensagens ---
  // TODO: Implementar a lógica real de envio para o canal "Evolution".
  //       Atualmente está apenas preparando e salvando a mensagem, mas não a envia.
  protected async sendMessageWithTyping(
    number: string,
    messageContent: any, // Conteúdo da mensagem (texto, mídia, botões, etc.)
    options?: Options,
    file?: any, // Para upload de mídia
    isIntegration = false, // Flag para diferenciar msgs de integração
  ): Promise<any> { // TODO: Definir tipo de retorno mais específico
    this.logger?.info?.(`Evolution Channel: Preparando sendMessageWithTyping para ${number}`);
    try {
      const messageId = v4(); // ID único para a mensagem
      const remoteJid = createJid(number); // Garante formato JID
      let quoted: any = undefined;
      let messageType = 'conversation'; // Padrão

      // Processa mensagem citada (quoted)
      if (options?.quoted?.key) {
        // TODO: Buscar a mensagem original no DB para preencher contextInfo se necessário
        quoted = options.quoted.key; // Usando a chave fornecida diretamente por enquanto
        messageContent.contextInfo = { ...(messageContent.contextInfo || {}), quotedMessage: options.quoted.message, stanzaId: options.quoted.key.id };
      }

      // Prepara o objeto base da mensagem
      const messageRaw: any = {
        key: { fromMe: true, id: messageId, remoteJid },
        message: messageContent,
        messageType: 'unknown', // Será definido abaixo
        messageTimestamp: Math.round(new Date().getTime() / 1000),
        webhookUrl: options?.webhookUrl,
        source: 'evolution_channel',
        instanceId: this.instanceId,
        status: 'PENDING', // Adicionado status inicial
      };

      // Adapta a estrutura da mensagem com base no tipo
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
        messageRaw.message = { audioMessage: { mimetype: messageContent.mimetype, ptt: messageContent.ptt, ...messageContent.audioMessage } };
      } else if (messageContent.documentMessage || messageContent.mediaType === 'document') {
        messageType = 'documentMessage';
        messageRaw.message = { documentMessage: { mimetype: messageContent.mimetype, fileName: messageContent.fileName, ...messageContent.documentMessage } };
      } else if (messageContent.buttonMessage) {
         messageType = 'buttonsMessage'; // Ou talvez interactiveMessage? Verificar Baileys/Meta
         messageRaw.message = { buttonsMessage: messageContent.buttonMessage };
      } else if (messageContent.listMessage) {
         messageType = 'listMessage';
         messageRaw.message = { listMessage: messageContent.listMessage };
      } else {
        // Tipo desconhecido, tentar tratar como texto
        this.logger?.warn?.(`Tipo de mensagem não explicitamente tratado em sendMessageWithTyping: ${JSON.stringify(messageContent)}. Tratando como 'conversation'.`);
        messageRaw.message = { conversation: JSON.stringify(messageContent) }; // Fallback
      }
      messageRaw.messageType = messageType;

      // Adiciona contextInfo se existir (ex: quoted)
      if (messageContent.contextInfo) {
        messageRaw.contextInfo = messageContent.contextInfo;
      }

      // Processamento de Mídia (Upload para S3 se configurado)
      const mediaContent = messageRaw.message[messageType];
      if (mediaContent && (file || isBase64(mediaContent.media) || isURL(mediaContent.media))) {
        if (this.configService.get<S3>('S3')?.ENABLE) {
          try {
            let buffer: Buffer;
            let originalFilename = file?.originalname || mediaContent.fileName || `${messageId}.${mimeTypes.extension(mediaContent.mimetype || 'bin') || 'bin'}`;
            let mimetype = file?.mimetype || mediaContent.mimetype || 'application/octet-stream';

            if (file?.buffer) {
              buffer = file.buffer;
            } else if (isBase64(mediaContent.media)) {
              buffer = Buffer.from(mediaContent.media, 'base64');
              delete mediaContent.media; // Remover base64 após converter
            } else if (isURL(mediaContent.media)) {
              this.logger?.info?.(`Baixando mídia de URL: ${mediaContent.media}`);
              const response = await axios.get(mediaContent.media, { responseType: 'arraybuffer' });
              buffer = Buffer.from(response.data);
              mimetype = response.headers['content-type'] || mimetype; // Usa mimetype da resposta se disponível
              // Tenta pegar nome do arquivo da URL
              try { originalFilename = new URL(mediaContent.media).pathname.split('/').pop() || originalFilename; } catch { /* ignora erro de URL inválida */ }
              mediaContent.mediaUrl = mediaContent.media; // Mantem a URL original
              delete mediaContent.media;
            }

            if (buffer) {
              const mediaTypeS3 = messageType.replace('Message', '').toLowerCase(); // image, video, audio, document
              const fileNameS3 = `${messageId}.${mimeTypes.extension(mimetype) || 'bin'}`;
              const fullNameS3 = join(`${this.instanceId}`, remoteJid, mediaTypeS3, fileNameS3);
              const size = buffer.byteLength;

              this.logger?.info?.(`Fazendo upload para S3: ${fullNameS3} (${mimetype})`);
              await s3Service.uploadFile(fullNameS3, buffer, size, { 'Content-Type': mimetype });
              const mediaUrl = await s3Service.getObjectUrl(fullNameS3);
              mediaContent.url = mediaUrl; // Adiciona a URL S3
              mediaContent.mimetype = mimetype;
              mediaContent.fileName = originalFilename; // Adiciona nome original se não houver
              this.logger?.info?.(`Upload S3 concluído: ${mediaUrl}`);
            }
          } catch (error: any) {
            this.logger?.error?.(`Erro no upload S3: ${error?.message}`, error?.stack);
            // Continuar mesmo com erro de S3? Ou lançar exceção? Depende do requisito.
          }
        } else if (isBase64(mediaContent.media)) {
             // Se S3 não está ativo, mas temos base64, talvez salvá-lo? Ou remover?
             this.logger?.warn?.('S3 desativado, mídia em base64 não será salva externamente.');
             // delete mediaContent.media; // Opcional: remover base64 se não for usar
             mediaContent.base64 = mediaContent.media; // Manter como base64?
             delete mediaContent.media;
        } else if (isURL(mediaContent.media)) {
            mediaContent.url = mediaContent.media; // Manter a URL original
            delete mediaContent.media;
        }
      }

      // Log e Webhook ANTES de salvar/enviar (para ter o ID)
      this.logger?.log?.('Mensagem preparada para envio (Evolution):', messageRaw);
      this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw); // TODO: Precisa de Events e sendDataWebhook

      // TODO: Implementar a lógica REAL de envio para o "Evolution Channel" aqui.
      // Esta parte é apenas um placeholder. O que significa "enviar" para este canal?
      // Chamar uma API externa? Gravar em outro lugar?
      this.logger?.warn?.('Lógica de envio real para Evolution Channel não implementada!');
      // Simular sucesso após um tempo:
      await delay(options?.delay || 50); // Usa delay das opções ou 50ms
      messageRaw.status = 'SENT'; // Ou 'DELIVERED'/'READ' se o canal der esse feedback
      messageRaw.key.fromMe = true; // Confirmar que é nossa

      // Salvar no banco DEPOIS de tentar enviar (com status atualizado)
      // TODO: Precisa do schema.prisma
      await this.prismaRepository.prisma.message.create({
        data: {
          ...messageRaw,
          key: messageRaw.key as any,
          message: messageRaw.message as any,
          messageTimestamp: BigInt(messageRaw.messageTimestamp),
        },
      });

      // Lógica Chatwoot (enviar só se não for integração que já envia)
      if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled && !isIntegration) {
        this.logger?.info?.('Enviando mensagem enviada para Chatwoot...');
        this.chatwootService?.eventWhatsapp?.( // TODO: Verificar se 'eventWhatsapp' existe
          Events.SEND_MESSAGE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );
      }

      // Se for integração, emite evento para chatbot (isso está certo?)
      if (isIntegration) {
        await chatbotController?.emit?.({ // TODO: Precisa de chatbotController
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName, // PushName pode não estar disponível aqui
        });
      }


      return messageRaw; // Retorna a mensagem formatada/salva
    } catch (error: any) {
      this.logger?.error?.(`Erro em sendMessageWithTyping: ${error?.message || error}`, error.stack);
      throw new BadRequestException(`Erro ao enviar mensagem: ${error.toString()}`);
    }
  }


  // --- Implementações dos Métodos de Envio ---

  public async textMessage(data: SendTextDto, isIntegration = false): Promise<any> {
    const content = {
      // Adapte para a estrutura esperada pelo canal Evolution
      // Pode ser simples como { text: data.text } ou mais complexo
      conversation: data.text, // Usando 'conversation' como padrão
      // Adicione linkPreview se suportado e necessário
      // extendedTextMessage: { text: data.text, canonicalUrl: ..., matchedText: ..., title: ..., description: ..., jpegThumbnail: ... }
    };
    return this.sendMessageWithTyping(data.number, content, data.options, null, isIntegration);
  }

  // TODO: Precisa de MediaMessage DTO
  protected async prepareMediaMessage(mediaMessage: MediaMessage): Promise<any> {
    this.logger?.info?.(`Preparando mídia: ${mediaMessage.mediatype}, ${mediaMessage.fileName || mediaMessage.media.substring(0, 30)}`);
    try {
      const mediaType = mediaMessage.mediatype;
      const messageStructure: any = {
          caption: mediaMessage?.caption,
          mimetype: mimeTypes.lookup(mediaMessage.fileName || mediaMessage.media) || 'application/octet-stream',
          fileName: mediaMessage.fileName,
          media: mediaMessage.media, // Será processado em sendMessageWithTyping (base64 ou url)
      };

      // Ajustes específicos por tipo
       if (mediaType === 'document' && !messageStructure.fileName) {
           messageStructure.fileName = `documento.${mimeTypes.extension(messageStructure.mimetype) || 'bin'}`;
       } else if (mediaType === 'image' && !messageStructure.fileName) {
           messageStructure.fileName = `imagem.${mimeTypes.extension(messageStructure.mimetype) || 'jpg'}`;
       } else if (mediaType === 'video' && !messageStructure.fileName) {
           messageStructure.fileName = `video.${mimeTypes.extension(messageStructure.mimetype) || 'mp4'}`;
       } else if (mediaType === 'audio') {
            messageStructure.ptt = mediaMessage.ptt ?? false; // Assume PTT false se não especificado
            if (!messageStructure.fileName) {
              messageStructure.fileName = `audio.${mimeTypes.extension(messageStructure.mimetype) || 'ogg'}`;
            }
       }

      // Estrutura final para sendMessageWithTyping
      const finalMessage: any = { mediaType };
      finalMessage[`${mediaType}Message`] = messageStructure; // Ex: { imageMessage: { caption: ..., mimetype: ..., ... } }

      return finalMessage;

    } catch (error: any) {
      this.logger?.error?.(`Erro ao preparar mídia: ${error?.message || error}`);
      throw new InternalServerErrorException(`Erro ao preparar mídia: ${error?.toString() || error}`);
    }
  }

  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false): Promise<any> {
    const mediaData: SendMediaDto = { ...data };
    // Se 'file' existe, usa o buffer dele como base64. Senão, usa data.media (que pode ser url ou base64)
    if (file?.buffer) {
        mediaData.media = file.buffer.toString('base64');
        mediaData.fileName = file.originalname || mediaData.fileName; // Usa nome original do arquivo se disponível
    }
    // Prepara a estrutura da mensagem de mídia
    const message = await this.prepareMediaMessage(mediaData);
    // Envia usando o método genérico
    return this.sendMessageWithTyping(data.number, message, data.options, file, isIntegration);
  }

   // TODO: Implementar processAudio se necessário para este canal, ou remover/delegar
  public async processAudio(audio: string, number: string, file?: any): Promise<any> {
     this.logger?.warn?.('Processamento de áudio (conversão externa) não implementado/necessário para Evolution Channel por padrão.');
     // Apenas prepara a estrutura básica
     const fileName = file?.originalname || `audio-${v4()}.mp3`; // Nome placeholder
     const mimetype = file?.mimetype || mimeTypes.lookup(fileName) || 'audio/mpeg';
     return {
         fileName,
         mediaType: 'audio',
         media: audio, // URL ou Base64
         mimetype,
         ptt: false, // Definir PTT se necessário
     };
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false): Promise<any> {
    const mediaData: SendAudioDto = { ...data };
    let audioContent = data.audio; // Pode ser URL ou Base64

    if (file?.buffer) {
      audioContent = file.buffer.toString('base64');
    } else if (!isURL(audioContent) && !isBase64(audioContent)) {
      throw new BadRequestException('Formato de áudio inválido. Forneça URL, Base64 ou um arquivo.');
    }

    // Usa processAudio (que pode ser simplificado para Evolution)
    const message = await this.processAudio(audioContent, data.number, file);
    message.ptt = data.ptt ?? false; // Garante que PTT seja passado

    return this.sendMessageWithTyping(data.number, { audioMessage: message, ptt: message.ptt }, data.options, file, isIntegration);
  }

  public async buttonMessage(data: SendButtonsDto, isIntegration = false): Promise<any> {
    // TODO: Adaptar a estrutura do 'buttonMessage' para o formato esperado pelo Evolution Channel
    const messageContent = {
      buttonMessage: {
        // Estrutura hipotética - precisa ser validada com a API/formato do Evolution
        contentText: data.description, // Mapeando description para contentText (exemplo)
        footerText: data.footer,
        buttons: data.buttons.map(b => ({ buttonId: b.id, buttonText: { displayText: b.label }, type: 1 })), // Exemplo de mapeamento
        headerType: 1, // Exemplo
        text: data.title, // Mapeando title para text (exemplo)
      },
    };
     this.logger?.warn?.('Estrutura de buttonMessage para Evolution Channel é hipotética. Verifique o formato correto.');
    return this.sendMessageWithTyping(data.number, messageContent, data.options, null, isIntegration);
  }

  // --- Métodos Não Suportados (Lançam Exceção) ---
  // Mantendo os métodos que lançam exceção, pois indicam funcionalidades não implementadas para este canal específico.
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
  public async offerCall(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); } // Mantido erro original
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
