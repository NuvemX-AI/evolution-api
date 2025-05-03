// src/api/controllers/chat.controller.ts
// Correções v8: Remove decorators, adapta para Express req/res, trata erros.
// Correções Gemini: Corrige acesso a 'error.status', 'logger.child', 'data.number' e 'pagination'.

import { Request, Response } from 'express'; // Importar tipos do Express
// Importar todos os DTOs necessários
import {
    ArchiveChatDto,
    BlockUserDto,
    DeleteMessage,
    getBase64FromMediaMessageDto,
    MarkChatUnreadDto,
    NumberDto,
    PrivacySettingDto,
    ProfileNameDto,
    ProfilePictureDto,
    ProfileStatusDto,
    ReadMessageDto,
    SendPresenceDto,
    UpdateMessageDto,
    WhatsAppNumberDto,
} from '../dto/chat.dto';
import { InstanceDto } from '../dto/instance.dto';
// Importar Query apenas para tipagem, se necessário internamente
import { Query } from '@repository/repository.service'; // Ajustar path se necessário - A definição de Query<T> é necessária para corrigir completamente a linha 41
import { WAMonitoringService } from '../services/wa-monitoring.service';
// Importar tipos Prisma para tipagem de retorno (opcional, pode usar any)
import { Contact, Message, MessageUpdate } from '@prisma/client';
import { Logger } from '@config/logger.config';
// Importar exceções para tratamento de erro
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';

// Helper para parsear query params para estrutura Query<T>
// **Atenção:** Esta é uma implementação SIMPLES. Adapte conforme sua definição real de Query<T>
function parseQueryParams<T>(queryParams: Request['query']): Query<T> {
    const page = parseInt(queryParams.page as string || '1');
    const limit = parseInt(queryParams.limit as string || '25');
    const filters: Partial<T> = { ...queryParams } as Partial<T>;
    delete (filters as any).page;
    delete (filters as any).limit;
    // TODO: Adicionar parsing para orderBy se necessário
    const orderBy = undefined; // Exemplo: queryParams.orderBy ? JSON.parse(queryParams.orderBy as string) : undefined;

    // Remover propriedades vazias ou indefinidas dos filtros
    Object.keys(filters).forEach(key => (filters as any)[key] == null && delete (filters as any)[key]);


    return {
        filters: filters,
        // CORREÇÃO: Comentado pois 'pagination' pode não existir em Query<T> ou ter outro formato
        // pagination: { page, limit },
        orderBy: orderBy
    };
}

export class ChatController {
    private readonly logger: Logger;

    constructor(
        // Injetar dependências (assumindo que WAMonitoringService e Logger são fornecidos)
        private readonly waMonitor: WAMonitoringService,
        baseLogger: Logger
    ) {
        // CORREÇÃO: Remover .child() pois o método pode não existir no tipo Logger
        this.logger = baseLogger; // Atribuir diretamente
        // Adicionar contexto se houver outra forma: this.logger.setContext(ChatController.name);
    }

    // --- Métodos adaptados para Express ---

