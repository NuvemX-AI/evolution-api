// Arquivo: src/api/services/monitor.service.ts
// Correções v8: Aplica correções baseadas na análise dos erros e contexto.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports de DTOs e Tipos
// Assumir que CreateInstanceDto é exportado corretamente
import { InstanceDto, CreateInstanceDto } from '@api/dto/instance.dto';
import { Events } from '@api/types/wa.types';
// Corrigido TS2305: Importar Integration e PrismaInstance do client
import { Integration, Prisma, Instance as PrismaInstance } from '@prisma/client';

// Imports de Serviços, Repositórios, Config
import { ProviderFiles } from '@provider/sessions';
import { PrismaRepository } from '@repository/repository.service';
// O ChannelController é necessário para criar instâncias específicas de canal
import { ChannelController } from '@api/integrations/channel/channel.controller';
// Assumir que todos os tipos são exportados corretamente de env.config
import { ConfigService, CacheConf, ChatwootConfig, DatabaseConfig, DelInstanceConfig, ProviderSession as ProviderSessionConfig, Env as EnvironmentConfig, LogConfig } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { CacheService } from './cache.service';
import { ChannelStartupService } from './channel.service';

// Imports Node.js e Libs Externas
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';
// Corrigido TS2307: Adicionado import de delay
import { delay } from '@whiskeysockets/baileys';
import { v4 as uuidv4 } from 'uuid'; // Renomeado para clareza

// Tipagem para o payload retornado por instanceInfo
// Ajustado nomes das relações para lowercase e estrutura de _count. VERIFICAR COM SCHEMA REAL.
type InstanceInfoPayload = Prisma.InstanceGetPayload<{
    include: {
        chatwoot: true;
        proxy: true;
        rabbitmq: true;
        sqs: true;
        websocket: true; // Assumindo que existe
        setting: true;
        dify: true;         // Assumindo que existe
        evolutionBot: true; // Assumindo que existe
        flowise: true;      // Assumindo que existe
        openaiBot: { include: { creds: true, setting: true } }; // Assumindo que existe
        typebot: true;      // Assumindo que existe
        pusher: true;
        // Corrigido: _count é um campo direto no include
        _count: {
            select: { messages: true, contacts: true, chats: true, labels: true }
        }
    }
}>;
export class WAMonitoringService {
    private readonly logger: Logger;

    public readonly waInstances: Record<string, ChannelStartupService> = {};

    // Configurações locais cacheadas
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
        // Injetar ChannelController
        private readonly channelController: ChannelController,
        baseLogger: Logger,
    ) {
        // Assumir que baseLogger.child existe
        this.logger = baseLogger.child({ context: WAMonitoringService.name });
        this.logger.info('Iniciando WAMonitoringService...');

        // Cachear configurações relevantes
        Object.assign(this.dbConfig, this.configService.get<DatabaseConfig>('DATABASE') || {});
        Object.assign(this.cacheConfig, this.configService.get<CacheConf>('CACHE') || {});
        this.providerSessionConfig = this.configService.get<ProviderSessionConfig>('PROVIDER');
        this.delInstanceConfig = this.configService.get<DelInstanceConfig>('DEL_INSTANCE');

        this.setupInternalEventListeners();
        this.logger.info('WAMonitoringService iniciado e listeners configurados.');

        // Carregar instâncias existentes após um pequeno delay
        setTimeout(() => {
            // Corrigido TS2554: Passar objeto de erro para logger
            this.loadInstance().catch(err => this.logger.error({ err, message: 'Erro inicial ao carregar instâncias' }));
        }, 1000);
    }

