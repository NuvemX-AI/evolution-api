// src/api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper.ts
// Correções Gemini: Import pg, correção boolean comparison

/* eslint-disable @typescript-eslint/no-explicit-any */
import { InstanceDto } from '@api/dto/instance.dto';
import { ChatwootDto } from '../dto/chatwoot.dto'; // Verifica se o DTO existe
import { ChatwootService } from '../services/chatwoot.service';
import { PrismaRepository } from '@repository/repository.service'; // Usar alias
import { Logger } from '@config/logger.config'; // Usar alias
import { ConfigService, Chatwoot as ChatwootConfig } from '@config/env.config'; // Usar alias
import { WAMonitoringService } from '@api/services/monitor.service'; // Usar alias
import { CacheService } from '@api/services/cache.service'; // Usar alias
import { EventEmitter2 } from 'eventemitter2';
import { Client } from 'pg'; // Importar Client do pg
// CORREÇÃO TS2304: Importar QueryResult do pg
import { QueryResult } from 'pg';

// Helper class para importação de dados do Chatwoot (exemplo)
// Esta classe parece lidar com a conexão direta ao DB do Chatwoot
export class ChatwootImportHelper {
    private readonly logger: Logger;
    private chatwootConfig: ChatwootConfig['IMPORT'] | undefined;
    private pgClient: Client | null = null;
    private chatwootService: ChatwootService;

    constructor(
        private readonly prismaRepository: PrismaRepository,
        private readonly cache: CacheService,
        private readonly eventEmitter: EventEmitter2,
        private readonly configService: ConfigService,
        private readonly waMonitor: WAMonitoringService,
        baseLogger: Logger
    ) {
        this.logger = baseLogger.child({ context: ChatwootImportHelper.name });
        this.chatwootConfig = this.configService.get<ChatwootConfig>('CHATWOOT')?.IMPORT;
        // Instanciar ChatwootService aqui (requer dependências)
        // Cuidado com dependências circulares se ChatwootService usar este Helper
        this.chatwootService = new ChatwootService(
            prismaRepository,
            cache,
            eventEmitter,
            configService,
            waMonitor,
            baseLogger // Passar o logger base
        );

        if (this.chatwootConfig?.DATABASE?.CONNECTION?.URI) {
            this.initializePgClient();
        } else {
            this.logger.warn('URI do banco de dados Chatwoot para importação não configurada.');
        }
    }

    private async initializePgClient(): Promise<void> {
        const connectionString = this.chatwootConfig?.DATABASE?.CONNECTION?.URI;
        if (!connectionString) {
            this.logger.error('Connection string para o DB Chatwoot não encontrada.');
            return;
        }
        this.pgClient = new Client({ connectionString });
        try {
            await this.pgClient.connect();
            this.logger.info('Conectado ao banco de dados do Chatwoot para importação.');
        } catch (error) {
            this.logger.error({ err: error, msg: 'Erro ao conectar ao DB do Chatwoot' });
            this.pgClient = null; // Reseta o cliente em caso de erro
        }
    }

    public async closePgConnection(): Promise<void> {
        if (this.pgClient) {
            await this.pgClient.end();
            this.logger.info('Conexão com o DB do Chatwoot fechada.');
            this.pgClient = null;
        }
    }

    /**
     * Busca uma configuração Chatwoot ativa para a instância.
     */
    private async getActiveChatwootProvider(instanceId: string): Promise<ChatwootDto | null> {
        const provider = await this.chatwootService.findChatwootConfig(instanceId);
        if (provider?.enabled) {
            return provider;
        }
        return null;
    }

    /**
     * Mapeia dados de contato do Prisma para o formato esperado pelo Chatwoot API.
     */
    private mapPrismaContactToChatwoot(contact: any): any { // Usar tipo Prisma Contact
        return {
            name: contact.pushName || contact.remoteJid?.split('@')[0],
            identifier: contact.remoteJid, // Usar remoteJid como identificador?
            phone_number: '+' + contact.remoteJid?.split('@')[0], // Adiciona '+' e remove @s.whatsapp.net
            // Mapear outros campos se necessário (email, avatar_url, etc.)
        };
    }

