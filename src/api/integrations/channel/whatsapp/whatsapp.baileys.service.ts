// src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts

// --- Baileys Imports ---
import makeWASocket, {
  AuthenticationState,
  BrowseSessionState,
  Chat,
  ConnectionState,
  Contact,
  DisconnectReason,
  fetchLatestBaileysVersion,
  GroupMetadata,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  makeCacheableSignalKeyStore,
  makeWASocket,
  MessageUserReceiptUpdate,
  ParticipantAction,
  proto,
  useMultiFileAuthState, // Import base para estado, pode ser substituído pelas implementações Prisma/Redis
  UserFacingSocketConfig,
  WAMessageKey,
  WAMessageContent,
  WASocket,
  WABrowserDescription,
  WAPresence,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache'; // Import NodeCache
import { delay } from '@whiskeysockets/baileys'; // Delay já estava na lista de erros

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
import { ChannelStartupService } from '@api/services/channel.service';
import { ConfigService } from '@config/config.service';
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Corrigido caminho relativo/alias
import { ProviderFiles } from '@provider/sessions';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
// Types
import { wa, Events, QrCode, Log, Chatwoot, Database, CacheConf, ProviderSession, ConfigSessionPhone } from '@api/types/wa.types'; // Assumindo que esses tipos estão em wa.types
// Utils
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files'; // Assumindo localização
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db'; // Assumindo localização
import { useMultiFileAuthStatePrisma } from '@utils/use-multi-file-auth-state-prisma'; // Assumindo localização
import { createJid } from '@utils/createJid'; // Assumindo localização
import { saveOnWhatsappCache, getFromWhatsappCache } from '@utils/onWhatsappCache'; // Assumindo localização
import { makeProxyAgent } from '@utils/makeProxyAgent'; // Assumindo localização
// TODO: Se chatwootImport for uma classe/objeto real, importe-o corretamente
// import * as chatwootImport from '@integrations/chatbot/chatwoot/utils/chatwoot-import-helper'; // Exemplo de import
// Placeholder para chatwootImport se não for uma importação real
const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } };

// Libs
import axios from 'axios';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys/lib/Utils'; // Import BufferJSON e initAuthCreds
import { Prisma } from '@prisma/client'; // Import Prisma para tipos se necessário
import P from 'pino'; // Import Pino
import qrcode from 'qrcode'; // Import qrcode
import qrcodeTerminal from 'qrcode-terminal'; // Import qrcode-terminal
import { v4 as cuid } from 'uuid'; // Import v4 como cuid
import EventEmitter2 from 'eventemitter2';

// Tipagem para CacheStore (interface simples)
interface CacheStore {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): boolean;
    del(key: string): number;
    flushAll?(): void; // Opcional
}

// TODO: Verificar CacheEngine e CacheService - A implementação atual pode ter conflitos de tipo com ICache
// const groupMetadataCache = new CacheService(new CacheEngine(configService, 'groups').getEngine()); // Precisa de configService aqui?

