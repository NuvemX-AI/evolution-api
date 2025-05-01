// src/api/integrations/chatbot/dify/routes/dify.router.ts

// << CORREÇÃO: Importar RouterBroker via alias se configurado >>
// import { RouterBroker } from '@api/abstract/abstract.router';
import { RouterBroker } from '../../../../abstract/abstract.router'; // Mantendo relativo
import { IgnoreJidDto } from '../../../../dto/chatbot.dto'; // Assume DTO existe
import { InstanceDto } from '../../../../dto/instance.dto'; // Assume DTO existe
import { DifyDto, DifySettingDto } from '../dto/dify.dto'; // Assume DTO existe
// << CORREÇÃO TS2305: Importar httpStatus local >>
import httpStatus from '../../../../constants/http-status'; // Ajustado caminho relativo
import { difyController } from '@api/server.module'; // Assume exportação correta
import {
  difyIgnoreJidSchema,
  difySchema,
  difySettingSchema,
  difyStatusSchema,
  instanceSchema,
} from '@validate/validate.schema'; // Assume alias e schemas existem
import { RequestHandler, Router } from 'express';

export class DifyRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res, next) => { // Adicionado next
        try { // Adicionado try-catch
          const response = await this.dataValidate<DifyDto>({
            request: req,
            schema: difySchema,
            ClassRef: DifyDto, // Passa a classe DTO como referência
            execute: (instance, data) => difyController.createBot(instance, data),
          });
           // << CORREÇÃO TS2305: Usar httpStatus >>
          res.status(httpStatus.CREATED).json(response);
        } catch (error) {
           next(error); // Passa o erro para o middleware de erro
        }
      })
      .get(this.routerPath('find'), ...guards, async (req, res, next) => { // Adicionado next
         try { // Adicionado try-catch
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto, // Passa a classe DTO como referência
              execute: (instance) => difyController.findBot(instance),
            });
             // << CORREÇÃO TS2305: Usar httpStatus >>
            res.status(httpStatus.OK).json(response);
         } catch (error) {
             next(error);
         }
      })
      .get(this.routerPath('fetch/:difyId'), ...guards, async (req, res, next) => { // Adicionado next
          try { // Adicionado try-catch
            const response = await this.dataValidate<InstanceDto>({
              request: req,
              schema: instanceSchema,
              ClassRef: InstanceDto,
              execute: (instance) => difyController.fetchBot(instance, req.params.difyId),
            });
             // << CORREÇÃO TS2305: Usar httpStatus >>
            res.status(httpStatus.OK).json(response);
          } catch (error) {
             next(error);
          }
      })
      .put(this.routerPath('update/:difyId'), ...guards, async (req, res, next) => { // Adicionado next
           try { // Adicionado try-catch
              const response = await this.dataValidate<DifyDto>({
                request: req,
                schema: difySchema,
                ClassRef: DifyDto,
                execute: (instance, data) => difyController.updateBot(instance, req.params.difyId, data),
              });
               // << CORREÇÃO TS2305: Usar httpStatus >>
              res.status(httpStatus.OK).json(response);
           } catch (error) {
               next(error);
           }
      })
      .delete(this.routerPath('delete/:difyId'), ...guards, async (req, res, next) => { // Adicionado next
            try { // Adicionado try-catch
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => difyController.deleteBot(instance, req.params.difyId),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .post(this.routerPath('settings'), ...guards, async (req, res, next) => { // Adicionado next
             try { // Adicionado try-catch
                const response = await this.dataValidate<DifySettingDto>({
                  request: req,
                  schema: difySettingSchema,
                  ClassRef: DifySettingDto, // Passa DTO correto
                  execute: (instance, data) => difyController.settings(instance, data),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
             } catch (error) {
                 next(error);
             }
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req, res, next) => { // Adicionado next
            try { // Adicionado try-catch
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  execute: (instance) => difyController.fetchSettings(instance),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req, res, next) => { // Adicionado next
            try { // Adicionado try-catch
                const response = await this.dataValidate<any>({ // Usar 'any' ou um DTO específico para status
                  request: req,
                  schema: difyStatusSchema, // Schema específico
                  ClassRef: Object, // Usar Object se não houver DTO específico
                  execute: (instance, data) => difyController.changeStatus(instance, data),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .get(this.routerPath('fetchSessions/:difyId?'), ...guards, async (req, res, next) => { // difyId opcional na rota?
            try { // Adicionado try-catch
                const response = await this.dataValidate<InstanceDto>({
                  request: req,
                  schema: instanceSchema,
                  ClassRef: InstanceDto,
                  // Passa req.params.difyId (pode ser undefined)
                  execute: (instance) => difyController.fetchSessions(instance, req.params.difyId),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
            } catch (error) {
                 next(error);
            }
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req, res, next) => { // Adicionado next
           try { // Adicionado try-catch
                const response = await this.dataValidate<IgnoreJidDto>({
                  request: req,
                  schema: difyIgnoreJidSchema,
                  ClassRef: IgnoreJidDto, // DTO correto
                  execute: (instance, data) => difyController.ignoreJid(instance, data),
                });
                 // << CORREÇÃO TS2305: Usar httpStatus >>
                res.status(httpStatus.OK).json(response);
           } catch (error) {
                next(error);
           }
      });
  }

  // Não precisa redeclarar router
  // public readonly router: Router = Router();
}
