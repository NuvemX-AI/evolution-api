import { RouterBroker } from '../../../abstract/abstract.router';
import { ConfigService } from '@config/env.config';
import { Router } from 'express';

export class EvolutionRouter extends RouterBroker {
  public routerPath(path: string, unused?: boolean): string {
    // Implemente aqui se tiver lógica específica
    return path;
  }

  public readonly router: Router = Router();

  constructor(readonly configService: ConfigService) {
    super();

    this.router.post(this.routerPath('webhook/evolution', false), async (req, res) => {
      const { body } = req;

      // 🔁 Simulação temporária
      const response = {
        success: true,
        message: 'Webhook Evolution recebido com sucesso (mock)',
        data: body,
      };

      return res.status(200).json(response);
    });
  }
}
