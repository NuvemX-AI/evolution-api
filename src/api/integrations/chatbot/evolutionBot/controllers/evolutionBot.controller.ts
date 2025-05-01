// src/api/integrations/chatbot/evolutionBot/controllers/evolutionBot.controller.ts

import { IgnoreJidDto } from '@api/dto/chatbot.dto'; // Ajustado caminho relativo/alias
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { Logger } from '@config/logger.config'; // Assume alias
// Importa o modelo Prisma e Enums
import { EvolutionBot, EvolutionBotSetting, IntegrationSession, $Enums, Prisma } from '@prisma/client';
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { getConversationMessage } from '@utils/getConversationMessage'; // Assume alias

// << CORREÇÃO TS2305: Remover ChatbotControllerInterface (não existe) >>
import { ChatbotController, EmitData } from '../../chatbot.controller'; // Importa apenas ChatbotController e EmitData
import { EvolutionBotDto, EvolutionBotSettingDto } from '../dto/evolutionBot.dto'; // Assume DTO existe
import { EvolutionBotService } from '../services/evolutionBot.service'; // Assume serviço existe

// << CORREÇÃO TS2305: Remover implementação da interface >>
export class EvolutionBotController extends ChatbotController {
  constructor(
    private readonly evolutionBotService: EvolutionBotService, // Serviço específico injetado
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor); // Passa dependências para a base

    // Define os repositórios específicos para este controller
    this.botRepository = this.prismaRepository.evolutionBot;
    this.settingsRepository = this.prismaRepository.evolutionBotSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  public readonly logger = new Logger('EvolutionBotController'); // Usa Logger importado

