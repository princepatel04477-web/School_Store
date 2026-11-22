import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Page } from '../../api';

const blockedLabels: Record<string, string> = {
  PAYMENT_NOT_PAID: 'Awaiting payment',
  PAYMENT_REVIEW_OPEN: 'Payment review open',
  PAYMENT_REFUNDED: 'Payment refunded',
};

type PackingOrder = {
  id: string;
  order_number: string;
  status: string;
  fulfillment_type: string;
  blocked_reason: string;
  claimed: boolean;
  claimed_by_me: boolean;
  issue: string;
  confirmed_items: string[];
  items: { id: string; name: string; size: string; quantity: number }[];
  article_number: string | null;
  booked_at: string | null;
  corrections: { previous_number: string; article_number: string; reason: string; changed_at: string }[];
};

export function PackingQueue() {
  const [tab, setTab] = useState<'packing' | 'sent'>('packing');
  const queue = useInfiniteQuery({
    queryKey: ['fulfilment', tab],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Page<PackingOrder>>(
      '/fulfilment/?' + new URLSearchParams({ tab, cursor: pageParam }),
    ),
    getNextPageParam: (page) => page.next ? new URL(page.next).searchParams.get('cursor') ?? undefined : undefined,
  });
  const orders = queue.data?.pages.flatMap((page) => page.results) ?? [];

  return (
    <section className="pad">
      <h2>Packing and dispatch</h2>
      <div className="section-row">
        <button type="button" aria-pressed={tab === 'packing'} onClick={() => setTab('packing')}>Packing queue</button>
        <button type="button" aria-pressed={tab === 'sent'} onClick={() => setTab('sent')}>Sent and collected</button>
      </div>
      {queue.isPending && <p role="status">Loading orders…</p>}
      {queue.isError && <p role="alert">Could not load orders. <button onClick={() => void queue.refetch()}>Retry</button></p>}
      {queue.isSuccess && !orders.length && <p>No orders in this queue.</p>}
      {orders.map((order) => <PackingCard key={order.id} order={order} />)}
      {queue.hasNextPage && (
        <button disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>Load more orders</button>
      )}
    </section>
  );
}

function PackingCard({ order }: { order: PackingOrder }) {
  const queryClient = useQueryClient();
  const [issue, setIssue] = useState<string | null>(null);
  const [article, setArticle] = useState('');
  const [receipt, setReceipt] = useState(false);
  const [reason, setReason] = useState('');
  const pickup = order.fulfillment_type === 'SCHOOL_PICKUP';
  const processing = order.status === 'PROCESSING';
  const packed = order.status === 'PACKED';
  const sent = ['DISPATCHED', 'SHIPPED', 'DELIVERED'].includes(order.status);
  const mutation = useMutation({
    mutationFn: ({ command, data }: { command: string; data?: object }) => api<PackingOrder>(
      '/fulfilment/' + order.id + '/' + command + '/',
      { method: 'POST', body: JSON.stringify(data ?? {}) },
    ),
    onSuccess: async (_, { command }) => {
      if (command === 'issue') setIssue(null);
      if (command === 'correct' || command === 'handover') {
        setArticle('');
        setReason('');
        setReceipt(false);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fulfilment'] }),
        queryClient.invalidateQueries({ queryKey: ['city-orders'] }),
      ]);
    },
  });
  const run = (command: string, data?: object) => mutation.mutate({ command, data });
  const evidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (order.article_number) run('correct', { article_number: article, reason });
    else run('handover', { article_number: article, receipt_confirmed: receipt });
  };

  return (
    <article className="order-card">
      <h3>{order.order_number}</h3>
      <p>{order.status} · {pickup ? 'School pickup' : 'Home delivery'}</p>
      {order.blocked_reason && (
        <p role="status">{blockedLabels[order.blocked_reason] ?? 'Fulfilment blocked'}</p>
      )}
      {order.claimed && !order.claimed_by_me && !sent && <p>Claimed by another staff member.</p>}
      {order.issue && <p>Packing issue: {order.issue}</p>}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      <fieldset disabled={mutation.isPending || Boolean(order.blocked_reason)}>
        {!order.claimed && !sent && <button onClick={() => run('claim')}>Claim order</button>}
        <ul>
          {order.items.map((item) => {
            const checked = order.confirmed_items.includes(item.id);
            return (
              <li key={item.id}>
                <label>
                  {processing && order.claimed_by_me && (
                    <input type="checkbox" checked={checked} onChange={(event) => run('confirm', {
                      item_id: item.id,
                      confirmed: event.target.checked,
                    })} />
                  )}
                  {item.quantity} × {item.name}{item.size ? ' · ' + item.size : ''}
                </label>
              </li>
            );
          })}
        </ul>
        {processing && order.claimed_by_me && (
          <>
            <form onSubmit={(event) => { event.preventDefault(); run('issue', { issue: issue ?? order.issue }); }}>
              <label>Packing issue <input maxLength={500} value={issue ?? order.issue} onChange={(event) => setIssue(event.target.value)} /></label>
              <button type="submit">Save issue</button>
            </form>
            <button disabled={!order.items.length || order.confirmed_items.length !== order.items.length || Boolean(order.issue)}
              onClick={() => run('pack')}>Mark packed</button>
          </>
        )}
        {pickup && packed && order.claimed_by_me && <button onClick={() => run('pickup')}>Mark collected</button>}
        {!pickup && sent && order.status !== 'DELIVERED' && <button onClick={() => run('deliver')}>Mark delivered</button>}
        {!pickup && order.article_number && (
          <>
            <p>Article number <strong>{order.article_number}</strong></p>
            {order.corrections.length > 0 && <details><summary>Correction history</summary><ul>
              {order.corrections.map((change, index) => <li key={change.changed_at + index}>
                {change.previous_number} → {change.article_number} · {change.reason}
              </li>)}
            </ul></details>}
          </>
        )}
        {!pickup && ((packed && order.claimed_by_me) || order.article_number) && (
          <form onSubmit={evidence}>
            <label>Article number <input maxLength={40} required value={article}
              onChange={(event) => setArticle(event.target.value)} /></label>
            {order.article_number ? (
              <label>Reason for correction <input maxLength={500} required value={reason}
                onChange={(event) => setReason(event.target.value)} /></label>
            ) : (
              <label><input type="checkbox" required checked={receipt} onChange={(event) => setReceipt(event.target.checked)} />
                Confirm booking receipt</label>
            )}
            <button type="submit">{order.article_number ? 'Save correction' : 'Record postal handover'}</button>
          </form>
        )}
      </fieldset>
    </article>
  );
}
