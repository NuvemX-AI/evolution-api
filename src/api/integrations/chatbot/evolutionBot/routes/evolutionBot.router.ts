// src/api/integrations/chatbot/evolutionBot/routes/evolutionBot.router.ts

// Imports (mantidos e corrigidos aliases/paths conforme análise anterior)
import { RouterBroker, DataValidateArgs } from '@api/abstract/abstract.router';
import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import httpStatus from '../../../../constants/http-status';
import { evolutionBotController } from '@api/server.module';
import { instanceSchema } from '@validate/instance.schema';
import { RequestHandler, Router, Request, Response, NextFunction } from 'express';
import { EvolutionBotDto, EvolutionBotSettingDto } from '../dto/evolutionBot.dto';
import {
  evolutionBotIgnoreJidSchema,
  evolutionBotSchema,
  evolutionBotSettingSchema,
  evolutionBotStatusSchema,
} from '../validate/evolutionBot.schema';

export class EvolutionBotRouter extends RouterBroker {

  // CORREÇÃO TS2339: Declarar a propriedade router ANTES do construtor
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super(); // Chamar construtor da classe base
    // Usar this.router para definir as rotas
    this.router
      .post(this.routerPath('create'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<EvolutionBotDto>({ // Tipagem <EvolutionBotDto> estava faltando
            request: req,
            schema: evolutionBotSchema,
            // CORREÇÃO TS2693: Passar a classe como referência
            ClassRef: EvolutionBotDto,
            execute: (instance, data) => evolutionBotController.createBot(instance, data),
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
              execute: (instance) => evolutionBotController.findBot(instance),
            });
            res.status(httpStatus.OK).json(response);
         } catch (error) { next(error); }
      })
      .get(this.routerPath('fetch/:evolutionBotId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
         try {
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => evolutionBotController.fetchBot(instance, req.params.evolutionBotId),
            });
            res.status(httpStatus.OK).json(response);
         } catch (error) { next(error); }
      })
      .put(this.routerPath('update/:evolutionBotId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
          try {
              const response = await this.dataValidate<EvolutionBotDto>({ // Tipagem <EvolutionBotDto> estava faltando
                request: req,
                schema: evolutionBotSchema,
                // CORREÇÃO TS2693: Passar a classe como referência
                ClassRef: EvolutionBotDto,
                execute: (instance, data) => evolutionBotController.updateBot(instance, req.params.evolutionBotId, data),
              });
              res.status(httpStatus.OK).json(response);
          } catch (error) { next(error); }
      })
      .delete(this.routerPath('delete/:evolutionBotId'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
           try {
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => evolutionBotController.deleteBot(instance, req.params.evolutionBotId),
                });
                res.status(httpStatus.OK).json(response);
           } catch (error) { next(error); }
      })
      .post(this.routerPath('settings'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                const response = await this.dataValidate<EvolutionBotSettingDto>({ // Tipagem <EvolutionBotSettingDto> estava faltando
                  request: req,
                  schema: evolutionBotSettingSchema,
                  // CORREÇÃO TS2693: Passar a classe como referência
                  ClassRef: EvolutionBotSettingDto,
                  execute: (instance, data) => evolutionBotController.settings(instance, data),
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
                    execute: (instance) => evolutionBotController.fetchSettings(instance),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<any>({
                    request: req,
                    schema: evolutionBotStatusSchema,
                    ClassRef: Object,
                    execute: (instance, data) => evolutionBotController.changeStatus(instance, data),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .get(this.routerPath('fetchSessions/:evolutionBotId?'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<InstanceDto>({
                    request: req,
                    schema: instanceSchema,
                    ClassRef: InstanceDto,
                    execute: (instance) => evolutionBotController.fetchSessions(instance, req.params.evolutionBotId),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
             try {
                  const response = await this.dataValidate<IgnoreJidDto>({
                    request: req,
                    schema: evolutionBotIgnoreJidSchema,
                    ClassRef: IgnoreJidDto,
                    execute: (instance, data) => evolutionBotController.ignoreJid(instance, data),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      });
  }

  // Placeholder para routerPath (idealmente viria da classe base RouterBroker)
  // Corrigir visibilidade se RouterBroker definir como public
  protected routerPath(pathSuffix: string): string {
    const basePath = ''; // Ajuste o base path conforme necessário ou remova se gerenciado pela base
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

  // Placeholder para dataValidate (idealmente viria da classe base RouterBroker)
  // Corrigir visibilidade se RouterBroker definir como public
  protected async dataValidate<T>(args: DataValidateArgs<T>): Promise<any> {
      // NOTE: Implementação MOCK - Substitua pela lógica real
      const instanceName = args.request.params?.instanceName || args.request.body?.instanceName || args.request.headers?.instanceName || args.request.params?.instance;
      if (!instanceName) {
        throw new Error("Nome da instância não encontrado na requisição (params, body ou headers)");
      }
      const instanceMock: InstanceDto = { instanceName: instanceName, instanceId: `mock-${instanceName}-id` };
      // Validação (exemplo Joi)
      // const { error } = args.schema.validate(args.request.body);
      // if (error) throw new Error(`Erro de validação: ${error.message}`);
      return await args.execute(instanceMock, args.request.body as T);
  }
}
