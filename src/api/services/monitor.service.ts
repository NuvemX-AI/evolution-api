// src/api/services/monitor.service.ts

// Imports de DTOs e Tipos (usando aliases @api)
import { InstanceDto } from '@api/dto/instance.dto'; // TODO: Precisa do arquivo instance.dto.ts
import { Events, Integration } from '@api/types/wa.types'; // TODO: Precisa do arquivo wa.types.ts

// Imports de Serviços, Repositórios, Config (usando aliases)
import { ProviderFiles } from '@provider/sessions'; // TODO: Precisa do arquivo sessions.ts
import { PrismaRepository } from '@repository/repository.service';
// TODO: Precisa do arquivo server.module.ts que exporta 'channelController'
//       Pode ser uma classe, um objeto ou uma instância, dependendo da implementação.
import { channelController } from '@api/server.module';
import { CacheConf, Chatwoot, ConfigService, Database, DelInstance, ProviderSession } from '@config/env.config'; // TODO: Precisa do arquivo env.config.ts
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config'; // TODO: Precisa do arquivo path.config.ts
import { NotFoundException } from '@exceptions'; // Usando alias
import { CacheService } from './cache.service'; // TODO: Precisa do arquivo cache.service.ts

// Imports de Node.js e Libs Externas
import { execSync } from 'child_process';
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';
// TODO: Importar a interface/classe base da instância (ex: ChannelStartupService) se existir
// import { ChannelStartupService } from './channel.service';

export class WAMonitoringService {
  // TODO: Tipar Logger corretamente quando logger.config.ts for fornecido
  private readonly logger: Logger = new Logger('WAMonitoringService');

  // Armazena as instâncias ativas (Chave: instanceName, Valor: instância do canal (Baileys, Meta, etc.))
  // TODO: Substituir 'any' pelo tipo/interface base da instância (ex: ChannelStartupService)
  public readonly waInstances: Record<string, any> = {};

  // Configurações locais cacheadas
  private readonly db: Partial<Database> = {};
  private readonly redis: Partial<CacheConf> = {};
  private readonly providerSession: ProviderSession | undefined; // Tipo correto de env.config

  constructor(
    // Injetando dependências necessárias
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly providerFiles: ProviderFiles, // TODO: Precisa do arquivo sessions.ts
    private readonly cache: CacheService, // TODO: Precisa do arquivo cache.service.ts
    // TODO: Estes caches podem ser instâncias diferentes do CacheService ou o mesmo?
    private readonly chatwootCache: CacheService, // Precisa do arquivo cache.service.ts
    private readonly baileysCache: CacheService, // Precisa do arquivo cache.service.ts
  ) {
    this.logger.info('Iniciando WAMonitoringService...');

    // Carrega configurações relevantes
    // Usando || {} para evitar erros se a config não estiver definida
    Object.assign(this.db, this.configService.get<Database>('DATABASE') || {});
    Object.assign(this.redis, this.configService.get<CacheConf>('CACHE') || {});
    this.providerSession = this.configService.get<ProviderSession>('PROVIDER');

    // Configura listeners para eventos internos
    this.setupInternalEventListeners();

    // Carrega instâncias existentes ao iniciar (opcional, pode ser chamado externamente)
    // this.loadInstance(); // Comentado para evitar execução automática no construtor
  }

