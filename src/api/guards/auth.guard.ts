import { Request, Response, NextFunction } from 'express';
// CORREÇÃO TS2307: Ajustado o caminho relativo para encontrar o repositório
import { PrismaRepository } from '../../repository/repository.service';
// Verificar se HttpStatus está definido em '../constants/http-status' ou se precisa ajustar o path
import { HttpStatus } from '../constants/http-status';
import { Instance } from '@prisma/client'; // Importar o tipo Instance do Prisma

// Definir um tipo mais específico para a propriedade 'instance' adicionada ao Request
declare global {
  namespace Express {
    interface Request {
      instance?: Instance; // Ou o tipo correto retornado pelo Prisma
    }
  }
}


export async function validarInstancia(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> { // Adicionado tipo de retorno
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null; // Verifica o prefixo Bearer

  if (!token) {
    return res.status(HttpStatus.UNAUTHORIZED).json({
      status: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      response: {
        message: ['Token de autenticação ausente ou mal formatado (esperado Bearer Token).'],
      },
    });
  }

  try {
    // Obter a instância do repositório (assumindo que foi injetada no app)
    const prismaRepository = req.app.get('prismaRepository') as PrismaRepository;
    if (!prismaRepository) {
        console.error("Erro Crítico: PrismaRepository não encontrado na instância do app Express. Verifique a configuração em main.ts/server.module.ts.");
        throw new Error("Configuração interna do servidor inválida.");
    }

    const instance = await prismaRepository.instance.findFirst({
      where: { token }, // Busca pelo token diretamente
    });

    if (!instance) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        status: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        response: {
          message: ['Token inválido ou instância não encontrada.'],
        },
      });
    }

    // Adiciona a instância encontrada ao objeto req para uso posterior nas rotas/controllers
    req.instance = instance;
    next(); // Prossegue para a próxima função de middleware/rota
  } catch (error) {
    console.error("Erro durante validação da instância:", error); // Log detalhado do erro
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Erro interno no servidor',
      response: {
        message: ['Erro ao validar token da instância.'],
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

// Exporta a função como 'authGuard' para uso como middleware
export const authGuard = validarInstancia;

// Remover chave extra no final, se houver
