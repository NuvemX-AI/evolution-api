import { Logger } from '@config/logger.config';

export class ChannelController {
  private logger = new Logger('ChannelController');

  constructor() {
    this.logger.info('ChannelController iniciado');
  }

  public exemploMetodo(): void {
    this.logger.info('Método de exemplo executado');
  }
}
