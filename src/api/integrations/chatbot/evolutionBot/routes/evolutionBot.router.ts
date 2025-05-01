// src/api/integrations/chatbot/evolutionBot/routes/evolutionBot.router.ts

// << CORREÇÃO TS2307: Usar alias >>
// NOTE: Certifique-se que DataValidateArgs está exportado de abstract.router.ts
import { RouterBroker, DataValidateArgs } from '@api/abstract/abstract.router';
import { IgnoreJidDto } from '@api/dto/chatbot.dto'; // Ajustado caminho relativo/alias
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
// << CORREÇÃO TS2305: Importar httpStatus local >>
import httpStatus from '../../../../constants/http-status'; // Ajustado caminho relativo
import { evolutionBotController } from '@api/server.module'; // Assume exportação correta
import { instanceSchema } from '@validate/instance.schema'; // Assume alias
import { RequestHandler, Router, Request, Response, NextFunction } from 'express'; // Importado Request, Response, NextFunction

// Importa DTOs e Schemas específicos
import { EvolutionBotDto, EvolutionBotSettingDto } from '../dto/evolutionBot.dto'; // Assume DTO existe
// NOTE: Verifique se estes schemas existem no caminho correto
import {
  evolutionBotIgnoreJidSchema,
  evolutionBotSchema,
  evolutionBotSettingSchema,
  evolutionBotStatusSchema,
} from '../validate/evolutionBot.schema'; // Assume schemas existem e alias @validate funciona

export class EvolutionBotRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<EvolutionBotDto>({
            request: req,
            schema: evolutionBotSchema,
            ClassRef: EvolutionBotDto,
            execute: (instance, data) => evolutionBotController.createBot(instance, data),
          });
          res.status(httpStatus.CREATED).json(response);
        } catch (error) { next(error); }
      })
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
              const response = await this.dataValidate<EvolutionBotDto>({
                request: req,
                schema: evolutionBotSchema,
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
                const response = await this.dataValidate<EvolutionBotSettingDto>({
                  request: req,
                  schema: evolutionBotSettingSchema,
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
                  // Usar um DTO específico para changeStatus se existir
                  const response = await this.dataValidate<any>({
                    request: req,
                    schema: evolutionBotStatusSchema,
                    ClassRef: Object, // Usar DTO específico se existir
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
                    execute: (instance) => evolutionBotController.fetchSessions(instance, req.params.evolutionBotId), // Passa botId opcional
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
  protected routerPath(pathSuffix: string): string {
    const basePath = '/evolution'; // Definir o prefixo correto para este bot
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

  // Placeholder para dataValidate (idealmente viria da classe base RouterBroker)
  // NOTE: Esta implementação é um MOCK e precisa ser substituída pela lógica real
  //       de validação de schema, busca de instância e execução.
  protected async dataValidate<T>(args: DataValidateArgs<T>): Promise<any> {
      const instanceName = args.request.params?.instanceName || args.request.body?.instanceName || args.request.headers?.instanceName || args.request.params?.instance; // Tenta pegar de params também
      if (!instanceName) {
        throw new Error("Nome da instância não encontrado na requisição (params, body ou headers)");
      }
      // Simula busca da instância (substitua pela lógica real com waMonitor)
      const instanceMock: InstanceDto = { instanceName: instanceName, instanceId: `mock-${instanceName}-id` };

      // Simula validação (adicione sua biblioteca de validação, ex: Joi)
      // const { error } = args.schema.validate(args.request.body);
      // if (error) throw new Error(`Erro de validação: ${error.message}`);

      // Executa a função do controller
      return await args.execute(instanceMock, args.request.body as T);
  }
}
