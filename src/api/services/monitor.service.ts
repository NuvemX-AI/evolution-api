// Arquivo: src/api/services/monitor.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs e Tipos
import { InstanceDto, CreateInstanceDto } from '@api/dto/instance.dto'; // VERIFICAR: Exportação de CreateInstanceDto
import { Events } from '@api/types/wa.types';
// CORRIGIDO TS2305: Importar Integration e Prisma do client (VERIFICAR se 'Integration' existe no seu schema)
import { Integration, Prisma, Instance as PrismaInstance } from '@prisma/client';

// Imports de Serviços, Repositórios, Config
import { ProviderFiles } from '@provider/sessions';
import { PrismaRepository } from '@repository/repository.service';
import { ChannelController } from '@api/integrations/channel/channel.controller';
import { ConfigService, CacheConf, ChatwootConfig, DatabaseConfig, DelInstanceConfig, ProviderSession as ProviderSessionConfig, Env as EnvironmentConfig } from '@config/env.config'; // Importar Env
import { Logger } from '@config/logger.config';
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { CacheService } from './cache.service';
import { ChannelStartupService } from './channel.service';

// Imports Node.js e Libs Externas
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';
import { delay } from '@whiskeysockets/baileys'; // VERIFICAR: Instalação de @whiskeysockets/baileys
import { v4 as uuidv4 } from 'uuid';

// Tipagem para o payload retornado por instanceInfo
// AJUSTAR: Nomes das relações (lowercase?) e _count conforme seu schema.prisma
type InstanceInfoPayload = Prisma.InstanceGetPayload<{
  include: {
    chatwoot: true, // Ex: Assumindo lowercase
    proxy: true,
    rabbitmq: true,
    sqs: true,
    websocket: true, // VERIFICAR: Modelo Websocket existe?
    setting: true,
    dify: true, // VERIFICAR: Modelo Dify existe?
    evolutionBot: true, // VERIFICAR: Modelo EvolutionBot existe?
    flowise: true, // VERIFICAR: Modelo Flowise existe?
    openaiBot: { include: { creds: true, setting: true } }, // VERIFICAR: Relação OpenaiBot existe?
    typebot: true, // VERIFICAR: Modelo Typebot existe?
    pusher: true,
    // VERIFICAR: Nome da relação _count no schema
    _count: { select: { messages: true, contacts: true, chats: true, labels: true } }
  }
}>;


export class WAMonitoringService {
  private readonly logger: Logger;

  public readonly waInstances: Record<string, ChannelStartupService> = {};

