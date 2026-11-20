import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const reqDuration = new Trend('req_duration', true);
export const requestCount = new Counter('requests');

// Execution options matching Prompt 5 requirements
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

// Seeded IDs for catalog navigation
const CITIES = [
  'd11c98ef-cedb-4c8d-8d9f-d732e04adbc8', // Surat
  'cb90d586-af9a-4a92-b578-ad67cf8e289f', // Ahmedabad
];

const SCHOOLS = [
  '0cb66c67-d510-4b6f-877a-650335ab9ed4', // DPS Surat
  '76dad4bf-291d-4db2-9395-44dc3e9569f0', // Fountainhead Surat
  'b918b1d9-2fcf-42bc-9ef9-50e199ed0130', // Udgam Ahmedabad
];

const CLASSES = ['Class 1', 'Class 2', 'Class 5', 'Class 8', 'Class 10'];
const GENDERS = ['boy', 'girl'];

export default function () {
  // Weighted catalog visit mix:
  // 25% schools list
  // 15% states list
  // 15% cities list
  // 15% city branches
  // 10% grades list
  // 20% products for school/class/gender
  const roll = Math.random();
  let res;

  if (roll < 0.25) {
    // 1. Schools list
    res = http.get(`${BASE_URL}/public/schools/`);
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else if (roll < 0.40) {
    // 2. States list
    res = http.get(`${BASE_URL}/public/states/`);
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else if (roll < 0.55) {
    // 3. Cities list
    res = http.get(`${BASE_URL}/public/cities/?state=Gujarat`);
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else if (roll < 0.70) {
    // 4. City branches
    const cityId = CITIES[Math.floor(Math.random() * CITIES.length)];
    res = http.get(`${BASE_URL}/public/cities/${cityId}/branches/`);
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else if (roll < 0.80) {
    // 5. Grades list
    res = http.get(`${BASE_URL}/public/grades/`);
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else {
    // 6. Products list for school/class/gender
    const schoolId = SCHOOLS[Math.floor(Math.random() * SCHOOLS.length)];
    const className = CLASSES[Math.floor(Math.random() * CLASSES.length)];
    const gender = GENDERS[Math.floor(Math.random() * GENDERS.length)];
    res = http.get(`${BASE_URL}/public/products/?school=${schoolId}&class=${encodeURIComponent(className)}&gender=${gender}`);
    check(res, { 'status is 200': (r) => r.status === 200 });
  }

  requestCount.add(1);
  reqDuration.add(res.timings.duration);
  errorRate.add(res.status !== 200);

  // Think time between clicks (0.5s - 1.5s)
  sleep(0.5 + Math.random());
}