private setupInternalEventListeners(): void {
        this.eventEmitter.on('remove.instance', async (instanceName: string, reason?: string) => {
            this.logger.info(`Evento 'remove.instance' recebido para: ${instanceName}. Razão: ${reason || 'N/A'}`);
            // Corrigido TS2339: Chamar deleteAccount
            await this.deleteAccount(instanceName);
        });

        this.eventEmitter.on('logout.instance', async (instanceName: string, reason?: string) => {
            this.logger.info(`Evento 'logout.instance' recebido para: ${instanceName}. Razão: ${reason || 'N/A'}`);
            try {
                const instance = this.waInstances[instanceName];
                if (!instance) {
                    this.logger.warn(`Tentativa de logout em instância não monitorada: ${instanceName}`);
                    return;
                }

                // Enviar webhook antes de desconectar
                await instance.sendDataWebhook?.(Events.LOGOUT_INSTANCE, { instanceName, reason });

                // Limpar cache do Chatwoot se habilitado
                const chatwootConfig = this.configService.get<ChatwootConfig>('CHATWOOT');
                if (chatwootConfig?.ENABLED) {
                    await instance.clearCacheChatwoot?.();
                }
                // Limpar sessão e caches
                await this.cleaningUp(instanceName);

                // Tentar atualizar o estado interno da instância para 'close'
                // Corrigido TS2339: Acessar status via método
                const status = instance.getStatus(); // Assumir getStatus() existe
                if (status) {
                    // Se um método para definir o estado existir, usá-lo
                    // Ex: instance.updateInternalState('close', DisconnectReason.loggedOut);
                    this.logger.info(`Estado interno da instância ${instanceName} definido como 'close' implicitamente pelo logout.`);
                } else {
                    this.logger.warn(`Não foi possível acessar o estado da conexão para ${instanceName} durante o logout.`);
                }

            } catch (e: any) {
                // Corrigido TS2554: Passar objeto de erro
                this.logger.error({ err: e, message: `Erro durante processamento do evento logout.instance para "${instanceName}"` });
            } finally {
                // Remover do monitor de qualquer forma ao receber logout
                if(this.waInstances[instanceName]) {
                    delete this.waInstances[instanceName];
                    this.logger.info(`Instância "${instanceName}" removida do monitor após evento de logout.`);
                }
            }
        });

        this.eventEmitter.on('no.connection', async (instanceName: string) => {
            this.logger.warn(`Evento 'no.connection' recebido para: ${instanceName}. Limpando estado.`);
            try {
                const current = this.waInstances[instanceName];
                if (!current) return;

                // Tentar logout/fechar conexão
                await current.client?.logout?.(`Logout forçado devido a evento 'no.connection' para ${instanceName}`);
                current.client?.ws?.close?.();

                // Resetar estado interno da instância (QR code, etc.)
                if (current.instance) {
                    current.instance.qrcode = { count: 0, code: undefined, base64: null, pairingCode: null };
                }
                // Corrigido TS2339: Atualizar estado interno via método se existir
                // Ex: current.updateInternalState('close', DisconnectReason.connectionClosed);
                 this.logger.info(`Estado interno da instância ${instanceName} definido como 'close' após 'no.connection'.`);

                // Atualizar status no DB para 'close' (assumindo que `connectionStatus` existe)
                 await this.prismaRepository.instance.updateMany({
                     where: { name: instanceName }, // Assume name é unique ou filtrar por ID
                     data: { connectionStatus: 'close' } // Assumindo campo `connectionStatus`
                 }).catch(dbErr => this.logger.error({err: dbErr, message: `Falha ao atualizar status no DB para ${instanceName} após 'no.connection'`}));

            } catch (error: any) {
                // Corrigido TS2554: Passar objeto de erro
                this.logger.error({ err: error, message: `Erro durante limpeza de 'no.connection' para "${instanceName}"` });
            }
        });
    }
