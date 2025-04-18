import { EventEmitter2 } from 'eventemitter2';
import { ConfigService } from '@config/env.config';
import { PrismaRepository } from '@api/repository/repository.service';
import { ProviderFiles } from '@api/provider/sessions';
import { ChatwootService } from '@api/integrations/chatbot/chatwoot';
import { CacheService } from '@api/services/cache.service';
import { ProxyService } from '@api/services/proxy.service';
import { SettingsService } from '@api/services/settings.service';

interface WAMonitoringProps {
  eventEmitter: EventEmitter2;
  configService: ConfigService;
  prismaRepository: PrismaRepository;
  providerFiles: ProviderFiles;
  chatwootService: ChatwootService;
  cacheService: CacheService;
  proxyService?: ProxyService;
  settingsService?: SettingsService;
}

export class WAMonitoringService {
  public waInstances: Record<string, any> = {};

  public readonly eventEmitter: EventEmitter2;
  public readonly configService: ConfigService;
  public readonly prismaRepository: PrismaRepository;
  public readonly providerFiles: ProviderFiles;
  public readonly chatwootService: ChatwootService;
  public readonly cacheService: CacheService;
  public settingsService?: SettingsService;
  public proxyService?: ProxyService;

  constructor(props: WAMonitoringProps) {
    this.eventEmitter = props.eventEmitter;
    this.configService = props.configService;
    this.prismaRepository = props.prismaRepository;
    this.providerFiles = props.providerFiles;
    this.chatwootService = props.chatwootService;
    this.cacheService = props.cacheService;
    this.settingsService = props.settingsService;
    this.proxyService = props.proxyService;
  }

  saveInstance(instance: any): Promise<void> {
    console.log('[MOCK] saveInstance', instance);
    return Promise.resolve();
  }

  set(instanceName: string, instance: any): void {
    console.log('[MOCK] set instance', instanceName);
    this.waInstances[instanceName] = {
      ...instance,
      setSettings: (data: any) => {
        console.log(`[MOCK] setSettings para ${instanceName}`, data);
        this.waInstances[instanceName].settings = data;
      },
      findSettings: () => {
        console.log(`[MOCK] findSettings para ${instanceName}`);
        return Promise.resolve(this.waInstances[instanceName].settings || {});
      },
      setProxy: (data: any) => {
        console.log(`[MOCK] setProxy para ${instanceName}`, data);
        this.waInstances[instanceName].proxy = data;
      },
      findProxy: () => {
        console.log(`[MOCK] findProxy para ${instanceName}`);
        return Promise.resolve(this.waInstances[instanceName].proxy || {});
      },
    };
  }

  get(instanceName: string): any {
    console.log('[MOCK] get instance', instanceName);
    return {
      ...this.waInstances[instanceName],
      instanceId: instanceName,
      connectionStatus: { state: 'open' },
      qrCode: 'mock-qr',
      logoutInstance: () => console.log('[MOCK] logout'),
      setPresence: (data: any) => console.log('[MOCK] setPresence', data),
      connectToWhatsapp: () => Promise.resolve(),
      sendDataWebhook: () => {},
    };
  }

  remove(instanceName: string): void {
    console.log('[MOCK] remove instance', instanceName);
    delete this.waInstances[instanceName];
  }

  delInstanceTime(instanceName: string): void {
    console.log('[MOCK] delInstanceTime', instanceName);
  }

  // >>> ADICIONE O MÉTODO MOCKADO AQUI <<<
  async createInstance(instanceData: any, _deps: any): Promise<any> {
    // Mock para criar uma instância (substitua posteriormente pelo código Evolution real)
    const instance = {
      instanceId: instanceData.instanceName ?? `instance-${Date.now()}`,
      qrCode: 'mock-qr-base64-ou-url-AQUI', // Coloque base64 real depois!
      connectionStatus: { state: 'connecting' },
      ...instanceData,
    };
    this.set(instance.instanceId, instance);

    // Simule delay ou processamento se desejar:
    await new Promise(res => setTimeout(res, 500));

    return instance;
  }
}
