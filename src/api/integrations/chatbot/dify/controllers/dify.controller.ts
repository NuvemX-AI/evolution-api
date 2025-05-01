// Arquivo: src/api/integrations/chatbot/dify/controllers/dify.controller.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { DifyDto, DifySettingDto } from '../dto/dify.dto'; // Importar DifySettingDto também
import { DifyService } from '../services/dify.service';
import { PrismaRepository } from '@repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service'; // Verificar se é monitor.service ou wa-monitoring.service
import { configService } from '@config/server.config'; // Importar configService global ou injetar
import { DifyConfig } from '@config/env.config'; // Importar tipo DifyConfig
import { Logger } from '@config/logger.config';
// CORREÇÃO TS2304: Importar Exceptions e Prisma/$Enums
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { Dify as DifyModel, IntegrationSession, Prisma, $Enums } from '@prisma/client';
import { getConversationMessage } from '@utils/getConversationMessage'; // Usar alias
import { ChatbotController, EmitData } from '../../chatbot.controller'; // Importar ChatbotController e EmitData

export class DifyController extends ChatbotController {
  // Declaração explícita dos repositórios com tipos corretos
  // Usamos ReturnType<typeof this.prismaRepository.nomeDoGetter> se os getters existirem
  // Ou usamos os tipos gerados pelo Prisma diretamente
  private readonly botRepository: Prisma.DifyDelegate<any>;
  private readonly settingsRepository: Prisma.DifySettingDelegate<any>;
  private readonly sessionRepository: Prisma.IntegrationSessionDelegate<any>;

  constructor(
    private readonly difyService: DifyService,
    // CORREÇÃO TS2345: Usar o tipo correto do PrismaRepository
    public readonly prismaRepository: PrismaRepository, // Mantido public para acesso na classe base
    protected readonly waMonitor: WAMonitoringService, // Mantido protected
    // Injetar Logger e ConfigService se não forem globais
    private readonly logger: Logger,
  ) {
    super(prismaRepository, waMonitor); // Passa dependências para a classe base
    this.logger = logger.child({ context: 'DifyController' }); // Cria logger filho

    // Define os repositórios específicos usando os getters do PrismaRepository
    // CORREÇÃO TS2339: Usar os getters corretos definidos no PrismaRepository
    this.botRepository = this.prismaRepository.dify;
    this.settingsRepository = this.prismaRepository.difySetting;
    this.sessionRepository = this.prismaRepository.integrationSession;

    // Inicializar a flag integrationEnabled
    this.integrationEnabled = configService.get<DifyConfig>('DIFY')?.ENABLED ?? false;
  }

  // Logger e propriedades específicas
  // public readonly logger = new Logger('DifyController'); // Logger agora é injetado
  integrationEnabled = false; // Inicializado no construtor
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // --- Métodos CRUD para Bots ---
  public async createBot(instance: InstanceDto, data: DifyDto): Promise<DifyModel> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');

