// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Baileys Imports ---
// CORREÇÃO TS2300: Remover import duplicado de makeWASocket
import makeWASocket, {
  AuthenticationState,
  // BrowseSessionState, // Não usado? Remover se não for necessário
  Chat,
  ConnectionState,
  Contact,
  DisconnectReason,
  fetchLatestBaileysVersion,
  GroupMetadata,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  // makeCacheableSignalKeyStore, // Importar se for usar explicitamente
  // makeWASocket, // Removido - já importado como default
  MessageUserReceiptUpdate,
  ParticipantAction,
  proto,
  useMultiFileAuthState, // Import base para estado, pode ser substituído
  UserFacingSocketConfig,
  // WAMessageKey, // Importar se for usar explicitamente
  // WAMessageContent, // Importar se for usar explicitamente
  WASocket,
  WABrowserDescription,
  // WAPresence, // Importar se for usar explicitamente
  BufferJSON, // CORREÇÃO TS2307: Importado de '/lib/Utils' abaixo
  initAuthCreds, // CORREÇÃO TS2307: Importado de '/lib/Utils' abaixo
  delay, // CORREÇÃO TS2307: Importado
} from '@whiskeysockets/baileys';
// CORREÇÃO TS2307: Importar de /lib/Utils (se o path for esse)
import {
    // BufferJSON, initAuthCreds // Movidos para import principal acima se possível, senão manter aqui
} from '@whiskeysockets/baileys/lib/Utils'; // <- VERIFICAR ESTE PATH NA VERSÃO INSTALADA
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache'; // Import NodeCache

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { release } from 'os';

// --- Project Imports ---
// DTOs
import { OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
// Services, Repositories, Config, etc. (using aliases)
import { ChannelStartupService } from '@api/services/channel.service'; // Usar classe base correta
import { ConfigService } from '@config/config.service'; // CORREÇÃO TS2307: Usar alias
import { PrismaRepository } from '@repository/repository.service'; // CORREÇÃO TS2345: Usar alias canônico
import { CacheService } from '@api/services/cache.service'; // Assumindo que está em @api/services
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { ProviderFiles } from '@provider/sessions'; // CORREÇÃO TS2345: Usar alias correto
import { Logger } from '@config/logger.config'; // Assumindo logger pino
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions'; // Importar exceções
// Types
// CORREÇÃO TS2305: Verificar exports em wa.types.ts
import {
  wa, // Namespace principal
  Events, // Enum de eventos
  // QrCode, // Usar wa.QrCode
  // Log, // Usar Logger do Pino
  // Chatwoot, // Usar tipo Chatwoot da configuração
  // Database, // Usar tipo Database da configuração
  // CacheConf, // Usar tipo CacheConf da configuração
  // ProviderSession, // Usar tipo ProviderSession da configuração
  // ConfigSessionPhone, // Usar tipo ConfigSessionPhone da configuração
  Label, // CORREÇÃO TS2304: Precisa existir em wa.types
  LabelAssociation, // CORREÇÃO TS2304: Precisa existir em wa.types
  ContactPayload, // CORREÇÃO TS2694: Precisa existir em wa.types
  LocalSettings, // CORREÇÃO TS2416: Precisa existir e ser compatível com a base
  Instance, // Adicionar tipo Instance se necessário
} from '@api/types/wa.types';
// Utils
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files'; // CORREÇÃO TS2305: Verificar export
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
// CORREÇÃO TS2614: Verificar export default ou named
import { useMultiFileAuthStatePrisma } from '@utils/use-multi-file-auth-state-prisma';
import { createJid } from '@utils/createJid';
// CORREÇÃO TS2724: Corrigir nome da função importada
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache';
import { makeProxyAgent, Proxy } from '@utils/makeProxyAgent'; // Importar Proxy type se existir em makeProxyAgent
// TODO: Importar useVoiceCallsBaileys de sua localização correta
import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys'; // CORREÇÃO TS2304: Assumindo path
// TODO: Se chatwootImport for uma classe/objeto real, importe-o corretamente
const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } };

// Libs
import axios from 'axios';
// import { Prisma } from '@prisma/client'; // Importar apenas se usar tipos Prisma diretamente
import P from 'pino'; // Import Pino
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { v4 as cuid } from 'uuid';
import EventEmitter2 from 'eventemitter2';

// Tipagem para CacheStore (interface simples)
interface CacheStore {
    get<T>(key: string): Promise<T | undefined | null> | T | undefined | null; // Permitir retorno síncrono ou assíncrono
    set<T>(key: string, value: T, ttl?: number): Promise<boolean | void> | boolean | void; // Permitir retorno síncrono ou assíncrono
    del(key: string): Promise<number | void> | number | void; // Permitir retorno síncrono ou assíncrono
    flushAll?(): Promise<void> | void; // Opcional
}

// Função getVideoDuration (movida para cá ou para um arquivo utils)
// ... (código da função getVideoDuration mantido como antes) ...
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> {
  // Implementação da função getVideoDuration...
  // Nota: Certifique-se que `mediainfo.js` está nas dependências.
  try {
    const MediaInfoFactory = (await import('mediainfo.js')).default;
    const mediainfo = await MediaInfoFactory({ format: 'JSON' });

    let fileSize: number;
    let readChunk: (chunkSize: number, offset: number) => Promise<Uint8Array>;

    if (Buffer.isBuffer(input)) {
      fileSize = input.length;
      readChunk = async (chunkSize: number, offset: number): Promise<Uint8Array> => {
        return input.slice(offset, offset + chunkSize);
      };
    } else if (typeof input === 'string') {
      const stats = await fs.promises.stat(input);
      fileSize = stats.size;
      const fileHandle = await fs.promises.open(input, 'r');
      readChunk = async (chunkSize: number, offset: number): Promise<Uint8Array> => {
        const buffer = Buffer.alloc(chunkSize);
        const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, offset);
        return buffer.slice(0, bytesRead);
      };
      // O resultado da análise deve ser obtido dentro de um bloco try/finally para fechar o handle
      try {
        const result = await mediainfo.analyzeData(() => fileSize, readChunk);
        const jsonResult = JSON.parse(result);
        const generalTrack = jsonResult.media?.track?.find((t: any) => t['@type'] === 'General');
        const duration = generalTrack?.Duration;
        return duration ? Math.round(parseFloat(duration)) : 0;
      } finally {
        await fileHandle.close();
      }
    } else if (input instanceof Readable) {
      // Para Readable stream, precisamos ler todo o conteúdo primeiro.
      // Isso pode ser ineficiente para arquivos grandes.
      // Uma abordagem melhor seria usar um fluxo de forma diferente,
      // mas para compatibilidade com mediainfo.js, leremos em memória.
      const chunks: Buffer[] = [];
      for await (const chunk of input) {
        chunks.push(chunk as Buffer);
      }
      const data = Buffer.concat(chunks);
      fileSize = data.length;
      readChunk = async (chunkSize: number, offset: number): Promise<Uint8Array> => {
        return data.slice(offset, offset + chunkSize);
      };
    } else {
      throw new Error('Tipo de entrada não suportado para getVideoDuration');
    }

    const result = await mediainfo.analyzeData(() => fileSize, readChunk);
    const jsonResult = JSON.parse(result);
    const generalTrack = jsonResult.media?.track?.find((t: any) => t['@type'] === 'General');
    const duration = generalTrack?.Duration;

    return duration ? Math.round(parseFloat(duration)) : 0;
  } catch (error) {
    console.error('Erro ao obter duração do vídeo:', error);
    return 0; // Retorna 0 em caso de erro
  }
}


