import { InstanceDto } from '@api/dto/instance.dto';
import { Options, Quoted, SendAudioDto, SendMediaDto, SendTextDto } from '@api/dto/sendMessage.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';
import { postgresClient } from '@api/integrations/chatbot/chatwoot/libs/postgres.client';
import { chatwootImport } from '@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper';
import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Events } from '@api/types/wa.types';
import { Chatwoot, ConfigService, Database, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
import ChatwootClient, {
  ChatwootAPIConfig,
  contact,
  contact_inboxes,
  conversation,
  conversation_show,
  generic_id,
  inbox,
} from '@figuro/chatwoot-sdk';
import { request as chatwootRequest } from '@figuro/chatwoot-sdk/dist/core/request';
import { Chatwoot as ChatwootModel, Contact as ContactModel, Message as MessageModel } from '@prisma/client';
import i18next from '../../../../utils/i18n';
import { sendTelemetry } from '../../../../utils/sendTelemetry';
import axios from 'axios';
import { proto } from 'baileys';
import dayjs from 'dayjs';
import FormData from 'form-data';
import Jimp from 'jimp';
import Long from 'long';
import mimeTypes from 'mime-types';
import path from 'path';
import { Readable } from 'stream';

interface ChatwootMessage {
  messageId?: number;
  inboxId?: number;
  conversationId?: number;
  contactInboxSourceId?: string;
  isRead?: boolean;
}

export class ChatwootService {
  private readonly logger = new Logger('ChatwootService');
  private provider: any;
  private pgClient = postgresClient.getChatwootConnection();

  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService,
  ) {}
  private async getProvider(instance: InstanceDto): Promise<ChatwootModel | null> {
    const cacheKey = `${instance.instanceName}:getProvider`;
    if (await this.cache.has(cacheKey)) {
      return (await this.cache.get(cacheKey)) as ChatwootModel;
    }
    const provider = await this.waMonitor.waInstances[instance.instanceName]?.findChatwoot();
    if (!provider) {
      this.logger.warn('provider not found');
      return null;
    }
    await this.cache.set(cacheKey, provider);
    return provider;
  }

  private async clientCw(instance: InstanceDto): Promise<ChatwootClient | null> {
    const provider = await this.getProvider(instance);
    if (!provider) {
      this.logger.error('provider not found');
      return null;
    }
    this.provider = provider;
    return new ChatwootClient({ config: this.getClientCwConfig() });
  }

  public getClientCwConfig(): ChatwootAPIConfig & { nameInbox: string; mergeBrazilContacts: boolean } {
    return {
      basePath: this.provider.url,
      with_credentials: true,
      credentials: 'include',
      token: this.provider.token,
      nameInbox: this.provider.nameInbox,
      mergeBrazilContacts: this.provider.mergeBrazilContacts,
    };
  }

  public getCache(): CacheService {
    return this.cache;
  }

  public async create(instance: InstanceDto, data: ChatwootDto): Promise<ChatwootDto> {
    await this.waMonitor.waInstances[instance.instanceName].setChatwoot(data);
    if (data.autoCreate) {
      this.logger.log('Auto create chatwoot instance');
      const urlServer = this.configService.get<HttpServer>('SERVER').URL;
      await this.initInstanceChatwoot(
        instance,
        data.nameInbox ?? instance.instanceName.split('-cwId-')[0],
        `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`,
        true,
        data.number,
        data.organization,
        data.logo,
      );
    }
    return data;
  }

  public async find(instance: InstanceDto): Promise<ChatwootDto> {
    try {
      return await this.waMonitor.waInstances[instance.instanceName].findChatwoot();
    } catch {
      this.logger.error('chatwoot not found');
      return { enabled: null, url: '' };
    }
  }

  public async getContact(instance: InstanceDto, id: number): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    if (!id) {
      this.logger.warn('id is required');
      return null;
    }
    const contact = await client.contact.getContactable({
      accountId: this.provider.accountId,
      id,
    });
    if (!contact) {
      this.logger.warn('contact not found');
      return null;
    }
    return contact;
  }
  public async initInstanceChatwoot(
    instance: InstanceDto,
    inboxName: string,
    webhookUrl: string,
    qrcode: boolean,
    number: string,
    organization?: string,
    logo?: string,
  ): Promise<boolean | null> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    const findInbox: any = await client.inboxes.list({ accountId: this.provider.accountId });
    const checkDuplicate = findInbox.payload.map((i: any) => i.name).includes(inboxName);
    let inboxId: number;

    this.logger.log('Creating chatwoot inbox');
    if (!checkDuplicate) {
      const channelData = { type: 'api', webhook_url: webhookUrl };
      const inbox = await client.inboxes.create({
        accountId: this.provider.accountId,
        data: { name: inboxName, channel: channelData as any },
      });
      if (!inbox) {
        this.logger.warn('inbox not found');
        return null;
      }
      inboxId = inbox.id;
    } else {
      const existing = findInbox.payload.find((i: any) => i.name === inboxName);
      if (!existing) {
        this.logger.warn('inbox not found');
        return null;
      }
      inboxId = existing.id;
    }
    this.logger.log(`Inbox created - inboxId: ${inboxId}`);

    if (!this.configService.get<Chatwoot>('CHATWOOT').BOT_CONTACT) {
      this.logger.log('Chatwoot bot contact is disabled');
      return true;
    }

    this.logger.log('Creating chatwoot bot contact');
    const contact =
      (await this.findContact(instance, '123456')) ||
      (await this.createContact(
        instance,
        '123456',
        inboxId,
        false,
        organization ?? 'EvolutionAPI',
        logo ?? 'https://evolution-api.com/files/evolution-api-favicon.png',
      ));
    if (!contact) {
      this.logger.warn('contact not found');
      return null;
    }
    const contactId = ('payload' in contact ? contact.payload.contact?.id ?? contact.payload.id : (contact as any).id) as number;
    this.logger.log(`Contact created - contactId: ${contactId}`);

    if (qrcode) {
      this.logger.log('QR code enabled');
      const data = { contact_id: contactId.toString(), inbox_id: inboxId.toString() };
      const conversation = await client.conversations.create({
        accountId: this.provider.accountId,
        data,
      });
      if (!conversation) {
        this.logger.warn('conversation not found');
        return null;
      }
      let contentMsg = 'init';
      if (number) contentMsg = `init:${number}`;
      const message = await client.messages.create({
        accountId: this.provider.accountId,
        conversationId: conversation.id,
        data: { content: contentMsg, message_type: 'outgoing' },
      });
      if (!message) {
        this.logger.warn('message not found');
        return null;
      }
      this.logger.log('Init message sent');
    }

    return true;
  }
  public async createContact(
    instance: InstanceDto,
    phoneNumber: string,
    inboxId: number,
    isGroup: boolean,
    name?: string,
    avatar_url?: string,
    jid?: string,
  ): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    let data: any = {};
    if (!isGroup) {
      data = {
        inbox_id: inboxId,
        name: name || phoneNumber,
        identifier: jid,
        avatar_url,
      };
      if ((jid && jid.includes('@')) || !jid) {
        data['phone_number'] = `+${phoneNumber}`;
      }
    } else {
      data = {
        inbox_id: inboxId,
        name: name || phoneNumber,
        identifier: phoneNumber,
        avatar_url,
      };
    }
    const contact = await client.contacts.create({
      accountId: this.provider.accountId,
      data,
    });
    if (!contact) {
      this.logger.warn('contact not found');
      return null;
    }
    const existing = await this.findContact(instance, phoneNumber);
    const contactId = ('id' in existing ? existing.id : existing.payload[0]?.id) as number;
    await this.addLabelToContact(this.provider.nameInbox, contactId);
    return contact;
  }

  public async updateContact(instance: InstanceDto, id: number, data: any): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    if (!id) {
      this.logger.warn('id is required');
      return null;
    }
    try {
      return await client.contacts.update({
        accountId: this.provider.accountId,
        id,
        data,
      });
    } catch {
      return null;
    }
  }

  public async addLabelToContact(nameInbox: string, contactId: number): Promise<boolean> {
    try {
      const uri = this.configService.get<Chatwoot>('CHATWOOT').IMPORT.DATABASE.CONNECTION.URI;
      if (!uri) return false;

      const sqlTags = 'SELECT id, taggings_count FROM tags WHERE name = $1 LIMIT 1';
      const tagData = (await this.pgClient.query(sqlTags, [nameInbox]))?.rows[0];
      let tagId = tagData?.id;
      const taggingsCount = tagData?.taggings_count || 0;

      const sqlTag = `
        INSERT INTO tags (name, taggings_count)
        VALUES ($1, $2)
        ON CONFLICT (name)
        DO UPDATE SET taggings_count = tags.taggings_count + 1
        RETURNING id`;
      tagId = (await this.pgClient.query(sqlTag, [nameInbox, taggingsCount + 1]))?.rows[0]?.id;

      const sqlCheckTagging = `
        SELECT 1 FROM taggings
        WHERE tag_id = $1 AND taggable_type = 'Contact' AND taggable_id = $2 AND context = 'labels'
        LIMIT 1`;
      const exists = (await this.pgClient.query(sqlCheckTagging, [tagId, contactId]))?.rowCount > 0;

      if (!exists) {
        const sqlInsertLabel = `
          INSERT INTO taggings (tag_id, taggable_type, taggable_id, context, created_at)
          VALUES ($1, 'Contact', $2, 'labels', NOW())`;
        await this.pgClient.query(sqlInsertLabel, [tagId, contactId]);
      }

      return true;
    } catch {
      return false;
    }
  }

  public async findContact(instance: InstanceDto, phoneNumber: string): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    const isGroup = phoneNumber.includes('@g.us');
    const query = isGroup ? phoneNumber : `+${phoneNumber}`;

    if (isGroup) {
      const res: any = await client.contacts.search({ accountId: this.provider.accountId, q: query });
      return res.payload.find((c: any) => c.identifier === query);
    } else {
      const response = await chatwootRequest(this.getClientCwConfig(), {
        method: 'POST',
        url: `/api/v1/accounts/${this.provider.accountId}/contacts/filter`,
        body: { payload: this.getFilterPayload(query) },
      });
      if (!response?.payload?.length) {
        this.logger.warn('contact not found');
        return null;
      }
      return response.payload.length > 1
        ? this.findContactInContactList(response.payload, query)
        : response.payload[0];
    }
  }

  private async mergeBrazilianContacts(contacts: any[]): Promise<any> {
    try {
      return await chatwootRequest(this.getClientCwConfig(), {
        method: 'POST',
        url: `/api/v1/accounts/${this.provider.accountId}/actions/contact_merge`,
        body: {
          base_contact_id: contacts.find((c) => c.phone_number.length === 14)?.id,
          mergee_contact_id: contacts.find((c) => c.phone_number.length === 13)?.id,
        },
      });
    } catch {
      this.logger.error('Error merging contacts');
      return null;
    }
  }

  private findContactInContactList(contacts: any[], query: string): any {
    const phoneNumbers = this.getNumbers(query);
    const fields = this.getSearchableFields();

    if (contacts.length === 2 && this.getClientCwConfig().mergeBrazilContacts && query.startsWith('+55')) {
      const merged = this.mergeBrazilianContacts(contacts);
      if (merged) return merged;
    }

    const longest = phoneNumbers.reduce((a, b) => (b.length > a.length ? b : a), '');
    const with9 = contacts.find((c) => c.phone_number === longest);
    if (with9) return with9;

    for (const c of contacts) {
      for (const field of fields) {
        if (c[field] && phoneNumbers.includes(c[field])) {
          return c;
        }
      }
    }
    return null;
  }

  private getNumbers(query: string): string[] {
    const nums = [query];
    if (query.startsWith('+55') && query.length === 14) {
      nums.push(query.slice(0, 5) + query.slice(6));
    } else if (query.startsWith('+55') && query.length === 13) {
      nums.push(query.slice(0, 5) + '9' + query.slice(5));
    }
    return nums;
  }

  private getSearchableFields(): string[] {
    return ['phone_number'];
  }

  private getFilterPayload(query: string): any[] {
    const numbers = this.getNumbers(query);
    const fields = this.getSearchableFields();
    const payload: any[] = [];
    fields.forEach((field, i) => {
      numbers.forEach((num, j) => {
        const op = i === fields.length - 1 && j === numbers.length - 1 ? null : 'OR';
        payload.push({
          attribute_key: field,
          filter_operator: 'equal_to',
          values: [num.replace('+', '')],
          query_operator: op,
        });
      });
    });
    return payload;
  }
  public async createConversation(instance: InstanceDto, body: any): Promise<number | null> {
    try {
      this.logger.verbose('--- Start createConversation ---');
      this.logger.verbose(`Instance: ${JSON.stringify(instance)}`);
      const client = await this.clientCw(instance);
      if (!client) {
        this.logger.warn(`Client not found for instance: ${JSON.stringify(instance)}`);
        return null;
      }

      const cacheKey = `${instance.instanceName}:createConversation-${body.key.remoteJid}`;
      this.logger.verbose(`Cache key: ${cacheKey}`);

      if (await this.cache.has(cacheKey)) {
        this.logger.verbose(`Cache hit for key: ${cacheKey}`);
        const conversationId = (await this.cache.get(cacheKey)) as number;
        this.logger.verbose(`Cached conversation ID: ${conversationId}`);
        let exists: conversation | boolean;
        try {
          exists = await client.conversations.get({
            accountId: this.provider.accountId,
            conversationId,
          });
          this.logger.verbose(`Conversation exists: ${JSON.stringify(exists)}`);
        } catch (err) {
          this.logger.error(`Error getting conversation: ${err}`);
          exists = false;
        }
        if (!exists) {
          this.logger.verbose('Conversation does not exist, re-calling createConversation');
          await this.cache.delete(cacheKey);
          return this.createConversation(instance, body);
        }
        return conversationId;
      }

      const isGroup = body.key.remoteJid.includes('@g.us');
      this.logger.verbose(`Is group: ${isGroup}`);

      const chatId = isGroup ? body.key.remoteJid : body.key.remoteJid.split('@')[0];
      this.logger.verbose(`Chat ID: ${chatId}`);

      let nameContact = !body.key.fromMe ? body.pushName : chatId;
      this.logger.verbose(`Name contact: ${nameContact}`);

      const filterInbox = await this.getInbox(instance);
      if (!filterInbox) {
        this.logger.warn(`Inbox not found for instance: ${JSON.stringify(instance)}`);
        return null;
      }

      // Processamento de grupo
      if (isGroup) {
        this.logger.verbose('Processing group conversation');
        const group = await this.waMonitor.waInstances[instance.instanceName].client.groupMetadata(chatId);
        this.logger.verbose(`Group metadata: ${JSON.stringify(group)}`);
        nameContact = `${group.subject} (GROUP)`;
        const pic = await this.waMonitor.waInstances[instance.instanceName].profilePicture(body.key.participant.split('@')[0]);
        this.logger.verbose(`Participant profile picture URL: ${JSON.stringify(pic)}`);
        const participant = await this.findContact(instance, body.key.participant.split('@')[0]);
        this.logger.verbose(`Found participant: ${JSON.stringify(participant)}`);
        if (participant) {
          if (!participant.name || participant.name === chatId) {
            await this.updateContact(instance, participant.id, {
              name: body.pushName,
              avatar_url: pic.profilePictureUrl || null,
            });
          }
        } else {
          await this.createContact(
            instance,
            body.key.participant.split('@')[0],
            filterInbox.id,
            false,
            body.pushName,
            pic.profilePictureUrl || null,
            body.key.participant,
          );
        }
      }

      // Contato individual
      const pic = await this.waMonitor.waInstances[instance.instanceName].profilePicture(chatId);
      this.logger.verbose(`Contact profile picture URL: ${JSON.stringify(pic)}`);

      let contact: any = await this.findContact(instance, chatId);
      this.logger.verbose(`Found contact: ${JSON.stringify(contact)}`);

      if (contact && !body.key.fromMe) {
        const waFile = pic.profilePictureUrl?.split('#')[0].split('?')[0].split('/').pop() ?? '';
        const cwFile = contact.thumbnail?.split('#')[0].split('?')[0].split('/').pop() ?? '';
        const picNeeds = waFile !== cwFile;
        const nameNeeds =
          !contact.name ||
          contact.name === chatId ||
          (chatId.startsWith('+55') && this.getNumbers(chatId).some(
            (v) => contact.name === v || contact.name === v.substring(3) || contact.name === v.substring(1),
          ));
        this.logger.verbose(`Picture needs update: ${picNeeds}`);
        this.logger.verbose(`Name needs update: ${nameNeeds}`);
        if (picNeeds || nameNeeds) {
          contact = await this.updateContact(instance, contact.id, {
            ...(nameNeeds && { name: nameContact }),
            ...(waFile === '' && { avatar_url: null }),
            ...(picNeeds && { avatar_url: pic.profilePictureUrl }),
          });
        }
      }

      if (!contact) {
        contact = await this.createContact(instance, chatId, filterInbox.id, isGroup, nameContact, pic.profilePictureUrl || null, body.key.remoteJid);
      }
      if (!contact) {
        this.logger.warn('Contact not created or found');
        return null;
      }

      const contactId = contact.payload?.id ?? contact.id;
      this.logger.verbose(`Contact ID: ${contactId}`);

      const convList: any = await client.contacts.listConversations({ accountId: this.provider.accountId, id: contactId });
      this.logger.verbose(`Contact conversations: ${JSON.stringify(convList)}`);

      if (!convList.payload) {
        this.logger.error('No conversations found or payload is undefined');
        return null;
      }

      if (convList.payload.length) {
        let conv: any;
        if (this.provider.reopenConversation) {
          conv = convList.payload.find((c: any) => c.inbox_id === filterInbox.id);
          this.logger.verbose(`Found conversation in reopenConversation mode: ${JSON.stringify(conv)}`);
          if (this.provider.conversationPending && conv.status !== 'open') {
            await client.conversations.toggleStatus({
              accountId: this.provider.accountId,
              conversationId: conv.id,
              data: { status: 'pending' },
            });
          }
        } else {
          conv = convList.payload.find((c: any) => c.status !== 'resolved' && c.inbox_id === filterInbox.id);
          this.logger.verbose(`Found conversation: ${JSON.stringify(conv)}`);
        }
        if (conv) {
          this.logger.verbose(`Returning existing conversation ID: ${conv.id}`);
          this.cache.set(cacheKey, conv.id);
          return conv.id;
        }
      }

      const payload: any = {
        contact_id: contactId.toString(),
        inbox_id: filterInbox.id.toString(),
      };
      if (this.provider.conversationPending) {
        payload.status = 'pending';
      }

      const newConv = await client.conversations.create({
        accountId: this.provider.accountId,
        data: payload,
      });
      if (!newConv) {
        this.logger.warn('Conversation not created or found');
        return null;
      }
      this.logger.verbose(`New conversation created with ID: ${newConv.id}`);
      this.cache.set(cacheKey, newConv.id);
      return newConv.id;
    } catch (error) {
      this.logger.error(`Error in createConversation: ${error}`);
      return null;
    }
  }
  public async getInbox(instance: InstanceDto): Promise<inbox | null> {
    const cacheKey = `${instance.instanceName}:getInbox`;
    if (await this.cache.has(cacheKey)) {
      return (await this.cache.get(cacheKey)) as inbox;
    }
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    const res: any = await client.inboxes.list({ accountId: this.provider.accountId });
    const found = res.payload.find((i: any) => i.name === this.getClientCwConfig().nameInbox);
    if (!found) {
      this.logger.warn('inbox not found');
      return null;
    }
    this.cache.set(cacheKey, found);
    return found;
  }

  public async createMessage(
    instance: InstanceDto,
    conversationId: number,
    content: string,
    messageType: 'incoming' | 'outgoing' | undefined,
    privateMessage = false,
    attachments?: { content: unknown; encoding: string; filename: string }[],
    messageBody?: any,
    sourceId?: string,
    quotedMsg?: MessageModel,
  ): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    const replyToIds = await this.getReplyToIds(messageBody, instance);
    const sourceReplyId = quotedMsg?.chatwootMessageId?.toString() ?? null;
    const message = await client.messages.create({
      accountId: this.provider.accountId,
      conversationId,
      data: {
        content,
        message_type: messageType,
        attachments,
        private: privateMessage,
        source_id: sourceId,
        content_attributes: { ...replyToIds },
        source_reply_id: sourceReplyId,
      },
    });
    if (!message) {
      this.logger.warn('message not found');
      return null;
    }
    return message;
  }

  public async getOpenConversationByContact(
    instance: InstanceDto,
    inbox: inbox,
    contact: generic_id & contact,
  ): Promise<conversation | undefined> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return undefined;
    }
    const res: any = await client.contacts.listConversations({
      accountId: this.provider.accountId,
      id: contact.id,
    });
    return res.payload.find((c: any) => c.inbox_id === inbox.id && c.status === 'open');
  }

  public async createBotMessage(
    instance: InstanceDto,
    content: string,
    messageType: 'incoming' | 'outgoing' | undefined,
    attachments?: { content: unknown; encoding: string; filename: string }[],
  ): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    const contact = await this.findContact(instance, '123456');
    if (!contact) {
      this.logger.warn('contact not found');
      return null;
    }
    const inbox = await this.getInbox(instance);
    if (!inbox) {
      this.logger.warn('inbox not found');
      return null;
    }
    const conv = await this.getOpenConversationByContact(instance, inbox, contact);
    if (!conv) {
      this.logger.warn('conversation not found');
      return null;
    }
    const message = await client.messages.create({
      accountId: this.provider.accountId,
      conversationId: conv.id,
      data: { content, message_type: messageType, attachments },
    });
    if (!message) {
      this.logger.warn('message not found');
      return null;
    }
    return message;
  }
  private async sendData(
    conversationId: number,
    fileStream: Readable,
    fileName: string,
    messageType: 'incoming' | 'outgoing' | undefined,
    content?: string,
    instance?: InstanceDto,
    messageBody?: any,
    sourceId?: string,
    quotedMsg?: MessageModel,
  ): Promise<any> {
    if (sourceId && this.isImportHistoryAvailable()) {
      const existing = await chatwootImport.getExistingSourceIds([sourceId]);
      if (existing && existing.size > 0) {
        this.logger.warn('Message already saved on chatwoot');
        return null;
      }
    }
    const data = new FormData();
    if (content) data.append('content', content);
    data.append('message_type', messageType);
    data.append('attachments[]', fileStream, { filename: fileName });
    const sourceReplyId = quotedMsg?.chatwootMessageId?.toString() ?? null;
    if (messageBody && instance) {
      const replyToIds = await this.getReplyToIds(messageBody, instance);
      if (replyToIds.in_reply_to || replyToIds.in_reply_to_external_id) {
        data.append('content_attributes', JSON.stringify(replyToIds));
      }
    }
    if (sourceReplyId) data.append('source_reply_id', sourceReplyId);
    if (sourceId) data.append('source_id', sourceId);

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${this.provider.url}/api/v1/accounts/${this.provider.accountId}/conversations/${conversationId}/messages`,
      headers: { api_access_token: this.provider.token, ...data.getHeaders() },
      data,
    };
    try {
      const res = await axios.request(config);
      return res.data;
    } catch (err) {
      this.logger.error(err);
      return null;
    }
  }

  public async createBotQr(
    instance: InstanceDto,
    content: string,
    messageType: 'incoming' | 'outgoing' | undefined,
    fileStream?: Readable,
    fileName?: string,
  ): Promise<any> {
    const client = await this.clientCw(instance);
    if (!client) {
      this.logger.warn('client not found');
      return null;
    }
    if (!this.configService.get<Chatwoot>('CHATWOOT').BOT_CONTACT) {
      this.logger.log('Chatwoot bot contact is disabled');
      return true;
    }
    const contact = await this.findContact(instance, '123456');
    if (!contact) {
      this.logger.warn('contact not found');
      return null;
    }
    const inbox = await this.getInbox(instance);
    if (!inbox) {
      this.logger.warn('inbox not found');
      return null;
    }
    const conv = await this.getOpenConversationByContact(instance, inbox, contact);
    if (!conv) {
      this.logger.warn('conversation not found');
      return null;
    }
    const data = new FormData();
    if (content) data.append('content', content);
    data.append('message_type', messageType);
    if (fileStream && fileName) data.append('attachments[]', fileStream, { filename: fileName });
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${this.provider.url}/api/v1/accounts/${this.provider.accountId}/conversations/${conv.id}/messages`,
      headers: { api_access_token: this.provider.token, ...data.getHeaders() },
      data,
    };
    try {
      const res = await axios.request(config);
      return res.data;
    } catch (err) {
      this.logger.error(err);
      return null;
    }
  }

  public async sendAttachment(
    waInstance: any,
    number: string,
    media: any,
    caption?: string,
    options?: Options,
  ): Promise<any> {
    try {
      const parsed = path.parse(decodeURIComponent(media));
      let mimeType = mimeTypes.lookup(parsed.ext) || '';
      let fileName = `${parsed.name}${parsed.ext}`;
      if (!mimeType) {
        const parts = media.split('/');
        fileName = decodeURIComponent(parts[parts.length - 1]);
        const res = await axios.get(media, { responseType: 'arraybuffer' });
        mimeType = res.headers['content-type'];
      }
      let type: 'image' | 'video' | 'audio' | 'document' = 'document';
      switch (mimeType.split('/')[0]) {
        case 'image': type = 'image'; break;
        case 'video': type = 'video'; break;
        case 'audio': type = 'audio'; break;
        default: type = 'document';
      }
      if (type === 'audio') {
        const data: SendAudioDto = { number, audio: media, delay: 1200, quoted: options?.quoted };
        sendTelemetry('/message/sendWhatsAppAudio');
        return await waInstance.audioWhatsapp(data, true);
      }
      if (type === 'image' && parsed.ext === '.gif') type = 'document';
      const mediaDto: SendMediaDto = { number, mediatype: type as any, fileName, media, delay: 1200, quoted: options?.quoted };
      if (caption) mediaDto.caption = caption;
      sendTelemetry('/message/sendMedia');
      return await waInstance.mediaMessage(mediaDto, null, true);
    } catch (err) {
      this.logger.error(err);
      return null;
    }
  }

  public async onSendMessageError(instance: InstanceDto, conversation: number, error?: any): Promise<void> {
    this.logger.verbose(`onSendMessageError ${JSON.stringify(error)}`);
    const client = await this.clientCw(instance);
    if (!client) return;
    if (error?.status === 400 && error.message?.[0]?.exists === false) {
      await client.messages.create({
        accountId: this.provider.accountId,
        conversationId: conversation,
        data: {
          content: i18next.t('cw.message.numbernotinwhatsapp'),
          message_type: 'outgoing',
          private: true,
        },
      });
      return;
    }
    await client.messages.create({
      accountId: this.provider.accountId,
      conversationId: conversation,
      data: {
        content: i18next.t('cw.message.notsent', { error: error ? `_${error.toString()}_` : '' }),
        message_type: 'outgoing',
        private: true,
      },
    });
  }
  public async receiveWebhook(instance: InstanceDto, body: any): Promise<any> {
    try {
      await new Promise((res) => setTimeout(res, 500));
      const client = await this.clientCw(instance);
      if (!client) {
        this.logger.warn('client not found');
        return null;
      }

      // Se conversa resolvida, limpa cache
      if (
        this.provider.reopenConversation === false &&
        body.event === 'conversation_status_changed' &&
        body.status === 'resolved' &&
        body.meta?.sender?.identifier
      ) {
        const keyToDelete = `${instance.instanceName}:createConversation-${body.meta.sender.identifier}`;
        await this.cache.delete(keyToDelete);
      }

      // Ignora atualizações irrelevantes
      if (!body?.conversation || body.private || (body.event === 'message_updated' && !body.content_attributes?.deleted)) {
        return { message: 'bot' };
      }

      const chatId =
        body.conversation.meta.sender?.identifier ||
        body.conversation.meta.sender?.phone_number.replace('+', '');

      // Formata texto recebido
      let messageReceived = body.content
        ? body.content
            .replaceAll(/(?<!\*)\*((?!\s)([^\n*]+?)(?<!\s))\*(?!\*)/g, '_$1_')
            .replaceAll(/\*{2}((?!\s)([^\n*]+?)(?<!\s))\*{2}/g, '*$1*')
            .replaceAll(/~{2}((?!\s)([^\n*]+?)(?<!\s))~{2}/g, '~$1~')
            .replaceAll(/(?<!`)`((?!\s)([^`*]+?)(?<!\s))`(?!`)/g, '```$1```')
        : body.content;

      const senderName =
        body.conversation.messages?.[0]?.sender?.available_name || body.sender?.name;
      const waInstance = this.waMonitor.waInstances[instance.instanceName];

      // Deleção de mensagem no WhatsApp
      if (body.event === 'message_updated' && body.content_attributes?.deleted) {
        const msg = await this.prismaRepository.message.findFirst({
          where: { chatwootMessageId: body.id, instanceId: instance.instanceId },
        });
        if (msg) {
          const key = msg.key as { id: string; remoteJid: string; fromMe: boolean; participant: string };
          await waInstance.client.sendMessage(key.remoteJid, { delete: key });
          await this.prismaRepository.message.deleteMany({
            where: { instanceId: instance.instanceId, chatwootMessageId: body.id },
          });
        }
        return { message: 'bot' };
      }

      const cwBot = this.configService.get<Chatwoot>('CHATWOOT').BOT_CONTACT;

      // Comandos do bot interno
      if (chatId === '123456' && body.message_type === 'outgoing') {
        const cmd = messageReceived.replace('/', '');
        if (cwBot && (cmd.includes('init') || cmd.includes('iniciar'))) {
          const state = waInstance?.connectionStatus?.state;
          if (state !== 'open') {
            const num = cmd.split(':')[1];
            await waInstance.connectToWhatsapp(num);
          } else {
            await this.createBotMessage(instance, i18next.t('cw.inbox.alreadyConnected', { inboxName: body.inbox.name }), 'incoming');
          }
        }
        if (cmd === 'clearcache') {
          waInstance.clearCacheChatwoot();
          await this.createBotMessage(instance, i18next.t('cw.inbox.clearCache', { inboxName: body.inbox.name }), 'incoming');
        }
        if (cmd === 'status') {
          const state = waInstance?.connectionStatus?.state;
          if (!state) {
            await this.createBotMessage(instance, i18next.t('cw.inbox.notFound', { inboxName: body.inbox.name }), 'incoming');
          } else {
            await this.createBotMessage(instance, i18next.t('cw.inbox.status', { inboxName: body.inbox.name, state }), 'incoming');
          }
        }
        if (cwBot && (cmd === 'disconnect' || cmd === 'desconectar')) {
          const msgLogout = i18next.t('cw.inbox.disconnect', { inboxName: body.inbox.name });
          await this.createBotMessage(instance, msgLogout, 'incoming');
          await waInstance.client.logout(`Log out instance: ${instance.instanceName}`);
          await waInstance.client.ws.close();
        }
        return { message: 'bot' };
      }

      // Encaminhamento de mensagens para o WhatsApp
      if (body.message_type === 'outgoing' && body.conversation.messages?.length && chatId !== '123456') {
        if (body.conversation.messages[0].source_id?.startsWith('WAID:')) {
          return { message: 'bot' };
        }
        if (!waInstance && body.conversation.id) {
          this.onSendMessageError(instance, body.conversation.id, 'Instance not found');
          return { message: 'bot' };
        }
        let formatText: string;
        if (!senderName) {
          formatText = messageReceived;
        } else {
          const delimiter = this.provider.signDelimiter?.replace(/\\n/g, '\n') || '\n';
          const parts = this.provider.signMsg ? [`*${senderName}:*`] : [];
          parts.push(messageReceived);
          formatText = parts.join(delimiter);
        }

        for (const message of body.conversation.messages) {
          if (message.attachments?.length) {
            for (const attachment of message.attachments) {
              if (!messageReceived) formatText = null;
              const options: Options = { quoted: await this.getQuotedMessage(body, instance) };
              const sent = await this.sendAttachment(waInstance, chatId, attachment.data_url, formatText, options);
              if (!sent && body.conversation.id) {
                this.onSendMessageError(instance, body.conversation.id);
              }
              await this.updateChatwootMessageId(
                { ...sent, owner: instance.instanceName },
                {
                  messageId: body.id,
                  inboxId: body.inbox?.id,
                  conversationId: body.conversation.id,
                  contactInboxSourceId: body.conversation.contact_inbox?.source_id,
                },
                instance,
              );
            }
          } else {
            const txtDto: SendTextDto = {
              number: chatId,
              text: formatText,
              delay: 1200,
              quoted: await this.getQuotedMessage(body, instance),
            };
            sendTelemetry('/message/sendText');
            try {
              const sent = await waInstance.textMessage(txtDto, true);
              if (!sent) throw new Error('Message not sent');
              if (Long.isLong(sent.messageTimestamp)) {
                sent.messageTimestamp = sent.messageTimestamp.toNumber();
              }
              await this.updateChatwootMessageId(
                { ...sent, instanceId: instance.instanceId },
                {
                  messageId: body.id,
                  inboxId: body.inbox?.id,
                  conversationId: body.conversation.id,
                  contactInboxSourceId: body.conversation.contact_inbox?.source_id,
                },
                instance,
              );
            } catch (err) {
              this.onSendMessageError(instance, body.conversation.id, err);
              throw err;
            }
          }
        }
      }

      // Marcar como lido
      const chatwootRead = this.configService.get<Chatwoot>('CHATWOOT').MESSAGE_READ;
      if (chatwootRead) {
        const lastMessage = await this.prismaRepository.message.findFirst({
          where: { instanceId: instance.instanceId, key: { path: ['fromMe'], equals: false } },
        });
        if (lastMessage && !lastMessage.chatwootIsRead) {
          const key = lastMessage.key as { id: string; fromMe: boolean; remoteJid: string };
          waInstance?.markMessageAsRead({ readMessages: [{ id: key.id, fromMe: key.fromMe, remoteJid: key.remoteJid }] });
          const updateData = {
            chatwootMessageId: lastMessage.chatwootMessageId,
            chatwootConversationId: lastMessage.chatwootConversationId,
            chatwootInboxId: lastMessage.chatwootInboxId,
            chatwootContactInboxSourceId: lastMessage.chatwootContactInboxSourceId,
            chatwootIsRead: true,
          };
          await this.prismaRepository.message.updateMany({
            where: { instanceId: instance.instanceId, key: { path: ['id'], equals: key.id } },
            data: updateData,
          });
        }
      }

      return { message: 'OK' };
    } catch (error) {
      this.logger.error(`Erro em receiveWebhook: ${error}`);
      return null;
    }
  }
  public getNumberFromRemoteJid(remoteJid: string): string {
    return remoteJid.replace(/:\d+/, '').split('@')[0];
  }

  public startImportHistoryMessages(instance: InstanceDto): void {
    if (!this.isImportHistoryAvailable()) return;
    this.createBotMessage(instance, i18next.t('cw.import.startImport'), 'incoming');
  }

  public isImportHistoryAvailable(): boolean {
    const uri = this.configService.get<Chatwoot>('CHATWOOT').IMPORT.DATABASE.CONNECTION.URI;
    return !!uri && uri !== 'postgres://user:password@hostname:port/dbname';
  }

  public addHistoryMessages(instance: InstanceDto, messagesRaw: MessageModel[]): void {
    if (!this.isImportHistoryAvailable()) return;
    chatwootImport.addHistoryMessages(instance, messagesRaw);
  }

  public addHistoryContacts(instance: InstanceDto, contactsRaw: ContactModel[]): any {
    if (!this.isImportHistoryAvailable()) return;
    return chatwootImport.addHistoryContacts(instance, contactsRaw);
  }

  public async importHistoryMessages(instance: InstanceDto): Promise<number | void> {
    if (!this.isImportHistoryAvailable()) return;
    this.createBotMessage(instance, i18next.t('cw.import.importingMessages'), 'incoming');
    const total = await chatwootImport.importHistoryMessages(
      instance,
      this,
      await this.getInbox(instance),
      this.provider,
    );
    await this.updateContactAvatarInRecentConversations(instance);
    const msg = Number.isInteger(total)
      ? i18next.t('cw.import.messagesImported', { totalMessagesImported: total as number })
      : i18next.t('cw.import.messagesException');
    this.createBotMessage(instance, msg, 'incoming');
    return total as number;
  }

  public async updateContactAvatarInRecentConversations(instance: InstanceDto, limitContacts = 100): Promise<void> {
    try {
      if (!this.isImportHistoryAvailable()) return;
      const client = await this.clientCw(instance);
      if (!client) {
        this.logger.warn('client not found');
        return;
      }
      const inbox = await this.getInbox(instance);
      if (!inbox) {
        this.logger.warn('inbox not found');
        return;
      }
      const recentContacts = await chatwootImport.getContactsOrderByRecentConversations(
        inbox,
        this.provider,
        limitContacts,
      );
      const identifiers = recentContacts.map((c) => c.identifier).filter(Boolean);
      const contactsWithPics = (
        await this.prismaRepository.contact.findMany({
          where: { instanceId: instance.instanceId, id: { in: identifiers }, profilePicUrl: { not: null } },
        })
      ).reduce((m, c) => m.set(c.id, c), new Map<string, ContactModel>());
      for (const c of recentContacts) {
        const pic = contactsWithPics.get(c.identifier);
        if (pic) {
          await client.contacts.update({
            accountId: this.provider.accountId,
            id: c.id,
            data: { avatar_url: pic.profilePictureUrl || null },
          });
        }
      }
    } catch (err) {
      this.logger.error(`Error on update avatar in recent conversations: ${err}`);
    }
  }

  public async syncLostMessages(
    instance: InstanceDto,
    chatwootConfig: ChatwootDto,
    prepareMessage: (message: any) => any,
  ): Promise<void> {
    try {
      if (!this.isImportHistoryAvailable()) return;
      if (!this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) return;
      const inbox = await this.getInbox(instance);
      const sqlMessages = `
        select * from messages m
        where account_id = ${chatwootConfig.accountId}
          and inbox_id = ${inbox.id}
          and created_at >= now() - interval '6h'
        order by created_at desc`;
      const rows = (await this.pgClient.query(sqlMessages)).rows;
      const ids = rows.filter((r) => !!r.source_id).map((r) => r.source_id.replace('WAID:', ''));
      const saved = await this.prismaRepository.message.findMany({
        where: {
          Instance: { name: instance.instanceName },
          messageTimestamp: { gte: dayjs().subtract(6, 'hours').unix() },
          AND: ids.map((id) => ({ key: { path: ['id'], not: id } })),
        },
      });
      const filtered = saved.filter((m) => !chatwootImport.isIgnorePhoneNumber(m.key?.remoteJid));
      const raw: any[] = [];
      for (const m of filtered) {
        if (!m.message || !m.key || !m.messageTimestamp) continue;
        if (Long.isLong(m.messageTimestamp)) m.messageTimestamp = m.messageTimestamp.toNumber();
        raw.push(prepareMessage(m));
      }
      this.addHistoryMessages(instance, raw);
      await chatwootImport.importHistoryMessages(instance, this, inbox, this.provider);
      const waInstance = this.waMonitor.waInstances[instance.instanceName];
      waInstance.clearCacheChatwoot();
    } catch {
      // swallow
    }
  }
}
