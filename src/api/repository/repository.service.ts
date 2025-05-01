/* src/api/repository/repository.service.ts
   ------------------------------------------------------------------------- */
import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService }        from '@config/env.config';
import { Logger }               from '@config/logger.config';

/**
 * Pequeno utilitário genérico que as rotas usam
 *     const result: Query<Prisma.ChatFindManyArgs> = { … }
 */
export type Query<T = unknown> = Prisma.SelectSubset<T, T>;

export class PrismaRepository {
  private readonly prisma  = new PrismaClient();
  private readonly logger  = new Logger('PrismaRepository');

  constructor(private readonly configService?: ConfigService) {
    void this.onModuleInit();           // conecta logo que a classe é criada
  }

  /* -------------------------------------------------------------------- *
   * Acesso bruto ao client – use quando precisar de algo fora dos getters */
  public get client(): PrismaClient {
    return this.prisma;
  }

  /* -------------------------------------------------------------------- *
   * Getters gerados para **todos** os modelos do schema.prisma            */
  public get instance()            { return this.prisma.instance; }
  public get session()             { return this.prisma.session; }
  public get chat()                { return this.prisma.chat; }
  public get contact()             { return this.prisma.contact; }
  public get message()             { return this.prisma.message; }
  public get messageUpdate()       { return this.prisma.messageUpdate; }
  public get webhook()             { return this.prisma.webhook; }
  public get chatwoot()            { return this.prisma.chatwoot; }
  public get proxy()               { return this.prisma.proxy; }
  public get rabbitmq()            { return this.prisma.rabbitmq; }
  public get sqs()                 { return this.prisma.sqs; }
  public get websocket()           { return this.prisma.websocket; }
  public get setting()             { return this.prisma.setting; }
  public get integrationSession()  { return this.prisma.integrationSession; }
  public get dify()                { return this.prisma.dify; }
  public get difySetting()         { return this.prisma.difySetting; }
  public get evolutionBot()        { return this.prisma.evolutionBot; }
  public get evolutionBotSetting() { return this.prisma.evolutionBotSetting; }
  public get flowise()             { return this.prisma.flowise; }
  public get flowiseSetting()      { return this.prisma.flowiseSetting; }
  public get openaiBot()           { return this.prisma.openaiBot; }
  public get openaiSetting()       { return this.prisma.openaiSetting; }
  public get openaiCreds()         { return this.prisma.openaiCreds; }
  public get typebot()             { return this.prisma.typebot; }
  public get typebotSetting()      { return this.prisma.typebotSetting; }
  public get label()               { return this.prisma.label; }
  public get pusher()              { return this.prisma.pusher; }
  public get whatsappIntegration() { return this.prisma.whatsappIntegration; }

  /* -------------------------------------------------------------------- *
   * Ciclo de vida                                                         */
  private async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.logger.log('✅  Prisma conectado');
    } catch (err: any) {
      this.logger.error(`❌  Falha ao conectar Prisma: ${err?.message || err}`);
    }
  }

  public async onModuleDestroy(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.logger.log('👋  Prisma desconectado com segurança');
    } catch (err: any) {
      this.logger.error(`❌  Falha ao desconectar Prisma: ${err?.message || err}`);
    }
  }
}
