// src/api/integrations/chatbot/flowise/routes/flowise.router.ts

// Imports (mantidos e corrigidos aliases/paths conforme análise anterior)
// CORREÇÃO TS2724: Importar DataValidateArgs de abstract.router
import { RouterBroker, DataValidateArgs } from '../../../../abstract/abstract.router'; // Ajustado path
import { IgnoreJidDto } from '../../../../dto/chatbot.dto';
import { InstanceDto } from '../../../../dto/instance.dto';
import httpStatus from '../../../../constants/http-status';
import { flowiseController } from '@api/server.module';
import { instanceSchema } from '@validate/instance.schema'; // Ajustar path/alias
import { RequestHandler, Router, Request, Response, NextFunction } from 'express';
import { FlowiseDto, FlowiseSettingDto } from '../dto/flowise.dto';
import {
  flowiseIgnoreJidSchema,
  flowiseSchema,
  flowiseSettingSchema,
  flowiseStatusSchema,
} from '../validate/flowise.schema'; // Ajustar path/alias

export class FlowiseRouter extends RouterBroker {

  // CORREÇÃO TS2339: Declarar a propriedade router ANTES do construtor
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super(); // Chamar construtor da base
    // Usar this.router
    this.router
      .post(this.routerPath('create'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<FlowiseDto>({
            request: req,
            schema: flowiseSchema,
            ClassRef: FlowiseDto,
            execute: (instance, data) => flowiseController.createBot(instance, data),
          });
          res.status(httpStatus.CREATED).json(response);
        } catch (error) { next(error); }
      })
      // ... (restante das definições de rota usando this.router) ...
       .get(this.routerPath('find'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
         try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => flowiseController.findBot(instance),
            });
            res.status(httpStatus.OK).json(response);
         } catch (error) { next(error); }
      })
      .get(this.routerPath('fetch/:flowiseId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
         try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => flowiseController.fetchBot(instance, req.params.flowiseId),
            });
            res.status(httpStatus.OK).json(response);
         } catch (error) { next(error); }
      })
      .put(this.routerPath('update/:flowiseId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
          try {
              const response = await this.dataValidate<FlowiseDto>({
                request: req,
                schema: flowiseSchema,
                ClassRef: FlowiseDto,
                execute: (instance, data) => flowiseController.updateBot(instance, req.params.flowiseId, data),
              });
              res.status(httpStatus.OK).json(response);
          } catch (error) { next(error); }
      })
      .delete(this.routerPath('delete/:flowiseId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
           try {
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => flowiseController.deleteBot(instance, req.params.flowiseId),
                });
                res.status(httpStatus.OK).json(response);
           } catch (error) { next(error); }
      })
      .post(this.routerPath('settings'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                const response = await this.dataValidate<FlowiseSettingDto>({
                  request: req,
                  schema: flowiseSettingSchema,
                  ClassRef: FlowiseSettingDto,
                  execute: (instance, data) => flowiseController.settings(instance, data),
                });
                res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<InstanceDto>({
                    request: req,
                    schema: instanceSchema,
                    ClassRef: InstanceDto,
                    execute: (instance) => flowiseController.fetchSettings(instance),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<any>({
                    request: req,
                    schema: flowiseStatusSchema,
                    ClassRef: Object,
                    execute: (instance, data) => flowiseController.changeStatus(instance, data),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .get(this.routerPath('fetchSessions/:flowiseId?'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<InstanceDto>({
                    request: req,
                    schema: instanceSchema,
                    ClassRef: InstanceDto,
                    execute: (instance) => flowiseController.fetchSessions(instance, req.params.flowiseId),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<IgnoreJidDto>({
                    request: req,
                    schema: flowiseIgnoreJidSchema,
                    ClassRef: IgnoreJidDto,
                    execute: (instance, data) => flowiseController.ignoreJid(instance, data),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      });
  }

  // Implementar ou herdar routerPath e dataValidate
  // CORREÇÃO TS2415: Visibilidade precisa ser compatível com a base (protected ou public)
  protected routerPath(pathSuffix: string): string {
    const basePath = ''; // Ajustar base path
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

  // CORREÇÃO TS2415: Visibilidade precisa ser compatível com a base (protected ou public)
  protected async dataValidate<T>(args: DataValidateArgs<T>): Promise<any> {
      // NOTE: Implementação MOCK - Substitua pela lógica real
      const instanceName = args.request.params?.instanceName || args.request.body?.instanceName || args.request.headers?.instanceName || args.request.params?.instance;
      if (!instanceName) throw new Error("Nome da instância não encontrado na requisição");
      const instanceMock: InstanceDto = { instanceName: instanceName, instanceId: `mock-${instanceName}-id` };
      // Validação (exemplo Joi)
      // const { error } = args.schema.validate(args.request.body);
      // if (error) throw new Error(`Erro de validação: ${error.message}`);
      return await args.execute(instanceMock, args.request.body as T);
  }
}
