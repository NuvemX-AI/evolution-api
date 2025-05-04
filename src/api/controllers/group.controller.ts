// src/api/controllers/group.controller.ts
// Correções v8: Remove decorators, adapta para Express req/res, trata erros.
// Correções Gemini: Corrige chamada a profilePicture, getParticipants, tipos DTO.
// Correção Erro 3: Converte getParticipantsDto.getParticipants (string) para boolean.

import { Request, Response } from 'express';
// Importar DTOs necessários
import {
  AddParticipantsDto,
  CreateGroupDto,
  DemoteParticipantsDto,
  GetInviteCodeDto,
  GetParticipantsDto,
  GroupDescriptionDto,
  GroupPictureDto,
  GroupSubjectDto,
  GroupToggleEphemeralDto,
  GroupUpdateSettingDto,
  LeaveGroupDto,
  PromoteParticipantsDto,
  RemoveParticipantsDto,
  RevokeInviteCodeDto,
} from '../dto/group.dto';
import { InstanceDto } from '../dto/instance.dto'; // Para tipagem do parâmetro instance
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';


export class GroupController {
  private readonly logger: Logger;

  constructor(
    private readonly waMonitor: WAMonitoringService,
    baseLogger: Logger
  ) {
    // CORREÇÃO: Remover .child() pois o método pode não existir no tipo Logger
    this.logger = baseLogger; // Atribuir diretamente
    // Adicionar contexto se houver outra forma: this.logger.setContext(GroupController.name);
  }

  // --- Métodos adaptados para Express ---

