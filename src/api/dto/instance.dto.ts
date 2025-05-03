import { IntegrationDto } from '../integrations/integration.dto';
import { JsonValue } from '@prisma/client/runtime/library';
// CORREÇÃO TS2307: Corrigido o nome do pacote para @whiskeysockets/baileys
import { WAPresence } from '@whiskeysockets/baileys';
// Importar ApiProperty se estiver usando Swagger (NestJS)
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, ValidateNested, IsIn } from 'class-validator'; // Adicionar validadores necessários
import { Type } from 'class-transformer'; // Para ValidateNested

// DTO auxiliar para Webhook (apenas exemplo, ajuste conforme necessário)
class WebhookDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsString({ each: true }) events?: string[];
  @ApiPropertyOptional() @IsOptional() headers?: JsonValue; // Tipo JsonValue do Prisma é adequado
  @ApiPropertyOptional() @IsOptional() @IsString() url?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() byEvents?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() base64?: boolean;
}


export class InstanceDto extends IntegrationDto {
  @ApiProperty({ example: 'my_instance', description: 'Nome único da instância' })
  @IsString()
  instanceName!: string; // '!' indica que será inicializado (ex: pelo construtor ou DI)

  @ApiPropertyOptional({ description: 'ID interno da instância (gerado)' })
  @IsOptional() @IsString() instanceId?: string;

  @ApiPropertyOptional({ description: 'Estado do QR Code (true se disponível)' })
  @IsOptional() @IsBoolean() qrcode?: boolean; // Ou string (base64)? Ajustar tipo se necessário

  @ApiPropertyOptional({ description: 'ID de negócio associado (Meta Business ID)' })
  @IsOptional() @IsString() businessId?: string;

  @ApiPropertyOptional({ description: 'Número de telefone associado à instância' })
  @IsOptional() @IsString() number?: string;

  @ApiPropertyOptional({ description: 'Tipo de integração (ex: whatsapp, telegram)' })
  @IsOptional() @IsString() integration?: string; // Herdado de IntegrationDto?

  @ApiPropertyOptional({ description: 'Token de API específico da instância' })
  @IsOptional() @IsString() token?: string;

  @ApiPropertyOptional({ description: 'Status atual da conexão (ex: open, close, connecting)' })
  @IsOptional() @IsString() status?: string;

  @ApiPropertyOptional({ description: 'JID do proprietário da instância (se aplicável)' })
  @IsOptional() @IsString() ownerJid?: string; // Renomeado de 'owner' para 'ownerJid' para clareza

  @ApiPropertyOptional({ description: 'Nome do perfil da instância no WhatsApp' })
  @IsOptional() @IsString() profileName?: string;

  @ApiPropertyOptional({ description: 'URL da foto de perfil da instância no WhatsApp' })
  @IsOptional() @IsString() profilePicUrl?: string;

  // settings (mover para um DTO aninhado SettingsDto?)
  @ApiPropertyOptional({ description: 'Rejeitar chamadas?' })
  @IsOptional() @IsBoolean() rejectCall?: boolean;
  @ApiPropertyOptional({ description: 'Mensagem automática para chamadas rejeitadas' })
  @IsOptional() @IsString() msgCall?: string;
  @ApiPropertyOptional({ description: 'Ignorar mensagens de grupo?' })
  @IsOptional() @IsBoolean() groupsIgnore?: boolean;
  @ApiPropertyOptional({ description: 'Manter sempre online?' })
  @IsOptional() @IsBoolean() alwaysOnline?: boolean;
  @ApiPropertyOptional({ description: 'Marcar mensagens como lidas?' })
  @IsOptional() @IsBoolean() readMessages?: boolean;
  @ApiPropertyOptional({ description: 'Marcar status como vistos?' })
  @IsOptional() @IsBoolean() readStatus?: boolean;
  @ApiPropertyOptional({ description: 'Sincronizar histórico completo?' })
  @IsOptional() @IsBoolean() syncFullHistory?: boolean;
  @ApiPropertyOptional({ description: 'Token para chamadas VOIP' })
  @IsOptional() @IsString() wavoipToken?: string;

  // proxy (mover para um DTO aninhado ProxyDto?)
  @ApiPropertyOptional() @IsOptional() @IsString() proxyHost?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() proxyPort?: string; // Porta geralmente é string ou number
  @ApiPropertyOptional() @IsOptional() @IsString() proxyProtocol?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() proxyUsername?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() proxyPassword?: string;

  // webhook (Usando DTO auxiliar)
  @ApiPropertyOptional({ type: WebhookDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookDto)
  webhook?: WebhookDto;

  // chatwoot (mover para um DTO aninhado ChatwootDto?)
  @ApiPropertyOptional() @IsOptional() @IsString() chatwootAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootConversationPending?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootAutoCreate?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() chatwootDaysLimitImportMessages?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootImportContacts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootImportMessages?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() chatwootLogo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootMergeBrazilContacts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() chatwootNameInbox?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() chatwootOrganization?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootReopenConversation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatwootSignMsg?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() chatwootToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() chatwootUrl?: string;

  // Adicionar 'owner' se ele realmente fizer parte deste DTO principal
  @ApiPropertyOptional({ description: 'Proprietário da instância (ex: email ou ID do usuário)' })
  @IsOptional() @IsString() owner?: string;

  constructor(data?: Partial<InstanceDto>) {
    super();
    if (data) Object.assign(this, data);
  }
}

export class SetPresenceDto {
  // Removido instanceName daqui, pois geralmente vem dos parâmetros da rota

  @ApiProperty({ enum: ['unavailable', 'available', 'composing', 'recording', 'paused'], description: 'Tipo de presença' })
  @IsIn(['unavailable', 'available', 'composing', 'recording', 'paused']) // Validar os tipos de presença
  presence!: WAPresence;

  @ApiProperty({ example: '5511999999999@s.whatsapp.net | 123456789-12345678@g.us', description: 'JID do chat para definir a presença (opcional, se não for global)' })
  @IsOptional()
  @IsString()
  jid?: string; // Renomeado de 'number' para 'jid' para consistência

  constructor(data?: Partial<SetPresenceDto>) {
    if (data) Object.assign(this, data);
  }
}

// Remover chave extra no final, se houver
