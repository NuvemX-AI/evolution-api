/* src/api/server.module.ts
   --------------------------------------------------------------------- */
import 'express-async-errors';
import { Router }                 from 'express';
import fs                         from 'fs';
import path                       from 'path';
import mimeTypes                  from 'mime-types';

/* aliases declarados no tsconfig */
import { HttpStatus }             from '@constants/http-status';
import { configService }          from '@config/env.config';
import { CacheEngine }            from '@cache/cacheengine';
import { CacheService }           from '@services/cache.service';
import { WAMonitoringService }    from '@services/wa-monitoring.service';
import { PrismaRepository }       from '@api/repository/repository.service';

import { instanceExistsGuard,
         instanceLoggedGuard }    from './guards/instance.guard';
import Telemetry                  from './guards/telemetry.guard';

/* rotas / providers */
import { ProviderFiles }          from './provider/sessions';
import { ChatwootService }        from './integrations/chatbot/chatwoot';
import { ChannelRouter }          from './integrations/channel/channel.router';
import { InstanceRouter }         from './routes/instance.router';
import { MessageRouter }          from './routes/sendMessage.router';

/* -------------------------------------------------------------------- */
/*  INSTÂNCIAS COMPARTILHADAS                                            */
const cacheInstance      = new CacheService(
  new CacheEngine(configService, 'evolution').getEngine(),
);

const prismaRepository   = new PrismaRepository(configService);

const waMonitor          = new WAMonitoringService({
  eventEmitter    : null as any,          // (troque pelo EventEmitter2 se/quando precisar)
  configService,
  prismaRepository,
  providerFiles   : new ProviderFiles(configService),
  chatwootService : new ChatwootService(),
  settingsService : null as any,
  proxyService    : null as any,
  cacheService    : cacheInstance,
});

/* -------------------------------------------------------------------- */
/*  ROTAS                                                                 */
const router: Router   = Router();
const guards           = [instanceExistsGuard, instanceLoggedGuard];
const telemetry        = new Telemetry();
const pkg              = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

/* assets do manager */
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

/* API pública */
router
  .use((req, res, next) => telemetry.collectTelemetry(req, res, next))

  .get('/', (_req, res) => {
    res.status(HttpStatus.OK).json({
      status      : HttpStatus.OK,
      message     : 'Welcome to Evolution-API. It’s alive! 🚀',
      version     : pkg.version,
      clientName  : process.env.DATABASE_CONNECTION_CLIENT_NAME,
      documentation: 'https://doc.evolution-api.com',
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

  /* rotas que exigem instanceName + guards */
  .use('/instance', new InstanceRouter(configService, ...guards).router)
  .use('/message' , new MessageRouter(waMonitor, ...guards).router)
  .use(''         , new ChannelRouter(configService, ...guards).router);

/* -------------------------------------------------------------------- */
export { router, waMonitor, prismaRepository };