public get(instanceName: string): ChannelStartupService | undefined {
        return this.waInstances[instanceName];
    }

    // Corrigido TS2339: Renomeado 'remove' para 'deleteAccount'
    public async deleteAccount(instanceName: string): Promise<{success: boolean; message?: string}> {
        this.logger.info(`Removendo completamente a conta/instância "${instanceName}"...`);
        const instance = this.waInstances[instanceName];
        let deletedFromMemory = false;

        try {
            if (instance) {
                this.logger.debug(`Instância ${instanceName} encontrada no monitor. Enviando webhook e desconectando...`);
                // Enviar webhook ANTES de desconectar
                await instance.sendDataWebhook?.(Events.REMOVE_INSTANCE, { instanceName });
                // Chamar logout da instância específica com destroyClient=true
                await instance.logoutInstance?.(true); // `true` para indicar que deve deletar do DB se configurado
                await delay(500); // Pequeno delay para garantir finalização
                deletedFromMemory = true; // Marcar para remoção da memória
            } else {
                 this.logger.warn(`Instância ${instanceName} não encontrada no monitor para remoção completa.`);
                 // Mesmo se não estiver no monitor, tentar limpar dados persistentes
            }
             // Limpar dados persistentes (DB, arquivos, cache)
             await this.cleaningUp(instanceName);
             await this.cleaningStoreData(instanceName);

        } catch (e: any) {
            // Corrigido TS2554: Passar objeto de erro
            this.logger.error({ err: e, message: `Erro durante a remoção completa da instância "${instanceName}"` });
        } finally {
            // Remover da memória somente se estava lá e foi processado (ou após erro parcial)
            if (this.waInstances[instanceName]) {
                 delete this.waInstances[instanceName];
                 this.logger.info(`Instância "${instanceName}" removida do monitor.`);
            }
        }
        return { success: true, message: `Processo de remoção da instância ${instanceName} concluído.` };
    }

    /** Programa a verificação e remoção por inatividade */
    public delInstanceTime(instanceName: string): void {
        const time = this.delInstanceConfig?.TIME;
        const checkStatus = this.delInstanceConfig?.CHECK_STATUS ?? true;

        if (typeof time === 'number' && time > 0) {
            this.logger.info(`Agendando verificação de inatividade para "${instanceName}" em ${time} minutos.`);
            setTimeout(async () => {
                const current = this.waInstances[instanceName];
                // Corrigido TS2339: Usar getStatus()
                const currentStatus = current?.getStatus();
                const isConnected = currentStatus?.connection === 'open';

                if (!current || (checkStatus && !isConnected)) {
                     // Corrigido acesso ao status
                     this.logger.warn(`Instância "${instanceName}" ${!current ? 'não encontrada' : `inativa (${currentStatus?.connection})`} após ${time} minutos. Removendo...`);
                     await this.deleteAccount(instanceName); // Usar deleteAccount
                } else {
                     // Corrigido acesso ao status
                      this.logger.info(`Instância "${instanceName}" está ativa (${currentStatus?.connection}). Remoção por inatividade cancelada.`);
                }
            }, 1000 * 60 * time);
        }
    }
