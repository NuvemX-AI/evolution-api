import { ICache } from '@api/abstract/abstract.cache';
import { CacheConf, ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';

import { LocalCache } from './localcache';
import { RedisCache } from './rediscache';

const logger = new Logger('CacheEngine');

export class CacheEngine implements ICache {
  private engine: ICache;

  constructor(
    private readonly configService: ConfigService,
    module: string,
  ) {
    const cacheConf = configService.get<CacheConf>('CACHE');

    if (cacheConf?.REDIS?.ENABLED && cacheConf?.REDIS?.URI !== '') {
      logger.verbose(`RedisCache initialized for ${module}`);
      this.engine = new RedisCache(configService, module);
    } else if (cacheConf?.LOCAL?.ENABLED) {
      logger.verbose(`LocalCache initialized for ${module}`);
      this.engine = new LocalCache(configService, module);
    } else {
      throw new Error('Nenhum mecanismo de cache habilitado nas configurações.');
    }
  }

  public getEngine(): ICache {
    return this.engine;
  }

  async get(key: string): Promise<any> {
    return this.engine.get(key);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.engine.set(key, value, ttl);
  }

  async has(key: string): Promise<boolean> {
    return this.engine.has(key);
  }

  async delete(key: string): Promise<number> {
    return this.engine.delete(key);
  }

  async keys(appendCriteria?: string): Promise<string[]> {
    return this.engine.keys(appendCriteria);
  }

  async deleteAll(appendCriteria?: string): Promise<number> {
    return this.engine.deleteAll(appendCriteria);
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.engine.hGet(key, field);
  }

  async hSet(key: string, field: string, value: string): Promise<void> {
    return this.engine.hSet(key, field, value);
  }

  async hDelete(key: string, field: string): Promise<void> {
    return this.engine.hDelete(key, field);
  }
}
