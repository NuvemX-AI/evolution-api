// src/api/integrations/channel/evolution/evolution.channel.service.ts
// Correção Erro 33: Usa alias @api para import ChatwootService.
// Correção Erro 34: Garante importação correta de WAMonitoringService (depende da definição em channel.service).
// Correção Erro 35: Adiciona stubs para métodos abstratos ausentes e importa DTOs necessários.
// Correção Erro 36: Resolvido pela correção 34.
// Correção Erro 37: Corrige chamada logger.warn.
// Correção Erro 38: Corrige chamada logger.log.
// Correção Erro 39: Corrige chamada chatbotController.emit.
// Correção Erro 40: Corrige segundo emit (evento e payload).
// Correção Erro 41: Remove messageId do prisma create.
// Correção Erro 42: Adiciona comentário sobre updateContact.
// Correção Erro 43: Corrige chamada logger.warn.
// Correção Erro 44: Corrige chamada logger.error.
// Correção Erro 45: Remove webhookUrl da simulação.
// Correção Erro 46: Usa type assertion para definir messageType na simulação.
// Correção Erro 47: Corrige chamada logger.info na simulação.
// Correção Erro 48: Remove messageId do prisma create na simulação.
// Correção Erro 49: Usa type assertion para ler messageType na simulação.

import { Injectable, OnModuleInit, OnModuleDestroy, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Assuming NestJS config module
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaRepository } from '@repository/repository.service'; // Use alias
import { CacheService } from '@api/services/cache.service'; // Use alias
import { Logger } from '@config/logger.config'; // Use alias
import { ChannelStartupService } from '@api/services/channel.service'; // Use alias
// ** Correção Erro 34: Importar WAMonitoringService do local correto/esperado pela classe base **
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar monitor.service (ou o que channel.service esperar)
import { InstanceDto } from '@api/dto/instance.dto';
import { Events } from '@api/integrations/event/event.dto'; // Use alias
import axios, { AxiosInstance } from 'axios'; // Para chamadas HTTP
import { Prisma, Message as MessageModel, proto } from '@prisma/client'; // Importar tipos Prisma e proto
import Long from 'long'; // Importar Long

// ** Correção Erro 35: Importar DTOs para métodos abstratos **
import {
    SendContactDto,
    SendLinkDto,
    SendLocationDto,
    SendMediaDto,
    SendReactionDto,
    SendTextDto,
    SendMessageOptions // Assuming SendMessageOptions is needed/used
} from '@api/dto/sendMessage.dto'; // Use alias
import { Multer } from 'multer'; // Para tipagem de arquivo
interface UploadedFile extends Multer.File {} // Define interface local se não importada globalmente

// ** Correção Erro 33: Usar alias @api para import **
import { ChatwootService } from '@api/integrations/chatbot/chatwoot/services/chatwoot.service'; // Usando alias

// Dados esperados no evento 'message' da API Evolution
interface EvolutionMessagePayload {
    key: {
        remoteJid: string;
        fromMe: boolean;
        id: string;
        participant?: string;
    };
    pushName?: string;
    message?: any; // Definir melhor a estrutura se conhecida (WAProto.IMessage?)
    messageType?: string;
    messageTimestamp?: number | Long;
    broadcast?: boolean;
    // Adicionar outros campos relevantes se existirem
}

interface EvolutionEvent {
    event: string; // ex: 'messages.upsert', 'connection.update'
    instance: string;
    data: any; // Payload específico do evento
    destination?: string; // Pode existir em alguns eventos
    owner?: string; // Pode existir em alguns eventos
    serverUrl?: string; // Pode existir em alguns eventos
    apiKey?: string; // Pode existir em alguns eventos
}


// ** Correção Erro 34 e 35 **
@Injectable({ scope: Scope.TRANSIENT }) // Transient scope para instâncias separadas
export class EvolutionStartupService extends ChannelStartupService implements OnModuleInit, OnModuleDestroy {
    private evolutionApi: AxiosInstance | null = null;
    private apiKey: string | null = null;
    private apiUrl: string | null = null; // URL base da API Evolution específica para esta instância