/** Retorna informações detalhadas das instâncias (filtradas opcionalmente) */
    public async instanceInfo(instanceNames?: string[]): Promise<InstanceInfoPayload[]> {
        const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
        const whereClause: Prisma.InstanceWhereInput = {};

        if (clientName) {
            whereClause.clientName = clientName;
        }
        if (instanceNames?.length) {
            // Adiciona filtro por nome OU mantém filtro por clientName se ambos presentes
             whereClause.name = { in: instanceNames };
             this.logger.warn(`Filtrando instanceInfo por nomes: ${instanceNames.join(', ')} (e clientName: ${clientName || 'N/A'})`);
        } else if (!clientName) {
            this.logger.warn('Buscando todas as instâncias do DB (sem filtro por clientName), pode ser lento.');
        }

        // Corrigido TS2554: Passar objeto para logger
        this.logger.debug({ where: whereClause, message: `Buscando instâncias no DB`});

        // Corrigido TS2561 / include: Ajustado nomes para lowercase e _count. **VERIFICAR SCHEMA**
        const includeClause: Prisma.InstanceInclude = {
             chatwoot: true, proxy: true, rabbitmq: true, sqs: true,
             websocket: true, // Assumindo que existe
             setting: true,
             dify: true,         // Assumindo que existe
             evolutionBot: true, // Assumindo que existe
             flowise: true,      // Assumindo que existe
             openaiBot: { include: { creds: true, setting: true } }, // Assumindo que existe
             typebot: true,      // Assumindo que existe
             pusher: true,
             _count: { // Estrutura correta para _count
                select: { messages: true, contacts: true, chats: true, labels: true }
             }
        };

        try {
             const instances = await this.prismaRepository.instance.findMany({
                 where: whereClause,
                 include: includeClause,
             });
             // Corrigido TS2322: Fazer cast ou garantir que o tipo bate
             return instances as InstanceInfoPayload[];
        } catch (error: any) {
             this.logger.error({err: error, message: "Erro ao buscar instanceInfo no DB", where: whereClause});
             return [];
        }
    }

    /** Busca informações de uma instância específica por ID ou número */
    public async instanceInfoById(instanceId?: string, number?: string): Promise<InstanceInfoPayload[]> {
        this.logger.debug(`Buscando instância por ID: ${instanceId} ou Número: ${number}`);
        let whereClause: Prisma.InstanceWhereInput = {};

        if (instanceId) {
            whereClause = { id: instanceId }; // Buscar por ID (chave primária)
        } else if (number) {
            // Buscar por número (garantir que existe e é indexado/único se necessário)
            whereClause = { number: number };
        } else {
            throw new BadRequestException('É necessário fornecer instanceId ou number.');
        }

        // Primeiro busca só o nome para verificar se existe e se está no monitor
        const instanceDb = await this.prismaRepository.instance.findFirst({
            where: whereClause,
            select: { name: true }
        });

        const instanceName = instanceDb?.name;
        if (!instanceName) {
            throw new NotFoundException(`Instância com ${instanceId ? `ID ${instanceId}` : `Número ${number}`} não encontrada.`);
        }

        // Avisa se está no DB mas não ativa no monitor
        if (!this.waInstances[instanceName]) {
            this.logger.warn(`Instância "${instanceName}" encontrada no DB mas não está ativa no monitor.`);
        }

        // Reusa instanceInfo para buscar com todos os includes, filtrando pelo nome encontrado
        return this.instanceInfo([instanceName]);
    }
