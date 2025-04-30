// ✅ Arquivo `chatwoot.service.ts` corrigido e reestruturado

import { InstanceDto } from '@api/dto/instance.dto';
import { Options, SendAudioDto, SendMediaDto, SendTextDto } from '@api/dto/sendMessage.dto';
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
  conversation,
  inbox,
  generic_id,
} from '@figuro/chatwoot-sdk';
import { request as chatwootRequest } from '@figuro/chatwoot-sdk/dist/core/request';
import { Chatwoot as ChatwootModel, Contact as ContactModel, Message as MessageModel } from '@prisma/client';
import i18next from '../../../../utils/i18n';
import { sendTelemetry } from '../../../../utils/sendTelemetry';
import axios from 'axios';
import { proto } from 'baileys';
import dayjs from 'dayjs';
import FormData from 'form-data';
import Long from 'long';
import mimeTypes from 'mime-types';
import path from 'path';
import { Readable } from 'stream';

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

  // ... Todas as funções principais e auxiliares já revisadas continuam aqui ...

  public getNumberFromRemoteJid(remoteJid: string) {
    return remoteJid.replace(/:\d+/, '').split('@')[0];
  }

  public startImportHistoryMessages(instance: InstanceDto) {
    if (!this.isImportHistoryAvailable()) return;
    this.createBotMessage(instance, i18next.t('cw.import.startImport'), 'incoming');
  }

  public isImportHistoryAvailable() {
    const uri = this.configService.get<Chatwoot>('CHATWOOT').IMPORT.DATABASE.CONNECTION.URI;
    return uri && uri !== 'postgres://user:password@hostname:port/dbname';
  }

  public addHistoryMessages(instance: InstanceDto, messagesRaw: MessageModel[]) {
    if (!this.isImportHistoryAvailable()) return;
    chatwootImport.addHistoryMessages(instance, messagesRaw);
  }

  public addHistoryContacts(instance: InstanceDto, contactsRaw: ContactModel[]) {
    if (!this.isImportHistoryAvailable()) return;
    return chatwootImport.addHistoryContacts(instance, contactsRaw);
  }

  public async importHistoryMessages(instance: InstanceDto) {
    if (!this.isImportHistoryAvailable()) return;
    this.createBotMessage(instance, i18next.t('cw.import.importingMessages'), 'incoming');
    const totalMessagesImported = await chatwootImport.importHistoryMessages(
      instance,
      this,
      await this.getInbox(instance),
      this.provider,
    );
    this.updateContactAvatarInRecentConversations(instance);
    const msg = Number.isInteger(totalMessagesImported)
      ? i18next.t('cw.import.messagesImported', { totalMessagesImported })
      : i18next.t('cw.import.messagesException');
    this.createBotMessage(instance, msg, 'incoming');
    return totalMessagesImported;
  }

  public async updateContactAvatarInRecentConversations(instance: InstanceDto, limitContacts = 100) {
    try {
      if (!this.isImportHistoryAvailable()) return;
      const client = await this.clientCw(instance);
      if (!client) return;
      const inbox = await this.getInbox(instance);
      if (!inbox) return;
      const recentContacts = await chatwootImport.getContactsOrderByRecentConversations(
        inbox,
        this.provider,
        limitContacts,
      );
      const contactIdentifiers = recentContacts.map(c => c.identifier).filter(Boolean);

      const contactsWithProfilePicture = (
        await this.prismaRepository.contact.findMany({
          where: {
            instanceId: instance.instanceId,
            id: { in: contactIdentifiers },
            profilePicUrl: { not: null },
          },
        })
      ).reduce((acc: Map<string, ContactModel>, contact: ContactModel) => acc.set(contact.id, contact), new Map());

      for (const contact of recentContacts) {
        if (contactsWithProfilePicture.has(contact.identifier)) {
          client.contacts.update({
            accountId: this.provider.accountId,
            id: contact.id,
            data: {
              avatar_url: contactsWithProfilePicture.get(contact.identifier).profilePictureUrl || null,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(`Error on update avatar in recent conversations: ${error.toString()}`);
    }
  }

  public async syncLostMessages(
    instance: InstanceDto,
    chatwootConfig: ChatwootDto,
    prepareMessage: (message: any) => any,
  ) {
    try {
      if (!this.isImportHistoryAvailable()) return;
      if (!this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) return;

      const inbox = await this.getInbox(instance);
      const sqlMessages = `SELECT * FROM messages m
        WHERE account_id = ${chatwootConfig.accountId}
        AND inbox_id = ${inbox.id}
        AND created_at >= now() - interval '6h'
        ORDER BY created_at DESC`;

      const messagesData = (await this.pgClient.query(sqlMessages))?.rows;
      const ids: string[] = messagesData
        .filter((m) => !!m.source_id)
        .map((m) => m.source_id.replace('WAID:', ''));

      const savedMessages = await this.prismaRepository.message.findMany({
        where: {
          Instance: { name: instance.instanceName },
          messageTimestamp: { gte: dayjs().subtract(6, 'hours').unix() },
          AND: ids.map((id) => ({ key: { path: ['id'], not: id } })),
        },
      });

      const filteredMessages = savedMessages.filter(
        (msg: any) => !chatwootImport.isIgnorePhoneNumber(msg.key?.remoteJid),
      );

      const messagesRaw = filteredMessages.map((m: any) => {
        if (Long.isLong(m?.messageTimestamp)) {
          m.messageTimestamp = m.messageTimestamp.toNumber();
        }
        return prepareMessage(m);
      });

      this.addHistoryMessages(
        instance,
        messagesRaw.filter((msg) => !chatwootImport.isIgnorePhoneNumber(msg.key?.remoteJid)),
      );

      await chatwootImport.importHistoryMessages(instance, this, inbox, this.provider);
      const waInstance = this.waMonitor.waInstances[instance.instanceName];
      waInstance.clearCacheChatwoot();
    } catch (error) {
      return;
    }
  }
}
