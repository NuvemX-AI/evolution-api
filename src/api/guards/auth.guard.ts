import { Request, Response, NextFunction } from 'express';
import { PrismaRepository } from '../repository/repository.service';
import { HttpStatus } from '../constants/http-status';

export async function validarInstancia(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(HttpStatus.UNAUTHORIZED).json({
      status: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      response: {
        message: ['Token de autenticação ausente.'],
      },
    });
  }

  try {
    const prismaRepository = req.app.get('prismaRepository') as PrismaRepository;

    const instance = await prismaRepository.instance.findFirst({
      where: { token },
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

    req['instance'] = instance;
    next();
  } catch (error) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Erro interno no servidor',
      response: {
        message: ['Erro ao validar token.'],
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export const authGuard = validarInstancia;
