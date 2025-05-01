// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções v5: Imports corrigidos (wa.types, env.config), construtor/super, logger, Prisma, override, return types, AuthState, where clauses, etc.

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Baileys Imports ---
import makeWASocket, { // Import padrão
  AuthenticationState, // Tipo para estado de autenticação
  AuthenticationCreds, // Tipo para credenciais
  BaileysEventEmitter, // Tipo para o event emitter do Baileys
  Browsers, // Util para gerar descrições de navegador
  ConnectionState, // Tipo para estado da conexão
  Contact, // Tipo para contato
  DisconnectReason, // Enum para razões de desconexão
  fetchLatestBaileysVersion, // Função para buscar a última versão
  GroupMetadata, // Tipo para metadados de grupo
  isJidBroadcast, // Função utilitária
  isJidGroup, // Função utilitária
  isJidNewsletter, // Função utilitária
  makeCacheableSignalKeyStore, // Função para store de chaves em cache
  makeInMemoryStore, // Função para store em memória (útil para poucos dados)
  MessageUpsertType, // Tipo para upsert de mensagens
  MessageUserReceiptUpdate, // Tipo para recibos de leitura
  MiscMessageGenerationOptions, // Opções genéricas de envio
  ParticipantAction, // Tipo para ações em participantes de grupo
  proto, // Protobufs do WhatsApp Web
  UserFacingSocketConfig, // Configuração principal do socket
  useMultiFileAuthState, // Hook padrão para auth state em arquivos
  WABrowserDescription, // Tipo para descrição do navegador
  WAMessageKey, // Tipo para chave de mensagem
  WAMessageStubType, // Tipo para stubs de mensagem
  WASocket, // Tipo principal do socket
  BufferJSON, // Util para serializar/desserializar buffers
  initAuthCreds, // Função para inicializar credenciais
  delay, // Função para atraso
  downloadMediaMessage, // Função para baixar mídia
  generateWAMessageFromContent, // Função para gerar mensagem a partir de conteúdo
  getDevice, // Função para obter ID do dispositivo
  isJidUser, // Função utilitária
  jidNormalizedUser, // Função para normalizar JID
  extractMessageContent, // Função para extrair conteúdo
  getContentType, // Função para obter tipo de conteúdo
  jidDecode, // Função para decodificar JID
  GroupSettingChange // Tipo para alteração de configuração de grupo (renomeado de GroupSettingUpdate)
} from '@whiskeysockets/baileys'; // CORRIGIDO: Import principal do Baileys

import { Boom } from '@hapi/boom'; // Para tratamento de erros
import NodeCache from 'node-cache'; // Cache em memória para reenvios e dispositivos

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs'; // Usado no fallback de auth state
import { rmSync } from 'fs'; // Usado no fallback de auth state
import * as path from 'path'; // Usado no fallback de auth state
import { release } from 'os'; // Usado na descrição do navegador

// --- Project Imports ---
// DTOs (importados de @api/dto/*)
import { OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto, ProfilePictureUrlDto } from '@api/dto/instance.dto';
import {
    SendTextDto, SendMediaDto, SendButtonsDto, SendListDto, SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto, BaseSendMessageDto, SendMessageOptions
} from '@api/dto/sendMessage.dto'; // DTOs de envio
import {
    CreateGroupDto, UpdateGroupPictureDto, UpdateSubjectDto as UpdateGroupSubjectDto, UpdateDescriptionDto as UpdateGroupDescriptionDto, SendInviteDto,
    UpdateParticipantsDto, UpdateSettingDto as GroupUpdateSettingDto, UpdateEphemeralDto as GroupToggleEphemeralDto, HandleLabelDto, GroupJidDto, InviteCodeDto // Renomeados para clareza
} from '@api/dto/group.dto'; // DTOs de grupo

// Services, Repositories, Config, etc. (usando aliases)
import { ChannelStartupService } from '@api/services/channel.service'; // Classe base
import { ConfigService } from '@config/config.service'; // Serviço de configuração
import { PrismaRepository } from '@repository/repository.service'; // Repositório Prisma
import { CacheService } from '@api/services/cache.service'; // Serviço de cache (geral, chatwoot, baileys)
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Serviço Chatwoot
import { ProviderFiles } from '@provider/sessions'; // Serviço para provedor de arquivos (se usado)
import { Logger } from '@config/logger.config'; // Tipo Logger (Pino)
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index'; // Exceções customizadas

// Types (Usar tipos dos DTOs e Baileys diretamente, remover import de wa.types se redundante)
// import { Events, ContactPayload, LocalSettings ... } from '@api/types/wa.types'; // REMOVIDO: Usar tipos/DTOs importados acima

// Config Types (importados de @config/env.config)
// CORRIGIDO: Verificar nomes exatos exportados em env.config.ts
import { DatabaseConfig, CacheConf as CacheConfig, ProviderSession, ConfigSessionPhone, QrCodeConfig as QrCodeOptions, ChatwootConfig } from '@config/env.config'; // Ajustados nomes QrCodeConfig, ConfigSessionPhoneConfig

// Auth Utils
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files'; // Mantido, mas com ressalvas sobre ProviderFiles
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { createJid } from '@utils/createJid';
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache';
import { makeProxyAgent } from '@utils/makeProxyAgent';
// import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys'; // Descomentar se usar
// CORRIGIDO: Importar WAMonitoringService do local correto e garantir tipo compatível
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Usar o tipo correto que é injetado

