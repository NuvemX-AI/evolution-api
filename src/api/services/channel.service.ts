// Arquivo: src/api/services/channel.service.ts
// Correções: Logger, instanceId, importações DTO, argumentos Prisma, cache, construtores chatbot, webhookByEvents.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { SettingsDto } from '@api/dto/settings.dto';
// Importando DTOs diretamente
import {
  SendTextDto, SendMediaDto, SendMediaUrlDto, SendButtonsDto, SendListDto,
  SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto,
  Button, Options, SendAudioDto // Adicionar outros DTOs se necessário
} from '@api/dto/sendMessage.dto';
import { CreateGroupDto, UpdateGroupPictureDto, OfferCallDto, HandleLabelDto } from '@api/dto/group.dto'; // Assumindo que estão em group.dto.ts
// Importando tipos do Chatwoot DTO
import { ChatwootDto } from '@integrations/chatbot/chatwoot/dto/chatwoot.dto';

import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
import { DifyService } from '@integrations/chatbot/dify/services/dify.service';
import { EvolutionBotService } from '@integrations/chatbot/evolutionBot/services/evolutionBot.service';
import { FlowiseService } from '@integrations/chatbot/flowise/services/flowise.service';
import { OpenaiService } from '@integrations/chatbot/openai/services/openai.service';
import { TypebotService } from '@integrations/chatbot/typebot/services/typebot.service';
import { PrismaRepository, Query } from '@repository/repository.service'; // Importando Query daqui
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
// Importando tipos de wa.types.ts (verificar se LocalSettings/Webhook/Proxy são exportados)
// Se não forem, defina-os aqui ou importe da fonte correta
import { Events, wa } from '@api/types/wa.types'; // Removidos LocalSettings, LocalWebhook, LocalProxy por enquanto
// Importando tipos de env.config.ts (verificar se são exportados)
import { ConfigService, Chatwoot, HttpServerConfig, AuthConfig } from '@config/env.config'; // Usando tipos exportados
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { Contact, Message, MessageUpdate, Prisma } from '@prisma/client';
import { createJid } from '@utils/createJid';
// Importando tipos de Baileys diretamente, se necessário
import { WASocket, MiscMessageGenerationOptions, GroupMetadata, ParticipantAction, GroupSettingUpdate, proto, ConnectionState } from '@whiskeysockets/baileys';
import { isArray } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';
import { CacheService } from './cache.service';

// --- Tipos Locais (Definir se não exportados em wa.types) ---
// Exemplo:
type LocalWebhook = {
  enabled: boolean;
  url?: string;
  webhookBase64: boolean;
  webhookByEvents: boolean; // Adicionado baseado no uso
  headers: Record<string, string>;
  events?: string[]; // Opcional, se precisar armazenar localmente
}
type LocalSettings = { // Exemplo, ajustar conforme campos reais
  rejectCall?: boolean;
  wavoipToken?: string;
  // outros campos...
}
type LocalProxy = { // Exemplo, ajustar conforme campos reais
  enabled?: boolean;
  server?: string;
  username?: string;
  // outros campos...
}
type StateConnection = { // Exemplo para compatibilidade com Baileys/Meta
  status?: 'open' | 'close' | 'connecting';
  lastDisconnect?: any;
}
// --- Fim Tipos Locais ---


// Interfaces de Query (manter como antes ou refinar)
interface ContactQueryArgs extends Query<Contact> {}
interface MessageQueryArgs extends Query<Message> {}
interface StatusQueryArgs extends Query<MessageUpdate> {}
interface ChatQueryResult { /* ... */ } // Definido como antes

export abstract class ChannelStartupService {
  protected readonly logger: Logger;

