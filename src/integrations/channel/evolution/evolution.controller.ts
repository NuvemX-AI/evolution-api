import { Logger } from '@config/logger.config';

export class EvolutionController {
  private logger = new Logger('EvolutionController');

  constructor() {
    this.logger.info('EvolutionController iniciado');
  }

  public exemploMetodo(): void {
    this.logger.info('Método de exemplo do EvolutionController executado');
  }
}
