import { InstanceDto } from '@api/dto/instance.dto';
// Usar o serviço correto (monitor.service ou wa-monitoring.service)
import { WAMonitoringService } from '@api/services/monitor.service'; // Assumindo monitor.service
import { BaileysStartupService } from './whatsapp.baileys.service'; // Importar para type hint
import { NotFoundException } from '@exceptions/index'; // Importar exceção

export class BaileysController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  // Helper para obter a instância Baileys ou lançar erro
  private getBaileysInstanceOrThrow(instanceName: string): BaileysStartupService {
    const instance = this.waMonitor.get(instanceName);
    if (!instance) {
      throw new NotFoundException(`Instância "${instanceName}" não encontrada.`);
    }
    if (!(instance instanceof BaileysStartupService)) {
      throw new NotFoundException(`Instância "${instanceName}" não é do tipo Baileys.`);
    }
    return instance;
  }

  public async onWhatsapp({ instanceName }: InstanceDto, body: any) {
    // CORREÇÃO: Usar helper e chamar método correto
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    // Assumindo que onWhatsapp espera apenas o JID ou um objeto com JID
    // O corpo do BaileysStartupService.onWhatsapp espera string[], ajustar chamada ou corpo do método.
    // Por enquanto, passando body.jids assumindo que é um array.
    if (!Array.isArray(body?.jids)) {
        throw new BadRequestException("A propriedade 'jids' deve ser um array de strings.");
    }
    return instance.onWhatsapp(body?.jids);
  }

  public async profilePictureUrl({ instanceName }: InstanceDto, body: any) {
    // CORREÇÃO: Usar helper e chamar método correto (profilePicture)
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    // O método profilePicture espera (jid: string, type?: 'preview', timeoutMs?: number)
    return instance.profilePicture(body?.jid, body?.type, body?.timeoutMs);
  }

  public async assertSessions({ instanceName }: InstanceDto, body: any) {
     // CORREÇÃO: Usar helper e chamar método correto
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    return instance.assertSessions(body?.jids, body?.force);
  }

  public async createParticipantNodes({ instanceName }: InstanceDto, body: any) {
    // CORREÇÃO: Usar helper e chamar método correto (não encontrado)
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    // Método baileysCreateParticipantNodes/createParticipantNodes não encontrado. Comentando.
    // return instance.createParticipantNodes(body?.jids, body?.message, body?.extraAttrs);
    throw new Error("Método createParticipantNodes não implementado.");
  }

  public async getUSyncDevices({ instanceName }: InstanceDto, body: any) {
     // CORREÇÃO: Usar helper e chamar método correto
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    return instance.getUSyncDevices(body?.jids, body?.useCache, body?.ignoreZeroDevices);
  }

  public async generateMessageTag({ instanceName }: InstanceDto) {
     // CORREÇÃO: Usar helper e chamar método correto
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    return instance.generateMessageTag();
  }

  public async sendNode({ instanceName }: InstanceDto, body: any) {
     // CORREÇÃO: Usar helper e chamar método correto
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    return instance.sendNode(body?.stanza);
  }

  public async signalRepositoryDecryptMessage({ instanceName }: InstanceDto, body: any) {
    // CORREÇÃO: Usar helper e chamar método correto (não encontrado)
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    // Método baileysSignalRepositoryDecryptMessage/signalRepositoryDecryptMessage não encontrado. Comentando.
    // return instance.signalRepositoryDecryptMessage(body?.jid, body?.type, body?.ciphertext);
    throw new Error("Método signalRepositoryDecryptMessage não implementado.");
  }

  public async getAuthState({ instanceName }: InstanceDto) {
     // CORREÇÃO: Usar helper e chamar método correto
    const instance = this.getBaileysInstanceOrThrow(instanceName);
    return instance.getAuthState();
  }
}

// Remover chave extra no final, se houver
