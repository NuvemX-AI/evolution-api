// Arquivo: src/repository/repository.service.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService } from '@config/config.service'; // Correção: Usar alias
import { Logger } from 'pino'; // Assumindo que pino logger é usado
import { pagination, PaginationOptions } from 'prisma-extension-pagination'; // Importando extensão e tipos

/**
 * Repositório principal que encapsula o Prisma Client.
 * Outros serviços devem injetar esta classe para acessar o banco de dados.
 */
export class PrismaRepository {
  /** Prisma Client estendido com paginação */
  public readonly client: PrismaClient & {
    $paginate: (model: string, options?: PaginationOptions) => any; // Adicionando tipo para a extensão
  };
  private readonly logger: Logger;

  constructor(
    private readonly configService: ConfigService, // ConfigService deve ser injetado
    logger: Logger, // Logger deve ser injetado
  ) {
    this.logger = logger.child({ context: 'PrismaRepository' }); // Criar um logger filho para o contexto
    this.logger.info('Initializing Prisma Client...');
    try {
      const prismaInstance = new PrismaClient({
        datasources: {
          db: {
            // Garante que a URL venha do ConfigService injetado
            url: this.configService.get('database').url,
          },
        },
        log:
          this.configService.get('NODE_ENV') === 'development'
            ? // Logs mais detalhados em desenvolvimento
              [
                { emit: 'event', level: 'query' },
                { emit: 'stdout', level: 'info' },
                { emit: 'stdout', level: 'warn' },
                { emit: 'stdout', level: 'error' },
              ]
            : // Logs mais concisos em produção
              [
                { emit: 'stdout', level: 'warn' },
                { emit: 'stdout', level: 'error' },
              ],
      });

      // Estender a instância com paginação
      this.client = prismaInstance.$extends(
        pagination({
          pages: {
            limit: 25, // Limite padrão por página
            includePageCount: true, // Incluir contagem total de páginas
          },
        }),
      ) as any; // Usar 'as any' temporariamente se a tipagem da extensão conflitar

      // Log de query se habilitado
      if (this.configService.get('NODE_ENV') === 'development') {
        // @ts-ignore Prisma typings for $on can be tricky
        this.client.$on('query', (e: Prisma.QueryEvent) => {
          this.logger.info(
            { query: e.query, params: e.params, duration: e.duration },
            'Prisma Query Executed',
          );
        });
      }

      this.logger.info('Prisma Client initialized successfully.');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to initialize Prisma Client');
      throw error; // Re-lançar erro para indicar falha crítica
    }
  }

