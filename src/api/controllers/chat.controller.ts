// src/api/controllers/chat.controller.ts

import {
  ArchiveChatDto,
  BlockUserDto,
  DeleteMessage,
  // Corrigido: Import com 'g' minúsculo
  getBase64FromMediaMessageDto,
  MarkChatUnreadDto,
  NumberDto,
  PrivacySettingDto,
  ProfileNameDto,
  ProfilePictureDto,
  ProfileStatusDto,
  ReadMessageDto,
  SendPresenceDto,
  UpdateMessageDto,
  WhatsAppNumberDto,
} from '../dto/chat.dto';
import { InstanceDto } from '../dto/instance.dto';
// Corrigido: Importa Query de @repository (verificar alias tsconfig)
import { Query } from '@repository/repository.service';
import { WAMonitoringService } from '../services/wa-monitoring.service';
// Nota: MessageUpdate deve existir no schema.prisma
import { Contact, Message, MessageUpdate } from '@prisma/client';
import { Logger } from '@config/logger.config'; // Importa o Logger

// Adicione decoradores apropriados se usar NestJS (@Controller, @Injectable, etc.)
export class ChatController {
  private readonly logger: Logger;

  // Injeta Logger e WAMonitoringService
  constructor(
      private readonly waMonitor: WAMonitoringService,
      baseLogger: Logger // Recebe o logger base
    ) {
      // Cria um logger filho para este contexto
      this.logger = baseLogger.child({ context: ChatController.name });
    }

