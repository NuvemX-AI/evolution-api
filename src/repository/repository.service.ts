// Arquivo: src/repository/repository.service.ts

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { PrismaClient, Prisma } from '@prisma/client';
// Corrigido import de ConfigService -> OK se ConfigService está em env.config.ts
import { ConfigService } from '@config/env.config';
// Usando Logger de logger.config.ts -> OK
import { Logger } from '@config/logger.config';
// Tentativa de importação correta para prisma-extension-pagination -> OK
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

 // Logger agora é propriedade da classe, injetado -> OK
 private readonly logger: Logger;

 constructor(
   private readonly configService: ConfigService,
   // Logger agora é injetado -> OK
   private readonly baseLogger: Logger,
 ) {
   // Usa o logger base injetado para definir o contexto -> OK
   this.logger = baseLogger; // Não chama mais .child()
   this.logger.setContext('PrismaRepository'); // Define o contexto explicitamente -> OK

   this.logger.info('Initializing Prisma Client...');
   try {
     const dbUrl = this.configService.get<any>('DATABASE')?.CONNECTION?.URI; // Acesso mais seguro à URL
     if (!dbUrl) {
        throw new Error('DATABASE.CONNECTION.URI not found in config.');
     }

     const prismaInstance = new PrismaClient({
       datasources: {
         db: {
           url: dbUrl, // Usando a URL obtida
         },
       },
       // Configuração de log parece OK
       log:
         this.configService.get<any>('NODE_ENV') === 'development'
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

     // Estender a instância com paginação -> OK
     this.client = prismaInstance.$extends(
       pagination({
         pages: {
           limit: 25, // Limite padrão por página
           includePageCount: true, // Incluir contagem total de páginas
         },
       }),
     ) as any; // Manter 'as any' se a tipagem inferida causar problemas complexos -> OK (mas idealmente resolver a tipagem)

     // Log de query se habilitado -> OK
     if (this.configService.get<any>('NODE_ENV') === 'development') {
       // @ts-ignore Prisma typings for $on can be tricky -> OK
       this.client.$on('query', (e: Prisma.QueryEvent) => {
         this.logger.info( // Passando objeto único -> OK
           { query: e.query, params: e.params, duration: e.duration, message: 'Prisma Query Executed'},
         );
       });
     }

     this.logger.info('Prisma Client initialized successfully.');
   } catch (error) {
     // Corrigido logger.error para 1 argumento (objeto) -> OK
     this.logger.error({ err: error, message: 'Failed to initialize Prisma Client' });
     throw error; // Re-lançar erro para indicar falha crítica -> OK
   }
 }

 /** Chamado para conectar o cliente Prisma */
 // Método parece correto, usado em frameworks como NestJS
 async onModuleInit(): Promise<void> {
   try {
     await this.client.$connect();
     this.logger.info('Prisma client connected successfully.');
   } catch (error) {
     // Corrigido logger.error para 1 argumento (objeto) -> OK
     this.logger.error({ err: error, message: 'Failed to connect to Prisma client' });
     throw error;
   }
 }

 /** Chamado para desconectar o cliente Prisma */
 // Método parece correto
 async onModuleDestroy(): Promise<void> {
   this.logger.info('Disconnecting Prisma Client...');
   await this.client.$disconnect();
   this.logger.info('Prisma Client disconnected.');
 }

 /** Constrói objeto skip/take a partir de Query genérico */
 // Método parece correto
 buildPagination(params: { page?: number; limit?: number } = {}) {
   const page = Number(params.page) || 1;
   const limit = Number(params.limit) > 0 ? Number(params.limit) : 25; // Garantir limite positivo
   const skip = (page > 0 ? page - 1 : 0) * limit;
   return { skip: skip, take: limit };
 }

 // --- Getters para os modelos (Verificados e mantidos) ---
 // Getters parecem corretos e são uma forma válida de expor os modelos
 public get instance() { return this.client.instance; }
 public get session() { return this.client.session; }
 public get chat() { return this.client.chat; }
 public get contact() { return this.client.contact; }
 public get message() { return this.client.message; }
 public get messageUpdate() { return this.client.messageUpdate; }
 public get label() { return this.client.label; }
 public get labelAssociation() { return this.client.labelAssociation; } // Adicionado getter faltante? Verificar schema
 public get webhook() { return this.client.webhook; }
 public get pusher() { return this.client.pusher; }
 public get sqs() { return this.client.sqs; }
 public get rabbitmq() { return this.client.rabbitmq; }
 public get proxy() { return this.client.proxy; }
 public get media() { return this.client.media; }
 public get template() { return this.client.template; }
 // Renomeado para settings (singular) para consistência com schema Prisma?
 public get settings() { return this.client.settings; } // Ajustado de 'setting' para 'settings'
 public get chatwoot() { return this.client.chatwoot; }
 public get typebot() { return this.client.typebot; }
 // Renomeado para typebotSettings?
 public get typebotSettings() { return this.client.typebotSettings; } // Ajustado de 'typebotSetting'
 public get openaiBot() { return this.client.openaiBot; }
 // Renomeado para openaiSettings?
 public get openaiSettings() { return this.client.openaiSettings; } // Ajustado de 'openaiSetting'
 public get openaiCreds() { return this.client.openaiCreds; }
 public get dify() { return this.client.dify; }
 // Renomeado para difySettings?
 public get difySettings() { return this.client.difySettings; } // Ajustado de 'difySetting'
 public get evolutionBot() { return this.client.evolutionBot; }
 // Renomeado para evolutionBotSettings?
 public get evolutionBotSettings() { return this.client.evolutionBotSettings; } // Ajustado de 'evolutionBotSetting'
 public get flowise() { return this.client.flowise; }
 // Renomeado para flowiseSettings?
 public get flowiseSettings() { return this.client.flowiseSettings; } // Ajustado de 'flowiseSetting'
 public get integrationSession() { return this.client.integrationSession; }
 public get isOnWhatsapp() { return this.client.isOnWhatsapp; }
 // public get integration() { return this.client.integration; } // Verificar se existe 'integration' no client

 // --- Métodos Utilitários Comuns ---

 /** Executa operações Prisma em uma transação */
 // Assinatura parece OK
 async $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: P): Promise<any> {
   return this.client.$transaction(arg);
 }

  /** Executa query raw (sem segurança de tipo/SQL Injection - use com CUIDADO!) */
   // Assinatura parece OK
  async $executeRawUnsafe(query: string, ...values: any[]): Promise<number> {
   this.logger.warn({ query, message: 'Executing unsafe raw query ($executeRawUnsafe)' }); // Corrigido logger -> OK
   return this.client.$executeRawUnsafe(query, ...values);
 }

 /** Executa query raw (sem segurança de tipo/SQL Injection - use com CUIDADO!) */
  // Assinatura corrigida para retornar Promise<unknown[]> -> OK
 async $queryRawUnsafe(query: string, ...values: any[]): Promise<unknown[]> {
   this.logger.warn({ query, message: 'Executing unsafe raw query ($queryRawUnsafe)'}); // Corrigido logger -> OK
   return this.client.$queryRawUnsafe(query, ...values);
 }

 // --- Métodos Wrappers (Exemplos mantidos como antes) ---
 // Assinaturas parecem OK, mas dependem da existência dos getters corretos
 async findFirstOpenaiSetting(args: Prisma.OpenaiSettingFindFirstArgs): Promise<any | null> { return this.openaiSetting.findFirst(args); }
 async createMessage(args: Prisma.MessageCreateArgs): Promise<any> { return this.message.create(args); }
 async upsertContact(args: Prisma.ContactUpsertArgs): Promise<any> { return this.contact.upsert(args); }
 // ... outros métodos wrapper ...
 async deleteManyLabels(args: Prisma.LabelDeleteManyArgs): Promise<Prisma.BatchPayload> { return this.label.deleteMany(args); }
}

// Exportar tipo Query para outros módulos usarem
// Definição de Query parece OK, mas simplificando 'orderBy'
export type Query<T> = {
 page?: number;
 limit?: number;
 // Simplificado orderBy para o formato mais comum esperado pelo Prisma
 orderBy?: { [key in keyof T]?: 'asc' | 'desc' };
 filters?: Partial<T>; // Ou um tipo mais específico para filtros
 // Adicionar outros parâmetros de query se necessário
};
