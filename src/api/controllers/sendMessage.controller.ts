// src/api/controllers/sendMessage.controller.ts
// Correções v8: Remove decorators, adapta para Express req/res, trata erros, usa Multer.
// Correções Gemini: Corrige acesso a métodos/propriedades do service, tratamento de erro, DTOs.
// Correção Erro 20: Remove verificação redundante ' !== "text" '.
// Comentários adicionados para erros 15, 16, 17, 18, 19, 21 indicando necessidade de correção nos Services.

import { Request, Response } from 'express';
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { Logger } from '@config/logger.config';
// Importar DTOs necessários
import {
    SendContactDto,
    SendTextDto,
    SendLocationDto,
    SendLinkDto,
    SendReactionDto,
    SendMediaDto, // Assume SendMediaUrlDto foi mesclado ou removido
    SendButtonsDto,
    SendTemplateDto,
    SendListDto,
    SendPollDto,
    SendStatusDto, // Usado para status
    // Tipos que parecem faltar ou foram renomeados:
    // SendAudioDto, SendStickerDto, SendPtvDto (Talvez cobertos por SendMediaDto?)
} from '../dto/sendMessage.dto';
import { InstanceDto } from '../dto/instance.dto';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { Multer } from 'multer'; // Importar Multer para tipagem de 'file'

// Interface para representar o arquivo carregado pelo Multer (simplificada)
interface UploadedFile extends Multer.File {}

export class SendMessageController {
    private readonly logger: Logger;

    constructor(
        private readonly waMonitor: WAMonitoringService,
        baseLogger: Logger
    ) {
        this.logger = baseLogger; // Atribuir diretamente
        // this.logger = baseLogger.child({ context: SendMessageController.name }); // Se child existir
    }

    // --- Métodos adaptados para Express ---

