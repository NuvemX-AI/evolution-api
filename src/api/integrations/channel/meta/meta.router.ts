// src/api/integrations/channel/meta/meta.router.ts

import { RouterBroker } from '../../../abstract/abstract.router';
import { ConfigService } from '@config/env.config';
import { Router } from 'express';

export class MetaRouter extends RouterBroker {
  constructor(readonly configService: ConfigService) {
    super();

    this.router.post(this.routerPath('webhook/meta', false), async (req, res) => {
      const { body } = req;

      const response = {
        success: true,
        message: 'Webhook Meta recebido com sucesso (mock)',
        data: body,
      };

      return res.status(200).json(response);
    });
  }

  public readonly router: Router = Router();
}
