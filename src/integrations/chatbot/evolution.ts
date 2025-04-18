import { Logger } from '@config/logger.config';

export class EvolutionBotService {
  private logger = new Logger('EvolutionBotService');

  constructor() {
    this.logger.info('EvolutionBotService iniciado');
  }

  public exemplo(): void {
    this.logger.info('Exemplo EvolutionBot funcionando!');
  }
}

export class EvolutionBotController {
  private logger = new Logger('EvolutionBotController');

  constructor(private evolutionBotService: EvolutionBotService) {
    this.logger.info('EvolutionBotController iniciado');
  }

  public executar(): void {
    this.evolutionBotService.exemplo();
  }
}
