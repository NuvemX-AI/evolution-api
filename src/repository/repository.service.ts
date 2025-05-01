/* src/repository/repository.service.ts
 * -------------------------------------------------------------------------- */

import { PrismaClient } from '@prisma/client';

/**  
 * Estrutura de paginação / busca que vários controllers importam como `Query`.
 * Ajuste livremente (ou adicione campos) se vir necessidade depois.
 */
export interface Query {
  page?: number;       // página (1 … n)
  limit?: number;      // itens por página
  search?: string;     // termo de busca textual
  orderBy?: string;    // campo de ordenação
  sort?: 'asc' | 'desc';
}

/**
 * Repositório principal que encapsula o Prisma Client.
 * Se, no futuro, você precisar ler algo do seu ConfigService,
 * basta tipar o parâmetro e usar internamente; por ora não é obrigatório.
 */
export class PrismaRepository {
  /** Prisma Client compartilhado em toda a app */
  public readonly prisma: PrismaClient;

  constructor(private readonly configService?: any) {
    this.prisma = new PrismaClient();
    // coloque aqui qualquer log ou inicialização extra, se quiser
  }

  /** Encapsula disconnect para quem precisar fechar a conexão manualmente */
  async $disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /* --------------------- helpers opcionais --------------------- */

  /** Constrói objeto skip/take a partir de Query genérico */
  buildPagination(params: Query = {}) {
    const page  = Number(params.page)  || 1;
    const limit = Number(params.limit) || 25;
    return { skip: (page - 1) * limit, take: limit };
  }
}

/* Exporta uma instância singleton caso queira usar direto */
export const prismaRepository = new PrismaRepository();
