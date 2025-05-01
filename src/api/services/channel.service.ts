// Arquivo: src/api/services/channel.service.ts
// Correções v3: Ajustados tipos locais (Chatwoot, Webhook), removida chamada a método inexistente do Chatwoot,
//               corrigida chamada ao CacheService, ajustados construtores dos serviços de chatbot.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { ChatwootDto } from '@integrations/chatbot/chatwoot/dto/chatwoot.dto';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { DifyService } from '@integrations/chatbot/dify/services/dify.service';
import { EvolutionBotService } from '@integrations/chatbot/evolutionBot/services/evolutionBot.service';
import { FlowiseService } from '@integrations/chatbot/flowise/services/flowise.service';
import { OpenaiService } from '@integrations/chatbot/openai/services/openai.service';
import { TypebotService } from '@integrations/chatbot/typebot/services/typebot.service';
import { PrismaRepository } from '@repository/repository.service';
import { eventManager } from '@api/server.module'; // Ajustar path se necessário
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
// ** VERIFICADO: Importando tipos de wa.types.ts **
import { Events, wa, LocalSettings, LocalWebhook, LocalProxy } from '@api/types/wa.types';
// ** VERIFICADO: Importando tipos de env.config.ts **
import { ConfigService, ChatwootConfig, HttpServerConfig, AuthConfig } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { Contact, Message, MessageUpdate, Prisma } from '@prisma/client';
import { createJid } from '@utils/createJid';
import { WASocket, MiscMessageGenerationOptions, GroupMetadata, ParticipantAction, GroupSettingUpdate, proto } from '@whiskeysockets/baileys';
import { isArray } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';
import { CacheService } from './cache.service';

// --- Tipos (Mantidos) ---
interface ContactQueryArgs { /* ... */ }
interface MessageQueryArgs { /* ... */ }
interface StatusQueryArgs { /* ... */ }
interface ChatQueryResult { /* ... */ } // Definido como antes

export abstract class ChannelStartupService {
  protected readonly logger: Logger;

