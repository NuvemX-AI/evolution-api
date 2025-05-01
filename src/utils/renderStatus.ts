import { StatusMessage } from '@api/types/wa.types';

/** Mapeia códigos de recibo do WhatsApp para rótulos legíveis */
export const status: Record<number, StatusMessage> = {
  0: 'ERROR',
  1: 'PENDING',
  2: 'SERVER_ACK',
  3: 'DELIVERY_ACK',
  4: 'READ',
  5: 'PLAYED',
};
