// src/api/server.module.ts

// import { authGuard } from './guards/auth.guard'; // Desativado temporariamente
import { instanceExistsGuard, instanceLoggedGuard } from './guards/instance.guard';
import Telemetry from './guards/telemetry.guard';
import { ChannelRouter } from './integrations/channel/channel.router';

import { configService, ConfigService } from '../config/env.config';
import { PrismaRepository } from './repository/repository.service';
import { WAMonitoringService } from './services/wa-monitoring.service';
import { CacheService } from './services/cache.service';
import { CacheEngine } from '../cache/cacheengine';
import { ProviderFiles } from './provider/sessions';
import { ChatwootService } from './integrations/chatbot/chatwoot';

import { Router } from 'express';
import fs from 'fs';
import mimeTypes from 'mime-types';
import path from 'path';

import { InstanceRouter } from './routes/instance.router';
import { MessageRouter } from './routes/sendMessage.router';

enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NOT_FOUND = 404,
  FORBIDDEN = 403,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  INTERNAL_SERVER_ERROR = 500,
}

// ====== MOVA A INICIALIZAÇÃO AQUI PARA FICAR ANTES DAS ROTAS ======
const cacheEngine: any = new CacheEngine(configService, 'evolution');
const cacheInstance = new CacheService(cacheEngine);

const prismaRepository = new PrismaRepository(configService);

const waMonitor = new WAMonitoringService({
  eventEmitter: null,
  configService,
  prismaRepository,
  providerFiles: new ProviderFiles(configService),
  chatwootService: new ChatwootService(),
  settingsService: null,
  proxyService: null,
  cacheService: cacheInstance,
});

// ====== ROTAS E USO DO waMonitor ======
const router: Router = Router();
const serverConfig = configService.get('SERVER');
const guards = [instanceExistsGuard, instanceLoggedGuard];
const telemetry = new Telemetry();
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

// rota de assets frontend manager
router.get('/assets/*', (req, res) => {
  const fileName = req.params[0];
  const basePath = path.join(process.cwd(), 'manager', 'dist');
  const filePath = path.join(basePath, 'assets/', fileName);

  if (fs.existsSync(filePath)) {
    res.set('Content-Type', mimeTypes.lookup(filePath) || 'text/css');
    res.send(fs.readFileSync(filePath));
  } else {
    res.status(404).send('File not found');
  }
});

router
  .use((req, res, next) => telemetry.collectTelemetry(req, res, next))
  .get('/', (req, res) => {
    res.status(HttpStatus.OK).json({
      status: HttpStatus.OK,
      message: 'Welcome to the Evolution API, it is working!',
      version: packageJson.version,
      clientName: process.env.DATABASE_CONNECTION_CLIENT_NAME,
      documentation: `https://doc.evolution-api.com`,
    });
  })
  .post('/verify-creds', async (req, res) => {
    return res.status(HttpStatus.OK).json({
      status: HttpStatus.OK,
      message: 'Credentials are valid (authGuard desativado temporariamente)',
      facebookAppId: process.env.FACEBOOK_APP_ID,
      facebookConfigId: process.env.FACEBOOK_CONFIG_ID,
      facebookUserToken: process.env.FACEBOOK_USER_TOKEN,
    });
  })
  .use('/instance', new InstanceRouter(configService, ...guards).router)
  .use('/message', new MessageRouter(waMonitor, ...guards).router) // <-- waMonitor AGORA EXISTE aqui!
  .use('', new ChannelRouter(configService, ...guards).router);

export { HttpStatus, router, waMonitor, prismaRepository };
