import { NumberBusiness } from '@api/dto/chat.dto';
import {
  ContactMessage,
  MediaMessage,
  Options,
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendReactionDto,
  SendTemplateDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { ProviderFiles } from '@api/provider/sessions';
import { PrismaRepository } from '@api/repository/repository.service';
import { chatbotController } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { Events, wa } from '@api/types/wa.types';
import { Chatwoot, ConfigService, Database, Openai, S3, WaBusiness } from '@config/env.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { createJid } from '../../../utils/createJid';
import { status } from '../../../utils/renderStatus';
import axios from 'axios';
import { arrayUnique, isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import mimeTypes from 'mime-types';
import { join } from 'path';

export class BusinessStartupService extends ChannelStartupService {
  public stateConnection: wa.StateConnection = { state: 'open' };
  public phoneNumber: string = '';
  public mobile: boolean = false;
  protected logger: any = console;

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles,
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache);
  }

  public get connectionStatus(): wa.StateConnection {
    return this.stateConnection;
  }

  public async closeClient(): Promise<void> {
    this.stateConnection = { state: 'close' };
  }

  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance?.qrcode?.pairingCode,
      code: this.instance?.qrcode?.code,
      base64: this.instance?.qrcode?.base64,
      count: this.instance?.qrcode?.count,
    };
  }

  public async logoutInstance(): Promise<void> {
    await this.closeClient();
  }

  private isMediaMessage(message: any): boolean {
    return Boolean(message.document || message.image || message.audio || message.video);
  }

  private async post(message: any, params: string): Promise<any> {
    try {
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${this.number}/${params}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
      const result = await axios.post(urlServer, message, { headers });
      return result.data;
    } catch (e: any) {
      return e?.response?.data?.error;
    }
  }

  public async profilePicture(number: string): Promise<{ wuid: string; profilePictureUrl: null; }> {
    const jid = createJid(number);
    return {
      wuid: jid,
      profilePictureUrl: null,
    };
  }

  public async getProfileName(): Promise<null> {
    return null;
  }

  public async profilePictureUrl(): Promise<null> {
    return null;
  }

  public async getProfileStatus(): Promise<null> {
    return null;
  }

  public async setWhatsappBusinessProfile(data: NumberBusiness): Promise<any> {
    const content = {
      messaging_product: 'whatsapp',
      about: data.about,
      address: data.address,
      description: data.description,
      vertical: data.vertical,
      email: data.email,
      websites: data.websites,
      profile_picture_handle: data.profilehandle,
    };
    return await this.post(content, 'whatsapp_business_profile');
  }

  public async connectToWhatsapp(data?: any): Promise<any> {
    if (!data) return;
    const content = data.entry[0].changes[0].value;
    try {
      this.loadChatwoot();
      this.eventHandler(content);
      this.phoneNumber = createJid(content.messages ? content.messages[0].from : content.statuses[0]?.recipient_id);
    } catch (error: any) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }

  private async downloadMediaMessage(message: any): Promise<any> {
    try {
      const id = message[message.type].id;
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${id}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
      let result = await axios.get(urlServer, { headers });
      result = await axios.get(result.data.url, { headers, responseType: 'arraybuffer' });
      return result.data;
    } catch (e: any) {
      this.logger.error(e);
    }
  }

  private messageMediaJson(received: any) {
    const message = received.messages[0];
    let content: any = message.type + 'Message';
    content = { [content]: message[message.type] };
    if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    return content;
  }

  private messageInteractiveJson(received: any) {
    const message = received.messages[0];
    let content: any = { conversation: message.interactive[message.interactive.type].title };
    if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    return content;
  }

  private messageButtonJson(received: any) {
    const message = received.messages[0];
    let content: any = { conversation: received.messages[0].button?.text };
    if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    return content;
  }

  private messageReactionJson(received: any) {
    const message = received.messages[0];
    let content: any = {
      reactionMessage: {
        key: {
          id: message.reaction.message_id,
        },
        text: message.reaction.emoji,
      },
    };
    if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    return content;
  }

  private messageTextJson(received: any) {
    let content: any;
    const message = received.messages[0];
    if (message.from === received.metadata.phone_number_id) {
      content = {
        extendedTextMessage: { text: message.text.body },
      };
      if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    } else {
      content = { conversation: message.text.body };
      if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    }
    return content;
  }

    private messageContactsJson(received: any) {
    const message = received.messages[0];
    let content: any = {};

    const vcard = (contact: any) => {
      let result =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `N:${contact.name.formatted_name}\n` +
        `FN:${contact.name.formatted_name}\n`;

      if (contact.org) {
        result += `ORG:${contact.org.company};\n`;
      }
      if (contact.emails) {
        result += `EMAIL:${contact.emails[0].email}\n`;
      }
      if (contact.urls) {
        result += `URL:${contact.urls[0].url}\n`;
      }
      if (!contact.phones[0]?.wa_id) {
        contact.phones[0].wa_id = createJid(contact.phones[0].phone);
      }
      result +=
        `item1.TEL;waid=${contact.phones[0]?.wa_id}:${contact.phones[0].phone}\n` +
        'item1.X-ABLabel:Celular\n' +
        'END:VCARD';
      return result;
    };

    if (message.contacts.length === 1) {
      content.contactMessage = {
        displayName: message.contacts[0].name.formatted_name,
        vcard: vcard(message.contacts[0]),
      };
    } else {
      content.contactsArrayMessage = {
        displayName: `${message.length} contacts`,
        contacts: message.map((contact: any) => ({
          displayName: contact.name.formatted_name,
          vcard: vcard(contact),
        })),
      };
    }
    if (message.context) content = { ...content, contextInfo: { stanzaId: message.context.id } };
    return content;
  }

  private renderMessageType(type: string) {
    let messageType: string;
    switch (type) {
      case 'text': messageType = 'conversation'; break;
      case 'image': messageType = 'imageMessage'; break;
      case 'video': messageType = 'videoMessage'; break;
      case 'audio': messageType = 'audioMessage'; break;
      case 'document': messageType = 'documentMessage'; break;
      case 'template': messageType = 'conversation'; break;
      default: messageType = 'conversation'; break;
    }
    return messageType;
  }

  protected async messageHandle(received: any, database: Database, settings: any) {
    try {
      let messageRaw: any;
      let pushName: any;

      if (received.contacts) pushName = received.contacts[0].profile.name;

      if (received.messages) {
        const key = {
          id: received.messages[0].id,
          remoteJid: this.phoneNumber,
          fromMe: received.messages[0].from === received.metadata.phone_number_id,
        };

        if (this.isMediaMessage(received?.messages[0])) {
          messageRaw = {
            key,
            pushName,
            message: this.messageMediaJson(received),
            contextInfo: this.messageMediaJson(received)?.contextInfo,
            messageType: this.renderMessageType(received.messages[0].type),
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };

          if (this.configService.get<S3>('S3').ENABLE) {
            try {
              const message: any = received;
              const id = message.messages[0][message.messages[0].type].id;
              let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
              const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
              urlServer = `${urlServer}/${version}/${id}`;
              const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
              const result = await axios.get(urlServer, { headers });
              const buffer = await axios.get(result.data.url, { headers, responseType: 'arraybuffer' });

              let mediaType;
              if (message.messages[0].document) mediaType = 'document';
              else if (message.messages[0].image) mediaType = 'image';
              else if (message.messages[0].audio) mediaType = 'audio';
              else mediaType = 'video';

              const mimetype = result.data?.mime_type || result.headers['content-type'];
              const contentDisposition = result.headers['content-disposition'];
              let fileName = `${message.messages[0].id}.${mimetype.split('/')[1]}`;
              if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+?)"/);
                if (match) fileName = match[1];
              }
              const size = result.headers['content-length'] || buffer.data.byteLength;
              const fullName = join(`${this.instance.id}`, key.remoteJid, mediaType, fileName);

              await s3Service.uploadFile(fullName, buffer.data, size, { 'Content-Type': mimetype });

              const createdMessage = await this.prismaRepository.message.create({ data: messageRaw });
              await this.prismaRepository.media.create({
                data: {
                  messageId: createdMessage.id,
                  instanceId: this.instanceId,
                  type: mediaType,
                  fileName: fullName,
                  mimetype,
                },
              });

              const mediaUrl = await s3Service.getObjectUrl(fullName);

              messageRaw.message.mediaUrl = mediaUrl;
              messageRaw.message.base64 = buffer.data.toString('base64');
            } catch (error: any) {
              this.logger.error(['Error on upload file to minio', error?.message, error?.stack]);
            }
          } else {
            const buffer = await this.downloadMediaMessage(received?.messages[0]);
            messageRaw.message.base64 = buffer.toString('base64');
          }
        } else if (received?.messages[0].interactive) {
          messageRaw = {
            key,
            pushName,
            message: { ...this.messageInteractiveJson(received) },
            contextInfo: this.messageInteractiveJson(received)?.contextInfo,
            messageType: 'interactiveMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (received?.messages[0].button) {
          messageRaw = {
            key,
            pushName,
            message: { ...this.messageButtonJson(received) },
            contextInfo: this.messageButtonJson(received)?.contextInfo,
            messageType: 'buttonMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (received?.messages[0].reaction) {
          messageRaw = {
            key,
            pushName,
            message: { ...this.messageReactionJson(received) },
            contextInfo: this.messageReactionJson(received)?.contextInfo,
            messageType: 'reactionMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else if (received?.messages[0].contacts) {
          messageRaw = {
            key,
            pushName,
            message: { ...this.messageContactsJson(received) },
            contextInfo: this.messageContactsJson(received)?.contextInfo,
            messageType: 'contactMessage',
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        } else {
          messageRaw = {
            key,
            pushName,
            message: this.messageTextJson(received),
            contextInfo: this.messageTextJson(received)?.contextInfo,
            messageType: this.renderMessageType(received.messages[0].type),
            messageTimestamp: parseInt(received.messages[0].timestamp) as number,
            source: 'unknown',
            instanceId: this.instanceId,
          };
        }

       
        if (this.localSettings?.readMessages) {
          // await this.client.readMessages([received.key]);
        }

        if (this.configService.get<Openai>('OPENAI').ENABLED) {
          const openAiDefaultSettings = await this.prismaRepository.openaiSetting.findFirst({
            where: { instanceId: this.instanceId },
            include: { OpenaiCreds: true },
          });
          const audioMessage = received?.messages[0]?.audio;
          if (
            openAiDefaultSettings &&
            openAiDefaultSettings.openaiCredsId &&
            openAiDefaultSettings.speechToText &&
            audioMessage
          ) {
            messageRaw.message.speechToText = await this.openaiService.speechToText(
              openAiDefaultSettings.OpenaiCreds,
              { message: { mediaUrl: messageRaw.message.mediaUrl, ...messageRaw } },
              () => {},
            );
          }
        }

        this.logger.log(messageRaw);

        this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

        await chatbotController.emit({
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          const chatwootSentMessage = await this.chatwootService.eventWhatsapp(
            Events.MESSAGES_UPSERT,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            messageRaw,
          );
          if (chatwootSentMessage?.id) {
            messageRaw.chatwootMessageId = chatwootSentMessage.id;
            messageRaw.chatwootInboxId = chatwootSentMessage.id;
            messageRaw.chatwootConversationId = chatwootSentMessage.id;
          }
        }

        if (!this.isMediaMessage(received?.messages[0])) {
          await this.prismaRepository.message.create({ data: messageRaw });
        }

        const contact = await this.prismaRepository.contact.findFirst({
          where: { instanceId: this.instanceId, remoteJid: key.remoteJid },
        });

        const contactRaw: any = {
          remoteJid: received.contacts[0].profile.phone,
          pushName,
          instanceId: this.instanceId,
        };

        if (contactRaw.remoteJid === 'status@broadcast') return;

        if (contact) {
          this.sendDataWebhook(Events.CONTACTS_UPDATE, contactRaw);
          if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
            await this.chatwootService.eventWhatsapp(
              Events.CONTACTS_UPDATE,
              { instanceName: this.instance.name, instanceId: this.instanceId },
              contactRaw,
            );
          }
          await this.prismaRepository.contact.updateMany({
            where: { remoteJid: contact.remoteJid },
            data: contactRaw,
          });
          return;
        }

        this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw);

        await this.prismaRepository.contact.create({ data: contactRaw });
      } // received.messages

      if (received.statuses) {
        for await (const item of received.statuses) {
          const key = {
            id: item.id,
            remoteJid: this.phoneNumber,
            fromMe: this.phoneNumber === received.metadata.phone_number_id,
          };
          if (settings?.groups_ignore && key.remoteJid.includes('@g.us')) return;
          if (key.remoteJid !== 'status@broadcast' && !key?.remoteJid?.match(/(:\d+)/)) {
            const findMessage = await this.prismaRepository.message.findFirst({
              where: {
                instanceId: this.instanceId,
                key: { path: ['id'], equals: key.id },
              },
            });
            if (!findMessage) return;

            if (item.message === null && item.status === undefined) {
              this.sendDataWebhook(Events.MESSAGES_DELETE, key);
              const message: any = {
                messageId: findMessage.id,
                keyId: key.id,
                remoteJid: key.remoteJid,
                fromMe: key.fromMe,
                participant: key?.remoteJid,
                status: 'DELETED',
                instanceId: this.instanceId,
              };
              await this.prismaRepository.messageUpdate.create({ data: message });

              if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
                this.chatwootService.eventWhatsapp(
                  Events.MESSAGES_DELETE,
                  { instanceName: this.instance.name, instanceId: this.instanceId },
                  { key: key },
                );
              }
              return;
            }

            const message: any = {
              messageId: findMessage.id,
              keyId: key.id,
              remoteJid: key.remoteJid,
              fromMe: key.fromMe,
              participant: key?.remoteJid,
              status: item.status.toUpperCase(),
              instanceId: this.instanceId,
            };

            this.sendDataWebhook(Events.MESSAGES_UPDATE, message);

            await this.prismaRepository.messageUpdate.create({ data: message });

            if (findMessage.webhookUrl) {
              await axios.post(findMessage.webhookUrl, message);
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.error(error);
    }
  }

  private convertMessageToRaw(message: any, content: any) {
    let convertMessage: any;

    if (message?.conversation) {
      if (content?.context?.message_id) {
        convertMessage = {
          ...message,
          contextInfo: { stanzaId: content.context.message_id },
        };
        return convertMessage;
      }
      convertMessage = message;
      return convertMessage;
    }

    if (message?.mediaType === 'image') {
      if (content?.context?.message_id) {
        return { imageMessage: message, contextInfo: { stanzaId: content.context.message_id } };
      }
      return { imageMessage: message };
    }
    if (message?.mediaType === 'video') {
      if (content?.context?.message_id) {
        return { videoMessage: message, contextInfo: { stanzaId: content.context.message_id } };
      }
      return { videoMessage: message };
    }
    if (message?.mediaType === 'audio') {
      if (content?.context?.message_id) {
        return { audioMessage: message, contextInfo: { stanzaId: content.context.message_id } };
      }
      return { audioMessage: message };
    }
    if (message?.mediaType === 'document') {
      if (content?.context?.message_id) {
        return { documentMessage: message, contextInfo: { stanzaId: content.context.message_id } };
      }
      return { documentMessage: message };
    }

    return message;
  }

  protected async eventHandler(content: any) {
    const database = this.configService.get<Database>('DATABASE');
    const settings = await this.findSettings();
    this.messageHandle(content, database, settings);
  }

  // MÉTODOS "not available" PRA PRODUTIZAÇÃO
  public async updateProfileStatus(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async mediaSticker(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async pollMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async statusMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async reloadConnection(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async whatsappNumber(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async markMessageAsRead(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async archiveChat(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async markChatUnread(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fetchProfile(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async offerCall(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async sendPresence(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async setPresence(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fetchPrivacySettings(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updatePrivacySettings(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fetchBusinessProfile(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateProfileName(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateProfilePicture(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async removeProfilePicture(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async blockUser(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateMessage(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async createGroup(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateGroupPicture(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateGroupSubject(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateGroupDescription(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async findGroup(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fetchAllGroups(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async inviteCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async inviteInfo(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async sendInvite(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async acceptInviteCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async revokeInviteCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async findParticipants(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateGParticipant(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async updateGSetting(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async toggleEphemeral(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async leaveGroup(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fetchLabels(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async handleLabel(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async receiveMobileCode(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
  public async fakeCall(): Promise<never> { throw new BadRequestException('Method not available on WhatsApp Business API'); }
}
