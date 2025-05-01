// Arquivo: src/api/dto/sendMessage.dto.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Importar decoradores e validadores
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, ValidateNested, IsArray, IsIn, Length, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

// CORRIGIDO: Garante que Baileys está instalado e tipos necessários importados
import { proto, WAPresence, MiscMessageGenerationOptions } from '@whiskeysockets/baileys';

// --- Estruturas Auxiliares ---

// Definição da mensagem original citada (Quoted) - Usando tipos Baileys
// Não precisa ser um DTO exportado se for usado apenas internamente ou via MiscMessageGenerationOptions
// class QuotedMessage {
//   key: proto.IMessageKey;
//   message: proto.IMessage | null;
// }

// --- DTOs Base ---

// Classe base para opções de envio, implementando a interface Baileys para melhor compatibilidade
export class SendMessageOptions implements MiscMessageGenerationOptions {
  @ApiPropertyOptional({ description: 'Timestamp da mensagem (opcional)', type: Number })
  @IsOptional()
  @IsNumber() // Deve ser número (epoch) ou Date? Baileys usa `number | Long` para timestamp.
  timestamp?: number | Long; // Usar Long do Baileys se disponível/necessário

  // Nota: 'quoted' em MiscMessageGenerationOptions espera proto.IWebMessageInfo
  @ApiPropertyOptional({ description: 'Mensagem a ser respondida/citada (estrutura WebMessageInfo)' })
  @IsOptional()
  // @ValidateNested() // Validação complexa para proto.IWebMessageInfo
  // @Type(() => WebMessageInfoPlaceholder) // Placeholder se precisar de validação profunda
  quoted?: proto.IWebMessageInfo; // Usar o tipo Baileys

  @ApiPropertyOptional({ description: 'Lista de JIDs a serem mencionados na mensagem', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @ApiPropertyOptional({ description: 'ID da mensagem (para rastreamento ou referência; Baileys gera o ID interno)', type: String })
  @IsOptional()
  @IsString()
  messageId?: string; // ID para uso externo, não o messageID do Baileys

  // @ApiPropertyOptional({ description: 'Atraso em ms antes de enviar (lógica customizada)', type: Number })
  // @IsOptional()
  // @IsNumber()
  // delay?: number; // Removido, pois não faz parte das opções padrão Baileys. Lógica de delay deve ser externa.

  // Outras opções de MiscMessageGenerationOptions podem ser adicionadas se necessário
  // ephemeralExpiration?: number | proto.Message.IEphemeralMessage.EphemeralSetting;
  // mediaUploadTimeoutMs?: number;
  // backgroundColor?: string; // Para status de texto
  // font?: number; // Para status de texto
  // ... etc
}

// Classe base para todos os DTOs de envio de mensagem
export class BaseSendMessageDto {
  @ApiProperty({ example: '5511999999999@s.whatsapp.net | 123456789-12345678@g.us', description: 'JID (Job ID) do destinatário (usuário ou grupo)' })
  @IsString()
  @IsNotEmpty()
  @Length(5, 200) // Adiciona validação de tamanho razoável para JID
  number: string; // Destinatário (JID)

  @ApiPropertyOptional({ description: 'Opções adicionais de envio da mensagem', type: SendMessageOptions })
  @IsOptional()
  @ValidateNested()
  @Type(() => SendMessageOptions) // Garante validação aninhada
  options?: SendMessageOptions;
}

// --- DTOs Específicos para cada Tipo de Mensagem ---

export class SendTextDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Olá mundo! 👋', description: 'Conteúdo da mensagem de texto' })
  @IsString()
  @IsNotEmpty()
  text: string;
}

export type MediaType = 'image' | 'document' | 'video' | 'audio' | 'sticker'; // Tipos de mídia suportados

// DTO para Mídia (URL ou Base64)
export class SendMediaDto extends BaseSendMessageDto {
  // CORRIGIDO: Renomeado mediatype para mediaType (camelCase padrão)
  @ApiProperty({ enum: ['image', 'document', 'video', 'audio', 'sticker'], description: 'Tipo da mídia' })
  @IsIn(['image', 'document', 'video', 'audio', 'sticker'])
  @IsNotEmpty()
  mediaType: MediaType;

  @ApiProperty({ example: 'https://example.com/image.jpg | data:image/jpeg;base64,...', description: 'URL pública da mídia ou string Base64 completa (com data URI prefix)' })
  @IsString()
  @IsNotEmpty()
  media: string; // URL ou Base64