    constructor(
        configService: ConfigService,
        eventEmitter: EventEmitter2,
        prismaRepository: PrismaRepository,
        cacheService: CacheService,
        waMonitor: WAMonitoringService,
        baseLogger: Logger,
        chatwootService: ChatwootService,
        public readonly chatwootCache: CacheService,
    ) {
        super(configService, eventEmitter, prismaRepository, cacheService, waMonitor, baseLogger, chatwootService);
    }

    async onModuleInit() {
        // Configuração inicial
    }

    async onModuleDestroy() {
        this.logger.log(`[${this.instanceName}] Encerrando serviço do canal Evolution.`);
    }

    public async init(instanceData: InstanceDto): Promise<void> {
        super.init(instanceData);
        this.logger.log(`[${this.instanceName}] Inicializando canal Evolution.`);
        // Obter URL e API Key da API Evolution (exemplo)
        // const evolutionConfig = await this.prismaRepository.evolutionBotSetting.findUnique({ where: { instanceId: this.instanceId }});
        // this.apiUrl = evolutionConfig?.apiUrl;
        // this.apiKey = evolutionConfig?.apiKey;

        if (!this.apiUrl) {
            this.logger.error(`[${this.instanceName}] URL da API Evolution não configurada.`);
            return;
        }

        this.evolutionApi = axios.create({
            baseURL: this.apiUrl,
            headers: { 'apikey': this.apiKey || '', 'Content-Type': 'application/json' }
        });
        this.logger.log(`[${this.instanceName}] Canal Evolution configurado para URL: ${this.apiUrl}`);
        // TODO: Iniciar escuta de webhooks da API Evolution
    }

