import { RouterBroker } from '../../../abstract/abstract.router';
import { InstanceDto } from '../../../dto/instance.dto';
import { EventDto } from '../event.dto';
import { HttpStatus } from '../../../routes/index.router';
import { eventManager } from '../../../server.module';
import { instanceSchema, pusherSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';
export class PusherRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('set'), ...guards, async (req, res) => {
        const response = await this.dataValidate<EventDto>({
          request: req,
          schema: pusherSchema,
          ClassRef: EventDto,
          execute: (instance, data) => eventManager.pusher.set(instance.instanceName, data),
        });
        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => eventManager.pusher.get(instance.instanceName),
        });
        res.status(HttpStatus.OK).json(response);
      });
  }
  public readonly router: Router = Router();
}