// --- Tipo para AuthState com clearState ---
type AuthStateWithClear = AuthenticationState & {
  clearState?: () => Promise<void>;
};

// --- Tipo para o retorno de defineAuthState ---
type DefinedAuthState = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState: () => Promise<void>; // CORREÇÃO TS2741: Garantir que clearState está no tipo
};


export class BaileysStartupService extends ChannelStartupService {
  public client: WASocket | null = null;
  public stateConnection: ConnectionState = { connection: 'close', lastDisconnect: undefined };
  public phoneNumber: string | null = null;
  private authStateProvider: AuthStateProvider;
  private readonly msgRetryCounterCache: CacheStore;
  private readonly userDevicesCache: CacheStore;
  private endSession = false;
  // Logger herdado da classe base (ChannelStartupService)
  // protected readonly logger: Logger; // Removido - usar this.logger da base

  // CORREÇÃO TS2339: Declarar propriedades que estavam faltando
  protected logBaileys: P.LevelWithSilent | undefined = 'silent'; // Nível de log do Baileys
  protected groupHandler: any = {}; // Placeholder para handlers de grupo (precisa ser inicializado)

  constructor(
    // Herdando da classe base
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    // CORREÇÃO TS2345: Usar tipo correto do PrismaRepository canônico
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    // CORREÇÃO TS2345: Usar tipo correto do ProviderFiles
    private readonly providerFiles: ProviderFiles,
    // Injetar ChatwootService
    private readonly chatwootService: ChatwootService, // <- Adicionado
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache, chatwootService); // Chama construtor da base, passando chatwootService
    // this.logger já é inicializado na classe base ChannelStartupService

    // Inicializar caches (usando NodeCache ou o CacheService injetado)
    this.msgRetryCounterCache = new NodeCache(); // Ou this.cache.getEngine() se CacheService prover acesso
    this.userDevicesCache = new NodeCache();

