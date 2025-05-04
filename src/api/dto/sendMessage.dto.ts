// src/api/dto/sendMessage.dto.ts
// Correção Erro 23: Corrige importação do 'Long'.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsString, IsNotEmpty, IsOptional, ValidateNested, IsArray, ArrayMinSize,
    IsNumber, Min, Max, IsBoolean, IsEnum, Length, Allow, IsObject, IsDefined, MaxLength, MinLength
} from 'class-validator';
import { Type } from 'class-transformer';
// ** Correção Erro 23: Removido 'Long' da desestruturação **
import { proto, WAPresence, MiscMessageGenerationOptions } from '@whiskeysockets/baileys';
// ** Correção Erro 23: Adicionada importação default para 'Long' **
import Long from '@whiskeysockets/baileys'; // Import Long as default

// --- Enums e Tipos Auxiliares ---

// Definindo PresenceStatus diretamente se WAPresence não for o enum correto
export enum PresenceStatus {
    unavailable = 'unavailable', // Offline
    available = 'available',     // Online
    composing = 'composing',     // Digitanto...
    recording = 'recording',     // Gravando áudio...
    paused = 'paused',         // Pausado (parou de digitar/gravar)
}


// Representa a chave de uma mensagem (para reações, respostas, etc.)
export class MessageKeyDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    remoteJid: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    id: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    fromMe?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    participant?: string; // Necessário para grupos
}

// Representa a mensagem original citada (quoted)
export class QuotedMessageDto {
    @ApiProperty()
    @ValidateNested()
    @Type(() => MessageKeyDto)
    key: MessageKeyDto;

    @ApiPropertyOptional({ description: 'Conteúdo da mensagem citada (pode ser simplificado ou completo)' })
    @IsOptional()
    @IsObject() // Ou um tipo mais específico se a estrutura for conhecida
    message?: any; // Use WAProto.IMessage ou um DTO mais simples se preferir
}

// Representa opções gerais de envio de mensagem
export class SendMessageOptions {
    @ApiPropertyOptional({ description: 'Timestamp da mensagem (Unix Epoch ms)' })
    @IsOptional()
    @IsNumber()
    timestamp?: number;

    @ApiPropertyOptional({ description: 'Mensagem a ser citada/respondida' })
    @IsOptional()
    @ValidateNested()
    @Type(() => QuotedMessageDto)
    quoted?: QuotedMessageDto;

    @ApiPropertyOptional({ description: 'Delay em milissegundos antes de enviar' })
    @IsOptional()
    @IsNumber()
    delay?: number;

    @ApiPropertyOptional({ description: 'ID customizado para a mensagem' })
    @IsOptional()
    @IsString()
    messageId?: string;

     // Gemini: Adicionando opções comuns
     @ApiPropertyOptional({ description: 'Marcar mensagem como visualização única' })
     @IsOptional()
     @IsBoolean()
     viewOnce?: boolean;

     @ApiPropertyOptional({ description: 'Editar uma mensagem existente (requer messageId na key)' })
     @IsOptional()
     @ValidateNested()
     @Type(() => MessageKeyDto)
     edit?: MessageKeyDto; // Passar a chave da mensagem a ser editada
}

// Base DTO com propriedades comuns a quase todas as mensagens
export class BaseSendMessageDto {
    @ApiProperty({ example: '5511999999999@s.whatsapp.net or 123456789-123456789@g.us' })
    @IsString()
    @IsNotEmpty()
    number: string; // Destinatário (JID)

    @ApiPropertyOptional({ type: () => SendMessageOptions })
    @IsOptional()
    @ValidateNested()
    @Type(() => SendMessageOptions)
    options?: SendMessageOptions;
}

// --- DTOs Específicos por Tipo de Mensagem ---

export class SendTextDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Sua mensagem de texto aqui' })
    @IsString()
    @IsNotEmpty()
    message: string;
}

export class SendContactDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Contato Exemplo' })
    @IsString()
    @IsNotEmpty()
    contactName: string;

    @ApiProperty({ example: '5511888888888' }) // Número sem máscara
    @IsString()
    @IsNotEmpty()
    contactNumber: string;
}

export class SendLocationDto extends BaseSendMessageDto {
    @ApiProperty({ example: -23.5505 })
    @IsNumber()
    latitude: number;

    @ApiProperty({ example: -46.6333 })
    @IsNumber()
    longitude: number;

    @ApiPropertyOptional({ example: 'Escritório' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ example: 'R. Exemplo, 123' })
    @IsOptional()
    @IsString()
    address?: string;
}

export class SendLinkDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'https://evolution-api.com' })
    @IsUrl()
    url: string;

    @ApiProperty({ example: 'Confira este link!' })
    @IsString()
    @IsNotEmpty()
    caption: string; // Legenda/texto que acompanha o link

    @ApiPropertyOptional({ example: 'Evolution API' })
    @IsOptional()
    @IsString()
    title?: string; // Título da pré-visualização

    @ApiPropertyOptional({ description: 'URL de uma imagem de thumbnail (JPEG)', example: 'https://server.com/thumb.jpg' })
    @IsOptional()
    @IsUrl()
    thumbnailUrl?: string; // Ou pode aceitar base64
}

