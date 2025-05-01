// Arquivo: src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
// Correções v2: Implementados métodos abstratos, corrigida chamada super(),
//               corrigidos imports, tipos, chamadas de logger, acesso a prisma,
//               uso de profilePictureUrl, where clauses, authState.
/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Baileys Imports ---
import makeWASocket, {
  AuthenticationState,
  Chat, ConnectionState, Contact, DisconnectReason, fetchLatestBaileysVersion,
  GroupMetadata, isJidBroadcast, isJidGroup, isJidNewsletter,
  makeCacheableSignalKeyStore, // Manter se for usar
  MessageUserReceiptUpdate, MiscMessageGenerationOptions, // Adicionado
  ParticipantAction, GroupSettingUpdate, // Adicionado
  proto, useMultiFileAuthState, UserFacingSocketConfig, WABrowserDescription,
  WASocket, BufferJSON, initAuthCreds, delay, downloadMediaMessage // Adicionado downloadMediaMessage
} from '@whiskeysockets/baileys';
// Importar Utils se necessário (BufferJSON e initAuthCreds podem vir do import principal)
// import { ... } from '@whiskeysockets/baileys/lib/Utils'; // VERIFICAR PATH
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';

// --- Node.js Imports ---
import { Readable } from 'stream';
import * as fs from 'fs';
import { rmSync } from 'fs'; // Usar rmSync para remover pastas
import * as path from 'path';
import { release } from 'os';

