// Arquivo: src/api/dto/sendMessage.dto.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Importar decoradores e validadores
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, ValidateNested, IsArray, IsIn, Length, IsObject, IsDate } from 'class-validator'; // Adicionado IsDate
import { Type } from 'class-transformer';

// CORRIGIDO: Garante que Baileys está instalado e tipos necessários importados
// CORREÇÃO TS2307: Usar @whiskeysockets/baileys
import { proto, WAPresence, MiscMessageGenerationOptions, Long } from '@whiskeysockets/baileys';

// --- Estruturas Auxiliares ---
// Não há necessidade de exportar QuotedMessage se for usado apenas via MiscMessageGenerationOptions

// --- DTOs Base ---

// Classe base para opções de envio, implementando a interface Baileys para melhor compatibilidade
export class SendMessageOptions implements MiscMessageGenerationOptions {
  @ApiPropertyOptional({ description: 'Timestamp da mensagem (opcional)', type: Date })
  @IsOptional()
  // CORREÇÃO TS2416: Mudar tipo para Date conforme erro (ou verificar tipo exato esperado por MiscMessageGenerationOptions)
  @Type(() => Date) // Ajuda na transformação/validação
  @IsDate()
  timestamp?: Date;

  @ApiPropertyOptional({ description: 'Mensagem a ser respondida/citada (estrutura WebMessageInfo)' })
  @IsOptional()
  // A validação profunda de proto.IWebMessageInfo é complexa e geralmente omitida em DTOs
  quoted?: proto.IWebMessageInfo;

  @ApiPropertyOptional({ description: 'Lista de JIDs a serem mencionados na mensagem', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @ApiPropertyOptional({ description: 'ID da mensagem (para rastreamento ou referência; Baileys gera o ID interno)', type: String })
  @IsOptional()
  @IsString()
  messageId?: string;

  // Outras opções de MiscMessageGenerationOptions podem ser adicionadas aqui
  // Ex: ephemeralExpiration, backgroundColor, font etc.
}

// Classe base para todos os DTOs de envio de mensagem
export class BaseSendMessageDto {
  @ApiProperty({ example: '5511999999999@s.whatsapp.net | 123456789-12345678@g.us', description: 'JID (Job ID) do destinatário (usuário ou grupo)' })
  @IsString()
  @IsNotEmpty()
  @Length(5, 200)
  number: string;

  @ApiPropertyOptional({ description: 'Opções adicionais de envio da mensagem', type: SendMessageOptions })
  @IsOptional()
  @ValidateNested()
  @Type(() => SendMessageOptions)
  options?: SendMessageOptions;
}

// --- DTOs Específicos para cada Tipo de Mensagem ---

export class SendTextDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Olá mundo! 👋', description: 'Conteúdo da mensagem de texto' })
  @IsString()
  @IsNotEmpty()
  text: string;
}

export type MediaType = 'image' | 'document' | 'video' | 'audio' | 'sticker';

export class SendMediaDto extends BaseSendMessageDto {
  @ApiProperty({ enum: ['image', 'document', 'video', 'audio', 'sticker'], description: 'Tipo da mídia' })
  @IsIn(['image', 'document', 'video', 'audio', 'sticker'])
  @IsNotEmpty()
  mediaType: MediaType;

  @ApiProperty({ example: 'https://example.com/image.jpg | data:image/jpeg;base64,...', description: 'URL pública da mídia ou string Base64 completa (com data URI prefix)' })
  @IsString()
  @IsNotEmpty()
  media: string;

