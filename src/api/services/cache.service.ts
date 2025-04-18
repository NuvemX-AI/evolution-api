import { ICache } from '@api/abstract/abstract.cache';
import { Logger } from '@config/logger.config';
import { BufferJSON } from 'baileys';

class DefaultCache implements ICache {
  private store = new Map<string, any>();

  async get(key: string): Promise<any> {
    return this.store.get(key);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    this.store.set(key, value);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async delete(key: string): Promise<number> {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  async keys(appendCriteria?: string): Promise<string[]> {
    return Array.from(this.store.keys()).filter(k => k.includes(appendCriteria || ''));
  }

  async deleteAll(appendCriteria?: string): Promise<number> {
    const keys = await this.keys(appendCriteria);
    keys.forEach(k => this.store.delete(k));
    return keys.length;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const data = this.store.get(key);
    return data?.[field] ?? null;
  }

  async hSet(key: string, field: string, value: string): Promise<void> {
    if (!this.store.has(key)) this.store.set(key, {});
    this.store.get(key)[field] = value;
  }

  async hDelete(key: string, field: string): Promise<void> {
    const data = this.store.get(key);
    if (data) delete data[field];
  }
}

export class CacheService {
  private readonly logger = new Logger('CacheService');

  constructor(private readonly cache: ICache = new DefaultCache()) {
    if (cache) {
      this.logger.verbose(`cacheservice created using cache engine: ${cache.constructor?.name}`);
    } else {
      this.logger.verbose(`cacheservice disabled`);
    }
  }

  async get(key: string): Promise<any> {
    if (!this.cache) return;
    return this.cache.get(key);
  }

  async set(key: string, value: any, ttl?: number) {
    if (!this.cache) return;
    return this.cache.set(key, value, ttl);
  }

  async has(key: string): Promise<boolean> {
    if (!this.cache) return false;
    return this.cache.has(key);
  }

  async delete(key: string): Promise<number> {
    if (!this.cache) return 0;
    return this.cache.delete(key);
  }

  async keys(appendCriteria?: string) {
    if (!this.cache) return;
    return this.cache.keys(appendCriteria);
  }

  async deleteAll(appendCriteria?: string): Promise<number> {
    if (!this.cache) return 0;
    return this.cache.deleteAll(appendCriteria);
  }

  async hGet(key: string, field: string) {
    if (!this.cache) return null;
    try {
      const data = await this.cache.hGet(key, field);
      return data ? JSON.parse(data, BufferJSON.reviver) : null;
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  async hSet(key: string, field: string, value: any) {
    if (!this.cache) return;
    try {
      const json = JSON.stringify(value, BufferJSON.replacer);
      await this.cache.hSet(key, field, json);
    } catch (error) {
      this.logger.error(error);
    }
  }

  async hDelete(key: string, field: string) {
    if (!this.cache) return false;
    try {
      await this.cache.hDelete(key, field);
      return true;
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }
}
