// src/api/controllers/chat.controller.ts

import { Request, Response } from 'express'; // Importar tipos do Express
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
// Mantém import da interface Query para tipagem, mas o decorator @Query foi removido
import { Query } from '@repository/repository.service';
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { Contact, Message, MessageUpdate } from '@prisma/client'; // Manteve tipos Prisma
import { Logger } from '@config/logger.config';
// Importar exceções para tratamento de erro
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';

export class ChatController {
  private readonly logger: Logger;

  constructor(
    private readonly waMonitor: WAMonitoringService,
    baseLogger: Logger
  ) {
    // Mantido: Assume que baseLogger.child é válido na sua implementação de Logger
    // Se TS2339 persistir, verifique a definição de Logger ou passe o contexto nos logs.
    this.logger = baseLogger.child({ context: ChatController.name });
  }

  // --- Métodos adaptados para Express ---

  public async whatsappNumber(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName; // Extrai dos parâmetros da rota
    const data: WhatsAppNumberDto = req.body;

    this.logger.debug(`[${instanceName}] Checking WhatsApp numbers`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.whatsappNumber(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error checking whatsapp number');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async readMessage(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: ReadMessageDto = req.body;

    this.logger.debug(`[${instanceName}] Marking messages as read`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.markMessageAsRead(data);
      res.status(200).json(result || { message: 'Read messages', read: 'success' }); // Retorna sucesso se undefined
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error marking messages as read');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async archiveChat(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: ArchiveChatDto = req.body;

    this.logger.debug(`[${instanceName}] Archiving/unarchiving chat`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.archiveChat(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error archiving chat');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async markChatUnread(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: MarkChatUnreadDto = req.body;

    this.logger.debug(`[${instanceName}] Marking chat unread`);
     try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.markChatUnread(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error marking chat unread');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async deleteMessage(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: DeleteMessage = req.body;

    this.logger.debug(`[${instanceName}] Deleting message ${data.id}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      // O método deleteMessage original retorna a mensagem enviada pelo Baileys, pode ser complexa.
      // Simplificando para retornar sucesso ou erro. Ajuste se precisar do retorno completo.
      await instance.deleteMessage(data);
      res.status(200).json({ deleted: true, messageId: data.id });
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error deleting message');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async fetchProfilePicture(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: NumberDto = req.body;

    this.logger.debug(`[${instanceName}] Fetching profile picture for ${data.number}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.profilePicture(data.number);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error fetching profile picture');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async fetchProfile(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: NumberDto = req.body;

    this.logger.debug(`[${instanceName}] Fetching profile for ${data.number}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      // Ajuste: Passa instanceName explicitamente se o método fetchProfile precisar dele
      const result = await instance.fetchProfile?.(instanceName, data.number);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error fetching profile');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  // Método que usava @Query - precisa parsear req.query
  public async fetchContacts(req: Request, res: Response): Promise<void> {
      const instanceName = req.params.instanceName;
      // req.query contém { [key: string]: string | string[] | ... }
      // Precisamos converter isso para a estrutura Query<Contact>
      // Exemplo SIMPLES (você precisará adaptar à estrutura real de Query<T>)
      const queryParams = req.query;
      const page = parseInt(queryParams.page as string || '1');
      const limit = parseInt(queryParams.limit as string || '10');
      const filters = { ...queryParams }; // Copia todos os query params
      delete filters.page; // Remove paginação dos filtros
      delete filters.limit;

      // Cria a estrutura Query - **AJUSTE CONFORME A DEFINIÇÃO REAL DE Query<T>**
      const query: Query<Contact> = {
          filters: filters, // Pode precisar de mais tratamento/tipagem aqui
          pagination: { page, limit }
      };

      this.logger.debug(`[${instanceName}] Fetching contacts with query: ${JSON.stringify(query)}`);
      try {
          const instance = this.waMonitor.get(instanceName);
          if (!instance) {
              res.status(404).json({ message: `Instance ${instanceName} not found.` });
              return;
          }
          const result = await instance.fetchContacts(query);
          res.status(200).json(result);
      } catch (error: any) {
          this.logger.error({ err: error, instance: instanceName, query }, 'Error fetching contacts');
          res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
      }
  }

  public async getBase64FromMediaMessage(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: getBase64FromMediaMessageDto = req.body;

    this.logger.debug(`[${instanceName}] Getting Base64 from media message`);
    try {
      const instance = this.waMonitor.get(instanceName);
       if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.getBase64FromMediaMessage(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error getting base64 from media');
       // Tratar erro específico 'Message not found' ou 'Not media type' com 400/404
       if (error instanceof BadRequestException || error instanceof NotFoundException) {
           res.status(error.status).json({ message: error.message });
       } else {
           res.status(500).json({ message: error.message || 'Internal Server Error' });
       }
    }
  }

  // Método que usava @Query - precisa parsear req.query
  public async fetchMessages(req: Request, res: Response): Promise<void> {
      const instanceName = req.params.instanceName;
      // Lógica de parsing similar a fetchContacts - **AJUSTE CONFORME Query<Message>**
      const queryParams = req.query;
      const page = parseInt(queryParams.page as string || '1');
      const limit = parseInt(queryParams.limit as string || '10');
      const filters = { ...queryParams };
      delete filters.page;
      delete filters.limit;
      const query: Query<Message> = { filters, pagination: { page, limit } };

      this.logger.debug(`[${instanceName}] Fetching messages with query: ${JSON.stringify(query)}`);
      try {
          const instance = this.waMonitor.get(instanceName);
          if (!instance) {
              res.status(404).json({ message: `Instance ${instanceName} not found.` });
              return;
          }
          const result = await instance.fetchMessages(query);
          res.status(200).json(result);
      } catch (error: any) {
          this.logger.error({ err: error, instance: instanceName, query }, 'Error fetching messages');
          res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
      }
  }

  // Método que usava @Query - precisa parsear req.query
  public async fetchStatusMessage(req: Request, res: Response): Promise<void> {
      const instanceName = req.params.instanceName;
       // Lógica de parsing similar a fetchContacts - **AJUSTE CONFORME Query<MessageUpdate>**
      const queryParams = req.query;
      const page = parseInt(queryParams.page as string || '1');
      const limit = parseInt(queryParams.limit as string || '10');
      const filters = { ...queryParams };
      delete filters.page;
      delete filters.limit;
      const query: Query<MessageUpdate> = { filters, pagination: { page, limit } };

      this.logger.debug(`[${instanceName}] Fetching message status with query: ${JSON.stringify(query)}`);
      try {
          const instance = this.waMonitor.get(instanceName);
          if (!instance) {
              res.status(404).json({ message: `Instance ${instanceName} not found.` });
              return;
          }
          const result = await instance.fetchStatusMessage(query);
          res.status(200).json(result);
      } catch (error: any) {
          this.logger.error({ err: error, instance: instanceName, query }, 'Error fetching message status');
          res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
      }
  }

   // Método que usava @Query - precisa parsear req.query
  public async fetchChats(req: Request, res: Response): Promise<void> {
      const instanceName = req.params.instanceName;
      // Lógica de parsing similar a fetchContacts - **AJUSTE CONFORME Query<any>** (para Chat)
      const queryParams = req.query;
      const page = parseInt(queryParams.page as string || '1');
      const limit = parseInt(queryParams.limit as string || '10');
      const filters = { ...queryParams };
      delete filters.page;
      delete filters.limit;
      const query: Query<any> = { filters, pagination: { page, limit } }; // Tipo 'any' mantido

      this.logger.debug(`[${instanceName}] Fetching chats with query: ${JSON.stringify(query)}`);
       try {
          const instance = this.waMonitor.get(instanceName);
          if (!instance) {
              res.status(404).json({ message: `Instance ${instanceName} not found.` });
              return;
          }
          const result = await instance.fetchChats(query);
          res.status(200).json(result);
      } catch (error: any) {
          this.logger.error({ err: error, instance: instanceName, query }, 'Error fetching chats');
          res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
      }
  }

  public async sendPresence(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: SendPresenceDto = req.body;

     this.logger.debug(`[${instanceName}] Sending presence ${data.presence} for ${data.number}`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.sendPresence(data);
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error sending presence');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async fetchPrivacySettings(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     this.logger.debug(`[${instanceName}] Fetching privacy settings`);
      try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.fetchPrivacySettings();
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error fetching privacy settings');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async updatePrivacySettings(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: PrivacySettingDto = req.body;
     this.logger.debug(`[${instanceName}] Updating privacy settings`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.updatePrivacySettings(data);
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error updating privacy settings');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async fetchBusinessProfile(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: NumberDto = req.body;
     this.logger.debug(`[${instanceName}] Fetching business profile for ${data.number}`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.fetchBusinessProfile(data.number);
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error fetching business profile');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async updateProfileName(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: ProfileNameDto = req.body;
     this.logger.debug(`[${instanceName}] Updating profile name`);
      try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.updateProfileName(data.name);
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error updating profile name');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async updateProfileStatus(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: ProfileStatusDto = req.body;
     this.logger.debug(`[${instanceName}] Updating profile status`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.updateProfileStatus(data.status);
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error updating profile status');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async updateProfilePicture(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: ProfilePictureDto = req.body;
     this.logger.debug(`[${instanceName}] Updating profile picture`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        // Assume que o método espera um objeto com a propriedade 'picture'
        const result = await instance.updateProfilePicture({ picture: data.picture });
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error updating profile picture');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async removeProfilePicture(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     this.logger.debug(`[${instanceName}] Removing profile picture`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.removeProfilePicture();
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, 'Error removing profile picture');
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }

  public async updateMessage(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: UpdateMessageDto = req.body;
    this.logger.debug(`[${instanceName}] Updating message ${data.key.id}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) {
        res.status(404).json({ message: `Instance ${instanceName} not found.` });
        return;
      }
      const result = await instance.updateMessage(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName }, 'Error updating message');
      res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
    }
  }

  public async blockUser(req: Request, res: Response): Promise<void> {
     const instanceName = req.params.instanceName;
     const data: BlockUserDto = req.body;
     const action = data.status === 'block' ? 'Blocking' : 'Unblocking';
     this.logger.debug(`[${instanceName}] ${action} user ${data.number}`);
     try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            res.status(404).json({ message: `Instance ${instanceName} not found.` });
            return;
        }
        const result = await instance.blockUser(data);
        res.status(200).json(result);
     } catch (error: any) {
         this.logger.error({ err: error, instance: instanceName }, `Error ${action.toLowerCase()} user`);
         res.status(error?.status || 500).json({ message: error.message || 'Internal Server Error' });
     }
  }
} // Fim da classe ChatController
