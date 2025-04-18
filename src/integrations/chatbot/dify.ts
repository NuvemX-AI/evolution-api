import { Logger } from '@config/logger.config';

export class DifyService {
  private logger = new Logger('DifyService');

  constructor() {
    this.logger.info('DifyService iniciado');
  }

  public exemplo(): void {
    this.logger.info('Exemplo Dify funcionando!');
  }
}

export class DifyController {
  private logger = new Logger('DifyController');

  constructor(private difyService: DifyService) {
    this.logger.info('DifyController iniciado');
  }

  public executar(): void {
    this.difyService.exemplo();
  }
}
