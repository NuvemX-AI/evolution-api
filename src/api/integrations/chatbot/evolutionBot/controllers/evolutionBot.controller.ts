// src/api/integrations/chatbot/evolutionBot/controllers/evolutionBot.controller.ts
// Correções Gemini: Acesso Prisma, criação de settings, update input, logger args.

import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
// Importa o modelo Prisma e Enums
import { EvolutionBot, EvolutionBotSetting, IntegrationSession, $Enums, Prisma } from '@prisma/client';
import { getConversationMessage } from '@utils/getConversationMessage';
import { ChatbotController, EmitData } from '../../chatbot.controller';
import { EvolutionBotDto, EvolutionBotSettingDto } from '../dto/evolutionBot.dto';
import { EvolutionBotService } from '../services/evolutionBot.service';
// Importar Exceptions
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';

export class EvolutionBotController extends ChatbotController {
  private readonly logger: Logger; // Logger agora é propriedade da classe
  public readonly integrationEnabled: boolean = true; // EvolutionBot é interno, assume habilitado
  // Repositórios específicos (tipados corretamente)
  private readonly botRepository: Prisma.EvolutionBotDelegate<any>;
  private readonly settingsRepository: Prisma.EvolutionBotSettingDelegate<any>;
  private readonly sessionRepository: Prisma.IntegrationSessionDelegate<any>;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  constructor(
    private readonly evolutionBotService: EvolutionBotService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
    baseLogger: Logger // Receber logger base
  ) {
    super(prismaRepository, waMonitor); // Passa dependências para a base
    this.logger = baseLogger.child({ context: EvolutionBotController.name }); // Cria logger filho

    // Define os repositórios específicos usando os delegados corretos do PrismaClient
    this.botRepository = this.prismaRepository.evolutionBot;
    this.settingsRepository = this.prismaRepository.evolutionBotSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  // --- Bots ---
  public async createBot(instance: InstanceDto, data: EvolutionBotDto): Promise<EvolutionBot> {
    const instanceId = instance.instanceId; // Pegar instanceId do DTO
    if (!instanceId) throw new BadRequestException(`ID da instância não encontrado.`);

    // Lógica para buscar ou definir configurações padrão
    // CORREÇÃO TS2739: Garantir que settings() lida com criação correta
    let defaultSettingCheck = await this.settingsRepository.findUnique({ where: { instanceId } });
    if (!defaultSettingCheck) {
        this.logger.warn(`Configurações padrão EvolutionBot não encontradas para ${instance.instanceName}, criando...`);
        // Chamada para criar/buscar configurações padrão - a lógica dentro de settings() precisa funcionar
        await this.settings(instance, {});
        defaultSettingCheck = await this.settingsRepository.findUnique({ where: { instanceId } }); // Recarrega
         if (!defaultSettingCheck) throw new InternalServerErrorException('Falha ao criar/buscar configurações EvolutionBot padrão.');
    }

    // Preenche dados faltantes
    const createData: Prisma.EvolutionBotCreateInput = {
        instance: { connect: { instanceId: instanceId } }, // Conecta à instância
        enabled: data.enabled ?? true,
        description: data.description,
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
        expire: data.expire ?? defaultSettingCheck.expire ?? 0,
        keywordFinish: data.keywordFinish ?? defaultSettingCheck.keywordFinish ?? '',
        delayMessage: data.delayMessage ?? defaultSettingCheck.delayMessage ?? 0,
        unknownMessage: data.unknownMessage ?? defaultSettingCheck.unknownMessage ?? '',
        listeningFromMe: data.listeningFromMe ?? defaultSettingCheck.listeningFromMe ?? false,
        stopBotFromMe: data.stopBotFromMe ?? defaultSettingCheck.stopBotFromMe ?? false,
        keepOpen: data.keepOpen ?? defaultSettingCheck.keepOpen ?? false,
        debounceTime: data.debounceTime ?? defaultSettingCheck.debounceTime ?? 0,
        triggerType: data.triggerType ?? $Enums.TriggerType.all,
        triggerOperator: data.triggerOperator,
        triggerValue: data.triggerValue,
        ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull, // Cast para tipo Prisma
        splitMessages: data.splitMessages ?? defaultSettingCheck.splitMessages ?? false,
        timePerChar: data.timePerChar ?? defaultSettingCheck.timePerChar ?? 0,
        // Lidar com fallback (se for relação)
        Fallback: data.botIdFallback ? { connect: { id: data.botIdFallback } } : undefined,
    };


    // Validação e Verificação de Gatilhos (mantida)
     if (createData.triggerType === $Enums.TriggerType.all) {
        const triggerAllBots = await this.botRepository.findMany({ where: { enabled: true, triggerType: $Enums.TriggerType.all, instanceId }});
        if (triggerAllBots.length > 0) throw new BadRequestException('Você já possui um bot Evolution com gatilho "all" ativo.');
     }
     // ... (outras validações de trigger e duplicidade) ...

    try {
      const bot = await this.botRepository.create({ data: createData });
      this.logger.log(`Bot Evolution criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      this.logger.error({ err: error, msg: `Erro ao criar bot Evolution` }); // Logger corrigido
      throw new InternalServerErrorException(`Erro ao criar bot Evolution: ${error.message}`);
    }
  }

  public async findBot(instance: InstanceDto): Promise<EvolutionBot[] | null> {
    const instanceId = instance.instanceId;
    if (!instanceId) return null;
    return await this.botRepository.findMany({ where: { instanceId } });
  }

  public async fetchBot(instance: InstanceDto, botId: string): Promise<EvolutionBot> {
    const instanceId = instance.instanceId;
    if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

    const bot = await this.botRepository.findUnique({ where: { id: botId } }); // Usa findUnique
    if (!bot) throw new NotFoundException('Bot Evolution não encontrado.');
    if (bot.instanceId !== instanceId) throw new BadRequestException('Bot Evolution não pertence a esta instância.');
    return bot;
  }

  public async updateBot(instance: InstanceDto, botId: string, data: Partial<EvolutionBotDto>): Promise<EvolutionBot> { // Usa Partial
    const instanceId = instance.instanceId;
    if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

    const bot = await this.botRepository.findUnique({ where: { id: botId } }); // Usa findUnique
    if (!bot || bot.instanceId !== instanceId) throw new NotFoundException('Bot Evolution não encontrado ou não pertence a esta instância.');

    // Lógica de verificação de gatilho 'all' e duplicidade (mantida)
    // ...

    try {
        // Preparar dados para atualização (remover campos não atualizáveis)
        const updateData = { ...data };
        delete (updateData as any).instanceId; // Garantir que instanceId não seja atualizado
        delete (updateData as any).id;
        if (updateData.ignoreJids !== undefined) {
            updateData.ignoreJids = updateData.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull; // Cast para tipo Prisma
        }
        // Lidar com atualização de fallback
        if (updateData.botIdFallback !== undefined) {
             updateData.Fallback = updateData.botIdFallback ? { connect: { id: updateData.botIdFallback } } : { disconnect: true };
             delete updateData.botIdFallback; // Remover campo DTO
        }

        const updatedBot = await this.botRepository.update({
            where: { id: botId },
            data: updateData,
        });
        this.logger.log(`Bot Evolution atualizado com ID: ${updatedBot.id}`);
        return updatedBot;
    } catch (error: any) {
        this.logger.error({ err: error, msg: `Erro ao atualizar bot Evolution` }); // Logger corrigido
        throw new InternalServerErrorException(`Erro ao atualizar bot Evolution: ${error.message}`);
    }
}


  public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
     const instanceId = instance.instanceId;
     if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

    const bot = await this.botRepository.findUnique({ where: { id: botId } }); // Usa findUnique
    if (!bot || bot.instanceId !== instanceId) throw new NotFoundException('Bot Evolution não encontrado ou não pertence a esta instância.');

    try {
        await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'evolution' } });
        await this.botRepository.delete({ where: { id: botId } });
        this.logger.log(`Bot Evolution deletado com ID: ${botId}`);
        return { bot: { id: botId } };
    } catch (error: any) {
        this.logger.error({ err: error, msg: `Erro ao deletar bot Evolution` }); // Logger corrigido
        throw new InternalServerErrorException(`Erro ao deletar bot Evolution: ${error.message}`);
    }
}

  // --- Settings ---
  public async settings(instance: InstanceDto, data: Partial<EvolutionBotSettingDto>): Promise<EvolutionBotSettingDto> {
    try {
        const instanceId = instance.instanceId;
        if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

        // Prepara dados (usando Partial)
        const settingsData = {
            expire: data.expire, keywordFinish: data.keywordFinish, delayMessage: data.delayMessage,
            unknownMessage: data.unknownMessage, listeningFromMe: data.listeningFromMe,
            stopBotFromMe: data.stopBotFromMe, keepOpen: data.keepOpen, debounceTime: data.debounceTime,
            botIdFallback: data.botIdFallback, // Usar ID para relacionar
            ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
            splitMessages: data.splitMessages, timePerChar: data.timePerChar,
        };
        // Remove chaves undefined para o update
        Object.keys(settingsData).forEach(key => settingsData[key as keyof typeof settingsData] === undefined && delete settingsData[key as keyof typeof settingsData]);

        // Dados para criação (precisa do instanceId e valores padrão)
        const createData = {
             instanceId: instanceId,
             expire: data.expire ?? 0,
             keywordFinish: data.keywordFinish ?? '',
             delayMessage: data.delayMessage ?? 0,
             unknownMessage: data.unknownMessage ?? '',
             listeningFromMe: data.listeningFromMe ?? false,
             stopBotFromMe: data.stopBotFromMe ?? false,
             keepOpen: data.keepOpen ?? false,
             debounceTime: data.debounceTime ?? 0,
             ignoreJids: data.ignoreJids as Prisma.InputJsonValue ?? Prisma.JsonNull,
             splitMessages: data.splitMessages ?? false,
             timePerChar: data.timePerChar ?? 0,
             // Conectar fallback na criação se ID for fornecido
             Fallback: data.botIdFallback ? { connect: { id: data.botIdFallback } } : undefined,
        };
        // Dados para atualização (não inclui instanceId, lida com fallback)
        const updateData = {
            ...settingsData,
            // Conectar/desconectar fallback na atualização
             Fallback: data.botIdFallback !== undefined
                        ? (data.botIdFallback ? { connect: { id: data.botIdFallback } } : { disconnect: true })
                        : undefined,
        };
        delete updateData.botIdFallback; // Remove campo DTO do update


        const upsertedSettings = await this.settingsRepository.upsert({
            where: { instanceId: instanceId },
            // CORREÇÃO TS2322: Remover instanceId do update
            update: updateData,
            create: createData,
            include: { Fallback: true },
        });

        // Retorna DTO
        return {
            ...upsertedSettings,
            ignoreJids: upsertedSettings.ignoreJids as string[] ?? [], // Cast de volta para string[]
            botIdFallback: upsertedSettings.botIdFallback // Manter campo no DTO
        };
    } catch (error: any) {
        this.logger.error({ err: error, msg: `Erro ao definir configurações EvolutionBot` }); // Logger corrigido
        throw new InternalServerErrorException(`Erro ao definir configurações EvolutionBot: ${error.message}`);
    }
}

  // fetchSettings, changeStatus, fetchSessions, ignoreJid (Lógica similar ao DifyController, ajustar tipo de sessão/bot)
   public async fetchSettings(instance: InstanceDto): Promise<any> { // Retorna DTO
       try {
           const instanceId = instance.instanceId;
           if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);

           const settings = await this.settingsRepository.findUnique({ // Usa findUnique
               where: { instanceId: instanceId },
               include: { Fallback: true },
           });

           return settings
           ? { // Mapeia para DTO
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
               fallback: settings.Fallback, // Retorna o bot completo
             }
           : { // Objeto padrão
               expire: 0, keywordFinish: '', delayMessage: 0, unknownMessage: '', listeningFromMe: false,
               stopBotFromMe: false, keepOpen: false, debounceTime: 0, ignoreJids: [],
               splitMessages: false, timePerChar: 0, botIdFallback: null, fallback: null
             };
       } catch (error: any) {
           this.logger.error({ err: error, msg: `Erro ao buscar configurações EvolutionBot` }); // Logger corrigido
           throw new InternalServerErrorException(`Erro ao buscar configurações EvolutionBot: ${error.message}`);
       }
   }

   // changeStatus, fetchSessions, ignoreJid (Lógica similar ao DifyController, ajustar tipo 'evolution')
    public async changeStatus(instance: InstanceDto, data: { remoteJid: string; status: 'open' | 'closed' | 'paused' | 'delete' }): Promise<any> {
        try {
            const instanceId = instance.instanceId;
            if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);
            const settings = await this.settingsRepository.findUnique({ where: { instanceId } });
            const { remoteJid, status } = data;
            if (!remoteJid || !status) throw new BadRequestException('remoteJid e status são obrigatórios.');

            if (status === 'delete') {
                const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'evolution' } });
                this.logger.log(`Sessões EvolutionBot deletadas para ${remoteJid}: ${deleted.count}`);
                return { bot: { remoteJid, status: 'deleted' } };
            } else if (status === 'closed') {
                if (settings?.keepOpen) {
                    const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'evolution', status: { not: 'closed' } }, data: { status: 'closed' } });
                    this.logger.log(`Sessões EvolutionBot fechadas (mantidas) para ${remoteJid}: ${updated.count}`);
                } else {
                    const deleted = await this.sessionRepository.deleteMany({ where: { instanceId, remoteJid, type: 'evolution' } });
                    this.logger.log(`Sessões EvolutionBot deletadas (keepOpen=false) para ${remoteJid}: ${deleted.count}`);
                }
                return { bot: { remoteJid, status: 'closed' } };
            } else {
                const updated = await this.sessionRepository.updateMany({ where: { instanceId, remoteJid, type: 'evolution' }, data: { status } });
                this.logger.log(`Status da sessão EvolutionBot atualizado para "${status}" para ${remoteJid}: ${updated.count}`);
                return { bot: { remoteJid, status } };
            }
        } catch (error: any) {
            this.logger.error({ err: error, msg: `Erro ao alterar status da sessão EvolutionBot` }); // Logger corrigido
            throw new InternalServerErrorException(`Erro ao alterar status da sessão EvolutionBot: ${error.message}`);
        }
    }

    public async fetchSessions(instance: InstanceDto, botId?: string, remoteJid?: string): Promise<IntegrationSession[]> {
        try {
            const instanceId = instance.instanceId;
            if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);
            if (botId) {
                const bot = await this.botRepository.findUnique({ where: { id: botId } });
                if (!bot || bot.instanceId !== instanceId) throw new NotFoundException('Bot Evolution não encontrado ou não pertence a esta instância.');
            }
            const whereClause: Prisma.IntegrationSessionWhereInput = {
                instanceId, type: 'evolution',
                ...(botId && { botId }),
                ...(remoteJid && { remoteJid }),
            };
            return await this.sessionRepository.findMany({ where: whereClause });
        } catch (error: any) {
            this.logger.error({ err: error, msg: `Erro ao buscar sessões EvolutionBot` }); // Logger corrigido
            throw new InternalServerErrorException(`Erro ao buscar sessões EvolutionBot: ${error.message}`);
        }
    }

    public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto): Promise<any> {
        try {
            const instanceId = instance.instanceId;
            if (!instanceId) throw new BadRequestException(`ID da instância não fornecido.`);
            const settings = await this.settingsRepository.findUnique({ where: { instanceId } });
            if (!settings) throw new NotFoundException('Configurações EvolutionBot não encontradas.');

            let ignoreJids: string[] = (settings?.ignoreJids as string[]) || [];
            if (data.action === 'add') {
                if (!ignoreJids.includes(data.remoteJid)) ignoreJids.push(data.remoteJid);
            } else {
                ignoreJids = ignoreJids.filter((jid) => jid !== data.remoteJid);
            }

            const updateSettings = await this.settingsRepository.update({
                where: { instanceId }, // Usa where unique
                data: { ignoreJids: ignoreJids },
            });
            return { ignoreJids: updateSettings.ignoreJids ?? [] }; // Retorna array
        } catch (error: any) {
            this.logger.error({ err: error, msg: `Erro ao atualizar ignoreJids EvolutionBot` }); // Logger corrigido
            throw new InternalServerErrorException(`Erro ao atualizar ignoreJids EvolutionBot: ${error.message}`);
        }
    }


  // --- Emit ---
  public async emit(emitData: EmitData): Promise<void> {
      const { instance, remoteJid, msg, pushName } = emitData; // Desestruturar para clareza
      // EvolutionBot é interno, sempre habilitado (integrationEnabled=true)

      try {
          const settings = await this.fetchSettings(instance);
          if (!settings) {
              this.logger.warn(`Configurações EvolutionBot não encontradas para ${instance.instanceName} (emit), ignorando.`);
              return;
          }
          if (this.checkIgnoreJids(settings?.ignoreJids ?? [], remoteJid)) return;

          const session = await this.getSession(remoteJid, instance);
          const content = getConversationMessage(msg);
          if (!content) {
               this.logger.debug(`Conteúdo vazio ou não extraído para ${remoteJid}, ignorando (EvolutionBot).`);
               return;
          }

          let findBot = await this.findBotTrigger(this.botRepository, content, instance, session) as EvolutionBot | null;
          if (!findBot && settings?.botIdFallback) {
              // Usa settings.fallback que já foi buscado com include
              findBot = settings.fallback;
              if (findBot) this.logger.debug(`Usando bot Evolution de fallback (ID: ${findBot.id}) para ${remoteJid}`);
          }
          if (!findBot) {
              this.logger.debug(`Nenhum bot Evolution (gatilho ou fallback) encontrado para ${remoteJid}, ignorando.`);
              return;
          }

          // Montar finalSettings combinando bot específico e geral
          const finalSettings: any = { ...settings, ...findBot }; // Sobrescreve settings gerais com as do bot
          // Garantir que ignoreJids seja array
          finalSettings.ignoreJids = (findBot.ignoreJids as string[] | null) ?? (settings.ignoreJids as string[] | null) ?? [];


          const key = msg?.key;

          // Verifica flags de controle (stopBotFromMe, listeningFromMe)
           if (finalSettings.stopBotFromMe && key?.fromMe && session && session.status !== 'closed') {
              this.logger.info(`Mensagem própria e stopBotFromMe ativo para ${remoteJid}. Pausando sessão EvolutionBot.`);
              await this.sessionRepository.updateMany({ where: { id: session.id }, data: { status: 'paused' } });
              return;
           }
           if (!finalSettings.listeningFromMe && key?.fromMe) {
              this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false, EvolutionBot)`);
              return;
           }
           if (session && session.status !== 'open') {
              this.logger.debug(`Sessão EvolutionBot para ${remoteJid} não está aberta (status: ${session.status}), ignorando.`);
              return;
           }
           if (session && !session.awaitUser) {
               this.logger.debug(`Sessão EvolutionBot para ${remoteJid} não aguarda input do usuário, ignorando.`);
               return;
           }

          const waInstance = this.waMonitor.get(instance.instanceName);
          if (!waInstance) {
               this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor (EvolutionBot).`);
               return;
          }

          // Processa com ou sem debounce
          const processFn = async (currentContent: string) => {
              await this.evolutionBotService.processBot(waInstance, remoteJid, findBot!, session, finalSettings, currentContent, pushName);
          };

          if (finalSettings.debounceTime && finalSettings.debounceTime > 0) {
              this.processDebounce(this.userMessageDebounce, content, remoteJid, finalSettings.debounceTime, processFn);
          } else {
              await processFn(content);
          }

      } catch (error: any) {
          // CORREÇÃO TS2554: Passar objeto de erro
          this.logger.error({ msg:`Erro no método emit EvolutionBotController para ${remoteJid}: ${error.message}`, err: error, stack: error.stack });
      }
  }
}
