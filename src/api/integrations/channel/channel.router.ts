// src/api/integrations/channel/channel.router.ts
// Correção Erro 32: Altera path alias para relativo.

import { Router } from 'express';
// ** Correção Erro 32: Alterado de '@config/config.service' para path relativo **
// import { ConfigService } from '@config/config.service'; // Ou path relativo
import { ConfigService } from '../../../config/config.service'; // Path relativo
import { channelController } from '../../server.module'; // Assumindo exportação de server.module
import { authGuard } from '../../guards/auth.guard'; // Assumindo que guard existe
import { instanceGuard } from '../../guards/instance.guard'; // Assumindo que guard existe
import { RouterBroker } from '../../abstract/abstract.router'; // Import base router

// Presumindo que ConfigService, channelController, authGuard, instanceGuard estão disponíveis e configurados corretamente
// Exemplo de como RouterBroker pode ser usado (adapte conforme sua implementação real)

export class ChannelRouter extends RouterBroker {
    public router: Router;
    private controller = channelController; // Usa o controller injetado/exportado

    constructor(private configService: ConfigService) {
        super('ChannelRouter'); // Chama construtor da classe base
        this.router = Router();
        this.initRoutes();
    }

    protected initRoutes() {
        const guards = [authGuard(this.configService), instanceGuard]; // Combina guards

        // Rota para criar canal (exemplo, pode não existir ou ser diferente)
        // Ajuste o path e o método do controller conforme necessário
        this.router.post(
            this.routerPath('create'), // Usa helper para construir path (ex: /channel/create)
            ...guards,
            async (req, res) => {
                const response = await this.dataValidate({ // Usa helper para validar e executar
                    req,
                    res,
                    controllerAction: (instance, data) => this.controller.createChannelInstance(data), // Chama método do controller
                    // DTOClass: CreateChannelDto, // Passar DTO para validação se necessário
                    instanceRequired: false // Exemplo: criação pode não exigir instância pré-existente
                });
                // dataValidate lida com envio da resposta
            }
        );

        // Adicione outras rotas do channel controller aqui se necessário
        // Ex: GET /:instanceName/channel/status
        this.router.get(
            this.routerPath('/:instanceName/status'), // Path com parâmetro
            ...guards, // Requer instância
            async (req, res) => {
                 const response = await this.dataValidate({
                     req,
                     res,
                     controllerAction: (instance) => this.controller.getChannelStatus(instance), // Método de exemplo
                     instanceRequired: true // Requer instância
                 });
            }
        );
    }
}

// Exemplo de como instanciar e exportar (adapte à sua estrutura principal)
// const configService = new ConfigService(); // Ou obtenha de DI
// export const channelRouter = new ChannelRouter(configService).router;