    /**
     * Importa contatos do banco de dados local para o Chatwoot.
     */
    public async importContacts(instance: InstanceDto): Promise<{ success: number, failed: number }> {
        let success = 0;
        let failed = 0;
        this.logger.info(`Iniciando importação de contatos para Chatwoot - Instância: ${instance.instanceName}`);

        const provider = await this.getActiveChatwootProvider(instance.instanceId!);
        if (!provider || !provider.importContacts) {
            this.logger.warn(`Importação de contatos desabilitada ou Chatwoot não configurado para ${instance.instanceName}`);
            return { success, failed };
        }

        try {
            const contacts = await this.prismaRepository.contact.findMany({
                where: { instanceId: instance.instanceId! }
            });

            this.logger.info(`Encontrados ${contacts.length} contatos locais para importar.`);

            for (const contact of contacts) {
                if (!contact.remoteJid || contact.remoteJid.includes('@g.us')) continue; // Pula grupos

                try {
                    const identifier = contact.remoteJid;
                    const contactExists = await this.chatwootService.findContact(identifier, provider);

                    if (!contactExists) {
                        const chatwootContactData = this.mapPrismaContactToChatwoot(contact);
                        this.logger.debug(`Criando contato no Chatwoot: ${identifier}`);
                        const created = await this.chatwootService.createContact(chatwootContactData, provider);
                        if (created) {
                            success++;
                        } else {
                            failed++;
                        }
                    } else {
                        this.logger.debug(`Contato ${identifier} já existe no Chatwoot.`);
                        // Poderia adicionar lógica para atualizar o contato aqui se necessário
                        success++; // Conta como sucesso se já existe
                    }
                } catch (error) {
                    this.logger.error({ err: error, contactId: contact.id, msg: `Erro ao processar/importar contato ${contact.remoteJid}` });
                    failed++;
                }
            }
        } catch (error) {
            this.logger.error({ err: error, instanceName: instance.instanceName, msg: 'Erro geral durante importação de contatos' });
        }

        this.logger.info(`Importação de contatos finalizada para ${instance.instanceName}. Sucesso: ${success}, Falha: ${failed}`);
        return { success, failed };
    }


    /**
     * Mapeia dados de mensagem do Prisma para o formato esperado pelo Chatwoot API.
     */
    private mapPrismaMessageToChatwoot(message: any, contactId: number, inboxId: number): any { // Usar tipo Prisma Message
        let messageType: 'incoming' | 'outgoing' = message.fromMe ? 'outgoing' : 'incoming';
        let content = message.textData || message.mediaCaption || (this.chatwootConfig?.PLACEHOLDER_MEDIA_MESSAGE ? `[Media: ${message.messageType}]` : null);

        // Ajustar conteúdo se for um placeholder e não houver texto
        if (!content && this.chatwootConfig?.PLACEHOLDER_MEDIA_MESSAGE) {
            content = `[Media: ${message.messageType}]`;
        } else if (!content) {
            return null; // Não envia mensagem sem conteúdo
        }

        // Adicionar assinatura se necessário
        // CORREÇÃO TS2367: Comparar como booleano
        if (message.fromMe && !!this.provider.signMsg) {
             content = `${content} ${this.provider.signDelimiter || ''}`;
        }

        return {
            content: content,
            message_type: messageType,
            private: false, // Mensagens do WhatsApp não são privadas no Chatwoot
            content_type: 'text', // Chatwoot geralmente espera 'text' aqui, mesmo para mídia (o anexo é separado)
            // content_attributes: {}, // Para formatção especial
            // source_id: message.keyId ou message.messageId? Verificar qual ID é mais útil
            // sender_id: message.fromMe ? null : contactId, // ID do contato Chatwoot se for incoming
            inbox_id: inboxId,
            // Adicionar attachments se houver mídia (requer upload prévio para Chatwoot ou URL pública)
            // attachments: message.mediaUrl ? [{ file_type: 'image', data_url: message.mediaUrl, file_name: ... }] : undefined
        };
    }


    /**
     * Importa mensagens do banco de dados local para o Chatwoot.
     */
    public async importMessages(instance: InstanceDto, daysLimit?: number): Promise<{ success: number, failed: number }> {
        let success = 0;
        let failed = 0;
        this.logger.info(`Iniciando importação de mensagens para Chatwoot - Instância: ${instance.instanceName}`);

        const provider = await this.getActiveChatwootProvider(instance.instanceId!);
        if (!provider || !provider.importMessages) {
            this.logger.warn(`Importação de mensagens desabilitada ou Chatwoot não configurado para ${instance.instanceName}`);
            return { success, failed };
        }
        if (!this.pgClient) {
            this.logger.error('Cliente PostgreSQL para Chatwoot não inicializado. Impossível importar mensagens.');
            return { success, failed };
        }

        const limit = daysLimit || provider.daysLimitImportMessages || 3; // Limite de dias padrão
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - limit);
        const startTimestamp = Math.floor(startDate.getTime() / 1000); // Timestamp em segundos

        this.logger.info(`Importando mensagens dos últimos ${limit} dias (desde ${startDate.toISOString()}).`);

