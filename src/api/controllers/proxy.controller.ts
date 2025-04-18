import { InstanceDto } from '../dto/instance.dto';
import { ProxyDto } from '../dto/proxy.dto';
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { ProxyService } from '../services/proxy.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '../../common/exceptions';
import { makeProxyAgent } from '../../utils/makeProxyAgent';
import axios from 'axios';

const logger = new Logger('ProxyController');

export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private readonly waMonitor: WAMonitoringService,
  ) {}

  public async createProxy(
    instance: InstanceDto,
    data: ProxyDto,
  ): Promise<any> { // Ajuste o tipo se souber o retorno do proxyService.create
    const target = this.waMonitor.waInstances?.[instance.instanceName];
    if (!target) {
      throw new NotFoundException(`The "${instance.instanceName}" instance does not exist`);
    }

    if (!data?.enabled) {
      data.host = '';
      data.port = '';
      data.protocol = '';
      data.username = '';
      data.password = '';
    }

    if (data.host && data.host.length > 0) {
      const testProxy = await this.testProxy(data);
      if (!testProxy) {
        throw new BadRequestException('Invalid proxy');
      }
    }

    return this.proxyService.create(instance, data);
  }

  public async findProxy(instance: InstanceDto): Promise<any> {
    const target = this.waMonitor.waInstances?.[instance.instanceName];
    if (!target) {
      throw new NotFoundException(`The "${instance.instanceName}" instance does not exist`);
    }

    return this.proxyService.find(instance);
  }

  public async testProxy(proxy: ProxyDto): Promise<boolean> {
    try {
      const serverIp = await axios.get('https://icanhazip.com/');
      const response = await axios.get('https://icanhazip.com/', {
        httpsAgent: makeProxyAgent(proxy),
      });

      return response?.data?.trim() !== serverIp?.data?.trim();
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.data) {
        logger.error('testProxy error: ' + error.response.data);
      } else {
       logger.error(`testProxy error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  }
}
