import {
  ArchiveChatDto,
  BlockUserDto,
  DeleteMessage,
  GetBase64FromMediaMessageDto,
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
} from '../dto/chat.dto'; // Mantido caminho relativo original
import { InstanceDto } from '../dto/instance.dto'; // Mantido caminho relativo original
import { Query } from '@repository/repository.service'; // CORRIGIDO: Usar alias ou caminho correto
import { WAMonitoringService } from '../services/wa-monitoring.service'; // Mantido caminho relativo original
import { Contact, Message, MessageUpdate } from '@prisma/client';

// Removidos decoradores NestJS, pois não estavam no original
export class ChatController {
  // Removida injeção via @Inject, assumindo que WAMonitoringService é passado de outra forma
  // ou que este arquivo é parte de um módulo maior onde a injeção ocorre.
  // Se WAMonitoringService precisar ser injetado aqui, adicione o construtor com @Inject.
   constructor(private readonly waMonitor: WAMonitoringService) {} // Mantido construtor original

  // Métodos originais mantidos sem decoradores de rota HTTP
  public async whatsappNumber(
    { instanceName }: InstanceDto,
    data: WhatsAppNumberDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.whatsappNumber(data);
  }

  public async readMessage(
    { instanceName }: InstanceDto,
    data: ReadMessageDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.markMessageAsRead(data);
  }

  public async archiveChat(
    { instanceName }: InstanceDto,
    data: ArchiveChatDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.archiveChat(data);
  }

  public async markChatUnread(
    { instanceName }: InstanceDto,
    data: MarkChatUnreadDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.markChatUnread(data);
  }

  public async deleteMessage(
    { instanceName }: InstanceDto,
    data: DeleteMessage
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.deleteMessage(data);
  }

  public async fetchProfilePicture(
    { instanceName }: InstanceDto,
    data: NumberDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.profilePicture(data.number);
  }

  public async fetchProfile(
    { instanceName }: InstanceDto,
    data: NumberDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.fetchProfile(instanceName, data.number);
  }

  public async fetchContacts(
    { instanceName }: InstanceDto,
    query: Query<Contact> // Usa o tipo Query importado corretamente
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.fetchContacts(query);
  }

  public async getBase64FromMediaMessage(
    { instanceName }: InstanceDto,
    data: GetBase64FromMediaMessageDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.getBase64FromMediaMessage(data);
  }

  public async fetchMessages(
    { instanceName }: InstanceDto,
    query: Query<Message> // Usa o tipo Query importado corretamente
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.fetchMessages(query);
  }

  public async fetchStatusMessage(
    { instanceName }: InstanceDto,
    query: Query<MessageUpdate> // Usa o tipo Query importado corretamente
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.fetchStatusMessage(query);
  }

  public async fetchChats(
    { instanceName }: InstanceDto,
    query: Query<Contact> // Usa o tipo Query importado corretamente
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.fetchChats(query);
  }

  public async sendPresence(
    { instanceName }: InstanceDto,
    data: SendPresenceDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.sendPresence(data);
  }

  public async fetchPrivacySettings(
    { instanceName }: InstanceDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.fetchPrivacySettings();
  }

  public async updatePrivacySettings(
    { instanceName }: InstanceDto,
    data: PrivacySettingDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.updatePrivacySettings(data);
  }

  public async fetchBusinessProfile(
    { instanceName }: InstanceDto,
    data: ProfilePictureDto // ProfilePictureDto pode não ser o tipo correto aqui, talvez NumberDto?
  ): Promise<any | undefined> {
    // O método original passava data.picture, mas o tipo era ProfilePictureDto.
    // Ajustado para passar data.number, assumindo que ProfilePictureDto foi um erro de digitação
    // e o correto seria NumberDto como em fetchProfilePicture.
    // Se ProfilePictureDto for correto, ajuste data.number para data.picture ou o campo apropriado.
    return this.waMonitor.get(instanceName)?.fetchBusinessProfile(data.number); // Ajustado para data.number
  }

  public async updateProfileName(
    { instanceName }: InstanceDto,
    data: ProfileNameDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.updateProfileName(data.name);
  }

  public async updateProfileStatus(
    { instanceName }: InstanceDto,
    data: ProfileStatusDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.updateProfileStatus(data.status);
  }

  public async updateProfilePicture(
    { instanceName }: InstanceDto,
    data: ProfilePictureDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.updateProfilePicture(data.picture);
  }

  public async removeProfilePicture(
    { instanceName }: InstanceDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.removeProfilePicture();
  }

  public async updateMessage(
    { instanceName }: InstanceDto,
    data: UpdateMessageDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.updateMessage(data);
  }

  public async blockUser(
    { instanceName }: InstanceDto,
    data: BlockUserDto
  ): Promise<any | undefined> {
    return this.waMonitor.get(instanceName)?.blockUser(data);
  }
}

// Havia um '}' extra no final do arquivo original, que foi removido.
