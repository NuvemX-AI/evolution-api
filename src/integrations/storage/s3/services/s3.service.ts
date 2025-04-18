import { Logger } from '@config/logger.config';

export class S3Service {
  private logger = new Logger('S3Service');

  constructor(repository: any) {
    this.logger.info('S3Service iniciado');
  }
}
