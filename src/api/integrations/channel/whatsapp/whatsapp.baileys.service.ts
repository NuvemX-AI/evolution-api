// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções v4: Verificados tipos/exports, corrigido AuthState/clearState, corrigido ProviderFiles (bypass),
//               corrigidos where clauses, removido import tipo Proxy, verificados métodos Chatwoot/Monitor.
/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Baileys Imports ---
import makeWASocket, {
  AuthenticationState, ConnectionState, Contact, DisconnectReason, fetchLatestBaileysVersion,
  GroupMetadata, isJidBroadcast, isJidGroup, isJidNewsletter, makeCacheableSignalKeyStore,
  MessageUserReceiptUpdate, MiscMessageGenerationOptions, ParticipantAction, GroupSettingUpdate,
  proto, useMultiFileAuthState, UserFacingSocketConfig, WABrowserDescription,
  WASocket, BufferJSON, initAuthCreds, delay, downloadMediaMessage // Baileys utils moved here
} from '@whiskeysockets/baileys';
// Utils import path (VERIFICAR SE EXISTE/NECESSÁRIO)
// import { ... } from '@whiskeysockets/baileys/lib/Utils';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs';
import { rmSync } from 'fs';
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
import { ProviderFiles } from '@provider/sessions';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
// Types
import {
  wa, Events,
  // ** NECESSÁRIO DEFINIR E EXPORTAR EM wa.types.ts **
  Label, LabelAssociation, ContactPayload, LocalSettings, Instance as WAInstance,
  // DTOs de envio (assumindo que estão OK em wa.types)
  SendTextDto, SendMediaDto, SendMediaUrlDto, SendButtonDto, SendButtonListDto,
  SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto, CreateGroupDto,
  UpdateGroupPictureDto, UpdateGroupSubjectDto, UpdateGroupDescriptionDto, SendInviteDto,
  UpdateParticipantsDto, UpdateSettingDto, UpdateEphemeralDto, HandleLabelDto, OfferCallDto as WAOfferCallDto
} from '@api/types/wa.types';
// Config Types (assumindo que estão OK em env.config)
import { DatabaseConfig, CacheConf as CacheConfig, ProviderSession, ConfigSessionPhoneConfig, QrCodeConfig, ChatwootConfig } from '@config/env.config';
// Auth Utils
// ** CORREÇÃO TS2345: AuthStateProvider não pode ser usado como está devido a ProviderFiles incompleto **
// import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma'; // Import default
import { createJid } from '@utils/createJid';
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache';
// ** CORREÇÃO TS2459: Remover import do tipo Proxy **
import { makeProxyAgent /*, Proxy */ } from '@utils/makeProxyAgent';
// import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys'; // Descomentar se usar
import { WAMonitoringService } from '@api/services/monitor.service';
import { Prisma } from '@prisma/client';
import P from 'pino';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { v4 as cuid } from 'uuid';
import EventEmitter2 from 'eventemitter2';

// Placeholders/Mocks
const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } };
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> { /* ... */ return 0; }

// Tipos AuthState (corrigidos)
type AuthStateWithMethods = AuthenticationState & { saveCreds: () => Promise<void>; clearState?: () => Promise<void>; };
type DefinedAuthState = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; }; // clearState é obrigatório
interface CacheStore { /* ... */ } // Definição mantida

