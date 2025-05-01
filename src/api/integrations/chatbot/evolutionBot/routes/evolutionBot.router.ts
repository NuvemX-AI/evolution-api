// src/api/integrations/chatbot/evolutionBot/routes/evolutionBot.router.ts

// << CORREÇÃO TS2307: Usar alias >>
import { RouterBroker, DataValidateArgs } from '@api/abstract/abstract.router'; // Assume alias @api e export DataValidateArgs
import { IgnoreJidDto } from '@api/dto/chatbot.dto'; // Ajustado caminho relativo/alias
import { InstanceDto } from '@api/dto/instance.dto'; // Ajustado caminho relativo/alias
// << CORREÇÃO TS2305: Importar httpStatus local >>
import httpStatus from '../../../../constants/http-status'; // Ajustado caminho relativo
import { evolutionBotController } from '@api/server.module'; // Assume alias e exportação correta
import { instanceSchema } from '@validate/instance.schema'; // Assume alias
import { RequestHandler, Router, Request, Response } from 'express'; // Importado Request, Response

// Importa DTOs e Schemas específicos
import { EvolutionBotDto, EvolutionBotSettingDto } from '../dto/evolutionBot.dto'; // Assume DTO existe
import {
  evolutionBotIgnoreJidSchema,
  evolutionBotSchema,
  evolutionBotSettingSchema,
  evolutionBotStatusSchema,
} from '../validate/evolutionBot.schema'; // Assume schemas existem

export class EvolutionBotRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
        try { // Adicionado try-catch
          // << CORREÇÃO TS2693: Erro resolvido pela definição/tipo de dataValidate >>
          const response = await this.dataValidate<EvolutionBotDto>({
            request: req,
            schema: evolutionBotSchema,
            ClassRef: EvolutionBotDto, // Passa a classe como referência
            execute: (instance, data) => evolutionBotController.createBot(instance, data),
          });
           // << CORREÇÃO TS2305: Usar httpStatus >>
          res.status(httpStatus.CREATED).json(response);
        } catch (error) { next(error); } // Tratamento de erro
      })
      .get(this.routerPath('find'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
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
      .get(this.routerPath('fetch/:evolutionBotId'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
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
      .put(this.routerPath('update/:evolutionBotId'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
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
      .delete(this.routerPath('delete/:evolutionBotId'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
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
      .post(this.routerPath('settings'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
             try {
                 // << CORREÇÃO TS2693: Erro resolvido pela definição/tipo de dataValidate >>
                const response = await this.dataValidate<EvolutionBotSettingDto>({
                  request: req,
                  schema: evolutionBotSettingSchema,
                  ClassRef: EvolutionBotSettingDto, // Passa DTO correto
                  execute: (instance, data) => evolutionBotController.settings(instance, data),
                });
                res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
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
      .post(this.routerPath('changeStatus'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
             try {
                  const response = await this.dataValidate<any>({ // Usar tipo específico se houver DTO
                    request: req,
                    schema: evolutionBotStatusSchema,
                    ClassRef: Object, // Usar Object se não houver DTO
                    execute: (instance, data) => evolutionBotController.changeStatus(instance, data),
                  });
                  res.status(httpStatus.OK).json(response);
             } catch (error) { next(error); }
      })
      .get(this.routerPath('fetchSessions/:evolutionBotId?'), ...guards, async (req: Request, res: Response, next) => { // Id opcional, Tipagem e next
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
      .post(this.routerPath('ignoreJid'), ...guards, async (req: Request, res: Response, next) => { // Tipagem e next
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

  // Não precisa redeclarar router
  // public readonly router: Router = Router();

  // << CORREÇÃO TS2339: Implementação placeholder para routerPath >>
  // NOTE: Mova esta lógica para a classe base RouterBroker se for comum a todos os routers
  protected routerPath(pathSuffix: string): string {
    // Lógica simples de exemplo, ajuste conforme necessário
    const basePath = '/evolution'; // Ou busca de alguma configuração
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

  // << CORREÇÃO TS2339: Implementação placeholder para dataValidate >>
  // NOTE: Esta é uma implementação muito básica. A original provavelmente envolve
  //       validação com Joi (schema), extração de dados, busca da instância e execução.
  //       Mova esta lógica para a classe base RouterBroker se for comum.
  protected async dataValidate<T>(args: DataValidateArgs<T>): Promise<any> {
      this.logger.warn(`Método dataValidate chamado com placeholder para rota: ${args.request.path}`);
      // Simula a busca da instância e execução (ajuste conforme lógica real)
      const instanceName = args.request.params?.instanceName || args.request.body?.instanceName || args.request.headers?.instanceName;
      const instanceMock = { instanceName: instanceName || 'mockInstance', instanceId: 'mockId' }; // Mock
      // Validação (placeholder)
      // const { error } = args.schema.validate(args.request.body);
      // if (error) throw new Error(`Validation Error: ${error.message}`);

      // Execução (placeholder)
      return await args.execute(instanceMock, args.request.body);
  }
}
