import { Logger } from '@config/logger.config';

export class FlowiseService {
  private logger = new Logger('FlowiseService');

  constructor() {
    this.logger.info('FlowiseService iniciado');
  }

  public exemplo(): void {
    this.logger.info('Exemplo Flowise funcionando!');
  }
}

export class FlowiseController {
  private logger = new Logger('FlowiseController');

  constructor(private flowiseService: FlowiseService) {
    this.logger.info('FlowiseController iniciado');
  }

  public executar(): void {
    this.flowiseService.exemplo();
  }
}
