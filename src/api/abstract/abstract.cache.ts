/**
 * Contrato genérico para qualquer driver de cache
 *  – agora todos os métodos seguem a mesma convenção `Promise`,
 *   facilitando await/async no resto do código.
 */
export interface ICache {
  /** Recupera uma chave simples */
  get<T = unknown>(key: string): Promise<T | null>;

  /** Recupera um campo dentro de um hash */
  hGet<T = unknown>(key: string, field: string): Promise<T | null>;

  /** Insere/atualiza valor – agora retorna Promise para manter consistência */
  set(key: string, value: any, ttl?: number): Promise<void>;

  /** Insere/atualiza campo em hash */
  hSet(key: string, field: string, value: any): Promise<void>;

  /** Verifica existência de chave */
  has(key: string): Promise<boolean>;

  /** Lista chaves que seguem um padrão (ex.: prefixo) */
  keys(appendCriteria?: string): Promise<string[]>;

  /** Apaga 1 ou várias chaves */
  delete(key: string | string[]): Promise<number>;

  /** Remove campo específico de um hash */
  hDelete(key: string, field: string): Promise<number>;

  /** Limpa todo o cache seguindo critério opcional */
  deleteAll(appendCriteria?: string): Promise<number>;
}
