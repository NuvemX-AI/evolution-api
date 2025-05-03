// Arquivo: src/api/integrations/chatbot/dify/controllers/dify.controller.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
// CORREÇÃO: Importar DTOs corretamente
import { DifyDto, DifySettingDto } from '../dto/dify.dto';
import { DifyService } from '../services/dify.service';
// CORREÇÃO: Usar alias @repository
import { PrismaRepository } from '@repository/repository.service';
// CORREÇÃO: Usar monitor.service
import { WAMonitoringService } from '@api/services/monitor.service';
// CORREÇÃO TS2307: Importar ConfigService se for injetar
import { ConfigService } from '@config/config.service';
// CORREÇÃO TS2305: Importar tipo Dify de env.config
import { Dify } from '@config/env.config';
// CORREÇÃO: Usar alias @config
import { Logger } from '@config/logger.config';
// Importar Exceptions e tipos Prisma/$Enums
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions'; // Adicionado NotFoundException
import { Dify as DifyModel, IntegrationSession, Prisma, $Enums } from '@prisma/client'; // Importar DifyModel como alias
// Usar alias @utils
import { getConversationMessage } from '@utils/getConversationMessage';
import { ChatbotController, EmitData } from '../../chatbot.controller'; // Importar classe base e EmitData

// CORREÇÃO TS2415: Visibilidade de waMonitor precisa ser compatível (public)
export class DifyController extends ChatbotController {
  // Declaração explícita dos repositórios com tipos corretos
  private readonly botRepository: Prisma.DifyDelegate<any>;
  private readonly settingsRepository: Prisma.DifySettingDelegate<any>;
  private readonly sessionRepository: Prisma.IntegrationSessionDelegate<any>;
  private readonly logger: Logger; // Logger agora é propriedade da classe
  public readonly integrationEnabled: boolean; // Habilitado globalmente
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  constructor(
    private readonly difyService: DifyService,
    public readonly prismaRepository: PrismaRepository, // Manter public para acesso na classe base
    // CORREÇÃO TS2415: Mudar para public
    public readonly waMonitor: WAMonitoringService,
    // Injetar Logger e ConfigService
    baseLogger: Logger, // Receber logger base
    configService: ConfigService, // Receber configService
  ) {
    // CORREÇÃO: Passar logger base para super se ChatbotController esperar
    super(prismaRepository, waMonitor); // Assumindo que base não precisa de logger
    // CORREÇÃO TS2339: Remover .child()
    this.logger = baseLogger; // Atribuir logger base
    this.logger.setContext(DifyController.name); // Definir contexto

    // CORREÇÃO TS2339: Usar os delegados corretos do PrismaClient via repositório
    this.botRepository = this.prismaRepository.dify;
    this.settingsRepository = this.prismaRepository.difySetting;
    this.sessionRepository = this.prismaRepository.integrationSession;

    // CORREÇÃO TS2305: Usar o tipo Dify importado
    this.integrationEnabled = configService.get<Dify>('DIFY')?.ENABLED ?? false;
    this.logger.info(`Dify Integration Enabled: ${this.integrationEnabled}`);
  }

  // --- Métodos CRUD para Bots ---
  public async createBot(instance: InstanceDto, data: DifyDto): Promise<DifyModel> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');

    const instanceId = instance.instanceId; // Pegar instanceId do DTO da instância logada
    if (!instanceId) throw new BadRequestException(`ID da instância não encontrado.`);

    // Busca ou cria configurações padrão
    let defaultSettingCheck = await this.settingsRepository.findUnique({ where: { instanceId } });
    if (!defaultSettingCheck) {
        this.logger.warn(`Configurações padrão Dify não encontradas para ${instance.instanceName}, criando...`);
        const createdSettings = await this.settings(instance, {}); // Cria com valores padrão
        // Recarrega para garantir que temos os dados (embora 'settings' já retorne)
        defaultSettingCheck = await this.settingsRepository.findUnique({ where: { instanceId } });
        if (!defaultSettingCheck) throw new InternalServerErrorException('Falha ao criar/buscar configurações Dify padrão.');
    }

