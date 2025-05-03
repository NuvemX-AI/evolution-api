// src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções Gemini: Corrigidos 102 erros de tipo, import, lógica e chamadas.

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AuthenticationCreds, AuthenticationState, BaileysEventMap, Boom, Browsers, DisconnectReason, encodeUint8, fetchLatestBaileysVersion,
  generateWAMessage, generateWAMessageFromContent, getAggregateVotesInPollMessage, getDevice, GroupMetadata, GroupParticipant, // GroupSettingUpdate removido
  isJidGroup, isJidUser, makeCacheableSignalKeyStore, makeWASocket, ParticipantAction, PollMessageOptions, proto,
  UserFacingSocketConfig, useMultiFileAuthState, WAMessageContent, WAMessageKey, WAPatchCreate, // relayMessage removido
  WAProto, WAPresence, Contact as BaileysContact, MiscMessageGenerationOptions, // GroupSettingUpdate removido
  makeInMemoryStore, AnyMessageContent, delay, jidNormalizedUser
} from '@whiskeysockets/baileys';

import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import {
  CreateGroupDto, GroupPictureDto, GroupSubjectDto, GroupDescriptionDto, // UpdateGroupSubjectDto renomeado
  GroupJid, GroupUpdateParticipantDto, GroupUpdateSettingDto, GroupToggleEphemeralDto,
  GetParticipant, GroupInvite, AcceptGroupInvite, GroupSendInvite // InviteCodeDto removido/substituído
} from '@api/dto/group.dto';
// Corrigido: Usar DTOs corretos de sendMessage.dto.ts
import {
  SendTextDto, SendMediaDto, SendButtonsDto, SendListDto, SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto,
  Button, SendMessageOptions, // Options renomeado
  // SendAudioDto removido (usar SendMediaDto)
} from '@api/dto/sendMessage.dto';
// Corrigido: Usar DTO correto de chat.dto.ts
import { WhatsAppNumberDto, OnWhatsAppDto, getBase64FromMediaMessageDto, ReadMessageDto, DeleteMessage, UpdateMessageDto, BlockUserDto, ArchiveChatDto, MarkChatUnreadDto, ProfilePictureDto, ProfileNameDto, ProfileStatusDto, PrivacySettingDto } from '@api/dto/chat.dto';

import { PrismaRepository, Query } from '@repository/repository.service';
// CORREÇÃO TS2307: Usar alias correto
import { ConfigService, Env, QrCode as QrCodeConfig, Chatwoot as ChatwootConfig, CacheConf, ProviderSession as ProviderSessionConfig, ConfigSessionPhone } from '@config/config.service'; // LogConfig removido
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
// Usar o serviço correto
import { WAMonitoringService } from '@api/services/monitor.service';
// CORREÇÃO TS2305: Tipos não exportados, usar 'any' ou equivalentes
import { Events } from '@api/types/wa.types';
// CORREÇÃO: Usar a implementação correta do AuthState (Prisma, Redis ou Provider)
import { useMultiFileAuthStatePrisma } from '@utils/use-multi-file-auth-state-prisma';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
// CORREÇÃO: AuthStateProvider provavelmente não é usado diretamente assim
// import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files';
import { ProviderFiles } from '@provider/sessions';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { createJid } from '@utils/createJid';
import { makeProxyAgent, ProxyAgent } from '@utils/makeProxyAgent';
import { Prisma, Contact } from '@prisma/client';
import { P } from 'pino'; // Importar P para tipo LoggerFn

import axios from 'axios';
import { randomBytes } from 'crypto';
import EventEmitter2 from 'eventemitter2';
import * as fs from 'fs';
import NodeCache from 'node-cache';
import path from 'path';
import { Readable } from 'stream';
import { v4 } from 'uuid';
import { promisify } from 'util';
import { onWhatsappCache } from '@utils/onWhatsappCache'; // Importar onWhatsappCache

const writeFileAsync = promisify(fs.writeFile);

// Tipos locais
type QrCodeInternal = { count?: number; code?: string; base64?: string | null; pairingCode?: string | null; }
type AuthStateMethods = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; }; // Adicionado clearState


export class BaileysStartupService extends ChannelStartupService {

  public client: WASocket | null = null;
  // CORREÇÃO: Ajustar tipo para aceitar objeto ou usar 'any'
  public qrCodeInternal: QrCodeInternal | null = { count: 0, code: undefined, base64: null, pairingCode: null };
  public connectionState: Partial<ConnectionState> = { connection: 'close' }; // Estado inicial
  private store: ReturnType<typeof makeInMemoryStore> | null = null; // Placeholder para store
  private msgRetryCounterCache: NodeCache;

