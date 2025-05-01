// Arquivo: src/api/dto/sendMessage.dto.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Importar tipos do Baileys que são usados nas opções
import { proto, WAPresence } from '@whiskeysockets/baileys'; // Renomeado para evitar conflito com nome da var global

// Definição da mensagem original citada (Quoted)
export class Quoted {
  key: proto.IMessageKey;
  message: proto.IMessage; // Conteúdo da mensagem original
}

// Definição das opções de envio (ajuste conforme necessário)
export class Options {
  delay?: number; // Atraso em ms antes de enviar
  presence?: WAPresence; // 'unavailable' | 'available' | 'composing' | 'recording' | 'paused'
  quoted?: Quoted; // Mensagem a ser respondida
  linkPreview?: boolean; // Gerar preview para links (padrão true)
  // encoding?: boolean; // Não usado diretamente no envio? Verificar necessidade.
  mentionsEveryOne?: boolean; // Marcar @todos (em grupos)
  mentioned?: string[]; // Lista de JIDs a serem mencionados
  webhookUrl?: string; // URL específica para webhook desta mensagem (se aplicável)
  // Adicionar outras opções conforme necessário
}

// --- Tipos Base e Comuns ---

// Classe base ou interface para propriedades comuns
// (Usar classe base permite herança mais fácil)
export class MessageMetadata {
  number: string; // Destinatário (JID)
}

// Classe base que inclui metadados e opções comuns
export class BaseSendMessageDto extends MessageMetadata {
  // CORREÇÃO: Adicionada propriedade options opcional
  options?: Options;
}

export type MediaType = 'image' | 'document' | 'video' | 'audio' | 'ptv' | 'sticker'; // Adicionado sticker

// --- DTOs Específicos para cada Tipo de Mensagem ---

export class SendTextDto extends BaseSendMessageDto {
  text: string;
}

// DTO para presença (pode não precisar de options)
export class SendPresenceDto extends MessageMetadata { // Não herda de BaseSendMessageDto
  presence: WAPresence;
}

// DTO para Status (não é uma mensagem de chat comum)
export class SendStatusDto extends MessageMetadata { // Não herda de BaseSendMessageDto
  type: 'text' | 'image' | 'video'; // Tipo de status
  content: string; // Texto ou URL/Base64 da mídia
  statusJidList?: string[]; // Para quem enviar (privado)
  allContacts?: boolean; // Enviar para todos?
  caption?: string; // Legenda para mídia
  backgroundColor?: string; // Cor de fundo para texto
  font?: number; // Fonte para texto
}

export class SendPollDto extends BaseSendMessageDto {
  name: string; // Nome/Pergunta da enquete
  selectableCount: number; // Quantas opções podem ser selecionadas
  values: string[]; // Opções da enquete
  messageSecret?: Uint8Array; // Necessário para editar enquetes?
}

export class SendMediaDto extends BaseSendMessageDto {
  mediatype: MediaType;
  media: string; // URL ou Base64 da mídia
  mimetype?: string; // Necessário para alguns tipos como áudio/documento
  caption?: string;
  fileName?: string; // Especialmente para documentos
}

// PTV (Vídeo curto - pode ser tratado como vídeo normal na API Meta)
export class SendPtvDto extends BaseSendMessageDto {
  video: string; // URL ou Base64
}

// Sticker
export class SendStickerDto extends BaseSendMessageDto {
  sticker: string; // URL ou Base64 do sticker (geralmente .webp)
}

// Áudio
export class SendAudioDto extends BaseSendMessageDto {
  audio: string; // URL ou Base64 do áudio
  // CORREÇÃO TS2339: Propriedade 'ptt' movida para cá
  ptt?: boolean; // Indica se é Push-to-Talk (gravação de voz)
}

// --- Componentes para Mensagens Interativas ---

export type TypeButton = 'reply' | 'copy' | 'url' | 'call' | 'pix'; // Tipos de botão Baileys? Verificar compatibilidade Meta API
export type KeyType = 'phone' | 'email' | 'cpf' | 'cnpj' | 'random'; // Para PIX?

export class Button {
  type?: TypeButton; // Tipo Baileys, pode não ser usado diretamente na Meta API
  // CORREÇÃO TS2339: Usar 'displayText' conforme erros anteriores
  displayText?: string; // Texto exibido no botão
  id: string; // ID para identificar a resposta (obrigatório para 'reply')
  url?: string; // Para botões de URL
  copyCode?: string; // Para botões de copiar
  phoneNumber?: string; // Para botões de chamada
  // PIX (não padrão WA)
  currency?: string;
  name?: string;
  keyType?: KeyType;
  key?: string;
}

export class SendButtonsDto extends BaseSendMessageDto {
  // thumbnailUrl?: string; // Header pode ser texto, imagem, vídeo ou documento na Meta API
  title?: string; // Usado no Header (texto)
  description: string; // Corpo da mensagem
  footer?: string; // Rodapé
  buttons: Button[]; // Lista de botões (máx 3 para Meta API)
}

export class SendLocationDto extends BaseSendMessageDto {
  latitude: number;
  longitude: number;
  name?: string; // Nome do local
  address?: string; // Endereço
}

// Componentes para Listas
class Row {
  title: string; // Título da linha (obrigatório, máx 24 chars)
  description?: string; // Descrição (opcional, máx 72 chars)
  rowId: string; // ID da linha (obrigatório, máx 200 chars)
}
class Section {
  title: string; // Título da seção (obrigatório, máx 24 chars)
  rows: Row[]; // Linhas da seção (pelo menos 1, máx 10)
}
export class SendListDto extends BaseSendMessageDto {
  title?: string; // Título/Header da lista (opcional)
  description: string; // Corpo da mensagem (obrigatório)
  footerText?: string; // Rodapé (opcional)
  buttonText: string; // Texto do botão da lista (obrigatório, máx 20 chars)
  sections: Section[]; // Seções da lista (pelo menos 1, máx 10)
}

// Contato
export class ContactMessage {
  fullName: string; // Obrigatório para Meta API (formatted_name)
  wuid: string; // Obrigatório para Meta API (usado para phone.wa_id)
  phoneNumber?: string; // Opcional, pode ser derivado do wuid
  organization?: string; // Pode ser mapeado se API suportar
  email?: string; // Pode ser mapeado se API suportar
  url?: string; // Pode ser mapeado se API suportar
}

export class SendContactDto extends BaseSendMessageDto {
  // CORREÇÃO TS2339: Renomeado para 'contacts' (plural)
  contacts: ContactMessage[]; // Lista de contatos (Meta API suporta múltiplos)
}

// Template (estrutura complexa, depende do template específico)
export class SendTemplateDto extends BaseSendMessageDto {
  name: string; // Nome do template pré-aprovado
  language: string; // Código do idioma (ex: 'pt_BR')
  components: any[]; // Array de componentes (header, body, footer, buttons) - estrutura varia
  // webhookUrl?: string; // Não faz parte do envio, mas pode ser usado internamente
}

// Reação
export class SendReactionDto extends BaseSendMessageDto { // Herda para ter 'options' se necessário citar ao reagir?
  key: proto.IMessageKey; // Chave da mensagem a reagir
  reaction: string; // Emoji a ser enviado (ou string vazia para remover)
}
