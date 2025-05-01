// Arquivo: src/repository/repository.service.ts
// Correções: Importado Logger, injetado Logger no construtor, importado e aplicado prisma-extension-pagination, adicionados getters faltantes, removido websocketClient getter inválido, adicionados métodos auxiliares comuns usados em outros locais.

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService } from '@config/config.service';
// ** CORREÇÃO: Importar Logger (assumindo Pino ou compatível com NestJS) **
// Ajuste o import se estiver usando um logger diferente (ex: '@nestjs/common')
import { Logger } from 'pino';
// ** CORREÇÃO: Importar extensão de paginação **
import { pagination, PaginationOptions, Page } from 'prisma-extension-pagination';

/**
 * Repositório principal que encapsula o Prisma Client.
 * Outros serviços devem injetar esta classe para acessar o banco de dados.
 */
export class PrismaRepository {
  /** Prisma Client estendido com paginação */
  // ** CORREÇÃO: Tipagem mais explícita para $paginate (opcional, mas recomendado) **
  public readonly client: PrismaClient & {
    $paginate: <T, A>(
      this: T,
      args?: Prisma.Exact<A, Prisma.Args<T, 'findMany'>> & PaginationOptions,
    ) => Promise<Page<Prisma.Result<T, A, 'findMany'>>>;
  };

  private readonly logger: Logger; // Logger injetado

  constructor(
    private readonly configService: ConfigService,
    // ** CORREÇÃO: Injetar Logger **
    logger: Logger,
  ) {
    // ** CORREÇÃO: Usar logger injetado e criar contexto **
    this.logger = logger.child({ context: 'PrismaRepository' });
    this.logger.info('Initializing Prisma Client...');
    try {
      const prismaInstance = new PrismaClient({
        datasources: {
          db: {
            url: this.configService.get('database').url,
          },
        },
        log:
          this.configService.get('NODE_ENV') === 'development'
            ? [
                { emit: 'event', level: 'query' },
                { emit: 'stdout', level: 'info' },
                { emit: 'stdout', level: 'warn' },
                { emit: 'stdout', level: 'error' },
              ]
            : [
                { emit: 'stdout', level: 'warn' },
                { emit: 'stdout', level: 'error' },
              ],
      });

      // ** CORREÇÃO: Estender a instância com paginação **
      this.client = prismaInstance.$extends(
        pagination({
          pages: {
            limit: 25,
            includePageCount: true,
          },
        }),
      ) as any; // Manter 'as any' se a tipagem inferida causar problemas complexos

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
      throw error;
    }
  }