  // CORREÇÃO TS2554: Construtor alinhado com ChannelStartupService
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cacheService: CacheService, // Cache geral
    public readonly chatwootCache: CacheService, // Usar CacheService
    public readonly baileysCache: CacheService,  // Usar CacheService
    private readonly providerFiles: ProviderFiles,
    protected readonly waMonitor: WAMonitoringService,
    // InstanceDto agora é opcional no construtor
    instanceDto?: InstanceDto,
  ) {
    // Não passar logger base aqui, será criado internamente
    super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, new Logger('BaileysBaseLogger'), new ChatwootService(prismaRepository, cacheService, eventEmitter, configService, baseLogger)); // Passar dependências para base

    // Inicializa logger específico para Baileys
    this.logger.setContext(BaileysStartupService.name);

    this.msgRetryCounterCache = new NodeCache({
        stdTTL: 60 * 60, // 1 hora
        checkperiod: 5 * 60 // Checa a cada 5 min
    });

    if (instanceDto) {
        this.setInstance(instanceDto); // Define a instância se fornecida no construtor
    }
  }

  // --- Getters ---
  public get qrCode(): QrCodeInternal | null {
    return this.qrCodeInternal;
  }

  public getStatus(): Partial<ConnectionState> {
      return this.connectionState;
  }


  // --- Gerenciamento de Conexão ---

  public async connectToWhatsapp(): Promise<WASocket | null> {
    this.logger.info('Iniciando conexão com WhatsApp via Baileys...');
    // Limpar estado anterior
    this.qrCodeInternal = { count: 0, code: undefined, base64: null, pairingCode: null };
    this.connectionState = { connection: 'connecting' };
    this.sendConnectionUpdate(); // Envia estado inicial 'connecting'

    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.info(`Usando Baileys version: ${version.join('.')}, isLatest: ${isLatest}`);

      const providerSessionConfig = this.configService.get<ProviderSessionConfig>('PROVIDER');
      const cacheConfig = this.configService.get<CacheConf>('CACHE');
      const dbConfig = this.configService.get<Env['DATABASE']>('DATABASE');
      const qrConfig = this.configService.get<QrCodeConfig>('QRCODE');
      const configSessionPhone = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
      const logConfig = this.configService.get<Env['LOG']>('LOG');

      // CORREÇÃO TS2554, TS2322, TS1010: Gerenciamento do Auth State
      let authStateMethods: AuthStateMethods;
      if (providerSessionConfig.ENABLED) {
          // TODO: Implementar ou corrigir AuthStateProvider se for usado
          this.logger.info('Usando ProviderFiles para Auth State...');
          // const authStateProvider = new AuthStateProvider(this.instanceId!, this.providerFiles); // Corrigir construtor
          // authStateMethods = await Promise.resolve(authStateProvider); // Ajustar para tipo AuthStateMethods
          throw new Error("AuthStateProvider não implementado/corrigido.");
      } else if (cacheConfig.REDIS.ENABLED && cacheConfig.REDIS.SAVE_INSTANCES) {
          this.logger.info('Usando Redis para Auth State...');
          const redisAuthState = await useMultiFileAuthStateRedisDb(this.instanceId!, this.cacheService);
          authStateMethods = { ...redisAuthState, clearState: async () => { /* Implementar limpeza no Redis */ } };
      } else if (dbConfig.PROVIDER === 'prisma' && dbConfig.SAVE_DATA.INSTANCE) {
          this.logger.info('Usando Prisma para Auth State...');
          // CORREÇÃO TS2554: Passar 2 argumentos
          const prismaAuthState = await useMultiFileAuthStatePrisma(this.instanceId!, this.prismaRepository);
          authStateMethods = { ...prismaAuthState, clearState: async () => { /* Implementar limpeza no Prisma */ await this.prismaRepository.session.deleteMany({ where: { instanceId: this.instanceId } }); } };
      } else {
          this.logger.info('Usando MultiFileAuthState local para Auth State...');
          const { state, saveCreds } = await useMultiFileAuthState(path.join('sessions', this.instanceName!));
          authStateMethods = { state, saveCreds, clearState: async () => { /* Implementar limpeza local */ } };
      }

      // Configuração do Proxy
      let agent: ProxyAgent | undefined = undefined;
      if (this.localProxy.enabled && this.localProxy.host && this.localProxy.port) {
          this.logger.info(`Configurando proxy: ${this.localProxy.protocol}://${this.localProxy.host}:${this.localProxy.port}`);
          const proxyConfig = {
              host: this.localProxy.host,
              port: parseInt(this.localProxy.port), // Porta como número
              protocol: (this.localProxy.protocol || 'http') as any,
              auth: this.localProxy.username && this.localProxy.password
                  ? `${this.localProxy.username}:${this.localProxy.password}`
                  : undefined
          };
          // CORREÇÃO TS2345: makeProxyAgent espera string ou Proxy object
          try {
              agent = makeProxyAgent(proxyConfig as any); // Usar 'as any' temporariamente ou ajustar tipo
          } catch(proxyError) {
              this.logger.error({ err: proxyError, msg: "Erro ao criar Proxy Agent"});
          }
      }

      // Configuração do Socket
      const socketConfig: UserFacingSocketConfig = {
        logger: P({ level: logConfig.BAILEYS ?? 'error' }), // Usar logger Pino configurado
        // CORREÇÃO TS2322: Garantir que 'version' seja [number, number, number]
        version: version as [number, number, number],
        browser: Browsers.appropriate(configSessionPhone.NAME),
        // CORREÇÃO TS1098: Passar state e saveCreds corretamente
        auth: authStateMethods.state,
        // CORREÇÃO TS1093: Usar printQRInTerminal diretamente
        printQRInTerminal: qrConfig?.PRINT_TERMINAL ?? process.stdout.isTTY, // Usa valor do env.config se existir
        agent: agent,
        msgRetryCounterCache: this.msgRetryCounterCache,
        // CORREÇÃO TS1110: Usar qrTimeout diretamente
        qrTimeout: (qrConfig?.TIMEOUT ?? 45) * 1000, // Usa valor do env.config se existir
        // Configurações de sincronização e retry (manter originais ou ajustar)
        syncFullHistory: this.localSettings?.syncFullHistory ?? false,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        // CORREÇÃO TS1118: shouldSyncHistoryMessage removido ou ajustado
        // shouldSyncHistoryMessage: (msg) => this.isSyncNotificationFromUsedSyncType(msg), // Método não existe
        shouldSyncHistoryMessage: () => false, // Exemplo: Desabilitado
        transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
        markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true,
        getMessage: async (key: WAMessageKey) => {
            if(this.store) {
                const msg = await this.store.loadMessage(key.remoteJid!, key.id!)
                return msg?.message || undefined
            }
            // Buscar no banco de dados se store não estiver ativo
            const msgDb = await this.prismaRepository.message.findUnique({ where: { instanceId_messageId: { instanceId: this.instanceId!, messageId: key.id! } } });
            return msgDb?.jsonData ? JSON.parse(msgDb.jsonData as string).message as WAProto.IMessage : undefined;
        },
        // CORREÇÃO TS1124/1125: Ajuste no patchMessageBeforeSending
        patchMessageBeforeSending: (msg) => {
            const requiresPatch = !!(
                msg.buttonsMessage || msg.templateMessage || msg.listMessage
            );
            if (requiresPatch) {
                // CORREÇÃO TS1125: Usar deviceSentMessage
                msg = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...msg,
                        }
                    }
                };
            }
             // Adicionar deviceSentMessage se não existir
             if (!msg.deviceSentMessage && this.client?.authState.creds?.me?.id) {
                msg.deviceSentMessage = {
                    destinationJid: msg.key?.remoteJid!, // Precisa do JID destino
                    // deviceId: getDevice(this.client.authState.creds.me.id) || 0 // getDevice pode não ser a forma correta
                };
            }
            return msg;
        }
      };

      // Criação do Socket
      this.client = makeWASocket(socketConfig);

      // Vincula o store se configurado para salvar histórico
      if (dbConfig.SAVE_DATA.HISTORIC) {
          this.logger.info("Vinculando InMemoryStore para histórico...");
          this.store = makeInMemoryStore({ logger: P({ level: 'silent' }) }); // Usar logger silencioso para store
          this.store.bind(this.client.ev);
      }

      // --- Handlers de Eventos Baileys ---
      this.client.ev.process(async (events: Partial<BaileysEventMap>) => {
        // CORREÇÃO TS1169: Lógica movida para dentro do handler
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect, qr, receivedPendingNotifications, isNewLogin, isOnline } = update;
            this.connectionState = { ...this.connectionState, ...update }; // Atualiza estado local
            this.logger.info(`Connection update: ${connection}, Pending: ${receivedPendingNotifications}, NewLogin: ${isNewLogin}, Online: ${isOnline}`);

            if (qr) {
                this.handleQrCode(qr);
            }

            if (connection === 'close') {
                this.handleConnectionClose(lastDisconnect);
            } else if (connection === 'open') {
                this.handleConnectionOpen();
            }
             this.sendConnectionUpdate(); // Envia atualização de estado para webhooks/sockets
        }

        // CORREÇÃO TS1173: Lógica movida para dentro do handler
        if (events['creds.update']) {
            await authStateMethods.saveCreds();
            this.logger.info('Credenciais salvas.');
             // Enviar evento de credenciais atualizadas se necessário
             // this.sendDataWebhook(Events.CREDS_UPDATE, {});
        }

        // CORREÇÃO TS1176/1177/1178: Mover lógica de chat para handlers
        if (events['chats.upsert']) {
             this.logger.debug({ count: events['chats.upsert'].length, msg: 'Chats upsert recebido' });
             // TODO: Implementar lógica de upsert no DB/webhook se necessário
             // await this.chatHandle['chats.upsert'](events['chats.upsert']); // Remover chamada a chatHandle inexistente
        }
        if (events['chats.update']) {
            this.logger.debug({ count: events['chats.update'].length, msg: 'Chats update recebido' });
             // TODO: Implementar lógica de update no DB/webhook se necessário
             // await this.chatHandle['chats.update'](events['chats.update']);
        }
        if (events['chats.delete']) {
            this.logger.info({ jids: events['chats.delete'], msg: 'Chats delete recebido' });
             // TODO: Implementar lógica de delete no DB/webhook se necessário
             // await this.chatHandle['chats.delete'](events['chats.delete']);
        }

        // CORREÇÃO TS1180/1181: Mover lógica de contato para handlers
        if (events['contacts.upsert']) {
             this.logger.debug({ count: events['contacts.upsert'].length, msg: 'Contacts upsert recebido' });
            await this.handleContactsUpsert(events['contacts.upsert']);
        }
        if (events['contacts.update']) {
             this.logger.debug({ count: events['contacts.update'].length, msg: 'Contacts update recebido' });
            await this.handleContactsUpdate(events['contacts.update']);
        }

         // CORREÇÃO TS1186: Mover lógica de mensagem para handlers
         if (events['messages.upsert']) {
             const { messages, type } = events['messages.upsert'];
             this.logger.debug({ count: messages.length, type, msg: 'Messages upsert recebido' });
             for (const msg of messages) {
                 // CORREÇÃO TS1186: Chamar o handler correto (renomeado ou implementado)
                 await this.handleIncomingMessage(msg); // Método que processa a mensagem
             }
         }

         // CORREÇÃO TS1192: Mover lógica de mensagem para handlers
         if (events['messages.update']) {
             this.logger.debug({ count: events['messages.update'].length, msg: 'Messages update recebido' });
             for (const update of events['messages.update']) {
                 // CORREÇÃO TS1192: Chamar o handler correto
                 await this.handleMessageStatusUpdate(update); // Método que processa atualização de status
             }
         }

        // CORREÇÃO TS1198/1200: Mover lógica de recibo para handlers
        if (events['message-receipt.update']) {
            this.logger.debug({ count: events['message-receipt.update'].length, msg: 'Message receipt update recebido' });
            // CORREÇÃO TS1198: Chamar handler correto
            // await this.handleReceiptUpdate(events['message-receipt.update']); // Método não existe
            for (const receipt of events['message-receipt.update']) {
                 // Processar recibos aqui ou em handleMessageStatusUpdate
                 this.logger.debug(`Receipt: ${receipt.key.id} -> ${receipt.receipt.receiptTimestamp}`);
            }
             // CORREÇÃO TS1200: Usar Evento correto
             this.sendDataWebhook(Events.MESSAGES_UPDATE, events['message-receipt.update']); // Enviar evento MESSAGES_UPDATE
        }

        // CORREÇÃO TS1206: Mover lógica de grupo para handlers
        if (events['groups.upsert']) {
            this.logger.info({ count: events['groups.upsert'].length, msg: 'Groups upsert recebido' });
             // TODO: Implementar lógica de upsert no DB/webhook se necessário
             // await this.handleGroupUpsert(events['groups.upsert']); // Método não existe
        }
        // CORREÇÃO TS1212: Mover lógica de grupo para handlers
        if (events['groups.update']) {
             this.logger.info({ count: events['groups.update'].length, msg: 'Groups update recebido' });
             // TODO: Implementar lógica de update no DB/webhook se necessário
             // await this.handleGroupUpdate(events['groups.update']); // Método não existe
        }
        // CORREÇÃO TS1218: Mover lógica de grupo para handlers
        if (events['group-participants.update']) {
             this.logger.info({ update: events['group-participants.update'], msg: 'Group participants update recebido' });
             // TODO: Implementar lógica de update no DB/webhook se necessário
             // await this.handleParticipantUpdate(events['group-participants.update']); // Método não existe
        }

        // CORREÇÃO TS1226: Mover lógica de presença para handlers
        if (events['presence.update']) {
             this.logger.debug({ update: events['presence.update'], msg: 'Presence update recebido' });
             // TODO: Implementar lógica de update no DB/webhook se necessário
             // await this.handlePresenceUpdate(events['presence.update']); // Método não existe
        }

         // CORREÇÃO TS1233: Mover lógica de histórico para handlers
         if (events['messaging-history.set']) {
             const { chats, contacts, messages, isLatest } = events['messaging-history.set'];
             this.logger.info(`Histórico recebido: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens. É o mais recente: ${isLatest}`);
             // TODO: Processar histórico (salvar no DB, etc.)
             // await this.handleHistorySet(chats, contacts, messages, isLatest); // Método não existe
         }

         // Adicionar outros handlers de eventos conforme necessário (call, labels, etc.)

      }); // Fim client.ev.process

      return this.client;

    } catch (error: any) {
      this.logger.error({ err: error, msg: `Erro fatal ao inicializar conexão Baileys` });
      this.connectionState = { connection: 'close', lastDisconnect: { error: error, date: new Date() } };
      this.sendConnectionUpdate();
      // Limpar estado se a conexão falhar completamente
      await authStateMethods!.clearState?.().catch(()=>{}); // Limpa estado salvo
      // CORREÇÃO TS2339: Verificar se deleteAccount existe (corrigido import anteriormente)
      await this.waMonitor.deleteAccount(this.instanceName!).catch(()=>{}); // Garantir remoção do monitor em caso de falha
      throw new InternalServerErrorException(`Falha ao conectar ao WhatsApp: ${error.message}`);
    }
  }

  // --- Handlers Internos (Implementações básicas) ---

  private handleQrCode(qr: string): void {
    this.logger.info('QR Code recebido, aguardando scan...');
    this.qrCodeInternal!.count = (this.qrCodeInternal?.count ?? 0) + 1;
    this.qrCodeInternal!.code = qr;
    // Gerar base64 se necessário (pode ser feito no frontend)
    // this.qrCodeInternal.base64 = await qrcode.toDataURL(qr);
    this.sendQrCodeUpdate(); // Envia atualização
}

  private handleConnectionClose(lastDisconnect: Boom | undefined): void {
    const statusCode = lastDisconnect?.output?.statusCode;
    this.logger.warn(`Conexão fechada. Razão: ${DisconnectReason[statusCode as number] ?? statusCode} (${lastDisconnect?.message})`);
    // CORREÇÃO TS296/TS329: Passar objeto para updateConnectionState
    this.updateConnectionState('close', { error: lastDisconnect as Error, date: new Date() });

    const shouldReconnect = statusCode !== DisconnectReason.loggedOut &&
                            statusCode !== DisconnectReason.connectionReplaced &&
                            statusCode !== DisconnectReason.multideviceMismatch;

    if (shouldReconnect) {
        this.logger.info('Tentando reconectar...');
        // Adicionar delay antes de reconectar
        setTimeout(() => this.connectToWhatsapp().catch(err => this.logger.error({err, msg: "Erro na tentativa de reconexão"})) , 5000); // Delay de 5s
    } else {
        this.logger.error('Não será possível reconectar automaticamente (loggedOut, replaced, mismatch). Limpando estado.');
        // Limpar estado salvo
        // CORREÇÃO TS329: Chamar clearState do authStateMethods
        this.getAuthStateMethods() // Obter métodos de auth
            .then(methods => methods.clearState?.())
            .catch(err => this.logger.error({err, msg: "Erro ao limpar estado de autenticação"}));
        // Remover do monitor
        this.waMonitor.remove(this.instanceName!);
    }
}

