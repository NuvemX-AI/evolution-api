import { RouterBroker } from '../../../abstract/abstract.router';
import { InstanceDto } from '../../../dto/instance.dto';
import { EventDto } from '../event.dto';
import { HttpStatus } from '../../../routes/index.router';
import { eventManager } from '../../../server.module';
import { ConfigService } from '@config/env.config';
import { instanceSchema, webhookSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

export class WebhookRouter extends RouterBroker {
  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.router
      .post(this.routerPath('set'), ...guards, async (req, res) => {
        const response = await this.dataValidate<EventDto>({
          request: req,
          schema: webhookSchema,
          ClassRef: EventDto,
          execute: (instance, data) => eventManager.webhook.set(instance.instanceName, data),
        });

        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => eventManager.webhook.get(instance.instanceName),
        });

        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
