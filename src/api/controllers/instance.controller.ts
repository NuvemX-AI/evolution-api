// src/api/controllers/instance.controller.ts
// Correções Gemini: Corrige imports, logger, chamadas prisma, acesso a DTOs.

// Imports de DTOs e Tipos
// Ajuste os aliases se necessário (ex: @api -> ../ ou similar)
// CORREÇÃO TS2305: Removido CreateInstanceDto pois não é exportado e InstanceDto é usado
import { InstanceDto, SetPresenceDto } from '../dto/instance.dto';
import { Events } from '../types/wa.types';

// Imports de Serviços e Repositórios (ajuste os aliases/paths se necessário)
// CORREÇÃO TS2339 (deleteAccount): Corrigido path para monitor.service
import { WAMonitoringService } from '../services/monitor.service';
// CORREÇÃO TS2307: Manter imports, mas requer configuração correta de paths no tsconfig.json
import { ConfigService } from '@config/config.service'; // Depende do tsconfig.json
import { PrismaRepository } from '@repository/repository.service'; // Depende do tsconfig.json
import { ChatwootService } from '../integrations/chatbot/chatwoot/services/chatwoot.service';
import { SettingsService } from '../services/settings.service'; // Manter se o serviço existir e for injetado
import { CacheService } from '../services/cache.service'; // Manter se o serviço existir e for injetado
import { ProviderFiles } from '@provider/sessions'; // Usar alias @provider (ou path relativo)

// Imports de Configuração e Utilitários
import { Logger } from '@config/logger.config'; // Usar alias @config (ou path relativo)
import { BadRequestException, InternalServerErrorException } from '@exceptions/index'; // Usar alias @exceptions (ou path relativo)
import { delay } from '@whiskeysockets/baileys'; // Garantir que Baileys esteja instalado
import { EventEmitter2 } from 'eventemitter2';

export class InstanceController {
  private readonly logger: Logger;

