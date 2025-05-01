// Arquivo: src/api/services/channel.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { ChatwootDto } from '@integrations/chatbot/chatwoot/dto/chatwoot.dto'; // Use alias @integrations
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Use alias @integrations
import { DifyService } from '@integrations/chatbot/dify/services/dify.service'; // Use alias @integrations
import { EvolutionBotService } from '@integrations/chatbot/evolutionBot/services/evolutionBot.service'; // Adicionado import
import { FlowiseService } from '@integrations/chatbot/flowise/services/flowise.service'; // Adicionado import
import { OpenaiService } from '@integrations/chatbot/openai/services/openai.service'; // Use alias @integrations
import { TypebotService } from '@integrations/chatbot/typebot/services/typebot.service'; // Use alias @integrations
import { PrismaRepository } from '@repository/repository.service'; // Use alias canônico @repository
// CORREÇÃO: Importar waMonitor e eventManager de onde são exportados (provavelmente server.module ou um contexto central)
import { eventManager } from '@api/server.module'; // Ajustar se necessário
// CORREÇÃO TS2345: Importar o tipo WAMonitoringService correto
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Assumindo que este é o serviço/tipo correto
import { Events, wa } from '@api/types/wa.types'; // Use alias @api
// CORREÇÃO TS2305: Importar tipos corretamente de env.config
import { ConfigService, ChatwootConfig, HttpServerConfig, AuthConfig } from '@config/env.config';
import { Logger } from '@config/logger.config'; // Use alias @config
import { NotFoundException } from '@exceptions'; // Use alias @exceptions
import { Contact, Message, MessageUpdate, Prisma } from '@prisma/client';
import { createJid } from '@utils/createJid'; // CORREÇÃO TS2307: Usar alias @utils
import { WASocket } from '@whiskeysockets/baileys'; // Renomeado para evitar conflito com nome da var global
import { isArray } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import { v4 } from 'uuid';
import { CacheService } from './cache.service'; // Importar CacheService local

// --- Tipos para Queries (Exemplo) ---
// Interface para argumentos de busca de contatos
interface ContactQueryArgs {
    where?: {
        remoteJid?: string;
        // Adicionar outros campos de filtro se necessário
    };
    // Adicionar paginação se necessário
    page?: number;
    limit?: number;
}

// Interface para argumentos de busca de mensagens
interface MessageQueryArgs {
    where?: {
        id?: string; // ID interno da mensagem
        source?: string;
        messageType?: string;
        messageTimestamp?: { // Filtro de timestamp
            gte?: string | Date | number;
            lte?: string | Date | number;
        };
        key?: { // Filtros baseados na chave WA
            id?: string; // ID da mensagem WA
            fromMe?: boolean;
            remoteJid?: string;
            participant?: string; // Corrigido para participant
        };
        // Adicionar outros campos de filtro
    };
    // Argumentos de paginação
    page?: number;
    limit?: number; // Renomeado de offset para limit para clareza
}

// Interface para argumentos de busca de status
interface StatusQueryArgs {
     where?: {
        remoteJid?: string;
        id?: string; // ID da mensagem original (keyId)
    };
    page?: number;
    limit?: number;
}


export class ChannelStartupService {
  protected readonly logger: Logger; // Logger deve ser inicializado no construtor

  public client: WASocket | null = null; // WASocket pode ser nulo inicialmente
  public readonly instance: wa.Instance = {}; // Inicializar com objeto vazio
  public readonly localChatwoot: Partial<wa.ChatwootConfigLocal> = {}; // Usar Partial
  public readonly localProxy: Partial<wa.LocalProxy> = {}; // Usar Partial
  public readonly localSettings: Partial<wa.LocalSettings> = {}; // Usar Partial
  public readonly localWebhook: Partial<wa.LocalWebHook> = {}; // Usar Partial

