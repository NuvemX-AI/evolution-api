// Arquivo: src/api/integrations/channel/meta/meta.controller.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// CORREÇÃO TS2307: Usar alias @repository
import { PrismaRepository } from '@repository/repository.service';
// Usar alias @api para serviços
// CORREÇÃO: Certifique-se que WAMonitoringService é importado do local correto (monitor.service ou wa-monitoring.service)
import { WAMonitoringService } from '@api/services/monitor.service'; // Assumindo monitor.service
// Usar alias @config para logger
import { Logger } from '@config/logger.config';
import axios from 'axios';

// CORREÇÃO TS2307: Ajustado caminho da importação
import { ChannelController, ChannelControllerInterface } from '../channel.controller';
// CORREÇÃO TS2304: Importar InstanceDto
import { InstanceDto } from '@api/dto/instance.dto';
import { Events } from '@api/types/wa.types'; // Importar Events se usado
import { Prisma } from '@prisma/client'; // Importar Prisma para tipos

export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger: Logger;
  public integrationEnabled = false; // Obter do configService se injetado

  constructor(
    public readonly prismaRepository: PrismaRepository,
    protected readonly waMonitor: WAMonitoringService,
    // Adicionar baseLogger se ChannelController esperar
    baseLogger: Logger
  ) {
    super(prismaRepository, waMonitor, baseLogger); // Passar dependências para a base
    this.logger = baseLogger.child({ context: MetaController.name }); // Criar logger filho
    // this.integrationEnabled = this.configService.get<WaBusinessConfig>('WA_BUSINESS')?.ENABLED ?? false; // Se configService for injetado
  }

  /**
   * Processa webhooks recebidos da Meta (WhatsApp Business API)
   * @param data Payload do webhook
   */
  public async receiveWebhook(data: any): Promise<{ status: string } | any> {
    // CORREÇÃO TS2554: Ajustar chamada ao logger
    this.logger.log({ msg: `Recebido webhook da Meta`, data });

    if (data?.object !== 'whatsapp_business_account' || !Array.isArray(data.entry)) {
      // CORREÇÃO TS2554: Ajustar chamada ao logger
      this.logger.warn({ receivedData: data, msg: `Webhook recebido não é do tipo esperado.` });
      return { status: 'error', message: 'Invalid webhook format' };
    }

    try {
      for (const entry of data.entry) {
        const change = entry?.changes?.[0];
        if (!change?.field || !change?.value) continue;

        // [1] Atualização de status de template
        if (change.field === 'message_template_status_update') {
          const templateValue = change.value;
          // CORREÇÃO TS2554: Ajustar chamada ao logger
          this.logger.log({ templateUpdate: templateValue, msg: `Atualização de template recebida` });

          // CORREÇÃO TS2339: Usar prismaRepository.template.findFirst (verificar nome do modelo 'template' no schema.prisma)
          const template = await this.prismaRepository.template?.findFirst({
            where: { templateId: String(templateValue.message_template_id) },
            select: { webhookUrl: true }
          });

          if (!template) {
            this.logger.error(`Template com ID ${templateValue.message_template_id} não encontrado para webhook.`);
            continue;
          }

          if (template.webhookUrl) {
            try {
              this.logger.log(`Enviando atualização de template para webhook: ${template.webhookUrl}`);
              await axios.post(template.webhookUrl, templateValue, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
              });
            } catch (error: any) {
              // CORREÇÃO TS2554: Ajustar chamada ao logger
              this.logger.error({ err: error, url: template.webhookUrl, msg: `Erro ao enviar webhook de template` });
            }
          } else {
            this.logger.warn(`Webhook URL não definido para o template ID ${templateValue.message_template_id}`);
          }
        }
        // [2] Eventos comuns (mensagens, status, etc)
        else if (change.value?.metadata?.phone_number_id) {
          const numberId = change.value.metadata.phone_number_id;
          this.logger.log(`Evento comum recebido para numberId: ${numberId}`);

          // CORREÇÃO TS2339: Usar prismaRepository.instance.findFirst
          const instanceDb = await this.prismaRepository.instance.findFirst({
            where: { number: numberId }, // Assumindo que 'number' armazena o phone_number_id
            select: { instanceName: true } // Corrigido select para instanceName
          });

          if (!instanceDb?.instanceName) { // Corrigido para instanceName
            this.logger.error(`Instância não encontrada no DB para o numberId ${numberId}.`);
            continue;
          }

          const instanceName = instanceDb.instanceName; // Corrigido para instanceName
          const activeInstance = this.waMonitor.get(instanceName);

          if (activeInstance?.connectToWhatsapp) {
            this.logger.log(`Encaminhando dados para a instância ativa: "${instanceName}"`);
            // O método connectToWhatsapp em BusinessStartupService deve tratar 'change.value'
            await activeInstance.connectToWhatsapp(change.value);
          } else {
            this.logger.error(
              `Instância ativa "${instanceName}" ou método connectToWhatsapp não encontrado no monitor para numberId ${numberId}.`,
            );
          }
        } else {
           // CORREÇÃO TS2554: Ajustar chamada ao logger
           this.logger.warn({ change, msg: `Tipo de mudança não reconhecido ou phone_number_id ausente` });
        }
      } // Fim do loop for (entry)
    } catch (error: any) {
        // CORREÇÃO TS2554: Ajustar chamada ao logger
        this.logger.error({ err: error, msg: `Erro ao processar entradas do webhook` });
        return { status: 'error', message: 'Internal server error processing webhook' };
    }

    return { status: 'success' };
  }

  // --- Implementação dos métodos da interface ChannelControllerInterface ---
  // Assumindo que estes métodos são necessários pela interface ou classe base

  // CORREÇÃO TS2304: InstanceDto foi importado
  public async start(instanceData: InstanceDto): Promise<any> {
      this.logger.info(`MetaController: start chamado para ${instanceData.instanceName}`);
      // Lógica de start para Meta (validar token, etc.)
      const instanceService = this.waMonitor.get(instanceData.instanceName);
      if (!instanceService) {
          this.logger.warn(`Tentando iniciar instância Meta ${instanceData.instanceName} que não está no monitor.`);
          // Pode tentar criar/adicionar ao monitor aqui se necessário
          // await this.waMonitor.createInstance(instanceData); // Exemplo
      } else {
         // Se já existe, talvez apenas verificar status?
         instanceService.connectToWhatsapp(); // Chama para carregar configs?
      }
       // Retorno de exemplo, ajuste conforme necessário
      return { status: 'Instance configured (Meta)', state: this.getStatus(instanceData.instanceName) };
  }

  public async stop(instanceName: string): Promise<any> {
      this.logger.info(`MetaController: stop chamado para ${instanceName}`);
      // Parar a instância Meta pode significar apenas removê-la do monitor
      const instance = this.waMonitor.get(instanceName);
      if (instance) {
          await instance.closeClient?.(); // Chama close se existir
      }
      // Remover do monitor (opcional, depende do fluxo)
      // await this.waMonitor.remove(instanceName);
      return { status: 'Instance stopped (Meta)' };
  }

  public async logout(instanceName: string): Promise<any> {
     this.logger.info(`MetaController: logout chamado para ${instanceName}`);
     await this.waMonitor.remove(instanceName); // Delega a remoção para o monitor
     return { status: 'Instance logged out and removed (Meta)' };
  }

  // Estes métodos já existem na classe base ChannelController,
  // não precisam ser redefinidos aqui a menos que a lógica seja específica para Meta
  // public getInstance(instanceName: string): any { ... }
  // public getStatus(instanceName: string): any { ... }
  // public async getQrCode(instanceName: string): Promise<any> { ... }

} // Fim da classe MetaController