  /** Configura listeners para eventos de remoção/logout */
  private setupInternalEventListeners(): void {
    this.eventEmitter.on('remove.instance', (instanceName: string, reason?: string) => {
       this.logger.log(`Recebido evento 'remove.instance' para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       this.remove(instanceName); // Chama o método de remoção/limpeza
    });

    this.eventEmitter.on('logout.instance', async (instanceName: string, reason?: string) => {
      this.logger.log(`Recebido evento 'logout.instance' para: ${instanceName}. Razão: ${reason || 'N/A'}`);
       try {
         const instance = this.waInstances[instanceName];
         if (!instance) return; // Instância já removida

         await instance.sendDataWebhook?.(Events.LOGOUT_INSTANCE, null); // TODO: Precisa de Events e sendDataWebhook

         if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED) {
           // TODO: Verificar se método clearCacheChatwoot existe na instância
           instance.clearCacheChatwoot?.();
         }
         await this.cleaningUp(instanceName); // Limpa dados de sessão/cache
         // Não deleta a instância do DB aqui, apenas limpa sessão/cache
       } catch (e: any) {
         this.logger.warn(`Erro durante logout.instance para "${instanceName}": ${e.message}`);
       }
    });

    this.eventEmitter.on('no.connection', async (instanceName: string) => {
       this.logger.warn(`Recebido evento 'no.connection' para: ${instanceName}. Tentando limpar estado.`);
      try {
        const current = this.waInstances[instanceName];
        if (!current) return;

        // Tenta forçar logout e fechar conexão se possível (específico do Baileys)
        await current.client?.logout?.('Forçado devido a falha na conexão: ' + instanceName);
        current.client?.ws?.close?.();
        current.client?.end?.(undefined); // Encerra o cliente Baileys

        // Reseta estado interno
        if (current.instance) current.instance.qrcode = { count: 0 };
        if (current.stateConnection) current.stateConnection.state = 'close';

        // Atualiza status no DB para 'close'
        await this.prismaRepository.prisma.instance.updateMany({
            where: { name: instanceName },
            data: { connectionStatus: 'close' }
        });

      } catch (error: any) {
        this.logger.error(`Erro durante limpeza de 'no.connection' para "${instanceName}": ${error.message}`);
      } finally {
        this.logger.warn(`Estado limpo para instância "${instanceName}" após falha de conexão.`);
      }
    });
  }

  /** Retorna uma instância ativa pelo nome */
  public get(instanceName: string): any | undefined { // TODO: Substituir 'any' pelo tipo base da instância
    return this.waInstances[instanceName];
  }

  /** Remove e limpa uma instância */
  public async remove(instanceName: string): Promise<void> {
     this.logger.info(`Removendo instância "${instanceName}"...`);
     const instance = this.waInstances[instanceName];
     if (!instance) {
          this.logger.warn(`Instância "${instanceName}" não encontrada no monitor para remoção.`);
          // Mesmo assim, tenta limpar dados persistentes caso existam
          await this.cleaningUp(instanceName);
          await this.cleaningStoreData(instanceName); // CUIDADO: Isso deleta dados do DB
          return;
     }
      try {
        // Envia webhook ANTES de deletar
        await instance.sendDataWebhook?.(Events.REMOVE_INSTANCE, null); // TODO: Precisa de Events e sendDataWebhook
        // Força logout e fechamento (importante para Baileys liberar recursos)
        await instance.logoutInstance?.();
        await delay(500); // Pequeno delay
        // Limpa dados de sessão/cache
        await this.cleaningUp(instanceName);
        // Limpa dados persistentes (DB, arquivos) - CUIDADO: Ação destrutiva
        await this.cleaningStoreData(instanceName);
      } catch (e: any) {
        this.logger.warn(`Erro durante limpeza ao remover instância "${instanceName}": ${e.message}`);
      } finally {
        delete this.waInstances[instanceName]; // Remove da memória
        this.logger.info(`Instância "${instanceName}" removida.`);
      }
  }


  /** Configura timeout para deletar instância inativa */
  public delInstanceTime(instanceName: string): void {
    // TODO: Precisa do tipo DelInstance do env.config
    const time = this.configService.get<DelInstance>('DEL_INSTANCE');
    if (typeof time === 'number' && time > 0) {
      this.logger.info(`Agendando remoção da instância "${instanceName}" em ${time} minutos se inativa.`);
      setTimeout(async () => {
        const current = this.waInstances[instanceName];
        // Verifica se a instância ainda existe e NÃO está aberta
        if (current && current.connectionStatus?.state !== 'open') {
          this.logger.warn(`Instância "${instanceName}" inativa após ${time} minutos. Removendo...`);
          await this.remove(instanceName); // Usa o método remove para limpeza completa
        } else if (current) {
           this.logger.info(`Instância "${instanceName}" está ativa. Remoção cancelada.`);
        } else {
             this.logger.info(`Instância "${instanceName}" não encontrada. Remoção cancelada.`);
        }
      }, 1000 * 60 * time);
    }
  }

  /** Busca informações de instâncias no DB */
  public async instanceInfo(instanceNames?: string[]): Promise<any[]> { // TODO: Tipar retorno com Prisma.Instance[]
    const clientName = this.configService.get<Database>('DATABASE')?.CONNECTION?.CLIENT_NAME; // TODO: Precisa de env.config Database type
    const whereClause: Prisma.InstanceWhereInput = { clientName }; // Usando tipo Prisma

    if (instanceNames?.length) {
      whereClause.name = { in: instanceNames };

      // Validação extra: verifica se todas as instâncias pedidas existem em memória
      const missing = instanceNames.filter((name) => !this.waInstances[name]);
      if (missing.length > 0) {
        this.logger.warn(`Tentando buscar info de instâncias não monitoradas: ${missing.join(', ')}`);
        // Pode lançar erro ou apenas logar, dependendo do requisito
        // throw new NotFoundException(`Instância(s) "${missing.join(', ')}" não encontrada(s) no monitor.`);
      }
    }

    this.logger.debug(`Buscando informações no DB com filtro: ${JSON.stringify(whereClause)}`);
    // Corrigido: Acesso via .prisma
    return this.prismaRepository.prisma.instance.findMany({
      where: whereClause,
      // TODO: Verificar nomes das relações no schema.prisma
      include: {
        Chatwoot: true,
        Proxy: true,
        Rabbitmq: true,
        Sqs: true,
        Websocket: true,
        Setting: true,
        _count: { select: { Message: true, Contact: true, Chat: true } },
      },
    });
  }

  // Busca info por ID da instância ou número
  public async instanceInfoById(instanceId?: string, number?: string): Promise<any[]> {
      this.logger.debug(`Buscando instância por ID: ${instanceId} ou Número: ${number}`);
      let instanceName: string | undefined;

      const whereClause: Prisma.InstanceWhereUniqueInput = {};
      if (instanceId) {
          whereClause.id = instanceId;
      } else if (number) {
          whereClause.number = number; // TODO: Verificar se 'number' é unique no schema
          // Se 'number' não for unique, usar findFirst com 'number' no where
      } else {
          throw new BadRequestException('É necessário fornecer instanceId ou number.');
      }

      // Corrigido: Acesso via .prisma
      const instanceDb = await this.prismaRepository.prisma.instance.findUnique({
          where: whereClause,
          select: { name: true } // Seleciona apenas o nome
      });

      instanceName = instanceDb?.name;

      if (!instanceName) {
          throw new NotFoundException(`Instância com ${instanceId ? `ID ${instanceId}` : `Número ${number}`} não encontrada no banco de dados.`);
      }

      if (!this.waInstances[instanceName]) {
          this.logger.warn(`Instância "${instanceName}" encontrada no DB mas não está ativa no monitor.`);
          // Pode optar por retornar os dados do DB mesmo assim ou lançar erro
           // throw new NotFoundException(`Instância "${instanceName}" não está ativa no monitor.`);
      }

      // Reutiliza o método instanceInfo para buscar os dados completos
      return this.instanceInfo([instanceName]);
  }

  /** Limpa dados de sessão e cache */
  public async cleaningUp(instanceName: string): Promise<void> {
    this.logger.info(`Limpando sessão/cache para instância "${instanceName}"...`);
    let instanceDbId: string | undefined;

    // Limpa sessão do banco (se configurado)
    if (this.db?.SAVE_DATA?.INSTANCE) {
      // Corrigido: Acesso via .prisma
      const found = await this.prismaRepository.prisma.instance.findUnique({
        where: { name: instanceName }, // Assumindo que 'name' é unique
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
      }
    }

    // Limpa cache Redis (se configurado)
    if (this.redis?.REDIS?.ENABLED && this.redis?.REDIS?.SAVE_INSTANCES) {
      // TODO: CacheService precisa do método delete
      await this.cache?.delete?.(instanceName); // Deleta chave baseada no nome
      if (instanceDbId) await this.cache?.delete?.(instanceDbId); // Deleta chave baseada no ID
      this.logger.debug(`Cache Redis limpo para "${instanceName}" e ID "${instanceDbId || 'N/A'}"`);
    }

    // Limpa sessão do Provider (se configurado)
    if (this.providerSession?.ENABLED) {
       // TODO: ProviderFiles precisa do método removeSession
      await this.providerFiles?.removeSession?.(instanceName);
      this.logger.debug(`Sessão do Provider limpa para "${instanceName}"`);
    }
  }

  /** Limpa TODOS os dados da instância, incluindo DB e arquivos */
  public async cleaningStoreData(instanceName: string): Promise<void> {
     this.logger.warn(`ATENÇÃO: Limpando TODOS os dados (DB e arquivos) para instância "${instanceName}"...`);

     // Limpa pasta Chatwoot se configurado
    if (this.configService.get<Chatwoot>('CHATWOOT')?.ENABLED) {
      // TODO: STORE_DIR precisa vir de path.config.ts
      const chatwootPath = join(STORE_DIR || './storage', 'chatwoot', instanceName + '*');
       this.logger.debug(`Removendo diretório Chatwoot: ${chatwootPath}`);
      try { rmSync(chatwootPath, { recursive: true, force: true }); } catch (e:any) { this.logger.error(`Erro ao remover pasta Chatwoot: ${e.message}`); }
    }

    // Busca ID da instância no DB
     // Corrigido: Acesso via .prisma
    const instance = await this.prismaRepository.prisma.instance.findUnique({
        where: { name: instanceName },
        select: { id: true }
    });
    if (!instance?.id) {
        this.logger.warn(`Instância "${instanceName}" não encontrada no DB para limpeza completa de dados.`);
        return;
    }
    const instanceId = instance.id;

    // Limpa pasta da instância
     // TODO: INSTANCE_DIR precisa vir de path.config.ts
     const instancePath = join(INSTANCE_DIR || './instances', instanceId);
     this.logger.debug(`Removendo diretório da instância: ${instancePath}`);
     try { rmSync(instancePath, { recursive: true, force: true }); } catch (e:any) { this.logger.error(`Erro ao remover pasta da instância: ${e.message}`); }

    // Deleta dados relacionados no Prisma (usando transaction para segurança)
    // TODO: Confirmar nomes das tabelas/modelos e relações no schema.prisma
    this.logger.info(`Deletando dados do DB para instanceId: ${instanceId}`);
    try {
        // Corrigido: Acesso via .prisma
        await this.prismaRepository.prisma.$transaction([
            this.prismaRepository.prisma.session.deleteMany({ where: { sessionId: instanceId } }),
            this.prismaRepository.prisma.chat.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.contact.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.messageUpdate.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.media.deleteMany({ where: { instanceId: instanceId } }), // Adicionado Media
            this.prismaRepository.prisma.message.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.webhook.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.chatwoot.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.proxy.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.rabbitmq.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.sqs.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.integrationSession.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.typebot.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.websocket.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.openaiSetting.deleteMany({ where: { instanceId: instanceId } }), // Adicionado OpenAI
            this.prismaRepository.prisma.dify.deleteMany({ where: { instanceId: instanceId } }),         // Adicionado Dify
            this.prismaRepository.prisma.evolutionBot.deleteMany({ where: { instanceId: instanceId } }), // Adicionado EvolutionBot
            this.prismaRepository.prisma.flowise.deleteMany({ where: { instanceId: instanceId } }),     // Adicionado Flowise
            this.prismaRepository.prisma.setting.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.label.deleteMany({ where: { instanceId: instanceId } }),
            this.prismaRepository.prisma.instance.delete({ where: { id: instanceId } }) // Deleta a instância por último
        ]);
        this.logger.info(`Dados do DB para instanceId ${instanceId} deletados com sucesso.`);
    } catch (dbError: any) {
         this.logger.error(`Erro ao deletar dados do DB para instanceId ${instanceId}: ${dbError.message}`);
    }
  }

  /** Carrega instâncias existentes ao iniciar (baseado na configuração) */
  public async loadInstance(): Promise<void> {
    this.logger.info('Carregando instâncias existentes...');
    try {
      if (this.providerSession?.ENABLED) {
        this.logger.info('Carregando instâncias do Provider...');
        await this.loadInstancesFromProvider();
      } else if (this.db?.SAVE_DATA?.INSTANCE) {
         this.logger.info('Carregando instâncias do Banco de Dados...');
        await this.loadInstancesFromDatabase(); // Renomeado para clareza
      } else if (this.redis?.REDIS?.ENABLED && this.redis?.REDIS?.SAVE_INSTANCES) {
         this.logger.info('Carregando instâncias do Redis...');
        await this.loadInstancesFromRedis();
      } else {
         this.logger.warn('Nenhum método de persistência de instância habilitado (DB, Redis ou Provider). Nenhuma instância será carregada.');
      }
       this.logger.info('Carregamento de instâncias concluído.');
    } catch (error: any) {
      this.logger.error(`Erro ao carregar instâncias: ${error.message}`);
    }
  }

  /** Cria e salva uma nova instância no DB */
  public async saveInstance(data: any): Promise<void> { // TODO: Tipar 'data' com um DTO de criação
    this.logger.info(`Salvando nova instância no DB: ${data.instanceName}`);
    try {
      const clientName = this.configService.get<Database>('DATABASE')?.CONNECTION?.CLIENT_NAME; // TODO: Precisa de env.config
      // Corrigido: Acesso via .prisma
      await this.prismaRepository.prisma.instance.create({
        data: {
          id: data.instanceId, // Assume que já tem ID (pode ser gerado antes)
          name: data.instanceName,
          ownerJid: data.ownerJid,
          profileName: data.profileName,
          profilePicUrl: data.profilePicUrl,
          // Define como 'close' inicialmente, a conexão real atualiza depois
          connectionStatus: 'close',
          number: data.number, // Número associado (ex: ID da Meta)
          // Define integração padrão se não fornecida
          integration: data.integration || Integration.WHATSAPP_BAILEYS, // TODO: Precisa de Integration enum
          token: data.hash || data.token, // Token de acesso (API Key, etc.)
          clientName,
          businessId: data.businessId,
        },
      });
       this.logger.info(`Instância "${data.instanceName}" salva no DB com ID: ${data.instanceId}`);
    } catch (error: any) {
       this.logger.error(`Erro ao salvar instância "${data.instanceName}" no DB: ${error.message}`);
       // Relançar o erro para que o chamador saiba que falhou?
       throw error;
    }
  }

   /**
   * Cria e inicializa uma instância de canal (Baileys, Meta, etc.).
   * Este é o método principal chamado externamente (ex: pelo InstanceController).
   * @param instanceData Dados da instância (nome, token, etc.)
   * @returns A instância do canal inicializada ou undefined em caso de erro.
   */
  public async createInstance(instanceData: InstanceDto): Promise<any | undefined> { // TODO: Retornar tipo base da instância
    this.logger.info(`Tentando criar/inicializar instância: ${instanceData.instanceName} (Integração: ${instanceData.integration || 'Padrão'})`);

    if (this.waInstances[instanceData.instanceName]) {
        this.logger.warn(`Instância "${instanceData.instanceName}" já existe no monitor.`);
        return this.waInstances[instanceData.instanceName];
    }

    // Garante que temos um ID único para a instância
    // Se não veio, pode gerar aqui ou buscar/criar no DB antes
    if (!instanceData.instanceId) {
         // TODO: Implementar busca/criação no DB para obter/gerar instanceId
         this.logger.warn(`instanceId não fornecido para ${instanceData.instanceName}. Gerando um novo.`);
         // instanceData.instanceId = cuid(); // Exemplo usando CUID2 se instalado
         instanceData.instanceId = v4(); // Usando UUID v4 por enquanto
         // Idealmente, salvaria no DB aqui se 'SAVE_DATA.INSTANCE' for true
         // await this.saveInstance(instanceData); // Salva antes de inicializar
    }

    try {
        // TODO: 'channelController.init' é a peça chave que falta.
        //       Ele deve ser responsável por decidir qual classe de serviço instanciar
        //       (BaileysStartupService, BusinessStartupService, EvolutionStartupService)
        //       com base em 'instanceData.integration' e injetar as dependências corretas.
        this.logger.debug(`Chamando channelController.init para ${instanceData.instanceName}`);
        const instance = channelController?.init?.(instanceData, {
            // Passa dependências que o channelController pode precisar para injetar
            configService: this.configService,
            eventEmitter: this.eventEmitter,
            prismaRepository: this.prismaRepository,
            cache: this.cache,
            chatwootCache: this.chatwootCache,
            baileysCache: this.baileysCache,
            providerFiles: this.providerFiles,
            // Adicione outras dependências se necessário
        });

        if (!instance) {
            this.logger.error(`Falha ao inicializar instância via channelController para ${instanceData.instanceName}`);
            throw new Error('channelController.init retornou undefined');
        }

        this.logger.debug(`Instância inicializada via channelController para ${instanceData.instanceName}`);

        // Configura a instância recém-criada
        // TODO: Garantir que 'instance' tenha o método 'setInstance'
        instance.setInstance(instanceData);

        // Conecta ao WhatsApp (pode iniciar geração de QR Code, etc.)
        // TODO: Garantir que 'instance' tenha o método 'connectToWhatsapp'
        await instance.connectToWhatsapp(); // Não passa número aqui, connect pode decidir se usa

        // Armazena a instância ativa no monitor
        this.waInstances[instanceData.instanceName] = instance;
        this.logger.info(`Instância "${instanceData.instanceName}" adicionada ao monitor.`);

        // Configura timeout para remoção se inativa (opcional)
        this.delInstanceTime(instanceData.instanceName);

        return instance; // Retorna a instância criada/inicializada

    } catch (error: any) {
        this.logger.error(`Erro CRÍTICO ao criar/inicializar instância ${instanceData.instanceName}: ${error.message}`, error.stack);
        // Limpar recursos se a inicialização falhou parcialmente?
        delete this.waInstances[instanceData.instanceName];
        await this.cleaningUp(instanceData.instanceName); // Tenta limpar o que foi criado
        // Relança o erro para o controller saber que falhou
        throw new InternalServerErrorException(`Erro ao inicializar instância ${instanceData.instanceName}: ${error.message}`);
    }
  }


  // --- Métodos de Carregamento ---
  private async setInstance(instanceData: InstanceDto): Promise<void> {
    // Este método foi movido para ser parte do 'createInstance' usando channelController
    // Mantido aqui como referência, mas a lógica principal deve estar em createInstance
    this.logger.warn('Método setInstance interno chamado - a lógica principal agora está em createInstance');
     try {
         await this.createInstance(instanceData);
     } catch (error: any) {
          this.logger.error(`Erro ao chamar createInstance de dentro de setInstance para ${instanceData.instanceName}: ${error.message}`);
     }
  }

  private async loadInstancesFromRedis(): Promise<void> {
    // TODO: Implementar lógica para buscar chaves de instância no Redis
    //       e chamar createInstance para cada uma.
    this.logger.warn('loadInstancesFromRedis não implementado.');
    // Exemplo:
    // const keys = await this.cache?.keys?.('instance:*'); // Ajustar padrão da chave
    // if (!keys?.length) return;
    // await Promise.all(keys.map(async (key) => {
    //   const instanceDataFromCache = await this.cache?.get(key);
    //   if (instanceDataFromCache) {
    //     await this.createInstance(instanceDataFromCache as InstanceDto);
    //   }
    // }));
  }

  private async loadInstancesFromDatabase(): Promise<void> { // Renomeado
    const clientName = this.configService.get<Database>('DATABASE')?.CONNECTION?.CLIENT_NAME; // TODO: Precisa de env.config
    if (!clientName) {
        this.logger.warn('CLIENT_NAME não definido, não é possível carregar instâncias do DB.');
        return;
    }
    // Corrigido: Acesso via .prisma
    const instances = await this.prismaRepository.prisma.instance.findMany({
        where: { clientName },
        // Incluir dados necessários para recriar a instância, se houver (token, etc.)
        // select: { id: true, name: true, integration: true, token: true, number: true, businessId: true /* ... outros */ }
    });
    this.logger.info(`Encontradas ${instances.length} instâncias no DB para ${clientName}.`);
    if (!instances.length) return;

    // Usar Promise.allSettled para tentar carregar todas, mesmo que algumas falhem
    const results = await Promise.allSettled(
      instances.map(async (i) => {
         this.logger.info(`Recarregando instância do DB: ${i.name} (ID: ${i.id})`);
         // Monta o DTO necessário para createInstance
         const instanceDto: InstanceDto = {
            instanceId: i.id,
            instanceName: i.name,
            integration: i.integration as Integration, // TODO: Precisa do enum Integration
            token: i.token,
            number: i.number, // Número/ID da Meta
            businessId: i.businessId,
            // Adicionar outros campos se necessário
         };
         await this.createInstance(instanceDto);
      }),
    );

     results.forEach((result, index) => {
        if (result.status === 'rejected') {
            this.logger.error(`Falha ao recarregar instância ${instances[index].name}: ${result.reason}`);
        }
     });
  }

  private async loadInstancesFromProvider(): Promise<void> {
    // TODO: Precisa da implementação de ProviderFiles
    this.logger.warn('loadInstancesFromProvider não implementado.');
    // Exemplo:
    // const [instances] = await this.providerFiles?.allInstances?.();
    // if (!instances?.data?.length) return;
    // await Promise.all(
    //   instances.data.map(async (instanceName: string) => {
          // Buscar dados completos da instância (ex: no DB ou no provider)
          // const data = await this.prismaRepository.prisma.instance.findUnique({ where: { name: instanceName } });
          // if(data) {
          //     const instanceDto: InstanceDto = { ... };
          //     await this.createInstance(instanceDto);
          // }
    //   }),
    // );
  }

} // Fim da classe WAMonitoringService
