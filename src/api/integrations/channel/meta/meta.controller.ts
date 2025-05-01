// Arquivo: src/api/integrations/channel/meta/meta.controller.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { PrismaRepository } from '@repository/repository.service'; // Usar alias canônico @repository
// Usar o tipo correto de WAMonitoringService consistentemente
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Manter este ou ajustar para monitor.service se for o caso
import { Logger } from '@config/logger.config'; // Usar alias @config
import axios from 'axios';

// Ajustado para usar alias @api (verificar se channel.controller está em /api/services ou similar)
import { ChannelController, ChannelControllerInterface } from '@api/services/channel.controller'; // Ajustar path/alias se necessário
import { Events } from '@api/types/wa.types'; // Importar Events

// CORREÇÃO TS2415: Visibilidade de waMonitor precisa ser compatível com a base
export class MetaController extends ChannelController implements ChannelControllerInterface {
  private readonly logger: Logger; // Inicializar logger
  public integrationEnabled = false; // Ou buscar do configService

  constructor(
    // Tipar explicitamente para clareza
    public readonly prismaRepository: PrismaRepository,
    // Visibilidade precisa corresponder à base (protected ou public)
    protected readonly waMonitor: WAMonitoringService,
  ) {
    // CORREÇÃO TS2345: O tipo de 'waMonitor' passado aqui precisa ser atribuível ao
    // tipo esperado no construtor de ChannelController.
    // Garanta que a importação de WAMonitoringService seja consistente.
    super(prismaRepository, waMonitor); // Passa para a classe base
    this.logger = new Logger('MetaController'); // Inicializa logger específico do controller
    // Buscar status de habilitação da integração (exemplo)
    // this.integrationEnabled = this.configService.get<WaBusinessConfig>('WA_BUSINESS')?.ENABLED ?? false;
  }

  /**
   * Processa webhooks recebidos da Meta (WhatsApp Business API)
   * @param data Payload do webhook
   */
  public async receiveWebhook(data: any): Promise<{ status: string } | any> { // Permitir retorno de erro
    this.logger.log(`Recebido webhook da Meta: ${JSON.stringify(data)}`);

    // Validação básica do webhook
    if (data?.object !== 'whatsapp_business_account' || !Array.isArray(data.entry)) {
      this.logger.warn({ receivedData: data }, `Webhook recebido não é do tipo esperado.`);
      // Considerar retornar um erro HTTP se apropriado, dependendo de como o webhook é chamado
      return { status: 'error', message: 'Invalid webhook format' };
    }

    try {
      for (const entry of data.entry) {
        const change = entry?.changes?.[0];
        if (!change?.field || !change?.value) continue; // Pula se não houver mudança válida

        // [1] Atualização de status de template
        if (change.field === 'message_template_status_update') {
          const templateValue = change.value;
          this.logger.log({ templateUpdate: templateValue }, `Atualização de template recebida`);

          // CORREÇÃO TS2339: Usar método 'findFirstTemplate' do repositório corrigido
          const template = await this.prismaRepository.findFirstTemplate({
            // Usar o ID numérico ou string, dependendo do schema
            where: { templateId: String(templateValue.message_template_id) },
            select: { webhookUrl: true } // Seleciona apenas o campo necessário
          });

          if (!template) {
            this.logger.error(`Template com ID ${templateValue.message_template_id} não encontrado para webhook.`);
            continue; // Próxima mudança ou entrada
          }

          if (template.webhookUrl) {
            try {
              this.logger.log(`Enviando atualização de template para webhook: ${template.webhookUrl}`);
              await axios.post(template.webhookUrl, templateValue, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000 // Adicionar timeout
              });
            } catch (error: any) {
              this.logger.error({ err: error, url: template.webhookUrl }, `Erro ao enviar webhook de template`);
            }
          } else {
            this.logger.warn(`Webhook URL não definido para o template ID ${templateValue.message_template_id}`);
          }
        }
        // [2] Eventos comuns (mensagens, status, etc)
        else if (change.value?.metadata?.phone_number_id) {
          const numberId = change.value.metadata.phone_number_id;
          this.logger.log(`Evento comum recebido para numberId: ${numberId}`);

          // CORREÇÃO TS2339: Usar método 'findFirstInstance' do repositório corrigido
          const instanceDb = await this.prismaRepository.findFirstInstance({
            where: { number: numberId }, // Busca pelo ID do número de telefone associado
            select: { name: true } // Seleciona apenas o nome
          });

          if (!instanceDb?.name) {
            this.logger.error(`Instância não encontrada no DB para o numberId ${numberId}.`);
            continue; // Próxima mudança ou entrada
          }

          const instanceName = instanceDb.name;
          // Acessa as instâncias através do waMonitor injetado
          const activeInstance = this.waMonitor.get(instanceName); // Usa o getter/método do monitor

          // Verifica se a instância está ativa e tem o método para processar webhooks
          if (activeInstance?.connectToWhatsapp) { // Usa optional chaining
            this.logger.log(`Encaminhando dados para a instância ativa: "${instanceName}"`);
            // Chama o método da instância específica (BusinessStartupService)
            await activeInstance.connectToWhatsapp(change.value);
          } else {
            this.logger.error(
              `Instância ativa "${instanceName}" ou método connectToWhatsapp não encontrado no monitor para numberId ${numberId}.`,
            );
          }
        } else {
           this.logger.warn({ change }, `Tipo de mudança não reconhecido ou phone_number_id ausente`);
        }
      } // Fim do loop for (changes)
    } catch (error) {
        this.logger.error({ err: error }, `Erro ao processar entradas do webhook`);
        // Considerar retornar erro HTTP
        return { status: 'error', message: 'Internal server error processing webhook' };
    }