  /** Chamado para conectar o cliente Prisma */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.info('Prisma client connected successfully.');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to connect to Prisma client');
      // Considerar uma estratégia de retry ou falhar a inicialização do app
      throw error;
    }
  }

  /** Chamado para desconectar o cliente Prisma */
  async $disconnect(): Promise<void> {
    this.logger.info('Disconnecting Prisma Client...');
    await this.client.$disconnect();
    this.logger.info('Prisma Client disconnected.');
  }

  /** Constrói objeto skip/take a partir de Query genérico */
  buildPagination(params: { page?: number; limit?: number } = {}) {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const skip = (page > 0 ? page - 1 : 0) * limit;
    return { skip: skip, take: limit };
  }

  // --- Getters para os modelos (Adicionados conforme erros) ---
  public get instance() { return this.client.instance; }
  public get session() { return this.client.session; }
  public get chat() { return this.client.chat; }
  public get contact() { return this.client.contact; }
  public get message() { return this.client.message; }
  public get messageUpdate() { return this.client.messageUpdate; }
  public get label() { return this.client.label; }
  public get webhook() { return this.client.webhook; }
  public get pusher() { return this.client.pusher; }
  public get sqs() { return this.client.sqs; }
  public get rabbitmq() { return this.client.rabbitmq; }
  public get websocketClient() { return this.client.websocketClient; }
  public get proxy() { return this.client.proxy; }
  public get media() { return this.client.media; }
  public get template() { return this.client.template; }
  public get setting() { return this.client.setting; }
  public get chatwoot() { return this.client.chatwoot; }
  public get typebot() { return this.client.typebot; }
  public get typebotSetting() { return this.client.typebotSetting; }
  public get openaiBot() { return this.client.openaiBot; }
  public get openaiSetting() { return this.client.openaiSetting; }
  public get openaiCreds() { return this.client.openaiCreds; }
  public get dify() { return this.client.dify; }
  public get difySetting() { return this.client.difySetting; }
  public get evolutionBot() { return this.client.evolutionBot; }
  public get evolutionBotSetting() { return this.client.evolutionBotSetting; }
  public get flowise() { return this.client.flowise; }
  public get flowiseSetting() { return this.client.flowiseSetting; }
  public get integrationSession() { return this.client.integrationSession; }
  public get isOnWhatsapp() { return this.client.isOnWhatsapp; }

  // --- Métodos Ausentes (Implementações básicas - REVISAR E AJUSTAR) ---

  /** Executa operações Prisma em uma transação */
  async $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: P): Promise<any[]> {
    return this.client.$transaction(arg);
  }

  /** Executa query raw (sem segurança de tipo/SQL Injection - use com CUIDADO!) */
  async $executeRawUnsafe(query: string, ...values: any[]): Promise<number> {
    this.logger.warn({ query }, 'Executing unsafe raw query ($executeRawUnsafe)');
    return this.client.$executeRawUnsafe(query, ...values);
  }
  /** Executa query raw (sem segurança de tipo/SQL Injection - use com CUIDADO!) */
  async $queryRawUnsafe(query: string, ...values: any[]): Promise<unknown[]> {
    this.logger.warn({ query }, 'Executing unsafe raw query ($queryRawUnsafe)');
    return this.client.$queryRawUnsafe(query, ...values);
  }
  // NOTA: Prefira Prisma.sql`` para queries raw seguras sempre que possível.

  /** Busca a primeira configuração do OpenAI */
  async findFirstOpenaiSetting(args: Prisma.OpenaiSettingFindFirstArgs): Promise<any | null> {
    return this.openaiSetting.findFirst(args);
  }

  /** Cria uma nova mensagem */
  async createMessage(args: Prisma.MessageCreateArgs): Promise<any> {
    return this.message.create(args);
  }

  /** Cria ou atualiza um contato */
  async upsertContact(args: Prisma.ContactUpsertArgs): Promise<any> {
    return this.contact.upsert(args);
  }

  /** Cria ou atualiza um chat */
  async upsertChat(args: Prisma.ChatUpsertArgs): Promise<any> {
    return this.chat.upsert(args);
  }

  /** Busca a primeira mensagem que corresponde aos critérios */
  async findFirstMessage(args: Prisma.MessageFindFirstArgs): Promise<any | null> {
    return this.message.findFirst(args);
  }

  /** Atualiza uma mensagem existente */
  async updateMessage(args: Prisma.MessageUpdateArgs): Promise<any> {
    return this.message.update(args);
  }

   /** Busca o primeiro template que corresponde aos critérios */
   async findFirstTemplate(args: Prisma.TemplateFindFirstArgs): Promise<any | null> {
    return this.template.findFirst(args);
  }

   /** Busca a primeira instância que corresponde aos critérios */
   async findFirstInstance(args: Prisma.InstanceFindFirstArgs): Promise<any | null> {
    return this.instance.findFirst(args);
  }

  /** Deleta uma sessão de autenticação */
  async deleteSession(args: Prisma.SessionDeleteArgs): Promise<any> {
    return this.session.delete(args);
  }

   /** Busca a primeira sessão de autenticação que corresponde aos critérios */
   async findFirstSession(args: Prisma.SessionFindFirstArgs): Promise<any | null> {
    return this.session.findFirst(args);
  }

   /** Atualiza uma instância existente */
  async updateInstance(args: Prisma.InstanceUpdateArgs): Promise<any> {
    return this.instance.update(args);
  }

  /** Busca múltiplas mensagens */
  async findManyMessages(args: Prisma.MessageFindManyArgs): Promise<any[]> {
    return this.message.findMany(args);
  }

  /** Busca múltiplos chats */
  async findManyChats(args: Prisma.ChatFindManyArgs): Promise<any[]> {
    return this.chat.findMany(args);
  }

  /** Cria múltiplos chats (usa createMany do client) */
  async createManyChats(args: Prisma.ChatCreateManyArgs): Promise<Prisma.BatchPayload> {
    return this.client.chat.createMany(args);
  }

  /** Deleta múltiplos chats (usa deleteMany do client) */
  async deleteManyChats(args: Prisma.ChatDeleteManyArgs): Promise<Prisma.BatchPayload> {
    return this.client.chat.deleteMany(args);
  }

  /** Cria múltiplos contatos (usa createMany do client) */
  async createManyContacts(args: Prisma.ContactCreateManyArgs): Promise<Prisma.BatchPayload> {
    return this.client.contact.createMany(args);
  }

  /** Busca a primeira label que corresponde aos critérios */
  async findFirstLabel(args: Prisma.LabelFindFirstArgs): Promise<any | null> {
    return this.label.findFirst(args);
  }

  /** Deleta uma label */
  async deleteLabel(args: Prisma.LabelDeleteArgs): Promise<any> {
    return this.label.delete(args);
  }

  /** Cria ou atualiza uma label */
  async upsertLabel(args: Prisma.LabelUpsertArgs): Promise<any> {
    return this.label.upsert(args);
  }

  /** Associa uma label a um chat (REQUER IMPLEMENTAÇÃO ESPEĆIFICA DO SCHEMA) */
  async addLabelToChat(labelId: string, instanceId: string, chatId: string): Promise<void> {
    // Exemplo: Assumindo uma tabela de relação `ChatLabel`
    // try {
    //   await this.client.chatLabel.create({
    //     data: { labelId, chatId, instanceId },
    //   });
    //   this.logger.info({ labelId, chatId, instanceId }, 'Label associated with chat');
    // } catch (error: any) {
    //   // Ignorar erro se a relação já existir (Unique constraint failed)
    //   if (error.code !== 'P2002') {
    //      this.logger.error({ err: error, labelId, chatId }, 'Failed to associate label with chat');
    //     throw error;
    //   }
    // }
    this.logger.warn(
      { labelId, chatId, instanceId },
      'addLabelToChat needs schema-specific implementation',
    );
  }

  /** Desassocia uma label de um chat (REQUER IMPLEMENTAÇÃO ESPEĆIFICA DO SCHEMA) */
  async removeLabelFromChat(labelId: string, instanceId: string, chatId: string): Promise<void> {
    // Exemplo: Assumindo uma tabela de relação `ChatLabel`
    // try {
    //   await this.client.chatLabel.deleteMany({
    //     where: { labelId, chatId, instanceId },
    //   });
    //   this.logger.info({ labelId, chatId, instanceId }, 'Label disassociated from chat');
    // } catch (error) {
    //   this.logger.error({ err: error, labelId, chatId }, 'Failed to disassociate label from chat');
    //   throw error;
    // }
    this.logger.warn(
      { labelId, chatId, instanceId },
      'removeLabelFromChat needs schema-specific implementation',
    );
  }

   /** Busca uma configuração única */
   async findUniqueSetting(args: Prisma.SettingFindUniqueArgs): Promise<any | null> {
    return this.setting.findUnique(args);
  }
}
