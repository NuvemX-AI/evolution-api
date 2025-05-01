// src/utils/getConversationMessage.ts
import { configService, S3 } from '@config/env.config';

/**
 * Concatena o tipo de mídia + ID do arquivo.
 * (forma padronizada usada pela Evolution-API)
 */
const buildMediaTag = (kind: string, mediaId: string, caption?: string): string =>
  `${kind}|${mediaId}${caption ? `|${caption}` : ''}`;

/**
 * Identifica todos os “candidate types” da mensagem e devolve
 * um objeto { ...types, messageType }
 */
const getTypeMessage = (msg: any) => {
  if (!msg?.message) return { messageType: 'unknown' };

  let mediaId = msg.key?.id as string | undefined;
  const s3Conf = configService.get<S3>('S3');
  if (s3Conf?.ENABLE && msg.message?.mediaUrl) mediaId = msg.message.mediaUrl;

  const types: Record<string, unknown> = {
    conversation: msg.message.conversation,
    extendedTextMessage: msg.message.extendedTextMessage?.text,
    contactMessage: msg.message.contactMessage?.displayName,
    locationMessage: msg.message.locationMessage?.degreesLatitude,
    viewOnceMessageV2:
      msg.message.viewOnceMessageV2?.message?.imageMessage?.url ||
      msg.message.viewOnceMessageV2?.message?.videoMessage?.url ||
      msg.message.viewOnceMessageV2?.message?.audioMessage?.url,
    listResponseMessage: msg.message.listResponseMessage?.title,
    responseRowId: msg.message.listResponseMessage?.singleSelectReply?.selectedRowId,
    templateButtonReplyMessage:
      msg.message.templateButtonReplyMessage?.selectedId ??
      msg.message.buttonsResponseMessage?.selectedButtonId,

    /* --- mídias --- */
    audioMessage: msg.message.speechToText
      ? msg.message.speechToText
      : msg.message.audioMessage && mediaId
        ? buildMediaTag('audioMessage', mediaId)
        : undefined,

    imageMessage: msg.message.imageMessage && mediaId
      ? buildMediaTag('imageMessage', mediaId, msg.message.imageMessage.caption)
      : undefined,

    videoMessage: msg.message.videoMessage && mediaId
      ? buildMediaTag('videoMessage', mediaId, msg.message.videoMessage.caption)
      : undefined,

    documentMessage: msg.message.documentMessage && mediaId
      ? buildMediaTag('documentMessage', mediaId, msg.message.documentMessage.caption)
      : undefined,

    documentWithCaptionMessage:
      msg.message.documentWithCaptionMessage?.message?.documentMessage && mediaId
        ? buildMediaTag(
            'documentWithCaptionMessage',
            mediaId,
            msg.message.documentWithCaptionMessage.message.documentMessage.caption
          )
        : undefined,

    externalAdReplyBody: msg.contextInfo?.externalAdReply?.body
      ? `externalAdReplyBody|${msg.contextInfo.externalAdReply.body}`
      : undefined,
  };

  const messageType =
    (Object.keys(types).find((k) => k !== 'externalAdReplyBody' && types[k] !== undefined) as string) ||
    'unknown';

  return { ...types, messageType };
};

/** devolve apenas o conteúdo relevante, já concatenando externalAdReplyBody (se existir) */
const getMessageContent = (types: any): string | undefined => {
  const typeKey = Object.keys(types).find((k) => k !== 'externalAdReplyBody' && types[k] !== undefined);
  const base = typeKey ? (types[typeKey] as string) : undefined;

  return types.externalAdReplyBody ? `${base ?? ''}\n${types.externalAdReplyBody}`.trim() : base;
};

/**
 * Função pública usada em vários serviços/routers
 */
export function getConversationMessage(msg: any): string | undefined {
  const types = getTypeMessage(msg);
  return getMessageContent(types);
}
