// src/api/integrations/chatbot/dify/dto/dify.dto.ts

// << CORREÇÃO TS2694: Importar $Enums apenas para tipos que existem >>
//    Importa apenas os enums que são realmente usados e existem no schema Prisma.
//    Se TriggerType/Operator não forem enums, remova-os do import.
import { $Enums, TriggerOperator, TriggerType } from '@prisma/client'; // Certifique-se que @prisma/client está atualizado (npx prisma generate)

export class DifyDto {
  enabled?: boolean;
  description?: string;
  // << CORREÇÃO TS2694: Usar string literal union se DifyBotType não for um enum Prisma >>
  //    Certifique-se que 'DifyBotType' está definido como enum no seu schema.prisma
  //    e rode 'npx prisma generate'. Se não for um enum, use string literal.
  botType?: 'chat' | 'agent'; // Tipos comuns Dify, ajuste se necessário
  // botType?: $Enums.DifyBotType; // Mantenha este se DifyBotType for um enum válido no seu schema
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
  // NOTE: Verifique se TriggerType é realmente um enum gerado ou apenas string
  triggerType?: TriggerType | 'all' | 'keyword' | 'advanced'; // Permite string literal também para segurança
  // NOTE: Verifique se TriggerOperator é realmente um enum gerado ou apenas string
  triggerOperator?: TriggerOperator | 'equals' | 'contains' | 'startsWith' | 'endsWith'; // Adiciona literais comuns
  triggerValue?: string;
  ignoreJids?: string[]; // Alterado de 'any' para 'string[]' para melhor tipagem
  splitMessages?: boolean;
  timePerChar?: number;
  // Campos que podem estar faltando baseados no uso em outros arquivos:
  difyIdFallback?: string | null; // Adicionado baseado no uso em settings
}

export class DifySettingDto {
  expire?: number;
  keywordFinish?: string;
  delayMessage?: number;
  unknownMessage?: string;
  listeningFromMe?: boolean;
  stopBotFromMe?: boolean;
  keepOpen?: boolean;
  debounceTime?: number;
  difyIdFallback?: string | null; // Usar string | null
  ignoreJids?: string[]; // Alterado de 'any' para 'string[]'
  splitMessages?: boolean;
  timePerChar?: number;
}
