// src/api/integrations/channel/whatsapp/baileys.controller.ts
// Correção Erro 73: Importa BadRequestException.

import { Logger } from '@config/logger.config'; // Ajustar path se necessário
import { WAMonitoringService } from '@api/services/monitor.service'; // Ajustar path se necessário
// ** Correção Erro 73: Importar exceção **
import { BadRequestException, NotFoundException, InternalServerErrorException } from '@exceptions/index'; // Ajustar path se necessário


// Este controller parece ser um intermediário ou um local para lógica específica do Baileys
// que não se encaixa diretamente no ChannelStartupService.
// Avaliar se ele é realmente necessário ou se sua lógica pode ser movida/integrada.

export class BaileysController {
    private readonly logger: Logger;

    constructor(
        private readonly waMonitor: WAMonitoringService,
        baseLogger: Logger // Recebe logger base
    ) {
        // Criar logger filho se suportado, senão usar baseLogger diretamente
        this.logger = baseLogger; // .child({ context: BaileysController.name });
    }

    // Exemplo de método que poderia existir aqui
    // (O método original `verifyJid` parece não existir mais ou foi movido)
    /**
     * @description Verifica se múltiplos JIDs existem no WhatsApp
     * @param instanceName Nome da instância
     * @param jids Array de JIDs para verificar
     */
    public async checkWhatsappNumbers(instanceName: string, data: { jids: string[] }): Promise<any> {
        this.logger.debug(`[${instanceName}] Verificando múltiplos JIDs via BaileysController`);
        const instance = this.waMonitor.get(instanceName);
        if (!instance) {
            throw new NotFoundException(`Instância ${instanceName} não encontrada.`);
        }

        // Validar entrada
        if (!data || !Array.isArray(data.jids) || data.jids.length === 0) {
             // ** Correção Erro 73: Usar BadRequestException importado **
            throw new BadRequestException("A propriedade 'jids' deve ser um array de strings não vazio.");
        }

        try {
            // Assumindo que o service da instância tem um método para verificar múltiplos JIDs
            // Exemplo: instance.onWhatsapp(jids) - verificar se aceita array
            // O método onWhatsapp corrigido anteriormente espera um WhatsAppNumberDto,
            // talvez precise de um método diferente como 'checkNumbers' ou adaptar 'onWhatsapp'.
            // Por enquanto, vamos simular a chamada a um método hipotético:
            const results = await instance.checkNumbers?.(data.jids);

             // Se 'checkNumbers' não existir, iterar e chamar 'onWhatsapp' individualmente?
             // const results = [];
             // for (const jid of data.jids) {
             //     results.push(await instance.onWhatsapp({ numbers: [jid] }));
             // }

             if (!results) {
                 throw new InternalServerErrorException('Método checkNumbers não disponível na instância.');
             }

            return results;
        } catch (error: any) {
            this.logger.error(`[${instanceName}] Erro ao verificar JIDs: ${error.message}`, error.stack);
            // Re-throw ou retornar erro formatado
            throw error;
        }
    }

    // Adicione outros métodos específicos do Baileys aqui, se necessário.
}
