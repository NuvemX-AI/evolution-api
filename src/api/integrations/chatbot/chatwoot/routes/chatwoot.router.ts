// src/api/integrations/chatbot/chatwoot/routes/chatwoot.router.ts

// Imports
import { RouterBroker, DataValidateArgs } from '../../../../abstract/abstract.router'; // Ajustado path
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto';
import httpStatus from '../../../../constants/http-status';
// CORREÇÃO TS2724: Importar chatwootController.
//                 NOTA: server.module.ts PRECISA INSTANCIAR E EXPORTAR chatwootController.
import { chatwootController } from '@api/server.module';
// Usar alias @validate ou ajustar path
import { chatwootSchema, instanceSchema } from '@validate/validate.schema';
import { RequestHandler, Router, Request, Response, NextFunction } from 'express'; // Importar tipos Express

export class ChatwootRouter extends RouterBroker {

  // CORREÇÃO TS2339: Declarar a propriedade router ANTES do construtor
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super(); // Chamar construtor da base
    // Usar this.router para definir as rotas
    this.router
      .post(this.routerPath('set'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<ChatwootDto>({
            request: req,
            schema: chatwootSchema,
            ClassRef: ChatwootDto,
            execute: (instance, data) => chatwootController.createChatwoot(instance, data),
          });
          res.status(httpStatus.CREATED).json(response);
        } catch (error) {
          next(error);
        }
      })
      .get(this.routerPath('find'), ...guards, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const response = await this.dataValidate<InstanceDto>({
            request: req,
            schema: instanceSchema,
            ClassRef: InstanceDto,
            execute: (instance) => chatwootController.findChatwoot(instance),
          });
          res.status(httpStatus.OK).json(response);
        } catch (error) {
          next(error);
        }
      })
      // Webhook não deve ter guards de instância logada
      // Ajustar a rota para incluir o nome da instância como parâmetro URL
      .post(this.routerPath('webhook/:instanceName'), async (req: Request, res: Response, next: NextFunction) => {
        try {
          const instanceName = req.params.instanceName;
          if (!instanceName) {
            return res.status(httpStatus.BAD_REQUEST).json({ message: "instanceName é obrigatório nos parâmetros da URL do webhook." });
          }
          // O controller espera um objeto { instanceName }, não InstanceDto completo
          const instanceParam = { instanceName };
          const response = await chatwootController.receiveWebhook(instanceParam, req.body);
          res.status(httpStatus.OK).json(response);
        } catch (error) {
           // Não passar erro para next em webhooks normalmente
           console.error("Erro no processamento do webhook Chatwoot:", error);
           res.status(httpStatus.OK).json({ message: "Webhook received, processing error occurred." });
           // Ou: next(error);
        }
      });
  }

  // Implementar ou herdar routerPath e dataValidate
  // Ajustar visibilidade se necessário
  protected routerPath(pathSuffix: string): string {
    const basePath = ''; // Ajustar base path para chatwoot
    return pathSuffix ? `${basePath}/${pathSuffix}` : basePath;
  }

  // MOCK - Substituir pela implementação real de RouterBroker ou local
  protected async dataValidate<T>(args: DataValidateArgs<T>): Promise<any> {
     const instanceName = args.request.params?.instanceName || args.request.body?.instanceName || args.request.headers?.instanceName || args.request.params?.instance;
     if (!instanceName) throw new Error("Nome da instância não encontrado na requisição");
     const instanceMock: InstanceDto = { instanceName: instanceName, instanceId: `mock-${instanceName}-id` };
     // Validação schema
     // const { error } = args.schema.validate(args.request.body);
     // if (error) throw new Error(`Erro de validação: ${error.message}`);
     return await args.execute(instanceMock, args.request.body as T);
  }
}
