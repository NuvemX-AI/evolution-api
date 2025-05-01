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

export class GroupController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  // Função auxiliar para obter a instância com o tipo correto
  private getInstance(instanceName: string): BaileysStartupService { // Ajuste o tipo de retorno se suportar outros canais (e.g., ChannelStartupService)
      const channelInstance = this.waMonitor.waInstances[instanceName];
      if (!channelInstance) {
          throw new Error(`Instance ${instanceName} not found or not running.`);
      }
      // CORRIGIDO: Verifica ou assume o tipo da instância.
      // Adicione verificações (instanceof) se houver múltiplos tipos de canal (Meta, Evolution)
      if (channelInstance instanceof BaileysStartupService) {
          return channelInstance;
      }
      // Se suportar outros tipos, adicione mais 'else if' aqui
      // else if (channelInstance instanceof BusinessStartupService) { ... }

      // Lança erro se o tipo não for esperado ou não tiver os métodos
      throw new Error(`Instance ${instanceName} is not of the expected type or does not support group operations.`);
  }


  public async createGroup(instance: InstanceDto, create: CreateGroupDto) {
    // CORRIGIDO: Usa a função auxiliar para obter a instância tipada
    const serviceInstance = this.getInstance(instance.instanceName);
    return await serviceInstance.createGroup(create);
  }

  public async updateGroupPicture(instance: InstanceDto, update: GroupPictureDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    return await serviceInstance.updateGroupPicture(update);
  }

  public async updateGroupSubject(instance: InstanceDto, update: GroupSubjectDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que updateGroupSubject existe
    return await serviceInstance.updateGroupSubject(update);
  }

  public async updateGroupDescription(instance: InstanceDto, update: GroupDescriptionDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que updateGroupDescription existe
    return await serviceInstance.updateGroupDescription(update);
  }

  // Renomeado para evitar conflito com 'findGroup' de Baileys que retorna metadados
  public async findGroupInfo(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que findGroup existe
    // Nota: O DTO original era GroupJid, passando groupJidDto diretamente
    return await serviceInstance.findGroup(groupJidDto.groupJid); // Ajustado para passar a string JID
  }

  public async fetchAllGroups(instance: InstanceDto, getParticipantsDto: GetParticipant) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que fetchAllGroups existe
    return await serviceInstance.fetchAllGroups(getParticipantsDto.getPaticipants); // Ajustado para passar o boolean
  }

  public async inviteCode(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que inviteCode existe
    return await serviceInstance.inviteCode(groupJidDto.groupJid); // Ajustado para passar a string JID
  }

  public async inviteInfo(instance: InstanceDto, inviteCodeDto: GroupInvite) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que inviteInfo existe
    return await serviceInstance.inviteInfo(inviteCodeDto.inviteCode); // Ajustado para passar a string do código
  }

  public async sendInvite(instance: InstanceDto, data: GroupSendInvite) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que sendInvite existe
    return await serviceInstance.sendInvite(data);
  }

  public async acceptInviteCode(instance: InstanceDto, inviteCodeDto: AcceptGroupInvite) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que acceptInviteCode existe
    return await serviceInstance.acceptInviteCode(inviteCodeDto.inviteCode); // Ajustado para passar a string do código
  }

  public async revokeInviteCode(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que revokeInviteCode existe
    return await serviceInstance.revokeInviteCode(groupJidDto.groupJid); // Ajustado para passar a string JID
  }

  public async findParticipants(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que findParticipants existe
    return await serviceInstance.findParticipants(groupJidDto.groupJid); // Ajustado para passar a string JID
  }

  // Renomeado de updateGParticipate para corresponder ao método em Baileys
  public async updateParticipants(instance: InstanceDto, update: GroupUpdateParticipantDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que updateGParticipant existe
    return await serviceInstance.updateGParticipant(update);
  }

  public async updateSetting(instance: InstanceDto, update: GroupUpdateSettingDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que updateGSetting existe
    return await serviceInstance.updateGSetting(update);
  }

  public async toggleEphemeral(instance: InstanceDto, update: GroupToggleEphemeralDto) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que toggleEphemeral existe
    return await serviceInstance.toggleEphemeral(update);
  }

  public async leaveGroup(instance: InstanceDto, groupJidDto: GroupJid) {
    const serviceInstance = this.getInstance(instance.instanceName);
    // Agora TypeScript sabe que leaveGroup existe
    return await serviceInstance.leaveGroup(groupJidDto.groupJid); // Ajustado para passar a string JID
  }
}

// Havia um '}' extra no final do arquivo original, que foi removido.