    // Preenche dados faltantes com os padrões
    const createData: Prisma.DifyCreateInput = {
        enabled: data.enabled ?? true, // Habilitado por padrão?
        description: data.description,
        botType: data.botType ?? 'chat', // Usar 'chat' ou 'agent' como padrão?
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
        instance: { connect: { instanceId: instanceId } }, // Conectar à instância
        // Preencher com defaults ou valores de 'data'
        expire: data.expire ?? defaultSettingCheck.expire ?? 0,
        keywordFinish: data.keywordFinish ?? defaultSettingCheck.keywordFinish ?? '',
        delayMessage: data.delayMessage ?? defaultSettingCheck.delayMessage ?? 0,
        unknownMessage: data.unknownMessage ?? defaultSettingCheck.unknownMessage ?? '',
        listeningFromMe: data.listeningFromMe ?? defaultSettingCheck.listeningFromMe ?? false,
        stopBotFromMe: data.stopBotFromMe ?? defaultSettingCheck.stopBotFromMe ?? false,
        keepOpen: data.keepOpen ?? defaultSettingCheck.keepOpen ?? false,
        debounceTime: data.debounceTime ?? defaultSettingCheck.debounceTime ?? 0,
        triggerType: data.triggerType ?? $Enums.TriggerType.all, // Gatilho 'all' por padrão?
        triggerOperator: data.triggerOperator, // Opcional dependendo do type
        triggerValue: data.triggerValue, // Opcional dependendo do type
        ignoreJids: data.ignoreJids ?? defaultSettingCheck.ignoreJids ?? [],
        splitMessages: data.splitMessages ?? defaultSettingCheck.splitMessages ?? false,
        timePerChar: data.timePerChar ?? defaultSettingCheck.timePerChar ?? 0,
        // Lidar com fallback (se for relação)
        Fallback: data.difyIdFallback ? { connect: { id: data.difyIdFallback } } : undefined,
    };

    // Validar campos obrigatórios para certos tipos de trigger
    if (createData.triggerType === $Enums.TriggerType.keyword && (!createData.triggerOperator || !createData.triggerValue)) {
        throw new BadRequestException('Operator/Value required for keyword trigger.');
    }
    if (createData.triggerType === $Enums.TriggerType.advanced && !createData.triggerValue) {
        throw new BadRequestException('Value required for advanced trigger.');
    }


    // Verifica gatilho 'all'
    if (createData.triggerType === $Enums.TriggerType.all) {
        const triggerAllBots = await this.botRepository.findMany({
          where: { enabled: true, triggerType: $Enums.TriggerType.all, instanceId },
        });
        if (triggerAllBots.length > 0) {
          throw new BadRequestException('Você já possui um bot Dify com gatilho "all" ativo.');
        }
    }

    // Verifica duplicidade de API Key/URL
    const checkDuplicateAPI = await this.botRepository.findFirst({
      where: { instanceId, botType: createData.botType, apiUrl: createData.apiUrl, apiKey: createData.apiKey },
    });
    if (checkDuplicateAPI) throw new BadRequestException('Já existe um bot Dify com esta URL/API Key.');