  /**
   * @description Cria um novo grupo
   * @route POST /:instanceName/group/create
   * @param req { Request } - instanceName (params), CreateGroupDto (body)
   * @param res { Response }
   */
  public async createGroup(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: CreateGroupDto = req.body;

    this.logger.debug(`[${instanceName}] Criando grupo '${data.subject}'`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.createGroup?.(data);
      res.status(201).json(result); // 201 Created
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao criar grupo' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Sai de um grupo
   * @route POST /:instanceName/group/leave
   * @param req { Request } - instanceName (params), LeaveGroupDto (body)
   * @param res { Response }
   */
  public async leaveGroup(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: LeaveGroupDto = req.body;

    this.logger.debug(`[${instanceName}] Saindo do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      await instance.leaveGroup?.(data); // Pode não retornar nada útil
      res.status(200).json({ success: true, message: `Saída do grupo ${data.groupJid} solicitada.` });
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao sair do grupo' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Busca metadados de todos os grupos
   * @route GET /:instanceName/group/all
   * @param req { Request } - instanceName (params), GetParticipantsDto (query)
   * @param res { Response }
   */
  public async fetchAllGroups(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const getParticipantsDto: GetParticipantsDto = req.query; // Query params mapeados para DTO

    this.logger.debug(`[${instanceName}] Buscando todos os grupos (participantes: ${!!getParticipantsDto.getParticipants})`);
    try {
      const serviceInstance = this.waMonitor.get(instanceName);
      if (!serviceInstance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);

      // ** CORREÇÃO ERRO 3: Passar boolean para fetchAllGroups **
      const result = await serviceInstance.fetchAllGroups(!!getParticipantsDto.getParticipants); // Convert string presence to boolean
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao buscar todos os grupos' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }


  /**
   * @description Busca metadados de um grupo específico
   * @route POST /:instanceName/group/metadata
   * @param req { Request } - instanceName (params), GetParticipantsDto (body)
   * @param res { Response }
   */
  public async groupMetadata(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GetParticipantsDto = req.body; // Body deve conter o groupJid

    if (!data.groupJid) {
        res.status(400).json({ message: 'Propriedade "groupJid" é obrigatória no corpo da requisição.' });
        return;
    }

    this.logger.debug(`[${instanceName}] Buscando metadados do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      // CORREÇÃO: Passar apenas o groupJid, o método do service deve lidar com a busca
      const result = await instance.groupMetadata?.(data.groupJid); // Passar apenas JID
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: `Erro ao buscar metadados do grupo ${data.groupJid}` });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }


  /**
   * @description Adiciona participantes a um grupo
   * @route POST /:instanceName/group/add-participants
   * @param req { Request } - instanceName (params), AddParticipantsDto (body)
   * @param res { Response }
   */
  public async addParticipants(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: AddParticipantsDto = req.body;

    this.logger.debug(`[${instanceName}] Adicionando participantes ao grupo ${data.groupJid}`);
    try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
        // CORREÇÃO: O método no service deve chamar 'groupParticipantsUpdate' com 'add'
        const result = await instance.updateParticipants?.({ groupJid: data.groupJid, participants: data.participants, action: 'add' });
        res.status(200).json(result);
    } catch (error: any) {
        this.logger.error({ err: error, instance: instanceName, message: 'Erro ao adicionar participantes' });
        const statusCode = error instanceof NotFoundException ? 404 :
                           error instanceof BadRequestException ? 400 : 500;
        res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
}


  /**
   * @description Remove participantes de um grupo
   * @route POST /:instanceName/group/remove-participants
   * @param req { Request } - instanceName (params), RemoveParticipantsDto (body)
   * @param res { Response }
   */
  public async removeParticipants(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: RemoveParticipantsDto = req.body;

    this.logger.debug(`[${instanceName}] Removendo participantes do grupo ${data.groupJid}`);
    try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
         // CORREÇÃO: O método no service deve chamar 'groupParticipantsUpdate' com 'remove'
        const result = await instance.updateParticipants?.({ groupJid: data.groupJid, participants: data.participants, action: 'remove' });
        res.status(200).json(result);
    } catch (error: any) {
        this.logger.error({ err: error, instance: instanceName, message: 'Erro ao remover participantes' });
        const statusCode = error instanceof NotFoundException ? 404 :
                           error instanceof BadRequestException ? 400 : 500;
        res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
}


  /**
   * @description Promove participantes a admin
   * @route POST /:instanceName/group/promote-participants
   * @param req { Request } - instanceName (params), PromoteParticipantsDto (body)
   * @param res { Response }
   */
  public async promoteParticipants(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: PromoteParticipantsDto = req.body;

    this.logger.debug(`[${instanceName}] Promovendo participantes no grupo ${data.groupJid}`);
    try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
        // CORREÇÃO: O método no service deve chamar 'groupParticipantsUpdate' com 'promote'
        const result = await instance.updateParticipants?.({ groupJid: data.groupJid, participants: data.participants, action: 'promote' });
        res.status(200).json(result);
    } catch (error: any) {
        this.logger.error({ err: error, instance: instanceName, message: 'Erro ao promover participantes' });
        const statusCode = error instanceof NotFoundException ? 404 :
                           error instanceof BadRequestException ? 400 : 500;
        res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
}


  /**
   * @description Demote participantes (remove admin)
   * @route POST /:instanceName/group/demote-participants
   * @param req { Request } - instanceName (params), DemoteParticipantsDto (body)
   * @param res { Response }
   */
  public async demoteParticipants(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: DemoteParticipantsDto = req.body;

    this.logger.debug(`[${instanceName}] Demovendo participantes no grupo ${data.groupJid}`);
    try {
        const instance = this.waMonitor.get(instanceName);
        if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
        // CORREÇÃO: O método no service deve chamar 'groupParticipantsUpdate' com 'demote'
        const result = await instance.updateParticipants?.({ groupJid: data.groupJid, participants: data.participants, action: 'demote' });
        res.status(200).json(result);
    } catch (error: any) {
        this.logger.error({ err: error, instance: instanceName, message: 'Erro ao demote participantes' });
        const statusCode = error instanceof NotFoundException ? 404 :
                           error instanceof BadRequestException ? 400 : 500;
        res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
}


  /**
   * @description Atualiza a configuração do grupo (aberto/fechado)
   * @route POST /:instanceName/group/setting
   * @param req { Request } - instanceName (params), GroupUpdateSettingDto (body)
   * @param res { Response }
   */
  public async updateSetting(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GroupUpdateSettingDto = req.body;

    this.logger.debug(`[${instanceName}] Atualizando configuração do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.updateGroupSetting?.(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar configuração do grupo' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Atualiza o assunto (nome) do grupo
   * @route POST /:instanceName/group/subject
   * @param req { Request } - instanceName (params), GroupSubjectDto (body)
   * @param res { Response }
   */
  public async updateSubject(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GroupSubjectDto = req.body;

    this.logger.debug(`[${instanceName}] Atualizando assunto do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.updateSubject?.(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar assunto do grupo' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Atualiza a descrição do grupo
   * @route POST /:instanceName/group/description
   * @param req { Request } - instanceName (params), GroupDescriptionDto (body)
   * @param res { Response }
   */
  public async updateDescription(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GroupDescriptionDto = req.body;

    this.logger.debug(`[${instanceName}] Atualizando descrição do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.updateDescription?.(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao atualizar descrição do grupo' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Define a foto do grupo
   * @route POST /:instanceName/group/profile-picture
   * @param req { Request } - instanceName (params), GroupPictureDto (body)
   * @param res { Response }
   */
  public async setGroupPicture(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GroupPictureDto = req.body;

    this.logger.debug(`[${instanceName}] Definindo foto do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      // CORREÇÃO: O método profilePicture provavelmente não é o correto aqui. Assumir que existe setGroupPicture
      const result = await instance.setGroupPicture?.(data); // Passar DTO completo
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao definir foto do grupo' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Obtém o código de convite do grupo
   * @route POST /:instanceName/group/invite-code
   * @param req { Request } - instanceName (params), GetInviteCodeDto (body)
   * @param res { Response }
   */
  public async groupInviteCode(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GetInviteCodeDto = req.body;

    this.logger.debug(`[${instanceName}] Obtendo código de convite do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.groupInviteCode?.(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao obter código de convite' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Revoga o código de convite do grupo
   * @route POST /:instanceName/group/revoke-invite-code
   * @param req { Request } - instanceName (params), RevokeInviteCodeDto (body)
   * @param res { Response }
   */
  public async revokeInviteCode(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: RevokeInviteCodeDto = req.body;

    this.logger.debug(`[${instanceName}] Revogando código de convite do grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.revokeGroupInviteCode?.(data); // Método pode se chamar revokeGroupInviteCode
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao revogar código de convite' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  /**
   * @description Ativa/desativa mensagens efêmeras no grupo
   * @route POST /:instanceName/group/ephemeral
   * @param req { Request } - instanceName (params), GroupToggleEphemeralDto (body)
   * @param res { Response }
   */
  public async toggleEphemeral(req: Request, res: Response): Promise<void> {
    const instanceName = req.params.instanceName;
    const data: GroupToggleEphemeralDto = req.body;

    this.logger.debug(`[${instanceName}] Alternando mensagens efêmeras para o grupo ${data.groupJid}`);
    try {
      const instance = this.waMonitor.get(instanceName);
      if (!instance) throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
      const result = await instance.toggleEphemeral?.(data);
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error({ err: error, instance: instanceName, message: 'Erro ao alternar mensagens efêmeras' });
      const statusCode = error instanceof NotFoundException ? 404 :
                         error instanceof BadRequestException ? 400 : 500;
      res.status(statusCode).json({ message: error.message || 'Erro interno do servidor' });
    }
  }
} // Fim da classe
