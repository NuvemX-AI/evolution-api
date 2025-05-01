// src/api/integrations/chatbot/chatwoot/routes/chatwoot.router.ts

// << CORREÇÃO: Importar RouterBroker via alias se configurado >>
// import { RouterBroker } from '@api/abstract/abstract.router';
import { RouterBroker } from '../../../../abstract/abstract.router'; // Mantendo relativo
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto'; // Assume DTO existe
// << CORREÇÃO TS2305: Importar httpStatus local >>
import httpStatus from '../../../../constants/http-status'; // Ajustado caminho relativo
// << CORREÇÃO TS2724: Importar chatwootController (precisa ser exportado de server.module) >>
// NOTE: Garanta que uma instância de ChatwootController seja criada e exportada
//       como 'chatwootController' em src/api/server.module.ts
import { chatwootController } from '@api/server.module';
import { chatwootSchema, instanceSchema } from '@validate/validate.schema'; // Assume alias existe
import { RequestHandler, Router } from 'express';

export class ChatwootRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('set'), ...guards, async (req, res, next) => { // Adicionado 'next'
        try { // Adicionado try-catch
          const response = await this.dataValidate<ChatwootDto>({
            request: req,
            schema: chatwootSchema,
            ClassRef: ChatwootDto,
            // Chama o método do controller importado
            execute: (instance, data) => chatwootController.createChatwoot(instance, data),
          });
          // << CORREÇÃO TS2305: Usar httpStatus >>
          res.status(httpStatus.CREATED).json(response);
        } catch (error) {
          next(error); // Passa o erro para o middleware de erro
        }
      })
      .get(this.routerPath('find'), ...guards, async (req, res, next) => { // Adicionado 'next'
        try { // Adicionado try-catch
          const response = await this.dataValidate<InstanceDto>({
            request: req,
            schema: instanceSchema,
            ClassRef: InstanceDto,
             // Chama o método do controller importado
            execute: (instance) => chatwootController.findChatwoot(instance),
          });
          // << CORREÇÃO TS2305: Usar httpStatus >>
          res.status(httpStatus.OK).json(response);
        } catch (error) {
          next(error); // Passa o erro para o middleware de erro
        }
      })
      // Webhook não deve ter guards de instância logada
      .post(this.routerPath('webhook'), async (req, res, next) => { // Removido guards, adicionado next
        try { // Adicionado try-catch
          // Validação do webhook pode precisar ser diferente (pegar instanceName do param?)
          const response = await this.dataValidate<InstanceDto>({
            request: req, // Precisa garantir que instanceName está em req.params ou req.body
            schema: instanceSchema, // Usar um schema específico para webhook?
            ClassRef: InstanceDto,
             // Chama o método do controller importado
            // Passa req.body como segundo argumento para receiveWebhook
            execute: (instance) => chatwootController.receiveWebhook(instance, req.body),
          });
          // << CORREÇÃO TS2305: Usar httpStatus >>
          res.status(httpStatus.OK).json(response);
        } catch (error) {
          // Não passar erro para next em webhooks normalmente, apenas logar e retornar OK
          // console.error("Erro no processamento do webhook Chatwoot:", error);
          // res.status(httpStatus.OK).json({ message: "Webhook received, processing error occurred." });
          // Ou passar para next se o seu error handler tratar webhooks
           next(error);
        }
      });
  }

  // Não precisa redeclarar router, herdado/gerenciado pela base
  // public readonly router: Router = Router();
}
