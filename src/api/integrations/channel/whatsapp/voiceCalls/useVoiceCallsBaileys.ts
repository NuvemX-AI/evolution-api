// src/api/integrations/channel/whatsapp/voiceCalls/useVoiceCallsBaileys.ts
// Correção Erro 76: Passa 'jid' como string para onWhatsApp.

// Credits: https://github.com/salmanytofficial/WebWhatsapp-Wrapper/blob/main/src/Utils/useVoiceCalls.ts

import { Boom } from '@hapi/boom';
import {
  DisconnectReason, fetchLatestBaileysVersion, proto, makeCacheableSignalKeyStore,
  GroupMetadata, ParticipantAction, jidNormalizedUser, makeWASocket, useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { writeFile } from 'fs/promises';
import { OfferResult, Transport } from './transport.type'; // Ajustar path se necessário

const Pino = require('pino'); // Usar require se não houver tipos ou import padrão não funcionar
const NodeCache = require('node-cache'); // Usar require

type WASocket = ReturnType<typeof makeWASocket>;

export type BaileysSocket = {
  getSession: (sessionId: string) => Promise<{ creds: any; keys: any }>;
  end: (error: Error | undefined) => void;
  init: () => Promise<WASocket>;
  getConfig: () => any; // Ajustar tipo de retorno se conhecido
};

export const useVoiceCalls = (baileys_sock: BaileysSocket, logger: any, sessionId: string) => {
  const transport = new Transport(logger);
  const calls = new Map<string, OfferResult>();

  transport.on('offer', (offer) => {
    logger.info({ offer }, `receieved offer for call ID: ${offer.callId}`);
    calls.set(offer.callId, offer);
    // TODO: Emitir evento para front-end/API informando sobre a chamada recebida
    // eventEmitter.emit('call.received', { instance: sessionId, callInfo: offer });
  });

  transport.on('reject', (reject) => {
    logger.info({ reject }, `call ${reject.callId} rejected`);
    // TODO: Emitir evento para front-end/API
  });

  transport.on('accept', (accept) => {
    logger.info({ accept }, `call ${accept.callId} accepted`);
    // TODO: Emitir evento para front-end/API
  });

  transport.on('terminate', (terminate) => {
    logger.info({ terminate }, `call ${terminate.callId} terminated`);
    calls.delete(terminate.callId);
    // TODO: Emitir evento para front-end/API
  });

  transport.on('timeout', ({ callId }) => {
    logger.info(`call ${callId} timed out`);
    calls.delete(callId);
    // TODO: Emitir evento para front-end/API
  });

  const handleCall = async ({ tag, attrs, content }: proto.IHIGHLYSTRUCTUREDNotification) => {
    if (tag !== 'call') {
      logger.info({ tag, attrs }, 'recv notification');
      return;
    }
    if (!content || !Array.isArray(content)) {
      logger.info({ content }, 'no content in call notification');
      return;
    }

    const stanza = content[0] as proto.IProtocolMessage; // Assumindo que content[0] é a stanza principal
    if (!stanza || !stanza.tag) return; // Verificar se stanza e tag existem

    const { tag: Action, attrs: callAttrs } = stanza; // attrs contém call-id, call-creator
    const callId = callAttrs['call-id'];
    const from = callAttrs.from;
    const status = callAttrs.status; // Pode ser 'offer', 'reject', 'accept', 'terminate'
    const jid = jidNormalizedUser(from);

    // Verificar se o número existe no WhatsApp
    try {
      // ** Correção Erro 76: Passar 'jid' como string **
      const response: any = await baileys_sock.onWhatsApp(jid); // Passar jid string diretamente
      logger.info({ jid, exists: response?.[0]?.exists }, 'Checked WhatsApp existence');
      if (!response?.[0]?.exists) {
        logger.warn({ jid }, 'Call from non-WhatsApp number, ignoring.');
        return;
      }
    } catch (error) {
      logger.error({ err: error, jid }, 'Failed to check WhatsApp existence');
      // Continuar mesmo assim? Ou rejeitar a chamada? Depende da política desejada.
    }


    // A lógica original processava 'offer' e 'terminate'. Adaptar conforme necessário.
    // O Transport agora lida com o parsing e emissão de eventos específicos ('offer', 'reject', 'accept', 'terminate').
    // Apenas encaminhar a stanza para o Transport.
    transport.push(stanza);

  }; // Fim de handleCall


  const listen = async () => {
    try {
        const sock = await baileys_sock.init(); // Inicializa o socket Baileys
        // A assinatura mudou, parece que 'ws:notify' é obsoleto ou o evento é tratado de outra forma.
        // Baileys agora pode emitir eventos específicos para chamadas.
        // Exemplo (verificar documentação atual do Baileys):
        // sock.ev.on('call', handleCall); // Nome do evento pode ser diferente

         // Ou talvez ainda use um evento genérico, mas com estrutura diferente?
         sock.ev.on('messages.upsert', (update) => {
             // Verificar se a mensagem contém notificação de chamada?
             update.messages.forEach(msg => {
                 // Analisar msg.messageStubType ou conteúdo para identificar notificações de chamada
                 // Exemplo MUITO simplificado:
                 if (msg.messageStubType === proto.WebMessageInfo.StubType.CALL_MISSED_VOICE ||
                     msg.messageStubType === proto.WebMessageInfo.StubType.CALL_MISSED_VIDEO) {
                     logger.info({ jid: msg.key.remoteJid, type: msg.messageStubType }, 'Missed call notification');
                     // TODO: Emitir evento de chamada perdida
                 }
             });
         });

         // Escutar notificações de nós (pode conter info de chamada)
         sock.ev.on('nodes.upsert', (nodes) => {
             nodes.forEach(node => {
                // Verificar se o node é uma notificação 'call'
                if (node.tag === 'call') {
                   // handleCall(node); // Passar o node para o handler antigo (adaptar se necessário)
                   logger.warn('Recebido node com tag "call", processamento via handleCall desativado/precisa adaptação.', node);
                } else if (node.tag === 'notification' && node.attrs.type === 'call') {
                    // Outro formato possível para notificações de chamada
                    logger.info('Recebida notificação de chamada via tag "notification".', node);
                    // Processar node.content para obter detalhes da chamada
                    // Ex: handleCall(node); ou lógica específica
                }
             });
         });


        logger.info('Listening for call notifications...');
    } catch (error) {
        logger.error({ err: error }, 'Error listening for calls');
        baileys_sock.end(error as Error); // Encerrar em caso de erro
    }
  };

  // Retornar funções para interagir com as chamadas (se necessário)
  return {
    listen, // Função para iniciar a escuta
    // Exemplo: Funções para aceitar, rejeitar, encerrar chamadas programaticamente
    // acceptCall: async (callId: string) => { /* ... enviar stanza de aceite ... */ },
    // rejectCall: async (callId: string) => { /* ... enviar stanza de rejeição ... */ },
    // endCall: async (callId: string) => { /* ... enviar stanza de término ... */ },
  };
}; // Fim de useVoiceCalls
