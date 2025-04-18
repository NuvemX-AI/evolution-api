import { RouterBroker } from '../../../abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { HttpStatus } from '../../constants/http-status';
import { instanceSchema } from '@validate/instance.schema';
import { RequestHandler, Router } from 'express';

export class BaileysRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();

    const mockResponse = (action: string, instance: any, body: any = null) => ({
      success: true,
      message: `Ação simulada: ${action}`,
      instance,
      data: body,
    });

    this.router
      .post(this.routerPath('onWhatsapp'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('onWhatsapp', instance, req.body),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('profilePictureUrl'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('profilePictureUrl', instance, req.body),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('assertSessions'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('assertSessions', instance, req.body),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('createParticipantNodes'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('createParticipantNodes', instance, req.body),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('generateMessageTag'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('generateMessageTag', instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('sendNode'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('sendNode', instance, req.body),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('signalRepositoryDecryptMessage'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('signalRepositoryDecryptMessage', instance, req.body),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('getAuthState'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: async (instance) => mockResponse('getAuthState', instance),
        });

        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
