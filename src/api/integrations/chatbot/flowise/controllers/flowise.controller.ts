// src/api/integrations/chatbot/flowise/controllers/flowise.controller.ts

import { IgnoreJidDto } from '@api/dto/chatbot.dto'; // Ajustado caminho relativo/alias
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { configService } from '@config/env.config'; // Assume import global ou injetado
import { Logger } from '@config/logger.config'; // Assume alias
import { BadRequestException } from '@exceptions'; // Assume alias
// Importa o modelo e Enums do Prisma Client atualizado
import { Flowise as FlowiseModel, FlowiseSetting, IntegrationSession, $Enums, Prisma } from '@prisma/client';
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { getConversationMessage } from '@utils/getConversationMessage'; // Assume alias

// << CORREÇÃO TS2305: Remover ChatbotControllerInterface (não existe) >>
import { ChatbotController, EmitData } from '../../chatbot.controller'; // Importa apenas ChatbotController e EmitData
import { FlowiseDto, FlowiseSettingDto } from '../dto/flowise.dto'; // Assume DTO existe
import { FlowiseService } from '../services/flowise.service'; // Assume serviço existe

// << CORREÇÃO TS2305: Remover implementação da interface >>
export class FlowiseController extends ChatbotController {
  constructor(
    private readonly flowiseService: FlowiseService, // Serviço específico injetado
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor); // Passa dependências para a base

    // Define os repositórios específicos para este controller
    this.botRepository = this.prismaRepository.flowise;
    this.settingsRepository = this.prismaRepository.flowiseSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  public readonly logger = new Logger('FlowiseController'); // Usa Logger importado

  // Assume Flowise sempre habilitado ou buscar de configService
  integrationEnabled = true; // configService.get<any>('FLOWISE')?.ENABLED ?? true;
  botRepository: PrismaRepository['flowise']; // Tipo Prisma correto
  settingsRepository: PrismaRepository['flowiseSetting']; // Tipo Prisma correto
  sessionRepository: PrismaRepository['integrationSession']; // Tipo Prisma correto
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // --- Bots ---
  public async createBot(instance: InstanceDto, data: FlowiseDto): Promise<FlowiseModel> {
    const instanceId = await this.prismaRepository.prisma.instance // Acessa via .prisma (ou método do repo)
        .findFirst({ where: { name: instance.instanceName } })
        .then((instanceDb) => instanceDb?.id);
    if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada no DB.`);

    // Lógica para buscar ou definir configurações padrão
    let defaultSettingCheck = await this.settingsRepository.findFirst({ where: { instanceId } });
    if (!defaultSettingCheck) {
        this.logger.warn(`Configurações padrão Flowise não encontradas para ${instance.instanceName}, criando...`);
        defaultSettingCheck = await this.settings(instance, {}); // Cria padrão
    }
    // Preenche dados faltantes
    data.expire = data.expire ?? defaultSettingCheck?.expire ?? 0;
    data.keywordFinish = data.keywordFinish ?? defaultSettingCheck?.keywordFinish ?? '';
    data.delayMessage = data.delayMessage ?? defaultSettingCheck?.delayMessage ?? 0;
    data.unknownMessage = data.unknownMessage ?? defaultSettingCheck?.unknownMessage ?? '';
    data.listeningFromMe = data.listeningFromMe ?? defaultSettingCheck?.listeningFromMe ?? false;
    data.stopBotFromMe = data.stopBotFromMe ?? defaultSettingCheck?.stopBotFromMe ?? false;
    data.keepOpen = data.keepOpen ?? defaultSettingCheck?.keepOpen ?? false;
    data.debounceTime = data.debounceTime ?? defaultSettingCheck?.debounceTime ?? 0;
    data.ignoreJids = data.ignoreJids ?? defaultSettingCheck?.ignoreJids ?? [];
    data.splitMessages = data.splitMessages ?? defaultSettingCheck?.splitMessages ?? false;
    data.timePerChar = data.timePerChar ?? defaultSettingCheck?.timePerChar ?? 0;

    // << CORREÇÃO TS2367: Usar Enum Prisma >>
    const triggerAllBots = await this.botRepository.findMany({
        where: { enabled: true, triggerType: $Enums.TriggerType.all, instanceId },
    });
    if (data.triggerType === $Enums.TriggerType.all && triggerAllBots.length > 0) {
        throw new Error('Você já possui um bot Flowise com gatilho "all" ativo.');
    }

    // Verifica duplicidade de URL (apiKey é opcional no Flowise)
    const checkDuplicateAPI = await this.botRepository.findFirst({
        where: { instanceId, url: data.url }, // Verifica só URL? Ou URL+apiKey se apiKey existir?
    });
    if (checkDuplicateAPI) {
        throw new Error('Já existe um bot Flowise com esta URL.');
    }

    // Validação e Verificação de Gatilhos Duplicados
    if (data.triggerType === $Enums.TriggerType.keyword) { // Usa Enum
        if (!data.triggerOperator || !data.triggerValue) throw new Error('Operador e Valor são obrigatórios para gatilho "keyword".');
        const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, instanceId } });
        if (checkDuplicateTrigger) throw new Error(`Gatilho "keyword" duplicado: ${data.triggerOperator} ${data.triggerValue}`);
    } else if (data.triggerType === $Enums.TriggerType.advanced) { // Usa Enum
        if (!data.triggerValue) throw new Error('Valor é obrigatório para gatilho "advanced".');
        const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, instanceId } });
        if (checkDuplicateTrigger) throw new Error(`Gatilho "advanced" duplicado: ${data.triggerValue}`);
    }

    try {
      const bot = await this.botRepository.create({
        data: {
            ...data,
            instanceId: instanceId,
            apiKey: data.apiKey, // Mantém apiKey como opcional
            // Renomeado token para apiKey no schema? Se não, ajuste aqui
            // token: data.apiKey,
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull, // Ajusta tipo
        },
      });
      this.logger.log(`Bot Flowise criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      this.logger.error(error);
      throw new Error(`Erro ao criar bot Flowise: ${error.message}`);
    }
  }

  // --- findBot, fetchBot, updateBot, deleteBot (Lógica similar aos outros controllers) ---
  public async findBot(instance: InstanceDto): Promise<FlowiseModel[] | null> {
    const instanceId = await this.prismaRepository.prisma.instance
        .findFirst({ where: { name: instance.instanceName } })
        .then((inst) => inst?.id);
    if (!instanceId) return null;
    return await this.botRepository.findMany({ where: { instanceId } });
}

