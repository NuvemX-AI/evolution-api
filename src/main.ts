import dotenv from 'dotenv';
dotenv.config();
console.log('[CORS DEBUG] ORIGINS:', process.env.CORS_ORIGIN);

import compression from 'compression';
import cors from 'cors';
import express, { json, NextFunction, Request, Response, urlencoded } from 'express';
import { join } from 'path';
import * as Sentry from '@sentry/node';
import axios from 'axios';

import { router } from './api/server.module';
import { HttpStatus } from './api/constants/http-status';
import { ProviderFiles } from './api/provider/sessions';
import { PrismaRepository } from './api/repository/repository.service';
import { configService, Auth, Cors, HttpServer, ProviderSession, Webhook } from './config/env.config';
import { onUnexpectedError } from './config/error.config';
import { Logger } from './config/logger.config';
import { ROOT_DIR } from './config/path.config';
import { ServerUP } from './utils/server-up';
import { WAMonitoringService } from './api/server/services/wa-monitoring.service';

function initWA() {
  try {
    globalThis.waMonitor = new WAMonitoringService();
    globalThis.manager = globalThis.waMonitor;
    console.log('✅ globalThis.waMonitor e globalThis.manager configurados com sucesso.');
  } catch (error) {
    console.error('❌ Erro ao inicializar o waMonitor:', error.message);
  }
}

async function bootstrap() {
  const logger = new Logger('SERVER');
  const app = express();

  let providerFiles: ProviderFiles = null;
  if (configService.get<ProviderSession>('PROVIDER').ENABLED) {
    providerFiles = new ProviderFiles(configService);
    await providerFiles.onModuleInit();
    logger.info('Provider:Files - ON');
  }

  const prismaRepository = new PrismaRepository(configService);
  await prismaRepository.onModuleInit();

  app.use(
    cors({
      origin: (origin, callback) => {
        const rawOrigins = process.env.CORS_ORIGIN || '';
        const allowedOrigins = rawOrigins.split(',').map(o => o.trim());

        console.log('[CORS DEBUG] Solicitado por:', origin);

        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        console.error(`[CORS BLOQUEADO] Origem não permitida: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
      },
      methods: configService.get<Cors>('CORS').METHODS,
      credentials: configService.get<Cors>('CORS').CREDENTIALS,
    }),
    urlencoded({ extended: true, limit: '136mb' }),
    json({ limit: '136mb' }),
    compression(),
  );

  app.set('view engine', 'hbs');
  app.set('views', join(ROOT_DIR, 'views'));
  app.use(express.static(join(ROOT_DIR, 'public')));
  app.use('/store', express.static(join(ROOT_DIR, 'store')));
  app.use('/', router);

  app.use(
    (err: Error, req: Request, res: Response, next: NextFunction) => {
      if (err) {
        const webhook = configService.get<Webhook>('WEBHOOK');
        const globalApiKey = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
        const serverUrl = configService.get<HttpServer>('SERVER').URL;
        const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString();

        const errorData = {
          event: 'error',
          data: {
            error: err['error'] || 'Internal Server Error',
            message: err['message'] || 'Internal Server Error',
            status: err['status'] || 500,
            response: {
              message: err['message'] || 'Internal Server Error',
            },
          },
          date_time: now,
          api_key: globalApiKey,
          server_url: serverUrl,
        };

        logger.error(errorData);

        if (webhook.EVENTS.ERRORS_WEBHOOK) {
          const httpService = axios.create({ baseURL: webhook.EVENTS.ERRORS_WEBHOOK });
          httpService.post('', errorData);
        }

        return res.status(err['status'] || 500).json({
          status: err['status'] || 500,
          error: err['error'] || 'Internal Server Error',
          response: {
            message: err['message'] || 'Internal Server Error',
          },
        });
      }
      next();
    },
    (req: Request, res: Response, next: NextFunction) => {
      const { method, url } = req;
      res.status(HttpStatus.NOT_FOUND).json({
        status: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        response: {
          message: [`Cannot ${method.toUpperCase()} ${url}`],
        },
      });
      next();
    },
  );

  const httpServer = configService.get<HttpServer>('SERVER');
  ServerUP.app = app;
  const server = ServerUP[httpServer.TYPE];

  if (process.env.SENTRY_DSN) {
    logger.info('Sentry - ON');
    Sentry.setupExpressErrorHandler(app);
  }

  server.listen(httpServer.PORT, () => logger.log(`${httpServer.TYPE.toUpperCase()} - ON: ${httpServer.PORT}`));

  initWA();
  onUnexpectedError();
}

bootstrap();