    public async sendText(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendTextDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando mensagem de texto para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.sendText?.(data);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar texto', res);
        }
    }

    public async sendContact(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendContactDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando contato para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.contactMessage?.(data); // Assumindo que o método se chama contactMessage
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar contato', res);
        }
    }

    public async sendLocation(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendLocationDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando localização para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.locationMessage?.(data); // Assumindo que o método se chama locationMessage
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar localização', res);
        }
    }

     // ** Erro 15: O método 'ptvMessage' precisa ser definido em ChannelStartupService/implementações **
    public async sendPtv(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendMediaDto = req.body; // Reutilizar SendMediaDto? Verificar DTO correto
        const file = req.file as UploadedFile | undefined; // Arquivo do Multer

        this.logger.debug(`[${instanceName}] Enviando PTV para ${data.number}`);
        if (!file) {
             this.handleError(new BadRequestException('Arquivo (file) é obrigatório para PTV.'), instanceName, '', res);
             return;
        }
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumindo que ptvMessage existe no service
            const result = await instance.ptvMessage?.(data, file);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar PTV', res);
        }
    }

     // ** Erro 16: O método 'mediaSticker' precisa ser definido em ChannelStartupService/implementações **
     public async sendSticker(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendMediaDto = req.body; // Reutilizar SendMediaDto? Verificar DTO correto
        const file = req.file as UploadedFile | undefined; // Arquivo do Multer

        this.logger.debug(`[${instanceName}] Enviando Sticker para ${data.number}`);
         if (!file) {
            this.handleError(new BadRequestException('Arquivo (file) é obrigatório para Sticker.'), instanceName, '', res);
             return;
         }
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumindo que mediaSticker existe no service
            const result = await instance.mediaSticker?.(data, file);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar sticker', res);
        }
    }

    // ** Erro 17: O método 'audioWhatsapp' (ou similar) precisa ser definido em ChannelStartupService/implementações **
    public async sendAudio(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendMediaDto = req.body; // Reutilizar SendMediaDto? Verificar DTO correto
        const file = req.file as UploadedFile | undefined; // Arquivo do Multer

        this.logger.debug(`[${instanceName}] Enviando Áudio para ${data.number}`);
        if (!file) {
            this.handleError(new BadRequestException('Arquivo (file) é obrigatório para Áudio.'), instanceName, '', res);
             return;
        }
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que método existe (ex: audioWhatsapp ou sendAudio)
            const result = await instance.audioWhatsapp?.(data, file);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar áudio', res);
        }
    }

    // ** Erro 18: O método 'listMessage' precisa ser definido em ChannelStartupService/implementações **
    public async sendListMessage(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendListDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando Lista para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que método existe
            const result = await instance.listMessage?.(data);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar lista', res);
        }
    }

    public async sendLink(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendLinkDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando Link para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.linkMessage?.(data); // Assumindo linkMessage
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar link', res);
        }
    }

    public async sendReaction(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendReactionDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando Reação para ${data.key.remoteJid}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.reactionMessage?.(data); // Assumindo reactionMessage
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar reação', res);
        }
    }

     // ** Erro 19: O método 'pollMessage' precisa ser definido em ChannelStartupService/implementações **
    public async sendPoll(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendPollDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando Enquete para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumir que método existe
            const result = await instance.pollMessage?.(data);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar enquete', res);
        }
    }

    // ** Erro 21: O método 'statusMessage' precisa ser definido em ChannelStartupService/implementações **
    public async sendStatus(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendStatusDto = req.body;
        const file = req.file as UploadedFile | undefined;

        this.logger.debug(`[${instanceName}] Enviando Status para ${data.number}`);

        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);

            // Lógica para status de texto (se aplicável e não tratada no service)
            if (data.options?.type === 'text' || data.mediaType === 'text') {
                 if (!data.message) {
                     throw new BadRequestException('Propriedade "message" é obrigatória para status de texto.');
                 }
                // Chamar método específico ou adaptar sendText? Por ora, assumir statusMessage lida com isso.
            } else {
                // Lógica para status de mídia
                if (!file) {
                    throw new BadRequestException('Arquivo (file) é obrigatório para status de mídia (imagem/vídeo).');
                }
                // ** Correção Erro 20: Removido check redundante ' !== "text" ' **
                if (data.mediaType !== 'image' && data.mediaType !== 'video') {
                    throw new BadRequestException('Status só pode ser enviado com mediaType image ou video.');
                }
            }

            // Assumir que statusMessage existe e trata ambos os casos (texto/mídia)
            const result = await instance.statusMessage?.(data, file);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar status', res);
        }
    }


    public async sendMedia(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendMediaDto = req.body;
        const file = req.file as UploadedFile | undefined;

        this.logger.debug(`[${instanceName}] Enviando Mídia ${data.mediaType} para ${data.number}`);

         if (!file) {
             this.handleError(new BadRequestException('Arquivo (file) é obrigatório para Mídia.'), instanceName, '', res);
             return;
         }

        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumindo um método genérico 'mediaMessage' no service
            const result = await instance.mediaMessage?.(data, file);
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar mídia', res);
        }
    }

    public async sendButton(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendButtonsDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando Botões para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.buttonsMessage?.(data); // Assumindo buttonsMessage
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar botões', res);
        }
    }

    public async sendTemplate(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendTemplateDto = req.body;
        this.logger.debug(`[${instanceName}] Enviando Template para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            const result = await instance.templateMessage?.(data); // Assumindo templateMessage
            res.status(201).json(result);
        } catch (error: any) {
            this.handleError(error, instanceName, 'Erro ao enviar template', res);
        }
    }

     // Helper para tratamento de erros
    private handleError(error: any, instanceName: string | null, contextMessage: string, res: Response): void {
         const logMsg = contextMessage || 'Erro no SendMessageController';
         this.logger.error({ err: error, instance: instanceName, message: logMsg });
         const statusCode = error instanceof NotFoundException ? 404 :
                            error instanceof BadRequestException ? 400 : 500;
         res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }

} // Fim da classe
