// Arquivo: src/repository/repository.service.ts

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { PrismaClient, Prisma } from '@prisma/client';
// Assuming ConfigService is correctly exported from env.config.ts in your structure
import { ConfigService } from '@config/env.config';
// Using Logger from your custom config
import { Logger } from '@config/logger.config';
// Correct import attempt for prisma-extension-pagination
import { pagination, type PaginationOptions, type Page } from 'prisma-extension-pagination';

/**
 * Repositório principal que encapsula o Prisma Client.
 * Outros serviços devem injetar esta classe para acessar o banco de dados.
 */
export class PrismaRepository {
  /** Prisma Client estendido com paginação */
  public readonly client: PrismaClient & {
    $paginate: <T, A>(
      this: T,
      args?: Prisma.Exact<A, Prisma.Args<T, 'findMany'>> & PaginationOptions,
    ) => Promise<Page<Prisma.Result<T, A, 'findMany'>>>;
  };

  private readonly logger: Logger;

  constructor(
    private readonly configService: ConfigService,
    private readonly baseLogger: Logger,
  ) {
    this.logger = baseLogger;
    this.logger.setContext('PrismaRepository');

    this.logger.info('Initializing Prisma Client...');
    try {
      const dbUrl = this.configService.get<any>('DATABASE')?.CONNECTION?.URI;
      if (!dbUrl) {
        throw new Error('DATABASE.CONNECTION.URI not found in config.');
      }

      const prismaInstance = new PrismaClient({
        datasources: {
          db: {
            url: dbUrl,
          },
        },
        log:
          this.configService.get<string>('NODE_ENV') === 'development' // CORRECTED: Use <string>
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

      this.client = prismaInstance.$extends(
        pagination({
          pages: {
            limit: 25,
            includePageCount: true,
          },
        }),
      ) as any; // Keep 'as any' for now if typing is complex

      if (this.configService.get<string>('NODE_ENV') === 'development') { // CORRECTED: Use <string>
        // @ts-ignore Prisma typings for $on can be tricky
        this.client.$on('query', (e: Prisma.QueryEvent) => {
          this.logger.info(
            { query: e.query, params: e.params, duration: e.duration, message: 'Prisma Query Executed'},
          );
        });
      }

      this.logger.info('Prisma Client initialized successfully.');
    } catch (error) {
      this.logger.error({ err: error, message: 'Failed to initialize Prisma Client' });
      throw error;
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.info('Prisma client connected successfully.');
    } catch (error) {
      this.logger.error({ err: error, message: 'Failed to connect to Prisma client' });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info('Disconnecting Prisma Client...');
    await this.client.$disconnect();
    this.logger.info('Prisma Client disconnected.');
  }

  buildPagination(params: { page?: number; limit?: number } = {}) {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) > 0 ? Number(params.limit) : 25;
    const skip = (page > 0 ? page - 1 : 0) * limit;
    return { skip: skip, take: limit };
  }

  // --- Getters para os modelos (CORRIGIDOS com base nos erros TS2551/TS2339) ---
  public get instance() { return this.client.instance; }
  public get session() { return this.client.session; }
  public get chat() { return this.client.chat; }
  public get contact() { return this.client.contact; }
  public get message() { return this.client.message; }
  public get messageUpdate() { return this.client.messageUpdate; }
  public get label() { return this.client.label; }
  // public get labelAssociation() { return this.client.labelAssociation; } // CORRIGIDO: Comentado pois provavelmente não existe (TS2339)
  public get webhook() { return this.client.webhook; }
  public get pusher() { return this.client.pusher; }
  public get sqs() { return this.client.sqs; }
  public get rabbitmq() { return this.client.rabbitmq; }
  public get proxy() { return this.client.proxy; }
  public get media() { return this.client.media; }
  public get template() { return this.client.template; }
  public get setting() { return this.client.setting; } // CORRIGIDO: Singular (era settings)
  public get chatwoot() { return this.client.chatwoot; }
  // Removido getter 'typebot' que não deve existir, mantido 'typebotSetting'
  public get typebotSetting() { return this.client.typebotSetting; } // CORRIGIDO: Singular (era typebotSettings)
  public get openaiBot() { return this.client.openaiBot; }
  public get openaiSetting() { return this.client.openaiSetting; } // CORRIGIDO: Singular (era openaiSettings)
  public get openaiCreds() { return this.client.openaiCreds; }
  // Removido getter 'dify' que não deve existir, mantido 'difySetting'
  public get difySetting() { return this.client.difySetting; } // CORRIGIDO: Singular (era difySettings)
  // Removido getter 'evolutionBot' que não deve existir, mantido 'evolutionBotSetting'
  public get evolutionBotSetting() { return this.client.evolutionBotSetting; } // CORRIGIDO: Singular (era evolutionBotSettings)
  // Removido getter 'flowise' que não deve existir, mantido 'flowiseSetting'
  public get flowiseSetting() { return this.client.flowiseSetting; } // CORRIGIDO: Singular (era flowiseSettings)
  public get integrationSession() { return this.client.integrationSession; }
  public get isOnWhatsapp() { return this.client.isOnWhatsapp; }
  // public get integration() { return this.client.integration; } // Verificar se existe 'integration' no client

  // --- Métodos Utilitários Comuns ---
  async $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: P): Promise<any> {
    return this.client.$transaction(arg);
  }

  async $executeRawUnsafe(query: string, ...values: any[]): Promise<number> {
    this.logger.warn({ query, message: 'Executing unsafe raw query ($executeRawUnsafe)' });
    return this.client.$executeRawUnsafe(query, ...values);
  }

  async $queryRawUnsafe(query: string, ...values: any[]): Promise<unknown[]> {
    this.logger.warn({ query, message: 'Executing unsafe raw query ($queryRawUnsafe)'});
    return this.client.$queryRawUnsafe(query, ...values);
  }

  // --- Métodos Wrappers (Exemplos corrigidos para usar getters corretos) ---
  async findFirstOpenaiSetting(args: Prisma.OpenaiSettingFindFirstArgs): Promise<any | null> { return this.openaiSetting.findFirst(args); } // CORRIGIDO: Usa getter singular
  async createMessage(args: Prisma.MessageCreateArgs): Promise<any> { return this.message.create(args); }
  async upsertContact(args: Prisma.ContactUpsertArgs): Promise<any> { return this.contact.upsert(args); }
  async deleteManyLabels(args: Prisma.LabelDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.label.deleteMany(args); }
  // Adicione outros métodos wrapper conforme necessário, certificando-se de usar os getters corretos (ex: this.setting, this.typebotSetting, etc.)
}

// Exportar tipo Query para outros módulos usarem
export type Query<T> = {
  page?: number;
  limit?: number;
  orderBy?: { [key in keyof T]?: 'asc' | 'desc' };
  filters?: Partial<T>;
};
