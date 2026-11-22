import { api } from '../api';

export interface ExchangeCandidateSize {
  size: string;
  available_qty: number;
  active: boolean;
  recommended: boolean;
  stock_status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

export interface ExchangeOrderItem {
  id: string;
  garment_name: string;
  product_id: string;
  current_holdings: Record<string, number>;
  exchangeable_units: number;
  candidate_sizes: ExchangeCandidateSize[];
  is_delivered: boolean;
  not_delivered_reason: string;
  has_active_exchange: boolean;
  active_exchange_id: string | null;
}

export interface SizeExchangeRequestItem {
  id: string;
  order: string;
  order_number: string;
  order_item: string;
  garment_name: string;
  from_size: string;
  to_size: string;
  quantity: number;
  reason: 'TOO_SMALL' | 'TOO_BIG' | 'NOT_SIZE';
  parent_note: string;
  status:
    | 'SUBMITTED'
    | 'UNDER_REVIEW'
    | 'APPROVED'
    | 'AWAITING_RETURN'
    | 'WINDOW_CONFIRMED'
    | 'HANDOVER_SCHEDULED'
    | 'RECEIVED'
    | 'COMPLETED'
    | 'REJECTED'
    | 'WITHDRAWN'
    | 'CANCELLED';
  review_reason: string;
  review_note: string;
  inspection_result: 'PENDING' | 'RESTOCKABLE' | 'DAMAGED';
  reservation_state: 'NONE' | 'RESERVED' | 'LOCKED' | 'CONSUMED' | 'RELEASED';
  window_mode: 'NONE' | 'DATE_RANGE' | 'EVENT';
  window_start: string | null;
  window_end: string | null;
  reversal_window_end: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  student_name?: string;
  school_name?: string;
  city_name?: string;
  can_withdraw: boolean;
  can_approve: boolean;
  can_confirm_window: boolean;
  can_set_handover: boolean;
  can_receive: boolean;
  can_complete: boolean;
  can_reject: boolean;
  can_return_original: boolean;
  can_reverse_receipt: boolean;
}

export interface OrderExchangeSummary {
  order_id: string;
  order_number: string;
  delivered_at: string | null;
  window_starts_at: string | null;
  window_ends_at: string | null;
  within_window: boolean;
  window_reason: string;
  delivered_event_exists: boolean;
  items: ExchangeOrderItem[];
  requests: SizeExchangeRequestItem[];
}

export interface ExchangeQueueResponse {
  count: number;
  results: SizeExchangeRequestItem[];
}

export interface ExchangeCreatePayload {
  order_item_id: string;
  from_size: string;
  to_size: string;
  quantity: number;
  reason: 'TOO_SMALL' | 'TOO_BIG' | 'NOT_SIZE';
  parent_note?: string;
}

export interface StaffActionPayload {
  action:
    | 'APPROVE'
    | 'CONFIRM_WINDOW'
    | 'SET_HANDOVER'
    | 'RECEIVE'
    | 'COMPLETE'
    | 'REJECT'
    | 'RETURN_ORIGINAL'
    | 'REVERSE_RECEIPT';
  note?: string;
  inspection_result?: 'RESTOCKABLE' | 'DAMAGED';
  window_mode?: 'NONE' | 'DATE_RANGE' | 'EVENT';
  window_start?: string;
  window_end?: string;
}

export const exchangeService = {
  /**
   * Fetches exchange eligibility, available replacement sizes, and existing exchange requests for an order.
   */
  getOrderSummary(orderId: string): Promise<OrderExchangeSummary> {
    return api<OrderExchangeSummary>(`/orders/${orderId}/exchange/`);
  },

  /**
   * Submits a size exchange request from a parent.
   */
  submitRequest(orderId: string, payload: ExchangeCreatePayload): Promise<SizeExchangeRequestItem> {
    return api<SizeExchangeRequestItem>(`/orders/${orderId}/exchange/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Parent withdraws a pending size exchange request.
   */
  withdrawRequest(orderId: string, requestId: string): Promise<SizeExchangeRequestItem> {
    return api<SizeExchangeRequestItem>(`/orders/${orderId}/exchange/${requestId}/withdraw/`, {
      method: 'POST',
    });
  },

  /**
   * Staff queues listing. Filterable by status, school, city, or search query.
   */
  listQueue(params?: {
    status?: string;
    search?: string;
    school?: string;
    city?: string;
  }): Promise<ExchangeQueueResponse> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.search) q.set('search', params.search);
    if (params?.school) q.set('school', params.school);
    if (params?.city) q.set('city', params.city);
    const queryString = q.toString();
    return api<ExchangeQueueResponse>(`/panel/exchanges/${queryString ? `?${queryString}` : ''}`);
  },

  /**
   * Staff action execution (Approve, Receive, Complete, Reject, Reverse, etc.)
   */
  executeAction(requestId: string, payload: StaffActionPayload): Promise<SizeExchangeRequestItem> {
    return api<SizeExchangeRequestItem>(`/panel/exchanges/${requestId}/action/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
