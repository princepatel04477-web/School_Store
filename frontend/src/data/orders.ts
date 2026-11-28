import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api';

export interface ParentOrderItem {
  id: string;
  variant: string;
  variant_sku: string;
  variant_size: string;
  product_name: string;
  category: string;
  quantity: number;
  unit_price_snapshot: string | number;
}

export interface ParentOrderStatusEvent {
  id: string;
  status: string;
  timestamp: string;
  note?: string;
}

export interface ParentOrder {
  id: string;
  order_number: string;
  student_name: string;
  student_gr?: string;
  school_name?: string;
  school_code?: string;
  city_name?: string;
  status: string;
  payment_status: string;
  fulfillment_type?: 'HOME_DELIVERY' | 'SCHOOL_PICKUP' | string;
  payment_method?: 'ONLINE' | 'COD' | string;
  subtotal?: string | number;
  total: string | number;
  created_at: string;
  item_count?: number;
  items?: ParentOrderItem[];
  status_events?: ParentOrderStatusEvent[];
}

function normalizeOrdersResponse(data: Page<ParentOrder> | ParentOrder[]): ParentOrder[] {
  const list = Array.isArray(data) ? data : data?.results ?? [];
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/** Real orders for the signed-in parent, newest first. */
export function useParentOrders(enabled: boolean) {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const data = await api<Page<ParentOrder> | ParentOrder[]>('/orders/');
      return normalizeOrdersResponse(data);
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/** Full order detail (items + status_events) fetched when an order is expanded. */
export function useParentOrderDetail(orderId: string | null) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api<ParentOrder>(`/orders/${orderId}/`),
    enabled: Boolean(orderId),
    staleTime: 60 * 1000,
  });
}