public async fetchBot(instance: InstanceDto, botId: string): Promise<FlowiseModel> {
    const instanceId = await this.prismaRepository.prisma.instance
        .findFirst({ where: { name: instance.instanceName } })
        .then((inst) => inst?.id);
    if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId } });
    if (!bot) throw new Error('Bot Flowise não encontrado.');
    if (bot.instanceId !== instanceId) throw new Error('Bot Flowise não pertence a esta instância.');
    return bot;
}

public async updateBot(instance: InstanceDto, botId: string, data: FlowiseDto): Promise<FlowiseModel> {
    const instanceId = await this.prismaRepository.prisma.instance
        .findFirst({ where: { name: instance.instanceName } })
        .then((inst) => inst?.id);
    if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId } });
    if (!bot || bot.instanceId !== instanceId) throw new Error('Bot Flowise não encontrado ou não pertence a esta instância.');

    // Lógica de verificação de gatilho 'all' e duplicidade
    if (data.triggerType === $Enums.TriggerType.all) {
        const checkTriggerAll = await this.botRepository.findFirst({ where: { enabled: true, triggerType: $Enums.TriggerType.all, id: { not: botId }, instanceId } });
        if (checkTriggerAll) throw new Error('Já existe outro bot Flowise com gatilho "all" ativo.');
    }
    // ... verificações de duplicidade para keyword/advanced/URL ...
     if (data.triggerType === $Enums.TriggerType.keyword) {
         if (!data.triggerOperator || !data.triggerValue) throw new Error('Operator/Value required for keyword trigger.');
         const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
         if (checkDuplicateTrigger) throw new Error(`Duplicate keyword trigger: ${data.triggerOperator} ${data.triggerValue}`);
     } else if (data.triggerType === $Enums.TriggerType.advanced) {
         if (!data.triggerValue) throw new Error('Value required for advanced trigger.');
         const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
         if (checkDuplicateTrigger) throw new Error(`Duplicate advanced trigger: ${data.triggerValue}`);
     }
     const checkDuplicateURL = await this.botRepository.findFirst({ where: { id: { not: botId }, instanceId, url: data.url } });
     if (checkDuplicateURL) throw new Error('Another Flowise bot with this URL already exists.');


    try {
        const updatedBot = await this.botRepository.update({
            where: { id: botId },
            data: {
                ...data,
                instanceId: undefined,
                id: undefined,
                ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
            },
        });
        this.logger.log(`Bot Flowise atualizado com ID: ${updatedBot.id}`);
        return updatedBot;
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao atualizar bot Flowise: ${error.message}`);
    }
}

public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
     const instanceId = await this.prismaRepository.prisma.instance
         .findFirst({ where: { name: instance.instanceName } })
         .then((inst) => inst?.id);
     if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

    const bot = await this.botRepository.findFirst({ where: { id: botId } });
    if (!bot || bot.instanceId !== instanceId) throw new Error('Bot Flowise não encontrado ou não pertence a esta instância.');

    try {
        await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'flowise' } }); // Filtra por tipo
        await this.botRepository.delete({ where: { id: botId } });
        this.logger.log(`Bot Flowise deletado com ID: ${botId}`);
        return { bot: { id: botId } };
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao deletar bot Flowise: ${error.message}`);
    }
}

  // --- Settings ---
  public async settings(instance: InstanceDto, data: Partial<FlowiseSettingDto>): Promise<FlowiseSettingDto> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const settingsData = {
            expire: data.expire,
            keywordFinish: data.keywordFinish,
            delayMessage: data.delayMessage,
            unknownMessage: data.unknownMessage,
            listeningFromMe: data.listeningFromMe,
            stopBotFromMe: data.stopBotFromMe,
            keepOpen: data.keepOpen,
            debounceTime: data.debounceTime,
            botIdFallback: data.flowiseIdFallback, // Nome correto para Flowise
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
            splitMessages: data.splitMessages,
            timePerChar: data.timePerChar,
            instanceId: instanceId,
        };
        Object.keys(settingsData).forEach(key => settingsData[key] === undefined && delete settingsData[key]);

        const upsertedSettings = await this.settingsRepository.upsert({
            where: { instanceId: instanceId },
            update: { ...settingsData, instanceId: undefined },
            create: settingsData as any,
        });

        return {
            expire: upsertedSettings.expire,
            keywordFinish: upsertedSettings.keywordFinish,
            delayMessage: upsertedSettings.delayMessage,
            unknownMessage: upsertedSettings.unknownMessage,
            listeningFromMe: upsertedSettings.listeningFromMe,
            stopBotFromMe: upsertedSettings.stopBotFromMe,
            keepOpen: upsertedSettings.keepOpen,
            debounceTime: upsertedSettings.debounceTime,
            flowiseIdFallback: upsertedSettings.botIdFallback, // Nome correto no retorno
            ignoreJids: upsertedSettings.ignoreJids as string[] ?? [],
            splitMessages: upsertedSettings.splitMessages,
            timePerChar: upsertedSettings.timePerChar,
        };
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao definir configurações Flowise: ${error.message}`);
    }
}


  public async fetchSettings(instance: InstanceDto): Promise<FlowiseSettingDto & { fallback: FlowiseModel | null }> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const settings = await this.settingsRepository.findFirst({
            where: { instanceId },
            include: { Fallback: true },
        });

        return settings
        ? {
            expire: settings.expire,
            keywordFinish: settings.keywordFinish,
            delayMessage: settings.delayMessage,
            unknownMessage: settings.unknownMessage,
            listeningFromMe: settings.listeningFromMe,
            stopBotFromMe: settings.stopBotFromMe,
            keepOpen: settings.keepOpen,
            debounceTime: settings.debounceTime,
            flowiseIdFallback: settings.botIdFallback, // Nome correto
            ignoreJids: settings.ignoreJids as string[] ?? [],
            splitMessages: settings.splitMessages,
            timePerChar: settings.timePerChar,
            fallback: settings.Fallback,
          }
        : { // Objeto padrão
            expire: 0, keywordFinish: '', delayMessage: 0, unknownMessage: '', listeningFromMe: false,
            stopBotFromMe: false, keepOpen: false, debounceTime: 0, ignoreJids: [],
            splitMessages: false, timePerChar: 0, flowiseIdFallback: null, fallback: null
          };
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao buscar configurações Flowise: ${error.message}`);
    }
}


  // --- Sessions ---
  // changeStatus, fetchSessions, ignoreJid (Lógica similar aos outros controllers)
  public async changeStatus(instance: InstanceDto, data: { remoteJid: string; status: 'open' | 'closed' | 'paused' | 'delete' }): Promise<any> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const settings = await this.settingsRepository?.findFirst({ where: { instanceId } });
        const remoteJid = data.remoteJid;
        const status = data.status;

        if (!remoteJid || !status) throw new Error('remoteJid e status são obrigatórios.');

        if (status === 'delete') {
            const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'flowise' } });
            this.logger.log(`Sessões Flowise deletadas para ${remoteJid}: ${deleted.count}`);
            return { bot: { remoteJid, status } };
        }

        if (status === 'closed') {
            if (settings?.keepOpen) {
                const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'flowise', status: { not: 'closed' } }, data: { status: 'closed' } });
                this.logger.log(`Sessões Flowise fechadas (mantidas) para ${remoteJid}: ${updated.count}`);
            } else {
                const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'flowise' } });
                this.logger.log(`Sessões Flowise deletadas (keepOpen=false) para ${remoteJid}: ${deleted.count}`);
            }
            return { bot: { remoteJid, status } };
        } else { // open ou paused
            const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'flowise' }, data: { status: status } });
            this.logger.log(`Status da sessão Flowise atualizado para "${status}" para ${remoteJid}: ${updated.count}`);
            return { bot: { remoteJid, status } };
        }
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao alterar status da sessão Flowise: ${error.message}`);
    }
}

public async fetchSessions(instance: InstanceDto, botId?: string, remoteJid?: string): Promise<IntegrationSession[]> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        if (botId) {
             const bot = await this.botRepository.findFirst({ where: { id: botId } });
             if (!bot || bot.instanceId !== instanceId) throw new Error('Bot Flowise não encontrado ou não pertence a esta instância.');
        }

        const whereClause: Prisma.IntegrationSessionWhereInput = {
            instanceId: instanceId,
            remoteJid: remoteJid,
            botId: botId,
            type: 'flowise', // Filtra por tipo
        };
        if (!remoteJid) delete whereClause.remoteJid;
        if (!botId) delete whereClause.botId;

        return await this.sessionRepository.findMany({ where: whereClause });
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao buscar sessões Flowise: ${error.message}`);
    }
}

