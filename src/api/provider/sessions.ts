import { Auth, ConfigService, ProviderSession } from '@config/env.config';
import { Logger } from '@config/logger.config';
import axios from 'axios';
import { execSync } from 'child_process';

type ResponseSuccess = { status: number; data?: any };
type ResponseProvider = Promise<ResponseSuccess | { error: any }>;

export class ProviderFiles {
  private readonly logger = new Logger('ProviderFiles');
  private readonly config: ProviderSession;
  private readonly baseUrl: string;
  private readonly globalApiToken: string;

  constructor(private readonly configService: ConfigService) {
    this.config = Object.freeze(this.configService.get<ProviderSession>('PROVIDER'));
    this.baseUrl = `http://${this.config.HOST}:${this.config.PORT}/session/${this.config.PREFIX}`;
    this.globalApiToken = this.configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
  }

  get isEnabled() {
    return !!this.config?.ENABLED;
  }

  public async onModuleInit() {
    if (!this.config.ENABLED) return;

    const url = `http://${this.config.HOST}:${this.config.PORT}`;
    try {
      const response = await axios.options(url + '/ping');
      if (response?.data !== 'pong') {
        throw new Error('Offline file provider.');
      }
    } catch (error: any) {
      try {
        await axios.post(`${url}/session`, { group: this.config.PREFIX }, {
          headers: { apikey: this.globalApiToken }
        });
      } catch {}

      this.logger.error(`[Failed to connect to the file server] ${error?.message}\n${error?.stack}`);
      execSync(`kill -9 ${process.pid}`);
    }
  }

  public async onModuleDestroy() {
    // Placeholder para encerramento
  }

  public async create(instance: string, key: any): ResponseProvider {
    try {
      const response = await axios.post(`${this.baseUrl}/${instance}`, key, {
        headers: { apikey: this.globalApiToken }
      });
      return { status: response.status, data: response.data };
    } catch (error: any) {
      return {
        status: error?.response?.status,
        data: error?.response?.data,
        error,
      };
    }
  }

  public async allInstances(): ResponseProvider {
    try {
      const response = await axios.get(`${this.baseUrl}/list-instances`, {
        headers: { apikey: this.globalApiToken }
      });
      return { status: response.status, data: response.data as string[] };
    } catch (error: any) {
      return {
        status: error?.response?.status,
        data: error?.response?.data,
        error,
      };
    }
  }

  public async removeSession(instance: string): ResponseProvider {
    try {
      const response = await axios.delete(`${this.baseUrl}/${instance}`, {
        headers: { apikey: this.globalApiToken }
      });
      return { status: response.status, data: response.data };
    } catch (error: any) {
      return {
        status: error?.response?.status,
        data: error?.response?.data,
        error,
      };
    }
  }
}
