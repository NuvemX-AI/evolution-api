import { PrismaClient, Instance, Session, Chat, Contact, Message, Webhook, Chatwoot, Proxy, Rabbitmq, Sqs, IntegrationSession, Typebot, Websocket, Setting, Label } from '@prisma/client';
import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';

export class PrismaRepository {
  private readonly prisma: PrismaClient;
  private readonly logger = new Logger('PrismaRepository');

  constructor(private readonly configService?: ConfigService) {
    this.prisma = new PrismaClient();
  }

  public get client(): PrismaClient {
    return this.prisma;
  }

  public get instance(): PrismaClient['instance'] {
    return this.prisma.instance;
  }

  public get session(): PrismaClient['session'] {
    return this.prisma.session;
  }

  public get chat(): PrismaClient['chat'] {
    return this.prisma.chat;
  }

  public get contact(): PrismaClient['contact'] {
    return this.prisma.contact;
  }

  public get message(): PrismaClient['message'] {
    return this.prisma.message;
  }

  public get webhook(): PrismaClient['webhook'] {
    return this.prisma.webhook;
  }

  public get chatwoot(): PrismaClient['chatwoot'] {
    return this.prisma.chatwoot;
  }

  public get proxy(): PrismaClient['proxy'] {
    return this.prisma.proxy;
  }

  public get rabbitmq(): PrismaClient['rabbitmq'] {
    return this.prisma.rabbitmq;
  }

  public get sqs(): PrismaClient['sqs'] {
    return this.prisma.sqs;
  }

  public get integrationSession(): PrismaClient['integrationSession'] {
    return this.prisma.integrationSession;
  }

  public get typebot(): PrismaClient['typebot'] {
    return this.prisma.typebot;
  }

  public get websocket(): PrismaClient['websocket'] {
    return this.prisma.websocket;
  }

  public get setting(): PrismaClient['setting'] {
    return this.prisma.setting;
  }

  public get label(): PrismaClient['label'] {
    return this.prisma.label;
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.logger.log('✅ Prisma conectado com sucesso');
    } catch (error) {
      this.logger.error(`❌ Falha ao conectar com o Prisma: ${error?.message || error}`);
    }
  }

  public async onModuleDestroy(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.logger.log('👋 Prisma desconectado com segurança');
    } catch (error) {
      this.logger.error(`❌ Falha ao desconectar Prisma: ${error?.message || error}`);
    }
  }
}