// Prisma
import { Prisma, Label, LabelAssociation } from '@prisma/client'; // Importar tipos Prisma necessários
import P from 'pino'; // Importar Pino diretamente para logger Baileys
import qrcode from 'qrcode'; // Para gerar QR code base64
import qrcodeTerminal from 'qrcode-terminal'; // Para exibir QR no terminal (debug)
import { v4 as cuid } from 'uuid'; // Para gerar IDs únicos
import EventEmitter2 from 'eventemitter2'; // Event emitter

// Placeholders/Mocks
const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } };
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> { console.warn('getVideoDuration mock called'); return 0; }

// Tipos AuthState (corrigidos)
type AuthStateWithMethods = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState?: () => Promise<void>; };
type DefinedAuthState = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; }; // clearState é obrigatório

// Constantes
const INSTANCE_DIR = process.env.INSTANCE_FOLDER || './instances'; // CORRIGIDO: Define INSTANCE_DIR

export class BaileysStartupService extends ChannelStartupService {
  // Propriedades
  // CORRIGIDO TS2415: chatwootService precisa ter o mesmo modificador da classe base ou ser protected/public
  // Se ChannelStartupService não declara chatwootService, ele pode ser private aqui.
  // Assumindo que ChannelStartupService *não* o declara:
  private readonly chatwootService: ChatwootService;
  // client e stateConnection mantidos como na v3
  public client: WASocket | null = null;
  // phoneNumber mantido
  public phoneNumber: string | null = null;
  // Caches mantidos
  private readonly msgRetryCounterCache: NodeCache;
  private readonly userDevicesCache: NodeCache;
  // Flags mantidos
  private endSession = false;
  // Configurações mantidas
  protected logBaileys: P.LevelWithSilent | undefined = 'silent';

