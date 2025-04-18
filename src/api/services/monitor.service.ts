import { InstanceDto } from '@api/dto/instance.dto';
import { ProviderFiles } from '@api/provider/sessions';
import { PrismaRepository } from '@api/repository/repository.service';
import { channelController } from '@api/server.module';
import { Events, Integration } from '@api/types/wa.types';
import { CacheConf, Chatwoot, ConfigService, Database, DelInstance, ProviderSession } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { INSTANCE_DIR, STORE_DIR } from '@config/path.config';
import { NotFoundException } from '@exceptions';
import { execSync } from 'child_process';
import EventEmitter2 from 'eventemitter2';
import { rmSync } from 'fs';
import { join } from 'path';

import { CacheService } from './cache.service';

export class WAMonitoringService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly providerFiles: ProviderFiles,
    private readonly cache: CacheService,
    private readonly chatwootCache: CacheService,
    private readonly baileysCache: CacheService,
  ) {
    this.removeInstance();
    this.noConnection();

    Object.assign(this.db, configService.get<Database>('DATABASE'));
    Object.assign(this.redis, configService.get<CacheConf>('CACHE'));
  }

  private readonly db: Partial<Database> = {};
  private readonly redis: Partial<CacheConf> = {};

  private readonly logger = new Logger('WAMonitoringService');
  public readonly waInstances: Record<string, any> = {};

  private readonly providerSession = Object.freeze(this.configService.get<ProviderSession>('PROVIDER'));

  public delInstanceTime(instance: string) {
    const time = this.configService.get<DelInstance>('DEL_INSTANCE');
    if (typeof time === 'number' && time > 0) {
      setTimeout(async () => {
        const current = this.waInstances[instance];
        if (current?.connectionStatus?.state !== 'open') {
          if (current?.connectionStatus?.state === 'connecting') {
            if ((await current.integration) === Integration.WHATSAPP_BAILEYS) {
              await current?.client?.logout('Log out instance: ' + instance);
              current?.client?.ws?.close();
              current?.client?.end(undefined);
            }
          }
          this.eventEmitter.emit('remove.instance', instance, 'inner');
        }
      }, 1000 * 60 * time);
    }
  }

  public async instanceInfo(instanceNames?: string[]): Promise<any> {
    if (instanceNames?.length) {
      const missing = instanceNames.filter((instance) => !this.waInstances[instance]);
      if (missing.length > 0) {
        throw new NotFoundException(`Instance${missing.length > 1 ? 's' : ''} "${missing.join(', ')}" not found`);
      }
    }

    const clientName = this.configService.get<Database>('DATABASE').CONNECTION.CLIENT_NAME;
    const where = instanceNames?.length
      ? { name: { in: instanceNames }, clientName }
      : { clientName };

    return this.prismaRepository.instance.findMany({
      where,
      include: {
        Chatwoot: true,
        Proxy: true,
        Rabbitmq: true,
        Sqs: true,
        Websocket: true,
        Setting: true,
        _count: { select: { Message: true, Contact: true, Chat: true } },
      },
    });
  }

  public async instanceInfoById(instanceId?: string, number?: string) {
    let instanceName: string;

    if (instanceId) {
      instanceName = (await this.prismaRepository.instance.findFirst({ where: { id: instanceId } }))?.name;
      if (!instanceName) throw new NotFoundException(`Instance "${instanceId}" not found`);
    } else if (number) {
      instanceName = (await this.prismaRepository.instance.findFirst({ where: { number } }))?.name;
      if (!instanceName) throw new NotFoundException(`Instance "${number}" not found`);
    }

    if (!instanceName || !this.waInstances[instanceName]) {
      throw new NotFoundException(`Instance "${instanceId ?? number}" not found`);
    }

    return this.instanceInfo([instanceName]);
  }

  public async cleaningUp(instanceName: string) {
    let instanceDbId: string;

    if (this.db.SAVE_DATA.INSTANCE) {
      const found = await this.prismaRepository.instance.findFirst({ where: { name: instanceName } });
      if (found) {
        const instance = await this.prismaRepository.instance.update({
          where: { name: instanceName },
          data: { connectionStatus: 'close' },
        });
        rmSync(join(INSTANCE_DIR, instance.id), { recursive: true, force: true });
        instanceDbId = instance.id;
        await this.prismaRepository.session.deleteMany({ where: { sessionId: instance.id } });
      }
    }

    if (this.redis.REDIS.ENABLED && this.redis.REDIS.SAVE_INSTANCES) {
      await this.cache.delete(instanceName);
      if (instanceDbId) await this.cache.delete(instanceDbId);
    }

    if (this.providerSession?.ENABLED) {
      await this.providerFiles.removeSession(instanceName);
    }
  }

  public async cleaningStoreData(instanceName: string) {
    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
      execSync(`rm -rf ${join(STORE_DIR, 'chatwoot', instanceName + '*')}`);
    }

    const instance = await this.prismaRepository.instance.findFirst({ where: { name: instanceName } });
    if (!instance) return;

    rmSync(join(INSTANCE_DIR, instance.id), { recursive: true, force: true });

    await this.prismaRepository.session.deleteMany({ where: { sessionId: instance.id } });
    await this.prismaRepository.chat.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.contact.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.messageUpdate.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.message.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.webhook.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.chatwoot.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.proxy.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.rabbitmq.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.sqs.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.integrationSession.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.typebot.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.websocket.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.setting.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.label.deleteMany({ where: { instanceId: instance.id } });
    await this.prismaRepository.instance.delete({ where: { name: instanceName } });
  }

  public async loadInstance() {
    try {
      if (this.providerSession?.ENABLED) {
        await this.loadInstancesFromProvider();
      } else if (this.db.SAVE_DATA.INSTANCE) {
        await this.loadInstancesFromDatabasePostgres();
      } else if (this.redis.REDIS.ENABLED && this.redis.REDIS.SAVE_INSTANCES) {
        await this.loadInstancesFromRedis();
      }
    } catch (error) {
      this.logger.error(error);
    }
  }

  public async saveInstance(data: any) {
    try {
      const clientName = this.configService.get<Database>('DATABASE').CONNECTION.CLIENT_NAME;
      await this.prismaRepository.instance.create({
        data: {
          id: data.instanceId,
          name: data.instanceName,
          ownerJid: data.ownerJid,
          profileName: data.profileName,
          profilePicUrl: data.profilePicUrl,
          connectionStatus: data.integration === Integration.WHATSAPP_BAILEYS ? 'close' : data.status ?? 'open',
          number: data.number,
          integration: data.integration || Integration.WHATSAPP_BAILEYS,
          token: data.hash,
          clientName,
          businessId: data.businessId,
        },
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  public deleteInstance(instanceName: string) {
    try {
      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
    } catch (error) {
      this.logger.error(error);
    }
  }

  private async setInstance(instanceData: InstanceDto) {
    const instance = channelController.init(instanceData, {
      configService: this.configService,
      eventEmitter: this.eventEmitter,
      prismaRepository: this.prismaRepository,
      cache: this.cache,
      chatwootCache: this.chatwootCache,
      baileysCache: this.baileysCache,
      providerFiles: this.providerFiles,
    });

    if (!instance) return;

    instance.setInstance({
      instanceId: instanceData.instanceId,
      instanceName: instanceData.instanceName,
      integration: instanceData.integration,
      token: instanceData.token,
      number: instanceData.number,
      businessId: instanceData.businessId,
    });

    await instance.connectToWhatsapp();
    this.waInstances[instanceData.instanceName] = instance;
  }

  private async loadInstancesFromRedis() {
    const keys = await this.cache.keys();
    if (!keys?.length) return;

    await Promise.all(
      keys.map(async (k) => {
        const id = k.split(':')[1];
        const name = k.split(':')[2];
        const data = await this.prismaRepository.instance.findUnique({ where: { id } });
        if (data) {
          await this.setInstance({
            instanceId: id,
            instanceName: name,
            integration: data.integration,
            token: data.token,
            number: data.number,
            businessId: data.businessId,
          });
        }
      }),
    );
  }

  private async loadInstancesFromDatabasePostgres() {
    const clientName = this.configService.get<Database>('DATABASE').CONNECTION.CLIENT_NAME;
    const instances = await this.prismaRepository.instance.findMany({ where: { clientName } });
    if (!instances.length) return;

    await Promise.all(
      instances.map(async (i) => {
        await this.setInstance({
          instanceId: i.id,
          instanceName: i.name,
          integration: i.integration,
          token: i.token,
          number: i.number,
          businessId: i.businessId,
        });
      }),
    );
  }

  private async loadInstancesFromProvider() {
    const [instances] = await this.providerFiles.allInstances();
    if (!instances?.data?.length) return;

    await Promise.all(
      instances.data.map(async (id: string) => {
        const data = await this.prismaRepository.instance.findUnique({ where: { id } });
        if (data) {
          await this.setInstance({
            instanceId: data.id,
            instanceName: data.name,
            integration: data.integration,
            token: data.token,
            businessId: data.businessId,
          });
        }
      }),
    );
  }

  private removeInstance() {
    this.eventEmitter.on('remove.instance', async (instanceName: string) => {
      try {
        await this.waInstances[instanceName]?.sendDataWebhook(Events.REMOVE_INSTANCE, null);
        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
      } catch (e) {
        this.logger.warn(`Instance "${instanceName}" - REMOVED`);
      } finally {
        delete this.waInstances[instanceName];
      }
    });

    this.eventEmitter.on('logout.instance', async (instanceName: string) => {
      try {
        await this.waInstances[instanceName]?.sendDataWebhook(Events.LOGOUT_INSTANCE, null);
        if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
          this.waInstances[instanceName]?.clearCacheChatwoot();
        }
        await this.cleaningUp(instanceName);
      } catch (e) {
        this.logger.warn(`Instance "${instanceName}" - LOGOUT`);
      }
    });
  }

  private noConnection() {
    this.eventEmitter.on('no.connection', async (instanceName) => {
      try {
        const current = this.waInstances[instanceName];
        await current?.client?.logout('Log out instance: ' + instanceName);
        current?.client?.ws?.close();
        if (current?.instance) current.instance.qrcode = { count: 0 };
        if (current?.stateConnection) current.stateConnection.state = 'close';
      } catch (error) {
        this.logger.error({
          localError: 'noConnection',
          warn: 'Error deleting instance from memory.',
          error,
        });
      } finally {
        this.logger.warn(`Instance "${instanceName}" - NOT CONNECTION`);
      }
    });
  }
}
