export interface PaymentRequest {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  method: 'UPI' | 'CARD' | 'NETBANKING' | 'COD';
  customer: {
    name: string;
    phone: string;
    email: string;
  };
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  gatewayReference?: string;
  error?: string;
}

export interface PaymentAdapter {
  getAvailableMethods(): ('UPI' | 'CARD' | 'NETBANKING' | 'COD')[];
  initiatePayment(request: PaymentRequest): Promise<PaymentResponse>;
}

/**
 * Clean mock adapter for UI verification without storing card credentials or fake calls.
 * Replaced cleanly with Razorpay/Cashfree/Stripe SDK when real credentials are configured.
 */
export class MockPaymentAdapter implements PaymentAdapter {
  getAvailableMethods(): ('UPI' | 'CARD' | 'NETBANKING' | 'COD')[] {
    return ['UPI', 'CARD', 'NETBANKING', 'COD'];
  }

  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Artificial brief UI delay simulating handshake
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      success: true,
      transactionId: `TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      gatewayReference: `REF_${request.method}`,
    };
  }
}

export const paymentAdapter: PaymentAdapter = new MockPaymentAdapter();