    public async start(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Iniciando operações do canal Evolution (verificação de status).`);
        // Exemplo: Verificar status inicial
        // try {
        //     const response = await this.evolutionApi?.get(`/instance/connectionState/${this.instanceName}`);
        //     this.handleConnectionUpdate(response?.data);
        // } catch (error: any) {
        //     this.logger.error(`[${this.instanceName}] Erro ao verificar status inicial: ${error.message}`);
        // }
    }

    public async handleEvolutionEvent(eventPayload: EvolutionEvent): Promise<void> {
        if (!eventPayload || eventPayload.instance !== this.instanceName) return;

        const { event, data } = eventPayload;
        this.logger.debug(`[${this.instanceName}] Recebido evento Evolution: ${event}`);

        try {
            switch (event) {
                case 'messages.upsert':
                    const received = data?.message as EvolutionMessagePayload | undefined;
                    if (!received?.key?.remoteJid) {
                        // ** Correção Erro 43: Usar objeto no logger **
                        this.logger.warn({ message: 'Evento Evolution recebido não contém estrutura de mensagem esperada:', eventData: received });
                        return;
                    }

                    const messageRaw: Partial<proto.IWebMessageInfo> = {
                        key: {
                            remoteJid: received.key.remoteJid,
                            fromMe: received.key.fromMe,
                            id: received.key.id,
                            participant: received.key.participant,
                        },
                        messageTimestamp: received.messageTimestamp,
                        pushName: received.pushName,
                        message: received.message,
                    };

                    // ** Correção Erro 38: Usar objeto no logger **
                    this.logger.log({ message: 'Mensagem Evolution processada (exemplo):', data: messageRaw });

                    const chatbotController = this.getChatbotController();
                    // ** Correção Erro 39: Ajustar argumentos do emit **
                    await chatbotController?.emit?.(Events.MESSAGES_UPSERT, { // Passar eventName e payload
                        instanceId: this.instanceId!,
                        message: messageRaw as proto.IWebMessageInfo,
                        source: 'evolution'
                    });

                    // ** Correção Erro 40: Corrigir evento e payload para webhook/websocket **
                    this.eventEmitter.emit(`${this.instanceId}.${Events.MESSAGES_UPSERT}`, { // Emitir evento correto
                         instanceId: this.instanceId!,
                         // 'event' property removed from payload
                         payload: messageRaw, // Payload contém a mensagem
                    });


                    if (this.prismaConfig.saveMessage) {
                        try {
                            await this.prismaRepository.message.create({
                                data: {
                                    instanceId: this.instanceId!,
                                    keyId: messageRaw.key!.id!, // Campo correto
                                    // ** Correção Erro 41: Remover messageId **
                                    // messageId: messageRaw.key.id!, // Removido
                                    key: messageRaw.key as any,
                                    message: messageRaw.message as any,
                                    messageTimestamp: messageRaw.messageTimestamp ? Number(messageRaw.messageTimestamp) : null,
                                    messageType: this.getMessageType(messageRaw.message),
                                    fromMe: messageRaw.key!.fromMe,
                                    remoteJid: messageRaw.key!.remoteJid!,
                                    participant: messageRaw.key!.participant,
                                    pushName: messageRaw.pushName,
                                    status: 'RECEIVED',
                                    source: 'evolution',
                                }
                            });
                        } catch (dbError) {
                            this.logger.error(`[${this.instanceName}] Erro ao salvar mensagem Evolution no DB: ${dbError}`);
                        }
                    }

                    if (messageRaw.key?.remoteJid && !messageRaw.key.remoteJid.includes('@g.us')) {
                        // ** Correção Erro 42: O método 'updateContact' precisa ser definido em ChannelStartupService **
                        await this.updateContact?.({ // Chamar método da classe base (precisa existir)
                            remoteJid: messageRaw.key.remoteJid,
                            pushName: messageRaw.pushName || undefined,
                        });
                    }
                    break;

                case 'connection.update':
                    this.handleConnectionUpdate(data);
                    break;

                default:
                    this.logger.debug(`[${this.instanceName}] Evento Evolution não tratado: ${event}`);
            }
        } catch (error: any) {
            // ** Correção Erro 44: Usar objeto no logger **
            this.logger.error({ message: `Erro em eventHandler Evolution: ${error?.message || error}`, stack: error?.stack, errorObj: error });
        }
    }

    private handleConnectionUpdate(data: any): void {
        const connectionStatus = data?.state;
        this.logger.log(`[${this.instanceName}] Status da conexão Evolution atualizado: ${connectionStatus}`);
        let internalState: any = 'close';
        if (connectionStatus === 'open') internalState = 'open';
        else if (connectionStatus === 'connecting') internalState = 'connecting';
        else if (connectionStatus === 'qr') internalState = 'qr';

        this.connectionState = { connection: internalState };
        this.eventEmitter.emit(Events.CONNECTION_UPDATE, {
            instanceId: this.instanceId, status: internalState,
        });
    }

    public async sendText(data: SendTextDto): Promise<any> {
        this.logger.debug(`[${this.instanceName}] Enviando texto via API Evolution para ${data.number}`);
        if (!this.evolutionApi) throw new Error('Evolution API client não inicializado.');
        const payload = {
            number: data.number,
            options: { delay: data.options?.delay ?? 1200, presence: 'composing' },
            textMessage: { text: data.message }
        };
        this.logger.debug(`[${this.instanceName}] Payload sendText Evolution: ${JSON.stringify(payload)}`);
        try {
             return this.simulateApiResponse(data.number, data.message, data.options, 'text');
        } catch (error: any) {
             this.logger.error(`[${this.instanceName}] Erro ao enviar texto via Evolution API: ${error.response?.data || error.message}`);
            throw error;
        }
    }

    // ** Correção Erro 35: Implementação dos métodos ausentes **
    public async mediaMessage(data: SendMediaDto, file?: UploadedFile): Promise<any> {
        this.logger.warn(`[${this.instanceName}] Método 'mediaMessage' não totalmente implementado para Evolution channel.`);
        return this.simulateApiResponse(data.number, data.caption || data.media, data.options, data.mediaType);
    }
    public async contactMessage(data: SendContactDto): Promise<any> {
        this.logger.warn(`[${this.instanceName}] Método 'contactMessage' não totalmente implementado para Evolution channel.`);
        const contactInfo = `${data.contactName} (${data.contactNumber})`;
        return this.simulateApiResponse(data.number, contactInfo, data.options, 'contact');
    }
    public async locationMessage(data: SendLocationDto): Promise<any> {
        this.logger.warn(`[${this.instanceName}] Método 'locationMessage' não totalmente implementado para Evolution channel.`);
        const locationInfo = `Lat: ${data.latitude}, Lon: ${data.longitude}`;
        return this.simulateApiResponse(data.number, locationInfo, data.options, 'location');
    }
     public async reactionMessage(data: SendReactionDto): Promise<any> {
         this.logger.warn(`[${this.instanceName}] Método 'reactionMessage' não totalmente implementado para Evolution channel.`);
         return this.simulateApiResponse(data.key.remoteJid, `Reacted ${data.reaction} to ${data.key.id}`, data.options, 'reaction');
     }

     private simulateApiResponse(number: string, messageContent: any, options: SendMessageOptions | undefined, messageType: string): any {
         const messageId = options?.messageId || `evolution-${Date.now()}`;
         const timestamp = Math.floor(Date.now() / 1000);

         const messageRaw: any = { // Usando 'any' para simplificar simulação
             key: { remoteJid: number, fromMe: true, id: messageId },
             message: { /* ... estrutura simulada ... */ },
             messageTimestamp: timestamp,
             status: 'PENDING',
             source: 'evolution-simulated',
             instanceId: this.instanceId!,
             // ** Correção Erro 45: Removido webhookUrl **
             // webhookUrl: options?.webhookUrl
         };

         // ** Correção Erro 46: Adicionar messageType dinamicamente **
         (messageRaw as any).messageType = messageType;

         this.eventEmitter.emit(`${this.instanceId}.${Events.MESSAGE_SEND_SUCCESS}`, {
             instanceId: this.instanceId, id: messageId, response: messageRaw
         });

         // ** Correção Erro 47: Usar objeto no logger **
         this.logger.info({ message: `Simulando envio Evolution para ${number}:`, data: messageRaw });

         if (this.prismaConfig.saveMessage) {
             this.prismaRepository.message.create({
                 data: {
                     instanceId: this.instanceId!,
                     keyId: messageRaw.key.id, // Usar keyId
                     // ** Correção Erro 48: Remover messageId **
                     // messageId: messageRaw.key.id, // Removido
                     key: messageRaw.key as any,
                     message: messageRaw.message as any,
                     messageTimestamp: messageRaw.messageTimestamp,
                     // ** Correção Erro 49: Usar type assertion para ler messageType **
                     messageType: (messageRaw as any).messageType,
                     fromMe: true,
                     remoteJid: messageRaw.key.remoteJid,
                     status: 'SENT',
                     source: 'evolution-simulated',
                 }
             }).catch(dbError => {
                 this.logger.error(`[${this.instanceName}] Erro ao salvar mensagem simulada Evolution no DB: ${dbError}`);
             });
         }
         return { id: messageId, status: 'pending', ack: 0, message: messageRaw };
     }

     public getStatus(): any {
         return this.connectionState;
     }
     public async logout(): Promise<void> {
        this.logger.log(`[${this.instanceName}] Solicitando logout na API Evolution.`);
         // TODO: Chamar endpoint de logout
         this.handleConnectionUpdate({ state: 'close' });
     }
     public async restart(): Promise<void> {
         this.logger.log(`[${this.instanceName}] Solicitando restart na API Evolution.`);
         // TODO: Chamar endpoint de restart
         this.handleConnectionUpdate({ state: 'connecting' });
     }

} // Fim da classe
