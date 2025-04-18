import { Logger } from '@config/logger.config';

export class S3Controller {
  private logger = new Logger('S3Controller');

  constructor(service: any) {
    this.logger.info('S3Controller iniciado');
  }
}
