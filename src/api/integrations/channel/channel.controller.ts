import { InstanceDto } from '@api/dto/instance.dto';
import { ProviderFiles } from '@api/provider/sessions';
// CORREÇÃO TS2307: Usar alias @repository
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Integration } from '@api/types/wa.types';
// CORREÇÃO: Importar ConfigService de @config/config.service (assumindo alias) ou path relativo correto
import { ConfigService } from '@config/config.service';
import { BadRequestException } from '@exceptions';
import EventEmitter2 from 'eventemitter2';
// CORREÇÃO: Importar Logger para passar como dependência
import { Logger } from '@config/logger.config';
// CORREÇÃO: Importar ChatwootService se for passado como dependência
import { ChatwootService } from '../chatbot/chatwoot/services/chatwoot.service';

import { EvolutionStartupService } from './evolution/evolution.channel.service';
import { BusinessStartupService } from './meta/whatsapp.business.service';
import { BaileysStartupService } from './whatsapp/whatsapp.baileys.service';
import { ChannelStartupService } from '@api/services/channel.service'; // Importar classe base

// Tipo ajustado para incluir dependências que faltavam
type ChannelDataType = {
  configService: ConfigService;
  eventEmitter: EventEmitter2;
  prismaRepository: PrismaRepository;
  cache: CacheService;
  chatwootCache: CacheService;
  baileysCache: CacheService;
  providerFiles: ProviderFiles;
  // Adicionar dependências que foram identificadas como faltantes
  waMonitor: WAMonitoringService;
  baseLogger: Logger;
  chatwootService: ChatwootService;
};

// Interface mantida, mas não implementada
export interface ChannelControllerInterface {
  receiveWebhook(data: any): Promise<any>;
}

export class ChannelController {
  public prismaRepository: PrismaRepository;
  public waMonitor: WAMonitoringService;
  // Adicionar Logger se for usado internamente ou passado como dependência
  private baseLogger: Logger;

  // O construtor deve receber todas as dependências necessárias
  constructor(
      prismaRepository: PrismaRepository,
      waMonitor: WAMonitoringService,
      baseLogger: Logger // Receber logger base
    ) {
    // CORREÇÃO: Usar nomes corretos das propriedades
    this.prismaRepository = prismaRepository;
    this.waMonitor = waMonitor;
    this.baseLogger = baseLogger; // Armazenar logger base
  }

  // Getters e Setters podem ser removidos se não forem estritamente necessários
  // public set prisma(prisma: PrismaRepository) {
  //   this.prismaRepository = prisma;
  // }

  // public get prisma() {
  //   return this.prismaRepository;
  // }

  // public set monitor(waMonitor: WAMonitoringService) {
  //   this.waMonitor = waMonitor;
  // }

  // public get monitor() {
  //   return this.waMonitor;
  // }

  // O método init agora recebe o ChannelDataType completo
  public init(instanceData: InstanceDto, data: ChannelDataType): ChannelStartupService | null {
    // Cria um logger específico para esta operação/instância
    const logger = this.baseLogger.child({ instance: instanceData.instanceName, channel: instanceData.integration });

    if (!instanceData.token && instanceData.integration === Integration.WHATSAPP_BUSINESS) {
      logger.error('Token é obrigatório para integração WHATSAPP_BUSINESS');
      throw new BadRequestException('Token é obrigatório para integração WHATSAPP_BUSINESS');
    }

    logger.info(`Iniciando instância do canal: ${instanceData.integration}`);

    if (instanceData.integration === Integration.WHATSAPP_BUSINESS) {
      // CORREÇÃO TS2554: Passar todos os 10 argumentos esperados na ordem correta
      return new BusinessStartupService(
        data.configService,
        data.eventEmitter,
        data.prismaRepository,
        data.chatwootCache, // 4º esperado
        data.waMonitor,      // 5º esperado (this.waMonitor ou data.waMonitor)
        logger,              // 6º esperado (logger específico da instância)
        data.chatwootService,// 7º esperado
        data.cache,          // 8º esperado
        data.baileysCache,   // 9º esperado
        data.providerFiles   // 10º esperado
      );
    }

    if (instanceData.integration === Integration.EVOLUTION) {
        // CORREÇÃO: Passar todos os 7 argumentos esperados (assumindo 7)
      return new EvolutionStartupService(
        data.configService,
        data.eventEmitter,
        data.prismaRepository,
        data.chatwootCache, // 4º - OK
        // Adicionando os que faltavam conforme erro original (espera 7, recebe 4)
        data.waMonitor,      // 5º - Faltava
        logger,              // 6º - Faltava (logger específico)
        data.chatwootService // 7º - Faltava
      );
    }

    if (instanceData.integration === Integration.WHATSAPP_BAILEYS) {
        // CORREÇÃO TS2554: Passar os 8 ou 9 argumentos esperados
      return new BaileysStartupService(
        data.configService,
        data.eventEmitter,
        data.prismaRepository,
        data.cache,
        data.chatwootCache,    // 5º - OK
        data.baileysCache,     // 6º - OK
        data.providerFiles,    // 7º - OK
        data.waMonitor,        // 8º - Faltava (this.waMonitor ou data.waMonitor)
        instanceData           // 9º - Faltava (instanceDto)
      );
    }

    logger.warn(`Tipo de integração desconhecido ou não suportado: ${instanceData.integration}`);
    return null; // Retorna null se a integração não for reconhecida
  }
}

// Remover chave extra no final se houver