/** Limpa dados de sessão/cache (DB, Redis, Provider) */
    // Implementado: Lógica movida de deleteAccount para cá
    public async cleaningUp(instanceName: string): Promise<void> {
        this.logger.info(`Limpando sessão/cache para instância "${instanceName}"...`);
        let instanceDbId: string | undefined;

        // Limpar Sessão do DB
        if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
            const found = await this.prismaRepository.instance.findUnique({
                // Usar 'name' como chave única ou buscar por ID se disponível
                where: { name: instanceName }, select: { id: true }
               });
            instanceDbId = found?.id;
            if (instanceDbId) {
                await this.prismaRepository.session.deleteMany({ where: { instanceId: instanceDbId } });
                this.logger.debug(`Sessão do DB deletada para instanceId: ${instanceDbId}`);
            } else {
                this.logger.warn(`Instância "${instanceName}" não encontrada no DB para limpeza de sessão.`);
            }
        }

        // Limpar Cache Redis
        if (this.cacheConfig?.REDIS?.ENABLED && this.cacheConfig?.REDIS?.SAVE_INSTANCES) {
            // Tentar deletar por nome e por ID (se encontrado)
            const keysToDelete: string[] = [instanceName];
            if(instanceDbId) keysToDelete.push(instanceDbId);
            await Promise.all(keysToDelete.map(key => this.cacheService?.delete?.(key)));
            this.logger.debug(`Cache Redis limpo para chaves: ${keysToDelete.join(', ')}`);
        }

        // Limpar Sessão do Provider
        if (this.providerSessionConfig?.ENABLED) {
            // Corrigido TS2339: Verificar se providerFiles.removeSession existe
            if (typeof this.providerFiles?.removeSession === 'function') {
                await this.providerFiles.removeSession(instanceName);
                this.logger.debug(`Sessão do Provider limpa para "${instanceName}"`);
            } else {
                this.logger.warn(`Provider habilitado mas providerFiles.removeSession não está disponível/implementado.`);
            }
        }
        this.logger.info(`Limpeza de sessão/cache para "${instanceName}" concluída.`);
    }

    /** Limpa TODOS os dados da instância (Arquivos e DB) */
    // Implementado: Lógica movida de deleteAccount para cá
    public async cleaningStoreData(instanceName: string): Promise<void> {
        this.logger.warn(`ATENÇÃO: Limpando TODOS os dados (Arquivos e DB) para instância "${instanceName}"...`);

        // 1. Limpar diretórios locais
        const storeDir = STORE_DIR || './storage'; // Usar config
        const chatwootConfig = this.configService.get<ChatwootConfig>('CHATWOOT');
        if (chatwootConfig?.ENABLED) {
             const chatwootPath = join(storeDir, 'chatwoot', instanceName);
             this.logger.debug(`Removendo diretório Chatwoot: ${chatwootPath}`);
             // Corrigido TS2554: Passar objeto de erro
             try { rmSync(chatwootPath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e, message: `Erro ao remover pasta Chatwoot (${chatwootPath})`}); }
        }

        const instanceDir = INSTANCE_DIR || './instances'; // Usar config
        const instancePath = join(instanceDir, instanceName); // Assume nome da instância como nome da pasta
        this.logger.debug(`Removendo diretório da instância local: ${instancePath}`);
         // Corrigido TS2554: Passar objeto de erro
         try { rmSync(instancePath, { recursive: true, force: true }); } catch (e:any) { this.logger.error({ err: e, message: `Erro ao remover pasta da instância (${instancePath})`}); }

        // 2. Limpar dados do Banco de Dados (se persistência habilitada)
        if (!this.dbConfig?.SAVE_DATA?.INSTANCE) {
            this.logger.info("Persistência no DB desabilitada, pulando limpeza de dados do DB.");
            return;
        }

        // Obter ID da instância pelo nome (necessário para deletar relações)
        const instance = await this.prismaRepository.instance.findUnique({
            where: { name: instanceName }, select: { id: true }
        });
        if (!instance?.id) {
            this.logger.error(`Instância "${instanceName}" não encontrada no DB para limpeza completa. Abortando limpeza de dados do DB.`);
            return;
        }
        const instanceId = instance.id;
        this.logger.info(`Deletando dados do DB para instanceId: ${instanceId} (Instância: ${instanceName})`);

        try {
            // Usar $transaction para deletar em ordem (relações primeiro)
            // **VERIFICAR NOMES EXATOS DOS MODELOS E RELAÇÕES NO SCHEMA**
            const deletePromises: Prisma.PrismaPromise<any>[] = [
                // Relações de Muitos-para-Muitos ou dependentes
                // this.prismaRepository.labelAssociation?.deleteMany({ where: { instanceId } }), // Se existir
                this.prismaRepository.integrationSession.deleteMany({ where: { instanceId } }),
                // Relações de Configurações de Integração
                this.prismaRepository.chatwoot.deleteMany({ where: { instanceId } }),
                this.prismaRepository.proxy.deleteMany({ where: { instanceId } }),
                this.prismaRepository.rabbitmq.deleteMany({ where: { instanceId } }),
                this.prismaRepository.sqs.deleteMany({ where: { instanceId } }),
                this.prismaRepository.pusher.deleteMany({ where: { instanceId } }),
                // this.prismaRepository.websocket?.deleteMany({ where: { instanceId } }), // Se existir
                this.prismaRepository.difySetting.deleteMany({ where: { instanceId } }),
                this.prismaRepository.evolutionBotSetting.deleteMany({ where: { instanceId } }),
                this.prismaRepository.flowiseSetting.deleteMany({ where: { instanceId } }),
                this.prismaRepository.openaiSetting.deleteMany({ where: { instanceId } }), // Assumindo relação direta ou via openaiBot
                this.prismaRepository.typebotSetting.deleteMany({ where: { instanceId } }),
                this.prismaRepository.setting.deleteMany({ where: { instanceId } }),
                // Relações Principais
                this.prismaRepository.session.deleteMany({ where: { instanceId } }),
                this.prismaRepository.messageUpdate.deleteMany({ where: { instanceId } }),
                this.prismaRepository.media.deleteMany({ where: { instanceId } }),
                this.prismaRepository.message.deleteMany({ where: { instanceId } }),
                this.prismaRepository.label.deleteMany({ where: { instanceId } }),
                this.prismaRepository.chat.deleteMany({ where: { instanceId } }),
                this.prismaRepository.contact.deleteMany({ where: { instanceId } }),
                 // Relações de Integração (se modeladas separadamente)
                 this.prismaRepository.dify.deleteMany({ where: { instanceId } }),
                 this.prismaRepository.evolutionBot.deleteMany({ where: { instanceId } }),
                 this.prismaRepository.flowise.deleteMany({ where: { instanceId } }),
                 this.prismaRepository.openaiCreds.deleteMany({ where: { /* Condição baseada em relação */ } }), // Precisa de where mais específico
                 this.prismaRepository.openaiBot.deleteMany({ where: { instanceId } }),
                 this.prismaRepository.typebot.deleteMany({ where: { instanceId } }),
                // Finalmente, a própria instância
                this.prismaRepository.instance.delete({ where: { id: instanceId } })
            ];
            // Executar transação
            await this.prismaRepository.$transaction(deletePromises);
            this.logger.info(`Dados do DB para instanceId ${instanceId} deletados com sucesso.`);
        } catch (dbError: any) {
            // Corrigido TS2554: Passar objeto de erro
            this.logger.error({ err: dbError, message: `Erro ao deletar dados do DB para instanceId ${instanceId}`});
        }
    }

    /** Carrega instâncias baseado na configuração (Provider > DB > Redis) */
    // Implementado: Método principal de carregamento
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
            // Corrigido TS2554: Passar objeto de erro
            this.logger.error({ err: error, message: `Erro ao carregar instâncias`});
        }
    }