  // Adicione decoradores HTTP se necessário (@Get, @Post, @Param, @Body, etc.)
  public async whatsappNumber(
    @Param() instanceDto: InstanceDto, // Exemplo de decorator (ajuste conforme seu framework)
    @Body() data: WhatsAppNumberDto  // Exemplo de decorator
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Checking WhatsApp numbers`);
    return this.waMonitor.get(instanceDto.instanceName)?.whatsappNumber(data);
  }

  public async readMessage(
    @Param() instanceDto: InstanceDto,
    @Body() data: ReadMessageDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Marking messages as read`);
    return this.waMonitor.get(instanceDto.instanceName)?.markMessageAsRead(data);
  }

  public async archiveChat(
    @Param() instanceDto: InstanceDto,
    @Body() data: ArchiveChatDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Archiving/unarchiving chat`);
    return this.waMonitor.get(instanceDto.instanceName)?.archiveChat(data);
  }

  public async markChatUnread(
    @Param() instanceDto: InstanceDto,
    @Body() data: MarkChatUnreadDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Marking chat unread`);
    return this.waMonitor.get(instanceDto.instanceName)?.markChatUnread(data);
  }

  public async deleteMessage(
    @Param() instanceDto: InstanceDto,
    @Body() data: DeleteMessage
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Deleting message ${data.id}`);
    return this.waMonitor.get(instanceDto.instanceName)?.deleteMessage(data);
  }

  public async fetchProfilePicture(
    @Param() instanceDto: InstanceDto,
    @Body() data: NumberDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching profile picture for ${data.number}`);
    return this.waMonitor.get(instanceDto.instanceName)?.profilePicture(data.number);
  }

  // Este método pode ser redundante se fetchBusinessProfile fizer o mesmo
  public async fetchProfile(
    @Param() instanceDto: InstanceDto,
    @Body() data: NumberDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching profile for ${data.number}`);
    // Assumindo que o método fetchProfile existe no ChannelStartupService ou sua implementação
    return this.waMonitor.get(instanceDto.instanceName)?.fetchProfile?.(instanceDto.instanceName, data.number);
  }

  public async fetchContacts(
    @Param() instanceDto: InstanceDto,
    @Query() query: Query<Contact> // Exemplo de decorator @Query
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching contacts`);
    return this.waMonitor.get(instanceDto.instanceName)?.fetchContacts(query);
  }

  // Corrigido nome do DTO
  public async getBase64FromMediaMessage(
    @Param() instanceDto: InstanceDto,
    @Body() data: getBase64FromMediaMessageDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Getting Base64 from media message`);
    return this.waMonitor.get(instanceDto.instanceName)?.getBase64FromMediaMessage(data);
  }

  public async fetchMessages(
    @Param() instanceDto: InstanceDto,
    @Query() query: Query<Message> // Exemplo de decorator @Query
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching messages`);
    return this.waMonitor.get(instanceDto.instanceName)?.fetchMessages(query);
  }

  // Manteve MessageUpdate - VERIFIQUE SEU SCHEMA PRISMA
  public async fetchStatusMessage(
    @Param() instanceDto: InstanceDto,
    @Query() query: Query<MessageUpdate> // Exemplo de decorator @Query
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching message status`);
    return this.waMonitor.get(instanceDto.instanceName)?.fetchStatusMessage(query);
  }

  // Ajustado tipo Query para any, pois a query de chat pode ser diferente
  public async fetchChats(
    @Param() instanceDto: InstanceDto,
    @Query() query: Query<any> // Exemplo de decorator @Query
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching chats`);
    return this.waMonitor.get(instanceDto.instanceName)?.fetchChats(query);
  }

  public async sendPresence(
    @Param() instanceDto: InstanceDto,
    @Body() data: SendPresenceDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Sending presence ${data.presence} for ${data.number}`);
    return this.waMonitor.get(instanceDto.instanceName)?.sendPresence(data);
  }

  public async fetchPrivacySettings(
    @Param() instanceDto: InstanceDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching privacy settings`);
    return this.waMonitor.get(instanceDto.instanceName)?.fetchPrivacySettings();
  }

  public async updatePrivacySettings(
    @Param() instanceDto: InstanceDto,
    @Body() data: PrivacySettingDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Updating privacy settings`);
    return this.waMonitor.get(instanceDto.instanceName)?.updatePrivacySettings(data);
  }

  public async fetchBusinessProfile(
    @Param() instanceDto: InstanceDto,
    @Body() data: NumberDto // Usando NumberDto como inferido anteriormente
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Fetching business profile for ${data.number}`);
    return this.waMonitor.get(instanceDto.instanceName)?.fetchBusinessProfile(data.number);
  }

  public async updateProfileName(
    @Param() instanceDto: InstanceDto,
    @Body() data: ProfileNameDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Updating profile name`);
    return this.waMonitor.get(instanceDto.instanceName)?.updateProfileName(data.name);
  }

  public async updateProfileStatus(
    @Param() instanceDto: InstanceDto,
    @Body() data: ProfileStatusDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Updating profile status`);
    return this.waMonitor.get(instanceDto.instanceName)?.updateProfileStatus(data.status);
  }

  public async updateProfilePicture(
    @Param() instanceDto: InstanceDto,
    @Body() data: ProfilePictureDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Updating profile picture`);
    // Passa um objeto com a propriedade 'picture' como esperado pelo método (provavelmente)
    return this.waMonitor.get(instanceDto.instanceName)?.updateProfilePicture({ picture: data.picture });
  }

  public async removeProfilePicture(
    @Param() instanceDto: InstanceDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Removing profile picture`);
    return this.waMonitor.get(instanceDto.instanceName)?.removeProfilePicture();
  }

  public async updateMessage(
    @Param() instanceDto: InstanceDto,
    @Body() data: UpdateMessageDto
  ): Promise<any | undefined> {
    this.logger.debug(`[${instanceDto.instanceName}] Updating message ${data.key.id}`);
    return this.waMonitor.get(instanceDto.instanceName)?.updateMessage(data);
  }

  public async blockUser(
    @Param() instanceDto: InstanceDto,
    @Body() data: BlockUserDto
  ): Promise<any | undefined> {
    const action = data.status === 'block' ? 'Blocking' : 'Unblocking';
    this.logger.debug(`[${instanceDto.instanceName}] ${action} user ${data.number}`);
    return this.waMonitor.get(instanceDto.instanceName)?.blockUser(data);
  }
}
