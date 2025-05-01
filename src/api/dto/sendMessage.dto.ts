// Arquivo: src/api/dto/sendMessage.dto.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// CORRIGIDO: Garante que Baileys está instalado e tipos necessários importados
import { proto, WAPresence, MiscMessageGenerationOptions } from '@whiskeysockets/baileys';

// Definição da mensagem original citada (Quoted) - Baseado na estrutura Baileys
export class QuotedMessage { // Renomeado para clareza
  key: proto.IMessageKey;
  message: proto.IMessage | null; // Conteúdo da mensagem original (pode ser null)
}

// Definição das opções de envio (ajuste conforme necessário)
// Usando MiscMessageGenerationOptions do Baileys como base pode ser mais robusto
export class SendMessageOptions implements MiscMessageGenerationOptions { // Implementa a interface Baileys
  @ApiPropertyOptional({ description: 'Timestamp da mensagem (opcional)', type: Number })
  timestamp?: Date;

  @ApiPropertyOptional({ description: 'Mensagem a ser respondida/citada', type: QuotedMessage })
  quoted?: proto.IWebMessageInfo; // Tipo Baileys para quoted

  @ApiPropertyOptional({ description: 'Lista de JIDs a serem mencionados na mensagem' })
  mentions?: string[];

  @ApiPropertyOptional({ description: 'ID para rastreamento ou lógica customizada' })
  messageId?: string; // Baileys gera o seu próprio ID, este seria para uso externo

  @ApiPropertyOptional({ description: 'Atraso em ms antes de enviar (lógica customizada)' })
  delay?: number;

  // Outras opções de MiscMessageGenerationOptions podem ser adicionadas se necessário
  // ephemeralExpiration?: number | proto.Message.IEphemeralMessage.EphemeralSetting;
  // mediaUploadTimeoutMs?: number;
  // etc...
}

// --- Tipos Base e Comuns ---

export class BaseSendMessageDto {
  @ApiProperty({ example: '5511999999999@s.whatsapp.net', description: 'JID (Job ID) do destinatário ou grupo' })
  number: string; // Destinatário (JID)

  @ApiPropertyOptional({ description: 'Opções adicionais de envio da mensagem', type: SendMessageOptions })
  options?: SendMessageOptions;
}

export type MediaType = 'image' | 'document' | 'video' | 'audio' | 'sticker'; // Removido 'ptv' pois pode ser tratado como 'video'

// --- DTOs Específicos para cada Tipo de Mensagem ---

export class SendTextDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Olá mundo!', description: 'Conteúdo da mensagem de texto' })
  text: string;
}

// DTO para Mídia (URL ou Base64)
// CORRIGIDO: Padronizado como SendMediaDto, lidando com URL ou Base64
export class SendMediaDto extends BaseSendMessageDto {
  @ApiProperty({ enum: ['image', 'document', 'video', 'audio', 'sticker'], description: 'Tipo da mídia' })
  mediatype: MediaType;

  @ApiProperty({ example: 'https://example.com/image.jpg | data:image/jpeg;base64,...', description: 'URL da mídia ou string Base64 completa' })
  media: string; // URL ou Base64

  @ApiPropertyOptional({ example: 'image/jpeg', description: 'MIME type da mídia (importante para Base64 e alguns áudios/documentos)' })
  mimetype?: string;

  @ApiPropertyOptional({ example: 'Legenda da imagem ou vídeo', description: 'Legenda opcional para a mídia' })
  caption?: string;

  @ApiPropertyOptional({ example: 'documento.pdf', description: 'Nome do arquivo (especialmente para documentos)' })
  fileName?: string;

  @ApiPropertyOptional({ example: true, description: 'Indica se o áudio é PTT (Push-to-Talk / Mensagem de voz)' })
  ptt?: boolean; // Relevante apenas se mediatype for 'audio'

  @ApiPropertyOptional({ example: true, description: 'Indica se o vídeo é um GIF' })
  gif?: boolean; // Relevante apenas se mediatype for 'video'
}

// DTO específico para áudio foi removido, pois SendMediaDto com ptt=true cobre o caso de PTT.
// Se precisar de validações MUITO específicas para áudio, pode ser recriado.

// DTO para Sticker foi removido, SendMediaDto com mediatype='sticker' cobre o caso.

// --- Componentes para Mensagens Interativas ---

