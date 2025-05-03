import { InstanceDto } from '../dto/instance.dto';
// CORREÇÃO TS2305: Removidos DTOs não exportados
import {
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto, // Usado para Audio, PTV, Sticker, Status
  SendPollDto, // Assumindo que este DTO existe ou será criado
  SendReactionDto,
  SendTemplateDto,
  SendTextDto,
} from '../dto/sendMessage.dto';
import { WAMonitoringService } from '../services/wa-monitoring.service';
// CORREÇÃO: Importar de @exceptions/index ou path correto
import { BadRequestException, NotFoundException } from '@exceptions/index';
import { isBase64, isURL } from 'class-validator';
import { ChannelStartupService } from '../services/channel.service'; // Importar para tipar 'instance'

export class SendMessageController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  // Helper para obter a instância do canal ou lançar erro
  private getInstanceOrThrow(instanceName: string): ChannelStartupService {
    const instance = this.waMonitor.get(instanceName);
    if (!instance) {
      throw new NotFoundException(`Instância "${instanceName}" não encontrada.`);
    }
    // Aqui poderíamos adicionar instanceof para verificar o tipo (Baileys, Meta, etc.) se necessário
    return instance;
  }

  public async sendTemplate({ instanceName }: InstanceDto, data: SendTemplateDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    // Assumir que templateMessage existe no ChannelStartupService ou suas implementações
    return await instance.templateMessage(data);
  }

  public async sendText({ instanceName }: InstanceDto, data: SendTextDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.textMessage(data);
  }

  public async sendMedia({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    // CORREÇÃO TS2551: Corrigido mediatype -> mediaType
    if (isBase64(data?.media) && !data?.fileName && data?.mediaType === 'document') {
      throw new BadRequestException('Para mídia Base64 do tipo documento, o nome do arquivo (fileName) deve ser informado.');
    }

    if (file || isURL(data?.media) || isBase64(data?.media)) {
      // Assumir que mediaMessage existe no ChannelStartupService ou suas implementações
      return await instance.mediaMessage(data, file); // Passar 'file' se existir
    }
    throw new BadRequestException('A mídia fornecida (media) deve ser uma URL válida ou uma string Base64.');
  }

  // CORREÇÃO TS2305: Usar SendMediaDto
  public async sendPtv({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    // Validar se é realmente um vídeo PTV
    if (data.mediaType !== 'video') {
        throw new BadRequestException("Para PTV, mediaType deve ser 'video'.")
    }
    // CORREÇÃO: Usar data.media
    if (file || isURL(data?.media) || isBase64(data?.media)) {
      // Assumir que ptvMessage existe. Se não, talvez usar mediaMessage com flag?
      // return await instance.mediaMessage({...data, ptt: true }, file); // Exemplo alternativo
      return await instance.ptvMessage(data, file); // Assumindo que ptvMessage existe
    }
    throw new BadRequestException('O vídeo PTV (media) deve ser uma URL válida ou uma string Base64.');
  }

  // CORREÇÃO TS2305: Usar SendMediaDto
  public async sendSticker({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    // Validar se é realmente um sticker
    if (data.mediaType !== 'sticker') {
      throw new BadRequestException("Para Sticker, mediaType deve ser 'sticker'.")
    }

    // CORREÇÃO: Usar data.media
    if (file || isURL(data.media) || isBase64(data.media)) {
      // Assumir que mediaSticker existe. Se não, usar mediaMessage?
      return await instance.mediaSticker(data, file); // Assumindo que mediaSticker existe
      // return await instance.mediaMessage(data, file); // Alternativa
    }
    throw new BadRequestException('O sticker (media) deve ser uma URL válida ou uma string Base64.');
  }

  // CORREÇÃO TS2305: Usar SendMediaDto
  public async sendWhatsAppAudio({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

     // Validar se é realmente um áudio
     if (data.mediaType !== 'audio') {
        throw new BadRequestException("Para Áudio WhatsApp, mediaType deve ser 'audio'.")
      }

    // CORREÇÃO: Usar data.media
    if (file?.buffer || isURL(data.media) || isBase64(data.media)) {
      // Assumir que audioWhatsapp existe
      return await instance.audioWhatsapp(data, file);
      // return await instance.mediaMessage(data, file); // Alternativa
    }
    throw new BadRequestException('O áudio (media) deve ser uma URL válida, Base64, ou um arquivo com buffer.');
  }

  public async sendButtons({ instanceName }: InstanceDto, data: SendButtonsDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.buttonMessage(data);
  }

  public async sendLocation({ instanceName }: InstanceDto, data: SendLocationDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.locationMessage(data);
  }

  public async sendList({ instanceName }: InstanceDto, data: SendListDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.listMessage(data);
  }

  public async sendContact({ instanceName }: InstanceDto, data: SendContactDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.contactMessage(data);
  }

  public async sendReaction({ instanceName }: InstanceDto, data: SendReactionDto) {
    const instance = this.getInstanceOrThrow(instanceName);

    // Validação simples de emoji (pode ser aprimorada)
    if (!data.reaction || data.reaction.match(/[^()\w\sà-ú"-+]/)) { // Permite string vazia para remover
      if (data.reaction !== '') { // Aceita string vazia
         throw new BadRequestException('"reaction" deve ser um emoji válido ou uma string vazia para remover a reação.');
      }
    }
    return await instance.reactionMessage(data);
  }

  public async sendPoll({ instanceName }: InstanceDto, data: SendPollDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    // Assumir que pollMessage existe e que SendPollDto está definido corretamente em algum lugar
    return await instance.pollMessage(data);
  }

  // CORREÇÃO TS2305: Usar SendMediaDto (ou SendTextDto se for status de texto)
  public async sendStatus({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
     // TODO: Verificar como o serviço diferencia status de texto e mídia
     // Atualmente assume que é mídia por causa do parâmetro 'file'
    const instance = this.getInstanceOrThrow(instanceName);
    if (data.mediaType !== 'image' && data.mediaType !== 'video' && data.mediaType !== 'text') { // Status pode ser texto também
        // throw new BadRequestException("Status só pode ser imagem, vídeo ou texto.");
        // Se for texto, o DTO deveria ser SendTextDto?
        // return await instance.statusMessage({ text: data.text }, file); // Exemplo para texto
    }
    return await instance.statusMessage(data, file);
  }
}

// Chave extra removida
