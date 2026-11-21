// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import contract from '../test/fixtures/payment-contract.json';
import { PaymentsToCheck } from './PaymentsToCheck';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('checks the order in the staff reconciliation list', async () => {
  const row = contract.states.CHECKING.panel;
  const request = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
    JSON.stringify(url.includes('reconcile-payment')
      ? contract.states.CHECKING.reconcile
      : { count: 1, results: [row], unmatched_events: [] }),
    { status: 200 },
  )));
  vi.stubGlobal('fetch', request);

  render(<QueryClientProvider client={new QueryClient()}>
    <PaymentsToCheck open onToggle={() => {}} />
  </QueryClientProvider>);
  expect(await screen.findByText(row.order_number)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Payments to check (1)' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Check with Razorpay' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    expect.stringContaining(`/panel/orders/${row.id}/reconcile-payment/`),
    expect.objectContaining({ method: 'POST' }),
  ));
});