  @ApiPropertyOptional({ example: 'image/jpeg', description: 'MIME type da mídia (Obrigatório para Base64 e recomendado para URL)' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ example: 'Legenda da imagem ou vídeo', description: 'Legenda opcional para a mídia' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ example: 'Relatorio_Anual.pdf', description: 'Nome do arquivo (recomendado para documentos)' })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiPropertyOptional({ example: true, description: 'Indica se o áudio é PTT. Aplicável apenas se mediaType for "audio".' })
  @IsOptional()
  @IsBoolean()
  ptt?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Indica se o vídeo é um GIF. Aplicável apenas se mediaType for "video".' })
  @IsOptional()
  @IsBoolean()
  gif?: boolean;
}


// --- Componentes para Mensagens Interativas ---

export type ButtonSubType = 'reply' | 'url' | 'call' | 'copy';

export class Button {
  @ApiProperty({ example: 'Clique Aqui', description: 'Texto exibido no botão (obrigatório)' })
  @IsString()
  @IsNotEmpty()
  displayText: string;

  @ApiPropertyOptional({ example: 'btn_confirmar_pedido', description: 'ID para botões de resposta' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ example: 'https://minhaempresa.com/produto', description: 'URL para botões de link' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ example: '+5511999999999', description: 'Número para botões de chamada' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'CODIGO_PROMO', description: 'Texto a ser copiado' })
  @IsOptional()
  @IsString()
  copyCode?: string;
}

export class SendButtonsDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Escolha uma opção abaixo:', description: 'Corpo da mensagem' })
  @IsString()
  @IsNotEmpty()
  bodyText: string;

  @ApiPropertyOptional({ example: 'Menu Principal', description: 'Texto do header (opcional)' })
  @IsOptional()
  @IsString()
  headerText?: string;

  @ApiPropertyOptional({ example: 'Selecione com cuidado', description: 'Texto do rodapé (opcional)' })
  @IsOptional()
  @IsString()
  footerText?: string;

  @ApiProperty({ type: [Button], description: 'Lista de botões (máximo 3)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Button)
  buttons: Button[];
}

export class SendLocationDto extends BaseSendMessageDto {
  @ApiProperty({ example: -23.55052, description: 'Latitude' })
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: -46.63330, description: 'Longitude' })
  @IsNumber()
  @IsNotEmpty()
  longitude: number;

