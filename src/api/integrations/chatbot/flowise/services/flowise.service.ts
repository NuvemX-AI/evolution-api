// src/api/integrations/chatbot/flowise/services/flowise.service.ts

/* eslint-disable @typescript-eslint/no-unused-vars */
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { Integration } from '@api/types/wa.types'; // Ajustado caminho relativo/alias
import { Auth, ConfigService, HttpServer } from '@config/env.config'; // Assume alias
import { Logger } from '@config/logger.config'; // Assume alias
// Importa tipos Prisma necessários
import { Flowise, FlowiseSetting, IntegrationSession, Prisma } from '@prisma/client';
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { sendTelemetry } from '@utils/sendTelemetry'; // Assume alias
import axios from 'axios';

export class FlowiseService {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
  ) {}

  private readonly logger = new Logger('FlowiseService');

  public async createNewSession(instance: InstanceDto, data: any): Promise<{ session: IntegrationSession } | undefined> {
    try {
      // pushName agora existe no schema
      const session = await this.prismaRepository.prisma.integrationSession.create({
        data: {
          remoteJid: data.remoteJid,
          pushName: data.pushName, // Mantido
          integrationSpecificSessionId: data.remoteJid, // Usar remoteJid como sessionId inicial
          status: 'opened',
          awaitUser: false,
          botId: data.botId,
          instanceId: instance.instanceId,
          type: 'flowise', // Define o tipo correto
        },
      });
      this.logger.log(`Nova sessão Flowise criada para ${data.remoteJid}, Bot ID: ${data.botId}`);
      return { session };
    } catch (error: any) {
      this.logger.error(`Erro ao criar nova sessão Flowise: ${error.message}`);
      return undefined;
    }
  }

  private isImageMessage(content: string | undefined | null): boolean {
    return !!content && content.includes('imageMessage');
  }

  private async sendMessageToBot(
    instance: any,
    bot: Flowise,
    remoteJid: string,
    pushName: string | undefined | null,
    content: string | undefined | null, // Aceita null/undefined
    // Adiciona sessionId para overrideConfig
    sessionId?: string | null
  ): Promise<string | null> { // Retorna a resposta do bot ou null
    if (!content) {
      this.logger.warn(`Conteúdo vazio para Flowise bot ${bot.id}`);
      return null;
    }

    // << CORREÇÃO TS2339: Usar bot.url >>
    const endpoint = bot.url;
    if (!endpoint) {
      this.logger.error(`URL do endpoint não definida para o bot Flowise ${bot.id}`);
      return null;
    }

    // Monta o payload para Flowise (pode variar com a configuração do seu flow)
    const payload: any = {
      question: content,
      overrideConfig: {
        // Usa o sessionId fornecido (pode ser o remoteJid ou um ID de sessão real do Flowise)
        sessionId: sessionId,
        // Variáveis que podem ser usadas dentro do fluxo Flowise
        vars: {
            remoteJid: remoteJid,
            pushName: pushName ?? remoteJid.split('@')[0],
            instanceName: instance.instanceName,
            serverUrl: this.configService.get<HttpServer>('SERVER')?.URL,
            apiKey: this.configService.get<Auth>('AUTHENTICATION')?.API_KEY?.KEY,
        },
      },
    };

    // Tratamento para imagem (lógica mantida)
    if (this.isImageMessage(content)) {
      const contentSplit = content.split('|');
      payload.uploads = [{
          // Flowise espera 'data' para URL remota ou base64
          data: contentSplit[1]?.split('?')[0], // URL da imagem
          type: 'url', // Indica que é URL
          name: 'image.png', // Nome do arquivo (opcional)
          // mime: 'image/png' // Mimetype (opcional)
      }];
      payload.question = contentSplit[2] || content; // Usa caption ou query original
      // Não precisa atualizar inputs.query aqui, Flowise usa payload.question
    }

    // Enviar presença 'composing' se for Baileys
    if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
       await instance.client.presenceSubscribe(remoteJid).catch((e:any) => this.logger.warn(`Erro presenceSubscribe: ${e.message}`));
       await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e:any) => this.logger.warn(`Erro sendPresenceUpdate composing: ${e.message}`));
    }

    // Monta headers
    const headers: any = { 'Content-Type': 'application/json' };
    // << CORREÇÃO TS2339: Usa bot.apiKey com optional chaining (campo agora existe no tipo) >>
    if (bot.apiKey) {
      headers['Authorization'] = `Bearer ${bot.apiKey}`;
    }

    try {
      this.logger.debug(`Enviando para Flowise (${bot.id}): Endpoint=${endpoint}, SessionID=${sessionId}`);
      const response = await axios.post(endpoint, payload, { headers });

      // Processa a resposta do Flowise (pode ser string direta ou JSON)
      let message: string | null = null;
      if (typeof response.data === 'string') {
        message = response.data;
      } else if (typeof response.data === 'object' && response.data !== null) {
        // Tenta extrair de campos comuns como 'text' ou 'output'
        message = response.data.text ?? response.data.output ?? JSON.stringify(response.data);
      }
      this.logger.debug(`Resposta Flowise: ${message}`);
      return message;

    } catch (error: any) {
       this.logger.error(`Erro ao enviar mensagem para bot Flowise (${bot.id}): ${error.response?.data?.message || error.message}`);
       return null; // Retorna null em caso de erro
    } finally {
        // Enviar presença 'paused' se for Baileys
        if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
             await instance.client.sendPresenceUpdate('paused', remoteJid).catch((e:any) => this.logger.warn(`Erro sendPresenceUpdate paused: ${e.message}`));
        }
    }
  }


  private async sendMessageWhatsApp(
    instance: any,
    remoteJid: string,
    settings: Partial<FlowiseSetting> | null, // Aceita null/Partial
    message: string | undefined | null,
  ) {
    if (!message || message.trim() === '') {
      this.logger.warn(`Mensagem do bot Flowise vazia para ${remoteJid}.`);
      // << CORREÇÃO TS2339: Usar optional chaining e fallback (campos agora existem nos tipos) >>
      if (settings?.unknownMessage) {
        await instance.textMessage(
          {
            number: remoteJid.split('@')[0],
            delay: settings?.delayMessage ?? 1000,
            text: settings.unknownMessage,
          },
          false,
        );
      }
      return;
    }

    // Lógica de split e envio com delay
    // << CORREÇÃO TS2339: Usar optional chaining e fallback (campos agora existem nos tipos) >>
    const splitMessages = settings?.splitMessages ?? false;
    const timePerChar = settings?.timePerChar ?? 0;
    const minDelay = 500;
    const maxDelay = 10000;

    const linkRegex = /(!?)\[(.*?)\]\((.*?)\)/g; // Mantém regex para links/mídia
    let textBuffer = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

     const getMediaType = (url: string): string | null => { /* ... (lógica mantida) ... */
      const extension = url?.split('.')?.pop()?.toLowerCase();
      if (!extension) return null;
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
      const audioExtensions = ['mp3', 'wav', 'aac', 'ogg', 'opus', 'm4a'];
      const videoExtensions = ['mp4', 'avi', 'mkv', 'mov', 'webm'];
      const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];

      if (imageExtensions.includes(extension)) return 'image';
      if (audioExtensions.includes(extension)) return 'audio';
      if (videoExtensions.includes(extension)) return 'video';
      if (documentExtensions.includes(extension)) return 'document';
      return null;
     };


    while ((match = linkRegex.exec(message)) !== null) {
        const [fullMatch, exclMark, altText, url] = match;
        const mediaType = getMediaType(url);
        const beforeText = message.slice(lastIndex, match.index);
        if (beforeText) textBuffer += beforeText;

        if (mediaType) {
            // Envia texto acumulado
            if (textBuffer.trim()) {
                if (splitMessages) {
                    const multipleMessages = textBuffer.trim().split('\n\n');
                    for (const msgPart of multipleMessages) {
                        const delay = Math.min(Math.max(msgPart.length * timePerChar, minDelay), maxDelay);
                        await this.sendWithDelay(instance, remoteJid, { text: msgPart }, settings?.delayMessage ?? 1000, delay);
                    }
                } else {
                    await this.sendWithDelay(instance, remoteJid, { text: textBuffer.trim() }, settings?.delayMessage ?? 1000, settings?.delayMessage ?? 1000);
                }
                textBuffer = '';
            }
            // Envia mídia
            const mediaPayload: any = { number: remoteJid.split('@')[0], caption: altText || undefined };
            if (mediaType === 'audio') {
                mediaPayload.audio = url;
                await this.sendWithDelay(instance, remoteJid, mediaPayload, settings?.delayMessage ?? 1000, settings?.delayMessage ?? 1000, 'audio');
            } else {
                mediaPayload.mediatype = mediaType;
                mediaPayload.media = url;
                await this.sendWithDelay(instance, remoteJid, mediaPayload, settings?.delayMessage ?? 1000, settings?.delayMessage ?? 1000, 'media');
            }
        } else {
            textBuffer += fullMatch; // Não é mídia, adiciona como texto
        }
        lastIndex = linkRegex.lastIndex;
    }

    // Envia texto restante
    if (lastIndex < message.length) {
      textBuffer += message.slice(lastIndex);
    }

    // Envia texto final acumulado
    if (textBuffer.trim()) {
        if (splitMessages) {
            const multipleMessages = textBuffer.trim().split('\n\n');
            for (const msgPart of multipleMessages) {
                const delay = Math.min(Math.max(msgPart.length * timePerChar, minDelay), maxDelay);
                await this.sendWithDelay(instance, remoteJid, { text: msgPart }, settings?.delayMessage ?? 1000, delay);
            }
        } else {
            await this.sendWithDelay(instance, remoteJid, { text: textBuffer.trim() }, settings?.delayMessage ?? 1000, settings?.delayMessage ?? 1000);
        }
    }

    // Usa sendTelemetry importado
    sendTelemetry('/message/sendText'); // Ou /message/sendMedia?
  }

   // Função auxiliar para enviar com delay e presença
   private async sendWithDelay(instance: any, remoteJid: string, data: any, baseDelay: number, calculatedDelay: number, type: 'text' | 'media' | 'audio' = 'text') {
        try {
            if (instance.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
                await instance.client.presenceSubscribe(remoteJid).catch((e:any) => {});
                await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e:any) => {});
            }

            await new Promise<void>((resolve) => {
                setTimeout(async () => {
                    try {
                        if (type === 'text') {
                             await instance.textMessage({ ...data, delay: undefined }, false);
                        } else if (type === 'media') {
                             await instance.mediaMessage({ ...data, delay: undefined }, null, false);
                        } else if (type === 'audio') {
                             await instance.audioWhatsapp({ ...data, delay: undefined }, null, false);
                        }
                        resolve();
                    } catch(sendError: any) {
                         this.logger.error(`Erro ao enviar mensagem (${type}) para ${remoteJid} após delay: ${sendError.message}`);
                         resolve();
                    }
                }, calculatedDelay);
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
    bot: Flowise,
    settings: Partial<FlowiseSetting> | null,
    session: IntegrationSession | null, // Sempre será null aqui
    content: string,
    pushName?: string | null,
  ) {
    const data = await this.createNewSession(instance, {
      remoteJid,
      pushName,
      botId: bot.id,
    });
    const currentSession = data?.session;
     if (!currentSession) {
         this.logger.error(`Falha ao criar sessão para ${remoteJid} no bot Flowise ${bot.id}`);
         return;
    }
    // Flowise usa remoteJid como session ID inicial se não houver um específico
    const message = await this.sendMessageToBot(instance, bot, remoteJid, pushName, content, remoteJid);
    // Atualiza sessão APÓS enviar a primeira mensagem, caso a API retorne um sessionId
    // await this.updateSession(currentSession.id, ??, true); // Flowise não retorna sessionId?
    await this.sendMessageWhatsApp(instance, remoteJid, settings, message);
    // Marca como esperando usuário após a primeira resposta
    await this.updateSession(currentSession.id, currentSession.integrationSpecificSessionId, true);
  }

  // Método principal chamado pelo Controller
  public async processBot(
    instance: any,
    remoteJid: string,
    bot: Flowise,
    session: IntegrationSession | null,
    settings: Partial<FlowiseSetting> | null,
    content: string | undefined | null,
    pushName?: string | null,
  ) {
     if (session && session.status !== 'opened') {
        this.logger.debug(`Sessão Flowise para ${remoteJid} não está aberta (${session.status}). Ignorando.`);
        return;
     }

     // Usa optional chaining e fallback (campos agora existem nos tipos)
     if (session && settings?.expire && settings.expire > 0) {
       const now = Date.now();
       const sessionUpdatedAt = new Date(session.updatedAt).getTime();
       const diffInMinutes = Math.floor((now - sessionUpdatedAt) / 1000 / 60);

       if (diffInMinutes > settings.expire) {
          this.logger.info(`Sessão Flowise para ${remoteJid} expirou (${diffInMinutes} min > ${settings.expire} min).`);
         if (settings?.keepOpen) {
           await this.updateSession(session.id, session.integrationSpecificSessionId, false, 'closed');
           this.logger.info(`Sessão Flowise marcada como fechada para ${remoteJid} (keepOpen=true).`);
         } else {
           await this.prismaRepository.prisma.integrationSession.deleteMany({ where: { botId: bot.id, remoteJid: remoteJid, type: 'flowise' } });
           this.logger.info(`Sessão Flowise deletada para ${remoteJid} (keepOpen=false).`);
         }
         await this.initNewSession(instance, remoteJid, bot, settings, null, content || '', pushName);
         return;
       }
     }

     if (!session) {
       await this.initNewSession(instance, remoteJid, bot, settings, null, content || '', pushName);
       return;
     }

     // Atualiza sessão existente para indicar processamento
     await this.updateSession(session.id, session.integrationSpecificSessionId, false); // awaitUser = false

     if (!content || content.trim() === '') {
       this.logger.warn(`Conteúdo vazio recebido para ${remoteJid} (Flowise)`);
       if (settings?.unknownMessage) { // Usa optional chaining
           await this.sendMessageWhatsApp(instance, remoteJid, settings, settings.unknownMessage);
       }
       await this.updateSession(session.id, session.integrationSpecificSessionId, true); // Volta a esperar usuário
       return;
     }

     // Usa optional chaining
     if (settings?.keywordFinish && content.toLowerCase() === settings.keywordFinish.toLowerCase()) {
        this.logger.info(`Keyword de finalização Flowise recebida de ${remoteJid}.`);
       if (settings?.keepOpen) {
           await this.updateSession(session.id, session.integrationSpecificSessionId, false, 'closed');
       } else {
           await this.prismaRepository.prisma.integrationSession.delete({ where: { id: session.id }});
       }
       return;
     }

     // Envia para o bot, passando o ID da sessão Flowise se existir
     const message = await this.sendMessageToBot(instance, bot, remoteJid, pushName, content, session.integrationSpecificSessionId);

     await this.sendMessageWhatsApp(instance, remoteJid, settings, message);
     // Marca como esperando usuário após a resposta
     await this.updateSession(session.id, session.integrationSpecificSessionId, true);
   } // Fim processBot

   // Função auxiliar para atualizar sessão
   private async updateSession(sessionId: string, newIntegrationSessionId: string | null, awaitUser: boolean, status: 'opened' | 'closed' | 'paused' | 'error' = 'opened'): Promise<void> {
       try {
          await this.prismaRepository.prisma.integrationSession.update({
             where: { id: sessionId },
             data: {
                 status: status,
                 awaitUser: awaitUser,
                 integrationSpecificSessionId: newIntegrationSessionId, // Atualiza o ID correto
             },
          });
       } catch (error: any) {
          this.logger.error(`Erro ao atualizar sessão de integração ${sessionId}: ${error.message}`);
       }
   }

} // Fim da classe FlowiseService