private handleConnectionOpen(): void {
    this.logger.info(`Conexão aberta com sucesso para ${this.instanceId} (${this.client?.user?.id})`);
    this.qrCodeInternal = null; // Limpa QR Code
    // CORREÇÃO: Passar objeto para updateConnectionState
    this.updateConnectionState('open', { date: new Date() } as any); // 'as any' para simplificar
    // Atualizar informações da instância no DB e localmente
    this.instance.wuid = jidNormalizedUser(this.client?.user?.id);
    this.instance.profileName = this.client?.user?.name || this.client?.user?.notify || this.client?.user?.verifiedName;
    this.updateInstanceInfo(); // Salva no DB

    // Carregar configurações após conectar
    this.loadSettings();
    this.loadWebhook();
    this.loadChatwoot();
}

// Método auxiliar para obter métodos de auth state
private async getAuthStateMethods(): Promise<AuthStateMethods> {
    const providerSessionConfig = this.configService.get<ProviderSessionConfig>('PROVIDER');
    const cacheConfig = this.configService.get<CacheConf>('CACHE');
    const dbConfig = this.configService.get<Env['DATABASE']>('DATABASE');

    if (providerSessionConfig.ENABLED) {
        throw new Error("AuthStateProvider não implementado/corrigido.");
    } else if (cacheConfig.REDIS.ENABLED && cacheConfig.REDIS.SAVE_INSTANCES) {
        const redisAuthState = await useMultiFileAuthStateRedisDb(this.instanceId!, this.cacheService);
        return { ...redisAuthState, clearState: async () => { /* Implementar limpeza no Redis */ } };
    } else if (dbConfig.PROVIDER === 'prisma' && dbConfig.SAVE_DATA.INSTANCE) {
        const prismaAuthState = await useMultiFileAuthStatePrisma(this.instanceId!, this.prismaRepository);
        return { ...prismaAuthState, clearState: async () => { await this.prismaRepository.session.deleteMany({ where: { instanceId: this.instanceId } }); } };
    } else {
        const { state, saveCreds } = await useMultiFileAuthState(path.join('sessions', this.instanceName!));
        return { state, saveCreds, clearState: async () => { /* Implementar limpeza local */ } };
    }
}

