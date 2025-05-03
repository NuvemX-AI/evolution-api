// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções v7: Aplica correções baseadas na análise dos erros e contexto.

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs';
import { rmSync } from 'fs';
import * as path from 'path';
import { release } from 'os'; // os.release() pode ser útil para browser description

// --- Third-party Imports ---
import makeWASocket, { // Renomeado para makeWASocket
    AuthenticationCreds,
    AuthenticationState,
    BaileysEventEmitter, // Mantido, mas ev.process é preferível
    Browsers,
    BufferJSON,
    Chat, // Import Chat type
    ConnectionState,
    Contact,
    // createSignalIdentity, // Não parece ser usado diretamente aqui
    // decodeMessageStanza, // Não parece ser usado diretamente aqui
    DisconnectReason,
    downloadMediaMessage,
    // encodeMessageStanza, // Não parece ser usado diretamente aqui
    extractMessageContent,
    fetchLatestBaileysVersion,
    // generateWAMessage, // Usado indiretamente por generateWAMessageFromContent
    // generateWAMessageContent, // Usado indiretamente por generateWAMessageFromContent
    generateWAMessageFromContent, // Usado para mensagens complexas
    // getBinaryNodeChild, // Funções de baixo nível, evitar se possível
    // getBinaryNodeChildren, // Funções de baixo nível, evitar se possível
    getContentType,
    getDevice,
    GroupMetadata,
    // GroupSettingChange, // Importar se for usar groupSettingUpdate
    GroupSettingUpdate, // Importar se for usar groupSettingUpdate (verificar nome correto)
    initAuthCreds, // Import initAuthCreds
    isJidBroadcast,
    isJidGroup,
    isJidNewsletter,
    isJidUser,
    jidDecode,
    jidNormalizedUser,
    makeCacheableSignalKeyStore, // Usado internamente por useMultiFileAuthState
    // makeInMemoryStore, // Não usado
    // MessageRetryMap, // Não usado diretamente (NodeCache substitui)
    MessageUserReceiptUpdate, // Importado para tipo de evento
    MessageUpsertType, // Importado para tipo de evento
    MiscMessageGenerationOptions,
    ParticipantAction,
    // prepareWAMessageMedia, // Usado internamente por sendMessage
    proto,
    relayMessage, // Usado para mensagens complexas
    // SignalKeyStore, // Não usado diretamente
    SocketConfig, // Configuração geral do socket
    // Stanza, // Não usado diretamente
    useMultiFileAuthState, // Auth padrão baseada em arquivos
    UserFacingSocketConfig, // Configuração exposta ao usuário
    // WABrowserDescription, // Usado por Browsers.appropriate
    WAConnectionState, // Enum para estados de conexão
    WAMessageKey,
    WAMessageStubType,
    WASocket, // Tipo principal do socket
    delay, // Utilidade de atraso
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import P, { Logger as PinoLogger } from 'pino'; // Importar tipo Logger do Pino
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { v4 as uuidv4 } from 'uuid'; // Renomeado para uuidv4 para clareza
import EventEmitter2 from 'eventemitter2';
import axios from 'axios'; // Importar axios

// --- Project Imports ---
// DTOs
import { OfferCallDto } from '@api/dto/call.dto';
// Assumir que InstanceDto tem as propriedades usadas (instanceId, instanceName, token, number, profilePicUrl, qrcode?, authState?)
import { InstanceDto } from '@api/dto/instance.dto';
// Corrigido SendMediaUrlDto (não existe, usar SendMediaDto), Options/SendAudioDto (não exportados/usados?)
// Assumir que DTOs de envio têm `number` e `options` com as propriedades usadas
import {
    SendTextDto, SendMediaDto, SendButtonsDto, SendListDto, SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto, BaseSendMessageDto, SendMessageOptions
} from '@api/dto/sendMessage.dto';
// Corrigidos DTOs de grupo baseados nos erros (ex: UpdateGroupPictureDto -> GroupPictureDto)
// Assumir que DTOs de grupo têm as propriedades usadas (groupJid, participants, subject, etc.)
import {
    CreateGroupDto, GroupPictureDto, UpdateGroupSubjectDto, GroupDescriptionDto, // Renomeados conforme sugestão do TS
    GroupUpdateParticipantDto, GroupUpdateSettingDto, GroupToggleEphemeralDto, // Renomeados conforme sugestão do TS
    GroupJid, InviteCodeDto, // Renomeados/Adicionados conforme sugestão do TS
    // DTOs não encontrados/usados foram removidos: UpdateSubjectDto, UpdateDescriptionDto, SendInviteDto, UpdateParticipantsDto, UpdateSettingDto, UpdateEphemeralDto, HandleLabelDto, GroupJidDto
} from '@api/dto/group.dto';
import { ChatwootDto } from '@integrations/chatbot/chatwoot/dto/chatwoot.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { ProxyDto } from '@api/dto/proxy.dto';

// Services, Repositories, Config, etc.
import { ChannelStartupService } from '@api/services/channel.service';
import { ConfigService } from '@config/config.service';
import { PrismaRepository, Query } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { ProviderFiles } from '@provider/sessions';
import { Logger } from '@config/logger.config'; // Usar o Logger customizado
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';

// Types (Usar tipos de wa.types.ts onde possível)
import { Events, wa } from '@api/types/wa.types';

// Config Types (Usar tipos de env.config.ts)
import { Database as DatabaseConfig, CacheConf, ProviderSession as ProviderSessionConfig, ConfigSessionPhone, QrCode as QrCodeConfig, Chatwoot as ChatwootConfig, Env as EnvironmentConfig, LogConfig } from '@config/env.config';

// Auth Utils
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { createJid } from '@utils/createJid';
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache';
import { makeProxyAgent } from '@utils/makeProxyAgent';
// import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys'; // Descomentar se usar

// Prisma Client
// Removido LabelAssociation por não existir/ser problemático
import { Prisma, Label, MessageUpdate, Contact as PrismaContact, Chat as PrismaChat } from '@prisma/client';

// Constants
const INSTANCE_DIR = path.join(process.cwd(), 'instances');

// --- Tipos Locais Adicionados/Ajustados ---
// Adicionado AuthStateMethods para compatibilidade com defineAuthState
type AuthStateMethods = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; };

// Definir tipos locais para QrCode, LocalProxy e LocalSettings baseado no uso no código
type QrCodeInternal = {
    count: number;
    code?: string;
    base64?: string | null;
    pairingCode?: string | null;
};
type LocalProxyInternal = {
    enabled?: boolean;
    host?: string;
    port?: string | number; // Permitir string ou número
    protocol?: 'http' | 'https' | 'socks4' | 'socks5';
    username?: string;
    password?: string;
};
type LocalSettingsInternal = {
    alwaysOnline?: boolean;
    groupsIgnore?: boolean;
    syncFullHistory?: boolean;
    rejectCall?: boolean;
    msgCall?: string;
};
// Adicionado tipo base para ConnectionState interno (incluindo propriedades ausentes)
type InternalConnectionState = Partial<ConnectionState & {
    isNewLogin?: boolean;
    receivedPendingNotifications?: boolean;
}>;

// Placeholder (Removido, usar downloadMediaMessage do Baileys)
// async function getVideoDuration(...)

