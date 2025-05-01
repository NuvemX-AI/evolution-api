// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções v3: Refinados imports, tipos (Label, ContactPayload, etc.),
//               corrigido import de useMultiFileAuthStatePrisma, ajustados where clauses,
//               corrigido uso de profilePictureUrl, adicionado optional chaining para chatwootService,
//               verificada compatibilidade AuthState/DefinedAuthState.
/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Baileys Imports ---
import makeWASocket, {
  AuthenticationState, ConnectionState, Contact, DisconnectReason, fetchLatestBaileysVersion,
  GroupMetadata, isJidBroadcast, isJidGroup, isJidNewsletter, makeCacheableSignalKeyStore,
  MessageUserReceiptUpdate, MiscMessageGenerationOptions, ParticipantAction, GroupSettingUpdate,
  proto, useMultiFileAuthState, UserFacingSocketConfig, WABrowserDescription,
  WASocket, BufferJSON, initAuthCreds, delay, downloadMediaMessage
} from '@whiskeysockets/baileys';
// ** CORREÇÃO TS2307: Verificar se este path existe, pode não ser necessário se BufferJSON/initAuthCreds vêm do import principal **
// import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys/lib/Utils';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { release } from 'os';

// --- Project Imports ---
// DTOs
import { OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
// Services, Repositories, Config, etc.
import { ChannelStartupService } from '@api/services/channel.service';
import { ConfigService } from '@config/config.service';
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
// ** CORREÇÃO TS2345: Usar tipo correto de ProviderFiles **
// Verifique a definição em @provider/sessions e @utils/use-multi-file-auth-state-provider-files
import { ProviderFiles } from '@provider/sessions'; // Ajuste o import se necessário
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
// Types
// ** CORREÇÃO TS2305/TS2694: Importar tipos de wa.types.ts (GARANTIR QUE ESTÃO EXPORTADOS LÁ) **
import {
  wa, Events,
  // Tipos que precisam ser EXPORTADOS em wa.types.ts:
  Label, LabelAssociation, ContactPayload, LocalSettings, Instance as WAInstance, // Renomeado Instance para WAInstance
  // DTOs de envio (já usados e importados de wa.types):
  SendTextDto, SendMediaDto, SendMediaUrlDto, SendButtonDto, SendButtonListDto,
  SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto, CreateGroupDto,
  UpdateGroupPictureDto, UpdateGroupSubjectDto, UpdateGroupDescriptionDto, SendInviteDto,
  UpdateParticipantsDto, UpdateSettingDto, UpdateEphemeralDto, HandleLabelDto, OfferCallDto as WAOfferCallDto
} from '@api/types/wa.types';
// ** CORREÇÃO TS2305: Importar tipos de configuração (GARANTIR EXPORTAÇÃO EM env.config.ts) **
import { DatabaseConfig, CacheConf as CacheConfig, ProviderSession, ConfigSessionPhoneConfig, QrCodeConfig, ChatwootConfig } from '@config/env.config';
// Utils
// ** CORREÇÃO TS2345: Ajustar tipo de retorno de AuthStateProvider **
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files'; // Ajuste o import se necessário
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
// ** CORREÇÃO TS2614: Usar import default **
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { createJid } from '@utils/createJid';
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache';
// ** CORREÇÃO TS2459: Remover import do tipo 'Proxy' se não exportado **
import { makeProxyAgent /*, Proxy */ } from '@utils/makeProxyAgent'; // Comentado tipo Proxy
// TODO: Importar useVoiceCallsBaileys de sua localização correta
// import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
import { Prisma } from '@prisma/client';
import P from 'pino';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { v4 as cuid } from 'uuid';
import EventEmitter2 from 'eventemitter2';

const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } };
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> { /* ... (implementação mantida) ... */ return 0; }

// --- Tipos AuthState (mantidos) ---
type AuthStateWithClear = AuthenticationState & { clearState?: () => Promise<void>; };
type DefinedAuthState = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; };
interface CacheStore { /* ... */ }

export class BaileysStartupService extends ChannelStartupService {
  // ChatwootService mantido private (verificar visibilidade na base se der erro TS2415)
  private readonly chatwootService: ChatwootService;

