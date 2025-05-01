// src/api/integrations/chatbot/openai/controllers/openai.controller.ts

import { IgnoreJidDto } from '@api/dto/chatbot.dto'; // Ajustado caminho relativo/alias
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { ConfigService, Openai } from '@config/env.config'; // Assume alias
import { Logger } from '@config/logger.config'; // Assume alias
import { BadRequestException, InternalServerErrorException } from '@exceptions'; // Assume alias
// Importa tipos Prisma necessários
import { OpenaiBot, OpenaiCreds, OpenaiSetting, IntegrationSession, $Enums, Prisma } from '@prisma/client';
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { getConversationMessage } from '@utils/getConversationMessage'; // Assume alias

// << CORREÇÃO TS2305: Remover ChatbotControllerInterface (não existe) >>
import { ChatbotController, EmitData } from '../../chatbot.controller';
import { OpenaiBotDto, OpenaiCredsDto, OpenaiSettingDto } from '../dto/openai.dto'; // Assume DTOs existem
import { OpenaiService } from '../services/openai.service'; // Assume serviço existe

// << CORREÇÃO TS2305: Remover implementação da interface >>
export class OpenaiController extends ChatbotController {
  constructor(
    private readonly openaiService: OpenaiService, // Serviço específico injetado
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor); // Passa dependências para a base

