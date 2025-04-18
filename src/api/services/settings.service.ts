import { InstanceDto } from '@api/dto/instance.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { Logger } from '@config/logger.config';
import { WAMonitoringService } from './wa-monitoring.service';

export class SettingsService {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  private readonly logger = new Logger('SettingsService');

  public async create(instance: InstanceDto, data: SettingsDto) {
    const target = this.waMonitor.get(instance.instanceName);
    if (!target) {
      this.logger.error(`Instance not found: ${instance.instanceName}`);
      throw new Error('Instance not found');
    }

    await target.setSettings(data);
    return { settings: { ...instance, settings: data } };
  }

  public async find(instance: InstanceDto): Promise<SettingsDto | null> {
    try {
      const target = this.waMonitor.get(instance.instanceName);
      if (!target) {
        this.logger.warn(`Instance not found: ${instance.instanceName}`);
        return null;
      }

      const result = await target.findSettings();
      if (!result || Object.keys(result).length === 0) {
        this.logger.warn('Settings not found');
        return null;
      }

      return result;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }
}