public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto): Promise<{ ignoreJids: string[] }> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const settings = await this.settingsRepository.findFirst({ where: { instanceId } });
        if (!settings) throw new Error('Configurações Flowise não encontradas.');

        let ignoreJids: string[] = (settings?.ignoreJids as string[]) || [];

        if (data.action === 'add') {
            if (!ignoreJids.includes(data.remoteJid)) ignoreJids.push(data.remoteJid);
        } else {
            ignoreJids = ignoreJids.filter((jid) => jid !== data.remoteJid);
        }

        const updateSettings = await this.settingsRepository.update({
            where: { id: settings.id },
            data: { ignoreJids: ignoreJids },
        });

        return { ignoreJids: updateSettings.ignoreJids as string[] ?? [] };
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao atualizar ignoreJids Flowise: ${error.message}`);
    }
}


  // --- Emit ---
  public async emit({ instance, remoteJid, msg }: EmitData): Promise<void> {
    // Flowise não tem flag global ENABLED no .env por padrão, checar se o bot existe/está ativo
    try {
       // Busca configurações Flowise
       const settings = await this.fetchSettings(instance);
       if (!settings) {
           this.logger.warn(`Configurações Flowise não encontradas para ${instance.instanceName}, ignorando mensagem.`);
           return;
       }
       // Verifica ignoreJids
       if (this.checkIgnoreJids(settings?.ignoreJids ?? [], remoteJid)) return;

       // Obtém sessão
       const session = await this.getSession(remoteJid, instance);

       // Extrai conteúdo
       const content = getConversationMessage(msg);
       if (!content) {
            this.logger.debug(`Conteúdo vazio ou não extraído para ${remoteJid}, ignorando (Flowise).`);
            return;
       }

       // Encontra bot (trigger ou fallback)
       let findBot = await this.findBotTrigger(this.botRepository, content, instance, session) as FlowiseModel | null;
       if (!findBot && settings?.flowiseIdFallback) { // Usa nome correto do campo
            findBot = await this.botRepository.findFirst({ where: { id: settings.flowiseIdFallback } });
            if (findBot) this.logger.debug(`Usando bot Flowise de fallback (ID: ${findBot.id}) para ${remoteJid}`);
       }
       if (!findBot || !findBot.enabled) { // Verifica se o bot encontrado está habilitado
            this.logger.debug(`Nenhum bot Flowise ativo (gatilho ou fallback) encontrado para ${remoteJid}, ignorando.`);
            return;
       }

       // Determina configurações finais
       const finalSettings = {
           expire: findBot.expire ?? settings.expire ?? 0,
           keywordFinish: findBot.keywordFinish ?? settings.keywordFinish ?? '',
           delayMessage: findBot.delayMessage ?? settings.delayMessage ?? 0,
           unknownMessage: findBot.unknownMessage ?? settings.unknownMessage ?? '',
           listeningFromMe: findBot.listeningFromMe ?? settings.listeningFromMe ?? false,
           stopBotFromMe: findBot.stopBotFromMe ?? settings.stopBotFromMe ?? false,
           keepOpen: findBot.keepOpen ?? settings.keepOpen ?? false,
           debounceTime: findBot.debounceTime ?? settings.debounceTime ?? 0,
           ignoreJids: (findBot.ignoreJids as string[] | null) ?? (settings.ignoreJids as string[] | null) ?? [],
           splitMessages: findBot.splitMessages ?? settings.splitMessages ?? false,
           timePerChar: findBot.timePerChar ?? settings.timePerChar ?? 0,
           flowiseIdFallback: settings.flowiseIdFallback, // Nome correto
       };

       const key = msg.key as { id: string; remoteJid: string; fromMe: boolean; participant: string };

       // Verifica stopBotFromMe
       if (finalSettings.stopBotFromMe && key.fromMe && session && session.status !== 'closed') {
           this.logger.info(`Mensagem própria recebida e stopBotFromMe ativo para ${remoteJid}. Pausando sessão Flowise.`);
           await this.sessionRepository.update({ where: { id: session.id }, data: { status: 'paused' } });
           return;
       }

       // Verifica listeningFromMe
       if (!finalSettings.listeningFromMe && key.fromMe) {
           this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false, Flowise)`);
           return;
       }

        // Verifica se a sessão aguarda input
       if (session && !session.awaitUser && session.status !== 'closed') {
           this.logger.debug(`Sessão Flowise para ${remoteJid} não aguarda input do usuário, ignorando.`);
           return;
       }

       // Processa com ou sem debounce
       const waInstance = this.waMonitor.get(instance.instanceName);
       if (!waInstance) {
            this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor (Flowise).`);
            return;
       }

       if (finalSettings.debounceTime && finalSettings.debounceTime > 0) {
           this.processDebounce(this.userMessageDebounce, content, remoteJid, finalSettings.debounceTime, async (debouncedContent) => {
               await this.flowiseService.processBot(waInstance, remoteJid, findBot!, session, finalSettings, debouncedContent, msg?.pushName);
           });
       } else {
           await this.flowiseService.processBot(waInstance, remoteJid, findBot!, session, finalSettings, content, msg?.pushName);
       }

    } catch (error: any) {
      this.logger.error(`Erro no método emit FlowiseController para ${remoteJid}: ${error.message}`, error.stack);
    }
  } // Fim emit
}
