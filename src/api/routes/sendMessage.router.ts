import { RouterBroker } from '../abstract/abstract.router';
import {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStatusDto,
  SendStickerDto,
  SendTemplateDto,
  SendTextDto,
} from '../dto/sendMessage.dto';
import { SendMessageController } from '../controllers/sendMessage.controller';

import {
  audioMessageSchema,
  buttonsMessageSchema,
  contactMessageSchema,
  listMessageSchema,
  locationMessageSchema,
  mediaMessageSchema,
  pollMessageSchema,
  ptvMessageSchema,
  reactionMessageSchema,
  statusMessageSchema,
  stickerMessageSchema,
  templateMessageSchema,
  textMessageSchema,
} from '@validate/validate.schema';
import { RequestHandler, Router, Request } from 'express';
import multer from 'multer';
import { HttpStatus } from '../constants/http-status';
import { WAMonitoringService } from '../services/wa-monitoring.service';

// Augmentação compatível e segura
declare global {
  namespace Express {
    interface Request {
      file?: any; // Para máxima compatibilidade/multer
    }
  }
}

const upload = multer({ storage: multer.memoryStorage() });

export class MessageRouter extends RouterBroker {
  public readonly router: Router = Router();
  private readonly sendMessageController: SendMessageController;

  constructor(
    waMonitor: WAMonitoringService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.sendMessageController = new SendMessageController(waMonitor);

    this.router
      .post(this.routerPath('sendTemplate'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendTemplateDto>({
          request: req,
          schema: templateMessageSchema,
          ClassRef: SendTemplateDto,
          execute: (instance, data) => this.sendMessageController.sendTemplate(instance, data),
        });
        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendText'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendTextDto>({
          request: req,
          schema: textMessageSchema,
          ClassRef: SendTextDto,
          execute: (instance, data) => this.sendMessageController.sendText(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendMedia'), ...guards, upload.single('file'), async (req: Request, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendMediaDto>({
          request: req,
          schema: mediaMessageSchema,
          ClassRef: SendMediaDto,
          execute: (instance) => this.sendMessageController.sendMedia(instance, bodyData, req.file),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPtv'), ...guards, upload.single('file'), async (req: Request, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendPtvDto>({
          request: req,
          schema: ptvMessageSchema,
          ClassRef: SendPtvDto,
          execute: (instance) => this.sendMessageController.sendPtv(instance, bodyData, req.file),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendWhatsAppAudio'), ...guards, upload.single('file'), async (req: Request, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendAudioDto>({
          request: req,
          schema: audioMessageSchema,
          ClassRef: SendMediaDto,
          execute: (instance) => this.sendMessageController.sendWhatsAppAudio(instance, bodyData, req.file),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendStatus'), ...guards, upload.single('file'), async (req: Request, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendStatusDto>({
          request: req,
          schema: statusMessageSchema,
          ClassRef: SendStatusDto,
          execute: (instance) => this.sendMessageController.sendStatus(instance, bodyData, req.file),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendSticker'), ...guards, upload.single('file'), async (req: Request, res) => {
        const bodyData = req.body;

        const response = await this.dataValidate<SendStickerDto>({
          request: req,
          schema: stickerMessageSchema,
          ClassRef: SendStickerDto,
          execute: (instance) => this.sendMessageController.sendSticker(instance, bodyData, req.file),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendLocation'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendLocationDto>({
          request: req,
          schema: locationMessageSchema,
          ClassRef: SendLocationDto,
          execute: (instance, data) => this.sendMessageController.sendLocation(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendContact'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendContactDto>({
          request: req,
          schema: contactMessageSchema,
          ClassRef: SendContactDto,
          execute: (instance, data) => this.sendMessageController.sendContact(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendReaction'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendReactionDto>({
          request: req,
          schema: reactionMessageSchema,
          ClassRef: SendReactionDto,
          execute: (instance, data) => this.sendMessageController.sendReaction(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPoll'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendPollDto>({
          request: req,
          schema: pollMessageSchema,
          ClassRef: SendPollDto,
          execute: (instance, data) => this.sendMessageController.sendPoll(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendList'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendListDto>({
          request: req,
          schema: listMessageSchema,
          ClassRef: SendListDto,
          execute: (instance, data) => this.sendMessageController.sendList(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendButtons'), ...guards, async (req, res) => {
        const response = await this.dataValidate<SendButtonsDto>({
          request: req,
          schema: buttonsMessageSchema,
          ClassRef: SendButtonsDto,
          execute: (instance, data) => this.sendMessageController.sendButtons(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      });
  }
}
