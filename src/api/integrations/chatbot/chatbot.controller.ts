import { InstanceDto } from '@api/dto/instance.dto';
// CORREÇÃO TS2307: Usar alias @repository
import { PrismaRepository } from '@repository/repository.service';
// Verificar se estas importações estão corretas e se server.module exporta os controllers
import {
  difyController,
  evolutionBotController,
  flowiseController,
  openaiController,
  typebotController,
} from '@api/server.module';
// Usar alias @api para serviços
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar monitor.service
// Usar alias @config para logger
import { Logger } from '@config/logger.config';
// Importar tipo Prisma
import { IntegrationSession } from '@prisma/client';
// Importar utilitário (verificar path)
import { findBotByTrigger } from '../../../utils/findBotByTrigger';

// Tipo para os dados passados para o método emit
export type EmitData = {
  instance: InstanceDto; // Informações da instância
  remoteJid: string;    // JID do remetente da mensagem
  msg: any;             // Objeto da mensagem (ex: WAMessage)
  pushName?: string;    // Nome do contato
  isIntegration?: boolean; // Flag para indicar se a mensagem é de uma integração
};

// Classe base ou controller principal para gerenciar chatbots
export class ChatbotController {
  public prismaRepository: PrismaRepository;
  public waMonitor: WAMonitoringService;
  // Inicializa um logger específico para este controller
  public readonly logger = new Logger('ChatbotController');

