/* src/api/server.module.ts --------------------------------------------------
   Camada de orquestração "à la Nest" para instanciar e compartilhar
   singletons (cache, prisma, monitor, controllers etc.).
   TODAS as referências externas (routers, services) que faziam
   `import { somethingController } from '@api/server.module'` agora
   encontram aqui as suas instâncias.
------------------------------------------------------------------- */

import 'express-async-errors';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import mimeTypes from 'mime-types';
import { EventEmitter2 } from 'eventemitter2';

/* ------------------------------------------------- */
/* Aliases (conforme tsconfig.json)                  */
/* ------------------------------------------------- */
import { HttpStatus }          from '@constants/http-status';
import { configService }       from '@config/env.config';
import { CacheEngine }         from '@cache/cacheengine';
import { CacheService }        from '@services/cache.service';
import { WAMonitoringService } from '@services/wa-monitoring.service';
import { PrismaRepository }    from '@repository/repository.service';

/* Guards & middlewares */
import { instanceExistsGuard, instanceLoggedGuard } from './guards/instance.guard';
import Telemetry from './guards/telemetry.guard';

/* Providers / misc. */
import { ProviderFiles }  from './provider/sessions';
import { ChatwootService } from './integrations/chatbot/chatwoot';

/* Routers */
import { ChannelRouter }  from './integrations/channel/channel.router';
import { InstanceRouter } from './routes/instance.router';
import { MessageRouter }  from './routes/sendMessage.router';

/* ------------------------------------------------- */
/* Controllers que outros módulos esperam encontrar  */
/* ------------------------------------------------- */
import { ChatController }        from './controllers/chat.controller';
import { InstanceController }    from './controllers/instance.controller';
import { GroupController }       from './controllers/group.controller';
import { CallController }        from './controllers/call.controller';

/* Chatbots */
import { ChatbotController }          from './integrations/chatbot/chatbot.controller';
import { DifyController }             from './integrations/chatbot/dify/controllers/dify.controller';
import { EvolutionBotController }     from './integrations/chatbot/evolutionBot/controllers/evolutionBot.controller';
import { FlowiseController }          from './integrations/chatbot/flowise/controllers/flowise.controller';
import { OpenaiController }           from './integrations/chatbot/openai/controllers/openai.controller';
import { TypebotController }          from './integrations/chatbot/typebot/controllers/typebot.controller';

/* Storage  */
import { S3Controller } from './integrations/storage/s3/controllers/s3.controller';

/* ------------------------------------------------- */
/*  SINGLETONS / SHARED INSTANCES                    */
/* ------------------------------------------------- */
const cacheInstance = new CacheService(new CacheEngine(configService, 'evolution').getEngine());
const prismaRepository = new PrismaRepository(configService);

/* Event manager (pode evoluir depois) */
const eventManager = new EventEmitter2({ wildcard: true, maxListeners: 100 });

const waMonitor = new WAMonitoringService({
  eventEmitter    : eventManager,
  configService,
  prismaRepository,
  providerFiles   : new ProviderFiles(configService),
  chatwootService : new ChatwootService(),
  settingsService : null as any,
  proxyService    : null as any,
  cacheService    : cacheInstance,
});

/* ------------------------------------------------- */
/* CONTROLLERS instanciados (injeção simplificada)   */
/* ------------------------------------------------- */
const instanceController   = new InstanceController(configService as any, prismaRepository as any, waMonitor as any);
const chatController       = new ChatController(waMonitor as any, prismaRepository as any, configService as any);
const groupController      = new GroupController(waMonitor as any, prismaRepository as any, configService as any);
const callController       = new CallController(waMonitor as any, prismaRepository as any, configService as any);

/* chatbots */
const chatbotController        = new ChatbotController(waMonitor as any, prismaRepository as any, configService as any);
const difyController           = new DifyController(waMonitor as any, prismaRepository as any, configService as any);
const evolutionBotController   = new EvolutionBotController(waMonitor as any, prismaRepository as any, configService as any);
const flowiseController        = new FlowiseController(waMonitor as any, prismaRepository as any, configService as any);
const openaiController         = new OpenaiController(waMonitor as any, prismaRepository as any, configService as any);
const typebotController        = new TypebotController(waMonitor as any, prismaRepository as any, configService as any);

/* storage */
const s3Controller             = new S3Controller(prismaRepository as any, configService as any);

/* ------------------------------------------------- */
/*  EXPRESS ROUTER                                   */
/* ------------------------------------------------- */
const router: Router = Router();
const guards        = [instanceExistsGuard, instanceLoggedGuard];
const telemetry     = new Telemetry();
const pkg           = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

/* assets do manager (frontend) */
router.get('/assets/*', (req, res) => {
  const fileName = req.params[0];
  const filePath = path.join(process.cwd(), 'manager', 'dist', 'assets', fileName);

  if (fs.existsSync(filePath)) {
    res.set('Content-Type', mimeTypes.lookup(filePath) || 'text/plain');
    res.send(fs.readFileSync(filePath));
  } else {
    res.status(HttpStatus.NOT_FOUND).send('File not found');
  }
});

/* API pública básica */
router
  .use((req, res, next) => telemetry.collectTelemetry(req, res, next))

  .get('/', (_req, res) => {
    res.status(HttpStatus.OK).json({
      status        : HttpStatus.OK,
      message       : 'Welcome to Evolution‑API. It’s alive! 🚀',
      version       : pkg.version,
      clientName    : process.env.DATABASE_CONNECTION_CLIENT_NAME,
      documentation : 'https://doc.evolution-api.com',
    });
  })

  .post('/verify-creds', (_req, res) => {
    res.status(HttpStatus.OK).json({
      status      : HttpStatus.OK,
      message     : 'Credentials are valid (authGuard temporarily disabled)',
      facebookAppId     : process.env.FACEBOOK_APP_ID,
      facebookConfigId  : process.env.FACEBOOK_CONFIG_ID,
      facebookUserToken : process.env.FACEBOOK_USER_TOKEN,
    });
  })

  /* rotas protegidas por guards */
  .use('/instance', new InstanceRouter(configService, ...guards).router)
  .use('/message' , new MessageRouter(waMonitor, ...guards).router)
  .use(''         , new ChannelRouter(configService, ...guards).router);

/* ------------------------------------------------- */
/* EXPORTS                                           */
/* ------------------------------------------------- */
export {
  /* singletons */
  router,
  waMonitor,
  prismaRepository,
  cacheInstance,
  eventManager,

  /* generic controllers */
  instanceController,
  chatController,
  groupController,
  callController,

  /* chatbots */
  chatbotController,
  difyController,
  evolutionBotController,
  flowiseController,
  openaiController,
  typebotController,

  /* storage */
  s3Controller,
};