    return { status: 'success' }; // Retorna sucesso se processou tudo sem erros fatais
  }

  // --- Implementação dos métodos da interface ChannelControllerInterface ---
  // (Adicionar implementações ou stubs se necessário)

  public async start(instanceData: InstanceDto): Promise<any> {
      this.logger.info(`MetaController: start chamado para ${instanceData.instanceName}`);
      // Meta API não tem um "start" real, apenas recebe webhooks.
      // Poderia verificar a validade do token/numberId aqui.
      return { status: 'Instance configured (Meta)', state: 'open' };
  }

  public async stop(instanceName: string): Promise<any> {
      this.logger.info(`MetaController: stop chamado para ${instanceName}`);
      // Meta API não tem um "stop" real. Apenas deixa de processar webhooks.
      // Limpar estado interno se houver.
      return { status: 'Instance stopped (Meta)' };
  }

  public async logout(instanceName: string): Promise<any> {
     this.logger.info(`MetaController: logout chamado para ${instanceName}`);
     // Ação de logout pode envolver invalidar token, remover configurações, etc.
     // Chamar waMonitor para remover a instância pode ser apropriado.
     await this.waMonitor.remove(instanceName); // Delega a remoção
     return { status: 'Instance logged out and removed (Meta)' };
  }

  public getInstance(instanceName: string): any {
      this.logger.debug(`MetaController: getInstance chamado para ${instanceName}`);
      // Retorna a instância gerenciada pelo waMonitor
      return this.waMonitor.get(instanceName);
  }

  public getStatus(instanceName: string): any {
      this.logger.debug(`MetaController: getStatus chamado para ${instanceName}`);
      const instance = this.waMonitor.get(instanceName);
      // Meta API está sempre "open" se configurada corretamente e recebendo webhooks.
      return instance ? instance.connectionStatus : { connection: 'close' };
  }

  public async getQrCode(instanceName: string): Promise<any> {
      this.logger.warn(`MetaController: getQrCode chamado para ${instanceName} (Não aplicável para Meta API)`);
      return { code: null, base64: null, count: 0, pairingCode: null }; // Retorna nulo
  }

  // ... outros métodos da interface ...

} // Fim da classe MetaController