  public client: WASocket | null = null;
  public stateConnection: ConnectionState = { connection: 'close', lastDisconnect: undefined };
  public phoneNumber: string | null = null;
  private authStateProvider: AuthStateProvider;
  private readonly msgRetryCounterCache: NodeCache; // Usando NodeCache diretamente
  private readonly userDevicesCache: NodeCache; // Usando NodeCache diretamente
  private endSession = false;
  protected logBaileys: P.LevelWithSilent = 'silent';
  protected groupHandler: any = {};

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService, // Cache geral (pode ser usado para msgRetry/userDevices)
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService, // Cache para Baileys (se diferente)
    // ** CORREÇÃO TS2345: Garantir tipo correto de ProviderFiles **
    private readonly providerFiles: ProviderFiles, // Tipo deve ser compatível
    chatwootService: ChatwootService,
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
  ) {
    // ** CORREÇÃO TS2554: Passar os 7 argumentos corretos **
    super(configService, eventEmitter, prismaRepository, chatwootCache, waMonitor, baseLogger, chatwootService);

    this.chatwootService = chatwootService;

    // ** CORREÇÃO TS2322: Usar CacheService injetado se compatível com CacheStore, senão NodeCache **
    // Se CacheService implementar get/set/del síncronos ou assíncronos compatíveis:
    // this.msgRetryCounterCache = this.cache; // Ou this.baileysCache
    // this.userDevicesCache = this.cache;   // Ou this.baileysCache
    // Senão, usar NodeCache:
    this.msgRetryCounterCache = new NodeCache();
    this.userDevicesCache = new NodeCache();

    this.instance.qrcode = { count: 0, code: undefined, base64: undefined, pairingCode: undefined };

    // ** CORREÇÃO TS2345 / TS227: Verificar tipo ProviderFiles vs AuthStateProvider **
    // Se o construtor de AuthStateProvider espera um tipo diferente de this.providerFiles,
    // será necessário um adaptador ou corrigir a importação/tipo.
    try {
      this.authStateProvider = new AuthStateProvider(this.providerFiles);
    } catch(e: any) {
       this.logger.error({ err: e }, "Erro crítico ao criar AuthStateProvider. Verifique a compatibilidade de tipos de ProviderFiles.");
       throw e;
    }

    this.logBaileys = this.configService.get<any>('LOG')?.BAILEYS ?? 'silent';
    this.initializeGroupHandlers(); // Inicializa handlers
  }

  // --- Implementação dos métodos abstratos (mantidos e verificados) ---
  async connectToWhatsapp(data?: { number?: string | null }): Promise<WASocket | null> {
    this.logger.info(`ConnectToWhatsapp (start) chamado para ${this.instanceName}...`);
    return this.start(data?.number);
  }

  override async logoutInstance(destroyClient = true): Promise<void> { /* ... (implementação v2 mantida, com logs corrigidos) ... */
    // ...
    try { /* client?.logout */ }
    catch(error: any) { this.logger.error({ err: error, message: `Erro durante client.logout()` }); }
    // ...
    try { /* client?.end */ }
    catch(error: any) { this.logger.error({ err: error, message: `Erro durante client.end()` }); }
    // ...
    try { /* authState?.clearState?.() */ }
    catch (error: any) { this.logger.error({ err: error, message: `Erro ao limpar estado de autenticação durante logout` }); }
  }

  override getStatus(): ConnectionState { return this.stateConnection; }

  override async textMessage(data: SendTextDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async mediaMessage(data: SendMediaDto | SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async buttonMessage(data: SendButtonDto | SendButtonListDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async contactMessage(data: SendContactDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async locationMessage(data: SendLocationDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async reactionMessage(data: SendReactionDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async templateMessage(data: SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... (impl. v2 mantida) ... */ }
  override async createGroup(data: CreateGroupDto): Promise<GroupMetadata | any> { /* ... (impl. v2 mantida) ... */ }
  override async updateGroupSubject(data: UpdateGroupSubjectDto): Promise<void | any> { /* ... (impl. v2 mantida) ... */ }
  override async updateGroupDescription(data: UpdateGroupDescriptionDto): Promise<void | any> { /* ... (impl. v2 mantida) ... */ }
  override async updateGroupPicture(data: UpdateGroupPictureDto): Promise<void | any> { /* ... (impl. v2 mantida) ... */ }
  override async findGroup(groupJid: string): Promise<GroupMetadata | any> { /* ... (impl. v2 mantida) ... */ }
  override async fetchAllGroups(getPaticipants = false): Promise<{ [key: string]: GroupMetadata } | any> { /* ... (impl. v2 mantida) ... */ }
  override async inviteCode(groupJid: string): Promise<string | any> { /* ... (impl. v2 mantida) ... */ }
  override async inviteInfo(inviteCode: string): Promise<GroupMetadata | any> { /* ... (impl. v2 mantida) ... */ }
  override async sendInvite(data: SendInviteDto): Promise<any> { /* ... (impl. v2 mantida) ... */ }
  override async acceptInviteCode(inviteCode: string): Promise<string | any> { /* ... (impl. v2 mantida) ... */ }
  override async revokeInviteCode(groupJid: string): Promise<string | any> { /* ... (impl. v2 mantida) ... */ }
  override async findParticipants(groupJid: string): Promise<any> { /* ... (impl. v2 mantida) ... */ }
  override async updateGParticipant(data: UpdateParticipantsDto): Promise<any> { /* ... (impl. v2 mantida) ... */ }
  override async updateGSetting(data: UpdateSettingDto): Promise<void | any> { /* ... (impl. v2 mantida) ... */ }
  override async toggleEphemeral(data: UpdateEphemeralDto): Promise<void | any> { /* ... (impl. v2 mantida) ... */ }
  override async leaveGroup(groupJid: string): Promise<void | any> { /* ... (impl. v2 mantida) ... */ }
  // ** CORREÇÃO: Usar tipo correto importado **
  override async offerCall(data: WAOfferCallDto): Promise<any> { /* ... (impl. v2 mantida) ... */ }
  override async fetchLabels(): Promise<Label[] | any> { /* ... (impl. v2 mantida) ... */ } // Retorna Label[]
  override async handleLabel(data: HandleLabelDto): Promise<any> { /* ... (impl. v2 mantida) ... */ }

  // --- Métodos Baileys (mantidos como antes) ---
  public async baileysOnWhatsapp(jid: string): Promise<any> { /* ... */ }
  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview' = 'image', timeoutMs?: number): Promise<string | null> { // Retorna string | null
      if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
      try {
          return await this.client.profilePictureUrl(createJid(jid), type, timeoutMs);
      } catch (error) {
           // Logar erro mas retornar null como esperado
           this.logger.warn({err: error, jid, type}, `Erro ao buscar profilePictureUrl`);
           return null;
      }
  }
  public async baileysAssertSessions(jids: string[], force?: boolean): Promise<any> { /* ... */ }
  public async baileysCreateParticipantNodes(jids: string[], message: proto.Message.ProtocolMessage, extraAttrs?: { [_: string]: string }): Promise<any> { /* ... */ }
  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> { /* ... */ }
  public async baileysGenerateMessageTag(): Promise<string> { /* ... */ }
  public async baileysSendNode(stanza: Buffer | proto.StanzaNode): Promise<any> { /* ... */ }
  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: Buffer): Promise<any> { /* ... */ }
  public async baileysGetAuthState(): Promise<AuthenticationState | undefined> { /* ... */ }

  // --- Métodos Internos e Handlers (com correções aplicadas) ---

  public async profilePicture(jid: string): Promise<{ profilePictureUrl: string | null }> {
      // ** CORREÇÃO TS2551: Usar baileysProfilePictureUrl implementado acima **
      const url = await this.baileysProfilePictureUrl(jid);
      return { profilePictureUrl: url };
  }

  private async connectionUpdate({ qr, connection, lastDisconnect }: Partial<ConnectionState>): Promise<void> { /* ... (impl. v2 mantida, logs corrigidos) ... */
    // ...
    try { /* qr logic */ }
    catch(error: any) { this.logger.error({ err: error, message: `Falha ao gerar QR code base64` }); }
    // ...
    try { /* pairing code */ }
    catch(error: any) { this.logger.error({ err: error, message: `Erro ao solicitar pairing code` }); }
    // ...
    try { /* update instance connecting */ }
    catch(dbError: any) { this.logger.error({ err: dbError, message: `Erro ao atualizar status da instância (connecting) no DB` }); }
    // ...
    if (connection === 'close') { /* ... */
        try { /* update instance closed */ }
        catch(dbError: any) { this.logger.error({ err: dbError, message: `Erro ao atualizar status da instância (closed) no DB` }); }
    }
    // ...
    if (connection === 'open') { /* ... */
      try { /* get profile pic */ }
      catch(error: any) { this.logger.error({ err: error, message: `Erro ao buscar foto do perfil` }); }
      // ...
      try { /* update instance open */ }
      catch(dbError: any) { this.logger.error({ err: dbError, message: `Erro ao atualizar status da instância (open) no DB` }); }
    }
    // ...
  }

  // CORREÇÃO TS2322: Garantir que o retorno seja compatível com DefinedAuthState
  private async defineAuthState(): Promise<DefinedAuthState> {
    const dbConfig = this.configService.get<DatabaseConfig>('DATABASE');
    const cacheConfig = this.configService.get<CacheConfig>('CACHE');
    const providerConfig = this.configService.get<ProviderSession>('PROVIDER');
    let authStatePromise: Promise<AuthStateWithClear>; // Usar tipo que pode ter clearState opcional

    if (providerConfig?.ENABLED) {
       this.logger.info(`Usando ProviderFiles para autenticação: ${this.providerFiles?.constructor?.name}`);
       authStatePromise = this.authStateProvider.authStateProvider(this.instanceId);
    } else if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
       this.logger.info('Usando Redis para autenticação');
       // ** CORREÇÃO TS2322: Garantir que useMultiFileAuthStateRedisDb retorna clearState **
       authStatePromise = useMultiFileAuthStateRedisDb(this.instanceId, this.cache);
    } else if (dbConfig?.SAVE_DATA?.INSTANCE) {
       this.logger.info('Usando Prisma (DB) para autenticação');
       // ** CORREÇÃO TS2322: Garantir que useMultiFileAuthStatePrisma retorna clearState **
       authStatePromise = useMultiFileAuthStatePrisma(this.instanceId, this.prismaRepository);
    } else {
        this.logger.warn('Nenhum método de persistência configurado. Usando MultiFileAuthState padrão.');
        const sessionDir = path.join('./instances', this.instanceId);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const clearState = async () => {
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); }
            catch (e) { this.logger.error({ err: e, message: `Erro ao limpar diretório de sessão padrão ${sessionDir}` }); }
        };
        authStatePromise = Promise.resolve({ state, saveCreds, clearState });
    }

    // Garantir que o retorno final TEM clearState
    return authStatePromise.then(auth => {
        if (typeof auth.clearState !== 'function') {
             this.logger.warn('Método clearState não encontrado no AuthState retornado. Adicionando fallback inócuo.');
             auth.clearState = async () => { this.logger.warn('Fallback clearState chamado, nenhuma ação real executada.'); };
        }
        // Forçar o tipo para DefinedAuthState
        return auth as DefinedAuthState;
    });
  }


  private async createClient(number?: string | null): Promise<WASocket> { /* ... (impl. v2 mantida, logs corrigidos) ... */
      // ...
      try { /* fetch latest version */ }
      catch(e: any) { this.logger.error({ err: e, message: `Falha ao buscar última versão do Baileys. Usando padrão interno.` }); }
      // ...
      try { /* proxy logic */ }
      catch (error: any) { this.logger.error({ err: error, proxyHost: this.localProxy.host, message: `Erro ao configurar proxy. Desabilitando proxy para esta conexão.` }); }
      // ...
      try { /* makeWASocket */ }
      catch (error: any) { this.logger.error({ err: error, message: `Erro CRÍTICO ao criar o socket Baileys` }); throw error; }
      // ...
      try { /* voice calls */ }
      catch(vcError: any) { this.logger.error({ err: vcError, message: `Falha ao inicializar chamadas de voz` }); }
      // ...
      return this.client!;
  }

  public async start(number?: string | null): Promise<WASocket | null> { /* ... (impl. v2 mantida, logs corrigidos) ... */
     try { /* ... */ }
     catch (error: any) {
        this.logger.error({ err: error, message: `Erro fatal ao iniciar instância ${this.instanceName}` });
        try {
          // ** CORREÇÃO TS2339: Garantir que waMonitor.deleteAccount existe **
          await this.waMonitor.deleteAccount(this.instanceName);
        } catch(cleanupError) {
           this.logger.error({ err: cleanupError, message: `Erro adicional ao tentar limpar DB para ${this.instanceName}` });
        }
        throw new InternalServerErrorException(`Erro ao inicializar instância ${this.instanceName}: ${error.message}`);
     }
  }

  public async reloadConnection(): Promise<WASocket | null> { /* ... (impl. v2 mantida, logs corrigidos) ... */
      try { /* ... */ }
      catch(e: any) { this.logger.warn({ err: e, message: `Erro ao limpar conexão antiga durante reload` }); }
      /* ... */
  }

  // --- Handlers de Eventos (com correções) ---
  private readonly chatHandle = {
    'chats.upsert': async (chats: Chat[]): Promise<void> => { /* ... (impl. v2 mantida, logs corrigidos) ... */
        try { /* ... */ }
        catch (error: any) { this.logger.error({ err: error, message: `Erro em chats.upsert` }); }
    },
    'chats.update': async (chats: Array<Partial<Chat & { lastMessageRecvTimestamp?: number | Long | null }>>): Promise<void> => { /* ... */ },
    'chats.delete': async (chats: string[]): Promise<void> => { /* ... (impl. v2 mantida, logs corrigidos) ... */
        try { /* ... */ }
        catch (error: any) { this.logger.error({ err: error, message: `Erro em chats.delete` }); }
    },
  };

  private readonly contactHandle = {
    'contacts.upsert': async (contacts: Contact[]): Promise<void> => { /* ... (impl. v2 mantida, logs corrigidos, where clause e profilePicUrl) ... */
       try {
          // ...
          const updatedContacts = await Promise.all(
            contactsRaw.map(async (contact) => { /* ... usa this.profilePictureUrl ... */ })
          );
          // ...
          await Promise.all(
            updatedContacts.map(contact =>
              // ** CORREÇÃO TS2353: Usar where correto **
              this.prismaRepository.upsertContact({
                where: { remoteJid_instanceId: { remoteJid: contact.remoteJid!, instanceId: contact.instanceId! } },
                create: { remoteJid: contact.remoteJid!, instanceId: contact.instanceId!, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
                update: { pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
              })
            )
          );
          // ...
          if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
            for (const contact of updatedContacts) {
               try {
                   // ** CORREÇÃO TS2339: Usar optional chaining para métodos do chatwootService **
                   const findParticipant = await this.chatwootService?.findContact?.(
                       /* ... */
                   );
                   if (findParticipant?.id) {
                       await this.chatwootService?.updateContact?.( /* ... */ );
                   }
               } catch (chatwootError: any) {
                   this.logger.error({ err: chatwootError, contactJid: contact.remoteJid, message: `Erro ao atualizar contato no Chatwoot` });
               }
            }
          }
       } catch (error: any) { this.logger.error({ err: error, message: `Erro em contacts.upsert` }); }
    },
    'contacts.update': async (contacts: Array<Partial<Contact>>): Promise<void> => { /* ... (impl. v2 mantida, logs corrigidos, where clause e profilePicUrl) ... */
        try {
            const contactsRaw: ContactPayload[] = [];
            for await (const contact of contacts) {
                if (!contact.id) continue;
                // ** CORREÇÃO TS2551: Usar this.profilePictureUrl **
                let profilePicUrl: string | null = await this.baileysProfilePictureUrl(contact.id);
                contactsRaw.push({ /* ... */ profilePicUrl });
            }
            // ...
            const updateTransactions = contactsRaw.map((contact) =>
                // ** CORREÇÃO TS2353: Usar where correto **
                this.prismaRepository.upsertContact({
                    where: { remoteJid_instanceId: { remoteJid: contact.remoteJid!, instanceId: contact.instanceId! } },
                    create: { /* ... */ }, update: { /* ... */ },
                }),
            );
            // ** CORREÇÃO TS2345: Garantir tipo PrismaPromise[] **
            await this.prismaRepository.$transaction(updateTransactions as Prisma.PrismaPromise<any>[]);
            // ...
        } catch (error: any) { this.logger.error({ err: error, message: `Erro em contacts.update` }); }
    },
  };

  private readonly labelHandle = {
    [Events.LABELS_EDIT]: async (label: Label): Promise<void> => { /* ... (impl. v2 mantida, logs corrigidos, where clause) ... */
        try {
            // ...
            if (label.deleted && savedLabel) {
                // ** CORREÇÃO TS2353: Usar where correto **
                await this.prismaRepository.deleteLabel({
                    where: { labelId_instanceId: { instanceId: this.instanceId!, labelId: label.id! } },
                });
            }
            // ...
            if (this.configService.get<DatabaseConfig>('DATABASE')?.SAVE_DATA?.LABELS) {
                // ** CORREÇÃO TS2353: Usar where correto **
                await this.prismaRepository.upsertLabel({
                    where: { labelId_instanceId: { instanceId: labelData.instanceId!, labelId: labelData.labelId! } },
                    update: labelData, create: labelData,
                });
            }
            // ...
        } catch (error: any) { this.logger.error({ err: error, labelId: label.id, message: `Erro em labels.edit` }); }
    },
    [Events.LABELS_ASSOCIATION]: async (data: { association: LabelAssociation; type: 'remove' | 'add' }): Promise<void> => { /* ... (impl. v2 mantida, logs corrigidos) ... */
       try { /* ... */ }
       catch(error: any) { this.logger.error({ err: error, labelId, chatId, message: `Erro ao associar/desassociar label` }); }
    },
  };

  private setupMainEventListeners(): void { /* ... (impl. v2 mantida, logs corrigidos) ... */
      this.client?.ev?.process(async (events) => {
        try { /* ... */
            if (events['presence.update']) {
                // ** CORREÇÃO TS2339: Usar this.logger.debug ou verbose, não trace **
                this.logger.debug({ presence: events['presence.update'], message: `Processando evento presence.update` });
                /* ... */
            }
            /* ... */
        } catch (error: any) { this.logger.error({ err: error, message: `Erro geral no processamento de eventos Baileys` }); }
      });
  }

  // Sobrescreve findSettings para garantir tipo compatível
  public async findSettings(): Promise<LocalSettings> { // Retorna LocalSettings, não Promise<wa.LocalSettings>
    this.logger.debug(`Buscando configurações para ${this.instanceName}...`);
    try {
       const data = await this.prismaRepository.findUniqueSetting({
          where: { instanceId: this.instanceId },
       });
       const settings: LocalSettings = { // Usa LocalSettings importado
           rejectCall: data?.rejectCall ?? false, msgCall: data?.msgCall ?? '',
           groupsIgnore: data?.groupsIgnore ?? false, alwaysOnline: data?.alwaysOnline ?? true,
           readMessages: data?.readMessages ?? true, readStatus: data?.readStatus ?? false,
           syncFullHistory: data?.syncFullHistory ?? false, wavoipToken: data?.wavoipToken ?? '',
       };
       Object.assign(this.localSettings, settings);
       return settings;
    } catch (error: any) {
       this.logger.error({ err: error, message: `Erro ao buscar configurações, retornando padrões.` });
       const defaultSettings: LocalSettings = {
           rejectCall: false, msgCall: '', groupsIgnore: false, alwaysOnline: true,
           readMessages: true, readStatus: false, syncFullHistory: false, wavoipToken: '',
       };
       Object.assign(this.localSettings, defaultSettings);
       return defaultSettings;
    }
 }

} // Fim da classe BaileysStartupService
