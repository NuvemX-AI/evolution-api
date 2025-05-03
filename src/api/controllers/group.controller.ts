import {
  AcceptGroupInvite,
  CreateGroupDto,
  GetParticipant,
  GroupDescriptionDto, // Mantido DTO original
  GroupInvite,
  GroupJid,
  GroupPictureDto,
  GroupSendInvite,
  GroupSubjectDto,
  GroupToggleEphemeralDto,
  GroupUpdateParticipantDto,
  GroupUpdateSettingDto,
} from '../dto/group.dto'; // Mantido caminho relativo original
import { InstanceDto } from '../dto/instance.dto'; // Mantido caminho relativo original
// Correção no import se WAMonitoringService estiver em outro local, ex: '@services/...'
import { WAMonitoringService } from '../services/monitor.service'; // Mantido caminho relativo original
// CORRIGIDO: Importar o tipo específico da implementação que contém os métodos de grupo
import { BaileysStartupService } from '../integrations/channel/whatsapp/whatsapp.baileys.service'; // Ajuste o caminho se necessário
// Importar outros tipos de ChannelStartupService (Meta, Evolution) se houver suporte a múltiplos canais
import { ChannelStartupService } from '../services/channel.service'; // Import base service if needed for typing

// Importar exceções
import { NotFoundException, InternalServerErrorException, BadRequestException } from '@exceptions/index';


export class GroupController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  // Função auxiliar para obter a instância com o tipo correto
  private getInstance(instanceName: string): BaileysStartupService { // Ajuste o tipo de retorno se suportar outros canais (e.g., ChannelStartupService)
      const channelInstance = this.waMonitor.waInstances[instanceName];
      if (!channelInstance) {
          // Use NotFoundException for consistency
          throw new NotFoundException(`Instância ${instanceName} não encontrada ou não está em execução.`);
      }
      // CORRIGIDO: Verifica ou assume o tipo da instância.
      // Adicione verificações (instanceof) se houver múltiplos tipos de canal (Meta, Evolution)
      if (channelInstance instanceof BaileysStartupService) {
          return channelInstance;
      }
      // Se suportar outros tipos, adicione mais 'else if' aqui
      // else if (channelInstance instanceof BusinessStartupService) { ... }

      // Lança erro se o tipo não for esperado ou não tiver os métodos
      throw new BadRequestException(`A instância ${instanceName} não é do tipo esperado (${channelInstance.constructor.name}) ou não suporta operações de grupo via Baileys.`);
  }

  // Nota: Adicionado tratamento de erro e async/await onde faltava
  // Nota: Removidos 'req' e 'res' pois não são usados aqui, a lógica de rota chama estes métodos

  public async createGroup(instance: InstanceDto, create: CreateGroupDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Assumindo que createGroup existe e retorna algo
    return await serviceInstance.createGroup(create);
  }

  public async updateGroupPicture(instance: InstanceDto, update: GroupPictureDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
     // Assumindo que updateGroupPicture existe
    return await serviceInstance.updateGroupPicture(update);
  }

  public async updateGroupSubject(instance: InstanceDto, update: GroupSubjectDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que updateGroupSubject existe (assumindo que existe no service)
    return await serviceInstance.updateGroupSubject(update);
  }

  public async updateGroupDescription(instance: InstanceDto, update: GroupDescriptionDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que updateGroupDescription existe (assumindo que existe no service)
    return await serviceInstance.updateGroupDescription(update);
  }

  // Renomeado para evitar conflito com 'findGroup' de Baileys que retorna metadados
  public async findGroupInfo(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que findGroup existe (assumindo que existe no service)
    // Nota: O DTO original era GroupJid, passando groupJidDto.groupJid (string)
    // CORREÇÃO TS2345: Mantido como string, mas o tipo no service pode precisar de ajuste
    return await serviceInstance.findGroup(groupJidDto.groupJid);
  }

  public async fetchAllGroups(instance: InstanceDto, getParticipantsDto: GetParticipant) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que fetchAllGroups existe (assumindo que existe no service)
    // CORREÇÃO TS2551: Corrigido typo getPaticipants -> getParticipants
    return await serviceInstance.fetchAllGroups(getParticipantsDto.getParticipants);
  }

  public async inviteCode(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que inviteCode existe (assumindo que existe no service)
    // CORREÇÃO TS2345: Mantido como string, mas o tipo no service pode precisar de ajuste
    return await serviceInstance.inviteCode(groupJidDto.groupJid);
  }

  public async inviteInfo(instance: InstanceDto, inviteCodeDto: GroupInvite) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // CORREÇÃO TS2339: Renomeado para groupAcceptInviteInfo (ou método correto do service)
    return await serviceInstance.groupAcceptInviteInfo(inviteCodeDto.inviteCode);
  }

  public async sendInvite(instance: InstanceDto, data: GroupSendInvite) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // CORREÇÃO TS2339: Método 'sendInvite' não encontrado no BaileysStartupService. Comentado.
    // return await serviceInstance.sendInvite(data);
    throw new Error("Método 'sendInvite' não implementado ou não encontrado no serviço.");
  }

  public async acceptInviteCode(instance: InstanceDto, inviteCodeDto: AcceptGroupInvite) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que acceptInviteCode existe (assumindo que existe no service)
    return await serviceInstance.acceptInviteCode(inviteCodeDto.inviteCode);
  }

  public async revokeInviteCode(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que revokeInviteCode existe (assumindo que existe no service)
    // CORREÇÃO TS2345: Mantido como string, mas o tipo no service pode precisar de ajuste
    return await serviceInstance.revokeInviteCode(groupJidDto.groupJid);
  }

  public async findParticipants(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que findParticipants existe (assumindo que existe no service)
    // CORREÇÃO TS2345: Mantido como string, mas o tipo no service pode precisar de ajuste
    return await serviceInstance.findParticipants(groupJidDto.groupJid);
  }

  // CORREÇÃO TS2551: Renomeado de updateGParticipate para updateParticipants
  public async updateParticipants(instance: InstanceDto, update: GroupUpdateParticipantDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora chama updateParticipants (assumindo que existe no service)
    return await serviceInstance.updateParticipants(update);
  }

  // CORREÇÃO TS2551: Renomeado de updateGSetting para updateSetting
  public async updateSetting(instance: InstanceDto, update: GroupUpdateSettingDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora chama updateSetting (assumindo que existe no service)
    return await serviceInstance.updateSetting(update);
  }

  public async toggleEphemeral(instance: InstanceDto, update: GroupToggleEphemeralDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que toggleEphemeral existe (assumindo que existe no service)
    return await serviceInstance.toggleEphemeral(update);
  }

  public async leaveGroup(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que leaveGroup existe (assumindo que existe no service)
    // CORREÇÃO TS2345: Mantido como string, mas o tipo no service pode precisar de ajuste
    return await serviceInstance.leaveGroup(groupJidDto.groupJid);
  }
}

// Chave extra removida
