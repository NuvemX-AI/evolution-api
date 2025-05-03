// CORREÇÃO TS2307: Usar alias @repository
import { PrismaRepository } from '@repository/repository.service';
// Usar alias @api para outros serviços
import { WAMonitoringService } from '@api/services/monitor.service';
// Usar alias @config para logger
import { Logger } from '@config/logger.config';

// Importar ChannelController do local correto
import { ChannelController, ChannelControllerInterface } from '../channel.controller';
import { Instance } from '@prisma/client'; // Importar tipo Instance

export class EvolutionController extends ChannelController implements ChannelControllerInterface {
  // Considerar injetar o logger em vez de criar um novo aqui
  private readonly logger = new Logger('EvolutionController');

  // O construtor deve receber todas as dependências necessárias pela classe base
  // Adicionado baseLogger aqui para passar ao super()
  constructor(
      prismaRepository: PrismaRepository,
      waMonitor: WAMonitoringService,
      baseLogger: Logger // Adicionar Logger base
    ) {
    // Passar todas as dependências esperadas pelo construtor de ChannelController
    super(prismaRepository, waMonitor, baseLogger); // Passar baseLogger
    this.logger.setContext(EvolutionController.name); // Definir contexto se necessário
  }

  // integrationEnabled não parece ser usado ou definido
  // integrationEnabled: boolean;

  public async receiveWebhook(data: any): Promise<any> {
    // O campo 'numberId' existe no payload real do Evolution? Verificar estrutura.
    const identifierField = data.instance || data.apikey || data.numberId; // Tentar campos comuns

    if (!identifierField) {
      this.logger.error('Webhook Evolution recebido sem um identificador de instância (instance/apikey/numberId)');
      // Retornar um erro HTTP faria mais sentido do que apenas logar e sair
      // throw new BadRequestException('Identificador da instância ausente no webhook.');
      return { status: 'error', message: 'Identificador da instância ausente.' };
    }

    this.logger.info(`Webhook Evolution recebido para identificador: ${identifierField}`);

    // A busca da instância deve usar o campo correto (instanceName, apikey, etc.)
    // Usando instanceName como exemplo
    // TODO: Ajustar o campo 'where' conforme a chave real usada para identificar instâncias Evolution
    const instance = await this.prismaRepository.instance.findFirst({
      where: { instanceName: identifierField }, // Ou apikey: identifierField, etc.
    });

    if (!instance) {
      this.logger.error(`Instância não encontrada para o identificador Evolution: ${identifierField}`);
      // throw new NotFoundException(`Instância não encontrada para o identificador: ${identifierField}`);
      return { status: 'error', message: 'Instância não encontrada.' };
    }

    // Verifica se a instância está no monitor
    const monitoredInstance = this.waMonitor.waInstances[instance.instanceName];
    if (!monitoredInstance) {
        this.logger.error(`Instância ${instance.instanceName} encontrada no DB mas não está ativa no monitor.`);
        // Pode ser necessário iniciar a instância aqui ou retornar erro
        // throw new InternalServerErrorException(`Instância ${instance.instanceName} não está ativa.`);
        return { status: 'error', message: 'Instância não está ativa no monitor.' };
    }

    // Chama connectToWhatsapp da instância monitorada para processar o evento/webhook
    // O método connectToWhatsapp em EvolutionStartupService foi adaptado para lidar com isso
    await monitoredInstance.connectToWhatsapp(data);

    // Retorno de sucesso genérico. Pode ser mais específico dependendo da API Evolution.
    return {
      status: 'success',
      message: 'Webhook recebido e processado.'
    };
  }
}

// Remover chave extra no final, se houver
