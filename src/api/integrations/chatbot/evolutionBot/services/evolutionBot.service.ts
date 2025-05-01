// src/api/integrations/chatbot/evolutionBot/services/evolutionBot.service.ts

/* eslint-disable @typescript-eslint/no-unused-vars */
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { Integration } from '@api/types/wa.types'; // Ajustado caminho relativo/alias
import { Auth, ConfigService, HttpServer } from '@config/env.config'; // Assume alias
import { Logger } from '@config/logger.config'; // Assume alias
// Importa tipos Prisma necessários
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
      // << CORREÇÃO: Readicionado pushName pois agora existe no schema >>
      const session = await this.prismaRepository.prisma.integrationSession.create({
        data: {
          remoteJid: data.remoteJid,
          pushName: data.pushName, // Readicionado
          integrationSpecificSessionId: data.remoteJid, // Usar remoteJid como sessionId inicial?
          status: 'opened',
          awaitUser: false,
          botId: data.botId, // Garante que botId está sendo passado
          instanceId: instance.instanceId,
          type: 'evolution', // Define o tipo correto
        },
      });
      this.logger.log(`Nova sessão EvolutionBot criada para ${data.remoteJid}, Bot ID: ${data.botId}`);
      return { session };
    } catch (error: any) {
      this.logger.error(`Erro ao criar nova sessão EvolutionBot: ${error.message}`);
      // Considerar relançar ou retornar um erro específico
      return undefined;
    }
  }

  private isImageMessage(content: string | undefined | null): boolean {
    return !!content && content.includes('imageMessage');
  }

  private async sendMessageToBot(
    instance: any,
    session: IntegrationSession,
    settings: Partial<EvolutionBotSetting> | null,
    bot: EvolutionBot,
    remoteJid: string,
    pushName: string | undefined | null,
    content: string,
  ) {
    try {
      // Acessa apiUrl (agora existe no tipo EvolutionBot)
      const endpoint: string = bot.apiUrl ?? '';
      if (!endpoint) {
          this.logger.error(`API URL não definida para o bot Evolution ID ${bot.id}`);
          return;
      }

      const payload = {
        conversationId: session.integrationSpecificSessionId === remoteJid ? undefined : session.integrationSpecificSessionId, // Corrigido nome do campo
        text: content,
        from: remoteJid,
        sender: {
            pushName: pushName ?? remoteJid.split('@')[0],
            id: remoteJid,
        },
        instance: {
             name: instance.instanceName,
             serverUrl: this.configService.get<HttpServer>('SERVER')?.URL,
             apiKey: this.configService.get<Auth>('AUTHENTICATION')?.API_KEY?.KEY,
        }
        // TODO: Adicionar tratamento para imagens/arquivos
      };

      this.logger.debug(`Enviando para EvolutionBot (${bot.id}): User=${remoteJid}, Session=${session.integrationSpecificSessionId}`);

      // Enviar presença 'composing'
      if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
         await instance.client.presenceSubscribe(remoteJid).catch((e:any) => this.logger.warn(`Erro presenceSubscribe: ${e.message}`));
         await instance.client.sendPresenceUpdate('composing', remoteJid).catch((e:any) => this.logger.warn(`Erro sendPresenceUpdate composing: ${e.message}`));
      }

      // Chamar API do bot
      const response = await axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(bot.apiKey && { 'Authorization': `Bearer ${bot.apiKey}` }),
        },
      });

      // Enviar presença 'paused'
      if (instance?.integration === Integration.WHATSAPP_BAILEYS && instance?.client?.sendPresenceUpdate) {
           await instance.client.sendPresenceUpdate('paused', remoteJid).catch((e:any) => this.logger.warn(`Erro sendPresenceUpdate paused: ${e.message}`));
      }

      // Processar resposta
      const message = response?.data?.text || response?.data?.message || response?.data;
      const conversationId = response?.data?.conversationId;

      await this.sendMessageWhatsApp(instance, remoteJid, settings, message);

      // Atualizar sessão
      await this.updateSession(session.id, conversationId ?? session.integrationSpecificSessionId, true); // Usa integrationSpecificSessionId

    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem para bot Evolution (${bot.id}): ${error.response?.data?.message || error.message}`);
      // Tenta atualizar sessão para erro?
      // await this.updateSession(session.id, session.integrationSpecificSessionId, false, 'error');
    }
  }

  private async sendMessageWhatsApp(
    instance: any,
    remoteJid: string,
    settings: Partial<EvolutionBotSetting> | null,
    message: string | undefined | null,
  ) {
    if (!message || message.trim() === '') {
      this.logger.warn(`Mensagem do bot Evolution vazia para ${remoteJid}.`);
      // Usa optional chaining e fallback para unknownMessage (agora existe no tipo)
      if (settings?.unknownMessage) {
        await instance.textMessage(
          {
            number: remoteJid.split('@')[0],
            // Usa optional chaining e fallback para delayMessage (agora existe no tipo)
            delay: settings?.delayMessage ?? 1000,
            text: settings.unknownMessage,
          },
          false,
        );
      }
      return;
    }

    // Lógica de split e envio com delay
    // Usa optional chaining e fallback (agora os campos existem nos tipos)
    const splitMessages = settings?.splitMessages ?? false;
    const timePerChar = settings?.timePerChar ?? 0;
    const minDelay = 500;
    const maxDelay = 10000;

    if (splitMessages) {
        const multipleMessages = message.trim().split('\n\n');
        for (const msgPart of multipleMessages) {
            const delay = Math.min(Math.max(msgPart.length * timePerChar, minDelay), maxDelay);
            await this.sendWithDelay(instance, remoteJid, { text: msgPart }, settings?.delayMessage ?? 1000, delay);
        }
    } else {
        await this.sendWithDelay(instance, remoteJid, { text: message.trim() }, settings?.delayMessage ?? 1000, settings?.delayMessage ?? 1000);
    }

    // Usa sendTelemetry importado
    sendTelemetry('/message/sendText');
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
    bot: EvolutionBot,
    settings: Partial<EvolutionBotSetting> | null,
    session: IntegrationSession | null, // Session pode ser null aqui
    content: string,
    pushName?: string | null,
  ) {
    const data = await this.createNewSession(instance, {
      remoteJid,
      pushName,
      botId: bot.id,
    });
    const currentSession = data?.session; // Pega a sessão criada
     if (!currentSession) {
         this.logger.error(`Falha ao criar sessão para ${remoteJid} no bot Evolution ${bot.id}`);
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
    settings: Partial<EvolutionBotSetting> | null, // Aceita null/Partial
    content: string | undefined | null,
    pushName?: string | null,
  ) {
     if (session && session.status !== 'opened') {
        this.logger.debug(`Sessão EvolutionBot para ${remoteJid} não está aberta (${session.status}). Ignorando.`);
        return;
     }

     // Usa optional chaining e fallback (campos agora existem nos tipos)
     if (session && settings?.expire && settings.expire > 0) {
       const now = Date.now();
       const sessionUpdatedAt = new Date(session.updatedAt).getTime();
       const diffInMinutes = Math.floor((now - sessionUpdatedAt) / 1000 / 60);

       if (diffInMinutes > settings.expire) {
          this.logger.info(`Sessão EvolutionBot para ${remoteJid} expirou (${diffInMinutes} min > ${settings.expire} min).`);
         if (settings?.keepOpen) {
           await this.updateSession(session.id, session.integrationSpecificSessionId, false, 'closed'); // Usa integrationSpecificSessionId
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
     await this.updateSession(session.id, session.integrationSpecificSessionId, false); // awaitUser = false, usa integrationSpecificSessionId

     if (!content || content.trim() === '') {
        this.logger.warn(`Conteúdo vazio recebido para ${remoteJid} (EvolutionBot)`);
       if (settings?.unknownMessage) { // Usa optional chaining
           await this.sendMessageWhatsApp(instance, remoteJid, settings, settings.unknownMessage);
       }
       await this.updateSession(session.id, session.integrationSpecificSessionId, true); // Volta a esperar usuário
       return;
     }

     // Usa optional chaining
     if (settings?.keywordFinish && content.toLowerCase() === settings.keywordFinish.toLowerCase()) {
        this.logger.info(`Keyword de finalização EvolutionBot recebida de ${remoteJid}.`);
       if (settings?.keepOpen) {
           await this.updateSession(session.id, session.integrationSpecificSessionId, false, 'closed');
       } else {
           await this.prismaRepository.prisma.integrationSession.delete({ where: { id: session.id }});
       }
       return;
     }

     // Envia para o bot
     await this.sendMessageToBot(instance, session, settings, bot, remoteJid, pushName, content);
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

} // Fim da classe EvolutionBotService
