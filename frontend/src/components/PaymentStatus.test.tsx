// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaymentView } from '../api';
import contract from '../test/fixtures/payment-contract.json';
import { PaymentStatus } from './PaymentStatus';

afterEach(cleanup);

describe('order payment recovery', () => {
  it.each([
    ['CHECKING', /Checking payment/],
    ['NOT_PAID', /Payment not received/],
    ['PAID', /Payment received/],
    ['RELEASED', /This order was released/],
    ['REFUND_DUE', /after this order was released/],
    ['COD_DUE', /Cash on delivery/],
    ['PAID_DO_NOT_COLLECT', /Do not pay cash on delivery/],
  ] as const)('renders %s from the server', (state, text) => {
    const order = contract.states[state].list;
    render(<MemoryRouter>
      <PaymentStatus payment={order.payment_view as PaymentView} orderNumber={order.order_number}
        onRefresh={() => {}} onPay={() => {}} onCod={() => {}} />
    </MemoryRouter>);
    expect(screen.getByText(text)).toBeDefined();
    if (state !== 'NOT_PAID') expect(screen.queryByRole('button', { name: /^Pay [^c]/i })).toBeNull();
    if (state === 'PAID') expect(screen.getByText(new RegExp(order.order_number))).toBeDefined();
  });
});
