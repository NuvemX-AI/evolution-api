// src/api/dto/instance.dto.ts
// Correção Erro 22: Adiciona IsNumber ao import de class-validator.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'; // Assuming NestJS Swagger decorators
// ** Correção Erro 22: Adicionado IsNumber **
import { IsString, IsNotEmpty, IsOptional, IsUrl, IsBoolean, ValidateNested, IsEnum, IsNumberString, IsArray, ArrayMinSize, IsDefined, IsNumber } from 'class-validator';
import { Type } from 'class-transformer'; // Necessary for ValidateNested DTOs

// --- Enums ---
export enum InstanceStatus {
    connecting = 'connecting',
    qrcode = 'qrcode',
    open = 'open',
    close = 'close',
    error = 'error', // Added for potential error states
}

// --- Sub-DTOs ---
// Representa a configuração do webhook
export class WebhookDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ description: 'URL do webhook' })
    @IsOptional()
    @IsUrl()
    url?: string;

    @ApiPropertyOptional({ description: 'Enviar mídia como base64 no webhook' })
    @IsOptional()
    @IsBoolean()
    webhookBase64?: boolean;

    @ApiPropertyOptional({ description: 'Enviar eventos específicos (separados por vírgula se string, ou array)', example: ['messages.upsert', 'connection.update'] })
    @IsOptional()
    @IsArray() // Assuming events are passed as an array
    @IsString({ each: true }) // Each item in the array should be a string
    events?: string[];

    @ApiPropertyOptional({ description: 'Headers customizados para o webhook (JSON)' })
    @IsOptional()
    // Add validation if headers should be a specific object structure or just any object/JSON string
    headers?: Record<string, any>; // Allows any JSON object for headers

    @ApiPropertyOptional({ description: 'Enviar eventos por nome (ex: messages.upsert) em vez de um webhook geral' })
    @IsOptional()
    @IsBoolean()
    webhookByEvents?: boolean; // Keep this if used by the implementation
}

// Representa as configurações locais da instância
export class LocalSettingsDto {
    @ApiPropertyOptional({ description: 'Marcar mensagens como lidas automaticamente' })
    @IsOptional()
    @IsBoolean()
    readMessages?: boolean;

    @ApiPropertyOptional({ description: 'Sincronizar todo o histórico de mensagens ao conectar' })
    @IsOptional()
    @IsBoolean()
    syncFullHistory?: boolean;

    @ApiPropertyOptional({ description: 'Manter a instância sempre online (pode aumentar uso de recursos)' })
    @IsOptional()
    @IsBoolean()
    alwaysOnline?: boolean;

    // Adicionar outros settings conforme necessário
    @ApiPropertyOptional({ description: 'Token wavoip se estiver usando chamadas de voz' })
    @IsOptional()
    @IsString()
    wavoipToken?: string;
}

// --- Main DTOs ---
// Usado para criar uma nova instância
export class CreateInstanceDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    instanceName: string;

    @ApiPropertyOptional({ description: 'Token (apikey) para esta instância. Gerado automaticamente se não fornecido.' })
    @IsOptional()
    @IsString()
    token?: string;

    @ApiPropertyOptional({ description: 'Solicitar QR Code ao conectar' })
    @IsOptional()
    @IsBoolean()
    qrcode?: boolean; // Typically true for initial connection

    @ApiPropertyOptional({ description: 'Número de telefone do proprietário da instância (sem máscara, apenas dígitos com DDI+DDD)' })
    @IsOptional()
    @IsNumberString()
    ownerJid?: string;

    @ApiPropertyOptional({ description: 'Webhook configuration' })
    @IsOptional()
    @ValidateNested()
    @Type(() => WebhookDto)
    webhook?: WebhookDto;

    @ApiPropertyOptional({ description: 'Local settings' })
    @IsOptional()
    @ValidateNested()
    @Type(() => LocalSettingsDto)
    settings?: LocalSettingsDto;

    // Gemini: Adicionando campos que podem ser úteis na criação
    @ApiPropertyOptional({ description: 'Integração a ser usada (evolution, meta, etc.)', example: 'evolution' })
    @IsOptional()
    @IsString()
    integration?: string;

    @ApiPropertyOptional({ description: 'Habilitar Chatwoot para esta instância' })
    @IsOptional()
    @IsBoolean()
    chatwootEnabled?: boolean; // Simplified flag, detailed config separate

    @ApiPropertyOptional({ description: 'Limite de dias para importar mensagens no Chatwoot' })
    @IsOptional()
    @IsNumber() // Use IsNumber for number type
    chatwootDaysLimitImportMessages?: number;

}

// Usado para atualizar uma instância (webhook e settings)
export class InstanceUpdateDto {
    @ApiPropertyOptional()
    @IsOptional()
    @ValidateNested()
    @Type(() => WebhookDto)
    webhook?: WebhookDto;

    @ApiPropertyOptional()
    @IsOptional()
    @ValidateNested()
    @Type(() => LocalSettingsDto)
    settings?: LocalSettingsDto;
}


// Representa os dados básicos de uma instância retornada pela API
export class InstanceDto {
    @ApiProperty()
    @IsDefined() // Should always be present
    instanceName!: string; // '!' indica que será inicializado (ex: pelo construtor ou DI)

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    owner?: string; // Usually the JID

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    profileName?: string;

    @ApiPropertyOptional({ type: 'string', format: 'url', nullable: true })
    @IsOptional()
    @IsUrl()
    profilePictureUrl?: string | null;

    @ApiProperty({ enum: InstanceStatus })
    @IsEnum(InstanceStatus)
    status: InstanceStatus; // Use the enum
}

// Representa a estrutura do QR Code
export class QRCodeDto {
    @ApiProperty()
    @IsString()
    base64: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    pairingCode?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    code?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    count?: number;
}

// Representa a estrutura do Hash (API Key)
export class HashDto {
    @ApiProperty()
    @IsString()
    apikey: string;
}

// Estrutura completa da resposta para criação/conexão
export class InstanceResponseDto {
    @ApiProperty()
    @ValidateNested()
    @Type(() => InstanceDto)
    instance: InstanceDto;

    @ApiProperty()
    @ValidateNested()
    @Type(() => HashDto)
    hash: HashDto;

    @ApiPropertyOptional()
    @IsOptional()
    @ValidateNested()
    @Type(() => QRCodeDto)
    qrcode?: QRCodeDto;

    @ApiPropertyOptional()
    @IsOptional()
    @ValidateNested()
    @Type(() => WebhookDto)
    webhook?: WebhookDto;

    @ApiPropertyOptional()
    @IsOptional()
    @ValidateNested()
    @Type(() => LocalSettingsDto)
    settings?: LocalSettingsDto;
}
