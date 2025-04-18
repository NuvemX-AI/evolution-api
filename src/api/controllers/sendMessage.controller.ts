import { InstanceDto } from '../dto/instance.dto';
import {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStatusDto,
  SendStickerDto,
  SendTemplateDto,
  SendTextDto,
} from '../dto/sendMessage.dto';
import { WAMonitoringService } from '../services/wa-monitoring.service';
import { BadRequestException, NotFoundException } from '../../common/exceptions';
import { isBase64, isURL } from 'class-validator';

export class SendMessageController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  private getInstanceOrThrow(instanceName: string) {
    const instance = this.waMonitor.get(instanceName);
    if (!instance) {
      throw new NotFoundException(`Instância "${instanceName}" não encontrada.`);
    }
    return instance;
  }

  public async sendTemplate({ instanceName }: InstanceDto, data: SendTemplateDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.templateMessage(data);
  }

  public async sendText({ instanceName }: InstanceDto, data: SendTextDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.textMessage(data);
  }

  public async sendMedia({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    if (isBase64(data?.media) && !data?.fileName && data?.mediatype === 'document') {
      throw new BadRequestException('For base64 the file name must be informed.');
    }

    if (file || isURL(data?.media) || isBase64(data?.media)) {
      return await instance.mediaMessage(data, file);
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendPtv({ instanceName }: InstanceDto, data: SendPtvDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    if (file || isURL(data?.video) || isBase64(data?.video)) {
      return await instance.ptvMessage(data, file);
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendSticker({ instanceName }: InstanceDto, data: SendStickerDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    if (file || isURL(data.sticker) || isBase64(data.sticker)) {
      return await instance.mediaSticker(data, file);
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendWhatsAppAudio({ instanceName }: InstanceDto, data: SendAudioDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);

    if (file?.buffer || isURL(data.audio) || isBase64(data.audio)) {
      return await instance.audioWhatsapp(data, file);
    }
    throw new BadRequestException('Owned media must be a url, base64, or valid file with buffer');
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

    if (!data.reaction.match(/[^()\w\sà-ú"-+]+/)) {
      throw new BadRequestException('"reaction" must be an emoji');
    }
    return await instance.reactionMessage(data);
  }

  public async sendPoll({ instanceName }: InstanceDto, data: SendPollDto) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.pollMessage(data);
  }

  public async sendStatus({ instanceName }: InstanceDto, data: SendStatusDto, file?: any) {
    const instance = this.getInstanceOrThrow(instanceName);
    return await instance.statusMessage(data, file);
  }
}
