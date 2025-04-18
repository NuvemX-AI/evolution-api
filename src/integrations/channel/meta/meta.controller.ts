import { Logger } from '@config/logger.config';

export class MetaController {
  private logger = new Logger('MetaController');

  constructor() {
    this.logger.info('MetaController iniciado');
  }

  public exemploMetodo(): void {
    this.logger.info('Método de exemplo do MetaController executado');
  }
}
