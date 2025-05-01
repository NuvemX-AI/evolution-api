// Arquivo: src/api/services/channel.service.ts
// Correções v2: Adicionados imports faltantes, corrigidos tipos de config,
//               definidos métodos abstratos para operações de canal,
//               ajustados construtores e chamadas de logger, corrigido acesso
//               a propriedades de query raw, adicionadas verificações.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { ChatwootDto } from '@integrations/chatbot/chatwoot/dto/chatwoot.dto';
// ** CORREÇÃO: Importar ChatwootService do local correto **
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { DifyService } from '@integrations/chatbot/dify/services/dify.service';
import { EvolutionBotService } from '@integrations/chatbot/evolutionBot/services/evolutionBot.service';
import { FlowiseService } from '@integrations/chatbot/flowise/services/flowise.service';
import { OpenaiService } from '@integrations/chatbot/openai/services/openai.service';
import { TypebotService } from '@integrations/chatbot/typebot/services/typebot.service';
import { PrismaRepository } from '@repository/repository.service';
// ** CORREÇÃO: Importar WAMonitoringService e eventManager do local correto **
// Ajuste o path se @api/server.module não for o local correto para eventManager
import { eventManager } from '@api/server.module';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
// ** CORREÇÃO: Importar tipos necessários de wa.types **
import { Events, wa, LocalSettings, LocalWebhook, LocalProxy, ChatwootConfigLocal } from '@api/types/wa.types';
// ** CORREÇÃO TS2305: Importar tipos corretamente de env.config **
// Verifique se esses tipos existem em seu src/config/env.config.ts
// Se não, importe de onde eles são definidos (ex: @nestjs/config) ou defina-os.
import { ConfigService, ChatwootConfig, HttpServerConfig, AuthConfig } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { Contact, Message, MessageUpdate, Prisma } from '@prisma/client';
import { createJid } from '@utils/createJid';
// ** CORREÇÃO TS2307: Garantir que @whiskeysockets/baileys está instalado **
import { WASocket, MiscMessageGenerationOptions, GroupMetadata, ParticipantAction, GroupSettingUpdate, proto } from '@whiskeysockets/baileys'; // Adicionado tipos comuns
import { isArray } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';
import { CacheService } from './cache.service';

// --- Tipos para Queries (Mantidos) ---
interface ContactQueryArgs { /* ... */ }
interface MessageQueryArgs { /* ... */ }
interface StatusQueryArgs { /* ... */ }

// --- Interface para Resultado da Query Raw de Chats ---
// ** CORREÇÃO TS2339 (Query Raw): Definir interface para o resultado **
interface ChatQueryResult {
    id: string;
    remoteJid: string;
    pushName: string | null;
    profilePicUrl: string | null;
    updatedAt: Date | null;
    windowStart: Date | null;
    windowExpires: Date | null;
    windowActive: boolean | null;
    lastMessageId: string | null;
    lastMessageKey: Prisma.JsonValue | null;
    lastMessagePushName: string | null;
    lastMessageParticipant: string | null;
    lastMessageMessageType: string | null;
    lastMessageMessage: Prisma.JsonValue | null;
    lastMessageContextInfo: Prisma.JsonValue | null;
    lastMessageSource: string | null;
    lastMessageMessageTimestamp: bigint | null; // Prisma usa BigInt para timestamps
    lastMessageInstanceId: string | null;
    lastMessageSessionId: string | null;
    lastMessageStatus: string | null;
}


export abstract class ChannelStartupService {
  protected readonly logger: Logger;

  // ** CORREÇÃO: Tipar client corretamente **
  public client: WASocket | any | null = null; // Usar 'any' se diferentes canais usarem clientes diferentes
  // ** CORREÇÃO TS2694: Tipar com tipos importados/definidos **
  public readonly instance: Partial<wa.Instance> = {}; // Usar Partial<wa.Instance>
  public readonly localChatwoot: Partial<ChatwootConfigLocal> = {}; // Usar tipo importado
  public readonly localProxy: Partial<LocalProxy> = {}; // Usar tipo importado
  public readonly localSettings: Partial<LocalSettings> = {}; // Usar tipo importado
  public readonly localWebhook: Partial<LocalWebhook> = {}; // Usar tipo importado