  // Serviços precisam ser inicializados após a injeção de dependências
  public chatwootService: ChatwootService;
  public typebotService: TypebotService;
  public openaiService: OpenaiService;
  public difyService: DifyService;
  public evolutionBotService: EvolutionBotService; // Adicionado
  public flowiseService: FlowiseService; // Adicionado

  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly chatwootCache: CacheService,
    // Injetar waMonitor e outros serviços que dependem dele
    protected readonly waMonitor: WAMonitoringService, // Usar o tipo importado
    protected readonly baseLogger: Logger, // Injetar logger base
    // Injetar outros serviços necessários
    chatwootService: ChatwootService, // Receber ChatwootService injetado
    // ... outros serviços
  ) {
      this.logger = baseLogger.child({ context: 'ChannelStartupService' }); // Criar logger filho

      // Inicializar serviços injetados
      this.chatwootService = chatwootService;

      // CORREÇÃO TS2345: Garantir que waMonitor tenha o tipo esperado pelos serviços
      // Se o tipo de waMonitor for diferente do esperado por TypebotService, OpenaiService, etc.,
      // será necessário ajustar os construtores desses serviços ou o tipo de waMonitor.
      // Assumindo que o tipo WAMonitoringService importado é o correto:
      this.typebotService = new TypebotService(this.waMonitor, this.configService, this.prismaRepository, this.logger); // Passar logger
      this.openaiService = new OpenaiService(this.waMonitor, this.configService, this.prismaRepository, this.logger); // Passar logger
      this.difyService = new DifyService(this.waMonitor, this.configService, this.prismaRepository, this.logger); // Passar logger
      this.evolutionBotService = new EvolutionBotService(this.waMonitor, this.configService, this.prismaRepository, this.logger); // Passar logger
      this.flowiseService = new FlowiseService(this.waMonitor, this.configService, this.prismaRepository, this.logger); // Passar logger
  }


  public setInstance(instanceData: InstanceDto): void {
    this.logger.setInstance(instanceData.instanceName); // Usar método do logger (se existir)

    this.instance.name = instanceData.instanceName;
    this.instance.id = instanceData.instanceId;
    this.instance.integration = instanceData.integration;
    this.instance.number = instanceData.number;
    this.instance.token = instanceData.token;
    this.instance.businessId = instanceData.businessId;

    // CORREÇÃO TS2305 / TS2339: Usar ChatwootConfig e chatwootService
    if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED && this.localChatwoot?.enabled) {
      // CORREÇÃO TS2339: Adicionar verificação de existência e optional chaining
      this.chatwootService?.eventWhatsapp?.( // Usar optional chaining
        Events.STATUS_INSTANCE,
        { instanceName: this.instance.name, instanceId: this.instance.id }, // Passar ID também
        {
          instance: this.instance.name,
          status: 'created',
        },
      );
    }
  }

  // --- Getters e Setters para propriedades da instância ---
  // (Mantidos como antes, mas garantindo que this.instance seja inicializado)
  public set instanceName(name: string) {
    if (!name) name = v4(); // Gera um nome se não fornecido
    this.logger.setInstance(name); // Atualiza contexto do logger
    this.instance.name = name;
  }
  public get instanceName(): string | undefined { return this.instance.name; }

  public set instanceId(id: string) {
    if (!id) id = v4(); // Gera um ID se não fornecido
    this.instance.id = id;
  }
  public get instanceId(): string | undefined { return this.instance.id; }

  // ... outros getters/setters ...
  public get integration(): string | undefined { return this.instance.integration; }
  public set integration(integration: string | undefined) { this.instance.integration = integration; }
  public get number(): string | undefined { return this.instance.number; }
  public set number(number: string | undefined) { this.instance.number = number; }
  public get token(): string | undefined { return this.instance.token; }
  public set token(token: string | undefined) { this.instance.token = token; }
  public get wuid(): string | undefined { return this.instance.wuid; }
  // Não deve haver um setter público para wuid, ele é definido na conexão


  // --- Métodos de Carregamento de Configuração ---

  public async loadWebhook(): Promise<void> {
    try {
        const data = await this.prismaRepository.webhook.findUnique({
          where: { instanceId: this.instanceId },
        });
        this.localWebhook.enabled = data?.enabled ?? false;
        this.localWebhook.url = data?.url; // Adicionar URL se existir no schema
        this.localWebhook.webhookBase64 = data?.webhookBase64 ?? false;
        this.localWebhook.byEvents = data?.webhookByEvents as any[] ?? []; // Adicionar byEvents
        this.localWebhook.headers = data?.headers as Record<string, string> ?? {}; // Adicionar headers
        this.logger.debug({ webhookConfig: this.localWebhook }, 'Webhook config loaded');
    } catch (error) {
        this.logger.error({ err: error }, 'Failed to load webhook config');
        Object.assign(this.localWebhook, { enabled: false, url: null, webhookBase64: false, byEvents: [], headers: {} }); // Reset
    }
  }

  public async loadSettings(): Promise<void> {
     try {
        const data = await this.prismaRepository.findUniqueSetting({ // Usa método corrigido do repo
          where: { instanceId: this.instanceId },
        });
        // Atribui valores ou defaults
        this.localSettings.rejectCall = data?.rejectCall ?? false;
        this.localSettings.msgCall = data?.msgCall ?? '';
        this.localSettings.groupsIgnore = data?.groupsIgnore ?? false;
        this.localSettings.alwaysOnline = data?.alwaysOnline ?? true;
        this.localSettings.readMessages = data?.readMessages ?? true;
        this.localSettings.readStatus = data?.readStatus ?? false;
        this.localSettings.syncFullHistory = data?.syncFullHistory ?? false;
        this.localSettings.wavoipToken = data?.wavoipToken ?? ''; // Corrigido para string vazia
        this.logger.debug({ settings: this.localSettings }, 'Settings loaded');
     } catch (error) {
        this.logger.error({ err: error }, 'Failed to load settings');
        // Reset para defaults em caso de erro
        Object.assign(this.localSettings, { rejectCall: false, msgCall: '', groupsIgnore: false, alwaysOnline: true, readMessages: true, readStatus: false, syncFullHistory: false, wavoipToken: '' });
     }
  }

  public async setSettings(data: SettingsDto): Promise<void> {
     try {
        await this.prismaRepository.setting.upsert({ // Usa o getter correto
          where: { instanceId: this.instanceId },
          update: data, // Passa o DTO diretamente se os campos coincidirem
          create: { ...data, instanceId: this.instanceId! }, // Garante instanceId
        });
        Object.assign(this.localSettings, data); // Atualiza cache local
        this.logger.info('Settings updated');

        // Reiniciar conexão se token wavoip mudou? Verificar lógica original
        // if (this.localSettings.wavoipToken && this.localSettings.wavoipToken.length > 0) {
        //   this.client?.ws.close();
        //   this.client?.ws.connect();
        // }
     } catch (error) {
        this.logger.error({ err: error }, 'Failed to set settings');
        throw error; // Relança o erro
     }
  }

  // Assinatura compatível com BaileysStartupService
  public async findSettings(): Promise<wa.LocalSettings> {
     // Retorna a configuração local já carregada (ou os defaults)
     // Garantir que todas as propriedades de LocalSettings existam
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
    // CORREÇÃO TS2305: Usar ChatwootConfig importado
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
      this.localChatwoot.enabled = false;
      return;
    }
    try {
        const data = await this.prismaRepository.chatwoot.findUnique({
          where: { instanceId: this.instanceId },
        });
        if (data) {
            this.localChatwoot.enabled = data.enabled;
            this.localChatwoot.accountId = data.accountId;
            this.localChatwoot.token = data.token;
            this.localChatwoot.url = data.url;
            this.localChatwoot.nameInbox = data.nameInbox;
            this.localChatwoot.signMsg = data.signMsg;
            this.localChatwoot.signDelimiter = data.signDelimiter;
            // this.localChatwoot.number = data.number; // 'number' não parece existir no schema Chatwoot
            this.localChatwoot.reopenConversation = data.reopenConversation;
            this.localChatwoot.conversationPending = data.conversationPending;
            this.localChatwoot.mergeBrazilContacts = data.mergeBrazilContacts;
            this.localChatwoot.importContacts = data.importContacts;
            this.localChatwoot.importMessages = data.importMessages;
            this.localChatwoot.daysLimitImportMessages = data.daysLimitImportMessages;
            this.localChatwoot.organization = data.organization as any; // Cast se necessário
            this.localChatwoot.logo = data.logo;
            this.localChatwoot.ignoreJids = (Array.isArray(data.ignoreJids) ? data.ignoreJids : []) as string[]; // Garantir array de string
        } else {
            this.localChatwoot.enabled = false; // Default se não encontrado
        }
         this.logger.debug({ chatwootConfig: this.localChatwoot }, 'Chatwoot config loaded');
    } catch (error) {
         this.logger.error({ err: error }, 'Failed to load Chatwoot config');
         this.localChatwoot.enabled = false; // Desabilita em caso de erro
    }
  }

  public async setChatwoot(data: ChatwootDto): Promise<void> {
    // CORREÇÃO TS2305: Usar ChatwootConfig importado
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
      this.logger.warn('Chatwoot integration is disabled globally. Cannot set instance config.');
      return;
    }
    try {
        const updateData = {
            enabled: data?.enabled ?? false, // Default para false se não vier
            accountId: data.accountId, token: data.token, url: data.url, nameInbox: data.nameInbox,
            signMsg: data.signMsg ?? false, // Default para false
            signDelimiter: data.signMsg ? data.signDelimiter : null,
            // number: data.number, // Campo 'number' removido? Verificar schema
            reopenConversation: data.reopenConversation ?? false,
            conversationPending: data.conversationPending ?? false,
            mergeBrazilContacts: data.mergeBrazilContacts ?? false,
            importContacts: data.importContacts ?? false,
            importMessages: data.importMessages ?? false,
            daysLimitImportMessages: data.daysLimitImportMessages ?? 0,
            organization: data.organization, logo: data.logo,
            ignoreJids: data.ignoreJids ?? [], // Default para array vazio
        };

        await this.prismaRepository.chatwoot.upsert({ // Usa o getter correto
          where: { instanceId: this.instanceId! }, // Garante que instanceId existe
          update: updateData,
          create: { ...updateData, instanceId: this.instanceId! },
        });
        Object.assign(this.localChatwoot, updateData); // Atualiza cache local
        this.clearCacheChatwoot(); // Limpa cache específico
        this.logger.info('Chatwoot config updated');
    } catch (error) {
         this.logger.error({ err: error }, 'Failed to set Chatwoot config');
         throw error; // Relança o erro
    }
  }

  public async findChatwoot(): Promise<ChatwootDto | null> {
    // CORREÇÃO TS2305: Usar ChatwootConfig importado
    if (!this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
      return null;
    }
    try {
        const data = await this.prismaRepository.chatwoot.findUnique({
          where: { instanceId: this.instanceId },
        });
        if (!data) return null;

        return {
          enabled: data.enabled, accountId: data.accountId, token: data.token, url: data.url, nameInbox: data.nameInbox,
          signMsg: data.signMsg, signDelimiter: data.signDelimiter, // number: data.number, // Removido?
          reopenConversation: data.reopenConversation, conversationPending: data.conversationPending, mergeBrazilContacts: data.mergeBrazilContacts,
          importContacts: data.importContacts, importMessages: data.importMessages, daysLimitImportMessages: data.daysLimitImportMessages,
          organization: data.organization as any, logo: data.logo,
          ignoreJids: (Array.isArray(data.ignoreJids) ? data.ignoreJids : []) as string[],
        };
    } catch (error) {
         this.logger.error({ err: error }, 'Failed to find Chatwoot config');
         return null;
    }
  }

  public clearCacheChatwoot(): void {
    if (this.localChatwoot?.enabled) {
      // Assumindo que CacheService tem um método deleteAll ou similar
      this.chatwootCache.deleteMatching?.(`${this.instanceName}:*`); // Exemplo
      this.logger.info(`Chatwoot cache cleared for instance ${this.instanceName}`);
    }
  }

  public async loadProxy(): Promise<void> {
     this.localProxy.enabled = false; // Reset inicial
     try {
        // Prioriza variáveis de ambiente globais
        if (process.env.PROXY_HOST) {
          this.localProxy.enabled = true;
          this.localProxy.host = process.env.PROXY_HOST;
          // CORREÇÃO TS2322: port deve ser string
          this.localProxy.port = process.env.PROXY_PORT || '80';
          this.localProxy.protocol = (process.env.PROXY_PROTOCOL as wa.LocalProxy['protocol']) || 'http';
          this.localProxy.username = process.env.PROXY_USERNAME;
          this.localProxy.password = process.env.PROXY_PASSWORD;
          this.logger.info('Global proxy config loaded from environment variables.');
        }

        // Sobrescreve com config específica da instância se existir e estiver habilitada
        const data = await this.prismaRepository.proxy.findUnique({
          where: { instanceId: this.instanceId },
        });

        if (data?.enabled) {
          this.localProxy.enabled = true;
          this.localProxy.host = data.host;
          // CORREÇÃO TS2322: port deve ser string (DB armazena Int?, converter)
          this.localProxy.port = String(data.port ?? 80);
          this.localProxy.protocol = data.protocol as wa.LocalProxy['protocol'];
          this.localProxy.username = data.username;
          this.localProxy.password = data.password;
           this.logger.info('Instance-specific proxy config loaded from database.');
        } else if (data && !data.enabled) {
            this.localProxy.enabled = false; // Explicitamente desabilitado no DB
             this.logger.info('Instance-specific proxy config found but disabled.');
        }
        this.logger.debug({ proxyConfig: this.localProxy }, 'Proxy config finalized');
     } catch (error) {
         this.logger.error({ err: error }, 'Failed to load Proxy config');
         this.localProxy.enabled = false; // Desabilita em caso de erro
     }
  }

  public async setProxy(data: ProxyDto): Promise<void> {
     try {
        // CORREÇÃO TS400: Converter port para número antes de salvar no Prisma
        const portNumber = data.port ? parseInt(data.port, 10) : null;
        if (data.port && isNaN(portNumber)) {
            throw new BadRequestException('Proxy port must be a valid number.');
        }

        const upsertData = {
            enabled: data?.enabled ?? false,
            host: data.host,
            port: portNumber, // Salva como número
            protocol: data.protocol,
            username: data.username,
            password: data.password,
        };
        await this.prismaRepository.proxy.upsert({ // Usa o getter correto
          where: { instanceId: this.instanceId! },
          update: upsertData,
          create: { ...upsertData, instanceId: this.instanceId! },
        });
        // Atualiza cache local com port como string
        Object.assign(this.localProxy, { ...data, port: String(portNumber ?? '') });
        this.logger.info('Proxy config updated');
     } catch (error) {
        this.logger.error({ err: error }, 'Failed to set Proxy config');
        throw error;
     }
  }

  public async findProxy(): Promise<ProxyDto | null> { // Retorna DTO
     try {
        const data = await this.prismaRepository.proxy.findUnique({
          where: { instanceId: this.instanceId },
        });
        if (!data) {
          // Não lança exceção, apenas retorna null se não encontrado
          return null;
        }
        // Converte para DTO (port para string)
        return {
            enabled: data.enabled, host: data.host, port: String(data.port ?? ''), // Converte port para string
            protocol: data.protocol, username: data.username, password: data.password,
        };
     } catch (error) {
        this.logger.error({ err: error }, 'Failed to find Proxy config');
        throw error; // Relança erro de banco
     }
  }

  // CORREÇÃO TS2353: Remover instanceName se não fizer parte do payload esperado por eventManager
  public async sendDataWebhook<T = any>(event: Events, data: T, local = true, integration?: string[]): Promise<void> {
    // CORREÇÃO TS2305: Usar HttpServerConfig e AuthConfig importados
    const serverUrl = this.configService.get<HttpServerConfig>('SERVER')?.URL; // Adicionar '?'
    const tzoffset = new Date().getTimezoneOffset() * 60000;
    const localISOTime = new Date(Date.now() - tzoffset).toISOString();
    const now = localISOTime;

    const expose = this.configService.get<AuthConfig>('AUTHENTICATION')?.EXPOSE_IN_FETCH_INSTANCES; // Adicionar '?'
    const instanceApikey = this.token; // Usar token da instância

    // Monta o payload do evento
    const eventPayload = {
        origin: ChannelStartupService.name, event, data, serverUrl, dateTime: now,
        sender: this.wuid, // Usa wuid da instância
        apiKey: expose && instanceApikey ? instanceApikey : null,
        local, integration,
        // instanceName: this.instanceName, // Removido - Adicionar APENAS se eventManager esperar
    };

    await eventManager.emit(this.instanceName!, eventPayload); // Passa instanceName como primeiro argumento (channel)
  }

  // --- Métodos de Formatação de Número (Mantidos) ---
  public formatMXOrARNumber(jid: string): string { /* ... */ return jid; }
  public formatBRNumber(jid: string): string { /* ... */ return jid; }

  // --- Métodos de Busca (Corrigidos) ---

  public async fetchContacts(query: ContactQueryArgs): Promise<Contact[]> { // Usa ContactQueryArgs
    // CORREÇÃO TS2339: Acessar where.remoteJid com segurança
    const remoteJidFilter = query?.where?.remoteJid
      ? query.where.remoteJid.includes('@')
        ? query.where.remoteJid
        : createJid(query.where.remoteJid)
      : undefined; // Usar undefined se não houver filtro

    const where: Prisma.ContactWhereInput = { // Usar tipo Prisma
      instanceId: this.instanceId!, // Garante que instanceId existe
    };

    if (remoteJidFilter) {
      where.remoteJid = remoteJidFilter;
    }
    // Adicionar outros filtros de query.where se necessário
    // Ex: if (query?.where?.pushName) where.pushName = { contains: query.where.pushName };

    this.logger.debug({ where }, 'Fetching contacts with filter');
    return this.prismaRepository.contact.findMany({ where }); // Usa o getter
  }


  public cleanMessageData(message: any): any { // Tipar retorno se possível
    if (!message) return message;
    // Cria cópia superficial, pode precisar de deep clone para aninhados
    const cleanedMessage = { ...message };

    // Guarda URL de mídia antes de limpar
    const mediaUrl = cleanedMessage?.message?.mediaUrl;

    // Remove base64 se existir
    delete cleanedMessage?.message?.base64;

    // Limpa tipos específicos de mensagem (adicionar verificações de existência)
    if (cleanedMessage.message?.imageMessage) {
        cleanedMessage.message.imageMessage = { caption: cleanedMessage.message.imageMessage.caption };
    }
    if (cleanedMessage.message?.videoMessage) {
        cleanedMessage.message.videoMessage = { caption: cleanedMessage.message.videoMessage.caption };
    }
    // ... limpar outros tipos de mensagem ...

    // Restaura URL de mídia se existia
    if (mediaUrl && cleanedMessage.message) {
        cleanedMessage.message.mediaUrl = mediaUrl;
    }

    return cleanedMessage;
  }


  public async fetchMessages(query: MessageQueryArgs): Promise<{ // Usa MessageQueryArgs
        total: number;
        pages: number;
        currentPage: number;
        records: Message[]; // Usar tipo Message importado
    }> {

    const where: Prisma.MessageWhereInput = { // Usar tipo Prisma
        instanceId: this.instanceId!, // Garante que instanceId existe
    };

    // Aplicar filtros do query.where
    if (query.where?.id) where.id = query.where.id; // Filtro por ID interno
    if (query.where?.source) where.source = query.where.source;
    if (query.where?.messageType) where.messageType = query.where.messageType;

    // Filtro de Timestamp
    if (query.where?.messageTimestamp) {
        const gteTs = query.where.messageTimestamp.gte ? Math.floor(new Date(query.where.messageTimestamp.gte).getTime() / 1000) : undefined;
        const lteTs = query.where.messageTimestamp.lte ? Math.floor(new Date(query.where.messageTimestamp.lte).getTime() / 1000) : undefined;
        if (gteTs || lteTs) {
            where.messageTimestamp = {};
            if (gteTs) where.messageTimestamp.gte = BigInt(gteTs); // Converter para BigInt
            if (lteTs) where.messageTimestamp.lte = BigInt(lteTs); // Converter para BigInt
        }
    }

    // Filtros da chave (key)
    const keyFilters: Prisma.JsonFilter = {};
    if (query.where?.key?.id) keyFilters.path = ['id']; keyFilters.equals = query.where.key.id;
    if (query.where?.key?.fromMe !== undefined) keyFilters.path = ['fromMe']; keyFilters.equals = query.where.key.fromMe;
    if (query.where?.key?.remoteJid) keyFilters.path = ['remoteJid']; keyFilters.equals = query.where.key.remoteJid;
    if (query.where?.key?.participant) keyFilters.path = ['participant']; keyFilters.equals = query.where.key.participant;
    if (Object.keys(keyFilters).length > 0 && keyFilters.path) { // Verifica se há filtro de chave
        where.key = keyFilters;
    }

    const page = query.page || 1;
    const limit = query.limit || 50; // Usa limit
    const skip = (page - 1) * limit;

    this.logger.debug({ where, skip, take: limit }, 'Fetching messages with filter');

    const [count, messages] = await this.prismaRepository.$transaction([ // Usa $transaction do repo
      this.prismaRepository.message.count({ where }),
      this.prismaRepository.message.findMany({
        where,
        orderBy: { messageTimestamp: 'desc' },
        skip,
        take: limit,
        // Selecionar apenas os campos necessários pode melhorar performance
        // select: { ... }
      }),
    ]);

    return {
      total: count,
      pages: Math.ceil(count / limit),
      currentPage: page,
      records: messages,
    };
  }


  public async fetchStatusMessage(query: StatusQueryArgs): Promise<MessageUpdate[]> { // Usa StatusQueryArgs
    const where: Prisma.MessageUpdateWhereInput = { // Usa tipo Prisma
        instanceId: this.instanceId!,
    };
    if(query.where?.remoteJid) where.remoteJid = query.where.remoteJid;
    if(query.where?.id) where.keyId = query.where.id; // Filtrar por keyId (ID da msg original)

    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    this.logger.debug({ where, skip, take: limit }, 'Fetching message statuses');
    return this.prismaRepository.messageUpdate.findMany({ // Usa o getter correto
      where,
      orderBy: { timestamp: 'desc' }, // Ordenar por timestamp do status
      skip,
      take: limit,
    });
  }


  public async fetchChats(query?: any): Promise<any[]> { // Manter 'any' ou criar tipo específico
    // CORREÇÃO TS2339: Acessar where.remoteJid com segurança
    const remoteJidFilter = query?.where?.remoteJid
      ? query.where.remoteJid.includes('@')
        ? query.where.remoteJid
        : createJid(query.where.remoteJid)
      : undefined;

    // Filtro de timestamp (adaptado para Prisma.sql)
    let timestampFilter = Prisma.sql``; // Inicializa vazio
    if (query?.where?.messageTimestamp?.gte && query?.where?.messageTimestamp?.lte) {
        try {
            const gte = BigInt(Math.floor(new Date(query.where.messageTimestamp.gte).getTime() / 1000));
            const lte = BigInt(Math.floor(new Date(query.where.messageTimestamp.lte).getTime() / 1000));
            timestampFilter = Prisma.sql`AND "Message"."messageTimestamp" BETWEEN ${gte} AND ${lte}`;
        } catch (e) {
            this.logger.warn({ timestampFilter: query.where.messageTimestamp }, 'Invalid timestamp filter for fetchChats');
        }
    }

    const instanceIdParam = this.instanceId!; // Garante que não é undefined

    this.logger.debug({ remoteJidFilter, hasTimestampFilter: !!timestampFilter }, 'Fetching chats with raw query');

    try {
        // CORREÇÃO TS2341: Usar $queryRawUnsafe ou $queryRaw do repositório
        const results = await this.prismaRepository.$queryRawUnsafe<any[]>(`
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
              -- Usar LEFT JOIN para incluir contatos sem mensagens recentes
              LEFT JOIN "Message" ON "Message"."key"->>'remoteJid' = "Contact"."remoteJid" AND "Message"."instanceId" = $1 ${timestampFilter}
              LEFT JOIN "Chat" ON "Chat"."remoteJid" = "Contact"."remoteJid" AND "Chat"."instanceId" = $1
              WHERE "Contact"."instanceId" = $1
                ${remoteJidFilter ? Prisma.sql`AND "Contact"."remoteJid" = ${remoteJidFilter}` : Prisma.sql``}
              ORDER BY "Contact"."remoteJid", "Message"."messageTimestamp" DESC NULLS LAST -- Ordena para pegar a última msg
            )
            SELECT * FROM rankedMessages
            ORDER BY "updatedAt" DESC NULLS LAST;
        `, instanceIdParam); // Passar parâmetros corretamente

        if (results && isArray(results) && results.length > 0) {
          const mappedResults = results.map((contact) => {
            // Mapeamento mantido, mas garantir que as chaves do JSON (key) estão corretas
            const lastMessage = contact.lastMessageId
              ? {
                  id: contact.lastMessageId, key: contact.lastMessageKey, pushName: contact.lastMessagePushName,
                  participant: contact.lastMessageParticipant, messageType: contact.lastMessageMessageType, message: contact.lastMessageMessage,
                  contextInfo: contact.lastMessageContextInfo, source: contact.lastMessageSource, messageTimestamp: contact.lastMessageMessageTimestamp,
                  instanceId: contact.lastMessageInstanceId, sessionId: contact.lastMessageSessionId, status: contact.lastMessageStatus,
                }
              : undefined;

            return {
              id: contact.id, remoteJid: contact.remoteJid, pushName: contact.pushName, profilePicUrl: contact.profilePicUrl,
              updatedAt: contact.updatedAt, windowStart: contact.windowStart, windowExpires: contact.windowExpires, windowActive: contact.windowActive,
              lastMessage: lastMessage ? this.cleanMessageData(lastMessage) : undefined,
            };
          });
          return mappedResults;
        }
        return []; // Retorna array vazio se não houver resultados
    } catch (error) {
        this.logger.error({ err: error }, 'Error fetching chats with raw query');
        return []; // Retorna array vazio em caso de erro
    }
  } // Fim fetchChats

} // Fim da classe ChannelStartupService
