import { InstanceDto } from '@api/dto/instance.dto';
import { ProxyDto } from '@api/dto/proxy.dto';
import { Logger } from '@config/logger.config';
import { Proxy } from '@prisma/client';
import { WAMonitoringService } from './wa-monitoring.service';

export class ProxyService {
  private readonly logger = new Logger('ProxyService');

  constructor(private readonly waMonitor: WAMonitoringService) {
    if (!waMonitor) {
      this.logger.error('❌ ProxyService: WAMonitoringService not provided');
      throw new Error('WAMonitoringService is required');
    }
  }

  public create(instance: InstanceDto, data: ProxyDto) {
    const target = this.waMonitor.waInstances?.[instance.instanceName];
    if (!target || typeof target.setProxy !== 'function') {
      this.logger.error(`❌ ProxyService: Instance "${instance.instanceName}" not found or setProxy not available`);
      return null;
    }

    target.setProxy(data);
    return { proxy: { ...instance, proxy: data } };
  }

  public async find(instance: InstanceDto): Promise<Proxy | null> {
    try {
      const target = this.waMonitor.waInstances?.[instance.instanceName];
      if (!target || typeof target.findProxy !== 'function') {
        this.logger.error(`❌ ProxyService: Instance "${instance.instanceName}" not found or findProxy not available`);
        return null;
      }

      const result = await target.findProxy();

      if (!result || Object.keys(result).length === 0) {
        throw new Error('Proxy not found');
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ ProxyService.find: ${error?.message || error}`);
      return null;
    }
  }
}
