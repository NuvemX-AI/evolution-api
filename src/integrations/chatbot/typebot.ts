import { Logger } from '@config/logger.config';

export class TypebotService {
  private logger = new Logger('TypebotService');

  constructor() {
    this.logger.info('TypebotService iniciado');
  }

  public exemplo(): void {
    this.logger.info('Exemplo Typebot funcionando!');
  }
}

export class TypebotController {
  private logger = new Logger('TypebotController');

  constructor(private typebotService: TypebotService) {
    this.logger.info('TypebotController iniciado');
  }

  public executar(): void {
    this.typebotService.exemplo();
  }
}
