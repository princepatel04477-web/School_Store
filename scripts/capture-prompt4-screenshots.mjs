import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../frontend/dist');
const outDir = 'C:\\Users\\rebel\\.gemini\\antigravity-cli\\brain\\27f6559b-2277-41a4-8d37-2b4892b178b4';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

let mockOrdersStatus = 200;
let mockOrdersData = { results: [] };
let mockOrderDetailStatus = 200;
let mockOrderDetailData = null;
let delayOrders = 0;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/auth/me/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'p1', username: 'parent_9820011223', role: 'PARENT' }));
    return;
  }

  if (urlPath.startsWith('/api/orders/') && urlPath !== '/api/orders/') {
    // Order detail call
    res.writeHead(mockOrderDetailStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockOrderDetailData || { error: 'Not found' }));
    return;
  }

  if (urlPath === '/api/orders/') {
    if (delayOrders > 0) {
      setTimeout(() => {
        res.writeHead(mockOrdersStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockOrdersData));
      }, delayOrders);
      return;
    }
    res.writeHead(mockOrdersStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockOrdersData));
    return;
  }

  let filePath = path.join(distDir, urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading file');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const PORT = 3460;
server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = path.join(outDir, 'chrome-profile-p4-' + Date.now());
  const cdpPort = 9226;

  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  let version = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      version = await resp.json();
      if (version?.webSocketDebuggerUrl) break;
    } catch {}
  }

  if (!version?.webSocketDebuggerUrl) {
    console.error('Failed to connect to Chrome CDP');
    chromeProc.kill();
    server.close();
    process.exit(1);
  }

  const wsUrl = version.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  let idCounter = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const { resolve, reject } = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = idCounter++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((r) => (ws.onopen = r));

  const targets = await send('Target.getTargets');
  let pageTarget = targets.targetInfos.find((t) => t.type === 'page');
  const targetId = pageTarget.targetId;

  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });

  const sendSession = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = idCounter++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, sessionId, method, params }));
    });

  await sendSession('Page.enable');
  await sendSession('Runtime.enable');

  // Set device metrics to 390x844 phone viewport
  await sendSession('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  async function evalJs(expr) {
    const res = await sendSession('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    return res.result?.value;
  }

  async function takeScreenshot(fileName) {
    const res = await sendSession('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${fileName}`);
  }

  // Pre-seed auth token
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/` });
  await new Promise((r) => setTimeout(r, 1000));
  await evalJs(`
    localStorage.setItem('access', 'mock-access-token');
    localStorage.setItem('refresh', 'mock-refresh-token');
    localStorage.setItem('user_role', 'PARENT');
  `);

  // 1. Loading screenshot: delay orders by 5000ms and screenshot while skeleton is visible
  console.log('Capturing (1) loading...');
  delayOrders = 8000;
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent/orders` });
  await new Promise((r) => setTimeout(r, 600));
  await takeScreenshot('prompt4-loading-390x844.png');
  delayOrders = 0;

  // 2. Error screenshot: orders endpoint returns 500
  console.log('Capturing (2) error...');
  mockOrdersStatus = 500;
  mockOrdersData = { error: 'Server unavailable' };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent/orders` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt4-error-390x844.png');

  // 3. Empty screenshot: no orders
  console.log('Capturing (3) empty...');
  mockOrdersStatus = 200;
  mockOrdersData = { results: [] };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent/orders` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt4-empty-390x844.png');

  // 4. List with one COD order and one paid online order
  console.log('Capturing (4) list with COD and paid online...');
  const codOrder = {
    id: 'ord-cod-1',
    order_number: 'ORD-2026-COD88',
    student: 'child-1',
    student_name: 'Aarav Patel',
    status: 'CONFIRMED',
    payment_status: 'PENDING',
    payment_method: 'COD',
    total: '850.00',
    created_at: '2026-11-20T11:00:00Z',
  };
  const paidOrder = {
    id: 'ord-paid-2',
    order_number: 'ORD-2026-PAY99',
    student: 'child-1',
    student_name: 'Aarav Patel',
    status: 'DELIVERED',
    payment_status: 'PAID',
    payment_method: 'ONLINE',
    total: '1750.00',
    created_at: '2026-11-18T14:30:00Z',
  };
  mockOrdersStatus = 200;
  mockOrdersData = { results: [codOrder, paidOrder] };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent/orders` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt4-list-cod-and-paid-390x844.png');

  // 5. A cancelled order
  console.log('Capturing (5) cancelled order...');
  const cancelledOrder = {
    id: 'ord-can-3',
    order_number: 'ORD-2026-CAN77',
    student: 'child-1',
    student_name: 'Aarav Patel',
    status: 'CANCELLED',
    payment_status: 'REFUNDED',
    payment_method: 'ONLINE',
    total: '650.00',
    created_at: '2026-11-15T09:15:00Z',
  };
  mockOrdersStatus = 200;
  mockOrdersData = { results: [cancelledOrder] };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent/orders` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt4-cancelled-order-390x844.png');

  // 6. Detail screen (/parent/orders/ord-detail-1)
  console.log('Capturing (6) detail...');
  mockOrderDetailStatus = 200;
  mockOrderDetailData = {
    id: 'ord-detail-1',
    order_number: 'ORD-2026-8812',
    student: 'child-1',
    student_name: 'Aarav Patel',
    student_gr: 'GR-1001',
    school_name: 'DPS Surat',
    city_name: 'Surat',
    status: 'PACKED',
    payment_status: 'PAID',
    payment_method: 'ONLINE',
    fulfillment_type: 'HOME_DELIVERY',
    subtotal: '1250.00',
    total: '1250.00',
    delivery_details: {
      recipient_name: 'Rajesh Patel',
      phone: '9820011223',
      address: 'Flat 402, River View Apartments',
      city: 'Surat',
      state: 'Gujarat',
      pincode: '395007',
    },
    items: [
      {
        id: 'item-101',
        variant: 'var-1',
        variant_sku: 'SHIRT-OXFORD-M',
        variant_size: 'M',
        product_name: 'Oxford Cotton Shirt',
        category: 'Uniform',
        quantity: 2,
        unit_price_snapshot: '450.00',
      },
      {
        id: 'item-102',
        variant: 'var-2',
        variant_sku: 'PANTS-NAVY-30',
        variant_size: '30',
        product_name: 'Navy Blue Trousers',
        category: 'Uniform',
        quantity: 1,
        unit_price_snapshot: '350.00',
      },
    ],
    status_events: [
      { id: 'ev-1', status: 'PLACED', timestamp: '2026-11-20T10:00:00Z', note: 'Order placed by parent' },
      { id: 'ev-2', status: 'CONFIRMED', timestamp: '2026-11-20T10:15:00Z', note: 'Payment verified' },
      { id: 'ev-3', status: 'PACKED', timestamp: '2026-11-20T11:45:00Z', note: 'Packed at central warehouse' },
    ],
    created_at: '2026-11-20T10:00:00Z',
  };

  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent/orders/ord-detail-1` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt4-detail-390x844.png');

  console.log('All Prompt 4 screenshots captured successfully!');
  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
});