// Tipos de Botão (simplificado para o que é mais comum e suportado)
export type ButtonType = 'reply' | 'url' | 'call' | 'copy'; // Removido 'pix' por não ser padrão

export class Button {
  // O tipo ('reply', 'url', 'call') geralmente é inferido pelos campos preenchidos
  // Ex: se 'id' está presente, é reply; se 'url' está presente, é url.

  @ApiProperty({ example: 'Texto do Botão 1', description: 'Texto exibido no botão (obrigatório)' })
  displayText: string;

  @ApiPropertyOptional({ example: 'btn_reply_1', description: 'ID único para botões de resposta (obrigatório para tipo reply)' })
  id?: string; // Obrigatório para 'reply'

  @ApiPropertyOptional({ example: 'https://evolution.com', description: 'URL para botões de link (obrigatório para tipo url)' })
  url?: string; // Obrigatório para 'url'

  @ApiPropertyOptional({ example: '+5511999999999', description: 'Número de telefone para botões de chamada (obrigatório para tipo call)' })
  phoneNumber?: string; // Obrigatório para 'call'

  @ApiPropertyOptional({ example: 'CÓDIGO123', description: 'Valor a ser copiado para botões de copiar (obrigatório para tipo copy)'})
  copyCode?: string; // Obrigatório para 'copy'
}

// DTO para Botões Simples (Template Buttons ou similar - limitado a 3 botões geralmente)
export class SendButtonsDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Corpo da mensagem com botões.', description: 'Texto principal da mensagem (obrigatório)' })
  description: string; // Corpo

  @ApiPropertyOptional({ example: 'Título opcional', description: 'Texto do header (opcional)' })
  title?: string; // Header (texto simples)

  @ApiPropertyOptional({ example: 'Rodapé opcional', description: 'Texto do rodapé (opcional)' })
  footer?: string; // Footer

  // Header com Mídia (alternativa ao title)
  @ApiPropertyOptional({ description: 'URL ou Base64 da mídia para o header (imagem/vídeo/documento)'})
  headerMedia?: string;
  @ApiPropertyOptional({ enum: ['image', 'video', 'document'], description: 'Tipo da mídia no header' })
  headerMediaType?: 'image' | 'video' | 'document';

  @ApiProperty({ type: [Button], description: 'Lista de botões (máximo 3)' })
  buttons: Button[];
}

// DTO para Localização
export class SendLocationDto extends BaseSendMessageDto {
  @ApiProperty({ example: -23.5505, description: 'Latitude (obrigatório)' })
  latitude: number;

  @ApiProperty({ example: -46.6333, description: 'Longitude (obrigatório)' })
  longitude: number;

  @ApiPropertyOptional({ example: 'Nome do Local', description: 'Nome opcional do local' })
  name?: string;

  @ApiPropertyOptional({ example: 'Endereço do Local', description: 'Endereço opcional do local' })
  address?: string;
}

// Componentes para Listas
class Row {
  @ApiProperty({ example: 'Item 1 Título', description: 'Título da linha (obrigatório, máx 24 chars)' })
  title: string;

  @ApiPropertyOptional({ example: 'Descrição do Item 1', description: 'Descrição da linha (opcional, máx 72 chars)' })
  description?: string;

  @ApiProperty({ example: 'row_id_1', description: 'ID único da linha (obrigatório, máx 200 chars)' })
  rowId: string;
}
class Section {
  @ApiProperty({ example: 'Título da Seção 1', description: 'Título da seção (obrigatório, máx 24 chars)' })
  title: string;

  @ApiProperty({ type: [Row], description: 'Linhas da seção (pelo menos 1)' })
  rows: Row[];
}

// DTO para Lista
export class SendListDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Texto do corpo da lista', description: 'Corpo da mensagem (obrigatório)' })
  description: string; // Corpo

  @ApiProperty({ example: 'Clique aqui', description: 'Texto do botão que abre a lista (obrigatório, máx 20 chars)' })
  buttonText: string;

  @ApiPropertyOptional({ example: 'Título da Lista', description: 'Título/Header da lista (opcional)' })
  title?: string;

  @ApiPropertyOptional({ example: 'Rodapé da lista', description: 'Rodapé (opcional)' })
  footerText?: string;

  @ApiProperty({ type: [Section], description: 'Seções da lista (pelo menos 1)' })
  sections: Section[];
}

