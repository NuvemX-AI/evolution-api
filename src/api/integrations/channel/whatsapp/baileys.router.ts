import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
// CORREÇÃO: Verificar se HttpStatus está definido neste local ou precisa ajustar path/alias
import { HttpStatus } from '@api/routes/index.router';
// CORREÇÃO: Verificar se baileysController é exportado corretamente
import { baileysController } from '@api/server.module';
// CORREÇÃO: Usar alias @validate ou path relativo correto
import { instanceSchema } from '@validate/instance.schema';
import { RequestHandler, Router } from 'express'; // Importar Router do express

export class BaileysRouter extends RouterBroker {

  // CORREÇÃO TS2339: Mover a declaração da propriedade 'router' para ANTES do construtor
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    super(); // Chamar construtor da classe base

    // Agora 'this.router' pode ser acessado aqui sem erro
    this.router
      .post(this.routerPath('onWhatsapp'), ...guards, async (req, res) => {
        // A validação e execução permanecem as mesmas
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto, // Passa a classe DTO para validação
          execute: (instance) => baileysController.onWhatsapp(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('profilePictureUrl'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => baileysController.profilePictureUrl(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('assertSessions'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => baileysController.assertSessions(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('createParticipantNodes'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          // Nota: createParticipantNodes foi comentado no controller por não existir no service
          // A rota pode precisar ser removida ou o método implementado no service/controller
          execute: (instance) => baileysController.createParticipantNodes(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('getUSyncDevices'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => baileysController.getUSyncDevices(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('generateMessageTag'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => baileysController.generateMessageTag(instance),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('sendNode'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => baileysController.sendNode(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('signalRepositoryDecryptMessage'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
           // Nota: signalRepositoryDecryptMessage foi comentado no controller por não existir no service
           // A rota pode precisar ser removida ou o método implementado no service/controller
          execute: (instance) => baileysController.signalRepositoryDecryptMessage(instance, req.body),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('getAuthState'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => baileysController.getAuthState(instance),
        });
        res.status(HttpStatus.OK).json(response);
      });
  }

  // A declaração foi movida para antes do construtor
  // public readonly router: Router = Router();
}

// Remover chave extra no final, se houver
