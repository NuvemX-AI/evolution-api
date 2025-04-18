import { PusherRouter } from './pusher/pusher.router';
import { RabbitmqRouter } from './rabbitmq/rabbitmq.router';
import { SqsRouter } from './sqs/sqs.router';
import { WebhookRouter } from './webhook/webhook.router';
import { WebsocketRouter } from './websocket/websocket.router';
import { Router } from 'express';

export class EventRouter {
  public readonly router: Router;

  constructor(configService: any, ...guards: any[]) {
    this.router = Router();

    this.router.use('/webhook', new WebhookRouter(configService, ...guards).router);
    this.router.use('/websocket', new WebsocketRouter(...guards).router);
    this.router.use('/rabbitmq', new RabbitmqRouter(...guards).router);
    this.router.use('/pusher', new PusherRouter(...guards).router);
    this.router.use('/sqs', new SqsRouter(...guards).router);
  }
}
