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

let mockOtpSendStatus = 200;
let mockOtpSendData = { status: 'ok', otp_debug: '123456' };

let mockOtpVerifyStatus = 200;
let mockOtpVerifyData = {
  access: 'mock-access',
  refresh: 'mock-refresh',
  user: { id: 'p1', username: 'parent_9820011223', role: 'PARENT' },
  children_linked: 1,
};

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

  if (urlPath === '/api/auth/otp/send/' && req.method === 'POST') {
    res.writeHead(mockOtpSendStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockOtpSendData));
    return;
  }

  if (urlPath === '/api/auth/otp/verify/' && req.method === 'POST') {
    res.writeHead(mockOtpVerifyStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockOtpVerifyData));
    return;
  }

  if (urlPath === '/api/catalog/schools/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
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

const PORT = 3458;
server.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = path.join(outDir, 'chrome-profile-p2-' + Date.now());
  const cdpPort = 9224;

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

  // 1. Phone step: Open '/' and tap account entrance
  mockOtpSendStatus = 200;
  mockOtpSendData = { status: 'ok', otp_debug: '123456' };
  mockOtpVerifyStatus = 200;

  await sendSession('Page.navigate', { url: `http://localhost:${PORT}/` });
  await new Promise((r) => setTimeout(r, 2000));

  await evalJs(`
    const btn = document.querySelector('.emerald-account-btn');
    if (btn) btn.click();
  `);
  await new Promise((r) => setTimeout(r, 800));
  await takeScreenshot('prompt2-phone-step-390x844.png');

  // 2. OTP step: Enter phone and click Send OTP
  await evalJs(`
    const input = document.querySelector('#psi-phone');
    if (input) {
      input.value = '9820011223';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const cta = document.querySelector('.psi-cta');
    if (cta) cta.click();
  `);
  await new Promise((r) => setTimeout(r, 1000));
  await takeScreenshot('prompt2-otp-step-390x844.png');

  // 3. Wrong code
  mockOtpVerifyStatus = 400;
  mockOtpVerifyData = { detail: 'That OTP is wrong or has expired. Request a new one.', code: 'otp_wrong' };
  await evalJs(`
    const input = document.querySelector('#psi-otp');
    if (input) {
      input.value = '000000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await new Promise((r) => setTimeout(r, 1000));
  await takeScreenshot('prompt2-wrong-code-390x844.png');

  // 4. Expired code
  mockOtpVerifyStatus = 400;
  mockOtpVerifyData = { detail: 'That OTP is wrong or has expired. Request a new one.', code: 'otp_expired' };
  await evalJs(`
    const input = document.querySelector('#psi-otp');
    if (input) {
      input.value = '111111';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await new Promise((r) => setTimeout(r, 1000));
  await takeScreenshot('prompt2-expired-code-390x844.png');

  // 5. Too many tries (429)
  mockOtpVerifyStatus = 429;
  mockOtpVerifyData = { detail: 'Too many requests. Please wait a few minutes.' };
  await evalJs(`
    const input = document.querySelector('#psi-otp');
    if (input) {
      input.value = '222222';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await new Promise((r) => setTimeout(r, 1000));
  await takeScreenshot('prompt2-too-many-tries-390x844.png');

  // 6. Provider unavailable (503)
  mockOtpSendStatus = 503;
  mockOtpSendData = { detail: 'SMS delivery is not configured on this server.', code: 'sms_unavailable' };
  await evalJs(`
    const changeBtn = document.querySelector('.psi-link');
    if (changeBtn && changeBtn.textContent.includes('Change')) {
      changeBtn.click();
    }
  `);
  await new Promise((r) => setTimeout(r, 500));
  await evalJs(`
    const input = document.querySelector('#psi-phone');
    if (input) {
      input.value = '9820011223';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const cta = document.querySelector('.psi-cta');
    if (cta) cta.click();
  `);
  await new Promise((r) => setTimeout(r, 1000));
  await takeScreenshot('prompt2-provider-unavailable-390x844.png');

  console.log('All Prompt 2 screenshots captured successfully!');
  chromeProc.kill();
  server.close();
  process.exit(0);
});
