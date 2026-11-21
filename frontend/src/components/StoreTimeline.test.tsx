import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Timeline, OrderTrackingBlock, getOrderStatusLabel } from './Store';
import { setLang, translate } from '../i18n';
import type { Order } from '../api';
import { siteConfig } from '../siteConfig';

describe('Timeline component tests', () => {
  beforeEach(() => {
    setLang('en');
  });

  afterEach(() => {
    setLang('en');
  });

  describe('Home Delivery steps', () => {
    it('renders PLACED status with aria-current="step" on Placed', () => {
      const order: Order = {
        id: 'ord-1',
        order_number: 'ORD-001',
        student_name: 'Test Child',
        status: 'PLACED',
        payment_status: 'PENDING',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [{ key: 'PLACED', at: '2026-11-20T10:00:00Z' }],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toContain('<ol class="timeline"');
      expect(html).toContain('<b>Placed</b>');
      expect(html).toContain('<b>Confirmed</b>');
      expect(html).toContain('<b>Packed</b>');
      expect(html).toContain('<b>Sent by India Post</b>');
      expect(html).toContain('<b>Delivered</b>');
      expect(html).toContain('aria-current="step"');
      // Placed step has aria-current and done
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>1<\/span><div><b>Placed<\/b>/);
    });

    it('renders CONFIRMED status with aria-current="step" on Confirmed and Placed done', () => {
      const order: Order = {
        id: 'ord-2',
        order_number: 'ORD-002',
        student_name: 'Test Child',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [
            { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
            { key: 'CONFIRMED', at: '2026-11-20T10:05:00Z' },
          ],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>2<\/span><div><b>Confirmed<\/b>/);
      // Placed is done
      expect(html).toMatch(/<li[^>]*class="done"[^>]*><span>1<\/span><div><b>Placed<\/b>/);
    });

    it('renders PACKED status with aria-current="step" on Packed', () => {
      const order: Order = {
        id: 'ord-3',
        order_number: 'ORD-003',
        student_name: 'Test Child',
        status: 'PACKED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [
            { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
            { key: 'CONFIRMED', at: '2026-11-20T10:05:00Z' },
            { key: 'PACKED', at: '2026-11-20T11:00:00Z' },
          ],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>3<\/span><div><b>Packed<\/b>/);
    });

    it('renders DISPATCHED status with "Sent by India Post" and tracking block', () => {
      const order: Order = {
        id: 'ord-4',
        order_number: 'ORD-004',
        student_name: 'Test Child',
        status: 'DISPATCHED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: 'INDIA_POST',
          consignment_number: 'EE123456785IN',
          dispatched_at: '2026-11-20T14:00:00Z',
          delivered_at: null,
          steps: [
            { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
            { key: 'CONFIRMED', at: '2026-11-20T10:05:00Z' },
            { key: 'PACKED', at: '2026-11-20T11:00:00Z' },
            { key: 'DISPATCHED', at: '2026-11-20T14:00:00Z' },
          ],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toContain('<b>Sent by India Post</b>');
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>4<\/span><div><b>Sent by India Post<\/b>/);
      // Tracking block rendered
      expect(html).toContain('India Post tracking number');
      expect(html).toContain('EE123456785IN');
      expect(html).toContain('Copy');
    });

    it('renders DELIVERED status with aria-current="step" on Delivered', () => {
      const order: Order = {
        id: 'ord-5',
        order_number: 'ORD-005',
        student_name: 'Test Child',
        status: 'DELIVERED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: 'INDIA_POST',
          consignment_number: 'EE123456785IN',
          dispatched_at: '2026-11-20T14:00:00Z',
          delivered_at: '2026-11-21T09:00:00Z',
          steps: [
            { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
            { key: 'CONFIRMED', at: '2026-11-20T10:05:00Z' },
            { key: 'PACKED', at: '2026-11-20T11:00:00Z' },
            { key: 'DISPATCHED', at: '2026-11-20T14:00:00Z' },
            { key: 'DELIVERED', at: '2026-11-21T09:00:00Z' },
          ],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toContain('<b>Delivered</b>');
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>5<\/span><div><b>Delivered<\/b>/);
    });
  });

  describe('School Pickup steps', () => {
    it('renders "Ready at school" for DISPATCHED and "Collected" for DELIVERED', () => {
      const dispatchedPickup: Order = {
        id: 'ord-p1',
        order_number: 'ORD-P1',
        student_name: 'Pickup Child',
        status: 'DISPATCHED',
        payment_status: 'PAID',
        fulfillment_type: 'SCHOOL_PICKUP',
        total: 300,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: '2026-11-20T12:00:00Z',
          delivered_at: null,
          steps: [
            { key: 'PLACED', at: '2026-11-20T10:00:00Z' },
            { key: 'CONFIRMED', at: '2026-11-20T10:05:00Z' },
            { key: 'PACKED', at: '2026-11-20T11:00:00Z' },
            { key: 'DISPATCHED', at: '2026-11-20T12:00:00Z' },
          ],
        },
      };

      const htmlDispatched = renderToString(<Timeline order={dispatchedPickup} />);
      expect(htmlDispatched).toContain('<b>Ready at school</b>');
      expect(htmlDispatched).toContain('<b>Collected</b>');
      expect(htmlDispatched).not.toContain('Sent by India Post');
      expect(htmlDispatched).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>4<\/span><div><b>Ready at school<\/b>/);
      // No India Post tracking block for pickup
      expect(htmlDispatched).not.toContain('India Post tracking number');

      const deliveredPickup: Order = {
        ...dispatchedPickup,
        status: 'DELIVERED',
        tracking: {
          ...dispatchedPickup.tracking!,
          delivered_at: '2026-11-21T10:00:00Z',
          steps: [
            ...dispatchedPickup.tracking!.steps,
            { key: 'DELIVERED', at: '2026-11-21T10:00:00Z' },
          ],
        },
      };

      const htmlDelivered = renderToString(<Timeline order={deliveredPickup} />);
      expect(htmlDelivered).toContain('<b>Collected</b>');
      expect(htmlDelivered).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>5<\/span><div><b>Collected<\/b>/);
    });
  });

  describe('PROCESSING status', () => {
    it('counts PROCESSING as Confirmed done with date and aria-current="step"', () => {
      const order: Order = {
        id: 'ord-proc',
        order_number: 'ORD-PROC',
        student_name: 'Proc Child',
        status: 'PROCESSING',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 450,
        created_at: '2026-11-20T09:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [
            { key: 'PLACED', at: '2026-11-20T09:00:00Z' },
            { key: 'PROCESSING', at: '2026-11-20T09:30:00Z' },
          ],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      // Confirmed step is done AND current
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>2<\/span><div><b>Confirmed<\/b>/);
      // Placed is done
      expect(html).toMatch(/<li[^>]*class="done"[^>]*><span>1<\/span><div><b>Placed<\/b>/);
      // Date from PROCESSING event is rendered under Confirmed
      expect(html).toContain('20 Nov 2026');
    });
  });

  describe('CANCELLED and RETURNED statuses', () => {
    it('renders single line for CANCELLED unpaid without step bar', () => {
      const order: Order = {
        id: 'ord-canc-unpaid',
        order_number: 'ORD-CANC-1',
        student_name: 'Cancelled Child',
        status: 'CANCELLED',
        payment_status: 'FAILED',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [{ key: 'CANCELLED', at: '2026-11-20T10:15:00Z' }],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).not.toContain('<ol class="timeline"');
      expect(html).toContain('Payment was not completed, so this order was cancelled.');
      expect(html).toContain('20 Nov 2026');
    });

    it('renders single line for CANCELLED paid without step bar', () => {
      const order: Order = {
        id: 'ord-canc-paid',
        order_number: 'ORD-CANC-2',
        student_name: 'Cancelled Child 2',
        status: 'CANCELLED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [{ key: 'CANCELLED', at: '2026-11-20T11:00:00Z' }],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).not.toContain('<ol class="timeline"');
      expect(html).toContain('This order was cancelled.');
      expect(html).not.toContain('Payment was not completed');
    });

    it('renders single line for RETURNED without step bar', () => {
      const order: Order = {
        id: 'ord-ret',
        order_number: 'ORD-RET-1',
        student_name: 'Returned Child',
        status: 'RETURNED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: null,
          consignment_number: null,
          dispatched_at: null,
          delivered_at: null,
          steps: [{ key: 'RETURNED', at: '2026-11-21T15:00:00Z' }],
        },
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).not.toContain('<ol class="timeline"');
      expect(html).toContain('This order was returned.');
      expect(html).toContain('21 Nov 2026');
    });
  });

  describe('Legacy statuses PENDING and SHIPPED', () => {
    it('maps legacy PENDING to Placed', () => {
      const order: Order = {
        id: 'ord-leg-1',
        order_number: 'ORD-LEG-1',
        student_name: 'Legacy Child',
        status: 'PENDING',
        payment_status: 'PENDING',
        total: 200,
        created_at: '2026-11-20T10:00:00Z',
      };
      const html = renderToString(<Timeline order={order} />);
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>1<\/span><div><b>Placed<\/b>/);
    });

    it('maps legacy SHIPPED to Sent by India Post', () => {
      const order: Order = {
        id: 'ord-leg-2',
        order_number: 'ORD-LEG-2',
        student_name: 'Legacy Child 2',
        status: 'SHIPPED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 200,
        created_at: '2026-11-20T10:00:00Z',
        tracking: {
          carrier: 'INDIA_POST',
          consignment_number: 'EE123456785IN',
          dispatched_at: '2026-11-20T12:00:00Z',
          delivered_at: null,
          steps: [{ key: 'SHIPPED', at: '2026-11-20T12:00:00Z' }],
        },
      };
      const html = renderToString(<Timeline order={order} />);
      expect(html).toMatch(/<li[^>]*class="[^"]*current[^"]*done[^"]*"[^>]*aria-current="step"[^>]*><span>4<\/span><div><b>Sent by India Post<\/b>/);
    });
  });

  describe('Translations in Gujarati and Hindi', () => {
    it('renders timeline labels in Gujarati', () => {
      setLang('gu');
      const order: Order = {
        id: 'ord-gu',
        order_number: 'ORD-GU',
        student_name: 'ગુજરાતી બાળક',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toContain('<b>ઓર્ડર થયો</b>');
      expect(html).toContain('<b>કન્ફર્મ થયો</b>');
      expect(html).toContain('<b>પેક થયો</b>');
      expect(html).toContain('<b>ઇન્ડિયા પોસ્ટ દ્વારા મોકલાયું</b>');
      expect(html).toContain('<b>પહોંચી ગયું</b>');
      expect(html).toContain('પ્રગતિમાં છે');
    });

    it('renders timeline labels in Hindi', () => {
      setLang('hi');
      const order: Order = {
        id: 'ord-hi',
        order_number: 'ORD-HI',
        student_name: 'हिंदी बच्चा',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 500,
        created_at: '2026-11-20T10:00:00Z',
      };

      const html = renderToString(<Timeline order={order} />);
      expect(html).toContain('<b>ऑर्डर हुआ</b>');
      expect(html).toContain('<b>पुष्टि हुई</b>');
      expect(html).toContain('<b>पैक हुआ</b>');
      expect(html).toContain('<b>इंडिया पोस्ट द्वारा भेजा गया</b>');
      expect(html).toContain('<b>पहुँचा दिया गया</b>');
      expect(html).toContain('प्रगति पर है');
    });
  });

  describe('Status badge helper getOrderStatusLabel', () => {
    it('returns translated step labels for card badges', () => {
      const orderHome: Order = {
        id: 'o-1',
        order_number: 'O1',
        student_name: 'Child',
        status: 'DISPATCHED',
        payment_status: 'PAID',
        fulfillment_type: 'HOME_DELIVERY',
        total: 100,
        created_at: '2026-11-20T10:00:00Z',
      };
      expect(getOrderStatusLabel(orderHome, (k) => translate('en', k))).toBe('Sent by India Post');
      expect(getOrderStatusLabel(orderHome, (k) => translate('gu', k))).toBe('ઇન્ડિયા પોસ્ટ દ્વારા મોકલાયું');

      const orderPickup: Order = {
        ...orderHome,
        fulfillment_type: 'SCHOOL_PICKUP',
      };
      expect(getOrderStatusLabel(orderPickup, (k) => translate('en', k))).toBe('Ready at school');
      expect(getOrderStatusLabel(orderPickup, (k) => translate('gu', k))).toBe('શાળાએ તૈયાર છે');
    });
  });
});
