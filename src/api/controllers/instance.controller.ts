console.log('========== LOADING FILE: instance.controller.ts ==========');
import { InstanceDto, SetPresenceDto } from '../dto/instance.dto';
import { ChatwootService } from '../integrations/chatbot/chatwoot';
import { ProviderFiles } from '../provider/sessions';
import { PrismaRepository } from '../repository/repository.service';
// import { channelController } from '../server.module'; // Se comentar, mantenha relativo
import { CacheService } from '../services/cache.service';
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { SettingsService } from '../services/settings.service';
import { Events, Integration, wa } from '../types/wa.types';
import { Logger } from '@config/logger.config';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../common/exceptions'; // Corrigido o caminho
import { delay } from 'baileys';
import { EventEmitter2 } from 'eventemitter2';
import { v4 } from 'uuid';
import { ProxyController } from './proxy.controller';

export class InstanceController {
  private readonly logger = new Logger('InstanceController');

  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly chatwootService: ChatwootService,
    private readonly settingsService: SettingsService,
    private readonly proxyService: ProxyController,
    private readonly cache: CacheService,
    private readonly chatwootCache: CacheService,
    private readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles
  ) {}

  public async createInstance(instanceData: InstanceDto) {
    try {
      // Cria/obtém a instância pelo monitor Evolution (Baileys)
      // Adapte para chamar o seu 'EvolutionController' caso exista!
      const instance = await this.waMonitor.createInstance(instanceData, {
        configService: this.configService,
        eventEmitter: this.eventEmitter,
        prismaRepository: this.prismaRepository,
        cache: this.cache,
        chatwootCache: this.chatwootCache,
        baileysCache: this.baileysCache,
        providerFiles: this.providerFiles,
      });

      if (!instance) throw new BadRequestException('Falha ao criar instância WhatsApp (Evolution)');

      return {
        status: 'SUCCESS',
        error: false,
        response: {
          instanceName: instanceData.instanceName,
          instanceId: instance.instanceId,
          qrCode: instance.qrCode || null,
          connectionState: instance.connectionStatus?.state || 'unknown',
        },
      };
    } catch (error: any) {
      this.waMonitor.remove(instanceData.instanceName);
      this.logger.error(error?.message || error);
      throw new BadRequestException(error?.message || 'Unknown error');
    }
  }

  public async connectToWhatsapp({ instanceName, number = null }: InstanceDto) {
    const instance = this.waMonitor.get(instanceName);
    const state = instance?.connectionStatus?.state;

    if (!state) throw new BadRequestException(`The "${instanceName}" instance does not exist`);

    if (state === 'open') return this.connectionState({ instanceName });
    if (state === 'connecting') return instance.qrCode;

    if (state === 'close') {
      await instance.connectToWhatsapp?.(number);
      await delay(2000);
      return instance.qrCode;
    }

    return {
      instance: { instanceName, status: state },
      qrcode: instance?.qrCode,
    };
  }

  public async connectionState({ instanceName }: InstanceDto) {
    return {
      instance: {
        instanceName,
        state: this.waMonitor.get(instanceName)?.connectionStatus?.state,
      },
    };
  }

  public async logout({ instanceName }: InstanceDto) {
    const { instance } = await this.connectionState({ instanceName });

    if (instance?.state === 'close') {
      throw new BadRequestException(`The "${instanceName}" instance is not connected`);
    }

    try {
      this.waMonitor.get(instanceName)?.logoutInstance?.();
      return { status: 'SUCCESS', error: false, response: { message: 'Instance logged out' } };
    } catch (error: any) {
      throw new InternalServerErrorException(error?.message || error);
    }
  }

  public async deleteInstance({ instanceName }: InstanceDto) {
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new BadRequestException(`Instance "${instanceName}" not found`);

      if (['open', 'connecting'].includes(instance.connectionStatus?.state)) {
        await this.logout({ instanceName });
      }

      instance.sendDataWebhook?.(Events.INSTANCE_DELETE, {
        instanceName,
        instanceId: instance.instanceId,
      });

      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      this.waMonitor.remove(instanceName);

      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
    } catch (error: any) {
      throw new BadRequestException(error?.message || error);
    }
  }

  public async setPresence({ instanceName }: InstanceDto, data: SetPresenceDto) {
    return this.waMonitor.get(instanceName)?.setPresence?.(data);
  }
}
