console.log('========== LOADING FILE: instance.router.ts ==========');
import { RouterBroker } from '../abstract/abstract.router';
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import { InstanceController } from '@api/controllers/instance.controller';
import { ConfigService } from '@config/env.config';
import EventEmitter2 from 'eventemitter2';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { ChatwootService } from '@api/integrations/chatbot/chatwoot';
import { SettingsService } from '@api/services/settings.service';
import { ProxyController } from '@api/controllers/proxy.controller';
import { ProxyService } from '@api/services/proxy.service';
import { CacheService } from '@api/services/cache.service';
import { ProviderFiles } from '@api/provider/sessions';
import { instanceSchema, presenceOnlySchema } from '@validate/instance.schema'; // use caminho correto!
import { RequestHandler, Router } from 'express';
import { HttpStatus } from '../constants/http-status';
import { CacheEngine } from '@cache/cacheengine';
import { ICache } from '@api/abstract/abstract.cache';

const configService = new ConfigService();
const prisma = new PrismaRepository(configService);
const providerFiles = new ProviderFiles(configService);
const chatwootService = new ChatwootService();
const cacheEngine: ICache = new CacheEngine(configService, 'instance.router');
const cacheInstance = new CacheService(cacheEngine);

const waMonitor = new WAMonitoringService({
  eventEmitter: new EventEmitter2(),
  configService,
  prismaRepository: prisma,
  providerFiles,
  chatwootService,
  settingsService: null as any,
  proxyService: null as any,
  cacheService: cacheInstance,
});

const settingsService = new SettingsService(waMonitor);
const proxyService = new ProxyService(waMonitor);
waMonitor.settingsService = settingsService;
waMonitor.proxyService = proxyService;

const instanceController = new InstanceController(
  waMonitor,
  configService,
  prisma,
  waMonitor['eventEmitter'],
  chatwootService,
  settingsService,
  new ProxyController(proxyService, waMonitor),
  cacheInstance,
  cacheInstance,
  cacheInstance,
  providerFiles
);

// Função robusta: prioriza query para DELETE, body para demais métodos.
function getInstanceName(req) {
  if (req.method === 'DELETE') {
    return req.query?.instanceName || req.body?.instanceName || req.params?.instanceName;
  }
  return req.body?.instanceName || req.query?.instanceName || req.params?.instanceName;
}

export class InstanceRouter extends RouterBroker {
  public readonly router: Router = Router();

  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();

    this.router

