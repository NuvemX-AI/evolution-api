import { Logger } from '@config/logger.config';

export class BaileysController {
  private logger = new Logger('BaileysController');

  constructor() {
    this.logger.info('BaileysController iniciado');
  }

  public exemploMetodo(): void {
    this.logger.info('Método de exemplo do BaileysController executado');
  }
}
