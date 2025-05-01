// src/config/config.service.ts

export class ConfigService {
  private readonly env = process.env;

  /**
   * Recupera uma variável de ambiente
   * @param key Nome da variável
   */
  get<T = any>(key: string): T {
    return this.env[key] as unknown as T;
  }
}