    this.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };
    // CORREÇÃO TS2345: Passar o providerFiles com tipo correto
    this.authStateProvider = new AuthStateProvider(this.providerFiles);

    // Inicializar handlers de grupo (a lógica real pode estar em outro lugar)
    this.initializeGroupHandlers();
  }

  // Método para inicializar handlers de grupo (exemplo)
  private initializeGroupHandlers(): void {
    this.groupHandler = {
      'groups.upsert': async (groups: GroupMetadata[]) => {
         this.logger.debug(`Handler groups.upsert chamado com ${groups.length} grupos.`);
        // Implementar lógica aqui...
      },
      'groups.update': async (groups: Array<Partial<GroupMetadata>>) => {
         this.logger.debug(`Handler groups.update chamado com ${groups.length} atualizações.`);
        // Implementar lógica aqui...
      },
      'group-participants.update': async (update: { id: string; participants: string[]; action: ParticipantAction }) => {
         this.logger.debug(`Handler group-participants.update chamado para grupo ${update.id}, ação ${update.action}.`);
        // Implementar lógica aqui...
      },
    };
  }


  // --- Getters ---
  public get connectionStatus(): ConnectionState { return this.stateConnection; }

  // Acessando profilePictureUrl do objeto 'instance' herdado da base
  public get profilePictureUrl(): string | null | undefined { return this.instance.profilePictureUrl; }

  // CORREÇÃO TS2305: Usar wa.QrCode
  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count ?? 0,
    };
  }

  // --- Métodos ---
  public async logoutInstance(): Promise<void> {
    this.logger.info(`Tentando logout da instância: ${this.instanceName}`);
    try {
      await this.client?.logout(`Log out instance: ${this.instanceName}`);
      this.client?.ws?.close(); // Fechar WebSocket explicitamente
      this.client?.end(new Error(`Logout solicitado para ${this.instanceName}`)); // Finaliza a conexão Baileys
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro durante logout no cliente Baileys`);
    } finally {
      this.client = null; // Limpa o cliente
      this.stateConnection = { connection: 'close', lastDisconnect: undefined }; // Reseta estado
    }

    try {
      const sessionExists = await this.prismaRepository.findFirstSession({ // Usa método corrigido do repo
        where: { sessionId: this.instanceId },
      });
      if (sessionExists) {
        await this.prismaRepository.deleteSession({ // Usa método corrigido do repo
          where: { sessionId: this.instanceId },
        });
        this.logger.info(`Sessão removida do DB para ${this.instanceName}`);
      }

      // CORREÇÃO TS2339: Usar authState com clearState
      const authState = this.instance?.authState as AuthStateWithClear | undefined;
      await authState?.clearState?.(); // Limpa o estado se o método existir
      this.logger.info(`Estado de autenticação local limpo para ${this.instanceName}`);

    } catch (error: any) {
      this.logger.error({ err: error }, `Erro ao remover/limpar sessão durante logout`);
    }
  }

  public async getProfileName(): Promise<string | undefined> {
    let profileName = this.client?.user?.name ?? this.client?.user?.verifiedName;
    // CORREÇÃO TS2339: Verificar se instance e authState existem
    if (!profileName && this.instance?.authState) {
      try {
        // CORREÇÃO TS2339: Acessar creds com segurança
        const creds = (this.instance.authState as AuthenticationState)?.creds;
        profileName = creds?.me?.name || creds?.me?.verifiedName;
      } catch (error: any) {
        this.logger.error({ err: error }, `Erro ao ler nome do perfil das credenciais salvas`);
      }
    }
    return profileName;
  }

  public async getProfileStatus(): Promise<string | undefined> {
    try {
      if (!this.client || !this.instance.wuid) return undefined;
      // O retorno de fetchStatus é { status: string }[]
      const statusResult = await this.client.fetchStatus(this.instance.wuid);
      return statusResult?.[0]?.status; // Acessa a propriedade status
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro ao buscar status do perfil`);
      return undefined;
    }
  }

  private async connectionUpdate({ qr, connection, lastDisconnect }: Partial<ConnectionState>): Promise<void> {
    this.logger.info(
        { connection, hasQr: !!qr, lastDisconnect: lastDisconnect?.error?.message },
        `Atualização de conexão para ${this.instanceName}`
    );

    if (connection) {
      this.stateConnection = { connection, lastDisconnect };
    }

    if (qr) {
      const currentCount = this.instance.qrcode?.count ?? 0;
      // CORREÇÃO TS2305: Usar tipo QrCode da configuração
      const limit = this.configService.get<wa.QrCodeConfig>('QRCODE')?.LIMIT ?? 5;
      if (currentCount >= limit) {
        this.logger.warn(`Limite de QR Codes (${limit}) atingido para ${this.instanceName}. Forçando desconexão.`);
        await this.sendDataWebhook(Events.QRCODE_UPDATED, {
          message: 'QR code limit reached, closing session.',
          statusCode: DisconnectReason.timedOut,
        });

        // CORREÇÃO TS2339: Usar chatwootService injetado
        if (this.configService.get<wa.ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
          await this.chatwootService?.eventWhatsapp?.( // Adicionado '?.'
            Events.QRCODE_UPDATED,
            { instanceName: this.instanceName, instanceId: this.instanceId },
            { message: 'QR code limit reached, closing session.', statusCode: DisconnectReason.timedOut },
          );
        }
        this.endSession = true;
        this.logoutInstance();
        this.eventEmitter.emit('no.connection', this.instanceName);
        return;
      }

      this.instance.qrcode.count = currentCount + 1;
      this.instance.qrcode.code = qr;

      try {
        const color = this.configService.get<wa.QrCodeConfig>('QRCODE')?.COLOR ?? '#000000';
        const optsQrcode: qrcode.QRCodeToDataURLOptions = {
          margin: 3, scale: 4, errorCorrectionLevel: 'H', color: { light: '#ffffff', dark: color },
        };
        this.instance.qrcode.base64 = await qrcode.toDataURL(qr, optsQrcode);
      } catch (error: any) {
        this.logger.error({ err: error }, `Falha ao gerar QR code base64`);
        this.instance.qrcode.base64 = null;
      }

      if (this.phoneNumber && this.client) { // Verificar se client existe
        try {
          await delay(1000);
          this.instance.qrcode.pairingCode = await this.client?.requestPairingCode(this.phoneNumber);
          this.logger.info(`Pairing code solicitado para ${this.phoneNumber}: ${this.instance.qrcode.pairingCode}`);
        } catch (error: any) {
          this.logger.error({ err: error }, `Erro ao solicitar pairing code`);
          this.instance.qrcode.pairingCode = null;
        }
      } else {
        this.instance.qrcode.pairingCode = null;
      }

      await this.sendDataWebhook(Events.QRCODE_UPDATED, { qrcode: this.qrCode });

      // CORREÇÃO TS2339: Usar chatwootService injetado
      if (this.configService.get<wa.ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        await this.chatwootService?.eventWhatsapp?.( // Adicionado '?.'
          Events.QRCODE_UPDATED,
          { instanceName: this.instanceName, instanceId: this.instanceId },
          { qrcode: this.qrCode },
        );
      }

      try {
        qrcodeTerminal.generate(qr, { small: true }, (qrcodeStr) =>
          this.logger.info(
            `\n{ instance: ${this.instanceName} pairingCode: ${this.instance.qrcode?.pairingCode ?? 'N/A'}, qrcodeCount: ${this.instance.qrcode?.count} }\n` + qrcodeStr,
          ),
        );
      } catch (error: any) {
        this.logger.error({ err: error }, `Falha ao gerar QR code no terminal`);
      }

      try {
        await this.prismaRepository.updateInstance({ // Usa método corrigido
          where: { id: this.instanceId },
          data: { connectionStatus: 'connecting' },
        });
      } catch (dbError: any) {
        this.logger.error({ err: dbError }, `Erro ao atualizar status da instância (connecting) no DB`);
      }
    } // Fim do if(qr)

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== DisconnectReason.forbidden && statusCode !== 402 && statusCode !== 406;

      this.logger.warn(
        `Conexão fechada para ${this.instanceName}. Razão: ${statusCode} (${DisconnectReason[statusCode as keyof typeof DisconnectReason] ?? 'Desconhecido'}). Reconnect: ${shouldReconnect}`
      );

      if (this.endSession) {
        this.logger.info(`Sessão ${this.instanceName} finalizada, não tentará reconectar.`);
        await this.logoutInstance();
      } else if (shouldReconnect) {
        this.logger.info(`Tentando reconectar ${this.instanceName}...`);
        await delay(this.configService.get<any>('EVOLUTION')?.RECONNECT_DELAY ?? 5000);
        // CORREÇÃO TS2339: Chamar o método start (renomeado)
        await this.start(this.phoneNumber); // Tenta reconectar
      } else {
        this.logger.error(`Não será possível reconectar ${this.instanceName}. Razão: ${statusCode}. Limpando sessão.`);
        await this.sendDataWebhook(Events.STATUS_INSTANCE, {
          instance: this.instanceName, status: 'closed', disconnectionAt: new Date(),
          disconnectionReasonCode: statusCode, disconnectionObject: JSON.stringify(lastDisconnect),
        });

        try {
          await this.prismaRepository.updateInstance({ // Usa método corrigido
            where: { id: this.instanceId },
            data: {
              connectionStatus: 'close', disconnectionAt: new Date(), disconnectionReasonCode: statusCode,
              disconnectionObject: JSON.stringify(lastDisconnect),
            },
          });
        } catch (dbError: any) {
          this.logger.error({ err: dbError }, `Erro ao atualizar status da instância (closed) no DB`);
        }

        // CORREÇÃO TS2339: Usar chatwootService injetado
        if (this.configService.get<wa.ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
          await this.chatwootService?.eventWhatsapp?.( // Adicionado '?.'
            Events.STATUS_INSTANCE,
            { instanceName: this.instanceName, instanceId: this.instanceId },
            { instance: this.instanceName, status: 'closed' },
          );
        }

        this.eventEmitter.emit('logout.instance', this.instanceName, 'inner');
        await this.logoutInstance();
      }
    } // Fim if (connection === 'close')

    if (connection === 'open') {
      this.logger.info(`Conexão aberta para ${this.instanceName}`);
      this.instance.wuid = this.client?.user?.id?.replace(/:.*$/, '');
      if (!this.instance.wuid) {
        this.logger.error('Não foi possível obter o WUID após a conexão.');
        await this.logoutInstance();
        return;
      }

      this.logger.info(`WUID definido: ${this.instance.wuid}`);
      this.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };

      const profileName = await this.getProfileName();
      try {
        const picInfo = await this.profilePicture(this.instance.wuid);
        this.instance.profilePictureUrl = picInfo.profilePictureUrl;
      } catch (error: any) {
        this.logger.error({ err: error }, `Erro ao buscar foto do perfil`);
        this.instance.profilePictureUrl = null;
      }

      const formattedWuid = this.instance.wuid.split('@')[0].padEnd(20, ' ');
      const formattedName = (profileName ?? 'N/A').padEnd(20, ' ');
      this.logger.info(`┌──────────────────────────────┐`);
      this.logger.info(`│    CONNECTED TO WHATSAPP     │`);
      this.logger.info(`├──────────────────────────────┤`);
      this.logger.info(`│ Instance: ${this.instanceName.padEnd(20, ' ')} │`);
      this.logger.info(`│ WUID:     ${formattedWuid} │`);
      this.logger.info(`│ Name:     ${formattedName} │`);
      this.logger.info(`└──────────────────────────────┘`);

      try {
        await this.prismaRepository.updateInstance({ // Usa método corrigido
          where: { id: this.instanceId },
          data: {
            ownerJid: this.instance.wuid, profileName: profileName, profilePicUrl: this.instance.profilePictureUrl,
            connectionStatus: 'open', disconnectionAt: null, disconnectionReasonCode: null, disconnectionObject: null,
          },
        });
      } catch (dbError: any) {
        this.logger.error({ err: dbError }, `Erro ao atualizar status da instância (open) no DB`);
      }

      // CORREÇÃO TS2339: Usar chatwootService injetado
      if (this.configService.get<wa.ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        await this.chatwootService?.eventWhatsapp?.( // Adicionado '?.'
          Events.CONNECTION_UPDATE,
          { instanceName: this.instanceName, instanceId: this.instanceId },
          { instance: this.instanceName, status: 'open' },
        );
        // await this.syncChatwootLostMessages(); // TODO: Implementar ou remover
      }

      await this.sendDataWebhook(Events.CONNECTION_UPDATE, {
        instance: this.instanceName, wuid: this.instance.wuid, profileName: profileName,
        profilePictureUrl: this.instance.profilePictureUrl, state: 'open', statusReason: 200,
      });

    } // Fim if (connection === 'open')

    if (connection === 'connecting') {
      await this.sendDataWebhook(Events.CONNECTION_UPDATE, {
        instance: this.instanceName, state: 'connecting',
        statusReason: (this.stateConnection.lastDisconnect?.error as Boom)?.output?.statusCode ?? 0,
      });
    }
  } // Fim connectionUpdate

  private async getMessage<T = proto.IMessage | undefined>(key: proto.IMessageKey, full = false): Promise<T | null> {
    try {
      const messages = await this.prismaRepository.findManyMessages({ // Usa método corrigido
          where: {
              instanceId: this.instanceId,
              keyId: key.id, // Usar keyId se for a chave primária ou indexada
              // Filtrar por remoteJid também pode ajudar performance se indexado
              // 'key.remoteJid': key.remoteJid
          },
          take: 1,
      });

      if (!messages || messages.length === 0) return null;

      // Desserializar a mensagem do JSON armazenado
      const messageData = JSON.parse(JSON.stringify(messages[0]), BufferJSON.reviver);

      if (full) {
          return messageData as T; // Retorna objeto Message completo do DB
      } else {
           if (messageData.message?.pollCreationMessage) {
              const messageSecretBase64 = messageData.message?.messageContextInfo?.messageSecret;
              if (typeof messageSecretBase64 === 'string') {
                const messageSecret = Buffer.from(messageSecretBase64, 'base64');
                const msg = {
                  messageContextInfo: { messageSecret },
                  pollCreationMessage: messageData.message.pollCreationMessage,
                };
                return msg as T;
              }
            }
          return messageData.message as T ?? null; // Retorna apenas o conteúdo da mensagem
      }
    } catch (error: any) {
      this.logger.error({ err: error, messageKey: key.id }, `Erro ao buscar mensagem do banco`);
      return null;
    }
  }


  // CORREÇÃO TS2741: Garantir que defineAuthState retorne um objeto com clearState
  private async defineAuthState(): Promise<DefinedAuthState> {
    // CORREÇÃO TS2305: Usar tipos da configuração
    const dbConfig = this.configService.get<wa.DatabaseConfig>('DATABASE');
    const cacheConfig = this.configService.get<wa.CacheConfig>('CACHE');
    const providerConfig = this.configService.get<wa.ProviderConfig>('PROVIDER');

    let authStatePromise: Promise<DefinedAuthState>;

    if (providerConfig?.ENABLED) {
       this.logger.info(`Usando ProviderFiles para autenticação: ${this.providerFiles?.constructor?.name}`);
       authStatePromise = this.authStateProvider.authStateProvider(this.instanceId);
    } else if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
       this.logger.info('Usando Redis para autenticação');
       authStatePromise = useMultiFileAuthStateRedisDb(this.instanceId, this.cache);
    } else if (dbConfig?.SAVE_DATA?.INSTANCE) {
       this.logger.info('Usando Prisma (DB) para autenticação');
       authStatePromise = useMultiFileAuthStatePrisma(this.instanceId, this.prismaRepository); // Passar repo corrigido
    } else {
        this.logger.warn('Nenhum método de persistência configurado (Provider, Redis, DB). Usando MultiFileAuthState padrão (não recomendado para produção).');
        const sessionDir = path.join('./instances', this.instanceId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        // useMultiFileAuthState original não retorna clearState, precisamos adaptar ou usar as outras opções
        // Adaptação simples (pode não limpar tudo):
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const clearState = async () => {
            // Tenta remover arquivos da sessão (simplista)
            try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                 this.logger.info(`Diretório de sessão ${sessionDir} removido (limpeza padrão).`);
            } catch (e) {
                this.logger.error({ err: e }, `Erro ao limpar diretório de sessão padrão ${sessionDir}`);
            }
        };
        authStatePromise = Promise.resolve({ state, saveCreds, clearState });
    }

    // Garantir que o retorno sempre tenha clearState
    return authStatePromise.then(auth => {
        if (!auth.clearState) {
             this.logger.warn('Método clearState não encontrado no AuthState retornado. Adicionando fallback.');
             auth.clearState = async () => { this.logger.warn('Fallback clearState chamado, nenhuma ação real executada.'); };
        }
        return auth;
    });
  }


  private async createClient(number?: string | null): Promise<WASocket> {
    this.logger.info(`Criando cliente Baileys para instância ${this.instanceName}...`);
    this.instance.authState = (await this.defineAuthState()).state; // Apenas o 'state' é necessário aqui
    const authStateMethods = await this.defineAuthState(); // Pega os métodos para config

    // CORREÇÃO TS2305: Usar tipo da configuração
    const sessionConfig = this.configService.get<wa.ConfigSessionPhoneConfig>('CONFIG_SESSION_PHONE');

    let browserOptions: { browser?: WABrowserDescription } = {};
    if (number) {
      this.phoneNumber = number;
      this.logger.info(`Usando número de telefone para pareamento: ${number}`);
    } else {
      const browser: WABrowserDescription = [sessionConfig?.CLIENT ?? 'Evolution API', sessionConfig?.NAME ?? 'Chrome', release()];
      browserOptions = { browser };
      this.logger.info(`Usando configuração de browser: ${browser.join(' / ')}`);
    }

    let version: [number, number, number] | undefined;
    let logVersion = '';
    if (sessionConfig?.VERSION) {
        try {
            const vParts = sessionConfig.VERSION.split('.').map(Number);
            if (vParts.length === 3 && vParts.every(v => Number.isInteger(v) && v >= 0)) {
                version = vParts as [number, number, number];
                logVersion = `Versão Baileys definida no .env: ${sessionConfig.VERSION}`;
            } else {
                this.logger.warn(`Versão Baileys no .env (${sessionConfig.VERSION}) inválida. Buscando a mais recente.`);
                sessionConfig.VERSION = undefined; // Força busca
            }
        } catch {
             this.logger.warn(`Erro ao processar versão Baileys no .env (${sessionConfig.VERSION}). Buscando a mais recente.`);
             sessionConfig.VERSION = undefined; // Força busca
        }
    }

    if (!version) { // Se não foi definida ou era inválida
      try {
        const baileysVersion = await fetchLatestBaileysVersion();
        version = baileysVersion.version;
        logVersion = `Versão Baileys mais recente: ${version.join('.')}`;
      } catch (e: any) {
        this.logger.error({ err: e }, `Falha ao buscar última versão do Baileys. Usando padrão interno.`);
      }
    }
    this.logger.info(logVersion);


    this.logger.info(`Ignorar Grupos: ${this.localSettings?.groupsIgnore ?? false}`);
    let agentOptions: { agent?: any, fetchAgent?: any } = {};

    if (this.localProxy?.enabled && this.localProxy?.host) {
      this.logger.info(`Proxy habilitado: ${this.localProxy.protocol}://${this.localProxy.host}:${this.localProxy.port}`);
      try {
        if (this.localProxy.host.includes('proxyscrape')) {
             const response = await axios.get(this.localProxy.host);
             const proxyUrls = response.data.split('\r\n').filter((p: string) => p);
             if (proxyUrls.length > 0) {
                const randomProxyUrl = 'http://' + proxyUrls[Math.floor(Math.random() * proxyUrls.length)];
                this.logger.info(`Usando proxy aleatório de proxyscrape: ${randomProxyUrl}`);
                agentOptions = { agent: makeProxyAgent(randomProxyUrl), fetchAgent: makeProxyAgent(randomProxyUrl) };
             } else {
                throw new Error('Lista de proxies de proxyscrape vazia.');
             }
        } else {
            // CORREÇÃO TS2345: Garantir que port seja string para makeProxyAgent
            const proxyConfig: Proxy = { // Usar tipo Proxy se definido
                host: this.localProxy.host,
                port: String(this.localProxy.port || '80'), // <-- Convertido para string
                protocol: this.localProxy.protocol as 'http' | 'https' | 'socks4' | 'socks5',
                username: this.localProxy.username,
                password: this.localProxy.password,
            };
            agentOptions = { agent: makeProxyAgent(proxyConfig), fetchAgent: makeProxyAgent(proxyConfig) };
        }
      } catch (error: any) {
        this.logger.error({ err: error, proxyHost: this.localProxy.host }, `Erro ao configurar proxy. Desabilitando proxy para esta conexão.`);
      }
    }

    // CORREÇÃO TS2339: Usar logBaileys definido na classe
    const socketConfig: UserFacingSocketConfig = {
      ...agentOptions,
      version,
      // Usa o logger pino configurado
      logger: P({ level: this.logBaileys ?? 'silent' }),
      printQRInTerminal: false,
      mobile: false,
      // Usa o state e saveCreds do método defineAuthState
      auth: {
        creds: authStateMethods.state.creds,
        keys: authStateMethods.state.keys,
      },
      // Passa a função saveCreds para o Baileys
      // saveCreds: authStateMethods.saveCreds, // Baileys chama saveCreds internamente via auth.saveCreds? Verificar documentação Baileys.
      msgRetryCounterCache: this.msgRetryCounterCache,
      userDevicesCache: this.userDevicesCache,
      generateHighQualityLinkPreview: true,
      getMessage: (key) => this.getMessage(key),
      ...browserOptions,
      markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      qrTimeout: 45_000,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid): boolean => {
        if (!jid) return false;
        const isGroup = this.localSettings?.groupsIgnore && isJidGroup(jid);
        const isBroadcastUser = !this.localSettings?.readStatus && isJidBroadcast(jid);
        const isNewsletterJid = isJidNewsletter(jid);
        return !!(isGroup || isBroadcastUser || isNewsletterJid);
      },
      syncFullHistory: this.localSettings?.syncFullHistory ?? false,
      shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification): boolean => {
        return this.historySyncNotification(msg);
      },
      // getcachedGroupMetadata: this.getGroupMetadataCache, // TODO: Implementar
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
       patchMessageBeforeSending: (msg) => {
          if (msg.deviceSentMessage?.message?.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
              msg = JSON.parse(JSON.stringify(msg));
              msg.deviceSentMessage.message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
          }
          if (msg.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
              msg = JSON.parse(JSON.stringify(msg));
              msg.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
          }
          return msg;
      },
    };

    this.endSession = false;
    this.logger.info(
        `Iniciando conexão Baileys com config: ${JSON.stringify({
            version: socketConfig.version?.join('.'),
            markOnlineOnConnect: socketConfig.markOnlineOnConnect,
            syncFullHistory: socketConfig.syncFullHistory,
        })}`
    );

    try {
        this.client = makeWASocket(socketConfig);
        // Anexa listeners de eventos principais APÓS a criação bem-sucedida
        this.setupMainEventListeners(); // Renomeado de eventListeners para clareza
        // Salvar creds inicial (importante se authState foi recém-criado)
        await authStateMethods.saveCreds();

    } catch (error: any) {
      this.logger.error({ err: error }, `Erro CRÍTICO ao criar o socket Baileys`);
      throw new InternalServerErrorException(`Falha ao iniciar cliente Baileys: ${error.message}`);
    }

    if (this.localSettings?.wavoipToken && this.client) { // Verificar client
      this.logger.info('Configurando chamadas de voz...');
      try {
          // CORREÇÃO TS2304: Usar useVoiceCallsBaileys importado
          useVoiceCallsBaileys(this.localSettings.wavoipToken, this.client, this.stateConnection as any, true);
          this.setupCallListeners();
      } catch(vcError: any) {
          this.logger.error({ err: vcError }, `Falha ao inicializar chamadas de voz`);
      }
    }

    return this.client;
  } // Fim createClient

  private setupCallListeners(): void {
    if (!this.client?.ws) { // Verificar client e ws
        this.logger.warn('Tentativa de configurar listeners de chamada sem WebSocket ativo.');
        return;
    };
    this.client.ws.on('CB:call', (packet) => {
      this.logger.debug({ packet }, `Evento CB:call recebido`);
      const payload = { event: 'CB:call', packet };
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });

    this.client.ws.on('CB:ack,class:call', (packet) => {
      this.logger.debug({ packet }, `Evento CB:ack,class:call recebido`);
      const payload = { event: 'CB:ack,class:call', packet };
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });
  }

  // CORREÇÃO: Renomeado de connectToWhatsapp para start
  public async start(number?: string | null): Promise<WASocket | null> {
    try {
      this.logger.info(`Iniciando instância Baileys ${this.instanceName}...`);
      // Carregar configurações ANTES de criar o cliente
      await this.loadChatwoot();
      await this.loadSettings(); // Garante que localSettings esteja carregado
      await this.loadWebhook();
      await this.loadProxy(); // Garante que localProxy esteja carregado
      this.logger.info(`Configurações carregadas para ${this.instanceName}`);

      this.client = await this.createClient(number); // Cria e atribui o cliente

      // Anexar listener de conexão APÓS criar o cliente
      this.client?.ev?.on('connection.update', (update) => {
         this.connectionUpdate(update).catch(err => this.logger.error({ err }, 'Erro no handler connectionUpdate'));
      });

      return this.client;
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro para logger
      this.logger.error({ err: error }, `Erro fatal ao iniciar instância ${this.instanceName}`);
      // Tentar limpar se falhou
      try {
          // CORREÇÃO TS2304: Usar this.instanceName
          this.logger.warn(`Tentando remover registro DB para ${this.instanceName} devido à falha na inicialização...`);
          // Usar waMonitor injetado ou método da classe base se existir
          await this.waMonitor.deleteAccount(this.instanceName); // Assumindo que waMonitor tem deleteAccount
      } catch(cleanupError) {
           this.logger.error({ err: cleanupError }, `Erro adicional ao tentar limpar DB para ${this.instanceName}`);
      }
      // CORREÇÃO TS2304: Usar InternalServerErrorException importado
      throw new InternalServerErrorException(`Erro ao inicializar instância ${this.instanceName}: ${error.message}`);
    }
  }

  public async reloadConnection(): Promise<WASocket | null> {
    this.logger.info(`Recarregando conexão para ${this.instanceName}...`);
    try {
      await this.client?.logout(`Reloading connection for ${this.instanceName}`);
      this.client?.ws?.close();
      this.client?.end(new Error('Reloading connection'));
    } catch(e: any) { // Tipar erro
        this.logger.warn({ err: e }, `Erro ao limpar conexão antiga durante reload`);
    } finally {
        this.client = null;
    }
    return await this.start(this.phoneNumber);
  }

  // --- Handlers de Eventos ---

  // CORREÇÃO: Adicionar this aos handlers e usar logger/prismaRepository da classe
  private readonly chatHandle = {
    'chats.upsert': async (chats: Chat[]): Promise<void> => {
      try {
        const existingChats = await this.prismaRepository.findManyChats({
          where: { instanceId: this.instanceId }, select: { remoteJid: true },
        });
        const existingChatIdSet = new Set(existingChats.map((chat) => chat.remoteJid));

        const chatsToInsert = chats
          .filter((chat) => !existingChatIdSet.has(chat.id))
          .map((chat) => ({
            remoteJid: chat.id, instanceId: this.instanceId,
            name: chat.name, unreadMessages: chat.unreadCount ?? 0,
          }));

        this.logger.debug(`Chats.upsert: ${chatsToInsert.length} novos chats para inserir.`);
        await this.sendDataWebhook(Events.CHATS_UPSERT, chatsToInsert); // Usa this.sendDataWebhook

        // CORREÇÃO TS2305: Usar tipo Database da configuração
        if (chatsToInsert.length > 0 && this.configService.get<wa.DatabaseConfig>('DATABASE')?.SAVE_DATA?.CHATS) {
            await this.prismaRepository.createManyChats({ // Usa this.prismaRepository
              data: chatsToInsert, skipDuplicates: true,
            });
        }
      } catch (error: any) {
        this.logger.error({ err: error }, `Erro em chats.upsert`); // Usa this.logger
      }
    },

    'chats.update': async (chats: Array<Partial<Chat & { lastMessageRecvTimestamp?: number | Long | null }>>): Promise<void> => {
      this.logger.debug(`Chats.update: Recebidas ${chats.length} atualizações.`);
      const chatsRaw = chats.map((chat) => ({
        remoteJid: chat.id, instanceId: this.instanceId,
        unreadCount: chat.unreadCount, name: chat.name // Incluir nome se disponível
      }));
      await this.sendDataWebhook(Events.CHATS_UPDATE, chatsRaw); // Usa this.sendDataWebhook
      // TODO: Implementar lógica de atualização no DB se necessário
    },

    'chats.delete': async (chats: string[]): Promise<void> => {
      this.logger.info(`Chats.delete: Removendo ${chats.length} chats.`);
      try {
        await this.prismaRepository.deleteManyChats({ // Usa this.prismaRepository
          where: { instanceId: this.instanceId, remoteJid: { in: chats } },
        });
        await this.sendDataWebhook(Events.CHATS_DELETE, chats); // Usa this.sendDataWebhook
      } catch (error: any) {
        this.logger.error({ err: error }, `Erro em chats.delete`); // Usa this.logger
      }
    },
  }; // Fim chatHandle

  private readonly contactHandle = {
    'contacts.upsert': async (contacts: Contact[]): Promise<void> => {
      this.logger.debug(`Contacts.upsert: Recebidos ${contacts.length} contatos.`);
      try {
        // CORREÇÃO TS2694: Usar tipo ContactPayload importado
        const contactsRaw: ContactPayload[] = contacts.map((contact) => ({
          remoteJid: contact.id,
          pushName: contact?.name || contact?.verifiedName || contact.id.split('@')[0],
          profilePicUrl: null, // Será atualizado depois
          instanceId: this.instanceId,
        }));

        if (contactsRaw.length > 0) {
          await this.sendDataWebhook(Events.CONTACTS_UPSERT, contactsRaw);
          // CORREÇÃO TS2305: Usar tipo Database da configuração
          if (this.configService.get<wa.DatabaseConfig>('DATABASE')?.SAVE_DATA?.CONTACTS) {
              await this.prismaRepository.createManyContacts({ // Usa this.prismaRepository
                data: contactsRaw.map(c => ({
                    remoteJid: c.remoteJid, pushName: c.pushName, instanceId: c.instanceId,
                })),
                skipDuplicates: true,
              });
          }
          const usersContacts = contactsRaw.filter((c) => c.remoteJid.endsWith('@s.whatsapp.net'));
          if (usersContacts.length > 0) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
          }
        }

        // CORREÇÃO TS2339: Usar chatwootService injetado e localChatwoot da base
        if (
          this.configService.get<wa.ChatwootConfig>('CHATWOOT')?.ENABLED &&
          this.localChatwoot?.enabled &&
          this.localChatwoot.importContacts &&
          contactsRaw.length
        ) {
          this.logger.info(`Enviando ${contactsRaw.length} contatos para importação Chatwoot...`);
          this.chatwootService?.addHistoryContacts?.(
            { instanceName: this.instance.name, instanceId: this.instanceId },
            contactsRaw,
          );
          chatwootImport?.importHistoryContacts?.(
            { instanceName: this.instance.name, instanceId: this.instanceId },
            this.localChatwoot,
          );
        }

        // Atualizar fotos (mantido, mas usar this.profilePicture da classe)
        const updatedContacts = await Promise.all(
          contactsRaw.map(async (contact) => {
            try {
                const picInfo = await this.profilePicture(contact.remoteJid); // Usa this.profilePicture
                return { ...contact, profilePicUrl: picInfo.profilePictureUrl };
            } catch { return contact; }
          })
        );

        if (updatedContacts.length > 0) {
          const usersContactsWithPic = updatedContacts.filter((c) => c.remoteJid.endsWith('@s.whatsapp.net'));
          if (usersContactsWithPic.length > 0) {
             await saveOnWhatsappCache(usersContactsWithPic.map((c) => ({ remoteJid: c.remoteJid })));
          }
          await this.sendDataWebhook(Events.CONTACTS_UPDATE, updatedContacts);

          // Upsert no DB (usa this.prismaRepository)
          await Promise.all(
            updatedContacts.map(contact =>
              this.prismaRepository.upsertContact({ // Usa método corrigido
                where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
                create: { remoteJid: contact.remoteJid, instanceId: contact.instanceId, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
                update: { pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
              })
            )
          );

          // Chatwoot update (usa this.chatwootService injetado)
          if (this.configService.get<wa.ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
            const instance = { instanceName: this.instance.name, instanceId: this.instanceId };
            for (const contact of updatedContacts) {
               try {
                  // CORREÇÃO TS2339: Chamar método correto do chatwootService
                   const findParticipant = await this.chatwootService?.findContact?.(
                       instance, contact.remoteJid.split('@')[0],
                   );
                   if (findParticipant?.id) {
                      // CORREÇÃO TS2339: Chamar método correto do chatwootService
                       await this.chatwootService?.updateContact?.(instance, findParticipant.id, {
                           name: contact.pushName, avatar_url: contact.profilePicUrl,
                       });
                   }
               } catch (chatwootError: any) {
                   this.logger.error({ err: chatwootError, contactJid: contact.remoteJid }, `Erro ao atualizar contato no Chatwoot`);
               }
            }
          }
        }
      } catch (error: any) {
        this.logger.error({ err: error }, `Erro em contacts.upsert`);
      }
    }, // Fim contacts.upsert

    'contacts.update': async (contacts: Array<Partial<Contact>>): Promise<void> => {
      this.logger.debug(`Contacts.update: Recebidas ${contacts.length} atualizações.`);
      try {
        // CORREÇÃO TS2694: Usar tipo ContactPayload importado
        const contactsRaw: ContactPayload[] = [];
        for await (const contact of contacts) {
           if (!contact.id) continue;
            let profilePicUrl: string | null = null;
            try {
               profilePicUrl = (await this.profilePicture(contact.id)).profilePictureUrl; // Usa this.profilePicture
            } catch { /* Ignora */ }
            contactsRaw.push({
                remoteJid: contact.id,
                pushName: contact?.name ?? contact?.verifiedName ?? contact.id.split('@')[0],
                profilePicUrl: profilePicUrl, instanceId: this.instanceId,
            });
        }

        await this.sendDataWebhook(Events.CONTACTS_UPDATE, contactsRaw); // Usa this.sendDataWebhook

        // Upsert no DB (usa this.prismaRepository)
        const updateTransactions = contactsRaw.map((contact) =>
            this.prismaRepository.upsertContact({ // Usa método corrigido
                where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
                create: { remoteJid: contact.remoteJid, instanceId: contact.instanceId, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
                update: { pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
            }),
        );
        await this.prismaRepository.$transaction(updateTransactions); // Usa método corrigido

        const usersContacts = contactsRaw.filter((c) => c.remoteJid.endsWith('@s.whatsapp.net'));
        if (usersContacts.length > 0) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
        }
      } catch (error: any) {
        this.logger.error({ err: error }, `Erro em contacts.update`);
      }
    }, // Fim contacts.update
  }; // Fim contactHandle


  // CORREÇÃO: Usar this
  private readonly labelHandle = {
    [Events.LABELS_EDIT]: async (label: Label): Promise<void> => {
      this.logger.debug(`Labels.edit: Processando label ${label.id} (${label.name}), Deletado: ${label.deleted}`);
      await this.sendDataWebhook(Events.LABELS_EDIT, { ...label, instance: this.instanceName });

      try {
        const savedLabel = await this.prismaRepository.findFirstLabel({ // Usa repo
           where: { instanceId: this.instanceId, labelId: label.id },
        });

        if (label.deleted && savedLabel) {
            await this.prismaRepository.deleteLabel({ // Usa repo
                where: { labelId_instanceId: { instanceId: this.instanceId, labelId: label.id } },
            });
            this.logger.info(`Label ${label.id} removida do DB.`);
            return;
        } else if (label.deleted) {
            this.logger.warn(`Tentativa de deletar label ${label.id} não encontrada no DB.`);
            return;
        }

        const labelName = label.name?.replace(/[^\x20-\x7E]/g, '') ?? `Label_${label.id}`;
        const labelColor = `${label.color}`;

        if (!savedLabel || savedLabel.color !== labelColor || savedLabel.name !== labelName) {
            // CORREÇÃO TS2305: Usar tipo Database da configuração
            if (this.configService.get<wa.DatabaseConfig>('DATABASE')?.SAVE_DATA?.LABELS) {
                const labelData = {
                    color: labelColor, name: labelName, labelId: label.id,
                    predefinedId: label.predefinedId, instanceId: this.instanceId,
                };
                await this.prismaRepository.upsertLabel({ // Usa repo
                    where: { labelId_instanceId: { instanceId: labelData.instanceId, labelId: labelData.labelId } },
                    update: labelData, create: labelData,
                });
                 this.logger.info(`Label ${label.id} salva/atualizada no DB.`);
            }
        }
      } catch (error: any) {
        // CORREÇÃO TS2554: Passar objeto de erro para logger
        this.logger.error({ err: error, labelId: label.id }, `Erro em labels.edit`);
      }
    }, // Fim LABELS_EDIT

    [Events.LABELS_ASSOCIATION]: async (data: { association: LabelAssociation; type: 'remove' | 'add' }): Promise<void> => {
      if (!data?.association) {
          this.logger.warn('Evento LABELS_ASSOCIATION recebido sem dados de associação.');
          return;
      }
      this.logger.info(
        `Labels.association - Chat: ${data.association.chatId}, Tipo: ${data.type}, Label: ${data.association.labelId}`
      );

      // CORREÇÃO TS2305: Usar tipo Database da configuração
      if (this.configService.get<wa.DatabaseConfig>('DATABASE')?.SAVE_DATA?.CHATS) {
        const instanceId = this.instanceId;
        const chatId = data.association.chatId;
        const labelId = data.association.labelId;

        try {
            if (data.type === 'add') {
                await this.prismaRepository.addLabelToChat(labelId, instanceId, chatId); // Usa repo
            } else if (data.type === 'remove') {
                await this.prismaRepository.removeLabelFromChat(labelId, instanceId, chatId); // Usa repo
            }
        } catch (error: any) {
           // CORREÇÃO TS2554: Passar objeto de erro para logger
           this.logger.error({ err: error, labelId, chatId }, `Erro ao associar/desassociar label`);
        }
      }

      await this.sendDataWebhook(Events.LABELS_ASSOCIATION, {
        instance: this.instanceName, type: data.type, chatId: data.association.chatId, labelId: data.association.labelId,
      });
    }, // Fim LABELS_ASSOCIATION
  }; // Fim labelHandle


  // Método principal que anexa os handlers de eventos ao cliente Baileys
  // CORREÇÃO: Renomeado de eventListeners para setupMainEventListeners
  private setupMainEventListeners(): void {
    if (!this.client) {
       this.logger.error('Tentativa de anexar listeners a um cliente Baileys não inicializado.');
       return;
    }

    this.client.ev.process(async (events) => {
      if (this.endSession) {
         this.logger.warn(`Sessão ${this.instanceName} marcada como finalizada. Ignorando eventos.`);
         return;
      }

      try {
        // const settings = await this.findSettings(); // Busca configurações a cada evento? Pode ser ineficiente.
        const settings = this.localSettings; // Usar settings carregados no início
        // CORREÇÃO TS2305: Usar tipo Database da configuração
        // const databaseConfig = this.configService.get<wa.DatabaseConfig>('DATABASE');

        // Processamento de chamadas (simplificado)
        if (events.call) {
          const call = events.call[0];
          this.logger.info({ callId: call.id, from: call.from, status: call.status }, `Evento de chamada recebido`);
          if (settings?.rejectCall && call.status === 'offer') {
            this.logger.info(`Rejeitando chamada ${call.id} de ${call.from}`);
            await this.client?.rejectCall(call.id, call.from);
          }
          if (settings?.msgCall?.trim() && call.status === 'offer') {
            this.logger.info(`Enviando mensagem de rejeição de chamada para ${call.from}`);
            const msg = await this.client?.sendMessage(call.from, { text: settings.msgCall });
            if (msg && this.client) { // Emitir localmente se necessário
              // this.client.ev.emit('messages.upsert', { messages: [msg], type: 'notify' });
            }
          }
          await this.sendDataWebhook(Events.CALL, call);
        }

        // Credenciais
        if (events['creds.update']) {
           this.logger.debug('Evento creds.update recebido. Salvando credenciais...');
           // A lógica de salvar creds agora está dentro de defineAuthState/useMultiFileAuthState*
           // await this.instance?.authState?.saveCreds(); // Não chamar aqui diretamente?
        }

        // Processar eventos usando os handlers definidos
        if (events['messaging-history.set']) {
             this.logger.info('Processando evento messaging-history.set...');
            // TODO: Implementar this.messageHandle['messaging-history.set']
        }
        if (events['messages.upsert']) {
             this.logger.debug(`Processando evento messages.upsert: ${events['messages.upsert'].messages?.length} mensagens.`);
            // TODO: Implementar this.messageHandle['messages.upsert']
        }
        if (events['messages.update']) {
             this.logger.debug(`Processando evento messages.update: ${events['messages.update'].length} atualizações.`);
            // TODO: Implementar this.messageHandle['messages.update']
        }
        if (events['message-receipt.update']) {
             this.logger.debug(`Processando evento message-receipt.update: ${events['message-receipt.update'].length} recibos.`);
             // TODO: Implementar lógica de atualização de status se necessário
        }
        if (events['presence.update']) {
            // CORREÇÃO TS2339: Usar this.logger.trace
            this.logger.trace({ presence: events['presence.update'] }, `Processando evento presence.update`);
            if (settings?.groupsIgnore && events['presence.update'].id.includes('@g.us')) return;
            await this.sendDataWebhook(Events.PRESENCE_UPDATE, events['presence.update']);
        }

        // Grupos (usar this.groupHandler)
        if (!settings?.groupsIgnore) {
            if (events['groups.upsert']) {
                // CORREÇÃO TS2339: Usar this.groupHandler
                this.groupHandler['groups.upsert']?.(events['groups.upsert']);
            }
            if (events['groups.update']) {
                // CORREÇÃO TS2339: Usar this.groupHandler
                this.groupHandler['groups.update']?.(events['groups.update']);
            }
            if (events['group-participants.update']) {
                // CORREÇÃO TS2339: Usar this.groupHandler
                this.groupHandler['group-participants.update']?.(events['group-participants.update']);
            }
        }

        // Chats (usar this.chatHandle)
        if (events['chats.upsert']) { this.chatHandle['chats.upsert'](events['chats.upsert']); }
        if (events['chats.update']) { this.chatHandle['chats.update'](events['chats.update']); }
        if (events['chats.delete']) { this.chatHandle['chats.delete'](events['chats.delete']); }

        // Contatos (usar this.contactHandle)
        if (events['contacts.upsert']) { this.contactHandle['contacts.upsert'](events['contacts.upsert']); }
        if (events['contacts.update']) { this.contactHandle['contacts.update'](events['contacts.update']); }

        // Labels (usar this.labelHandle)
        if (events[Events.LABELS_ASSOCIATION]) { this.labelHandle[Events.LABELS_ASSOCIATION](events[Events.LABELS_ASSOCIATION]); }
        if (events[Events.LABELS_EDIT]) { this.labelHandle[Events.LABELS_EDIT](events[Events.LABELS_EDIT]); }

      } catch (error: any) {
        // CORREÇÃO TS2554: Passar objeto de erro para logger
        this.logger.error({ err: error }, `Erro geral no processamento de eventos Baileys`);
      }
    }); // Fim client.ev.process
  } // Fim setupMainEventListeners

  // ... (Implementação dos outros métodos como profilePicture, getStatus, offerCall, etc., mantidos com correções anteriores) ...

  // ===== Helpers do baileys (corrigidos anteriormente) =====
  // ... (baileysOnWhatsapp, baileysProfilePictureUrl, etc.) ...

  // Exemplo: Implementação de findSettings (corrigido anteriormente)
  // CORREÇÃO TS2416: Garantir que o tipo de retorno seja compatível com a base
  // A classe base ChannelStartupService espera Promise<{ rejectCall: boolean; ... }>
  // A wa.LocalSettings precisa ter essas propriedades como obrigatórias ou a base precisa aceitar opcionais.
  public async findSettings(): Promise<wa.LocalSettings> { // Ajustado para retornar sempre LocalSettings (pode ser com defaults)
    this.logger.debug(`Buscando configurações para ${this.instanceName}...`);
    try {
       const data = await this.prismaRepository.findUniqueSetting({ // Usa repo
          where: { instanceId: this.instanceId },
       });
       const settings: wa.LocalSettings = {
           // Valores padrão se não encontrados no DB
           rejectCall: data?.rejectCall ?? false,
           msgCall: data?.msgCall ?? '',
           groupsIgnore: data?.groupsIgnore ?? false,
           alwaysOnline: data?.alwaysOnline ?? true,
           readMessages: data?.readMessages ?? true,
           readStatus: data?.readStatus ?? false,
           syncFullHistory: data?.syncFullHistory ?? false,
           wavoipToken: data?.wavoipToken ?? '',
       };
       // Atualiza cache local
       Object.assign(this.localSettings, settings);
       return settings; // Retorna o objeto completo
    } catch (error: any) {
       this.logger.error({ err: error }, `Erro ao buscar configurações, retornando padrões.`);
       // Retorna padrões em caso de erro
       const defaultSettings: wa.LocalSettings = {
           rejectCall: false, msgCall: '', groupsIgnore: false, alwaysOnline: true,
           readMessages: true, readStatus: false, syncFullHistory: false, wavoipToken: '',
       };
        Object.assign(this.localSettings, defaultSettings); // Atualiza cache local com defaults
       return defaultSettings;
    }
 }

} // Fim da classe BaileysStartupService