// DTO para Contato(s)
// VCard pode ser complexo, simplificando para os campos mais comuns
export class ContactVCard {
    @ApiProperty({ example: 'Fulano de Tal', description: 'Nome completo formatado' })
    fullName: string;

    // Baileys usa 'notify' ou 'displayName', Meta usa 'name.first_name', 'name.last_name'
    // Simplificando para displayName por enquanto
    @ApiProperty({ example: 'Fulano', description: 'Nome de exibição' })
    displayName: string;

    @ApiProperty({ example: '5511988888888', description: 'Número de telefone principal (sem máscara, apenas dígitos)' })
    phoneNumber: string;

    @ApiPropertyOptional({ example: 'Empresa X', description: 'Organização/Empresa' })
    organization?: string;

    // O vCard real pode conter muito mais (emails, endereços, URLs, etc.)
    // A representação exata depende de como Baileys/Meta o processam.
}
export class SendContactDto extends BaseSendMessageDto {
  @ApiProperty({ type: [ContactVCard], description: 'Lista de contatos a serem enviados' })
  contacts: ContactVCard[]; // Pode ser um ou mais contatos
}

// DTO para Template (Estrutura simplificada, pode variar muito)
// O envio real geralmente requer o nome/namespace e os parâmetros
export class TemplateParameter {
    // O tipo pode ser text, currency, date_time, image, document, video, etc.
    @ApiProperty({ example: 'text', enum: ['text', 'currency', 'date_time', 'image', 'document', 'video'], description: 'Tipo do parâmetro' })
    type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video'; // E outros

    // Valor do parâmetro (texto, objeto de moeda, objeto de data, objeto de mídia)
    @ApiProperty({ example: 'Valor do parâmetro', description: 'Valor do parâmetro (string, objeto, etc.)' })
    value: any; // O tipo real depende do 'type'
}
export class TemplateComponent {
    @ApiProperty({ example: 'body', enum: ['header', 'body', 'button'], description: 'Tipo do componente' })
    type: 'header' | 'body' | 'button';

    @ApiPropertyOptional({ description: 'Parâmetros para este componente', type: [TemplateParameter] })
    parameters?: TemplateParameter[];

    // Para botões, pode ter sub_type e index
    @ApiPropertyOptional({ example: 'quick_reply', enum: ['quick_reply', 'url'], description: 'Subtipo do botão (se type=button)' })
    sub_type?: 'quick_reply' | 'url';

    @ApiPropertyOptional({ example: 0, description: 'Índice do botão (se type=button)' })
    index?: number;
}
export class SendTemplateDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'my_template_name', description: 'Nome do template (namespace pode ser implícito ou parte do nome)' })
  name: string; // Nome do template

  @ApiProperty({ example: 'pt_BR', description: 'Código do idioma do template' })
  language: string; // Ou { code: 'pt_BR' } dependendo da API

  @ApiPropertyOptional({ type: [TemplateComponent], description: 'Componentes com parâmetros preenchidos (se houver)' })
  components?: TemplateComponent[];
}

// DTO para Reação
export class SendReactionDto extends BaseSendMessageDto { // Herda para ter 'options' se precisar citar
  @ApiProperty({ example: '👍', description: 'Emoji da reação (string vazia "" para remover)' })
  reaction: string;

  @ApiProperty({ example: 'ABCDEFGHIJKLMNO0987654321', description: 'ID da mensagem à qual reagir' })
  messageId: string; // ID da mensagem original
}

// Manter outros DTOs que já estavam definidos se ainda forem necessários em outros lugares
// Ex: SendPresenceDto, SendStatusDto, SendPollDto

// --- DTOs que estavam no arquivo original mas não são de envio de mensagem ---
// Podem pertencer a chat.dto.ts ou instance.dto.ts

// export class SendPresenceDto extends MessageMetadata { // Já definido em chat.dto.ts?
//   presence: WAPresence;
// }

// export class SendStatusDto extends MessageMetadata { // Já definido em chat.dto.ts?
//   type: 'text' | 'image' | 'video';
//   content: string;
//   statusJidList?: string[];
//   allContacts?: boolean;
//   caption?: string;
//   backgroundColor?: string;
//   font?: number;
// }

// export class SendPollDto extends BaseSendMessageDto { // Já definido em chat.dto.ts?
//   name: string;
//   selectableCount: number;
//   values: string[];
//   messageSecret?: Uint8Array;
// }

// Havia um '}' extra no final do arquivo original, que foi removido.
