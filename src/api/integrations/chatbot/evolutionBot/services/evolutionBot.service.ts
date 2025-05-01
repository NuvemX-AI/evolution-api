// src/api/integrations/chatbot/evolutionBot/services/evolutionBot.service.ts

/* eslint-disable @typescript-eslint/no-unused-vars */
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { Integration } from '@api/types/wa.types'; // Ajustado caminho relativo/alias
import { Auth, ConfigService, HttpServer } from '@config/env.config'; // Assume alias
import { Logger } from '@config/logger.config'; // Assume alias
// Importa tipos Prisma
import { EvolutionBot, EvolutionBotSetting, IntegrationSession, Prisma } from '@prisma/client';
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { sendTelemetry } from '@utils/sendTelemetry'; // Assume alias
import axios from 'axios';
import { Readable } from 'stream'; // Importado, embora não pareça usado aqui diretamente

export class EvolutionBotService {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
  ) {}

  private readonly logger = new Logger('EvolutionBotService');

  public async createNewSession(instance: InstanceDto, data: any): Promise<{ session: IntegrationSession } | undefined> {
    try {
      // << CORREÇÃO TS2353: Remover pushName >>
      const session = await this.prismaRepository.prisma.integrationSession.create({
        data: {
          remoteJid: data.remoteJid,
          // pushName: data.pushName, // Removido
          sessionId: data.remoteJid, // Usar remoteJid como sessionId inicial?
          status: 'opened',
          awaitUser: false,
          botId: data.botId,
          instanceId: instance.instanceId,
          type: 'evolution', // Define o tipo correto
        },
      });
      this.logger.log(`Nova sessão EvolutionBot criada para ${data.remoteJid}, Bot ID: ${data.botId}`);
      return { session };
    } catch (error: any) {
      this.logger.error(`Erro ao criar nova sessão EvolutionBot: ${error.message}`);
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

  // Método para enviar mensagem ao bot (backend Evolution AI?)
  private async sendMessageToBot(
    instance: any, // Tipo da instância WA (Baileys/Meta)
    session: IntegrationSession,
    // << CORREÇÃO: Aceitar settings como nulo ou Partial >>
    settings: Partial<EvolutionBotSetting> | null, // Pode ser nulo
    bot: EvolutionBot,
    remoteJid: string,
    pushName: string | undefined | null,
    content: string,
  ) {
    try {
      // << CORREÇÃO TS2339: Usar optional chaining e fallback para apiUrl >>
      // NOTE: Adicione 'apiUrl String?' ao modelo EvolutionBot no schema.prisma e regenere.
      const endpoint: string = bot.apiUrl ?? ''; // Usa apiUrl do bot específico
      if (!endpoint) {
          this.logger.error(`API URL não definida para o bot Evolution ID ${bot.id}`);
          return;
      }

      const payload = {
        conversationId: session.sessionId === remoteJid ? undefined : session.sessionId,
        text: content,
        from: remoteJid,
        sender: {
            pushName: pushName ?? remoteJid.split('@')[0], // Usa pushName ou parte do JID
            id: remoteJid,
        },
        instance: {
             name: instance.instanceName,
             serverUrl: this.configService.get<HttpServer>('SERVER')?.URL,
             apiKey: this.configService.get<Auth>('AUTHENTICATION')?.API_KEY?.KEY,
        }
        // TODO: Adicionar tratamento para imagens/arquivos se o bot Evolution suportar
      };

      this.logger.debug(`Enviando para EvolutionBot (${bot.id}): User=${remoteJid}, Session=${session.sessionId}`);

      // Enviar presença 'composing' se for Baileys
      if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
         await instance.client.presenceSubscribe(remoteJid).catch((e:any) => this.logger.warn(`Erro presenceSubscribe: ${e.message}`));
         await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e:any) => this.logger.warn(`Erro sendPresenceUpdate composing: ${e.message}`));
      }

      // Chamar API do bot Evolution
      // << CORREÇÃO TS2339: Usar bot.apiKey (opcional) e bot.apiUrl (opcional) >>
      const response = await axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(bot.apiKey && { 'Authorization': `Bearer ${bot.apiKey}` }), // Adiciona Auth apenas se existir apiKey
        },
      });

      // Enviar presença 'paused' se for Baileys
      if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
           await instance.client.sendPresenceUpdate('paused', remoteJid).catch((e:any) => this.logger.warn(`Erro sendPresenceUpdate paused: ${e.message}`));
      }

      // Processar resposta (adapte conforme a API do seu bot)
      const message = response?.data?.text || response?.data?.message || response?.data;
      const conversationId = response?.data?.conversationId;

      await this.sendMessageWhatsApp(instance, remoteJid, message, settings);

      // Atualizar sessão (mantém ID antigo se a API não retornar um novo)
      await this.updateSession(session.id, conversationId ?? session.sessionId, true);

    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem para bot Evolution (${bot.id}): ${error.response?.data?.message || error.message}`);
      // Enviar mensagem de erro?
      // await this.sendMessageWhatsApp(instance, remoteJid, "Erro ao processar com Bot Evolution.", settings);
      // await this.updateSession(session.id, session.sessionId, false, 'error');
    }
  }

  // << CORREÇÃO: Aceitar settings como nulo ou Partial >>
  private async sendMessageWhatsApp(instance: any, remoteJid: string, message: string | undefined | null, settings: Partial<EvolutionBotSetting> | null) {
    if (!message || message.trim() === '') {
      this.logger.warn(`Mensagem do bot Evolution vazia para ${remoteJid}.`);
      // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
      // NOTE: Adicione 'unknownMessage String?' ao EvolutionBotSetting no schema.prisma e regenere.
      if (settings?.unknownMessage) {
        await instance.textMessage(
          {
            number: remoteJid.split('@')[0],
             // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
             // NOTE: Adicione 'delayMessage Int?' ao EvolutionBotSetting no schema.prisma e regenere.
            delay: settings?.delayMessage ?? 1000,
            text: settings.unknownMessage,
          },
          false, // Não é integração
        );
      }
      return;
    }

    // Lógica de split e envio com delay (similar ao DifyService)
    // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
    // NOTE: Adicione 'splitMessages Boolean?' e 'timePerChar Int?' ao EvolutionBotSetting no schema.prisma e regenere.
    const splitMessages = settings?.splitMessages ?? false;
    const timePerChar = settings?.timePerChar ?? 0;
    const minDelay = 500;
    const maxDelay = 10000;

    if (splitMessages) {
        const multipleMessages = message.trim().split('\n\n');
        for (const msgPart of multipleMessages) {
            const delay = Math.min(Math.max(msgPart.length * timePerChar, minDelay), maxDelay);
             // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
            await this.sendWithDelay(instance, remoteJid, { text: msgPart }, settings?.delayMessage ?? 1000, delay);
        }
    } else {
         // << CORREÇÃO TS2339: Usar optional chaining e fallback >>
        await this.sendWithDelay(instance, remoteJid, { text: message.trim() }, settings?.delayMessage ?? 1000, settings?.delayMessage ?? 1000);
    }

    // << CORREÇÃO TS2307: Usar sendTelemetry importado >>
    sendTelemetry('/message/sendText');
}

  // Função auxiliar para enviar com delay e presença (similar ao DifyService)
  private async sendWithDelay(instance: any, remoteJid: string, data: any, baseDelay: number, calculatedDelay: number, type: 'text' | 'media' | 'audio' = 'text') {
        try {
            if (instance.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
                await instance.client.presenceSubscribe(remoteJid).catch((e: any) => {});
                await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e: any) => {});
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
                await instance.client.sendPresenceUpdate('paused', remoteJid).catch((e: any) => {});
            }
        } catch(error: any) {
             this.logger.error(`Erro geral em sendWithDelay para ${remoteJid}: ${error.message}`);
        }
    }


  private async initNewSession(
    instance: any,
    remoteJid: string,
    bot: EvolutionBot,
    settings: Partial<EvolutionBotSetting> | null,
    session: IntegrationSession | null,
    content: string,
    pushName?: string | null,
  ) {
    const data = await this.createNewSession(instance, {
      remoteJid,
      pushName,
      botId: bot.id,
    });
     const currentSession = data?.session ?? session;
     if (!currentSession) {
         this.logger.error(`Falha ao obter/criar sessão para ${remoteJid} no bot Evolution ${bot.id}`);
         return;
    }
    await this.sendMessageToBot(instance, currentSession, settings, bot, remoteJid, pushName, content);
  }

  // Método principal chamado pelo Controller
  public async processBot(
    instance: any,
    remoteJid: string,
    bot: EvolutionBot,
    session: IntegrationSession | null,
    settings: Partial<EvolutionBotSetting> | null,
    content: string | undefined | null,
    pushName?: string | null,
  ) {
     if (session && session.status !== 'opened') {
        this.logger.debug(`Sessão EvolutionBot para ${remoteJid} não está aberta (${session.status}). Ignorando.`);
        return;
     }

      // << CORREÇÃO TS2339: Usar optional chaining e fallback para expire >>
      // NOTE: Adicione 'expire Int?' ao EvolutionBotSetting no schema.prisma e regenere.
     if (session && settings?.expire && settings.expire > 0) {
       const now = Date.now();
       const sessionUpdatedAt = new Date(session.updatedAt).getTime();
       const diffInMinutes = Math.floor((now - sessionUpdatedAt) / 1000 / 60);

       if (diffInMinutes > settings.expire) {
          this.logger.info(`Sessão EvolutionBot para ${remoteJid} expirou (${diffInMinutes} min > ${settings.expire} min).`);
          // << CORREÇÃO TS2339: Usar optional chaining para keepOpen >>
          // NOTE: Adicione 'keepOpen Boolean?' ao EvolutionBotSetting no schema.prisma e regenere.
         if (settings?.keepOpen) {
           await this.updateSession(session.id, session.sessionId, false, 'closed');
           this.logger.info(`Sessão EvolutionBot marcada como fechada para ${remoteJid} (keepOpen=true).`);
         } else {
           await this.prismaRepository.prisma.integrationSession.deleteMany({ where: { botId: bot.id, remoteJid: remoteJid, type: 'evolution' } });
           this.logger.info(`Sessão EvolutionBot deletada para ${remoteJid} (keepOpen=false).`);
         }
         await this.initNewSession(instance, remoteJid, bot, settings, null, content || '', pushName);
         return;
       }
     }

     if (!session) {
       await this.initNewSession(instance, remoteJid, bot, settings, null, content || '', pushName);
       return;
     }

     // Atualiza sessão existente
     await this.updateSession(session.id, session.sessionId, false); // awaitUser = false

      // << CORREÇÃO TS2339: Usar optional chaining para unknownMessage >>
      // NOTE: Adicione 'unknownMessage String?' ao EvolutionBotSetting no schema.prisma e regenere.
     if (!content || content.trim() === '') {
        this.logger.warn(`Conteúdo vazio recebido para ${remoteJid} (EvolutionBot)`);
       if (settings?.unknownMessage) {
           await this.sendMessageWhatsApp(instance, remoteJid, settings.unknownMessage, settings);
       }
       await this.updateSession(session.id, session.sessionId, true); // Volta a esperar usuário
       return;
     }

      // << CORREÇÃO TS2339: Usar optional chaining para keywordFinish e keepOpen >>
      // NOTE: Adicione 'keywordFinish String?' e 'keepOpen Boolean?' ao EvolutionBotSetting no schema.prisma e regenere.
     if (settings?.keywordFinish && content.toLowerCase() === settings.keywordFinish.toLowerCase()) {
        this.logger.info(`Keyword de finalização EvolutionBot recebida de ${remoteJid}.`);
       if (settings?.keepOpen) {
           await this.updateSession(session.id, session.sessionId, false, 'closed');
       } else {
           await this.prismaRepository.prisma.integrationSession.delete({ where: { id: session.id }});
       }
       return;
     }

     // Envia para o bot
     await this.sendMessageToBot(instance, session, settings, bot, remoteJid, pushName, content);
   } // Fim processBot

   // Função auxiliar para atualizar sessão (similar ao DifyService)
   private async updateSession(sessionId: string, newConversationId: string | null, awaitUser: boolean, status: 'opened' | 'closed' | 'paused' | 'error' = 'opened'): Promise<void> {
       try {
          await this.prismaRepository.prisma.integrationSession.update({
             where: { id: sessionId },
             data: {
                 status: status,
                 awaitUser: awaitUser,
                 sessionId: newConversationId,
             },
          });
       } catch (error: any) {
          this.logger.error(`Erro ao atualizar sessão de integração ${sessionId}: ${error.message}`);
       }
   }

} // Fim da classe EvolutionBotService
