// src/api/integrations/chatbot/flowise/routes/flowise.router.ts

// << CORREÇÃO: Importar RouterBroker via alias se configurado >>
// import { RouterBroker } from '@api/abstract/abstract.router';
import { RouterBroker, DataValidateArgs } from '../../../../abstract/abstract.router'; // Mantendo relativo e importando Args
import { IgnoreJidDto } from '../../../../dto/chatbot.dto'; // Assume DTO existe
import { InstanceDto } from '../../../../dto/instance.dto'; // Assume DTO existe
// << CORREÇÃO TS2305: Importar httpStatus local >>
import httpStatus from '../../../../constants/http-status'; // Ajustado caminho relativo
import { flowiseController } from '@api/server.module'; // Assume exportação correta
import { instanceSchema } from '@validate/instance.schema'; // Assume alias
import { RequestHandler, Router, Request, Response, NextFunction } from 'express'; // Importados Request, Response, NextFunction

// Importa DTOs e Schemas específicos
import { FlowiseDto, FlowiseSettingDto } from '../dto/flowise.dto'; // Assume DTO existe
// NOTE: Verifique se estes schemas existem no caminho correto
import {
  flowiseIgnoreJidSchema,
  flowiseSchema,
  flowiseSettingSchema,
  flowiseStatusSchema,
} from '../validate/flowise.schema'; // Assume schemas existem e alias @validate funciona

export class FlowiseRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<FlowiseDto>({
            request: req,
            schema: flowiseSchema,
            ClassRef: FlowiseDto,
            execute: (instance, data) => flowiseController.createBot(instance, data),
          });
           // << CORREÇÃO TS2305: Usar httpStatus >>
          res.status(httpStatus.CREATED).json(response);
        } catch (error) { next(error); }
      })
      .get(this.routerPath('find'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
         try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => flowiseController.findBot(instance),
            });
             // << CORREÇÃO TS2305: Usar httpStatus >>
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
             // << CORREÇÃO TS2305: Usar httpStatus >>
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
               // << CORREÇÃO TS2305: Usar httpStatus >>
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
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
           } catch (error) { next(error); }
      })
      .post(this.routerPath('settings'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                const response = await this.dataValidate<FlowiseSettingDto>({
                  request: req,
                  schema: flowiseSettingSchema,
                  ClassRef: FlowiseSettingDto, // Passa DTO correto
                  execute: (instance, data) => flowiseController.settings(instance, data),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
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
                   // << CORREÇÃO TS2305: Usar httpStatus >>
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<any>({ // Usar DTO específico se houver
                    request: req,
                    schema: flowiseStatusSchema,
                    ClassRef: Object, // Usar DTO específico se houver
                    execute: (instance, data) => flowiseController.changeStatus(instance, data),
                  });
                   // << CORREÇÃO TS2305: Usar httpStatus >>
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .get(this.routerPath('fetchSessions/:flowiseId?'), ...guards, async (req: Request, res: Response, next: NextFunction) => { // Id opcional
             try {
                  const response = await this.dataValidate<InstanceDto>({
                    request: req,
                    schema: instanceSchema,
                    ClassRef: InstanceDto,
                    execute: (instance) => flowiseController.fetchSessions(instance, req.params.flowiseId), // Passa botId opcional
                  });
                   // << CORREÇÃO TS2305: Usar httpStatus >>
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
                   // << CORREÇÃO TS2305: Usar httpStatus >>
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      });
  }

  // Placeholder para routerPath
  protected routerPath(pathSuffix: string): string {
    const basePath = '/flowise'; // Definir o prefixo correto para Flowise
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

  // Placeholder para dataValidate
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
