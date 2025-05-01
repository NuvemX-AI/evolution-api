// src/api/controllers/instance.controller.ts
// console.log('========== LOADING FILE: instance.controller.ts =========='); // Removido console.log desnecessário

// Imports de DTOs e Tipos
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto'; // Usando alias @api
import { Events, Integration, wa } from '@api/types/wa.types'; // Usando alias @api // TODO: Verificar se 'wa' é realmente necessário ou se os tipos específicos do Baileys devem ser importados

// Imports de Serviços e Repositórios (usando aliases)
import { WAMonitoringService } from '@services/wa-monitoring.service';
import { ConfigService } from '@config/config.service';
import { PrismaRepository } from '@repository/repository.service';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service'; // Ajustado para caminho mais provável com alias
import { SettingsService } from '@services/settings.service'; // TODO: Precisa do arquivo src/api/services/settings.service.ts
import { CacheService } from '@services/cache.service'; // TODO: Precisa do arquivo src/cache/cache.service.ts
import { ProviderFiles } from '@provider/sessions'; // TODO: Precisa do arquivo src/provider/sessions.ts
import { ProxyController } from '@controllers/proxy.controller'; // Usando alias @controllers // TODO: Precisa do arquivo proxy.controller.ts

// Imports de Configuração e Utilitários
import { Logger } from '@config/logger.config'; // TODO: Precisa do arquivo logger.config.ts
import { BadRequestException, InternalServerErrorException } from '@exceptions'; // Usando alias @exceptions
import { delay } from '@whiskeysockets/baileys'; // Importando delay do Baileys
import { EventEmitter2 } from 'eventemitter2'; // Importando EventEmitter2
import { v4 } from 'uuid'; // Importando v4 de uuid

// TODO: Se estiver usando NestJS, descomente os decorators e importe do @nestjs/common
// import { Controller, Inject, Post, Body, Get, Delete, Param, Patch } from '@nestjs/common';

// @Controller('instance') // Exemplo de decorator NestJS
export class InstanceController {
  // TODO: Se não estiver usando DI (Injeção de Dependência), inicialize o Logger aqui.
  // Se Logger for uma classe, precisa ser importada de '@config/logger.config'.
  private readonly logger: Logger = new Logger('InstanceController');

