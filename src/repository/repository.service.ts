/* src/repository/repository.service.ts
 * -------------------------------------------------------------------------- */

import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@config/config.service'; // Adicionado import com alias

/**
 * Estrutura de paginação / busca que vários controllers importam como `Query`.
 * Ajuste livremente (ou adicione campos) se vir necessidade depois.
 */
export interface Query {
  page?: number; // página (1 … n)
  limit?: number; // itens por página
  search?: string; // termo de busca textual
  orderBy?: string; // campo de ordenação
  sort?: 'asc' | 'desc';
}

/**
 * Repositório principal que encapsula o Prisma Client.
 * Outros serviços devem injetar esta classe ou importar o singleton `prismaRepository`
 * e acessar os modelos através da propriedade `prisma`.
 * Exemplo: `this.prismaRepository.prisma.NOME_DO_MODELO.findUnique(...)`
 * ou `prismaRepository.prisma.NOME_DO_MODELO.findUnique(...)`
 */
export class PrismaRepository {
  /** Prisma Client compartilhado em toda a app */
  public readonly prisma: PrismaClient;

  // O ConfigService aqui é opcional, mas tipado corretamente se for usado.
  constructor(private readonly configService?: ConfigService) {
    this.logger.info('Initializing Prisma Client...'); // Adicionado log de inicialização
    try {
      this.prisma = new PrismaClient({
        // Você pode adicionar logs do Prisma aqui se precisar debugar queries:
        // log: ['query', 'info', 'warn', 'error'],
      });
       this.logger.info('Prisma Client initialized successfully.');
    } catch (error) {
       this.logger.error('Failed to initialize Prisma Client:', error);
       // Lançar o erro ou lidar com ele apropriadamente pode ser necessário
       throw error; // Garante que a aplicação saiba que houve um erro crítico
    }
    // coloque aqui qualquer log ou inicialização extra, se quiser
  }
  
  // Adicionado um logger para melhor depuração (ajuste o import e a instância se necessário)
  // Se você não tiver uma classe Logger global, pode usar console.log/error
  // Certifique-se de que Logger seja importado corretamente, ex: import { Logger } from '@config/logger.config';
  // Ou remova os logs se não tiver um sistema de log configurado ainda.
  private readonly logger = { // Exemplo simples de logger (substitua pela sua implementação)
      info: (message: string, ...optionalParams: any[]) => console.log(`[INFO] PrismaRepository: ${message}`, ...optionalParams),
      error: (message: string, ...optionalParams: any[]) => console.error(`[ERROR] PrismaRepository: ${message}`, ...optionalParams),
  };

  /** Encapsula disconnect para quem precisar fechar a conexão manualmente */
  async $disconnect(): Promise<void> {
    this.logger.info('Disconnecting Prisma Client...');
    await this.prisma.$disconnect();
     this.logger.info('Prisma Client disconnected.');
  }

  /* --------------------- helpers opcionais --------------------- */

  /** Constrói objeto skip/take a partir de Query genérico */
  buildPagination(params: Query = {}) {
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    // Garante que skip seja não-negativo
    const skip = (page > 0 ? page - 1 : 0) * limit; 
    return { skip: skip, take: limit };
  }
}

/* Exporta uma instância singleton caso queira usar direto */
// Removido export singleton para promover injeção de dependência, mas pode ser descomentado se necessário.
// export const prismaRepository = new PrismaRepository();
