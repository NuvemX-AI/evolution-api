// src/api/integrations/channel/whatsapp/baileys.router.ts
// Correção Erro 74: Ajusta path do import HttpStatus.
// Correção Erro 75: Ajusta path do import baileysController para relativo.

import { Router } from 'express';
import { ConfigService } from '@config/config.service'; // Use alias or relative path
// ** Correção Erro 74: Corrigir path do import **
// import { HttpStatus } from '@api/routes/index.router'; // Original
import { HttpStatus } from '@api/constants/http-status'; // Corrigido
import { authGuard } from '../../../guards/auth.guard'; // Ajustar path
import { instanceGuard } from '../../../guards/instance.guard'; // Ajustar path
// ** Correção Erro 75: Usar path relativo **
// import { baileysController } from '@api/server.module'; // Original
import { baileysController } from '../../../server.module'; // Path relativo
import { RouterBroker } from '../../../abstract/abstract.router'; // Ajustar path

// Exemplo de como BaileysRouter poderia ser estruturado
export class BaileysRouter extends RouterBroker {
    public router: Router;
    private controller = baileysController; // Usa controller importado

    constructor(private configService: ConfigService) {
        super('BaileysRouter'); // Nome do Router para logging/debug
        this.router = Router();
        this.initRoutes();
    }

    protected initRoutes() {
        const guards = [authGuard(this.configService), instanceGuard];

        // Exemplo de rota que usa o BaileysController
        // POST /:instanceName/baileys/check-numbers
        this.router.post(
            this.routerPath('check-numbers'), // Path: /baileys/check-numbers (assumindo base /:instanceName/baileys)
            ...guards,
            async (req, res) => {
                const response = await this.dataValidate({ // Valida e executa
                    req,
                    res,
                    // DTOClass: CheckNumbersDto, // Criar DTO se necessário { jids: string[] }
                    controllerAction: (instance, data) => this.controller.checkWhatsappNumbers(instance.instanceName, data),
                    instanceRequired: true
                });
                // dataValidate lida com o envio da resposta
            }
        );

        // Adicione outras rotas específicas do Baileys aqui...
    }
}

// Exemplo de instanciação (ajuste conforme sua estrutura principal)
// const configService = new ConfigService(); // Ou injetado
// export const baileysRouter = new BaileysRouter(configService).router;
