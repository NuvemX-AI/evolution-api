import { OfferCallDto } from '@api/dto/call.dto';
// ... (todos os outros imports do seu código original)

import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys';

const groupMetadataCache = new CacheService(new CacheEngine(configService, 'groups').getEngine());

async function getVideoDuration(input: Buffer | string | Readable): Promise<number> {
  const MediaInfoFactory = (await import('mediainfo.js')).default;
  const mediainfo = await MediaInfoFactory({ format: 'JSON' });

  let fileSize: number;
  let readChunk: (size: number, offset: number) => Promise<Buffer>;

  if (Buffer.isBuffer(input)) {
    fileSize = input.length;
    readChunk = async (size: number, offset: number): Promise<Buffer> => {
      return input.slice(offset, offset + size);
    };
  } else if (typeof input === 'string') {
    const fs = await import('fs');
    const stat = await fs.promises.stat(input);
    fileSize = stat.size;
    const fd = await fs.promises.open(input, 'r');

    readChunk = async (size: number, offset: number): Promise<Buffer> => {
      const buffer = Buffer.alloc(size);
      await fd.read(buffer, 0, size, offset);
      return buffer;
    };

    try {
      const result = await mediainfo.analyzeData(() => fileSize, readChunk);
      const jsonResult = JSON.parse(result);

      const generalTrack = jsonResult.media.track.find((t: any) => t['@type'] === 'General');
      const duration = generalTrack.Duration;

      return Math.round(parseFloat(duration));
    } finally {
      await fd.close();
    }
  } else if (input instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    fileSize = data.length;

    readChunk = async (size: number, offset: number): Promise<Buffer> => {
      return data.slice(offset, offset + size);
    };
  } else {
    throw new Error('Tipo de entrada não suportado');
  }

  const result = await mediainfo.analyzeData(() => fileSize, readChunk);
  const jsonResult = JSON.parse(result);
  const generalTrack = jsonResult.media.track.find((t: any) => t['@type'] === 'General');
  const duration = generalTrack.Duration;

  return Math.round(parseFloat(duration));
}

