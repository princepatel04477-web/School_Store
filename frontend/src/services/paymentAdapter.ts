/**
 * Real Razorpay checkout loader and payment adapter.
 */

declare global {
  interface Window {
    Razorpay?: any;
  }
}

let scriptPromise: Promise<boolean> | null = null;

export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      scriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  timeout?: number;
  retry?: { enabled: boolean };
  prefill?: {
    name?: string;
    contact?: string;
    email?: string;
  };
  notes?: Record<string, string>;
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: {
    ondismiss?: () => void;
  };
  onPaymentFailed?: (response: any) => void;
}

export function openRazorpayCheckout(options: RazorpayOptions): any {
  if (!window.Razorpay) {
    throw new Error('Razorpay SDK not loaded');
  }
  const rzp = new window.Razorpay(options);
  if (options.onPaymentFailed) {
    rzp.on('payment.failed', options.onPaymentFailed);
  }
  rzp.open();
  return rzp;
}