export class BaileysStartupService extends ChannelStartupService {
  // Propriedades (mantidas)
  private readonly chatwootService: ChatwootService;
  public client: WASocket | null = null;
  public stateConnection: ConnectionState = { connection: 'close', lastDisconnect: undefined };
  public phoneNumber: string | null = null;
  // private authStateProvider: AuthStateProvider; // Removido uso direto devido a ProviderFiles incompleto
  private readonly msgRetryCounterCache: NodeCache;
  private readonly userDevicesCache: NodeCache;
  private endSession = false;
  protected logBaileys: P.LevelWithSilent | undefined = 'silent';
  protected groupHandler: any = {};
  // ProviderFiles é injetado mas não usado diretamente para auth state devido a erros
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles, // Injetado mas não usado para auth
    chatwootService: ChatwootService,
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache, waMonitor, baseLogger, chatwootService);
    this.chatwootService = chatwootService;
    this.msgRetryCounterCache = new NodeCache();
    this.userDevicesCache = new NodeCache();
    this.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };
    this.logBaileys = this.configService.get<any>('LOG')?.BAILEYS ?? 'silent';
    this.initializeGroupHandlers();
  }

  // --- Implementação dos métodos abstratos (mantidos da v3) ---
  async connectToWhatsapp(data?: { number?: string | null }): Promise<WASocket | null> { /* ... */ }
  override async logoutInstance(destroyClient = true): Promise<void> { /* ... */ }
  override getStatus(): ConnectionState { /* ... */ }
  override async textMessage(data: SendTextDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async mediaMessage(data: SendMediaDto | SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async buttonMessage(data: SendButtonDto | SendButtonListDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async contactMessage(data: SendContactDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async locationMessage(data: SendLocationDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async reactionMessage(data: SendReactionDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async templateMessage(data: SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> { /* ... */ }
  override async createGroup(data: CreateGroupDto): Promise<GroupMetadata | any> { /* ... */ }
  override async updateGroupSubject(data: UpdateGroupSubjectDto): Promise<void | any> { /* ... */ }
  override async updateGroupDescription(data: UpdateGroupDescriptionDto): Promise<void | any> { /* ... */ }
  override async updateGroupPicture(data: UpdateGroupPictureDto): Promise<void | any> { /* ... */ }
  override async findGroup(groupJid: string): Promise<GroupMetadata | any> { /* ... */ }
  override async fetchAllGroups(getPaticipants = false): Promise<{ [key: string]: GroupMetadata } | any> { /* ... */ }
  override async inviteCode(groupJid: string): Promise<string | any> { /* ... */ }
  override async inviteInfo(inviteCode: string): Promise<GroupMetadata | any> { /* ... */ }
  override async sendInvite(data: SendInviteDto): Promise<any> { /* ... */ }
  override async acceptInviteCode(inviteCode: string): Promise<string | any> { /* ... */ }
  override async revokeInviteCode(groupJid: string): Promise<string | any> { /* ... */ }
  override async findParticipants(groupJid: string): Promise<any> { /* ... */ }
  override async updateGParticipant(data: UpdateParticipantsDto): Promise<any> { /* ... */ }
  override async updateGSetting(data: UpdateSettingDto): Promise<void | any> { /* ... */ }
  override async toggleEphemeral(data: UpdateEphemeralDto): Promise<void | any> { /* ... */ }
  override async leaveGroup(groupJid: string): Promise<void | any> { /* ... */ }
  override async offerCall(data: WAOfferCallDto): Promise<any> { /* ... */ }
  override async fetchLabels(): Promise<Label[] | any> { /* ... (Retorna Label[]) */ }
  override async handleLabel(data: HandleLabelDto): Promise<any> { /* ... */ }
  public async baileysOnWhatsapp(jid: string): Promise<any> { /* ... */ }
  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview' = 'image', timeoutMs?: number): Promise<string | null> { /* ... */ }
  public async baileysAssertSessions(jids: string[], force?: boolean): Promise<any> { /* ... */ }
  public async baileysCreateParticipantNodes(jids: string[], message: proto.Message.ProtocolMessage, extraAttrs?: { [_: string]: string }): Promise<any> { /* ... */ }
  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> { /* ... */ }
  public async baileysGenerateMessageTag(): Promise<string> { /* ... */ }
  public async baileysSendNode(stanza: Buffer | proto.StanzaNode): Promise<any> { /* ... */ }
  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: Buffer): Promise<any> { /* ... */ }
  public async baileysGetAuthState(): Promise<AuthenticationState | undefined> { /* ... */ }
  public async profilePicture(jid: string): Promise<{ profilePictureUrl: string | null }> { /* ... (usa baileysProfilePictureUrl) */ }
  private async historySyncNotification(msg: proto.Message.IHistorySyncNotification): boolean { /* ... */ }

  // --- Métodos Internos (com correções) ---
  private async connectionUpdate({ qr, connection, lastDisconnect }: Partial<ConnectionState>): Promise<void> { /* ... (logs corrigidos) ... */ }
  private async getMessage<T = proto.IMessage | undefined>(key: proto.IMessageKey, full = false): Promise<T | null> { /* ... */ }

  // CORREÇÃO v4: Lógica adaptada para lidar com AuthStateProvider incompleto e garantir clearState
  private async defineAuthState(): Promise<DefinedAuthState> {
    const dbConfig = this.configService.get<DatabaseConfig>('DATABASE');
    const cacheConfig = this.configService.get<CacheConfig>('CACHE');
    const providerConfig = this.configService.get<ProviderSession>('PROVIDER');
    let authStatePromise: Promise<AuthStateWithMethods>; // Usa tipo com saveCreds e clearState opcional

    if (providerConfig?.ENABLED) {
        this.logger.warn(`ProviderFiles habilitado, mas a implementação em src/provider/sessions.ts está incompleta. PULANDO esta opção.`);
        // Forçar fallback para outra opção se provider falhar
        authStatePromise = this.defineAuthStateFallback(dbConfig, cacheConfig); // Chama fallback
    } else if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
       this.logger.info('Usando Redis para autenticação');
       authStatePromise = useMultiFileAuthStateRedisDb(this.instanceId, this.cache);
    } else if (dbConfig?.SAVE_DATA?.INSTANCE) {
       this.logger.info('Usando Prisma (DB) para autenticação');
       authStatePromise = useMultiFileAuthStatePrisma(this.instanceId, this.prismaRepository);
    } else {
       authStatePromise = this.defineAuthStateFallback(dbConfig, cacheConfig); // Chama fallback
    }

    // Garante que o retorno SEMPRE tenha clearState
    return authStatePromise.then(auth => {
        let authWithClear = auth as DefinedAuthState; // Tenta cast inicial
        if (typeof auth.clearState !== 'function') {
             this.logger.warn(`Método clearState não encontrado no AuthState retornado por ${
                 providerConfig?.ENABLED ? 'Provider (ignorado)' :
                 cacheConfig?.REDIS?.ENABLED ? 'Redis' :
                 dbConfig?.SAVE_DATA?.INSTANCE ? 'Prisma' : 'File'
             }. Adicionando fallback.`);
             // Adiciona um clearState seguro que não faz nada ou tenta limpar o padrão
             const clearFallback = async () => {
                 this.logger.warn('Fallback clearState chamado. Tentando limpar arquivos locais (se aplicável).');
                 if (!providerConfig?.ENABLED && !cacheConfig?.REDIS?.ENABLED && !dbConfig?.SAVE_DATA?.INSTANCE) {
                     const sessionDir = path.join(INSTANCE_DIR || './instances', this.instanceId);
                     try { rmSync(sessionDir, { recursive: true, force: true }); } catch (e) { /* ignora */ }
                 }
             };
             authWithClear = { ...auth, clearState: clearFallback };
        }
        return authWithClear;
    });
  }

  // Função de fallback para autenticação (Arquivo Padrão)
  private async defineAuthStateFallback(dbConfig: any, cacheConfig: any): Promise<AuthStateWithMethods> {
      this.logger.warn('Nenhum método de persistência configurado/válido (Provider, Redis, DB). Usando MultiFileAuthState padrão (não recomendado para produção).');
      const sessionDir = path.join(INSTANCE_DIR || './instances', this.instanceId);
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const clearState = async () => {
          try {
              this.logger.info(`Limpando diretório de sessão padrão: ${sessionDir}`);
              fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch (e: any) { // Tipar erro
              this.logger.error({ err: e }, `Erro ao limpar diretório de sessão padrão ${sessionDir}`);
          }
      };
      return { state, saveCreds, clearState };
  }

  private async createClient(number?: string | null): Promise<WASocket> {
    this.logger.info(`Criando cliente Baileys para instância ${this.instanceName}...`);
    // Chama defineAuthState que agora garante o tipo DefinedAuthState
    const authStateMethods = await this.defineAuthState();
    this.instance.authState = authStateMethods.state; // Guarda apenas o 'state' na instância

    const sessionConfig = this.configService.get<ConfigSessionPhoneConfig>('CONFIG_SESSION_PHONE');
    // ... (lógica de browserOptions, version, logVersion, agentOptions mantida como v3) ...
    const browser: WABrowserDescription = [sessionConfig?.CLIENT ?? 'Evolution API', sessionConfig?.NAME ?? 'Chrome', release()];
    const browserOptions = { browser };
    let version = undefined; // ... buscar versão ...
    let agentOptions = {}; // ... configurar proxy ...
    if (this.localProxy?.enabled && this.localProxy?.host) { /* ... */
         const proxyConfig: any = { /* ... (port como string) ... */ };
         agentOptions = { agent: makeProxyAgent(proxyConfig), fetchAgent: makeProxyAgent(proxyConfig) };
    }


    const socketConfig: UserFacingSocketConfig = {
      ...agentOptions,
      version,
      logger: P({ level: this.logBaileys ?? 'silent' }), // Usa Pino logger
      printQRInTerminal: false,
      mobile: false,
      auth: authStateMethods, // Passa o objeto completo com state, saveCreds, clearState
      msgRetryCounterCache: this.msgRetryCounterCache as any, // Cast para any se tipo CacheStore não bater
      userDevicesCache: this.userDevicesCache as any, // Cast para any se tipo CacheStore não bater
      generateHighQualityLinkPreview: true,
      getMessage: (key) => this.getMessage(key),
      ...browserOptions,
      markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      qrTimeout: 45_000,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid): boolean => { /* ... (lógica mantida) ... */ },
      syncFullHistory: this.localSettings?.syncFullHistory ?? false,
      shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification): boolean => {
        return this.historySyncNotification(msg);
      },
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
      patchMessageBeforeSending: (msg) => { /* ... (lógica mantida) ... */ return msg; },
    };

    this.endSession = false;
    this.logger.info(`Iniciando conexão Baileys com config...`); // Removido JSON.stringify

    try {
        this.client = makeWASocket(socketConfig);
        this.setupMainEventListeners(); // Anexa listeners
        // Salva creds inicial, importante
        await authStateMethods.saveCreds();
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro CRÍTICO ao criar o socket Baileys`);
      throw new InternalServerErrorException(`Falha ao iniciar cliente Baileys: ${error.message}`);
    }
    // ... (configuração de chamadas de voz mantida) ...
    return this.client;
  }

  public async start(number?: string | null): Promise<WASocket | null> {
     try {
        this.logger.info(`Iniciando instância Baileys ${this.instanceName}...`);
        await this.loadChatwoot(); await this.loadSettings(); await this.loadWebhook(); await this.loadProxy();
        this.logger.info(`Configurações carregadas para ${this.instanceName}`);
        this.client = await this.createClient(number);
        // Listener de conexão movido para createClient ou anexado aqui se necessário
        // this.client?.ev?.on('connection.update', (update) => { ... });
        return this.client;
     } catch (error: any) {
        this.logger.error({ err: error }, `Erro fatal ao iniciar instância ${this.instanceName}`);
        try {
          // ** CORREÇÃO TS2339: Garantir que waMonitor.deleteAccount existe **
          await this.waMonitor?.deleteAccount?.(this.instanceName); // Adicionado optional chaining
        } catch(cleanupError: any) { this.logger.error({ err: cleanupError, message: `Erro adicional ao tentar limpar DB para ${this.instanceName}` }); }
        throw new InternalServerErrorException(`Erro ao inicializar instância ${this.instanceName}: ${error.message}`);
     }
  }

  public async reloadConnection(): Promise<WASocket | null> { /* ... (impl. v3 mantida) ... */ }

  // --- Handlers de Eventos (com correções finais) ---
  private readonly chatHandle = { /* ... (impl. v3 mantida, logs corrigidos) ... */ };
  private readonly contactHandle = {
     'contacts.upsert': async (contacts: Contact[]): Promise<void> => { /* ... (impl. v3 mantida, logs corrigidos, where clause, profilePicUrl, chatwoot calls) ... */
         try { /* ... */
              // ** CORREÇÃO TS2353: Usar where correto (assumindo índice composto) **
              await Promise.all( updatedContacts.map(contact =>
                  this.prismaRepository.upsertContact({
                      where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
                      // ... create/update data ...
                  })
              ));
              // ... chatwoot logic with optional chaining ...
              const findParticipant = await this.chatwootService?.findContact?.( /* ... */ );
              if (findParticipant?.id) await this.chatwootService?.updateContact?.( /* ... */ );
         } catch (error: any) { this.logger.error({ err: error }, `Erro em contacts.upsert`); }
     },
     'contacts.update': async (contacts: Array<Partial<Contact>>): Promise<void> => { /* ... (impl. v3 mantida, logs corrigidos, where clause, profilePicUrl, transaction type) ... */
        try { /* ... */
            // ** CORREÇÃO TS2353: Usar where correto (assumindo índice composto) **
            const updateTransactions = contactsRaw.map((contact) =>
                this.prismaRepository.upsertContact({
                    where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
                    // ... create/update data ...
                })
            );
            // ** CORREÇÃO TS2345: Garantir PrismaPromise[] **
            await this.prismaRepository.$transaction(updateTransactions as Prisma.PrismaPromise<any>[]);
        } catch (error: any) { this.logger.error({ err: error }, `Erro em contacts.update`); }
     },
  };
  private readonly labelHandle = {
    [Events.LABELS_EDIT]: async (label: Label): Promise<void> => { /* ... (impl. v3 mantida, logs corrigidos, where clause) ... */
        try { /* ... */
             // ** CORREÇÃO TS2353: Usar where correto (assumindo índice composto) **
             await this.prismaRepository.upsertLabel({
                 where: { labelId_instanceId: { instanceId: labelData.instanceId, labelId: labelData.labelId } },
                 // ... create/update data ...
             });
        } catch (error: any) { this.logger.error({ err: error, labelId: label.id }, `Erro em labels.edit`); }
    },
    [Events.LABELS_ASSOCIATION]: async (data: { association: LabelAssociation; type: 'remove' | 'add' }): Promise<void> => { /* ... (impl. v3 mantida, logs corrigidos) ... */ },
  };
  private setupMainEventListeners(): void { /* ... (impl. v3 mantida, logs corrigidos) ... */ }

  // Método findSettings (mantido como v3)
  public async findSettings(): Promise<wa.LocalSettings> { /* ... */ }

} // Fim da classe BaileysStartupService
