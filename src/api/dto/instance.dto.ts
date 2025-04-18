import { IntegrationDto } from '../integrations/integration.dto';
import { JsonValue } from '@prisma/client/runtime/library';
import { WAPresence } from 'baileys';

export class InstanceDto extends IntegrationDto {
  instanceName!: string;
  instanceId?: string;
  qrcode?: boolean;
  businessId?: string;
  number?: string;
  integration?: string;
  token?: string;
  status?: string;
  ownerJid?: string;
  profileName?: string;
  profilePicUrl?: string;

  // settings
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  readStatus?: boolean;
  syncFullHistory?: boolean;
  wavoipToken?: string;

  // proxy
  proxyHost?: string;
  proxyPort?: string;
  proxyProtocol?: string;
  proxyUsername?: string;
  proxyPassword?: string;

  // webhook
  webhook?: {
    enabled?: boolean;
    events?: string[];
    headers?: JsonValue;
    url?: string;
    byEvents?: boolean;
    base64?: boolean;
  };

  // chatwoot
  chatwootAccountId?: string;
  chatwootConversationPending?: boolean;
  chatwootAutoCreate?: boolean;
  chatwootDaysLimitImportMessages?: number;
  chatwootImportContacts?: boolean;
  chatwootImportMessages?: boolean;
  chatwootLogo?: string;
  chatwootMergeBrazilContacts?: boolean;
  chatwootNameInbox?: string;
  chatwootOrganization?: string;
  chatwootReopenConversation?: boolean;
  chatwootSignMsg?: boolean;
  chatwootToken?: string;
  chatwootUrl?: string;

  constructor(data?: Partial<InstanceDto>) {
    super();
    if (data) Object.assign(this, data);
  }
}

// ----------- CORRIGIDO PARA INCLUIR instanceName -----------
export class SetPresenceDto {
  instanceName!: string;
  presence!: WAPresence;

  constructor(data?: Partial<SetPresenceDto>) {
    if (data) Object.assign(this, data);
  }
}