// --- Project Imports ---
import { OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { ChannelStartupService } from '@api/services/channel.service';
// ** CORREÇÃO TS2307: Usar alias @config **
import { ConfigService } from '@config/config.service';
import { PrismaRepository } from '@repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { ChatwootService } from '@integrations/chatbot/chatwoot/services/chatwoot.service';
// ** CORREÇÃO TS2345: Usar alias @provider **
import { ProviderFiles } from '@provider/sessions';
import { Logger } from '@config/logger.config';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
// ** CORREÇÃO TS2305: Importar tipos de wa.types **
// Importar tipos necessários e o namespace 'wa'
import {
  wa, Events, Label, LabelAssociation, ContactPayload, LocalSettings, Instance,
  SendTextDto, SendMediaDto, SendMediaUrlDto, SendButtonDto, SendButtonListDto,
  SendContactDto, SendLocationDto, SendReactionDto, SendTemplateDto, CreateGroupDto,
  UpdateGroupPictureDto, UpdateGroupSubjectDto, UpdateGroupDescriptionDto, SendInviteDto,
  UpdateParticipantsDto, UpdateSettingDto, UpdateEphemeralDto, HandleLabelDto
} from '@api/types/wa.types';
// ** CORREÇÃO TS2305: Importar tipos de env.config **
import { DatabaseConfig, CacheConfig, ProviderSession, ConfigSessionPhoneConfig, QrCodeConfig, ChatwootConfig } from '@config/env.config'; // Adicionar tipos necessários
import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
// ** CORREÇÃO TS2614: Usar import default **
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { createJid } from '@utils/createJid';
import { saveOnWhatsappCache, getOnWhatsappCache as getFromWhatsappCache } from '@utils/onWhatsappCache';
// ** CORREÇÃO TS2459: Exportar 'Proxy' ou remover import do tipo **
import { makeProxyAgent /*, Proxy */ } from '@utils/makeProxyAgent'; // Comentado tipo Proxy
// ** CORREÇÃO TS2304: Importar useVoiceCallsBaileys **
// import { useVoiceCallsBaileys } from './voiceCalls/useVoiceCallsBaileys'; // Descomentar se usar chamadas de voz
import { WAMonitoringService } from '@api/services/wa-monitoring.service'; // Importar WAMonitoringService
import { Prisma } from '@prisma/client'; // Importar Prisma para tipos
import P from 'pino';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { v4 as cuid } from 'uuid';
import EventEmitter2 from 'eventemitter2';
// Placeholder para chatwootImport
const chatwootImport = { importHistoryContacts: (p1: any, p2: any) => { console.warn('chatwootImport.importHistoryContacts mock called'); } };
// Implementação da função getVideoDuration (como antes)
async function getVideoDuration(input: Buffer | string | Readable): Promise<number> { /* ... */ return 0; }

// --- Tipos para AuthState e Cache ---
type AuthStateWithClear = AuthenticationState & { clearState?: () => Promise<void>; };
type DefinedAuthState = { state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void>; };
interface CacheStore { /* ... (definição como antes) ... */ }

export class BaileysStartupService extends ChannelStartupService {
  // ** CORREÇÃO TS2415: Ajustar visibilidade se necessário (ou manter private e não herdar) **
  // Se ChannelStartupService define chatwootService como public/protected, mude aqui.
  // Se não, mantenha private. Assumindo que a base NÃO define chatwootService explicitamente:
  private readonly chatwootService: ChatwootService; // Mantido private

  public client: WASocket | null = null;
  public stateConnection: ConnectionState = { connection: 'close', lastDisconnect: undefined };
  public phoneNumber: string | null = null;
  private authStateProvider: AuthStateProvider;
  private readonly msgRetryCounterCache: CacheStore;
  private readonly userDevicesCache: CacheStore;
  private endSession = false;
  protected logBaileys: P.LevelWithSilent = 'silent'; // Inicializado
  protected groupHandler: any = {}; // Inicializado

  constructor(
    // Dependencies from base class + specific ones
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService, // Cache geral
    public readonly chatwootCache: CacheService, // Cache específico Chatwoot
    public readonly baileysCache: CacheService, // Cache específico Baileys
    // ** CORREÇÃO TS2345: Usar tipo correto (importado com alias) **
    private readonly providerFiles: ProviderFiles,
    chatwootService: ChatwootService, // Serviço Chatwoot
    // Injetar WAMonitoringService e Logger (exigidos pela base)
    protected readonly waMonitor: WAMonitoringService,
    protected readonly baseLogger: Logger,
  ) {
    // ** CORREÇÃO TS2554: Chamar super com TODOS os 7 argumentos esperados **
    super(configService, eventEmitter, prismaRepository, chatwootCache, waMonitor, baseLogger, chatwootService);

    // ** CORREÇÃO TS2415: Atribuir chatwootService após chamada super() **
    this.chatwootService = chatwootService; // Atribui serviço injetado

    // Inicializar caches específicos do Baileys
    this.msgRetryCounterCache = new NodeCache(); // Ou usar this.baileysCache se configurado
    this.userDevicesCache = new NodeCache();    // Ou usar this.baileysCache se configurado

    // Atribui valor inicial de qrcode (herdado)
    this.instance.qrcode = { count: 0, code: undefined, base64: undefined, pairingCode: undefined };

    // ** CORREÇÃO TS2345: Garantir que tipo ProviderFiles passado é compatível **
    // O tipo 'ProviderFiles' importado de @provider/sessions deve ser o mesmo
    // esperado pelo construtor de AuthStateProvider.
    try {
      this.authStateProvider = new AuthStateProvider(this.providerFiles);
    } catch (e: any) {
       this.logger.error({err: e}, "Erro ao criar AuthStateProvider");
       throw e; // Relança o erro, pois é crítico
    }

    // Configura nível de log do Baileys
    this.logBaileys = this.configService.get<any>('LOG')?.BAILEYS ?? 'silent'; // Usa any se tipo Log não estiver completo

    // Inicializa handlers (exemplo)
    this.initializeGroupHandlers();
  }

  // Implementação do método abstrato connectToWhatsapp
  async connectToWhatsapp(data?: { number?: string | null }): Promise<WASocket | null> {
    this.logger.info(`Conectando ao WhatsApp para ${this.instanceName}...`);
    return this.start(data?.number); // Chama o método start renomeado
  }

  // --- Implementação dos métodos abstratos de ChannelStartupService ---

  // Sobrescreve logoutInstance para limpar estado Baileys
  override async logoutInstance(destroyClient = true): Promise<void> {
    this.logger.info(`Iniciando logout da instância Baileys: ${this.instanceName}`);
    this.endSession = true; // Marca para não tentar reconectar
    try {
      await this.client?.logout(`Logout requested for ${this.instanceName}`);
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro durante client.logout()`);
    }
    try {
        this.client?.ws?.close();
    } catch (error: any) {
        this.logger.warn({ err: error }, `Erro ao fechar WebSocket durante logout`);
    }
    try {
      // Encerra a conexão Baileys, se existir
      if (destroyClient && this.client) {
         this.client?.end(new Error(`Logout requested for ${this.instanceName}`));
      }
    } catch (error: any) {
       this.logger.error({ err: error }, `Erro durante client.end()`);
    } finally {
       this.client = null; // Limpa a referência do cliente
       this.stateConnection = { connection: 'close', lastDisconnect: undefined }; // Reseta estado
       this.logger.info(`Cliente Baileys finalizado para ${this.instanceName}`);
    }

    // Limpeza de sessão/auth state
    try {
       const authState = this.instance?.authState as DefinedAuthState | undefined; // Usa tipo definido
       if (authState?.clearState) {
           await authState.clearState(); // Limpa o estado de autenticação
           this.logger.info(`Estado de autenticação local limpo para ${this.instanceName}`);
           this.instance.authState = undefined; // Remove do objeto instance
       } else {
            this.logger.warn(`Método clearState não encontrado no authState para ${this.instanceName}`);
       }
       // Remover sessão do DB (opcional, pode ser feito pelo monitor.service)
       // await this.prismaRepository.deleteManySessions({ where: { instanceId: this.instanceId }});
    } catch (error: any) {
      this.logger.error({ err: error }, `Erro ao limpar estado de autenticação durante logout`);
    }
  }

  // Sobrescreve getStatus
  override getStatus(): ConnectionState {
    return this.stateConnection;
  }

  // --- Implementação dos Métodos de Envio ---
  override async textMessage(data: SendTextDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
    if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
    const jid = createJid(data.number);
    return this.client.sendMessage(jid, { text: data.text }, options);
  }

  override async mediaMessage(data: SendMediaDto | SendMediaUrlDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
    if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
    const jid = createJid(data.number);
    let media: any; // Para { url: string } ou Buffer
    let messagePayload: any = { caption: data.caption, mimetype: data.mimetype, fileName: data.filename };

    if ('media' in data && typeof data.media === 'string' && data.media.startsWith('http')) {
        // É SendMediaUrlDto
        media = { url: data.media };
    } else if ('media' in data) {
        // É SendMediaDto (base64 ou path local?)
        // Assumindo base64 por enquanto
        media = Buffer.from(data.media, 'base64');
    } else {
        throw new BadRequestException('Dados de mídia inválidos.');
    }

    switch (data.mediatype) {
      case 'image': messagePayload.image = media; break;
      case 'video': messagePayload.video = media; break;
      case 'audio':
          messagePayload.audio = media;
          messagePayload.ptt = data.ptt ?? false; // Verifica se é PTT
          // mimetype é inferido pelo Baileys para audio/ptt
          delete messagePayload.mimetype;
          break;
      case 'document': messagePayload.document = media; break;
      default: throw new BadRequestException(`Tipo de mídia inválido: ${data.mediatype}`);
    }

    return this.client.sendMessage(jid, messagePayload, options);
  }

  override async buttonMessage(data: SendButtonDto | SendButtonListDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     const jid = createJid(data.number);

     if ('buttons' in data) { // SendButtonDto
        const buttons = data.buttons.map(btn => ({ buttonId: btn.id, buttonText: { displayText: btn.label }, type: 1 }));
        const buttonMessage: proto.Message.IButtonsMessage = {
            text: data.description, // Usar description como texto principal?
            footer: data.footer,
            buttons: buttons,
            headerType: 1 // TEXT
            // Adicionar imagem/video/documento se necessário (headerType 4, 5, 6)
        };
        return this.client.sendMessage(jid, buttonMessage, options);
     } else { // SendButtonListDto
        const sections = data.sections.map(sec => ({
            title: sec.title,
            rows: sec.rows.map(row => ({
                title: row.title,
                rowId: row.rowId,
                description: row.description
            }))
        }));
        const listMessage: proto.Message.IListMessage = {
            title: data.title,
            description: data.description,
            buttonText: data.buttonText,
            footerText: data.footerText, // Adicionar footer se existir
            listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
            sections: sections,
        };
        return this.client.sendMessage(jid, listMessage, options);
     }
  }

  override async contactMessage(data: SendContactDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
    if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
    const jid = createJid(data.number);
    const contacts = data.contacts.map(c => ({
        displayName: c.name,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${c.name}\nFN:${c.name}\nitem1.TEL;waid=${c.number}:${c.number}\nitem1.X-ABLabel:Celular\nEND:VCARD`
    }));
    return this.client.sendMessage(jid, { contacts: { displayName: data.contactName ?? `${contacts.length} Contato(s)`, contacts: contacts } }, options);
  }

  override async locationMessage(data: SendLocationDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     const jid = createJid(data.number);
     return this.client.sendMessage(jid, {
         location: {
             degreesLatitude: data.latitude,
             degreesLongitude: data.longitude,
             name: data.businessName, // Adicionar nome se disponível
             address: data.address // Adicionar endereço se disponível
         }
     }, options);
  }

  override async reactionMessage(data: SendReactionDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     const jid = createJid(data.number);
     return this.client.sendMessage(jid, {
         react: {
             text: data.reaction || '', // Reação vazia para remover
             key: {
                 id: data.key.id,
                 remoteJid: jid,
                 fromMe: data.key.fromMe,
                 // participant: data.key.participant // Adicionar se a chave tiver participante (grupos)
             }
         }
     }, options);
  }

  override async templateMessage(data: SendTemplateDto, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     const jid = createJid(data.number);
     // A estrutura de templateMessage pode variar. Exemplo com buttons:
     const templateButtons = data.buttons?.map(btn => {
         if ('url' in btn) return { index: btn.index, urlButton: { displayText: btn.displayText, url: btn.url }};
         if ('call' in btn) return { index: btn.index, callButton: { displayText: btn.displayText, phoneNumber: btn.call }};
         if ('id' in btn) return { index: btn.index, quickReplyButton: { displayText: btn.displayText, id: btn.id }};
         return null;
     }).filter(Boolean);

     if (!templateButtons || templateButtons.length === 0) {
         throw new BadRequestException("Botões de template inválidos ou ausentes.");
     }

     const message: proto.Message.ITemplateMessage = {
         hydratedTemplate: { // Ou templateButtons? Verificar estrutura exata necessária
             hydratedContentText: data.text,
             hydratedFooterText: data.footer,
             hydratedButtons: templateButtons,
             // Adicionar namespace e element_name se aplicável
         },
         // contextInfo: {} // Adicionar se necessário
     };

     return this.client.sendMessage(jid, message, options);
  }

  // --- Implementação dos Métodos de Grupo ---
  override async createGroup(data: CreateGroupDto): Promise<GroupMetadata | any> {
      if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
      const participants = data.participants.map(p => createJid(p));
      return this.client.groupCreate(data.subject, participants);
  }
  override async updateGroupSubject(data: UpdateGroupSubjectDto): Promise<void | any> {
      if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
      const groupJid = createJid(data.groupJid);
      return this.client.groupUpdateSubject(groupJid, data.subject);
  }
  override async updateGroupDescription(data: UpdateGroupDescriptionDto): Promise<void | any> {
      if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
      const groupJid = createJid(data.groupJid);
      return this.client.groupUpdateDescription(groupJid, data.description);
  }
   override async updateGroupPicture(data: UpdateGroupPictureDto): Promise<void | any> {
       if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
       const groupJid = createJid(data.groupJid);
       const imageBuffer = Buffer.from(data.media, 'base64');
       return this.client.updateProfilePicture(groupJid, imageBuffer);
   }
   override async findGroup(groupJid: string): Promise<GroupMetadata | any> {
       if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
       const jid = createJid(groupJid);
       return this.client.groupMetadata(jid);
   }
   override async fetchAllGroups(getPaticipants = false): Promise<{ [key: string]: GroupMetadata } | any> {
       if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
       const groups = await this.client.groupFetchAllParticipating();
       if (!getPaticipants) {
           // Remove participantes para payload menor
           Object.values(groups).forEach(g => delete g.participants);
       }
       return groups;
   }
    override async inviteCode(groupJid: string): Promise<string | any> {
        if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
        const jid = createJid(groupJid);
        return this.client.groupInviteCode(jid);
    }
    override async inviteInfo(inviteCode: string): Promise<GroupMetadata | any> {
        if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
        return this.client.groupGetInviteInfo(inviteCode);
    }
     override async sendInvite(data: SendInviteDto): Promise<any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         // Precisa obter o groupJid de alguma forma, talvez pelo inviteCode
         // Ou o DTO precisa incluir o groupJid
         const inviteInfo = await this.inviteInfo(data.inviteCode);
         if (!inviteInfo?.id) throw new NotFoundException(`Grupo não encontrado para o código ${data.inviteCode}`);
         const groupJid = inviteInfo.id;
         const participantJid = createJid(data.number);
         // A API do Baileys pode não ter um método direto 'sendInvite' para um número.
         // Normalmente, você envia o link de convite para o número.
         const inviteLink = `https://chat.whatsapp.com/${data.inviteCode}`;
         return this.textMessage({ number: participantJid, text: data.caption ? `${data.caption}\n${inviteLink}` : inviteLink });
     }
     override async acceptInviteCode(inviteCode: string): Promise<string | any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         return this.client.groupAcceptInvite(inviteCode);
     }
     override async revokeInviteCode(groupJid: string): Promise<string | any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         const jid = createJid(groupJid);
         return this.client.groupRevokeInvite(jid);
     }
     override async findParticipants(groupJid: string): Promise<any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         const jid = createJid(groupJid);
         const metadata = await this.client.groupMetadata(jid);
         return metadata.participants;
     }
     override async updateGParticipant(data: UpdateParticipantsDto): Promise<any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         const groupJid = createJid(data.groupJid);
         const participants = data.participants.map(p => createJid(p));
         return this.client.groupParticipantsUpdate(groupJid, participants, data.action);
     }
     override async updateGSetting(data: UpdateSettingDto): Promise<void | any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         const groupJid = createJid(data.groupJid);
         // Baileys usa 'announcement' ou 'not_announcement' / 'locked' ou 'unlocked'
         const setting = data.setting === 'announcement' ? 'announcement' :
                         data.setting === 'restrict' ? 'locked' : undefined;
         const action = data.action === 'lock' ? 'locked' : // Mapear para 'locked'/'unlocked'
                        data.action === 'unlock' ? 'unlocked' :
                        data.action === 'close' ? 'announcement' : // Mapear para 'announcement'/'not_announcement'
                        data.action === 'open' ? 'not_announcement' : undefined;
          if (!setting || !action) throw new BadRequestException('Configuração ou ação inválida.');
         // Ajustar chamada conforme a API do Baileys (pode ser groupSettingUpdate ou groupToggleEphemeral)
         return this.client.groupSettingUpdate(groupJid, setting as GroupSettingUpdate); // Ajustar tipo se necessário
     }
     override async toggleEphemeral(data: UpdateEphemeralDto): Promise<void | any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         const groupJid = createJid(data.groupJid);
         return this.client.groupToggleEphemeral(groupJid, data.value);
     }
     override async leaveGroup(groupJid: string): Promise<void | any> {
         if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
         const jid = createJid(groupJid);
         return this.client.groupLeave(jid);
     }

  // --- Implementação dos Métodos de Chamada ---
  override async offerCall(data: OfferCallDto): Promise<any> {
      if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
      this.logger.warn('offerCall (Voice Call) via Baileys requires specific implementation using useVoiceCallsBaileys.');
      // TODO: Implementar usando helpers de useVoiceCallsBaileys
      // Exemplo (simplificado):
      // const vc = useVoiceCallsBaileys(...); // Obter instância do helper
      // return vc?.offerCall(createJid(data.number), data.isVideo);
      throw new Error("Voice call offering not fully implemented yet.");
  }

  // --- Implementação dos Métodos de Labels ---
   override async fetchLabels(): Promise<wa.Label[] | any> {
       if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
       return this.client.getLabels();
   }
   override async handleLabel(data: HandleLabelDto): Promise<any> {
       if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
       if (data.action === 'create') {
           return this.client.addLabel(data.label.name, { labelColor: data.label.color });
       } else if (data.action === 'edit') {
           if (!data.label.id) throw new BadRequestException("Label ID is required for editing.");
           return this.client.editLabel(data.label.id, { labelName: data.label.name, labelColor: data.label.color });
       } else if (data.action === 'delete') {
           if (!data.label.id) throw new BadRequestException("Label ID is required for deletion.");
           return this.client.deleteLabel(data.label.id);
       } else if (data.action === 'associate') {
           if (!data.label.id || !data.chatId) throw new BadRequestException("Label ID and Chat ID are required for association.");
           return this.client.addChatLabel(data.chatId, data.label.id);
       } else if (data.action === 'disassociate') {
           if (!data.label.id || !data.chatId) throw new BadRequestException("Label ID and Chat ID are required for disassociation.");
           return this.client.removeChatLabel(data.chatId, data.label.id);
       }
       throw new BadRequestException(`Ação inválida para handleLabel: ${data.action}`);
   }

  // --- Implementação dos Métodos específicos do Baileys ---
  // (Removidos do 'abstract' da base e implementados aqui)
  public async baileysOnWhatsapp(jid: string): Promise<any> {
    if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
    const [result] = await this.client.onWhatsApp(createJid(jid));
    return result;
  }
  public async baileysProfilePictureUrl(jid: string, type: 'image' | 'preview' = 'image', timeoutMs?: number): Promise<any> {
    if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
    return this.client.profilePictureUrl(createJid(jid), type, timeoutMs);
  }
  public async baileysAssertSessions(jids: string[], force?: boolean): Promise<any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     const mappedJids = jids.map(j => createJid(j));
     return this.client.assertSessions(mappedJids, force);
  }
  public async baileysCreateParticipantNodes(jids: string[], message: proto.Message.ProtocolMessage, extraAttrs?: { [_: string]: string }): Promise<any> {
     // Este método pode ser interno do Baileys, verificar necessidade de expor
     throw new Error("baileysCreateParticipantNodes might be internal to Baileys library.");
  }
  public async baileysGetUSyncDevices(jids: string[], useCache: boolean, ignoreZeroDevices: boolean): Promise<any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     const mappedJids = jids.map(j => createJid(j));
     return this.client.getUSyncDevices(mappedJids, useCache, ignoreZeroDevices);
  }
  public async baileysGenerateMessageTag(): Promise<string> { // Retorna string
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     return this.client.generateMessageTag();
  }
  public async baileysSendNode(stanza: Buffer | proto.StanzaNode): Promise<any> {
     if (!this.client) throw new Error(`Cliente Baileys não conectado para ${this.instanceName}`);
     return this.client.sendNode(stanza as proto.StanzaNode); // Cast para StanzaNode
  }
  public async baileysSignalRepositoryDecryptMessage(jid: string, type: 'pkmsg' | 'msg', ciphertext: Buffer): Promise<any> {
      if (!this.client?.authCreds?.signalIdentities) throw new Error(`Repositório de sinal não disponível para ${this.instanceName}`);
      // Acesso pode ser mais complexo, dependendo da implementação do auth state
      // const signalRepo = makeCacheableSignalKeyStore(this.client.authCreds, this.logger as any); // Exemplo
      // return signalRepo.decryptMessage(jid, type, ciphertext);
       throw new Error("baileysSignalRepositoryDecryptMessage requires direct access to signal repository.");
  }
  public async baileysGetAuthState(): Promise<AuthenticationState | undefined> {
     // Retorna o estado de autenticação atual (pode não ser seguro expor tudo)
     return this.instance?.authState as AuthenticationState | undefined;
  }

  // Método para buscar foto de perfil (implementação específica)
  public async profilePicture(jid: string): Promise<{ profilePictureUrl: string | null }> {
      if (!this.client) {
           this.logger.warn(`Tentando buscar foto de perfil sem cliente conectado para ${jid}`);
           return { profilePictureUrl: null };
      }
      try {
          const url = await this.client.profilePictureUrl(createJid(jid), 'image');
          return { profilePictureUrl: url };
      } catch (error: any) {
          // Erros 401 (não autorizado) ou 404 (não encontrado) são comuns e esperados
          if (error?.output?.statusCode === 401 || error?.output?.statusCode === 404 || error?.message?.includes('not-found')) {
               this.logger.debug(`Foto de perfil não encontrada ou acesso negado para ${jid}`);
          } else {
               this.logger.error({ err: error }, `Erro ao buscar foto de perfil para ${jid}`);
          }
          return { profilePictureUrl: null }; // Retorna null em caso de erro ou não encontrada
      }
  }

   // --- Método historySyncNotification ---
   // CORREÇÃO TS2339: Implementar método
   private historySyncNotification(msg: proto.Message.IHistorySyncNotification): boolean {
        const historySetting = this.localSettings?.syncFullHistory ?? false;
        // this.logger.debug({ msgId: msg?.id, type: msg?.syncType }, `History sync notification received. Sync Full: ${historySetting}`);
        // Por padrão, sincroniza tudo se syncFullHistory for true
        // Adicione lógica customizada aqui se necessário para filtrar tipos específicos de sync.
        return historySetting;
    }

} // Fim da classe BaileysStartupService
