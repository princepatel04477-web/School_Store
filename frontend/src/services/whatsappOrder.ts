import { formatINR } from '../utils/formatINR';
import type { CartItem } from '../store/storeState';

/**
 * Until orders are saved on the server, the parent sends the order to the store's
 * WhatsApp. The message is written for the person reading it at the store: everything
 * needed to call the parent back and pack the order, one fact per line.
 */
export interface WhatsAppOrder {
  reference: string;
  schoolName?: string;
  studentName: string;
  studentClass: string;
  parentName: string;
  parentMobile: string;
  deliveryType: 'HOME' | 'SCHOOL';
  address?: string;
  items: CartItem[];
  subtotalPaise: number;
  gstPaise: number;
  deliveryPaise: number;
  totalPaise: number;
}

export function buildOrderMessage(order: WhatsAppOrder): string {
  const lines = [
    `New uniform order ${order.reference}`,
    '',
    order.schoolName ? `School: ${order.schoolName}` : null,
    `Student: ${order.studentName} (${order.studentClass})`,
    `Parent: ${order.parentName}, ${order.parentMobile}`,
    '',
    ...order.items.map(
      (item) =>
        `${item.quantity} x ${item.name}${item.size ? ` (size ${item.size})` : ''} = ${formatINR(item.pricePaise * item.quantity)}`,
    ),
    '',
    `Items: ${formatINR(order.subtotalPaise)}`,
    `GST: ${formatINR(order.gstPaise)}`,
    `Delivery: ${order.deliveryPaise === 0 ? 'Free' : formatINR(order.deliveryPaise)}`,
    `Total: ${formatINR(order.totalPaise)}`,
    '',
    order.deliveryType === 'HOME' ? `Deliver to: ${order.address}` : 'Collect at school',
    'Payment: cash on delivery',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

export function whatsappOrderUrl(whatsappNumber: string, message: string): string {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}
