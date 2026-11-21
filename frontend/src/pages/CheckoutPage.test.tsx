// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckoutPage } from './CheckoutPage';
import { orderApi, ApiError } from '../api';
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
let currentSelection: any = { schoolId: 'school-1', schoolName: 'DPS Surat', cityName: 'Surat', stateName: 'Gujarat' };
let mockSchoolsList: any = [{ id: 'school-1', name: 'DPS Surat', state: 'Gujarat', city: 'Surat', homeDelivery: true, schoolPickup: true }];

vi.mock('../store/storeState', () => ({
  useStoreState: () => ({
    cart: currentCart,
    subtotalPaise: currentCart.reduce((sum, item) => sum + item.pricePaise * item.quantity, 0),
    clearCart: vi.fn(),
    selection: currentSelection,
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
    data: mockSchoolsList,
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
            onDone(currentChild)
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

    vi.spyOn(placeOrderService, 'submitOrder').mockResolvedValueOnce({
      id: 'order-123',
      order_number: 'SS-ORD-123',
      total: '1000.00',
      student_name: 'Aarav Patel',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      payment_status: 'PENDING',
      status: 'PLACED',
    });

    vi.spyOn(orderApi, 'payment').mockResolvedValueOnce({
      key_id: 'rzp_test_123',
      razorpay_order_id: 'order_test_123',
      amount_paise: 100000,
      amount: 1000,
      currency: 'INR',
      store_order_number: 'SS-ORD-123',
    });

    vi.spyOn(paymentAdapter, 'loadRazorpay').mockResolvedValue(true);

    let modalDismissHandler: (() => void) | undefined;
    let paymentSuccessHandler: ((response: any) => Promise<void>) | undefined;
    vi.spyOn(paymentAdapter, 'openRazorpayCheckout').mockImplementation((options: any) => {
      modalDismissHandler = options.modal?.ondismiss;
      paymentSuccessHandler = options.handler;
      return { open: vi.fn(), on: vi.fn() };
    });

    // Reconcile takes a moment so checking state can be observed
    let resolveReconcile: any;
    vi.spyOn(orderApi, 'reconcilePayment').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReconcile = resolve;
        })
    );

    // Verify returns confirming
    vi.spyOn(orderApi, 'verifyPayment').mockResolvedValueOnce({
      status: 'confirming',
      payment_status: 'PENDING',
      order_status: 'PLACED',
    });

    renderCheckout();
    await advanceToStep3();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pay now/i })).toBeDefined();
    });

    // Click Pay Now
    fireEvent.click(screen.getByRole('button', { name: /Pay now/i }));

    await waitFor(() => {
      expect(paymentAdapter.openRazorpayCheckout).toHaveBeenCalled();
    });

    // Case 1: Parent closes modal -> checking state
    act(() => {
      modalDismissHandler?.();
    });

    // In checking state:
    await waitFor(() => {
      expect(screen.getAllByText(/Checking your payment/i)[0]).toBeDefined();
    });
    // Must NEVER say "paid" or "Payment received" in checking state
    expect(screen.queryByText(/Payment received/i)).toBeNull();
    expect(screen.queryByText(/Order SS-ORD-123 is confirmed/i)).toBeNull();

    // Finish reconcile
    act(() => {
      resolveReconcile({
        id: 'order-123',
        order_number: 'SS-ORD-123',
        student_name: 'Aarav Patel',
        status: 'PLACED',
        payment_status: 'PENDING',
        payment_method: 'ONLINE',
        total: '1000.00',
        created_at: new Date().toISOString(),
        has_in_progress_attempt: false,
        last_attempt_failed: null,
      });
    });

    // Case 2: Success handler runs but server verify returned 'confirming'
    await act(async () => {
      await paymentSuccessHandler?.({
        razorpay_order_id: 'order_test_123',
        razorpay_payment_id: 'pay_test_123',
        razorpay_signature: 'sig_123',
      });
    });

    // In confirming state:
    await waitFor(() => {
      expect(screen.getByText(/confirming your payment/i)).toBeDefined();
    });
    // Must NEVER say "paid" or "Payment received" in confirming state
    expect(screen.queryByText(/Payment received/i)).toBeNull();
    expect(screen.queryByText(/Order SS-ORD-123 is confirmed/i)).toBeNull();
  });

  it('Try again is hidden while server reports attempt in progress', async () => {
    vi.spyOn(orderApi, 'quote').mockResolvedValueOnce({
      lines: [],
      subtotal: '1000.00',
      total: '1000.00',
      total_paise: 100000,
      currency: 'INR',
      payment_methods: ['ONLINE'],
      reservation_minutes: 15,
    });

    vi.spyOn(placeOrderService, 'submitOrder').mockResolvedValueOnce({
      id: 'order-456',
      order_number: 'SS-ORD-456',
      total: '1000.00',
      student_name: 'Aarav Patel',
      fulfillment_type: 'HOME_DELIVERY',
      payment_method: 'ONLINE',
      payment_status: 'PENDING',
      status: 'PLACED',
    });

    vi.spyOn(orderApi, 'payment').mockResolvedValueOnce({
      key_id: 'rzp_test_123',
      razorpay_order_id: 'order_test_456',
      amount_paise: 100000,
      amount: 1000,
      currency: 'INR',
      store_order_number: 'SS-ORD-456',
    });

    vi.spyOn(paymentAdapter, 'loadRazorpay').mockResolvedValue(true);

    let modalDismissHandler: (() => void) | undefined;
    vi.spyOn(paymentAdapter, 'openRazorpayCheckout').mockImplementation((options: any) => {
      modalDismissHandler = options.modal?.ondismiss;
      return { open: vi.fn(), on: vi.fn() };
    });

    // Reconcile reports attempt in progress!
    vi.spyOn(orderApi, 'reconcilePayment').mockResolvedValueOnce({
      id: 'order-456',
      order_number: 'SS-ORD-456',
      student_name: 'Aarav Patel',
      status: 'PLACED',
      payment_status: 'PENDING',
      payment_method: 'ONLINE',
      total: '1000.00',
      created_at: new Date().toISOString(),
      has_in_progress_attempt: true,
      last_attempt_failed: null,
    });

    renderCheckout();
    await advanceToStep3();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pay now/i })).toBeDefined();
    });

    // Click Pay Now
    fireEvent.click(screen.getByRole('button', { name: /Pay now/i }));

    await waitFor(() => {
      expect(paymentAdapter.openRazorpayCheckout).toHaveBeenCalled();
    });

    // Dismiss checkout modal
    act(() => {
      modalDismissHandler?.();
    });

    // Verify "A payment is still in progress" is displayed
    await waitFor(() => {
      expect(screen.getByText(/A payment is still in progress/i)).toBeDefined();
    });

    // "Check again" is available
    expect(screen.getByText('Check again')).toBeDefined();

    // "Try again" and "Pay cash on delivery instead" MUST BE HIDDEN while attempt is in progress!
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText('Pay cash on delivery instead')).toBeNull();
  });
});

