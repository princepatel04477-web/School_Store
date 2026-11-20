import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const reqDuration = new Trend('req_duration', true);
export const requestCount = new Counter('requests');

// Load parent tokens exported by seed_perf_parents
const tokensFilePath = __ENV.TOKENS_FILE || 'C:\\Users\\rebel\\AppData\\Local\\Temp\\perf_parent_tokens.json';
let parents = [];
try {
  parents = JSON.parse(open(tokensFilePath));
} catch (e) {
  // Fallback for syntax check or dry run
  parents = [
    {
      user_id: 'default',
      username: 'perf_parent_5000000001',
      token: 'dummy_token',
      order_ids: ['dummy_order_id'],
      child_ids: ['dummy_child_id'],
    },
  ];
}

export const options = {
  stages: [
    { duration: '30s', target: 1 },    // Warm-up
    { duration: '2m', target: 1 },     // 1 VU
    { duration: '30s', target: 5 },    // Transition
    { duration: '2m', target: 5 },     // 5 VUs
    { duration: '30s', target: 10 },   // Transition
    { duration: '2m', target: 10 },    // 10 VUs
    { duration: '30s', target: 25 },   // Transition
    { duration: '2m', target: 25 },    // 25 VUs
    { duration: '30s', target: 50 },   // Transition
    { duration: '2m', target: 50 },    // 50 VUs
    { duration: '30s', target: 100 },  // Transition
    { duration: '2m', target: 100 },   // 100 VUs
    { duration: '30s', target: 0 },    // Cool-down
  ],
  thresholds: {
    errors: ['rate<0.01'],             // Error rate < 1%
    http_req_duration: ['p(95)<2000'],  // p95 < 2s
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8000/api';

export default function () {
  // Select a parent from the pool based on VU ID or random
  const parent = parents[(__VU - 1) % parents.length] || parents[0];
  const params = {
    headers: {
      Authorization: `Bearer ${parent.token}`,
      'Content-Type': 'application/json',
    },
  };

  // Parent mix:
  // 50% List orders: GET /api/orders/
  // 30% Order detail: GET /api/orders/{id}/
  // 20% List students: GET /api/students/
  const roll = Math.random();
  let res;

  if (roll < 0.50) {
    // List orders
    res = http.get(`${BASE_URL}/orders/`, params);
    check(res, {
      'orders list status is 200': (r) => r.status === 200,
    });
  } else if (roll < 0.80) {
    // Open one order detail
    const orderId = (parent.order_ids && parent.order_ids.length > 0)
      ? parent.order_ids[Math.floor(Math.random() * parent.order_ids.length)]
      : '';
    if (orderId) {
      res = http.get(`${BASE_URL}/orders/${orderId}/`, params);
      check(res, {
        'order detail status is 200': (r) => r.status === 200,
      });
    } else {
      res = http.get(`${BASE_URL}/orders/`, params);
    }
  } else {
    // List students (associated children)
    res = http.get(`${BASE_URL}/students/`, params);
    check(res, {
      'students list status is 200': (r) => r.status === 200,
    });
  }

  requestCount.add(1);
  reqDuration.add(res.timings.duration);
  errorRate.add(res.status !== 200);

  // Think time between actions (0.5s - 1.5s)
  sleep(0.5 + Math.random());
}
