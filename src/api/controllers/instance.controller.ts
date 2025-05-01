// src/api/controllers/instance.controller.ts

// Imports de DTOs e Tipos
// Ajuste os aliases se necessário (ex: @api -> ../ ou similar)
import { InstanceDto, CreateInstanceDto, SetPresenceDto } from '../dto/instance.dto';
import { Events } from '../types/wa.types'; // Removidos 'Integration' e 'wa' pois não parecem usados aqui

// Imports de Serviços e Repositórios (ajuste os aliases/paths se necessário)
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { ConfigService } from '@config/config.service'; // CORRIGIDO: Usar alias @config (ou path relativo)
import { PrismaRepository } from '@repository/repository.service'; // Usar alias @repository (ou path relativo)
import { ChatwootService } from '../integrations/chatbot/chatwoot/services/chatwoot.service';
import { SettingsService } from '../services/settings.service'; // Manter se o serviço existir e for injetado
import { CacheService } from '../services/cache.service'; // Manter se o serviço existir e for injetado
import { ProviderFiles } from '@provider/sessions'; // Usar alias @provider (ou path relativo)
// CORRIGIDO: ProxyController geralmente é injetado, não importado diretamente aqui, a menos que seja um tipo
// import { ProxyController } from '@controllers/proxy.controller'; // Removido ou ajustado se for apenas tipo

// Imports de Configuração e Utilitários
import { Logger } from '@config/logger.config'; // Usar alias @config (ou path relativo)
import { BadRequestException, InternalServerErrorException } from '@exceptions/index'; // Usar alias @exceptions (ou path relativo)
// CORRIGIDO: Garantir que Baileys esteja instalado e importável
import { delay } from '@whiskeysockets/baileys';
import { EventEmitter2 } from 'eventemitter2';
// import { v4 } from 'uuid'; // Não parece ser usado neste arquivo

// Removidos decoradores NestJS pois não estavam no original
export class InstanceController {
  private readonly logger: Logger; // Logger será injetado ou instanciado no construtor

  // CORRIGIDO: Ajustar construtor para refletir as dependências REAIS usadas pela classe
  // e que são (ou deveriam ser) fornecidas via DI (ex: no server.module.ts).
  // Removidas dependências não utilizadas diretamente nos métodos deste controller.
  constructor(
    // Removido @Inject se não estiver usando NestJS DI explicitamente aqui
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository, // Mantido se usado para validações futuras
    private readonly eventEmitter: EventEmitter2,
    private readonly chatwootService: ChatwootService, // Mantido se usado para validações futuras
    // private readonly settingsService: SettingsService, // Remover se não usado
    // private readonly proxyService: ProxyController, // Remover se não usado
    // Injetar o Logger
    baseLogger: Logger // Recebe o logger base
    // Remover caches específicos se não usados diretamente aqui
    // private readonly cache: CacheService,
    // private readonly chatwootCache: CacheService,
    // private readonly baileysCache: CacheService,
    // private readonly providerFiles: ProviderFiles, // Remover se não usado
  ) {
      // Cria um logger filho específico para este controller
      this.logger = baseLogger.child({ context: InstanceController.name });
  }