  // Construtor recebe dependências (geralmente injetadas)
  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    this.prismaRepository = prismaRepository;
    this.waMonitor = waMonitor;
  }

  // Getters e Setters (podem ser desnecessários dependendo do uso)
  public set prisma(prisma: PrismaRepository) {
    this.prismaRepository = prisma;
  }
  public get prisma() {
    return this.prismaRepository;
  }
  public set monitor(waMonitor: WAMonitoringService) {
    this.waMonitor = waMonitor;
  }
  public get monitor() {
    return this.waMonitor;
  }

  /**
   * Emite o evento de mensagem recebida para todos os controllers de chatbot registrados.
   * Cada controller específico (Typebot, OpenAI, etc.) decide se deve processar a mensagem.
   */
  public async emit(emitData: EmitData): Promise<void> {
    this.logger.debug(`Emitindo dados para controllers de chatbot: JID=${emitData.remoteJid}, Instância=${emitData.instance.instanceName}`);
    try {
      // Chama o método 'emit' de cada controller específico
      // Cada controller implementará sua própria lógica para decidir se processa a mensagem
      await Promise.all([
        evolutionBotController.emit(emitData),
        typebotController.emit(emitData),
        openaiController.emit(emitData),
        difyController.emit(emitData),
        flowiseController.emit(emitData),
      ]);
    } catch (error) {
      this.logger.error({ err: error, msg: `Erro ao emitir evento para chatbots` });
      // Tratar o erro conforme necessário (ex: log, notificação)
    }
  }

  /**
   * Processa mensagens com debounce para agrupar mensagens rápidas do mesmo usuário.
   */
  public processDebounce(
    userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } },
    content: string,
    remoteJid: string,
    debounceTime: number, // Tempo em segundos
    callback: (msg: string) => void, // Função a ser chamada após o debounce
  ): void {
    if (!debounceTime || debounceTime <= 0) {
        // Se debounceTime for 0 ou inválido, processa imediatamente
        callback(content);
        return;
    }

    const debounceMs = debounceTime * 1000; // Converter para milissegundos

    if (userMessageDebounce[remoteJid]) {
      // Se já existe debounce para este JID, concatena a mensagem e reinicia o timer
      userMessageDebounce[remoteJid].message += `\n${content}`; // Concatena mensagens
      this.logger.log(`Mensagem debounced para ${remoteJid}: ` + userMessageDebounce[remoteJid].message);
      clearTimeout(userMessageDebounce[remoteJid].timeoutId); // Limpa timer anterior
    } else {
      // Se for a primeira mensagem no período de debounce, inicia o registro
      userMessageDebounce[remoteJid] = {
        message: content,
        timeoutId: null as any, // Inicializa timeoutId
      };
    }

    // Define um novo timer
    userMessageDebounce[remoteJid].timeoutId = setTimeout(() => {
      const messageToSend = userMessageDebounce[remoteJid].message;
      this.logger.log(`Debounce completo para ${remoteJid}. Processando mensagem: ` + messageToSend);

      delete userMessageDebounce[remoteJid]; // Remove o registro do debounce
      callback(messageToSend); // Chama o callback com a mensagem completa
    }, debounceMs);
  }

  /**
   * Verifica se um JID deve ser ignorado com base na lista `ignoreJids`.
   */
  public checkIgnoreJids(ignoreJids: string[] | null | undefined, remoteJid: string): boolean {
    if (!ignoreJids || ignoreJids.length === 0) {
      return false; // Se a lista for vazia ou nula, não ignora
    }

    // Verifica se deve ignorar todos os grupos
    if (ignoreJids.includes('@g.us') && remoteJid.endsWith('@g.us')) {
      this.logger.warn(`Ignorando mensagem do grupo ${remoteJid} (configurado para ignorar todos os grupos)`);
      return true;
    }

    // Verifica se deve ignorar todos os contatos individuais
    if (ignoreJids.includes('@s.whatsapp.net') && remoteJid.endsWith('@s.whatsapp.net')) {
      this.logger.warn(`Ignorando mensagem do contato ${remoteJid} (configurado para ignorar todos os contatos)`);
      return true;
    }

    // Verifica se o JID específico está na lista
    if (ignoreJids.includes(remoteJid)) {
      this.logger.warn(`Ignorando mensagem do JID específico ${remoteJid}`);
      return true;
    }

    return false; // Não ignora
  }

  /**
   * Busca a sessão de integração ativa (não fechada) para um JID e instância.
   */
  public async getSession(remoteJid: string, instance: InstanceDto): Promise<IntegrationSession | null> {
    if (!instance?.instanceId) {
        this.logger.error("getSession chamado sem instanceId válido.");
        return null;
    }
    try {
        const session = await this.prismaRepository.integrationSession.findFirst({
            where: {
                remoteJid: remoteJid,
                instanceId: instance.instanceId,
                status: { not: 'closed' } // Busca sessão que não esteja fechada
            },
            orderBy: { createdAt: 'desc' }, // Pega a mais recente se houver múltiplas ativas (improvável)
        });
        return session; // Retorna a sessão encontrada ou null
    } catch (error) {
        this.logger.error({ err: error, jid: remoteJid, instanceId: instance.instanceId, msg: "Erro ao buscar sessão de integração" });
        return null;
    }
  }

  /**
    * Encontra o bot apropriado com base no gatilho (trigger) ou na sessão existente.
    */
  public async findBotTrigger(
    botRepository: any, // Repositório específico do chatbot (ex: prisma.typebot, prisma.openaiBot)
    content: string | null | undefined, // Conteúdo da mensagem para verificar trigger
    instanceId: string,
    session?: IntegrationSession | null, // Sessão existente (opcional)
  ): Promise<any | null> { // Retorna o bot encontrado ou null
    let findBot = null;

    if (!botRepository) {
        this.logger.error("Repositório do Bot não fornecido para findBotTrigger.");
        return null;
    }

    if (session?.botId) {
      // Se já existe uma sessão ativa, busca o bot pelo ID da sessão
      this.logger.debug(`Buscando bot pela sessão ativa: ID=${session.botId}`);
      try {
          findBot = await botRepository.findUnique({ // Usa findUnique pois temos o ID
              where: { id: session.botId },
          });
          if (!findBot) {
             this.logger.warn(`Bot com ID ${session.botId} da sessão ativa não encontrado.`);
          }
      } catch (error) {
         this.logger.error({ err: error, botId: session.botId, msg: "Erro ao buscar bot pelo ID da sessão" });
      }
    } else if (content) {
      // Se não há sessão ativa, busca um bot pelo gatilho (trigger) na mensagem
      this.logger.debug(`Buscando bot pelo gatilho na mensagem: "${content}"`);
      try {
          // findBotByTrigger é uma função utilitária que precisa ser verificada
          findBot = await findBotByTrigger(botRepository, content, instanceId);
          if (!findBot) {
             this.logger.debug(`Nenhum bot encontrado com gatilho para a mensagem.`);
          } else {
             this.logger.info(`Bot encontrado pelo gatilho: ID=${findBot.id}`);
          }
      } catch (error) {
         this.logger.error({ err: error, content, instanceId, msg: "Erro ao buscar bot pelo gatilho" });
      }
    } else {
        this.logger.debug("Nenhuma sessão ativa e nenhum conteúdo de mensagem para buscar bot por gatilho.");
    }

    return findBot; // Retorna o bot encontrado ou null
  }
}

// Remover chave extra no final, se houver
