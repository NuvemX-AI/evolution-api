import { Router } from 'express';
// CORREÇÃO: Importar ConfigService do local correto (ex: @config)
import { ConfigService } from '@config/config.service'; // Ou path relativo

import { EvolutionRouter } from './evolution/evolution.router';
import { MetaRouter } from './meta/meta.router';
import { BaileysRouter } from './whatsapp/baileys.router';

export class ChannelRouter {
  public readonly router: Router;

  // O construtor deve receber ConfigService e os guards
  constructor(configService: ConfigService, ...guards: any[]) {
    this.router = Router();

    // Assumindo que EvolutionRouter e MetaRouter também expõem .router
    // Se eles herdarem de RouterBroker, isso deve funcionar
    this.router.use('/', new EvolutionRouter(configService).router); // Passa configService se necessário
    this.router.use('/', new MetaRouter(configService).router);     // Passa configService se necessário

    // A linha abaixo deve funcionar se BaileysRouter expõe .router publicamente
    this.router.use('/baileys', new BaileysRouter(...guards).router);
  }
}

// Remover chave extra no final, se houver