    // Define os repositórios específicos
    this.botRepository = this.prismaRepository.openaiBot;
    this.settingsRepository = this.prismaRepository.openaiSetting; // Ajustado para OpenaiSetting
    this.sessionRepository = this.prismaRepository.integrationSession;
    // Adiciona repositório de credenciais
    this.credsRepository = this.prismaRepository.openaiCreds;
  }

  public readonly logger = new Logger('OpenaiController'); // Usa Logger importado
  // << CORREÇÃO: Usar configService injetado/herdado ou importado global >>
  integrationEnabled = configService.get<Openai>('OPENAI')?.ENABLED ?? false; // Usa configService global
  botRepository: PrismaRepository['openaiBot']; // Tipo Prisma correto
  settingsRepository: PrismaRepository['openaiSetting']; // Tipo Prisma correto
  sessionRepository: PrismaRepository['integrationSession']; // Tipo Prisma correto
  credsRepository: PrismaRepository['openaiCreds']; // Repositório para credenciais
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // --- Bots ---
  public async createBot(instance: InstanceDto, data: OpenaiBotDto): Promise<OpenaiBot> {
    if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');

    const instanceId = await this.prismaRepository.prisma.instance
        .findFirst({ where: { name: instance.instanceName } })
        .then((inst) => inst?.id);
    if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada no DB.`);

    // Verifica se credsId foi fornecido e existe
    if (!data.credsId) throw new BadRequestException('O ID das credenciais (credsId) é obrigatório.');
    const credsExist = await this.credsRepository.findUnique({ where: { id: data.credsId } });
    if (!credsExist) throw new BadRequestException(`Credenciais OpenAI com ID ${data.credsId} não encontradas.`);

    // Lógica para buscar ou definir configurações padrão
    let defaultSettingCheck = await this.settingsRepository.findFirst({ where: { instanceId } });
    if (!defaultSettingCheck) {
        this.logger.warn(`Configurações padrão OpenAI não encontradas para ${instance.instanceName}, criando...`);
        // Cria configurações padrão (precisa de um DTO para settings)
        const defaultSettingsDto: Partial<OpenaiSettingDto> = {}; // DTO vazio para criar padrão
        defaultSettingCheck = await this.settings(instance, defaultSettingsDto);
    }
    // Preenche dados faltantes no bot DTO com os padrões
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
    data.model = data.model ?? defaultSettingCheck?.model ?? undefined;
    data.maxTokens = data.maxTokens ?? defaultSettingCheck?.maxTokens ?? undefined;
    data.temperature = data.temperature ?? defaultSettingCheck?.temperature ?? undefined;
    data.prompt = data.prompt ?? defaultSettingCheck?.prompt ?? undefined;
    data.speechToText = data.speechToText ?? defaultSettingCheck?.speechToText ?? false;


    // << CORREÇÃO TS2367: Usar Enum Prisma >>
    const triggerAllBots = await this.botRepository.findMany({
        where: { enabled: true, triggerType: $Enums.TriggerType.all, instanceId },
    });
    if (data.triggerType === $Enums.TriggerType.all && triggerAllBots.length > 0) {
        throw new BadRequestException('Você já possui um bot OpenAI com gatilho "all" ativo.');
    }

    // Verifica duplicidade de nome (ou outro identificador único do bot OpenAI)
    const checkDuplicateName = await this.botRepository.findFirst({
        where: { instanceId, name: data.name },
    });
    if (checkDuplicateName) {
        throw new BadRequestException(`Já existe um bot OpenAI com o nome "${data.name}".`);
    }

    // Validação e Verificação de Gatilhos Duplicados
    if (data.triggerType === $Enums.TriggerType.keyword) { // Usa Enum
        if (!data.triggerOperator || !data.triggerValue) throw new BadRequestException('Operador e Valor são obrigatórios para gatilho "keyword".');
        const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, instanceId } });
        if (checkDuplicateTrigger) throw new BadRequestException(`Gatilho "keyword" duplicado: ${data.triggerOperator} ${data.triggerValue}`);
    } else if (data.triggerType === $Enums.TriggerType.advanced) { // Usa Enum
        if (!data.triggerValue) throw new Error('Valor é obrigatório para gatilho "advanced".');
        const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, instanceId } });
        if (checkDuplicateTrigger) throw new BadRequestException(`Gatilho "advanced" duplicado: ${data.triggerValue}`);
    }

    try {
      const bot = await this.botRepository.create({
        data: {
            ...data,
            instanceId: instanceId,
            credsId: data.credsId, // Garante que credsId está presente
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
        },
      });
      this.logger.log(`Bot OpenAI criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      this.logger.error(error);
      // Verifica erro de constraint único se aplicável
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
           throw new BadRequestException(`Erro ao criar bot OpenAI: Um campo único já existe (${error.meta?.target})`);
      }
      throw new InternalServerErrorException(`Erro ao criar bot OpenAI: ${error.message}`);
    }
  }

  // --- findBot, fetchBot, updateBot, deleteBot (Lógica similar, adaptada para OpenAI) ---
    public async findBot(instance: InstanceDto): Promise<OpenaiBot[] | null> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) return null;
        return await this.botRepository.findMany({ where: { instanceId }, include: { creds: true } }); // Inclui credenciais
    }

    public async fetchBot(instance: InstanceDto, botId: string): Promise<OpenaiBot> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId }, include: { creds: true } }); // Inclui credenciais
        if (!bot) throw new BadRequestException('Bot OpenAI não encontrado.');
        if (bot.instanceId !== instanceId) throw new BadRequestException('Bot OpenAI não pertence a esta instância.');
        return bot;
    }

    public async updateBot(instance: InstanceDto, botId: string, data: OpenaiBotDto): Promise<OpenaiBot> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot || bot.instanceId !== instanceId) throw new BadRequestException('Bot OpenAI não encontrado ou não pertence a esta instância.');

        // Verifica se credsId foi alterado e se o novo existe
        if (data.credsId && data.credsId !== bot.credsId) {
            const credsExist = await this.credsRepository.findUnique({ where: { id: data.credsId } });
            if (!credsExist) throw new BadRequestException(`Credenciais OpenAI com ID ${data.credsId} não encontradas.`);
        }

        // Lógica de verificação de gatilho 'all' e duplicidade
        if (data.triggerType === $Enums.TriggerType.all) {
            const checkTriggerAll = await this.botRepository.findFirst({ where: { enabled: true, triggerType: $Enums.TriggerType.all, id: { not: botId }, instanceId } });
            if (checkTriggerAll) throw new BadRequestException('Já existe outro bot OpenAI com gatilho "all" ativo.');
        }
         // ... verificações de duplicidade para keyword/advanced/nome ...
         if (data.triggerType === $Enums.TriggerType.keyword) {
             if (!data.triggerOperator || !data.triggerValue) throw new BadRequestException('Operator/Value required for keyword trigger.');
             const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
             if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate keyword trigger: ${data.triggerOperator} ${data.triggerValue}`);
         } else if (data.triggerType === $Enums.TriggerType.advanced) {
             if (!data.triggerValue) throw new BadRequestException('Value required for advanced trigger.');
             const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
             if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate advanced trigger: ${data.triggerValue}`);
         }
         if (data.name && data.name !== bot.name) {
             const checkDuplicateName = await this.botRepository.findFirst({ where: { id: { not: botId }, instanceId, name: data.name } });
             if (checkDuplicateName) throw new BadRequestException(`Já existe um bot OpenAI com o nome "${data.name}".`);
         }


        try {
            const updatedBot = await this.botRepository.update({
                where: { id: botId },
                data: {
                    ...data,
                    instanceId: undefined,
                    id: undefined,
                    ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
                    // Não permitir alterar instanceId ou id
                },
            });
            this.logger.log(`Bot OpenAI atualizado com ID: ${updatedBot.id}`);
            return updatedBot;
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao atualizar bot OpenAI: ${error.message}`);
        }
    }

     public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
         const instanceId = await this.prismaRepository.prisma.instance
             .findFirst({ where: { name: instance.instanceName } })
             .then((inst) => inst?.id);
         if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot || bot.instanceId !== instanceId) throw new BadRequestException('Bot OpenAI não encontrado ou não pertence a esta instância.');

        try {
            await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'openai' } });
            await this.botRepository.delete({ where: { id: botId } });
            this.logger.log(`Bot OpenAI deletado com ID: ${botId}`);
            return { bot: { id: botId } };
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao deletar bot OpenAI: ${error.message}`);
        }
    }


  // --- Settings ---
  public async settings(instance: InstanceDto, data: Partial<OpenaiSettingDto>): Promise<OpenaiSettingDto> {
    if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const settingsData = {
            expire: data.expire,
            keywordFinish: data.keywordFinish,
            delayMessage: data.delayMessage,
            unknownMessage: data.unknownMessage,
            listeningFromMe: data.listeningFromMe,
            stopBotFromMe: data.stopBotFromMe,
            keepOpen: data.keepOpen,
            debounceTime: data.debounceTime,
            botIdFallback: data.openaiIdFallback, // Nome correto para OpenAI
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
            splitMessages: data.splitMessages,
            timePerChar: data.timePerChar,
            model: data.model, // Configurações específicas OpenAI
            maxTokens: data.maxTokens,
            temperature: data.temperature,
            prompt: data.prompt,
            speechToText: data.speechToText,
            instanceId: instanceId, // Para create
        };
        Object.keys(settingsData).forEach(key => settingsData[key] === undefined && delete settingsData[key]);

        const upsertedSettings = await this.settingsRepository.upsert({
            where: { instanceId: instanceId },
            update: { ...settingsData, instanceId: undefined },
            create: settingsData as any,
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
            openaiIdFallback: upsertedSettings.botIdFallback, // Nome correto
            ignoreJids: upsertedSettings.ignoreJids as string[] ?? [],
            splitMessages: upsertedSettings.splitMessages,
            timePerChar: upsertedSettings.timePerChar,
            model: upsertedSettings.model,
            maxTokens: upsertedSettings.maxTokens,
            temperature: upsertedSettings.temperature,
            prompt: upsertedSettings.prompt,
            speechToText: upsertedSettings.speechToText,
        };
    } catch (error: any) {
        this.logger.error(error);
        throw new InternalServerErrorException(`Erro ao definir configurações OpenAI: ${error.message}`);
    }
}

  public async fetchSettings(instance: InstanceDto): Promise<OpenaiSettingDto & { fallback: OpenaiBot | null }> {
     if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

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
            openaiIdFallback: settings.botIdFallback, // Nome correto
            ignoreJids: settings.ignoreJids as string[] ?? [],
            splitMessages: settings.splitMessages,
            timePerChar: settings.timePerChar,
            model: settings.model,
            maxTokens: settings.maxTokens,
            temperature: settings.temperature,
            prompt: settings.prompt,
            speechToText: settings.speechToText,
            fallback: settings.Fallback,
          }
        : { // Objeto padrão
            expire: 0, keywordFinish: '', delayMessage: 0, unknownMessage: '', listeningFromMe: false,
            stopBotFromMe: false, keepOpen: false, debounceTime: 0, ignoreJids: [],
            splitMessages: false, timePerChar: 0, openaiIdFallback: null, fallback: null,
            model: null, maxTokens: null, temperature: null, prompt: null, speechToText: false
          };
    } catch (error: any) {
        this.logger.error(error);
        throw new InternalServerErrorException(`Erro ao buscar configurações OpenAI: ${error.message}`);
    }
}


  // --- Sessions ---
  // changeStatus, fetchSessions, ignoreJid (Lógica similar aos outros controllers)
  public async changeStatus(instance: InstanceDto, data: { remoteJid: string; status: 'open' | 'closed' | 'paused' | 'delete' }): Promise<any> {
    if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
    try {
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const settings = await this.settingsRepository?.findFirst({ where: { instanceId } });
        const remoteJid = data.remoteJid;
        const status = data.status;

        if (!remoteJid || !status) throw new BadRequestException('remoteJid e status são obrigatórios.');

        if (status === 'delete') {
            const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'openai' } });
            this.logger.log(`Sessões OpenAI deletadas para ${remoteJid}: ${deleted.count}`);
            return { bot: { remoteJid, status } };
        }

        if (status === 'closed') {
            if (settings?.keepOpen) {
                const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'openai', status: { not: 'closed' } }, data: { status: 'closed' } });
                this.logger.log(`Sessões OpenAI fechadas (mantidas) para ${remoteJid}: ${updated.count}`);
            } else {
                const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'openai' } });
                this.logger.log(`Sessões OpenAI deletadas (keepOpen=false) para ${remoteJid}: ${deleted.count}`);
            }
            return { bot: { remoteJid, status } };
        } else { // open ou paused
            const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'openai' }, data: { status: status } });
            this.logger.log(`Status da sessão OpenAI atualizado para "${status}" para ${remoteJid}: ${updated.count}`);
            return { bot: { remoteJid, status } };
        }
    } catch (error: any) {
        this.logger.error(error);
        throw new InternalServerErrorException(`Erro ao alterar status da sessão OpenAI: ${error.message}`);
    }
}