  /** Chamado pelo NestJS para conectar o cliente Prisma */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.info('Prisma client connected successfully.');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to connect to Prisma client');
      throw error;
    }
  }

  /** Chamado pelo NestJS para desconectar o cliente Prisma */
  async onModuleDestroy(): Promise<void> { // Renomeado para onModuleDestroy (padrão NestJS)
    this.logger.info('Disconnecting Prisma Client...');
    await this.client.$disconnect();
    this.logger.info('Prisma Client disconnected.');
  }

  /** Constrói objeto skip/take a partir de Query genérico */
  buildPagination(params: { page?: number; limit?: number } = {}) {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) > 0 ? Number(params.limit) : 25; // Garantir limite positivo
    const skip = (page > 0 ? page - 1 : 0) * limit;
    return { skip: skip, take: limit };
  }

  // --- Getters para Acesso Direto aos Modelos ---
  // (Mantidos e verificados conforme o código original fornecido)
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
  // ** CORREÇÃO: Remover getter inválido (a menos que tenha uma extensão específica) **
  // public get websocketClient() { return this.client.websocketClient; }
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
  // ** ADICIONADO: Getter para modelo Integration (se usado em outras partes) **
  public get integration() { return this.client.integration; }


  // --- Métodos Utilitários Comuns (Mantidos e verificados) ---

  /** Executa operações Prisma em uma transação */
  async $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: P): Promise<Prisma.TransactionClient> {
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

  // Métodos auxiliares comuns (mantidos do original)
  // Nota: A implementação específica de add/removeLabelToChat dependerá do seu schema Prisma
  async findFirstOpenaiSetting(args: Prisma.OpenaiSettingFindFirstArgs): Promise<any | null> { return this.openaiSetting.findFirst(args); }
  async createMessage(args: Prisma.MessageCreateArgs): Promise<any> { return this.message.create(args); }
  async upsertContact(args: Prisma.ContactUpsertArgs): Promise<any> { return this.contact.upsert(args); }
  async upsertChat(args: Prisma.ChatUpsertArgs): Promise<any> { return this.chat.upsert(args); }
  async findFirstMessage(args: Prisma.MessageFindFirstArgs): Promise<any | null> { return this.message.findFirst(args); }
  async updateMessage(args: Prisma.MessageUpdateArgs): Promise<any> { return this.message.update(args); }
  async findFirstTemplate(args: Prisma.TemplateFindFirstArgs): Promise<any | null> { return this.template.findFirst(args); }
  async findFirstInstance(args: Prisma.InstanceFindFirstArgs): Promise<any | null> { return this.instance.findFirst(args); }
  async deleteSession(args: Prisma.SessionDeleteArgs): Promise<any> { return this.session.delete(args); }
  async deleteManySessions(args: Prisma.SessionDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.session.deleteMany(args); } // Adicionado deleteMany
  async findFirstSession(args: Prisma.SessionFindFirstArgs): Promise<any | null> { return this.session.findFirst(args); }
  async updateInstance(args: Prisma.InstanceUpdateArgs): Promise<any> { return this.instance.update(args); }
  async findManyMessages(args: Prisma.MessageFindManyArgs): Promise<any[]> { return this.message.findMany(args); }
  async findManyMessageUpdates(args: Prisma.MessageUpdateFindManyArgs): Promise<any[]> { return this.messageUpdate.findMany(args); } // Adicionado
  async findManyContacts(args: Prisma.ContactFindManyArgs): Promise<any[]> { return this.contact.findMany(args); } // Adicionado
  async findManyLabels(args: Prisma.LabelFindManyArgs): Promise<any[]> { return this.label.findMany(args); } // Adicionado
  async findManyInstances(args: Prisma.InstanceFindManyArgs): Promise<any[]> { return this.instance.findMany(args); } // Adicionado
  async findManyChats(args: Prisma.ChatFindManyArgs): Promise<any[]> { return this.chat.findMany(args); }
  async createManyChats(args: Prisma.ChatCreateManyArgs): Promise<Prisma.BatchPayload> { return this.client.chat.createMany(args); }
  async deleteManyChats(args: Prisma.ChatDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.client.chat.deleteMany(args); }
  async createManyContacts(args: Prisma.ContactCreateManyArgs): Promise<Prisma.BatchPayload> { return this.client.contact.createMany(args); }
  async findFirstLabel(args: Prisma.LabelFindFirstArgs): Promise<any | null> { return this.label.findFirst(args); }
  async deleteLabel(args: Prisma.LabelDeleteArgs): Promise<any> { return this.label.delete(args); }
  async upsertLabel(args: Prisma.LabelUpsertArgs): Promise<any> { return this.label.upsert(args); }
  async addLabelToChat(labelId: string, instanceId: string, chatId: string): Promise<void> { this.logger.warn({ labelId, chatId, instanceId },'addLabelToChat needs schema-specific implementation'); }
  async removeLabelFromChat(labelId: string, instanceId: string, chatId: string): Promise<void> { this.logger.warn({ labelId, chatId, instanceId },'removeLabelFromChat needs schema-specific implementation'); }
  async findUniqueSetting(args: Prisma.SettingFindUniqueArgs): Promise<any | null> { return this.setting.findUnique(args); }
  async upsertSetting(args: Prisma.SettingUpsertArgs): Promise<any> { return this.setting.upsert(args); } // Adicionado
  async findUniqueProxy(args: Prisma.ProxyFindUniqueArgs): Promise<any | null> { return this.proxy.findUnique(args); } // Adicionado
  async upsertProxy(args: Prisma.ProxyUpsertArgs): Promise<any> { return this.proxy.upsert(args); } // Adicionado
  async findUniqueWebhook(args: Prisma.WebhookFindUniqueArgs): Promise<any | null> { return this.webhook.findUnique(args); } // Adicionado
  async upsertWebhook(args: Prisma.WebhookUpsertArgs): Promise<any> { return this.webhook.upsert(args); } // Adicionado
  async findUniqueChatwoot(args: Prisma.ChatwootFindUniqueArgs): Promise<any | null> { return this.chatwoot.findUnique(args); } // Adicionado
  async upsertChatwoot(args: Prisma.ChatwootUpsertArgs): Promise<any> { return this.chatwoot.upsert(args); } // Adicionado
  async deleteInstance(args: Prisma.InstanceDeleteArgs): Promise<any> { return this.instance.delete(args); } // Adicionado
  async deleteManyContacts(args: Prisma.ContactDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.contact.deleteMany(args); } // Adicionado
  async deleteManyMessages(args: Prisma.MessageDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.message.deleteMany(args); } // Adicionado
  async deleteManyMessageUpdates(args: Prisma.MessageUpdateDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.messageUpdate.deleteMany(args); } // Adicionado
  async deleteManyLabels(args: Prisma.LabelDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.label.deleteMany(args); } // Adicionado

}