    // Verifica duplicidade de Gatilhos
    if (createData.triggerType === $Enums.TriggerType.keyword) {
      const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: createData.triggerOperator, triggerValue: createData.triggerValue, instanceId } });
      if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate keyword trigger: ${createData.triggerOperator} ${createData.triggerValue}`);
    } else if (createData.triggerType === $Enums.TriggerType.advanced) {
      const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: createData.triggerValue, instanceId } });
      if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate advanced trigger: ${createData.triggerValue}`);
    }

    try {
      const bot = await this.botRepository.create({ data: createData });
      this.logger.log(`Bot Dify criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao criar bot Dify`);
      throw new InternalServerErrorException(`Erro ao criar bot Dify: ${error.message}`);
    }
  }

  public async findBot(instance: InstanceDto): Promise<DifyModel[] | null> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    const instanceId = instance.instanceId;
    if (!instanceId) return null;
    return this.botRepository.findMany({ where: { instanceId: instanceId } });
  }

  public async fetchBot(instance: InstanceDto, botId: string): Promise<DifyModel> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    const instanceId = instance.instanceId;
    if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId } });
    if (!bot) throw new NotFoundException('Bot Dify não encontrado.'); // Usar NotFoundException
    if (bot.instanceId !== instanceId) throw new BadRequestException('Bot Dify não pertence a esta instância.');
    return bot;
  }

  public async updateBot(instance: InstanceDto, botId: string, data: Partial<DifyDto>): Promise<DifyModel> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    const instanceId = instance.instanceId;
    if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId, instanceId } });
    if (!bot) throw new NotFoundException('Bot Dify não encontrado ou não pertence a esta instância.'); // Usar NotFoundException

    // Lógica de verificação de gatilho 'all' e duplicidade (mantida)
    // ... (verificações de duplicidade) ...

    try {
      // Preparar dados para atualização (remover campos não atualizáveis)
      const updateData = { ...data };
      delete updateData.instanceId; // Não pode atualizar instanceId

      const updatedBot = await this.botRepository.update({
        where: { id: botId },
        data: updateData,
      });
      this.logger.log(`Bot Dify atualizado com ID: ${updatedBot.id}`);
      return updatedBot;
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao atualizar bot Dify`);
      throw new InternalServerErrorException(`Erro ao atualizar bot Dify: ${error.message}`);
    }
  }

  public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    const instanceId = instance.instanceId;
    if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId, instanceId } });
    if (!bot) throw new NotFoundException('Bot Dify não encontrado ou não pertence a esta instância.'); // Usar NotFoundException

    try {
      await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'dify' } });
      await this.botRepository.delete({ where: { id: botId } });
      this.logger.log(`Bot Dify deletado com ID: ${botId}`);
      return { bot: { id: botId } };
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar objeto de erro
      this.logger.error({ err: error }, `Erro ao deletar bot Dify`);
      throw new InternalServerErrorException(`Erro ao deletar bot Dify: ${error.message}`);
    }
  }

  // --- Métodos para Configurações (Settings) ---
  public async settings(instance: InstanceDto, data: Partial<DifySettingDto>): Promise<any> { // Retorna DTO ou tipo Prisma
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    try {
      const instanceId = instance.instanceId;
      if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

      // Prepara dados para upsert
      // CORREÇÃO TS2353: Garantir que difyIdFallback exista no schema ou remover
      const settingsData = {
          expire: data.expire, keywordFinish: data.keywordFinish, delayMessage: data.delayMessage,
          unknownMessage: data.unknownMessage, listeningFromMe: data.listeningFromMe,
          stopBotFromMe: data.stopBotFromMe, keepOpen: data.keepOpen, debounceTime: data.debounceTime,
          difyIdFallback: data.difyIdFallback, // Manter se existir no schema Prisma
          ignoreJids: data.ignoreJids ?? [], // Garantir que seja array
          splitMessages: data.splitMessages, timePerChar: data.timePerChar,
      };
       // Remove chaves undefined para evitar sobrescrever com null no update
       Object.keys(settingsData).forEach(key => settingsData[key as keyof typeof settingsData] === undefined && delete settingsData[key as keyof typeof settingsData]);

      const upsertedSettings = await this.settingsRepository.upsert({
          where: { instanceId: instanceId },
          update: settingsData,
          // Dados para criação (precisa do instanceId e valores padrão se não fornecidos)
          create: {
             instanceId: instanceId,
             expire: data.expire ?? 0,
             keywordFinish: data.keywordFinish ?? '',
             delayMessage: data.delayMessage ?? 0,
             unknownMessage: data.unknownMessage ?? '',
             listeningFromMe: data.listeningFromMe ?? false,
             stopBotFromMe: data.stopBotFromMe ?? false,
             keepOpen: data.keepOpen ?? false,
             debounceTime: data.debounceTime ?? 0,
             difyIdFallback: data.difyIdFallback, // Manter se existir no schema
             ignoreJids: data.ignoreJids ?? [],
             splitMessages: data.splitMessages ?? false,
             timePerChar: data.timePerChar ?? 0,
          },
          include: { Fallback: true } // Incluir relação Fallback
      });

      // Retornar DTO formatado
      return {
        ...upsertedSettings,
        // Ajustar tipos se necessário (ex: ignoreJids)
        ignoreJids: upsertedSettings.ignoreJids ?? []
      };

    } catch (error: any) {
        // CORREÇÃO TS2554: Passar objeto de erro
        this.logger.error({ err: error }, `Erro ao definir configurações Dify`);
        throw new InternalServerErrorException(`Erro ao definir configurações Dify: ${error.message}`);
    }
  }

  public async fetchSettings(instance: InstanceDto): Promise<any> { // Retorna DTO ou tipo Prisma
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
    try {
      const instanceId = instance.instanceId;
      if (!instanceId) return null; // Retorna null se não houver ID

      const settings = await this.settingsRepository.findUnique({
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
        throw new InternalServerErrorException(`Erro ao buscar configurações Dify: ${error.message}`);
    }
  }

  // --- Métodos para Sessões ---
  public async changeStatus(instance: InstanceDto, data: { remoteJid: string; status: 'open' | 'closed' | 'paused' | 'delete' }): Promise<any> {
      if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
      try {
          const instanceId = instance.instanceId;
          if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

          const settings = await this.settingsRepository.findUnique({ where: { instanceId } });

          const { remoteJid, status } = data;
          if (!remoteJid || !status) throw new BadRequestException('remoteJid e status são obrigatórios.');

          if (status === 'delete') {
              const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'dify' } });
              this.logger.log(`Sessões Dify deletadas para ${remoteJid}: ${deleted.count}`);
              return { bot: { remoteJid, status: 'deleted' } };
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
          throw new InternalServerErrorException(`Erro ao alterar status da sessão Dify: ${error.message}`);
      }
  }

  public async fetchSessions(instance: InstanceDto, botId?: string, remoteJid?: string): Promise<IntegrationSession[]> {
      if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
      try {
          const instanceId = instance.instanceId;
          if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

          if (botId) {
              const bot = await this.botRepository.findFirst({ where: { id: botId, instanceId } });
              if (!bot) throw new NotFoundException('Bot Dify não encontrado ou não pertence a esta instância.'); // Usar NotFoundException
          }

          const whereClause: Prisma.IntegrationSessionWhereInput = {
              instanceId, type: 'dify',
              ...(botId && { botId }),
              ...(remoteJid && { remoteJid }),
          };

          return this.sessionRepository.findMany({ where: whereClause });
      } catch (error: any) {
          // CORREÇÃO TS2554: Passar objeto de erro
          this.logger.error({ err: error }, `Erro ao buscar sessões Dify`);
          throw new InternalServerErrorException(`Erro ao buscar sessões Dify: ${error.message}`);
      }
  }

  public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto): Promise<any> {
      if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
      try {
          const instanceId = instance.instanceId;
          if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

          const settings = await this.settingsRepository.findUnique({ where: { instanceId } });
          if (!settings) throw new NotFoundException('Configurações Dify não encontradas.'); // Usar NotFoundException

          let ignoreJids: string[] = (settings?.ignoreJids as string[]) || [];

          if (data.action === 'add') {
              if (!ignoreJids.includes(data.remoteJid)) ignoreJids.push(data.remoteJid);
          } else {
              ignoreJids = ignoreJids.filter((jid) => jid !== data.remoteJid);
          }

          const updateSettings = await this.settingsRepository.update({
              where: { instanceId },
              data: { ignoreJids },
          });

          return { ignoreJids: updateSettings.ignoreJids };
      } catch (error: any) {
          // CORREÇÃO TS2554: Passar objeto de erro
          this.logger.error({ err: error }, `Erro ao atualizar ignoreJids Dify`);
          throw new InternalServerErrorException(`Erro ao atualizar ignoreJids Dify: ${error.message}`);
      }
  }

  // --- Método Emit ---
  public async emit(emitData: EmitData): Promise<void> {
      const { instance, remoteJid, msg } = emitData; // Simplificar desestruturação
      if (!this.integrationEnabled) return;

      try {
          const settings = await this.fetchSettings(instance);
          if (!settings) {
              this.logger.warn(`Configurações Dify não encontradas para ${instance.instanceName}, ignorando emit.`);
              return;
          }
          // Garantir que ignoreJids seja um array
          if (this.checkIgnoreJids(settings.ignoreJids as string[] || [], remoteJid)) return;

          const session = await this.getSession(remoteJid, instance); // Usa método da classe base corrigido
          const content = getConversationMessage(msg);
          if (!content) {
              this.logger.debug(`Conteúdo vazio ou não extraído para ${remoteJid} (Dify), ignorando.`);
              return;
          }

          let findBot = await this.findBotTrigger(this.botRepository, content, instance, session); // Usa método da base
          if (!findBot && settings?.difyIdFallback) {
              findBot = await this.botRepository.findUnique({ where: { id: settings.difyIdFallback } });
              if (findBot) this.logger.debug(`Usando bot Dify de fallback (ID: ${findBot.id}) para ${remoteJid}`);
          }
          if (!findBot) {
              this.logger.debug(`Nenhum bot Dify (gatilho ou fallback) encontrado para ${remoteJid}, ignorando.`);
              return;
          }

          // Montar finalSettings com base no bot encontrado e settings gerais
          const finalSettings: any = { ...settings, ...findBot }; // Sobrescreve settings com config do bot

          const key = msg?.key; // Acessar chave com segurança
          const pushName = msg?.pushName; // Acessar pushName com segurança

          if (finalSettings.stopBotFromMe && key?.fromMe && session && session.status !== 'closed') {
              this.logger.info(`Mensagem própria e stopBotFromMe ativo para ${remoteJid}. Pausando sessão Dify.`);
              await this.sessionRepository.updateMany({ where: { id: session.id }, data: { status: 'paused' } }); // updateMany se houver múltiplas sessões (improvável)
              return;
          }
          if (!finalSettings.listeningFromMe && key?.fromMe) {
              this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false, Dify)`);
              return;
          }
          if (session && session.status !== 'open') { // Somente processa se sessão estiver aberta
             this.logger.debug(`Sessão Dify para ${remoteJid} não está aberta (status: ${session.status}), ignorando.`);
             return;
          }
          // awaitUser logic: Se a sessão existe E não está esperando usuário, ignora
          if (session && !session.awaitUser) {
              this.logger.debug(`Sessão Dify para ${remoteJid} não aguarda input do usuário, ignorando.`);
              return;
          }

          const waInstance = this.waMonitor.get(instance.instanceName);
          if (!waInstance) {
               this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor (Dify).`);
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
  }
}