  @ApiPropertyOptional({ example: 'image/jpeg', description: 'MIME type da mídia (Obrigatório para Base64 e recomendado para URL se não óbvio pela extensão)' })
  @IsOptional() // Tornar opcional pode causar problemas com Base64
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ example: 'Legenda da imagem ou vídeo', description: 'Legenda opcional para a mídia (não aplicável a áudio, documento, sticker)' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ example: 'Relatorio_Anual.pdf', description: 'Nome do arquivo (recomendado para documentos e útil para outros tipos)' })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiPropertyOptional({ example: true, description: 'Indica se o áudio é PTT (Push-to-Talk / Mensagem de voz). Aplicável apenas se mediaType for "audio".' })
  @IsOptional()
  @IsBoolean()
  ptt?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Indica se o vídeo é um GIF animado. Aplicável apenas se mediaType for "video".' })
  @IsOptional()
  @IsBoolean()
  gif?: boolean;
}


// --- Componentes para Mensagens Interativas ---

// Tipos de Botão
export type ButtonSubType = 'reply' | 'url' | 'call' | 'copy'; // Tipos suportados

export class Button {
  // O subtipo é inferido pelos campos presentes

  @ApiProperty({ example: 'Clique Aqui', description: 'Texto exibido no botão (obrigatório)' })
  @IsString()
  @IsNotEmpty()
  displayText: string;

  // Campos específicos por subtipo (pelo menos um deve estar presente)
  @ApiPropertyOptional({ example: 'btn_confirmar_pedido', description: 'ID único para botões de resposta (obrigatório para resposta)' })
  @IsOptional()
  @IsString()
  id?: string; // Para 'reply'

  @ApiPropertyOptional({ example: 'https://minhaempresa.com/produto', description: 'URL para botões de link (obrigatório para link)' })
  @IsOptional()
  @IsString()
  // @IsUrl() // Adicionar validação de URL se necessário
  url?: string; // Para 'url'

  @ApiPropertyOptional({ example: '+5511999999999', description: 'Número de telefone para botões de chamada (obrigatório para chamada)' })
  @IsOptional()
  @IsString()
  // @IsPhoneNumber('BR') // Adicionar validação específica se necessário
  phoneNumber?: string; // Para 'call'

  @ApiPropertyOptional({ example: 'CODIGO_PROMO', description: 'Texto a ser copiado (obrigatório para copiar)'})
  @IsOptional()
  @IsString()
  copyCode?: string; // Para 'copy'
}

