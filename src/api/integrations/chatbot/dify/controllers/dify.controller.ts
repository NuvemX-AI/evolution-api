// src/api/integrations/chatbot/dify/controllers/dify.controller.ts

import { IgnoreJidDto } from '@api/dto/chatbot.dto'; // Ajustado caminho relativo/alias
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
import { DifyDto } from '../dto/dify.dto';
import { DifyService } from '../services/dify.service';
import { PrismaRepository } from '@repository/repository.service'; // Ajustado caminho relativo/alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustado caminho relativo/alias
import { configService, Dify } from '@config/env.config'; // Assume alias
import { Logger } from '@config/logger.config'; // Assume alias
import { BadRequestException } from '@exceptions'; // Assume alias
import { Dify as DifyModel, IntegrationSession, $Enums } from '@prisma/client'; // Importa $Enums do Prisma
// << CORREÇÃO TS2307: Usar alias para importar utilitário >>
import { getConversationMessage } from '@utils/getConversationMessage';

// << CORREÇÃO TS2305: Remover ChatbotControllerInterface (não existe) >>
import { ChatbotController, EmitData } from '../../chatbot.controller'; // Importa apenas ChatbotController e EmitData

// << CORREÇÃO TS2305: Remover implementação da interface >>
export class DifyController extends ChatbotController {
  constructor(
    private readonly difyService: DifyService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor); // Passa dependências para a classe base