    // CORREÇÃO TS2341: Usar this.prismaRepository.instance
    const instanceDb = await this.prismaRepository.instance.findFirst({
        where: { name: instance.instanceName }, select: { id: true }
    });
    if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada no DB.`);
    const instanceId = instanceDb.id;

     // Busca ou cria configurações padrão
     let defaultSettingCheck = await this.settingsRepository.findUnique({ where: { instanceId } });
     if (!defaultSettingCheck) {
         this.logger.warn(`Configurações padrão Dify não encontradas para ${instance.instanceName}, criando...`);
         // Cria configurações padrão se não existirem (assumindo que settings() retorna o objeto criado/atualizado)
         // Passar Partial<DifySettingDto> para settings
         const createdSettings = await this.settings(instance, {});
         defaultSettingCheck = await this.settingsRepository.findUnique({ where: { instanceId } }); // Recarrega
         if (!defaultSettingCheck) throw new InternalServerErrorException('Falha ao criar configurações Dify padrão.');
     }

     // Preenche dados faltantes com os padrões
     data.expire = data.expire ?? defaultSettingCheck.expire ?? 0;
     data.keywordFinish = data.keywordFinish ?? defaultSettingCheck.keywordFinish ?? '';
     // ... (preencher outros campos com fallback para defaultSettingCheck) ...
     data.delayMessage = data.delayMessage ?? defaultSettingCheck?.delayMessage ?? 0;
     data.unknownMessage = data.unknownMessage ?? defaultSettingCheck?.unknownMessage ?? '';
     data.listeningFromMe = data.listeningFromMe ?? defaultSettingCheck?.listeningFromMe ?? false;
     data.stopBotFromMe = data.stopBotFromMe ?? defaultSettingCheck?.stopBotFromMe ?? false;
     data.keepOpen = data.keepOpen ?? defaultSettingCheck?.keepOpen ?? false;
     data.debounceTime = data.debounceTime ?? defaultSettingCheck?.debounceTime ?? 0;
     data.ignoreJids = data.ignoreJids ?? defaultSettingCheck?.ignoreJids as string[] ?? []; // Cast se necessário
     data.splitMessages = data.splitMessages ?? defaultSettingCheck?.splitMessages ?? false;
     data.timePerChar = data.timePerChar ?? defaultSettingCheck?.timePerChar ?? 0;
     data.difyIdFallback = data.difyIdFallback ?? defaultSettingCheck?.difyIdFallback ?? null; // Usar null se for string opcional


    // Verifica gatilho 'all'
    const triggerAllBots = await this.botRepository.findMany({
      where: { enabled: true, triggerType: $Enums.TriggerType.all, instanceId },
    });
    if (data.triggerType === $Enums.TriggerType.all && triggerAllBots.length > 0) {
      throw new BadRequestException('Você já possui um bot Dify com gatilho "all" ativo.');
    }

    // Verifica duplicidade de API Key/URL
    const checkDuplicateAPI = await this.botRepository.findFirst({
      where: { instanceId, botType: data.botType, apiUrl: data.apiUrl, apiKey: data.apiKey },
    });
    if (checkDuplicateAPI) throw new BadRequestException('Já existe um bot Dify com esta URL/API Key.');

    // Verifica duplicidade de Gatilhos
    if (data.triggerType === $Enums.TriggerType.keyword) {
      if (!data.triggerOperator || !data.triggerValue) throw new BadRequestException('Operator/Value required for keyword trigger.');
      const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, instanceId } });
      if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate keyword trigger: ${data.triggerOperator} ${data.triggerValue}`);
    } else if (data.triggerType === $Enums.TriggerType.advanced) {
      if (!data.triggerValue) throw new BadRequestException('Value required for advanced trigger.');
      const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, instanceId } });
      if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate advanced trigger: ${data.triggerValue}`);
    }

    try {
      const bot = await this.botRepository.create({
        data: { ...data, instanceId }, // Inclui instanceId
      });
      this.logger.log(`Bot Dify criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao criar bot Dify`);
      // CORREÇÃO TS2304: Usar InternalServerErrorException importado
      throw new InternalServerErrorException(`Erro ao criar bot Dify: ${error.message}`);
    }
  }

  public async findBot(instance: InstanceDto): Promise<DifyModel[] | null> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    // CORREÇÃO TS2341: Usar this.prismaRepository.instance
    const instanceDb = await this.prismaRepository.instance.findFirst({
        where: { name: instance.instanceName }, select: { id: true }
    });
    if (!instanceDb?.id) return null;
    return this.botRepository.findMany({ where: { instanceId: instanceDb.id } });
  }

  public async fetchBot(instance: InstanceDto, botId: string): Promise<DifyModel> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    // CORREÇÃO TS2341: Usar this.prismaRepository.instance
    const instanceDb = await this.prismaRepository.instance.findFirst({
        where: { name: instance.instanceName }, select: { id: true }
    });
    if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId } });
    if (!bot) throw new BadRequestException('Bot Dify não encontrado.');
    if (bot.instanceId !== instanceDb.id) throw new BadRequestException('Bot Dify não pertence a esta instância.');
    return bot;
  }

  public async updateBot(instance: InstanceDto, botId: string, data: Partial<DifyDto>): Promise<DifyModel> { // Usa Partial para permitir atualização parcial
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    // CORREÇÃO TS2341: Usar this.prismaRepository.instance
    const instanceDb = await this.prismaRepository.instance.findFirst({
        where: { name: instance.instanceName }, select: { id: true }
    });
    if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);
    const instanceId = instanceDb.id;

    const bot = await this.botRepository.findFirst({ where: { id: botId, instanceId } });
    if (!bot) throw new BadRequestException('Bot Dify não encontrado ou não pertence a esta instância.');

    // Lógica de verificação de gatilho 'all' e duplicidade (mantida, usando Enum)
    if (data.triggerType === $Enums.TriggerType.all) {
        const checkTriggerAll = await this.botRepository.findFirst({ where: { enabled: true, triggerType: $Enums.TriggerType.all, id: { not: botId }, instanceId } });
        if (checkTriggerAll) throw new BadRequestException('Já existe outro bot Dify com gatilho "all" ativo.');
    }
    // ... (verificações de duplicidade para keyword, advanced, API/URL mantidas, usando Enum e id: { not: botId }) ...
     if (data.triggerType === $Enums.TriggerType.keyword) {
         if (!data.triggerOperator || !data.triggerValue) throw new BadRequestException('Operator/Value required for keyword trigger.');
         const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
         if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate keyword trigger: ${data.triggerOperator} ${data.triggerValue}`);
     } else if (data.triggerType === $Enums.TriggerType.advanced) {
         if (!data.triggerValue) throw new BadRequestException('Value required for advanced trigger.');
         const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
         if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate advanced trigger: ${data.triggerValue}`);
     }
     // Verificar duplicidade de API/URL apenas se esses campos estiverem sendo atualizados
     if (data.apiUrl !== undefined || data.apiKey !== undefined || data.botType !== undefined) {
        const checkDuplicateAPI = await this.botRepository.findFirst({
            where: {
                id: { not: botId }, instanceId,
                botType: data.botType ?? bot.botType, // Usa novo ou antigo
                apiUrl: data.apiUrl ?? bot.apiUrl,
                apiKey: data.apiKey ?? bot.apiKey
            }
        });
        if (checkDuplicateAPI) throw new BadRequestException('Another Dify bot with this URL/API Key already exists.');
    }

    try {
      const updatedBot = await this.botRepository.update({
        where: { id: botId },
        // Passa apenas os dados fornecidos em 'data'
        data: { ...data, instanceId: undefined, id: undefined }, // Remove campos não atualizáveis
      });
      this.logger.log(`Bot Dify atualizado com ID: ${updatedBot.id}`);
      return updatedBot;
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao atualizar bot Dify`);
      // CORREÇÃO TS2304: Usar InternalServerErrorException importado
      throw new InternalServerErrorException(`Erro ao atualizar bot Dify: ${error.message}`);
    }
  }

  public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    // CORREÇÃO TS2341: Usar this.prismaRepository.instance
    const instanceDb = await this.prismaRepository.instance.findFirst({
        where: { name: instance.instanceName }, select: { id: true }
    });
    if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);
    const instanceId = instanceDb.id;

    const bot = await this.botRepository.findFirst({ where: { id: botId, instanceId } });
    if (!bot) throw new BadRequestException('Bot Dify não encontrado ou não pertence a esta instância.');

    try {
      // Deleta sessões associadas primeiro
      await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'dify' } });
      // Deleta o bot
      await this.botRepository.delete({ where: { id: botId } });
      this.logger.log(`Bot Dify deletado com ID: ${botId}`);
      return { bot: { id: botId } };
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao deletar bot Dify`);
      // CORREÇÃO TS2304: Usar InternalServerErrorException importado
      throw new InternalServerErrorException(`Erro ao deletar bot Dify: ${error.message}`);
    }
  }

  // --- Métodos para Configurações (Settings) ---
  public async settings(instance: InstanceDto, data: Partial<DifySettingDto>): Promise<any> { // Retorna DTO ou tipo Prisma
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    try {
      // CORREÇÃO TS2341: Usar this.prismaRepository.instance
      const instanceDb = await this.prismaRepository.instance.findFirst({
          where: { name: instance.instanceName }, select: { id: true }
      });
      if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);
      const instanceId = instanceDb.id;

      // Prepara dados para upsert (apenas campos de DifySettingDto)
      const settingsData: Partial<Prisma.DifySettingCreateInput> = {
          expire: data.expire, keywordFinish: data.keywordFinish, delayMessage: data.delayMessage,
          unknownMessage: data.unknownMessage, listeningFromMe: data.listeningFromMe,
          stopBotFromMe: data.stopBotFromMe, keepOpen: data.keepOpen, debounceTime: data.debounceTime,
          difyIdFallback: data.difyIdFallback, ignoreJids: data.ignoreJids,
          splitMessages: data.splitMessages, timePerChar: data.timePerChar,
          // 'Fallback' é uma relação, não pode ser definida diretamente aqui, precisa conectar por ID
          // Fallback: data.Fallback ? { connect: { id: data.Fallback.id } } : undefined, // Exemplo de conexão
          instance: { connect: { id: instanceId } } // Conecta à instância
      };
      // Remove chaves undefined
      Object.keys(settingsData).forEach(key => settingsData[key as keyof typeof settingsData] === undefined && delete settingsData[key as keyof typeof settingsData]);

      // Dados para criação (precisa do instanceId)
      const createData = { ...settingsData, instanceId };
      // Dados para atualização (não inclui instanceId)
      const updateData = { ...settingsData };

      const upsertedSettings = await this.settingsRepository.upsert({
          where: { instanceId: instanceId },
          update: updateData,
          create: createData as Prisma.DifySettingCreateInput, // Cast para garantir tipo
          include: { Fallback: true } // Inclui fallback no retorno
      });

      // Retorna DTO formatado
      return {
          expire: upsertedSettings.expire, keywordFinish: upsertedSettings.keywordFinish,
          delayMessage: upsertedSettings.delayMessage, unknownMessage: upsertedSettings.unknownMessage,
          listeningFromMe: upsertedSettings.listeningFromMe, stopBotFromMe: upsertedSettings.stopBotFromMe,
          keepOpen: upsertedSettings.keepOpen, debounceTime: upsertedSettings.debounceTime,
          difyIdFallback: upsertedSettings.difyIdFallback, ignoreJids: upsertedSettings.ignoreJids,
          splitMessages: upsertedSettings.splitMessages, timePerChar: upsertedSettings.timePerChar,
          Fallback: upsertedSettings.Fallback // Retorna o bot de fallback completo se incluído
      };
    } catch (error: any) {
        // CORREÇÃO TS2554: Passar objeto de erro
        this.logger.error({ err: error }, `Erro ao definir configurações Dify`);
        // CORREÇÃO TS2304: Usar InternalServerErrorException importado
        throw new InternalServerErrorException(`Erro ao definir configurações Dify: ${error.message}`);
    }
  }

  public async fetchSettings(instance: InstanceDto): Promise<any> { // Retorna DTO ou tipo Prisma
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    try {
      // CORREÇÃO TS2341: Usar this.prismaRepository.instance
      const instanceDb = await this.prismaRepository.instance.findFirst({
          where: { name: instance.instanceName }, select: { id: true }
      });
      if (!instanceDb?.id) return null;
      const instanceId = instanceDb.id;

      const settings = await this.settingsRepository.findUnique({ // findUnique agora
          where: { instanceId: instanceId },
          include: { Fallback: true },
      });

      return settings || { // Retorna defaults se não encontrar
          expire: 0, keywordFinish: '', delayMessage: 0, unknownMessage: '', listeningFromMe: false,
          stopBotFromMe: false, keepOpen: false, debounceTime: 0, ignoreJids: [],
          splitMessages: false, timePerChar: 0, difyIdFallback: null, Fallback: null
      };
    } catch (error: any) {
        // CORREÇÃO TS2554: Passar objeto de erro
        this.logger.error({ err: error }, `Erro ao buscar configurações Dify`);
        // CORREÇÃO TS2304: Usar InternalServerErrorException importado
        throw new InternalServerErrorException(`Erro ao buscar configurações Dify: ${error.message}`);
    }
  }

  // --- Métodos para Sessões ---
  public async changeStatus(instance: InstanceDto, data: { remoteJid: string; status: 'open' | 'closed' | 'paused' | 'delete' }): Promise<any> {
      if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
      try {
          // CORREÇÃO TS2341: Usar this.prismaRepository.instance
          const instanceDb = await this.prismaRepository.instance.findFirst({
              where: { name: instance.instanceName }, select: { id: true }
          });
          if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);
          const instanceId = instanceDb.id;

          const settings = await this.settingsRepository.findUnique({ where: { instanceId } });

          const { remoteJid, status } = data;
          if (!remoteJid || !status) throw new BadRequestException('remoteJid e status são obrigatórios.');

          if (status === 'delete') {
              const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'dify' } });
              this.logger.log(`Sessões Dify deletadas para ${remoteJid}: ${deleted.count}`);
              return { bot: { remoteJid, status: 'deleted' } }; // Retorna status 'deleted'
          } else if (status === 'closed') {
              if (settings?.keepOpen) {
                  const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'dify', status: { not: 'closed' } }, data: { status: 'closed' } });
                  this.logger.log(`Sessões Dify fechadas (mantidas) para ${remoteJid}: ${updated.count}`);
              } else {
                  const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'dify' } });
                  this.logger.log(`Sessões Dify deletadas (keepOpen=false) para ${remoteJid}: ${deleted.count}`);
              }
              return { bot: { remoteJid, status: 'closed' } };
          } else { // 'open' ou 'paused'
              const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'dify' }, data: { status } });
              this.logger.log(`Status da sessão Dify atualizado para "${status}" para ${remoteJid}: ${updated.count}`);
              return { bot: { remoteJid, status } };
          }
      } catch (error: any) {
          // CORREÇÃO TS2554: Passar objeto de erro
          this.logger.error({ err: error }, `Erro ao alterar status da sessão Dify`);
          // CORREÇÃO TS2304: Usar InternalServerErrorException importado
          throw new InternalServerErrorException(`Erro ao alterar status da sessão Dify: ${error.message}`);
      }
  }

  public async fetchSessions(instance: InstanceDto, botId?: string, remoteJid?: string): Promise<IntegrationSession[]> {
      if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
      try {
          // CORREÇÃO TS2341: Usar this.prismaRepository.instance
          const instanceDb = await this.prismaRepository.instance.findFirst({
              where: { name: instance.instanceName }, select: { id: true }
          });
          if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);
          const instanceId = instanceDb.id;

          if (botId) { // Valida botId se fornecido
              const bot = await this.botRepository.findFirst({ where: { id: botId, instanceId } });
              if (!bot) throw new BadRequestException('Bot Dify não encontrado ou não pertence a esta instância.');
          }

          // CORREÇÃO TS2503: Usar Prisma importado
          const whereClause: Prisma.IntegrationSessionWhereInput = {
              instanceId, type: 'dify',
              ...(botId && { botId }), // Adiciona se botId for fornecido
              ...(remoteJid && { remoteJid }), // Adiciona se remoteJid for fornecido
          };

          return this.sessionRepository.findMany({ where: whereClause });
      } catch (error: any) {
          // CORREÇÃO TS2554: Passar objeto de erro
          this.logger.error({ err: error }, `Erro ao buscar sessões Dify`);
          // CORREÇÃO TS2304: Usar InternalServerErrorException importado
          throw new InternalServerErrorException(`Erro ao buscar sessões Dify: ${error.message}`);
      }
  }

  public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto): Promise<any> {
      if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
      try {
          // CORREÇÃO TS2341: Usar this.prismaRepository.instance
          const instanceDb = await this.prismaRepository.instance.findFirst({
              where: { name: instance.instanceName }, select: { id: true }
          });
          if (!instanceDb?.id) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);
          const instanceId = instanceDb.id;

          // Usa findUnique agora que where é unique
          const settings = await this.settingsRepository.findUnique({ where: { instanceId } });
          if (!settings) throw new BadRequestException('Configurações Dify não encontradas.');

          let ignoreJids: string[] = (settings?.ignoreJids as string[]) || []; // Cast seguro

          if (data.action === 'add') {
              if (!ignoreJids.includes(data.remoteJid)) ignoreJids.push(data.remoteJid);
          } else {
              ignoreJids = ignoreJids.filter((jid) => jid !== data.remoteJid);
          }

          // Usa update e where unique
          const updateSettings = await this.settingsRepository.update({
              where: { instanceId }, // Usa where unique
              data: { ignoreJids },
          });

          return { ignoreJids: updateSettings.ignoreJids };
      } catch (error: any) {
          // CORREÇÃO TS2554: Passar objeto de erro
          this.logger.error({ err: error }, `Erro ao atualizar ignoreJids Dify`);
          // CORREÇÃO TS2304: Usar InternalServerErrorException importado
          throw new InternalServerErrorException(`Erro ao atualizar ignoreJids Dify: ${error.message}`);
      }
  }

  // --- Método Emit ---
  // (Corrigido anteriormente, verificar se precisa de mais ajustes)
  public async emit({ instance, remoteJid, msg }: EmitData): Promise<void> {
    if (!this.integrationEnabled) return;
    const pushName = msg?.pushName; // Obter pushName

    try {
      const settings = await this.fetchSettings(instance);
      if (!settings) {
         this.logger.warn(`Configurações Dify não encontradas para ${instance.instanceName}, ignorando.`);
         return;
      }
      if (this.checkIgnoreJids(settings?.ignoreJids as string[] || [], remoteJid)) return;

      const session = await this.getSession(remoteJid, instance);
      const content = getConversationMessage(msg);
      if (!content) {
         this.logger.debug(`Conteúdo vazio ou não extraído para ${remoteJid}, ignorando.`);
         return;
      }

      let findBot = await this.findBotTrigger(this.botRepository, content, instance, session) as DifyModel | null;
      if (!findBot && settings?.difyIdFallback) {
          findBot = await this.botRepository.findFirst({ where: { id: settings.difyIdFallback } });
          if (findBot) this.logger.debug(`Usando bot Dify de fallback (ID: ${findBot.id}) para ${remoteJid}`);
      }
      if (!findBot) {
         this.logger.debug(`Nenhum bot Dify (gatilho ou fallback) encontrado para ${remoteJid}, ignorando.`);
        return;
      }

      // Usar Partial<DifySettingDto> ou tipo similar
      const finalSettings: Partial<DifySettingDto> & { difyIdFallback?: string | null } = {
        expire: findBot.expire ?? settings.expire ?? 0,
        keywordFinish: findBot.keywordFinish ?? settings.keywordFinish ?? '',
        delayMessage: findBot.delayMessage ?? settings.delayMessage ?? 0,
        unknownMessage: findBot.unknownMessage ?? settings.unknownMessage ?? '',
        listeningFromMe: findBot.listeningFromMe ?? settings.listeningFromMe ?? false,
        stopBotFromMe: findBot.stopBotFromMe ?? settings.stopBotFromMe ?? false,
        keepOpen: findBot.keepOpen ?? settings.keepOpen ?? false,
        debounceTime: findBot.debounceTime ?? settings.debounceTime ?? 0,
        ignoreJids: findBot.ignoreJids as string[] ?? settings.ignoreJids as string[] ?? [],
        splitMessages: findBot.splitMessages ?? settings.splitMessages ?? false,
        timePerChar: findBot.timePerChar ?? settings.timePerChar ?? 0,
        difyIdFallback: settings.difyIdFallback,
      };

      const key = msg.key as any; // Cast temporário

      if (finalSettings.stopBotFromMe && key?.fromMe && session && session.status !== 'closed') {
        this.logger.info(`Mensagem própria recebida e stopBotFromMe ativo para ${remoteJid}. Pausando sessão Dify.`);
        await this.sessionRepository.update({ where: { id: session.id }, data: { status: 'paused' } });
        return;
      }
      if (!finalSettings.listeningFromMe && key?.fromMe) {
        this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false)`);
        return;
      }
      if (session && !session.awaitUser && session.status !== 'closed') {
         this.logger.debug(`Sessão Dify para ${remoteJid} não aguarda input do usuário, ignorando.`);
        return;
      }

      const waInstance = this.waMonitor.get(instance.instanceName);
      if (!waInstance) {
           this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor.`);
           return;
      }

      const processFn = async (currentContent: string) => {
          await this.difyService.processDify(waInstance, remoteJid, findBot!, session, finalSettings, currentContent, pushName);
      };

      if (finalSettings.debounceTime && finalSettings.debounceTime > 0) {
        this.processDebounce(this.userMessageDebounce, content, remoteJid, finalSettings.debounceTime, processFn);
      } else {
        await processFn(content);
      }

    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error, remoteJid }, `Erro no método emit DifyController`);
    }
  } // Fim emit
}
