import { Logger } from '@config/logger.config';

export class ChatwootService {
  private readonly logger = new Logger('ChatwootService');

  constructor() {
    this.logger.info('ChatwootService iniciado');
  }

  // Exemplo de método
  public async enviarMensagem(msg: string): Promise<void> {
    this.logger.info(`Enviando mensagem: ${msg}`);
    // Aqui você poderá integrar com a API do Chatwoot no futuro
  }
}