    // Define os repositórios específicos para este controller
    this.botRepository = this.prismaRepository.dify;
    this.settingsRepository = this.prismaRepository.difySetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  // Logger e propriedades específicas
  public readonly logger = new Logger('DifyController'); // Usa Logger importado
  // << CORREÇÃO: Usar configService injetado/herdado se disponível, ou importar global >>
  integrationEnabled = configService.get<Dify>('DIFY')?.ENABLED ?? false; // Usa configService importado globalmente
  botRepository: PrismaRepository['dify']; // Tipo Prisma correto
  settingsRepository: PrismaRepository['difySetting']; // Tipo Prisma correto
  sessionRepository: PrismaRepository['integrationSession']; // Tipo Prisma correto
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // Bots
  public async createBot(instance: InstanceDto, data: DifyDto): Promise<DifyModel> {
    if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');

    const instanceId = await this.prismaRepository.prisma.instance // Acessa via .prisma (ou método do repo)
      .findFirst({ where: { name: instance.instanceName } })
      .then((instanceDb) => instanceDb?.id);

    if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada no DB.`);

    // Lógica para buscar ou definir configurações padrão (mantida, mas verificar acesso ao repo)
    // NOTE: Acessando settingsRepository diretamente aqui
     let defaultSettingCheck = await this.settingsRepository?.findFirst({
         where: { instanceId: instanceId },
     });

     if (!defaultSettingCheck) {
         this.logger.warn(`Configurações padrão Dify não encontradas para ${instance.instanceName}, criando...`);
         // Cria configurações padrão se não existirem
         defaultSettingCheck = await this.settings(instance, {}); // Chama settings com objeto vazio para criar padrão
     }

     // Preenche dados faltantes com os padrões
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
    const triggerAllBots = await this.botRepository.findMany({ // Busca todos com 'all'
      where: {
        enabled: true,
        triggerType: $Enums.TriggerType.all, // Usando Enum Prisma
        // triggerType: 'all', // Manter se TriggerType for string literal
        instanceId: instanceId,
      },
    });

    // Permite criar 'all' apenas se não houver nenhum outro bot ativo do tipo 'all'
    if (data.triggerType === $Enums.TriggerType.all && triggerAllBots.length > 0) {
      throw new BadRequestException('Você já possui um bot Dify com gatilho "all" ativo. Desative-o para criar outro.');
    }

    // Verifica duplicidade de API Key/URL (mantida)
    const checkDuplicateAPI = await this.botRepository.findFirst({
      where: {
        instanceId: instanceId,
        botType: data.botType, // << CORREÇÃO: Assume que botType existe em DifyDto/Model >>
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
      },
    });
    if (checkDuplicateAPI) {
      throw new BadRequestException('Já existe um bot Dify com esta URL/API Key.');
    }

    // Validação e Verificação de Gatilhos Duplicados (keyword/advanced)
    if (data.triggerType === $Enums.TriggerType.keyword) { // Usando Enum Prisma
    // if (data.triggerType === 'keyword') { // Manter se for string literal
      if (!data.triggerOperator || !data.triggerValue) {
        throw new BadRequestException('Operador (triggerOperator) e Valor (triggerValue) são obrigatórios para o gatilho "keyword".');
      }
      const checkDuplicateTrigger = await this.botRepository.findFirst({
        where: {
          triggerType: $Enums.TriggerType.keyword,
          triggerOperator: data.triggerOperator,
          triggerValue: data.triggerValue,
          instanceId: instanceId,
        },
      });
      if (checkDuplicateTrigger) {
        throw new BadRequestException(`Gatilho "keyword" duplicado: ${data.triggerOperator} ${data.triggerValue}`);
      }
    } else if (data.triggerType === $Enums.TriggerType.advanced) { // Usando Enum Prisma
    // } else if (data.triggerType === 'advanced') { // Manter se for string literal
      if (!data.triggerValue) {
        throw new BadRequestException('Valor (triggerValue) é obrigatório para o gatilho "advanced".');
      }
       const checkDuplicateTrigger = await this.botRepository.findFirst({
        where: {
          triggerType: $Enums.TriggerType.advanced,
          triggerValue: data.triggerValue,
          instanceId: instanceId,
        },
      });
      if (checkDuplicateTrigger) {
         throw new BadRequestException(`Gatilho "advanced" duplicado: ${data.triggerValue}`);
      }
    }

    try {
      // Cria o bot (ajustado para usar os dados com fallback)
      const bot = await this.botRepository.create({
        data: {
          ...data, // Espalha os dados recebidos (com fallbacks aplicados)
          instanceId: instanceId, // Garante que instanceId correto seja usado
        },
      });
      this.logger.log(`Bot Dify criado com ID: ${bot.id}`);
      return bot;
    } catch (error: any) {
      this.logger.error(error);
      throw new InternalServerErrorException(`Erro ao criar bot Dify: ${error.message}`); // Usa InternalServerErrorException
    }
  }

  // findBot, fetchBot, updateBot, deleteBot (lógica mantida, verificar acesso ao repo)
    public async findBot(instance: InstanceDto): Promise<DifyModel[] | null> {
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) return null; // Retorna null se instância não existe

        const bots = await this.botRepository.findMany({ where: { instanceId: instanceId } });
        return bots; // Retorna array vazio se não houver bots
    }

    public async fetchBot(instance: InstanceDto, botId: string): Promise<DifyModel> {
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot) throw new BadRequestException('Bot Dify não encontrado.');
        if (bot.instanceId !== instanceId) throw new BadRequestException('Bot Dify não pertence a esta instância.');
        return bot;
    }

    public async updateBot(instance: InstanceDto, botId: string, data: DifyDto): Promise<DifyModel> {
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
        if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot || bot.instanceId !== instanceId) throw new BadRequestException('Bot Dify não encontrado ou não pertence a esta instância.');

        // Lógica de verificação de gatilho 'all' e duplicidade (mantida, com correção de tipo)
        if (data.triggerType === $Enums.TriggerType.all) {
            const checkTriggerAll = await this.botRepository.findFirst({
                where: {
                    enabled: true,
                    triggerType: $Enums.TriggerType.all,
                    id: { not: botId },
                    instanceId: instanceId,
                },
            });
            if (checkTriggerAll) {
                throw new BadRequestException('Já existe outro bot Dify com gatilho "all" ativo.');
            }
        }
        // ... (verificações de duplicidade para keyword e advanced mantidas, usando Enum) ...
         if (data.triggerType === $Enums.TriggerType.keyword) {
             if (!data.triggerOperator || !data.triggerValue) throw new BadRequestException('Operator/Value required for keyword trigger.');
             const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.keyword, triggerOperator: data.triggerOperator, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
             if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate keyword trigger: ${data.triggerOperator} ${data.triggerValue}`);
         } else if (data.triggerType === $Enums.TriggerType.advanced) {
             if (!data.triggerValue) throw new BadRequestException('Value required for advanced trigger.');
             const checkDuplicateTrigger = await this.botRepository.findFirst({ where: { triggerType: $Enums.TriggerType.advanced, triggerValue: data.triggerValue, id: { not: botId }, instanceId } });
             if (checkDuplicateTrigger) throw new BadRequestException(`Duplicate advanced trigger: ${data.triggerValue}`);
         }
         // Verificar duplicidade de API/URL
         const checkDuplicateAPI = await this.botRepository.findFirst({ where: { id: { not: botId }, instanceId, botType: data.botType, apiUrl: data.apiUrl, apiKey: data.apiKey } });
         if (checkDuplicateAPI) throw new BadRequestException('Another Dify bot with this URL/API Key already exists.');


        try {
            const updatedBot = await this.botRepository.update({
                where: { id: botId },
                data: {
                    ...data, // Passa todos os dados do DTO
                    instanceId: undefined, // Não permite atualizar instanceId
                    id: undefined, // Não permite atualizar id
                },
            });
            this.logger.log(`Bot Dify atualizado com ID: ${updatedBot.id}`);
            return updatedBot;
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao atualizar bot Dify: ${error.message}`);
        }
    }

    public async deleteBot(instance: InstanceDto, botId: string): Promise<{ bot: { id: string } }> {
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        const instanceId = await this.prismaRepository.prisma.instance
            .findFirst({ where: { name: instance.instanceName } })
            .then((inst) => inst?.id);
         if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

        const bot = await this.botRepository.findFirst({ where: { id: botId } });
        if (!bot || bot.instanceId !== instanceId) throw new BadRequestException('Bot Dify não encontrado ou não pertence a esta instância.');

        try {
            // Deleta sessões associadas primeiro
            await this.sessionRepository.deleteMany({ where: { botId: botId, type: 'dify' } }); // Especifica o tipo
            // Deleta o bot
            await this.botRepository.delete({ where: { id: botId } });
            this.logger.log(`Bot Dify deletado com ID: ${botId}`);
            return { bot: { id: botId } };
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao deletar bot Dify: ${error.message}`);
        }
    }


  // Settings (lógica mantida, verificar acesso ao repo)
   public async settings(instance: InstanceDto, data: Partial<DifyDto>) { // Usa Partial para permitir atualização parcial
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        try {
            const instanceId = await this.prismaRepository.prisma.instance
                .findFirst({ where: { name: instance.instanceName } })
                .then((inst) => inst?.id);
            if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

            // Prepara dados para upsert (apenas campos de configuração)
            const settingsData = {
                expire: data.expire,
                keywordFinish: data.keywordFinish,
                delayMessage: data.delayMessage,
                unknownMessage: data.unknownMessage,
                listeningFromMe: data.listeningFromMe,
                stopBotFromMe: data.stopBotFromMe,
                keepOpen: data.keepOpen,
                debounceTime: data.debounceTime,
                difyIdFallback: data.difyIdFallback, // Campo existe no DTO/Model? Adicionar se necessário.
                ignoreJids: data.ignoreJids,
                splitMessages: data.splitMessages,
                timePerChar: data.timePerChar,
                instanceId: instanceId, // Necessário para 'create'
            };

             // Remove chaves com valor undefined para não sobrescrever com null no update
            Object.keys(settingsData).forEach(key => settingsData[key] === undefined && delete settingsData[key]);

            const upsertedSettings = await this.settingsRepository.upsert({
                where: { instanceId: instanceId },
                update: { ...settingsData, instanceId: undefined }, // Não atualiza instanceId
                create: settingsData as any, // Garante que instanceId está presente no create
            });

            // Retorna apenas os campos relevantes
            return {
                expire: upsertedSettings.expire,
                keywordFinish: upsertedSettings.keywordFinish,
                delayMessage: upsertedSettings.delayMessage,
                unknownMessage: upsertedSettings.unknownMessage,
                listeningFromMe: upsertedSettings.listeningFromMe,
                stopBotFromMe: upsertedSettings.stopBotFromMe,
                keepOpen: upsertedSettings.keepOpen,
                debounceTime: upsertedSettings.debounceTime,
                difyIdFallback: upsertedSettings.difyIdFallback,
                ignoreJids: upsertedSettings.ignoreJids,
                splitMessages: upsertedSettings.splitMessages,
                timePerChar: upsertedSettings.timePerChar,
            };
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao definir configurações Dify: ${error.message}`);
        }
    }

    public async fetchSettings(instance: InstanceDto) {
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        try {
            const instanceId = await this.prismaRepository.prisma.instance
                .findFirst({ where: { name: instance.instanceName } })
                .then((inst) => inst?.id);
            if (!instanceId) return null; // Retorna null se instância não existe

            const settings = await this.settingsRepository.findFirst({
                where: { instanceId: instanceId },
                include: { Fallback: true }, // Inclui relação Fallback se existir no schema
            });

            // Retorna as configurações ou um objeto padrão
            return settings || {
                expire: 0, keywordFinish: '', delayMessage: 0, unknownMessage: '', listeningFromMe: false,
                stopBotFromMe: false, keepOpen: false, debounceTime: 0, ignoreJids: [],
                splitMessages: false, timePerChar: 0, difyIdFallback: null, Fallback: null
            };
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao buscar configurações Dify: ${error.message}`);
        }
    }


  // Sessions (lógica mantida, verificar acesso ao repo)
  public async changeStatus(instance: InstanceDto, data: any) {
     if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
     try {
         const instanceId = await this.prismaRepository.prisma.instance
             .findFirst({ where: { name: instance.instanceName } })
             .then((inst) => inst?.id);
         if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

         const defaultSettingCheck = await this.settingsRepository?.findFirst({ where: { instanceId } });

         const remoteJid = data.remoteJid;
         const status = data.status; // 'open', 'closed', 'paused', 'delete'

         if (!remoteJid || !status) throw new BadRequestException('remoteJid e status são obrigatórios.');

         if (status === 'delete') {
             const deleted = await this.sessionRepository.deleteMany({
                 where: { instanceId, remoteJid, type: 'dify' }, // Filtra por tipo também
             });
             this.logger.log(`Sessões Dify deletadas para ${remoteJid}: ${deleted.count}`);
             return { bot: { remoteJid, status } };
         }

         if (status === 'closed') {
             if (defaultSettingCheck?.keepOpen) {
                 // Apenas atualiza o status para 'closed'
                 const updated = await this.sessionRepository.updateMany({
                     where: { instanceId, remoteJid, type: 'dify', status: { not: 'closed' } },
                     data: { status: 'closed' },
                 });
                 this.logger.log(`Sessões Dify fechadas (mantidas) para ${remoteJid}: ${updated.count}`);
             } else {
                 // Deleta as sessões fechadas se keepOpen for false
                 const deleted = await this.sessionRepository.deleteMany({
                     where: { instanceId, remoteJid, type: 'dify' },
                 });
                 this.logger.log(`Sessões Dify deletadas (keepOpen=false) para ${remoteJid}: ${deleted.count}`);
             }
             return { bot: { remoteJid, status } };
         } else {
             // Atualiza para 'open' ou 'paused'
             const updated = await this.sessionRepository.updateMany({
                 where: { instanceId, remoteJid, type: 'dify' },
                 data: { status: status },
             });
              this.logger.log(`Status da sessão Dify atualizado para "${status}" para ${remoteJid}: ${updated.count}`);
             // Retorna mais detalhes se necessário, como a sessão atualizada (requer findFirst)
             return { bot: { remoteJid, status } };
         }
     } catch (error: any) {
         this.logger.error(error);
         throw new InternalServerErrorException(`Erro ao alterar status da sessão Dify: ${error.message}`);
     }
 }

 // fetchSessions, ignoreJid (lógica mantida, verificar acesso ao repo)
    public async fetchSessions(instance: InstanceDto, botId?: string, remoteJid?: string): Promise<IntegrationSession[]> { // botId é opcional
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        try {
            const instanceId = await this.prismaRepository.prisma.instance
                .findFirst({ where: { name: instance.instanceName } })
                .then((inst) => inst?.id);
            if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

            // Verifica se o botId pertence à instância, se fornecido
            if (botId) {
                 const bot = await this.botRepository.findFirst({ where: { id: botId } });
                 if (!bot || bot.instanceId !== instanceId) throw new BadRequestException('Bot Dify não encontrado ou não pertence a esta instância.');
            }

            const whereClause: Prisma.IntegrationSessionWhereInput = {
                instanceId: instanceId,
                remoteJid: remoteJid, // Filtra por JID se fornecido
                botId: botId, // Filtra por botId se fornecido
                type: 'dify', // Garante que são sessões Dify
            };
            // Remove filtros indefinidos
            if (!remoteJid) delete whereClause.remoteJid;
            if (!botId) delete whereClause.botId;


            return await this.sessionRepository.findMany({ where: whereClause });
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao buscar sessões Dify: ${error.message}`);
        }
    }

    public async ignoreJid(instance: InstanceDto, data: IgnoreJidDto) {
        if (!this.integrationEnabled) throw new BadRequestException('Dify is disabled');
        try {
            const instanceId = await this.prismaRepository.prisma.instance
                .findFirst({ where: { name: instance.instanceName } })
                .then((inst) => inst?.id);
            if (!instanceId) throw new BadRequestException(`Instância ${instance.instanceName} não encontrada.`);

            const settings = await this.settingsRepository.findFirst({ where: { instanceId } });
            if (!settings) throw new BadRequestException('Configurações Dify não encontradas.');

            let ignoreJids: string[] = (settings?.ignoreJids as string[]) || []; // Faz cast ou usa array vazio

            if (data.action === 'add') {
                if (!ignoreJids.includes(data.remoteJid)) {
                    ignoreJids.push(data.remoteJid);
                }
            } else { // action === 'remove'
                ignoreJids = ignoreJids.filter((jid) => jid !== data.remoteJid);
            }

            const updateSettings = await this.settingsRepository.update({
                where: { id: settings.id },
                data: { ignoreJids: ignoreJids },
            });

            return { ignoreJids: updateSettings.ignoreJids };
        } catch (error: any) {
            this.logger.error(error);
            throw new InternalServerErrorException(`Erro ao atualizar ignoreJids Dify: ${error.message}`);
        }
    }


  // Emit (lógica principal mantida, com correções de tipo e acesso)
  public async emit({ instance, remoteJid, msg }: EmitData): Promise<void> { // isIntegration não usado aqui
    if (!this.integrationEnabled) return;

    try {
      // Busca configurações Dify para a instância
       const settings = await this.fetchSettings(instance); // Usa o método fetchSettings corrigido
      if (!settings) {
         this.logger.warn(`Configurações Dify não encontradas para ${instance.instanceName}, ignorando mensagem.`);
         return;
      }
      // Verifica se o JID deve ser ignorado
      if (this.checkIgnoreJids(settings?.ignoreJids as string[] || [], remoteJid)) return; // Usa checkIgnoreJids da base

      // Obtém a sessão de integração existente
      const session = await this.getSession(remoteJid, instance); // Usa getSession da base

      // Extrai o conteúdo da mensagem
      const content = getConversationMessage(msg); // Usa utilitário importado
      if (!content) {
         this.logger.debug(`Conteúdo da mensagem vazio ou não extraído para ${remoteJid}, ignorando.`);
         return; // Ignora se não houver conteúdo
      }

      // Encontra o bot Dify apropriado (por gatilho ou sessão existente)
      // Usa findBotTrigger da classe base
      let findBot = await this.findBotTrigger(this.botRepository, content, instance, session) as DifyModel | null;

      // Se nenhum bot for encontrado pelo gatilho/sessão, verifica fallback
      if (!findBot) {
        if (settings?.difyIdFallback) {
          findBot = await this.botRepository.findFirst({ where: { id: settings.difyIdFallback } });
           if (findBot) this.logger.debug(`Usando bot Dify de fallback (ID: ${findBot.id}) para ${remoteJid}`);
        }
      }

      // Se ainda assim nenhum bot for encontrado, encerra
      if (!findBot) {
         this.logger.debug(`Nenhum bot Dify (gatilho ou fallback) encontrado para ${remoteJid}, ignorando mensagem.`);
        return;
      }

      // Determina as configurações finais a serem usadas (bot específico ou padrão)
      const finalSettings = {
        expire: findBot.expire ?? settings.expire ?? 0,
        keywordFinish: findBot.keywordFinish ?? settings.keywordFinish ?? '',
        delayMessage: findBot.delayMessage ?? settings.delayMessage ?? 0,
        unknownMessage: findBot.unknownMessage ?? settings.unknownMessage ?? '',
        listeningFromMe: findBot.listeningFromMe ?? settings.listeningFromMe ?? false,
        stopBotFromMe: findBot.stopBotFromMe ?? settings.stopBotFromMe ?? false,
        keepOpen: findBot.keepOpen ?? settings.keepOpen ?? false,
        debounceTime: findBot.debounceTime ?? settings.debounceTime ?? 0,
        ignoreJids: findBot.ignoreJids as string[] ?? settings.ignoreJids as string[] ?? [], // Cast para string[]
        splitMessages: findBot.splitMessages ?? settings.splitMessages ?? false,
        timePerChar: findBot.timePerChar ?? settings.timePerChar ?? 0,
        // Adiciona difyIdFallback das configurações gerais
        difyIdFallback: settings.difyIdFallback,
      };

      const key = msg.key as { id: string; remoteJid: string; fromMe: boolean; participant: string };

      // Verifica stopBotFromMe
      if (finalSettings.stopBotFromMe && key.fromMe && session && session.status !== 'closed') {
        this.logger.info(`Mensagem própria recebida e stopBotFromMe ativo para ${remoteJid}. Pausando sessão Dify.`);
        await this.sessionRepository.update({ where: { id: session.id }, data: { status: 'paused' } });
        return;
      }

      // Verifica listeningFromMe
      if (!finalSettings.listeningFromMe && key.fromMe) {
        this.logger.debug(`Ignorando mensagem própria para ${remoteJid} (listeningFromMe=false)`);
        return;
      }

      // Verifica se a sessão aguarda input do usuário
      if (session && !session.awaitUser && session.status !== 'closed') {
         this.logger.debug(`Sessão Dify para ${remoteJid} não aguarda input do usuário, ignorando.`);
        return;
      }

      // Processa com ou sem debounce
      const waInstance = this.waMonitor.get(instance.instanceName); // Obtém instância Baileys/Meta
      if (!waInstance) {
           this.logger.error(`Instância WA ${instance.instanceName} não encontrada no monitor.`);
           return;
      }

      if (finalSettings.debounceTime && finalSettings.debounceTime > 0) {
        // Usa processDebounce da classe base
        this.processDebounce(this.userMessageDebounce, content, remoteJid, finalSettings.debounceTime, async (debouncedContent) => {
          await this.difyService.processDify(waInstance, remoteJid, findBot!, session, finalSettings, debouncedContent, msg?.pushName);
        });
      } else {
        await this.difyService.processDify(waInstance, remoteJid, findBot!, session, finalSettings, content, msg?.pushName);
      }

    } catch (error: any) {
      this.logger.error(`Erro no método emit DifyController para ${remoteJid}: ${error.message}`, error.stack);
    }
  } // Fim emit
}
