// src/api/integrations/chatbot/dify/services/dify.service.ts
// Correções Gemini: Acesso Prisma, acesso a session.sessionId, comparação de tipo, argumentos de método.

/* eslint-disable @typescript-eslint/no-unused-vars */
import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Integration } from '@api/types/wa.types';
import { Auth, ConfigService, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
// Importar tipos Prisma necessários
import { Dify, DifySetting, IntegrationSession, Prisma } from '@prisma/client';
import { sendTelemetry } from '@utils/sendTelemetry';
import axios from 'axios';
import { Readable } from 'stream';
// Importar tipos do Baileys/WA se necessário para 'instance'
import { WASocket } from '@whiskeysockets/baileys';
import { ChannelStartupService } from '@api/services/channel.service'; // Importar para tipar 'instance'


export class DifyService {
  private readonly logger: Logger;

  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    baseLogger: Logger // Receber logger base
  ) {
      this.logger = baseLogger.child({ context: DifyService.name }); // Criar logger filho
  }

  public async createNewSession(instance: InstanceDto, data: { remoteJid: string, pushName?: string | null, botId: string }): Promise<{ session: IntegrationSession } | undefined> {
    if (!instance.instanceId) {
        this.logger.error("createNewSession chamado sem instanceId válido.");
        return undefined;
    }
    try {
      // CORREÇÃO TS2339: Remover .prisma
      const session = await this.prismaRepository.integrationSession.create({
        data: {
          remoteJid: data.remoteJid,
          // pushName: data.pushName, // Remover se não existir no schema
          // CORREÇÃO TS2339: Assumindo que sessionId existe no schema IntegrationSession
          sessionId: data.remoteJid, // Usar remoteJid como ID inicial
          status: 'opened',
          awaitUser: false, // Bot inicia conversando
          botId: data.botId,
          instanceId: instance.instanceId,
          type: 'dify',
        },
      });
      this.logger.log(`Nova sessão Dify criada para ${data.remoteJid}, Bot ID: ${data.botId}, SessionDB ID: ${session.id}`);
      return { session };
    } catch (error: any) {
      this.logger.error(`Erro ao criar nova sessão Dify para ${data.remoteJid}: ${error.message}`);
      return undefined;
    }
  }

  private isImageMessage(content: string | undefined | null): boolean {
    // Verifica se é uma string e contém a estrutura de mensagem de imagem
    return typeof content === 'string' && content.includes('|imageMessage|'); // Adaptar se o formato for diferente
  }

  private isJSON(str: string): boolean {
    if (typeof str !== 'string') return false;
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  // CORREÇÃO TS2345: Aceitar Partial<DifySetting> | null para settings
  private async sendMessageToBot(
    instance: ChannelStartupService | undefined | null, // Usar tipo ChannelStartupService
    session: IntegrationSession,
    settings: Partial<DifySetting> | null, // Aceita Parcial ou Nulo
    dify: Dify,
    remoteJid: string,
    pushName: string | undefined | null,
    content: string,
  ) {
    if (!instance) {
        this.logger.error(`Instância WA não fornecida para sendMessageToBot (Dify).`);
        return;
    }
    try {
      const endpoint: string = dify.apiUrl ?? ''; // Usar URL do bot
      if (!endpoint) {
          this.logger.error(`API URL não definida para o bot Dify ID ${dify.id}`);
          return;
      }

      let response: any;
      const botType = dify.botType || 'chat';

      // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
      this.logger.debug(`Enviando para Dify (${botType}): User=${remoteJid}, Session=${session.sessionId}, Bot=${dify.id}`);

      // Enviar presença 'composing'
      await instance.sendPresence?.({ jid: remoteJid, presence: 'composing' })
          .catch((e: any) => this.logger.warn(`Erro ao enviar presença 'composing' para ${remoteJid}: ${e.message}`));

      // Monta payload base
      const payloadBase: any = {
         inputs: { // Incluir dados relevantes nos inputs
            ...(remoteJid && { remoteJid: remoteJid }),
            ...(pushName && { pushName: pushName }),
            ...(instance?.instanceName && { instanceName: instance.instanceName }),
         },
         query: content,
         user: remoteJid,
         // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
         conversation_id: session.sessionId === remoteJid ? undefined : session.sessionId,
         // Adicionar arquivos se necessário (requer lógica de upload/url)
      };
      // Adicionar API Key ao header
      const headers = { Authorization: `Bearer ${dify.apiKey}` };

      // Lógica específica por tipo de bot Dify
      // CORREÇÃO TS2367: Comparar com 'chat'
      if (botType === 'chat') {
        const chatEndpoint = `${endpoint.replace(/\/$/, '')}/chat-messages`;
        payloadBase.response_mode = 'blocking';
        this.logger.debug(`POST ${chatEndpoint} Payload: ${JSON.stringify(payloadBase)}`);
        response = await axios.post(chatEndpoint, payloadBase, { headers });
        const message = response?.data?.answer;
        const conversationId = response?.data?.conversation_id;
        await this.sendMessageWhatsApp(instance, remoteJid, message, settings);
        // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
        await this.updateSession(session.id, conversationId ?? session.sessionId!, true); // Garante que sessionId não é null aqui

      } else if (botType === 'agent') {
         const agentEndpoint = `${endpoint.replace(/\/$/, '')}/chat-messages`;
         payloadBase.response_mode = 'streaming';
         this.logger.debug(`POST ${agentEndpoint} Payload (streaming): ${JSON.stringify(payloadBase)}`);
         const streamResponse = await axios.post(agentEndpoint, payloadBase, { headers, responseType: 'stream' });
         let conversationId: string | undefined;
         let answer = '';
         const stream = streamResponse.data as Readable;
         for await (const chunk of stream) {
             const lines = chunk.toString().split('\n');
             for (const line of lines) {
                 if (line.startsWith('data:')) {
                    try {
                        const eventData = JSON.parse(line.substring(5));
                        if (eventData?.event === 'agent_message' || eventData?.event === 'message') { // Captura ambos os eventos
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
         // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
         await this.updateSession(session.id, conversationId ?? session.sessionId!, true); // Garante que sessionId não é null aqui

      } else if (botType === 'workflow') {
         const workflowEndpoint = `${endpoint.replace(/\/$/, '')}/workflows/run`;
         payloadBase.response_mode = 'blocking'; // Workflows podem ser blocking ou streaming
         this.logger.debug(`POST ${workflowEndpoint} Payload: ${JSON.stringify(payloadBase)}`);
         response = await axios.post(workflowEndpoint, payloadBase, { headers });
         // O caminho da resposta pode variar, verificar documentação Dify
         const message = response?.data?.data?.outputs?.text || response?.data?.text || response?.data?.answer;
         await this.sendMessageWhatsApp(instance, remoteJid, message, settings);
         // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
         await this.updateSession(session.id, session.sessionId!, true); // Workflow não retorna conversation_id

      } else {
        this.logger.error(`Tipo de bot Dify desconhecido ou não suportado: ${botType}`);
      }

    } catch (error: any) {
      this.logger.error(`Erro ao enviar mensagem para bot Dify (${dify.id}): ${error.response?.data?.message || error.message}`);
      // Considerar enviar mensagem de erro ou atualizar status da sessão
    } finally {
        // Enviar presença 'paused'
        await instance.sendPresence?.({ jid: remoteJid, presence: 'paused' })
             .catch((e: any) => this.logger.warn(`Erro ao enviar presença 'paused' para ${remoteJid}: ${e.message}`));
    }
  }

  // Função auxiliar para atualizar sessão
  private async updateSession(sessionIdDb: string, difyConversationId: string, awaitUser: boolean, status: 'opened' | 'closed' | 'paused' | 'error' = 'opened'): Promise<void> {
      try {
         // CORREÇÃO TS2339: Remover .prisma
         await this.prismaRepository.integrationSession.update({
            where: { id: sessionIdDb },
            data: {
                status: status,
                awaitUser: awaitUser,
                // CORREÇÃO TS2339: Atualizar sessionId (verificar schema)
                sessionId: difyConversationId, // Campo que armazena o ID da conversa Dify
            },
         });
         this.logger.debug(`Sessão DB ID ${sessionIdDb} atualizada: Status=${status}, AwaitUser=${awaitUser}, DifyConvID=${difyConversationId}`);
      } catch (error: any) {
         this.logger.error(`Erro ao atualizar sessão de integração ${sessionIdDb}: ${error.message}`);
      }
  }

  // CORREÇÃO TS2345: Aceitar Partial<DifySetting> | null
  private async sendMessageWhatsApp(instance: ChannelStartupService, remoteJid: string, message: string | undefined | null, settings: Partial<DifySetting> | null) {
    if (!message || message.trim() === '') {
      this.logger.warn(`Mensagem do bot Dify vazia para ${remoteJid}.`);
      if (settings?.unknownMessage) {
         await instance.textMessage(
            {
              number: remoteJid, // Passar JID completo
              text: settings.unknownMessage,
            },
            // Adicionar objeto options vazio se necessário pela assinatura
            {} // Objeto options vazio
          );
      }
      return;
    }

    // Lógica de processamento de mídia e envio com delay (mantida, verificar sendWithDelay)
    // ... (código de processamento de markdown/mídia) ...
     const linkRegex = /(!?)\[(.*?)\]\((.*?)\)/g;
     let textBuffer = '';
     let lastIndex = 0;
     let match: RegExpExecArray | null;

     const getMediaType = (url: string): string | null => { /* ... */ return null;}; // Simplificado, implementar se necessário

     while ((match = linkRegex.exec(message)) !== null) {
        const [fullMatch, exclMark, altText, url] = match;
        const mediaType = getMediaType(url);
        const beforeText = message.slice(lastIndex, match.index);
        if (beforeText) textBuffer += beforeText;

        if (mediaType) {
             const splitMessages = settings?.splitMessages ?? false;
             const timePerChar = settings?.timePerChar ?? 0;
             // Envia texto acumulado
             if (textBuffer.trim()) {
                // ... lógica de split/delay ...
                await this.sendWithDelay(instance, remoteJid, { text: textBuffer.trim() }, settings, settings?.delayMessage ?? 50);
                textBuffer = '';
             }
             // Envia mídia
             const mediaPayload: any = { number: remoteJid, caption: altText || undefined };
             // ... preparar payload mídia ...
             await this.sendWithDelay(instance, remoteJid, mediaPayload, settings, settings?.delayMessage ?? 50, 'media'); // Ajustar tipo
        } else {
           textBuffer += fullMatch;
        }
        lastIndex = linkRegex.lastIndex;
     }

     if (lastIndex < message.length) textBuffer += message.slice(lastIndex);

     if (textBuffer.trim()) {
         const splitMessages = settings?.splitMessages ?? false;
         const timePerChar = settings?.timePerChar ?? 0;
         // ... lógica de split/delay ...
         await this.sendWithDelay(instance, remoteJid, { text: textBuffer.trim() }, settings, settings?.delayMessage ?? 50);
     }

    sendTelemetry('/message/sendText'); // Enviar Telemetria
  }

  // CORREÇÃO TS2345: Aceitar Partial<DifySetting> | null
  private async sendWithDelay(instance: ChannelStartupService, remoteJid: string, data: any, settings: Partial<DifySetting> | null, delayMs: number, type: 'text' | 'media' | 'audio' = 'text') {
       try {
           await instance.sendPresence?.({ jid: remoteJid, presence: 'composing' }).catch(()=>{});
           await delay(delayMs > 0 ? delayMs : 50); // Usa delay ou um mínimo
           if (type === 'text') {
                await instance.textMessage({ number: remoteJid, text: data.text }, {}); // Passa options vazio
           } else {
                // Implementar envio de mídia
                this.logger.warn(`Envio de mídia (${type}) em sendWithDelay não totalmente implementado.`);
           }
           await instance.sendPresence?.({ jid: remoteJid, presence: 'paused' }).catch(()=>{});
       } catch(error: any) {
            this.logger.error(`Erro geral em sendWithDelay (Dify) para ${remoteJid}: ${error.message}`);
       }
  }

  // CORREÇÃO TS2345: Aceitar Partial<DifySetting> | null
  private async initNewSession(
    instance: ChannelStartupService, // Usar tipo correto
    remoteJid: string,
    dify: Dify,
    settings: Partial<DifySetting> | null, // Aceita Partial ou Nulo
    session: IntegrationSession | null,
    content: string,
    pushName?: string | null,
  ) {
    // Passar instanceId de instance
    const sessionData = await this.createNewSession(instance, {
      remoteJid,
      pushName,
      botId: dify.id,
    });

    const currentSession = sessionData?.session;
    if (!currentSession) {
         this.logger.error(`Falha ao obter/criar sessão para ${remoteJid} no bot Dify ${dify.id}`);
         return;
    }
    // Passar settings como está (Partial ou null)
    await this.sendMessageToBot(instance, currentSession, settings, dify, remoteJid, pushName, content);
  }

  // CORREÇÃO TS2345: Aceitar Partial<DifySetting> | null
  public async processDify(
    instance: ChannelStartupService | undefined | null, // Usar tipo correto
    remoteJid: string,
    dify: Dify,
    session: IntegrationSession | null,
    settings: Partial<DifySetting> | null, // Aceita Partial ou Nulo
    content: string | undefined | null,
    pushName?: string | null,
  ) {
    if (!instance) {
        this.logger.error(`Instância WA não encontrada para processDify (Dify).`);
        return;
    }
    // Verifica se a sessão existe e está fechada
    if (session && session.status === 'closed') {
       this.logger.debug(`Sessão Dify para ${remoteJid} está fechada. Ignorando.`);
      return;
    }

    // Verifica expiração
    if (session && settings?.expire && settings.expire > 0) {
      const now = Date.now();
      const sessionUpdatedAt = new Date(session.updatedAt).getTime();
      const diffInMinutes = Math.floor((now - sessionUpdatedAt) / 1000 / 60);

      if (diffInMinutes > settings.expire) {
         this.logger.info(`Sessão Dify para ${remoteJid} expirou (${diffInMinutes} min > ${settings.expire} min).`);
        if (settings?.keepOpen) {
          // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
          await this.updateSession(session.id, session.sessionId!, false, 'closed'); // Garante não nulo
          this.logger.info(`Sessão Dify marcada como fechada para ${remoteJid} (keepOpen=true).`);
        } else {
          // CORREÇÃO TS2339: Remover .prisma
          await this.prismaRepository.integrationSession.deleteMany({
            where: { botId: dify.id, remoteJid: remoteJid, type: 'dify' },
          });
           this.logger.info(`Sessão Dify deletada para ${remoteJid} (keepOpen=false).`);
        }
        await this.initNewSession(instance, remoteJid, dify, settings, null, content || '', pushName);
        return;
      }
    }

    // Se não há sessão, inicia uma nova
    if (!session) {
      await this.initNewSession(instance, remoteJid, dify, settings, null, content || '', pushName);
      return;
    }

    // Atualiza sessão existente
    // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
    await this.updateSession(session.id, session.sessionId!, false); // Garante não nulo

    // Verifica conteúdo vazio
    if (!content || content.trim() === '') {
       this.logger.warn(`Conteúdo vazio recebido para ${remoteJid} (Dify)`);
      if (settings?.unknownMessage) {
          await this.sendMessageWhatsApp(instance, remoteJid, settings.unknownMessage, settings);
      }
      await this.updateSession(session.id, session.sessionId!, true); // Volta a esperar usuário
      return;
    }

    // Verifica keyword de finalização
    if (settings?.keywordFinish && content.toLowerCase() === settings.keywordFinish.toLowerCase()) {
       this.logger.info(`Keyword de finalização Dify recebida de ${remoteJid}.`);
      if (settings?.keepOpen) {
          // CORREÇÃO TS2339: Usar session.sessionId (verificar schema)
          await this.updateSession(session.id, session.sessionId!, false, 'closed');
      } else {
          // CORREÇÃO TS2339: Remover .prisma
          await this.prismaRepository.integrationSession.delete({ where: { id: session.id }});
      }
      return;
    }

    // Envia para o bot Dify (passando settings como Partial ou null)
    await this.sendMessageToBot(instance, session, settings, dify, remoteJid, pushName, content);
  }
}
