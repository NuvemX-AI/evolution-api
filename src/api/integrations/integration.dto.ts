import { ChatwootInstanceMixin } from './chatbot/chatwoot/dto/chatwoot.dto';
import { EventInstanceMixin } from '../integrations/event/event.dto';

export type Constructor<T = {}> = new (...args: any[]) => T;

// Aplica os mixins de Chatwoot e Eventos ao DTO base
export class IntegrationDto extends EventInstanceMixin(
  ChatwootInstanceMixin(class {})
) {}
