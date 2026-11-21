// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckoutPage } from './CheckoutPage';
import { orderApi, ApiError, type Order, type PaymentStartResponse, type PaymentReconcileResponse } from '../api';
import contract from '../test/fixtures/payment-contract.json';
import * as placeOrderService from '../services/placeOrder';
import * as paymentAdapter from '../services/paymentAdapter';

const mockCart = [
  {
    id: 'cart-1',
    variantId: 'var-1',
    name: 'School Shirt',
    size: '32',
    pricePaise: 50000,
    quantity: 2,
  },
];

const mockChild = {
  id: 'student-1',
  name: 'Aarav Patel',
  gr_number: 'GR-1042',
  class_name: '5',
  section: 'A',
  gender: 'Male',
  school: 'school-1',
  school_name: 'DPS Surat',
  school_code: 'DPS',
  active: true,
};

let currentCart = [...mockCart];
let currentChild: any = mockChild;

vi.mock('../store/storeState', () => ({
  useStoreState: () => ({
    cart: currentCart,
    subtotalPaise: currentCart.reduce((sum, item) => sum + item.pricePaise * item.quantity, 0),
    clearCart: vi.fn(),
    selection: { schoolId: 'school-1', schoolName: 'DPS Surat', cityName: 'Surat' },
  }),
}));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: {
      role: 'PARENT',
      phone: '9876543210',
      first_name: 'Ramesh',
      last_name: 'Patel',
    },
  }),
}));

vi.mock('../data/catalog', () => ({
  useStoreSchools: () => ({
    data: [{ id: 'school-1', name: 'DPS Surat', homeDelivery: true, schoolPickup: true }],
  }),
}));

vi.mock('../components/parent/ParentSignInSheet', () => ({
  ParentSignInSheet: ({ open, onDone }: any) => {
    if (!open) return null;
    return (
      <div data-testid="sign-in-sheet">
        <button
          type="button"
          onClick={() =>
            onDone({
              id: 'student-1',
              name: 'Aarav Patel',
              gr_number: 'GR-1042',
              class_name: '5',
              section: 'A',
              gender: 'Male',
              school: 'school-1',
              school_name: 'DPS Surat',
              school_code: 'DPS',
              active: true,
            })
          }
        >
          Select Child
        </button>
      </div>
    );
  },
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderCheckout() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function advanceToStep3() {
  // Step 1: Choose child
  const chooseChildBtn = screen.getByText('Choose your child');
  fireEvent.click(chooseChildBtn);
  const selectChildBtn = screen.getByText('Select Child');
  fireEvent.click(selectChildBtn);

  // Click Next on Step 1
  const nextBtn1 = screen.getByText('Next');
  fireEvent.click(nextBtn1);

  // Step 2: Fill address and click Next
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
  });
  fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '395007' } });
  fireEvent.change(screen.getByLabelText('House and society'), { target: { value: '101 Sunrise Apt' } });
  const nextBtn2 = screen.getByText('Next');
  fireEvent.click(nextBtn2);

  // Step 3: Payment
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Payment' })).toBeDefined();
  });
}

describe('CheckoutPage Razorpay Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentCart = [...mockCart];
    currentChild = mockChild;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows server total and methods from quote on step 3', async () => {
    vi.spyOn(orderApi, 'quote').mockResolvedValueOnce({
      lines: [
        {
          variant: 'var-1',
          sku: 'SHIRT-32',
          name: 'School Shirt',
          size: '32',
          quantity: 2,
          unit_price: '600.00',
          line_total: '1200.00',
        },
      ],
      subtotal: '1200.00',
      total: '1200.00',
      total_paise: 120000,
      currency: 'INR',
      payment_methods: ['ONLINE', 'COD'],
      reservation_minutes: 15,
    });

    renderCheckout();
    await advanceToStep3();

    // Check payment methods from quote
    await waitFor(() => {
      expect(screen.getByText('Pay online (UPI, card, netbanking)')).toBeDefined();
      expect(screen.getByText('Cash on delivery')).toBeDefined();
      // Server total from quote
      expect(screen.getByText('₹1,200')).toBeDefined();
    });
  });

  it('409 price_changed shows new total and asks parent to confirm again', async () => {
    vi.spyOn(orderApi, 'quote').mockResolvedValueOnce({
      lines: [],
      subtotal: '1000.00',
      total: '1000.00',
      total_paise: 100000,
      currency: 'INR',
      payment_methods: ['ONLINE', 'COD'],
      reservation_minutes: 15,
    });

    vi.spyOn(placeOrderService, 'submitOrder').mockRejectedValueOnce(
      new ApiError('Price changed while ordering.', 409, {
        code: 'price_changed',
        detail: 'Price changed while ordering. Review the new total before confirming.',
        quote: {
          lines: [],
          subtotal: '1100.00',
          total: '1100.00',
          total_paise: 110000,
          currency: 'INR',
          payment_methods: ['ONLINE', 'COD'],
          reservation_minutes: 15,
        },
      })
    );

    renderCheckout();
    await advanceToStep3();

    await waitFor(() => {
      expect(screen.getByText('Pay online (UPI, card, netbanking)')).toBeDefined();
    });

    // Select COD to test place order
    const codRadio = screen.getByDisplayValue('COD');
    fireEvent.click(codRadio);

    // Click Place Order
    const placeBtn = screen.getByRole('button', { name: /Place order/i });
    fireEvent.click(placeBtn);

    // 409 price_changed notice should appear and new total shown
    await waitFor(() => {
      expect(screen.getByText(/Prices have been updated/i)).toBeDefined();
      expect(screen.getByText('₹1,100')).toBeDefined();
    });
  });

  it('confirming and checking states never say paid', async () => {
    vi.spyOn(orderApi, 'quote').mockResolvedValueOnce({
      lines: [],
      subtotal: '1000.00',
      total: '1000.00',
      total_paise: 100000,
      currency: 'INR',
      payment_methods: ['ONLINE'],
      reservation_minutes: 15,
    });

    const deadline = new Date(Date.now() + 900_000).toISOString();
    const detail = contract.states.CHECKING.detail as Order;
    vi.spyOn(placeOrderService, 'submitOrder').mockResolvedValueOnce({
      ...detail, total: String(detail.total), fulfillment_type: detail.fulfillment_type!,
    });
    vi.spyOn(orderApi, 'payment').mockResolvedValueOnce({
      ...contract.start as PaymentStartResponse, hold_expires_at: deadline,
    });
    vi.spyOn(paymentAdapter, 'loadRazorpay').mockResolvedValue(true);
    const open = vi.spyOn(paymentAdapter, 'openRazorpayCheckout').mockImplementation(options => {
      options.modal?.ondismiss?.();
    });
    vi.spyOn(orderApi, 'reconcilePayment').mockResolvedValueOnce(
      contract.states.CHECKING.reconcile as PaymentReconcileResponse,
    );

    renderCheckout();
    await advanceToStep3();
    fireEvent.click(await screen.findByRole('button', { name: /Pay now/i }));

    expect(await screen.findByRole('heading', { name: 'Checking payment' })).toBeDefined();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      order_id: contract.start.razorpay_order_id, amount: contract.start.amount_paise, retry: { enabled: false },
    }));
    expect(screen.getByText(/A payment is still in progress/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDefined();
    expect(screen.queryByText(/Payment received/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Pay now|Try again|Pay cash/i })).toBeNull();
  });
});