  // Ajustar construtor para refletir dependências REAIS usadas
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly chatwootService: ChatwootService, // Usado implicitamente por waMonitor? Verificar dependências.
    // Injetar o Logger
    baseLogger: Logger // Recebe o logger base
  ) {
      // CORREÇÃO TS2339: Remover .child()
      this.logger = baseLogger; // Atribuir diretamente
      // Adicionar contexto se houver outra forma: this.logger.setContext(InstanceController.name);
  }

  /**
   * Cria ou conecta uma nova instância
   */
  public async createInstance(
    // CORREÇÃO TS2305: Usar InstanceDto pois CreateInstanceDto não é exportado
    instanceData: InstanceDto,
  ): Promise<any> {
    try {
      this.logger.info(`Attempting to create instance: ${instanceData.instanceName}`);
      // A chamada a waMonitor.createInstance precisa das dependências corretas
      // O segundo argumento `this` foi removido, verificar se WAMonitoringService realmente precisa do controller
      const instanceService = await this.waMonitor.createInstance(instanceData); // Remover 'this' se não for necessário

      if (!instanceService) {
        // CORREÇÃO TS2554: Passar um único objeto para o logger
        this.logger.error({ msg: `Failed to create instance service for ${instanceData.instanceName}. WAMonitoringService returned null.` });
        throw new BadRequestException(
          `Falha ao criar a estrutura da instância ${instanceData.instanceName}. Verifique os logs.`,
        );
      }

      this.logger.info(`Instance service created for ${instanceData.instanceName}. Waiting for potential QR code...`);
      await delay(2500);

      const connectionState = instanceService.connectionState?.connection ?? 'close';
      const qrCode = instanceService.instance.qrcode;
      const instanceId = instanceService.instance.instanceId;

      this.logger.info(`Instance ${instanceData.instanceName} (ID: ${instanceId}) state: ${connectionState}. QR Code fetched.`);

      return {
        error: false,
        message: 'Instance creation process initiated.',
        instance: {
            instanceName: instanceData.instanceName,
            instanceId: instanceId,
            owner: instanceData.owner, // Manter owner se existir no DTO (verificar instance.dto.ts)
            status: connectionState,
        },
        qrcode: connectionState !== 'open' ? qrCode : undefined,
      };
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar um único objeto para o logger
      this.logger.error({ err: error, msg: `Error creating instance "${instanceData.instanceName}"` });
      await this.waMonitor.remove(instanceData.instanceName);
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
     instanceDto: InstanceDto,
  ): Promise<any> {
    const { instanceName, number } = instanceDto; // 'number' existe em InstanceDto? Verificar dto.
    const instanceService = this.waMonitor.get(instanceName);

    if (!instanceService) {
      this.logger.warn(`Instance "${instanceName}" not found in monitor. Attempting to load from DB.`);
      try {
        // CORREÇÃO TS2353 & TS2339: Usar 'instanceName' como where unique, remover 'owner' pois não está no DTO
        const instanceDb = await this.prismaRepository.instance.findUnique({
            where: { instanceName: instanceName }, // Corrigido where clause
        });
        if (!instanceDb) {
           throw new BadRequestException(`A instância "${instanceName}" não existe.`);
        }
        this.logger.info(`Instance "${instanceName}" found in DB. Initiating connection process.`);
        // CORREÇÃO TS2305: Passar DTO compatível (InstanceDto)
        return await this.createInstance(instanceDb as InstanceDto); // Reutiliza createInstance
      } catch (dbError: any) {
         // CORREÇÃO TS2554: Passar um único objeto para o logger
         this.logger.error({ err: dbError, msg: `Error searching or creating instance "${instanceName}" from DB` });
         throw new InternalServerErrorException(`Erro ao processar instância "${instanceName}": ${dbError.message}`);
      }
    }

    const state = instanceService.connectionState?.connection;

    if (state === 'open') {
      this.logger.info(`Instância "${instanceName}" já está conectada.`);
      return this.connectionState(instanceDto);
    }

    if (state === 'connecting') {
      this.logger.info(`Instância "${instanceName}" já está conectando. Aguardando QR Code/conexão.`);
      return {
        instance: { instanceName, state: 'connecting' },
        qrcode: instanceService.instance.qrcode || null,
      };
    }

    try {
      this.logger.info(`Attempting to connect instance "${instanceName}"...`);
      await instanceService.connectToWhatsapp?.(number);
      await delay(2000);
      const qrCode = instanceService.instance.qrcode;
      const newState = instanceService.connectionState?.connection ?? 'connecting';
      this.logger.info(`Connection process initiated for "${instanceName}". State: ${newState}. QR Code: ${qrCode ? 'Available' : 'Not Available/Needed'}`);
      return {
        instance: { instanceName, state: newState },
        qrcode: qrCode || null,
      };
    } catch (error: any) {
       // CORREÇÃO TS2554: Passar um único objeto para o logger
       this.logger.error({ err: error, msg: `Error connecting instance "${instanceName}"` });
       throw new InternalServerErrorException(`Erro ao conectar: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Obtém o estado de conexão da instância
   */
  public async connectionState(
     instanceDto: InstanceDto,
   ): Promise<{ instance: { instanceName: string; state: string } }> {
    const { instanceName } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);
    const state = instanceService?.connectionState?.connection ?? 'close';

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
     instanceDto: InstanceDto,
  ): Promise<any> {
    const { instanceName } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);

    if (!instanceService) {
      this.logger.warn(`Attempting to logout non-existing/stopped instance: "${instanceName}"`);
      return { status: 'SUCCESS', error: false, response: { message: 'Instância não encontrada ou já parada.' } };
    }

    const state = instanceService.connectionState?.connection;

    if (state === 'close') {
       this.logger.warn(`Attempting to logout already closed instance: "${instanceName}"`);
      return { status: 'SUCCESS', error: false, response: { message: 'Instância já está desconectada.' } };
    }

    try {
      this.logger.info(`Logging out instance "${instanceName}"...`);
      await instanceService.logoutInstance?.();
      this.logger.info(`Instance "${instanceName}" logged out.`);
      return { status: 'SUCCESS', error: false, response: { message: 'Instância desconectada com sucesso' } };
    } catch (error: any) {
      // CORREÇÃO TS2554: Passar um único objeto para o logger
      this.logger.error({ err: error, msg: `Error logging out instance "${instanceName}"` });
      throw new InternalServerErrorException(`Erro ao desconectar: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Deleta uma instância completamente
   */
  public async deleteInstance(
     instanceDto: InstanceDto,
  ): Promise<any> {
      const { instanceName } = instanceDto;
      try {
          this.logger.info(`Deleting instance "${instanceName}"...`);
          // CORREÇÃO TS2339: Assumindo que deleteAccount existe em WAMonitoringService (após correção do import)
          const result = await this.waMonitor.deleteAccount(instanceName);

          if (result.success) {
              this.logger.info(`Instance "${instanceName}" deleted successfully.`);
              return { status: 'SUCCESS', error: false, response: { message: result.message || 'Instância deletada com sucesso' } };
          } else {
              this.logger.warn(`Instance "${instanceName}" not found for deletion or already deleted.`);
              throw new BadRequestException(result.message || `Instância "${instanceName}" não encontrada para deletar.`);
          }
      } catch (error: any) {
          // CORREÇÃO TS2554: Passar um único objeto para o logger
          this.logger.error({ err: error, msg: `Error deleting instance "${instanceName}"` });
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
     instanceDto: InstanceDto,
     presenceData: SetPresenceDto
   ): Promise<any> {
    const { instanceName } = instanceDto;
    const instanceService = this.waMonitor.get(instanceName);

    if (!instanceService) {
      throw new BadRequestException(`A instância "${instanceName}" não existe.`);
    }

    if (instanceService.connectionState?.connection !== 'open') {
       throw new BadRequestException(`A instância "${instanceName}" não está conectada.`);
    }

    try {
      // CORREÇÃO TS2339: Usar 'jid' em vez de 'number'
      this.logger.debug(`Setting presence for instance "${instanceName}" to ${presenceData.presence} for ${presenceData.jid}`);
      // Delega para o método sendPresence da instância específica (ChannelStartupService)
      const result = await instanceService.sendPresence?.(presenceData);
      this.logger.debug(`Presence set successfully for "${instanceName}"`);
      return { status: 'SUCCESS', error: false, response: result || { message: 'Presença definida' } };
    } catch (error: any) {
       // CORREÇÃO TS2554: Passar um único objeto para o logger
       this.logger.error({ err: error, msg: `Error setting presence for "${instanceName}"` });
       throw new InternalServerErrorException(`Erro ao definir presença: ${error?.message || 'Erro desconhecido'}`);
    }
  }
}

// Chave extra removida