  /**
   * Cria ou conecta uma nova instância
   * NOTA: A lógica parece delegar a criação para waMonitor.createInstance
   */
  public async createInstance(
    instanceData: CreateInstanceDto, // Renomeado DTO para CreateInstanceDto se for diferente de InstanceDto
  ): Promise<any> { // TODO: Definir um tipo de retorno mais específico
    try {
      this.logger.info(`Attempting to create instance: ${instanceData.instanceName}`);
      // A chamada a waMonitor.createInstance precisa das dependências corretas passadas para o WAMonitoringService
      // O segundo argumento (_deps) foi removido da chamada, assumindo que não é mais necessário
      // ou que WAMonitoringService obtém suas dependências via construtor.
      const instanceService = await this.waMonitor.createInstance(instanceData, this); // Passa o controller se necessário para o monitor

      if (!instanceService) {
        this.logger.error(`Failed to create instance service for ${instanceData.instanceName}. WAMonitoringService returned null.`);
        throw new BadRequestException(
          `Falha ao criar a estrutura da instância ${instanceData.instanceName}. Verifique os logs.`,
        );
      }

      this.logger.info(`Instance service created for ${instanceData.instanceName}. Waiting for potential QR code...`);
      // Espera um pouco para o QR Code ser gerado, se aplicável
      await delay(2500); // Aumentado delay ligeiramente

      // Acessa as propriedades da instância gerenciada pelo ChannelService
      const connectionState = instanceService.connectionState?.connection ?? 'close';
      const qrCode = instanceService.instance.qrcode; // Acessa qrcode dentro do DTO da instância gerenciada
      const instanceId = instanceService.instance.instanceId; // Acessa instanceId

      this.logger.info(`Instance ${instanceData.instanceName} (ID: ${instanceId}) state: ${connectionState}. QR Code fetched.`);

      return {
        error: false,
        message: 'Instance creation process initiated.',
        instance: {
            instanceName: instanceData.instanceName,
            instanceId: instanceId,
            owner: instanceData.owner, // Incluir owner se relevante
            status: connectionState,
        },
        // Retorna o QR Code apenas se a conexão não estiver aberta
        qrcode: connectionState !== 'open' ? qrCode : undefined,
      };
    } catch (error: any) {
      this.logger.error({ err: error }, `Error creating instance "${instanceData.instanceName}"`);
      // Remove a instância do monitor em caso de erro na criação
      await this.waMonitor.remove(instanceData.instanceName); // Garante que a remoção seja aguardada
      // Re-lança a exceção para ser tratada pelo framework (Express/NestJS)
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(`Falha ao criar instância: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Conecta uma instância existente ao WhatsApp (gera QR Code se necessário)
   */
  public async connectToWhatsapp(
     instanceDto: InstanceDto, // Recebe o DTO completo
  ): Promise<any> { // TODO: Definir tipo de retorno
    const { instanceName, number } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);

    if (!instanceService) {
      // Tenta carregar a instância do banco de dados se não estiver no monitor
      this.logger.warn(`Instance "${instanceName}" not found in monitor. Attempting to load from DB.`);
      try {
        const instanceDb = await this.prismaRepository.instance.findUnique({
            where: { instanceName_owner: { instanceName, owner: instanceDto.owner } }, // Assumindo owner no DTO
        });
        if (!instanceDb) {
           throw new BadRequestException(`A instância "${instanceName}" não existe.`);
        }
        // Se encontrou no DB, tenta criar/conectar através do monitor
        this.logger.info(`Instance "${instanceName}" found in DB. Initiating connection process.`);
        // Passa o DTO reconstruído do DB
        return await this.createInstance(instanceDb as CreateInstanceDto); // Reutiliza createInstance
      } catch (dbError: any) {
         this.logger.error({ err: dbError }, `Error searching or creating instance "${instanceName}" from DB`);
         throw new InternalServerErrorException(`Erro ao processar instância "${instanceName}": ${dbError.message}`);
      }
    }

    const state = instanceService.connectionState?.connection;

    if (state === 'open') {
      this.logger.info(`Instância "${instanceName}" já está conectada.`);
      return this.connectionState(instanceDto); // Retorna o estado atual
    }

    if (state === 'connecting') {
      this.logger.info(`Instância "${instanceName}" já está conectando. Aguardando QR Code/conexão.`);
      return {
        instance: { instanceName, state: 'connecting' },
        qrcode: instanceService.instance.qrcode || null,
      };
    }

    // Se estiver 'close' ou outro estado, tenta conectar
    try {
      this.logger.info(`Attempting to connect instance "${instanceName}"...`);
      await instanceService.connectToWhatsapp?.(number); // Chama método do ChannelService
      await delay(2000); // Aguarda um pouco para potencial geração de QR Code
      const qrCode = instanceService.instance.qrcode;
      const newState = instanceService.connectionState?.connection ?? 'connecting';
      this.logger.info(`Connection process initiated for "${instanceName}". State: ${newState}. QR Code: ${qrCode ? 'Available' : 'Not Available/Needed'}`);
      return {
        instance: { instanceName, state: newState },
        qrcode: qrCode || null, // Retorna o QR code atualizado
      };
    } catch (error: any) {
       this.logger.error({ err: error }, `Error connecting instance "${instanceName}"`);
       throw new InternalServerErrorException(`Erro ao conectar: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Obtém o estado de conexão da instância
   */
  public async connectionState(
     instanceDto: InstanceDto, // Recebe o DTO para pegar instanceName
   ): Promise<{ instance: { instanceName: string; state: string } }> {
    const { instanceName } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);
    // Usa connectionState.connection conforme definido na classe base ChannelStartupService
    const state = instanceService?.connectionState?.connection ?? 'close'; // Assume 'close' se não encontrada

    if (!instanceService) {
        this.logger.warn(`Attempting to get state of non-existing/stopped instance: "${instanceName}"`);
    } else {
        this.logger.debug(`Instance "${instanceName}" state is: ${state}`);
    }

    return {
      instance: {
        instanceName,
        state: state,
      },
    };
  }

  /**
   * Desconecta (logout) uma instância
   */
  public async logout(
     instanceDto: InstanceDto, // Recebe o DTO
  ): Promise<any> { // TODO: Definir tipo de retorno
    const { instanceName } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);

    if (!instanceService) {
      this.logger.warn(`Attempting to logout non-existing/stopped instance: "${instanceName}"`);
      // Considera sucesso se já não existe? Ou erro?
      // Retornando sucesso por ora, pois o objetivo (não estar conectado) foi atingido.
      return { status: 'SUCCESS', error: false, response: { message: 'Instância não encontrada ou já parada.' } };
      // Ou lançar erro:
      // throw new BadRequestException(`A instância "${instanceName}" não existe ou não está ativa.`);
    }

    const state = instanceService.connectionState?.connection;

    if (state === 'close') {
       this.logger.warn(`Attempting to logout already closed instance: "${instanceName}"`);
      return { status: 'SUCCESS', error: false, response: { message: 'Instância já está desconectada.' } };
      // Ou lançar erro:
      // throw new BadRequestException(`A instância "${instanceName}" já está desconectada.`);
    }

    try {
      this.logger.info(`Logging out instance "${instanceName}"...`);
      await instanceService.logoutInstance?.(); // Chama o método da instância específica (ChannelStartupService)
      this.logger.info(`Instance "${instanceName}" logged out.`);
      // Não remover do monitor aqui, apenas desconectar
      return { status: 'SUCCESS', error: false, response: { message: 'Instância desconectada com sucesso' } };
    } catch (error: any) {
      this.logger.error({ err: error }, `Error logging out instance "${instanceName}"`);
      throw new InternalServerErrorException(`Erro ao desconectar: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Deleta uma instância completamente
   */
  public async deleteInstance(
     instanceDto: InstanceDto, // Recebe o DTO
  ): Promise<any> { // TODO: Definir tipo de retorno
      const { instanceName } = instanceDto;
      try {
          this.logger.info(`Deleting instance "${instanceName}"...`);
          // Chama o método do WAMonitoringService que encapsula a lógica de logout e remoção
          const result = await this.waMonitor.deleteAccount(instanceName);

          if (result.success) {
              this.logger.info(`Instance "${instanceName}" deleted successfully.`);
              return { status: 'SUCCESS', error: false, response: { message: result.message || 'Instância deletada com sucesso' } };
          } else {
              this.logger.warn(`Instance "${instanceName}" not found for deletion or already deleted.`);
              // Lança exceção para indicar que não foi encontrada ou já havia sido deletada
              throw new BadRequestException(result.message || `Instância "${instanceName}" não encontrada para deletar.`);
          }
      } catch (error: any) {
          this.logger.error({ err: error }, `Error deleting instance "${instanceName}"`);
          // Delegação para deleteAccount já deve tentar limpar o monitor
          if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
              throw error;
          }
          throw new InternalServerErrorException(`Erro ao deletar instância: ${error?.message || 'Erro desconhecido'}`);
      }
  }


  /**
   * Define a presença (online, digitando, etc.)
   */
  public async setPresence(
     instanceDto: InstanceDto, // Recebe o DTO para instanceName
     presenceData: SetPresenceDto // Recebe o DTO com os dados da presença
   ): Promise<any> { // TODO: Definir tipo de retorno
    const { instanceName } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);

    if (!instanceService) {
      throw new BadRequestException(`A instância "${instanceName}" não existe.`);
    }

    if (instanceService.connectionState?.connection !== 'open') {
       throw new BadRequestException(`A instância "${instanceName}" não está conectada.`);
    }

    try {
      this.logger.debug(`Setting presence for instance "${instanceName}" to ${presenceData.presence} for ${presenceData.number}`);
      // Delega para o método setPresence da instância específica (ChannelStartupService)
      const result = await instanceService.sendPresence?.(presenceData); // Renomeado para sendPresence na classe base?
      this.logger.debug(`Presence set successfully for "${instanceName}"`);
      return { status: 'SUCCESS', error: false, response: result || { message: 'Presença definida' } };
    } catch (error: any) {
       this.logger.error({ err: error }, `Error setting presence for "${instanceName}"`);
       throw new InternalServerErrorException(`Erro ao definir presença: ${error?.message || 'Erro desconhecido'}`);
    }
  }
}

// Havia um '}' extra no final do arquivo original, que foi removido.
