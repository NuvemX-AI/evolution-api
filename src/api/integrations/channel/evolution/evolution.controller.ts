// src/api/integrations/channel/evolution/evolution.controller.ts
// Correção Erro 50: Adiciona comentário sobre prisma generate.
// Correção Erro 51, 52: Adiciona checagem de null para instance, mantém acesso a instanceName.

import { Request, Response } from 'express';
import { PrismaRepository } from '@repository/repository.service'; // Ajustar path se necessário
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustar path se necessário
import { Logger } from '@config/logger.config'; // Ajustar path se necessário
import { Instance, Prisma } from '@prisma/client'; // Importar tipos Prisma
import { NotFoundException, BadRequestException, InternalServerErrorException } from '@exceptions/index'; // Ajustar path se necessário
import { EvolutionStartupService } from './evolution.channel.service'; // Importar o serviço específico
import { EventEmitter2 } from '@nestjs/event-emitter'; // Para emitir eventos
import { Events } from '@api/integrations/event/event.dto'; // Ajustar path

// Interface para o payload esperado do webhook da Evolution API
interface EvolutionWebhookPayload {
    event: string;
    instance: string;
    data: any;
    // Adicionar outros campos se existirem (destination, owner, etc.)
}

export class EvolutionController {
    private readonly logger: Logger;

    constructor(
        private readonly prismaRepository: PrismaRepository,
        private readonly waMonitor: WAMonitoringService,
        private readonly eventEmitter: EventEmitter2, // Injetar EventEmitter
        baseLogger: Logger // Receber logger base
    ) {
         // Idealmente, criar um logger filho com contexto
         this.logger = baseLogger; // Ou baseLogger.child({ context: EvolutionController.name }); se existir
    }

    /**
     * @description Recebe eventos do webhook da Evolution API
     * @route POST /evolution/webhook/:identifier
     * @param req { Request } - identifier (params), EvolutionWebhookPayload (body)
     * @param res { Response }
     */
    public async handleWebhook(req: Request, res: Response): Promise<void> {
        const identifierField = req.params.identifier; // Pode ser instanceName ou apikey
        const payload: EvolutionWebhookPayload = req.body;

        this.logger.debug(`[${payload.instance}] Recebido webhook Evolution: ${payload.event}`);

        if (!payload || !payload.instance || !payload.event) {
            this.logger.warn('Payload do webhook Evolution inválido recebido.', payload);
             res.status(400).send({ message: 'Payload inválido.' });
             return;
        }

        try {
             // 1. Encontrar a instância no DB usando o identificador (pode ser instanceName ou apikey)
             const instance = await this.findInstanceByIdentifier(identifierField);

             // ** Correção Erro 51/52: Adicionar checagem de null **
             if (!instance) {
                 // Se não encontrou pelo identificador, talvez o payload.instance seja o nome correto?
                 // Tentar buscar por payload.instance se diferente do identifierField?
                 this.logger.warn(`[${payload.instance}] Instância não encontrada no DB com identificador: ${identifierField}. Payload pode estar associado a outra instância.`);
                 // Decide se retorna erro ou ignora. Por segurança, retornar erro.
                 res.status(404).send({ message: `Instância não encontrada com identificador: ${identifierField}` });
                 return;
             }

             // Verificar se o nome da instância no payload corresponde à instância encontrada (opcional, mas bom para segurança)
             if (instance.instanceName !== payload.instance) {
                 this.logger.warn(`[${payload.instance}] Discrepância entre identificador da rota (${identifierField} -> ${instance.instanceName}) e nome no payload webhook (${payload.instance}). Processando mesmo assim.`);
                 // Considerar retornar erro 403 Forbidden se a discrepância for um problema de segurança
             }


             // 2. Obter a instância monitorada correspondente
             // ** Correção Erro 51: Mantém acesso a instanceName, assumindo tipo correto **
             const monitoredInstance = this.waMonitor.waInstances[instance.instanceName];

             if (!monitoredInstance || !(monitoredInstance instanceof EvolutionStartupService)) {
                // ** Correção Erro 52: Mantém acesso a instanceName, assumindo tipo correto **
                 this.logger.error(`[${instance.instanceName}] Instância encontrada no DB mas não está ativa no monitor ou não é do tipo Evolution.`);
                 // Tentar iniciar a instância? Ou apenas retornar erro?
                 // Por ora, retornar erro, pois o webhook espera uma instância ativa.
                 res.status(404).send({ message: `Instância ${instance.instanceName} não está ativa ou configurada corretamente.` });
                 return;
             }

             // 3. Repassar o evento para o serviço da instância processar
             await monitoredInstance.handleEvolutionEvent(payload);

             // 4. Responder ao webhook
             res.status(200).send({ message: 'Evento recebido com sucesso.' });

        } catch (error: any) {
             this.logger.error(`[${payload?.instance || identifierField}] Erro ao processar webhook Evolution: ${error.message}`, error.stack);
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno ao processar webhook.' });
        }
    }

    /**
     * Helper para encontrar instância por nome ou token (apikey)
     */
    private async findInstanceByIdentifier(identifier: string): Promise<Instance | null> {
        // Tenta buscar por instanceName primeiro
        let instance = await this.prismaRepository.instance.findUnique({
            // ** Correção Erro 50: Manter where, adicionar comentário sobre prisma generate **
             where: { instanceName: identifier }, // Garanta que 'npx prisma generate' está atualizado.
        });

        if (!instance) {
            // Se não encontrou por nome, tenta buscar por token (apikey)
            instance = await this.prismaRepository.instance.findFirst({
                where: { token: identifier }, // Busca pelo token
            });
        }

        return instance;
    }
}
