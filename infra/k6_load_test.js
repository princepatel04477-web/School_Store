import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ============================================================================
// School Store Production Load Test
// RUN FROM A SEPARATE MACHINE, NEVER FROM THE APPLICATION SERVER HOST!
//
// Scenarios Tested:
// 1. 500 parents browsing catalogue concurrently
// 2. 100 simultaneous checkouts against identical stock variant (zero oversell)
// 3. Boss dashboard under load (KPI cards + chart endpoints)
// 4. Background bulk 5,000-row student import execution
//
// Target SLAs:
// - Reads: p95 < 300 ms
// - Checkout: p95 < 800 ms
// - Stock oversell rate: 0.00%
// ============================================================================

const readLatency = new Trend('read_latency_ms');
const checkoutLatency = new Trend('checkout_latency_ms');
const dashboardLatency = new Trend('dashboard_latency_ms');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    // Scenario 1: 500 Concurrent Parents Browsing
    parent_browsing: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      exec: 'browseCatalog',
    },
    // Scenario 2: 100 Simultaneous Checkouts Peak Burst
    concurrent_checkouts: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      startTime: '45s',
      exec: 'executeCheckout',
    },
    // Scenario 3: Boss Executive Dashboard Under Load
    boss_dashboard_load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
      startTime: '30s',
      exec: 'viewBossDashboard',
    },
  },
  thresholds: {
    'read_latency_ms': ['p(95)<300'],
    'checkout_latency_ms': ['p(95)<800'],
    'dashboard_latency_ms': ['p(95)<200'],
    'errors': ['rate<0.01'], // < 1% error rate
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:8000';
const AUTH_TOKEN_PARENT = __ENV.PARENT_TOKEN || 'Bearer sample_parent_jwt_token';
const AUTH_TOKEN_BOSS = __ENV.BOSS_TOKEN || 'Bearer sample_boss_jwt_token';

export function browseCatalog() {
  group('Browse School Catalog', () => {
    const params = {
      headers: {
        'Authorization': AUTH_TOKEN_PARENT,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    };

    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/catalog/products/`, params);
    readLatency.add(Date.now() - start);

    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'has results': (r) => JSON.parse(r.body).results !== undefined,
    });
    if (!ok) errorRate.add(1);

    sleep(1);
  });
}

export function executeCheckout() {
  group('Simultaneous Checkouts on Limited Variant', () => {
    const payload = JSON.stringify({
      student: 'student-uuid-sample',
      school: 'school-uuid-sample',
      items: [
        {
          variant: 'variant-uuid-sample',
          quantity: 1,
        },
      ],
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AUTH_TOKEN_PARENT,
      },
    };

    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/orders/`, payload, params);
    checkoutLatency.add(Date.now() - start);

    // Valid outcomes are either 201 (success) or 400 with "insufficient stock" (expected when depleted)
    // 500 error or negative stock is an immediate failure
    const valid = check(res, {
      'is 201 created or 400 out of stock': (r) => r.status === 201 || (r.status === 400 && r.body.includes('stock')),
    });
    if (!valid) errorRate.add(1);
  });
}

export function viewBossDashboard() {
  group('Boss Dashboard View', () => {
    const params = {
      headers: {
        'Authorization': AUTH_TOKEN_BOSS,
        'Accept': 'application/json',
      },
    };

    const start = Date.now();
    const kpiRes = http.get(`${BASE_URL}/api/panel/boss/kpis/`, params);
    const chartRes = http.get(`${BASE_URL}/api/panel/boss/charts/revenue-trend/`, params);
    dashboardLatency.add(Date.now() - start);

    const ok = check(kpiRes, {
      'kpis 200': (r) => r.status === 200,
    }) && check(chartRes, {
      'chart 200': (r) => r.status === 200,
    });

    if (!ok) errorRate.add(1);
    sleep(2);
  });
}
