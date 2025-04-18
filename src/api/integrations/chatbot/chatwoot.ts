export class ChatwootService {
  constructor() {
    console.log('[MOCK] ChatwootService iniciado');
  }

  async sendMessage(instanceName: string, message: string) {
    console.log(`[MOCK] Chatwoot -> ${instanceName}: ${message}`);
    return Promise.resolve();
  }

  async notifyNewInstance(instanceName: string) {
    console.log(`[MOCK] Notificando Chatwoot nova instância: ${instanceName}`);
    return Promise.resolve();
  }
}
