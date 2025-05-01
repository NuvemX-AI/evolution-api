// src/api/integrations/chatbot/dify/services/dify.service.ts

/* eslint-disable @typescript-eslint/no-unused-vars */
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { Integration } from '@api/types/wa.types'; // Ajustado caminho relativo/alias
import { Auth, ConfigService, HttpServer } from '@config/env.config'; // Assume alias
import { Logger } from '@config/logger.config'; // Assume alias
// Importa tipos Prisma necessários
import { Dify, DifySetting, IntegrationSession, Prisma } from '@prisma/client';
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { sendTelemetry } from '@utils/sendTelemetry'; // Assume alias
import axios from 'axios';
import { Readable } from 'stream';

export class DifyService {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
  ) {}

  private readonly logger = new Logger('DifyService');

  public async createNewSession(instance: InstanceDto, data: any): Promise<{ session: IntegrationSession } | undefined> {
    try {
      // << CORREÇÃO TS2353: Remover pushName (não existe no modelo IntegrationSession) >>
      // NOTE: Se precisar salvar pushName, adicione a coluna ao schema Prisma e regenere.
      const session = await this.prismaRepository.prisma.integrationSession.create({
        data: {
          remoteJid: data.remoteJid,
          // pushName: data.pushName, // Removido
          sessionId: data.remoteJid, // Usar remoteJid como sessionId inicial? Verificar lógica.
          status: 'opened',
          awaitUser: false,
          botId: data.botId,
          instanceId: instance.instanceId,
          type: 'dify', // Garante que o tipo está definido
        },
      });
      this.logger.log(`Nova sessão Dify criada para ${data.remoteJid}, Bot ID: ${data.botId}`);
      return { session };
    } catch (error: any) {
      this.logger.error(`Erro ao criar nova sessão Dify: ${error.message}`);
      return undefined;
    }
  }

  private isImageMessage(content: string | undefined | null): boolean {
    // Adiciona verificação para nulo/undefined
    return !!content && content.includes('imageMessage');
  }

  private isJSON(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  private async sendMessageToBot(
    instance: any, // Tipo da instância WA (Baileys/Meta) - precisa ser mais específico?
    session: IntegrationSession,
    settings: DifySetting | null, // Pode ser nulo se não houver settings específicos
    dify: Dify,
    remoteJid: string,
    pushName: string | undefined | null, // Pode ser nulo/undefined
    content: string,
  ) {
    try {
      // << CORREÇÃO TS2339: Usar optional chaining e fallback para apiUrl >>
      // NOTE: Adicione 'apiUrl String?' ao modelo Dify no schema.prisma e regenere.
      let endpoint: string = dify.apiUrl ?? '';
      if (!endpoint) {
          this.logger.error(`API URL não definida para o bot Dify ID ${dify.id}`);
          return; // Não pode continuar sem endpoint
      }

      let response: any; // Para armazenar a resposta da API Dify

      // Assume 'chat' como default se botType não estiver definido
      const botType = dify.botType || 'chat';

      this.logger.debug(`Enviando para Dify (${botType}): User=${remoteJid}, Session=${session.sessionId}, Bot=${dify.id}`);

      // Enviar presença 'composing' se for Baileys
      if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
          await instance.client.presenceSubscribe(remoteJid).catch((e: any) => this.logger.warn(`Erro ao subscrever presença para ${remoteJid}: ${e.message}`));
          await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e: any) => this.logger.warn(`Erro ao enviar presença 'composing' para ${remoteJid}: ${e.message}`));
      }

      // Monta payload base
      const payloadBase: any = {
         inputs: {
            // Incluir apenas dados que realmente existem
            ...(remoteJid && { remoteJid: remoteJid }),
            ...(pushName && { pushName: pushName }),
            ...(instance?.instanceName && { instanceName: instance.instanceName }),
            ...(this.configService.get<HttpServer>('SERVER')?.URL && { serverUrl: this.configService.get<HttpServer>('SERVER').URL }),
            ...(this.configService.get<Auth>('AUTHENTICATION')?.API_KEY?.KEY && { apiKey: this.configService.get<Auth>('AUTHENTICATION').API_KEY.KEY }),
         },
         query: content, // Query inicial
         user: remoteJid, // ID do usuário final
         conversation_id: session.sessionId === remoteJid ? undefined : session.sessionId, // Usa ID da sessão se não for o inicial
      };

      // Adiciona arquivos se for imagem
      if (this.isImageMessage(content)) {
        const contentSplit = content!.split('|'); // content não será nulo aqui
        payloadBase.files = [{
            type: 'image',
            transfer_method: 'remote_url',
            url: contentSplit[1]?.split('?')[0], // URL da imagem
        }];
        payloadBase.query = contentSplit[2] || content; // Usa caption ou query original
        payloadBase.inputs.query = payloadBase.query; // Atualiza input também
      }
      payloadBase.inputs = { ...payloadBase.inputs, query: payloadBase.query }; // Garante que input.query está atualizado

      // Lógica específica por tipo de bot Dify
      if (botType === 'chat' || botType === 'chatBot') { // Inclui 'chatBot' por segurança
        endpoint += '/chat-messages';
        payloadBase.response_mode = 'blocking'; // ou 'streaming'
        response = await axios.post(endpoint, payloadBase, { headers: { Authorization: `Bearer ${dify.apiKey}` } });
        const message = response?.data?.answer;
        const conversationId = response?.data?.conversation_id;
        await this.sendMessageWhatsApp(instance, remoteJid, message, settings); // Passa settings (pode ser null)
        await this.updateSession(session.id, conversationId ?? session.sessionId, true); // Atualiza sessão

      } else if (botType === 'agent') {
         endpoint += '/chat-messages';
         payloadBase.response_mode = 'streaming';
         // Tratamento de streaming
         const streamResponse = await axios.post(endpoint, payloadBase, { headers: { Authorization: `Bearer ${dify.apiKey}` }, responseType: 'stream' });
         let conversationId: string | undefined;
         let answer = '';
         const stream = streamResponse.data as Readable;
         for await (const chunk of stream) {
             const lines = chunk.toString().split('\n');
             for (const line of lines) {
                 if (line.startsWith('data:')) {
                    try {
                        const eventData = JSON.parse(line.substring(5));
                        if (eventData?.event === 'agent_message') {
                            conversationId = conversationId ?? eventData?.conversation_id;
                            answer += eventData?.answer ?? '';
                        }
                    } catch (e) {
                        this.logger.warn(`Erro ao parsear linha do stream Dify: ${line}`);
                    }
                 }
             }
         }
         await this.sendMessageWhatsApp(instance, remoteJid, answer, settings);
         await this.updateSession(session.id, conversationId ?? session.sessionId, true);

      } else if (botType === 'workflow') {
         endpoint += '/workflows/run';
         payloadBase.response_mode = 'blocking';
         response = await axios.post(endpoint, payloadBase, { headers: { Authorization: `Bearer ${dify.apiKey}` } });
         const message = response?.data?.data?.outputs?.text; // Caminho comum para workflows
         await this.sendMessageWhatsApp(instance, remoteJid, message, settings);
         await this.updateSession(session.id, session.sessionId, true); // Workflow não retorna conversation_id?

      } else if (botType === 'textGenerator') { // Nome antigo? Mantido por compatibilidade
         endpoint += '/completion-messages';
         payloadBase.response_mode = 'blocking';
         response = await axios.post(endpoint, payloadBase, { headers: { Authorization: `Bearer ${dify.apiKey}` } });
         const message = response?.data?.answer;
         const conversationId = response?.data?.conversation_id;
         await this.sendMessageWhatsApp(instance, remoteJid, message, settings);
         await this.updateSession(session.id, conversationId ?? session.sessionId, true);

      } else {
        this.logger.error(`Tipo de bot Dify desconhecido: ${botType}`);
      }

    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem para bot Dify (${dify.id}): ${error.response?.data?.message || error.message}`);
      // Enviar mensagem de erro para o usuário?
      // await this.sendMessageWhatsApp(instance, remoteJid, "Desculpe, ocorreu um erro ao processar sua solicitação.", settings);
      // Atualizar status da sessão para erro ou fechar?
      // await this.updateSession(session.id, session.sessionId, false, 'error');
    } finally {
        // Enviar presença 'paused' se for Baileys
        if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
             await instance.client.sendPresenceUpdate('paused', remoteJid).catch((e: any) => this.logger.warn(`Erro ao enviar presença 'paused' para ${remoteJid}: ${e.message}`));
        }
    }
  }

  // Função auxiliar para atualizar sessão
  private async updateSession(sessionId: string, newConversationId: string, awaitUser: boolean, status: 'opened' | 'closed' | 'paused' | 'error' = 'opened') {
      try {
         await this.prismaRepository.prisma.integrationSession.update({
            where: { id: sessionId },
            data: {
                status: status,
                awaitUser: awaitUser,
                sessionId: newConversationId, // Atualiza o ID da conversa Dify
            },
         });
      } catch (error: any) {
         this.logger.error(`Erro ao atualizar sessão de integração ${sessionId}: ${error.message}`);
      }
  }


  // << CORREÇÃO: Aceitar settings como nulo ou Partial >>
  private async sendMessageWhatsApp(instance: any, remoteJid: string, message: string | undefined | null, settings: Partial<DifySetting> | null) {
    if (!message || message.trim() === '') {
      this.logger.warn(`Mensagem do bot Dify vazia para ${remoteJid}.`);
      // Enviar mensagem de 'sem resposta' se configurado?
      if (settings?.unknownMessage) {
         await instance.textMessage(
            {
              number: remoteJid.split('@')[0],
              // << CORREÇÃO TS2339: Usar optional chaining >>
              delay: settings?.delayMessage ?? 1000,
              text: settings.unknownMessage,
            },
            false, // Não é integração (é resposta do bot)
          );
      }
      return;
    }

    const linkRegex = /(!?)\[(.*?)\]\((.*?)\)/g;
    let textBuffer = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const getMediaType = (url: string): string | null => { /* ... (lógica mantida) ... */
      const extension = url?.split('.')?.pop()?.toLowerCase();
      if (!extension) return null;
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
      const audioExtensions = ['mp3', 'wav', 'aac', 'ogg', 'opus', 'm4a']; // Adicionado m4a, opus
      const videoExtensions = ['mp4', 'avi', 'mkv', 'mov', 'webm']; // Adicionado webm
      const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']; // Adicionado csv

      if (imageExtensions.includes(extension)) return 'image';
      if (audioExtensions.includes(extension)) return 'audio';
      if (videoExtensions.includes(extension)) return 'video';
      if (documentExtensions.includes(extension)) return 'document';
      return null;
     };

    // Processa a mensagem buscando por links de mídia no formato markdown
    while ((match = linkRegex.exec(message)) !== null) {
      const [fullMatch, exclMark, altText, url] = match;
      const mediaType = getMediaType(url);

      const beforeText = message.slice(lastIndex, match.index);
      if (beforeText) textBuffer += beforeText;

      if (mediaType) {
        // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
        const splitMessages = settings?.splitMessages ?? false;
        const timePerChar = settings?.timePerChar ?? 0;
        const minDelay = 500; // Delay mínimo menor?
        const maxDelay = 10000; // Delay máximo menor?

        // Envia texto acumulado antes da mídia
        if (textBuffer.trim()) {
          if (splitMessages) {
             // ... (lógica de split/delay mantida, mas usando settings?.) ...
             const multipleMessages = textBuffer.trim().split('\n\n');
             for (const msgPart of multipleMessages) {
                const delay = Math.min(Math.max(msgPart.length * timePerChar, minDelay), maxDelay);
                await this.sendWithDelay(instance, remoteJid, { text: msgPart }, settings, delay);
             }
          } else {
             await this.sendWithDelay(instance, remoteJid, { text: textBuffer.trim() }, settings, settings?.delayMessage ?? 1000);
          }
          textBuffer = ''; // Limpa buffer
        }

        // Envia a mídia
        const mediaPayload: any = { number: remoteJid.split('@')[0], caption: altText || undefined };
        if (mediaType === 'audio') {
            mediaPayload.audio = url;
            await this.sendWithDelay(instance, remoteJid, mediaPayload, settings, settings?.delayMessage ?? 1000, 'audio');
        } else {
            mediaPayload.mediatype = mediaType;
            mediaPayload.media = url;
            // mediaPayload.fileName = url.substring(url.lastIndexOf('/') + 1); // Define nome do arquivo da URL
            await this.sendWithDelay(instance, remoteJid, mediaPayload, settings, settings?.delayMessage ?? 1000, 'media');
        }

      } else {
        // Se não for mídia, trata como texto normal (link)
        textBuffer += fullMatch;
      }
      lastIndex = linkRegex.lastIndex;
    }

    // Envia texto restante após o último link/mídia
    if (lastIndex < message.length) {
      textBuffer += message.slice(lastIndex);
    }

    // Envia texto final acumulado
    if (textBuffer.trim()) {
        // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
        const splitMessages = settings?.splitMessages ?? false;
        const timePerChar = settings?.timePerChar ?? 0;
        const minDelay = 500;
        const maxDelay = 10000;

        if (splitMessages) {
            // ... (lógica de split/delay mantida, mas usando settings?.) ...
             const multipleMessages = textBuffer.trim().split('\n\n');
             for (const msgPart of multipleMessages) {
                const delay = Math.min(Math.max(msgPart.length * timePerChar, minDelay), maxDelay);
                await this.sendWithDelay(instance, remoteJid, { text: msgPart }, settings, delay);
             }
        } else {
             await this.sendWithDelay(instance, remoteJid, { text: textBuffer.trim() }, settings, settings?.delayMessage ?? 1000);
        }
    }

    // << CORREÇÃO TS2307: Usar sendTelemetry importado >>
    sendTelemetry('/message/sendText'); // Ou /message/sendMedia se apropriado
  }

  // Função auxiliar para enviar com delay e presença
  private async sendWithDelay(instance: any, remoteJid: string, data: any, settings: Partial<DifySetting> | null, delayMs: number, type: 'text' | 'media' | 'audio' = 'text') {
       try {
           if (instance.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
               await instance.client.presenceSubscribe(remoteJid).catch((e:any) => {});
               await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e:any) => {});
           }

           await new Promise<void>((resolve) => {
               setTimeout(async () => {
                   try {
                       if (type === 'text') {
                            await instance.textMessage({ ...data, delay: undefined }, false); // Remove delay interno
                       } else if (type === 'media') {
                            await instance.mediaMessage({ ...data, delay: undefined }, null, false);
                       } else if (type === 'audio') {
                            await instance.audioWhatsapp({ ...data, delay: undefined }, null, false);
                       }
                       resolve();
                   } catch(sendError: any) {
                        this.logger.error(`Erro ao enviar mensagem (${type}) para ${remoteJid} após delay: ${sendError.message}`);
                        resolve(); // Resolve mesmo em caso de erro para não bloquear o loop
                   }
               }, delayMs);
           });

           if (instance.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
               await instance.client.sendPresenceUpdate('paused', remoteJid).catch((e:any) => {});
           }
       } catch(error: any) {
            this.logger.error(`Erro geral em sendWithDelay para ${remoteJid}: ${error.message}`);
       }
  }


  private async initNewSession(
    instance: any,
    remoteJid: string,
    dify: Dify,
    settings: DifySetting | null, // Aceita null
    session: IntegrationSession | null, // Aceita null
    content: string,
    pushName?: string | null, // Aceita null
  ) {
    const data = await this.createNewSession(instance, {
      remoteJid,
      pushName,
      botId: dify.id,
    });

    // Usa a sessão recém-criada ou a existente (se createNewSession falhar?)
    const currentSession = data?.session ?? session;
    if (!currentSession) {
         this.logger.error(`Falha ao obter/criar sessão para ${remoteJid} no bot Dify ${dify.id}`);
         return;
    }

    await this.sendMessageToBot(instance, currentSession, settings, dify, remoteJid, pushName, content);
  }

  public async processDify(
    instance: any, // Tipo da instância WA (Baileys/Meta)
    remoteJid: string,
    dify: Dify,
    session: IntegrationSession | null, // Pode ser nulo
    settings: Partial<DifySetting> | null, // Aceita null e Partial
    content: string | undefined | null, // Aceita null/undefined
    pushName?: string | null, // Aceita null/undefined
  ) {
    // Verifica se a sessão existe e está fechada (e não deve reabrir automaticamente)
    if (session && session.status === 'closed') {
       this.logger.debug(`Sessão Dify para ${remoteJid} está fechada. Ignorando.`);
      return;
    }

     // << CORREÇÃO TS2339: Usar optional chaining e fallback para expire >>
     // Verifica expiração da sessão
    if (session && settings?.expire && settings.expire > 0) {
      const now = Date.now();
      const sessionUpdatedAt = new Date(session.updatedAt).getTime();
      const diffInMinutes = Math.floor((now - sessionUpdatedAt) / 1000 / 60);

      if (diffInMinutes > settings.expire) {
         this.logger.info(`Sessão Dify para ${remoteJid} expirou (${diffInMinutes} min > ${settings.expire} min).`);
          // << CORREÇÃO TS2339: Usar optional chaining para keepOpen >>
        if (settings?.keepOpen) {
          await this.updateSession(session.id, session.sessionId, false, 'closed'); // Marca como fechada
          this.logger.info(`Sessão Dify marcada como fechada para ${remoteJid} (keepOpen=true).`);
        } else {
          await this.prismaRepository.prisma.integrationSession.deleteMany({ // Deleta sessão expirada
            where: { botId: dify.id, remoteJid: remoteJid, type: 'dify' },
          });
           this.logger.info(`Sessão Dify deletada para ${remoteJid} (keepOpen=false).`);
        }
        // Inicia nova sessão após expiração
        await this.initNewSession(instance, remoteJid, dify, settings, null, content || '', pushName); // Passa null para session
        return;
      }
    }

    // Se não há sessão, inicia uma nova
    if (!session) {
      await this.initNewSession(instance, remoteJid, dify, settings, null, content || '', pushName); // Passa null para session
      return;
    }

    // Atualiza sessão existente para indicar processamento
    await this.updateSession(session.id, session.sessionId, false); // awaitUser = false

    // Verifica conteúdo vazio
    if (!content || content.trim() === '') {
       this.logger.warn(`Conteúdo vazio recebido para ${remoteJid}`);
       // << CORREÇÃO TS2339: Usar optional chaining para unknownMessage >>
      if (settings?.unknownMessage) {
          await this.sendMessageWhatsApp(instance, remoteJid, settings.unknownMessage, settings);
      }
      await this.updateSession(session.id, session.sessionId, true); // Volta a esperar usuário
      return;
    }

    // Verifica keyword de finalização
    // << CORREÇÃO TS2339: Usar optional chaining para keywordFinish e keepOpen >>
    if (settings?.keywordFinish && content.toLowerCase() === settings.keywordFinish.toLowerCase()) {
       this.logger.info(`Keyword de finalização Dify recebida de ${remoteJid}.`);
      if (settings?.keepOpen) {
          await this.updateSession(session.id, session.sessionId, false, 'closed'); // Fecha a sessão
      } else {
          await this.prismaRepository.prisma.integrationSession.delete({ where: { id: session.id }}); // Deleta a sessão
      }
      return; // Finaliza o fluxo
    }

    // Envia para o bot Dify
    await this.sendMessageToBot(instance, session, settings, dify, remoteJid, pushName, content);
  }
}