  // TODO: Se não estiver usando DI, este construtor precisa ser removido ou adaptado
  // para instanciar as dependências manualmente. Assumindo DI por enquanto.
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly chatwootService: ChatwootService,
    private readonly settingsService: SettingsService, // Dependência não fornecida
    private readonly proxyService: ProxyController, // Dependência não fornecida
    private readonly cache: CacheService, // Dependência não fornecida
    private readonly chatwootCache: CacheService, // Dependência não fornecida
    private readonly baileysCache: CacheService, // Dependência não fornecida
    private readonly providerFiles: ProviderFiles, // Dependência não fornecida
  ) {}

  /**
   * Cria ou conecta uma nova instância
   */
  // @Post('create') // Exemplo NestJS
  public async createInstance(
    /* @Body() */ instanceData: InstanceDto, // Se usar NestJS, use @Body
  ): Promise<any> { // TODO: Definir um tipo de retorno mais específico
    try {
      // Delega a criação/inicialização para o WAMonitoringService
      // WAMonitoringService agora recebe as dependências no seu próprio construtor,
      // então não precisamos passá-las aqui novamente.
      const instance = await this.waMonitor.createInstance(instanceData); // Simplificado

      if (!instance) {
        throw new BadRequestException(
          'Falha ao criar instância WhatsApp. Verifique os logs do WAMonitoringService.',
        );
      }

      // Espera um pouco para o QR Code ser gerado, se aplicável
      await delay(1500); // Pequeno delay pode ajudar a garantir que o QR code esteja pronto

      const connectionState = instance.connectionStatus?.state || 'close'; // Garante um estado padrão
      const qrCode = instance.qrCode; // Pega o QR code gerado

      return {
        error: false,
        response: {
          instanceName: instanceData.instanceName,
          instanceId: instance.instanceId, // Assumindo que instanceId existe na instância retornada
          // Retorna o QR Code apenas se a conexão não estiver aberta
          qrCode: connectionState !== 'open' ? qrCode : null,
          connectionState: connectionState,
        },
      };
    } catch (error: any) {
      // Remove a instância do monitor em caso de erro na criação
      this.waMonitor.remove(instanceData.instanceName);
      this.logger.error(`Erro ao criar instância "${instanceData.instanceName}": ${error?.message || error}`);
      // Re-lança a exceção para ser tratada pelo framework (Express/NestJS)
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Falha ao criar instância: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Conecta uma instância existente ao WhatsApp (gera QR Code se necessário)
   */
  // @Post('connect') // Exemplo NestJS
  public async connectToWhatsapp(
    /* @Body() */ { instanceName, number = null }: InstanceDto,
  ): Promise<any> { // TODO: Definir tipo de retorno
    const instance = this.waMonitor.get(instanceName);

    if (!instance) {
      throw new BadRequestException(`A instância "${instanceName}" não existe.`);
    }

    const state = instance.connectionStatus?.state;

    if (state === 'open') {
      this.logger.info(`Instância "${instanceName}" já está conectada.`);
      return this.connectionState({ instanceName }); // Retorna o estado atual
    }

    if (state === 'connecting') {
      this.logger.info(`Instância "${instanceName}" já está conectando. Aguardando QR Code/conexão.`);
      // Retorna o QR code existente se houver, ou estado 'connecting'
      return {
        instance: { instanceName, state: 'connecting' },
        qrcode: instance.qrCode || null,
      };
    }

    // Se estiver 'close' ou outro estado, tenta conectar
    try {
      this.logger.info(`Tentando conectar instância "${instanceName}"...`);
      await instance.connectToWhatsapp?.(number); // Passa o número se fornecido
      await delay(2000); // Aguarda um pouco para potencial geração de QR Code
      const qrCode = instance.qrCode;
      this.logger.info(`Conexão iniciada para "${instanceName}". QR Code: ${qrCode?.code ? 'Gerado' : 'Não gerado/Necessário'}`);
      return {
        instance: { instanceName, state: instance.connectionStatus?.state || 'connecting' },
        qrcode: qrCode || null, // Retorna o QR code atualizado
      };
    } catch (error: any) {
       this.logger.error(`Erro ao conectar instância "${instanceName}": ${error?.message || error}`);
       throw new InternalServerErrorException(`Erro ao conectar: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Obtém o estado de conexão da instância
   */
  // @Get('connectionState/:instanceName') // Exemplo NestJS
  public async connectionState(
    /* @Param('instanceName') */ { instanceName }: InstanceDto // Use @Param se for NestJS
   ): Promise<any> { // TODO: Definir tipo de retorno
    const instance = this.waMonitor.get(instanceName);
    const state = instance?.connectionStatus?.state ?? 'close'; // Assume 'close' se não encontrada

    if (!instance) {
        this.logger.warn(`Tentativa de obter estado de instância não existente: "${instanceName}"`);
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
  // @Post('logout') // Exemplo NestJS
  public async logout(
     /* @Body() */ { instanceName }: InstanceDto
  ): Promise<any> { // TODO: Definir tipo de retorno
    const instance = this.waMonitor.get(instanceName);

    if (!instance) {
      throw new BadRequestException(`A instância "${instanceName}" não existe.`);
    }

    const state = instance.connectionStatus?.state;

    if (state === 'close') {
      throw new BadRequestException(`A instância "${instanceName}" já está desconectada.`);
    }

    try {
      this.logger.info(`Desconectando instância "${instanceName}"...`);
      await instance.logoutInstance?.(); // Chama o método da instância específica
      this.logger.info(`Instância "${instanceName}" desconectada.`);
      return { status: 'SUCCESS', error: false, response: { message: 'Instância desconectada com sucesso' } };
    } catch (error: any) {
      this.logger.error(`Erro ao desconectar instância "${instanceName}": ${error?.message || error}`);
      throw new InternalServerErrorException(`Erro ao desconectar: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Deleta uma instância completamente
   */
  // @Delete('delete/:instanceName') // Exemplo NestJS
  public async deleteInstance(
     /* @Param('instanceName') */ { instanceName }: InstanceDto // Use @Param se for NestJS
  ): Promise<any> { // TODO: Definir tipo de retorno
    const instance = this.waMonitor.get(instanceName);

    if (!instance) {
      throw new BadRequestException(`Instância "${instanceName}" não encontrada para deletar.`);
    }

    try {
      this.logger.info(`Deletando instância "${instanceName}"...`);
      // Tenta desconectar primeiro se estiver conectada
      if (['open', 'connecting'].includes(instance.connectionStatus?.state)) {
         this.logger.info(`Desconectando instância "${instanceName}" antes de deletar...`);
        await instance.logoutInstance?.();
        await delay(1000); // Pequeno delay para garantir o logout
      }

      // Envia webhook antes de remover do monitor
      instance.sendDataWebhook?.(Events.INSTANCE_DELETE, {
        instanceName,
        instanceId: instance.instanceId, // Assumindo que instanceId existe
      });

      // Emite evento interno para limpeza e remove do monitor
      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      // A linha abaixo pode ser redundante se 'remove.instance' já chama waMonitor.remove
      // this.waMonitor.remove(instanceName);

      this.logger.info(`Instância "${instanceName}" deletada com sucesso.`);
      return { status: 'SUCCESS', error: false, response: { message: 'Instância deletada com sucesso' } };
    } catch (error: any) {
       this.logger.error(`Erro ao deletar instância "${instanceName}": ${error?.message || error}`);
      // Mesmo que haja erro, tenta remover do monitor para evitar inconsistência
      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      throw new BadRequestException(`Erro ao deletar instância: ${error?.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Define a presença (online, digitando, etc.)
   */
  // @Post('presence') // Exemplo NestJS
  public async setPresence(
    /* @Body() */ body: { instanceName: string } & SetPresenceDto // Combina os DTOs
   ): Promise<any> { // TODO: Definir tipo de retorno
    const { instanceName, ...data } = body;
    const instance = this.waMonitor.get(instanceName);

    if (!instance) {
      throw new BadRequestException(`A instância "${instanceName}" não existe.`);
    }

    if (instance.connectionStatus?.state !== 'open') {
       throw new BadRequestException(`A instância "${instanceName}" não está conectada.`);
    }

    try {
      // Delega para o método setPresence da instância específica (Baileys, Meta, etc.)
      const result = await instance.setPresence?.(data);
      return { status: 'SUCCESS', error: false, response: result || { message: 'Presença definida' } };
    } catch (error: any) {
       this.logger.error(`Erro ao definir presença para "${instanceName}": ${error?.message || error}`);
       throw new InternalServerErrorException(`Erro ao definir presença: ${error?.message || 'Erro desconhecido'}`);
    }
  }
}
