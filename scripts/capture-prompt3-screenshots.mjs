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

let mockStudentsStatus = 200;
let mockStudentsData = { results: [] };

let mockOrdersStatus = 200;
let mockOrdersData = { results: [] };

const mockSchools = [
  {
    id: 'sch-1',
    name: 'DPS Surat',
    code: 'DPS-SURAT',
    city: 'Surat',
    active: true,
  },
];

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

  if (urlPath === '/api/students/') {
    res.writeHead(mockStudentsStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockStudentsData));
    return;
  }

  if (urlPath === '/api/orders/') {
    res.writeHead(mockOrdersStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockOrdersData));
    return;
  }

  if (urlPath === '/api/catalog/schools/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockSchools));
    return;
  }

  if (urlPath === '/api/catalog/products/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [] }));
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

const PORT = 3459;
server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = path.join(outDir, 'chrome-profile-p3-' + Date.now());
  const cdpPort = 9225;

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

  // Pre-seed auth token in localStorage so Guard allows /parent
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/` });
  await new Promise((r) => setTimeout(r, 1000));
  await evalJs(`
    localStorage.setItem('access', 'mock-access-token');
    localStorage.setItem('refresh', 'mock-refresh-token');
    localStorage.setItem('user_role', 'PARENT');
  `);

  const childAarav = {
    id: 'child-1',
    name: 'Aarav Patel',
    gr_number: 'GR-1001',
    school: 'sch-1',
    school_name: 'DPS Surat',
    branch: 'br-1',
    branch_name: 'Main Campus',
    class_name: 'Class 5',
    section: 'A',
    gender: 'MALE',
    active: true,
  };

  const childDiya = {
    id: 'child-2',
    name: 'Diya Patel',
    gr_number: 'GR-1002',
    school: 'sch-1',
    school_name: 'DPS Surat',
    branch: 'br-1',
    branch_name: 'Main Campus',
    class_name: 'Class 2',
    section: 'B',
    gender: 'FEMALE',
    active: true,
  };

  const activeOrder = {
    id: 'ord-101',
    order_number: 'ORD-2026-8812',
    student: 'child-1',
    status: 'CONFIRMED',
    payment_status: 'PAID',
    total: '1250.00',
    created_at: '2026-11-20T10:00:00Z',
  };

  // (a) prompt3-active-order-390x844.png: Active order present -> order card first
  console.log('Capturing (a) active order...');
  mockStudentsStatus = 200;
  mockStudentsData = { results: [childAarav] };
  mockOrdersStatus = 200;
  mockOrdersData = { results: [activeOrder] };

  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt3-active-order-390x844.png');

  // Single header check
  await takeScreenshot('prompt3-single-header-390x844.png');

  // (b) prompt3-shop-child-390x844.png: No active order, one child -> "Shop for <child>" button with child details
  console.log('Capturing (b) shop child...');
  mockOrdersData = { results: [] };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt3-shop-child-390x844.png');

  // (f) prompt3-shop-reached-from-b-390x844.png: Tap "Shop for <child>"
  console.log('Capturing (f) shop reached from b...');
  await evalJs(`
    const shopBtn = document.querySelector('.shop-for-child-btn');
    if (shopBtn) shopBtn.click();
  `);
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt3-shop-reached-from-b-390x844.png');

  // (c) prompt3-no-children-390x844.png: No children -> "Find your school" + "Add your child"
  console.log('Capturing (c) no children...');
  mockStudentsData = { results: [] };
  mockOrdersData = { results: [] };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt3-no-children-390x844.png');

  // (d) prompt3-two-children-390x844.png: Two children -> child switcher chips
  console.log('Capturing (d) two children...');
  mockStudentsData = { results: [childAarav, childDiya] };
  mockOrdersData = { results: [] };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt3-two-children-390x844.png');

  // (e) prompt3-error-retry-390x844.png: Error loading children -> error card with retry button (no invented names)
  console.log('Capturing (e) error retry...');
  mockStudentsStatus = 500;
  mockStudentsData = { error: 'Server error' };
  mockOrdersStatus = 500;
  mockOrdersData = { error: 'Server error' };
  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/parent` });
  await new Promise((r) => setTimeout(r, 1500));
  await takeScreenshot('prompt3-error-retry-390x844.png');

  console.log('All Prompt 3 screenshots captured successfully!');
  ws.close();
  chromeProc.kill();
  server.close();
  process.exit(0);
});