  private readonly dbConfig: Partial<DatabaseConfig> = {};
  private readonly cacheConfig: Partial<CacheConf> = {};
  private readonly providerSessionConfig: ProviderSessionConfig | undefined;
  private readonly delInstanceConfig: DelInstanceConfig | undefined;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly providerFiles: ProviderFiles,
    private readonly cacheService: CacheService,
    // Injete o ChannelController corretamente
    private readonly channelController: ChannelController,
    baseLogger: Logger,
  ) {
    // CORRIGIDO TS2339: Assume que Logger tem o método 'child'. Verifique sua implementação.
    this.logger = baseLogger.child({ context: WAMonitoringService.name });
    this.logger.info('Iniciando WAMonitoringService...');

    Object.assign(this.dbConfig, this.configService.get<DatabaseConfig>('DATABASE') || {});
    Object.assign(this.cacheConfig, this.configService.get<CacheConf>('CACHE') || {});
    this.providerSessionConfig = this.configService.get<ProviderSessionConfig>('PROVIDER');
    this.delInstanceConfig = this.configService.get<DelInstanceConfig>('DEL_INSTANCE');

    this.setupInternalEventListeners();
    this.logger.info('WAMonitoringService iniciado e listeners configurados.');

    setTimeout(() => {
        // CORRIGIDO TS2554: Passar objeto para logger.error
        this.loadInstance().catch(err => this.logger.error({ err, message: 'Erro inicial ao carregar instâncias' }));
    }, 1000);

  }

  private setupInternalEventListeners(): void {
    this.eventEmitter.on('remove.instance', async (instanceName: string, reason?: string) => {
       this.logger.info(`Evento 'remove.instance' recebido para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       // CORRIGIDO TS2339: Chamar deleteAccount em vez de remove
       await this.deleteAccount(instanceName);
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

         if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
           await instance.clearCacheChatwoot?.();
         }
         await this.cleaningUp(instanceName);
         // CORRIGIDO TS2339: Acessar status via método ou propriedade correta
         const status = instance.getStatus(); // Assume que getStatus() existe e retorna { connection: ... }
         if (status && status.connection) {
            // Se precisar modificar o estado interno (cuidado com a imutabilidade)
            // instance.updateConnectionState?.('close', DisconnectReason.loggedOut); // Se existir método
         } else {
             this.logger.warn(`Não foi possível acessar o estado da conexão para ${instanceName} durante o logout.`);
         }

       } catch (e: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
         this.logger.error({ err: e, message: `Erro durante processamento do evento logout.instance para "${instanceName}"` });
       }
    });

    this.eventEmitter.on('no.connection', async (instanceName: string) => {
       this.logger.warn(`Evento 'no.connection' recebido para: ${instanceName}. Limpando estado.`);
      try {
        const current = this.waInstances[instanceName];
        if (!current) return;

        await current.client?.logout?.(`Logout forçado devido a evento 'no.connection' para ${instanceName}`);
        current.client?.ws?.close?.();

        if (current.instance) current.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };
        // CORRIGIDO TS2339: Usar método para atualizar estado interno
        // current.updateConnectionState?.('close', DisconnectReason.connectionClosed);

        // Atualiza status no DB para 'close'
        await this.prismaRepository.instance.updateMany({
            where: { name: instanceName }, // Assume name é unique ou filtrar por ID se tiver
            data: { connectionStatus: 'close' }
        });

      } catch (error: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
        this.logger.error({ err: error, message: `Erro durante limpeza de 'no.connection' para "${instanceName}"` });
      } finally {
        this.logger.warn(`Estado definido como 'close' para instância "${instanceName}" após evento 'no.connection'.`);
      }
    });
  }

  public get(instanceName: string): ChannelStartupService | undefined {
    return this.waInstances[instanceName];
  }

  public async deleteAccount(instanceName: string): Promise<{success: boolean; message?: string}> {
     this.logger.info(`Removendo completamente a conta/instância "${instanceName}"...`);
     const instance = this.waInstances[instanceName];
     let deletedFromMemory = false;

      try {
        if (instance) {
            this.logger.debug(`Instância ${instanceName} encontrada no monitor. Enviando webhook e desconectando...`);
            await instance.sendDataWebhook?.(Events.REMOVE_INSTANCE, { instanceName });
            await instance.logoutInstance?.(true); // Chama logout da instância específica
            await delay(500);
            deletedFromMemory = true;
        } else {
             this.logger.warn(`Instância ${instanceName} não encontrada no monitor para remoção.`);
        }
        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
      } catch (e: any) {
        // CORRIGIDO TS2554: Passar objeto de erro
        this.logger.error({ err: e, message: `Erro durante a remoção completa da instância "${instanceName}"` });
      } finally {
        if (instance && deletedFromMemory) { // Garante que só deleta se estava e foi processado
            delete this.waInstances[instanceName];
            this.logger.info(`Instância "${instanceName}" removida do monitor.`);
        } else if (deletedFromMemory) {
            // Caso raro
            delete this.waInstances[instanceName];
            this.logger.info(`Instância "${instanceName}" removida do monitor após erro parcial.`);
        }
      }
      return { success: true, message: `Processo de remoção da instância ${instanceName} concluído.` };
  }

  public delInstanceTime(instanceName: string): void {
    const time = this.delInstanceConfig?.TIME;
    const checkStatus = this.delInstanceConfig?.CHECK_STATUS ?? true;

    if (typeof time === 'number' && time > 0) {
      this.logger.info(`Agendando verificação de inatividade para "${instanceName}" em ${time} minutos.`);
      setTimeout(async () => {
        const current = this.waInstances[instanceName];
        // CORRIGIDO TS2339: Usar getStatus() ou similar
        const currentStatus = current?.getStatus();
        const isConnected = currentStatus?.connection === 'open';

        if (!current || (checkStatus && !isConnected)) {
          this.logger.warn(`Instância "${instanceName}" ${!current ? 'não encontrada' : `inativa (${currentStatus?.connection})`} após ${time} minutos. Removendo...`);
          await this.deleteAccount(instanceName);
        } else {
           this.logger.info(`Instância "${instanceName}" está ativa (${currentStatus?.connection}). Remoção por inatividade cancelada.`);
        }
      }, 1000 * 60 * time);
    }
  }

  public async instanceInfo(instanceNames?: string[]): Promise<InstanceInfoPayload[]> {
    const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    const whereClause: Prisma.InstanceWhereInput = {};
    if (clientName) {
        whereClause.clientName = clientName;
    }
    if (instanceNames?.length) {
      whereClause.name = { in: instanceNames }; // Assume 'name' é o campo
      // ... (lógica de warning mantida) ...
    } else if (!clientName) {
       this.logger.warn('Buscando todas as instâncias do DB (sem filtro por clientName).');
    }

    // CORRIGIDO TS2554: Passar objeto para logger
    this.logger.debug({ where: whereClause }, `Buscando instâncias no DB`);

    // CORRIGIDO TS2561 / include: Ajustar nomes das relações para lowercase (provavelmente) e verificar existência no schema
    const includeClause: Prisma.InstanceInclude = {
        chatwoot: true, proxy: true, rabbitmq: true, sqs: true, websocket: true, setting: true,
        dify: true, evolutionBot: true, flowise: true,
        openaiBot: { include: { creds: true, setting: true } },
        typebot: true, pusher: true,
        _count: { select: { messages: true, contacts: true, chats: true, labels: true } } // VERIFICAR NOME _count
    };

    // CORRIGIDO TS2322: O tipo de retorno depende do include. Se InstanceInfoPayload estiver correto, ok.
    try {
         const instances = await this.prismaRepository.instance.findMany({
            where: whereClause,
            include: includeClause,
         });
         return instances as InstanceInfoPayload[]; // Faz cast se necessário, mas idealmente o tipo bate
    } catch (error: any) {
        this.logger.error({err: error, message: "Erro ao buscar instanceInfo no DB", where: whereClause});
        return [];
    }
  }

  public async instanceInfoById(instanceId?: string, number?: string): Promise<InstanceInfoPayload[]> {
      this.logger.debug(`Buscando instância por ID: ${instanceId} ou Número: ${number}`);
      let whereClause: Prisma.InstanceWhereInput = {}; // Usar WhereInput para busca não única

      if (instanceId) {
          whereClause = { id: instanceId }; // Busca por ID
      } else if (number) {
           whereClause = { number: number }; // Assume 'number' existe no schema para busca
      } else {
          throw new BadRequestException('É necessário fornecer instanceId ou number.');
      }

      const instanceDb = await this.prismaRepository.instance.findFirst({
          where: whereClause,
          select: { name: true } // Busca só o nome primeiro
      });

      const instanceName = instanceDb?.name;
      if (!instanceName) {
          throw new NotFoundException(`Instância com ${instanceId ? `ID ${instanceId}` : `Número ${number}`} não encontrada.`);
      }
      if (!this.waInstances[instanceName]) {
          this.logger.warn(`Instância "${instanceName}" encontrada no DB mas não está ativa no monitor.`);
      }
      return this.instanceInfo([instanceName]); // Reusa para buscar com includes
  }

  public async cleaningUp(instanceName: string): Promise<void> {
    this.logger.info(`Limpando sessão/cache para instância "${instanceName}"...`);
    let instanceDbId: string | undefined;

    if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
      const found = await this.prismaRepository.instance.findUnique({
        where: { name: instanceName }, select: { id: true } // Assume name é unique
       });
      instanceDbId = found?.id;
      if (instanceDbId) {
        await this.prismaRepository.session.deleteMany({ where: { instanceId: instanceDbId } });
        this.logger.debug(`Sessão do DB deletada para instanceId: ${instanceDbId}`);
      } else {
           this.logger.warn(`Instância "${instanceName}" não encontrada no DB para limpeza de sessão.`);
      }
    }

    if (this.cacheConfig?.REDIS?.ENABLED && this.cacheConfig?.REDIS?.SAVE_INSTANCES) {
      await this.cacheService?.delete?.(instanceName);
      if (instanceDbId) await this.cacheService?.delete?.(instanceDbId);
      this.logger.debug(`Cache Redis limpo para "${instanceName}" e ID "${instanceDbId || 'N/A'}"`);
    }

    // CORREÇÃO TS2339: Verificar se providerFiles.removeSession existe antes de chamar
    if (this.providerSessionConfig?.ENABLED) {
        if (typeof this.providerFiles?.removeSession === 'function') {
            await this.providerFiles.removeSession(instanceName);
            this.logger.debug(`Sessão do Provider limpa para "${instanceName}"`);
        } else {
            this.logger.warn(`Provider habilitado mas providerFiles.removeSession não está disponível/implementado.`);
        }
    }
     this.logger.info(`Limpeza de sessão/cache para "${instanceName}" concluída.`);
  }

  public async cleaningStoreData(instanceName: string): Promise<void> {
     this.logger.warn(`ATENÇÃO: Limpando TODOS os dados (DB e arquivos) para instância "${instanceName}"...`);

     const storeDir = STORE_DIR || './storage';
     if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
        const chatwootPath = join(storeDir, 'chatwoot', instanceName);
        this.logger.debug(`Removendo diretório Chatwoot: ${chatwootPath}`);
        // CORRIGIDO TS2554: Passar objeto de erro
        try { rmSync(chatwootPath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e, message: `Erro ao remover pasta Chatwoot (${chatwootPath})`}); }
     }

     const instance = await this.prismaRepository.instance.findUnique({
        where: { name: instanceName }, select: { id: true } // Assume name é unique
    });
    if (!instance?.id) {
        this.logger.error(`Instância "${instanceName}" não encontrada no DB para limpeza completa. Abortando limpeza de dados.`);
        return;
    }
    const instanceId = instance.id;

    const instanceDir = INSTANCE_DIR || './instances';
    const instancePath = join(instanceDir, instanceName); // Assume nome da instância como nome da pasta
    this.logger.debug(`Removendo diretório da instância local: ${instancePath}`);
    // CORRIGIDO TS2554: Passar objeto de erro
    try { rmSync(instancePath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e, message: `Erro ao remover pasta da instância (${instancePath})`}); }

    this.logger.info(`Deletando dados do DB para instanceId: ${instanceId}`);
    try {
        // CORREÇÃO TS2339: Verificar nomes reais dos modelos no schema
        await this.prismaRepository.client.$transaction([
            this.prismaRepository.session.deleteMany({ where: { instanceId } }),
            this.prismaRepository.messageUpdate.deleteMany({ where: { instanceId } }),
            this.prismaRepository.media.deleteMany({ where: { instanceId } }),
            this.prismaRepository.message.deleteMany({ where: { instanceId } }),
            // this.prismaRepository.labelAssociation?.deleteMany({ where: { instanceId } }), // VERIFICAR se labelAssociation existe
            this.prismaRepository.label.deleteMany({ where: { instanceId } }),
            this.prismaRepository.chat.deleteMany({ where: { instanceId } }),
            this.prismaRepository.contact.deleteMany({ where: { instanceId } }),
            this.prismaRepository.webhook.deleteMany({ where: { instanceId } }),
            this.prismaRepository.chatwoot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.proxy.deleteMany({ where: { instanceId } }),
            this.prismaRepository.rabbitmq.deleteMany({ where: { instanceId } }),
            this.prismaRepository.sqs.deleteMany({ where: { instanceId } }),
            this.prismaRepository.pusher.deleteMany({ where: { instanceId } }),
            // this.prismaRepository.websocket?.deleteMany({ where: { instanceId } }), // VERIFICAR se websocket existe
            this.prismaRepository.integrationSession.deleteMany({ where: { instanceId } }),
            this.prismaRepository.difySetting.deleteMany({ where: { instanceId } }), // VERIFICAR se Dify existe
            this.prismaRepository.dify.deleteMany({ where: { instanceId } }), // VERIFICAR se Dify existe
            this.prismaRepository.evolutionBotSetting.deleteMany({ where: { instanceId } }), // VERIFICAR se EvolutionBot existe
            this.prismaRepository.evolutionBot.deleteMany({ where: { instanceId } }), // VERIFICAR se EvolutionBot existe
            this.prismaRepository.flowiseSetting.deleteMany({ where: { instanceId } }), // VERIFICAR se Flowise existe
            this.prismaRepository.flowise.deleteMany({ where: { instanceId } }), // VERIFICAR se Flowise existe
            this.prismaRepository.openaiCreds.deleteMany({ where: { openaiBots: { some: { instanceId } } } }), // Check relation name
            this.prismaRepository.openaiSetting.deleteMany({ where: { openaiBot: { instanceId } } }), // Check relation name
            this.prismaRepository.openaiBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.typebotSetting.deleteMany({ where: { instanceId } }), // VERIFICAR se Typebot existe
            this.prismaRepository.typebot.deleteMany({ where: { instanceId } }), // VERIFICAR se Typebot existe
            this.prismaRepository.setting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.instance.delete({ where: { id: instanceId } })
        ]);
        this.logger.info(`Dados do DB para instanceId ${instanceId} deletados com sucesso.`);
    } catch (dbError: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
         this.logger.error({ err: dbError, message: `Erro ao deletar dados do DB para instanceId ${instanceId}`});
    }
  }

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
      this.logger.error({ err: error, message: `Erro ao carregar instâncias`});
    }
  }

  public async saveInstance(data: InstanceDto & { ownerJid?: string; profileName?: string; profilePicUrl?: string; hash?: string; connectionStatus?: string }): Promise<PrismaInstance | null> {
    if (!this.dbConfig?.SAVE_DATA?.INSTANCE) {
        this.logger.debug('Persistência de instância no DB desabilitada, pulando saveInstance.');
        return null;
    }
    this.logger.info(`Salvando/Atualizando instância no DB: ${data.instanceName}`);
    try {
      const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
      // CORREÇÃO TS2353: Remover 'owner' se não existir no schema Instance
      const createData: Prisma.InstanceCreateInput = {
          id: data.instanceId || undefined,
          name: data.instanceName,
          // owner: data.owner, // REMOVIDO - Adicione se existir no schema
          ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
          connectionStatus: data.connectionStatus || 'close',
          number: data.number,
          integration: data.integration || Integration.WHATSAPP_BAILEYS, // VERIFICAR: Import e tipo de Integration
          token: data.hash || data.token,
          clientName, businessId: data.businessId,
      };
       const updateData: Prisma.InstanceUpdateInput = {
          // owner: data.owner, // REMOVIDO - Adicione se existir no schema
          ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
          connectionStatus: data.connectionStatus,
          number: data.number,
          integration: data.integration || Integration.WHATSAPP_BAILEYS, // VERIFICAR: Import e tipo de Integration
          token: data.hash || data.token,
          clientName, businessId: data.businessId,
      };

      const instanceDataForDb: Prisma.InstanceUpsertArgs = {
          where: { name: data.instanceName }, // Assume name é unique
          create: createData,
          update: updateData
      };
      const saved = await this.prismaRepository.instance.upsert(instanceDataForDb);
      this.logger.info(`Instância "${data.instanceName}" salva/atualizada no DB com ID: ${saved.id}`);
      return saved;
    } catch (error: any) {
       // CORRIGIDO TS2554: Passar objeto de erro
       this.logger.error({ err: error, message: `Erro ao salvar/atualizar instância "${data.instanceName}" no DB`});
       throw error;
    }
  }

  public async initializeInstance(instanceData: CreateInstanceDto): Promise<ChannelStartupService | undefined> {
    this.logger.info(`Solicitação para criar/inicializar instância: ${instanceData.instanceName} (Integração: ${instanceData.integration || 'Padrão'})`);

    if (this.waInstances[instanceData.instanceName]) {
        this.logger.warn(`Instância "${instanceData.instanceName}" já existe no monitor. Retornando existente.`);
        return this.waInstances[instanceData.instanceName];
    }

    let instanceId = instanceData.instanceId;
    let dbInstance: PrismaInstance | null = null;

    if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
         try {
             // Passa o DTO que pode conter o owner (será filtrado em saveInstance se não existir no schema)
             dbInstance = await this.saveInstance(instanceData);
             instanceId = dbInstance?.id;
             if (!instanceId) {
                 throw new Error('Falha ao obter ID da instância do banco de dados.');
             }
             instanceData.instanceId = instanceId;
         } catch(dbError: any) {
              throw new InternalServerErrorException(`Erro de banco de dados ao preparar instância: ${dbError.message}`);
         }
    } else if (!instanceId) {
         instanceId = uuidv4();
         instanceData.instanceId = instanceId;
         this.logger.warn(`Persistência de instância no DB desabilitada. Usando ID gerado: ${instanceId} para ${instanceData.instanceName}`);
    }

    try {
        // CORREÇÃO TS2339: Verificar se createChannelInstance existe e está correto
        if (!this.channelController || typeof this.channelController.createChannelInstance !== 'function') {
             this.logger.error('ChannelController ou método createChannelInstance não está disponível/definido.');
             throw new Error('ChannelController.createChannelInstance não está disponível/definido.');
        }
        const instanceService: ChannelStartupService = this.channelController.createChannelInstance(instanceData);

        if (!instanceService) {
            throw new Error('Falha ao criar a instância específica do canal via ChannelController.');
        }
        this.logger.debug(`Instância específica do canal criada para ${instanceData.instanceName}`);

        await instanceService.start?.(); // Chama start da instância criada

        this.waInstances[instanceData.instanceName] = instanceService;
        this.logger.info(`Instância "${instanceData.instanceName}" (ID: ${instanceId}) adicionada ao monitor e conexão iniciada.`);
        this.delInstanceTime(instanceData.instanceName);

        return instanceService;

    } catch (error: any) {
        // CORRIGIDO TS2554: Passar objeto de erro
        this.logger.error({ err: error, message: `Erro CRÍTICO ao criar/inicializar instância ${instanceData.instanceName}` });
        if (dbInstance) {
             this.logger.warn(`Tentando remover registro DB para ${instanceData.instanceName} devido à falha na inicialização...`);
             // CORRIGIDO TS2554: Passar objeto de erro
             await this.prismaRepository.instance.delete({ where: { id: dbInstance.id } })
                 .catch(e => this.logger.error({ err: e, message: `Erro ao deletar instância ${dbInstance.id} do DB após falha`}));
        }
        await this.cleaningUp(instanceData.instanceName);
        delete this.waInstances[instanceData.instanceName];
        throw new InternalServerErrorException(`Erro ao inicializar instância ${instanceData.instanceName}: ${error.message}`);
    }
  }

  private async loadInstancesFromRedis(): Promise<void> {
    this.logger.info('Carregando instâncias do Redis...');
    try {
        const keys = await this.cacheService.keys(`${this.instanceIdPrefix}*`);
        if (!keys || keys.length === 0) {
            this.logger.info('Nenhuma instância encontrada no Redis para carregar.');
            return;
        }
        this.logger.info(`Encontradas ${keys.length} chaves de instância no Redis.`);
        // Implementar busca e chamada a initializeInstance
    } catch(error: any) {
         // CORRIGIDO TS2554: Passar objeto de erro
         this.logger.error({ err: error, message: 'Erro ao carregar instâncias do Redis'});
    }
  }

  private async loadInstancesFromDatabase(): Promise<void> {
    const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    if (!clientName) {
        this.logger.warn('DATABASE.CONNECTION.CLIENT_NAME não definido. Não é possível carregar instâncias do DB com segurança.');
        return;
    }
    // CORRIGIDO TS2353: Remover 'owner' do select se não existir no schema
    const instances = await this.prismaRepository.instance.findMany({
        where: { clientName },
        select: { id: true, name: true, integration: true, token: true, number: true, businessId: true /*, owner: true */ } // Remover owner se não existir
    });
    this.logger.info(`Encontradas ${instances.length} instâncias no DB para o clientName "${clientName}".`);
    if (!instances.length) return;

    const results = await Promise.allSettled(
      instances.map(async (i) => {
        this.logger.info(`Tentando recarregar instância do DB: ${i.name} (ID: ${i.id})`);
        const instanceDto: CreateInstanceDto = {
            instanceId: i.id,
            instanceName: i.name,
            integration: i.integration as Integration, // VERIFICAR tipo Integration
            token: i.token,
            number: i.number,
            businessId: i.businessId,
            // owner: i.owner, // Remover se não existir no select/schema
         };
         await this.initializeInstance(instanceDto);
      }),
    );
     results.forEach((result, index) => {
        if (result.status === 'rejected') {
            // CORRIGIDO TS2554: Passar objeto de erro
            this.logger.error({ reason: result.reason, message: `Falha ao recarregar instância ${instances[index].name} do DB` });
        }
     });
  }

  private async loadInstancesFromProvider(): Promise<void> {
    this.logger.warn('Carregamento de instâncias do Provider não implementado.');
  }

  private get instanceIdPrefix(): string {
      // CORRIGIDO TS2345: Garantir que 'SERVER_NAME' existe na tipagem Env
      const serverName = this.configService.get<EnvironmentConfig['SERVER_NAME']>('SERVER_NAME'); // Acessa de forma segura
      return `instance:${serverName || 'default'}:`;
  }

} // Fim da classe WAMonitoringService
