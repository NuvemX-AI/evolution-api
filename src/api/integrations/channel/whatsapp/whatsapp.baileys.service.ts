// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções v6: Integrando contexto de channel.service.ts, env.config.ts, wa.types.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs';
import { rmSync } from 'fs';
import * as path from 'path';
import { release } from 'os';

// --- Third-party Imports ---
import makeWASocket, {
  AuthenticationCreds,
  AuthenticationState,
  BaileysEventEmitter,
  Browsers,
  BufferJSON,
  Chat, // Import Chat type
  ConnectionState,
  Contact,
  createSignalIdentity, // Missing import? Add if needed for AuthStateProvider
  decodeMessageStanza, // Missing import? Add if needed
  DisconnectReason,
  downloadMediaMessage,
  encodeMessageStanza, // Missing import? Add if needed
  extractMessageContent,
  fetchLatestBaileysVersion,
  generateWAMessage, // Missing import? Add if needed
  generateWAMessageContent, // Missing import? Add if needed
  generateWAMessageFromContent,
  getBinaryNodeChild, // Missing import? Add if needed
  getBinaryNodeChildren, // Missing import? Add if needed
  getContentType,
  getDevice,
  GroupMetadata,
  GroupSettingChange, // Renamed from GroupSettingUpdate in Baileys
  initAuthCreds, // Import initAuthCreds
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidUser,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  // makeInMemoryStore, // Likely not needed if using Prisma/Redis
  MessageRetryMap, // Missing import? Add if needed for retry cache
  MessageUpsertType,
  MessageUserReceiptUpdate,
  MiscMessageGenerationOptions,
  ParticipantAction,
  prepareWAMessageMedia, // Missing import? Add if needed for media sending
  proto,
  relayMessage, // Missing import? Add if needed
  SignalKeyStore, // Missing import? Add if needed for AuthStateProvider
  SocketConfig, // General socket config type
  Stanza, // Missing import? Add if needed
  useMultiFileAuthState, // Default file-based auth state
  UserFacingSocketConfig,
  // WABrowserDescription, // Type alias included in Baileys types
  WAConnectionState, // Specific connection state enum
  WAMessageKey,
  WAMessageStubType,
  WASocket,
  delay,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import P, { Logger as PinoLogger } from 'pino'; // Import Pino logger type
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { v4 as cuid } from 'uuid';
import EventEmitter2 from 'eventemitter2';
import axios from 'axios'; // Import axios

// --- Project Imports ---
// DTOs
import { OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto, ProfilePictureUrlDto } from '@api/dto/instance.dto';
import {
  SendTextDto, SendMediaDto, SendButtonsDto, SendListDto, SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto, BaseSendMessageDto, SendMessageOptions, SendMediaUrlDto
} from '@api/dto/sendMessage.dto';
import {
  CreateGroupDto, UpdateGroupPictureDto, UpdateSubjectDto as UpdateGroupSubjectDto, UpdateDescriptionDto as UpdateGroupDescriptionDto, SendInviteDto,
  UpdateParticipantsDto, UpdateSettingDto as GroupUpdateSettingDto, UpdateEphemeralDto as GroupToggleEphemeralDto, HandleLabelDto, GroupJidDto, InviteCodeDto
} from '@api/dto/group.dto';
import { ChatwootDto } from '@integrations/chatbot/chatwoot/dto/chatwoot.dto'; // Chatwoot DTO
import { SettingsDto } from '@api/dto/settings.dto'; // Settings DTO
import { ProxyDto } from '@api/dto/proxy.dto'; // Proxy DTO

// Services, Repositories, Config, etc.
import { ChannelStartupService } from '@api/services/channel.service';
import { ConfigService } from '@config/config.service';
import { PrismaRepository, Query } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service'; // General Cache Service
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { ProviderFiles } from '@provider/sessions'; // Assumes this path is correct
import { Logger } from '@config/logger.config'; // Project's Logger type (likely Pino wrapper)
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';

// Types (Importing from wa.types.ts)
import { Events, wa } from '@api/types/wa.types'; // Using types defined in wa.types.ts

// Config Types (Importing from env.config.ts)
import { Database as DatabaseConfig, CacheConf, ProviderSession, ConfigSessionPhone, QrCode as QrCodeConfig, Chatwoot as ChatwootConfig, Env as EnvironmentConfig } from '@config/env.config';

// Auth Utils
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files'; // Provider-based auth
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db'; // Redis-based auth
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma'; // Prisma-based auth
import { createJid } from '@utils/createJid';
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache'; // Assuming these exist and work
import { makeProxyAgent } from '@utils/makeProxyAgent';
// import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys'; // Descomentar se usar

// Prisma Client
import { Prisma, Label, LabelAssociation, MessageUpdate, Contact as PrismaContact, Chat as PrismaChat } from '@prisma/client';

// Constants
const INSTANCE_DIR = path.join(process.cwd(), 'instances'); // Define INSTANCE_DIR consistently

// Define a type for the auth state methods object expected by Baileys
type AuthStateMethods = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; };


// Placeholder/Mock (Remove if real implementation exists)
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> { console.warn('getVideoDuration mock called'); return 0; }
// const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } }; // Placeholder removed, use ChatwootService

export class BaileysStartupService extends ChannelStartupService {
  // --- Inherited Properties (from ChannelStartupService) ---
  // protected readonly logger: Logger;
  // public readonly instance: Partial<InstanceDto & { wuid?: string, profileName?: string, profilePictureUrl?: string }>;
  // public readonly localChatwoot: Partial<wa.LocalChatwoot>; // Using type from wa.types
  // public readonly localProxy: Partial<wa.LocalProxy>; // Using type from wa.types
  // public readonly localSettings: Partial<wa.LocalSettings>; // Using type from wa.types
  // public readonly localWebhook: Partial<wa.LocalWebHook>; // Using type from wa.types
  // public chatwootService: ChatwootService;
  // public typebotService: TypebotService;
  // ... other chatbot services

  // --- Baileys Specific Properties ---
  public client: WASocket | null = null; // Baileys client instance
  public phoneNumber: string | null = null; // Phone number associated (if pairing)

  // Caches specific to Baileys (if needed beyond general cacheService)
  private readonly msgRetryCounterCache: NodeCache;
  private readonly userDevicesCache: NodeCache; // Cache for user devices

  // Internal state flags
  private endSession = false;

  // Configuration shortcuts
  protected logBaileysLevel: P.LevelWithSilent = 'silent'; // Log level for Baileys library

  // Constructor
  constructor(
    // Dependencies injected via super() or directly assigned
    configService: ConfigService,
    eventEmitter: EventEmitter2,
    prismaRepository: PrismaRepository,
    cacheService: CacheService, // General cache service
    waMonitor: WAMonitoringService,
    baseLogger: Logger,
    chatwootService: ChatwootService, // Chatwoot service
    instanceDto: InstanceDto, // Instance specific data
    private readonly providerFiles?: ProviderFiles, // Optional file provider for sessions
  ) {
    // Call base class constructor
    super(
      configService,
      eventEmitter,
      prismaRepository,
      cacheService, // Pass general cache service
      waMonitor,
      baseLogger,
      chatwootService // Pass Chatwoot service
    );

    // Set instance data received from controller/manager
    this.setInstance(instanceDto); // Initialize inherited 'instance' property

    // Initialize Baileys specific properties
    this.msgRetryCounterCache = new NodeCache();
    this.userDevicesCache = new NodeCache();

    // Set Baileys log level from config
    this.logBaileysLevel = this.configService.get<EnvironmentConfig>('LOG')?.BAILEYS ?? 'silent';

    // Initialize instance qrcode property if not already set
    if (!this.instance.qrcode) {
        this.instance.qrcode = { count: 0, code: undefined, base64: undefined, pairingCode: undefined };
    }

    this.logger.info(`BaileysStartupService initialized for instance: ${this.instanceName}`);
  }

  // --- Overridden/Implemented Abstract Methods ---

  /**
   * Connects to WhatsApp using Baileys.
   * Creates the Baileys client and sets up event listeners.
   */
  async connectToWhatsapp(data?: { number?: string | null }): Promise<WASocket | null> {
    this.logger.info(`Attempting to connect instance ${this.instanceName} to WhatsApp...`);

    // Check current connection status from base class property
    const currentStatus = this.getStatus().connection; // Use base class method/property if available
    if (currentStatus === 'open') {
      this.logger.warn(`Instance ${this.instanceName} is already open.`);
      return this.client;
    }
    if (currentStatus === 'connecting') {
      this.logger.warn(`Instance ${this.instanceName} is already connecting.`);
      // Decide whether to wait or return null/existing client
      return null;
    }

    try {
      // Load necessary configurations before creating the client
      await this.loadLocalSettings(); // Use renamed method
      await this.loadChatwoot();
      await this.loadWebhook();
      await this.loadProxy();
      this.logger.info(`Configurations loaded for ${this.instanceName}. Creating Baileys client...`);

      // Store phone number if provided (for pairing code)
      this.phoneNumber = data?.number ?? null;

      // Create the Baileys client instance
      this.client = await this.createClient(this.phoneNumber);
      this.logger.info(`Baileys client created successfully for ${this.instanceName}.`);
      return this.client;

    } catch (error: any) {
      this.logger.error({ err: error }, `Failed to connect instance ${this.instanceName}`);
      await this.logoutInstance(true); // Attempt cleanup on critical connection failure
      // Update connection status in base class/monitoring
      this.updateConnectionState('close', DisconnectReason.connectionClosed); // Example status update
      // Rethrow or handle specific exceptions
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException(`Failed to connect to WhatsApp: ${error.message}`);
    }
  }