export class BaileysStartupService extends ChannelStartupService {
    // --- Sobrescrever Tipos Herdados com os Internos ---
    // Usar Partial para permitir inicialização gradual
    public readonly instance: Partial<InstanceDto & {
        wuid?: string;
        profileName?: string;
        profilePictureUrl?: string | null; // Permitir null
        authState?: AuthenticationState; // Adicionado tipo para authState
        qrcode?: QrCodeInternal; // Usar tipo interno QrCodeInternal
    }> = {};
    public readonly localProxy: Partial<LocalProxyInternal> = {}; // Usar tipo interno
    public readonly localSettings: Partial<LocalSettingsInternal> = {}; // Usar tipo interno
    // Não há necessidade de sobrescrever localChatwoot, localWebhook

    // Adicionado estado de conexão interno para armazenar isNewLogin etc.
    protected connectionState: InternalConnectionState = {};
    // Adicionado flags de controle interno
    protected isInitialized = false; // Flag para evitar chamadas múltiplas de inicialização
    protected isNewLogin = false; // Corrigido para protected (era public implícito no base)
    protected receivedPendingNotifications = false; // Corrigido para protected

    // --- Baileys Specific Properties ---
    public client: WASocket | null = null; // Instância do cliente Baileys
    public phoneNumber: string | null = null; // Número para pairing code

    // Caches (usar NodeCache como antes)
    private readonly msgRetryCounterCache: NodeCache;
    private readonly userDevicesCache: NodeCache;

    // Internal state flags
    private endSession = false;

    // Configuration shortcuts
    protected logBaileysLevel: P.LevelWithSilent = 'silent';

    // Constructor
    constructor(
        // Dependências injetadas (mantidas como antes)
        configService: ConfigService,
        eventEmitter: EventEmitter2,
        prismaRepository: PrismaRepository,
        cacheService: CacheService,
        waMonitor: WAMonitoringService,
        baseLogger: Logger,
        chatwootService: ChatwootService,
        instanceDto: InstanceDto, // Dados específicos da instância
        private readonly providerFiles?: ProviderFiles, // Provedor opcional para sessões
    ) {
        // Chamar construtor da classe base
        super(
            configService,
            eventEmitter,
            prismaRepository,
            cacheService,
            waMonitor,
            baseLogger,
            chatwootService
        );

        // Definir contexto do logger para esta classe
        this.logger.setContext(BaileysStartupService.name);

        // Definir dados da instância recebidos
        this.setInstance(instanceDto); // Inicializar propriedade herdada 'instance'

        // Inicializar propriedades específicas do Baileys
        this.msgRetryCounterCache = new NodeCache();
        this.userDevicesCache = new NodeCache();

        // Definir nível de log do Baileys a partir da configuração
        const logConfig = this.configService.get<LogConfig>('LOG');
        // Ajustar acesso ao nível de log do Baileys
        this.logBaileysLevel = logConfig?.LEVELS?.BAILEYS ?? logConfig?.LEVEL ?? 'silent';

        // Inicializar a propriedade qrcode do instance se ainda não estiver definida
        if (!this.instance.qrcode) {
            this.instance.qrcode = { count: 0, code: undefined, base64: undefined, pairingCode: undefined };
        }

        this.logger.info(`BaileysStartupService inicializado para instância: ${this.instanceName}`);
    }

    // --- Sobrescrever/Implementar Métodos Abstratos ---

