// CORREÇÃO TS2307: Usar nome correto do pacote @whiskeysockets/baileys
import { BinaryNode, Contact, JidWithDevice, proto, WAConnectionState } from '@whiskeysockets/baileys';

// Interfaces para eventos Socket.IO (Cliente <-> Servidor) para chamadas de voz

export interface ServerToClientEvents {
  // Cliente pede algo ao servidor e espera um callback de confirmação/erro
  withAck: (d: string, callback: (e: number) => void) => void;

  // Funções que o cliente pode chamar no servidor (para executar ações Baileys)
  onWhatsApp: onWhatsAppType;
  profilePictureUrl: ProfilePictureUrlType;
  assertSessions: AssertSessionsType;
  createParticipantNodes: CreateParticipantNodesType;
  getUSyncDevices: GetUSyncDevicesType;
  generateMessageTag: GenerateMessageTagType;
  sendNode: SendNodeType;
  'signalRepository:decryptMessage': SignalRepositoryDecryptMessageType; // Usando ':' para simular namespace
}

export interface ClientToServerEvents {
  // Eventos que o servidor envia para o cliente
  init: (
    me: Contact | undefined,
    account: proto.IADVSignedDeviceIdentity | undefined,
    status: WAConnectionState,
  ) => void;

  // Callbacks específicos de chamadas
  'CB:call': (packet: any) => void; // Callback genérico para eventos de chamada
  'CB:ack,class:call': (packet: any) => void; // Callback para ACKs de chamadas

  // Atualizações de conexão enviadas ao cliente
  'connection.update:status': (
    me: Contact | undefined,
    account: proto.IADVSignedDeviceIdentity | undefined,
    status: WAConnectionState,
  ) => void;
  'connection.update:qr': (qr: string) => void; // Envio de QR Code
}

// --- Tipos específicos para os eventos ServerToClient ---

// onWhatsApp
export type onWhatsAppType = (jid: string, callback: onWhatsAppCallback) => void;
export type onWhatsAppCallback = (
  response: {
    exists: boolean;
    jid: string;
  }[],
) => void;

// profilePictureUrl
export type ProfilePictureUrlType = (
  jid: string,
  type: 'image' | 'preview', // Tipos válidos
  timeoutMs: number | undefined,
  callback: ProfilePictureUrlCallback,
) => void;
export type ProfilePictureUrlCallback = (response: string | undefined) => void; // URL ou undefined

// assertSessions
export type AssertSessionsType = (jids: string[], force: boolean, callback: AssertSessionsCallback) => void;
export type AssertSessionsCallback = (response: boolean) => void; // Sucesso/Falha

// createParticipantNodes (estrutura do retorno precisa ser verificada)
export type CreateParticipantNodesType = (
  jids: string[],
  message: any, // Tipo da mensagem (node?)
  extraAttrs: any, // Atributos extras (node?)
  callback: CreateParticipantNodesCallback,
) => void;
export type CreateParticipantNodesCallback = (nodes: any, shouldIncludeDeviceIdentity: boolean) => void;

// getUSyncDevices
export type GetUSyncDevicesType = (
  jids: string[],
  useCache: boolean,
  ignoreZeroDevices: boolean,
  callback: GetUSyncDevicesTypeCallback,
) => void;
export type GetUSyncDevicesTypeCallback = (jids: JidWithDevice[]) => void; // Retorna JIDs com device

// generateMessageTag
export type GenerateMessageTagType = (callback: GenerateMessageTagTypeCallback) => void;
export type GenerateMessageTagTypeCallback = (response: string) => void; // Retorna a tag gerada

// sendNode
export type SendNodeType = (stanza: BinaryNode, callback: SendNodeTypeCallback) => void;
export type SendNodeTypeCallback = (response: boolean) => void; // Sucesso/Falha

// signalRepository:decryptMessage
export type SignalRepositoryDecryptMessageType = (
  jid: string,
  type: 'pkmsg' | 'msg', // Tipos de criptografia
  ciphertext: Buffer, // Dados criptografados
  callback: SignalRepositoryDecryptMessageCallback,
) => void;
export type SignalRepositoryDecryptMessageCallback = (response: any) => void; // Mensagem decriptada (estrutura?)
