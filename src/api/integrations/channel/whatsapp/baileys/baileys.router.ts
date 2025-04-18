// src/api/integrations/channel/whatsapp/baileys/baileys.router.ts

import { Router } from 'express';
import { RouterBroker } from '../../../../abstract/abstract.router';
import { HttpStatus } from '../../../constants/http-status';
import { Request, Response } from 'express';

export class BaileysRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(...guards: any[]) {
    super();

    this.router.get('/ping', ...guards, async (_req: Request, res: Response) => {
      res.status(HttpStatus.OK).json({
        status: HttpStatus.OK,
        message: 'Baileys router is alive!',
      });
    });
  }
}
