// src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correção Erro 77: Importa Boom de @hapi/boom.
// Correção Erro 78: Importa encodeUint8 como default.
// Correção Erro 79: Importa makeInMemoryStore como default.
// Correção Erro 80: Ajusta imports de config.service e env.config.
// Correção Erro 81: Corrige import de useMultiFileAuthStatePrisma para default.
// Correção Erro 82: Remove ProxyAgent do import local.
// Correção Erro 83: Corrige nome da função importada para getOnWhatsappCache.
// Correção Erro 84: Garante importação consistente de WAMonitoringService.
// Correção Erro 85: Adiciona implementações stub/reais para logoutInstance e templateMessage.
// Correção Erro 86: Importa WASocket de baileys.
// Correção Erro 87: Importa ConnectionState de baileys.

import * as Sentry from '@sentry/node';
import { createHash } from 'crypto';
import makeWASocket, {
    // ** Correção Erro 77, 78: Removido Boom, encodeUint8 daqui **
    AuthenticationCreds, AuthenticationState, BaileysEventMap, Browsers, DisconnectReason, fetchLatestBaileysVersion,
    // ** Correção Erro 86, 87: Adicionado WASocket, ConnectionState **
    WASocket, ConnectionState,
    generateProfilePicture, getDevice, GroupMetadata, GroupParticipant, GroupSettingUpdate, // GroupSettingUpdate importado aqui, verificar se é o correto
    isJidGroup, isJidUser, MessageRetryMap, MessageType, MiscMessageGenerationOptions, ParticipantAction,
    prepareWAMessageMedia, proto, useSingleFileAuthState, // useSingleFileAuthState mantido? Usar useMultiFileAuthStatePrisma?
    WAMessageKey, WAMessageStubType, WAMessageUpdate, WAPatchName, // WAMessageUpdate parece estar aqui
    areJidsSameUser, BinaryNodeInfo, // BinaryNodeInfo pode ser útil para sendNode
    // ** Correção Erro 79: Removido makeInMemoryStore daqui **
     AnyMessageContent, delay, jidNormalizedUser, // delay estava aqui
    extractMessageContent, generateForwardMessageContent, generateWAMessage, generateWAMessageContent, generateWAMessageFromContent, getContentType, jidDecode, downloadContentFromMessage, getAggregateVotesInPollMessage
} from '@whiskeysockets/baileys';
// ** Correção Erro 77: Importar Boom de @hapi/boom **
import Boom from '@hapi/boom';
// ** Correção Erro 78: Importar encodeUint8 como default **
import encodeUint8 from '@whiskeysockets/baileys';
// ** Correção Erro 79: Importar makeInMemoryStore como default **
import makeInMemoryStore from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode'; // Importar qrcode
import { writeFile } from 'fs/promises';
import { createReadStream, existsSync, unlinkSync } from 'fs'; // Para manipulação de arquivos
import NodeCache from 'node-cache'; // Cache em memória (usado no exemplo original)
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaRepository } from '@repository/repository.service'; // Use alias
import { CacheService } from '@api/services/cache.service'; // Use alias
import { Logger } from '@config/logger.config'; // Use alias
import { ChannelStartupService } from '@api/services/channel.service'; // Use alias
// ** Correção Erro 84: Usar import consistente com a base **
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar monitor.service
import { InstanceDto } from '@api/dto/instance.dto'; // Use alias
import { Events } from '@api/integrations/event/event.dto'; // Use alias
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Use alias
// ** Correção Erro 80: Ajustar imports de config **
import { ConfigService } from '../../../config/config.service';
import { Env, QrCode as QrCodeConfig, Chatwoot as ChatwootConfig, CacheConf, ProviderSession as ProviderSessionConfig, ConfigSessionPhone } from '../../../config/env.config'; // LogConfig removido
// Importar DTOs de mensagem
import {
    SendTextDto, SendMediaDto, SendContactDto, SendLocationDto, SendReactionDto, SendLinkDto,
    SendButtonsDto, SendListDto, SendPollDto, SendTemplateDto, SendMessageOptions, MessageKeyDto
} from '@api/dto/sendMessage.dto';
// Importar DTOs de grupo
import {
    CreateGroupDto, GroupPictureDto, GroupToggleEphemeralDto, GroupUpdateSettingDto,
    GroupSubjectDto, GroupDescriptionDto, GroupUpdateParticipantDto, LeaveGroupDto, GetInviteCodeDto, RevokeInviteCodeDto
} from '@api/dto/group.dto';
// Importar DTOs de chat
import { ArchiveChatDto, MarkChatUnreadDto, NumberDto } from '@api/dto/chat.dto';
// ** Correção Erro 81: Usar import default **
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma'; // Ajustar path e verificar export
// Importar utilitários
import { ProviderFiles } from '@provider/sessions'; // Ajustar path e verificar export
import { getMessageRaw, getMessageOptions, getMessageButtons, getMessageList } from '@utils/parseMessage'; // Ajustar path
// ** Correção Erro 82: Remover ProxyAgent daqui **
import { makeProxyAgent } from '@utils/makeProxyAgent'; // Ajustar path
// Importar pino para logger de Baileys
import P from 'pino';
import { Prisma, Message as MessageModel, Contact as ContactModel, MessageUpdate as MessageUpdateModel, Chat as ChatModel, Label as LabelModel } from '@prisma/client';
// ** Correção Erro 83: Corrigir nome da função **
import { getOnWhatsappCache } from '@utils/onWhatsappCache'; // Importar getOnWhatsappCache
import { useVoiceCalls } from './voiceCalls/useVoiceCallsBaileys'; // Importar hook de chamadas
import { Multer } from 'multer';
interface UploadedFile extends Multer.File {}
import { LocalSettingsDto, WebhookDto, QRCodeDto } from '@api/dto/instance.dto'; // Importar DTOs internos
import { LocalProxy } from '@api/dto/proxy.dto'; // Importar DTO de proxy


