// Arquivo: src/api/services/monitor.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs e Tipos
import { InstanceDto } from '@api/dto/instance.dto';
import { Events } from '@api/types/wa.types';
// CORREÇÃO TS2749: Importar Integration Enum (ajuste o path se necessário)
import { Integration, Prisma } from '@prisma/client'; // Ou '@api/types/wa.types'

// Imports de Serviços, Repositórios, Config
import { ProviderFiles } from '@provider/sessions';
import { PrismaRepository } from '@repository/repository.service';
// CORREÇÃO TS2724: Importar o controller correto (ex: instanceController)
import { instanceController } from '@api/server.module'; // Ou importar WAMonitoringService se ele gerenciar
import { ConfigService, CacheConf, ChatwootConfig, DatabaseConfig, DelInstanceConfig, ProviderSessionConfig } from '@config/env.config'; // Usar tipos específicos
import { Logger } from '@config/logger.config';
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config';
// CORREÇÃO TS2304: Importar Exceptions
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
import { CacheService } from './cache.service'; // Import local
import { ChannelStartupService } from './channel.service'; // Importar classe base para tipagem

// Imports Node.js e Libs Externas
// import { execSync } from 'child_process'; // Descomentar se usado
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';
// CORREÇÃO TS2307: Importar delay
import { delay } from '@whiskeysockets/baileys';
// CORREÇÃO TS2304: Importar v4
import { v4 } from 'uuid';


export class WAMonitoringService {
  private readonly logger: Logger; // Logger agora é injetado ou criado com base injetada

  // Armazena as instâncias ativas (usando a classe base como tipo)
  public readonly waInstances: Record<string, ChannelStartupService> = {};