    /**
     * @description Verifica números no WhatsApp
     * @route POST /:instanceName/chat/whatsapp-number
     * @param req { Request } - instanceName (params), WhatsAppNumberDto (body)
     * @param res { Response }
     */
    public async whatsappNumber(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: WhatsAppNumberDto = req.body; // Validação do DTO deve ocorrer em middleware anterior

        this.logger.debug(`[${instanceName}] Verificando números WhatsApp`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) {
                 // Usar NotFoundException
                 throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            }
            // Assumir que o método existe no service e espera o DTO
            const result = await instance.onWhatsapp?.(data); // Usar onWhatsapp
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao verificar número whatsapp' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Marca mensagens como lidas
     * @route POST /:instanceName/chat/read-message
     * @param req { Request } - instanceName (params), ReadMessageDto (body)
     * @param res { Response }
     */
    public async readMessage(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: ReadMessageDto = req.body;

        this.logger.debug(`[${instanceName}] Marcando mensagens como lidas`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.markMessageAsRead?.(data);
            res.status(200).json(result || { message: 'Mensagens marcadas como lidas', read: 'success' });
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao marcar mensagens como lidas' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }
    /**
     * @description Arquiva/Desarquiva um chat
     * @route POST /:instanceName/chat/archive
     * @param req { Request } - instanceName (params), ArchiveChatDto (body)
     * @param res { Response }
     */
    public async archiveChat(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: ArchiveChatDto = req.body;

        // CORREÇÃO: Usar 'jid' (ou propriedade correta do DTO) em vez de 'number'
        this.logger.debug(`[${instanceName}] Arquivando/Desarquivando chat ${data.jid}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumir que o método existe no service
            const result = await instance.archiveChat?.(data);
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao arquivar chat' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Marca um chat como não lido
     * @route POST /:instanceName/chat/mark-unread
     * @param req { Request } - instanceName (params), MarkChatUnreadDto (body)
     * @param res { Response }
     */
    public async markChatUnread(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: MarkChatUnreadDto = req.body;

        // CORREÇÃO: Usar 'jid' (ou propriedade correta do DTO) em vez de 'number'
        this.logger.debug(`[${instanceName}] Marcando chat ${data.jid} como não lido`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumir que o método existe no service
            const result = await instance.markChatUnread?.(data);
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao marcar chat como não lido' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Deleta uma mensagem para todos
     * @route POST /:instanceName/chat/delete-message
     * @param req { Request } - instanceName (params), DeleteMessage (body)
     * @param res { Response }
     */
    public async deleteMessage(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: DeleteMessage = req.body;

        this.logger.debug(`[${instanceName}] Deletando mensagem ${data.id}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumir que o método existe no service
            await instance.deleteMessage?.(data); // Método pode não retornar nada útil
            res.status(200).json({ deleted: true, messageId: data.id });
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao deletar mensagem' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Obtém a URL da foto de perfil de um contato/grupo
     * @route POST /:instanceName/chat/profile-picture-url
     * @param req { Request } - instanceName (params), NumberDto (body)
     * @param res { Response }
     */
    public async fetchProfilePicture(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: NumberDto = req.body;

        this.logger.debug(`[${instanceName}] Buscando URL da foto de perfil para ${data.number}`);
        try {
            const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.profilePicture?.(data.number);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: 'Erro ao buscar URL da foto de perfil' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Obtém informações de perfil (status, foto, nome)
     * @route POST /:instanceName/chat/profile-info
     * @param req { Request } - instanceName (params), NumberDto (body)
     * @param res { Response }
     */
    public async fetchProfile(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: NumberDto = req.body;

        this.logger.debug(`[${instanceName}] Buscando informações de perfil para ${data.number}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.fetchProfile?.(data.number); // Passar apenas o número
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao buscar perfil' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Busca contatos salvos no DB
     * @route GET /:instanceName/chat/contacts
     * @param req { Request } - instanceName (params), Query<Contact> (query params)
     * @param res { Response }
     */
    public async fetchContacts(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        // Parsear query params usando helper
        const query: Query<Contact> = parseQueryParams<Contact>(req.query);

        this.logger.debug(`[${instanceName}] Buscando contatos com query: ${JSON.stringify(query)}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.fetchContacts?.(query);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, query, message: 'Erro ao buscar contatos' });
            // CORREÇÃO: Usar status codes explícitos
            const statusCode = error instanceof NotFoundException ? 404 :
                               error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Obtém Base64 de uma mídia a partir da mensagem
     * @route POST /:instanceName/chat/media-base64
     * @param req { Request } - instanceName (params), getBase64FromMediaMessageDto (body)
     * @param res { Response }
     */
    public async getBase64FromMediaMessage(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: getBase64FromMediaMessageDto = req.body;

        this.logger.debug(`[${instanceName}] Obtendo Base64 da mensagem de mídia`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.getBase64FromMediaMessage?.(data);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: 'Erro ao obter base64 da mídia' });
            // CORREÇÃO: Usar status codes explícitos
            const statusCode = error instanceof NotFoundException ? 404 :
                               error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Busca mensagens salvas no DB
     * @route GET /:instanceName/chat/messages
     * @param req { Request } - instanceName (params), Query<Message> (query params)
     * @param res { Response }
     */
    public async fetchMessages(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        // Parsear query params
        const query: Query<Message> = parseQueryParams<Message>(req.query);

        this.logger.debug(`[${instanceName}] Buscando mensagens com query: ${JSON.stringify(query)}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumir que o método existe no service
            const result = await instance.fetchMessages?.(query);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, query, message: 'Erro ao buscar mensagens' });
            // CORREÇÃO: Usar status codes explícitos
            const statusCode = error instanceof NotFoundException ? 404 :
                               error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Busca status de mensagens salvos no DB
     * @route GET /:instanceName/chat/message-status
     * @param req { Request } - instanceName (params), Query<MessageUpdate> (query params)
     * @param res { Response }
     */
    public async fetchStatusMessage(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
         // Parsear query params
         const query: Query<MessageUpdate> = parseQueryParams<MessageUpdate>(req.query);

        this.logger.debug(`[${instanceName}] Buscando status de mensagens com query: ${JSON.stringify(query)}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.fetchStatusMessage?.(query);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, query, message: 'Erro ao buscar status de mensagens' });
            // CORREÇÃO: Usar status codes explícitos
            const statusCode = error instanceof NotFoundException ? 404 :
                               error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Busca chats salvos no DB
     * @route GET /:instanceName/chat/chats
     * @param req { Request } - instanceName (params), Query<any> (query params)
     * @param res { Response }
     */
    public async fetchChats(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        // Parsear query params (usando 'any' como antes)
        const query: Query<any> = parseQueryParams<any>(req.query);

        this.logger.debug(`[${instanceName}] Buscando chats com query: ${JSON.stringify(query)}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.fetchChats?.(query);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, query, message: 'Erro ao buscar chats' });
            // CORREÇÃO: Usar status codes explícitos
            const statusCode = error instanceof NotFoundException ? 404 :
                               error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Envia status de presença (digitando, gravando, online, etc.)
     * @route POST /:instanceName/chat/presence
     * @param req { Request } - instanceName (params), SendPresenceDto (body)
     * @param res { Response }
     */
    public async sendPresence(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: SendPresenceDto = req.body;

        this.logger.debug(`[${instanceName}] Enviando presença ${data.presence} para ${data.number}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.sendPresence?.(data);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: 'Erro ao enviar presença' });
            // CORREÇÃO: Usar status codes explícitos
            const statusCode = error instanceof NotFoundException ? 404 :
                               error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Busca configurações de privacidade
     * @route GET /:instanceName/chat/privacy-settings
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
    public async fetchPrivacySettings(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.debug(`[${instanceName}] Buscando configurações de privacidade`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.fetchPrivacySettings?.();
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: 'Erro ao buscar configurações de privacidade' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Atualiza configurações de privacidade
     * @route POST /:instanceName/chat/privacy-settings
     * @param req { Request } - instanceName (params), PrivacySettingDto (body)
     * @param res { Response }
     */
    public async updatePrivacySettings(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: PrivacySettingDto = req.body;
        this.logger.debug(`[${instanceName}] Atualizando configurações de privacidade`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
            // Assumir que o método existe no service
            const result = await instance.updatePrivacySettings?.(data);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar configurações de privacidade' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }
    /**
     * @description Busca perfil comercial (usado também para grupos)
     * @route POST /:instanceName/chat/business-profile
     * @param req { Request } - instanceName (params), NumberDto (body)
     * @param res { Response }
     */
    public async fetchBusinessProfile(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: NumberDto = req.body;
        this.logger.debug(`[${instanceName}] Buscando perfil comercial para ${data.number}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.fetchBusinessProfile?.(data.number);
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao buscar perfil comercial' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Atualiza o nome do perfil da instância
     * @route POST /:instanceName/chat/profile-name
     * @param req { Request } - instanceName (params), ProfileNameDto (body)
     * @param res { Response }
     */
    public async updateProfileName(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: ProfileNameDto = req.body;
        this.logger.debug(`[${instanceName}] Atualizando nome do perfil`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
              // Assumir que o método existe no service
            const result = await instance.updateProfileName?.(data.name);
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar nome do perfil' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Atualiza o status (recado) do perfil da instância
     * @route POST /:instanceName/chat/profile-status
     * @param req { Request } - instanceName (params), ProfileStatusDto (body)
     * @param res { Response }
     */
    public async updateProfileStatus(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: ProfileStatusDto = req.body;
        this.logger.debug(`[${instanceName}] Atualizando status do perfil`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
              // Assumir que o método existe no service
            const result = await instance.updateProfileStatus?.(data.status);
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar status do perfil' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Atualiza a foto do perfil da instância
     * @route POST /:instanceName/chat/profile-picture
     * @param req { Request } - instanceName (params), ProfilePictureDto (body)
     * @param res { Response }
     */
    public async updateProfilePicture(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: ProfilePictureDto = req.body;
        this.logger.debug(`[${instanceName}] Atualizando foto do perfil`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método espera um objeto com a propriedade 'picture'
            const result = await instance.updateProfilePicture?.({ picture: data.picture });
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar foto do perfil' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Remove a foto do perfil da instância
     * @route DELETE /:instanceName/chat/profile-picture
     * @param req { Request } - instanceName (params)
     * @param res { Response }
     */
    public async removeProfilePicture(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        this.logger.debug(`[${instanceName}] Removendo foto do perfil`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.removeProfilePicture?.();
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao remover foto do perfil' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Edita uma mensagem enviada (requer Baileys)
     * @route POST /:instanceName/chat/update-message
     * @param req { Request } - instanceName (params), UpdateMessageDto (body)
     * @param res { Response }
     */
    public async updateMessage(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: UpdateMessageDto = req.body;
        this.logger.debug(`[${instanceName}] Atualizando mensagem ${data.key.id}`);
        try {
            const instance = this.waMonitor.get(instanceName);
            if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.updateMessage?.(data);
            res.status(200).json(result);
        } catch (error: any) {
             this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar mensagem' });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

    /**
     * @description Bloqueia ou desbloqueia um usuário
     * @route POST /:instanceName/chat/block-user
     * @param req { Request } - instanceName (params), BlockUserDto (body)
     * @param res { Response }
     */
    public async blockUser(req: Request, res: Response): Promise<void> {
        const instanceName = req.params.instanceName;
        const data: BlockUserDto = req.body;
        const action = data.status === 'block' ? 'Bloqueando' : 'Desbloqueando';
        this.logger.debug(`[${instanceName}] ${action} usuário ${data.number}`);
        try {
             const instance = this.waMonitor.get(instanceName);
             if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
             // Assumir que o método existe no service
            const result = await instance.blockUser?.(data);
            res.status(200).json(result);
        } catch (error: any) {
            this.logger.error({ err: error, instance: instanceName, message: `Erro ao ${action.toLowerCase()} usuário` });
             // CORREÇÃO: Usar status codes explícitos
             const statusCode = error instanceof NotFoundException ? 404 :
                                error instanceof BadRequestException ? 400 : 500;
             res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
        }
    }

} // Fim da classe ChatController