export class BaileysStartupService extends ChannelStartupService {
  public stateConnection: wa.StateConnection = { state: 'close' };
  public phoneNumber: string;
  private authStateProvider: AuthStateProvider;
  private readonly msgRetryCounterCache: CacheStore = new NodeCache();
  private readonly userDevicesCache: CacheStore = new NodeCache();
  private endSession = false;
  private logBaileys = this.configService.get<Log>('LOG').BAILEYS;

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
    this.instance.qrcode = { count: 0 };
    this.authStateProvider = new AuthStateProvider(this.providerFiles);
  }   public get connectionStatus() {
    return this.stateConnection;
  }

  public get profilePictureUrl() {
    return this.instance.profilePictureUrl;
  }

  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count,
    };
  }

  public async logoutInstance() {
    await this.client?.logout('Log out instance: ' + this.instanceName);
    this.client?.ws?.close();

    const sessionExists = await this.prismaRepository.session.findFirst({
      where: { sessionId: this.instanceId },
    });
    if (sessionExists) {
      await this.prismaRepository.session.delete({
        where: { sessionId: this.instanceId },
      });
    }
  }

  public async getProfileName() {
    let profileName = this.client.user?.name ?? this.client.user?.verifiedName;
    if (!profileName) {
      const data = await this.prismaRepository.session.findUnique({
        where: { sessionId: this.instanceId },
      });

      if (data) {
        const creds = JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver);
        profileName = creds.me?.name || creds.me?.verifiedName;
      }
    }

    return profileName;
  }

  public async getProfileStatus() {
    const status = await this.client.fetchStatus(this.instance.wuid);
    return status[0]?.status;
  }   private async connectionUpdate({ qr, connection, lastDisconnect }: Partial<ConnectionState>) {
    if (qr) {
      if (this.instance.qrcode.count === this.configService.get<QrCode>('QRCODE').LIMIT) {
        this.sendDataWebhook(Events.QRCODE_UPDATED, {
          message: 'QR code limit reached, please login again',
          statusCode: DisconnectReason.badSession,
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          this.chatwootService.eventWhatsapp(
            Events.QRCODE_UPDATED,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            {
              message: 'QR code limit reached, please login again',
              statusCode: DisconnectReason.badSession,
            },
          );
        }

        this.sendDataWebhook(Events.CONNECTION_UPDATE, {
          instance: this.instance.name,
          state: 'refused',
          statusReason: DisconnectReason.connectionClosed,
          wuid: this.instance.wuid,
          profileName: await this.getProfileName(),
          profilePictureUrl: this.instance.profilePictureUrl,
        });

        this.endSession = true;

        return this.eventEmitter.emit('no.connection', this.instance.name);
      }

      this.instance.qrcode.count++;

      const color = this.configService.get<QrCode>('QRCODE').COLOR;

      const optsQrcode: QRCodeToDataURLOptions = {
        margin: 3,
        scale: 4,
        errorCorrectionLevel: 'H',
        color: { light: '#ffffff', dark: color },
      };

      if (this.phoneNumber) {
        await delay(1000);
        this.instance.qrcode.pairingCode = await this.client.requestPairingCode(this.phoneNumber);
      } else {
        this.instance.qrcode.pairingCode = null;
      }

      qrcode.toDataURL(qr, optsQrcode, (error, base64) => {
        if (error) {
          this.logger.error('Qrcode generate failed:' + error.toString());
          return;
        }

        this.instance.qrcode.base64 = base64;
        this.instance.qrcode.code = qr;

        this.sendDataWebhook(Events.QRCODE_UPDATED, {
          qrcode: {
            instance: this.instance.name,
            pairingCode: this.instance.qrcode.pairingCode,
            code: qr,
            base64,
          },
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          this.chatwootService.eventWhatsapp(
            Events.QRCODE_UPDATED,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            {
              qrcode: {
                instance: this.instance.name,
                pairingCode: this.instance.qrcode.pairingCode,
                code: qr,
                base64,
              },
            },
          );
        }
      });

      qrcodeTerminal.generate(qr, { small: true }, (qrcode) =>
        this.logger.log(
          `\n{ instance: ${this.instance.name} pairingCode: ${this.instance.qrcode.pairingCode}, qrcodeCount: ${this.instance.qrcode.count} }\n` +
            qrcode,
        ),
      );

      await this.prismaRepository.instance.update({
        where: { id: this.instanceId },
        data: { connectionStatus: 'connecting' },
      });
    }

    if (connection) {
      this.stateConnection = {
        state: connection,
        statusReason: (lastDisconnect?.error as Boom)?.output?.statusCode ?? 200,
      };
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const codesToNotReconnect = [DisconnectReason.loggedOut, DisconnectReason.forbidden, 402, 406];
      const shouldReconnect = !codesToNotReconnect.includes(statusCode);
      if (shouldReconnect) {
        await this.connectToWhatsapp(this.phoneNumber);
      } else {
        this.sendDataWebhook(Events.STATUS_INSTANCE, {
          instance: this.instance.name,
          status: 'closed',
          disconnectionAt: new Date(),
          disconnectionReasonCode: statusCode,
          disconnectionObject: JSON.stringify(lastDisconnect),
        });

        await this.prismaRepository.instance.update({
          where: { id: this.instanceId },
          data: {
            connectionStatus: 'close',
            disconnectionAt: new Date(),
            disconnectionReasonCode: statusCode,
            disconnectionObject: JSON.stringify(lastDisconnect),
          },
        });

        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
          this.chatwootService.eventWhatsapp(
            Events.STATUS_INSTANCE,
            { instanceName: this.instance.name, instanceId: this.instanceId },
            {
              instance: this.instance.name,
              status: 'closed',
            },
          );
        }

        this.eventEmitter.emit('logout.instance', this.instance.name, 'inner');
        this.client?.ws?.close();
        this.client.end(new Error('Close connection'));

        this.sendDataWebhook(Events.CONNECTION_UPDATE, {
          instance: this.instance.name,
          ...this.stateConnection,
        });
      }
    }

    if (connection === 'open') {
      this.instance.wuid = this.client.user.id.replace(/:\d+/, '');
      try {
        const profilePic = await this.profilePicture(this.instance.wuid);
        this.instance.profilePictureUrl = profilePic.profilePictureUrl;
      } catch (error) {
        this.instance.profilePictureUrl = null;
      }
      const formattedWuid = this.instance.wuid.split('@')[0].padEnd(30, ' ');
      const formattedName = this.instance.name;
      this.logger.info(
        `
        ┌──────────────────────────────┐
        │    CONNECTED TO WHATSAPP     │
        └──────────────────────────────┘`.replace(/^ +/gm, '  '),
      );
      this.logger.info(
        `
        wuid: ${formattedWuid}
        name: ${formattedName}
      `,
      );

      await this.prismaRepository.instance.update({
        where: { id: this.instanceId },
        data: {
          ownerJid: this.instance.wuid,
          profileName: (await this.getProfileName()) as string,
          profilePicUrl: this.instance.profilePictureUrl,
          connectionStatus: 'open',
        },
      });

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
        this.chatwootService.eventWhatsapp(
          Events.CONNECTION_UPDATE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          {
            instance: this.instance.name,
            status: 'open',
          },
        );
        this.syncChatwootLostMessages();
      }

      this.sendDataWebhook(Events.CONNECTION_UPDATE, {
        instance: this.instance.name,
        wuid: this.instance.wuid,
        profileName: await this.getProfileName(),
        profilePictureUrl: this.instance.profilePictureUrl,
        ...this.stateConnection,
      });
    }

    if (connection === 'connecting') {
      this.sendDataWebhook(Events.CONNECTION_UPDATE, {
        instance: this.instance.name,
        ...this.stateConnection,
      });
    }
  }

  private async getMessage(key: proto.IMessageKey, full = false) {
    try {
      const webMessageInfo = (await this.prismaRepository.message.findMany({
        where: {
          instanceId: this.instanceId,
          key: { path: ['id'], equals: key.id },
        },
      })) as unknown as proto.IWebMessageInfo[];
      if (full) {
        return webMessageInfo[0];
      }
      if (webMessageInfo[0].message?.pollCreationMessage) {
        const messageSecretBase64 = webMessageInfo[0].message?.messageContextInfo?.messageSecret;

        if (typeof messageSecretBase64 === 'string') {
          const messageSecret = Buffer.from(messageSecretBase64, 'base64');

          const msg = {
            messageContextInfo: { messageSecret },
            pollCreationMessage: webMessageInfo[0].message?.pollCreationMessage,
          };

          return msg;
        }
      }
      return webMessageInfo[0].message;
    } catch (error) {
      return { conversation: '' };
    }
  }   private async defineAuthState() {
    const db = this.configService.get<Database>('DATABASE');
    const cache = this.configService.get<CacheConf>('CACHE');
    const provider = this.configService.get<ProviderSession>('PROVIDER');

    if (provider?.ENABLED) {
      return await this.authStateProvider.authStateProvider(this.instance.id);
    }
    if (cache?.REDIS.ENABLED && cache?.REDIS.SAVE_INSTANCES) {
      this.logger.info('Redis enabled');
      return await useMultiFileAuthStateRedisDb(this.instance.id, this.cache);
    }
    if (db.SAVE_DATA.INSTANCE) {
      return await useMultiFileAuthStatePrisma(this.instance.id, this.cache);
    }
  }

  private async createClient(number?: string): Promise<WASocket> {
    this.instance.authState = await this.defineAuthState();

    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');

    let browserOptions = {};

    if (number || this.phoneNumber) {
      this.phoneNumber = number;
      this.logger.info(`Phone number: ${number}`);
    } else {
      const browser: WABrowserDescription = [session.CLIENT, session.NAME, release()];
      browserOptions = { browser };
      this.logger.info(`Browser: ${browser}`);
    }

    let version;
    let log;
    if (session.VERSION) {
      version = session.VERSION.split('.');
      log = `Baileys version env: ${version}`;
    } else {
      const baileysVersion = await fetchLatestBaileysVersion();
      version = baileysVersion.version;
      log = `Baileys version: ${version}`;
    }

    this.logger.info(log);
    this.logger.info(`Group Ignore: ${this.localSettings.groupsIgnore}`);
    let options;

    if (this.localProxy?.enabled) {
      this.logger.info('Proxy enabled: ' + this.localProxy?.host);

      if (this.localProxy?.host?.includes('proxyscrape')) {
        try {
          const response = await axios.get(this.localProxy?.host);
          const text = response.data;
          const proxyUrls = text.split('\r\n');
          const rand = Math.floor(Math.random() * Math.floor(proxyUrls.length));
          const proxyUrl = 'http://' + proxyUrls[rand];
          options = {
            agent: makeProxyAgent(proxyUrl),
            fetchAgent: makeProxyAgent(proxyUrl),
          };
        } catch (error) {
          this.localProxy.enabled = false;
        }
      } else {
        options = {
          agent: makeProxyAgent({
            host: this.localProxy.host,
            port: this.localProxy.port,
            protocol: this.localProxy.protocol,
            username: this.localProxy.username,
            password: this.localProxy.password,
          }),
          fetchAgent: makeProxyAgent({
            host: this.localProxy.host,
            port: this.localProxy.port,
            protocol: this.localProxy.protocol,
            username: this.localProxy.username,
            password: this.localProxy.password,
          }),
        };
      }
    }

    const socketConfig: UserFacingSocketConfig = {
      ...options,
      version,
      logger: P({ level: this.logBaileys }),
      printQRInTerminal: false,
      auth: {
        creds: this.instance.authState.state.creds,
        keys: makeCacheableSignalKeyStore(this.instance.authState.state.keys, P({ level: 'error' }) as any),
      },
      msgRetryCounterCache: this.msgRetryCounterCache,
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => (await this.getMessage(key)) as Promise<proto.IMessage>,
      ...browserOptions,
      markOnlineOnConnect: this.localSettings.alwaysOnline,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 4,
      fireInitQueries: true,
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 30_000,
      qrTimeout: 45_000,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid) => {
        const isGroupJid = this.localSettings.groupsIgnore && isJidGroup(jid);
        const isBroadcast = !this.localSettings.readStatus && isJidBroadcast(jid);
        const isNewsletter = isJidNewsletter(jid);
        return isGroupJid || isBroadcast || isNewsletter;
      },
      syncFullHistory: this.localSettings.syncFullHistory,
      shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification) => {
        return this.historySyncNotification(msg);
      },
      cachedGroupMetadata: this.getGroupMetadataCache,
      userDevicesCache: this.userDevicesCache,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
      patchMessageBeforeSending(message) {
        if (
          message.deviceSentMessage?.message?.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST
        ) {
          message = JSON.parse(JSON.stringify(message));
          message.deviceSentMessage.message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
        }
        if (message.listMessage?.listType == proto.Message.ListMessage.ListType.PRODUCT_LIST) {
          message = JSON.parse(JSON.stringify(message));
          message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
        }
        return message;
      },
    };

    this.endSession = false;
    this.client = makeWASocket(socketConfig);

    if (this.localSettings.wavoipToken && this.localSettings.wavoipToken.length > 0) {
      useVoiceCallsBaileys(this.localSettings.wavoipToken, this.client, this.connectionStatus.state as any, true);
    }

    this.eventHandler();

    this.client.ws.on('CB:call', (packet) => {
      console.log('CB:call', packet);
      const payload = {
        event: 'CB:call',
        packet: packet,
      };
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });

    this.client.ws.on('CB:ack,class:call', (packet) => {
      console.log('CB:ack,class:call', packet);
      const payload = {
        event: 'CB:ack,class:call',
        packet: packet,
      };
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });

    this.phoneNumber = number;

    return this.client;
  }

  public async connectToWhatsapp(number?: string): Promise<WASocket> {
    try {
      this.loadChatwoot();
      this.loadSettings();
      this.loadWebhook();
      this.loadProxy();

      return await this.createClient(number);
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }

  public async reloadConnection(): Promise<WASocket> {
    try {
      return await this.createClient(this.phoneNumber);
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }   private readonly chatHandle = {
    'chats.upsert': async (chats: Chat[]) => {
      const existingChatIds = await this.prismaRepository.chat.findMany({
        where: { instanceId: this.instanceId },
        select: { remoteJid: true },
      });

      const existingChatIdSet = new Set(existingChatIds.map((chat) => chat.remoteJid));
      const chatsToInsert = chats
        .filter((chat) => !existingChatIdSet?.has(chat.id))
        .map((chat) => ({
          remoteJid: chat.id,
          instanceId: this.instanceId,
          name: chat.name,
          unreadMessages: chat.unreadCount !== undefined ? chat.unreadCount : 0,
        }));

      this.sendDataWebhook(Events.CHATS_UPSERT, chatsToInsert);

      if (chatsToInsert.length > 0) {
        if (this.configService.get<Database>('DATABASE').SAVE_DATA.CHATS)
          await this.prismaRepository.chat.createMany({
            data: chatsToInsert,
            skipDuplicates: true,
          });
      }
    },

    'chats.update': async (
      chats: Partial<
        proto.IConversation & {
          lastMessageRecvTimestamp?: number;
        } & {
          conditional: (bufferedData: BufferedEventData) => boolean;
        }
      >[],
    ) => {
      const chatsRaw = chats.map((chat) => {
        return { remoteJid: chat.id, instanceId: this.instanceId };
      });

      this.sendDataWebhook(Events.CHATS_UPDATE, chatsRaw);

      for (const chat of chats) {
        await this.prismaRepository.chat.updateMany({
          where: {
            instanceId: this.instanceId,
            remoteJid: chat.id,
            name: chat.name,
          },
          data: { remoteJid: chat.id },
        });
      }
    },

    'chats.delete': async (chats: string[]) => {
      chats.forEach(
        async (chat) =>
          await this.prismaRepository.chat.deleteMany({
            where: { instanceId: this.instanceId, remoteJid: chat },
          }),
      );

      this.sendDataWebhook(Events.CHATS_DELETE, [...chats]);
    },
  };

  private readonly contactHandle = {
    'contacts.upsert': async (contacts: Contact[]) => {
      try {
        const contactsRaw: any = contacts.map((contact) => ({
          remoteJid: contact.id,
          pushName: contact?.name || contact?.verifiedName || contact.id.split('@')[0],
          profilePicUrl: null,
          instanceId: this.instanceId,
        }));

        if (contactsRaw.length > 0) {
          this.sendDataWebhook(Events.CONTACTS_UPSERT, contactsRaw);

          if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS)
            await this.prismaRepository.contact.createMany({
              data: contactsRaw,
              skipDuplicates: true,
            });

          const usersContacts = contactsRaw.filter((c) => c.remoteJid.includes('@s.whatsapp'));
          if (usersContacts) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
          }
        }

        if (
          this.configService.get<Chatwoot>('CHATWOOT').ENABLED &&
          this.localChatwoot?.enabled &&
          this.localChatwoot.importContacts &&
          contactsRaw.length
        ) {
          this.chatwootService.addHistoryContacts(
            { instanceName: this.instance.name, instanceId: this.instance.id },
            contactsRaw,
          );
          chatwootImport.importHistoryContacts(
            { instanceName: this.instance.name, instanceId: this.instance.id },
            this.localChatwoot,
          );
        }

        const updatedContacts = await Promise.all(
          contacts.map(async (contact) => ({
            remoteJid: contact.id,
            pushName: contact?.name || contact?.verifiedName || contact.id.split('@')[0],
            profilePicUrl: (await this.profilePicture(contact.id)).profilePictureUrl,
            instanceId: this.instanceId,
          })),
        );

        if (updatedContacts.length > 0) {
          const usersContacts = updatedContacts.filter((c) => c.remoteJid.includes('@s.whatsapp'));
          if (usersContacts) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
          }

          this.sendDataWebhook(Events.CONTACTS_UPDATE, updatedContacts);
          await Promise.all(
            updatedContacts.map(async (contact) => {
              const update = this.prismaRepository.contact.updateMany({
                where: { remoteJid: contact.remoteJid, instanceId: this.instanceId },
                data: { profilePicUrl: contact.profilePicUrl },
              });

              if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
                const instance = { instanceName: this.instance.name, instanceId: this.instance.id };

                const findParticipant = await this.chatwootService.findContact(
                  instance,
                  contact.remoteJid.split('@')[0],
                );

                if (!findParticipant) {
                  return;
                }

                this.chatwootService.updateContact(instance, findParticipant.id, {
                  name: contact.pushName,
                  avatar_url: contact.profilePicUrl,
                });
              }

              return update;
            }),
          );
        }
      } catch (error) {
        console.error(error);
        this.logger.error(`Error: ${error.message}`);
      }
    },

    'contacts.update': async (contacts: Partial<Contact>[]) => {
      const contactsRaw: {
        remoteJid: string;
        pushName?: string;
        profilePicUrl?: string;
        instanceId: string;
      }[] = [];
      for await (const contact of contacts) {
        contactsRaw.push({
          remoteJid: contact.id,
          pushName: contact?.name ?? contact?.verifiedName,
          profilePicUrl: (await this.profilePicture(contact.id)).profilePictureUrl,
          instanceId: this.instanceId,
        });
      }

      this.sendDataWebhook(Events.CONTACTS_UPDATE, contactsRaw);

      const updateTransactions = contactsRaw.map((contact) =>
        this.prismaRepository.contact.upsert({
          where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
          create: contact,
          update: contact,
        }),
      );
      await this.prismaRepository.$transaction(updateTransactions);

      const usersContacts = contactsRaw.filter((c) => c.remoteJid.includes('@s.whatsapp'));
      if (usersContacts) {
        await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
      }
    },
  };

  // (Os outros handlers messageHandle, groupHandler, labelHandle seguem o mesmo padrão.)   private readonly messageHandle = {
    'messaging-history.set': async ({
      messages,
      chats,
      contacts,
      isLatest,
      progress,
      syncType,
    }: {
      chats: Chat[];
      contacts: Contact[];
      messages: proto.IWebMessageInfo[];
      isLatest?: boolean;
      progress?: number;
      syncType?: proto.HistorySync.HistorySyncType;
    }) => {
      try {
        // Implemente aqui sua lógica de restore de histórico, se necessário
      } catch (error) {
        this.logger.error(error);
      }
    },

    // (adicione aqui outros handlers como messages.upsert, messages.update, etc — mesmo padrão do seu projeto)
  };

  private readonly groupHandler = {
    'groups.upsert': (groupMetadata: GroupMetadata[]) => {
      this.sendDataWebhook(Events.GROUPS_UPSERT, groupMetadata);
    },

    'groups.update': (groupMetadataUpdate: Partial<GroupMetadata>[]) => {
      this.sendDataWebhook(Events.GROUPS_UPDATE, groupMetadataUpdate);

      groupMetadataUpdate.forEach((group) => {
        if (isJidGroup(group.id)) {
          this.updateGroupMetadataCache(group.id);
        }
      });
    },

    'group-participants.update': (participantsUpdate: {
      id: string;
      participants: string[];
      action: ParticipantAction;
    }) => {
      this.sendDataWebhook(Events.GROUP_PARTICIPANTS_UPDATE, participantsUpdate);
      this.updateGroupMetadataCache(participantsUpdate.id);
    },
  };

  private readonly labelHandle = {
    [Events.LABELS_EDIT]: async (label: Label) => {
      this.sendDataWebhook(Events.LABELS_EDIT, { ...label, instance: this.instance.name });

      const labelsRepository = await this.prismaRepository.label.findMany({
        where: { instanceId: this.instanceId },
      });

      const savedLabel = labelsRepository.find((l) => l.labelId === label.id);
      if (label.deleted && savedLabel) {
        await this.prismaRepository.label.delete({
          where: { labelId_instanceId: { instanceId: this.instanceId, labelId: label.id } },
        });
        this.sendDataWebhook(Events.LABELS_EDIT, { ...label, instance: this.instance.name });
        return;
      }

      const labelName = label.name.replace(/[^\x20-\x7E]/g, '');
      if (!savedLabel || savedLabel.color !== `${label.color}` || savedLabel.name !== labelName) {
        if (this.configService.get<Database>('DATABASE').SAVE_DATA.LABELS) {
          const labelData = {
            color: `${label.color}`,
            name: labelName,
            labelId: label.id,
            predefinedId: label.predefinedId,
            instanceId: this.instanceId,
          };
          await this.prismaRepository.label.upsert({
            where: {
              labelId_instanceId: {
                instanceId: labelData.instanceId,
                labelId: labelData.labelId,
              },
            },
            update: labelData,
            create: labelData,
          });
        }
      }
    },

    [Events.LABELS_ASSOCIATION]: async (
      data: { association: LabelAssociation; type: 'remove' | 'add' },
      database: Database,
    ) => {
      this.logger.info(
        `labels association - ${data?.association?.chatId} (${data.type}-${data?.association?.type}): ${data?.association?.labelId}`,
      );
      if (database.SAVE_DATA.CHATS) {
        const instanceId = this.instanceId;
        const chatId = data.association.chatId;
        const labelId = data.association.labelId;

        if (data.type === 'add') {
          await this.addLabel(labelId, instanceId, chatId);
        } else if (data.type === 'remove') {
          await this.removeLabel(labelId, instanceId, chatId);
        }
      }

      this.sendDataWebhook(Events.LABELS_ASSOCIATION, {
        instance: this.instance.name,
        type: data.type,
        chatId: data.association.chatId,
        labelId: data.association.labelId,
      });
    },
  };   private eventHandler() {
    this.client.ev.process(async (events) => {
      if (!this.endSession) {
        const database = this.configService.get<Database>('DATABASE');
        const settings = await this.findSettings();

        if (events.call) {
          const call = events.call[0];

          if (settings?.rejectCall && call.status == 'offer') {
            this.client.rejectCall(call.id, call.from);
          }
          if (settings?.msgCall?.trim().length > 0 && call.status == 'offer') {
            const msg = await this.client.sendMessage(call.from, {
              text: settings.msgCall,
            });

            this.client.ev.emit('messages.upsert', {
              messages: [msg],
              type: 'notify',
            });
          }
          this.sendDataWebhook(Events.CALL, call);
        }

        if (events['connection.update']) {
          this.connectionUpdate(events['connection.update']);
        }

        if (events['creds.update']) {
          this.instance.authState.saveCreds();
        }

        if (events['messaging-history.set']) {
          const payload = events['messaging-history.set'];
          this.messageHandle['messaging-history.set'](payload);
        }

        if (events['messages.upsert']) {
          const payload = events['messages.upsert'];
          this.messageHandle['messages.upsert'](payload, settings);
        }

        if (events['messages.update']) {
          const payload = events['messages.update'];
          this.messageHandle['messages.update'](payload, settings);
        }

        if (events['message-receipt.update']) {
          const payload = events['message-receipt.update'] as MessageUserReceiptUpdate[];
          const remotesJidMap: Record<string, number> = {};
          for (const event of payload) {
            if (typeof event.key.remoteJid === 'string' && typeof event.receipt.readTimestamp === 'number') {
              remotesJidMap[event.key.remoteJid] = event.receipt.readTimestamp;
            }
          }
          await Promise.all(
            Object.keys(remotesJidMap).map(async (remoteJid) =>
              this.updateMessagesReadedByTimestamp(remoteJid, remotesJidMap[remoteJid]),
            ),
          );
        }

        if (events['presence.update']) {
          const payload = events['presence.update'];
          if (settings?.groupsIgnore && payload.id.includes('@g.us')) {
            return;
          }
          this.sendDataWebhook(Events.PRESENCE_UPDATE, payload);
        }

        if (!settings?.groupsIgnore) {
          if (events['groups.upsert']) {
            const payload = events['groups.upsert'];
            this.groupHandler['groups.upsert'](payload);
          }
          if (events['groups.update']) {
            const payload = events['groups.update'];
            this.groupHandler['groups.update'](payload);
          }
          if (events['group-participants.update']) {
            const payload = events['group-participants.update'];
            this.groupHandler['group-participants.update'](payload);
          }
        }

        if (events['chats.upsert']) {
          const payload = events['chats.upsert'];
          this.chatHandle['chats.upsert'](payload);
        }

        if (events['chats.update']) {
          const payload = events['chats.update'];
          this.chatHandle['chats.update'](payload);
        }
        if (events['chats.delete']) {
          const payload = events['chats.delete'];
          this.chatHandle['chats.delete'](payload);
        }

        if (events['contacts.upsert']) {
          const payload = events['contacts.upsert'];
          this.contactHandle['contacts.upsert'](payload);
        }
        if (events['contacts.update']) {
          const payload = events['contacts.update'];
          this.contactHandle['contacts.update'](payload);
        }

        if (events[Events.LABELS_ASSOCIATION]) {
          const payload = events[Events.LABELS_ASSOCIATION];
          this.labelHandle[Events.LABELS_ASSOCIATION](payload, database);
          return;
        }
        if (events[Events.LABELS_EDIT]) {
          const payload = events[Events.LABELS_EDIT];
          this.labelHandle[Events.LABELS_EDIT](payload);
          return;
        }
      }
    });
  }

  private historySyncNotification(msg: proto.Message.IHistorySyncNotification) {
    const instance: InstanceDto = { instanceName: this.instance.name };
    if (
      this.configService.get<Chatwoot>('CHATWOOT').ENABLED &&
      this.localChatwoot?.enabled &&
      this.localChatwoot.importMessages &&
      this.isSyncNotificationFromUsedSyncType(msg)
    ) {
      if (msg.chunkOrder === 1) {
        this.chatwootService.startImportHistoryMessages(instance);
      }
      if (msg.progress === 100) {
        setTimeout(() => {
          this.chatwootService.importHistoryMessages(instance);
        }, 10000);
      }
    }
    return true;
  }

  private isSyncNotificationFromUsedSyncType(msg: proto.Message.IHistorySyncNotification) {
    return (
      (this.localSettings.syncFullHistory && msg?.syncType === 2) ||
      (!this.localSettings.syncFullHistory && msg?.syncType === 3)
    );
  }

  public async profilePicture(number: string) {
    const jid = createJid(number);

    try {
      const profilePictureUrl = await this.client.profilePictureUrl(jid, 'image');
      return { wuid: jid, profilePictureUrl };
    } catch (error) {
      return { wuid: jid, profilePictureUrl: null };
    }
  }

  public async getStatus(number: string) {
    const jid = createJid(number);
    try {
      return { wuid: jid, status: (await this.client.fetchStatus(jid))[0]?.status };
    } catch (error) {
      return { wuid: jid, status: null };
    }
  }

  public async fetchProfile(instanceName: string, number?: string) {
    const jid = number ? createJid(number) : this.client?.user?.id;

    const onWhatsapp = (await this.whatsappNumber({ numbers: [jid] }))?.shift();

    if (!onWhatsapp.exists) {
      throw new BadRequestException(onWhatsapp);
    }

    try {
      if (number) {
        const info = (await this.whatsappNumber({ numbers: [jid] }))?.shift();
        const picture = await this.profilePicture(info?.jid);
        const status = await this.getStatus(info?.jid);
        const business = await this.fetchBusinessProfile(info?.jid);

        return {
          wuid: info?.jid || jid,
          name: info?.name,
          numberExists: info?.exists,
          picture: picture?.profilePictureUrl,
          status: status?.status,
          isBusiness: business.isBusiness,
          email: business?.email,
          description: business?.description,
          website: business?.website?.shift(),
        };
      } else {
        const instanceNames = instanceName ? [instanceName] : null;
        const info: Instance = await waMonitor.instanceInfo(instanceNames);
        const business = await this.fetchBusinessProfile(jid);

        return {
          wuid: jid,
          name: info?.profileName,
          numberExists: true,
          picture: info?.profilePicUrl,
          status: info?.connectionStatus,
          isBusiness: business.isBusiness,
          email: business?.email,
          description: business?.description,
          website: business?.website?.shift(),
        };
      }
    } catch (error) {
      return {
        wuid: jid,
        name: null,
        picture: null,
        status: null,
        os: null,
        isBusiness: false,
      };
    }
  }

  public async offerCall({ number, isVideo, callDuration }: OfferCallDto) {
    const jid = createJid(number);
    try {
      const call = await this.client.offerCall(jid, isVideo);
      setTimeout(() => this.client.terminateCall(call.id, call.to), callDuration * 1000);
      return call;
    } catch (error) {
      return error;
    }
  }

  public async templateMessage() {
    throw new Error('Method not available in the Baileys service');
  }

  private async updateChatUnreadMessages(remoteJid: string): Promise<number> {
    const [chat, unreadMessages] = await Promise.all([
      this.prismaRepository.chat.findFirst({ where: { remoteJid } }),
      this.prismaRepository.message.count({
        where: {
          AND: [
            { key: { path: ['remoteJid'], equals: remoteJid } },
            { key: { path: ['fromMe'], equals: false } },
            { status: { equals: status[3] } },
          ],
        },
      }),
    ]);

    if (chat && chat.unreadMessages !== unreadMessages) {
      await this.prismaRepository.chat.update({
        where: { id: chat.id },
        data: { unreadMessages },
      });
    }
    return unreadMessages;
  }

  private async addLabel(labelId: string, instanceId: string, chatId: string) {
    const id = cuid();
    await this.prismaRepository.$executeRawUnsafe(
      `INSERT INTO "Chat" ("id", "instanceId", "remoteJid", "labels", "createdAt", "updatedAt")
       VALUES ($4, $2, $3, to_jsonb(ARRAY[$1]::text[]), NOW(), NOW()) ON CONFLICT ("instanceId", "remoteJid")
     DO
      UPDATE
          SET "labels" = (
          SELECT to_jsonb(array_agg(DISTINCT elem))
          FROM (
          SELECT jsonb_array_elements_text("Chat"."labels") AS elem
          UNION
          SELECT $1::text AS elem
          ) sub
          ),
          "updatedAt" = NOW();`,
      labelId,
      instanceId,
      chatId,
      id,
    );
  }

  private async removeLabel(labelId: string, instanceId: string, chatId: string) {
    const id = cuid();
    await this.prismaRepository.$executeRawUnsafe(
      `INSERT INTO "Chat" ("id", "instanceId", "remoteJid", "labels", "createdAt", "updatedAt")
       VALUES ($4, $2, $3, '[]'::jsonb, NOW(), NOW()) ON CONFLICT ("instanceId", "remoteJid")
     DO
      UPDATE
          SET "labels" = COALESCE (
          (
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements_text("Chat"."labels") AS elem
          WHERE elem <> $1
          ),
          '[]'::jsonb
          ),
          "updatedAt" = NOW();`,
      labelId,
      instanceId,
      chatId,
      id,
    );
  }

  // ===== Helpers do baileys =====
  public async baileysOnWhatsapp(jid: string) {
    const response = await this.client.onWhatsApp(jid);
    return response;
  }
  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview', timeoutMs: number) {
    const response = await this.client.profilePictureUrl(jid, type, timeoutMs);
    return response;
  }
  public async baileysAssertSessions(jids: string[], force: boolean) {
    const response = await this.client.assertSessions(jids, force);
    return response;
  }
  public async baileysCreateParticipantNodes(jids: string[], message: proto.IMessage, extraAttrs: any) {
    const response = await this.client.createParticipantNodes(jids, message, extraAttrs);
    const convertedResponse = {
      ...response,
      nodes: response.nodes.map((node: any) => ({
        ...node,
        content: node.content?.map((c: any) => ({
          ...c,
          content: c.content instanceof Uint8Array ? Buffer.from(c.content).toString('base64') : c.content,
        })),
      })),
    };
    return convertedResponse;
  }
  public async baileysSendNode(stanza: any) {
    console.log('stanza', JSON.stringify(stanza));
    const response = await this.client.sendNode(stanza);
    return response;
  }
  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean) {
    const response = await this.client.getUSyncDevices(jids, useCache, ignoreZeroDevices);
    return response;
  }
  public async baileysGenerateMessageTag() {
    const response = await this.client.generateMessageTag();
    return response;
  }
  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: string) {
    try {
      const ciphertextBuffer = Buffer.from(ciphertext, 'base64');
      const response = await this.client.signalRepository.decryptMessage({
        jid,
        type,
        ciphertext: ciphertextBuffer,
      });
      return response instanceof Uint8Array ? Buffer.from(response).toString('base64') : response;
    } catch (error) {
      this.logger.error('Error decrypting message:');
      this.logger.error(error);
      throw error;
    }
  }
  public async baileysGetAuthState() {
    const response = {
      me: this.client.authState.creds.me,
      account: this.client.authState.creds.account,
    };
    return response;
  }
} // <------ ESTA chave fecha a classe, não coloque métodos depois dela! 