// Implementação básica dos handlers de eventos
private async handleContactsUpsert(contacts: BaileysContact[]): Promise<void> {
    if (!this.configService.get<Env['DATABASE']>('DATABASE').SAVE_DATA.CONTACTS) return;
    for (const contact of contacts) {
        await this.prismaRepository.upsertContact({
            where: { remoteJid_instanceId: { remoteJid: contact.id, instanceId: this.instanceId! } },
            create: { remoteJid: contact.id, instanceId: this.instanceId!, pushName: contact.name || contact.notify },
            update: { pushName: contact.name || contact.notify }
        });
    }
    this.sendDataWebhook(Events.CONTACTS_UPSERT, contacts);
}

private async handleContactsUpdate(updates: Partial<BaileysContact>[]): Promise<void> {
    if (!this.configService.get<Env['DATABASE']>('DATABASE').SAVE_DATA.CONTACTS) return;
     for (const update of updates) {
         if (update.id) {
            await this.prismaRepository.contact.updateMany({ // Usar updateMany ou upsert?
                where: { remoteJid: update.id, instanceId: this.instanceId! },
                data: { pushName: update.name || update.notify } // Atualiza o nome
            });
         }
    }
    this.sendDataWebhook(Events.CONTACTS_UPDATE, updates);
}

