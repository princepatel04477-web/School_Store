// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { orderErrorMessage, pickedBranch, prepareOrder, submitOrder } from './placeOrder';

const CHAIN = 'school-chain';
const CAMPUS = 'branch-chainpur';

function order(extra: Partial<Parameters<typeof prepareOrder>[0]> = {}) {
  return {
    student: 'child-1',
    fulfillment_type: 'SCHOOL_PICKUP' as const,
    payment_method: 'COD' as const,
    delivery_details: { recipient_name: 'Parent', phone: '9876543210' },
    items: [{ variant: 'variant-1', quantity: 1 }],
    ...extra,
  };
}

describe('the campus picked in the shop', () => {
  it('is sent when it is a campus of the child’s school', () => {
    expect(pickedBranch({ schoolId: CHAIN, branchId: CAMPUS }, CHAIN)).toEqual({ branch: CAMPUS });
  });

  it('is left out for another school, or when no campus was picked', () => {
    expect(pickedBranch({ schoolId: CHAIN, branchId: CAMPUS }, 'school-other')).toEqual({});
    expect(pickedBranch({ schoolId: CHAIN }, CHAIN)).toEqual({});
    expect(pickedBranch(null, CHAIN)).toEqual({});
    expect(pickedBranch({ schoolId: CHAIN, branchId: CAMPUS }, undefined)).toEqual({});
  });
});

describe('checkout sends the campus with the order', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the branch in the order body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'o1', order_number: 'ORD-1', total: '100.00', fulfillment_type: 'SCHOOL_PICKUP' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = prepareOrder(order(pickedBranch({ schoolId: CHAIN, branchId: CAMPUS }, CHAIN)));
    await submitOrder(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/orders/');
    expect(JSON.parse(String(init.body))).toMatchObject({ student: 'child-1', branch: CAMPUS });
  });

  it('a different campus is a different order, so it gets a new key', () => {
    localStorage.setItem('access', 'token'); // signed in, so the attempt is saved
    const first = prepareOrder(order({ branch: CAMPUS }));
    const again = prepareOrder(order({ branch: CAMPUS }));
    const other = prepareOrder(order({ branch: 'branch-otherpur' }));
    expect(again.idempotency_key).toBe(first.idempotency_key);
    expect(other.idempotency_key).not.toBe(first.idempotency_key);
  });
});

describe('campus refusals become words a parent can act on', () => {
  it('names a campus mismatch', () => {
    const err = new ApiError('bad', 400, { branch: ["This campus is not the child's campus."] });
    expect(orderErrorMessage(err)).toBe('err.wrongCampus');
  });

  it('asks for a campus when none was picked', () => {
    const err = new ApiError('bad', 400, { branch: ["Choose the child's campus before placing the order."] });
    expect(orderErrorMessage(err)).toBe('err.chooseCampus');
  });
});