// DTO para Mensagem com Botões (similar a Template Buttons)
export class SendButtonsDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Escolha uma opção abaixo:', description: 'Corpo da mensagem (obrigatório)' })
  @IsString()
  @IsNotEmpty()
  bodyText: string; // Renomeado de 'description' para clareza

  @ApiPropertyOptional({ example: 'Menu Principal', description: 'Texto do header (opcional)' })
  @IsOptional()
  @IsString()
  headerText?: string; // Header (texto simples)

  @ApiPropertyOptional({ example: 'Selecione com cuidado', description: 'Texto do rodapé (opcional)' })
  @IsOptional()
  @IsString()
  footerText?: string; // Footer

  // Header com Mídia (alternativa ao headerText) - Menos comum para botões simples
  // @ApiPropertyOptional({ description: 'URL ou Base64 da mídia para o header (imagem/vídeo/documento)'})
  // @IsOptional()
  // @IsString()
  // headerMedia?: string;
  // @ApiPropertyOptional({ enum: ['image', 'video', 'document'], description: 'Tipo da mídia no header' })
  // @IsOptional()
  // @IsIn(['image', 'video', 'document'])
  // headerMediaType?: 'image' | 'video' | 'document';

  @ApiProperty({ type: [Button], description: 'Lista de botões (máximo 3)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Button)
  // @ArrayMaxSize(3) // Adicionar validação se for estritamente para Meta API
  buttons: Button[];
}

// DTO para Localização
export class SendLocationDto extends BaseSendMessageDto {
  @ApiProperty({ example: -23.55052, description: 'Latitude (obrigatório)' })
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: -46.63330, description: 'Longitude (obrigatório)' })
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

  @ApiProperty({ example: 'item_1_id', description: 'ID único da linha para identificar a seleção (obrigatório, máx 200 chars)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  id: string; // Renomeado de rowId para id para simplicidade
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
  // @ArrayMinSize(1) // Validação mínima
  // @ArrayMaxSize(10) // Validação máxima por seção
  rows: Row[];
}

// DTO para Mensagem de Lista
export class SendListDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'Confira nosso catálogo de produtos.', description: 'Corpo da mensagem (obrigatório)' })
  @IsString()
  @IsNotEmpty()
  bodyText: string; // Renomeado de 'description'

  @ApiProperty({ example: 'Ver Opções', description: 'Texto do botão que abre a lista (obrigatório, máx 20 chars)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  buttonText: string;

  @ApiPropertyOptional({ example: 'Catálogo de Produtos', description: 'Título/Header da lista (opcional)' })
  @IsOptional()
  @IsString()
  headerText?: string; // Renomeado de 'title'

  @ApiPropertyOptional({ example: 'Promoção válida até fim do mês', description: 'Rodapé (opcional)' })
  @IsOptional()
  @IsString()
  footerText?: string;

  @ApiProperty({ type: [Section], description: 'Seções da lista (pelo menos 1)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Section)
  // @ArrayMinSize(1)
  // @ArrayMaxSize(10) // Máximo de seções
  sections: Section[];
}

// --- DTO para Contato(s) ---
export class ContactVCard {
    // A estrutura exata pode variar (Baileys vs Meta)
    // Focando em campos comuns e geralmente necessários

    @ApiProperty({ example: 'Fulano de Tal', description: 'Nome completo formatado (Necessário para Meta API: formatted_name)' })
    @IsString()
    @IsNotEmpty()
    fullName: string; // formatted_name

    // Meta API usa name: { first_name, last_name }, Baileys pode usar notify/displayName
    @ApiPropertyOptional({ example: 'Fulano', description: 'Primeiro nome' })
    @IsOptional() @IsString() firstName?: string;
    @ApiPropertyOptional({ example: 'de Tal', description: 'Sobrenome' })
    @IsOptional() @IsString() lastName?: string;
    @ApiPropertyOptional({ example: 'Apelido', description: 'Nome de exibição/apelido (Baileys: notify?)' })
    @IsOptional() @IsString() displayName?: string;

    @ApiProperty({ example: '5511988888888', description: 'Número de telefone principal (sem máscara, apenas dígitos)' })
    @IsString()
    @IsNotEmpty()
    phoneNumber: string; // Usado para phones[0].phone e phones[0].wa_id na Meta API

    @ApiPropertyOptional({ example: 'Empresa Fantasia Ltda.', description: 'Organização/Empresa' })
    @IsOptional() @IsString() organization?: string; // org.company

    @ApiPropertyOptional({ example: 'Desenvolvedor', description: 'Cargo na empresa' })
    @IsOptional() @IsString() title?: string; // org.title

    // Meta API permite múltiplos telefones, emails, endereços, urls
    // Simplificando aqui para o principal, expanda se necessário
}
export class SendContactDto extends BaseSendMessageDto {
  @ApiProperty({ type: [ContactVCard], description: 'Lista de contatos a serem enviados (Meta API suporta múltiplos)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactVCard)
  // @ArrayMinSize(1)
  contacts: ContactVCard[];
}

// --- DTO para Template (Abstrato, requer implementação específica) ---
// O envio geralmente envolve nome+língua+componentes(parâmetros)
// Este DTO é um placeholder e pode precisar ser muito mais detalhado
// ou tratado de forma diferente (ex: buscar template do DB e só passar parâmetros).

export class SendTemplateDto extends BaseSendMessageDto {
  @ApiProperty({ example: 'my_namespace:my_template_name', description: 'Nome completo do template (incluindo namespace, se aplicável)' })
  @IsString()
  @IsNotEmpty()
  name: string; // Ou talvez 'namespace' e 'elementName' separados?

  @ApiProperty({ example: 'pt_BR', description: 'Código do idioma do template' })
  @IsString()
  @IsNotEmpty()
  languageCode: string; // Ou talvez { code: 'pt_BR' }

  // Componentes são a parte complexa, varia muito com o template
  @ApiPropertyOptional({ description: 'Array de componentes com parâmetros (header, body, buttons)'})
  @IsOptional()
  @IsArray()
  // @ValidateNested({ each: true }) // Precisa de DTOs específicos para cada tipo de componente
  // @Type(() => TemplateComponentPlaceholder)
  components?: any[]; // Usar 'any' por enquanto, idealmente DTOs específicos por tipo
}

// --- DTO para Reação ---
export class SendReactionDto { // Não herda de BaseSendMessageDto, pois o alvo é uma mensagem existente
  @ApiProperty({ example: '👍 | 😂 | ❤️ | 🙏 | 😢 | 🎉', description: 'Emoji da reação (string vazia "" para remover)' })
  @IsString() // Permite string vazia
  reaction: string;

  @ApiProperty({ example: '5511999999999@s.whatsapp.net', description: 'JID do chat onde a mensagem original está' })
  @IsString() @IsNotEmpty() number: string;

  @ApiProperty({ example: 'ABCDEFGHIJKLMNO0987654321', description: 'ID da mensagem à qual reagir' })
  @IsString() @IsNotEmpty() messageId: string; // ID da mensagem original

  @ApiPropertyOptional({ description: 'Chave completa da mensagem (alternativa ao messageId)', type: Object })
  @IsOptional() @IsObject() key?: proto.IMessageKey; // Opcional, usar messageId preferencialmente
}

// --- DTOs que NÃO são de envio de mensagem, mover para chat.dto.ts ou outro local ---
// export class SendPresenceDto ...
// export class SendStatusDto ...
// export class SendPollDto ...

// Remover definição de MediaMessage se não existir ou não for usada aqui
// export class MediaMessage { ... }

// Remover chave extra no final se houver
