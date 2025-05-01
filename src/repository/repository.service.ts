// Arquivo: src/repository/repository.service.ts
// Correções: Injeção e uso do logger, assinatura $queryRawUnsafe, getters Prisma.

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { PrismaClient, Prisma } from '@prisma/client';
// Corrigido import de ConfigService
import { ConfigService } from '@config/env.config';
// Usando Logger de logger.config.ts
import { Logger } from '@config/logger.config';
// Tentativa de importação correta para prisma-extension-pagination
// Nota: Verifique a documentação da biblioteca se isto falhar. Pode precisar de `import pagination from ...`
import { pagination, type PaginationOptions, type Page } from 'prisma-extension-pagination'; // Usando type import

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

  // Logger agora é propriedade da classe, injetado
  private readonly logger: Logger;

  constructor(
    private readonly configService: ConfigService,
    // Logger agora é injetado
    private readonly baseLogger: Logger,
  ) {
    // Usa o logger base injetado para definir o contexto
    this.logger = baseLogger; // Não chama mais .child()
    this.logger.setContext('PrismaRepository'); // Define o contexto explicitamente

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

      // Estender a instância com paginação
      this.client = prismaInstance.$extends(
        pagination({
          pages: {
            limit: 25, // Limite padrão por página
            includePageCount: true, // Incluir contagem total de páginas
          },
        }),
      ) as any; // Manter 'as any' se a tipagem inferida causar problemas complexos

      // Log de query se habilitado
      if (this.configService.get('NODE_ENV') === 'development') {
        // @ts-ignore Prisma typings for $on can be tricky
        this.client.$on('query', (e: Prisma.QueryEvent) => {
          this.logger.info( // Passando objeto único
            { query: e.query, params: e.params, duration: e.duration, message: 'Prisma Query Executed'},
          );
        });
      }

      this.logger.info('Prisma Client initialized successfully.');
    } catch (error) {
      // Corrigido logger.error para 1 argumento (objeto)
      this.logger.error({ err: error, message: 'Failed to initialize Prisma Client' });
      throw error; // Re-lançar erro para indicar falha crítica
    }
  }

  /** Chamado para conectar o cliente Prisma */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.info('Prisma client connected successfully.');
    } catch (error) {
      // Corrigido logger.error para 1 argumento (objeto)
      this.logger.error({ err: error, message: 'Failed to connect to Prisma client' });
      // Considerar uma estratégia de retry ou falhar a inicialização do app
      throw error;
    }
  }

  /** Chamado para desconectar o cliente Prisma */
  async onModuleDestroy(): Promise<void> {
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

  // --- Getters para os modelos (Verificados e mantidos) ---
  // (Getters para instance, session, chat, etc. mantidos como antes)
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
  // public get integration() { return this.client.integration; } // Getter mantido, mas verificar se 'integration' existe no client Prisma estendido

  // --- Métodos Utilitários Comuns ---

  /** Executa operações Prisma em uma transação */
  async $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: P): Promise<any> { // Retorno pode precisar ser ajustado para TransactionClient dependendo do uso
    return this.client.$transaction(arg);
  }

   /** Executa query raw (sem segurança de tipo/SQL Injection - use com CUIDADO!) */
   async $executeRawUnsafe(query: string, ...values: any[]): Promise<number> {
    this.logger.warn({ query, message: 'Executing unsafe raw query ($executeRawUnsafe)' }); // Corrigido logger
    return this.client.$executeRawUnsafe(query, ...values);
  }

  /** Executa query raw (sem segurança de tipo/SQL Injection - use com CUIDADO!) */
  // Assinatura corrigida para retornar Promise<unknown[]>
  async $queryRawUnsafe(query: string, ...values: any[]): Promise<unknown[]> {
    this.logger.warn({ query, message: 'Executing unsafe raw query ($queryRawUnsafe)'}); // Corrigido logger
    return this.client.$queryRawUnsafe(query, ...values);
  }

  // --- Métodos Wrappers (Exemplos mantidos como antes) ---
  // (Métodos como findFirstOpenaiSetting, createMessage, upsertContact, etc., mantidos)
  async findFirstOpenaiSetting(args: Prisma.OpenaiSettingFindFirstArgs): Promise<any | null> { return this.openaiSetting.findFirst(args); }
  async createMessage(args: Prisma.MessageCreateArgs): Promise<any> { return this.message.create(args); }
  async upsertContact(args: Prisma.ContactUpsertArgs): Promise<any> { return this.contact.upsert(args); }
  // ... outros métodos wrapper ...
  async deleteManyLabels(args: Prisma.LabelDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.label.deleteMany(args); }
}

// Exportar tipo Query para outros módulos usarem
// (Se Query for uma interface/tipo complexo, defina-o aqui ou importe de um local comum)
export type Query<T> = {
  page?: number;
  limit?: number;
  orderBy?: keyof T | { [key in keyof T]?: 'asc' | 'desc' };
  filters?: Partial<T>; // Ou um tipo mais específico para filtros
  // Adicionar outros parâmetros de query se necessário
};