  /**
   * Logs out the instance and cleans up resources.
   */
  async logoutInstance(destroyClient = false): Promise<void> {
    this.logger.warn(`Logging out instance ${this.instanceName}. Destroy client: ${destroyClient}`);
    this.endSession = true; // Signal to prevent reconnection attempts

    // Close WebSocket connection
    try {
      this.client?.ws?.close();
    } catch (e) {
      this.logger.error({ err: e }, `Error closing WebSocket for ${this.instanceName}`);
    }

    // End Baileys client gracefully
    try {
      await this.client?.logout(`Logging out instance: ${this.instanceName}`);
    } catch (e) {
      this.logger.error({ err: e }, `Error logging out Baileys client for ${this.instanceName}`);
    }

    // Update connection status
    this.updateConnectionState('close', DisconnectReason.loggedOut);

    // Clear authentication state (using defined method)
    try {
      const authStateMethods = await this.defineAuthState();
      await authStateMethods.clearState();
      this.logger.info(`Authentication state cleared for ${this.instanceName}.`);
    } catch (e) {
      this.logger.error({ err: e }, `Error clearing auth state for ${this.instanceName}`);
    }

    // Remove instance data from Prisma DB if requested (and configured)
    const shouldDelete = this.configService.get<boolean | number>('DEL_INSTANCE'); // Check config
    if (destroyClient && shouldDelete) {
      this.logger.warn(`Deleting instance data from database for ${this.instanceName} as requested.`);
      try {
        await this.prismaRepository.instance.delete({ where: { instanceId: this.instanceId } });
        // Optionally delete related data (settings, webhooks, etc.)
      } catch (dbError) {
        this.logger.error({ err: dbError }, `Error deleting instance data from DB for ${this.instanceName}`);
      }
    }

    // Remove from monitoring service
    await this.waMonitor.deleteAccount(this.instanceName);

    // Reset client property
    this.client = null;
  }

  /**
   * Gets the current connection status.
   */
  getStatus(): ConnectionState {
    // Return the state managed by the Baileys client or the base class
    return {
        connection: this.client?.ws?.readyState === 1 ? 'open' : 'close', // Example mapping
        lastDisconnect: this.connectionState?.lastDisconnect, // Use state from base class
        qr: this.instance.qrcode?.code, // Get QR from instance property
        isNewLogin: this.isNewLogin ?? false, // Use state from base class
        receivedPendingNotifications: this.receivedPendingNotifications ?? false, // Use state from base class
    };
  }


  // --- Message Sending Methods (Implement using Baileys client) ---

  async textMessage(data: SendTextDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const jid = createJid(data.number);
    this.logger.debug(`Sending text message to ${jid} for instance ${this.instanceName}`);
    try {
      return await this.client.sendMessage(jid, { text: data.options.text }, options);
    } catch (error: any) {
      this.logger.error({ err: error, jid }, `Error sending text message to ${jid}`);
      throw new InternalServerErrorException(`Failed to send text message: ${error.message}`);
    }
  }

  async mediaMessage(data: SendMediaDto | SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const jid = createJid(data.number);
    this.logger.debug(`Sending media message to ${jid} (type: ${data.media.mediatype}) for instance ${this.instanceName}`);

    const messageOptions: any = {
      caption: data.options?.caption,
      ptt: data.media.mediatype === 'audio' ? data.options?.isPtt : undefined,
      mimetype: data.options?.mimetype,
      fileName: data.options?.filename,
      gifPlayback: data.media.mediatype === 'video' ? data.options?.isGif : undefined,
    };

    let media: Buffer | { url: string };
    if ('url' in data.media) {
      media = { url: data.media.url };
    } else if ('base64' in data.media) {
      media = Buffer.from(data.media.base64, 'base64');
    } else {
      throw new BadRequestException('Media data missing (url or base64 required)');
    }

    try {
      // Dynamically set the key based on mediatype
      messageOptions[data.media.mediatype] = media; // e.g., messageOptions.image = media

      return await this.client.sendMessage(jid, messageOptions, options);
    } catch (error: any) {
      this.logger.error({ err: error, jid }, `Error sending media message to ${jid}`);
      throw new InternalServerErrorException(`Failed to send media message: ${error.message}`);
    }
  }

  async buttonMessage(data: SendButtonsDto | SendListDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     const jid = createJid(data.number);
     this.logger.debug(`Sending button/list message to ${jid} for instance ${this.instanceName}`);

     let messageContent: any;
     if ('buttons' in data.options) { // SendButtonsDto
         messageContent = {
             text: data.options.text,
             footer: data.options.footer,
             buttons: data.options.buttons, // Assuming format is [{ buttonId, buttonText, type }]
             headerType: data.options.isDynamicReplyButtons ? 4 : 1, // Example logic, adjust as needed
             // Add image/video/document if needed for header
         };
         if (data.options.image) messageContent.image = { url: data.options.image.url };
         // ... handle other media headers ...
     } else { // SendListDto
         messageContent = {
             text: data.options.text,
             footer: data.options.footer,
             title: data.options.title,
             buttonText: data.options.buttonText,
             sections: data.options.sections, // Assuming format is [{ title, rows: [{ title, rowId, description }] }]
         };
     }

     try {
         // Baileys v6 uses generateWAMessageFromContent
         const prepMsg = await generateWAMessageFromContent(jid, messageContent, { userJid: this.client.user!.id, ...options });
         return await this.client.relayMessage(jid, prepMsg.message!, { messageId: prepMsg.key.id! });
     } catch (error: any) {
         this.logger.error({ err: error, jid }, `Error sending button/list message to ${jid}`);
         throw new InternalServerErrorException(`Failed to send button/list message: ${error.message}`);
     }
  }

