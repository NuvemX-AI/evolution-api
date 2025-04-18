import { RouterBroker } from '../abstract/abstract.router';
import { OfferCallDto } from '../dto/call.dto';
import { callController } from '../server.module';
import { offerCallSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class CallRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router.post(this.routerPath('offer'), ...guards, async (req, res) => {
      const response = await this.dataValidate<OfferCallDto>({
        request: req,
        schema: offerCallSchema,
        ClassRef: OfferCallDto,
        execute: (instance, data) => callController.offerCall(instance, data),
      });

      return res.status(HttpStatus.CREATED).json(response);
    });
  }

  public readonly router: Router = Router();
}