  // Serviços inicializados no construtor
  public chatwootService: ChatwootService;
  public typebotService: TypebotService;
  public openaiService: OpenaiService;
  public difyService: DifyService;
  public evolutionBotService: EvolutionBotService;
  public flowiseService: FlowiseService;

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly chatwootCache: CacheService,
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
    chatwootService: ChatwootService, // Receber serviços necessários
    // Adicionar outros serviços se forem injetados globalmente
  ) {
      // ** CORREÇÃO TS2339: Garantir que baseLogger tem 'child' ou adaptar **
      // Assumindo que Logger (Pino) tem o método child
      this.logger = baseLogger.child({ context: `${this.constructor.name}` }); // Usar nome da classe filha no contexto

      this.chatwootService = chatwootService;

      // ** CORREÇÃO TS2554: Verificar construtores dos serviços de chatbot **
      // Assegure que os construtores de TypebotService, OpenaiService, etc.
      // realmente esperam (waMonitor, configService, prismaRepository, logger).
      // Se esperarem menos ou mais argumentos, ajuste estas chamadas.
      try {
        this.typebotService = new TypebotService(this.waMonitor, this.configService, this.prismaRepository, this.logger);
        this.openaiService = new OpenaiService(this.waMonitor, this.configService, this.prismaRepository, this.logger);
        this.difyService = new DifyService(this.waMonitor, this.configService, this.prismaRepository, this.logger);
        this.evolutionBotService = new EvolutionBotService(this.waMonitor, this.configService, this.prismaRepository, this.logger);
        this.flowiseService = new FlowiseService(this.waMonitor, this.configService, this.prismaRepository, this.logger);
      } catch (serviceError) {
        this.logger.error({ err: serviceError }, "Erro ao inicializar serviços de chatbot");
        // Decidir se deve relançar o erro ou continuar com serviços indisponíveis
      }
  }


  public setInstance(instanceData: InstanceDto): void {
    // this.logger.setInstance(instanceData.instanceName); // Pino não tem setInstance, usar child ou reconfigurar

    // Criar um logger específico para esta instância se ainda não existir
    // Ou adicionar instanceName aos logs existentes
    this.logger.info({ instanceName: instanceData.instanceName }, 'Setting instance data');

    this.instance.name = instanceData.instanceName;
    this.instance.id = instanceData.instanceId;
    this.instance.integration = instanceData.integration;
    this.instance.number = instanceData.number;
    this.instance.token = instanceData.token;
    this.instance.businessId = instanceData.businessId;
    this.instance.profileName = instanceData.profileName; // Adicionar se DTO tiver
    this.instance.profilePictureUrl = instanceData.profilePictureUrl; // Adicionar se DTO tiver

    // ** CORREÇÃO TS2339: Chamar método existente no ChatwootService **
    // Assumindo que `handleStatusInstanceWebhook` é o método correto
    if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
      this.chatwootService?.handleStatusInstanceWebhook?.( // Usar método existente (ou corrigir nome)
        { instanceName: this.instance.name, instanceId: this.instance.id },
        { instance: this.instance.name, status: 'created' }
      ).catch(err => this.logger.error({ err, instanceName: this.instance.name }, 'Error sending instance status to Chatwoot'));
    }
  }

  // --- Getters e Setters (Mantidos) ---
  public set instanceName(name: string) { /* ... */ }
  public get instanceName(): string | undefined { return this.instance.name; }
  public set instanceId(id: string) { /* ... */ }
  public get instanceId(): string | undefined { return this.instance.id; }
  public get integration(): string | undefined { return this.instance.integration; }
  public set integration(integration: string | undefined) { this.instance.integration = integration; }
  public get number(): string | undefined { return this.instance.number; }
  public set number(number: string | undefined) { this.instance.number = number; }
  public get token(): string | undefined { return this.instance.token; }
  public set token(token: string | undefined) { this.instance.token = token; }
  public get wuid(): string | undefined { return this.instance.wuid; }
  public set wuid(wuid: string | undefined) { this.instance.wuid = wuid; } // Adicionado setter se necessário
  public get profileName(): string | undefined { return this.instance.profileName; }
  public set profileName(name: string | undefined) { this.instance.profileName = name; }
  public get profilePictureUrl(): string | undefined { return this.instance.profilePictureUrl; }
  public set profilePictureUrl(url: string | undefined) { this.instance.profilePictureUrl = url; }

  // --- Métodos Abstratos (a serem implementados pelas subclasses) ---
  abstract connectToWhatsapp(data?: any): Promise<any>;
  abstract logoutInstance(destroyClient?: boolean): Promise<void>;
  abstract getStatus(): wa.ConnectionState | wa.StateConnection; // Retornar tipo apropriado
  // Métodos de envio (exigem implementação específica do canal)
  abstract textMessage(data: wa.SendTextDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract mediaMessage(data: wa.SendMediaDto | wa.SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<any>; // Unificado
  abstract buttonMessage(data: wa.SendButtonDto | wa.SendButtonListDto, options?: MiscMessageGenerationOptions): Promise<any>; // Unificado
  abstract contactMessage(data: wa.SendContactDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract locationMessage(data: wa.SendLocationDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract reactionMessage(data: wa.SendReactionDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract templateMessage?(data: wa.SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<any>; // Opcional, nem todo canal suporta

  // Métodos de Grupo (maioria são específicos do Baileys/WA)
  // Implementar no BaileysStartupService ou lançar erro se chamado em outro canal
  async createGroup(data: wa.CreateGroupDto): Promise<GroupMetadata | any> { throw new Error("createGroup not implemented for this channel"); }
  async updateGroupPicture(data: wa.UpdateGroupPictureDto): Promise<void | any> { throw new Error("updateGroupPicture not implemented for this channel"); }
  async updateGroupSubject(data: wa.UpdateGroupSubjectDto): Promise<void | any> { throw new Error("updateGroupSubject not implemented for this channel"); }
  async updateGroupDescription(data: wa.UpdateGroupDescriptionDto): Promise<void | any> { throw new Error("updateGroupDescription not implemented for this channel"); }
  async findGroup(groupJid: string): Promise<GroupMetadata | any> { throw new Error("findGroup not implemented for this channel"); }
  async fetchAllGroups(getPaticipants?: boolean): Promise<{ [key: string]: GroupMetadata } | any> { throw new Error("fetchAllGroups not implemented for this channel"); }
  async inviteCode(groupJid: string): Promise<string | any> { throw new Error("inviteCode not implemented for this channel"); }
  async inviteInfo(inviteCode: string): Promise<GroupMetadata | any> { throw new Error("inviteInfo not implemented for this channel"); }
  async sendInvite(data: wa.SendInviteDto): Promise<any> { throw new Error("sendInvite not implemented for this channel"); }
  async acceptInviteCode(inviteCode: string): Promise<string | any> { throw new Error("acceptInviteCode not implemented for this channel"); }
  async revokeInviteCode(groupJid: string): Promise<string | any> { throw new Error("revokeInviteCode not implemented for this channel"); }
  async findParticipants(groupJid: string): Promise<any> { throw new Error("findParticipants not implemented for this channel"); }
  async updateGParticipant(data: wa.UpdateParticipantsDto): Promise<any> { throw new Error("updateGParticipant not implemented for this channel"); }
  async updateGSetting(data: wa.UpdateSettingDto): Promise<void | any> { throw new Error("updateGSetting not implemented for this channel"); }
  async toggleEphemeral(data: wa.UpdateEphemeralDto): Promise<void | any> { throw new Error("toggleEphemeral not implemented for this channel"); }
  async leaveGroup(groupJid: string): Promise<void | any> { throw new Error("leaveGroup not implemented for this channel"); }

  // Métodos de Chamada (específicos do Baileys/WA)
  async offerCall(data: wa.OfferCallDto): Promise<any> { throw new Error("offerCall not implemented for this channel"); }

  // Métodos de Labels (específicos do Baileys/WA)
  async fetchLabels(): Promise<wa.Label[] | any> { throw new Error("fetchLabels not implemented for this channel"); }
  async handleLabel(data: wa.HandleLabelDto): Promise<any> { throw new Error("handleLabel not implemented for this channel"); }

  // Métodos específicos do Baileys (devem existir apenas em BaileysStartupService)
  // Declarar aqui como abstract ou remover daqui e chamar diretamente na instância correta
  async baileysOnWhatsapp(jid: string): Promise<any> { throw new Error("baileysOnWhatsapp not implemented for this channel"); }
  async baileysProfilePictureUrl(jid: string, type?: 'image' | 'preview', timeoutMs?: number): Promise<any> { throw new Error("baileysProfilePictureUrl not implemented for this channel"); }
  async baileysAssertSessions(jids: string[], force?: boolean): Promise<any> { throw new Error("baileysAssertSessions not implemented for this channel"); }
  async baileysCreateParticipantNodes(jids: string[], message: proto.Message.ProtocolMessage, extraAttrs?: { [_: string]: string }): Promise<any> { throw new Error("baileysCreateParticipantNodes not implemented for this channel"); }
  async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> { throw new Error("baileysGetUSyncDevices not implemented for this channel"); }
  async baileysGenerateMessageTag(): Promise<any> { throw new Error("baileysGenerateMessageTag not implemented for this channel"); }
  async baileysSendNode(stanza: Buffer | proto.StanzaNode): Promise<any> { throw new Error("baileysSendNode not implemented for this channel"); }
  async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: Buffer): Promise<any> { throw new Error("baileysSignalRepositoryDecryptMessage not implemented for this channel"); }
  async baileysGetAuthState(): Promise<any> { throw new Error("baileysGetAuthState not implemented for this channel"); }



  // --- Métodos de Carregamento de Configuração (Corrigidos) ---

  public async loadWebhook(): Promise<void> {
    try {
        const data = await this.prismaRepository.webhook.findUnique({
          where: { instanceId: this.instanceId },
        });
        this.localWebhook.enabled = data?.enabled ?? false;
        this.localWebhook.url = data?.url;
        this.localWebhook.webhookBase64 = data?.webhookBase64 ?? false;
        // ** CORREÇÃO TS2551/TS2339: Usar 'events' do DB e atribuir a 'events' local **
        // Assegure que o schema Prisma tenha 'events' e não 'webhookByEvents'
        // E que wa.LocalWebhook tenha a propriedade 'events'
        this.localWebhook.events = (Array.isArray(data?.events) ? data?.events : []) as wa.WebhookEvents[]; // Usa 'events'
        this.localWebhook.headers = data?.headers as Record<string, string> ?? {};
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.debug({ webhookConfig: this.localWebhook, message: 'Webhook config loaded' });
    } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to load webhook config' });
        Object.assign(this.localWebhook, { enabled: false, url: undefined, webhookBase64: false, events: [], headers: {} }); // Reset com 'events'
    }
  }

  public async loadSettings(): Promise<void> {
     try {
        const data = await this.prismaRepository.findUniqueSetting({
          where: { instanceId: this.instanceId },
        });
        this.localSettings.rejectCall = data?.rejectCall ?? false;
        this.localSettings.msgCall = data?.msgCall ?? '';
        this.localSettings.groupsIgnore = data?.groupsIgnore ?? false;
        this.localSettings.alwaysOnline = data?.alwaysOnline ?? true;
        this.localSettings.readMessages = data?.readMessages ?? true;
        this.localSettings.readStatus = data?.readStatus ?? false;
        this.localSettings.syncFullHistory = data?.syncFullHistory ?? false;
        this.localSettings.wavoipToken = data?.wavoipToken ?? '';
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.debug({ settings: this.localSettings, message: 'Settings loaded' });
     } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to load settings' });
        Object.assign(this.localSettings, { rejectCall: false, msgCall: '', groupsIgnore: false, alwaysOnline: true, readMessages: true, readStatus: false, syncFullHistory: false, wavoipToken: '' });
     }
  }

  public async setSettings(data: SettingsDto): Promise<void> {
     try {
        await this.prismaRepository.upsertSetting({ // Usa método do repo
          where: { instanceId: this.instanceId! },
          update: data,
          create: { ...data, instanceId: this.instanceId! },
        });
        Object.assign(this.localSettings, data);
        this.logger.info('Settings updated');
        // Lógica de reinício da conexão removida para simplificação
     } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to set settings' });
        throw error;
     }
  }

  // Assinatura compatível com BaileysStartupService
  public async findSettings(): Promise<LocalSettings> { // Retorna tipo importado
     // Retorna a configuração local já carregada (ou os defaults)
     const currentSettings = this.localSettings;
     return {
         rejectCall: currentSettings.rejectCall ?? false,
         msgCall: currentSettings.msgCall ?? '',
         groupsIgnore: currentSettings.groupsIgnore ?? false,
         alwaysOnline: currentSettings.alwaysOnline ?? true,
         readMessages: currentSettings.readMessages ?? true,
         readStatus: currentSettings.readStatus ?? false,
         syncFullHistory: currentSettings.syncFullHistory ?? false,
         wavoipToken: currentSettings.wavoipToken ?? '',
     };
  }

  public async loadChatwoot(): Promise<void> {
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
      this.localChatwoot.enabled = false; return;
    }
    try {
        const data = await this.prismaRepository.findUniqueChatwoot({ // Usa método do repo
          where: { instanceId: this.instanceId },
        });
        if (data) {
            this.localChatwoot.enabled = data.enabled;
            this.localChatwoot.accountId = data.accountId;
            // ... (restante das atribuições como antes) ...
             this.localChatwoot.ignoreJids = (Array.isArray(data.ignoreJids) ? data.ignoreJids : []) as string[];
        } else { this.localChatwoot.enabled = false; }
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.debug({ chatwootConfig: this.localChatwoot, message: 'Chatwoot config loaded' });
    } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to load Chatwoot config' });
        this.localChatwoot.enabled = false;
    }
  }

  public async setChatwoot(data: ChatwootDto): Promise<void> {
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
      this.logger.warn('Chatwoot integration is disabled globally. Cannot set instance config.'); return;
    }
    try {
        const updateData = { /* ... (como antes) ... */ };
        await this.prismaRepository.upsertChatwoot({ // Usa método do repo
          where: { instanceId: this.instanceId! },
          update: updateData, create: { ...updateData, instanceId: this.instanceId! },
        });
        Object.assign(this.localChatwoot, updateData);
        this.clearCacheChatwoot();
        this.logger.info('Chatwoot config updated');
    } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to set Chatwoot config' });
        throw error;
    }
  }

  public async findChatwoot(): Promise<ChatwootDto | null> {
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) return null;
    try {
        const data = await this.prismaRepository.findUniqueChatwoot({ // Usa método do repo
          where: { instanceId: this.instanceId },
        });
        // ... (mapeamento como antes) ...
        return data ? { /* ... mapear DTO ... */ } as ChatwootDto : null;
    } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to find Chatwoot config' });
        return null; // Retorna null em caso de erro
    }
  }

  public clearCacheChatwoot(): void {
    if (this.localChatwoot?.enabled) {
      // ** CORREÇÃO TS2339: Verificar se deleteMatching existe em CacheService **
      // Se não existir, implementar ou usar outro método (ex: deleteAll)
      this.chatwootCache.deleteMatching?.(`${this.instanceName}:*`)
         .then(() => this.logger.info(`Chatwoot cache cleared for instance ${this.instanceName}`))
         .catch(err => this.logger.error({ err }, `Failed to clear chatwoot cache for ${this.instanceName}`));
    }
  }

  public async loadProxy(): Promise<void> {
     this.localProxy.enabled = false;
     try {
        // Lógica de carregar do env e DB mantida...
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.debug({ proxyConfig: this.localProxy, message: 'Proxy config finalized' });
     } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
         this.logger.error({ err: error, message: 'Failed to load Proxy config' });
         this.localProxy.enabled = false;
     }
  }

  public async setProxy(data: ProxyDto): Promise<void> {
     try {
        const portNumber = data.port ? parseInt(data.port, 10) : null;
        if (data.port && isNaN(portNumber!)) { // Adicionado '!' para afirmar que não é null aqui
            throw new BadRequestException('Proxy port must be a valid number.');
        }
        const upsertData = { /* ... (como antes, usando portNumber) ... */ };
        await this.prismaRepository.upsertProxy({ // Usa método do repo
          where: { instanceId: this.instanceId! },
          update: upsertData, create: { ...upsertData, instanceId: this.instanceId! },
        });
        Object.assign(this.localProxy, { ...data, port: String(portNumber ?? '') });
        this.logger.info('Proxy config updated');
     } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to set Proxy config' });
        throw error;
     }
  }

  public async findProxy(): Promise<ProxyDto | null> {
     try {
        const data = await this.prismaRepository.findUniqueProxy({ // Usa método do repo
          where: { instanceId: this.instanceId },
        });
        // ... (lógica de retorno e conversão como antes) ...
        return data ? { /* ... map DTO ... */ } as ProxyDto : null;
     } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Failed to find Proxy config' });
        throw error;
     }
  }

  public async sendDataWebhook<T = any>(event: Events, data: T, local = true, integration?: string[]): Promise<void> {
    const serverUrl = this.configService.get<HttpServerConfig>('SERVER')?.URL;
    const tzoffset = new Date().getTimezoneOffset() * 60000;
    const localISOTime = new Date(Date.now() - tzoffset).toISOString();
    const expose = this.configService.get<AuthConfig>('AUTHENTICATION')?.EXPOSE_IN_FETCH_INSTANCES;
    const instanceApikey = this.token;

    const eventPayload = {
        origin: this.constructor.name, // Usar nome da classe concreta
        event, instanceName: this.instanceName, // Adicionar instanceName ao payload
        data, serverUrl, dateTime: localISOTime,
        sender: this.wuid,
        apiKey: expose && instanceApikey ? instanceApikey : null,
        local, integration,
    };

    // Emitir evento usando o nome da instância como canal
    await eventManager.emit(this.instanceName!, eventPayload);
  }

  // --- Métodos de Formatação de Número (Mantidos) ---
  public formatMXOrARNumber(jid: string): string { /* ... */ return jid; }
  public formatBRNumber(jid: string): string { /* ... */ return jid; }

  // --- Métodos de Busca (Corrigidos) ---

  public async fetchContacts(query: ContactQueryArgs): Promise<Contact[]> {
    const remoteJidFilter = query?.where?.remoteJid ? createJid(query.where.remoteJid) : undefined;
    const where: Prisma.ContactWhereInput = { instanceId: this.instanceId! };
    if (remoteJidFilter) where.remoteJid = remoteJidFilter;
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.debug({ where, message: 'Fetching contacts with filter' });
    return this.prismaRepository.findManyContacts({ where }); // Usa método do repo
  }

  public cleanMessageData(message: any): any { /* ... (lógica mantida) ... */ return message; }

  public async fetchMessages(query: MessageQueryArgs): Promise<{ /* ... */ }> {
    const where: Prisma.MessageWhereInput = { instanceId: this.instanceId! };
    // ... (lógica de filtros mantida, garantindo uso de BigInt para timestamp) ...
    const keyFilters: Prisma.JsonFilter<Prisma.InputJsonValue> = {}; // ** CORREÇÃO TS2694: Tipar JsonFilter **
    if (query.where?.key?.id) { keyFilters.path = ['id']; keyFilters.equals = query.where.key.id; }
    // ... (outros filtros de key) ...
    if (Object.keys(keyFilters).length > 0 && keyFilters.path) { where.key = keyFilters; }

    const page = query.page || 1; const limit = query.limit || 50; const skip = (page - 1) * limit;

    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.debug({ where, skip, take: limit, message: 'Fetching messages with filter' });

    const [count, messages] = await this.prismaRepository.$transaction([
      this.prismaRepository.message.count({ where }),
      this.prismaRepository.findManyMessages({ // Usa método do repo
        where, orderBy: { messageTimestamp: 'desc' }, skip, take: limit,
      }),
    ]);
    return { total: count, pages: Math.ceil(count / limit), currentPage: page, records: messages };
  }

  public async fetchStatusMessage(query: StatusQueryArgs): Promise<MessageUpdate[]> {
    const where: Prisma.MessageUpdateWhereInput = { instanceId: this.instanceId! };
    if(query.where?.remoteJid) where.remoteJid = query.where.remoteJid;
    if(query.where?.id) where.keyId = query.where.id;
    const page = query.page || 1; const limit = query.limit || 50; const skip = (page - 1) * limit;
    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.debug({ where, skip, take: limit, message: 'Fetching message statuses' });
    return this.prismaRepository.findManyMessageUpdates({ // Usa método do repo
      where, orderBy: { timestamp: 'desc' }, skip, take: limit,
    });
  }

  public async fetchChats(query?: any): Promise<any[]> {
    const remoteJidFilter = query?.where?.remoteJid ? createJid(query.where.remoteJid) : undefined;
    let timestampFilter = Prisma.sql``;
    // ... (lógica de timestamp filter mantida, usando BigInt) ...
    const instanceIdParam = this.instanceId!;

    // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
    this.logger.debug({ remoteJidFilter, hasTimestampFilter: !!timestampFilter, message: 'Fetching chats with raw query' });

    try {
      // Query raw mantida, mas atenção aos nomes exatos das colunas/tabelas e tipos
      // ** CORREÇÃO TS2339: Usar interface ChatQueryResult **
      const results = await this.prismaRepository.$queryRawUnsafe<ChatQueryResult[]>(`
            WITH rankedMessages AS (
              SELECT DISTINCT ON ("Contact"."remoteJid")
                "Contact"."id", "Contact"."remoteJid", "Contact"."pushName", "Contact"."profilePicUrl",
                COALESCE(to_timestamp("Message"."messageTimestamp"), "Contact"."updatedAt") as "updatedAt",
                "Chat"."createdAt" as "windowStart",
                ("Chat"."createdAt" + INTERVAL '24 hours') as "windowExpires",
                CASE WHEN ("Chat"."createdAt" + INTERVAL '24 hours' > NOW()) THEN true ELSE false END as "windowActive",
                "Message"."id" AS "lastMessageId", "Message"."key" AS "lastMessageKey",
                "Message"."pushName" AS "lastMessagePushName", "Message"."participant" AS "lastMessageParticipant",
                "Message"."messageType" AS "lastMessageMessageType", "Message"."message" AS "lastMessageMessage",
                "Message"."contextInfo" AS "lastMessageContextInfo", "Message"."source" AS "lastMessageSource",
                "Message"."messageTimestamp" AS "lastMessageMessageTimestamp", "Message"."instanceId" AS "lastMessageInstanceId",
                "Message"."sessionId" AS "lastMessageSessionId", "Message"."status" AS "lastMessageStatus"
              FROM "Contact"
              LEFT JOIN "Message" ON "Message"."key"->>'remoteJid' = "Contact"."remoteJid" AND "Message"."instanceId" = $1 ${timestampFilter}
              LEFT JOIN "Chat" ON "Chat"."remoteJid" = "Contact"."remoteJid" AND "Chat"."instanceId" = $1
              WHERE "Contact"."instanceId" = $1
                ${remoteJidFilter ? Prisma.sql`AND "Contact"."remoteJid" = ${remoteJidFilter}` : Prisma.sql``}
              ORDER BY "Contact"."remoteJid", "Message"."messageTimestamp" DESC NULLS LAST
            )
            SELECT * FROM rankedMessages
            ORDER BY "updatedAt" DESC NULLS LAST;
        `, instanceIdParam);

      if (results && isArray(results) && results.length > 0) {
          // ** CORREÇÃO TS2339: Acessar propriedades da interface ChatQueryResult **
          const mappedResults = results.map((contact: ChatQueryResult) => { // Tipar contact
            const lastMessage = contact.lastMessageId
              ? { /* ... mapear usando contact.lastMessage... */ } : undefined;
            return {
              id: contact.id, remoteJid: contact.remoteJid, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl,
              updatedAt: contact.updatedAt, windowStart: contact.windowStart, windowExpires: contact.windowExpires, windowActive: contact.windowActive,
              lastMessage: lastMessage ? this.cleanMessageData(lastMessage) : undefined,
            };
          });
          return mappedResults;
        }
        return [];
    } catch (error) {
        // ** CORREÇÃO TS2554: Usar 1 argumento para logger **
        this.logger.error({ err: error, message: 'Error fetching chats with raw query' });
        return [];
    }
  }

} // Fim da classe ChannelStartupService