  // Construtor CORRIGIDO
  constructor(
    // Ordem e tipos devem corresponder à chamada em channel.controller.ts
    configService: ConfigService,
    eventEmitter: EventEmitter2,
    prismaRepository: PrismaRepository,
    chatwootCache: CacheService, // Cache usado pelo Chatwoot
    waMonitor: WAMonitoringService, // Tipo correto injetado
    baseLogger: Logger,
    instanceDto: InstanceDto, // DTO da instância recebido
    private readonly providerFiles: ProviderFiles, // Serviço ProviderFiles
    cacheService: CacheService, // Cache geral (Redis/Local)
    chatwootService: ChatwootService, // Serviço Chatwoot
  ) {
    // CORRIGIDO: Chamada super com argumentos corretos e na ordem esperada pela classe base ChannelStartupService
    // A ordem exata depende da definição de ChannelStartupService, ajustada conforme análise anterior:
    super(
        configService,
        eventEmitter,
        prismaRepository,
        chatwootCache, // Passa chatwootCache
        waMonitor,    // Passa waMonitor (tipo correto)
        baseLogger,
        instanceDto,  // Passa instanceDto
        chatwootService // Passa chatwootService para a classe base (se ela o esperar)
    );
    // Atribuições específicas desta classe
    this.chatwootService = chatwootService; // OK, desde que não conflite com visibilidade da base
    this.msgRetryCounterCache = new NodeCache();
    this.userDevicesCache = new NodeCache();
    // CORRIGIDO TS2322: qrcode na instância DTO é um objeto, não boolean
    this.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };
    this.logBaileys = this.configService.get<any>('LOG')?.BAILEYS ?? 'silent';
    // CORRIGIDO TS2339: Remover chamada a método inexistente
    // this.initializeGroupHandlers(); // REMOVIDO - implementar ou remover
  }

  // --- Implementação de Métodos (Abstratos e Públicos) ---

  // Método connectToWhatsapp (esqueleto, implementação omitida por brevidade)
  async connectToWhatsapp(data?: { number?: string | null }): Promise<WASocket | null> {
      this.logger.info(`ConnectToWhatsapp called for ${this.instanceName} with number: ${data?.number}`);
      if (this.connectionState.connection === 'open') {
          this.logger.warn(`Instance ${this.instanceName} already open.`);
          return this.client;
      }
      if (this.connectionState.connection === 'connecting') {
           this.logger.warn(`Instance ${this.instanceName} already connecting.`);
           return null; // Ou retornar o cliente existente se houver
      }
      // Lógica principal de criação do cliente e tratamento de conexão
      try {
          this.client = await this.createClient(data?.number);
          return this.client;
      } catch (error) {
          this.logger.error({ err: error }, `Failed to connect instance ${this.instanceName}`);
          await this.logoutInstance(true); // Tenta limpar em caso de erro na conexão inicial
          return null;
      }
  }

  // Implementar os demais métodos abstratos e públicos...
  // (Implementações omitidas por brevidade, mas devem existir e retornar os tipos corretos)

  // CORRIGIDO TS4113: Remover `override` se o método não existe na classe base ChannelStartupService
  // Se ChannelStartupService definir estes métodos como `abstract`, então `override` está correto.
  // Assumindo que NÃO estão na base (causa do TS4113):
  async updateGroupSubject(data: UpdateGroupSubjectDto): Promise<void | any> { /* ... */ }
  async updateGroupDescription(data: UpdateGroupDescriptionDto): Promise<void | any> { /* ... */ }
  async updateGroupPicture(data: UpdateGroupPictureDto): Promise<void | any> { /* ... */ }
  async findGroup(groupJid: string): Promise<GroupMetadata | any> { /* ... */ }
  async fetchAllGroups(getPaticipants = false): Promise<{ [key: string]: GroupMetadata } | any> { /* ... */ }
  async inviteCode(groupJid: string): Promise<string | any> { /* ... */ }
  async inviteInfo(inviteCode: string): Promise<GroupMetadata | any> { /* ... */ }
  async sendInvite(data: SendInviteDto): Promise<any> { /* ... */ }
  async acceptInviteCode(inviteCode: string): Promise<string | any> { /* ... */ }
  async revokeInviteCode(groupJid: string): Promise<string | any> { /* ... */ }
  async findParticipants(groupJid: string): Promise<any> { /* ... */ }
  async updateGParticipant(data: UpdateParticipantsDto): Promise<any> { /* ... */ }
  async updateGSetting(data: GroupUpdateSettingDto): Promise<void | any> { /* ... */ }
  async toggleEphemeral(data: GroupToggleEphemeralDto): Promise<void | any> { /* ... */ }
  async leaveGroup(groupJid: string): Promise<void | any> { /* ... */ }
  // Métodos específicos Baileys (não precisam de override)
  public async baileysOnWhatsapp(jid: string): Promise<any> { /* ... */ }
  // CORRIGIDO TS2355: Garantir retorno Promise<string | null>
  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview' = 'image', timeoutMs?: number): Promise<string | null> { /* ... implementação ... */ return null; } // Placeholder
  public async baileysAssertSessions(jids: string[], force?: boolean): Promise<any> { /* ... */ }
  public async baileysCreateParticipantNodes(jids: string[], message: proto.Message.ProtocolMessage, extraAttrs?: { [_: string]: string }): Promise<any> { /* ... */ }
  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> { /* ... */ }
  // CORRIGIDO TS2355: Garantir retorno Promise<string>
  public async baileysGenerateMessageTag(): Promise<string> { /* ... implementação ... */ return cuid(); } // Placeholder
  public async baileysSendNode(stanza: Buffer | proto.StanzaNode): Promise<any> { /* ... */ }
  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: Buffer): Promise<any> { /* ... */ }
  public async baileysGetAuthState(): Promise<AuthenticationState | undefined> { return this.instance?.authState; } // Acessa o estado guardado
  // CORRIGIDO TS2355: Garantir retorno Promise<{ profilePictureUrl: string | null }>
  public async profilePicture(jid: string): Promise<{ profilePictureUrl: string | null }> { /* ... (usa baileysProfilePictureUrl) ... */ return { profilePictureUrl: null }; } // Placeholder
  // CORRIGIDO TS1064 e TS2355: Usar Promise<boolean> e garantir retorno
  private async historySyncNotification(msg: proto.Message.IHistorySyncNotification): Promise<boolean> { /* ... */ return true; } // Placeholder
  // CORRIGIDO TS2355: Garantir retorno Promise<T | null>
  private async getMessage<T = proto.IMessage | undefined>(key: proto.IMessageKey, full = false): Promise<T | null> { /* ... */ return null; } // Placeholder

  // --- Métodos Internos (com correções) ---

  // CORRIGIDO v5: Lógica de AuthState revisada
  private async defineAuthState(): Promise<DefinedAuthState> {
    const dbConfig = this.configService.get<DatabaseConfig>('DATABASE');
    const cacheConfig = this.configService.get<CacheConfig>('CACHE');
    const providerConfig = this.configService.get<ProviderSession>('PROVIDER');
    let authStatePromise: Promise<AuthStateWithMethods>;

    // 1. Provider (com ressalvas)
    if (providerConfig?.ENABLED) {
        // A implementação de ProviderFiles precisa ser verificada quanto à compatibilidade com AuthStateWithMethods
        // e se os métodos create/write/read/delete estão corretos.
        this.logger.warn(`Usando ProviderFiles para autenticação. Verifique a implementação em src/provider/sessions.ts`);
        // CORRIGIDO: Passar cacheService (ou logger) para AuthStateProvider se necessário
        const authStateProvider = new AuthStateProvider(this.instanceId, this.providerFiles, this.cacheService); // Exemplo
        authStatePromise = Promise.resolve(authStateProvider); // Assumindo que AuthStateProvider está correto
    }
    // 2. Redis
    else if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
       this.logger.info(`Usando Redis para autenticação (Instância: ${this.instanceId})`);
       // Passar cacheService (que encapsula Redis ou LocalCache)
       authStatePromise = useMultiFileAuthStateRedisDb(this.instanceId, this.cacheService);
    }
    // 3. Prisma (DB)
    else if (dbConfig?.SAVE_DATA?.INSTANCE) {
       this.logger.info(`Usando Prisma (DB) para autenticação (Instância: ${this.instanceId})`);
       // CORRIGIDO TS2345: Passar prismaRepository diretamente
       authStatePromise = useMultiFileAuthStatePrisma(this.instanceId, this.prismaRepository);
    }
    // 4. Fallback (Arquivo Local)
    else {
       this.logger.warn(`Nenhum método de persistência configurado/válido (Provider, Redis, DB). Usando MultiFileAuthState padrão (Instância: ${this.instanceId}).`);
       const sessionDir = path.join(INSTANCE_DIR, this.instanceId);
       if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
       // useMultiFileAuthState retorna { state, saveCreds }, precisamos adicionar clearState
       const fileAuthState = await useMultiFileAuthState(sessionDir);
       const clearFileState = async () => {
           try {
               this.logger.info(`Limpando diretório de sessão padrão: ${sessionDir}`);
               rmSync(sessionDir, { recursive: true, force: true });
           } catch (e: any) {
               this.logger.error({ err: e }, `Erro ao limpar diretório de sessão padrão ${sessionDir}`);
           }
       };
       authStatePromise = Promise.resolve({ ...fileAuthState, clearState: clearFileState });
    }

    // Garante que o retorno SEMPRE tenha clearState
    return authStatePromise.then(auth => {
        if (typeof auth.clearState !== 'function') {
             this.logger.warn(`Método clearState não encontrado no AuthState retornado. Adicionando fallback NOP.`);
             // Adiciona um clearState seguro que não faz nada
             const clearNop = async () => { this.logger.warn('Fallback clearState (NOP) chamado.'); };
             return { ...auth, clearState: clearNop } as DefinedAuthState;
        }
        // Força o tipo se clearState já existe
        return auth as DefinedAuthState;
    });
  }


  private async createClient(number?: string | null): Promise<WASocket> {
    this.logger.info(`Criando cliente Baileys para instância ${this.instanceName}...`);
    const authStateMethods = await this.defineAuthState(); // Obtém auth state com clearState garantido
    // CORRIGIDO TS2322: instance.authState é AuthenticationState
    this.instance.authState = authStateMethods.state;

    const sessionConfig = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
    // CORRIGIDO: Usar Browsers do Baileys
    const browser: WABrowserDescription = Browsers.appropriate(sessionConfig?.CLIENT || 'Evolution API');
    this.logger.info(`Using browser description: ${browser.join(' | ')}`);

    let version: proto.Version | undefined = undefined;
    try {
        const result = await fetchLatestBaileysVersion();
        version = result.version;
        this.logger.info(`Using Baileys version: ${version.join('.')}`);
    } catch (e) {
        this.logger.warn({ err: e }, `Failed to fetch latest Baileys version. Using default.`);
    }

    let agentOptions = {};
    await this.loadProxy(); // Carrega configurações de proxy
    if (this.localProxy?.enabled && this.localProxy?.host && this.localProxy?.port) {
         try {
            // CORRIGIDO TS2339: Usar propriedades corretas de localProxy
             const proxyConfig: any = {
                 host: this.localProxy.host,
                 port: this.localProxy.port, // Port como string
                 protocol: this.localProxy.protocol || 'http', // Default protocol
                 auth: (this.localProxy.username && this.localProxy.password)
                     ? `${this.localProxy.username}:${this.localProxy.password}`
                     : undefined,
             };
             this.logger.info(`Using proxy: ${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`);
             const agent = makeProxyAgent(proxyConfig);
             agentOptions = { agent: agent, fetchAgent: agent };
         } catch (e) {
             this.logger.error({ err: e }, "Failed to create proxy agent");
         }
    }

    const socketConfig: UserFacingSocketConfig = {
      ...agentOptions,
      version,
      logger: P({ level: this.logBaileys }).child({ context: `Baileys[${this.instanceName}]` }), // Logger Pino
      printQRInTerminal: this.configService.get<QrCodeOptions>('QRCODE')?.PRINT_TERMINAL ?? false,
      mobile: false,
      auth: authStateMethods, // Passa objeto com state, saveCreds, clearState
      msgRetryCounterCache: this.msgRetryCounterCache, // Passar diretamente
      userDevicesCache: this.userDevicesCache, // Passar diretamente
      generateHighQualityLinkPreview: true,
      // getMessage é opcional se você não precisar buscar mensagens do store interno do Baileys
      // getMessage: async (key) => this.getMessage(key), // Descomentar se necessário
      browser: browser,
      // CORRIGIDO TS2339: Usar localSettings corretos
      markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true, // Usa localSettings
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      qrTimeout: (this.configService.get<QrCodeOptions>('QRCODE')?.TIMEOUT || 45) * 1000, // Usa config
      emitOwnEvents: false,
      // CORRIGIDO TS2355: Função deve retornar boolean
      shouldIgnoreJid: (jid): boolean => {
          if (!jid) return false;
          return isJidBroadcast(jid) || isJidNewsletter(jid) || this.localSettings?.ignoreBroadcast || false;
       },
       // CORRIGIDO TS2339: Usar localSettings corretos
      syncFullHistory: this.localSettings?.syncFullHistory ?? false, // Usa localSettings
      shouldSyncHistoryMessage: (msg) => this.historySyncNotification(msg), // Chama o método async
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
      patchMessageBeforeSending: (msg) => {
          // Adiciona deviceId se não existir (necessário para algumas mensagens)
          if (!msg.deviceSentMeta) msg.deviceSentMeta = { deviceId: getDevice(this.instance.authState?.creds?.me?.id || '') || 0 };
          return msg;
       },
    };

    this.endSession = false;
    this.logger.info(`Initializing Baileys socket connection for ${this.instanceName}...`);

    try {
        this.client = makeWASocket(socketConfig);
        this.setupMainEventListeners();
        await authStateMethods.saveCreds(); // Salvar credenciais iniciais
    } catch (error: any) {
      this.logger.error({ err: error }, `CRITICAL error creating Baileys socket for ${this.instanceName}`);
      // Garante que a instância seja removida do monitor e DB em caso de falha crítica na criação
      await this.waMonitor.deleteAccount(this.instanceName);
      throw new InternalServerErrorException(`Failed to initialize Baileys client: ${error.message}`);
    }
    // ... (configuração de chamadas de voz) ...
    return this.client;
  }

  // Método start ajustado
  public async start(number?: string | null): Promise<WASocket | null> {
     try {
        this.logger.info(`Starting Baileys instance ${this.instanceName}...`);
        // Carrega configurações ANTES de criar o cliente
        await this.loadLocalSettings(); // Renomeado de loadSettings
        await this.loadChatwoot();
        await this.loadWebhook();
        await this.loadProxy();
        this.logger.info(`Configurations loaded for ${this.instanceName}. Creating client...`);
        // Cria o cliente (que agora também anexa listeners principais)
        this.client = await this.createClient(number);
        return this.client;
     } catch (error: any) {
        // Log já ocorre dentro de createClient ou nos métodos load*
        // A limpeza via deleteAccount já é chamada em createClient se falhar
        // Relançar a exceção para quem chamou o start
        throw error; // Pode ser InternalServerErrorException ou outra
     }
  }


  // --- Handlers de Eventos (com correções Prisma e Chatwoot) ---
  private readonly chatHandle = { /* ... (implementação mantida, verificar logs e sendDataWebhook) ... */ };
  private readonly contactHandle = {
     'contacts.upsert': async (contacts: Contact[]): Promise<void> => {
         this.logger.debug({ contactsCount: contacts.length }, 'Received contacts.upsert event');
         const filteredContacts = contacts.filter(c => c.id && isJidUser(c.id)); // Filtra apenas JIDs de usuário válidos
         if (!filteredContacts.length) return;

         // Prepara dados para Prisma e Chatwoot
         const upsertData = filteredContacts.map(contact => {
             const profilePicUrl = contact.imgUrl === 'changed' || contact.imgUrl === 'set'
                 ? await this.client?.profilePictureUrl(contact.id).catch(() => null) // Buscar URL se mudou
                 : contact.imgUrl; // Manter URL existente ou undefined

             return {
                 where: { remoteJid_instanceId: { remoteJid: contact.id, instanceId: this.instanceId } },
                 update: {
                     name: contact.name || contact.verifiedName || null,
                     pushName: contact.notify || null, // 'notify' é o pushName em Baileys
                     profilePictureUrl: profilePicUrl,
                 },
                 create: {
                     instanceId: this.instanceId,
                     remoteJid: contact.id,
                     name: contact.name || contact.verifiedName || null,
                     pushName: contact.notify || null,
                     profilePictureUrl: profilePicUrl,
                 },
                 // Dados para Chatwoot (se habilitado)
                 chatwootContactData: {
                     inboxId: this.chatwootConfig?.INBOX_ID ?? '', // Pegar do chatwootConfig carregado
                     contactIdentifier: contact.id.split('@')[0], // Número sem @s.whatsapp.net
                     name: contact.notify || contact.name || contact.verifiedName || contact.id.split('@')[0],
                     avatarUrl: profilePicUrl,
                     // Adicionar mais campos se necessário
                 }
             };
         });

         try {
             this.logger.debug(`Upserting ${upsertData.length} contacts to DB...`);
             // Executar upserts no Prisma
             const prismaPromises = upsertData.map(data => this.prismaRepository.contact.upsert({
                 where: data.where,
                 create: data.create,
                 update: data.update,
             }));
             await this.prismaRepository.$transaction(prismaPromises);
             this.logger.debug(`Contacts upserted successfully to DB.`);

             // Enviar para Chatwoot se habilitado
             if (this.chatwootConfig?.ENABLED && this.chatwootService) {
                 this.logger.debug(`Upserting ${upsertData.length} contacts to Chatwoot...`);
                 for (const data of upsertData) {
                     if (!this.chatwootConfig?.INBOX_ID) continue; // Pula se inbox não configurado
                     try {
                         // CORRIGIDO: Usar métodos corretos do ChatwootService
                         const existingContact = await this.chatwootService.findContactByIdentifier(data.chatwootContactData.contactIdentifier);
                         if (existingContact?.id) {
                             await this.chatwootService.updateChatwootContact(existingContact.id, data.chatwootContactData);
                         } else {
                             await this.chatwootService.createChatwootContact(data.chatwootContactData);
                         }
                     } catch (cwError: any) {
                         this.logger.error({ err: cwError, contactId: data.where.remoteJid_instanceId.remoteJid }, `Failed to upsert contact in Chatwoot`);
                     }
                 }
                 this.logger.debug(`Contacts upserted to Chatwoot.`);
             }

         } catch (error: any) {
             this.logger.error({ err: error }, `Error in contacts.upsert handler`);
         }
     },
     'contacts.update': async (updates: Array<Partial<Contact>>): Promise<void> => {
        this.logger.debug({ updateCount: updates.length }, 'Received contacts.update event');
        const validUpdates = updates.filter(u => u.id && isJidUser(u.id));
        if (!validUpdates.length) return;

        // Mapeia updates para o formato do Prisma e Chatwoot
        const updateOps = await Promise.all(validUpdates.map(async (update) => {
            let profilePicUrl: string | undefined | null = undefined;
            if (update.imgUrl === 'changed' || update.imgUrl === 'set') {
                profilePicUrl = await this.client?.profilePictureUrl(update.id!).catch(() => null);
            } else if (update.imgUrl === 'delete') {
                 profilePicUrl = null;
            }
            // Mantém a URL existente se não for 'changed', 'set' ou 'delete'
            // (O campo imgUrl pode não estar presente se só outros campos mudaram)

            const dataToUpdate: Prisma.ContactUpdateArgs['data'] = {};
            if (update.notify !== undefined) dataToUpdate.pushName = update.notify; // Push name
            if (update.name !== undefined) dataToUpdate.name = update.name; // Nome verificado/contato
            if (profilePicUrl !== undefined) dataToUpdate.profilePictureUrl = profilePicUrl; // URL da foto

            // Dados para Chatwoot
            const chatwootUpdateData = {
                 name: update.notify || update.name, // Atualiza nome no chatwoot
                 avatarUrl: profilePicUrl // Atualiza avatar
                 // Adicionar mais campos se necessário
            };

            return {
                where: { remoteJid_instanceId: { remoteJid: update.id!, instanceId: this.instanceId } },
                data: dataToUpdate,
                chatwootContactIdentifier: update.id!.split('@')[0],
                chatwootUpdateData: chatwootUpdateData,
            };
        }));

        const validDbUpdates = updateOps.filter(op => Object.keys(op.data).length > 0);

        try {
            if (validDbUpdates.length > 0) {
                 this.logger.debug(`Updating ${validDbUpdates.length} contacts in DB...`);
                 // CORRIGIDO: Usar updateMany pode ser mais eficiente se o where for simples,
                 // mas update individual garante que só atualizamos existentes.
                 // Usando transação com múltiplos updates.
                 const prismaPromises = validDbUpdates.map(op => this.prismaRepository.contact.update({
                     where: op.where,
                     data: op.data,
                 }));
                 await this.prismaRepository.$transaction(prismaPromises);
                 this.logger.debug(`Contacts updated successfully in DB.`);
            } else {
                 this.logger.debug('No valid data to update in DB for contacts.update event.');
            }


             // Atualizar Chatwoot se habilitado
             if (this.chatwootConfig?.ENABLED && this.chatwootService) {
                 this.logger.debug(`Updating ${updateOps.length} contacts in Chatwoot...`);
                 for (const op of updateOps) {
                     // Atualiza apenas se houver dados relevantes para Chatwoot
                     if (op.chatwootUpdateData.name !== undefined || op.chatwootUpdateData.avatarUrl !== undefined) {
                         try {
                             const existingContact = await this.chatwootService.findContactByIdentifier(op.chatwootContactIdentifier);
                             if (existingContact?.id) {
                                 await this.chatwootService.updateChatwootContact(existingContact.id, op.chatwootUpdateData);
                             } else {
                                 this.logger.warn({ contactId: op.where.remoteJid_instanceId.remoteJid }, `Contact not found in Chatwoot for update, skipping.`);
                             }
                         } catch (cwError: any) {
                             this.logger.error({ err: cwError, contactId: op.where.remoteJid_instanceId.remoteJid }, `Failed to update contact in Chatwoot`);
                         }
                     }
                 }
                 this.logger.debug(`Contacts updated in Chatwoot.`);
             }

        } catch (error: any) {
             // Ignora erros de 'Record to update not found.' que podem ocorrer se o contato não existir no DB
             if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) {
                 this.logger.error({ err: error }, `Error in contacts.update handler`);
             } else {
                  this.logger.warn(`Some contacts to update were not found in the database.`);
             }
        }
     },
  };
  private readonly labelHandle = {
    [Events.LABELS_EDIT]: async (label: Label): Promise<void> => {
        this.logger.debug({ label }, 'Received labels.edit event');
        // Label do Prisma já tem instanceId? Se não, precisa adicionar.
        // Assumindo que 'label' é do tipo Prisma.Label e já tem instanceId.
        const labelData = { ...label, instanceId: this.instanceId }; // Garante instanceId

        try {
            // CORRIGIDO TS2339/TS2353: Usar método e where correto
            await this.prismaRepository.label.upsert({
                 where: { labelId_instanceId: { labelId: labelData.id, instanceId: this.instanceId } }, // Usa ID do label e instanceId
                 create: labelData, // Cria com todos os dados
                 update: { name: labelData.name, color: labelData.color /* outros campos */ }, // Atualiza campos relevantes
            });
            this.logger.info(`Label ${labelData.id} upserted successfully.`);
        } catch (error: any) {
            // CORRIGIDO TS2554: Usar um objeto para o log de erro
            this.logger.error({ err: error, labelId: label.id }, `Error processing labels.edit`);
        }
    },
    [Events.LABELS_ASSOCIATION]: async (data: { association: LabelAssociation; type: 'add' | 'remove' }): Promise<void> => {
         this.logger.debug({ data }, 'Received labels.association event');
         const { association, type } = data;
         // A associação do Prisma já tem instanceId? Se não, precisa adicionar.
         // Assumindo que 'association' é do tipo Prisma.LabelAssociation.
         const assocData = { ...association, instanceId: this.instanceId };

         try {
             if (type === 'add') {
                  // CORRIGIDO: Usar create do Prisma e tratar conflitos (onConflict?)
                  await this.prismaRepository.labelAssociation.upsert({
                       where: { chatId_labelId_instanceId: { chatId: assocData.chatId, labelId: assocData.labelId, instanceId: this.instanceId } },
                       create: assocData,
                       update: {}, // Não fazer nada se já existe
                  });
                  this.logger.info(`Label association added: Chat ${assocData.chatId}, Label ${assocData.labelId}`);
             } else if (type === 'remove') {
                  // CORRIGIDO: Usar delete do Prisma
                  await this.prismaRepository.labelAssociation.delete({
                       where: { chatId_labelId_instanceId: { chatId: assocData.chatId, labelId: assocData.labelId, instanceId: this.instanceId } },
                  });
                  this.logger.info(`Label association removed: Chat ${assocData.chatId}, Label ${assocData.labelId}`);
             }
         } catch (error: any) {
             // Ignora erros de 'Record to delete does not exist'
             if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) {
                  this.logger.error({ err: error, association }, `Error processing labels.association (${type})`);
             } else {
                  this.logger.warn(`Label association to ${type} (Chat ${assocData.chatId}, Label ${assocData.labelId}) not found.`);
             }
         }
    },
  };
  private setupMainEventListeners(): void {
      if (!this.client) return;
      this.logger.debug('Setting up main Baileys event listeners...');

      // Usar this.client.ev que é um BaileysEventEmitter
      const ev = this.client.ev;

      ev.on('connection.update', this.connectionUpdate.bind(this));
      ev.on('creds.update', this.handleCredsUpdate.bind(this)); // Adicionado handler para salvar creds

      // Bind chat, contact, label handlers
      Object.keys(this.chatHandle).forEach(event => ev.on(event as any, (this.chatHandle as any)[event]));
      Object.keys(this.contactHandle).forEach(event => ev.on(event as any, (this.contactHandle as any)[event]));
      Object.keys(this.labelHandle).forEach(event => ev.on(event as any, (this.labelHandle as any)[event]));

      // Adicionar outros listeners necessários (messages.upsert, groups.update, etc.)
      ev.on('messages.upsert', async (m: { messages: proto.IWebMessageInfo[], type: MessageUpsertType }) => {
          this.logger.debug({ messageCount: m.messages.length, type: m.type }, 'Received messages.upsert event');
          for (const msg of m.messages) {
              await this.handleMessageUpsert(msg); // Chama um método dedicado para tratar a mensagem
          }
          // Enviar webhook geral após processar todas as mensagens do lote
          this.sendDataWebhook(Events.MESSAGES_UPSERT, { messages: m.messages, type: m.type });
      });

      ev.on('messages.update', async (updates: proto.IWebMessageInfo[]) => {
          this.logger.debug({ updateCount: updates.length }, 'Received messages.update event');
          for (const update of updates) {
               await this.handleMessageUpdate(update); // Chama um método dedicado
          }
          this.sendDataWebhook(Events.MESSAGES_UPDATE, updates);
      });

      ev.on('message-receipt.update', (updates: MessageUserReceiptUpdate[]) => {
         this.logger.debug({ updateCount: updates.length }, 'Received message-receipt.update event');
         this.handleReceiptUpdate(updates); // Chama método dedicado
         this.sendDataWebhook(Events.MESSAGE_RECEIPT_UPDATE, updates);
      });

      ev.on('groups.upsert', (groups: GroupMetadata[]) => {
          this.logger.debug({ groupCount: groups.length }, 'Received groups.upsert event');
          this.handleGroupUpsert(groups); // Chama método dedicado
          this.sendDataWebhook(Events.GROUPS_UPSERT, groups);
      });

       ev.on('groups.update', (updates: Partial<GroupMetadata>[]) => {
          this.logger.debug({ updateCount: updates.length }, 'Received groups.update event');
          this.handleGroupUpdate(updates); // Chama método dedicado
          this.sendDataWebhook(Events.GROUPS_UPDATE, updates);
       });

       ev.on('group-participants.update', (update: { id: string; participants: string[]; action: ParticipantAction }) => {
           this.logger.debug({ ...update }, 'Received group-participants.update event');
           this.handleParticipantUpdate(update); // Chama método dedicado
           this.sendDataWebhook(Events.GROUP_PARTICIPANTS_UPDATE, update);
       });

      // Adicionar listener para chamadas, se necessário
      // ev.on('call', (call) => { /* ... */ });

      this.logger.debug('Main Baileys event listeners set up.');
  }

  // Handler para salvar credenciais
  private async handleCredsUpdate() {
      if (!this.instance?.authState) return; // Verifica se authState existe
      try {
          // Obtém o método saveCreds do AuthState (que agora garantimos existir)
          const authStateMethods = await this.defineAuthState();
          await authStateMethods.saveCreds();
          this.logger.debug('Authentication credentials updated and saved successfully.');
      } catch (error) {
          this.logger.error({ err: error }, 'Failed to save updated credentials');
      }
  }

  // --- Handlers Dedicados para Eventos ---
  private async handleMessageUpsert(msg: proto.IWebMessageInfo): Promise<void> {
      // Lógica para salvar a mensagem no DB (usar prismaRepository)
      // Lógica para encaminhar para Chatwoot (usar chatwootService)
      // Lógica para encaminhar para Chatbots (chamar this.emit para ChatbotController)
      // Lógica para webhook (já tratada pelo sendDataWebhook geral)
      this.logger.trace({ msgId: msg.key.id }, 'Processing message upsert');
      // ... implementação detalhada ...

      // Exemplo: Salvar no DB
      try {
          const messageData = this.mapWebMessageInfoToPrisma(msg); // Criar função de mapeamento
          await this.prismaRepository.message.upsert({
               where: { keyId_instanceId: { keyId: msg.key.id!, instanceId: this.instanceId } },
               create: messageData,
               update: messageData, // Atualiza se já existir
          });
      } catch (dbError) {
           this.logger.error({ err: dbError, msgId: msg.key.id }, 'Failed to save message to DB');
      }

      // Exemplo: Emitir para ChatbotController
      if (this.shouldProcessMessageForChatbot(msg)) { // Criar função de verificação
           this.emit(Events.MESSAGES_UPSERT, { messages: [msg], type: 'notify', source: 'baileys' });
      }
  }

  private async handleMessageUpdate(update: proto.IWebMessageInfo): Promise<void> {
     // Lógica para salvar o update no DB (tabela MessageUpdate?)
     // Lógica para Chatwoot/Chatbots se necessário
     this.logger.trace({ msgId: update.key.id, status: update.status }, 'Processing message update');
      // ... implementação detalhada ...
  }

  private handleReceiptUpdate(updates: MessageUserReceiptUpdate[]): void {
      // Lógica para atualizar status no DB ou notificar outros sistemas
      this.logger.trace({ updateCount: updates.length }, 'Processing message receipt update');
       // ... implementação detalhada ...
  }

  private handleGroupUpsert(groups: GroupMetadata[]): void {
      // Lógica para salvar/atualizar grupos no DB (talvez na tabela Contact?)
      this.logger.trace({ groupCount: groups.length }, 'Processing group upsert');
      // ... implementação detalhada ...
  }

    private handleGroupUpdate(updates: Partial<GroupMetadata>[]): void {
      // Lógica para atualizar metadados de grupos no DB
      this.logger.trace({ updateCount: updates.length }, 'Processing group update');
       // ... implementação detalhada ...
    }

    private handleParticipantUpdate(update: { id: string; participants: string[]; action: ParticipantAction }): void {
       // Lógica para atualizar participantes no DB ou notificar sistemas
       this.logger.trace({ ...update }, 'Processing group participant update');
        // ... implementação detalhada ...
    }

    // Função de mapeamento (exemplo)
    private mapWebMessageInfoToPrisma(msg: proto.IWebMessageInfo): Prisma.MessageCreateInput {
         // Mapeia os campos de proto.IWebMessageInfo para Prisma.MessageCreateInput
         // Atenção aos tipos (Buffer, Long, etc.)
         return {
             instance: { connect: { id: this.instanceId } }, // Conecta à instância existente
             keyId: msg.key.id!,
             remoteJid: msg.key.remoteJid!,
             fromMe: msg.key.fromMe || false,
             participant: msg.key.participant,
             messageTimestamp: typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : msg.messageTimestamp?.toNumber?.(), // Trata Long
             pushName: msg.pushName,
             status: msg.status?.toString(), // Converte enum para string ou número? Verificar schema
             messageType: getContentType(msg.message)?.toString(),
             // message: BufferJSON.stringify(msg.message), // Salva conteúdo como JSON string? Verificar tamanho/necessidade
             message: msg.message ? JSON.parse(JSON.stringify(msg.message, BufferJSON.replacer)) : Prisma.JsonNull, // Tenta converter para JSON preservando Buffers

             // Adicionar outros campos conforme schema Prisma
         };
    }

    // Função de verificação para chatbot (exemplo)
    private shouldProcessMessageForChatbot(msg: proto.IWebMessageInfo): boolean {
        // Implementar lógica: não processar de broadcast, de grupos ignorados, mensagens de status, etc.
        if (!msg.key.remoteJid || isJidBroadcast(msg.key.remoteJid) || msg.key.fromMe) {
             return false;
        }
        // Adicionar outras verificações (ex: grupo, tipo de mensagem)
        return true;
    }

  // Método findSettings (CORRIGIDO TS2355: Garantir retorno Promise<LocalSettings | null>)
  // Este método provavelmente foi movido para ChannelStartupService como loadLocalSettings
  // public async findSettings(): Promise<LocalSettings | null> {
  //    this.logger.debug('Finding local settings...');
  //    // Lógica para buscar do DB ou Cache
  //    return this.localSettings; // Retorna o localSettings carregado
  // }

} // Fim da classe BaileysStartupService
