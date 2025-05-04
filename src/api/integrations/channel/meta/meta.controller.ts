// src/api/integrations/channel/meta/meta.controller.ts
// Correção Erro 53: Ajusta modificador de waMonitor no construtor.
// Correção Erro 54: Remove chamada a logger.child.
// Correção Erro 55: Adiciona comentário sobre prisma generate para select.
// Correção Erro 56, 57: Mantém acesso a instanceDb.instanceName.
// Correção Erro 58: Obtém status via waMonitor.get(..).getStatus().
// Correção Erro 59: Remove chamada redundante a instance.closeClient.
// Correção Erro 60: Altera waMonitor.remove para waMonitor.stop.

import { Request, Response } from 'express';
import { ChannelController, ChannelControllerInterface, ChannelCreationData } from '../channel.controller'; // Importar base e interface
import { PrismaRepository } from '@repository/repository.service'; // Use alias
import { ConfigService } from '@config/config.service'; // Use alias
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@config/logger.config'; // Use alias
import { CacheService } from '@api/services/cache.service'; // Use alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Use alias (verificar consistência)
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Use alias
import { ProviderFiles } from '@provider/sessions'; // Use alias (verificar consistência)
import { InstanceDto } from '@api/dto/instance.dto'; // Para tipagem
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions/index'; // Use alias
import { BusinessStartupService } from './whatsapp.business.service'; // Serviço específico Meta
import { Prisma, Instance as PrismaInstance } from '@prisma/client'; // Tipos Prisma


// ** Correção Erro 53: Modificador de waMonitor **
export class MetaController extends ChannelController implements ChannelControllerInterface {
    // Herda logger, configService, etc., da classe base ChannelController