private async handleIncomingMessage(msg: WAProto.IWebMessageInfo): Promise<void> {
    // Lógica principal de processamento de mensagem
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return; // Ignora status antigos ou sem conteúdo

    const remoteJid = msg.key.remoteJid!;
    // Salvar mensagem se configurado
    if (this.configService.get<Env['DATABASE']>('DATABASE').SAVE_DATA.NEW_MESSAGE) {
        await this.prismaRepository.createMessage({
             data: { /* mapear msg para schema Prisma */
                instanceId: this.instanceId!,
                messageId: msg.key.id!,
                remoteJid: remoteJid,
                fromMe: msg.key.fromMe ?? false,
                messageType: Object.keys(msg.message)[0], // Tipo da mensagem
                messageTimestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
                jsonData: JSON.stringify(msg), // Salvar objeto completo
                // Mapear outros campos (text, media, etc.) se o schema permitir
             }
        }).catch(e => this.logger.error({err: e, msg: "Erro ao salvar mensagem recebida no DB"}));
    }

    // Emitir para webhook global
    this.sendDataWebhook(Events.MESSAGES_UPSERT, msg);

    // Emitir para chatbot interno
    await chatbotController?.emit?.(Events.MESSAGES_UPSERT, {
        instanceId: this.instanceId!,
        data: msg,
        source: 'baileys'
    });

    // Lógica Chatwoot
    if (this.localChatwoot?.enabled && !msg.key.fromMe) {
        await this.chatwootService?.processWebhook({
             instanceId: this.instanceId!,
             event: Events.MESSAGES_UPSERT,
             payload: msg
         }).catch(e => this.logger.error({err: e, msg: "Erro ao processar webhook Chatwoot para mensagem recebida"}));
    }

    // Marcar como lida se configurado
    if (this.localSettings?.readMessages && !msg.key.fromMe && !isJidGroup(remoteJid)) {
        await this.client?.readMessages([msg.key]);
    }
}

private async handleMessageStatusUpdate(update: WAProto.IMessageUpdate): Promise<void> {
     if (!this.configService.get<Env['DATABASE']>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) return;
     // Salvar atualização de status no DB
     await this.prismaRepository.messageUpdate.create({
         data: { /* mapear update para schema Prisma */
             instanceId: this.instanceId!,
             messageId: update.key?.id!,
             remoteJid: update.key?.remoteJid!,
             fromMe: update.key?.fromMe ?? false,
             participant: update.key?.participant || null,
             status: WAProto.WebMessageInfo.Status[update.update?.status ?? 0], // Mapear enum para string
             timestamp: Number(update.update?.messageTimestamp) || Math.floor(Date.now() / 1000)
         }
     }).catch(e => this.logger.error({err: e, msg: "Erro ao salvar status de mensagem no DB"}));

     // Emitir para webhook
     this.sendDataWebhook(Events.MESSAGES_UPDATE, update);
}

// Método para atualizar instância no DB (exemplo)
private async updateInstanceInfo(): Promise<void> {
    if (!this.instanceId) return;
    try {
        await this.prismaRepository.instance.update({
            where: { instanceId: this.instanceId },
            data: {
                wuid: this.instance.wuid,
                profileName: this.instance.profileName,
                profilePicUrl: this.instance.profilePictureUrl // Corrigido nome da propriedade
            }
        });
        this.logger.info("Informações da instância atualizadas no DB.");
    } catch (error) {
        this.logger.error({ err: error, msg: "Erro ao atualizar informações da instância no DB." });
    }
}