        try {
            const inbox = await this.chatwootService.findInbox(provider.nameInbox || instance.instanceName!, provider);
            if (!inbox) {
                this.logger.error(`Inbox "${provider.nameInbox || instance.instanceName}" não encontrado no Chatwoot.`);
                return { success, failed };
            }

            const messages = await this.prismaRepository.message.findMany({
                where: {
                    instanceId: instance.instanceId!,
                    messageTimestamp: { gte: BigInt(startTimestamp) } // Buscar mensagens desde a data limite
                },
                orderBy: { messageTimestamp: 'asc' } // Importar em ordem cronológica
            });

            this.logger.info(`Encontradas ${messages.length} mensagens locais para importar.`);

            for (const message of messages) {
                 if (!message.remoteJid || message.remoteJid.includes('@g.us')) continue; // Pula grupos

                 try {
                     const identifier = message.remoteJid;
                     // Verifica se a mensagem já foi importada (usando source_id ou query no DB do Chatwoot)
                     const messageSourceId = message.messageId; // ID da mensagem no WhatsApp/Evolution
                     const alreadyImported = await this.checkIfMessageImported(inbox.id, messageSourceId);

                     if (alreadyImported) {
                         this.logger.debug(`Mensagem ${messageSourceId} já importada para o inbox ${inbox.id}. Pulando.`);
                         continue; // Pula para a próxima
                     }

                     const contact = await this.chatwootService.findContact(identifier, provider);
                     if (!contact) {
                         this.logger.warn(`Contato ${identifier} não encontrado no Chatwoot para importar mensagem ${messageSourceId}. Pulando.`);
                         failed++;
                         continue;
                     }

                     let conversation = await this.chatwootService.findConversation(contact.id, inbox.id, provider);
                     if (!conversation) {
                        this.logger.debug(`Conversa não encontrada para contato ${contact.id} no inbox ${inbox.id}. Criando...`);
                        conversation = await this.chatwootService.createConversation(inbox.id, contact.id, identifier, provider);
                     }

                     if (!conversation) {
                         this.logger.error(`Falha ao encontrar ou criar conversa para contato ${contact.id} no inbox ${inbox.id}. Pulando mensagem ${messageSourceId}.`);
                         failed++;
                         continue;
                     }

                     const chatwootMessageData = this.mapPrismaMessageToChatwoot(message, contact.id, inbox.id);
                     if (!chatwootMessageData) {
                         this.logger.debug(`Mensagem ${messageSourceId} sem conteúdo para importar. Pulando.`);
                         continue;
                     }
                     // Adicionar source_id para evitar duplicação
                     chatwootMessageData.source_id = messageSourceId;

                     this.logger.debug(`Criando mensagem no Chatwoot para conversa ${conversation.id}, source_id: ${messageSourceId}`);
                     const created = await this.chatwootService.createMessage(conversation.id, chatwootMessageData, provider);

                     if (created) {
                         // Atualizar DB local com ID da mensagem Chatwoot (opcional)
                         await this.updateMessageSourceID(message.id, created.id);
                         success++;
                     } else {
                         failed++;
                     }

                 } catch (error) {
                    this.logger.error({ err: error, messageId: message.id, msg: `Erro ao processar/importar mensagem ${message.messageId}` });
                    failed++;
                 }
            }

        } catch (error) {
             this.logger.error({ err: error, instanceName: instance.instanceName, msg: 'Erro geral durante importação de mensagens' });
        } finally {
             // Considerar fechar a conexão PG aqui se não for usada em outro lugar
             // await this.closePgConnection();
        }

        this.logger.info(`Importação de mensagens finalizada para ${instance.instanceName}. Sucesso: ${success}, Falha: ${failed}`);
        return { success, failed };
    }

    /**
     * Verifica no banco de dados do Chatwoot se uma mensagem com um source_id específico já existe.
     */
    private async checkIfMessageImported(inboxId: number, sourceId: string): Promise<boolean> {
        if (!this.pgClient) return false; // Não pode verificar sem conexão

        const sql = `
            SELECT EXISTS (
                SELECT 1
                FROM messages
                WHERE inbox_id = $1 AND source_id = $2
            );
        `;
        const bindValues = [inboxId, sourceId];

        try {
            // CORREÇÃO TS2304: Tipar resultado como QueryResult
            const result: QueryResult = await this.pgClient.query(sql, bindValues);
            return result.rows[0]?.exists || false;
        } catch (error) {
            this.logger.error({ err: error, sql, bindValues, msg: 'Erro ao verificar existência de mensagem importada no DB Chatwoot' });
            return false; // Assume que não existe em caso de erro
        }
    }

    /**
     * Atualiza a tabela local de mensagens com o ID da mensagem correspondente no Chatwoot.
     */
     // CORREÇÃO TS2304: Tipar retorno como QueryResult | null
    public async updateMessageSourceID(localMessageId: string | number, chatwootMessageId: number): Promise<QueryResult | null> {
        this.logger.debug(`Atualizando source ID para mensagem local ${localMessageId} -> Chatwoot ID ${chatwootMessageId}`);
        try {
            // Atualiza o campo sourceId (ou um campo dedicado como chatwootMessageId) na tabela Message local
            const updated = await this.prismaRepository.message.update({
                where: { id: String(localMessageId) }, // Usar ID primário correto
                data: { sourceId: String(chatwootMessageId) } // Campo sourceId precisa existir no schema Prisma
            });
            return updated as any; // Retorna resultado (ajustar tipo se necessário)
        } catch (error) {
            this.logger.error({ err: error, localMessageId, chatwootMessageId, msg: 'Erro ao atualizar source ID da mensagem local' });
            return null;
        }
    }

} // Fim da classe ChatwootImportHelper