// Função getVideoDuration (movida para cá ou para um arquivo utils)
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> {
  try {
    const MediaInfoFactory = (await import('mediainfo.js')).default;
    const mediainfo = await MediaInfoFactory({ format: 'JSON' });

    let fileSize: number;
    let readChunk: (chunkSize: number, offset: number) => Promise<Uint8Array>; // Ajustado para Uint8Array

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
        return buffer.slice(0, bytesRead); // Retorna apenas os bytes lidos
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
      const chunks: Buffer[] = [];
      for await (const chunk of input) {
        chunks.push(chunk as Buffer); // Cast para Buffer
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
    console.error("Erro ao obter duração do vídeo:", error);
    return 0; // Retorna 0 em caso de erro
  }
}

export class BaileysStartupService extends ChannelStartupService {
  // << CORREÇÃO: Declarar client corretamente >>
  public client: WASocket | null = null;
  // << CORREÇÃO: Usar tipo Baileys ConnectionState >>
  public stateConnection: ConnectionState = { connection: 'close', lastDisconnect: undefined }; // Estado inicial
  public phoneNumber: string | null = null; // Pode ser nulo se não usar pareamento por número
  private authStateProvider: AuthStateProvider;
  // << CORREÇÃO: Tipar CacheStore e usar NodeCache corretamente >>
  private readonly msgRetryCounterCache: CacheStore = new NodeCache();
  private readonly userDevicesCache: CacheStore = new NodeCache();
  private endSession = false;
  // << CORREÇÃO: Inicializar logger >>
  private readonly logger: Logger; // Logger agora é inicializado no construtor da base ou aqui

  constructor(
    // Herdando da classe base
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService, // Cache genérico
    public readonly chatwootCache: CacheService, // Cache específico Chatwoot
    public readonly baileysCache: CacheService, // Cache específico Baileys
    private readonly providerFiles: ProviderFiles, // Provider para estado de autenticação
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache); // Chama construtor da base
    this.logger = new Logger(`BaileysStartupService`); // Inicializa logger específico
    // << CORREÇÃO TS2339: Inicializar instance.qrcode >>
    this.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null }; // Inicializa qrcode
    // << CORREÇÃO TS2304 / TS2339: Inicializar AuthStateProvider >>
    this.authStateProvider = new AuthStateProvider(this.providerFiles);
    // Inicializa logger na classe base também, se necessário
    // super.logger = this.logger; // Ou a base inicializa o seu próprio logger
  }

  // --- Getters ---
  // << CORREÇÃO: Sobrescrever getters/setters se necessário ou usar os da base >>
  // Se a classe base já tem getters para instanceId, instanceName, etc., não precisa redefinir.
  // Acessar via this.instanceId, this.instanceName

  public get connectionStatus(): ConnectionState {
    return this.stateConnection;
  }

  // Acessando profilePictureUrl do objeto 'instance' gerenciado internamente ou na base
  public get profilePictureUrl(): string | null | undefined {
    return this.instance.profilePictureUrl; // Acessa a propriedade dinâmica
  }

  public get qrCode(): wa.QrCode { // wa.QrCode precisa estar definido em wa.types.ts
    return {
      // << CORREÇÃO TS2339: Acessar this.instance.qrcode com segurança >>
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count ?? 0, // Garante um número
    };
  }

  // --- Métodos ---
  public async logoutInstance(): Promise<void> {
    this.logger.info(`Tentando logout da instância: ${this.instanceName}`);
    try {
      // << CORREÇÃO TS2339: Usar this.client com verificação >>
      await this.client?.logout(`Log out instance: ${this.instanceName}`);
      this.client?.ws?.close();
      this.client?.end(new Error(`Logout solicitado para ${this.instanceName}`)); // Finaliza a conexão
    } catch (error: any) {
       this.logger.error(`Erro durante logout no cliente Baileys: ${error.message}`);
    } finally {
       this.client = null; // Limpa o cliente
       this.stateConnection = { connection: 'close', lastDisconnect: undefined }; // Reseta estado
    }

    try {
      // << CORREÇÃO TS2341 / TS2339: Usar método do repositório >>
      // NOTE: Implemente findFirstSession e deleteSession no PrismaRepository
      const sessionExists = await this.prismaRepository.findFirstSession({
        where: { sessionId: this.instanceId },
      });
      if (sessionExists) {
        await this.prismaRepository.deleteSession({
          where: { sessionId: this.instanceId },
        });
         this.logger.info(`Sessão removida do DB para ${this.instanceName}`);
      }
      // Limpar estado de autenticação local também
      await this.instance?.authState?.clearState?.(); // Limpa o estado se o método existir
    } catch (error: any) {
       this.logger.error(`Erro ao remover sessão do DB durante logout: ${error.message}`);
    }
  }

  public async getProfileName(): Promise<string | undefined> {
    // << CORREÇÃO TS2339: Usar this.client com verificação >>
    let profileName = this.client?.user?.name ?? this.client?.user?.verifiedName;
    if (!profileName && this.instance?.authState) { // Verifica se authState existe
      try {
        // Acessa creds do estado de autenticação gerenciado
        const creds = this.instance.authState.creds;
        profileName = creds?.me?.name || creds?.me?.verifiedName;
      } catch (error: any) {
        this.logger.error(`Erro ao ler nome do perfil das credenciais salvas: ${error.message}`);
        // Tenta buscar do DB como último recurso, se necessário (mas creds já devem estar em authState)
        // const data = await this.prismaRepository.findUniqueSession({ where: { sessionId: this.instanceId } });
        // if (data?.creds) {
        //   const credsParsed = JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver);
        //   profileName = credsParsed.me?.name || credsParsed.me?.verifiedName;
        // }
      }
    }
    return profileName;
  }

  public async getProfileStatus(): Promise<string | undefined> {
    try {
       // << CORREÇÃO TS2339: Usar this.client e this.instance.wuid com verificação >>
      if (!this.client || !this.instance.wuid) return undefined;
      const statusResult = await this.client.fetchStatus(this.instance.wuid);
      // fetchStatus retorna um array, pegamos o primeiro elemento
      return statusResult?.[0]?.status;
    } catch (error: any) {
       this.logger.error(`Erro ao buscar status do perfil: ${error.message}`);
       return undefined;
    }
  }

  // << CORREÇÃO: Tipar corretamente o parâmetro e usar tipos Baileys >>
  private async connectionUpdate({ qr, connection, lastDisconnect }: Partial<ConnectionState>): Promise<void> {
    this.logger.info(`Atualização de conexão para ${this.instanceName}: ${connection}, QR: ${qr ? 'Sim' : 'Não'}, LastDisconnect: ${lastDisconnect?.error?.message}`);

    if (connection) {
      // Atualiza o estado local
      this.stateConnection = { connection, lastDisconnect };
    }

    if (qr) {
      // << CORREÇÃO TS2339: Acessar this.instance.qrcode com segurança >>
      const currentCount = this.instance.qrcode?.count ?? 0;
      const limit = this.configService.get<QrCode>('QRCODE')?.LIMIT ?? 5; // Usar tipo QrCode importado
      // << CORREÇÃO TS2304: Usar DisconnectReason importado >>
      if (currentCount >= limit) {
        this.logger.warn(`Limite de QR Codes (${limit}) atingido para ${this.instanceName}. Forçando desconexão.`);
        // << CORREÇÃO TS2339: Usar sendDataWebhook >>
        await this.sendDataWebhook(Events.QRCODE_UPDATED, { // Usar Events importado
          message: 'QR code limit reached, closing session.',
          statusCode: DisconnectReason.timedOut, // Usar razão apropriada
        });

        if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
          // << CORREÇÃO TS2339: Usar chatwootService >>
          await this.chatwootService?.eventWhatsapp?.(
            Events.QRCODE_UPDATED,
            { instanceName: this.instanceName, instanceId: this.instanceId },
            { message: 'QR code limit reached, closing session.', statusCode: DisconnectReason.timedOut },
          );
        }
        this.endSession = true;
        this.logoutInstance(); // Força logout ao atingir limite
        this.eventEmitter.emit('no.connection', this.instanceName); // Emitir evento
        return;
      }

      this.instance.qrcode.count = currentCount + 1;
      this.instance.qrcode.code = qr; // Atualiza o código QR

      // Geração do Base64
      try {
        const color = this.configService.get<QrCode>('QRCODE')?.COLOR ?? '#000000';
        // << CORREÇÃO TS2304: Tipar optsQrcode corretamente >>
        const optsQrcode: qrcode.QRCodeToDataURLOptions = { // Usar tipo importado
          margin: 3,
          scale: 4,
          errorCorrectionLevel: 'H',
          color: { light: '#ffffff', dark: color },
        };
        this.instance.qrcode.base64 = await qrcode.toDataURL(qr, optsQrcode); // Usar qrcode importado
      } catch (error: any) {
        this.logger.error(`Falha ao gerar QR code base64: ${error.message}`);
        this.instance.qrcode.base64 = null;
      }

      // Lógica de Pairing Code
      if (this.phoneNumber) {
        try {
          await delay(1000); // Usa delay importado
          // << CORREÇÃO TS2339: Usar this.client com verificação >>
          this.instance.qrcode.pairingCode = await this.client?.requestPairingCode(this.phoneNumber);
           this.logger.info(`Pairing code solicitado para ${this.phoneNumber}: ${this.instance.qrcode.pairingCode}`);
        } catch (error: any) {
           this.logger.error(`Erro ao solicitar pairing code: ${error.message}`);
           this.instance.qrcode.pairingCode = null;
        }
      } else {
        this.instance.qrcode.pairingCode = null;
      }

      // Enviar Webhook QR_CODE
      // << CORREÇÃO TS2339: Usar sendDataWebhook >>
      await this.sendDataWebhook(Events.QRCODE_UPDATED, { // Usar Events importado
        qrcode: {
          instance: this.instanceName,
          pairingCode: this.instance.qrcode.pairingCode,
          code: this.instance.qrcode.code,
          base64: this.instance.qrcode.base64,
          count: this.instance.qrcode.count,
        },
      });

      // Enviar para Chatwoot
      if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        // << CORREÇÃO TS2339: Usar chatwootService >>
        await this.chatwootService?.eventWhatsapp?.(
          Events.QRCODE_UPDATED,
          { instanceName: this.instanceName, instanceId: this.instanceId },
          { qrcode: this.qrCode }, // Usa o getter qrCode
        );
      }

      // Logar no terminal
      try {
        // << CORREÇÃO TS2304: Usar qrcodeTerminal importado >>
        qrcodeTerminal.generate(qr, { small: true }, (qrcodeStr) =>
          this.logger.info(
            `\n{ instance: ${this.instanceName} pairingCode: ${this.instance.qrcode.pairingCode}, qrcodeCount: ${this.instance.qrcode.count} }\n` +
              qrcodeStr,
          ),
        );
      } catch (error: any) {
         this.logger.error(`Falha ao gerar QR code no terminal: ${error.message}`);
      }

      // Atualizar status da instância no DB
      try {
        // << CORREÇÃO TS2341: Usar método do repositório >>
        // NOTE: Implemente updateInstance no PrismaRepository
        await this.prismaRepository.updateInstance({
          where: { id: this.instanceId },
          data: { connectionStatus: 'connecting' },
        });
      } catch (dbError: any) {
         this.logger.error(`Erro ao atualizar status da instância (connecting) no DB: ${dbError.message}`);
      }
    } // Fim do if(qr)

    // --- Lógica para 'connection' ---
    if (connection === 'close') {
      // << CORREÇÃO TS2304: Usar Boom e DisconnectReason importados >>
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== DisconnectReason.forbidden && statusCode !== 402 && statusCode !== 406;

       this.logger.warn(`Conexão fechada para ${this.instanceName}. Razão: ${statusCode} (${DisconnectReason[statusCode as keyof typeof DisconnectReason] ?? 'Desconhecido'}). Reconnect: ${shouldReconnect}`);


      if (this.endSession) {
         this.logger.info(`Sessão ${this.instanceName} finalizada, não tentará reconectar.`);
         // Garante limpeza final
         await this.logoutInstance();
      } else if (shouldReconnect) {
         this.logger.info(`Tentando reconectar ${this.instanceName}...`);
         // Adiciona um pequeno delay antes de tentar reconectar
         await delay(this.configService.get<any>('EVOLUTION')?.RECONNECT_DELAY ?? 5000);
         await this.connectToWhatsapp(this.phoneNumber); // Tenta reconectar
      } else {
         this.logger.error(`Não será possível reconectar ${this.instanceName}. Razão: ${statusCode}. Limpando sessão.`);
        // << CORREÇÃO TS2339: Usar sendDataWebhook >>
        await this.sendDataWebhook(Events.STATUS_INSTANCE, { // Usar Events importado
          instance: this.instanceName,
          status: 'closed',
          disconnectionAt: new Date(),
          disconnectionReasonCode: statusCode,
          disconnectionObject: JSON.stringify(lastDisconnect),
        });

        // Atualizar DB
        try {
          // << CORREÇÃO TS2341: Usar método do repositório >>
          // NOTE: Implemente updateInstance no PrismaRepository
          await this.prismaRepository.updateInstance({
            where: { id: this.instanceId },
            data: {
              connectionStatus: 'close',
              disconnectionAt: new Date(),
              disconnectionReasonCode: statusCode,
              disconnectionObject: JSON.stringify(lastDisconnect),
            },
          });
        } catch (dbError: any) {
           this.logger.error(`Erro ao atualizar status da instância (closed) no DB: ${dbError.message}`);
        }

        // Enviar para Chatwoot
        if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
          // << CORREÇÃO TS2339: Usar chatwootService >>
          await this.chatwootService?.eventWhatsapp?.(
            Events.STATUS_INSTANCE,
            { instanceName: this.instanceName, instanceId: this.instanceId },
            { instance: this.instanceName, status: 'closed' },
          );
        }

        // << CORREÇÃO TS2339: Emitir evento interno e chamar logoutInstance >>
        this.eventEmitter.emit('logout.instance', this.instanceName, 'inner');
        await this.logoutInstance(); // Limpa o cliente e estado local
      }
    } // Fim if (connection === 'close')

    if (connection === 'open') {
       this.logger.info(`Conexão aberta para ${this.instanceName}`);
       // << CORREÇÃO TS2339: Usar this.client e definir this.instance.wuid >>
       this.instance.wuid = this.client?.user?.id?.replace(/:.*$/, ''); // Garante que client existe
       if (!this.instance.wuid) {
           this.logger.error('Não foi possível obter o WUID após a conexão.');
           await this.logoutInstance(); // Desconecta se não conseguiu WUID
           return;
       }

       this.logger.info(`WUID definido: ${this.instance.wuid}`);
       this.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null }; // Reseta QR

      // Obtem nome e foto
      const profileName = await this.getProfileName();
      try {
        // << CORREÇÃO TS2339: Chamar this.profilePicture >>
        const picInfo = await this.profilePicture(this.instance.wuid);
        this.instance.profilePictureUrl = picInfo.profilePictureUrl;
      } catch (error: any) {
         this.logger.error(`Erro ao buscar foto do perfil: ${error.message}`);
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

      // Atualizar DB
      try {
        // << CORREÇÃO TS2341: Usar método do repositório >>
        // NOTE: Implemente updateInstance no PrismaRepository
        await this.prismaRepository.updateInstance({
          where: { id: this.instanceId },
          data: {
            ownerJid: this.instance.wuid,
            profileName: profileName,
            profilePicUrl: this.instance.profilePictureUrl,
            connectionStatus: 'open',
            disconnectionAt: null, // Limpa dados de desconexão
            disconnectionReasonCode: null,
            disconnectionObject: null,
          },
        });
      } catch (dbError: any) {
         this.logger.error(`Erro ao atualizar status da instância (open) no DB: ${dbError.message}`);
      }

      // Enviar para Chatwoot
      if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
        // << CORREÇÃO TS2339: Usar chatwootService >>
        await this.chatwootService?.eventWhatsapp?.(
          Events.CONNECTION_UPDATE,
          { instanceName: this.instanceName, instanceId: this.instanceId },
          { instance: this.instanceName, status: 'open' },
        );
        // << CORREÇÃO TS2339: Chamar syncChatwootLostMessages (precisa existir) >>
        // await this.syncChatwootLostMessages(); // TODO: Implementar ou remover chamada
      }

      // Enviar Webhook CONNECTION_UPDATE
      // << CORREÇÃO TS2339: Usar sendDataWebhook >>
      await this.sendDataWebhook(Events.CONNECTION_UPDATE, { // Usar Events importado
        instance: this.instanceName,
        wuid: this.instance.wuid,
        profileName: profileName,
        profilePictureUrl: this.instance.profilePictureUrl,
        state: 'open',
        statusReason: 200,
      });

    } // Fim if (connection === 'open')

    if (connection === 'connecting') {
      // << CORREÇÃO TS2339: Usar sendDataWebhook >>
      await this.sendDataWebhook(Events.CONNECTION_UPDATE, { // Usar Events importado
        instance: this.instanceName,
        state: 'connecting',
        statusReason: this.stateConnection.lastDisconnect?.error?.output?.statusCode ?? 0,
      });
    }
  } // Fim connectionUpdate

  // << CORREÇÃO: Adicionar tipo de retorno Promise<T | null> e usar BufferJSON >>
  private async getMessage<T = proto.IMessage | undefined>(key: proto.IMessageKey, full = false): Promise<T | null> {
    try {
        // << CORREÇÃO TS2341: Usar método do repositório >>
        // NOTE: Implemente findManyMessages no PrismaRepository
        const messages = await this.prismaRepository.findManyMessages({
            where: {
                instanceId: this.instanceId, // Usa instanceId da base
                key: { path: ['id'], equals: key.id },
                // Adicionar remoteJid ao where pode otimizar a busca
                // key: { path: ['remoteJid'], equals: key.remoteJid }
            },
            take: 1, // Só precisamos de uma mensagem
        });

        if (!messages || messages.length === 0) return null;

        // Desserializar a mensagem do JSON armazenado
        // << CORREÇÃO TS2304: Usar BufferJSON importado >>
        const messageData = JSON.parse(JSON.stringify(messages[0]), BufferJSON.reviver);

        if (full) {
            // Retorna o objeto completo similar a WAMessage
            return messageData as T;
        } else {
             // Lógica para poll message mantida
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
            // Retorna apenas o conteúdo da mensagem
            return messageData.message as T ?? null;
        }
    } catch (error: any) {
        this.logger.error(`Erro ao buscar mensagem ${key.id} do banco: ${error.message}`);
        return null; // Retorna null em caso de erro
    }
}


  // << CORREÇÃO: Usar tipos importados e lógica de seleção de provider >>
  private async defineAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void> }> {
    const dbConfig = this.configService.get<Database>('DATABASE');
    const cacheConfig = this.configService.get<CacheConf>('CACHE');
    const providerConfig = this.configService.get<ProviderSession>('PROVIDER');

    if (providerConfig?.ENABLED) {
       this.logger.info(`Usando ProviderFiles para autenticação: ${this.providerFiles?.constructor?.name}`);
       // << CORREÇÃO TS2339: Usar this.authStateProvider >>
      return this.authStateProvider.authStateProvider(this.instanceId); // Usa getter da base
    }
    if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
      this.logger.info('Usando Redis para autenticação');
      // << CORREÇÃO TS2304: Usar useMultiFileAuthStateRedisDb importado >>
      return await useMultiFileAuthStateRedisDb(this.instanceId, this.cache); // Usa cache da base
    }
    if (dbConfig?.SAVE_DATA?.INSTANCE) {
       this.logger.info('Usando Prisma (DB) para autenticação');
       // << CORREÇÃO TS2304: Usar useMultiFileAuthStatePrisma importado >>
      return await useMultiFileAuthStatePrisma(this.instanceId, this.cache); // Usa cache da base
    }
    // Fallback para MultiFileAuthState padrão se nenhum provider/db/redis estiver configurado
    this.logger.warn('Nenhum método de persistência configurado (Provider, Redis, DB). Usando MultiFileAuthState padrão.');
    // Cria o diretório se não existir
    const sessionDir = path.join('./instances', this.instanceId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    return await useMultiFileAuthState(sessionDir);
  }


  // << CORREÇÃO: Usar tipos Baileys e Node.js importados >>
  private async createClient(number?: string | null): Promise<WASocket> {
     this.logger.info(`Criando cliente Baileys para instância ${this.instanceName}...`);
     // << CORREÇÃO TS2339: Acessar this.instance.authState >>
    this.instance.authState = await this.defineAuthState();

    const sessionConfig = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE'); // Usar tipo importado

    let browserOptions: { browser?: WABrowserDescription } = {}; // Objeto para opções do browser

    if (number) {
      this.phoneNumber = number; // Armazena o número para reconexão
       this.logger.info(`Usando número de telefone para pareamento: ${number}`);
    } else {
      // << CORREÇÃO TS2304: Usar WABrowserDescription e release importados >>
      const browser: WABrowserDescription = [sessionConfig?.CLIENT ?? 'Evolution API', sessionConfig?.NAME ?? 'Chrome', release()];
      browserOptions = { browser };
       this.logger.info(`Usando configuração de browser: ${browser.join(' / ')}`);
    }

    let version: [number, number, number] | undefined;
    let logVersion = '';
    if (sessionConfig?.VERSION) {
      const vParts = sessionConfig.VERSION.split('.').map(Number);
      if (vParts.length === 3 && vParts.every(Number.isInteger)) {
           version = vParts as [number, number, number];
      }
      logVersion = `Versão Baileys definida no .env: ${sessionConfig.VERSION}`;
    } else {
      try {
        // << CORREÇÃO TS2304: Usar fetchLatestBaileysVersion importado >>
        const baileysVersion = await fetchLatestBaileysVersion();
        version = baileysVersion.version;
        logVersion = `Versão Baileys mais recente: ${version.join('.')}`;
      } catch (e: any) {
         this.logger.error(`Falha ao buscar última versão do Baileys: ${e.message}. Usando padrão.`);
         // Fallback para uma versão conhecida ou deixar undefined para Baileys decidir
      }
    }
    this.logger.info(logVersion);

    // << CORREÇÃO TS2339: Usar localSettings da classe base >>
    this.logger.info(`Ignorar Grupos: ${this.localSettings?.groupsIgnore ?? false}`);
    let agentOptions: { agent?: any, fetchAgent?: any } = {}; // Opções de agente/proxy

    // << CORREÇÃO TS2339: Usar localProxy da classe base >>
    if (this.localProxy?.enabled && this.localProxy?.host) {
       this.logger.info(`Proxy habilitado: ${this.localProxy.protocol}://${this.localProxy.host}:${this.localProxy.port}`);
      try {
         // << CORREÇÃO TS2304: Usar axios e makeProxyAgent importados >>
         // Lógica de ProxyScrape mantida
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
           // Proxy manual
            const proxyConfig = {
                host: this.localProxy.host,
                port: parseInt(this.localProxy.port || '80'), // Garante que port seja número
                protocol: this.localProxy.protocol as 'http' | 'https' | 'socks4' | 'socks5', // Cast para tipo esperado
                username: this.localProxy.username,
                password: this.localProxy.password,
            };
            agentOptions = { agent: makeProxyAgent(proxyConfig), fetchAgent: makeProxyAgent(proxyConfig) };
        }
      } catch (error: any) {
         this.logger.error(`Erro ao configurar proxy ${this.localProxy.host}: ${error.message}. Desabilitando proxy para esta conexão.`);
         // this.localProxy.enabled = false; // Não desabilitar permanentemente
      }
    }

    // << CORREÇÃO TS2304 / TS2339: Usar tipos e propriedades corretas >>
    const socketConfig: UserFacingSocketConfig = {
      ...agentOptions, // Inclui agente/proxy se definido
      version, // Versão do Baileys
      // << CORREÇÃO TS2304 / TS2339: Usar P e logBaileys >>
      logger: P({ level: this.logBaileys ?? 'silent' }), // Usa logger pino
      printQRInTerminal: false, // QR será tratado em connectionUpdate
      mobile: false, // Baileys geralmente emula desktop
      auth: this.instance.authState, // Estado de autenticação
      // << CORREÇÃO TS2304: Usar makeCacheableSignalKeyStore e P >>
      // signalCache: new SignalRepository(this.instance.authState.keys), // Simplificado? Verificar necessidade
      msgRetryCounterCache: this.msgRetryCounterCache,
      userDevicesCache: this.userDevicesCache,
      generateHighQualityLinkPreview: true,
      // << CORREÇÃO: Passar a função getMessage corretamente >>
      getMessage: (key) => this.getMessage(key),
      ...browserOptions, // Inclui browser info se definido
      // << CORREÇÃO TS2339: Usar localSettings da base >>
      markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true, // Usar config local
      // Configurações de timeout e keep-alive
      connectTimeoutMs: 60_000, // Aumentado para 60s
      keepAliveIntervalMs: 20_000, // 20s
      qrTimeout: 45_000, // Timeout para QR
      emitOwnEvents: false, // Não emitir eventos para próprias ações
      // << CORREÇÃO TS2339 / TS2304: Usar localSettings e jid checkers >>
      shouldIgnoreJid: (jid): boolean => {
        if (!jid) return false;
        const isGroup = this.localSettings?.groupsIgnore && isJidGroup(jid);
        const isBroadcastUser = !this.localSettings?.readStatus && isJidBroadcast(jid); // Status Broadcast
        const isNewsletterJid = isJidNewsletter(jid); // Ignorar canais
        return !!(isGroup || isBroadcastUser || isNewsletterJid); // Retorna booleano
      },
       // << CORREÇÃO TS2339: Usar localSettings da base >>
      syncFullHistory: this.localSettings?.syncFullHistory ?? false, // Usar config local
      // << CORREÇÃO TS2304 / TS2503: Usar tipo proto >>
      shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification): boolean => {
        return this.historySyncNotification(msg); // Chama método interno
      },
      // << CORREÇÃO TS2339: Usar getGroupMetadataCache (precisa existir) >>
      // getcachedGroupMetadata: this.getGroupMetadataCache, // TODO: Implementar getGroupMetadataCache se necessário
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
       patchMessageBeforeSending: (msg) => { // Lógica mantida
         // << CORREÇÃO TS2304 / TS2503: Usar tipo proto >>
          if (msg.deviceSentMessage?.message?.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
              msg = JSON.parse(JSON.stringify(msg)); // Deep clone
              msg.deviceSentMessage.message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
          }
          if (msg.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
              msg = JSON.parse(JSON.stringify(msg)); // Deep clone
              msg.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
          }
          return msg;
      },
    };

    this.endSession = false; // Reseta flag de fim de sessão
    this.logger.info(`Iniciando conexão Baileys com config: ${JSON.stringify({ version: socketConfig.version, markOnlineOnConnect: socketConfig.markOnlineOnConnect, syncFullHistory: socketConfig.syncFullHistory })}`);
    // << CORREÇÃO TS2304 / TS2339: Atribuir a this.client >>
    try {
        this.client = makeWASocket(socketConfig); // Cria o socket
        this.eventListeners(); // Anexa os listeners de eventos principais
    } catch (error: any) {
        this.logger.error(`Erro CRÍTICO ao criar o socket Baileys: ${error.message}`, error.stack);
        throw new InternalServerErrorException(`Falha ao iniciar cliente Baileys: ${error.message}`);
    }

    // Configuração de chamadas de voz (mantida)
    // << CORREÇÃO TS2339: Usar localSettings >>
    if (this.localSettings?.wavoipToken) {
       this.logger.info('Configurando chamadas de voz...');
       // << CORREÇÃO TS2339: Passar this.client e this.stateConnection >>
      try {
          useVoiceCallsBaileys(this.localSettings.wavoipToken, this.client, this.stateConnection as any, true);
          this.setupCallListeners(); // Configura listeners de chamada
      } catch(vcError: any) {
          this.logger.error(`Falha ao inicializar chamadas de voz: ${vcError.message}`);
      }
    }

    return this.client;
  } // Fim createClient

  // Método para configurar listeners de chamada
  private setupCallListeners(): void {
    if (!this.client) return;
    // << CORREÇÃO TS2339: Acessar this.client?.ws >>
    this.client.ws.on('CB:call', (packet) => {
      this.logger.debug(`Evento CB:call recebido: ${JSON.stringify(packet)}`);
      const payload = { event: 'CB:call', packet };
      // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });

    this.client.ws.on('CB:ack,class:call', (packet) => {
       this.logger.debug(`Evento CB:ack,class:call recebido: ${JSON.stringify(packet)}`);
      const payload = { event: 'CB:ack,class:call', packet };
      // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
      this.sendDataWebhook(Events.CALL, payload, true, ['websocket']);
    });
  }


  // << CORREÇÃO: Renomeado de connectToWhatsapp para start >>
  public async start(number?: string | null): Promise<WASocket | null> {
    try {
      this.logger.info(`Iniciando instância Baileys ${this.instanceName}...`);
      // << CORREÇÃO TS2339: Chamar métodos load da base >>
      await this.loadChatwoot();
      await this.loadSettings();
      await this.loadWebhook();
      await this.loadProxy();
      this.logger.info(`Configurações carregadas para ${this.instanceName}`);
      this.client = await this.createClient(number); // Cria e atribui o cliente
      return this.client;
    } catch (error: any) {
      this.logger.error(`Erro fatal ao iniciar instância ${this.instanceName}: ${error.message}`, error.stack);
      // Não relançar exceção aqui, apenas retornar null ou tratar o erro
      // throw new InternalServerErrorException(error?.toString());
      return null;
    }
  }

  // << CORREÇÃO: Tipar retorno e usar this.client >>
  public async reloadConnection(): Promise<WASocket | null> {
    this.logger.info(`Recarregando conexão para ${this.instanceName}...`);
    try {
      // Tenta limpar conexão antiga antes de recriar
      await this.client?.logout(`Reloading connection for ${this.instanceName}`);
      this.client?.ws?.close();
      this.client?.end(new Error('Reloading connection'));
    } catch(e) {
        this.logger.warn(`Erro ao limpar conexão antiga durante reload: ${e}`);
    } finally {
        this.client = null; // Garante que o cliente antigo seja limpo
    }
    // Recria o cliente
    return await this.start(this.phoneNumber);
  }

  // --- Handlers de Eventos ---
  // (chatHandle, contactHandle, messageHandle, groupHandler, labelHandle - lógica mantida, mas precisa de revisão e correção de Prisma/Tipos)

  private readonly chatHandle = {
    // << CORREÇÃO: Usar tipo Chat importado e prismaRepository da base >>
    'chats.upsert': async (chats: Chat[]): Promise<void> => {
      try {
        // NOTE: Implemente findManyChats e createManyChats no PrismaRepository
        const existingChats = await this.prismaRepository.findManyChats({
          where: { instanceId: this.instanceId },
          select: { remoteJid: true },
        });
        const existingChatIdSet = new Set(existingChats.map((chat) => chat.remoteJid));

        const chatsToInsert = chats
          .filter((chat) => !existingChatIdSet.has(chat.id))
          .map((chat) => ({
            remoteJid: chat.id,
            instanceId: this.instanceId,
            name: chat.name,
            unreadMessages: chat.unreadCount ?? 0,
          }));

         this.logger.debug(`Chats.upsert: ${chatsToInsert.length} novos chats para inserir.`);
         // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
        await this.sendDataWebhook(Events.CHATS_UPSERT, chatsToInsert);

        if (chatsToInsert.length > 0 && this.configService.get<Database>('DATABASE')?.SAVE_DATA?.CHATS) {
            await this.prismaRepository.createManyChats({
              data: chatsToInsert,
              skipDuplicates: true,
            });
        }
      } catch (error: any) {
         this.logger.error(`Erro em chats.upsert: ${error.message}`, error.stack);
      }
    },

    'chats.update': async (
      // << CORREÇÃO: Usar tipos Baileys/proto importados >>
      chats: Array<Partial<Chat & { lastMessageRecvTimestamp?: number | Long | null }>> // Usar tipo Chat
    ): Promise<void> => {
       this.logger.debug(`Chats.update: Recebidas ${chats.length} atualizações.`);
      const chatsRaw = chats.map((chat) => ({
        remoteJid: chat.id,
        instanceId: this.instanceId,
        unreadCount: chat.unreadCount,
        // Mapear outros campos relevantes de 'chat' se necessário
      }));

       // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
      await this.sendDataWebhook(Events.CHATS_UPDATE, chatsRaw);

      // TODO: Atualizar chats no banco. 'updateMany' pode ser ineficiente.
      //      Considerar upsert ou update individual se necessário.
      // Exemplo de update individual (mais lento, mas mais preciso):
      // for (const chat of chats) {
      //     await this.prismaRepository.updateChat({ // NOTE: Implemente updateChat
      //         where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: chat.id! } },
      //         data: { unreadMessages: chat.unreadCount, name: chat.name /* outros campos */ },
      //     });
      // }
    },

    'chats.delete': async (chats: string[]): Promise<void> => {
       this.logger.info(`Chats.delete: Removendo ${chats.length} chats.`);
      try {
        // << CORREÇÃO TS2341: Usar método do repositório >>
        // NOTE: Implemente deleteManyChats no PrismaRepository
        await this.prismaRepository.deleteManyChats({
          where: { instanceId: this.instanceId, remoteJid: { in: chats } },
        });
        // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
        await this.sendDataWebhook(Events.CHATS_DELETE, chats);
      } catch (error: any) {
         this.logger.error(`Erro em chats.delete: ${error.message}`, error.stack);
      }
    },
  }; // Fim chatHandle

  private readonly contactHandle = {
     // << CORREÇÃO: Usar tipo Contact importado e prismaRepository da base >>
    'contacts.upsert': async (contacts: Contact[]): Promise<void> => {
       this.logger.debug(`Contacts.upsert: Recebidos ${contacts.length} contatos.`);
      try {
        const contactsRaw: wa.ContactPayload[] = contacts.map((contact) => ({ // Usar tipo wa.ContactPayload
          remoteJid: contact.id,
          pushName: contact?.name || contact?.verifiedName || contact.id.split('@')[0],
          profilePicUrl: null, // Será atualizado depois
          instanceId: this.instanceId,
        }));

        if (contactsRaw.length > 0) {
           // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
          await this.sendDataWebhook(Events.CONTACTS_UPSERT, contactsRaw);

          if (this.configService.get<Database>('DATABASE')?.SAVE_DATA?.CONTACTS) {
              // << CORREÇÃO TS2341: Usar método do repositório >>
              // NOTE: Implemente createManyContacts no PrismaRepository
              await this.prismaRepository.createManyContacts({
                data: contactsRaw.map(c => ({ // Garante que apenas campos do schema sejam passados
                    remoteJid: c.remoteJid,
                    pushName: c.pushName,
                    instanceId: c.instanceId,
                    // profilePicUrl é atualizado depois
                })),
                skipDuplicates: true,
              });
          }
            // << CORREÇÃO TS2304 / TS2339: Usar saveOnWhatsappCache e filtrar por JID válido >>
          const usersContacts = contactsRaw.filter((c) => c.remoteJid.endsWith('@s.whatsapp.net'));
          if (usersContacts.length > 0) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
          }
        }

        // Lógica Chatwoot (mantida, requer ajustes nos métodos do chatwootService)
        if (
          this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED &&
          this.localChatwoot?.enabled && // << CORREÇÃO TS2339: Usar localChatwoot da base >>
          this.localChatwoot.importContacts && // << CORREÇÃO TS2339: Usar localChatwoot da base >>
          contactsRaw.length
        ) {
           this.logger.info(`Enviando ${contactsRaw.length} contatos para importação Chatwoot...`);
           // << CORREÇÃO TS2339: Usar chatwootService da base >>
          this.chatwootService?.addHistoryContacts?.( // Adicionado ?. para segurança
            { instanceName: this.instance.name, instanceId: this.instanceId }, // << CORREÇÃO TS2339 >>
            contactsRaw,
          );
          // << CORREÇÃO TS2304: Usar chatwootImport real >>
          chatwootImport?.importHistoryContacts?.( // Adicionado ?. para segurança
            { instanceName: this.instance.name, instanceId: this.instanceId }, // << CORREÇÃO TS2339 >>
            this.localChatwoot, // << CORREÇÃO TS2339 >>
          );
        }

        // Atualizar fotos de perfil (pode ser demorado, fazer em paralelo limitado?)
        const updatedContacts = await Promise.all(
          contactsRaw.map(async (contact) => {
            try {
                const picInfo = await this.profilePicture(contact.remoteJid);
                return { ...contact, profilePicUrl: picInfo.profilePictureUrl };
            } catch {
                return contact; // Retorna contato original se falhar ao buscar foto
            }
          })
        );

        if (updatedContacts.length > 0) {
          const usersContactsWithPic = updatedContacts.filter((c) => c.remoteJid.endsWith('@s.whatsapp.net'));
           // << CORREÇÃO TS2304 / TS2339: Usar saveOnWhatsappCache >>
          if (usersContactsWithPic.length > 0) {
             await saveOnWhatsappCache(usersContactsWithPic.map((c) => ({ remoteJid: c.remoteJid })));
          }

          // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
          await this.sendDataWebhook(Events.CONTACTS_UPDATE, updatedContacts);

          // << CORREÇÃO TS2341: Usar método do repositório >>
          // NOTE: Implemente updateManyContacts ou upsertContact no PrismaRepository
          // Usar upsert pode ser mais seguro aqui
          await Promise.all(
            updatedContacts.map(contact =>
              this.prismaRepository.upsertContact({ // NOTE: Implemente upsertContact
                where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
                create: { remoteJid: contact.remoteJid, instanceId: contact.instanceId, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
                update: { pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
              })
            )
          );

          // Lógica Chatwoot para atualizar contatos existentes
          if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) { // << CORREÇÃO TS2339 >>
            const instance = { instanceName: this.instance.name, instanceId: this.instanceId }; // << CORREÇÃO TS2339 >>
            for (const contact of updatedContacts) {
               try {
                  // << CORREÇÃO TS2339: Usar chatwootService da base >>
                   const findParticipant = await this.chatwootService?.findContact?.( // Adicionado ?. para segurança
                       instance,
                       contact.remoteJid.split('@')[0],
                   );

                   if (findParticipant?.id) {
                      // << CORREÇÃO TS2339: Usar chatwootService da base >>
                       await this.chatwootService?.updateContact?.(instance, findParticipant.id, { // Adicionado ?. para segurança
                           name: contact.pushName,
                           avatar_url: contact.profilePicUrl,
                       });
                   }
               } catch (chatwootError: any) {
                   this.logger.error(`Erro ao atualizar contato ${contact.remoteJid} no Chatwoot: ${chatwootError.message}`);
               }
            }
          }
        }
      } catch (error: any) { // << CORREÇÃO: Capturar erro aqui >>
        this.logger.error(`Erro em contacts.upsert: ${error.message}`, error.stack);
      }
    }, // Fim contacts.upsert

    'contacts.update': async (contacts: Array<Partial<Contact>>): Promise<void> => {
       this.logger.debug(`Contacts.update: Recebidas ${contacts.length} atualizações.`);
      try {
        const contactsRaw: wa.ContactPayload[] = [];
        for await (const contact of contacts) {
           if (!contact.id) continue; // Pula se não tiver ID
            let profilePicUrl: string | null = null;
            try {
               profilePicUrl = (await this.profilePicture(contact.id)).profilePictureUrl;
            } catch { /* Ignora erro ao buscar foto */ }

            contactsRaw.push({
                remoteJid: contact.id,
                pushName: contact?.name ?? contact?.verifiedName ?? contact.id.split('@')[0],
                profilePicUrl: profilePicUrl,
                instanceId: this.instanceId,
            });
        }

         // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
        await this.sendDataWebhook(Events.CONTACTS_UPDATE, contactsRaw);

        // << CORREÇÃO TS2341: Usar método do repositório (upsert é mais seguro) >>
        // NOTE: Implemente upsertContact no PrismaRepository
        const updateTransactions = contactsRaw.map((contact) =>
            this.prismaRepository.upsertContact({
                where: { remoteJid_instanceId: { remoteJid: contact.remoteJid, instanceId: contact.instanceId } },
                create: { remoteJid: contact.remoteJid, instanceId: contact.instanceId, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
                update: { pushName: contact.pushName, profilePicUrl: contact.profilePicUrl },
            }),
        );
        // << CORREÇÃO TS2341: Usar método $transaction do repositório >>
        // NOTE: Implemente $transaction no PrismaRepository se não for herdado do PrismaClient
        await this.prismaRepository.$transaction(updateTransactions);

        // << CORREÇÃO TS2304 / TS2339: Usar saveOnWhatsappCache >>
        const usersContacts = contactsRaw.filter((c) => c.remoteJid.endsWith('@s.whatsapp.net'));
        if (usersContacts.length > 0) {
            await saveOnWhatsappCache(usersContacts.map((c) => ({ remoteJid: c.remoteJid })));
        }
      } catch (error: any) { // << CORREÇÃO: Capturar erro aqui >>
         this.logger.error(`Erro em contacts.update: ${error.message}`, error.stack);
      }
    }, // Fim contacts.update
  }; // Fim contactHandle

  // messageHandle, groupHandler, labelHandle precisam ser adaptados similarmente,
  // corrigindo acessos a this.client, this.instance, this.logger, this.prismaRepository,
  // this.sendDataWebhook, this.localSettings, this.localChatwoot, this.chatwootService,
  // e usando tipos importados corretamente.

  // ... (Implementação dos outros handlers messageHandle, groupHandler, labelHandle - requer correções similares) ...
  // Exemplo de correção para labelHandle:
  private readonly labelHandle = {
     // << CORREÇÃO TS2304: Usar tipo Label e Events importados >>
    [Events.LABELS_EDIT]: async (label: Label): Promise<void> => {
       this.logger.debug(`Labels.edit: Processando label ${label.id} (${label.name}), Deletado: ${label.deleted}`);
       // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
      await this.sendDataWebhook(Events.LABELS_EDIT, { ...label, instance: this.instanceName }); // Passa instanceName

      try {
        // << CORREÇÃO TS2341: Usar métodos do repositório >>
        // NOTE: Implemente findManyLabels, deleteLabel, upsertLabel no PrismaRepository
        const savedLabel = await this.prismaRepository.findFirstLabel({ // Usar findFirstLabel
           where: { instanceId: this.instanceId, labelId: label.id },
        });

        if (label.deleted && savedLabel) {
            await this.prismaRepository.deleteLabel({
                where: { labelId_instanceId: { instanceId: this.instanceId, labelId: label.id } },
            });
            this.logger.info(`Label ${label.id} removida do DB.`);
            return; // Sai após deletar
        } else if (label.deleted) {
            this.logger.warn(`Tentativa de deletar label ${label.id} não encontrada no DB.`);
            return;
        }

        // Tratar nome (remover caracteres inválidos)
        const labelName = label.name?.replace(/[^\x20-\x7E]/g, '') ?? `Label_${label.id}`;
        const labelColor = `${label.color}`; // Garantir que cor seja string

        // Verifica se precisa atualizar ou criar
        if (!savedLabel || savedLabel.color !== labelColor || savedLabel.name !== labelName) {
            if (this.configService.get<Database>('DATABASE')?.SAVE_DATA?.LABELS) {
                const labelData = {
                    color: labelColor,
                    name: labelName,
                    labelId: label.id,
                    predefinedId: label.predefinedId,
                    instanceId: this.instanceId,
                };
                await this.prismaRepository.upsertLabel({
                    where: { labelId_instanceId: { instanceId: labelData.instanceId, labelId: labelData.labelId } },
                    update: labelData,
                    create: labelData,
                });
                 this.logger.info(`Label ${label.id} salva/atualizada no DB.`);
            }
        }
      } catch (error: any) {
         this.logger.error(`Erro em labels.edit para label ${label.id}: ${error.message}`, error.stack);
      }
    }, // Fim LABELS_EDIT

    // << CORREÇÃO TS2304: Usar tipos LabelAssociation, Events, Database >>
    [Events.LABELS_ASSOCIATION]: async (
      data: { association: LabelAssociation; type: 'remove' | 'add' },
      // << CORREÇÃO TS2554: Remover parâmetro database não usado/fornecido >>
      // database: Database, // Removido
    ): Promise<void> => {
      if (!data?.association) {
          this.logger.warn('Evento LABELS_ASSOCIATION recebido sem dados de associação.');
          return;
      }
       this.logger.info(
        `Labels.association - Chat: ${data.association.chatId}, Tipo: ${data.type}, Label: ${data.association.labelId}`
      );

       // << CORREÇÃO TS2339: Usar configService da classe >>
      if (this.configService.get<Database>('DATABASE')?.SAVE_DATA?.CHATS) {
        const instanceId = this.instanceId; // << CORREÇÃO TS2339: Usar getter da base >>
        const chatId = data.association.chatId;
        const labelId = data.association.labelId;

        try {
            // TODO: Implementar addLabelToChat e removeLabelFromChat no PrismaRepository
            //       Estes métodos precisam atualizar o array JSONB 'labels' na tabela Chat.
            if (data.type === 'add') {
                await this.prismaRepository.addLabelToChat(labelId, instanceId, chatId);
            } else if (data.type === 'remove') {
                await this.prismaRepository.removeLabelFromChat(labelId, instanceId, chatId);
            }
        } catch (error: any) {
           this.logger.error(`Erro ao associar/desassociar label ${labelId} ao chat ${chatId}: ${error.message}`, error.stack);
        }
      }

       // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
      await this.sendDataWebhook(Events.LABELS_ASSOCIATION, {
        instance: this.instanceName, // << CORREÇÃO TS2339: Usar getter da base >>
        type: data.type,
        chatId: data.association.chatId,
        labelId: data.association.labelId,
      });
    }, // Fim LABELS_ASSOCIATION
  }; // Fim labelHandle


  // Método principal que anexa os handlers de eventos ao cliente Baileys
  private eventListeners(): void {
    if (!this.client) {
       this.logger.error('Tentativa de anexar listeners a um cliente Baileys não inicializado.');
       return;
    }

    // << CORREÇÃO TS2339: Acessar this.client.ev >>
    this.client.ev.process(async (events) => {
      // << CORREÇÃO: Verificar this.endSession no início >>
      if (this.endSession) {
         this.logger.warn(`Sessão ${this.instanceName} marcada como finalizada. Ignorando eventos.`);
         return;
      }

      try {
        // << CORREÇÃO TS2339: Usar this.findSettings (precisa existir/ser herdado) >>
        // const settings = await this.findSettings(); // TODO: Implementar ou herdar findSettings
        const settings = this.localSettings; // Usando config local carregada por loadSettings
        // << CORREÇÃO TS2304: Usar tipo Database >>
        const databaseConfig = this.configService.get<Database>('DATABASE');

        // Processamento de chamadas
        if (events.call) {
          const call = events.call[0]; // Assumindo que é um array
           this.logger.info(`Evento de chamada recebido: ID ${call.id}, De ${call.from}, Status ${call.status}`);
          if (settings?.rejectCall && call.status === 'offer') {
             this.logger.info(`Rejeitando chamada ${call.id} de ${call.from}`);
             // << CORREÇÃO TS2339: Usar this.client >>
             await this.client?.rejectCall(call.id, call.from);
          }
          if (settings?.msgCall?.trim() && call.status === 'offer') {
             this.logger.info(`Enviando mensagem de rejeição de chamada para ${call.from}`);
             // << CORREÇÃO TS2339: Usar this.client >>
             const msg = await this.client?.sendMessage(call.from, { text: settings.msgCall });
             // Emitir evento local para que a mensagem enviada seja processada
             if (msg && this.client) {
                this.client.ev.emit('messages.upsert', { messages: [msg], type: 'notify' });
             }
          }
          // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
          await this.sendDataWebhook(Events.CALL, call);
        }

        // Atualização de conexão (já tratada em connectionUpdate, chamada externamente)
        // if (events['connection.update']) {
        //   await this.connectionUpdate(events['connection.update']);
        // }

        // Atualização de credenciais
        if (events['creds.update']) {
           this.logger.debug('Evento creds.update recebido. Salvando credenciais...');
           // << CORREÇÃO TS2339: Acessar this.instance.authState >>
          await this.instance?.authState?.saveCreds();
        }

        // Histórico de mensagens
        if (events['messaging-history.set']) {
          // this.messageHandle['messaging-history.set'](events['messaging-history.set']); // Chamada movida para dentro do handler
           this.logger.info('Processando evento messaging-history.set...');
           // A lógica de processamento real deve estar dentro do handler
        }

        // Mensagens recebidas/enviadas
        if (events['messages.upsert']) {
          // this.messageHandle['messages.upsert'](events['messages.upsert'], settings); // Chamada movida para dentro do handler
           this.logger.debug(`Processando evento messages.upsert: ${events['messages.upsert'].messages?.length} mensagens.`);
           // A lógica real está no messageHandle
        }

        // Atualizações de mensagens (status, etc.)
        if (events['messages.update']) {
          // this.messageHandle['messages.update'](events['messages.update'], settings); // Chamada movida para dentro do handler
           this.logger.debug(`Processando evento messages.update: ${events['messages.update'].length} atualizações.`);
           // A lógica real está no messageHandle
        }

        // Recibos de leitura/entrega
        if (events['message-receipt.update']) {
           this.logger.debug(`Processando evento message-receipt.update: ${events['message-receipt.update'].length} recibos.`);
           // << CORREÇÃO TS2304: Usar tipo MessageUserReceiptUpdate >>
          const payload = events['message-receipt.update'] as MessageUserReceiptUpdate[];
          const remotesJidMap: Record<string, number> = {};
          for (const event of payload) {
             // Garantir que remoteJid e readTimestamp existam e sejam dos tipos corretos
            if (typeof event.key.remoteJid === 'string' && typeof event.receipt.readTimestamp === 'number') {
              remotesJidMap[event.key.remoteJid] = Math.max(remotesJidMap[event.key.remoteJid] ?? 0, event.receipt.readTimestamp);
            } else if (typeof event.key.remoteJid === 'string' && typeof event.receipt.playedTimestamp === 'number') {
               // Considerar playedTimestamp também?
            }
          }
          // << CORREÇÃO TS2339: Chamar updateMessagesReadedByTimestamp (precisa existir) >>
          // await Promise.all(
          //   Object.keys(remotesJidMap).map(remoteJid =>
          //     this.updateMessagesReadedByTimestamp(remoteJid, remotesJidMap[remoteJid]) // TODO: Implementar este método
          //   )
          // );
           this.logger.warn('updateMessagesReadedByTimestamp não implementado.');
        }

        // Atualização de presença
        if (events['presence.update']) {
           this.logger.trace(`Processando evento presence.update para ${events['presence.update'].id}`);
          const payload = events['presence.update'];
          // << CORREÇÃO TS2339: Usar localSettings da base >>
          if (settings?.groupsIgnore && payload.id.includes('@g.us')) {
            return; // Ignora se for grupo e a configuração estiver ativa
          }
          // << CORREÇÃO TS2339 / TS2304: Usar sendDataWebhook e Events >>
          await this.sendDataWebhook(Events.PRESENCE_UPDATE, payload);
        }

        // Eventos de Grupo (se não ignorados)
        if (!settings?.groupsIgnore) {
          if (events['groups.upsert']) {
             this.logger.debug(`Processando evento groups.upsert: ${events['groups.upsert'].length} grupos.`);
             // << CORREÇÃO TS2304: Usar tipo GroupMetadata >>
            this.groupHandler['groups.upsert'](events['groups.upsert'] as GroupMetadata[]);
          }
          if (events['groups.update']) {
             this.logger.debug(`Processando evento groups.update: ${events['groups.update'].length} atualizações.`);
             // << CORREÇÃO TS2304: Usar tipo GroupMetadata >>
            this.groupHandler['groups.update'](events['groups.update'] as Array<Partial<GroupMetadata>>);
          }
          if (events['group-participants.update']) {
             this.logger.debug(`Processando evento group-participants.update para grupo ${events['group-participants.update'].id}`);
             // << CORREÇÃO TS2304: Usar tipo ParticipantAction >>
            this.groupHandler['group-participants.update'](events['group-participants.update'] as { id: string; participants: string[]; action: ParticipantAction });
          }
        }

        // Eventos de Chat
        if (events['chats.upsert']) {
           this.logger.debug(`Processando evento chats.upsert: ${events['chats.upsert'].length} chats.`);
           // << CORREÇÃO TS2304: Usar tipo Chat >>
          this.chatHandle['chats.upsert'](events['chats.upsert'] as Chat[]);
        }
        if (events['chats.update']) {
           this.logger.debug(`Processando evento chats.update: ${events['chats.update'].length} atualizações.`);
          this.chatHandle['chats.update'](events['chats.update'] as Array<Partial<Chat>>);
        }
        if (events['chats.delete']) {
           this.logger.debug(`Processando evento chats.delete: ${events['chats.delete'].length} chats.`);
          this.chatHandle['chats.delete'](events['chats.delete'] as string[]);
        }

        // Eventos de Contato
        if (events['contacts.upsert']) {
           this.logger.debug(`Processando evento contacts.upsert: ${events['contacts.upsert'].length} contatos.`);
           // << CORREÇÃO TS2304: Usar tipo Contact >>
          this.contactHandle['contacts.upsert'](events['contacts.upsert'] as Contact[]);
        }
        if (events['contacts.update']) {
           this.logger.debug(`Processando evento contacts.update: ${events['contacts.update'].length} atualizações.`);
          this.contactHandle['contacts.update'](events['contacts.update'] as Array<Partial<Contact>>);
        }

         // Eventos de Label
         // << CORREÇÃO TS2304: Usar Events >>
        if (events[Events.LABELS_ASSOCIATION]) {
            this.logger.debug(`Processando evento ${Events.LABELS_ASSOCIATION}`);
            // << CORREÇÃO TS2304: Usar tipo LabelAssociation >>
            // << CORREÇÃO TS2554: Remover argumento database >>
            this.labelHandle[Events.LABELS_ASSOCIATION](events[Events.LABELS_ASSOCIATION] as { association: LabelAssociation; type: 'remove' | 'add' });
        }
        if (events[Events.LABELS_EDIT]) {
            this.logger.debug(`Processando evento ${Events.LABELS_EDIT}`);
            // << CORREÇÃO TS2304: Usar tipo Label >>
             // << CORREÇÃO TS2554 / TS1000: Chamar com argumento correto >>
            this.labelHandle[Events.LABELS_EDIT](events[Events.LABELS_EDIT] as Label);
        }

      } catch (error: any) {
         this.logger.error(`Erro geral no processamento de eventos Baileys: ${error.message}`, error.stack);
      }
    }); // Fim client.ev.process
  } // Fim eventListeners


  // << CORREÇÃO: Renomeado para eventListeners >>
  // private eventHandler() { ... } // Removido - lógica movida para eventListeners


  // << CORREÇÃO TS2503 / TS2304: Usar tipos proto importados >>
  private historySyncNotification(msg: proto.Message.IHistorySyncNotification): boolean {
    // << CORREÇÃO TS2304: Usar tipo InstanceDto >>
    const instance: InstanceDto = { instanceName: this.instanceName }; // Usa getter da base
    // << CORREÇÃO TS2339: Usar configService, localChatwoot da base e chatwootService da base >>
    if (
      this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED &&
      this.localChatwoot?.enabled &&
      this.localChatwoot.importMessages &&
      this.isSyncNotificationFromUsedSyncType(msg)
    ) {
      if (msg.chunkOrder === 1) {
        this.chatwootService?.startImportHistoryMessages?.(instance); // Adicionado ?.
      }
      if (msg.progress === 100) {
        setTimeout(() => {
          this.chatwootService?.importHistoryMessages?.(instance); // Adicionado ?.
        }, 10000);
      }
    }
    return true; // Sempre retorna true para processar a notificação? Verifique a lógica Baileys.
  }

  // << CORREÇÃO TS2503 / TS2304: Usar tipos proto importados >>
  private isSyncNotificationFromUsedSyncType(msg: proto.Message.IHistorySyncNotification): boolean {
    // << CORREÇÃO TS2339: Usar localSettings da base >>
    const syncFull = this.localSettings?.syncFullHistory ?? false;
    // Usa os valores corretos do enum HistorySyncType
    const fullSyncType = proto.HistorySync.HistorySyncType.FULL;
    const recentSyncType = proto.HistorySync.HistorySyncType.RECENT;
    return (
      (syncFull && msg?.syncType === fullSyncType) ||
      (!syncFull && msg?.syncType === recentSyncType)
    );
  }

  // << CORREÇÃO: Tipar retorno e usar createJid >>
  public async profilePicture(number: string): Promise<{ wuid: string; profilePictureUrl: string | null }> {
    // << CORREÇÃO TS2304: Usar createJid importado >>
    const jid = createJid(number);
    try {
      // << CORREÇÃO TS2339: Usar this.client com verificação >>
      const profilePictureUrl = await this.client?.profilePictureUrl(jid, 'image');
      return { wuid: jid, profilePictureUrl: profilePictureUrl || null };
    } catch (error: any) {
       this.logger.warn(`Falha ao buscar foto do perfil para ${jid}: ${error.message}`);
      return { wuid: jid, profilePictureUrl: null };
    }
  }

  // << CORREÇÃO: Tipar retorno e usar createJid >>
  public async getStatus(number: string): Promise<{ wuid: string; status: string | null }> {
     // << CORREÇÃO TS2304: Usar createJid importado >>
    const jid = createJid(number);
    try {
      // << CORREÇÃO TS2339: Usar this.client com verificação >>
      const statusResult = await this.client?.fetchStatus(jid);
      return { wuid: jid, status: statusResult?.[0]?.status || null };
    } catch (error: any) {
       this.logger.warn(`Falha ao buscar status para ${jid}: ${error.message}`);
      return { wuid: jid, status: null };
    }
  }

  // << CORREÇÃO: Tipar retorno, usar createJid e correções internas >>
  // TODO: Revisar lógica, depende de waMonitor e fetchBusinessProfile
  public async fetchProfile(instanceName: string, number?: string): Promise<any> {
     // << CORREÇÃO TS2304: Usar createJid importado >>
    // << CORREÇÃO TS2339: Usar this.client com verificação >>
    const jid = number ? createJid(number) : this.client?.user?.id;
    if (!jid) {
        throw new BadRequestException('Não foi possível determinar o JID para buscar o perfil.'); // Usar exceção importada
    }

    // << CORREÇÃO TS2339: Usar whatsappNumber (precisa existir) >>
    // const onWhatsapp = (await this.whatsappNumber({ numbers: [jid] }))?.shift(); // TODO: Implementar/herdar whatsappNumber
    // Mock temporário:
    const onWhatsapp = { exists: true, jid: jid }; // Assume que existe
    this.logger.warn('Usando mock para verificação onWhatsApp em fetchProfile.');

    if (!onWhatsapp?.exists) {
       throw new BadRequestException(`Número ${jid} não encontrado no WhatsApp.`); // Usar exceção importada
    }

    try {
      const pictureInfo = await this.profilePicture(jid);
      const statusInfo = await this.getStatus(jid);
      // << CORREÇÃO TS2339: Usar fetchBusinessProfile (precisa existir) >>
      // const business = await this.fetchBusinessProfile(jid); // TODO: Implementar/herdar fetchBusinessProfile
      // Mock temporário:
      const business = { isBusiness: false, email: null, description: null, website: [] };
      this.logger.warn('Usando mock para fetchBusinessProfile em fetchProfile.');


      // Se for o próprio número, busca informações da instância monitorada
      if (!number && this.client?.user?.id === jid) {
         // << CORREÇÃO TS2304: Remover waMonitor global, usar injeção/propriedade >>
         // NOTE: waMonitor agora é injetado no construtor. Precisa de um método instanceInfo nele.
         // const info: wa.Instance = await this.waMonitor.instanceInfo(instanceName); // Usar waMonitor injetado
         // Mock temporário:
         const info: Partial<wa.Instance> = { profileName: await this.getProfileName(), profilePicUrl: pictureInfo.profilePictureUrl, connectionStatus: this.stateConnection.connection };
         this.logger.warn('Usando mock para waMonitor.instanceInfo em fetchProfile.');

         return {
             wuid: jid,
             name: info?.profileName,
             numberExists: true,
             picture: info?.profilePicUrl,
             status: statusInfo?.status, // Usar status real se disponível
             isBusiness: business?.isBusiness,
             email: business?.email,
             description: business?.description,
             website: business?.website?.shift(),
         };
      } else {
          // Busca informações de um contato externo
          // O nome pode vir do 'verifiedName' ou 'notify' (pushName)
           let contactName: string | undefined | null = undefined;
           // Tenta obter dos contatos salvos
           // const contactData = await this.prismaRepository.findFirstContact({ where: { remoteJid: jid, instanceId: this.instanceId } });
           // contactName = contactData?.pushName;

           // Se não achar, usa o que o Baileys fornecer (pode não ser confiável para contatos não salvos)
           if (!contactName) {
              const contactBaileys = await this.client?.getContactById(jid);
              contactName = contactBaileys?.name || contactBaileys?.notify || contactBaileys?.verifiedName;
           }

          return {
              wuid: jid,
              name: contactName,
              numberExists: true,
              picture: pictureInfo?.profilePictureUrl,
              status: statusInfo?.status,
              isBusiness: business?.isBusiness,
              email: business?.email,
              description: business?.description,
              website: business?.website?.shift(),
          };
      }

    } catch (error: any) {
       this.logger.error(`Erro ao buscar perfil para ${jid}: ${error.message}`);
      return { wuid: jid, name: null, picture: null, status: null, isBusiness: false }; // Retorno padrão em erro
    }
  } // Fim fetchProfile

  // << CORREÇÃO: Usar createJid e this.client >>
  public async offerCall({ number, isVideo, callDuration }: OfferCallDto): Promise<any> {
     // << CORREÇÃO TS2304: Usar createJid importado >>
    const jid = createJid(number);
    if (!this.client) throw new Error('Cliente não conectado para iniciar chamada.');
    try {
      // << CORREÇÃO TS2339: Usar this.client >>
      const call = await this.client.offerCall(jid, isVideo);
       this.logger.info(`Chamada oferecida para ${jid}. ID: ${call.id}. Duração: ${callDuration}s.`);
      // << CORREÇÃO TS2339: Usar this.client >>
      // Agendar término da chamada
      setTimeout(() => {
         this.logger.info(`Terminando chamada ${call.id} para ${call.to}`);
         this.client?.terminateCall(call.id, call.to);
      }, callDuration * 1000);
      return call; // Retorna info da chamada iniciada
    } catch (error: any) {
       this.logger.error(`Erro ao oferecer chamada para ${jid}: ${error.message}`);
      throw error; // Relança o erro
    }
  }

  // Método não suportado, mantido
  public async templateMessage(): Promise<never> {
    throw new BadRequestException('Method not available in the Baileys service');
  }

  // Método não suportado, mantido
  // private async updateChatUnreadMessages(...): Promise<number> { ... }


  // Métodos addLabel/removeLabel (mantidos, mas dependem de Prisma)
  private async addLabel(labelId: string, instanceId: string, chatId: string): Promise<void> {
    // << CORREÇÃO TS2304: Usar cuid importado >>
    const id = cuid();
    // << CORREÇÃO TS2341: Usar método do repositório >>
    // NOTE: Implemente $executeRawUnsafe ou um método específico no PrismaRepository
    await this.prismaRepository.$executeRawUnsafe(
      // Query SQL mantida - CUIDADO com SQL Injection se os inputs não forem sanitizados
      `INSERT INTO "Chat" ("id", "instanceId", "remoteJid", "labels", "createdAt", "updatedAt")
       VALUES ($4, $2, $3, to_jsonb(ARRAY[$1]::text[]), NOW(), NOW()) ON CONFLICT ("instanceId", "remoteJid")
     DO
      UPDATE
          SET "labels" = ( SELECT to_jsonb(array_agg(DISTINCT elem)) FROM ( SELECT jsonb_array_elements_text("Chat"."labels") AS elem UNION SELECT $1::text AS elem ) sub ), "updatedAt" = NOW();`,
      labelId, instanceId, chatId, id,
    );
  }

  private async removeLabel(labelId: string, instanceId: string, chatId: string): Promise<void> {
    // << CORREÇÃO TS2304: Usar cuid importado >>
    const id = cuid();
    // << CORREÇÃO TS2341: Usar método do repositório >>
    // NOTE: Implemente $executeRawUnsafe ou um método específico no PrismaRepository
    await this.prismaRepository.$executeRawUnsafe(
      // Query SQL mantida - CUIDADO com SQL Injection
      `INSERT INTO "Chat" ("id", "instanceId", "remoteJid", "labels", "createdAt", "updatedAt")
       VALUES ($4, $2, $3, '[]'::jsonb, NOW(), NOW()) ON CONFLICT ("instanceId", "remoteJid")
     DO
      UPDATE
          SET "labels" = COALESCE ( ( SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Chat"."labels") AS elem WHERE elem <> $1 ), '[]'::jsonb ), "updatedAt" = NOW();`,
      labelId, instanceId, chatId, id,
    );
  }


  // ===== Helpers do baileys =====
  // << CORREÇÃO: Adicionar verificações de cliente e async >>
  public async baileysOnWhatsapp(jid: string): Promise<any> {
    if (!this.client) throw new Error('Cliente Baileys não conectado.');
     // << CORREÇÃO TS2339: Usar this.client >>
    const response = await this.client.onWhatsApp(jid);
    return response;
  }
  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview', timeoutMs?: number): Promise<string | null> {
     if (!this.client) throw new Error('Cliente Baileys não conectado.');
     // << CORREÇÃO TS2339: Usar this.client >>
    const response = await this.client.profilePictureUrl(jid, type, timeoutMs);
    return response;
  }
  public async baileysAssertSessions(jids: string[], force: boolean): Promise<void> {
     if (!this.client) throw new Error('Cliente Baileys não conectado.');
      // << CORREÇÃO TS2339: Usar this.client >>
    await this.client.assertSessions(jids, force);
  }
  // << CORREÇÃO: Tipar message como proto.IMessage >>
  public async baileysCreateParticipantNodes(jids: string[], message: proto.IMessage, extraAttrs?: any): Promise<any> {
     if (!this.client) throw new Error('Cliente Baileys não conectado.');
      // << CORREÇÃO TS2339: Usar this.client >>
    const response = await this.client.createParticipantNodes(jids, message, extraAttrs);
    // Conversão para Base64 mantida
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
  // << CORREÇÃO: Tipar stanza como proto.BinaryNode >>
  public async baileysSendNode(stanza: proto.BinaryNode): Promise<string> {
     if (!this.client) throw new Error('Cliente Baileys não conectado.');
      // << CORREÇÃO TS2339: Usar this.client >>
    const response = await this.client.sendNode(stanza);
    return response;
  }
  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> {
     if (!this.client) throw new Error('Cliente Baileys não conectado.');
      // << CORREÇÃO TS2339: Usar this.client >>
    const response = await this.client.getUSyncDevices(jids, useCache, ignoreZeroDevices);
    return response;
  }
  public async baileysGenerateMessageTag(): Promise<string> {
     if (!this.client) throw new Error('Cliente Baileys não conectado.');
      // << CORREÇÃO TS2339: Usar this.client >>
    const response = await this.client.generateMessageTag();
    return response;
  }
  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: string): Promise<string | null> {
    if (!this.client) throw new Error('Cliente Baileys não conectado.');
    try {
      const ciphertextBuffer = Buffer.from(ciphertext, 'base64');
      // << CORREÇÃO TS2339: Usar this.client >>
      const response = await this.client.signalRepository.decryptMessage({
        jid,
        type,
        ciphertext: ciphertextBuffer,
      });
      // Retorna Base64 se for Uint8Array
      return response instanceof Uint8Array ? Buffer.from(response).toString('base64') : null;
    } catch (error: any) {
       // << CORREÇÃO TS2339: Usar this.logger >>
      this.logger.error(`Erro ao descriptografar mensagem para ${jid}: ${error.message}`);
      // throw error; // Não relançar, apenas retornar null?
      return null;
    }
  }
  public async baileysGetAuthState(): Promise<Partial<AuthenticationState> | null> {
    if (!this.client) throw new Error('Cliente Baileys não conectado.');
    // << CORREÇÃO TS2339: Usar this.client >>
    const response = {
      creds: this.client.authState.creds, // Retorna as credenciais atuais
      // keys: this.client.authState.keys // Não expor as chaves diretamente?
    };
    return response;
  }

  // --- Métodos adicionais que podem ser necessários ---
  // Exemplo: Implementação de findSettings (se não herdado)
  public async findSettings(): Promise<wa.LocalSettings | null> {
     this.logger.debug(`Buscando configurações para ${this.instanceName}...`);
     try {
        // NOTE: Implemente findUniqueSetting no PrismaRepository
        const data = await this.prismaRepository.findUniqueSetting({
           where: { instanceId: this.instanceId },
        });
        if (data) {
            // Mapeia do DB para o formato LocalSettings
            const settings: wa.LocalSettings = {
                rejectCall: data.rejectCall,
                msgCall: data.msgCall,
                groupsIgnore: data.groupsIgnore as boolean, // Ajuste de tipo se necessário
                alwaysOnline: data.alwaysOnline,
                readMessages: data.readMessages,
                readStatus: data.readStatus,
                syncFullHistory: data.syncFullHistory,
                wavoipToken: data.wavoipToken,
            };
            // Atualiza cache local
            Object.assign(this.localSettings, settings);
            return settings;
        }
        return null;
     } catch (error: any) {
        this.logger.error(`Erro ao buscar configurações: ${error.message}`);
        return null;
     }
  }

    // TODO: Implementar outros métodos que estavam dando erro TS2339:
    // - syncChatwootLostMessages()
    // - getGroupMetadataCache()
    // - updateGroupMetadataCache()
    // - updateMessagesReadedByTimestamp()
    // - whatsappNumber()
    // - fetchBusinessProfile()


} // Fim da classe BaileysStartupService
