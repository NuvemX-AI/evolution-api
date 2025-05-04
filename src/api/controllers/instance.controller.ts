// src/api/controllers/instance.controller.ts
// Correções v8: Remove decorators, adapta para Express req/res, trata erros.
// Correções Gemini: Corrige acesso a waMonitor, tipos DTO, parse json, status code, métodos service.
// Correção Erro 4: Altera path alias para relativo.
// Correção Erro 5: createInstance -> start
// Correção Erro 6: remove -> stop
// Correção Erro 7: Mantém where: { instanceName: instanceName }, adiciona comentário sobre prisma generate.
// Correção Erro 8: Remove chamada incorreta a createInstance na função connect.
// Correção Erros 9, 10, 11, 12, 13: Usa getStatus() ao invés de connectionState.
// Correção Erro 14: Adiciona comentário sobre necessidade de definir sendPresence em ChannelStartupService.


import { Request, Response } from 'express';
import { PrismaRepository } from '@repository/repository.service'; // Ajustar path se necessário
// Importar DTOs necessários
import { InstanceDto, CreateInstanceDto, InstanceUpdateDto, InstanceResponseDto, InstanceStatus } from '../dto/instance.dto';
import { SendPresenceDto } from '../dto/chat.dto';
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { ChannelStartupService } from '../services/channel.service'; // Para tipagem
import { Logger } from '@config/logger.config'; // Assume que Logger está em config
// ** Correção Erro 4: Alterado de '@config/config.service' para path relativo **
// import { ConfigService } from '@config/config.service'; // Comentado - Depende do tsconfig.json
import { ConfigService } from '../../config/config.service'; // Path relativo
import { EventEmitter2 } from '@nestjs/event-emitter'; // Assumindo que event emitter é usado
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Ajustar path
import { Instance } from '@prisma/client'; // Importar tipo Instance do Prisma

export class InstanceController {
    private readonly logger: Logger;
    private readonly httpServerConfig: any; // Tipar melhor se possível
    private readonly authConfig: any; // Tipar melhor se possível

    constructor(
        private readonly configService: ConfigService,
        private readonly waMonitor: WAMonitoringService,
        private readonly prismaRepository: PrismaRepository, // Injetar PrismaRepository
        private readonly eventManager: EventEmitter2, // Injetar EventEmitter
        // Injetar serviços necessários se forem usados diretamente aqui
        private readonly chatwootService: ChatwootService, // Exemplo
        baseLogger: Logger
    ) {
        this.logger = baseLogger; // Atribuir diretamente
        // this.logger = baseLogger.child({ context: InstanceController.name }); // Se child existir
        this.httpServerConfig = this.configService.get('http-server');
        this.authConfig = this.configService.get('auth');
    }

