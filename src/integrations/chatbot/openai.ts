import { Logger } from '@config/logger.config';

export class OpenaiService {
  private logger = new Logger('OpenaiService');

  constructor() {
    this.logger.info('OpenaiService iniciado');
  }

  public exemplo(): void {
    this.logger.info('Exemplo OpenAI funcionando!');
  }
}

export class OpenaiController {
  private logger = new Logger('OpenaiController');

  constructor(private openaiService: OpenaiService) {
    this.logger.info('OpenaiController iniciado');
  }

  public executar(): void {
    this.openaiService.exemplo();
  }
}
