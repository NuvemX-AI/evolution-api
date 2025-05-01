// src/api/integrations/channel/meta/meta.controller.ts

import { PrismaRepository } from '@api/repository/repository.service'; // Usando alias @api
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Usando alias @api
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts
import axios from 'axios';

// TODO: Precisa do arquivo channel.controller.ts para definir ChannelController e ChannelControllerInterface
import { ChannelController, ChannelControllerInterface } from '../channel.controller'; // Mantendo caminho relativo por enquanto

// TODO: Verificar modificadores de propriedade e assinatura do construtor em ChannelController quando disponível (TS2415, TS2345)
export class MetaController extends ChannelController implements ChannelControllerInterface {
  // TODO: Se Logger não for injetado ou herdado, inicialize aqui
  private readonly logger = new Logger('MetaController');
  public integrationEnabled: boolean = false; // Esta propriedade parece específica de MetaController

  constructor(
    // Modificadores 'protected' mantidos, mas precisam ser compatíveis com ChannelController
    protected readonly prismaRepository: PrismaRepository,
    protected readonly waMonitor: WAMonitoringService,
  ) {
    // A chamada super() pode gerar o erro TS2345 se a assinatura não for compatível
    super(prismaRepository, waMonitor); // TODO: Confirmar assinatura do construtor de ChannelController
  }

  /**
   * Processa webhooks recebidos da Meta (WhatsApp Business API)
   * @param data Payload do webhook
   */
  public async receiveWebhook(data: any): Promise<{ status: string }> {
    this.logger.log(`Recebido webhook da Meta: ${JSON.stringify(data)}`); // Adicionado log

    // Verifica se é um evento de conta de negócios do WhatsApp
    if (data.object === 'whatsapp_business_account' && Array.isArray(data.entry)) {
      for (const entry of data.entry) {
        const change = entry?.changes?.[0]; // Pega a primeira mudança

        if (!change) continue; // Pula se não houver 'changes'

        // [1] Atualização de status de template
        if (change.field === 'message_template_status_update') {
          const templateValue = change.value;
          this.logger.log(`Atualização de template recebida: ${JSON.stringify(templateValue)}`);

          // Corrigido: Acessar modelo 'template' através de '.prisma.'
          const template = await this.prismaRepository.prisma.template.findFirst({
            where: { templateId: `${templateValue.message_template_id}` }, // TODO: Confirmar se 'templateId' é o campo correto no schema.prisma
          });

          if (!template) {
            this.logger.error(`Template com ID ${templateValue.message_template_id} não encontrado para webhook.`);
            continue; // Continua para o próximo 'entry' se houver, em vez de retornar sucesso
          }

          // TODO: Confirmar se 'webhookUrl' é o campo correto no schema.prisma para Template
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

          // Corrigido: Acessar modelo 'instance' através de '.prisma.'
          // TODO: Confirmar se o campo para buscar é 'number' ou talvez 'ownerJid' ou outro identificador da Meta
          const instanceDb = await this.prismaRepository.prisma.instance.findFirst({
            where: { number: numberId }, // Busca pelo ID do número de telefone associado
          });

          if (!instanceDb) {
            this.logger.error(`Instância não encontrada para o numberId ${numberId} no banco de dados.`);
            continue;
          }

          const instanceName = instanceDb.name;
          const activeInstance = this.waMonitor.waInstances[instanceName];

          if (activeInstance && typeof activeInstance.connectToWhatsapp === 'function') {
            this.logger.log(`Encaminhando dados para a instância ativa: "${instanceName}"`);
            // Passa o objeto 'value' que contém a mensagem/status, não o 'data' inteiro
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

    // Retorna sucesso para a Meta API acusar o recebimento
    return {
      status: 'success',
    };
  }

  // TODO: Implementar os outros métodos da interface ChannelControllerInterface se necessário
  // (Ex: createInstance, connectToWhatsapp, etc., se MetaController precisar deles diretamente)
}
