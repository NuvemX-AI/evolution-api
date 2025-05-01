// src/api/integrations/channel/meta/meta.controller.ts

import { PrismaRepository } from '@api/repository/repository.service'; // Usando alias @api
// Usando o import que já estava aqui, assumindo que é o correto ou que os tipos são compatíveis.
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts e importação correta
import axios from 'axios';

// Ajustado para caminho relativo mais provável, confirme se existe ou use alias @api
import { ChannelController, ChannelControllerInterface } from '../../channel/channel.controller';

export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger = new Logger('MetaController'); // Certifique-se que Logger está importado
  public integrationEnabled: boolean = false;

  constructor(
    // << CORREÇÃO TS2415: Visibilidade alterada para 'public' para corresponder à classe base >>
    public readonly prismaRepository: PrismaRepository,
    protected readonly waMonitor: WAMonitoringService, // Mantido protected, verifique a base se necessário
  ) {
    // << CORREÇÃO TS2345: Mantida a chamada super. O erro pode ser devido a definições conflitantes
    //    de WAMonitoringService em diferentes arquivos ou caminhos de import.
    //    Garanta que WAMonitoringService seja importado consistentemente ou que os tipos sejam compatíveis. >>
    super(prismaRepository, waMonitor); // TODO: Confirmar assinatura do construtor de ChannelController
  }

  /**
   * Processa webhooks recebidos da Meta (WhatsApp Business API)
   * @param data Payload do webhook
   */
  public async receiveWebhook(data: any): Promise<{ status: string }> {
    this.logger.log(`Recebido webhook da Meta: ${JSON.stringify(data)}`);

    if (data.object === 'whatsapp_business_account' && Array.isArray(data.entry)) {
      for (const entry of data.entry) {
        const change = entry?.changes?.[0];

        if (!change) continue;

        // [1] Atualização de status de template
        if (change.field === 'message_template_status_update') {
          const templateValue = change.value;
          this.logger.log(`Atualização de template recebida: ${JSON.stringify(templateValue)}`);

          // << CORREÇÃO TS2341 / TS2339: Usar método do repositório (nome hipotético) >>
          // NOTE: Implemente findFirstTemplate em PrismaRepository.
          // NOTE: Confirme se o campo de busca é 'templateId'.
          const template = await this.prismaRepository.findFirstTemplate({
            where: { templateId: `${templateValue.message_template_id}` },
          });

          if (!template) {
            this.logger.error(`Template com ID ${templateValue.message_template_id} não encontrado para webhook.`);
            continue;
          }

          // NOTE: Confirme se 'webhookUrl' é o campo correto no schema Prisma para Template.
          const { webhookUrl } = template;

          if (webhookUrl) {
            try {
              this.logger.log(`Enviando atualização de template para webhook: ${webhookUrl}`);
              await axios.post(webhookUrl, templateValue, {
                headers: { 'Content-Type': 'application/json' },
              });
            } catch (error: any) {
              this.logger.error(`Erro ao enviar webhook de template para ${webhookUrl}: ${error.message}`);
            }
          } else {
            this.logger.warn(`Webhook URL não definido para o template ID ${templateValue.message_template_id}`);
          }
        }
        // [2] Eventos comuns (mensagens, status, etc)
        else if (change.value?.metadata?.phone_number_id) {
          const numberId = change.value.metadata.phone_number_id;
          this.logger.log(`Evento comum recebido para numberId: ${numberId}`);

          // << CORREÇÃO TS2341: Usar método do repositório (nome hipotético) >>
          // NOTE: Implemente findFirstInstance em PrismaRepository.
          // NOTE: Confirme se o campo de busca é 'number'.
          const instanceDb = await this.prismaRepository.findFirstInstance({
            where: { number: numberId }, // Busca pelo ID do número de telefone associado
          });

          if (!instanceDb) {
            this.logger.error(`Instância não encontrada para o numberId ${numberId} no banco de dados.`);
            continue;
          }

          const instanceName = instanceDb.name;
          // Acessa as instâncias através do waMonitor injetado
          const activeInstance = this.waMonitor.get(instanceName); // Usando o getter/método do monitor

          if (activeInstance && typeof activeInstance.connectToWhatsapp === 'function') {
            this.logger.log(`Encaminhando dados para a instância ativa: "${instanceName}"`);
            await activeInstance.connectToWhatsapp(change.value);
          } else {
            this.logger.error(
              `Instância ativa "${instanceName}" ou método connectToWhatsapp não encontrado no monitor para numberId ${numberId}.`,
            );
          }
        } else {
           this.logger.warn(`Tipo de mudança não reconhecido ou phone_number_id ausente: ${JSON.stringify(change)}`);
        }
      } // Fim do loop for
    } else {
      this.logger.warn(`Webhook recebido não é do tipo 'whatsapp_business_account': ${JSON.stringify(data)}`);
    }

    return {
      status: 'success',
    };
  }

  // TODO: Implementar os outros métodos da interface ChannelControllerInterface se necessário
}