public async fetchSessions(instance: InstanceDto, botId?: string, remoteJid?: string): Promise<IntegrationSession[]> {
   if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
   try {
       const instanceId = await this.prismaRepository.prisma.instance
           .findFirst({ where: { name: instance.instanceName } })
           .then((inst) => inst?.id);
       if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

       if (botId) {
            const bot = await this.botRepository.findFirst({ where: { id: botId } });
            if (!bot || bot.instanceId !== instanceId) throw new BadRequestException('Bot OpenAI não encontrado ou não pertence a esta instância.');
       }

       const whereClause: Prisma.IntegrationSessionWhereInput = {
           instanceId: instanceId,
           remoteJid: remoteJid,
           botId: botId,
           type: 'openai', // Filtra por tipo
       };
       if (!remoteJid) delete whereClause.remoteJid;
       if (!botId) delete whereClause.botId;

       return await this.sessionRepository.findMany({ where: whereClause });
   } catch (error: any) {
       this.logger.error(error);
       throw new InternalServerErrorException(`Erro ao buscar sessões OpenAI: ${error.message}`);
   }
}

public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto): Promise<{ ignoreJids: string[] }> {
    if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
   try {
       const instanceId = await this.prismaRepository.prisma.instance
           .findFirst({ where: { name: instance.instanceName } })
           .then((inst) => inst?.id);
       if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

       const settings = await this.settingsRepository.findFirst({ where: { instanceId } });
       if (!settings) throw new BadRequestException('Configurações OpenAI não encontradas.');

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
       throw new InternalServerErrorException(`Erro ao atualizar ignoreJids OpenAI: ${error.message}`);
   }
}


  // --- Emit ---
  public async emit({ instance, remoteJid, msg }: EmitData): Promise<void> {
    if (!this.integrationEnabled) return;
    try {
       // Busca configurações OpenAI
       const settings = await this.fetchSettings(instance);
       if (!settings) {
            this.logger.warn(`Configurações OpenAI não encontradas para ${instance.instanceName}, ignorando mensagem.`);
            return;
        }
       // Verifica ignoreJids
       if (this.checkIgnoreJids(settings?.ignoreJids ?? [], remoteJid)) return;

       // Obtém sessão
       const session = await this.getSession(remoteJid, instance);

       // Extrai conteúdo
       const content = getConversationMessage(msg);
        // Adiciona tratamento para áudio se speechToText estiver habilitado em algum bot
        const audioContent = msg?.message?.audioMessage ? msg : null; // Passa msg completa se for audio
        if (!content && !audioContent) {
            this.logger.debug(`Conteúdo de mensagem (texto/áudio) vazio ou não extraído para ${remoteJid}, ignorando (OpenAI).`);
            return;
       }

       // Encontra bot (trigger ou fallback)
       let findBot = await this.findBotTrigger(this.botRepository, content || 'audio', instance, session) as OpenaiBot | null; // Usa 'audio' como gatilho se for audio
       if (!findBot && settings?.openaiIdFallback) { // Nome correto para fallback
            findBot = await this.botRepository.findFirst({ where: { id: settings.openaiIdFallback } });
            if (findBot) this.logger.debug(`Usando bot OpenAI de fallback (ID: ${findBot.id}) para ${remoteJid}`);
       }
       if (!findBot || !findBot.enabled) {
            this.logger.debug(`Nenhum bot OpenAI ativo (gatilho ou fallback) encontrado para ${remoteJid}, ignorando.`);
            return;
       }

        // Verifica se a mensagem é de áudio e se o bot tem speechToText habilitado
        if (audioContent && !findBot.speechToText) {
             this.logger.debug(`Bot OpenAI ${findBot.id} não tem speechToText habilitado. Ignorando mensagem de áudio.`);
             return;
        }
        // Se não for áudio e não houver conteúdo de texto, ignora
        if (!audioContent && !content) {
            this.logger.debug(`Conteúdo de texto ausente e não é áudio para ${remoteJid}. Ignorando (OpenAI).`);
            return;
        }

       // Determina configurações finais (bot ou padrão)
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
           // Configs específicas OpenAI
           model: findBot.model ?? settings.model,
           maxTokens: findBot.maxTokens ?? settings.maxTokens,
           temperature: findBot.temperature ?? settings.temperature,
           prompt: findBot.prompt ?? settings.prompt,
           speechToText: findBot.speechToText ?? settings.speechToText ?? false,
           botType: findBot.botType,
           assistantId: findBot.assistantId,
           functionUrl: findBot.functionUrl,
           credsId: findBot.credsId, // Passa credsId para o serviço
           openaiIdFallback: settings.openaiIdFallback, // Nome correto
       };

       const key = msg.key as { id: string; remoteJid: string; fromMe: boolean; participant: string };

       // Verifica stopBotFromMe
       if (finalSettings.stopBotFromMe && key.fromMe && session && session.status !== 'closed') {
           this.logger.info(`Mensagem própria recebida e stopBotFromMe ativo para ${remoteJid}. Pausando sessão OpenAI.`);
           await this.sessionRepository.update({ where: { id: session.id }, data: { status: 'paused' } });
           return;
       }

       // Verifica listeningFromMe
       if (!finalSettings.listeningFromMe && key.fromMe) {
           this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false, OpenAI)`);
           return;
       }

        // Verifica se a sessão aguarda input
       if (session && !session.awaitUser && session.status !== 'closed') {
           this.logger.debug(`Sessão OpenAI para ${remoteJid} não aguarda input do usuário, ignorando.`);
           return;
       }

       // Processa com ou sem debounce
       const waInstance = this.waMonitor.get(instance.instanceName);
       if (!waInstance) {
            this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor (OpenAI).`);
            return;
       }

        // Usa 'audioContent' se existir, senão usa 'content'
        const contentToProcess = audioContent ? 'audio_message' : content!; // Sinaliza que é áudio ou usa texto

       if (finalSettings.debounceTime && finalSettings.debounceTime > 0 && !audioContent) { // Debounce só para texto?
           this.processDebounce(this.userMessageDebounce, contentToProcess, remoteJid, finalSettings.debounceTime, async (debouncedContent) => {
               await this.openaiService.processOpenai(waInstance, remoteJid, findBot!, session, finalSettings, debouncedContent, msg?.pushName);
           });
       } else {
            // Passa msg completa para áudio, ou content para texto
           await this.openaiService.processOpenai(waInstance, remoteJid, findBot!, session, finalSettings, audioContent || content, msg?.pushName);
       }

    } catch (error: any) {
      this.logger.error(`Erro no método emit OpenaiController para ${remoteJid}: ${error.message}`, error.stack);
    }
  } // Fim emit

    // --- Credenciais ---
    public async createCreds(data: OpenaiCredsDto): Promise<OpenaiCreds> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
        if (!data.apiKey) throw new BadRequestException('apiKey é obrigatório.');
        // Verifica duplicidade se necessário (ex: por nome)
        if (data.name) {
            const existing = await this.credsRepository.findFirst({ where: { name: data.name } });
            if (existing) throw new BadRequestException(`Credencial com nome "${data.name}" já existe.`);
        }
        try {
            const creds = await this.credsRepository.create({ data });
            this.logger.log(`Credenciais OpenAI criadas com ID: ${creds.id}`);
            return creds;
        } catch (error: any) {
            this.logger.error(`Erro ao criar credenciais OpenAI: ${error.message}`);
            throw new InternalServerErrorException('Erro ao criar credenciais.');
        }
    }

    public async findCreds(): Promise<OpenaiCreds[]> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
        return await this.credsRepository.findMany();
    }

    public async fetchCreds(credsId: string): Promise<OpenaiCreds> {
        if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
        const creds = await this.credsRepository.findUnique({ where: { id: credsId } });
        if (!creds) throw new BadRequestException('Credenciais OpenAI não encontradas.');
        return creds;
    }

     public async updateCreds(credsId: string, data: Partial<OpenaiCredsDto>): Promise<OpenaiCreds> {
         if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
         const creds = await this.credsRepository.findUnique({ where: { id: credsId } });
         if (!creds) throw new BadRequestException('Credenciais OpenAI não encontradas.');

         // Verifica duplicidade de nome se ele for alterado
         if (data.name && data.name !== creds.name) {
             const existing = await this.credsRepository.findFirst({ where: { name: data.name, id: { not: credsId } } });
             if (existing) throw new BadRequestException(`Credencial com nome "${data.name}" já existe.`);
         }

         try {
             const updatedCreds = await this.credsRepository.update({
                 where: { id: credsId },
                 data: {
                     name: data.name,
                     apiKey: data.apiKey,
                     // Não permitir alterar id ou timestamps
                 },
             });
             this.logger.log(`Credenciais OpenAI atualizadas com ID: ${updatedCreds.id}`);
             return updatedCreds;
         } catch (error: any) {
             this.logger.error(`Erro ao atualizar credenciais OpenAI: ${error.message}`);
             throw new InternalServerErrorException('Erro ao atualizar credenciais.');
         }
     }

     public async deleteCreds(credsId: string): Promise<{ id: string }> {
         if (!this.integrationEnabled) throw new BadRequestException('OpenAI Integration is disabled');
         const creds = await this.credsRepository.findUnique({ where: { id: credsId } });
         if (!creds) throw new BadRequestException('Credenciais OpenAI não encontradas.');

         // Verifica se as credenciais estão em uso por algum bot
         const botsUsingCreds = await this.botRepository.count({ where: { credsId: credsId } });
         if (botsUsingCreds > 0) {
             throw new BadRequestException(`Não é possível deletar as credenciais. Elas estão sendo usadas por ${botsUsingCreds} bot(s).`);
         }

         try {
             await this.credsRepository.delete({ where: { id: credsId } });
             this.logger.log(`Credenciais OpenAI deletadas com ID: ${credsId}`);
             return { id: credsId };
         } catch (error: any) {
             this.logger.error(`Erro ao deletar credenciais OpenAI: ${error.message}`);
             throw new InternalServerErrorException('Erro ao deletar credenciais.');
         }
     }

} // Fim da classe OpenaiController