  // Configurações locais cacheadas (tipadas)
  private readonly dbConfig: Partial<DatabaseConfig> = {};
  private readonly redisConfig: Partial<CacheConf> = {}; // Renomeado para evitar conflito
  private readonly providerSessionConfig: ProviderSessionConfig | undefined;
  private readonly delInstanceConfig: DelInstanceConfig | undefined; // Tipado

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly providerFiles: ProviderFiles,
    private readonly cache: CacheService,
    private readonly chatwootCache: CacheService,
    private readonly baileysCache: CacheService,
    baseLogger: Logger, // Injetar logger base
  ) {
    this.logger = baseLogger.child({ context: 'WAMonitoringService' });
    this.logger.info('Iniciando WAMonitoringService...');

    // Carrega configurações relevantes
    Object.assign(this.dbConfig, this.configService.get<DatabaseConfig>('DATABASE') || {});
    Object.assign(this.redisConfig, this.configService.get<CacheConf>('CACHE') || {});
    this.providerSessionConfig = this.configService.get<ProviderSessionConfig>('PROVIDER');
    this.delInstanceConfig = this.configService.get<DelInstanceConfig>('DEL_INSTANCE'); // Carrega config de deleção

    this.setupInternalEventListeners();
    this.logger.info('WAMonitoringService iniciado e listeners configurados.');

    // Carregar instâncias após o serviço estar pronto
    this.loadInstance().catch(err => this.logger.error({ err }, 'Erro inicial ao carregar instâncias'));
  }

  /** Configura listeners para eventos de remoção/logout */
  private setupInternalEventListeners(): void {
    this.eventEmitter.on('remove.instance', async (instanceName: string, reason?: string) => {
       this.logger.log(`Evento 'remove.instance' para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       await this.remove(instanceName);
    });

    this.eventEmitter.on('logout.instance', async (instanceName: string, reason?: string) => {
      this.logger.log(`Evento 'logout.instance' para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       try {
         const instance = this.waInstances[instanceName];
         if (!instance) {
             this.logger.warn(`Tentativa de logout em instância não monitorada: ${instanceName}`);
             return;
         };

         await instance.sendDataWebhook?.(Events.LOGOUT_INSTANCE, null);

         if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
           instance.clearCacheChatwoot?.();
         }
         await this.cleaningUp(instanceName);
       } catch (e: any) {
         this.logger.error({ err: e }, `Erro durante logout.instance para "${instanceName}"`);
       }
    });

    this.eventEmitter.on('no.connection', async (instanceName: string) => {
       this.logger.warn(`Evento 'no.connection' para: ${instanceName}. Limpando estado.`);
      try {
        const current = this.waInstances[instanceName];
        if (!current) return;

        // Tenta forçar logout e fechar conexão
        await current.client?.logout?.('Forçado devido a falha na conexão: ' + instanceName);
        current.client?.ws?.close?.();
        current.client?.end?.(undefined);

        // Reseta estado interno
        if (current.instance) current.instance.qrcode = { count: 0, code: null, base64: null, pairingCode: null };
        if (current.stateConnection) current.stateConnection.connection = 'close';

        // Atualiza status no DB para 'close'
        await this.prismaRepository.instance.updateMany({
            where: { name: instanceName },
            data: { connectionStatus: 'close' }
        });

      } catch (error: any) {
        this.logger.error({ err: error }, `Erro durante limpeza de 'no.connection' para "${instanceName}"`);
      } finally {
        this.logger.warn(`Estado definido como 'close' para instância "${instanceName}" após falha de conexão.`);
      }
    });
  }

  /** Retorna uma instância ativa pelo nome */
  public get(instanceName: string): ChannelStartupService | undefined {
    return this.waInstances[instanceName];
  }

  /** Remove e limpa uma instância (memória, cache, sessão, arquivos, DB) */
  public async remove(instanceName: string): Promise<void> {
     this.logger.info(`Removendo instância "${instanceName}"...`);
     const instance = this.waInstances[instanceName];

      try {
        if (instance) {
            await instance.sendDataWebhook?.(Events.REMOVE_INSTANCE, null);
            await instance.logoutInstance?.(); // Chama logout da instância específica
            await delay(500);
        }
        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
      } catch (e: any) {
        this.logger.error({ err: e }, `Erro durante limpeza completa ao remover instância "${instanceName}"`);
      } finally {
        delete this.waInstances[instanceName];
        this.logger.info(`Instância "${instanceName}" removida do monitor.`);
      }
  }


  /** Configura timeout para deletar instância inativa */
  public delInstanceTime(instanceName: string): void {
    // CORREÇÃO: Usar delInstanceConfig tipado
    const time = this.delInstanceConfig?.TIME;
    const checkStatus = this.delInstanceConfig?.CHECK_STATUS ?? true; // Default para true

    if (typeof time === 'number' && time > 0) {
      this.logger.info(`Agendando verificação de inatividade para "${instanceName}" em ${time} minutos.`);
      setTimeout(async () => {
        const current = this.waInstances[instanceName];
        // Verifica se ainda existe e se o status não é 'open' (se checkStatus for true)
        if (current && (!checkStatus || current.connectionStatus?.connection !== 'open')) {
          this.logger.warn(`Instância "${instanceName}" inativa (${current.connectionStatus?.connection}) após ${time} minutos. Removendo...`);
          await this.remove(instanceName);
        } else if (current) {
           this.logger.info(`Instância "${instanceName}" está ativa (${current.connectionStatus?.connection}). Remoção por inatividade cancelada.`);
        } else {
           this.logger.info(`Instância "${instanceName}" não encontrada no monitor. Remoção por inatividade cancelada.`);
        }
      }, 1000 * 60 * time);
    }
  }

  /** Busca informações de instâncias no DB */
  public async instanceInfo(instanceNames?: string[]): Promise<Prisma.InstanceGetPayload<{ include: any }>[]> {
    const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    const whereClause: Prisma.InstanceWhereInput = { clientName };

    if (instanceNames?.length) {
      whereClause.name = { in: instanceNames };
      const missing = instanceNames.filter((name) => !this.waInstances[name]);
      if (missing.length > 0) {
        this.logger.warn(`Buscando info de instâncias não monitoradas ativamente: ${missing.join(', ')}`);
      }
    }

    this.logger.debug({ where: whereClause }, `Buscando instâncias no DB`);
    // CORREÇÃO TS2561: Corrigir nome da relação para 'messages' (ou o nome correto no schema)
    const includeClause: Prisma.InstanceInclude = {
        Chatwoot: true, Proxy: true, Rabbitmq: true, Sqs: true, Websocket: true, Setting: true,
        Dify: true, EvolutionBot: true, Flowise: true,
        OpenaiBot: { include: { creds: true, setting: true } },
        Typebot: true, Pusher: true,
        _count: { select: { messages: true, Contact: true, Chat: true, Label: true } } // <- Corrigido para 'messages'
    };

    return this.prismaRepository.instance.findMany({ // Usa o getter
      where: whereClause,
      include: includeClause,
    });
  }

  /** Busca info por ID da instância ou número */
  public async instanceInfoById(instanceId?: string, number?: string): Promise<Prisma.InstanceGetPayload<{ include: any }>[]> {
      this.logger.debug(`Buscando instância por ID: ${instanceId} ou Número: ${number}`);
      let whereClause: Prisma.InstanceWhereInput = {};

      if (instanceId) {
          whereClause = { id: instanceId };
      } else if (number) {
           whereClause = { number: number };
      } else {
          // CORREÇÃO TS2304: Usar BadRequestException importado
          throw new BadRequestException('É necessário fornecer instanceId ou number.');
      }

      const instanceDb = await this.prismaRepository.instance.findFirst({ // Usa o getter
          where: whereClause,
          select: { name: true }
      });

      const instanceName = instanceDb?.name;
      if (!instanceName) {
          // CORREÇÃO TS2304: Usar NotFoundException importado
          throw new NotFoundException(`Instância com ${instanceId ? `ID ${instanceId}` : `Número ${number}`} não encontrada.`);
      }
      if (!this.waInstances[instanceName]) {
          this.logger.warn(`Instância "${instanceName}" encontrada no DB mas não está ativa no monitor.`);
      }
      return this.instanceInfo([instanceName]);
  }

  /** Limpa dados de sessão e cache */
  public async cleaningUp(instanceName: string): Promise<void> {
    this.logger.info(`Limpando sessão/cache para instância "${instanceName}"...`);
    let instanceDbId: string | undefined;

    if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
      const found = await this.prismaRepository.instance.findUnique({ // Usa o getter
        where: { name: instanceName }, select: { id: true }
       });
      if (found) {
        instanceDbId = found.id;
        await this.prismaRepository.session.deleteMany({ where: { instanceId } }); // Usa o getter e instanceId diretamente
        this.logger.debug(`Sessão do DB deletada para instanceId: ${instanceDbId}`);
        await this.prismaRepository.instance.update({ // Usa o getter
            where: { id: instanceDbId }, data: { connectionStatus: 'close' },
          });
      } else {
           this.logger.warn(`Instância "${instanceName}" não encontrada no DB para limpeza de sessão.`);
      }
    }

    // CORREÇÃO: Usar redisConfig
    if (this.redisConfig?.REDIS?.ENABLED && this.redisConfig?.REDIS?.SAVE_INSTANCES) {
      await this.cache?.delete?.(instanceName);
      if (instanceDbId) await this.cache?.delete?.(instanceDbId);
      this.logger.debug(`Cache Redis limpo para "${instanceName}" e ID "${instanceDbId || 'N/A'}"`);
    }

    // CORREÇÃO: Usar providerSessionConfig
    if (this.providerSessionConfig?.ENABLED) {
      // CORREÇÃO TS2339: Adicionar '?' para segurança, mas verificar se removeSession existe
      await this.providerFiles?.removeSession?.(instanceName);
      this.logger.debug(`Sessão do Provider limpa para "${instanceName}"`);
    }
     this.logger.info(`Limpeza de sessão/cache para "${instanceName}" concluída.`);
  }

  /** Limpa TODOS os dados da instância, incluindo DB e arquivos - AÇÃO DESTRUTIVA! */
  public async cleaningStoreData(instanceName: string): Promise<void> {
     this.logger.warn(`ATENÇÃO: Limpando TODOS os dados (DB e arquivos) para instância "${instanceName}"...`);

     const storeDir = STORE_DIR || './storage';
     if (this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED) {
        const chatwootPath = join(storeDir, 'chatwoot', instanceName + '*');
        this.logger.debug(`Removendo diretório Chatwoot: ${chatwootPath}`);
        try { rmSync(chatwootPath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e }, `Erro ao remover pasta Chatwoot (${chatwootPath})`); }
     }

    const instance = await this.prismaRepository.instance.findUnique({ // Usa o getter
        where: { name: instanceName }, select: { id: true }
    });
    if (!instance?.id) {
        this.logger.error(`Instância "${instanceName}" não encontrada no DB para limpeza completa. Abortando limpeza de dados.`);
        return;
    }
    const instanceId = instance.id;

    const instanceDir = INSTANCE_DIR || './instances';
    const instancePath = join(instanceDir, instanceId); // Usa ID para pasta
    this.logger.debug(`Removendo diretório da instância: ${instancePath}`);
    try { rmSync(instancePath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e }, `Erro ao remover pasta da instância (${instancePath})`); }

    this.logger.info(`Deletando dados do DB para instanceId: ${instanceId}`);
    try {
        // CORREÇÃO TS2353/TS2561: Usar instanceId diretamente no where para deleteMany
        await this.prismaRepository.client.$transaction([ // Usa client do repo
            this.prismaRepository.session.deleteMany({ where: { instanceId } }),
            this.prismaRepository.messageUpdate.deleteMany({ where: { instanceId } }),
            this.prismaRepository.media.deleteMany({ where: { instanceId } }),
            this.prismaRepository.message.deleteMany({ where: { instanceId } }),
            this.prismaRepository.chat.deleteMany({ where: { instanceId } }),
            this.prismaRepository.contact.deleteMany({ where: { instanceId } }),
            this.prismaRepository.webhook.deleteMany({ where: { instanceId } }),
            this.prismaRepository.chatwoot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.proxy.deleteMany({ where: { instanceId } }),
            this.prismaRepository.rabbitmq.deleteMany({ where: { instanceId } }),
            this.prismaRepository.sqs.deleteMany({ where: { instanceId } }),
            this.prismaRepository.integrationSession.deleteMany({ where: { instanceId } }),
            this.prismaRepository.difySetting.deleteMany({ where: { instanceId } }), // Assumindo coluna instanceId
            this.prismaRepository.dify.deleteMany({ where: { instanceId } }),
            this.prismaRepository.evolutionBotSetting.deleteMany({ where: { instanceId } }), // Assumindo coluna instanceId
            this.prismaRepository.evolutionBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.flowiseSetting.deleteMany({ where: { instanceId } }), // Assumindo coluna instanceId
            this.prismaRepository.flowise.deleteMany({ where: { instanceId } }),
            // CORREÇÃO TS2561: Relação OpenaiBot -> OpenaiCreds é One-to-Many, deletar bot primeiro ou usar where na relação
            this.prismaRepository.openaiCreds.deleteMany({ where: { openaiBots: { some: { instanceId } } } }), // Exemplo usando relação
            this.prismaRepository.openaiSetting.deleteMany({ where: { openaiBot: { instanceId } } }), // Usar relação
            this.prismaRepository.openaiBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.typebotSetting.deleteMany({ where: { instanceId } }), // Assumindo coluna instanceId
            this.prismaRepository.typebot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.setting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.label.deleteMany({ where: { instanceId } }),
            this.prismaRepository.pusher.deleteMany({ where: { instanceId } }),
            // this.prismaRepository.websocket.deleteMany({ where: { instanceId } }), // Modelo Websocket não existe no schema?
            this.prismaRepository.whatsappIntegration.deleteMany({ where: { instanceId } }),
            // Deleta a instância principal por último
            this.prismaRepository.instance.delete({ where: { id: instanceId } })
        ]);
        this.logger.info(`Dados do DB para instanceId ${instanceId} deletados com sucesso.`);
    } catch (dbError: any) {
         // CORREÇÃO TS2554: Passar objeto de erro
         this.logger.error({ err: dbError }, `Erro ao deletar dados do DB para instanceId ${instanceId}`);
    }
  }

  /** Carrega instâncias existentes ao iniciar */
  public async loadInstance(): Promise<void> {
    this.logger.info('Carregando instâncias existentes...');
    try {
      // CORREÇÃO: Usar configs tipados
      if (this.providerSessionConfig?.ENABLED) {
        this.logger.info('Carregando instâncias do Provider...');
        await this.loadInstancesFromProvider();
      } else if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
         this.logger.info('Carregando instâncias do Banco de Dados...');
        await this.loadInstancesFromDatabase();
      // CORREÇÃO: Usar redisConfig
      } else if (this.redisConfig?.REDIS?.ENABLED && this.redisConfig?.REDIS?.SAVE_INSTANCES) {
         this.logger.info('Carregando instâncias do Redis...');
        await this.loadInstancesFromRedis();
      } else {
         this.logger.warn('Nenhum método de persistência de instância habilitado.');
      }
       this.logger.info('Carregamento de instâncias concluído.');
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro ao carregar instâncias`);
    }
  }

  /** Salva/Atualiza instância no DB */
  public async saveInstance(data: InstanceDto & { ownerJid?: string; profileName?: string; profilePicUrl?: string; hash?: string; }): Promise<void> {
    if (!this.dbConfig?.SAVE_DATA?.INSTANCE) {
        this.logger.debug('Persistência de instância no DB desabilitada, pulando saveInstance.');
        return;
    }
    this.logger.info(`Salvando/Atualizando instância no DB: ${data.instanceName}`);
    try {
      const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
      const instanceData: Prisma.InstanceUpsertArgs = {
          where: { name: data.instanceName },
          create: {
              id: data.instanceId || undefined,
              name: data.instanceName,
              ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
              connectionStatus: 'close',
              number: data.number,
              integration: data.integration || Integration.WHATSAPP_BAILEYS, // CORREÇÃO TS2749: Usar enum
              token: data.hash || data.token,
              clientName, businessId: data.businessId,
          },
          update: {
              ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
              number: data.number,
              integration: data.integration || Integration.WHATSAPP_BAILEYS, // CORREÇÃO TS2749: Usar enum
              token: data.hash || data.token,
              clientName, businessId: data.businessId,
          }
      };
      const saved = await this.prismaRepository.instance.upsert(instanceData); // Usa o getter
      this.logger.info(`Instância "${data.instanceName}" salva/atualizada no DB com ID: ${saved.id}`);
    } catch (error: any) {
       this.logger.error({ err: error }, `Erro ao salvar/atualizar instância "${data.instanceName}" no DB`);
       throw error;
    }
  }

   /** Cria e inicializa uma instância de canal */
  public async createInstance(instanceData: InstanceDto): Promise<ChannelStartupService | undefined> {
    this.logger.info(`Solicitação para criar/inicializar instância: ${instanceData.instanceName} (Integração: ${instanceData.integration || 'Padrão'})`);

    if (this.waInstances[instanceData.instanceName]) {
        this.logger.warn(`Instância "${instanceData.instanceName}" já existe no monitor. Retornando existente.`);
        return this.waInstances[instanceData.instanceName];
    }

    let instanceId = instanceData.instanceId;
    if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
         try {
             const upsertData: Prisma.InstanceUpsertArgs = {
                 where: { name: instanceData.instanceName },
                 create: {
                     name: instanceData.instanceName, id: instanceData.instanceId || undefined,
                     integration: instanceData.integration || Integration.WHATSAPP_BAILEYS, // CORREÇÃO TS2749: Usar enum
                     token: instanceData.token, number: instanceData.number, businessId: instanceData.businessId,
                     connectionStatus: 'close',
                     clientName: this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME,
                 },
                 update: {
                     integration: instanceData.integration || Integration.WHATSAPP_BAILEYS, // CORREÇÃO TS2749: Usar enum
                     token: instanceData.token, number: instanceData.number, businessId: instanceData.businessId,
                 }
             };
             const dbInstance = await this.prismaRepository.instance.upsert(upsertData); // Usa getter
             instanceId = dbInstance.id;
             instanceData.instanceId = instanceId;
             this.logger.info(`Registro da instância "${instanceData.instanceName}" garantido no DB com ID: ${instanceId}`);
         } catch(dbError: any) {
              this.logger.error({ err: dbError }, `Erro ao garantir registro da instância "${instanceData.instanceName}" no DB`);
              // CORREÇÃO TS2304: Usar InternalServerErrorException importado
              throw new InternalServerErrorException(`Erro de banco de dados ao preparar instância: ${dbError.message}`);
         }
    } else if (!instanceId) {
         // CORREÇÃO TS2304: Usar v4 importado
         instanceId = v4();
         instanceData.instanceId = instanceId;
          this.logger.warn(`Persistência de instância no DB desabilitada. Usando ID gerado: ${instanceId} para ${instanceData.instanceName}`);
    }

    // Agora tenta inicializar a instância real
    try {
        // CORREÇÃO: Usar instanceController importado (ou lógica equivalente)
        // A forma como a instância específica é criada depende da sua arquitetura.
        // Se WAMonitoringService for responsável por isso, ele precisa de um método/lógica aqui.
        // Assumindo que instanceController.createInstanceChannel faz isso:
        if (!instanceController || typeof instanceController.createInstanceChannel !== 'function') {
             throw new Error('instanceController.createInstanceChannel não está disponível/definido.');
        }
        const instance: ChannelStartupService = await instanceController.createInstanceChannel(instanceData); // Passa DTO

        if (!instance) {
            throw new Error('Falha ao criar a instância específica do canal.');
        }
        this.logger.debug(`Instância específica do canal criada para ${instanceData.instanceName}`);

        // Configura a instância (ID, nome, etc.) - setInstance já é chamado dentro de createInstanceChannel? Verificar
        // instance.setInstance(instanceData); // Pode ser redundante

        // Tenta conectar
        // TODO: Corrigir nome do método se não for 'connectToWhatsapp' na instância retornada
        await instance.start?.(); // Chama start (ou connectToWhatsapp)

        this.waInstances[instanceData.instanceName] = instance;
        this.logger.info(`Instância "${instanceData.instanceName}" (ID: ${instanceId}) adicionada ao monitor e conexão iniciada.`);
        this.delInstanceTime(instanceData.instanceName);

        return instance;

    } catch (error: any) {
        // CORREÇÃO TS2554: Passar objeto de erro
        this.logger.error({ err: error }, `Erro CRÍTICO ao criar/inicializar instância ${instanceData.instanceName}`);
        if (this.dbConfig?.SAVE_DATA?.INSTANCE && instanceId) {
             // CORREÇÃO TS2304: Usar instanceData.instanceName
             this.logger.warn(`Tentando remover registro DB para ${instanceData.instanceName} devido à falha na inicialização...`);
             // await this.prismaRepository.instance.delete({ where: { id: instanceId } }).catch(e => this.logger.error(`Erro ao deletar instância ${instanceId} do DB após falha: ${e.message}`));
        }
        delete this.waInstances[instanceData.instanceName];
        await this.cleaningUp(instanceData.instanceName);
        // CORREÇÃO TS2304: Usar InternalServerErrorException importado
        throw new InternalServerErrorException(`Erro ao inicializar instância ${instanceData.instanceName}: ${error.message}`);
    }
  }

  // --- Métodos de Carregamento (Adaptados) ---
  private async loadInstancesFromRedis(): Promise<void> {
    this.logger.info('Carregando instâncias do Redis (Não implementado)...');
    // Implementar lógica para buscar chaves/dados do Redis e chamar createInstance
  }

  private async loadInstancesFromDatabase(): Promise<void> {
    const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    if (!clientName) {
        this.logger.warn('CLIENT_NAME não definido, não é possível carregar instâncias do DB.');
        return;
    }
    const instances = await this.prismaRepository.instance.findMany({ // Usa getter
        where: { clientName },
        select: { id: true, name: true, integration: true, token: true, number: true, businessId: true }
    });
    this.logger.info(`Encontradas ${instances.length} instâncias no DB para ${clientName}.`);
    if (!instances.length) return;

    const results = await Promise.allSettled(
      instances.map(async (i) => {
        this.logger.info(`Tentando recarregar instância do DB: ${i.name} (ID: ${i.id})`);
        const instanceDto: InstanceDto = {
            instanceId: i.id, instanceName: i.name,
            // CORREÇÃO TS2749: Cast para o tipo Integration (importado)
            integration: i.integration as Integration,
            token: i.token, number: i.number, businessId: i.businessId,
         };
         await this.createInstance(instanceDto); // Reusa fluxo de criação
      }),
    );
     results.forEach((result, index) => {
        if (result.status === 'rejected') {
            // CORREÇÃO TS2554: Passar objeto de erro
            this.logger.error({ reason: result.reason }, `Falha ao recarregar instância ${instances[index].name} do DB`);
        }
     });
  }

  private async loadInstancesFromProvider(): Promise<void> {
    this.logger.info('Carregando instâncias do Provider (Não implementado)...');
    // Implementar lógica para buscar dados do ProviderFiles e chamar createInstance
  }

} // Fim da classe WAMonitoringService