export class SendReactionDto extends BaseSendMessageDto {
    @ApiProperty({ description: 'Emoji para reagir', example: '👍' })
    @IsString()
    @IsNotEmpty()
    @Length(1, 4) // Permite emojis simples e compostos
    reaction: string;

    @ApiProperty({ description: 'Chave da mensagem à qual reagir' })
    @IsDefined()
    @ValidateNested()
    @Type(() => MessageKeyDto)
    key: MessageKeyDto;
}

// DTO Genérico para Mídias (Imagem, Vídeo, Áudio, Documento, Sticker)
// O tipo exato é determinado pela propriedade 'mediaType'
export class SendMediaDto extends BaseSendMessageDto {
    @ApiProperty({ description: 'Tipo da mídia', enum: ['image', 'video', 'audio', 'document', 'sticker', 'ptv'] })
    @IsEnum(['image', 'video', 'audio', 'document', 'sticker', 'ptv']) // Definir tipos permitidos
    mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'ptv';

    @ApiProperty({ description: 'URL da mídia OU nome do arquivo (se enviado via form-data)' })
    @IsString()
    @IsNotEmpty()
    media: string; // Pode ser URL ou nome de referência do arquivo em form-data

    @ApiPropertyOptional({ description: 'Legenda para imagem/vídeo/documento' })
    @IsOptional()
    @IsString()
    caption?: string;

    @ApiPropertyOptional({ description: 'Nome do arquivo (para documentos)' })
    @IsOptional()
    @IsString()
    filename?: string;

    @ApiPropertyOptional({ description: 'Para áudio, enviar como mensagem de voz (PTT)' })
    @IsOptional()
    @IsBoolean()
    ptt?: boolean; // Indica se áudio é PTT
}


// Representa um botão simples
export class ButtonDto {
    @ApiProperty({ example: 'Texto do Botão' })
    @IsString()
    @IsNotEmpty()
    text: string;

    @ApiProperty({ example: 'id-do-botao-1' })
    @IsString()
    @IsNotEmpty()
    id: string;
}

