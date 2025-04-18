import { RouterBroker } from '../../../abstract/abstract.router';
import { IgnoreJidDto } from '../../../../dto/chatbot.dto';
import { InstanceDto } from '../../../../dto/instance.dto';
import { HttpStatus } from '../../../../routes/index.router';
import { evolutionBotController } from '../../../../server.module';
import { instanceSchema } from '@validate/instance.schema';
import { RequestHandler, Router } from 'express';

import { EvolutionBotDto, EvolutionBotSettingDto } from '../dto/evolutionBot.dto';
import {
  evolutionBotIgnoreJidSchema,
  evolutionBotSchema,
  evolutionBotSettingSchema,
  evolutionBotStatusSchema,
} from '../validate/evolutionBot.schema';

export class EvolutionBotRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        const response = await this.dataValidate<EvolutionBotDto>({
          request: req,
          schema: evolutionBotSchema,
          ClassRef: EvolutionBotDto,
          execute: (instance, data) => evolutionBotController.createBot(instance, data),
        });

        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => evolutionBotController.findBot(instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetch/:evolutionBotId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => evolutionBotController.fetchBot(instance, req.params.evolutionBotId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .put(this.routerPath('update/:evolutionBotId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<EvolutionBotDto>({
          request: req,
          schema: evolutionBotSchema,
          ClassRef: EvolutionBotDto,
          execute: (instance, data) => evolutionBotController.updateBot(instance, req.params.evolutionBotId, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete/:evolutionBotId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => evolutionBotController.deleteBot(instance, req.params.evolutionBotId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<EvolutionBotSettingDto>({
          request: req,
          schema: evolutionBotSettingSchema,
          ClassRef: EvolutionBotSettingDto,
          execute: (instance, data) => evolutionBotController.settings(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => evolutionBotController.fetchSettings(instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: evolutionBotStatusSchema,
          ClassRef: InstanceDto,
          execute: (instance, data) => evolutionBotController.changeStatus(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSessions/:evolutionBotId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => evolutionBotController.fetchSessions(instance, req.params.evolutionBotId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req, res) => {
        const response = await this.dataValidate<IgnoreJidDto>({
          request: req,
          schema: evolutionBotIgnoreJidSchema,
          ClassRef: IgnoreJidDto,
          execute: (instance, data) => evolutionBotController.ignoreJid(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