// Tipagem para estado de autenticação com método clearState (para logout)
type ExtendedAuthenticationState = AuthenticationState & { clearState?: () => Promise<void> | void };

// ** Correção Erro 84 e 85 **
@Injectable({ scope: Scope.TRANSIENT })
export class BaileysStartupService extends ChannelStartupService implements OnModuleInit, OnModuleDestroy {
    // ** Correção Erro 86: Usar tipo WASocket importado **
    public client: WASocket | null = null;
    private store: ReturnType<typeof makeInMemoryStore> | null = null; // Ou tipo mais específico se usar store customizado
    // ** Correção Erro 87: Usar tipo ConnectionState importado **
    public connectionState: Partial<ConnectionState> = { connection: 'close' }; // Estado inicial
    private authState: ExtendedAuthenticationState | null = null;
    private messageRetryMap: MessageRetryMap = {};
    private qrCodeData: QRCodeDto = { base64: '', count: 0 }; // Armazenar dados do QR Code
    private callsHandler: ReturnType<typeof useVoiceCalls> | null = null; // Handler para chamadas

    constructor(
        // Injetar dependências via construtor
        configService: ConfigService,
        eventEmitter: EventEmitter2,
        prismaRepository: PrismaRepository,
        cacheService: CacheService,
        waMonitor: WAMonitoringService, // Tipo deve ser consistente
        baseLogger: Logger,
        chatwootService: ChatwootService,
        // ** Correção Erro (rel 27/31): Usar ProviderFiles importado corretamente **
        // O tipo aqui deve ser consistente com o esperado pela classe base e outras partes
        private readonly providerFiles?: ProviderFiles, // Tornar opcional ou garantir que sempre exista
    ) {
        // ** Correção Erro (rel 62): Passar waMonitor para super, tipo precisa ser compatível **
        // A compatibilidade depende da definição em ChannelStartupService
        super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, baseLogger, chatwootService);
        // Criar logger específico para esta instância no onModuleInit
        this.logger = baseLogger; // Atribuir diretamente ou criar filho
        // this.logger = baseLogger.child({ context: BaileysStartupService.name });
    }

    async onModuleInit() {
        // Inicialização se necessário ao carregar o módulo
    }

    async onModuleDestroy() {
        this.logger.log(`[${this.instanceName}] Encerrando serviço do canal Baileys.`);
        this.client?.ev.removeAllListeners(); // Remover listeners para evitar memory leaks
        this.client?.end(undefined); // Tentar desconectar
        this.client = null;
        this.store = null;
        this.authState = null;
    }

    // Override do método getStatus da classe base
    public getStatus(): Partial<ConnectionState> {
        return this.connectionState;
    }

    // Inicialização específica com dados da instância
    public async init(instanceData: InstanceDto): Promise<void> {
        await super.init(instanceData); // Chama init base
        this.logger = this.baseLogger; // .child({ instance: this.instanceName }); // Cria logger com contexto da instância
        this.logger.log(`[${this.instanceName}] Inicializando canal Baileys.`);
        // Iniciar conexão ao WhatsApp aqui
        await this.connectToWhatsapp();
    }

    public async connectToWhatsapp(): Promise<WASocket | null> {
        if (this.client && this.connectionState.connection !== 'close') {
            this.logger.warn(`[${this.instanceName}] Conexão já existente ou em andamento (${this.connectionState.connection}).`);
            return this.client;
        }

        this.logger.log(`[${this.instanceName}] Iniciando conexão com WhatsApp...`);
        this.connectionState = { connection: 'connecting', qr: undefined, isNewLogin: undefined }; // Estado inicial
        this.emitConnectionUpdate(); // Envia estado inicial 'connecting'

        // Configuração de Cache e Store
        const msgRetryCounterCache = new NodeCache(); // Ou usar Redis/CacheService se preferir
        const loggerBaileys = P({ level: this.logConfig.BAILEYS ?? 'error' }).child({ stream: 'baileys' }); // Logger específico para Baileys

        // --- Configuração do Estado de Autenticação ---
        // Prioridade: 1. ProviderFiles (se existir) 2. Prisma DB 3. Single File (como fallback ou dev)
        if (this.providerFiles && this.providerSessionConfig.type === 'provider') {
            this.logger.log(`[${this.instanceName}] Usando ProviderFiles para autenticação.`);
            // TODO: Adaptar useMultiFileAuthStateProviderFiles se necessário
             // this.authState = await useMultiFileAuthStateProviderFiles(this.instanceName, this.providerFiles, this.logger);
             throw new Error("useMultiFileAuthStateProviderFiles não implementado/adaptado."); // Remover após implementação
        } else if (this.dbConfig.SESSION_SAVE === 'prisma' && this.providerSessionConfig.type !== 'provider') {
             this.logger.log(`[${this.instanceName}] Usando Prisma para autenticação.`);
             // ** Correção Erro 81: Usar import default **
             this.authState = await useMultiFileAuthStatePrisma(this.instanceName, this.prismaRepository, this.logger);
        } else {
             this.logger.log(`[${this.instanceName}] Usando SingleFileAuthState (arquivo local ${this.instanceName}_session.json).`);
             // TODO: Considerar remover SingleFileAuthState ou tornar configurável
             const { state, saveState } = await useSingleFileAuthState(`${this.instanceName}_session.json`);
             this.authState = state as ExtendedAuthenticationState;
             // Adicionar clearState manualmente se necessário para SingleFile
             this.authState.clearState = async () => {
                 if (existsSync(`${this.instanceName}_session.json`)) {
                     unlinkSync(`${this.instanceName}_session.json`);
                 }
                 this.authState = null; // Resetar estado em memória
                 this.logger.log(`[${this.instanceName}] Estado de autenticação (arquivo) limpo.`);
             };
             // TODO: Tratar saveState (pode ser saveCreds em versões mais novas)
             // this.client.ev.on('creds.update', saveState); // Exemplo
        }

        const { version, isLatest } = await fetchLatestBaileysVersion();
        this.logger.info(`[${this.instanceName}] Usando Baileys v${version}, latest: ${isLatest}`);

        // --- Configuração de Proxy ---
        let agent: any = undefined; // Tipo any para compatibilidade
        if (this.localProxy?.enabled && this.localProxy?.host && this.localProxy?.port) {
            this.logger.info(`[${this.instanceName}] Configurando proxy: ${this.localProxy.protocol}://${this.localProxy.host}:${this.localProxy.port}`);
            try {
                // ** Correção Erro 82: Remover tipo ProxyAgent se não importado **
                agent = makeProxyAgent({
                    protocol: (this.localProxy.protocol || 'http') as 'http' | 'https' | 'socks' | 'socks4' | 'socks5',
                    host: this.localProxy.host,
                    port: parseInt(this.localProxy.port),
                    auth: this.localProxy.username && this.localProxy.password
                          ? `${this.localProxy.username}:${this.localProxy.password}`
                          : undefined
                });
                 this.logger.info(`[${this.instanceName}] Proxy Agent configurado com sucesso.`);
            } catch (proxyError) {
                 this.logger.error(`[${this.instanceName}] Falha ao configurar Proxy Agent: ${proxyError}`);
                 // Decidir se continua sem proxy ou lança erro
            }
        }


        this.client = makeWASocket({
             version,
             logger: loggerBaileys,
             printQRInTerminal: this.qrCodeConfig.PRINT_ON_CONSOLE ?? false, // Usar config
             mobile: false, // Geralmente false para APIs
             auth: {
                 creds: this.authState!.creds,
                 // CacheableSignalKeyStore recomendado para multi-device
                 keys: makeCacheableSignalKeyStore(this.authState!.keys, loggerBaileys),
             },
             msgRetryCounterCache,
             // getMessage: async key => { // Implementar se usar store persistente
             //     if (this.store) {
             //         const msg = await this.store.loadMessage(key.remoteJid!, key.id!);
             //         return msg?.message || undefined;
             //     }
             //     // // ou busca do DB se necessário
             //     // const msgDb = await this.prismaRepository.message.findUnique({ where: { keyId_instanceId: { keyId: key.id!, instanceId: this.instanceId! } } });
             //     // return msgDb?.message ? (JSON.parse(msgDb.message as string) as proto.IMessage) : undefined;
             //     return undefined;
             // },
              shouldIgnoreJid: (jid) => isJidGroup(jid), // Exemplo: Ignorar jids de grupo em certas lógicas?
             browser: Browsers.ubuntu('Chrome'), // Simular um navegador
             agent: agent, // Passa o proxy agent configurado
             syncFullHistory: this.localSettings?.syncFullHistory ?? false, // Usar config local
             connectTimeoutMs: 60000, // Timeout maior para conectar
             keepAliveIntervalMs: 20000, // Keep alive para manter conexão
             markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true, // Usar config local
             // patchMessageBeforeSending: (msg) => {
             //      // Exemplo: Adicionar rodapé em todas as mensagens
             //      const requiresCaption = getContentType(msg.message) === 'imageMessage' || getContentType(msg.message) === 'videoMessage';
             //      const caption = requiresCaption ? msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption : null;
             //      if (caption !== null) {
             //          msg = JSON.parse(JSON.stringify(msg)); // Deep copy
             //          const key = getContentType(msg.message) as 'imageMessage' | 'videoMessage';
             //          msg.message![key]!.caption = caption + '\n\n_Sent via Evolution API_';
             //      }
             //      return msg;
             // },
        });

         // Configurar store se necessário (para contatos, chats, etc. em memória)
         // O store não persiste dados entre reinicializações por padrão
         // this.store = makeInMemoryStore({ logger: P({ level: 'silent' }).child({ stream: 'store' }) });
         // this.store?.bind(this.client.ev); // Conecta o store aos eventos do cliente

         // Vincular handlers aos eventos Baileys
         this.bindEventHandlers();

        // Iniciar o handler de chamadas de voz se configurado
        if (this.localSettings?.wavoipToken) {
            this.logger.info(`[${this.instanceName}] Configurando handler de chamadas de voz.`);
            this.callsHandler = useVoiceCalls(this as any, this.logger, this.instanceName); // Passar 'this' como BaileysSocket
            this.callsHandler.listen(); // Começa a escutar eventos de chamada
        }


        return this.client;
    }

    private bindEventHandlers(): void {
        if (!this.client) return;

        // Atualização de credenciais
        this.client.ev.on('creds.update', this.authState!.saveCreds); // Usar saveCreds do estado de auth escolhido

        // Eventos de Conexão
        this.client.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;
            this.connectionState = { ...this.connectionState, ...update }; // Atualiza estado interno

             this.logger.info(`[${this.instanceName}] Status conexão: ${connection}${lastDisconnect ? (', Erro: ' + lastDisconnect.error?.message) : ''}${qr ? ', QR recebido' : ''}${isNewLogin ? ', Novo login' : ''}`);

            if (qr) {
                this.handleQrCode(qr); // Lida com o QR code
            }

            if (connection === 'close') {
                 this.handleDisconnection(lastDisconnect);
            } else if (connection === 'open') {
                 this.handleConnectionOpen(receivedPendingNotifications);
            }

            this.emitConnectionUpdate(); // Envia atualização de estado para webhooks/sockets
        });

        // Eventos de Mensagens
        this.client.ev.on('messages.upsert', async (update) => {
            if (update.type === 'notify') {
                 for (const msg of update.messages) {
                     await this.handleMessageUpsert(msg);
                 }
            }
            // TODO: Tratar type 'append'/'replace' se necessário
        });

         // Eventos de Status de Mensagens
         this.client.ev.on('message-receipt.update', async (updates) => {
             for (const { key, receipt } of updates) {
                 await this.handleMessageStatusUpdate(key, receipt);
             }
         });


         // Eventos de Chats
         this.client.ev.on('chats.upsert', (chats) => {
             // TODO: Processar chats recebidos (armazenar no DB/cache?)
              this.logger.debug(`[${this.instanceName}] Chats.upsert recebido: ${chats.length} chats.`);
             // this.store?.chats.upsert(chats); // Atualiza store em memória se usado
             this.emitChatsEvent(Events.CHATS_UPSERT, chats);
             this.saveChatsToDb(chats);
         });
         this.client.ev.on('chats.update', (updates) => {
             // TODO: Processar atualizações parciais de chats
              this.logger.debug(`[${this.instanceName}] Chats.update recebido: ${updates.length} updates.`);
             // if (this.store) {
             //     for (const update of updates) {
             //         const chat = this.store.chats.get(update.id!);
             //         if (chat) {
             //             Object.assign(chat, update);
             //         }
             //     }
             // }
             this.emitChatsEvent(Events.CHATS_UPDATE, updates);
             this.updateChatsInDb(updates);
         });
         this.client.ev.on('chats.delete', (deletions) => {
             // TODO: Processar chats deletados
              this.logger.debug(`[${this.instanceName}] Chats.delete recebido: ${deletions.length} JIDs.`);
             // this.store?.chats.delete(deletions); // Atualiza store em memória se usado
             this.emitChatsEvent(Events.CHATS_DELETE, deletions);
             this.deleteChatsFromDb(deletions);
         });

         // Eventos de Contatos
         this.client.ev.on('contacts.upsert', (contacts) => {
             // TODO: Processar contatos recebidos/atualizados
              this.logger.debug(`[${this.instanceName}] Contacts.upsert recebido: ${contacts.length} contatos.`);
             // this.store?.contacts.upsert(contacts); // Atualiza store em memória se usado
             this.emitContactsEvent(Events.CONTACTS_UPSERT, contacts);
             this.saveContactsToDb(contacts);
         });
         this.client.ev.on('contacts.update', (updates) => {
              this.logger.debug(`[${this.instanceName}] Contacts.update recebido: ${updates.length} updates.`);
             // TODO: Processar atualizações parciais de contatos
             this.emitContactsEvent(Events.CONTACTS_UPDATE, updates);
             this.updateContactsInDb(updates);
         });

         // Eventos de Presença
         this.client.ev.on('presence.update', (update) => {
              this.logger.debug(`[${this.instanceName}] Presence.update recebido de ${update.id}:`, update.presences);
             this.emitPresenceEvent(Events.PRESENCE_UPDATE, update);
             // TODO: Salvar presença no DB/cache se necessário
         });

         // Eventos de Grupos
         this.client.ev.on('groups.upsert', (groups) => {
              this.logger.debug(`[${this.instanceName}] Groups.upsert recebido: ${groups.length} grupos.`);
             // TODO: Processar metadados de grupos recebidos/atualizados
             this.emitGroupsEvent(Events.GROUPS_UPSERT, groups);
         });
         this.client.ev.on('groups.update', (updates) => {
              this.logger.debug(`[${this.instanceName}] Groups.update recebido: ${updates.length} updates.`);
             // TODO: Processar atualizações parciais de grupos
             this.emitGroupsEvent(Events.GROUPS_UPDATE, updates);
         });
         this.client.ev.on('group-participants.update', (update) => {
              this.logger.debug(`[${this.instanceName}] Group-participants.update recebido para ${update.id}: Ação ${update.action}`);
             // TODO: Processar atualizações de participantes
             this.emitGroupParticipantsEvent(Events.GROUP_PARTICIPANTS_UPDATE, update);
         });

         // Eventos de Blocqueio/Desbloqueio
         this.client.ev.on('blocklist.set', (update) => {
              this.logger.debug(`[${this.instanceName}] Blocklist.set recebido:`, update);
             this.emitBlocklistEvent(Events.BLOCKLIST_SET, update);
             // TODO: Atualizar blocklist local/DB
         });
         this.client.ev.on('blocklist.update', (update) => {
             this.logger.debug(`[${this.instanceName}] Blocklist.update recebido:`, update);
             this.emitBlocklistEvent(Events.BLOCKLIST_UPDATE, update);
             // TODO: Atualizar blocklist local/DB
         });

        // Outros eventos...
        // this.client.ev.on('labels.edit', ...);
        // this.client.ev.on('labels.association', ...);
    }

    private handleQrCode(qr: string): void {
         this.logger.info(`[${this.instanceName}] QR Code recebido. Count: ${this.qrCodeData.count + 1}`);
         this.qrCodeData.count++;
         this.qrCodeData.code = qr; // Armazena o código QR

         // Gerar base64 para API/frontend
         qrcode.toDataURL(qr, (err, url) => {
             if (err) {
                 this.logger.error(`[${this.instanceName}] Erro ao gerar QR code base64: ${err}`);
                 this.qrCodeData.base64 = ''; // Limpa em caso de erro
             } else {
                 this.qrCodeData.base64 = url;
                 this.logger.info(`[${this.instanceName}] QR code base64 gerado.`);
             }
             // Emitir atualização do QR code APÓS gerar base64 (ou falhar)
             this.emitQrCodeUpdate();
         });
    }

     private handleDisconnection(lastDisconnect: Partial<DisconnectReason> | undefined): void {
         const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
         const shouldReconnect = statusCode !== DisconnectReason.loggedOut &&
                                statusCode !== DisconnectReason.connectionReplaced &&
                                statusCode !== DisconnectReason.multideviceMismatch && // Evitar loop se credenciais inválidas
                                statusCode !== DisconnectReason.badSession; // Sessão inválida, não reconectar

         this.logger.warn(`[${this.instanceName}] Conexão fechada. Razão: ${DisconnectReason[statusCode as number] || statusCode || 'Desconhecida'}. Reconectar: ${shouldReconnect}`);

         this.qrCodeData = { base64: '', count: 0, code: undefined, pairingCode: undefined }; // Limpa QR ao desconectar

         if (shouldReconnect) {
             this.logger.info(`[${this.instanceName}] Tentando reconectar em ${this.waMonitor.reconnectInterval}ms...`);
             setTimeout(() => {
                 if (this.connectionState.connection === 'close') { // Verifica se ainda está fechado antes de reconectar
                     this.logger.info(`[${this.instanceName}] Reconectando...`);
                     this.connectToWhatsapp().catch(err => this.logger.error(`[${this.instanceName}] Erro na tentativa de reconexão: ${err}`));
                 } else {
                      this.logger.info(`[${this.instanceName}] Reconexão não necessária, estado atual: ${this.connectionState.connection}`);
                 }
             }, this.waMonitor.reconnectInterval);
         } else {
             this.logger.warn(`[${this.instanceName}] Não será reconectado automaticamente.`);
             // Se for loggedOut, limpar o estado de autenticação
             if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession) {
                 this.logger.info(`[${this.instanceName}] Limpando estado de autenticação devido a logout/sessão inválida.`);
                 this.authState?.clearState?.().catch(err => this.logger.error(`[${this.instanceName}] Erro ao limpar estado de auth: ${err}`));
                 // Remover do monitor pode ser uma opção aqui também, ou deixar o usuário deletar manualmente
                 // this.waMonitor.stop(this.instanceName); // Opcional: remover automaticamente
             } else if (statusCode === DisconnectReason.connectionReplaced) {
                  this.logger.warn(`[${this.instanceName}] Conexão substituída. Outra sessão foi iniciada.`);
                  // Pode ser interessante parar o monitoramento aqui para evitar conflitos
                  // this.waMonitor.stop(this.instanceName);
             } else if (statusCode === DisconnectReason.multideviceMismatch) {
                 this.logger.error(`[${this.instanceName}] Credenciais Multi-Device inválidas. Limpando estado. Por favor, gere um novo QR code.`);
                  this.authState?.clearState?.().catch(err => this.logger.error(`[${this.instanceName}] Erro ao limpar estado de auth: ${err}`));
             }
         }
     }

     private async handleConnectionOpen(receivedPendingNotifications?: boolean): Promise<void> {
         this.logger.info(`[${this.instanceName}] Conexão aberta. Notificações pendentes: ${receivedPendingNotifications}`);
         this.qrCodeData = { base64: '', count: 0, code: undefined, pairingCode: undefined }; // Limpa QR code

         // Obter dados da instância (nome, foto, etc.) se ainda não tiver
         if (!this.instance.profileName && this.client?.user?.id) {
            try {
                const profile = await this.fetchProfile(this.client.user.id); // Busca perfil da própria instância
                if (profile) {
                     this.instance.profileName = profile.pushName || profile.verifiedName;
                     this.instance.profilePicUrl = profile.profilePictureUrl;
                     // Atualizar no banco de dados
                      await this.prismaRepository.instance.update({
                           where: { id: this.instanceId },
                           data: { profileName: this.instance.profileName, profilePicUrl: this.instance.profilePicUrl }
                      });
                }
            } catch (error) {
                 this.logger.warn(`[${this.instanceName}] Falha ao buscar perfil da instância após conectar: ${error}`);
            }
         }
         // Atualizar JID do proprietário se não estiver definido
         if (!this.instance.ownerJid && this.client?.user?.id) {
              this.instance.ownerJid = this.client.user.id;
               await this.prismaRepository.instance.update({
                    where: { id: this.instanceId },
                    data: { ownerJid: this.instance.ownerJid }
               });
         }
     }

     private async handleMessageUpsert(msg: proto.IWebMessageInfo): Promise<void> {
         if (!msg.message) {
            this.logger.debug(`[${this.instanceName}] Mensagem recebida sem conteúdo (notificação?). ID: ${msg.key.id}`);
            // Tratar stubs de mensagem (excluído, participante adicionado, etc.) se necessário
            // Ex: if (msg.messageStubType) { this.handleMessageStub(msg); }
            return;
         }

         this.logger.debug(`[${this.instanceName}] Mensagem ${msg.key.id} recebida de ${msg.key.remoteJid}:`, JSON.stringify(msg));

         // Salvar no banco de dados
         this.saveMessageToDb(msg);

         // Emitir evento para processamento pelo ChatbotController
         this.emitMessageUpsert(msg);

         // Emitir evento para webhook/websocket
         this.emitWebhookEvent(Events.MESSAGES_UPSERT, { message: msg });

         // Atualizar contato
         this.updateContactFromMessage(msg);

         // Marcar como lida (se configurado e não for mensagem própria ou de grupo)
         const remoteJid = msg.key?.remoteJid;
         if (this.localSettings?.readMessages && !msg.key.fromMe && remoteJid && isJidUser(remoteJid)) {
             try {
                 await this.client?.readMessages([msg.key]);
                 this.logger.debug(`[${this.instanceName}] Mensagem ${msg.key.id} marcada como lida.`);
             } catch (error) {
                  this.logger.warn(`[${this.instanceName}] Falha ao marcar mensagem ${msg.key.id} como lida: ${error}`);
             }
         }
     }

    private async handleMessageStatusUpdate(key: proto.IMessageKey, receipt: Partial<proto.IMessageReceipt>): Promise<void> {
        this.logger.debug(`[${this.instanceName}] Status da mensagem ${key.id} atualizado para ${receipt.type} por ${receipt.userJid}`);
        // Mapear 'receipt' para 'proto.IMessageUserReceipt' se necessário
        const adaptedStatus: Partial<proto.IMessageUserReceipt> = {
             userJid: receipt.userJid,
             messageId: key.id,
             receiptTimestamp: receipt.receiptTimestamp,
             readTimestamp: receipt.readTimestamp,
             playedTimestamp: receipt.playedTimestamp,
             // type: receipt.type // O tipo pode ser útil para mapear para status do Prisma
        };
        this.saveMessageStatusToDb(adaptedStatus); // Salvar no DB
        this.emitMessageStatusUpdate(adaptedStatus); // Emitir evento interno
        this.emitWebhookEvent(Events.MESSAGE_ACK, { key, receipt }); // Emitir para webhook/socket
    }


    // ** Correção Erro 85: Implementar logoutInstance **
    public async logoutInstance(): Promise<void> {
        await this.logout();
    }

    public async logout(): Promise<void> {
         this.logger.log(`[${this.instanceName}] Solicitando logout do Baileys.`);
         await this.authState?.clearState?.(); // Limpa credenciais salvas
         this.client?.logout(); // Comando do Baileys para deslogar
         this.connectionState = { connection: 'close' }; // Define estado como fechado
         this.qrCodeData = { base64: '', count: 0 }; // Limpa QR
         this.emitConnectionUpdate();
         // Não remove do monitor aqui, apenas desloga
    }

    public async restart(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Reiniciando conexão Baileys.`);
        // Tentar desconectar primeiro
        this.client?.end(undefined);
        this.connectionState = { connection: 'close' };
        this.emitConnectionUpdate();
        // Aguardar um pouco e reconectar
        await delay(1000);
        await this.connectToWhatsapp();
    }

    // ** Correção Erro 85: Implementar templateMessage **
    public async templateMessage(data: SendTemplateDto): Promise<any> {
        this.logger.debug(`[${this.instanceName}] Enviando template para ${data.number}`);
        try {
            if (!this.client) throw new Error('Client not initialized');

            // Adaptar SendTemplateDto para Baileys AnyMessageContent (templateMessage)
            // Isso requer mapear os botões DTO para o formato Baileys
            // Ref: https://adiwajshing.github.io/Baileys/modules/_whiskeysockets_baileys.html#templatemessage
            const templateContent = generateWAMessageContent(
                {
                    templateMessage: proto.TemplateMessage.create({
                        hydratedTemplate: { // Ou interactiveMessage se for outro tipo de template
                            // Mapear conteúdo, rodapé, botões, etc.
                            // Exemplo MUITO simplificado:
                            hydratedContentText: data.message,
                            hydratedFooterText: data.footerText,
                            hydratedButtons: data.buttons.map(btn => this.adaptTemplateButton(btn)) as proto.IHydratedTemplateButton[]
                            // Tratar cabeçalho (image/video/document) aqui se necessário
                        }
                    })
                },
                {} // generateWAMessageContent options (pode precisar de upload de mídia se houver header)
            );


             const prep = await generateWAMessage(
                 data.number,
                 templateContent,
                 { userJid: this.client.user!.id!, quoted: data.options?.quoted }
             );

            const result = await this.relayMessage(prep);
            this.saveMessageToDb(prep, 'SENT'); // Salvar após relay
            return result;

        } catch (error: any) {
             this.logger.error(`[${this.instanceName}] Erro ao enviar template: ${error.message}`, error);
             throw error;
        }
    }

     // Helper para adaptar botão DTO para formato Baileys (precisa ser implementado)
     private adaptTemplateButton(buttonDto: TemplateButtonDto): Partial<proto.IHydratedTemplateButton> {
         // Lógica para converter QuickReplyButtonDto, UrlButtonDto, CallButtonDto
         // para proto.IHydratedTemplateButton (quickReplyButton, urlButton, callButton)
         // Exemplo:
          if (buttonDto.quickReplyButton) {
              return { index: buttonDto.index, quickReplyButton: { displayText: buttonDto.quickReplyButton.displayText, id: buttonDto.quickReplyButton.id } };
          }
          // ... outros tipos de botão ...
         return { index: buttonDto.index }; // Retorna apenas index se tipo não reconhecido/implementado
     }


    // --- Outros Métodos Públicos (Interface ChannelStartupService) ---
    // Implementar os métodos restantes da interface/classe base ChannelStartupService
    // que são específicos do Baileys


     // ... outros métodos (sendPresence, blockUser, profilePicture, etc.) ...

} // Fim da classe