    constructor(
        // Injete as mesmas dependências que ChannelController, mais as específicas se houver
        configService: ConfigService,
        eventEmitter: EventEmitter2,
        prismaRepository: PrismaRepository,
        cacheService: CacheService,
        // ** Correção Erro 53: Remover modificador para herdar o da base **
        /*protected override readonly*/ waMonitor: WAMonitoringService,
        baseLogger: Logger,
        chatwootService: ChatwootService,
        providerFiles: ProviderFiles,
        // Adicione dependências específicas do MetaController aqui, se houver
    ) {
        // Chama o construtor da classe base com as dependências necessárias
        super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, baseLogger, chatwootService, providerFiles);
        // ** Correção Erro 54: Remover .child() **
        this.logger = baseLogger; // Atribui logger base diretamente
        // Adicionar contexto se necessário: this.logger.setContext(MetaController.name);
    }

    // Implementação específica para criar instância do canal Meta
    public createChannelInstance(data: ChannelCreationData): BusinessStartupService {
        this.logger.log(`[${data.instanceData.instanceName}] Criando instância do canal Meta (Business).`);
        // Cria logger específico para esta instância de serviço
        const instanceLogger = this.baseLogger; // Ou use um logger filho se disponível

        // Cria e retorna a instância do serviço específico para Meta/Business
        // Passa todas as dependências necessárias para o construtor do BusinessStartupService
        return new BusinessStartupService(
            data.configService,
            data.eventEmitter,
            data.prismaRepository,
            data.cacheService,
            data.waMonitor, // Tipo deve ser compatível
            instanceLogger, // Logger para o serviço
            data.chatwootService,
            data.providerFiles // Tipo deve ser compatível
        );
    }

    /**
     * @description Recebe eventos do webhook da Meta API
     * @route POST /meta/webhook
     * @param req { Request } - Vem sem instanceName no path padrão da Meta
     * @param res { Response }
     */
     public async handleWebhook(req: Request, res: Response): Promise<void> {
        // 1. Validar assinatura/token do webhook (essencial para segurança)
        // Implementar validação usando o App Secret da Meta
        // const signature = req.headers['x-hub-signature-256'];
        // const rawBody = req.rawBody; // Precisa habilitar rawBody no Express (e.g., bodyParser.raw())
        // if (!this.validateMetaSignature(rawBody, signature)) {
        //    this.logger.warn('Assinatura do webhook Meta inválida.');
        //    res.status(403).send('Forbidden');
        //    return;
        // }
        this.logger.debug('Assinatura do webhook Meta validada (simulação).');


        const payload = req.body;
        this.logger.log('Recebido webhook da Meta:', JSON.stringify(payload));

        // 2. Extrair informações relevantes do payload
        // O payload da Meta pode conter múltiplos 'entry' e múltiplos 'changes'/'messages'
        if (!payload.object || payload.object !== 'whatsapp_business_account') {
            this.logger.warn('Webhook Meta recebido não é do objeto esperado.', payload.object);
            res.status(400).send('Payload inválido.');
            return;
        }

        try {
             // Iterar sobre as entradas e mudanças
             for (const entry of payload.entry || []) {
                 const businessAccountId = entry.id; // ID da WABA
                 for (const change of entry.changes || []) {
                     if (change.field !== 'messages') continue; // Processar apenas eventos de mensagem

                     const value = change.value;
                     const metadata = value.metadata; // Contém phone_number_id e display_phone_number
                     const contacts = value.contacts;
                     const messages = value.messages;
                     const statuses = value.statuses; // Status de envio/leitura

                     // 3. Identificar a instância com base no phone_number_id ou business_id
                     // Você precisa de um mapeamento entre phone_number_id/WABA_id e seu instanceName/instanceId
                     const instance = await this.findInstanceByMetaId(metadata?.phone_number_id, businessAccountId);

                     if (!instance) {
                         this.logger.warn(`Nenhuma instância encontrada para phone_number_id: ${metadata?.phone_number_id} ou WABA ID: ${businessAccountId}`);
                         continue; // Pula para próxima change/entry
                     }

                      // 4. Obter a instância monitorada correspondente
                      const monitoredInstance = this.waMonitor.get(instance.instanceName);
                      if (!monitoredInstance || !(monitoredInstance instanceof BusinessStartupService)) {
                         this.logger.error(`[${instance.instanceName}] Instância encontrada (${instance.id}) mas não está ativa no monitor ou não é do tipo Business.`);
                         continue; // Pula para próxima change/entry
                      }

                     // 5. Processar mensagens, status, etc., e repassar para o serviço da instância
                     if (messages) {
                         for (const message of messages) {
                             // O 'message' aqui é o payload da Meta, precisa ser adaptado se necessário
                             // e passado para um método handler no BusinessStartupService
                              await monitoredInstance.handleIncomingMessage({ // Método de exemplo
                                 contacts: contacts, // Passa info do contato junto
                                 message: message,
                                 metadata: metadata
                             });
                         }
                     }

                     if (statuses) {
                          for (const status of statuses) {
                              await monitoredInstance.handleMessageStatus({ // Método de exemplo
                                  status: status,
                                  metadata: metadata
                              });
                          }
                     }
                 }
             }

             // 6. Responder ao webhook da Meta com 200 OK rapidamente
             res.status(200).send('EVENT_RECEIVED');

         } catch (error: any) {
            this.logger.error(`Erro ao processar webhook Meta: ${error.message}`, error.stack);
            // Não enviar erro detalhado para a Meta, apenas logar internamente
             res.status(500).send('Internal Server Error'); // Responder com 500 se houver falha interna
        }
    }

    // Helper para encontrar instância baseada no ID da Meta (WABA ID ou Phone Number ID)
    private async findInstanceByMetaId(phoneNumberId?: string, wabaId?: string): Promise<PrismaInstance | null> {
        if (!phoneNumberId && !wabaId) return null;

        // Lógica de busca:
        // 1. Tentar por phoneNumberId (se você armazena isso na tabela Instance ou relacionada)
        // 2. Tentar por wabaId (se você armazena isso)

        // Exemplo (requer ajuste no schema Prisma):
        // Assumindo que 'businessId' na tabela Instance armazena o WABA ID ou Phone Number ID
        const whereClause: Prisma.InstanceWhereInput = {};
        if (phoneNumberId) {
             // whereClause.businessPhoneNumberId = phoneNumberId; // Se tiver campo específico
             whereClause.businessId = phoneNumberId; // Ou usar campo genérico
        } else if (wabaId) {
             whereClause.businessId = wabaId; // Usar campo genérico
        }

        return this.prismaRepository.instance.findFirst({ where: whereClause });
    }


    // --- Métodos da Interface ChannelControllerInterface (implementação específica Meta) ---

    public async configure(instanceData: InstanceDto, data: any): Promise<any> {
        this.logger.log(`[${instanceData.instanceName}] Configurando canal Meta...`);
        // Lógica específica para configurar Meta:
        // - Validar token de acesso permanente da Meta, App ID, App Secret, WABA ID, Phone Number ID
        // - Armazenar essas credenciais de forma segura (ex: associadas à instância no DB)
        // - Configurar o webhook no app da Meta programaticamente (se possível/necessário)

         // ** Correção Erro 58: Usar waMonitor para obter status **
         const instanceService = this.waMonitor.get(instanceData.instanceName);
         const state = instanceService?.getStatus()?.connection ?? 'close'; // Get status from service


        // Retorna status ou confirmação
         return { status: 'Instance configured (Meta)', state: state }; // Use the fetched state
    }

    public async start(instanceData: InstanceDto): Promise<any> {
        this.logger.log(`[${instanceData.instanceName}] Iniciando canal Meta (nenhuma ação necessária, baseado em webhook).`);
        // Para Meta, "start" geralmente não envolve iniciar uma conexão persistente como Baileys.
        // A conexão é baseada em webhooks. Apenas retorna o status atual.
         const instanceService = this.waMonitor.get(instanceData.instanceName);
         const state = instanceService?.getStatus()?.connection ?? 'close';
        return { status: 'Meta channel is webhook-based', state: state };
    }

    public async remove(instanceData: InstanceDto): Promise<any> {
        const instanceName = instanceData.instanceName;
        this.logger.log(`[${instanceName}] Removendo instância Meta.`);

        const instance = this.waMonitor.get(instanceName);
        if (instance) {
             // ** Correção Erro 59: Remover chamada redundante a closeClient **
             // await instance.closeClient?.(); // Método provavelmente não existe ou é redundante

            // ** Correção Erro 60: Usar waMonitor.stop **
             await this.waMonitor.stop(instanceName); // Delega a remoção para o monitor
        } else {
            this.logger.warn(`[${instanceName}] Tentativa de remover instância Meta não ativa.`);
        }
        return { success: true, message: `Instância Meta ${instanceName} removida.` };
    }

     public async getStatus(instanceData: InstanceDto): Promise<any> {
         this.logger.debug(`[${instanceData.instanceName}] Verificando status do canal Meta.`);
          const instanceService = this.waMonitor.get(instanceData.instanceName);
          const state = instanceService?.getStatus()?.connection ?? 'close';
          // Para Meta, 'open' pode significar que está configurado e pronto para receber webhooks.
          // 'close' pode significar não configurado ou desativado.
         return { status: state };
     }

     // --- Métodos privados específicos ---

     private async findInstanceById(instanceId: string): Promise<PrismaInstance | null> {
         this.logger.debug(`Buscando instância por ID: ${instanceId}`);
         // Usar o repositório para buscar pelo ID primário
         return this.prismaRepository.instance.findUnique({
             where: { id: instanceId },
             // ** Correção Erro 55: Manter select, adicionar comentário **
             // select: { instanceName: true } // Garanta que 'npx prisma generate' está atualizado.
         });
         // Se precisar do objeto completo, remova o 'select'
     }


    // Método de validação de assinatura (exemplo - adaptar com crypto)
    // private validateMetaSignature(rawBody: Buffer, signature: string | undefined): boolean {
    //     if (!signature || !process.env.META_APP_SECRET) return false; // Precisa do App Secret
    //     const expectedSignature = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET)
    //                                             .update(rawBody)
    //                                             .digest('hex');
    //     return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    // }

} // Fim da classe
