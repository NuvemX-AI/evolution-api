import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/wa-monitoring.service';
import { Logger } from '@config/logger.config';
import axios from 'axios';

import { ChannelController, ChannelControllerInterface } from '../channel.controller';

export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger = new Logger('MetaController');
  public integrationEnabled: boolean = false;

  constructor(
    protected readonly prismaRepository: PrismaRepository,
    protected readonly waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor);
  }

  public async receiveWebhook(data: any): Promise<{ status: string }> {
    if (data.object === 'whatsapp_business_account') {
      // [1] Atualização de template do WhatsApp
      if (data.entry?.[0]?.changes?.[0]?.field === 'message_template_status_update') {
        const template = await this.prismaRepository.template.findFirst({
          where: { templateId: `${data.entry[0].changes[0].value.message_template_id}` },
        });

        if (!template) {
          this.logger.error('Template not found for webhook');
          return { status: 'success' };
        }

        const { webhookUrl } = template;

        await axios.post(webhookUrl, data.entry[0].changes[0].value, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        return { status: 'success' };
      }

      // [2] Eventos comuns (mensagens, status, etc)
      if (Array.isArray(data.entry)) {
        for (const entry of data.entry) {
          const numberId = entry?.changes?.[0]?.value?.metadata?.phone_number_id;

          if (!numberId) {
            this.logger.error('WebhookService -> receiveWebhookMeta -> numberId not found');
            continue;
          }

          const instance = await this.prismaRepository.instance.findFirst({
            where: { number: numberId },
          });

          if (!instance) {
            this.logger.error('WebhookService -> receiveWebhookMeta -> instance not found');
            continue;
          }

          if (
            this.waMonitor.waInstances &&
            this.waMonitor.waInstances[instance.name] &&
            typeof this.waMonitor.waInstances[instance.name].connectToWhatsapp === 'function'
          ) {
            await this.waMonitor.waInstances[instance.name].connectToWhatsapp(data);
          } else {
            this.logger.error(
              `Instance or connectToWhatsapp function not found for instance "${instance.name}"`,
            );
          }
        }
      }
    }

    return {
      status: 'success',
    };
  }
}