  public client: WASocket | any | null = null;
  public readonly instance: Partial<wa.Instance> = {};
  // ** CORREÇÃO v3: Usar Partial<ChatwootDto> pois ChatwootConfigLocal não existe **
  public readonly localChatwoot: Partial<ChatwootDto> = {};
  public readonly localProxy: Partial<LocalProxy> = {};
  public readonly localSettings: Partial<LocalSettings> = {};
  public readonly localWebhook: Partial<LocalWebhook> = {}; // Usa tipo de wa.types

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
    chatwootService: ChatwootService,
  ) {
      this.logger = baseLogger.child({ context: `${this.constructor.name}` });

      this.chatwootService = chatwootService;

      // ** CORREÇÃO v3: Ajustar argumentos dos construtores dos serviços de chatbot **
      // Passando apenas os 3 argumentos esperados: waMonitor, configService, prismaRepository
      try {
        this.typebotService = new TypebotService(this.waMonitor, this.configService, this.prismaRepository);
        this.openaiService = new OpenaiService(this.waMonitor, this.configService, this.prismaRepository);
        this.difyService = new DifyService(this.waMonitor, this.configService, this.prismaRepository);
        this.evolutionBotService = new EvolutionBotService(this.waMonitor, this.configService, this.prismaRepository);
        this.flowiseService = new FlowiseService(this.waMonitor, this.configService, this.prismaRepository);
      } catch (serviceError) {
        this.logger.error({ err: serviceError }, "Erro ao inicializar serviços de chatbot");
      }
  }


  public setInstance(instanceData: InstanceDto): void {
    this.logger.info({ instanceName: instanceData.instanceName }, 'Setting instance data');
    this.instance.name = instanceData.instanceName;
    this.instance.id = instanceData.instanceId;
    // ... (outras atribuições como antes) ...
    this.instance.profilePictureUrl = instanceData.profilePictureUrl;

    // ** CORREÇÃO v3: Comentado pois o método chamado não existe em ChatwootService **
    // if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
    //   this.chatwootService?.handleStatusInstanceWebhook?.( // <<< MÉTODO NÃO EXISTE
    //     { instanceName: this.instance.name, instanceId: this.instance.id },
    //     { instance: this.instance.name, status: 'created' }
    //   ).catch(err => this.logger.error({ err, instanceName: this.instance.name }, 'Error sending instance status to Chatwoot'));
    // }
  }

  // --- Getters e Setters (Mantidos como na v2) ---
  // ... (getters/setters para instanceName, instanceId, etc.) ...
   public get instanceName(): string | undefined { return this.instance.name; }
   public set instanceName(name: string) {
     if (!name) name = v4();
     this.logger.info({ oldName: this.instance.name, newName: name }, 'Setting instance name');
     this.instance.name = name;
   }
   // ... outros getters/setters ...
   public get wuid(): string | undefined { return this.instance.wuid; }
   public set wuid(wuid: string | undefined) { this.instance.wuid = wuid; }
   public get profileName(): string | undefined { return this.instance.profileName; }
   public set profileName(name: string | undefined) { this.instance.profileName = name; }
   public get profilePictureUrl(): string | undefined { return this.instance.profilePictureUrl; }
   public set profilePictureUrl(url: string | undefined) { this.instance.profilePictureUrl = url; }
   // ...

  // --- Métodos Abstratos (Mantidos como na v2) ---
  abstract connectToWhatsapp(data?: any): Promise<any>;
  abstract logoutInstance(destroyClient?: boolean): Promise<void>;
  abstract getStatus(): wa.ConnectionState | wa.StateConnection;
  abstract textMessage(data: wa.SendTextDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract mediaMessage(data: wa.SendMediaDto | wa.SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract buttonMessage(data: wa.SendButtonDto | wa.SendButtonListDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract contactMessage(data: wa.SendContactDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract locationMessage(data: wa.SendLocationDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract reactionMessage(data: wa.SendReactionDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract templateMessage?(data: wa.SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<any>;
  // ... (outros métodos abstratos ou com throw Error mantidos) ...
  async createGroup(data: wa.CreateGroupDto): Promise<GroupMetadata | any> { throw new Error("createGroup not implemented for this channel"); }
  async updateGroupPicture(data: wa.UpdateGroupPictureDto): Promise<void | any> { throw new Error("updateGroupPicture not implemented for this channel"); }
  // ... (restante dos métodos de grupo, chamada, label, baileys) ...
  async offerCall(data: wa.OfferCallDto): Promise<any> { throw new Error("offerCall not implemented for this channel"); }
  async fetchLabels(): Promise<wa.Label[] | any> { throw new Error("fetchLabels not implemented for this channel"); }
  async handleLabel(data: wa.HandleLabelDto): Promise<any> { throw new Error("handleLabel not implemented for this channel"); }
  async baileysOnWhatsapp(jid: string): Promise<any> { throw new Error("baileysOnWhatsapp not implemented for this channel"); }
  // ...


  // --- Métodos de Carregamento de Configuração (Corrigidos) ---

  public async loadWebhook(): Promise<void> {
    try {
        const data = await this.prismaRepository.webhook.findUnique({
          where: { instanceId: this.instanceId },
        });
        this.localWebhook.enabled = data?.enabled ?? false;
        this.localWebhook.url = data?.url;
        this.localWebhook.webhookBase64 = data?.webhookBase64 ?? false;
        // ** CORREÇÃO v3: Usar 'webhookByEvents' do tipo LocalWebhook **
        this.localWebhook.webhookByEvents = data?.webhookByEvents ?? false;
        this.localWebhook.headers = data?.headers as Record<string, string> ?? {};
        // Nota: A propriedade 'events' do banco (se existir) não está sendo mapeada aqui
        // pois o tipo LocalWebhook não a possui. Adicione 'events?: wa.WebhookEvents[]'
        // ao tipo LocalWebhook em wa.types.ts se precisar armazená-la localmente.
        this.logger.debug({ webhookConfig: this.localWebhook, message: 'Webhook config loaded' });
    } catch (error) {
        this.logger.error({ err: error, message: 'Failed to load webhook config' });
        Object.assign(this.localWebhook, { enabled: false, url: undefined, webhookBase64: false, webhookByEvents: false, headers: {} }); // Reset
    }
  }

  public async loadSettings(): Promise<void> {
     try {
        const data = await this.prismaRepository.findUniqueSetting({ // Usa método do repo
          where: { instanceId: this.instanceId },
        });
        // ... (atribuições mantidas como na v2) ...
         this.localSettings.wavoipToken = data?.wavoipToken ?? '';
        this.logger.debug({ settings: this.localSettings, message: 'Settings loaded' });
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to load settings' });
        Object.assign(this.localSettings, { rejectCall: false, /* ... defaults ... */ wavoipToken: '' });
     }
  }

  public async setSettings(data: SettingsDto): Promise<void> {
     try {
        await this.prismaRepository.upsertSetting({ /* ... */ }); // Usa método do repo
        Object.assign(this.localSettings, data);
        this.logger.info('Settings updated');
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to set settings' });
        throw error;
     }
  }

  public async findSettings(): Promise<LocalSettings> {
     // ... (lógica mantida como na v2) ...
     return { /* ... retorna objeto LocalSettings ... */ } as LocalSettings;
  }

  public async loadChatwoot(): Promise<void> {
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) { /* ... */ return; }
    try {
        const data = await this.prismaRepository.findUniqueChatwoot({ /* ... */ }); // Usa método do repo
        if (data) {
            // ** CORREÇÃO v3: Atribui ao localChatwoot (Partial<ChatwootDto>) **
            this.localChatwoot.enabled = data.enabled;
            this.localChatwoot.accountId = data.accountId;
            this.localChatwoot.token = data.token;
            this.localChatwoot.url = data.url;
            this.localChatwoot.nameInbox = data.nameInbox;
            this.localChatwoot.signMsg = data.signMsg; // Assumindo que DTO e DB usam mesmo tipo (boolean ou string)
            this.localChatwoot.signDelimiter = data.signDelimiter;
            // this.localChatwoot.number = data.number; // DTO não tem 'number'?
            this.localChatwoot.reopenConversation = data.reopenConversation;
            this.localChatwoot.conversationPending = data.conversationPending;
            this.localChatwoot.mergeBrazilContacts = data.mergeBrazilContacts;
            this.localChatwoot.importContacts = data.importContacts;
            this.localChatwoot.importMessages = data.importMessages;
            this.localChatwoot.daysLimitImportMessages = data.daysLimitImportMessages;
            this.localChatwoot.organization = data.organization as any;
            this.localChatwoot.logo = data.logo;
            this.localChatwoot.ignoreJids = (Array.isArray(data.ignoreJids) ? data.ignoreJids : []) as string[];
        } else { this.localChatwoot.enabled = false; }
        this.logger.debug({ chatwootConfig: this.localChatwoot, message: 'Chatwoot config loaded' });
    } catch (error) {
         this.logger.error({ err: error, message: 'Failed to load Chatwoot config' });
         this.localChatwoot.enabled = false;
    }
  }

  public async setChatwoot(data: ChatwootDto): Promise<void> {
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) { /* ... */ return; }
    try {
        // ** CORREÇÃO v3: Mapear DTO para o tipo esperado pelo Prisma.ChatwootUpsertArgs **
        // Principalmente signMsg (boolean no DTO vs string/boolean no DB?)
        const updateData = {
             enabled: data?.enabled ?? false,
             accountId: data.accountId ? String(data.accountId) : undefined, // Garante String
             token: data.token, url: data.url, nameInbox: data.nameInbox,
             signMsg: data.signMsg, // Assumindo que DTO e DB usam boolean
             signDelimiter: data.signMsg ? data.signDelimiter : null,
             // number: data.number, // Campo 'number' existe no schema Chatwoot?
             reopenConversation: data.reopenConversation ?? false,
             conversationPending: data.conversationPending ?? false,
             mergeBrazilContacts: data.mergeBrazilContacts ?? false,
             importContacts: data.importContacts ?? false,
             importMessages: data.importMessages ?? false,
             daysLimitImportMessages: data.daysLimitImportMessages ?? 0,
             organization: data.organization, logo: data.logo,
             ignoreJids: data.ignoreJids ?? [],
        };
        await this.prismaRepository.upsertChatwoot({ // Usa método do repo
          where: { instanceId: this.instanceId! },
          update: updateData,
          create: { ...updateData, instanceId: this.instanceId! },
        });
        Object.assign(this.localChatwoot, data); // Atualiza cache local com DTO original
        this.clearCacheChatwoot();
        this.logger.info('Chatwoot config updated');
    } catch (error) {
         this.logger.error({ err: error, message: 'Failed to set Chatwoot config' });
         throw error;
    }
  }

  public async findChatwoot(): Promise<ChatwootDto | null> {
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) return null;
    try {
        const data = await this.prismaRepository.findUniqueChatwoot({ /* ... */ }); // Usa método do repo
        // ... (mapeamento DB -> DTO como antes) ...
        return data ? { /* ... map DTO ... */ } as ChatwootDto : null;
    } catch (error) {
        this.logger.error({ err: error, message: 'Failed to find Chatwoot config' });
        return null;
    }
  }

  public clearCacheChatwoot(): void {
    if (this.localChatwoot?.enabled) {
      // ** CORREÇÃO v3: Usar deleteAll do CacheService **
      this.chatwootCache.deleteAll?.(`${this.instanceName}:*`) // Chama deleteAll com prefixo
         .then((deletedCount) => this.logger.info(`Chatwoot cache cleared for instance ${this.instanceName}. Keys deleted: ${deletedCount}`))
         .catch(err => this.logger.error({ err }, `Failed to clear chatwoot cache for ${this.instanceName}`));
    }
  }

  // ... (Métodos loadProxy, setProxy, findProxy mantidos como na v2, com logs corrigidos) ...
   public async loadProxy(): Promise<void> { /* ... (lógica mantida, logger corrigido) ... */
     try { /* ... */ this.logger.debug({ proxyConfig: this.localProxy, message: 'Proxy config finalized' }); }
     catch (error) { this.logger.error({ err: error, message: 'Failed to load Proxy config' }); /* ... */ }
   }
   public async setProxy(data: ProxyDto): Promise<void> { /* ... (lógica mantida, logger corrigido) ... */
     try { /* ... */ }
     catch (error) { this.logger.error({ err: error, message: 'Failed to set Proxy config' }); throw error; }
   }
   public async findProxy(): Promise<ProxyDto | null> { /* ... (lógica mantida, logger corrigido) ... */
     try { /* ... */ }
     catch (error) { this.logger.error({ err: error, message: 'Failed to find Proxy config' }); throw error; }
   }

  // ... (Método sendDataWebhook mantido como na v2) ...
  public async sendDataWebhook<T = any>(event: Events, data: T, local = true, integration?: string[]): Promise<void> { /* ... */ }

  // ... (Métodos de Formatação de Número mantidos) ...
  public formatMXOrARNumber(jid: string): string { /* ... */ return jid; }
  public formatBRNumber(jid: string): string { /* ... */ return jid; }

  // --- Métodos de Busca (Corrigidos) ---
  public async fetchContacts(query: ContactQueryArgs): Promise<Contact[]> { /* ... (lógica mantida, logger corrigido) ... */
     this.logger.debug({ where, message: 'Fetching contacts with filter' });
     return this.prismaRepository.findManyContacts({ where }); // Usa método do repo
  }
  public cleanMessageData(message: any): any { /* ... */ return message; }
  public async fetchMessages(query: MessageQueryArgs): Promise<{ /* ... */ }> { /* ... (lógica mantida, logger corrigido) ... */
     this.logger.debug({ where, skip, take: limit, message: 'Fetching messages with filter' });
     // ... (usa $transaction e findManyMessages do repo) ...
     return { total: count, pages: Math.ceil(count / limit), currentPage: page, records: messages };
   }
  public async fetchStatusMessage(query: StatusQueryArgs): Promise<MessageUpdate[]> { /* ... (lógica mantida, logger corrigido) ... */
     this.logger.debug({ where, skip, take: limit, message: 'Fetching message statuses' });
     return this.prismaRepository.findManyMessageUpdates({ where, /* ... */ }); // Usa método do repo
   }
  public async fetchChats(query?: any): Promise<any[]> { /* ... (lógica mantida, logger corrigido, usa ChatQueryResult) ... */
    try { /* ... */ }
    catch (error) { this.logger.error({ err: error, message: 'Error fetching chats with raw query' }); return []; }
  }

} // Fim da classe ChannelStartupService
