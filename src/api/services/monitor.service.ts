// Arquivo: src/api/services/monitor.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs e Tipos
import { InstanceDto, CreateInstanceDto } from '@api/dto/instance.dto'; // Ajustar path/alias se necessário
import { Events } from '@api/types/wa.types'; // Ajustar path/alias se necessário
// CORRIGIDO TS2305: Importar Integration e Prisma do client
import { Integration, Prisma, Instance as PrismaInstance } from '@prisma/client';

// Imports de Serviços, Repositórios, Config
import { ProviderFiles } from '@provider/sessions'; // Ajustar path/alias se necessário
import { PrismaRepository } from '@repository/repository.service'; // Ajustar path/alias se necessário
// CORRIGIDO: Importar o controller que REALMENTE cria a instância (ChannelController foi usado antes)
import { ChannelController } from '@api/integrations/channel/channel.controller'; // Ajustar path/alias se necessário
// CORRIGIDO TS2305: Importar tipos de configuração corretamente (verificar nomes exatos em env.config.ts)
import { ConfigService, CacheConf, ChatwootConfig, DatabaseConfig, DelInstanceConfig, ProviderSession as ProviderSessionConfig } from '@config/env.config'; // Ajustado ProviderSessionConfig
import { Logger } from '@config/logger.config'; // Ajustar path/alias se necessário
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config'; // Ajustar path/alias se necessário
// CORRIGIDO TS2304: Importar Exceptions
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index'; // Ajustar path/alias se necessário
import { CacheService } from './cache.service'; // Import local OK
import { ChannelStartupService } from './channel.service'; // Importar classe base para tipagem

// Imports Node.js e Libs Externas
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';
// CORRIGIDO TS2307: Importar delay
import { delay } from '@whiskeysockets/baileys';
// CORRIGIDO TS2304: Importar v4 as uuidv4 para evitar conflito potencial
import { v4 as uuidv4 } from 'uuid';


// Tipagem para o payload retornado por instanceInfo
type InstanceInfoPayload = Prisma.InstanceGetPayload<{
  include: {
    Chatwoot: true, Proxy: true, Rabbitmq: true, Sqs: true, Websocket: true, Setting: true,
    Dify: true, EvolutionBot: true, Flowise: true,
    OpenaiBot: { include: { creds: true, setting: true } },
    Typebot: true, Pusher: true,
    // CORRIGIDO TS2561: Usar nomes de relação corretos (geralmente plural)
    _count: { select: { messages: true, contacts: true, chats: true, labels: true } }
  }
}>;


export class WAMonitoringService {
  private readonly logger: Logger; // Logger agora é injetado ou criado com base injetada

  // Armazena as instâncias ativas (usando a classe base como tipo)
  public readonly waInstances: Record<string, ChannelStartupService> = {};

