// src/api/integrations/chatbot/dify/routes/dify.router.ts

// Imports (mantidos e corrigidos aliases/paths conforme análise anterior)
import { RouterBroker, DataValidateArgs } from '../../../../abstract/abstract.router'; // Ajustado path
import { IgnoreJidDto } from '../../../../dto/chatbot.dto';
import { InstanceDto } from '../../../../dto/instance.dto';
import { DifyDto, DifySettingDto } from '../dto/dify.dto';
import httpStatus from '../../../../constants/http-status';
import { difyController } from '@api/server.module';
import {
  difyIgnoreJidSchema,
  difySchema,
  difySettingSchema,
  difyStatusSchema,
  instanceSchema,
} from '@validate/validate.schema'; // Ajustar path/alias
import { RequestHandler, Router, Request, Response, NextFunction } from 'express'; // Adicionado Request, Response, NextFunction

export class DifyRouter extends RouterBroker {

  // CORREÇÃO TS2339: Declarar a propriedade router ANTES do construtor
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super(); // Chamar construtor da base
    // Usar this.router
    this.router
      .post(this.routerPath('create'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<DifyDto>({
            request: req,
            schema: difySchema,
            ClassRef: DifyDto,
            execute: (instance, data) => difyController.createBot(instance, data),
          });
          res.status(httpStatus.CREATED).json(response);
        } catch (error) {
           next(error);
        }
      })
      // ... (restante das definições de rota usando this.router) ...
       .get(this.routerPath('find'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
         try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => difyController.findBot(instance),
            });
            res.status(httpStatus.OK).json(response);
         } catch (error) {
             next(error);
         }
      })
      .get(this.routerPath('fetch/:difyId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
          try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => difyController.fetchBot(instance, req.params.difyId),
            });
            res.status(httpStatus.OK).json(response);
          } catch (error) {
             next(error);
          }
      })
      .put(this.routerPath('update/:difyId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
           try {
              const response = await this.dataValidate<DifyDto>({
                request: req,
                schema: difySchema,
                ClassRef: DifyDto,
                execute: (instance, data) => difyController.updateBot(instance, req.params.difyId, data),
              });
              res.status(httpStatus.OK).json(response);
           } catch (error) {
               next(error);
           }
      })
      .delete(this.routerPath('delete/:difyId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
            try {
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => difyController.deleteBot(instance, req.params.difyId),
                });
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .post(this.routerPath('settings'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                const response = await this.dataValidate<DifySettingDto>({
                  request: req,
                  schema: difySettingSchema,
                  ClassRef: DifySettingDto,
                  execute: (instance, data) => difyController.settings(instance, data),
                });
                res.status(httpStatus.OK).json(response);
             } catch (error) {
                 next(error);
             }
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
            try {
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => difyController.fetchSettings(instance),
                });
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
            try {
                const response = await this.dataValidate<any>({
                  request: req,
                  schema: difyStatusSchema,
                  ClassRef: Object,
                  execute: (instance, data) => difyController.changeStatus(instance, data),
                });
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .get(this.routerPath('fetchSessions/:difyId?'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
            try {
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => difyController.fetchSessions(instance, req.params.difyId),
                });
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
           try {
                const response = await this.dataValidate<IgnoreJidDto>({
                  request: req,
                  schema: difyIgnoreJidSchema,
                  ClassRef: IgnoreJidDto,
                  execute: (instance, data) => difyController.ignoreJid(instance, data),
                });
                res.status(httpStatus.OK).json(response);
           } catch (error) {
                next(error);
           }
      });
  }

  // Implementar ou herdar routerPath e dataValidate
  protected routerPath(pathSuffix: string): string {
    const basePath = ''; // Ajustar base path
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

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
