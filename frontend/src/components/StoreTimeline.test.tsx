// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Timeline } from './Store';
import { setLang } from '../i18n';
import type { Order } from '../api';

function renderTimeline(order: Partial<Order>) {
  const baseOrder: Order = {
    id: 'ord-test-123',
    order_number: 'ORD-2026-0001',
    student_name: 'Aarav Sharma',
    student_gr: 'GR-101',
    status: 'PLACED',
    payment_status: 'PENDING',
    payment_method: 'COD',
    fulfillment_type: 'HOME_DELIVERY',
    items: [],
    subtotal: 500,
    total: 500,
    created_at: '2026-11-20T10:00:00Z',
    ...order,
  };

  return render(
    <MemoryRouter>
      <Timeline order={baseOrder} />
    </MemoryRouter>
  );
}

describe('Timeline component (Order tracking)', () => {
  beforeEach(() => {
    setLang('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders home delivery steps with Dispatched and Delivered', () => {
    renderTimeline({
      fulfillment_type: 'HOME_DELIVERY',
      status: 'CONFIRMED',
      status_events: [
        { id: '1', status: 'PLACED', status_display: 'Placed', changed_at: '2026-11-20T10:00:00Z' },
        { id: '2', status: 'CONFIRMED', status_display: 'Confirmed', changed_at: '2026-11-20T10:30:00Z' },
      ],
    });

    expect(screen.getByText('Placed')).toBeDefined();
    expect(screen.getByText('Confirmed')).toBeDefined();
    expect(screen.getByText('Packed')).toBeDefined();
    expect(screen.getByText('Dispatched')).toBeDefined();
    expect(screen.getByText('Delivered')).toBeDefined();

    // Must NOT contain pickup step labels
    expect(screen.queryByText('Ready at school')).toBeNull();
    expect(screen.queryByText('Collected')).toBeNull();
  });

  it('renders school pickup steps and does not claim courier tracking', () => {
    renderTimeline({
      fulfillment_type: 'SCHOOL_PICKUP',
      status: 'READY_FOR_PICKUP',
      delivery_details: {
        delivery_type: 'SCHOOL_PICKUP',
        pickup_location: 'Admin Office, Room 4',
        pickup_timings: '9 AM - 2 PM',
      },
      status_events: [
        { id: '1', status: 'PLACED', status_display: 'Placed', changed_at: '2026-11-20T10:00:00Z' },
        { id: '2', status: 'CONFIRMED', status_display: 'Confirmed', changed_at: '2026-11-20T10:30:00Z' },
        { id: '3', status: 'PACKED', status_display: 'Packed', changed_at: '2026-11-20T11:00:00Z' },
        { id: '4', status: 'READY_FOR_PICKUP', status_display: 'Ready for pickup', changed_at: '2026-11-20T11:30:00Z' },
      ],
    });

    expect(screen.getByText('Ready at school')).toBeDefined();
    expect(screen.getByText('Collected')).toBeDefined();
    expect(screen.queryByText('Dispatched')).toBeNull();
    expect(screen.queryByText('Delivered')).toBeNull();

    // Verify pickup location & timings are displayed
    expect(screen.getByText(/Admin Office, Room 4/)).toBeDefined();
    expect(screen.getByText(/9 AM - 2 PM/)).toBeDefined();

    // Verify courier tracking is NOT claimed
    expect(screen.queryByText(/courier tracking/i)).toBeNull();
    expect(screen.queryByText(/tracking link/i)).toBeNull();
  });

  it('renders PROCESSING status with preceding steps completed and current step as Processing', () => {
    renderTimeline({
      fulfillment_type: 'HOME_DELIVERY',
      status: 'PROCESSING',
      status_events: [
        { id: '1', status: 'PLACED', status_display: 'Placed', changed_at: '2026-11-20T10:00:00Z' },
        { id: '2', status: 'CONFIRMED', status_display: 'Confirmed', changed_at: '2026-11-20T10:15:00Z' },
        { id: '3', status: 'PROCESSING', status_display: 'Processing', changed_at: '2026-11-20T10:45:00Z' },
      ],
    });

    // Step 3 shows Processing
    expect(screen.getByText('Processing')).toBeDefined();
    expect(screen.getByText('Placed')).toBeDefined();
    expect(screen.getByText('Confirmed')).toBeDefined();
  });

  it('renders CANCELLED status showing exceptional card without wiping past milestone history', () => {
    renderTimeline({
      fulfillment_type: 'HOME_DELIVERY',
      status: 'CANCELLED',
      status_events: [
        { id: '1', status: 'PLACED', status_display: 'Placed', changed_at: '2026-11-20T10:00:00Z' },
        { id: '2', status: 'CONFIRMED', status_display: 'Confirmed', changed_at: '2026-11-20T10:15:00Z' },
        { id: '3', status: 'CANCELLED', status_display: 'Cancelled', changed_at: '2026-11-20T11:00:00Z' },
      ],
    });

    // Milestone steps still present
    expect(screen.getByText('Placed')).toBeDefined();
    expect(screen.getByText('Confirmed')).toBeDefined();

    // Exceptional notice is present
    expect(screen.getByText(/returned to school stock/i)).toBeDefined();
  });

  it('maps legacy SHIPPED and PENDING statuses smoothly', () => {
    const { unmount } = renderTimeline({
      fulfillment_type: 'HOME_DELIVERY',
      status: 'SHIPPED',
    });
    expect(screen.getByText('Dispatched')).toBeDefined();
    unmount();

    renderTimeline({
      fulfillment_type: 'HOME_DELIVERY',
      status: 'PENDING',
    });
    expect(screen.getByText('Placed')).toBeDefined();
  });
});
