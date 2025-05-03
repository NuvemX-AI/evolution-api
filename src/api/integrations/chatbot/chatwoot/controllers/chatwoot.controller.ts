// src/api/integrations/chatbot/chatwoot/controllers/chatwoot.controller.ts

import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto'; // Verifica se o DTO existe
// CORREÇÃO TS2307: Usar alias @repository
import { PrismaRepository } from '@repository/repository.service'; // Assume alias e repo existem
// Importar serviços necessários (verificar se ConfigService é realmente usado aqui ou só no ChatwootService)
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service';
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar monitor.service
import { ConfigService, Chatwoot as ChatwootConfig } from '@config/env.config'; // Importar ConfigService e tipo Chatwoot
import { Logger } from '@config/logger.config'; // Importar Logger
// Importar ChatbotController se for herdar ou usar métodos dele
import { ChatbotController } from '../../chatbot.controller'; // Ajustar path se necessário
// Importar exceções
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index';
import { Request, Response } from 'express'; // Importar tipos Express se usados diretamente

// A classe deve herdar de ChatbotController? Verificar design
// export class ChatwootController extends ChatbotController {
export class ChatwootController { // Não herda de ChatbotController no código original

  private readonly logger: Logger;
  public readonly integrationEnabled: boolean;

  // O construtor deve receber todas as dependências necessárias
  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly chatwootService: ChatwootService, // Serviço específico do Chatwoot
    private readonly configService: ConfigService, // ConfigService para verificar se Chatwoot está habilitado
    private readonly waMonitor: WAMonitoringService, // Adicionado se for necessário buscar instâncias ativas
    baseLogger: Logger // Receber logger base para criar filho
  ) {
    // Remover chamada super() se não herdar de ChatbotController
    // super(prismaRepository, waMonitor); // Remover se não herdar
    this.logger = baseLogger.child({ context: ChatwootController.name }); // Criar logger filho
    // Verifica se a integração Chatwoot está habilitada globalmente
    this.integrationEnabled = this.configService.get<ChatwootConfig>('CHATWOOT')?.ENABLED ?? false;
  }

  /**
   * Cria ou atualiza as configurações do Chatwoot para uma instância.
   */
  public async createChatwoot(instance: InstanceDto, data: ChatwootDto): Promise<ChatwootDto> {
    this.logger.info(`Configurando Chatwoot para a instância: ${instance.instanceName}`);
    if (!this.integrationEnabled) {
      throw new BadRequestException('A integração com Chatwoot não está habilitada globalmente.');
    }

    try {
      // Delega a lógica de salvar/atualizar para o ChatwootService
      const result = await this.chatwootService.setChatwootConfig(instance.instanceId!, data); // Passa instanceId
      this.logger.info(`Configuração Chatwoot salva com sucesso para: ${instance.instanceName}`);
      return result; // Retorna a configuração salva/atualizada
    } catch (error: any) {
      this.logger.error({ err: error, instanceName: instance.instanceName, msg: `Erro ao salvar configuração Chatwoot` });
      throw new InternalServerErrorException(`Erro ao salvar configuração Chatwoot: ${error.message}`);
    }
  }

  /**
   * Busca as configurações do Chatwoot para uma instância.
   */
  public async findChatwoot(instance: InstanceDto): Promise<ChatwootDto | null> {
    this.logger.debug(`Buscando configuração Chatwoot para a instância: ${instance.instanceName}`);
    if (!this.integrationEnabled) {
      this.logger.warn(`Integração Chatwoot desabilitada, retornando null para ${instance.instanceName}`);
      return null; // Retorna null se a integração estiver desabilitada
    }

    try {
      // Delega a busca para o ChatwootService
      const config = await this.chatwootService.findChatwootConfig(instance.instanceId!); // Passa instanceId
      if (!config) {
        this.logger.debug(`Nenhuma configuração Chatwoot encontrada para: ${instance.instanceName}`);
      }
      return config;
    } catch (error: any) {
      this.logger.error({ err: error, instanceName: instance.instanceName, msg: `Erro ao buscar configuração Chatwoot` });
      // Não lança exceção aqui, apenas retorna null em caso de erro na busca
      return null;
    }
  }

  /**
   * Processa webhooks recebidos do Chatwoot.
   * A instância é identificada via parâmetro na URL do webhook (ex: /chatwoot/webhook/myinstance).
   */
  // O DTO da instância pode não ser necessário aqui se instanceName vier dos params
  public async receiveWebhook(instanceParam: { instanceName: string }, data: any): Promise<any> {
     const instanceName = instanceParam.instanceName; // Pega o nome da URL
     this.logger.info(`Webhook Chatwoot recebido para instância: ${instanceName}`);
     this.logger.debug(`Dados do webhook Chatwoot: ${JSON.stringify(data)}`);

     if (!this.integrationEnabled) {
       this.logger.warn(`Integração Chatwoot desabilitada. Webhook ignorado para ${instanceName}`);
       return { message: 'Chatwoot integration disabled.' }; // Retorno simples
     }

     // Busca a configuração/instância ativa
     const instanceService = this.waMonitor.get(instanceName); // Busca no monitor
     const chatwootConfig = await this.findChatwoot({ instanceName: instanceName } as InstanceDto); // Busca config no DB

     if (!instanceService || !chatwootConfig?.enabled) {
       // CORREÇÃO TS2341: Usar o logger do controller (this.logger)
       this.logger.warn(`Instância ${instanceName} não ativa no monitor ou configuração Chatwoot desabilitada. Webhook ignorado.`);
       return { message: 'Instance not active or Chatwoot disabled for this instance.' };
     }

     try {
       // Delega o processamento do webhook para o ChatwootService
       // O serviço precisa do instanceId e dos dados do webhook
       const result = await this.chatwootService.processWebhook({
           instanceId: instanceService.instanceId!, // Pega o ID da instância ativa
           payload: data
       });
       this.logger.info(`Webhook Chatwoot processado para ${instanceName}`);
       return { status: 'success', result: result }; // Retorna sucesso
     } catch (error: any) {
       this.logger.error({ err: error, instanceName: instanceName, msg: `Erro ao processar webhook Chatwoot` });
       // Webhooks geralmente retornam OK mesmo com erro interno para evitar retentativas do Chatwoot
       return { status: 'error', message: `Erro interno: ${error.message}` };
       // Ou lançar exceção se preferir que o framework trate
       // throw new InternalServerErrorException(`Erro ao processar webhook Chatwoot: ${error.message}`);
     }
  }

  // Implementar outros métodos se necessário (ex: emit para receber mensagens do WhatsApp)
  // public async emit(emitData: EmitData): Promise<void> { ... }

} // Fim da classe ChatwootController