    /**
     * @description Cria uma nova instância
     * @route POST /instance/create
     * @param req { Request } - CreateInstanceDto (body)
     * @param res { Response }
     */
    public async create(req: Request, res: Response): Promise<void> {
        const instanceData: CreateInstanceDto = req.body;
        this.logger.log(`[${instanceData.instanceName}] Solicitando criação de instância`);

        try {
            // ** Correção Erro 5: Alterado de createInstance para start **
            const instanceService = await this.waMonitor.start(instanceData); // Usa start para iniciar/criar

            if (!instanceService) {
                throw new InternalServerErrorException(`Falha ao iniciar a instância ${instanceData.instanceName}. Verifique os logs.`);
            }

            // Formata a resposta conforme InstanceResponseDto
            const responsePayload: InstanceResponseDto = {
                instance: {
                    instanceName: instanceData.instanceName,
                    owner: instanceService.instance?.ownerJid || '', // Acessa via instanceService.instance
                    profileName: instanceService.instance?.profileName || '',
                    profilePictureUrl: instanceService.instance?.profilePicUrl || null,
                    // ** Correção Erro 9: Usa getStatus() **
                    status: this.getStatusFromState(instanceService.getStatus()?.connection), // Pega status da conexão
                },
                hash: {
                    apikey: instanceService.instance?.token || '', // Pega token do BD
                },
                webhook: instanceService.localWebhook, // Pega config de webhook do service
                settings: instanceService.localSettings, // Pega settings do service
            };

            res.status(201).json(responsePayload);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceData.instanceName, message: 'Erro ao criar instância' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

     /**
     * @description Deleta uma instância
     * @route DELETE /instance/delete/:instanceName
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
    public async delete(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.log(`[${instanceName}] Solicitando exclusão de instância`);

        try {
            // ** Correção Erro 6: Alterado de remove para stop **
            const result = await this.waMonitor.stop(instanceName); // Usa stop para parar/remover

             if (result) { // stop retorna boolean ou void, verificar o retorno esperado
                 res.status(200).json({ success: true, message: `Instância ${instanceName} removida.` });
             } else {
                 // Se stop retornar false ou void em caso de falha ou instância não encontrada
                 throw new NotFoundException(`Instância ${instanceName} não encontrada ou falha ao remover.`);
             }
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao deletar instância' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }


    /**
     * @description Conecta uma instância existente (obter QR Code ou status)
     * @route GET /instance/connect/:instanceName
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
     public async connect(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.log(`[${instanceName}] Solicitando conexão/status`);

        try {
            // Tenta buscar a instância no banco primeiro para obter dados
            const instanceDb = await this.prismaRepository.instance.findUnique({
                 // ** Correção Erro 7: Manter instanceName, mas garantir que `npx prisma generate` foi executado **
                 // Se o erro persistir, pode ser necessário usar o ID único (ex: { id: instanceId })
                where: { instanceName: instanceName }, // Tenta buscar por nome único. Garanta que 'npx prisma generate' está atualizado.
            });

             if (!instanceDb) {
                 throw new NotFoundException(`Instância ${instanceName} não encontrada no banco de dados.`);
             }

             // Tenta iniciar a instância (pode já estar rodando, start deve lidar com isso)
            const createDto: CreateInstanceDto = {
                instanceName: instanceDb.instanceName,
                token: instanceDb.token || undefined, // Passar token se existir
                qrcode: true, // Solicitar QR code se não estiver conectado
            };
             const instanceService = await this.waMonitor.start(createDto); // Inicia/Reconecta

            if (!instanceService) {
                throw new InternalServerErrorException(`Falha ao conectar a instância ${instanceName}.`);
            }

             // ** Correção Erro 8: Linha removida daqui **
             // return await this.createInstance(instanceDb as InstanceDto); // Chamada incorreta removida

            // Resposta similar ao 'create', mas talvez sem recriar hash/webhook
            const responsePayload: InstanceResponseDto = {
                 instance: {
                    instanceName: instanceName,
                    owner: instanceService.instance?.ownerJid || '',
                    profileName: instanceService.instance?.profileName || '',
                    profilePictureUrl: instanceService.instance?.profilePicUrl || null,
                     // ** Correção Erro 9: Usa getStatus() **
                     status: this.getStatusFromState(instanceService.getStatus()?.connection),
                },
                 hash: { apikey: instanceDb.token || '' },
                 webhook: instanceService.localWebhook,
                settings: instanceService.localSettings,
            };

            // Se o status for 'qrcode', adiciona o QR code na resposta
            if (responsePayload.instance.status === InstanceStatus.qrcode && instanceService.qrcode?.base64) {
                responsePayload.qrcode = {
                    base64: instanceService.qrcode.base64,
                    pairingCode: instanceService.qrcode.pairingCode ?? undefined, // Usar pairingCode se disponível
                    code: instanceService.qrcode.code ?? undefined, // Usar code se disponível
                    count: instanceService.qrcode.count ?? 0,
                };
             }

             res.status(200).json(responsePayload);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: 'Erro ao conectar instância' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }


    /**
     * @description Reconecta uma instância
     * @route GET /instance/reconnect/:instanceName
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
     public async reconnect(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.log(`[${instanceName}] Solicitando reconexão`);
        try {
            const instanceService = this.waMonitor.get(instanceName);
            if (!instanceService) {
                throw new NotFoundException(`Instância ${instanceName} não encontrada ou não ativa.`);
            }
            await instanceService.restart?.(); // Tenta chamar restart

             // Resposta pode ser simples ou retornar o status atualizado
             // ** Correção Erro 10: Usa getStatus() **
             const newState = instanceService.getStatus()?.connection ?? 'connecting';
             res.status(200).json({
                 success: true,
                 message: `Reconexão solicitada para ${instanceName}.`,
                 status: this.getStatusFromState(newState),
             });
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao reconectar instância' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

     /**
     * @description Desconecta (logout) uma instância
     * @route GET /instance/logout/:instanceName
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
    public async logout(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.log(`[${instanceName}] Solicitando logout`);
        try {
            const instanceService = this.waMonitor.get(instanceName);
             if (!instanceService) {
                throw new NotFoundException(`Instância ${instanceName} não encontrada ou não ativa.`);
            }
            await instanceService.logout?.(); // Chama logout do service

             // ** Correção Erro 11: Usa getStatus() **
            const state = instanceService?.getStatus()?.connection ?? 'close';
             res.status(200).json({
                 success: true,
                 message: `Logout solicitado para ${instanceName}.`,
                 status: this.getStatusFromState(state),
             });
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao fazer logout da instância' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Obtém status de conexão de uma instância
     * @route GET /instance/connectionState/:instanceName
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
     public async connectionState(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.debug(`[${instanceName}] Verificando status da conexão`);
        try {
            const instanceService = this.waMonitor.get(instanceName);
             if (!instanceService) {
                 const instanceDb = await this.prismaRepository.instance.findUnique({ where: { instanceName } });
                 if (instanceDb) {
                    res.status(200).json({ status: InstanceStatus.close });
                    return;
                } else {
                    throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
                }
            }

            // ** Correção Erro 12: Usa getStatus() **
            const state = instanceService.getStatus()?.connection;
            res.status(200).json({ status: this.getStatusFromState(state) });
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao verificar status da conexão' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Obtém todas as instâncias (ativas e/ou do DB)
     * @route GET /instance/fetchInstances
     * @param req { Request }
     * @param res { Response }
     */
     public async fetchInstances(req: Request, res: Response): Promise<void> {
        this.logger.debug(`Buscando todas as instâncias`);
        try {
            const instances = await this.waMonitor.getAllInstances(); // Método que retorna infos das instâncias
            res.status(200).json(instances);
        } catch (error: any) {
             this.logger.error({ err: error, message: 'Erro ao buscar instâncias' });
             res.status(500).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Atualiza configurações da instância (webhook, settings)
     * @route PATCH /instance/update/:instanceName
     * @param req { Request } - instanceName (params), InstanceUpdateDto (body)
     * @param res { Response }
     */
    public async update(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const updateData: InstanceUpdateDto = req.body;

        this.logger.log(`[${instanceName}] Atualizando configurações`);
        try {
            const instanceService = this.waMonitor.get(instanceName);
            if (!instanceService) {
                throw new NotFoundException(`Instância ${instanceName} não encontrada ou não ativa para atualização.`);
            }

             await instanceService.updateInstanceConfig?.(updateData); // Método para atualizar config

             const responsePayload: Partial<InstanceResponseDto> = {
                 webhook: instanceService.localWebhook,
                 settings: instanceService.localSettings,
             };
             res.status(200).json({ success: true, message: 'Configurações atualizadas.', data: responsePayload });

        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar instância' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

     /**
     * @description Envia status de presença (typing, recording)
     * @route POST /instance/presence/:instanceName
     * @param req { Request } - instanceName (params), SendPresenceDto (body)
     * @param res { Response }
     */
    public async sendPresence(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const presenceData: SendPresenceDto = req.body;

        this.logger.debug(`[${instanceName}] Enviando presença ${presenceData.presence} para ${presenceData.number}`);
        try {
            const instanceService = this.waMonitor.get(instanceName);
            if (!instanceService) {
                throw new NotFoundException(`Instância ${instanceName} não encontrada ou não ativa.`);
            }

            // ** Correção Erro 13: Usa getStatus() **
             if (instanceService.getStatus()?.connection !== 'open') {
                throw new BadRequestException(`Instância ${instanceName} não está conectada (${instanceService.getStatus()?.connection}).`);
            }

            // ** Correção Erro 14: A chamada está correta, mas o método deve existir em ChannelStartupService **
            // A correção real é garantir que ChannelStartupService (e suas implementações) definam 'sendPresence'.
            const result = await instanceService.sendPresence?.(presenceData);
            res.status(200).json(result);

        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao enviar presença' });
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }


    // Helper para mapear estado Baileys para InstanceStatus DTO
    private getStatusFromState(connectionState: string | undefined): InstanceStatus {
        switch (connectionState) {
            case 'open':
                return InstanceStatus.open;
            case 'connecting':
                return InstanceStatus.connecting;
            case 'close':
                return InstanceStatus.close;
            case 'qr':
                 return InstanceStatus.qrcode;
            default:
                return InstanceStatus.close;
        }
    }
}
