import { TriggerOperator, TriggerType } from '@prisma/client';

export interface EvolutionBotDto {
  enabled?: boolean;
  description?: string;
  apiUrl?: string;
  apiKey?: string;
  expire?: number;
  keywordFinish?: string;
  delayMessage?: number;
  unknownMessage?: string;
  listeningFromMe?: boolean;
  stopBotFromMe?: boolean;
  keepOpen?: boolean;
  debounceTime?: number;
  triggerType?: TriggerType;
  triggerOperator?: TriggerOperator;
  triggerValue?: string;
  ignoreJids?: string[]; // tipando corretamente como array de strings
  splitMessages?: boolean;
  timePerChar?: number;
}

export interface EvolutionBotSettingDto {
  expire?: number;
  keywordFinish?: string;
  delayMessage?: number;
  unknownMessage?: string;
  listeningFromMe?: boolean;
  stopBotFromMe?: boolean;
  keepOpen?: boolean;
  debounceTime?: number;
  botIdFallback?: string;
  ignoreJids?: string[];
  splitMessages?: boolean;
  timePerChar?: number;
}
