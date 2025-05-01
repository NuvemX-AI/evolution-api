// src/api/integrations/chatbot/chatwoot/controllers/chatwoot.controller.ts

import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '@api/integrations/chatbot/chatwoot/dto/chatwoot.dto'; // Assume alias e DTO existem
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Assume alias e serviço existem
import { PrismaRepository } from '@api/repository/repository.service'; // Assume alias e repo existem
// << CORREÇÃO TS2345: Importar waMonitor de server.module pode causar conflito se ele usar WAMonitoringService de 'monitor.service'
//    e o ChatwootService esperar o de 'wa-monitoring.service'. Garanta consistência nas importações/definições. >>
import { waMonitor } from '@api/server.module'; // Verifique se waMonitor exportado usa o tipo correto de WAMonitoringService
import { CacheService } from '@api/services/cache.service'; // Assume alias e serviço existem
import { CacheEngine } from '@cache/cacheengine'; // Assume alias e cache engine existem
import { Chatwoot, ConfigService, HttpServer } from '@config/env.config'; // Assume alias e tipos existem
import { BadRequestException } from '@exceptions'; // Assume alias e exceção existem
import { isURL } from 'class-validator';
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Importando o tipo esperado pelo ChatwootService

export class ChatwootController {
  // O ChatwootService agora é injetado (assumindo DI) ou instanciado em server.module
  constructor(
    private readonly chatwootService: ChatwootService, // Serviço principal injetado
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    // Removido cache daqui, pois parece ser usado apenas temporariamente em receiveWebhook
  ) {}

  public async createChatwoot(instance: InstanceDto, data: ChatwootDto): Promise<any> {
    // << CORREÇÃO: Usar o chatwootService injetado >>
    if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED)
      throw new BadRequestException('Chatwoot is disabled');

    if (data?.enabled) {
      if (!isURL(data.url, { require_tld: false })) {
        throw new BadRequestException('url is not valid');
      }
      if (!data.accountId) {
        throw new BadRequestException('accountId is required');
      }
      if (!data.token) {
        throw new BadRequestException('token is required');
      }
      // TODO: Verifique se 'signMsg' existe no DTO ChatwootDto
      // if (data.signMsg !== true && data.signMsg !== false) {
      //   throw new BadRequestException('signMsg is required');
      // }
      // if (data.signMsg === false) data.signDelimiter = null;
    }

    if (!data.nameInbox || data.nameInbox === '') {
      data.nameInbox = instance.instanceName;
    }

    // << CORREÇÃO: Usar o chatwootService injetado >>
    const result = await this.chatwootService.create(instance, data);

    const urlServer = this.configService.get<HttpServer>('SERVER').URL;

    const response = {
      ...result,
      webhook_url: `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}`,
    };

    return response;
  }

  public async findChatwoot(instance: InstanceDto): Promise<ChatwootDto & { webhook_url: string }> {
    // << CORREÇÃO: Usar o chatwootService injetado >>
    if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED)
      throw new BadRequestException('Chatwoot is disabled');

    // << CORREÇÃO: Usar o chatwootService injetado >>
    const result = await this.chatwootService.find(instance);

    const urlServer = this.configService.get<HttpServer>('SERVER').URL;

    // Ajuste no tratamento de resultado nulo para retornar um objeto completo
    const responseResult = result || {
        enabled: false,
        url: '',
        accountId: '', // Usar string vazia ou null? Verifique o tipo DTO.
        token: '',
        signMsg: false,
        nameInbox: '',
        // Adicione outros campos padrão se necessário
    };


    const response = {
      ...(responseResult as ChatwootDto), // Faz cast para o DTO
      webhook_url: result ? `${urlServer}/chatwoot/webhook/${encodeURIComponent(instance.instanceName)}` : '',
    };

    return response;
  }

  // Método para receber webhooks do Chatwoot (requer implementação no ChatwootService)
  public async receiveWebhook(instance: InstanceDto, data: any): Promise<any> {
    // << CORREÇÃO: Usar o chatwootService injetado em vez de criar um novo >>
    if (!this.configService.get<Chatwoot>('CHATWOOT').ENABLED) {
        this.chatwootService.logger?.warn?.(`Chatwoot desabilitado. Webhook ignorado para ${instance.instanceName}`); // Usa logger do serviço injetado
        // Retorna algo indicando sucesso silencioso ou um erro específico?
        // Por enquanto, retorna um objeto vazio para não quebrar o fluxo.
        return {};
        // throw new BadRequestException('Chatwoot is disabled'); // Lançar erro pode não ser ideal para webhooks
    }

    // REMOVIDO: Instanciação local de CacheService e ChatwootService
    // const chatwootCache = new CacheService(new CacheEngine(this.configService, ChatwootService.name).getEngine());
    // const chatwootService = new ChatwootService(waMonitor, this.configService, this.prismaRepository, chatwootCache);

    // << CORREÇÃO TS2339: Chamar um método que exista no serviço para processar o webhook >>
    //    Renomeado de 'receiveWebhook' para 'processWebhookPayload'.
    // NOTE: Você PRECISA implementar o método 'processWebhookPayload' na classe ChatwootService.
    //       Este método deve receber 'instance' e 'data', analisar o 'data' (payload do webhook)
    //       e chamar os handlers apropriados (ex: para mensagens recebidas do agente).
    return this.chatwootService.processWebhookPayload(instance, data);
  }
}