  integrationEnabled: boolean = true; // EvolutionBot é interno, assume habilitado
  botRepository: PrismaRepository['evolutionBot']; // Tipo Prisma correto
  settingsRepository: PrismaRepository['evolutionBotSetting']; // Tipo Prisma correto
  sessionRepository: PrismaRepository['integrationSession']; // Tipo Prisma correto
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // --- Bots ---
  public async createBot(instance: InstanceDto, data: EvolutionBotDto): Promise<EvolutionBot> {
    const instanceId = await this.prismaRepository.prisma.instance // Acessa via .prisma (ou método do repo)
        .findFirst({ where: { name: instance.instanceName } })
        .then((instanceDb) => instanceDb?.id);
    if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada no DB.`);


    // Lógica para buscar ou definir configurações padrão
    let defaultSettingCheck = await this.settingsRepository.findFirst({ where: { instanceId } });
    if (!defaultSettingCheck) {
        this.logger.warn(`Configurações padrão EvolutionBot não encontradas para ${instance.instanceName}, criando...`);
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

    // << CORREÇÃO TS2367: Usar Enum Prisma se aplicável, senão manter string e verificar definição >>
    // NOTE: Verifique como TriggerType é definido (Prisma Enum ou string literal)
    const triggerAllBots = await this.botRepository.findMany({
        where: {
            enabled: true,
            triggerType: $Enums.TriggerType.all, // Usando Enum Prisma
            // triggerType: 'all', // Manter se TriggerType for string literal
            instanceId: instanceId,
        },
    });
    if (data.triggerType === $Enums.TriggerType.all && triggerAllBots.length > 0) {
        throw new Error('Você já possui um bot Evolution com gatilho "all" ativo.');
    }

    // Verifica duplicidade de API Key/URL (mantida)
    const checkDuplicateAPI = await this.botRepository.findFirst({
        where: {
            instanceId: instanceId,
            apiUrl: data.apiUrl,
            apiKey: data.apiKey,
        },
    });
    if (checkDuplicateAPI) {
        throw new Error('Já existe um bot Evolution com esta URL/API Key.');
    }

    // Validação e Verificação de Gatilhos Duplicados (keyword/advanced)
    if (data.triggerType === $Enums.TriggerType.keyword) { // Usa Enum
        if (!data.triggerOperator || !data.triggerValue) {
            throw new Error('Operador e Valor são obrigatórios para o gatilho "keyword".');
        }
        const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, instanceId } });
        if (checkDuplicateTrigger) throw new Error(`Gatilho "keyword" duplicado: ${data.triggerOperator} ${data.triggerValue}`);
    } else if (data.triggerType === $Enums.TriggerType.advanced) { // Usa Enum
        if (!data.triggerValue) throw new Error('Valor é obrigatório para o gatilho "advanced".');
        const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, instanceId } });
        if (checkDuplicateTrigger) throw new Error(`Gatilho "advanced" duplicado: ${data.triggerValue}`);
    }

    try {
      const bot = await this.botRepository.create({
        data: {
            ...data, // Usa dados com fallbacks
            instanceId: instanceId, // Garante instanceId
            // Ajusta tipos se necessário (ex: ignoreJids para Prisma.InputJsonValue se for JSON)
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
        },
      });
      this.logger.log(`Bot Evolution criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      this.logger.error(error);
      throw new Error(`Erro ao criar bot Evolution: ${error.message}`);
    }
  }

  // --- findBot, fetchBot, updateBot, deleteBot (Lógica similar ao DifyController, com tipos ajustados) ---
    public async findBot(instance: InstanceDto): Promise<EvolutionBot[] | null> {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) return null;
        return await this.botRepository.findMany({ where: { instanceId } });
    }

    public async fetchBot(instance: InstanceDto, botId: string): Promise<EvolutionBot> {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot) throw new Error('Bot Evolution não encontrado.');
        if (bot.instanceId !== instanceId) throw new Error('Bot Evolution não pertence a esta instância.');
        return bot;
    }

    public async updateBot(instance: InstanceDto, botId: string, data: EvolutionBotDto): Promise<EvolutionBot> {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot || bot.instanceId !== instanceId) throw new Error('Bot Evolution não encontrado ou não pertence a esta instância.');

        // Lógica de verificação de gatilho 'all' e duplicidade
        if (data.triggerType === $Enums.TriggerType.all) {
            const checkTriggerAll = await this.botRepository.findFirst({ where: { enabled: true, triggerType: $Enums.TriggerType.all, id: { not: botId }, instanceId } });
            if (checkTriggerAll) throw new Error('Já existe outro bot Evolution com gatilho "all" ativo.');
        }
        // ... verificações de duplicidade para keyword/advanced/apiKey ...
         if (data.triggerType === $Enums.TriggerType.keyword) {
             if (!data.triggerOperator || !data.triggerValue) throw new Error('Operator/Value required for keyword trigger.');
             const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
             if (checkDuplicateTrigger) throw new Error(`Duplicate keyword trigger: ${data.triggerOperator} ${data.triggerValue}`);
         } else if (data.triggerType === $Enums.TriggerType.advanced) {
             if (!data.triggerValue) throw new Error('Value required for advanced trigger.');
             const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
             if (checkDuplicateTrigger) throw new Error(`Duplicate advanced trigger: ${data.triggerValue}`);
         }
         const checkDuplicateAPI = await this.botRepository.findFirst({ where: { id: { not: botId }, instanceId, apiUrl: data.apiUrl, apiKey: data.apiKey } });
         if (checkDuplicateAPI) throw new Error('Another Evolution bot with this URL/API Key already exists.');


        try {
            const updatedBot = await this.botRepository.update({
                where: { id: botId },
                data: {
                    ...data,
                    instanceId: undefined, // Não atualiza instanceId
                    id: undefined, // Não atualiza id
                    ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull, // Ajusta tipo para Prisma
                },
            });
            this.logger.log(`Bot Evolution atualizado com ID: ${updatedBot.id}`);
            return updatedBot;
        } catch (error: any) {
            this.logger.error(error);
            throw new Error(`Erro ao atualizar bot Evolution: ${error.message}`);
        }
    }

    public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
         const instanceId = await this.prismaRepository.prisma.instance
             .findFirst({ where: { name: instance.instanceName } })
             .then((inst) => inst?.id);
         if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot || bot.instanceId !== instanceId) throw new Error('Bot Evolution não encontrado ou não pertence a esta instância.');

        try {
            await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'evolution' } }); // Filtra por tipo
            await this.botRepository.delete({ where: { id: botId } });
            this.logger.log(`Bot Evolution deletado com ID: ${botId}`);
            return { bot: { id: botId } };
        } catch (error: any) {
            this.logger.error(error);
            throw new Error(`Erro ao deletar bot Evolution: ${error.message}`);
        }
    }

  // --- Settings ---
  public async settings(instance: InstanceDto, data: Partial<EvolutionBotSettingDto>): Promise<EvolutionBotSettingDto> {
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
            botIdFallback: data.botIdFallback,
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull, // Ajusta tipo
            splitMessages: data.splitMessages,
            timePerChar: data.timePerChar,
            instanceId: instanceId, // Para 'create'
        };
         // Remove chaves undefined
        Object.keys(settingsData).forEach(key => settingsData[key] === undefined && delete settingsData[key]);

        const upsertedSettings = await this.settingsRepository.upsert({
            where: { instanceId: instanceId },
            update: { ...settingsData, instanceId: undefined }, // Não atualiza instanceId
            create: settingsData as any, // Garante instanceId no create
        });

        // Retorna DTO
        return {
            expire: upsertedSettings.expire,
            keywordFinish: upsertedSettings.keywordFinish,
            delayMessage: upsertedSettings.delayMessage,
            unknownMessage: upsertedSettings.unknownMessage,
            listeningFromMe: upsertedSettings.listeningFromMe,
            stopBotFromMe: upsertedSettings.stopBotFromMe,
            keepOpen: upsertedSettings.keepOpen,
            debounceTime: upsertedSettings.debounceTime,
            botIdFallback: upsertedSettings.botIdFallback,
            ignoreJids: upsertedSettings.ignoreJids as string[] ?? [], // Faz cast de volta
            splitMessages: upsertedSettings.splitMessages,
            timePerChar: upsertedSettings.timePerChar,
        };
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao definir configurações EvolutionBot: ${error.message}`);
    }
}


  public async fetchSettings(instance: InstanceDto): Promise<EvolutionBotSettingDto & { fallback: EvolutionBot | null }> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const settings = await this.settingsRepository.findFirst({
            where: { instanceId },
            include: { Fallback: true }, // Inclui relação Fallback
        });

        // Retorna settings ou padrão
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
            botIdFallback: settings.botIdFallback,
            ignoreJids: settings.ignoreJids as string[] ?? [], // Cast
            splitMessages: settings.splitMessages,
            timePerChar: settings.timePerChar,
            fallback: settings.Fallback, // Retorna o bot de fallback incluído
          }
        : { // Objeto padrão
            expire: 0, keywordFinish: '', delayMessage: 0, unknownMessage: '', listeningFromMe: false,
            stopBotFromMe: false, keepOpen: false, debounceTime: 0, ignoreJids: [],
            splitMessages: false, timePerChar: 0, botIdFallback: null, fallback: null
          };
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao buscar configurações EvolutionBot: ${error.message}`);
    }
}


  // --- Sessions ---
  // changeStatus, fetchSessions, ignoreJid (Lógica similar ao DifyController, ajustar tipo de sessão)
  public async changeStatus(instance: InstanceDto, data: { remoteJid: string; status: 'open' | 'closed' | 'paused' | 'delete' }): Promise<any> {
     try {
         const instanceId = await this.prismaRepository.prisma.instance
             .findFirst({ where: { name: instance.instanceName } })
             .then((inst) => inst?.id);
         if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

         const settings = await this.settingsRepository.findFirst({ where: { instanceId } });
         const remoteJid = data.remoteJid;
         const status = data.status;

         if (!remoteJid || !status) throw new Error('remoteJid e status são obrigatórios.');

         if (status === 'delete') {
             const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'evolution' } }); // Filtra por tipo
             this.logger.log(`Sessões EvolutionBot deletadas para ${remoteJid}: ${deleted.count}`);
             return { bot: { remoteJid, status } };
         }

         if (status === 'closed') {
             if (settings?.keepOpen) {
                 const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'evolution', status: { not: 'closed' } }, data: { status: 'closed' } });
                 this.logger.log(`Sessões EvolutionBot fechadas (mantidas) para ${remoteJid}: ${updated.count}`);
             } else {
                 const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'evolution' } });
                 this.logger.log(`Sessões EvolutionBot deletadas (keepOpen=false) para ${remoteJid}: ${deleted.count}`);
             }
             return { bot: { remoteJid, status } };
         } else { // open ou paused
             const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'evolution' }, data: { status: status } });
             this.logger.log(`Status da sessão EvolutionBot atualizado para "${status}" para ${remoteJid}: ${updated.count}`);
             return { bot: { remoteJid, status } };
         }
     } catch (error: any) {
         this.logger.error(error);
         throw new Error(`Erro ao alterar status da sessão EvolutionBot: ${error.message}`);
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
             if (!bot || bot.instanceId !== instanceId) throw new Error('Bot Evolution não encontrado ou não pertence a esta instância.');
        }

        const whereClause: Prisma.IntegrationSessionWhereInput = {
            instanceId: instanceId,
            remoteJid: remoteJid,
            botId: botId,
            type: 'evolution', // Filtra por tipo
        };
        if (!remoteJid) delete whereClause.remoteJid;
        if (!botId) delete whereClause.botId;

        return await this.sessionRepository.findMany({ where: whereClause });
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao buscar sessões EvolutionBot: ${error.message}`);
    }
}

public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto): Promise<{ ignoreJids: string[] }> {
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new Error(`Instância ${instance.instanceName} não encontrada.`);

        const settings = await this.settingsRepository.findFirst({ where: { instanceId } });
        if (!settings) throw new Error('Configurações EvolutionBot não encontradas.');

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

        return { ignoreJids: updateSettings.ignoreJids as string[] ?? [] }; // Faz cast de volta
    } catch (error: any) {
        this.logger.error(error);
        throw new Error(`Erro ao atualizar ignoreJids EvolutionBot: ${error.message}`);
    }
}


  // --- Emit ---
  public async emit({ instance, remoteJid, msg, pushName }: EmitData): Promise<void> {
    // EvolutionBot não é habilitado/desabilitado via .env, sempre tenta processar
    try {
       // Busca configurações EvolutionBot
       const settings = await this.fetchSettings(instance); // Usa fetchSettings corrigido
       if (!settings) { // Se settings for null (instância não encontrada no fetch)
           this.logger.warn(`Configurações EvolutionBot não encontradas para ${instance.instanceName} (emit), ignorando.`);
           return;
       }
       // Verifica ignoreJids
       if (this.checkIgnoreJids(settings?.ignoreJids ?? [], remoteJid)) return; // Usa checkIgnoreJids da base

       // Obtém sessão
       const session = await this.getSession(remoteJid, instance); // Usa getSession da base

       // Extrai conteúdo
       const content = getConversationMessage(msg);
       if (!content) {
            this.logger.debug(`Conteúdo vazio ou não extraído para ${remoteJid}, ignorando (EvolutionBot).`);
            return;
       }

       // Encontra bot (trigger ou fallback)
       let findBot = await this.findBotTrigger(this.botRepository, content, instance, session) as EvolutionBot | null;
       if (!findBot && settings?.botIdFallback) {
            findBot = await this.botRepository.findFirst({ where: { id: settings.botIdFallback } });
            if (findBot) this.logger.debug(`Usando bot Evolution de fallback (ID: ${findBot.id}) para ${remoteJid}`);
       }
       if (!findBot) {
            this.logger.debug(`Nenhum bot Evolution (gatilho ou fallback) encontrado para ${remoteJid}, ignorando.`);
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
           ignoreJids: (findBot.ignoreJids as string[] | null) ?? (settings.ignoreJids as string[] | null) ?? [], // Cast e fallback
           splitMessages: findBot.splitMessages ?? settings.splitMessages ?? false,
           timePerChar: findBot.timePerChar ?? settings.timePerChar ?? 0,
           botIdFallback: settings.botIdFallback, // Vem das settings gerais
       };

       const key = msg.key as { id: string; remoteJid: string; fromMe: boolean; participant: string };

       // Verifica stopBotFromMe
       if (finalSettings.stopBotFromMe && key.fromMe && session && session.status !== 'closed') {
           this.logger.info(`Mensagem própria recebida e stopBotFromMe ativo para ${remoteJid}. Pausando sessão EvolutionBot.`);
           await this.sessionRepository.update({ where: { id: session.id }, data: { status: 'paused' } });
           return;
       }

       // Verifica listeningFromMe
       if (!finalSettings.listeningFromMe && key.fromMe) {
           this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false, EvolutionBot)`);
           return;
       }

        // Verifica se a sessão aguarda input
       if (session && !session.awaitUser && session.status !== 'closed') {
           this.logger.debug(`Sessão EvolutionBot para ${remoteJid} não aguarda input do usuário, ignorando.`);
           return;
       }

       // Processa com ou sem debounce
       const waInstance = this.waMonitor.get(instance.instanceName);
       if (!waInstance) {
            this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor (EvolutionBot).`);
            return;
       }

       if (finalSettings.debounceTime && finalSettings.debounceTime > 0) {
           this.processDebounce(this.userMessageDebounce, content, remoteJid, finalSettings.debounceTime, async (debouncedContent) => {
               await this.evolutionBotService.processBot(waInstance, remoteJid, findBot!, session, finalSettings, debouncedContent, msg?.pushName);
           });
       } else {
           await this.evolutionBotService.processBot(waInstance, remoteJid, findBot!, session, finalSettings, content, msg?.pushName);
       }

    } catch (error: any) {
      this.logger.error(`Erro no método emit EvolutionBotController para ${remoteJid}: ${error.message}`, error.stack);
    }
  } // Fim emit
}