  public client: WASocket | any | null = null;
  // Usando Partial<InstanceDto> para mais flexibilidade inicial
  public readonly instance: Partial<InstanceDto & { wuid?: string, profileName?: string, profilePictureUrl?: string }> = {};
  public readonly localChatwoot: Partial<ChatwootDto> = {};
  public readonly localProxy: Partial<LocalProxy> = {};
  public readonly localSettings: Partial<LocalSettings> = {};
  public readonly localWebhook: Partial<LocalWebhook> = {};

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
    // CacheService agora é usado para o cache geral, não específico do chatwoot apenas
    public readonly cacheService: CacheService,
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
    // Serviço Chatwoot injetado
    chatwootService: ChatwootService,
  ) {
      // Não chama mais .child()
      this.logger = baseLogger;
      this.logger.setContext(this.constructor.name); // Define contexto

      this.chatwootService = chatwootService;

      // Passando as dependências corretas para os construtores dos serviços
      // Assumindo que todos precisam de waMonitor, configService, prismaRepository
      try {
        // ** VERIFICAR: Se os serviços de chatbot realmente precisam do waMonitor ou apenas de config/prisma **
        this.typebotService = new TypebotService(this.waMonitor, this.configService, this.prismaRepository);
        this.openaiService = new OpenaiService(this.waMonitor, this.configService, this.prismaRepository);
        this.difyService = new DifyService(this.waMonitor, this.configService, this.prismaRepository);
        this.evolutionBotService = new EvolutionBotService(this.waMonitor, this.configService, this.prismaRepository);
        this.flowiseService = new FlowiseService(this.waMonitor, this.configService, this.prismaRepository);
      } catch (serviceError) {
        // Corrigido logger.error
        this.logger.error({ err: serviceError, message: "Erro ao inicializar serviços de chatbot" });
      }
  }


  public setInstance(instanceData: InstanceDto): void {
    // Corrigido logger.info
    this.logger.info({ instanceName: instanceData.instanceName, message: 'Setting instance data' });
    this.instance.instanceName = instanceData.instanceName;
    this.instance.instanceId = instanceData.instanceId;
    this.instance.token = instanceData.token; // Adicionado token se necessário
    this.instance.number = instanceData.number; // Adicionado number se necessário
    // Corrigido acesso a profilePictureUrl (usando nome do DTO)
    this.instance.profilePictureUrl = instanceData.profilePicUrl; // Correção aqui

    // ... (lógica comentada do handleStatusInstanceWebhook mantida) ...
  }

  // --- Getters e Setters ---
  public get instanceName(): string | undefined { return this.instance.instanceName; }
  public set instanceName(name: string | undefined) {
    if (!name) name = v4();
    // Corrigido logger.info
    this.logger.info({ oldName: this.instance.instanceName, newName: name, message: 'Setting instance name' });
    this.instance.instanceName = name;
  }
  // Corrigido getter para instanceId
  public get instanceId(): string | undefined { return this.instance.instanceId; }

  public get wuid(): string | undefined { return this.instance.wuid; }
  public set wuid(wuid: string | undefined) { this.instance.wuid = wuid; }
  public get profileName(): string | undefined { return this.instance.profileName; }
  public set profileName(name: string | undefined) { this.instance.profileName = name; }
  public get profilePictureUrl(): string | undefined { return this.instance.profilePictureUrl; }
  public set profilePictureUrl(url: string | undefined) { this.instance.profilePictureUrl = url; }
   // ... outros getters/setters ...


  // --- Métodos Abstratos (Assinaturas corrigidas para usar DTOs importados) ---
  abstract connectToWhatsapp(data?: any): Promise<any>;
  abstract logoutInstance(destroyClient?: boolean): Promise<void>;
  // Usando tipos mais genéricos ou específicos da implementação (Baileys/Meta)
  abstract getStatus(): ConnectionState | StateConnection | any;
  // Usando DTOs importados
  abstract textMessage(data: SendTextDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract mediaMessage(data: SendMediaDto | SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<any>;
  // Renomeados SendButtonDto para SendButtonsDto e SendButtonListDto para SendListDto conforme DTOs
  abstract buttonMessage(data: SendButtonsDto | SendListDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract contactMessage(data: SendContactDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract locationMessage(data: SendLocationDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract reactionMessage(data: SendReactionDto, options?: MiscMessageGenerationOptions): Promise<any>;
  abstract templateMessage?(data: SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<any>;
  // Usando DTOs importados para grupos, chamadas, labels
  async createGroup(data: CreateGroupDto): Promise<GroupMetadata | any> { throw new Error("createGroup not implemented for this channel"); }
  async updateGroupPicture(data: UpdateGroupPictureDto): Promise<void | any> { throw new Error("updateGroupPicture not implemented for this channel"); }
  // ... outros métodos com throw Error ...
  async offerCall(data: OfferCallDto): Promise<any> { throw new Error("offerCall not implemented for this channel"); }
  async fetchLabels(): Promise<any[] | any> { throw new Error("fetchLabels not implemented for this channel"); } // Ajustado retorno
  async handleLabel(data: HandleLabelDto): Promise<any> { throw new Error("handleLabel not implemented for this channel"); }
  async baileysOnWhatsapp?(jid: string): Promise<any> { throw new Error("baileysOnWhatsapp not implemented for this channel"); } // Marcar como opcional
  // ...


  // --- Métodos de Carregamento de Configuração (Corrigidos) ---

  public async loadWebhook(): Promise<void> {
    try {
        // Corrigido acesso a instanceId
        const data = await this.prismaRepository.webhook.findUnique({
          where: { instanceId: this.instanceId },
        });
        this.localWebhook.enabled = data?.enabled ?? false;
        this.localWebhook.url = data?.url;
        this.localWebhook.webhookBase64 = data?.webhookBase64 ?? false;
        // Corrigido acesso a webhookByEvents (campo existe no DB?)
        // Assumindo que 'webhookByEvents' existe no modelo Webhook do Prisma
        this.localWebhook.webhookByEvents = data?.webhookByEvents ?? false; // Ajuste se o nome do campo for outro
        this.localWebhook.headers = (data?.headers as Record<string, string>) ?? {};
        this.logger.debug({ webhookConfig: this.localWebhook, message: 'Webhook config loaded' });
    } catch (error) {
        this.logger.error({ err: error, message: 'Failed to load webhook config' });
        Object.assign(this.localWebhook, { enabled: false, url: undefined, webhookBase64: false, webhookByEvents: false, headers: {} }); // Reset
    }
  }

  public async loadSettings(): Promise<void> {
     try {
        // Corrigido acesso a instanceId
        const data = await this.prismaRepository.findUniqueSetting({
          where: { instanceId: this.instanceId },
        });
        // Mapeamento DB -> localSettings (Exemplo)
        this.localSettings.rejectCall = data?.rejectCall ?? false;
        this.localSettings.wavoipToken = data?.wavoipToken ?? '';
        // ... outros campos ...
        this.logger.debug({ settings: this.localSettings, message: 'Settings loaded' });
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to load settings' });
        Object.assign(this.localSettings, { rejectCall: false, wavoipToken: '' /* ... defaults ... */ });
     }
  }

  public async setSettings(data: SettingsDto): Promise<void> {
     try {
        // Corrigido acesso a instanceId
        const instanceId = this.instanceId;
        if (!instanceId) throw new Error("Instance ID not set");
        // Corrigido: Passando objeto completo para upsertSetting
        await this.prismaRepository.upsertSetting({
            where: { instanceId: instanceId },
            update: data,
            create: { ...data, instanceId: instanceId },
        });
        Object.assign(this.localSettings, data);
        this.logger.info({ message: 'Settings updated' }); // Corrigido logger
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to set settings' });
        throw error;
     }
  }

  public async findSettings(): Promise<LocalSettings> {
    // Corrigido acesso a instanceId
     const instanceId = this.instanceId;
     if (!instanceId) {
         this.logger.warn({ message: "Instance ID not available for findSettings" });
         return { rejectCall: false, wavoipToken: '' /* ... defaults ... */ };
     }
     try {
        const data = await this.prismaRepository.findUniqueSetting({ where: { instanceId } });
        return { // Mapear DB -> LocalSettings
            rejectCall: data?.rejectCall ?? false,
            wavoipToken: data?.wavoipToken ?? '',
            // ... outros campos ...
        };
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to find settings' });
        return { rejectCall: false, wavoipToken: '' /* ... defaults ... */ };
     }
  }

  public async loadChatwoot(): Promise<void> {
    const chatwootConfig = this.configService.get<Chatwoot>('CHATWOOT');
    if (!chatwootConfig?.ENABLED) {
        this.localChatwoot.enabled = false;
        return;
    }
    // Corrigido acesso a instanceId
    const instanceId = this.instanceId;
    if (!instanceId) {
        this.logger.warn({ message: "Instance ID not available for loadChatwoot" });
        this.localChatwoot.enabled = false;
        return;
    }
    try {
        // Corrigido: Passando where correto
        const data = await this.prismaRepository.findUniqueChatwoot({ where: { instanceId } });
        if (data) {
            Object.assign(this.localChatwoot, data); // Mapeia campos do DB para o DTO parcial
            this.localChatwoot.enabled = data.enabled; // Garante que enabled seja setado
        } else {
            this.localChatwoot.enabled = false;
        }
        this.logger.debug({ chatwootConfig: this.localChatwoot, message: 'Chatwoot config loaded' });
    } catch (error) {
         this.logger.error({ err: error, message: 'Failed to load Chatwoot config' });
         this.localChatwoot.enabled = false;
    }
  }

  public async setChatwoot(data: ChatwootDto): Promise<void> {
    const chatwootConfig = this.configService.get<Chatwoot>('CHATWOOT');
    if (!chatwootConfig?.ENABLED) { /* ... */ return; }
    // Corrigido acesso a instanceId
    const instanceId = this.instanceId;
    if (!instanceId) throw new Error("Instance ID not set");
    try {
        // Mapeamento DTO -> Prisma (considerando tipos)
        const updateData: Prisma.ChatwootUncheckedUpdateInput = {
             enabled: data?.enabled ?? false,
             accountId: data.accountId ? String(data.accountId) : undefined,
             token: data.token, url: data.url, nameInbox: data.nameInbox,
             signMsg: data.signMsg, // Assumindo boolean
             signDelimiter: data.signMsg ? data.signDelimiter : null,
             reopenConversation: data.reopenConversation ?? false,
             conversationPending: data.conversationPending ?? false,
             mergeBrazilContacts: data.mergeBrazilContacts ?? false,
             importContacts: data.importContacts ?? false,
             importMessages: data.importMessages ?? false,
             daysLimitImportMessages: data.daysLimitImportMessages ?? 0,
             organization: data.organization ?? Prisma.JsonNull,
             logo: data.logo,
             ignoreJids: data.ignoreJids ?? [],
        };
        const createData: Prisma.ChatwootUncheckedCreateInput = {
            ...updateData,
            instanceId: instanceId,
            // Adicione outros campos obrigatórios se houver
        };

        await this.prismaRepository.upsertChatwoot({ // Usa método do repo
          where: { instanceId: instanceId },
          update: updateData,
          create: createData,
        });
        Object.assign(this.localChatwoot, data); // Atualiza cache local com DTO original
        this.clearCacheChatwoot();
        this.logger.info({ message: 'Chatwoot config updated' }); // Corrigido logger
    } catch (error) {
         this.logger.error({ err: error, message: 'Failed to set Chatwoot config' });
         throw error;
    }
  }

  public async findChatwoot(): Promise<ChatwootDto | null> {
    const chatwootConfig = this.configService.get<Chatwoot>('CHATWOOT');
    if (!chatwootConfig?.ENABLED) return null;
    // Corrigido acesso a instanceId
    const instanceId = this.instanceId;
     if (!instanceId) {
         this.logger.warn({ message: "Instance ID not available for findChatwoot" });
         return null;
     }
    try {
        // Corrigido: Passando where correto
        const data = await this.prismaRepository.findUniqueChatwoot({ where: { instanceId } });
        // Mapear dados do DB para ChatwootDto
        return data ? { ...data, organization: data.organization as any } as ChatwootDto : null;
    } catch (error) {
        this.logger.error({ err: error, message: 'Failed to find Chatwoot config' });
        return null;
    }
  }

  public clearCacheChatwoot(): void {
    if (this.localChatwoot?.enabled && this.instanceName) {
        // Corrigido: Usando cacheService geral e método deleteAll
        this.cacheService.deleteAll?.(`${this.instanceName}:*`) // Assumindo que deleteAll existe
           .then((deletedCount) => this.logger.info({ message: `Chatwoot cache cleared for instance ${this.instanceName}. Keys deleted: ${deletedCount}` })) // Corrigido logger
           .catch(err => this.logger.error({ err, message: `Failed to clear chatwoot cache for ${this.instanceName}` })); // Corrigido logger
    }
  }

  // --- Métodos de Proxy (Corrigidos) ---
   public async loadProxy(): Promise<void> {
     // Corrigido acesso a instanceId
     const instanceId = this.instanceId;
     if (!instanceId) return;
     try {
       const data = await this.prismaRepository.findUniqueProxy({ where: { instanceId } });
       Object.assign(this.localProxy, data); // Mapeia campos
       this.localProxy.enabled = data?.enabled ?? false;
       this.logger.debug({ proxyConfig: this.localProxy, message: 'Proxy config finalized' });
     }
     catch (error) {
       this.logger.error({ err: error, message: 'Failed to load Proxy config' });
       Object.assign(this.localProxy, { enabled: false, server: undefined, username: undefined, password: undefined }); // Reset
     }
   }

   public async setProxy(data: ProxyDto): Promise<void> {
     // Corrigido acesso a instanceId
     const instanceId = this.instanceId;
     if (!instanceId) throw new Error("Instance ID not set");
     try {
        await this.prismaRepository.upsertProxy({
             where: { instanceId },
             update: data,
             create: { ...data, instanceId },
        });
        Object.assign(this.localProxy, data);
        this.logger.info({ message: 'Proxy config updated' });
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to set Proxy config' });
        throw error;
     }
   }

   public async findProxy(): Promise<ProxyDto | null> {
     // Corrigido acesso a instanceId
     const instanceId = this.instanceId;
     if (!instanceId) return null;
     try {
       const data = await this.prismaRepository.findUniqueProxy({ where: { instanceId } });
       return data ? { ...data } as ProxyDto : null; // Mapeia DB -> DTO
     } catch (error) {
        this.logger.error({ err: error, message: 'Failed to find Proxy config' });
        throw error; // Re-lançar ou retornar null?
     }
   }

  // --- Webhook (Mantido como antes, verificar lógica interna) ---
  public async sendDataWebhook<T = any>(event: Events, data: T, local = true, integration?: string[]): Promise<void> { /* ... */ }

  // --- Formatação (Mantido como antes) ---
  public formatMXOrARNumber(jid: string): string { /* ... */ return jid; }
  public formatBRNumber(jid: string): string { /* ... */ return jid; }

  // --- Métodos de Busca (Corrigidos) ---
  public async fetchContacts(query: ContactQueryArgs): Promise<Contact[]> {
     const where: Prisma.ContactWhereInput = { instanceId: this.instanceId, ...query.filters }; // Adiciona instanceId e usa query.filters
     this.logger.debug({ where, message: 'Fetching contacts with filter' }); // Corrigido logger
     return this.prismaRepository.findManyContacts({ where }); // Usa método do repo
  }

  public cleanMessageData(message: any): any { /* ... */ return message; }

  public async fetchMessages(query: MessageQueryArgs): Promise<{ total: number, pages: number, currentPage: number, records: Message[] }> {
     const page = query.page || 1;
     const limit = query.limit || 25;
     const skip = (page - 1) * limit;
     const where: Prisma.MessageWhereInput = { instanceId: this.instanceId, ...query.filters }; // Adiciona instanceId e usa query.filters
     const orderBy = query.orderBy || { messageTimestamp: 'desc' }; // Ordenação padrão

     this.logger.debug({ where, skip, take: limit, orderBy, message: 'Fetching messages with filter' }); // Corrigido logger

     try {
       const [messages, count] = await this.prismaRepository.$transaction([ // Usa repo
         this.prismaRepository.findManyMessages({ where, skip, take: limit, orderBy }),
         this.prismaRepository.message.count({ where }),
       ]);
       return { total: count, pages: Math.ceil(count / limit), currentPage: page, records: messages };
     } catch (error) {
       this.logger.error({ err: error, message: "Error fetching messages" });
       return { total: 0, pages: 0, currentPage: page, records: [] };
     }
   }

  public async fetchStatusMessage(query: StatusQueryArgs): Promise<MessageUpdate[]> {
     const page = query.page || 1;
     const limit = query.limit || 25;
     const skip = (page - 1) * limit;
     const where: Prisma.MessageUpdateWhereInput = { instanceId: this.instanceId, ...query.filters }; // Adiciona instanceId e usa query.filters
     const orderBy = query.orderBy || { timestamp: 'desc' }; // Ordenação padrão

     this.logger.debug({ where, skip, take: limit, orderBy, message: 'Fetching message statuses' }); // Corrigido logger
     try {
       return this.prismaRepository.findManyMessageUpdates({ where, skip, take: limit, orderBy }); // Usa método do repo
     } catch (error) {
        this.logger.error({ err: error, message: "Error fetching message statuses" });
        return [];
     }
   }

  public async fetchChats(query?: any): Promise<any[]> {
    // Manter a lógica com $queryRawUnsafe por enquanto, mas ciente dos riscos.
    // Idealmente, refatorar para usar queries Prisma tipadas se possível.
    const instanceId = this.instanceId;
    if (!instanceId) return [];
    try {
      // ... (Lógica com $queryRawUnsafe mantida como antes) ...
      const sql = `SELECT c.*, COALESCE(m.last_message_timestamp, 0) AS last_message_timestamp FROM "Chat" c LEFT JOIN ( SELECT "remoteJid", MAX("messageTimestamp") AS last_message_timestamp FROM "Message" WHERE "instanceId" = $1 GROUP BY "remoteJid" ) m ON c."remoteJid" = m."remoteJid" WHERE c."instanceId" = $1 ORDER BY last_message_timestamp DESC NULLS LAST;`;
      this.logger.debug({ sql, instanceId, message: "Fetching chats with raw query" });
      const result = await this.prismaRepository.$queryRawUnsafe(sql, instanceId);
      return result as any[]; // Assumindo que o resultado é compatível
    }
    catch (error) { this.logger.error({ err: error, message: 'Error fetching chats with raw query' }); return []; }
  }

} // Fim da classe ChannelStartupService