  // Configurações locais cacheadas (tipadas)
  private readonly dbConfig: Partial<DatabaseConfig> = {};
  private readonly cacheConfig: Partial<CacheConf> = {}; // Renomeado para evitar conflito
  private readonly providerSessionConfig: ProviderSessionConfig | undefined;
  private readonly delInstanceConfig: DelInstanceConfig | undefined;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly providerFiles: ProviderFiles, // Serviço para gerenciar arquivos de sessão (se habilitado)
    private readonly cacheService: CacheService, // Cache principal (Redis ou Local)
    // Remover caches específicos se não usados diretamente aqui
    // private readonly chatwootCache: CacheService,
    // private readonly baileysCache: CacheService,
    // Injetar o ChannelController para criar instâncias específicas
    private readonly channelController: ChannelController,
    baseLogger: Logger, // Injetar logger base
  ) {
    // CORRIGIDO TS2339: Usar baseLogger.child para criar logger filho
    this.logger = baseLogger.child({ context: WAMonitoringService.name });
    this.logger.info('Iniciando WAMonitoringService...');

    // Carrega configurações relevantes
    Object.assign(this.dbConfig, this.configService.get<DatabaseConfig>('DATABASE') || {});
    Object.assign(this.cacheConfig, this.configService.get<CacheConf>('CACHE') || {});
    this.providerSessionConfig = this.configService.get<ProviderSessionConfig>('PROVIDER');
    this.delInstanceConfig = this.configService.get<DelInstanceConfig>('DEL_INSTANCE');

    this.setupInternalEventListeners();
    this.logger.info('WAMonitoringService iniciado e listeners configurados.');

    // Carregar instâncias após o serviço estar pronto
    // Atraso opcional para permitir que outros serviços (ex: DB) iniciem completamente
    setTimeout(() => {
        this.loadInstance().catch(err => this.logger.error({ err }, 'Erro inicial ao carregar instâncias'));
    }, 1000); // Delay de 1 segundo (ajustar se necessário)

  }

  /** Configura listeners para eventos de remoção/logout */
  private setupInternalEventListeners(): void {
    this.eventEmitter.on('remove.instance', async (instanceName: string, reason?: string) => {
       this.logger.info(`Evento 'remove.instance' recebido para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       await this.remove(instanceName);
    });

    this.eventEmitter.on('logout.instance', async (instanceName: string, reason?: string) => {
      this.logger.info(`Evento 'logout.instance' recebido para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       try {
         const instance = this.waInstances[instanceName];
         if (!instance) {
             this.logger.warn(`Tentativa de logout em instância não monitorada: ${instanceName}`);
             return;
         };

         await instance.sendDataWebhook?.(Events.LOGOUT_INSTANCE, { instanceName, reason });

         // Limpar cache Chatwoot se habilitado e método existir
         if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
           await instance.clearCacheChatwoot?.();
         }
         // Realiza apenas a limpeza de sessão/cache, não remove do DB nem arquivos
         await this.cleaningUp(instanceName);
         // Define o estado como 'close' internamente
         if (instance.stateConnection) instance.stateConnection.connection = 'close';

       } catch (e: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
         this.logger.error({ err: e }, `Erro durante processamento do evento logout.instance para "${instanceName}"`);
       }
    });

    this.eventEmitter.on('no.connection', async (instanceName: string) => {
       this.logger.warn(`Evento 'no.connection' recebido para: ${instanceName}. Limpando estado.`);
      try {
        const current = this.waInstances[instanceName];
        if (!current) return;

        // Tenta forçar logout e fechar conexão (melhor esforço)
        await current.client?.logout?.(`Logout forçado devido a evento 'no.connection' para ${instanceName}`);
        current.client?.ws?.close?.();
        // current.client?.end?.(undefined); // 'end' pode causar erros se chamado em estado incorreto

        // Reseta estado interno
        // CORRIGIDO TS2322: qrcode é um objeto
        if (current.instance) current.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };
        // CORRIGIDO TS2339: Usar connectionState e connection
        if (current.connectionState) current.connectionState.connection = 'close';

        // Atualiza status no DB para 'close'
        await this.prismaRepository.instance.updateMany({
            where: { name: instanceName }, // CORREÇÃO: Usar 'name' se for o campo correto
            data: { connectionStatus: 'close' }
        });

      } catch (error: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
        this.logger.error({ err: error }, `Erro durante limpeza de 'no.connection' para "${instanceName}"`);
      } finally {
        this.logger.warn(`Estado definido como 'close' para instância "${instanceName}" após evento 'no.connection'.`);
      }
    });
  }

  /** Retorna uma instância ativa pelo nome */
  public get(instanceName: string): ChannelStartupService | undefined {
    return this.waInstances[instanceName];
  }

  /** Remove e limpa uma instância (memória, cache, sessão, arquivos, DB) */
  // Renomeado para deleteAccount para clareza da ação destrutiva
  public async deleteAccount(instanceName: string): Promise<{success: boolean; message?: string}> {
     this.logger.info(`Removendo completamente a conta/instância "${instanceName}"...`);
     const instance = this.waInstances[instanceName];
     let deleted = false;

      try {
        if (instance) {
            this.logger.debug(`Instância ${instanceName} encontrada no monitor. Enviando webhook e desconectando...`);
            await instance.sendDataWebhook?.(Events.REMOVE_INSTANCE, { instanceName });
            // Chama logoutInstance da instância específica para desconectar corretamente
            await instance.logoutInstance?.(true); // Passa true para destruir o cliente
            await delay(500); // Pequeno delay
            deleted = true; // Marcado como deletado da memória
        } else {
             this.logger.warn(`Instância ${instanceName} não encontrada no monitor para remoção.`);
             // Mesmo não estando no monitor, tenta limpar dados persistidos
        }
        // Limpa dados de sessão e cache
        await this.cleaningUp(instanceName);
        // Limpa dados do DB e arquivos de store (ação mais destrutiva)
        await this.cleaningStoreData(instanceName);
      } catch (e: any) {
        // CORRIGIDO TS2554: Passar objeto de erro
        this.logger.error({ err: e }, `Erro durante a remoção completa da instância "${instanceName}"`);
        // Mesmo em caso de erro, tenta remover da memória
      } finally {
        // Remove da memória APENAS se estava lá
        if (instance) {
            delete this.waInstances[instanceName];
            this.logger.info(`Instância "${instanceName}" removida do monitor.`);
        } else if (deleted) {
            // Caso raro onde a instância foi encontrada mas houve erro antes do delete this.waInstances
            delete this.waInstances[instanceName];
            this.logger.info(`Instância "${instanceName}" removida do monitor após erro parcial.`);
        }
      }
      // Retorna sucesso se ao menos tentou limpar os dados persistidos
      // (pode ter falhado em deletar do DB se já não existia)
      return { success: true, message: `Processo de remoção da instância ${instanceName} concluído.` };
  }


  /** Configura timeout para deletar instância inativa */
  public delInstanceTime(instanceName: string): void {
    const time = this.delInstanceConfig?.TIME;
    const checkStatus = this.delInstanceConfig?.CHECK_STATUS ?? true;

    if (typeof time === 'number' && time > 0) {
      this.logger.info(`Agendando verificação de inatividade para "${instanceName}" em ${time} minutos.`);
      setTimeout(async () => {
        const current = this.waInstances[instanceName];
        // CORRIGIDO TS2339: Usar connectionState.connection
        const isConnected = current?.connectionState?.connection === 'open';

        // Remove se:
        // 1. Instância não existe mais no monitor OU
        // 2. checkStatus é true E a instância não está conectada ('open')
        if (!current || (checkStatus && !isConnected)) {
          this.logger.warn(`Instância "${instanceName}" ${!current ? 'não encontrada' : `inativa (${current.connectionState?.connection})`} após ${time} minutos. Removendo...`);
          // CORREÇÃO: Usar deleteAccount para remoção completa
          await this.deleteAccount(instanceName);
        } else {
           this.logger.info(`Instância "${instanceName}" está ativa (${current.connectionState?.connection}). Remoção por inatividade cancelada.`);
        }
      }, 1000 * 60 * time);
    }
  }

  /** Busca informações de instâncias no DB */
  public async instanceInfo(instanceNames?: string[]): Promise<InstanceInfoPayload[]> {
    const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    const whereClause: Prisma.InstanceWhereInput = {};
    // Adiciona clientName ao where se estiver definido
    if (clientName) {
        whereClause.clientName = clientName;
    }

    if (instanceNames?.length) {
      // CORREÇÃO: Usar 'name' se for o campo correto no schema Prisma para o nome da instância
      whereClause.name = { in: instanceNames };
      const missing = instanceNames.filter((name) => !this.waInstances[name]);
      if (missing.length > 0) {
        this.logger.warn(`Buscando info de instâncias não monitoradas ativamente: ${missing.join(', ')}`);
      }
    } else if (!clientName && !instanceNames?.length) {
       this.logger.warn('Buscando todas as instâncias do DB (sem filtro por clientName).');
    }

    // CORRIGIDO TS2554: Passar objeto para logger
    this.logger.debug({ where: whereClause }, `Buscando instâncias no DB`);

    const includeClause: Prisma.InstanceInclude = {
        Chatwoot: true, Proxy: true, Rabbitmq: true, Sqs: true, Websocket: true, Setting: true,
        Dify: true, EvolutionBot: true, Flowise: true,
        OpenaiBot: { include: { creds: true, setting: true } },
        Typebot: true, Pusher: true,
        // CORRIGIDO TS2561: Usar nomes de relação corretos (plural)
        _count: { select: { messages: true, contacts: true, chats: true, labels: true } }
    };

    // CORRIGIDO TS2322: O retorno já deve ser do tipo correto se o include estiver certo
    const instances: InstanceInfoPayload[] = await this.prismaRepository.instance.findMany({
      where: whereClause,
      include: includeClause,
    });
    return instances;
  }

  /** Busca info por ID da instância ou número */
  public async instanceInfoById(instanceId?: string, number?: string): Promise<InstanceInfoPayload[]> {
      this.logger.debug(`Buscando instância por ID: ${instanceId} ou Número: ${number}`);
      let whereClause: Prisma.InstanceWhereUniqueInput | Prisma.InstanceWhereInput = {};

      if (instanceId) {
          whereClause = { id: instanceId }; // Assuming ID is unique
      } else if (number) {
           // CORREÇÃO: Usar 'name' ou 'number' conforme o schema. Assumindo 'number' é único.
           whereClause = { number: number };
      } else {
          throw new BadRequestException('É necessário fornecer instanceId ou number.');
      }

      // Busca o nome da instância primeiro para garantir que existe
      const instanceDb = await this.prismaRepository.instance.findFirst({
          where: whereClause,
          select: { name: true }
      });

      const instanceName = instanceDb?.name;
      if (!instanceName) {
          throw new NotFoundException(`Instância com ${instanceId ? `ID ${instanceId}` : `Número ${number}`} não encontrada.`);
      }
      if (!this.waInstances[instanceName]) {
          this.logger.warn(`Instância "${instanceName}" encontrada no DB mas não está ativa no monitor.`);
      }
      // Usa o método instanceInfo para buscar os dados completos com includes
      return this.instanceInfo([instanceName]);
  }

  /** Limpa dados de sessão e cache (não remove do DB principal ou arquivos) */
  public async cleaningUp(instanceName: string): Promise<void> {
    this.logger.info(`Limpando sessão/cache para instância "${instanceName}"...`);
    let instanceDbId: string | undefined;

    if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
      // CORREÇÃO: Usar 'name' se for a chave única
      const found = await this.prismaRepository.instance.findUnique({
        where: { name: instanceName }, select: { id: true }
       });
      instanceDbId = found?.id; // Pode ser undefined se não encontrar
      if (instanceDbId) {
        // CORRIGIDO TS2552 / Lógica: Usar instanceDbId corretamente
        await this.prismaRepository.session.deleteMany({ where: { instanceId: instanceDbId } });
        this.logger.debug(`Sessão do DB deletada para instanceId: ${instanceDbId}`);
        // Não alterar status aqui, pois cleaningUp é chamado durante logout também
        // await this.prismaRepository.instance.update({ where: { id: instanceDbId }, data: { connectionStatus: 'close' }});
      } else {
           this.logger.warn(`Instância "${instanceName}" não encontrada no DB para limpeza de sessão.`);
      }
    }

    if (this.cacheConfig?.REDIS?.ENABLED && this.cacheConfig?.REDIS?.SAVE_INSTANCES) {
      // Limpa pelo nome e pelo ID (se encontrado)
      await this.cacheService?.delete?.(instanceName);
      if (instanceDbId) await this.cacheService?.delete?.(instanceDbId);
      this.logger.debug(`Cache Redis limpo para "${instanceName}" e ID "${instanceDbId || 'N/A'}"`);
    }

    // CORREÇÃO TS2339: Verificar se providerFiles e removeSession existem
    if (this.providerSessionConfig?.ENABLED && typeof this.providerFiles?.removeSession === 'function') {
      await this.providerFiles.removeSession(instanceName);
      this.logger.debug(`Sessão do Provider limpa para "${instanceName}"`);
    } else if (this.providerSessionConfig?.ENABLED) {
       this.logger.warn(`Provider habilitado mas providerFiles.removeSession não está disponível.`);
    }
     this.logger.info(`Limpeza de sessão/cache para "${instanceName}" concluída.`);
  }

  /** Limpa TODOS os dados da instância, incluindo DB e arquivos - AÇÃO DESTRUTIVA! */
  public async cleaningStoreData(instanceName: string): Promise<void> {
     this.logger.warn(`ATENÇÃO: Limpando TODOS os dados (DB e arquivos) para instância "${instanceName}"...`);

     const storeDir = STORE_DIR || './storage';
     if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
        const chatwootPath = join(storeDir, 'chatwoot', instanceName); // Remover '*' para diretório exato
        this.logger.debug(`Removendo diretório Chatwoot: ${chatwootPath}`);
        try { rmSync(chatwootPath, { recursive: true, force: true }); } catch (e:any) { /* CORRIGIDO TS2554 */ this.logger.error({ err: e }, `Erro ao remover pasta Chatwoot (${chatwootPath})`); }
     }

     const instance = await this.prismaRepository.instance.findUnique({
        // CORREÇÃO: Usar 'name' se for a chave única
        where: { name: instanceName }, select: { id: true }
    });
    if (!instance?.id) {
        this.logger.error(`Instância "${instanceName}" não encontrada no DB para limpeza completa. Abortando limpeza de dados.`);
        return;
    }
    const instanceId = instance.id;

    const instanceDir = INSTANCE_DIR || './instances';
    // CORREÇÃO: Usar instanceName para a pasta local, se essa for a convenção
    const instancePath = join(instanceDir, instanceName);
    this.logger.debug(`Removendo diretório da instância local: ${instancePath}`);
    // CORRIGIDO TS2554: Passar objeto de erro
    try { rmSync(instancePath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e }, `Erro ao remover pasta da instância (${instancePath})`); }

    this.logger.info(`Deletando dados do DB para instanceId: ${instanceId}`);
    try {
        // CORREÇÃO TS2561 / TS2339: Usar instanceId e nomes de modelo corretos
        // CORREÇÃO: Verificar se whatsappIntegration existe no schema
        // CORREÇÃO: Usar where na relação para openaiCreds e openaiSetting
        await this.prismaRepository.client.$transaction([
            this.prismaRepository.session.deleteMany({ where: { instanceId } }),
            this.prismaRepository.messageUpdate.deleteMany({ where: { instanceId } }),
            this.prismaRepository.media.deleteMany({ where: { instanceId } }),
            this.prismaRepository.message.deleteMany({ where: { instanceId } }),
            this.prismaRepository.labelAssociation.deleteMany({ where: { instanceId } }), // Deletar associações primeiro
            this.prismaRepository.label.deleteMany({ where: { instanceId } }),
            this.prismaRepository.chat.deleteMany({ where: { instanceId } }),
            this.prismaRepository.contact.deleteMany({ where: { instanceId } }),
            this.prismaRepository.webhook.deleteMany({ where: { instanceId } }),
            this.prismaRepository.chatwoot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.proxy.deleteMany({ where: { instanceId } }),
            this.prismaRepository.rabbitmq.deleteMany({ where: { instanceId } }),
            this.prismaRepository.sqs.deleteMany({ where: { instanceId } }),
            this.prismaRepository.pusher.deleteMany({ where: { instanceId } }),
            // this.prismaRepository.websocket.deleteMany({ where: { instanceId } }), // Verificar se modelo existe
            this.prismaRepository.integrationSession.deleteMany({ where: { instanceId } }),
            this.prismaRepository.difySetting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.dify.deleteMany({ where: { instanceId } }),
            this.prismaRepository.evolutionBotSetting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.evolutionBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.flowiseSetting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.flowise.deleteMany({ where: { instanceId } }),
            // Deletar credenciais/settings antes do bot principal
            this.prismaRepository.openaiCreds.deleteMany({ where: { openaiBots: { some: { instanceId } } } }),
            this.prismaRepository.openaiSetting.deleteMany({ where: { openaiBot: { instanceId } } }),
            this.prismaRepository.openaiBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.typebotSetting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.typebot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.setting.deleteMany({ where: { instanceId } }),
            // this.prismaRepository.whatsappIntegration?.deleteMany?.({ where: { instanceId } }), // Verificar se existe
            // Deleta a instância principal por último
            this.prismaRepository.instance.delete({ where: { id: instanceId } })
        ]);
        this.logger.info(`Dados do DB para instanceId ${instanceId} deletados com sucesso.`);
    } catch (dbError: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
         this.logger.error({ err: dbError }, `Erro ao deletar dados do DB para instanceId ${instanceId}`);
    }
  }

  /** Carrega instâncias existentes ao iniciar */
  public async loadInstance(): Promise<void> {
    this.logger.info('Carregando instâncias existentes...');
    try {
      if (this.providerSessionConfig?.ENABLED) {
        this.logger.info('Carregando instâncias do Provider...');
        await this.loadInstancesFromProvider();
      } else if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
         this.logger.info('Carregando instâncias do Banco de Dados...');
        await this.loadInstancesFromDatabase();
      } else if (this.cacheConfig?.REDIS?.ENABLED && this.cacheConfig?.REDIS?.SAVE_INSTANCES) {
         this.logger.info('Carregando instâncias do Redis...');
        await this.loadInstancesFromRedis();
      } else {
         this.logger.warn('Nenhum método de persistência de instância habilitado para carregamento inicial.');
      }
       this.logger.info('Carregamento de instâncias concluído.');
    } catch (error: any) {
      // CORRIGIDO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao carregar instâncias`);
    }
  }

  /** Salva/Atualiza instância no DB */
  public async saveInstance(data: InstanceDto & { ownerJid?: string; profileName?: string; profilePicUrl?: string; hash?: string; connectionStatus?: string }): Promise<PrismaInstance | null> {
    if (!this.dbConfig?.SAVE_DATA?.INSTANCE) {
        this.logger.debug('Persistência de instância no DB desabilitada, pulando saveInstance.');
        return null;
    }
    this.logger.info(`Salvando/Atualizando instância no DB: ${data.instanceName}`);
    try {
      const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
      const instanceDataForDb: Prisma.InstanceUpsertArgs = {
          // CORREÇÃO: Usar 'name' se for a chave única
          where: { name: data.instanceName },
          create: {
              id: data.instanceId || undefined, // Permite que o DB gere se não fornecido
              name: data.instanceName,
              owner: data.owner, // Adicionado owner
              ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
              connectionStatus: data.connectionStatus || 'close', // Usa status fornecido ou 'close'
              number: data.number,
              integration: data.integration || Integration.WHATSAPP_BAILEYS, // Usa enum
              token: data.hash || data.token,
              clientName, businessId: data.businessId,
          },
          update: {
              owner: data.owner, // Atualiza owner
              ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
              connectionStatus: data.connectionStatus, // Atualiza status se fornecido
              number: data.number,
              integration: data.integration || Integration.WHATSAPP_BAILEYS, // Usa enum
              token: data.hash || data.token,
              clientName, businessId: data.businessId,
          }
      };
      const saved = await this.prismaRepository.instance.upsert(instanceDataForDb);
      this.logger.info(`Instância "${data.instanceName}" salva/atualizada no DB com ID: ${saved.id}`);
      return saved;
    } catch (error: any) {
       // CORRIGIDO TS2554: Passar objeto de erro
       this.logger.error({ err: error }, `Erro ao salvar/atualizar instância "${data.instanceName}" no DB`);
       throw error; // Relança o erro
    }
  }

   /** Cria e inicializa uma instância de canal */
   // Renomeado para clareza, pois não cria apenas, mas também inicializa e conecta
  public async initializeInstance(instanceData: CreateInstanceDto): Promise<ChannelStartupService | undefined> {
    this.logger.info(`Solicitação para criar/inicializar instância: ${instanceData.instanceName} (Integração: ${instanceData.integration || 'Padrão'})`);

    if (this.waInstances[instanceData.instanceName]) {
        this.logger.warn(`Instância "${instanceData.instanceName}" já existe no monitor. Retornando existente.`);
        return this.waInstances[instanceData.instanceName];
    }

    let instanceId = instanceData.instanceId;
    let dbInstance: PrismaInstance | null = null;

    // Garante registro no DB se habilitado
    if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
         try {
             dbInstance = await this.saveInstance(instanceData); // Reusa saveInstance para upsert
             instanceId = dbInstance?.id;
             if (!instanceId) {
                 throw new Error('Falha ao obter ID da instância do banco de dados.');
             }
             instanceData.instanceId = instanceId; // Atualiza DTO com ID do DB
         } catch(dbError: any) {
              // Log já ocorre em saveInstance
              throw new InternalServerErrorException(`Erro de banco de dados ao preparar instância: ${dbError.message}`);
         }
    } else if (!instanceId) {
         instanceId = uuidv4(); // Gera ID se não persistir no DB
         instanceData.instanceId = instanceId;
         this.logger.warn(`Persistência de instância no DB desabilitada. Usando ID gerado: ${instanceId} para ${instanceData.instanceName}`);
    }

    // Agora tenta inicializar a instância real usando ChannelController
    try {
        // CORREÇÃO TS2551: createInstanceChannel não existe. O método correto é createChannelInstance
        if (!this.channelController || typeof this.channelController.createChannelInstance !== 'function') {
             throw new Error('ChannelController.createChannelInstance não está disponível/definido.');
        }
        // Passa o DTO atualizado (com ID, se veio do DB)
        const instanceService: ChannelStartupService = this.channelController.createChannelInstance(instanceData);

        if (!instanceService) {
            throw new Error('Falha ao criar a instância específica do canal via ChannelController.');
        }
        this.logger.debug(`Instância específica do canal criada para ${instanceData.instanceName}`);

        // Tenta conectar
        // CORREÇÃO TS2339: Usar start() que é o método definido em ChannelStartupService (ou connectToWhatsapp se preferir)
        await instanceService.start?.(); // Chama o método start da instância criada

        this.waInstances[instanceData.instanceName] = instanceService;
        this.logger.info(`Instância "${instanceData.instanceName}" (ID: ${instanceId}) adicionada ao monitor e conexão iniciada.`);
        this.delInstanceTime(instanceData.instanceName); // Agenda verificação de inatividade

        return instanceService;

    } catch (error: any) {
        this.logger.error({ err: error }, `Erro CRÍTICO ao criar/inicializar instância ${instanceData.instanceName}`);
        // Tenta remover do DB se foi criado/atualizado
        if (dbInstance) {
             this.logger.warn(`Tentando remover registro DB para ${instanceData.instanceName} devido à falha na inicialização...`);
             await this.prismaRepository.instance.delete({ where: { id: dbInstance.id } })
                 .catch(e => this.logger.error({ err: e }, `Erro ao deletar instância ${dbInstance.id} do DB após falha`));
        }
        // Garante limpeza de cache/sessão mesmo em falha
        await this.cleaningUp(instanceData.instanceName);
        // Remove da memória se chegou a ser adicionado
        delete this.waInstances[instanceData.instanceName];
        throw new InternalServerErrorException(`Erro ao inicializar instância ${instanceData.instanceName}: ${error.message}`);
    }
  }


  // --- Métodos de Carregamento (Adaptados) ---
  private async loadInstancesFromRedis(): Promise<void> {
    this.logger.info('Carregando instâncias do Redis...');
    try {
        const keys = await this.cacheService.keys(`${this.instanceIdPrefix}*`); // Assume prefixo para instâncias no Redis
        if (!keys || keys.length === 0) {
            this.logger.info('Nenhuma instância encontrada no Redis para carregar.');
            return;
        }
        this.logger.info(`Encontradas ${keys.length} chaves de instância no Redis.`);
        // Implementar lógica para buscar dados de cada chave e chamar initializeInstance
        // Cuidado para não sobrecarregar na inicialização (processar em lotes?)
    } catch(error: any) {
         this.logger.error({ err: error }, 'Erro ao carregar instâncias do Redis');
    }
  }

  private async loadInstancesFromDatabase(): Promise<void> {
    const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    // Não carrega se clientName não estiver definido, para evitar carregar instâncias de outros servers
    if (!clientName) {
        this.logger.warn('DATABASE.CONNECTION.CLIENT_NAME não definido. Não é possível carregar instâncias do DB com segurança.');
        return;
    }
    const instances = await this.prismaRepository.instance.findMany({
        where: { clientName }, // Carrega apenas as deste cliente
        // Seleciona apenas os campos necessários para recriar o DTO
        select: { id: true, name: true, integration: true, token: true, number: true, businessId: true, owner: true }
    });
    this.logger.info(`Encontradas ${instances.length} instâncias no DB para o clientName "${clientName}".`);
    if (!instances.length) return;

    const results = await Promise.allSettled(
      instances.map(async (i) => {
        this.logger.info(`Tentando recarregar instância do DB: ${i.name} (ID: ${i.id})`);
        const instanceDto: CreateInstanceDto = { // Usa CreateInstanceDto
            instanceId: i.id,
            instanceName: i.name,
            integration: i.integration as Integration, // Cast para Enum
            token: i.token,
            number: i.number,
            businessId: i.businessId,
            owner: i.owner, // Inclui owner
            // Não passar qrcode ou status aqui, pois serão definidos na inicialização
         };
         // Reusa initializeInstance para criar, conectar e adicionar ao monitor
         await this.initializeInstance(instanceDto);
      }),
    );
     results.forEach((result, index) => {
        if (result.status === 'rejected') {
            // CORRIGIDO TS2554: Passar objeto de erro
            this.logger.error({ reason: result.reason }, `Falha ao recarregar instância ${instances[index].name} do DB`);
        }
     });
  }

  private async loadInstancesFromProvider(): Promise<void> {
    this.logger.warn('Carregamento de instâncias do Provider não implementado.');
    // Implementar lógica para listar/buscar dados do ProviderFiles e chamar initializeInstance
  }

  // Prefixo para chaves Redis (exemplo)
  private get instanceIdPrefix(): string {
      return `instance:${this.configService.get<string>('SERVER_NAME') || 'default'}:`;
  }


} // Fim da classe WAMonitoringService
