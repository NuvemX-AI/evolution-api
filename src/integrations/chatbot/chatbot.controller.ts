import { Logger } from '@config/logger.config';

export class ChatbotController {
  private logger = new Logger('ChatbotController');

  constructor() {
    this.logger.info('ChatbotController iniciado');
  }

  public exemploMetodo(): void {
    this.logger.info('Executando método de exemplo do ChatbotController');
  }
}
