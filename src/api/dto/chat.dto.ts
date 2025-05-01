import {
  proto,
  WAPresence,
  WAPrivacyGroupAddValue,
  WAPrivacyOnlineValue,
  WAPrivacyValue,
  WAReadReceiptsValue,
} from 'baileys';

/* -------------------------------------------------------------------------- */
/*  Checagem de número                                                        */
/* -------------------------------------------------------------------------- */
export class OnWhatsAppDto {
  constructor(
    public readonly jid: string,
    public readonly exists: boolean,
    public readonly number: string,
    public readonly name?: string,
  ) {}
}

/* -------------------------------------------------------------------------- */
/*  Media → Base64                                                            */
/* -------------------------------------------------------------------------- */
export class GetBase64FromMediaMessageDto {
  message: proto.WebMessageInfo;
  convertToMp4?: boolean;
}

/* -------- Alias opcional de compatibilidade: remova quando não precisar --- */
export { GetBase64FromMediaMessageDto as getBase64FromMediaMessageDto };

/* -------------------------------------------------------------------------- */
/*  Diversos DTOs                                                             */
/* -------------------------------------------------------------------------- */
export class WhatsAppNumberDto {
  numbers: string[];
}

export class NumberDto {
  number: string;
}

export class NumberBusiness {
  wid?: string;
  jid?: string;
  exists?: boolean;
  isBusiness: boolean;
  name?: string;
  message?: string;
  description?: string;
  email?: string;
  websites?: string[];
  website?: string[];
  address?: string;
  about?: string;
  vertical?: string;
  profilehandle?: string;
}

export class ProfileNameDto {
  name: string;
}

export class ProfileStatusDto {
  status: string;
}

export class ProfilePictureDto {
  number?: string;
  // url ou base64
  picture?: string;
}

/* -------------------------------------------------------------------------- */
/*  Chats & mensagens                                                         */
/* -------------------------------------------------------------------------- */
class Key {
  id: string;
  fromMe: boolean;
  remoteJid: string;
}

export class ReadMessageDto {
  readMessages: Key[];
}

export class LastMessage {
  key: Key;
  messageTimestamp?: number;
}

export class ArchiveChatDto {
  lastMessage?: LastMessage;
  chat?: string;
  archive: boolean;
}

export class MarkChatUnreadDto {
  lastMessage?: LastMessage;
  chat?: string;
}

/* -------------------------------------------------------------------------- */
/*  Privacidade                                                               */
/* -------------------------------------------------------------------------- */
export class PrivacySettingDto {
  readreceipts: WAReadReceiptsValue;
  profile: WAPrivacyValue;
  status: WAPrivacyValue;
  online: WAPrivacyOnlineValue;
  last: WAPrivacyValue;
  groupadd: WAPrivacyGroupAddValue;
}

/* -------------------------------------------------------------------------- */
/*  Exclusão                                                                  */
/* -------------------------------------------------------------------------- */
export class DeleteMessage {
  id: string;
  fromMe: boolean;
  remoteJid: string;
  participant?: string;
}

/* -------------------------------------------------------------------------- */
/*  Utilidades                                                                */
/* -------------------------------------------------------------------------- */
export class Options {
  delay?: number;
  presence?: WAPresence;
}

class OptionsMessage {
  options: Options;
}

export class Metadata extends OptionsMessage {
  number: string;
}

/* -------------------------------------------------------------------------- */
/*  Presença / Atualizações                                                   */
/* -------------------------------------------------------------------------- */
export class SendPresenceDto extends Metadata {
  presence: WAPresence;
  delay: number;
}

export class UpdateMessageDto extends Metadata {
  number: string;
  key: proto.IMessageKey;
  text: string;
}

export class BlockUserDto {
  number: string;
  status: 'block' | 'unblock';
}