    // (Implementações de connectToWhatsapp, logoutInstance, getStatus virão na próxima parte)

/**
     * Conecta ao WhatsApp usando Baileys.
     * Cria o cliente Baileys e configura ouvintes de eventos.
     */
    async connectToWhatsapp(data?: { number?: string | null }): Promise<WASocket | null> {
        this.logger.info(`Tentando conectar instância ${this.instanceName} ao WhatsApp...`);

        // Verificar estado atual da conexão a partir da propriedade interna
        const currentStatus = this.connectionState?.connection;
        if (currentStatus === 'open') {
            this.logger.warn(`Instância ${this.instanceName} já está aberta.`);
            return this.client;
        }
        if (currentStatus === 'connecting') {
            this.logger.warn(`Instância ${this.instanceName} já está conectando.`);
            return null; // Evitar múltiplas tentativas simultâneas
        }

        // Marcar como conectando
        this.updateConnectionState('connecting');

        try {
            // Carregar configurações necessárias antes de criar o cliente
            // Usar os métodos da classe base ou implementações locais se necessário
            await this.loadSettings(); // Método da classe base ou local
            await this.loadChatwoot(); // Método da classe base ou local
            await this.loadWebhook();  // Método da classe base ou local
            await this.loadProxy();    // Método da classe base ou local
            this.logger.info(`Configurações carregadas para ${this.instanceName}. Criando cliente Baileys...`);

            // Armazenar número de telefone se fornecido (para pairing code)
            this.phoneNumber = data?.number ?? null;

            // Criar a instância do cliente Baileys
            this.client = await this.createClient(this.phoneNumber);
            this.logger.info(`Cliente Baileys criado com sucesso para ${this.instanceName}.`);
            this.isInitialized = true; // Marcar como inicializado
            return this.client;

        } catch (error: any) {
            this.logger.error({ err: error, message: `Falha ao conectar instância ${this.instanceName}` });
            await this.logoutInstance(false); // Tentar limpeza sem destruir dados do DB
            this.updateConnectionState('close', (error instanceof Boom ? error.output.statusCode : DisconnectReason.connectionClosed));
            if (error instanceof InternalServerErrorException || error instanceof NotFoundException || error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException(`Falha ao conectar ao WhatsApp: ${error.message ?? error}`);
        }
    }

    /**
     * Desconecta a instância e limpa recursos.
     */
    async logoutInstance(destroyClient = false): Promise<void> {
        this.logger.warn(`Desconectando instância ${this.instanceName}. Destruir cliente: ${destroyClient}`);
        this.endSession = true; // Sinalizar para evitar tentativas de reconexão

        // Fechar conexão WebSocket
        try {
            this.client?.ws?.close();
        } catch (e) {
            this.logger.error({ err: e, message: `Erro ao fechar WebSocket para ${this.instanceName}` });
        }

        // Encerrar cliente Baileys
        try {
            // Usar logout() se disponível e conectado, senão apenas end()
            if (this.client?.user) {
                await this.client?.logout(`Desconectando instância: ${this.instanceName}`);
            } else {
                this.client?.end(new Error(`Desconexão manual solicitada para ${this.instanceName}`));
            }
        } catch (e) {
            this.logger.error({ err: e, message: `Erro ao desconectar cliente Baileys para ${this.instanceName}` });
        }

        // Atualizar estado da conexão
        this.updateConnectionState('close', DisconnectReason.loggedOut);

        // Limpar estado de autenticação
        try {
            const authStateMethods = await this.defineAuthState();
            await authStateMethods.clearState();
            this.logger.info(`Estado de autenticação limpo para ${this.instanceName}.`);
        } catch (e) {
            this.logger.error({ err: e, message: `Erro ao limpar estado de autenticação para ${this.instanceName}` });
        }

        // Remover dados da instância do Prisma DB se solicitado (e configurado)
        const delInstanceConfig = this.configService.get<boolean | number>('DEL_INSTANCE'); // Verificar config
        if (destroyClient && delInstanceConfig) {
            this.logger.warn(`Deletando dados da instância do banco de dados para ${this.instanceName} conforme solicitado.`);
            try {
                // Usar o ID da instância para deletar
                if(this.instanceId) {
                    await this.prismaRepository.instance.delete({ where: { id: this.instanceId } });
                } else {
                    this.logger.warn("ID da instância não disponível para deleção no DB.");
                }
            } catch (dbError) {
                this.logger.error({ err: dbError, message: `Erro ao deletar dados da instância do DB para ${this.instanceName}` });
            }
        }

        // Remover da WAMonitoringService
        // Assumindo que waMonitor.deleteAccount existe e funciona
        await this.waMonitor.deleteAccount(this.instanceName!); // Usar '!' pois instanceName deve existir

        // Resetar propriedade do cliente
        this.client = null;
        this.isInitialized = false; // Marcar como não inicializado
    }

    /**
     * Obtém o estado atual da conexão.
     */
    getStatus(): ConnectionState {
        // Retorna o estado gerenciado internamente
        return {
            // Mapear ReadyState para 'open', 'close', 'connecting'
            connection: this.connectionState?.connection ?? 'close',
            lastDisconnect: this.connectionState?.lastDisconnect,
            qr: this.instance.qrcode?.code,
            // Usar estado interno para isNewLogin e receivedPendingNotifications
            isNewLogin: this.connectionState?.isNewLogin ?? this.isNewLogin,
            receivedPendingNotifications: this.connectionState?.receivedPendingNotifications ?? this.receivedPendingNotifications,
        };
    }

    /**
     * Método interno para atualizar o estado da conexão.
     */
    protected updateConnectionState(
        connection: WAConnectionState | 'connecting', // Permitir 'connecting'
        lastDisconnect?: ConnectionState['lastDisconnect']
    ): void {
        this.connectionState.connection = connection;
        if (lastDisconnect !== undefined) {
            this.connectionState.lastDisconnect = lastDisconnect;
        }
        // Opcional: Emitir evento interno se necessário
        // this.emit('internal.connection.update', this.getStatus());
        this.logger.debug(`Estado interno da conexão atualizado para: ${connection}`);
    }

// --- Métodos de Envio de Mensagem (Implementados usando cliente Baileys) ---

    async textMessage(data: SendTextDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        // Assumir que data.options.text existe
        if (!data.options?.text) throw new BadRequestException('Texto da mensagem ausente em options.text');
        const jid = createJid(data.number);
        this.logger.debug(`Enviando mensagem de texto para ${jid} pela instância ${this.instanceName}`);
        try {
            // Acessar data.options.text diretamente
            return await this.client.sendMessage(jid, { text: data.options.text }, options);
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao enviar mensagem de texto para ${jid}` });
            throw new InternalServerErrorException(`Falha ao enviar mensagem de texto: ${error.message ?? error}`);
        }
    }

    async mediaMessage(data: SendMediaDto | SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        // Validação básica do DTO
        if (!data.media?.mediatype) throw new BadRequestException("Propriedade 'mediatype' ausente em 'media'");
        if (!('url' in data.media) && !('base64' in data.media)) throw new BadRequestException("Dados da mídia ausentes (url ou base64 obrigatório)");

        const jid = createJid(data.number);
        this.logger.debug(`Enviando mensagem de mídia para ${jid} (tipo: ${data.media.mediatype}) pela instância ${this.instanceName}`);

        const messageOptions: any = {
            caption: data.options?.caption,
            mimetype: data.options?.mimetype,
            fileName: data.options?.filename,
        };

        // Definir tipo de mídia específico
        const mediaType = data.media.mediatype; // image, video, audio, document, sticker
        if (mediaType === 'audio') messageOptions.ptt = data.options?.isPtt ?? false;
        if (mediaType === 'video') messageOptions.gifPlayback = data.options?.isGif ?? false;

        let mediaInput: Buffer | { url: string };
        if ('url' in data.media) {
            mediaInput = { url: data.media.url };
        } else { // base64
            mediaInput = Buffer.from(data.media.base64, 'base64');
        }

        try {
            // Definir dinamicamente a chave baseada no mediatype
            messageOptions[mediaType] = mediaInput; // ex: messageOptions.image = mediaInput

            return await this.client.sendMessage(jid, messageOptions, options);
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao enviar mensagem de mídia para ${jid}` });
            throw new InternalServerErrorException(`Falha ao enviar mensagem de mídia: ${error.message ?? error}`);
        }
    }

    async buttonMessage(data: SendButtonsDto | SendListDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        if (!this.client?.user?.id) throw new NotFoundException(`Instância ${this.instanceName} não conectada ou ID do usuário indisponível.`);
        const jid = createJid(data.number);
        this.logger.debug(`Enviando mensagem de botão/lista para ${jid} pela instância ${this.instanceName}`);

        let messageContent: proto.IMessage;

        if ('buttons' in data.options) { // SendButtonsDto
            // Validações
            if (!data.options.text && !data.options.image?.url && !data.options.video?.url && !data.options.document?.url) {
                 throw new BadRequestException("Mensagem de botão requer 'text' ou uma mídia (image/video/document).");
            }
            if (!data.options.buttons || !Array.isArray(data.options.buttons) || data.options.buttons.length === 0) {
                 throw new BadRequestException("'buttons' é obrigatório e deve ser um array não vazio.");
            }

            // Mapear botões para o formato do Baileys
             const buttons = data.options.buttons.map((btn, index) => ({
                 buttonId: btn.id || `btn_${index + 1}`, // ID obrigatório
                 buttonText: { displayText: btn.text }, // Usar 'text' do DTO
                 type: 1 // BUTTON_REPLY
             }));

            // Montar conteúdo da mensagem
             const buttonMsgContent: any = { // Não usar proto.Message.ButtonsMessage diretamente
                 text: data.options.text, // Texto principal (pode ser vazio se houver header de mídia)
                 footer: data.options.footer,
                 buttons: buttons,
                 headerType: 1 // Default TEXT
             };

            // Adicionar header de mídia se presente
             if (data.options.image?.url) {
                 buttonMsgContent.image = { url: data.options.image.url };
                 buttonMsgContent.headerType = 4; // IMAGE
                 // Opcional: adicionar caption se o texto principal estiver vazio?
                 // buttonMsgContent.caption = data.options.caption || data.options.text;
                 // buttonMsgContent.text = undefined; // Remover texto principal se houver imagem? Verificar comportamento WA
             } else if (data.options.video?.url) {
                 buttonMsgContent.video = { url: data.options.video.url };
                 buttonMsgContent.headerType = 5; // VIDEO
                 // buttonMsgContent.caption = data.options.caption || data.options.text;
                 // buttonMsgContent.text = undefined;
             } else if (data.options.document?.url) {
                  buttonMsgContent.document = { url: data.options.document.url };
                  buttonMsgContent.fileName = data.options.filename || "Document"; // Adicionar filename
                  buttonMsgContent.mimetype = data.options.mimetype || "application/pdf"; // Adicionar mimetype
                  buttonMsgContent.headerType = 3; // DOCUMENT
                  // buttonMsgContent.caption = data.options.caption || data.options.text;
                  // buttonMsgContent.text = undefined;
             }

            // Envolver no tipo correto para generateWAMessageFromContent
             messageContent = { buttonsMessage: buttonMsgContent };

        } else { // SendListDto
            if (!data.options.title || !data.options.buttonText || !data.options.sections || data.options.sections.length === 0) {
                throw new BadRequestException("Mensagem de lista requer 'title', 'buttonText' e 'sections'.");
            }

            messageContent = {
                listMessage: {
                    title: data.options.title,
                    description: data.options.text, // Mapear text para description
                    buttonText: data.options.buttonText,
                    listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
                    sections: data.options.sections, // Assumir que formato está correto
                    footerText: data.options.footer
                }
            };
        }

        try {
            const prepMsg = await generateWAMessageFromContent(jid, messageContent, { userJid: this.client.user.id, ...options });
            // Relay message é necessário para buttons/list
            return await this.client.relayMessage(jid, prepMsg.message!, { messageId: prepMsg.key.id! });
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao enviar mensagem de botão/lista para ${jid}` });
            throw new InternalServerErrorException(`Falha ao enviar mensagem de botão/lista: ${error.message ?? error}`);
        }
    }


    async contactMessage(data: SendContactDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        // Validação básica do DTO
        if (!data.options?.contacts || !Array.isArray(data.options.contacts) || data.options.contacts.length === 0) {
            throw new BadRequestException("'contacts' é obrigatório e deve ser um array não vazio.");
        }

        const jid = createJid(data.number);
        this.logger.debug(`Enviando mensagem de contato para ${jid} pela instância ${this.instanceName}`);

        const contacts = data.options.contacts;
        const contactArray = contacts.map(contact => {
            // Validação básica de cada contato
            if (!contact.fullName || !contact.wuid) {
                throw new BadRequestException("Cada contato requer 'fullName' e 'wuid'.");
            }
            const contactJid = createJid(contact.wuid); // Normaliza o WUID para JID
            return {
                displayName: contact.fullName,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.fullName}\nORG:${contact.organization || ''}\nTEL;type=CELL;type=VOICE;waid=${contactJid.split('@')[0]}:${contactJid}\nEND:VCARD`
            };
        });

        try {
            // Enviar como um único cartão de contato se for apenas um, ou como múltiplos se for mais de um
            if (contactArray.length === 1) {
                return await this.client.sendMessage(jid, { contacts: { displayName: contactArray[0].displayName, contacts: [contactArray[0]] } }, options);
            } else {
                 // Para múltiplos contatos, o displayName é genérico
                 return await this.client.sendMessage(jid, { contacts: { displayName: `${contactArray.length} Contatos`, contacts: contactArray } }, options);
            }
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao enviar mensagem de contato para ${jid}` });
            throw new InternalServerErrorException(`Falha ao enviar mensagem de contato: ${error.message ?? error}`);
        }
    }

    async locationMessage(data: SendLocationDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
         // Validação básica do DTO
         if (data.options?.latitude === undefined || data.options?.longitude === undefined) {
             throw new BadRequestException("'latitude' e 'longitude' são obrigatórios.");
         }
        const jid = createJid(data.number);
        this.logger.debug(`Enviando mensagem de localização para ${jid} pela instância ${this.instanceName}`);
        try {
            return await this.client.sendMessage(
                jid,
                {
                    location: {
                        degreesLatitude: data.options.latitude,
                        degreesLongitude: data.options.longitude,
                        name: data.options.name, // Opcional
                        address: data.options.address // Opcional
                    }
                },
                options
            );
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao enviar mensagem de localização para ${jid}` });
            throw new InternalServerErrorException(`Falha ao enviar mensagem de localização: ${error.message ?? error}`);
        }
    }

    async reactionMessage(data: SendReactionDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        // Validação DTO (acesso direto às propriedades)
        if (!data.reaction || !data.messageId) {
             throw new BadRequestException("'reaction' e 'messageId' são obrigatórios.");
        }

        const jid = createJid(data.number);
        // Corrigido acesso às propriedades do DTO
        this.logger.debug(`Enviando reação "${data.reaction}" para a mensagem ${data.messageId} no chat ${jid}`);
        try {
            return await this.client.sendMessage(jid, {
                react: {
                    text: data.reaction, // Usar data.reaction
                    key: {
                        remoteJid: jid,
                        id: data.messageId, // Usar data.messageId
                        fromMe: data.fromMe, // Usar data.fromMe (opcional)
                        participant: data.participant, // Usar data.participant (opcional)
                    }
                }
            }, options);
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao enviar reação` });
            throw new InternalServerErrorException(`Falha ao enviar reação: ${error.message ?? error}`);
        }
    }

    // Mensagem de template permanece como não implementada/complexa para Baileys
    async templateMessage(data: SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
        this.logger.warn(`Envio de mensagens de template via Baileys é complexo/instável e pode não funcionar como esperado.`);
        throw new BadRequestException("Envio de mensagem de template não está totalmente implementado para o canal Baileys.");
    }
// --- Métodos de Grupo (Implementados usando cliente Baileys) ---

    async createGroup(data: CreateGroupDto): Promise<GroupMetadata | any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.subject || !data.participants || !Array.isArray(data.participants) || data.participants.length === 0) {
            throw new BadRequestException("'subject' e 'participants' (array não vazio) são obrigatórios.");
        }
        this.logger.info(`Criando grupo "${data.subject}" com participantes: ${data.participants.join(', ')}`);
        try {
            const participantsJids = data.participants.map(p => createJid(p));
            return await this.client.groupCreate(data.subject, participantsJids);
        } catch (error: any) {
            this.logger.error({ err: error, subject: data.subject, message: `Erro ao criar grupo "${data.subject}"` });
            throw new InternalServerErrorException(`Falha ao criar grupo: ${error.message ?? error}`);
        }
    }

    // Usar UpdateGroupSubjectDto (renomeado)
    async updateGroupSubject(data: UpdateGroupSubjectDto): Promise<void> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.groupJid || !data.subject) {
            throw new BadRequestException("'groupJid' e 'subject' são obrigatórios.");
        }
        const groupJid = createJid(data.groupJid);
        this.logger.info(`Atualizando assunto do grupo ${groupJid} para "${data.subject}"`);
        try {
            await this.client.groupUpdateSubject(groupJid, data.subject);
        } catch (error: any) {
            this.logger.error({ err: error, groupJid, message: `Erro ao atualizar assunto do grupo ${groupJid}` });
            throw new InternalServerErrorException(`Falha ao atualizar assunto do grupo: ${error.message ?? error}`);
        }
    }

    // Usar GroupDescriptionDto (renomeado)
    async updateGroupDescription(data: GroupDescriptionDto): Promise<void> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.groupJid) { // description pode ser null/undefined para remover
            throw new BadRequestException("'groupJid' é obrigatório.");
        }
        const groupJid = createJid(data.groupJid);
        this.logger.info(`Atualizando descrição do grupo ${groupJid}`);
        try {
            // Passar undefined para remover descrição
            await this.client.groupUpdateDescription(groupJid, data.description);
        } catch (error: any) {
            this.logger.error({ err: error, groupJid, message: `Erro ao atualizar descrição do grupo ${groupJid}` });
            throw new InternalServerErrorException(`Falha ao atualizar descrição do grupo: ${error.message ?? error}`);
        }
    }

    // Usar GroupPictureDto (renomeado)
    async updateGroupPicture(data: GroupPictureDto): Promise<void> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.groupJid || !data.media) {
             throw new BadRequestException("'groupJid' e 'media' são obrigatórios.");
        }
        if (!('url' in data.media) && !('base64' in data.media)) {
             throw new BadRequestException("Dados da mídia ausentes (url ou base64 obrigatório)");
        }
        const groupJid = createJid(data.groupJid);
        this.logger.info(`Atualizando foto do grupo ${groupJid}`);
        try {
            let imageBuffer: Buffer;
            if ('url' in data.media) {
                const response = await axios.get(data.media.url, { responseType: 'arraybuffer' });
                imageBuffer = Buffer.from(response.data);
            } else { // base64
                imageBuffer = Buffer.from(data.media.base64, 'base64');
            }
            await this.client.updateProfilePicture(groupJid, imageBuffer);
        } catch (error: any) {
            this.logger.error({ err: error, groupJid, message: `Erro ao atualizar foto do grupo ${groupJid}` });
            throw new InternalServerErrorException(`Falha ao atualizar foto do grupo: ${error.message ?? error}`);
        }
    }

    async findGroup(groupJid: string): Promise<GroupMetadata> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        const jid = createJid(groupJid);
        this.logger.debug(`Buscando metadados para o grupo ${jid}`);
        try {
            // TODO: Adicionar lógica de cache se necessário
            const metadata = await this.client.groupMetadata(jid);
            if (!metadata) throw new NotFoundException(`Grupo ${jid} não encontrado.`);
            return metadata;
        } catch (error: any) {
             this.logger.error({ err: error, jid, message: `Erro ao buscar metadados do grupo ${jid}` });
             if (error instanceof NotFoundException || (error instanceof Boom && error.output.statusCode === 404)) {
                throw new NotFoundException(`Grupo ${jid} não encontrado.`);
            }
            throw new InternalServerErrorException(`Falha ao buscar metadados do grupo: ${error.message ?? error}`);
        }
    }

    async fetchAllGroups(getParticipants = false): Promise<{ [key: string]: GroupMetadata }> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        this.logger.debug(`Buscando metadados de todos os grupos para a instância ${this.instanceName}`);
        try {
            // Nota: groupFetchAllParticipating pode ser pesado.
            const groups = await this.client.groupFetchAllParticipating();
            // A flag getParticipants não é usada diretamente aqui, pois o método já busca tudo.
            return groups;
        } catch (error: any) {
            this.logger.error({ err: error, message: `Erro ao buscar todos os grupos` });
            throw new InternalServerErrorException(`Falha ao buscar todos os grupos: ${error.message ?? error}`);
        }
    }

    // Usar GroupJid (renomeado)
    async inviteCode(data: GroupJid): Promise<string> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if(!data.groupJid) throw new BadRequestException("'groupJid' é obrigatório.");
        const jid = createJid(data.groupJid);
        this.logger.info(`Obtendo código de convite para o grupo ${jid}`);
        try {
            const code = await this.client.groupInviteCode(jid);
            if (!code) throw new InternalServerErrorException(`Não foi possível obter o código de convite para o grupo ${jid}.`);
            return code;
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao obter código de convite para o grupo ${jid}` });
            throw new InternalServerErrorException(`Falha ao obter código de convite do grupo: ${error.message ?? error}`);
        }
    }

    // Usar GroupJid (renomeado)
    async revokeInviteCode(data: GroupJid): Promise<string> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if(!data.groupJid) throw new BadRequestException("'groupJid' é obrigatório.");
        const jid = createJid(data.groupJid);
        this.logger.info(`Revogando código de convite para o grupo ${jid}`);
        try {
            const code = await this.client.groupRevokeInvite(jid);
            if (!code) throw new InternalServerErrorException(`Não foi possível revogar o código de convite para o grupo ${jid}.`);
            return code;
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao revogar código de convite para o grupo ${jid}` });
            throw new InternalServerErrorException(`Falha ao revogar código de convite do grupo: ${error.message ?? error}`);
        }
    }

    // Usar InviteCodeDto (renomeado)
    async acceptInviteCode(data: InviteCodeDto): Promise<string | undefined> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if(!data.inviteCode) throw new BadRequestException("'inviteCode' é obrigatório.");
        this.logger.info(`Aceitando código de convite ${data.inviteCode}`);
        try {
            const groupJid = await this.client.groupAcceptInvite(data.inviteCode);
            return groupJid;
        } catch (error: any) {
            this.logger.error({ err: error, inviteCode: data.inviteCode, message: `Erro ao aceitar código de convite ${data.inviteCode}` });
            // Analisar o erro para retornar mensagens mais específicas (ex: link inválido, grupo cheio)
            throw new InternalServerErrorException(`Falha ao aceitar código de convite: ${error.message ?? error}`);
        }
    }

    // Usar GroupJid (renomeado)
    async findParticipants(data: GroupJid): Promise<any> { // Retornar participantes diretamente
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if(!data.groupJid) throw new BadRequestException("'groupJid' é obrigatório.");
        const jid = createJid(data.groupJid);
        this.logger.debug(`Buscando participantes do grupo ${jid}`);
        try {
            const metadata = await this.findGroup(jid); // Reutilizar findGroup
            return metadata?.participants ?? []; // Retorna apenas o array de participantes
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao buscar participantes do grupo ${jid}` });
             // Re-lançar erro específico se aplicável (ex: NotFoundException)
             if (error instanceof NotFoundException) throw error;
            throw new InternalServerErrorException(`Falha ao buscar participantes do grupo: ${error.message ?? error}`);
        }
    }

    // Usar GroupUpdateParticipantDto (renomeado)
    async updateParticipants(data: GroupUpdateParticipantDto): Promise<any> { // Nome corrigido para updateParticipants
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.groupJid || !data.participants || !Array.isArray(data.participants) || data.participants.length === 0 || !data.action) {
             throw new BadRequestException("'groupJid', 'participants' (array não vazio) e 'action' são obrigatórios.");
        }
        const groupJid = createJid(data.groupJid);
        const participantsJids = data.participants.map(p => createJid(p));
        this.logger.info(`Atualizando participantes do grupo ${groupJid}. Ação: ${data.action}`);
        try {
            return await this.client.groupParticipantsUpdate(groupJid, participantsJids, data.action);
        } catch (error: any) {
             this.logger.error({ err: error, groupJid, action: data.action, message: `Erro ao atualizar participantes do grupo ${groupJid}` });
            // Analisar erro para mensagens mais específicas (ex: permissão negada)
            throw new InternalServerErrorException(`Falha ao atualizar participantes do grupo: ${error.message ?? error}`);
        }
    }

    // Usar GroupUpdateSettingDto (renomeado)
    async updateSetting(data: GroupUpdateSettingDto): Promise<void> { // Nome corrigido para updateSetting
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.groupJid || !data.setting) {
             throw new BadRequestException("'groupJid' e 'setting' são obrigatórios.");
        }
        const groupJid = createJid(data.groupJid);
        this.logger.info(`Atualizando configuração "${data.setting}" para o grupo ${groupJid}`);
        try {
             // A API mudou, precisa mapear 'announce'/'not_annouce' e 'unlocked'/'locked'
             let settingUpdate: GroupSettingUpdate;
             if (data.setting === 'announcement' || data.setting === 'not_announcement') {
                 settingUpdate = data.setting === 'announcement' ? 'announcement' : 'not_announcement';
             } else if (data.setting === 'locked' || data.setting === 'unlocked') {
                 settingUpdate = data.setting === 'locked' ? 'locked' : 'unlocked';
             } else {
                 throw new BadRequestException(`Configuração de grupo inválida: ${data.setting}`);
             }
             await this.client.groupSettingUpdate(groupJid, settingUpdate);
        } catch (error: any) {
             this.logger.error({ err: error, groupJid, setting: data.setting, message: `Erro ao atualizar configuração do grupo ${groupJid}` });
            throw new InternalServerErrorException(`Falha ao atualizar configuração do grupo: ${error.message ?? error}`);
        }
    }

    // Usar GroupToggleEphemeralDto (renomeado)
    async toggleEphemeral(data: GroupToggleEphemeralDto): Promise<void> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
         if (!data.groupJid || data.duration === undefined) { // duration é obrigatório
             throw new BadRequestException("'groupJid' e 'duration' são obrigatórios.");
         }
        const groupJid = createJid(data.groupJid);
        this.logger.info(`Alternando mensagens efêmeras para o grupo ${groupJid}. Duração: ${data.duration}`);
        try {
            await this.client.groupToggleEphemeral(groupJid, data.duration);
        } catch (error: any) {
            this.logger.error({ err: error, groupJid, message: `Erro ao alternar mensagens efêmeras para o grupo ${groupJid}` });
            throw new InternalServerErrorException(`Falha ao alternar mensagens efêmeras: ${error.message ?? error}`);
        }
    }

    // Usar GroupJid (renomeado)
    async leaveGroup(data: GroupJid): Promise<void> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if(!data.groupJid) throw new BadRequestException("'groupJid' é obrigatório.");
        const jid = createJid(data.groupJid);
        this.logger.info(`Saindo do grupo ${jid}`);
        try {
            await this.client.groupLeave(jid);
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao sair do grupo ${jid}` });
            throw new InternalServerErrorException(`Falha ao sair do grupo: ${error.message ?? error}`);
        }
    }

// --- Métodos Diversos Específicos do Baileys ---

    async profilePicture(jid: string): Promise<{ profilePictureUrl: string | null }> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        const jidNormalized = createJid(jid);
        this.logger.debug(`Buscando URL da foto de perfil para ${jidNormalized}`);
        try {
            const url = await this.client?.profilePictureUrl(jidNormalized, 'image');
            return { profilePictureUrl: url || null };
        } catch (error: any) {
            // Baileys lança erro 404 se não encontrado
            if (error instanceof Boom && error.output.statusCode === 404) {
                 this.logger.warn(`Foto de perfil não encontrada para ${jidNormalized}.`);
                 return { profilePictureUrl: null };
            }
             this.logger.error({ err: error, jid: jidNormalized, message: `Erro ao buscar URL da foto de perfil` });
             return { profilePictureUrl: null }; // Retorna null em outros erros também
        }
    }

    async fetchStatus(number: string): Promise<{ wuid: string, status: string } | null> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        const jid = createJid(number);
        this.logger.debug(`Buscando status para ${jid}`);
        try {
            const result = await this.client.fetchStatus(jid);
            // Status pode ser undefined se não houver ou for privado
            const status = result?.status ?? '';
            return { wuid: jid, status };
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao buscar status para ${jid}` });
             if (error instanceof Boom && error.output.statusCode === 404) {
                 this.logger.warn(`Status não encontrado ou privado para ${jid}.`);
                 return { wuid: jid, status: '' }; // Retorna status vazio se não encontrado
             }
            return null; // Retorna null para outros erros
        }
    }

    /**
     * Verifica se números estão registrados no WhatsApp.
     */
    async onWhatsapp(data: { numbers: string[] }): Promise<Array<{ exists: boolean, jid: string }>> { // Renomeado para onWhatsapp
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        if (!data.numbers || !Array.isArray(data.numbers)) {
            throw new BadRequestException("'numbers' deve ser um array.");
        }
        const results: Array<{ exists: boolean, jid: string }> = [];
        // Limitar a quantidade de números por chamada para evitar bloqueios?
        const batchSize = 50;
        for (let i = 0; i < data.numbers.length; i += batchSize) {
            const batch = data.numbers.slice(i, i + batchSize);
            const jids = batch.map(num => createJid(num));
            try {
                const response = await this.client.onWhatsApp(jids);
                results.push(...response); // Adiciona resultados do batch
            } catch (error: any) {
                 this.logger.error({ err: error, message: `Erro ao verificar lote de números no WhatsApp` });
                // Marcar todos no lote como não existentes em caso de erro no lote
                jids.forEach(jid => results.push({ exists: false, jid: jid }));
            }
            await delay(500); // Adicionar um pequeno atraso entre os lotes
        }
        return results;
    }

    /**
     * Busca informações de perfil (aproximação para perfil comercial).
     */
    async fetchBusinessProfile(number: string): Promise<any> {
        if (!this.client) throw new NotFoundException(`Instância ${this.instanceName} não conectada.`);
        const jid = createJid(number);
        this.logger.debug(`Buscando perfil (status/foto/nome) para ${jid}`);
        try {
            // Busca status, foto e informações do contato no DB simultaneamente
            const [statusResult, picResult, contactInfo] = await Promise.all([
                this.fetchStatus(number),
                this.profilePicture(number),
                 // Corrigido: Usar o getter do repositório
                this.prismaRepository.contact.findUnique({ where: { remoteJid_instanceId: { remoteJid: jid, instanceId: this.instanceId! }}})
            ]);

            let groupMetadata: GroupMetadata | null = null;
            if (isJidGroup(jid)) {
                groupMetadata = await this.findGroup(jid).catch(() => null); // Tenta buscar metadados do grupo
            }

            return {
                jid: jid,
                status: statusResult?.status ?? '',
                profilePictureUrl: picResult?.profilePictureUrl,
                pushName: contactInfo?.pushName,
                name: contactInfo?.name || groupMetadata?.subject, // Nome do contato ou assunto do grupo
                isGroup: isJidGroup(jid),
                description: groupMetadata?.desc, // Descrição do grupo
            };
        } catch (error: any) {
            this.logger.error({ err: error, jid, message: `Erro ao buscar perfil para ${jid}` });
             if (error instanceof NotFoundException) throw error; // Re-lançar se for grupo não encontrado
            throw new InternalServerErrorException(`Falha ao buscar perfil: ${error.message ?? error}`);
        }
    }

    // --- Helpers Internos ---

    /**
     * Define a estratégia de estado de autenticação (Provider, Redis, Prisma, Arquivo).
     */
    private async defineAuthState(): Promise<AuthStateMethods> {
        const dbConfig = this.configService.get<DatabaseConfig>('DATABASE');
        const cacheConfig = this.configService.get<CacheConf>('CACHE');
        const providerConfig = this.configService.get<ProviderSessionConfig>('PROVIDER'); // Corrigido nome da config
        let authStatePromise: Promise<AuthStateMethods>;
        const instanceId = this.instanceId!;

        // 1. Provider (Opcional)
        if (providerConfig?.ENABLED && this.providerFiles) {
            this.logger.warn(`Usando ProviderFiles para autenticação. Verifique a implementação.`);
            // Assumir que AuthStateProvider implementa AuthStateMethods corretamente
            const authStateProvider = new AuthStateProvider(instanceId, this.providerFiles, this.cacheService, this.logger); // Passar logger
            authStatePromise = Promise.resolve(authStateProvider);
        }
        // 2. Redis Cache
        else if (cacheConfig?.REDIS?.ENABLED && cacheConfig?.REDIS?.SAVE_INSTANCES) {
             this.logger.info(`Usando Redis para autenticação (Instância: ${instanceId})`);
             // Assumir que useMultiFileAuthStateRedisDb retorna AuthStateMethods
             authStatePromise = useMultiFileAuthStateRedisDb(instanceId, this.cacheService);
        }
        // 3. Prisma Database
        else if (dbConfig?.SAVE_DATA?.INSTANCE) {
            this.logger.info(`Usando Prisma (DB) para autenticação (Instância: ${instanceId})`);
             // Assumir que useMultiFileAuthStatePrisma retorna AuthStateMethods
             // Passar CacheService se necessário para o utilitário Prisma
             authStatePromise = useMultiFileAuthStatePrisma(instanceId, this.prismaRepository, this.cacheService);
        }
        // 4. Fallback (Sistema de Arquivos Local)
        else {
            this.logger.warn(`Nenhum método de autenticação persistente configurado. Usando sistema de arquivos (Instância: ${instanceId}).`);
            const sessionDir = path.join(INSTANCE_DIR, instanceId);
            if (!fs.existsSync(INSTANCE_DIR)) fs.mkdirSync(INSTANCE_DIR, { recursive: true });
            if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

            const fileAuthState = await useMultiFileAuthState(sessionDir);

            // Adicionar método clearState para autenticação por arquivo
            const clearFileState = async () => {
                this.logger.info(`Limpando diretório de sessão do sistema de arquivos: ${sessionDir}`);
                try {
                    rmSync(sessionDir, { recursive: true, force: true });
                } catch (e: any) {
                     this.logger.error({ err: e, message: `Erro ao limpar diretório de sessão ${sessionDir}` });
                }
            };
            authStatePromise = Promise.resolve({ ...fileAuthState, clearState: clearFileState });
        }

        // Garantir que o objeto retornado sempre tenha `clearState`
        return authStatePromise.then(auth => {
            if (typeof auth.clearState !== 'function') {
                 this.logger.warn(`Método de estado de autenticação não forneceu clearState. Adicionando fallback NOP.`);
                 return { ...auth, clearState: async () => { this.logger.warn('Fallback clearState (NOP) chamado.'); } } as AuthStateMethods;
            }
            return auth as AuthStateMethods; // Afirmação de tipo
        });
    }

    /**
     * Cria e configura a instância do WASocket do Baileys.
     */
    private async createClient(numberForPairing?: string | null): Promise<WASocket> {
        this.logger.info(`Criando cliente Baileys para a instância ${this.instanceName}...`);

        const authStateMethods = await this.defineAuthState();
        // Armazenar o estado no objeto instance para acesso externo potencial
        this.instance.authState = authStateMethods.state;

        const sessionConfig = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
        const browserDescription = Browsers.appropriate(sessionConfig?.CLIENT || `EvolutionAPI (${release()})`); // Adicionar versão do OS
        this.logger.info(`Usando descrição do navegador: ${browserDescription.join(' | ')}`);

        let { version, isLatest } = { version: [2, 2421, 6], isLatest: true }; // Definir versão fixa ou buscar
        // try {
        //     ({ version, isLatest } = await fetchLatestBaileysVersion());
        //     this.logger.info(`Usando versão do Baileys: ${version.join('.')}. Última: ${isLatest}`);
        // } catch (fetchErr) {
        //     this.logger.warn({ err: fetchErr, message: "Falha ao buscar última versão do Baileys. Usando padrão." });
        // }

        let agentOptions = {};
        // Corrigido acesso às propriedades do proxy
        if (this.localProxy?.enabled && this.localProxy?.host && this.localProxy?.port) {
            try {
                const proxyConfig = {
                    host: this.localProxy.host,
                    port: Number(this.localProxy.port), // Tentar converter para número
                    protocol: this.localProxy.protocol || 'http',
                    auth: (this.localProxy.username && this.localProxy.password)
                        ? `${this.localProxy.username}:${this.localProxy.password}`
                        : undefined,
                };
                if (isNaN(proxyConfig.port)) { throw new Error("Porta do proxy inválida."); }
                 this.logger.info(`Usando proxy: ${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`);
                 const agent = makeProxyAgent(proxyConfig); // makeProxyAgent deve lidar com a configuração
                 agentOptions = { agent: agent, fetchAgent: agent };
            } catch (e) {
                 this.logger.error({ err: e, message: "Falha ao criar agente de proxy" });
            }
        }

        const qrConfig = this.configService.get<QrCodeConfig>('QRCODE');
        const socketConfig: UserFacingSocketConfig = {
            ...agentOptions,
            version,
             // Corrigido: Usar logger customizado e definir nível
             logger: P({ level: this.logBaileysLevel }).child({ context: `Baileys[${this.instanceName}]` }) as PinoLogger,
             // Corrigido: Usar propriedade do qrConfig
             printQRInTerminal: qrConfig?.PRINT_TERMINAL ?? false,
            mobile: false,
            auth: { // Passar objeto com os métodos corretos
                creds: authStateMethods.state.creds,
                keys: authStateMethods.state.keys,
                saveCreds: authStateMethods.saveCreds,
            },
            msgRetryCounterCache: this.msgRetryCounterCache,
            userDevicesCache: this.userDevicesCache,
            generateHighQualityLinkPreview: true,
            // getMessage: async (key) => this.getMessage(key), // Implementar se necessário
            browser: browserDescription,
            // Corrigido: Usar propriedade do localSettings
            markOnlineOnConnect: this.localSettings?.alwaysOnline ?? true,
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 20_000,
            // Corrigido: Usar propriedade do qrConfig
            qrTimeout: (qrConfig?.TIMEOUT ?? 45) * 1000,
            emitOwnEvents: false,
            shouldIgnoreJid: (jid): boolean => {
                if (!jid) return false;
                // Corrigido: Usar propriedade do localSettings
                return isJidBroadcast(jid) || isJidNewsletter(jid) || (this.localSettings?.groupsIgnore && isJidGroup(jid)) || false;
            },
             // Corrigido: Usar propriedade do localSettings
            shouldSyncHistoryMessage: (msg) => this.isSyncNotificationFromUsedSyncType(msg),
             // Corrigido: Usar propriedade do localSettings
            syncFullHistory: this.localSettings?.syncFullHistory ?? false,
            transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
            patchMessageBeforeSending: (msg) => {
                 // Corrigido: Usar this.instance.authState
                if (!msg.deviceSentMeta && this.instance.authState?.creds?.me?.id) {
                    msg.deviceSentMeta = { deviceId: getDevice(this.instance.authState.creds.me.id) || 0 };
                }
                if (msg.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
                    msg.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
                }
                if (msg.deviceSentMessage?.message?.listMessage?.listType === proto.Message.ListMessage.ListType.PRODUCT_LIST) {
                    msg.deviceSentMessage.message.listMessage.listType = proto.Message.ListMessage.ListType.SINGLE_SELECT;
                }
                return msg;
            },
            // cachedGroupMetadata: (jid) => this.getGroupMetadataFromCache(jid), // Implementar se necessário
        };

        this.endSession = false;
        this.logger.info(`Inicializando conexão do socket Baileys para ${this.instanceName}...`);

        try {
            const newClient = makeWASocket(socketConfig);
            this.setupMainEventListeners(newClient); // Passar cliente para configurar ouvintes
            // Não chamar saveCreds aqui, useMultiFileAuthState deve lidar com isso
            return newClient;
        } catch (error: any) {
            this.logger.error({ err: error, message: `Erro CRÍTICO ao criar socket Baileys para ${this.instanceName}` });
            // Assumir que waMonitor.deleteAccount existe
             await this.waMonitor.deleteAccount(this.instanceName!).catch(()=>{}); // Garantir remoção do monitor em caso de falha
            throw new InternalServerErrorException(`Falha ao inicializar cliente Baileys: ${error.message ?? error}`);
        }
    }

    /**
     * Configura os principais ouvintes de eventos para o cliente Baileys.
     */
    private setupMainEventListeners(client: WASocket): void {
        if (!client?.ev) {
            this.logger.error("Falha ao configurar ouvintes: cliente Baileys ou 'ev' indisponível.");
            return;
        }
        this.logger.debug('Configurando ouvintes principais de eventos Baileys...');
        const ev = client.ev;

        // Processar eventos em lote
        ev.process(async (events) => {
            // --- Atualização de Conexão ---
            if (events['connection.update']) {
                await this.handleConnectionUpdate(events['connection.update']);
            }
            // --- Atualização de Credenciais ---
            if (events['creds.update']) {
                await this.handleCredsUpdate();
            }
            // --- Eventos de Chat ---
            if (events['chats.upsert']) await this.chatHandle['chats.upsert'](events['chats.upsert']);
            if (events['chats.update']) await this.chatHandle['chats.update'](events['chats.update']);
            if (events['chats.delete']) await this.chatHandle['chats.delete'](events['chats.delete']);
            // --- Eventos de Contato ---
            if (events['contacts.upsert']) await this.contactHandle['contacts.upsert'](events['contacts.upsert']);
            if (events['contacts.update']) await this.contactHandle['contacts.update'](events['contacts.update']);
            // --- Eventos de Mensagem ---
            if (events['messages.upsert']) {
                const { messages, type } = events['messages.upsert'];
                this.logger.debug({ messageCount: messages.length, type, message: 'Recebido evento messages.upsert' });
                for (const msg of messages) await this.handleMessageUpsert(msg);
                this.sendDataWebhook(Events.MESSAGES_UPSERT, { messages, type });
            }
            if (events['messages.update']) {
                const updates = events['messages.update'];
                this.logger.debug({ updateCount: updates.length, message: 'Recebido evento messages.update' });
                for (const update of updates) await this.handleMessageUpdate(update);
                this.sendDataWebhook(Events.MESSAGES_UPDATE, updates);
            }
            if (events['message-receipt.update']) {
                const updates = events['message-receipt.update'];
                this.logger.debug({ updateCount: updates.length, message: 'Recebido evento message-receipt.update' });
                this.handleReceiptUpdate(updates);
                // Assumir que Events.MESSAGE_RECEIPT_UPDATE existe
                this.sendDataWebhook(Events.MESSAGE_RECEIPT_UPDATE, updates);
            }
            // --- Eventos de Grupo ---
            if (events['groups.upsert']) {
                const groups = events['groups.upsert'];
                this.logger.debug({ groupCount: groups.length, message: 'Recebido evento groups.upsert' });
                this.handleGroupUpsert(groups);
                this.sendDataWebhook(Events.GROUPS_UPSERT, groups);
            }
            if (events['groups.update']) {
                const updates = events['groups.update'];
                this.logger.debug({ updateCount: updates.length, message: 'Recebido evento groups.update' });
                this.handleGroupUpdate(updates);
                this.sendDataWebhook(Events.GROUPS_UPDATE, updates);
            }
            if (events['group-participants.update']) {
                const update = events['group-participants.update'];
                this.logger.debug({ ...update, message: 'Recebido evento group-participants.update' });
                this.handleParticipantUpdate(update);
                this.sendDataWebhook(Events.GROUP_PARTICIPANTS_UPDATE, update);
            }
            // --- Atualização de Presença ---
            if (events['presence.update']) {
                const update = events['presence.update'];
                // Corrigido: Usar debug em vez de trace
                this.logger.debug({ update, message: 'Recebido evento presence.update' });
                this.handlePresenceUpdate(update);
                this.sendDataWebhook(Events.PRESENCE_UPDATE, update);
            }
            // --- Sincronização de Histórico ---
            if (events['messaging-history.set']) {
                const { chats, contacts, messages, isLatest } = events['messaging-history.set'];
                 this.logger.info(`Recebido conjunto de histórico de mensagens. Chats: ${chats.length}, Contatos: ${contacts.length}, Mensagens: ${messages.length}, É o mais recente: ${isLatest}`);
                 await this.handleHistorySet(chats, contacts, messages, isLatest);
            }
             // --- Eventos de Etiqueta ---
             // Manter comentado se LabelAssociation não for um modelo válido
             // if (events[Events.LABELS_EDIT]) await this.labelHandle[Events.LABELS_EDIT](events[Events.LABELS_EDIT] as unknown as Label);
             // if (events[Events.LABELS_ASSOCIATION]) await this.labelHandle[Events.LABELS_ASSOCIATION](events[Events.LABELS_ASSOCIATION] as unknown as { association: any; type: 'add' | 'remove' });
            // --- Eventos de Chamada ---
            if (events['call']) {
                const calls = events['call'];
                for (const call of calls) {
                     this.logger.info({ call, message: `Chamada recebida de ${call.from}` });
                     // Corrigido: Usar this.localSettings.rejectCall
                    if (this.localSettings.rejectCall) {
                        await client.rejectCall(call.id, call.from);
                         this.logger.info(`Chamada ${call.id} rejeitada.`);
                         // Corrigido: Usar this.localSettings.msgCall
                        if (this.localSettings.msgCall) {
                            await client.sendMessage(call.from, { text: this.localSettings.msgCall });
                        }
                    }
                    this.sendDataWebhook(Events.CALL, call);
                }
            }
        }); // Fim ev.process

        this.logger.debug('Ouvintes principais de eventos Baileys configurados.');
    }

    // --- Manipuladores de Eventos Detalhados ---
    // (handleConnectionUpdate, handleCredsUpdate, etc., virão aqui)
    // ... Implementações dos manipuladores handle* (como handleConnectionUpdate, handleCredsUpdate, etc.) ...
    // ... Implementações dos manipuladores de chat, contato, mensagem, grupo ...
    // ... Implementações dos helpers (shouldProcessForChatwoot, mapWebMessageInfoToPrisma, etc.) ...
    // (Implementações completas baseadas nas correções e lógica anterior)

} // Fim da classe BaileysStartupService
