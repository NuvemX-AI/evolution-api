// src/api/services/monitor.service.ts

// Imports de DTOs e Tipos
import { InstanceDto } from '@api/dto/instance.dto'; // TODO: Precisa do arquivo instance.dto.ts
import { Events, Integration } from '@api/types/wa.types'; // TODO: Precisa do arquivo wa.types.ts

// Imports de Serviços, Repositórios, Config
import { ProviderFiles } from '@provider/sessions'; // TODO: Precisa do arquivo sessions.ts
import { PrismaRepository } from '@repository/repository.service';
// TODO: Precisa do arquivo server.module.ts que exporta 'channelController' (pode ser um objeto/instância)
import { channelController } from '@api/server.module';
// TODO: Precisa do arquivo env.config.ts para estes tipos
import { CacheConf, Chatwoot, ConfigService, Database, DelInstance, ProviderSession } from '@config/env.config';
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config'; // TODO: Precisa do arquivo path.config.ts
import { NotFoundException } from '@exceptions'; // TODO: Precisa do arquivo exceptions/index.ts
import { CacheService } from './cache.service'; // TODO: Precisa do arquivo cache.service.ts
// TODO: Importar a classe/interface base da instância, ex: import { ChannelStartupService } from './channel.service';

// Imports Node.js e Libs Externas
import { Prisma } from '@prisma/client'; // Importando tipos Prisma
import { execSync } from 'child_process';
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';
import { delay } from '@whiskeysockets/baileys'; // Importando delay

export class WAMonitoringService {
  // TODO: Tipar Logger corretamente quando logger.config.ts for fornecido
  private readonly logger: Logger = new Logger('WAMonitoringService');

  // Armazena as instâncias ativas
  // TODO: Substituir 'any' pelo tipo/interface base da instância (ex: ChannelStartupService)
  public readonly waInstances: Record<string, any> = {};