      .post('/create', ...guards, async (req, res) => {
        console.log("DEBUG [create] BODY:", req.body);
        console.log("DEBUG [create] QUERY:", req.query);
        console.log("DEBUG [create] PARAMS:", req.params);

        const instanceName = getInstanceName(req);
        console.log("DEBUG [create] NAME:", instanceName);

        req.body = { ...req.body, instanceName };
        console.log("DEBUG [create] BODY FINAL:", req.body);

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => await instanceController.createInstance(instance),
        });
        return res.status(HttpStatus.CREATED).json(response);
      })

      .post('/restart', ...guards, async (req, res) => {
        console.log("DEBUG [restart] BODY:", req.body);
        console.log("DEBUG [restart] QUERY:", req.query);
        console.log("DEBUG [restart] PARAMS:", req.params);

        const instanceName = getInstanceName(req);
        console.log("DEBUG [restart] NAME:", instanceName);

        req.body = { ...req.body, instanceName };
        console.log("DEBUG [restart] BODY FINAL:", req.body);

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: undefined,
          ClassRef: InstanceDto,
          execute: async (instance) => await instanceController.createInstance(instance),
        });
        return res.status(HttpStatus.OK).json(response);
      })

      .post('/connect', async (req, res) => {
        console.log("DEBUG [connect] BODY:", req.body);
        console.log("DEBUG [connect] QUERY:", req.query);
        console.log("DEBUG [connect] PARAMS:", req.params);

        const instanceName = getInstanceName(req) || req.body.session;
        console.log("DEBUG [connect] NAME:", instanceName);

        if (!instanceName) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'instanceName ausente no corpo, na query ou nos params da requisição.',
          });
        }
        req.body = { ...req.body, instanceName };
        console.log("DEBUG [connect] BODY FINAL:", req.body);

        const qr = 'mock-qr-connect-AQUI';
        return res.status(HttpStatus.OK).json({ instanceName, qr });
      })

      .post('/logout', ...guards, async (req, res) => {
        console.log("DEBUG [logout POST] BODY:", req.body);
        console.log("DEBUG [logout POST] QUERY:", req.query);
        console.log("DEBUG [logout POST] PARAMS:", req.params);

        const instanceName = getInstanceName(req);
        console.log("DEBUG [logout POST] NAME:", instanceName);

        if (!instanceName) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'instanceName not provided',
          });
        }
        req.body = { ...req.body, instanceName };
        console.log("DEBUG [logout POST] BODY FINAL:", req.body);

        const instance = new InstanceDto({ instanceName });
        const response = await instanceController.logout(instance);
        return res.status(HttpStatus.OK).json(response);
      })

      .delete('/logout', ...guards, async (req, res) => {
        console.log("DEBUG [logout DELETE] BODY:", req.body);
        console.log("DEBUG [logout DELETE] QUERY:", req.query);
        console.log("DEBUG [logout DELETE] PARAMS:", req.params);

        const instanceName = getInstanceName(req);
        console.log("DEBUG [logout DELETE] NAME:", instanceName);

        if (!instanceName) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'instanceName not provided',
          });
        }
        req.body = { ...req.body, instanceName };
        console.log("DEBUG [logout DELETE] BODY FINAL:", req.body);

        const instance = new InstanceDto({ instanceName });
        const response = await instanceController.logout(instance);
        return res.status(HttpStatus.OK).json(response);
      })

      .delete('/delete', ...guards, async (req, res) => {
        // LOGS DETALHADOS PARA DEBUG ABSOLUTO
        console.log("=== DEBUG [delete] INICIO ===");
        console.log("METHOD:", req.method);
        console.log("RAW QUERY:", req.query);
        console.log("RAW BODY:", req.body);
        console.log("RAW PARAMS:", req.params);

        const instanceName = getInstanceName(req);

        console.log("RESOLVED instanceName:", instanceName);

        if (!instanceName) {
          console.log("=== DEBUG [delete] ERRO FIM ===");
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'instanceName not provided',
          });
        }
        req.body = { ...req.body, instanceName };
        console.log("DEBUG [delete] BODY FINAL:", req.body);

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => await instanceController.deleteInstance(instance),
        });
        console.log("=== DEBUG [delete] SUCESSO FIM ===");
        return res.status(HttpStatus.OK).json(response);
      })

      .post('/setPresence', ...guards, async (req, res) => {
        console.log("DEBUG [setPresence] BODY:", req.body);
        console.log("DEBUG [setPresence] QUERY:", req.query);
        console.log("DEBUG [setPresence] PARAMS:", req.params);

        const instanceName = getInstanceName(req);
        console.log("DEBUG [setPresence] NAME:", instanceName);

        if (!instanceName) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'instanceName not provided',
          });
        }
        req.body = { ...req.body, instanceName };
        console.log("DEBUG [setPresence] BODY FINAL:", req.body);

        console.log("DEBUG [setPresence] SCHEMA:", presenceOnlySchema);

        const response = await this.dataValidate<SetPresenceDto>({
          request: req,
          schema: presenceOnlySchema,
          ClassRef: SetPresenceDto,
          execute: async (instance, data) => await instanceController.setPresence(instance, data),
        });
        return res.status(HttpStatus.OK).json(response);
      })

      .get('/connectionState', ...guards, async (req, res) => {
        console.log("DEBUG [connectionState] BODY:", req.body);
        console.log("DEBUG [connectionState] QUERY:", req.query);
        console.log("DEBUG [connectionState] PARAMS:", req.params);

        const instanceName = getInstanceName(req);
        console.log("DEBUG [connectionState] NAME:", instanceName);

        if (!instanceName) {
          return res.status(HttpStatus.BAD_REQUEST).json({
            status: HttpStatus.BAD_REQUEST,
            error: 'instanceName not provided',
          });
        }
        req.body = { ...req.body, instanceName };
        console.log("DEBUG [connectionState] BODY FINAL:", req.body);

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => await instanceController.connectionState(instance),
        });
        return res.status(HttpStatus.OK).json(response);
      });

  }
}