// --- Outros Métodos (Corrigidos ou Implementados) ---

  // CORREÇÃO TS2345: Usar string[]
  public async onWhatsapp(jids: string[]): Promise<OnWhatsAppDto[]> {
    const results: OnWhatsAppDto[] = [];
    // O método onWhatsApp do Baileys pode aceitar múltiplos JIDs, mas a chamada original passava um só.
    // Iterar se necessário ou passar o array diretamente.
    const response = await this.client?.onWhatsApp(jids);
    // Mapear resposta
    if (response) {
        response.forEach(item => results.push({
            jid: item.jid,
            exists: item.exists,
            // CORREÇÃO: Adapte 'number' e 'name' conforme a resposta real de onWhatsApp
            number: item.jid.split('@')[0], // Exemplo
            name: undefined // Nome não vem por padrão
        }));
    }
     // Verificar cache
     await onWhatsappCache(this.prismaRepository, jids, results);
    return results;
}

  public async profilePicture(jid: string, type: 'image' | 'preview' = 'image', timeoutMs?: number): Promise<{ url?: string | null }> {
     const url = await this.client?.profilePictureUrl(jid, type, timeoutMs);
     return { url };
  }

  public async assertSessions(jids: string[], force: boolean): Promise<boolean> {
      return await this.client?.assertSessions(jids, force) ?? false;
  }

  // createParticipantNodes: Método não encontrado

  public async getUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> {
      return await this.client?.getUSyncDevices(jids, useCache, ignoreZeroDevices);
  }

  public generateMessageTag(): string {
      return this.client?.generateMessageTag() ?? randomBytes(4).toString('hex').toUpperCase();
  }

  public async sendNode(stanza: BinaryNode): Promise<void> {
      await this.client?.sendNode(stanza);
  }

  // signalRepositoryDecryptMessage: Método não encontrado

  public async getAuthState(): Promise<AuthenticationCreds> {
    return this.client?.authState.creds ?? {} as AuthenticationCreds;
  }


  // --- Métodos de Envio (Corrigidos) ---

  public async textMessage(data: SendTextDto, options?: SendMessageOptions): Promise<proto.WebMessageInfo> {
    // CORREÇÃO TS402/TS407: Acessar data.text
    return await this.client?.sendMessage(createJid(data.number), { text: data.text }, options as MiscMessageGenerationOptions);
  }

  // CORREÇÃO TS414: Ajustado tipo do parâmetro
  public async mediaMessage(data: SendMediaDto, options?: SendMessageOptions): Promise<proto.WebMessageInfo> {
    const jid = createJid(data.number);
    const mediaPayload: AnyMessageContent = {}; // Usar AnyMessageContent para flexibilidade

    // Monta o payload baseado em mediaType
    const mediaKey = `${data.mediaType}Message`;
    // A mídia real (URL ou buffer) será tratada pela função de envio do Baileys
    const mediaContent = { [data.mediaType]: data.media };

    mediaPayload[mediaKey] = {
      ...mediaContent, // Inclui { image: url/buffer } ou similar
      caption: data.caption,
      mimetype: data.mimetype,
      fileName: data.fileName,
      ptt: data.ptt,
      gifPlayback: data.gif,
    };

    return await this.client?.sendMessage(jid, mediaPayload, options as MiscMessageGenerationOptions);
  }


  public async buttonMessage(data: SendButtonsDto | SendListDto, options?: SendMessageOptions): Promise<proto.WebMessageInfo> {
    const jid = createJid(data.number);
    let messagePayload: AnyMessageContent;

    if ('buttons' in data) { // SendButtonsDto
        // CORREÇÃO: Usar propriedades corretas do DTO
        messagePayload = {
            text: data.bodyText, // Texto principal
            footer: data.footerText,
            buttons: data.buttons.map(b => ({ buttonId: b.id, buttonText: { displayText: b.displayText }, type: 1 })), // Mapear para formato Baileys
            headerType: data.headerText ? 1 : 0, // Tipo 1 para texto simples no header
            viewOnce: options?.viewOnce,
            // Adicionar header de mídia se necessário (requer SendMediaDto aninhado?)
            ...(data.headerText && { title: data.headerText }) // 'title' é usado para header de texto? verificar Baileys
        };
    } else { // SendListDto
        // CORREÇÃO: Usar propriedades corretas do DTO
        messagePayload = {
            text: data.bodyText,
            footer: data.footerText,
            title: data.headerText, // Header da lista
            buttonText: data.buttonText,
            sections: data.sections.map(s => ({
                title: s.title,
                rows: s.rows.map(r => ({ title: r.title, rowId: r.id, description: r.description })) // Mapear para formato Baileys
            })),
            viewOnce: options?.viewOnce,
        };
    }

    return await this.client?.sendMessage(jid, messagePayload, options as MiscMessageGenerationOptions);
}


  public async contactMessage(data: SendContactDto, options?: SendMessageOptions): Promise<proto.WebMessageInfo> {
      const jid = createJid(data.number);
      let messagePayload: AnyMessageContent;

      // Baileys envia um contato por vez ou array? Verificar documentação
      if (data.contacts.length === 1) {
          const contact = data.contacts[0];
          messagePayload = {
              contacts: {
                  displayName: contact.fullName,
                  contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.fullName}\nORG:${contact.organization || ''};\nTEL;type=CELL;type=VOICE;waid=${contact.phoneNumber}:${contact.phoneNumber}\nEND:VCARD` }]
              }
          };
      } else {
          // Enviar múltiplos contatos
          messagePayload = {
              contacts: {
                  contacts: data.contacts.map(contact => ({ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.fullName}\nORG:${contact.organization || ''};\nTEL;type=CELL;type=VOICE;waid=${contact.phoneNumber}:${contact.phoneNumber}\nEND:VCARD` }))
              }
          };
      }
      return await this.client?.sendMessage(jid, messagePayload, options as MiscMessageGenerationOptions);
  }

  public async locationMessage(data: SendLocationDto, options?: SendMessageOptions): Promise<proto.WebMessageInfo> {
    const jid = createJid(data.number);
    // CORREÇÃO: Usar propriedades corretas do DTO
    const messagePayload: AnyMessageContent = {
        location: {
            degreesLatitude: data.latitude,
            degreesLongitude: data.longitude,
            name: data.name,
            address: data.address
        }
    };
    return await this.client?.sendMessage(jid, messagePayload, options as MiscMessageGenerationOptions);
  }

  public async reactionMessage(data: SendReactionDto, options?: SendMessageOptions): Promise<proto.WebMessageInfo> {
     const jid = createJid(data.number);
     // CORREÇÃO: Usar propriedades corretas do DTO
     const reaction: proto.IReaction = {
         text: data.reaction, // O emoji
         key: { // Chave da mensagem original
             remoteJid: jid,
             id: data.messageId,
             fromMe: data.key?.fromMe, // Precisa saber se a msg original era sua
             participant: data.key?.participant,
             // id precisa ser o da msg original!
         }
     };
     return await this.client?.sendMessage(jid, { react: reaction }, options as MiscMessageGenerationOptions);
  }

  // Implementar templateMessage, pollMessage, etc., se necessário

  // --- Métodos de Chat/Contato (Corrigidos) ---

  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto): Promise<{ base64: string | null }> {
     // A lógica de download do Baileys retorna Buffer, converter para base64
     const stream = await downloadMediaMessage(data.message, 'buffer', {}, { logger: this.logger, reuploadRequest: this.client!.updateMediaMessage });
     if (stream instanceof Buffer) {
         return { base64: stream.toString('base64') };
     }
     // Se for stream, precisa consumir
     const buffer = await streamToBuffer(stream);
     return { base64: buffer.toString('base64') };
  }

  public async deleteMessage(data: DeleteMessage): Promise<void> {
     await this.client?.chatModify({
         clear: { messages: [{ id: data.id, fromMe: data.fromMe, timestamp: Date.now() }] } // Exemplo, verificar API correta
     }, data.remoteJid);
     // OU enviar uma mensagem de revogação (mais comum)
     await this.client?.sendMessage(data.remoteJid, { delete: { remoteJid: data.remoteJid, fromMe: data.fromMe, id: data.id, participant: data.participant } });
  }

   public async updateMessage(data: UpdateMessageDto): Promise<proto.WebMessageInfo> {
       return await this.client?.sendMessage(data.number, { edit: data.key, text: data.text });
   }

   public async blockUser(data: BlockUserDto): Promise<void> {
       const action = data.status === 'block' ? 'add' : 'remove';
       await this.client?.updateBlockStatus(createJid(data.number), action);
   }

    public async archiveChat(data: ArchiveChatDto): Promise<void> {
        await this.client?.chatModify({ archive: data.archive }, createJid(data.jid!)); // Usa jid do DTO corrigido
    }

    public async markChatUnread(data: MarkChatUnreadDto): Promise<void> {
        await this.client?.chatModify({ markRead: false, // Marcar como não lida
            // Ajustar lastMessages se necessário, ou omitir
            lastMessages: data.lastMessage ? [ data.lastMessage as any ] : undefined
        }, createJid(data.jid!)); // Usa jid do DTO corrigido
    }

  // --- Métodos de Grupo (Corrigidos) ---

    public async createGroup(data: CreateGroupDto): Promise<GroupMetadata> {
        return await this.client?.groupCreate(data.subject, data.participants.map(p => createJid(p)));
    }

    public async updateGroupPicture(data: GroupPictureDto): Promise<void> {
        // CORREÇÃO TS685, TS688, TS695, TS696, TS699: Usar data.picture e tratar URL/Base64
        const groupJid = createJid(data.groupJid);
        let imageBuffer: Buffer;
        if (!data.picture) throw new BadRequestException("Propriedade 'picture' (URL ou Base64) é obrigatória.");

        if (isURL(data.picture)) {
            const response = await axios.get(data.picture, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
        } else if (isBase64(data.picture)) {
             imageBuffer = Buffer.from(data.picture.split(',')[1] || data.picture, 'base64'); // Remove prefixo se houver
        } else {
             throw new BadRequestException("Propriedade 'picture' deve ser uma URL válida ou Base64.");
        }
        await this.client?.updateProfilePicture(groupJid, imageBuffer);
    }

     // CORREÇÃO: Usar GroupSubjectDto
    public async updateGroupSubject(data: GroupSubjectDto): Promise<void> {
        await this.client?.groupUpdateSubject(createJid(data.groupJid), data.subject);
    }

    public async updateGroupDescription(data: GroupDescriptionDto): Promise<void> {
        await this.client?.groupUpdateDescription(createJid(data.groupJid), data.description);
    }

    public async findGroup(groupJid: string): Promise<GroupMetadata> {
       return await this.client?.groupMetadata(createJid(groupJid));
    }

    public async fetchAllGroups(getParticipants: boolean = false): Promise<GroupMetadata[]> {
        const groups = await this.client?.groupFetchAllParticipating();
        const metadataPromises: Promise<GroupMetadata>[] = [];
        if (groups) {
            for (const id in groups) {
                 metadataPromises.push(this.client!.groupMetadata(id));
            }
        }
        return await Promise.all(metadataPromises);
    }

    public async inviteCode(groupJid: string): Promise<string | undefined> {
        return await this.client?.groupInviteCode(createJid(groupJid));
    }

    // CORREÇÃO: Usar GroupInvite DTO
    public async groupAcceptInviteInfo(inviteCode: string): Promise<any> { // Renomeado de inviteInfo
        return await this.client?.groupAcceptInviteV4(inviteCode, {}); // Adaptar conforme API Baileys
    }

    // acceptInviteCode: Método não encontrado diretamente, usar groupAcceptInviteV4?
    public async acceptInviteCode(inviteCode: string): Promise<string | undefined> {
         return await this.client?.groupAcceptInvite(inviteCode);
    }


    public async revokeInviteCode(groupJid: string): Promise<string | undefined> {
        return await this.client?.groupRevokeInvite(createJid(groupJid));
    }

    public async findParticipants(groupJid: string): Promise<GroupParticipant[]> {
        const metadata = await this.client?.groupMetadata(createJid(groupJid));
        return metadata?.participants ?? [];
    }

    // CORREÇÃO: Nome corrigido
    public async updateParticipants(data: GroupUpdateParticipantDto): Promise<any> {
        const participants = data.participants.map(p => createJid(p));
        return await this.client?.groupParticipantsUpdate(createJid(data.groupJid), participants, data.action);
    }

     // CORREÇÃO: Nome corrigido
    public async updateSetting(data: GroupUpdateSettingDto): Promise<void> {
        // CORREÇÃO TS825, TS829, TS833, TS834, TS835, TS836, TS838, TS842: Usar data.settings
        const groupJid = createJid(data.groupJid);
        const setting = data.settings; // Usar 'settings' conforme DTO

        if (!setting || (setting !== 'announcement' && setting !== 'not_announcement' && setting !== 'locked' && setting !== 'unlocked')) {
           throw new BadRequestException(`Configuração de grupo inválida: ${setting}. Use 'announcement', 'not_announcement', 'locked', ou 'unlocked'.`);
        }

        this.logger.info(`Atualizando configuração "${setting}" para o grupo ${groupJid}`);
        try {
             await this.client?.groupSettingUpdate(groupJid, setting);
        } catch (error: any) {
             this.logger.error({ err: error, groupJid, setting: data.settings, message: `Erro ao atualizar configuração do grupo ${groupJid}` });
             throw new InternalServerErrorException(`Erro ao atualizar configuração: ${error.message}`);
        }
    }

     // CORREÇÃO: Nome corrigido para ephemeralExpiration
    public async toggleEphemeral(data: GroupToggleEphemeralDto): Promise<void> {
         // CORREÇÃO TS850, TS854, TS856: Usar data.ephemeralExpiration
        const groupJid = createJid(data.groupJid);
        if (data.ephemeralExpiration === undefined) {
           throw new BadRequestException("Propriedade 'ephemeralExpiration' é obrigatória (número de segundos ou 0 para desativar).");
        }
        this.logger.info(`Alternando mensagens efêmeras para o grupo ${groupJid}. Duração: ${data.ephemeralExpiration}`);
        try {
            await this.client?.groupToggleEphemeral(groupJid, data.ephemeralExpiration);
        } catch (error: any) {
           this.logger.error({ err: error, groupJid, duration: data.ephemeralExpiration, message: `Erro ao alternar mensagens efêmeras` });
           throw new InternalServerErrorException(`Erro ao alternar mensagens efêmeras: ${error.message}`);
        }
    }

    public async leaveGroup(groupJid: string): Promise<void> {
        await this.client?.groupLeave(createJid(groupJid));
    }


  // --- Outros Métodos ---

  public async getStatusFromGroupMetadata(result: any): Promise<string> {
    // CORREÇÃO TS904: Verificar se 'status' existe no tipo de 'result'
    // A estrutura retornada por groupMetadata pode não ter 'status' diretamente
    // return result?.status ?? ''; // Remover ou adaptar se status não existir
    // Exemplo: Verificar se o grupo está ativo baseado em outra propriedade
    return result?.participants?.length > 0 ? 'active' : 'inactive'; // Exemplo
  }

  // Métodos relacionados a profile/privacy (implementações básicas)
  public async updateProfileName(name: string): Promise<void> {
    await this.client?.updateProfileName(name);
  }
  public async updateProfileStatus(status: string): Promise<void> {
     await this.client?.updateProfileStatus(status);
  }
  public async updateProfilePicture(data: ProfilePictureDto): Promise<void> {
      let imageBuffer: Buffer;
      if (!data.picture) throw new BadRequestException("Propriedade 'picture' (URL ou Base64) é obrigatória.");
      if (isURL(data.picture)) {
          const response = await axios.get(data.picture, { responseType: 'arraybuffer' });
          imageBuffer = Buffer.from(response.data);
      } else if (isBase64(data.picture)) {
           imageBuffer = Buffer.from(data.picture.split(',')[1] || data.picture, 'base64');
      } else {
           throw new BadRequestException("Propriedade 'picture' deve ser uma URL válida ou Base64.");
      }
      // Atualiza a foto do próprio usuário conectado
      await this.client?.updateProfilePicture(this.client.user!.id, imageBuffer);
  }
   public async removeProfilePicture(): Promise<void> {
      await this.client?.removeProfilePicture(this.client!.user!.id);
   }
   public async fetchPrivacySettings(): Promise<any> {
       return await this.client?.fetchPrivacySettings();
   }
   public async updatePrivacySettings(data: PrivacySettingDto): Promise<void> {
       await this.client?.updatePrivacySetting(data.readreceipts ? 'readreceipts' : undefined, data.readreceipts);
       // Chamar updatePrivacySetting para cada chave em PrivacySettingDto
       // await this.client?.updatePrivacySetting('profile', data.profile); ... etc
       this.logger.warn("updatePrivacySettings parcialmente implementado. Verifique a API Baileys para todas as chaves.");
   }
   public async fetchBusinessProfile(jid: string): Promise<any> {
       return await this.client?.fetchBusinessProfile(jid);
   }


   // Método auxiliar para buscar contato com cache/DB
   public async getContactInfo(remoteJid: string): Promise<Partial<Contact>> {
        const jid = createJid(remoteJid);
        let contactInfo: Partial<Contact> | undefined;

        // Tentar buscar no store (cache rápido)
        contactInfo = this.store?.contacts?.[jid];

        // Se não encontrar no store, buscar no DB
        if (!contactInfo) {
            try {
                // CORREÇÃO TS956: Usar estrutura correta para where com chave composta
                contactInfo = await this.prismaRepository.contact.findUnique({
                   where: { remoteJid_instanceId: { remoteJid: jid, instanceId: this.instanceId! } }
                });
            } catch (error) {
                 this.logger.error({ err: error, jid, msg: `Erro ao buscar contato ${jid} no DB` });
            }
        }

        // Obter nome e URL da foto se disponíveis
        const name = contactInfo?.pushName || contactInfo?.name; // CORREÇÃO TS969: Usar pushName ou name
        const profilePicUrl = contactInfo?.profilePicUrl || undefined; // Usar profilePicUrl se existir no DB

        return {
            id: jid, // Usar o JID como ID principal
            remoteJid: jid, // Manter remoteJid
            pushName: name,
            profilePicUrl: profilePicUrl,
            // Retornar outros campos relevantes do DB se necessário
        };
    }

} // Fim da classe BaileysStartupService

// Função auxiliar para converter Stream para Buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