  // Configurações locais cacheadas
  // TODO: Tipar Database e CacheConf corretamente (precisa de env.config.ts)
  private readonly db: Partial<any /*Database*/> = {};
  private readonly redis: Partial<any /*CacheConf*/> = {};
  private readonly providerSession: any /*ProviderSession*/ | undefined;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly providerFiles: ProviderFiles, // TODO: Precisa da definição e importação
    private readonly cache: CacheService, // TODO: Precisa da definição e importação
    private readonly chatwootCache: CacheService, // TODO: Precisa da definição e importação
    private readonly baileysCache: CacheService, // TODO: Precisa da definição e importação
  ) {
    this.logger.info('Iniciando WAMonitoringService...');

    // Carrega configurações relevantes usando optional chaining '?' para segurança
    Object.assign(this.db, this.configService.get<any /*Database*/>('DATABASE') || {});
    Object.assign(this.redis, this.configService.get<any /*CacheConf*/>('CACHE') || {});
    this.providerSession = this.configService.get<any /*ProviderSession*/>('PROVIDER');

    this.setupInternalEventListeners(); // Configura listeners para eventos internos
    this.logger.info('WAMonitoringService iniciado e listeners configurados.');

    // Considerar chamar loadInstance() fora do construtor, talvez em um método onModuleInit se usar NestJS
    // this.loadInstance();
  }

  /** Configura listeners para eventos de remoção/logout */
  private setupInternalEventListeners(): void {
    this.eventEmitter.on('remove.instance', async (instanceName: string, reason?: string) => {
       this.logger.log(`Evento 'remove.instance' para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       await this.remove(instanceName); // Chama o método de remoção/limpeza
    });

    this.eventEmitter.on('logout.instance', async (instanceName: string, reason?: string) => {
      this.logger.log(`Evento 'logout.instance' para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       try {
         const instance = this.waInstances[instanceName];
         if (!instance) {
             this.logger.warn(`Tentativa de logout em instância não monitorada: ${instanceName}`);
             return;
         };

         // TODO: Precisa de Events e do método sendDataWebhook na instância
         await instance.sendDataWebhook?.(Events.LOGOUT_INSTANCE, null);

         // TODO: Precisa do tipo Chatwoot do env.config
         if (this.configService.get<any>('CHATWOOT')?.ENABLED) {
           // TODO: Verificar se método clearCacheChatwoot existe na instância
           instance.clearCacheChatwoot?.();
         }
         await this.cleaningUp(instanceName); // Limpa dados de sessão/cache
       } catch (e: any) {
         this.logger.error(`Erro durante logout.instance para "${instanceName}": ${e.message}`);
       }
    });

    this.eventEmitter.on('no.connection', async (instanceName: string) => {
       this.logger.warn(`Evento 'no.connection' para: ${instanceName}. Limpando estado.`);
      try {
        const current = this.waInstances[instanceName];
        if (!current) return;

        // Tenta forçar logout e fechar conexão (específico do Baileys/instâncias com client)
        await current.client?.logout?.('Forçado devido a falha na conexão: ' + instanceName);
        current.client?.ws?.close?.();
        current.client?.end?.(undefined);

        // Reseta estado interno
        if (current.instance) current.instance.qrcode = { count: 0 }; // Reseta QR code info
        if (current.stateConnection) current.stateConnection.state = 'close'; // Define estado como fechado

        // Atualiza status no DB para 'close'
        // Corrigido: Acesso via .prisma
        await this.prismaRepository.prisma.instance.updateMany({
            where: { name: instanceName },
            data: { connectionStatus: 'close' }
        });

      } catch (error: any) {
        this.logger.error(`Erro durante limpeza de 'no.connection' para "${instanceName}": ${error.message}`);
      } finally {
        this.logger.warn(`Estado definido como 'close' para instância "${instanceName}" após falha de conexão.`);
      }
    });
  }

  /** Retorna uma instância ativa pelo nome */
  // TODO: Substituir 'any' pelo tipo base da instância (ex: ChannelStartupService)
  public get(instanceName: string): any | undefined {
    return this.waInstances[instanceName];
  }

  /** Remove e limpa uma instância (memória, cache, sessão, arquivos, DB) */
  public async remove(instanceName: string): Promise<void> {
     this.logger.info(`Removendo instância "${instanceName}"...`);
     const instance = this.waInstances[instanceName];

      try {
        if (instance) {
            // Tenta enviar webhook ANTES de deletar
            // TODO: Precisa de Events e do método sendDataWebhook na instância
            await instance.sendDataWebhook?.(Events.REMOVE_INSTANCE, null);
            // Tenta forçar logout e fechamento
            await instance.logoutInstance?.();
            await delay(500); // Pequeno delay para garantir
        }
        // Limpa dados de sessão/cache (mesmo se não estiver em memória)
        await this.cleaningUp(instanceName);
        // Limpa dados persistentes (DB e arquivos) - Ação Destrutiva!
        await this.cleaningStoreData(instanceName);
      } catch (e: any) {
        this.logger.error(`Erro durante limpeza completa ao remover instância "${instanceName}": ${e.message}`);
      } finally {
        // Remove da memória independentemente de erros na limpeza
        delete this.waInstances[instanceName];
        this.logger.info(`Instância "${instanceName}" removida do monitor.`);
      }
  }


  /** Configura timeout para deletar instância inativa */
  public delInstanceTime(instanceName: string): void {
    // TODO: Precisa do tipo DelInstance do env.config
    const time = this.configService.get<number>('DEL_INSTANCE'); // Assumindo que é number
    if (typeof time === 'number' && time > 0) {
      this.logger.info(`Agendando verificação de inatividade para "${instanceName}" em ${time} minutos.`);
      setTimeout(async () => {
        const current = this.waInstances[instanceName];
        // Verifica se a instância ainda existe no monitor e NÃO está aberta
        if (current && current.connectionStatus?.state !== 'open') {
          this.logger.warn(`Instância "${instanceName}" inativa após ${time} minutos. Removendo...`);
          await this.remove(instanceName); // Usa o método remove para limpeza completa
        } else if (current) {
           this.logger.info(`Instância "${instanceName}" está ativa. Remoção por inatividade cancelada.`);
        } else {
             this.logger.info(`Instância "${instanceName}" não encontrada no monitor. Remoção por inatividade cancelada.`);
        }
      }, 1000 * 60 * time);
    }
  }

  /** Busca informações de instâncias no DB */
  // TODO: Tipar retorno com Prisma.Instance[] + Relações
  public async instanceInfo(instanceNames?: string[]): Promise<any[]> {
    // TODO: Precisa do tipo Database do env.config
    const clientName = this.configService.get<any>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    const whereClause: Prisma.InstanceWhereInput = { clientName };

    if (instanceNames?.length) {
      whereClause.name = { in: instanceNames };
      const missing = instanceNames.filter((name) => !this.waInstances[name]);
      if (missing.length > 0) {
        this.logger.warn(`Buscando info de instâncias não monitoradas ativamente: ${missing.join(', ')}`);
      }
    }

    this.logger.debug(`Buscando instâncias no DB com filtro: ${JSON.stringify(whereClause)}`);
    // Corrigido: Acesso via .prisma
    // TODO: Verificar/Ajustar nomes das relações no include com base no schema.prisma
    return this.prismaRepository.prisma.instance.findMany({
      where: whereClause,
      include: {
        Chatwoot: true,
        Proxy: true,
        Rabbitmq: true,
        Sqs: true,
        Websocket: true,
        Setting: true,
        Dify: true,         // Adicionadas novas relações do schema
        EvolutionBot: true,
        Flowise: true,
        OpenaiBot: { include: { creds: true, setting: true } }, // Inclui relações aninhadas
        Typebot: true,
        Pusher: true,
        _count: { select: { Message: true, Contact: true, Chat: true, Label: true } }, // Contagem de Labels
      },
    });
  }

  /** Busca info por ID da instância ou número */
  // TODO: Tipar retorno com Prisma.Instance + Relações
  public async instanceInfoById(instanceId?: string, number?: string): Promise<any[]> {
      this.logger.debug(`Buscando instância por ID: ${instanceId} ou Número: ${number}`);
      let whereClause: Prisma.InstanceWhereUniqueInput | Prisma.InstanceWhereInput = {};

      if (instanceId) {
          whereClause = { id: instanceId };
      } else if (number) {
          // Assumindo que 'number' pode não ser unique, usamos findFirst
           whereClause = { number: number };
      } else {
          throw new BadRequestException('É necessário fornecer instanceId ou number.');
      }

      // Corrigido: Acesso via .prisma
      const instanceDb = await this.prismaRepository.prisma.instance.findFirst({ // findFirst para buscar por 'number'
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

      return this.instanceInfo([instanceName]); // Reutiliza para buscar dados completos
  }

  /** Limpa dados de sessão e cache */
  public async cleaningUp(instanceName: string): Promise<void> {
    this.logger.info(`Limpando sessão/cache para instância "${instanceName}"...`);
    let instanceDbId: string | undefined;

    // Limpa sessão do banco (se configurado)
     // TODO: Precisa do tipo Database do env.config
    if (this.db?.SAVE_DATA?.INSTANCE) {
       // Corrigido: Acesso via .prisma e usando findUnique por 'name' (assumindo unique)
      const found = await this.prismaRepository.prisma.instance.findUnique({
        where: { name: instanceName },
        select: { id: true }
       });
      if (found) {
        instanceDbId = found.id;
        // Corrigido: Acesso via .prisma
        await this.prismaRepository.prisma.session.deleteMany({ where: { sessionId: instanceDbId } });
        this.logger.debug(`Sessão do DB deletada para instanceId: ${instanceDbId}`);
        // Atualiza status para 'close' no DB
         await this.prismaRepository.prisma.instance.update({
            where: { id: instanceDbId },
            data: { connectionStatus: 'close' },
          });
      } else {
           this.logger.warn(`Instância "${instanceName}" não encontrada no DB para limpeza de sessão.`);
      }
    }

    // Limpa cache Redis (se configurado)
     // TODO: Precisa do tipo CacheConf do env.config e CacheService funcional
    if (this.redis?.REDIS?.ENABLED && this.redis?.REDIS?.SAVE_INSTANCES) {
      await this.cache?.delete?.(instanceName); // Deleta chave baseada no nome
      if (instanceDbId) await this.cache?.delete?.(instanceDbId); // Deleta chave baseada no ID
      this.logger.debug(`Cache Redis limpo para "${instanceName}" e ID "${instanceDbId || 'N/A'}"`);
    }

    // Limpa sessão do Provider (se configurado)
     // TODO: Precisa do tipo ProviderSession do env.config e ProviderFiles funcional
    if (this.providerSession?.ENABLED) {
      await this.providerFiles?.removeSession?.(instanceName);
      this.logger.debug(`Sessão do Provider limpa para "${instanceName}"`);
    }
     this.logger.info(`Limpeza de sessão/cache para "${instanceName}" concluída.`);
  }

  /** Limpa TODOS os dados da instância, incluindo DB e arquivos - AÇÃO DESTRUTIVA! */
  public async cleaningStoreData(instanceName: string): Promise<void> {
     this.logger.warn(`ATENÇÃO: Limpando TODOS os dados (DB e arquivos) para instância "${instanceName}"...`);

     // Limpa pasta Chatwoot se configurado
     // TODO: Precisa do tipo Chatwoot do env.config e da constante STORE_DIR
     const storeDir = STORE_DIR || './storage'; // Usando valor padrão
     if (this.configService.get<any>('CHATWOOT')?.ENABLED) {
        const chatwootPath = join(storeDir, 'chatwoot', instanceName + '*');
        this.logger.debug(`Removendo diretório Chatwoot: ${chatwootPath}`);
        try { rmSync(chatwootPath, { recursive: true, force: true }); } catch (e:any) { this.logger.error(`Erro ao remover pasta Chatwoot (${chatwootPath}): ${e.message}`); }
     }

    // Busca ID da instância no DB
    // Corrigido: Acesso via .prisma
    const instance = await this.prismaRepository.prisma.instance.findUnique({
        where: { name: instanceName },
        select: { id: true }
    });
    if (!instance?.id) {
        this.logger.error(`Instância "${instanceName}" não encontrada no DB para limpeza completa. Abortando limpeza de dados.`);
        return;
    }
    const instanceId = instance.id;

    // Limpa pasta da instância
    // TODO: Precisa da constante INSTANCE_DIR
    const instanceDir = INSTANCE_DIR || './instances'; // Usando valor padrão
    const instancePath = join(instanceDir, instanceId);
    this.logger.debug(`Removendo diretório da instância: ${instancePath}`);
    try { rmSync(instancePath, { recursive: true, force: true }); } catch (e:any) { this.logger.error(`Erro ao remover pasta da instância (${instancePath}): ${e.message}`); }

    // Deleta dados relacionados no Prisma
    // TODO: Confirmar nomes exatos dos modelos e relações no schema.prisma
    this.logger.info(`Deletando dados do DB para instanceId: ${instanceId}`);
    try {
        // Usar $transaction para garantir atomicidade (ou falhar tudo junto)
        // Corrigido: Acesso via .prisma
        await this.prismaRepository.prisma.$transaction([
            // Deletar dependentes primeiro (ajustar ordem conforme relações e constraints)
            this.prismaRepository.prisma.session.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.messageUpdate.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.media.deleteMany({ where: { instanceId } }), // Adicionado
            this.prismaRepository.prisma.message.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.chat.deleteMany({ where: { instanceId } }), // Chat pode depender de Contact ou Label? Verificar schema
            this.prismaRepository.prisma.contact.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.webhook.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.chatwoot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.proxy.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.rabbitmq.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.sqs.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.integrationSession.deleteMany({ where: { instanceId } }),
            // Deletar configurações de bots (assumindo relação direta com Instance)
            this.prismaRepository.prisma.difySetting.deleteMany({ where: { dify: { instanceId } } }), // Exemplo: deletar settings primeiro
            this.prismaRepository.prisma.dify.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.evolutionBotSetting.deleteMany({ where: { evolutionBot: { instanceId } } }),
            this.prismaRepository.prisma.evolutionBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.flowiseSetting.deleteMany({ where: { flowise: { instanceId } } }),
            this.prismaRepository.prisma.flowise.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.openaiCreds.deleteMany({ where: { openaiBot: { instanceId } } }), // Deletar creds/settings antes do bot principal
            this.prismaRepository.prisma.openaiSetting.deleteMany({ where: { openaiBot: { instanceId } } }),
            this.prismaRepository.prisma.openaiBot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.typebotSetting.deleteMany({ where: { typebot: { instanceId } } }),
            this.prismaRepository.prisma.typebot.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.setting.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.label.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.pusher.deleteMany({ where: { instanceId } }),
            this.prismaRepository.prisma.websocket.deleteMany({ where: { instanceId } }), // Adicionado Websocket
            this.prismaRepository.prisma.whatsappIntegration.deleteMany({ where: { instanceId } }), // Adicionado

            // Deleta a instância principal por último
            this.prismaRepository.prisma.instance.delete({ where: { id: instanceId } })
        ]);
        this.logger.info(`Dados do DB para instanceId ${instanceId} deletados com sucesso.`);
    } catch (dbError: any) {
         this.logger.error(`Erro ao deletar dados do DB para instanceId ${instanceId}: ${dbError.message}`, dbError.stack);
         // Mesmo com erro, a instância pode ter sido removida da memória, mas o DB está inconsistente.
    }
  }

  /** Carrega instâncias existentes ao iniciar (baseado na configuração) */
  public async loadInstance(): Promise<void> {
    this.logger.info('Carregando instâncias existentes...');
    try {
       // TODO: Precisa dos tipos ProviderSession, Database, CacheConf de env.config
      if (this.providerSession?.ENABLED) {
        this.logger.info('Carregando instâncias do Provider...');
        await this.loadInstancesFromProvider();
      } else if (this.db?.SAVE_DATA?.INSTANCE) {
         this.logger.info('Carregando instâncias do Banco de Dados...');
        await this.loadInstancesFromDatabase();
      } else if (this.redis?.REDIS?.ENABLED && this.redis?.REDIS?.SAVE_INSTANCES) {
         this.logger.info('Carregando instâncias do Redis...');
        await this.loadInstancesFromRedis();
      } else {
         this.logger.warn('Nenhum método de persistência de instância habilitado.');
      }
       this.logger.info('Carregamento de instâncias concluído.');
    } catch (error: any) {
      this.logger.error(`Erro ao carregar instâncias: ${error.message}`);
    }
  }

  /** Cria e salva uma nova instância no DB (se configurado) */
  // TODO: Tipar 'data' com um DTO de criação mais específico
  public async saveInstance(data: any): Promise<void> {
    // TODO: Precisa do tipo Database de env.config
    if (!this.db?.SAVE_DATA?.INSTANCE) {
        this.logger.debug('Persistência de instância no DB desabilitada, pulando saveInstance.');
        return;
    }
    this.logger.info(`Salvando/Atualizando instância no DB: ${data.instanceName}`);
    try {
      const clientName = this.configService.get<any>('DATABASE')?.CONNECTION?.CLIENT_NAME;
      // Usa upsert para criar se não existir ou atualizar se existir (baseado no nome)
      // Corrigido: Acesso via .prisma
      // TODO: Precisa do tipo Integration de wa.types
      const instanceData: Prisma.InstanceUpsertArgs = {
          where: { name: data.instanceName },
          create: {
              id: data.instanceId || undefined, // Usa ID se fornecido
              name: data.instanceName,
              ownerJid: data.ownerJid,
              profileName: data.profileName,
              profilePicUrl: data.profilePicUrl,
              connectionStatus: 'close', // Sempre começa como close no DB
              number: data.number,
              integration: data.integration || 'WHATSAPP_BAILEYS', // TODO: Usar Integration enum
              token: data.hash || data.token,
              clientName,
              businessId: data.businessId,
          },
          update: { // O que atualizar se a instância já existir pelo nome?
              ownerJid: data.ownerJid,
              profileName: data.profileName,
              profilePicUrl: data.profilePicUrl,
              // NÃO atualizar status aqui, só quando conectar/desconectar
              number: data.number,
              integration: data.integration || 'WHATSAPP_BAILEYS', // TODO: Usar Integration enum
              token: data.hash || data.token,
              clientName,
              businessId: data.businessId,
              // connectionStatus: ??? // Não atualizar status aqui
          }
      };
      const saved = await this.prismaRepository.prisma.instance.upsert(instanceData);
      this.logger.info(`Instância "${data.instanceName}" salva/atualizada no DB com ID: ${saved.id}`);
    } catch (error: any) {
       this.logger.error(`Erro ao salvar/atualizar instância "${data.instanceName}" no DB: ${error.message}`);
       throw error; // Relança o erro
    }
  }

   /**
   * Cria e inicializa uma instância de canal (Baileys, Meta, etc.).
   * Ponto de entrada principal para adicionar/iniciar uma instância.
   * @param instanceData Dados da instância (nome, token, etc.)
   * @returns A instância do canal inicializada ou undefined em caso de erro.
   */
   // TODO: Retornar tipo base da instância (ex: ChannelStartupService)
  public async createInstance(instanceData: InstanceDto): Promise<any | undefined> {
    this.logger.info(`Solicitação para criar/inicializar instância: ${instanceData.instanceName} (Integração: ${instanceData.integration || 'Padrão'})`);

    if (this.waInstances[instanceData.instanceName]) {
        this.logger.warn(`Instância "${instanceData.instanceName}" já existe no monitor. Retornando existente.`);
        // Opcional: Tentar reconectar se estiver fechada?
        // if (this.waInstances[instanceData.instanceName].connectionStatus?.state === 'close') {
        //    await this.waInstances[instanceData.instanceName].connectToWhatsapp();
        // }
        return this.waInstances[instanceData.instanceName];
    }

    // Garante/Obtém/Cria o registro da instância no DB primeiro (se SAVE_DATA.INSTANCE for true)
    // Isso garante que temos um instanceId consistente.
    let instanceId = instanceData.instanceId;
    if (this.db?.SAVE_DATA?.INSTANCE) {
         try {
             const upsertData: Prisma.InstanceUpsertArgs = {
                 where: { name: instanceData.instanceName },
                 create: {
                     name: instanceData.instanceName,
                     id: instanceData.instanceId || undefined, // Permite que o DB gere se não fornecido
                     integration: instanceData.integration || 'WHATSAPP_BAILEYS', // TODO: Usar enum Integration
                     token: instanceData.token,
                     number: instanceData.number,
                     businessId: instanceData.businessId,
                     connectionStatus: 'close', // Estado inicial no DB
                     clientName: this.configService.get<any>('DATABASE')?.CONNECTION?.CLIENT_NAME,
                 },
                 update: { // Atualiza dados se a instância já existe pelo nome
                     integration: instanceData.integration || 'WHATSAPP_BAILEYS',
                     token: instanceData.token,
                     number: instanceData.number,
                     businessId: instanceData.businessId,
                 }
             };
             // Corrigido: Acesso via .prisma
             const dbInstance = await this.prismaRepository.prisma.instance.upsert(upsertData);
             instanceId = dbInstance.id; // Usa o ID do banco (criado ou existente)
             instanceData.instanceId = instanceId; // Atualiza o DTO com o ID correto
             this.logger.info(`Registro da instância "${instanceData.instanceName}" garantido no DB com ID: ${instanceId}`);
         } catch(dbError: any) {
              this.logger.error(`Erro ao garantir registro da instância "${instanceData.instanceName}" no DB: ${dbError.message}`);
              throw new InternalServerErrorException(`Erro de banco de dados ao preparar instância: ${dbError.message}`);
         }
    } else if (!instanceId) {
         // Se não salva no DB e não tem ID, gera um temporário (menos ideal)
         instanceId = v4();
         instanceData.instanceId = instanceId;
          this.logger.warn(`Persistência de instância no DB desabilitada. Usando ID gerado: ${instanceId} para ${instanceData.instanceName}`);
    }

    // Agora tenta inicializar a instância real usando o channelController
    try {
        // TODO: 'channelController.init' é a peça que falta. Precisa ser importado e funcional.
        //       Ele deve retornar a instância específica do canal (Baileys, Meta, etc.).
        this.logger.debug(`Chamando channelController.init para ${instanceData.instanceName} (ID: ${instanceId})`);
        const instance = channelController?.init?.(instanceData, {
            // Injetando dependências que o channelController/Serviços de Canal podem precisar
            configService: this.configService,
            eventEmitter: this.eventEmitter,
            prismaRepository: this.prismaRepository,
            cache: this.cache,
            chatwootCache: this.chatwootCache,
            baileysCache: this.baileysCache,
            providerFiles: this.providerFiles,
        });

        if (!instance) {
            this.logger.error(`Falha ao inicializar instância via channelController para ${instanceData.instanceName}`);
            throw new Error('channelController.init retornou inválido');
        }
        this.logger.debug(`Instância inicializada via channelController para ${instanceData.instanceName}`);

        // Configura a instância (passa dados como ID, nome, token)
        // TODO: Garantir que a instância retornada tenha o método 'setInstance'
        instance.setInstance(instanceData);

        // Tenta conectar ao respectivo serviço (WhatsApp, Meta API, etc.)
        // TODO: Garantir que a instância retornada tenha o método 'connectToWhatsapp'
        await instance.connectToWhatsapp(); // Pode gerar QR code, etc.

        // Armazena no monitor e configura timeout
        this.waInstances[instanceData.instanceName] = instance;
        this.logger.info(`Instância "${instanceData.instanceName}" (ID: ${instanceId}) adicionada ao monitor e conexão iniciada.`);
        this.delInstanceTime(instanceData.instanceName);

        return instance;

    } catch (error: any) {
        this.logger.error(`Erro CRÍTICO ao criar/inicializar instância ${instanceData.instanceName}: ${error.message}`, error.stack);
        // Se falhou aqui, tenta remover o registro do DB se ele foi criado/atualizado e SAVE_DATA está ativo
        if (this.db?.SAVE_DATA?.INSTANCE && instanceId) {
             this.logger.warn(`Tentando remover registro DB para ${instanceName} devido à falha na inicialização...`);
             // Idealmente, apenas reverteria o upsert, mas delete é mais simples
             // CUIDADO: Isso pode deletar uma instância que existia antes mas falhou ao reiniciar
             // await this.prismaRepository.prisma.instance.delete({ where: { id: instanceId } }).catch(e => this.logger.error(`Erro ao deletar instância ${instanceId} do DB após falha: ${e.message}`));
        }
        // Remove da memória se chegou a ser adicionada
        delete this.waInstances[instanceData.instanceName];
        // Limpa arquivos/cache relacionados ao ID (se aplicável)
        await this.cleaningUp(instanceData.instanceName);
        throw new InternalServerErrorException(`Erro ao inicializar instância ${instanceData.instanceName}: ${error.message}`);
    }
  }


  // --- Métodos de Carregamento (Adaptados) ---
  // Removido setInstance duplicado

  private async loadInstancesFromRedis(): Promise<void> {
    this.logger.info('Carregando instâncias do Redis...');
    // TODO: Precisa de CacheService funcional com método keys/scan e get
    this.logger.warn('loadInstancesFromRedis não implementado.');
  }

  private async loadInstancesFromDatabase(): Promise<void> {
    // TODO: Precisa do tipo Database de env.config
    const clientName = this.configService.get<any>('DATABASE')?.CONNECTION?.CLIENT_NAME;
    if (!clientName) {
        this.logger.warn('CLIENT_NAME não definido, não é possível carregar instâncias do DB.');
        return;
    }
    // Corrigido: Acesso via .prisma
    // Seleciona apenas os campos necessários para recriar o DTO
    const instances = await this.prismaRepository.prisma.instance.findMany({
        where: { clientName },
        select: { id: true, name: true, integration: true, token: true, number: true, businessId: true }
    });
    this.logger.info(`Encontradas ${instances.length} instâncias no DB para ${clientName}.`);
    if (!instances.length) return;

    const results = await Promise.allSettled(
      instances.map(async (i) => {
        this.logger.info(`Tentando recarregar instância do DB: ${i.name} (ID: ${i.id})`);
        const instanceDto: InstanceDto = { // TODO: Precisa do DTO InstanceDto
            instanceId: i.id,
            instanceName: i.name,
            integration: i.integration as Integration, // TODO: Precisa do enum Integration
            token: i.token,
            number: i.number,
            businessId: i.businessId,
         };
         // Usa createInstance para garantir que passe pelo mesmo fluxo de inicialização
         await this.createInstance(instanceDto);
      }),
    );

     results.forEach((result, index) => {
        if (result.status === 'rejected') {
            this.logger.error(`Falha ao recarregar instância ${instances[index].name} do DB: ${result.reason?.message || result.reason}`);
        }
     });
  }

  private async loadInstancesFromProvider(): Promise<void> {
    this.logger.info('Carregando instâncias do Provider...');
    // TODO: Precisa de ProviderFiles funcional com método allInstances
    this.logger.warn('loadInstancesFromProvider não implementado.');
  }

} // Fim da classe WAMonitoringService