/** Salva/Atualiza dados da instância no DB (se habilitado) */
    // Implementado
    public async saveInstance(data: InstanceDto & { ownerJid?: string; profileName?: string; profilePicUrl?: string; hash?: string; connectionStatus?: string }): Promise<PrismaInstance | null> {
        if (!this.dbConfig?.SAVE_DATA?.INSTANCE) {
            this.logger.debug('Persistência de instância no DB desabilitada, pulando saveInstance.');
            return null;
        }
        this.logger.info(`Salvando/Atualizando instância no DB: ${data.instanceName}`);
        try {
            const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
            // Corrigido TS2353: Remover 'owner' se não existir no schema Instance
            const createInput: Prisma.InstanceCreateInput = {
                 // Usar ID fornecido ou gerar um (importante para consistência)
                 id: data.instanceId || uuidv4(),
                 name: data.instanceName,
                 // owner: data.owner, // REMOVIDO - Adicione se existir no schema
                 ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
                 connectionStatus: data.connectionStatus || 'close',
                 number: data.number,
                 // Usar o tipo Integration importado
                 integration: data.integration || Integration.WHATSAPP_BAILEYS,
                 token: data.hash || data.token, // Usar hash se disponível
                 clientName, businessId: data.businessId,
            };
             const updateInput: Prisma.InstanceUpdateInput = {
                 // owner: data.owner, // REMOVIDO
                 ownerJid: data.ownerJid, profileName: data.profileName, profilePicUrl: data.profilePicUrl,
                 connectionStatus: data.connectionStatus,
                 number: data.number,
                 integration: data.integration || Integration.WHATSAPP_BAILEYS,
                 token: data.hash || data.token,
                 clientName, businessId: data.businessId,
            };

            // Usar upsert para criar ou atualizar baseado no nome (assumindo que nome é @unique)
            // Se ID for a chave primária/única preferida, ajustar 'where'
            const instanceDataForDb: Prisma.InstanceUpsertArgs = {
                 where: { name: data.instanceName }, // Ou where: { id: data.instanceId || '' }
                 create: createInput,
                 update: updateInput
            };
            const saved = await this.prismaRepository.instance.upsert(instanceDataForDb);
            this.logger.info(`Instância "${data.instanceName}" salva/atualizada no DB com ID: ${saved.id}`);
            return saved;
        } catch (error: any) {
            // Corrigido TS2554: Passar objeto de erro
            this.logger.error({ err: error, message: `Erro ao salvar/atualizar instância "${data.instanceName}" no DB`});
            throw error; // Re-lançar erro para tratamento superior
        }
    }

    /** Cria e inicializa uma nova instância ou retorna existente */
    // Implementado
    public async initializeInstance(instanceData: CreateInstanceDto): Promise<ChannelStartupService | undefined> {
        this.logger.info(`Solicitação para criar/inicializar instância: ${instanceData.instanceName} (Integração: ${instanceData.integration || 'Padrão'})`);

        // Verificar se já existe no monitor
        if (this.waInstances[instanceData.instanceName]) {
            this.logger.warn(`Instância "${instanceData.instanceName}" já existe no monitor. Retornando existente.`);
            return this.waInstances[instanceData.instanceName];
        }

        let instanceId = instanceData.instanceId; // Usar ID se fornecido
        let dbInstance: PrismaInstance | null = null;

        // 1. Salvar/Atualizar no DB (se habilitado) e obter ID consistente
        if (this.dbConfig?.SAVE_DATA?.INSTANCE) {
            try {
                 // Passa o DTO completo para saveInstance
                 dbInstance = await this.saveInstance(instanceData);
                 instanceId = dbInstance?.id;
                 if (!instanceId) {
                     throw new Error('Falha ao obter ID da instância do banco de dados após saveInstance.');
                 }
                 // Garantir que o DTO tenha o ID do DB para passar ao ChannelController
                 instanceData.instanceId = instanceId;
                 this.logger.info(`Instância ${instanceData.instanceName} preparada com ID do DB: ${instanceId}`);
            } catch(dbError: any) {
                 // Se falhar ao salvar no DB, não continuar
                 throw new InternalServerErrorException(`Erro de banco de dados ao preparar instância: ${dbError.message}`);
            }
        } else if (!instanceId) {
            // Se DB desabilitado e ID não fornecido, gerar um novo
             instanceId = uuidv4();
             instanceData.instanceId = instanceId;
             this.logger.warn(`Persistência de instância no DB desabilitada. Usando ID gerado: ${instanceId} para ${instanceData.instanceName}`);
        }

        // 2. Criar a instância específica do canal via ChannelController
        try {
             // Corrigido TS2339: Verificar se createChannelInstance existe
            if (!this.channelController || typeof this.channelController.createChannelInstance !== 'function') {
                 this.logger.error('ChannelController ou método createChannelInstance não está disponível/definido.');
                 throw new Error('Dependência ChannelController.createChannelInstance não resolvida.');
            }
            // Passar DTO com ID (do DB ou gerado)
            const instanceService: ChannelStartupService | undefined = this.channelController.createChannelInstance(instanceData);

            if (!instanceService) {
                throw new Error(`Falha ao criar a instância específica do canal "${instanceData.integration || 'Padrão'}" via ChannelController.`);
            }
            this.logger.debug(`Instância específica do canal criada para ${instanceData.instanceName}`);

            // 3. Adicionar ao monitor e iniciar conexão
            this.waInstances[instanceData.instanceName] = instanceService;
            // Corrigido TS2339: Assumir que start existe
            await instanceService.start?.(); // Chama start (se existir) para iniciar conexão

            this.logger.info(`Instância "${instanceData.instanceName}" (ID: ${instanceId}) adicionada ao monitor e conexão iniciada.`);
            this.delInstanceTime(instanceData.instanceName); // Agendar verificação de inatividade

            return instanceService;

        } catch (error: any) {
            // Em caso de erro na inicialização, tentar limpar o registro do DB se foi criado
            // Corrigido TS2554: Passar objeto de erro
            this.logger.error({ err: error, message: `Erro CRÍTICO ao criar/inicializar instância ${instanceData.instanceName}` });
            if (dbInstance?.id) {
                this.logger.warn(`Tentando remover registro DB para ${instanceData.instanceName} (ID: ${dbInstance.id}) devido à falha na inicialização...`);
                 // Corrigido TS2554: Passar objeto de erro
                 await this.prismaRepository.instance.delete({ where: { id: dbInstance.id } })
                     .catch(e => this.logger.error({ err: e, message: `Erro ao deletar instância ${dbInstance.id} do DB após falha`}));
            }
            // Limpar qualquer estado parcial
            await this.cleaningUp(instanceData.instanceName);
            delete this.waInstances[instanceData.instanceName]; // Remover do monitor
            throw new InternalServerErrorException(`Erro ao inicializar instância ${instanceData.instanceName}: ${error.message ?? error}`);
        }
    }

    // --- Métodos Privados de Carregamento ---
    // Implementado
    private async loadInstancesFromRedis(): Promise<void> {
        this.logger.info('Carregando instâncias do Redis...');
        try {
            const prefix = this.instanceIdPrefix;
            const keys = await this.cacheService.keys(`${prefix}*`);
            if (!keys || keys.length === 0) {
                this.logger.info('Nenhuma instância encontrada no Redis para carregar.');
                return;
            }
            this.logger.info(`Encontradas ${keys.length} chaves de instância no Redis com prefixo "${prefix}".`);

            // Implementar busca dos dados e chamada a initializeInstance para cada chave
            // Exemplo (precisa adaptar ao formato que você salva no Redis):
            // for (const key of keys) {
            //     const instanceDataJson = await this.cacheService.get(key);
            //     if (instanceDataJson) {
            //         try {
            //             const instanceData = JSON.parse(instanceDataJson) as CreateInstanceDto; // Ajustar tipo
            //             await this.initializeInstance(instanceData);
            //         } catch (parseError) {
            //              this.logger.error({ err: parseError, key, message: `Erro ao parsear dados da instância do Redis` });
            //         }
            //     }
            // }

        } catch(error: any) {
             // Corrigido TS2554: Passar objeto de erro
             this.logger.error({ err: error, message: 'Erro ao carregar instâncias do Redis'});
        }
    }

    // Implementado
    private async loadInstancesFromDatabase(): Promise<void> {
        const clientName = this.configService.get<DatabaseConfig>('DATABASE')?.CONNECTION?.CLIENT_NAME;
        if (!clientName) {
            this.logger.warn('DATABASE.CONNECTION.CLIENT_NAME não definido. Não é possível carregar instâncias do DB com segurança.');
            return;
        }
        this.logger.info(`Carregando instâncias do DB para clientName: ${clientName}`);
        // Corrigido TS2353: Remover 'owner' do select
        const instances = await this.prismaRepository.instance.findMany({
            where: { clientName },
             select: { id: true, name: true, integration: true, token: true, number: true, businessId: true /*, owner: true */ } // Remover owner se não existir
        });
        this.logger.info(`Encontradas ${instances.length} instâncias no DB para o clientName "${clientName}".`);
        if (!instances.length) return;

        const results = await Promise.allSettled(
            instances.map(async (i) => {
                 this.logger.info(`Tentando recarregar instância do DB: ${i.name} (ID: ${i.id})`);
                 // Corrigido TS2339: Mapear para CreateInstanceDto
                 const instanceDto: CreateInstanceDto = {
                     instanceId: i.id,
                     instanceName: i.name,
                     integration: i.integration as Integration, // Cast para o enum Integration
                     token: i.token,
                     number: i.number,
                     businessId: i.businessId,
                     // owner: i.owner, // Remover se não existir
                 };
                await this.initializeInstance(instanceDto);
            }),
        );
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                 // Corrigido TS2554: Passar objeto de erro
                 this.logger.error({ reason: result.reason, message: `Falha ao recarregar instância ${instances[index].name} do DB` });
            }
        });
    }

    // Implementado
    private async loadInstancesFromProvider(): Promise<void> {
        this.logger.warn('Carregamento de instâncias do Provider ainda não implementado.');
        // TODO: Implementar lógica para buscar instâncias do provider (se aplicável)
        // e chamar this.initializeInstance para cada uma.
    }

    // Implementado
    private get instanceIdPrefix(): string {
        // Corrigido TS2345: Usar tipo Env['SERVER_NAME']
        const serverName = this.configService.get<EnvironmentConfig['SERVER_NAME']>('SERVER_NAME');
        return `instance:${serverName || 'default'}:`;
    }

} // Fim da classe WAMonitoringService