export class SendButtonsDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Texto principal da mensagem de botões' })
    @IsString()
    @IsNotEmpty()
    message: string;

    @ApiProperty({ type: [ButtonDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ButtonDto)
    buttons: ButtonDto[];

    @ApiPropertyOptional({ example: 'Texto do rodapé' })
    @IsOptional()
    @IsString()
    footerText?: string;

    // Opção para adicionar imagem/vídeo/documento no cabeçalho
    @ApiPropertyOptional({ description: 'URL de uma mídia para o cabeçalho' })
    @IsOptional()
    @IsUrl()
    headerMediaUrl?: string; // Ou base64, ou nome do arquivo (requer ajuste)

    @ApiPropertyOptional({ description: 'Tipo da mídia do cabeçalho', enum: ['image', 'video', 'document'] })
    @IsOptional()
    @IsEnum(['image', 'video', 'document'])
    headerMediaType?: 'image' | 'video' | 'document';
}

// Representa um botão de template (pode ser resposta rápida, URL ou call)
export class TemplateButtonDto {
    @ApiProperty({ description: 'Tipo do índice do botão (1, 2, 3...)', example: 1 })
    @IsNumber()
    index: number;

    @ApiPropertyOptional({ description: 'Botão de Resposta Rápida' })
    @IsOptional()
    @ValidateNested()
    @Type(() => QuickReplyButtonDto)
    quickReplyButton?: QuickReplyButtonDto;

    @ApiPropertyOptional({ description: 'Botão de URL' })
    @IsOptional()
    @ValidateNested()
    @Type(() => UrlButtonDto)
    urlButton?: UrlButtonDto;

    @ApiPropertyOptional({ description: 'Botão de Chamada Telefônica' })
    @IsOptional()
    @ValidateNested()
    @Type(() => CallButtonDto)
    callButton?: CallButtonDto;
}

export class QuickReplyButtonDto {
    @ApiProperty({ example: 'Texto de Exibição' })
    @IsString()
    @IsNotEmpty()
    displayText: string;

    @ApiProperty({ example: 'payload-resposta-rapida' })
    @IsString()
    @IsNotEmpty()
    id: string;
}

export class UrlButtonDto {
    @ApiProperty({ example: 'Visite nosso site' })
    @IsString()
    @IsNotEmpty()
    displayText: string;

    @ApiProperty({ example: 'https://www.yoursite.com' })
    @IsUrl()
    url: string;
}

export class CallButtonDto {
    @ApiProperty({ example: 'Ligue para nós' })
    @IsString()
    @IsNotEmpty()
    displayText: string;

    @ApiProperty({ example: '+1234567890' })
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;
}


export class SendTemplateDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Seu texto com variáveis {{1}}, {{2}}...' })
    @IsString()
    @IsNotEmpty()
    message: string; // Ou talvez 'contentText' dependendo da implementação de Baileys

    @ApiProperty({ type: [TemplateButtonDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => TemplateButtonDto)
    buttons: TemplateButtonDto[];

    @ApiPropertyOptional({ example: 'Texto do rodapé do template' })
    @IsOptional()
    @IsString()
    footerText?: string;

     // Opção para adicionar imagem/vídeo/documento no cabeçalho
     @ApiPropertyOptional({ description: 'URL de uma mídia para o cabeçalho do template' })
     @IsOptional()
     @IsUrl()
     headerMediaUrl?: string; // Ou base64, ou nome do arquivo

     @ApiPropertyOptional({ description: 'Tipo da mídia do cabeçalho', enum: ['image', 'video', 'document'] })
     @IsOptional()
     @IsEnum(['image', 'video', 'document'])
     headerMediaType?: 'image' | 'video' | 'document';
}

// Representa uma linha dentro de uma seção da lista
export class RowDto {
    @ApiProperty({ example: 'Título da Linha 1' })
    @IsString()
    @IsNotEmpty()
    title: string;

    @ApiPropertyOptional({ example: 'Descrição da Linha 1' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 'row-id-1' })
    @IsString()
    @IsNotEmpty()
    rowId: string; // ID único para esta linha
}

// Representa uma seção na mensagem de lista
export class SectionDto {
    @ApiPropertyOptional({ example: 'Título da Seção' })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ type: [RowDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => RowDto)
    rows: RowDto[];
}

export class SendListDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Texto principal acima da lista' })
    @IsString()
    @IsNotEmpty()
    message: string;

    @ApiProperty({ example: 'Título da Lista' })
    @IsString()
    @IsNotEmpty()
    title: string; // Título exibido na lista

    @ApiProperty({ example: 'Texto do Botão' })
    @IsString()
    @IsNotEmpty()
    buttonText: string; // Texto do botão que abre a lista

    @ApiProperty({ type: [SectionDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => SectionDto)
    sections: SectionDto[];

    @ApiPropertyOptional({ example: 'Rodapé da lista' })
    @IsOptional()
    @IsString()
    footerText?: string;
}


export class PollOptionDto {
    @ApiProperty({ example: 'Opção 1' })
    @IsString()
    @IsNotEmpty()
    optionName: string;
}

export class SendPollDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Qual sua cor favorita?' })
    @IsString()
    @IsNotEmpty()
    pollName: string; // A pergunta da enquete

    @ApiProperty({ type: [PollOptionDto], description: 'Pelo menos 2 opções são necessárias' })
    @IsArray()
    @ArrayMinSize(2) // Enquete precisa de no mínimo 2 opções
    @ValidateNested({ each: true })
    @Type(() => PollOptionDto)
    options: PollOptionDto[];

    @ApiPropertyOptional({ description: 'Permitir múltiplas escolhas?', default: false })
    @IsOptional()
    @IsBoolean()
    selectableOptionsCount?: boolean | number; // Ou número exato se a lib permitir
}

// DTO para envio de Status (Stories)
export class SendStatusDto extends BaseSendMessageDto {
    // 'number' em BaseSendMessageDto é ignorado para status (é sempre para '@s.whatsapp.net')

    @ApiPropertyOptional({ description: 'Tipo da mídia do status', enum: ['text', 'image', 'video'] })
    @IsOptional()
    @IsEnum(['text', 'image', 'video'])
    mediaType?: 'text' | 'image' | 'video'; // Define se é texto ou mídia

    @ApiPropertyOptional({ description: 'Texto do status (se mediaType for text)' })
    @IsOptional()
    @IsString()
    message?: string; // O texto do status

    // Para status de texto, pode-se adicionar cor de fundo, fonte, etc. via 'options'
    // Para status de mídia, 'media' (URL ou nome do arquivo) e 'caption' são usados

    @ApiPropertyOptional({ description: 'URL ou nome do arquivo de mídia (se image/video)' })
    @IsOptional()
    @IsString()
    media?: string; // URL ou nome do arquivo

    @ApiPropertyOptional({ description: 'Legenda para status de imagem/vídeo' })
    @IsOptional()
    @IsString()
    caption?: string;

     // Sobrescreve 'options' para adicionar opções específicas de status, se necessário
     @ApiPropertyOptional({ description: 'Opções adicionais para status (ex: cor de fundo para texto)' })
     @IsOptional()
     @ValidateNested()
     @Type(() => SendMessageOptions) // Reutiliza SendMessageOptions ou cria StatusOptionsDto
     options?: SendMessageOptions & {
         backgroundColor?: string; // Exemplo
         font?: number; // Exemplo (referenciando fontes do WhatsApp)
         // Adicione outras opções específicas de status aqui
     };
}