  async contactMessage(data: SendContactDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     const jid = createJid(data.number);
     this.logger.debug(`Sending contact message to ${jid} for instance ${this.instanceName}`);

     const contacts = Array.isArray(data.options.contacts) ? data.options.contacts : [data.options.contacts];
     const contactArray = contacts.map(contact => ({
         displayName: contact.fullName,
         vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.fullName}\nORG:${contact.organization || ''}\nTEL;type=CELL;type=VOICE;waid=${contact.wuid}:${contact.wuid}\nEND:VCARD`
     }));

     try {
         return await this.client.sendMessage(jid, { contacts: { displayName: `${contactArray.length} Contacts`, contacts: contactArray } }, options);
     } catch (error: any) {
         this.logger.error({ err: error, jid }, `Error sending contact message to ${jid}`);
         throw new InternalServerErrorException(`Failed to send contact message: ${error.message}`);
     }
  }

  async locationMessage(data: SendLocationDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     const jid = createJid(data.number);
     this.logger.debug(`Sending location message to ${jid} for instance ${this.instanceName}`);
     try {
         return await this.client.sendMessage(
             jid,
             {
                 location: {
                     degreesLatitude: data.options.latitude,
                     degreesLongitude: data.options.longitude,
                     name: data.options.name,
                     address: data.options.address
                 }
             },
             options
         );
     } catch (error: any) {
         this.logger.error({ err: error, jid }, `Error sending location message to ${jid}`);
         throw new InternalServerErrorException(`Failed to send location message: ${error.message}`);
     }
  }

  async reactionMessage(data: SendReactionDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     const jid = createJid(data.number);
     this.logger.debug(`Sending reaction "${data.options.reaction}" to message ${data.options.messageId} in chat ${jid}`);
     try {
         return await this.client.sendMessage(jid, {
             react: {
                 text: data.options.reaction,
                 key: {
                     remoteJid: jid,
                     id: data.options.messageId,
                     fromMe: data.options.fromMe, // Need to determine if reacting to own message
                     participant: data.options.participant, // Optional: if reacting in a group
                 }
             }
         }, options);
     } catch (error: any) {
         this.logger.error({ err: error, jid }, `Error sending reaction message`);
         throw new InternalServerErrorException(`Failed to send reaction: ${error.message}`);
     }
  }

  // Template message might require WhatsApp Business API or specific Baileys implementation
  async templateMessage(data: SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
    // Baileys support for templates is limited/complex, often requires generating protobuf directly
    this.logger.warn(`Sending template messages via Baileys is complex/unstable and might not work as expected.`);
    // Placeholder - actual implementation depends heavily on template type (HSM, interactive, etc.)
    throw new Error("Template message sending not fully implemented for Baileys channel.");
  }


  // --- Group Methods (Implement using Baileys client) ---
  // Note: Removed 'override' as these are likely not in the abstract base class

  async createGroup(data: CreateGroupDto): Promise<GroupMetadata | any> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     this.logger.info(`Creating group "${data.subject}" with participants: ${data.participants.join(', ')}`);
     try {
         const participantsJids = data.participants.map(p => createJid(p));
         return await this.client.groupCreate(data.subject, participantsJids);
     } catch (error: any) {
         this.logger.error({ err: error }, `Error creating group "${data.subject}"`);
         throw new InternalServerErrorException(`Failed to create group: ${error.message}`);
     }
  }

  async updateGroupSubject(data: UpdateGroupSubjectDto): Promise<void> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     const groupJid = createJid(data.groupJid);
     this.logger.info(`Updating subject for group ${groupJid} to "${data.subject}"`);
     try {
         await this.client.groupUpdateSubject(groupJid, data.subject);
     } catch (error: any) {
         this.logger.error({ err: error, groupJid }, `Error updating subject for group ${groupJid}`);
         throw new InternalServerErrorException(`Failed to update group subject: ${error.message}`);
     }
  }

  async updateGroupDescription(data: UpdateGroupDescriptionDto): Promise<void> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const groupJid = createJid(data.groupJid);
    this.logger.info(`Updating description for group ${groupJid}`);
    try {
        await this.client.groupUpdateDescription(groupJid, data.description);
    } catch (error: any) {
        this.logger.error({ err: error, groupJid }, `Error updating description for group ${groupJid}`);
        throw new InternalServerErrorException(`Failed to update group description: ${error.message}`);
    }
  }

  async updateGroupPicture(data: UpdateGroupPictureDto): Promise<void> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const groupJid = createJid(data.groupJid);
    this.logger.info(`Updating picture for group ${groupJid}`);
    try {
        let imageBuffer: Buffer;
        if ('url' in data.media) {
            const response = await axios.get(data.media.url, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
        } else {
            imageBuffer = Buffer.from(data.media.base64, 'base64');
        }
        await this.client.updateProfilePicture(groupJid, imageBuffer);
    } catch (error: any) {
        this.logger.error({ err: error, groupJid }, `Error updating picture for group ${groupJid}`);
        throw new InternalServerErrorException(`Failed to update group picture: ${error.message}`);
    }
  }

  async findGroup(groupJid: string): Promise<GroupMetadata> {
     if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
     const jid = createJid(groupJid);
     this.logger.debug(`Workspaceing metadata for group ${jid}`);
     try {
         // Consider adding caching here using groupMetadataCache from original attempt
         const metadata = await this.client.groupMetadata(jid);
         if (!metadata) throw new NotFoundException(`Group ${jid} not found.`);
         return metadata;
     } catch (error: any) {
         this.logger.error({ err: error, jid }, `Error fetching metadata for group ${jid}`);
         if (error instanceof NotFoundException) throw error;
         throw new InternalServerErrorException(`Failed to fetch group metadata: ${error.message}`);
     }
  }

  async fetchAllGroups(getPaticipants = false): Promise<{ [key: string]: GroupMetadata }> {
      if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
      this.logger.debug(`Workspaceing all group metadatas for instance ${this.instanceName}`);
      try {
          // Note: groupFetchAllParticipating is often heavy. Use with caution.
          const groups = await this.client.groupFetchAllParticipating();
          // If getParticipants is true, the result already contains participants.
          // If false, you might need to iterate and call groupMetadata for each ID if needed,
          // but the method name implies fetching all, so returning the result directly seems appropriate.
          return groups;
      } catch (error: any) {
          this.logger.error({ err: error }, `Error fetching all groups`);
          throw new InternalServerErrorException(`Failed to fetch all groups: ${error.message}`);
      }
  }

  async inviteCode(groupJid: string): Promise<string> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const jid = createJid(groupJid);
    this.logger.info(`Getting invite code for group ${jid}`);
    try {
        const code = await this.client.groupInviteCode(jid);
        if (!code) throw new InternalServerErrorException(`Could not get invite code for group ${jid}.`);
        return code;
    } catch (error: any) {
        this.logger.error({ err: error, jid }, `Error getting invite code for group ${jid}`);
        throw new InternalServerErrorException(`Failed to get group invite code: ${error.message}`);
    }
  }

  async revokeInviteCode(groupJid: string): Promise<string> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const jid = createJid(groupJid);
    this.logger.info(`Revoking invite code for group ${jid}`);
    try {
        const code = await this.client.groupRevokeInvite(jid);
        if (!code) throw new InternalServerErrorException(`Could not revoke invite code for group ${jid}.`);
        return code;
    } catch (error: any) {
        this.logger.error({ err: error, jid }, `Error revoking invite code for group ${jid}`);
        throw new InternalServerErrorException(`Failed to revoke group invite code: ${error.message}`);
    }
  }

  async acceptInviteCode(inviteCode: string): Promise<string | undefined> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    this.logger.info(`Accepting invite code ${inviteCode}`);
    try {
        const groupJid = await this.client.groupAcceptInvite(inviteCode);
        return groupJid;
    } catch (error: any) {
        this.logger.error({ err: error, inviteCode }, `Error accepting invite code ${inviteCode}`);
        throw new InternalServerErrorException(`Failed to accept invite code: ${error.message}`);
    }
  }

  async findParticipants(groupJid: string): Promise<any> { // Return type depends on what you need
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const jid = createJid(groupJid);
    this.logger.debug(`Finding participants for group ${jid}`);
    try {
        const metadata = await this.client.groupMetadata(jid);
        return metadata?.participants ?? []; // Return only participants array
    } catch (error: any) {
        this.logger.error({ err: error, jid }, `Error finding participants for group ${jid}`);
        throw new InternalServerErrorException(`Failed to find group participants: ${error.message}`);
    }
  }

  async updateGParticipant(data: UpdateParticipantsDto): Promise<any> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const groupJid = createJid(data.groupJid);
    const participantsJids = data.participants.map(p => createJid(p));
    this.logger.info(`Updating participants for group ${groupJid}. Action: ${data.action}`);
    try {
        return await this.client.groupParticipantsUpdate(groupJid, participantsJids, data.action);
    } catch (error: any) {
        this.logger.error({ err: error, groupJid, action: data.action }, `Error updating participants for group ${groupJid}`);
        throw new InternalServerErrorException(`Failed to update group participants: ${error.message}`);
    }
  }

  async updateGSetting(data: GroupUpdateSettingDto): Promise<void> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const groupJid = createJid(data.groupJid);
    this.logger.info(`Updating setting "${data.setting}" for group ${groupJid}`);
    try {
        await this.client.groupSettingUpdate(groupJid, data.setting);
    } catch (error: any) {
        this.logger.error({ err: error, groupJid, setting: data.setting }, `Error updating setting for group ${groupJid}`);
        throw new InternalServerErrorException(`Failed to update group setting: ${error.message}`);
    }
  }

  async toggleEphemeral(data: GroupToggleEphemeralDto): Promise<void> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const groupJid = createJid(data.groupJid);
    this.logger.info(`Toggling ephemeral messages for group ${groupJid}. Duration: ${data.duration}`);
    try {
        await this.client.groupToggleEphemeral(groupJid, data.duration);
    } catch (error: any) {
        this.logger.error({ err: error, groupJid }, `Error toggling ephemeral messages for group ${groupJid}`);
        throw new InternalServerErrorException(`Failed to toggle ephemeral messages: ${error.message}`);
    }
  }

  async leaveGroup(groupJid: string): Promise<void> {
    if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
    const jid = createJid(groupJid);
    this.logger.info(`Leaving group ${jid}`);
    try {
        await this.client.groupLeave(jid);
    } catch (error: any) {
        this.logger.error({ err: error, jid }, `Error leaving group ${jid}`);
        throw new InternalServerErrorException(`Failed to leave group: ${error.message}`);
    }
  }

  // --- Other Baileys Specific Methods ---

  async profilePicture(jid: string): Promise<{ profilePictureUrl: string | null }> {
     const jidNormalized = createJid(jid);
     this.logger.debug(`Workspaceing profile picture URL for ${jidNormalized}`);
     try {
         const url = await this.client?.profilePictureUrl(jidNormalized, 'image');
         return { profilePictureUrl: url || null };
     } catch (error: any) {
         // Baileys throws if not found, treat as null
         if (error instanceof Boom && error.output.statusCode === 404) {
              this.logger.warn(`Profile picture not found for ${jidNormalized}.`);
              return { profilePictureUrl: null };
         }
         this.logger.error({ err: error, jid: jidNormalized }, `Error fetching profile picture URL`);
         return { profilePictureUrl: null }; // Return null on other errors too
     }
  }

  async fetchStatus(number: string): Promise<{ wuid: string, status: string } | null> {
      if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
      const jid = createJid(number);
      this.logger.debug(`Workspaceing status for ${jid}`);
      try {
          const result = await this.client.fetchStatus(jid);
          const status = result[0]?.status ?? ''; // Get status from the first result if available
          return { wuid: jid, status };
      } catch (error: any) {
          this.logger.error({ err: error, jid }, `Error fetching status for ${jid}`);
          // Decide if to throw or return null based on expected behavior
          return null;
      }
  }

  /**
   * Checks if numbers are registered on WhatsApp.
   */
  async whatsappNumber(data: { numbers: string[] }): Promise<Array<{ exists: boolean, jid: string }>> {
      if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
      const results: Array<{ exists: boolean, jid: string }> = [];
      for (const number of data.numbers) {
          const jid = createJid(number);
          try {
              const response = await this.client.onWhatsApp(jid);
              results.push(...response); // Add results for this JID
          } catch (error: any) {
              this.logger.error({ err: error, jid }, `Error checking WhatsApp status for ${jid}`);
              results.push({ exists: false, jid: jid }); // Assume not exists on error
          }
      }
      return results;
  }

  /**
   * Fetches business profile information.
   */
  async fetchBusinessProfile(number: string): Promise<any> {
      if (!this.client) throw new NotFoundException(`Instance ${this.instanceName} not connected.`);
      const jid = createJid(number);
      this.logger.debug(`Workspaceing business profile for ${jid}`);
      try {
          // Baileys doesn't have a direct getBusinessProfile like WABAs.
          // Fetch status and profile picture as approximation.
          const [statusResult, picResult, contactInfo] = await Promise.all([
               this.fetchStatus(number),
               this.profilePicture(number),
               this.prismaRepository.findUniqueContact({ where: { remoteJid_instanceId: { remoteJid: jid, instanceId: this.instanceId! }}}) // Fetch contact info from DB
          ]);
          // Attempt to fetch group metadata if it's a group JID
          let groupMetadata: GroupMetadata | null = null;
          if (isJidGroup(jid)) {
              groupMetadata = await this.client.groupMetadata(jid).catch(() => null);
          }

          return {
               jid: jid,
               status: statusResult?.status,
               profilePictureUrl: picResult?.profilePictureUrl,
               pushName: contactInfo?.pushName,
               name: contactInfo?.name || groupMetadata?.subject, // Use group subject if available
               isGroup: isJidGroup(jid),
               // Add more fields if available (like description from groupMetadata)
               description: groupMetadata?.desc,
          };
      } catch (error: any) {
           this.logger.error({ err: error, jid }, `Error fetching business profile for ${jid}`);
           throw new InternalServerErrorException(`Failed to fetch business profile: ${error.message}`);
      }
  }

  /**
   * Offers a call (not standard WhatsApp feature via Baileys).
   */
  async offerCall(data: OfferCallDto): Promise<any> {
      // Baileys generally does not support initiating standard WA calls.
      // Voice call features require specific libraries/implementations like useVoiceCallsBaileys.
      this.logger.warn(`Offering standard calls via Baileys is not supported. Use voice call specific features if enabled.`);
      throw new BadRequestException("Offering standard calls is not supported via this method.");
      // If using useVoiceCallsBaileys:
      // if (!this.client || !this.voiceCallService) throw new NotFoundException(...)
      // return this.voiceCallService.offerCall(createJid(data.number), data.isVideo);
  }

  // --- Internal Helper Methods ---

  /**
   * Defines the authentication state strategy (Provider, Redis, Prisma, File).
   */
  private async defineAuthState(): Promise<AuthStateMethods> {
    const dbConfig = this.configService.get<DatabaseConfig>('DATABASE');
    const cacheConfig = this.configService.get<CacheConf>('CACHE');
    const providerConfig = this.configService.get<ProviderSession>('PROVIDER');
    let authStatePromise: Promise<AuthStateMethods>;

    const instanceId = this.instanceId!; // Assume instanceId is set

    // 1. Provider (Optional, requires providerFiles to be injected)
    if (providerConfig?.ENABLED && this.providerFiles) {
      this.logger.warn(`Using ProviderFiles for authentication. Ensure implementation is correct.`);
      // Pass logger or cacheService if needed by AuthStateProvider
      const authStateProvider = new AuthStateProvider(instanceId, this.providerFiles, this.cacheService);
      authStatePromise = Promise.resolve(authStateProvider); // Assumes AuthStateProvider implements AuthStateMethods
    }
    // 2. Redis Cache (If enabled and configured for instances)
    else if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
      this.logger.info(`Using Redis for authentication (Instance: ${instanceId})`);
      authStatePromise = useMultiFileAuthStateRedisDb(instanceId, this.cacheService); // Pass general cache service
    }
    // 3. Prisma Database (If enabled for instance data)
    else if (dbConfig?.SAVE_DATA?.INSTANCE) {
      this.logger.info(`Using Prisma (DB) for authentication (Instance: ${instanceId})`);
      authStatePromise = useMultiFileAuthStatePrisma(instanceId, this.prismaRepository); // Pass Prisma repository
    }
    // 4. Fallback (Local File System)
    else {
      this.logger.warn(`No persistent auth method (Provider, Redis, DB) configured. Using default file system auth (Instance: ${instanceId}).`);
      const sessionDir = path.join(INSTANCE_DIR, instanceId);
      if (!fs.existsSync(INSTANCE_DIR)) fs.mkdirSync(INSTANCE_DIR, { recursive: true });
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

      const fileAuthState = await useMultiFileAuthState(sessionDir);

      // Add clearState method for file auth
      const clearFileState = async () => {
        this.logger.info(`Clearing file system session directory: ${sessionDir}`);
        try {
          rmSync(sessionDir, { recursive: true, force: true });
        } catch (e: any) {
          this.logger.error({ err: e }, `Error clearing file session directory ${sessionDir}`);
        }
      };
      authStatePromise = Promise.resolve({ ...fileAuthState, clearState: clearFileState });
    }

    // Ensure the returned object always has a `clearState` method
    return authStatePromise.then(auth => {
      if (typeof auth.clearState !== 'function') {
        this.logger.warn(`Auth state method did not provide clearState. Adding NOP fallback.`);
        return { ...auth, clearState: async () => { this.logger.warn('Fallback clearState (NOP) called.'); } } as AuthStateMethods;
      }
      return auth as AuthStateMethods; // Type assertion
    });
  }

  /**
   * Creates and configures the Baileys WASocket instance.
   */
   private async createClient(numberForPairing?: string | null): Promise<WASocket> {
     this.logger.info(`Creating Baileys client for instance ${this.instanceName}...`);

     const authStateMethods = await this.defineAuthState();
     // Assign the state part to the instance property for potential external access
     this.instance.authState = authStateMethods.state;

     const sessionConfig = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
     const browserDescription = Browsers.appropriate(sessionConfig?.CLIENT || 'Evolution API');
     this.logger.info(`Using browser description: ${browserDescription.join(' | ')}`);

     let { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined, isLatest: false }));
     if (version) {
         this.logger.info(`Using Baileys version: ${version.join('.')}. Latest: ${isLatest}`);
     } else {
         this.logger.warn(`Failed to fetch latest Baileys version. Using default.`);
     }

     let agentOptions = {};
     if (this.localProxy?.enabled && this.localProxy?.host && this.localProxy?.port) {
         try {
             const proxyConfig: any = {
                 host: this.localProxy.host,
                 port: this.localProxy.port, // Should be number? makeProxyAgent handles string/number
                 protocol: this.localProxy.protocol || 'http',
                 auth: (this.localProxy.username && this.localProxy.password)
                     ? `${this.localProxy.username}:${this.localProxy.password}`
                     : undefined,
             };
             this.logger.info(`Using proxy: ${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`);
             const agent = makeProxyAgent(proxyConfig); // makeProxyAgent likely handles string port
             agentOptions = { agent: agent, fetchAgent: agent };
         } catch (e) {
             this.logger.error({ err: e }, "Failed to create proxy agent");
         }
     }

     const qrConfig = this.configService.get<QrCodeConfig>('QRCODE');
     const socketConfig: UserFacingSocketConfig = {
         ...agentOptions,
         version,
         logger: P({ level: this.logBaileysLevel }).child({ context: `Baileys[${this.instanceName}]` }) as PinoLogger,
         printQRInTerminal: qrConfig?.PRINT_TERMINAL ?? false,
         mobile: false, // Use mobile: true for pairing code method if needed, but requires browser override
         auth: authStateMethods, // Pass object with state, saveCreds, clearState
         msgRetryCounterCache: this.msgRetryCounterCache,
         userDevicesCache: this.userDevicesCache,
         generateHighQualityLinkPreview: true,
         // getMessage: async (key) => this.getMessage(key), // Optional, needed for specific store interactions
         browser: browserDescription,
         markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true,
         connectTimeoutMs: 60_000,
         keepAliveIntervalMs: 20_000,
         qrTimeout: (qrConfig?.TIMEOUT || 45) * 1000,
         emitOwnEvents: false,
         shouldIgnoreJid: (jid): boolean => {
             if (!jid) return false;
             // Ignore broadcast, newsletters, and based on settings
             return isJidBroadcast(jid) || isJidNewsletter(jid) || (this.localSettings?.groupsIgnore && isJidGroup(jid)) || false;
         },
         shouldSyncHistoryMessage: (msg) => this.isSyncNotificationFromUsedSyncType(msg), // Check sync type
         syncFullHistory: this.localSettings?.syncFullHistory ?? false,
         transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
         patchMessageBeforeSending: (msg) => {
             // Add deviceId if missing (important for some message types)
             if (!msg.deviceSentMeta && this.instance.authState?.creds?.me?.id) {
                  msg.deviceSentMeta = { deviceId: getDevice(this.instance.authState.creds.me.id) || 0 };
             }
             // Fix potential issue with product list messages (convert to single select)
             if (msg.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
                msg.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
             }
             // Also check deviceSentMessage for the same issue
             if (msg.deviceSentMessage?.message?.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
                 msg.deviceSentMessage.message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
             }
             return msg;
         },
         // Optional: Provide cached group metadata getter
         // cachedGroupMetadata: (jid) => this.getGroupMetadataFromCache(jid), // Requires implementation
     };

     this.endSession = false;
     this.logger.info(`Initializing Baileys socket connection for ${this.instanceName}...`);

     try {
         const newClient = makeWASocket(socketConfig);
         this.setupMainEventListeners(newClient); // Pass client to setup listeners
         // await authStateMethods.saveCreds(); // Save initial creds (might be handled by useMultiFileAuthState)
         return newClient;
     } catch (error: any) {
         this.logger.error({ err: error }, `CRITICAL error creating Baileys socket for ${this.instanceName}`);
         await this.waMonitor.deleteAccount(this.instanceName).catch(()=>{}); // Ensure removal from monitor on failure
         throw new InternalServerErrorException(`Failed to initialize Baileys client: ${error.message}`);
     }
   }

  /**
   * Sets up the main event listeners for the Baileys client.
   */
  private setupMainEventListeners(client: WASocket): void {
    this.logger.debug('Setting up main Baileys event listeners...');
    const ev = client.ev; // Get the event emitter

    // Connection updates
    ev.process(async (events) => { // Use ev.process for batch processing
      // --- Connection Update ---
      if (events['connection.update']) {
        await this.handleConnectionUpdate(events['connection.update']);
      }

      // --- Credentials Update ---
      if (events['creds.update']) {
        await this.handleCredsUpdate(); // Save updated creds
      }

      // --- Chat Events ---
      if (events['chats.upsert']) {
        await this.chatHandle['chats.upsert'](events['chats.upsert']);
      }
      if (events['chats.update']) {
        await this.chatHandle['chats.update'](events['chats.update']);
      }
      if (events['chats.delete']) {
        await this.chatHandle['chats.delete'](events['chats.delete']);
      }

      // --- Contact Events ---
      if (events['contacts.upsert']) {
        await this.contactHandle['contacts.upsert'](events['contacts.upsert']);
      }
      if (events['contacts.update']) {
        await this.contactHandle['contacts.update'](events['contacts.update']);
      }

      // --- Message Events ---
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        this.logger.debug({ messageCount: messages.length, type }, 'Received messages.upsert event');
        for (const msg of messages) {
            await this.handleMessageUpsert(msg); // Process each message
        }
        this.sendDataWebhook(Events.MESSAGES_UPSERT, { messages, type }); // Send webhook after processing batch
      }
      if (events['messages.update']) {
        const updates = events['messages.update'];
        this.logger.debug({ updateCount: updates.length }, 'Received messages.update event');
        for (const update of updates) {
            await this.handleMessageUpdate(update);
        }
        this.sendDataWebhook(Events.MESSAGES_UPDATE, updates);
      }
      if (events['message-receipt.update']) {
        const updates = events['message-receipt.update'];
        this.logger.debug({ updateCount: updates.length }, 'Received message-receipt.update event');
        this.handleReceiptUpdate(updates);
        this.sendDataWebhook(Events.MESSAGE_RECEIPT_UPDATE, updates);
      }

      // --- Group Events ---
      if (events['groups.upsert']) {
        const groups = events['groups.upsert'];
        this.logger.debug({ groupCount: groups.length }, 'Received groups.upsert event');
        this.handleGroupUpsert(groups);
        this.sendDataWebhook(Events.GROUPS_UPSERT, groups);
      }
      if (events['groups.update']) {
        const updates = events['groups.update'];
        this.logger.debug({ updateCount: updates.length }, 'Received groups.update event');
        this.handleGroupUpdate(updates);
        // Consider updating cache: updates.forEach(u => u.id && this.updateGroupMetadataCache(u.id));
        this.sendDataWebhook(Events.GROUPS_UPDATE, updates);
      }
      if (events['group-participants.update']) {
        const update = events['group-participants.update'];
        this.logger.debug({ ...update }, 'Received group-participants.update event');
        this.handleParticipantUpdate(update);
        // Consider updating cache: this.updateGroupMetadataCache(update.id);
        this.sendDataWebhook(Events.GROUP_PARTICIPANTS_UPDATE, update);
      }

      // --- Presence Update ---
      if (events['presence.update']) {
         const update = events['presence.update'];
         this.logger.trace({ update }, 'Received presence.update event');
         this.handlePresenceUpdate(update);
         this.sendDataWebhook(Events.PRESENCE_UPDATE, update);
      }

      // --- History Sync ---
      if (events['messaging-history.set']) {
          const { chats, contacts, messages, isLatest } = events['messaging-history.set'];
          this.logger.info(`Received messaging history set. Chats: ${chats.length}, Contacts: ${contacts.length}, Messages: ${messages.length}, IsLatest: ${isLatest}`);
          await this.handleHistorySet(chats, contacts, messages, isLatest);
          // Potentially trigger Chatwoot import if needed
      }

      // --- Label Events (Require specific handling for DB interaction) ---
      if (events[Events.LABELS_EDIT]) {
          const label = events[Events.LABELS_EDIT] as unknown as Label; // Cast needed
          await this.labelHandle[Events.LABELS_EDIT](label);
      }
      if (events[Events.LABELS_ASSOCIATION]) {
          const data = events[Events.LABELS_ASSOCIATION] as unknown as { association: LabelAssociation; type: 'add' | 'remove' }; // Cast needed
          // Pass only data, as handler doesn't need DB argument
          await this.labelHandle[Events.LABELS_ASSOCIATION](data);
      }

      // --- Call Events (Optional, requires specific handling) ---
      // if (events.call) { ... handle incoming call ... }
      if (events['call']) {
           const calls = events['call'];
           // Handle call events (rejecting, sending webhooks)
           for (const call of calls) {
                this.logger.info({ call }, `Incoming call received from ${call.from}`);
                // Example: Auto-reject calls based on settings
                if (this.localSettings?.rejectCall) {
                     await client.rejectCall(call.id, call.from);
                     this.logger.info(`Call ${call.id} rejected.`);
                     // Optionally send a message
                     if (this.localSettings.msgCall) {
                         await client.sendMessage(call.from, { text: this.localSettings.msgCall });
                     }
                }
                this.sendDataWebhook(Events.CALL, call); // Send webhook regardless
           }
      }

    }); // End ev.process

    this.logger.debug('Main Baileys event listeners set up.');
  }

  /**
   * Handles connection updates from Baileys.
   */
   private async handleConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
     const { connection, lastDisconnect, qr, isNewLogin } = update;
     const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

     this.logger.info(`Connection update for ${this.instanceName}: ${connection}, Status Code: ${statusCode ?? 'N/A'}`);
     // Update base class state
     this.connectionState.connection = connection;
     this.connectionState.lastDisconnect = lastDisconnect;
     this.connectionState.isNewLogin = isNewLogin;

     // Handle QR code generation/update
     if (qr) {
        this.logger.info(`QR code received/updated for ${this.instanceName}.`);
        this.instance.qrcode = this.instance.qrcode || { count: 0 }; // Initialize if needed
        this.instance.qrcode.count = (this.instance.qrcode.count ?? 0) + 1;
        this.instance.qrcode.code = qr;

        // Pairing code logic (if enabled/detected) - Requires mobile: true and potentially browser override
        const usePairingCode = false; // Determine if pairing code should be used
        if (usePairingCode && this.phoneNumber && this.client) {
            try {
                await delay(1000); // Delay recommended by Baileys docs
                this.instance.qrcode.pairingCode = await this.client.requestPairingCode(this.phoneNumber);
                this.logger.info(`Pairing code requested: ${this.instance.qrcode.pairingCode}`);
            } catch (pairError) {
                this.logger.error({ err: pairError }, "Failed to request pairing code.");
                this.instance.qrcode.pairingCode = null;
            }
        } else {
             this.instance.qrcode.pairingCode = null; // Ensure pairing code is null if not used
        }

        // Generate Base64 QR
        const qrConfig = this.configService.get<QrCodeConfig>('QRCODE');
        try {
           const opts: qrcode.QRCodeToDataURLOptions = {
               margin: 1, errorCorrectionLevel: 'L', type: 'image/png',
               color: { dark: '#000000', light: '#ffffff' },
               // Use color from config if available
               // color: { dark: qrConfig?.COLOR || '#198754', light: '#ffffff' },
           };
           this.instance.qrcode.base64 = await qrcode.toDataURL(qr, opts);
        } catch (qrError) {
            this.logger.error({ err: qrError }, "Failed to generate Base64 QR code.");
            this.instance.qrcode.base64 = null;
        }

        // Log QR to terminal if configured
        if (qrConfig?.PRINT_TERMINAL) {
            qrcodeTerminal.generate(qr, { small: true }, (qrcodeStr) => {
                this.logger.info(`QR Code for ${this.instanceName} (Count: ${this.instance.qrcode?.count}):\n${qrcodeStr}\nPairing Code: ${this.instance.qrcode?.pairingCode || 'N/A'}`);
            });
        }

        // Send QR update webhook
        this.sendDataWebhook(Events.QRCODE_UPDATED, {
           instance: this.instanceName,
           qrcode: this.instance.qrcode, // Send updated QR object
        });
        // Emit event for Chatwoot (if enabled)
        this.emitChatwootEvent(Events.QRCODE_UPDATED, {
            qrcode: this.instance.qrcode,
            statusReason: DisconnectReason.timedOut // Example status for QR timeout limit
        });

        // Check QR code limit
        if (this.instance.qrcode?.count >= (qrConfig?.LIMIT ?? 30)) {
             this.logger.warn(`QR code limit reached for ${this.instanceName}. Closing connection.`);
             this.updateConnectionState('close', DisconnectReason.timedOut);
             // Consider logging out completely
             // await this.logoutInstance(true);
             this.client?.ws?.close(); // Close socket
        }
     }

     if (connection === 'close') {
         this.logger.warn(`Connection closed for ${this.instanceName}. Reason: ${DisconnectReason[statusCode!] || statusCode || 'Unknown'}`);

         const shouldReconnect = statusCode !== DisconnectReason.loggedOut &&
                                statusCode !== DisconnectReason.connectionReplaced &&
                                statusCode !== DisconnectReason.forbidden &&
                                statusCode !== 401; // 401 often means QR expired or invalid session

         // Update instance status in DB
         await this.prismaRepository.instance.update({
              where: { instanceId: this.instanceId },
              data: { status: 'close', statusReason: statusCode },
         }).catch(err => this.logger.error({ err }, "Failed to update instance status in DB"));

         // Send status webhook
         this.sendDataWebhook(Events.CONNECTION_UPDATE, {
             instance: this.instanceName,
             state: 'close',
             statusReason: statusCode,
         });
         // Emit Chatwoot event
         this.emitChatwootEvent(Events.CONNECTION_UPDATE, { state: 'close', statusReason: statusCode });

         if (shouldReconnect && !this.endSession) {
             this.logger.info(`Attempting to reconnect instance ${this.instanceName}...`);
             // Add delay before reconnecting?
             await delay(5000); // 5 second delay
             await this.connectToWhatsapp().catch(e => this.logger.error({ err: e }, `Reconnect failed for ${this.instanceName}`));
         } else {
             this.logger.warn(`Not attempting to reconnect instance ${this.instanceName}. Logged out: ${!shouldReconnect}, End Session: ${this.endSession}`);
             // Clean up if logged out or connection replaced
             if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.connectionReplaced) {
                 await this.logoutInstance(true); // Full cleanup including DB removal if configured
             } else {
                 // Remove from monitor if not logged out but not reconnecting
                  await this.waMonitor.deleteAccount(this.instanceName).catch(() => {});
             }
         }
     }

     if (connection === 'open') {
         this.logger.info(`Connection opened successfully for ${this.instanceName}. WUID: ${this.client?.user?.id}`);
         this.endSession = false; // Reset end session flag on successful open
         this.instance.qrcode = { count: 0 }; // Reset QR count
         this.instance.wuid = this.client?.user?.id.split(':')[0]; // Store WUID without device identifier
         this.instance.number = this.instance.wuid; // Set number from WUID
         this.instance.profileName = this.client?.user?.name || this.client?.user?.notify || this.instance.profileName; // Update profile name

         // Fetch and update profile picture URL
         try {
              const pic = await this.profilePicture(this.instance.wuid!);
              this.instance.profilePictureUrl = pic.profilePictureUrl;
         } catch (e) {
              this.logger.warn({ err: e }, `Could not fetch profile picture for ${this.instance.wuid}`);
              this.instance.profilePictureUrl = null;
         }

         // Update instance data in DB
         await this.prismaRepository.instance.update({
             where: { instanceId: this.instanceId },
             data: {
                 status: 'open',
                 statusReason: 200,
                 owner: this.instance.wuid,
                 number: this.instance.number,
                 profileName: this.instance.profileName,
                 profilePicUrl: this.instance.profilePictureUrl,
                 token: this.instance.token // Ensure token is persisted if needed
             },
         }).catch(err => this.logger.error({ err }, "Failed to update instance status/info in DB"));

         // Send webhook
         this.sendDataWebhook(Events.CONNECTION_UPDATE, {
             instance: this.instanceName,
             state: 'open',
             wuid: this.instance.wuid,
             profileName: this.instance.profileName,
             profilePictureUrl: this.instance.profilePictureUrl,
         });
         // Emit Chatwoot event
         this.emitChatwootEvent(Events.CONNECTION_UPDATE, {
             state: 'open',
             wuid: this.instance.wuid,
             profileName: this.instance.profileName,
             profilePictureUrl: this.instance.profilePictureUrl,
         });

         // Trigger potential sync tasks
         // this.syncChatwootLostMessages(); // Implement this method if needed
         this.logger.info(`Instance ${this.instanceName} ready.`);
     }
   }

  /**
   * Handles credential updates from Baileys.
   */
  private async handleCredsUpdate(): Promise<void> {
    try {
      const authStateMethods = await this.defineAuthState();
      await authStateMethods.saveCreds();
      this.logger.debug('Authentication credentials updated and saved.');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to save updated credentials');
    }
  }

  /**
   * Handles presence updates.
   */
  private handlePresenceUpdate(update: { id: string; presences: { [participant: string]: proto.WebMessageInfo.IPresence } }): void {
    // Optional: Implement logic to store or react to presence updates
    this.logger.trace({ update }, `Presence update received for ${update.id}`);
  }

  /**
   * Handles history sync set event.
   */
  private async handleHistorySet(
       chats: PrismaChat[],
       contacts: PrismaContact[],
       messages: proto.IWebMessageInfo[],
       isLatest: boolean
   ): Promise<void> {
       // Process history data (save to DB, etc.)
       // Example: Upsert contacts
       if (contacts.length > 0 && this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CONTACTS) {
            try {
                 const contactOps = contacts.map(c => this.prismaRepository.contact.upsert({
                      where: { remoteJid_instanceId: { remoteJid: c.id, instanceId: this.instanceId! } },
                      create: { ...c, instanceId: this.instanceId! },
                      update: { name: c.name, pushName: c.notify },
                 }));
                 await this.prismaRepository.$transaction(contactOps);
                 this.logger.info(`Upserted ${contacts.length} contacts from history sync.`);
            } catch (e) {
                 this.logger.error({ err: e }, "Error saving contacts from history sync.");
            }
       }
       // Example: Upsert chats
       if (chats.length > 0 && this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CHATS) {
            try {
                 const chatOps = chats.map(c => this.prismaRepository.chat.upsert({
                      where: { remoteJid_instanceId: { remoteJid: c.id, instanceId: this.instanceId! } },
                      // Ensure mapping handles potential null/undefined values correctly
                      create: {
                          instanceId: this.instanceId!,
                          remoteJid: c.id,
                          name: c.name ?? null,
                          // Map other fields: conversationTimestamp, unreadCount, etc.
                      },
                      update: {
                           name: c.name ?? null,
                           // Update other fields
                      },
                 }));
                 await this.prismaRepository.$transaction(chatOps);
                 this.logger.info(`Upserted ${chats.length} chats from history sync.`);
            } catch (e) {
                 this.logger.error({ err: e }, "Error saving chats from history sync.");
            }
       }
       // Example: Upsert messages (might be resource intensive)
       if (messages.length > 0 && this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.HISTORIC) {
           this.logger.warn(`Processing ${messages.length} messages from history sync. This might take time.`);
           // Implement batch upsert logic for messages if needed
       }

       // Trigger Chatwoot history import if configured
       if (this.chatwootConfig?.ENABLED && this.chatwootService && this.localChatwoot?.importMessages) {
           this.logger.info("Starting Chatwoot history import based on history sync.");
           // Use methods from ChatwootService
           // this.chatwootService.startImportHistoryMessages({ instanceName: this.instanceName });
       }
   }

  /**
   * Checks if a history sync notification matches the configured sync type.
   */
  private isSyncNotificationFromUsedSyncType(msg: proto.Message.IHistorySyncNotification): boolean {
    const syncType = msg?.syncType;
    const fullSyncEnabled = this.localSettings?.syncFullHistory ?? false;

    if (fullSyncEnabled && syncType === proto.HistorySync.HistorySyncType.FULL) {
        return true; // Process FULL when full sync is enabled
    }
    if (!fullSyncEnabled && syncType === proto.HistorySync.HistorySyncType.RECENT) {
        return true; // Process RECENT when full sync is disabled
    }
    // Ignore other types or mismatches
    return false;
  }


  /**
   * Fetches a specific message (potentially from store/cache).
   * Placeholder implementation.
   */
  private async getMessage<T = proto.IMessage | undefined>(key: proto.IMessageKey, full = false): Promise<T | null> {
    this.logger.warn(`getMessage called for key ${key.id}, but store implementation is missing.`);
    // Needs implementation using Baileys store or custom DB query
    // Example using Prisma:
    // const msgData = await this.prismaRepository.message.findUnique({ where: { keyId_instanceId: { keyId: key.id!, instanceId: this.instanceId! }}});
    // return msgData?.message as T ?? null; // Assuming message content is stored as JSON
    return null;
  }

  /**
   * Helper to emit events specifically for Chatwoot integration.
   */
   private emitChatwootEvent(event: Events, payload: any): void {
       if (this.chatwootConfig?.ENABLED && this.localChatwoot?.enabled && this.chatwootService) {
           this.logger.debug(`Emitting event ${event} to Chatwoot service.`);
           try {
                // Pass instance details along with payload
                const instanceDetails = { instanceName: this.instanceName, instanceId: this.instanceId };
                this.chatwootService.eventWhatsapp(event, instanceDetails, payload);
           } catch (error) {
                this.logger.error({ err: error, event }, `Error emitting event ${event} to Chatwoot`);
           }
       }
   }

   // --- Event Handlers (Mapped to internal methods) ---
   // These handlers structure how specific events are processed

   private readonly chatHandle = {
       'chats.upsert': async (chats: Chat[]): Promise<void> => {
           if (!this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CHATS) return;
           this.logger.debug(`Processing ${chats.length} chats for upsert.`);
           const chatOps = chats.map(chat => {
                const data = {
                     instanceId: this.instanceId!,
                     remoteJid: chat.id,
                     name: chat.name ?? null,
                     unreadCount: chat.unreadCount,
                     conversationTimestamp: typeof chat.conversationTimestamp === 'number' ? chat.conversationTimestamp : chat.conversationTimestamp?.toNumber?.(),
                     // Map other relevant fields from Chat type
                };
                return this.prismaRepository.chat.upsert({
                     where: { remoteJid_instanceId: { remoteJid: chat.id, instanceId: this.instanceId! } },
                     create: data,
                     update: data, // Update all fields on conflict
                });
           });
           try {
                await this.prismaRepository.$transaction(chatOps);
           } catch (e) { this.logger.error({ err: e }, "Error upserting chats"); }
       },
       'chats.update': async (updates: Array<Partial<Chat>>): Promise<void> => {
           if (!this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CHATS) return;
           this.logger.debug(`Processing ${updates.length} chat updates.`);
           const updateOps = updates.map(update => {
                const data: Prisma.ChatUpdateInput = {};
                if (update.name !== undefined) data.name = update.name;
                if (update.unreadCount !== undefined) data.unreadCount = update.unreadCount;
                if (update.conversationTimestamp !== undefined) data.conversationTimestamp = typeof update.conversationTimestamp === 'number' ? update.conversationTimestamp : update.conversationTimestamp?.toNumber?.();
                // Map other fields...

                return this.prismaRepository.chat.update({
                     where: { remoteJid_instanceId: { remoteJid: update.id!, instanceId: this.instanceId! } },
                     data: data,
                });
           });
            try {
                await this.prismaRepository.$transaction(updateOps);
            } catch (e) {
                // Ignore 'Record to update not found' errors
                if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) {
                     this.logger.error({ err: e }, "Error updating chats");
                }
            }
       },
       'chats.delete': async (deletions: string[]): Promise<void> => {
           if (!this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CHATS) return;
           this.logger.debug(`Processing ${deletions.length} chat deletions.`);
           try {
               await this.prismaRepository.chat.deleteMany({
                   where: { instanceId: this.instanceId!, remoteJid: { in: deletions } },
               });
           } catch (e) { this.logger.error({ err: e }, "Error deleting chats"); }
       },
   };

   private readonly contactHandle = {
        'contacts.upsert': async (contacts: Contact[]): Promise<void> => {
             await this._handleContactUpsert(contacts); // Call helper
        },
        'contacts.update': async (updates: Array<Partial<Contact>>): Promise<void> => {
             await this._handleContactUpdate(updates); // Call helper
        },
   };

   private readonly labelHandle = {
       // Note: Prisma types `Label` and `LabelAssociation` might not directly match Baileys event payloads.
       // Casting or mapping might be needed.
       [Events.LABELS_EDIT]: async (labelPayload: any): Promise<void> => {
           // Assuming labelPayload directly maps to Prisma.LabelCreateInput/UpdateInput
           const labelData: Prisma.LabelCreateInput = {
               ...labelPayload, // Spread payload data
               instance: { connect: { instanceId: this.instanceId! } } // Connect to instance
           };
           this.logger.debug({ labelId: labelData.id }, 'Processing labels.edit event');
           try {
               await this.prismaRepository.label.upsert({
                   where: { labelId_instanceId: { labelId: labelData.id, instanceId: this.instanceId! } },
                   create: labelData,
                   update: { name: labelData.name, color: labelData.color /* outros campos */ },
               });
           } catch (error: any) {
               this.logger.error({ err: error, labelId: labelData.id }, `Error processing labels.edit`);
           }
       },
       [Events.LABELS_ASSOCIATION]: async (data: { association: any; type: 'add' | 'remove' }): Promise<void> => {
           // Assuming data.association directly maps to Prisma.LabelAssociation related fields
           const assocPayload = data.association;
           const type = data.type;
           const assocIdentifier = { // Composite key fields
               chatId: assocPayload.chatId, // Ensure these fields exist in payload
               labelId: assocPayload.labelId,
               instanceId: this.instanceId!
           };
           this.logger.debug({ association: assocIdentifier, type }, 'Processing labels.association event');

           try {
               if (type === 'add') {
                    // Create needs all fields
                    const createData: Prisma.LabelAssociationCreateInput = {
                       chatId: assocPayload.chatId,
                       label: { connect: { labelId_instanceId: { labelId: assocPayload.labelId, instanceId: this.instanceId! } } },
                       instance: { connect: { instanceId: this.instanceId! } },
                       // Map other fields if necessary
                    };
                   await this.prismaRepository.labelAssociation.upsert({
                       where: { chatId_labelId_instanceId: assocIdentifier },
                       create: createData,
                       update: {}, // Do nothing if exists
                   });
               } else if (type === 'remove') {
                   await this.prismaRepository.labelAssociation.delete({
                       where: { chatId_labelId_instanceId: assocIdentifier },
                   }).catch(e => {
                        // Ignore if not found during delete
                        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e;
                   });
               }
           } catch (error: any) {
               this.logger.error({ err: error, association: assocIdentifier, type }, `Error processing labels.association (${type})`);
           }
       },
   };

   // --- Internal Contact Handlers (Refactored for DB/Chatwoot logic) ---

   private async _handleContactUpsert(contacts: Contact[]): Promise<void> {
        if (!this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CONTACTS) return;

        const filteredContacts = contacts.filter(c => c.id && isJidUser(c.id));
        if (!filteredContacts.length) return;
        this.logger.debug(`Processing ${filteredContacts.length} contacts for upsert.`);

        const upsertPromises = filteredContacts.map(async (contact) => {
            let profilePicUrl: string | null = contact.imgUrl;
            // Refetch URL only if explicitly marked as changed/set or if null/undefined
            if (profilePicUrl === 'changed' || profilePicUrl === 'set' || !profilePicUrl) {
                profilePicUrl = await this.client?.profilePictureUrl(contact.id).catch(() => null);
            }

            const contactData: Prisma.ContactCreateInput & Prisma.ContactUpdateInput = {
                 instanceId: this.instanceId!,
                 remoteJid: contact.id,
                 name: contact.name || contact.verifiedName || null,
                 pushName: contact.notify || null,
                 profilePictureUrl: profilePicUrl,
            };

            // Upsert into local DB
            await this.prismaRepository.contact.upsert({
                 where: { remoteJid_instanceId: { remoteJid: contact.id, instanceId: this.instanceId! } },
                 create: contactData,
                 update: contactData,
            });

            // Upsert into Chatwoot if enabled
            if (this.chatwootConfig?.ENABLED && this.localChatwoot?.enabled && this.chatwootService) {
                 const chatwootContactData = {
                      inboxIdentifier: this.localChatwoot?.inboxIdentifier, // Use localChatwoot for identifier
                      contactIdentifier: contact.id.split('@')[0],
                      name: contact.notify || contact.name || contact.verifiedName || contact.id.split('@')[0],
                      avatar_url: profilePicUrl,
                      phone_number: `+${contact.id.split('@')[0]}`, // Format number for Chatwoot
                 };
                 await this.chatwootService.createOrUpdateContact(chatwootContactData)
                     .catch(cwError => this.logger.error({ err: cwError, contactId: contact.id }, `Failed Chatwoot contact upsert`));
            }
        });

        try {
            await Promise.all(upsertPromises);
            // Update onWhatsapp cache
            await saveOnWhatsappCache(filteredContacts.map(c => ({ remoteJid: c.remoteJid })));
        } catch (error) {
             this.logger.error({ err: error }, "Error during contact upsert processing.");
        }
   }

   private async _handleContactUpdate(updates: Array<Partial<Contact>>): Promise<void> {
        if (!this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.CONTACTS) return;

        const validUpdates = updates.filter(u => u.id && isJidUser(u.id));
        if (!validUpdates.length) return;
        this.logger.debug(`Processing ${validUpdates.length} contact updates.`);

        const updatePromises = validUpdates.map(async (update) => {
             let profilePicUrl: string | null | undefined = undefined; // undefined means no change requested
             if (update.imgUrl === 'changed' || update.imgUrl === 'set') {
                 profilePicUrl = await this.client?.profilePictureUrl(update.id!).catch(() => null);
             } else if (update.imgUrl === 'delete') {
                 profilePicUrl = null; // Explicitly set to null
             }

             const dataToUpdate: Prisma.ContactUpdateInput = {};
             if (update.notify !== undefined) dataToUpdate.pushName = update.notify;
             if (update.name !== undefined) dataToUpdate.name = update.name;
             if (profilePicUrl !== undefined) dataToUpdate.profilePictureUrl = profilePicUrl; // Only update if defined

             if (Object.keys(dataToUpdate).length > 0) {
                 // Update local DB
                 await this.prismaRepository.contact.update({
                      where: { remoteJid_instanceId: { remoteJid: update.id!, instanceId: this.instanceId! } },
                      data: dataToUpdate,
                 }).catch(e => { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e; }); // Ignore not found

                 // Update Chatwoot if enabled
                 if (this.chatwootConfig?.ENABLED && this.localChatwoot?.enabled && this.chatwootService) {
                      const chatwootUpdatePayload: any = {};
                      if (dataToUpdate.pushName !== undefined || dataToUpdate.name !== undefined) {
                           chatwootUpdatePayload.name = dataToUpdate.pushName || dataToUpdate.name;
                      }
                      if (dataToUpdate.profilePictureUrl !== undefined) {
                            chatwootUpdatePayload.avatar_url = dataToUpdate.profilePictureUrl;
                      }

                      if (Object.keys(chatwootUpdatePayload).length > 0) {
                         const contactIdentifier = update.id!.split('@')[0];
                         await this.chatwootService.updateContactByIdentifier(contactIdentifier, chatwootUpdatePayload)
                             .catch(cwError => this.logger.error({ err: cwError, contactId: update.id }, `Failed Chatwoot contact update`));
                      }
                 }
             }
        });

        try {
             await Promise.all(updatePromises);
             // Update onWhatsapp cache for potentially changed numbers
             await saveOnWhatsappCache(validUpdates.map(u => ({ remoteJid: u.id! })));
        } catch (error) {
              this.logger.error({ err: error }, "Error during contact update processing.");
        }
   }


   // --- Message Processing ---
    private async handleMessageUpsert(msg: proto.IWebMessageInfo): Promise<void> {
        if (!msg.key.remoteJid) return; // Ignore messages without remote JID
        this.logger.trace({ msgId: msg.key.id, from: msg.key.remoteJid }, 'Processing message upsert');

        // 1. Save to Database (if enabled)
        if (this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
            try {
                const messageData = this.mapWebMessageInfoToPrisma(msg);
                await this.prismaRepository.message.upsert({
                    where: { keyId_instanceId: { keyId: msg.key.id!, instanceId: this.instanceId! } },
                    create: messageData,
                    update: { // Only update status or potentially mutable fields
                        status: messageData.status,
                        messageTimestamp: messageData.messageTimestamp,
                        // Avoid overwriting original message content on upsert if possible
                    },
                });
            } catch (dbError) {
                this.logger.error({ err: dbError, msgId: msg.key.id }, 'Failed to save message to DB');
            }
        }

        // 2. Process for Chatwoot (if enabled)
        if (this.shouldProcessForChatwoot(msg)) {
            this.emitChatwootEvent(Events.MESSAGES_UPSERT, { messages: [msg], type: 'notify' });
        }

        // 3. Process for other Chatbots (Typebot, OpenAI, etc.)
        if (this.shouldProcessForChatbot(msg)) {
            this.emit(Events.MESSAGES_UPSERT, { messages: [msg], type: 'notify', source: 'baileys' });
        }
    }

    private async handleMessageUpdate(update: proto.IWebMessageInfo): Promise<void> {
         if (!update.key.id) return; // Ignore updates without key ID
         this.logger.trace({ msgId: update.key.id, status: update.status }, 'Processing message update');

         // 1. Update status in Database (if enabled)
         if (this.configService.get<DatabaseConfig>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) {
             try {
                 const statusString = update.status ? wa.StatusMessage[update.status] ?? update.status.toString() : null; // Map enum to string
                 if (statusString) {
                     await this.prismaRepository.message.update({
                         where: { keyId_instanceId: { keyId: update.key.id, instanceId: this.instanceId! } },
                         data: { status: statusString },
                     });
                 }
                 // Optionally store full update history in MessageUpdate table
                 // await this.prismaRepository.messageUpdate.create({ data: { ... } });

             } catch (dbError) {
                  // Ignore 'Record to update not found' errors
                  if (!(dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025')) {
                      this.logger.error({ err: dbError, msgId: update.key.id }, 'Failed to update message status in DB');
                  }
             }
         }

         // 2. Process for Chatwoot (e.g., message deletion)
         if (this.shouldProcessForChatwoot(update) && update.messageStubType === WAMessageStubType.REVOKE) {
             this.emitChatwootEvent(Events.MESSAGES_UPDATE, [update]);
         }
         // Add other relevant update types for Chatwoot if needed
    }

    private handleReceiptUpdate(updates: MessageUserReceiptUpdate[]): void {
        this.logger.trace({ updateCount: updates.length }, 'Processing message receipt update');
        // Implement logic to update read status in DB or notify Chatwoot/other systems
        updates.forEach(update => {
             // Example: Update message status in DB based on receipt timestamp
             // const status = update.receipt.readTimestamp ? wa.StatusMessage.READ : (update.receipt.deliveryTimestamp ? wa.StatusMessage.DELIVERY_ACK : null);
             // if (status) { ... update DB ... }
        });
    }

    private handleGroupUpsert(groups: GroupMetadata[]): void {
        this.logger.trace({ groupCount: groups.length }, 'Processing group upsert');
        // Logic to save/update group info in Contact or Chat table in DB
    }

    private handleGroupUpdate(updates: Partial<GroupMetadata>[]): void {
        this.logger.trace({ updateCount: updates.length }, 'Processing group update');
        // Logic to update group metadata in DB
    }

    private handleParticipantUpdate(update: { id: string; participants: string[]; action: ParticipantAction }): void {
        this.logger.trace({ ...update }, 'Processing group participant update');
        // Logic to update participant list/status in DB or notify systems
    }

    // Helper to check if message should be processed by Chatwoot
    private shouldProcessForChatwoot(msg: proto.IWebMessageInfo): boolean {
        if (!this.chatwootConfig?.ENABLED || !this.localChatwoot?.enabled) return false;
        if (!msg.key.remoteJid) return false;
        // Add Chatwoot specific ignore logic (e.g., ignored JIDs from localChatwoot.ignoreJids)
        if (this.localChatwoot.ignoreJids?.includes(msg.key.remoteJid)) return false;
        // Add other general ignore logic
        if (isJidBroadcast(msg.key.remoteJid) || isJidNewsletter(msg.key.remoteJid)) return false;
        // Ignore own messages unless needed
        // if (msg.key.fromMe) return false;
        return true;
    }

    // Helper to check if message should be processed by general chatbots
    private shouldProcessForChatbot(msg: proto.IWebMessageInfo): boolean {
        if (!msg.key.remoteJid || msg.key.fromMe) return false; // Ignore own messages
        if (isJidBroadcast(msg.key.remoteJid) || isJidNewsletter(msg.key.remoteJid)) return false; // Ignore broadcast/newsletter
        // Add group ignore logic if needed
        if (this.localSettings?.groupsIgnore && isJidGroup(msg.key.remoteJid)) return false;
        // Add other checks (e.g., message type) if necessary
        return true;
    }

    // Helper to map Baileys message format to Prisma format
    private mapWebMessageInfoToPrisma(msg: proto.IWebMessageInfo): Prisma.MessageCreateInput {
         const status = msg.status ? wa.StatusMessage[msg.status] ?? msg.status.toString() : null;
         const messageTimestamp = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : msg.messageTimestamp?.toNumber?.();
         const messageType = getContentType(msg.message)?.toString();

         // Safely stringify message content, handling Buffers
         let messageContentJson: Prisma.JsonValue = Prisma.JsonNull;
         if (msg.message) {
             try {
                 messageContentJson = JSON.parse(JSON.stringify(msg.message, BufferJSON.replacer));
             } catch (e) {
                  this.logger.warn({ err: e, msgId: msg.key.id }, "Failed to serialize message content to JSON");
             }
         }

         return {
             instance: { connect: { instanceId: this.instanceId! } },
             keyId: msg.key.id!,
             remoteJid: msg.key.remoteJid!,
             fromMe: msg.key.fromMe || false,
             participant: msg.key.participant,
             messageTimestamp: messageTimestamp,
             pushName: msg.pushName,
             status: status,
             messageType: messageType,
             message: messageContentJson, // Store as JSON
             // Add other relevant fields from your Prisma schema
         };
    }

} // End of BaileysStartupService class
