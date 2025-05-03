// CORREÇÃO TS2307: Usar nome correto do pacote @whiskeysockets/baileys
import { ConnectionState, WAConnectionState, WASocket } from '@whiskeysockets/baileys';
import { io, Socket } from 'socket.io-client';

// Importar tipos de eventos definidos localmente
import { ClientToServerEvents, ServerToClientEvents } from './transport.type';

let baileys_connection_state: WAConnectionState = 'close';

// Função para estabelecer a conexão Socket.IO para chamadas de voz
export const useVoiceCallsBaileys = async (
  wavoip_token: string, // Token específico do serviço Wavoip
  baileys_sock: WASocket, // Instância do socket Baileys principal
  status?: WAConnectionState, // Status inicial da conexão Baileys
  logger?: boolean, // Flag para habilitar logs
): Promise<Socket<ServerToClientEvents, ClientToServerEvents>> => { // Retorna a instância do socket.io
  baileys_connection_state = status ?? 'close';

  // Conecta ao servidor Wavoip usando o token fornecido
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io('https://devices.wavoip.com/baileys', {
    transports: ['websocket'],
    path: `/${wavoip_token}/websocket`,
    // Adicionar outras opções de conexão se necessário (reconnection, etc.)
  });

  // --- Handlers de Eventos do Socket.IO ---

  socket.on('connect', () => {
    if (logger) console.log('[*] - Wavoip connected', socket.id);
    // Envia informações iniciais da instância Baileys para o servidor Wavoip
    socket.emit(
      'init',
      baileys_sock.authState.creds.me,
      baileys_sock.authState.creds.account,
      baileys_connection_state,
    );
  });

  socket.on('disconnect', () => {
    if (logger) console.log('[*] - Wavoip disconnect');
    // Lógica de reconexão pode ser necessária aqui ou gerenciada pelo socket.io
  });

  socket.on('connect_error', (error) => {
    if (socket.active) {
      // Tentativas de reconexão automáticas geralmente ocorrem aqui
      if (logger) {
        console.log(
          '[*] - Wavoip connection error temporary failure, the socket will automatically try to reconnect',
          error,
        );
       }
    } else {
      // Erro permanente ou falha na conexão inicial
      if (logger) console.error('[*] - Wavoip connection error', error.message);
    }
  });

  // --- Handlers para chamadas do Servidor Wavoip para o Cliente (executar ações Baileys) ---

  socket.on('onWhatsApp', async (jid, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested onWhatsApp for ${jid}`);
      // A função onWhatsApp do Baileys espera um array de JIDs
      // Se a API Wavoip envia apenas um JID, precisamos encapsulá-lo em um array
      const response: any = await baileys_sock.onWhatsApp([jid]); // Passar JID como array
      // O retorno é um array, pegamos o primeiro elemento para o callback (se houver)
      callback(response);
      if (logger) console.log('[*] Success on call onWhatsApp function', response);
    } catch (error) {
      if (logger) console.error('[*] Error on call onWhatsApp function', error);
      // Considerar chamar o callback com erro: callback(undefined, error); (se a assinatura permitir)
    }
  });

  socket.on('profilePictureUrl', async (jid, type, timeoutMs, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested profilePictureUrl for ${jid}`);
      const response = await baileys_sock.profilePictureUrl(jid, type, timeoutMs);
      callback(response);
      if (logger) console.log('[*] Success on call profilePictureUrl function', response);
    } catch (error) {
      if (logger) console.error('[*] Error on call profilePictureUrl function', error);
      // callback(undefined, error);
    }
  });

  socket.on('assertSessions', async (jids, force, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested assertSessions`);
      const response = await baileys_sock.assertSessions(jids, force);
      callback(response);
      if (logger) console.log('[*] Success on call assertSessions function', response);
    } catch (error) {
      if (logger) console.error('[*] Error on call assertSessions function', error);
      // callback(false, error);
    }
  });

  // Verificar a assinatura exata de createParticipantNodes no Baileys
  socket.on('createParticipantNodes', async (jids, message, extraAttrs, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested createParticipantNodes`);
      // O método pode não existir ou ter assinatura diferente
      // const response = await baileys_sock.createParticipantNodes(jids, message, extraAttrs);
      // callback(response, true); // Ajustar callback conforme retorno real
      if (logger) console.warn('[*] createParticipantNodes pode não estar disponível/implementado no Baileys da mesma forma.');
      callback(null, false); // Retorno placeholder
    } catch (error) {
      if (logger) console.error('[*] Error on call createParticipantNodes function', error);
      // callback(null, false, error);
    }
  });

  socket.on('getUSyncDevices', async (jids, useCache, ignoreZeroDevices, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested getUSyncDevices`);
      const response = await baileys_sock.getUSyncDevices(jids, useCache, ignoreZeroDevices);
      callback(response);
      if (logger) console.log('[*] Success on call getUSyncDevices function', response);
    } catch (error) {
      if (logger) console.error('[*] Error on call getUSyncDevices function', error);
      // callback([], error);
    }
  });

  socket.on('generateMessageTag', async (callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested generateMessageTag`);
      const response = await baileys_sock.generateMessageTag();
      callback(response);
      if (logger) console.log('[*] Success on call generateMessageTag function', response);
    } catch (error) {
      if (logger) console.error('[*] Error on call generateMessageTag function', error);
      // callback('', error);
    }
  });

  socket.on('sendNode', async (stanza, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested sendNode: ${JSON.stringify(stanza)}`);
      await baileys_sock.sendNode(stanza); // sendNode geralmente não retorna dados significativos
      callback(true); // Indica sucesso
      if (logger) console.log('[*] Success on call sendNode function');
    } catch (error) {
      if (logger) console.error('[*] Error on call sendNode function', error);
      callback(false); // Indica falha
    }
  });

  // Verificar a assinatura exata de decryptMessage no Baileys
  socket.on('signalRepository:decryptMessage', async (jid, type, ciphertext, callback) => {
    try {
      if (logger) console.log(`[*] - Wavoip requested signalRepository:decryptMessage for ${jid}`);
      // Acesso ao repositório de sinal pode ser diferente
      const response = await (baileys_sock.signalRepository as any).decryptMessage({ // Usar 'as any' se a estrutura exata for incerta
        jid: jid,
        type: type,
        ciphertext: ciphertext,
      });
      callback(response);
      if (logger) console.log('[*] Success on call signalRepository:decryptMessage function', response);
    } catch (error) {
      if (logger) console.error('[*] Error on call signalRepository:decryptMessage function', error);
      // callback(null, error);
    }
  });

  // --- Handlers para eventos do Baileys (enviar para Servidor Wavoip) ---

  baileys_sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection } = update;
    if (connection) {
      baileys_connection_state = connection;
      // Envia atualização de status para o servidor Wavoip
      socket
        .timeout(1000) // Adiciona timeout para garantir entrega ou erro
        .emit(
          'connection.update:status',
          baileys_sock.authState.creds.me,
          baileys_sock.authState.creds.account,
          connection,
        );
    }
    if (update.qr) {
      // Envia QR Code para o servidor Wavoip
      socket.timeout(1000).emit('connection.update:qr', update.qr);
    }
  });

  // Ouve eventos de chamada diretamente do WebSocket do Baileys
  baileys_sock.ws.on('CB:call', (packet) => {
    if (logger) console.log('[*] Signaling CB:call received from Baileys');
    // Envia o pacote de sinalização para o servidor Wavoip
    socket.volatile.timeout(1000).emit('CB:call', packet);
  });

  // Ouve ACKs de chamada do WebSocket do Baileys
  baileys_sock.ws.on('CB:ack,class:call', (packet) => {
    if (logger) console.log('[*] Signaling CB:ack,class:call received from Baileys');
    // Envia o pacote de ACK para o servidor Wavoip
    socket.volatile.timeout(1000).emit('CB:ack,class:call', packet);
  });

  return socket; // Retorna a instância do socket.io conectada e configurada
};