  @ApiPropertyOptional({ example: 'Escritório Central', description: 'Nome opcional do local' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Av. Paulista, 1000, São Paulo - SP', description: 'Endereço opcional do local' })
  @IsOptional()
  @IsString()
  address?: string;
}

// --- Componentes para Mensagem de Lista ---
export class Row {
  @ApiProperty({ example: 'Item 1', description: 'Título da linha (obrigatório, máx 24 chars)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 24)
  title: string;

  @ApiPropertyOptional({ example: 'Descrição adicional do item 1', description: 'Descrição da linha (opcional, máx 72 chars)' })
  @IsOptional()
  @IsString()
  @Length(1, 72)
  description?: string;

  @ApiProperty({ example: 'item_1_id', description: 'ID único da linha (obrigatório, máx 200 chars)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  id: string;
}

export class Section {
  @ApiProperty({ example: 'Opções Principais', description: 'Título da seção (obrigatório, máx 24 chars)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 24)
  title: string;

  @ApiProperty({ type: [Row], description: 'Linhas da seção (pelo menos 1)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Row)
  rows: Row[];
}

export class SendListDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Confira nosso catálogo de produtos.', description: 'Corpo da mensagem' })
  @IsString()
  @IsNotEmpty()
  bodyText: string;

  @ApiProperty({ example: 'Ver Opções', description: 'Texto do botão que abre a lista (obrigatório, máx 20 chars)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  buttonText: string;

  @ApiPropertyOptional({ example: 'Catálogo de Produtos', description: 'Título/Header da lista (opcional)' })
  @IsOptional()
  @IsString()
  headerText?: string;

  @ApiPropertyOptional({ example: 'Promoção válida até fim do mês', description: 'Rodapé (opcional)' })
  @IsOptional()
  @IsString()
  footerText?: string;

  @ApiProperty({ type: [Section], description: 'Seções da lista (pelo menos 1)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Section)
  sections: Section[];
}

// --- DTO para Contato(s) ---
export class ContactVCard {
    @ApiProperty({ example: 'Fulano de Tal', description: 'Nome completo formatado' })
    @IsString()
    @IsNotEmpty()
    fullName: string;

    @ApiPropertyOptional({ example: 'Fulano', description: 'Primeiro nome' })
    @IsOptional() @IsString() firstName?: string;
    @ApiPropertyOptional({ example: 'de Tal', description: 'Sobrenome' })
    @IsOptional() @IsString() lastName?: string;
    @ApiPropertyOptional({ example: 'Apelido', description: 'Nome de exibição/apelido' })
    @IsOptional() @IsString() displayName?: string;

    @ApiProperty({ example: '5511988888888', description: 'Número de telefone principal' })
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;

    @ApiPropertyOptional({ example: 'Empresa Fantasia Ltda.', description: 'Organização/Empresa' })
    @IsOptional() @IsString() organization?: string;

    @ApiPropertyOptional({ example: 'Desenvolvedor', description: 'Cargo na empresa' })
    @IsOptional() @IsString() title?: string;
}
export class SendContactDto extends BaseSendMessageDto {
  @ApiProperty({ type: [ContactVCard], description: 'Lista de contatos a serem enviados' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactVCard)
  contacts: ContactVCard[];
}

// --- DTO para Template ---
export class SendTemplateDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'my_namespace:my_template_name', description: 'Nome completo do template' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'pt_BR', description: 'Código do idioma do template' })
  @IsString()
  @IsNotEmpty()
  languageCode: string;

  @ApiPropertyOptional({ description: 'Array de componentes com parâmetros' })
  @IsOptional()
  @IsArray()
  components?: any[]; // Usar 'any' ou DTOs específicos
}

// --- DTO para Reação ---
export class SendReactionDto {
  @ApiProperty({ example: '👍 | 😂 | ❤️ | 🙏 | 😢 | 🎉', description: 'Emoji da reação (string vazia "" para remover)' })
  @IsString()
  reaction: string;

  @ApiProperty({ example: '5511999999999@s.whatsapp.net', description: 'JID do chat onde a mensagem original está' })
  @IsString() @IsNotEmpty() number: string;

  @ApiProperty({ example: 'ABCDEFGHIJKLMNO0987654321', description: 'ID da mensagem à qual reagir' })
  @IsString() @IsNotEmpty() messageId: string;

  @ApiPropertyOptional({ description: 'Chave completa da mensagem (alternativa ao messageId)', type: Object })
  @IsOptional() @IsObject() key?: proto.IMessageKey;
}

// --- DTOs específicos que podem ou não existir ---
// Se SendPollDto é realmente usado, ele precisa ser definido
export class SendPollDto extends BaseSendMessageDto {
    @ApiProperty({ example: 'Qual sua cor favorita?', description: 'Nome/Título da enquete' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ type: [String], example: ['Azul', 'Verde', 'Vermelho'], description: 'Opções da enquete' })
    @IsArray()
    @IsString({ each: true })
    // @ArrayMinSize(1) // Precisa de pelo menos uma opção?
    values: string[];

    @ApiPropertyOptional({ example: 1, description: 'Número de opções selecionáveis' })
    @IsOptional()
    @IsNumber()
    selectableCount?: number; // Geralmente 1 para WhatsApp
}

// Definição de SendPtvDto (se necessário, ou usar SendMediaDto)
// export class SendPtvDto extends BaseSendMessageDto { ... }

// Definição de SendStickerDto (se necessário, ou usar SendMediaDto)
// export class SendStickerDto extends BaseSendMessageDto { ... }

// Definição de SendStatusDto (se necessário, ou usar SendTextDto/SendMediaDto)
// export class SendStatusDto extends BaseSendMessageDto { ... }

// Definição de SendAudioDto (se necessário, ou usar SendMediaDto)
// export class SendAudioDto extends BaseSendMessageDto { ... }

// Remover chave extra no final, se houver
