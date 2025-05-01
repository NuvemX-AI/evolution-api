import { ConfigService, Database } from '@config/env.config';
import { ROOT_DIR } from '@config/path.config';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Resultado padrão para operações que escrevem no disco ou BD */
export interface IInsert {
  insertCount: number;
}

/**
 * Contrato mínimo para repositórios
 * • Todos recebem/retornam genéricos, permitindo reutilização
 */
export interface IRepository {
  insert<T = unknown>(data: T, instanceName: string, saveDb?: boolean): Promise<IInsert>;
  update<T = unknown>(data: T, instanceName: string, saveDb?: boolean): Promise<IInsert>;
  find<T = unknown>(query: any): Promise<T | null>;
  delete(query: any, force?: boolean): Promise<any>;

  /** Configurações de BD, injetadas via ConfigService */
  dbSettings: Database;

  /** Caminho físico onde persistimos arquivos .json */
  readonly storePath: string;
}

type WriteStore<U> = {
  path: string;
  fileName: string;
  data: U;
};

export abstract class Repository implements IRepository {
  constructor(configService: ConfigService) {
    this.dbSettings = configService.get<Database>('DATABASE');
  }

  dbSettings: Database;
  readonly storePath = join(ROOT_DIR, 'store');

  /** Persistência em arquivo local – útil para mocks e fallback */
  public writeStore = <T = unknown>(create: WriteStore<T>) => {
    if (!existsSync(create.path)) {
      mkdirSync(create.path, { recursive: true });
    }
    try {
      writeFileSync(
        join(create.path, `${create.fileName}.json`),
        JSON.stringify({ ...create.data }),
        { encoding: 'utf-8' }
      );

      return { message: 'create – success' };
    } finally {
      // Evita manter referência em memória
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      create.data = undefined;
    }
  };

  // Métodos a serem implementados nos repositórios concretos
  abstract insert<T = unknown>(data: T, instanceName: string, saveDb?: boolean): Promise<IInsert>;
  abstract update<T = unknown>(data: T, instanceName: string, saveDb?: boolean): Promise<IInsert>;
  abstract find<T = unknown>(query: any): Promise<T | null>;
  abstract delete(query: any, force?: boolean): Promise<any>;
}