describe('CheckoutPage Delivery Address and PIN Serviceability Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentCart = [...mockCart];
    currentChild = mockChild;
    currentSelection = { schoolId: 'school-1', schoolName: 'DPS Surat', cityName: 'Surat', stateName: 'Gujarat' };
    mockSchoolsList = [{ id: 'school-1', name: 'DPS Surat', state: 'Gujarat', city: 'Surat', homeDelivery: true, schoolPickup: true }];
  });

  afterEach(() => {
    cleanup();
  });

  it('non-Gujarat selection and school do not inherit Gujarat', async () => {
    currentSelection = { schoolId: 'school-punjab', schoolName: 'Cambridge Jalandhar', cityName: 'Jalandhar', stateName: 'Punjab' };
    mockSchoolsList = [{ id: 'school-punjab', name: 'Cambridge Jalandhar', state: 'Punjab', city: 'Jalandhar', homeDelivery: true, schoolPickup: true }];
    currentChild = { ...mockChild, school: 'school-punjab', school_name: 'Cambridge Jalandhar' };

    renderCheckout();

    // Advance to Step 2
    fireEvent.click(screen.getByText('Choose your child'));
    fireEvent.click(screen.getByText('Select Child'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
    });

    const stateSelect = screen.getByLabelText('State / Union Territory') as HTMLSelectElement;
    expect(stateSelect.value).toBe('Punjab');
    expect(stateSelect.value).not.toBe('Gujarat');
  });

  it('asks parent for state when location state is unknown and validates on step 2', async () => {
    currentSelection = { schoolId: 'school-unknown', schoolName: 'Unknown School' };
    mockSchoolsList = [{ id: 'school-unknown', name: 'Unknown School', homeDelivery: true, schoolPickup: true }];
    currentChild = { ...mockChild, school: 'school-unknown', school_name: 'Unknown School' };

    renderCheckout();

    // Advance to Step 2
    fireEvent.click(screen.getByText('Choose your child'));
    fireEvent.click(screen.getByText('Select Child'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
    });

    const stateSelect = screen.getByLabelText('State / Union Territory') as HTMLSelectElement;
    expect(stateSelect.value).toBe('');

    // Fill other fields except State
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '400001' } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByLabelText('House and society'), { target: { value: 'Flat 12, Marine Drive' } });

    // Click Next
    fireEvent.click(screen.getByText('Next'));

    // State error should appear
    await waitFor(() => {
      expect(screen.getByText('Please select your state or UT')).toBeDefined();
    });

    // Parent selects Maharashtra
    fireEvent.change(stateSelect, { target: { value: 'Maharashtra' } });
    expect(stateSelect.value).toBe('Maharashtra');
  });

  it('6-digit PIN lookup auto-fills geography when not manually touched', async () => {
    currentSelection = { schoolId: 'school-punjab', schoolName: 'Cambridge Jalandhar' };
    mockSchoolsList = [{ id: 'school-punjab', name: 'Cambridge Jalandhar', homeDelivery: true, schoolPickup: true }];
    currentChild = { ...mockChild, school: 'school-punjab', school_name: 'Cambridge Jalandhar' };

    const lookupSpy = vi.spyOn(orderApi, 'pincodeLookup').mockResolvedValueOnce({
      pincode: '144008',
      format_valid: true,
      geography: {
        found: true,
        pincode: '144008',
        city: 'Jalandhar',
        state: 'Punjab',
      },
      serviceability: {
        status: 'UNKNOWN',
        message: 'Courier serviceability unconfirmed.',
        provider: null,
      },
    });

    renderCheckout();

    // Advance to Step 2
    fireEvent.click(screen.getByText('Choose your child'));
    fireEvent.click(screen.getByText('Select Child'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
    });

    // Enter 6-digit PIN
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '144008' } });

    await waitFor(() => {
      expect(lookupSpy).toHaveBeenCalledWith('144008');
    });

    await waitFor(() => {
      const cityInput = screen.getByLabelText('City') as HTMLInputElement;
      const stateSelect = screen.getByLabelText('State / Union Territory') as HTMLSelectElement;
      expect(cityInput.value).toBe('Jalandhar');
      expect(stateSelect.value).toBe('Punjab');
      // Unconfirmed serviceability displays honest message, never promises delivery
      expect(screen.getByText(/Courier delivery unconfirmed/i)).toBeDefined();
      expect(screen.queryByText(/Home delivery available to this PIN/i)).toBeNull();
    });
  });

  it('6-digit PIN lookup does not override manually corrected city or state', async () => {
    currentSelection = { schoolId: 'school-punjab', schoolName: 'Cambridge Jalandhar' };
    mockSchoolsList = [{ id: 'school-punjab', name: 'Cambridge Jalandhar', homeDelivery: true, schoolPickup: true }];
    currentChild = { ...mockChild, school: 'school-punjab', school_name: 'Cambridge Jalandhar' };

    vi.spyOn(orderApi, 'pincodeLookup').mockResolvedValue({
      pincode: '144001',
      format_valid: true,
      geography: {
        found: true,
        pincode: '144001',
        city: 'Jalandhar',
        state: 'Punjab',
      },
      serviceability: {
        status: 'UNKNOWN',
        message: 'Courier serviceability unconfirmed.',
        provider: null,
      },
    });

    renderCheckout();

    // Advance to Step 2
    fireEvent.click(screen.getByText('Choose your child'));
    fireEvent.click(screen.getByText('Select Child'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
    });

    // Parent manually enters their custom city and state first
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Phagwara' } });
    fireEvent.change(screen.getByLabelText('State / Union Territory'), { target: { value: 'Punjab' } });

    // Now parent enters PIN
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '144001' } });

    await waitFor(() => {
      const cityInput = screen.getByLabelText('City') as HTMLInputElement;
      // Must NOT override manually entered "Phagwara" with "Jalandhar"!
      expect(cityInput.value).toBe('Phagwara');
    });
  });

  it('pickup works without a home address (no street, city, state, or PIN required)', async () => {
    renderCheckout();

    // Advance to Step 2
    fireEvent.click(screen.getByText('Choose your child'));
    fireEvent.click(screen.getByText('Select Child'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
    });

    // Select School Pickup
    const pickupRadio = screen.getByRole('radio', { name: /Collect at school/i });
    fireEvent.click(pickupRadio);

    // Click Next without filling any address fields
    const nextBtn = screen.getByText('Next');
    fireEvent.click(nextBtn);

    // Should successfully advance to Step 3 (Payment) without errors
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Payment' })).toBeDefined();
    });
  });

  it('serviceability check failure shows unconfirmed unknown status, not serviceable', async () => {
    vi.spyOn(orderApi, 'pincodeLookup').mockRejectedValueOnce(new Error('Network failure'));

    renderCheckout();

    // Advance to Step 2
    fireEvent.click(screen.getByText('Choose your child'));
    fireEvent.click(screen.getByText('Select Child'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '395007' } });

    await waitFor(() => {
      expect(screen.getByText(/Courier delivery unconfirmed/i)).toBeDefined();
      expect(screen.queryByText(/Home delivery available to this PIN/i)).toBeNull();
    });
  });
});
