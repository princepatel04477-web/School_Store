// Phone-size (Pixel 7) Playwright run of the payment recovery flows against the local stack.
// Razorpay's checkout.js is replaced by a stub; every request to a non-local host is blocked and logged.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SIM = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const WORKTREE = process.env.WORKTREE;
const OUT = path.join(WORKTREE, 'recovery-evidence', 'review');
mkdirSync(OUT, { recursive: true });
const { chromium, devices } = await import(pathToFileURL(path.join(WORKTREE, 'frontend/node_modules/playwright/index.mjs')).href);

const BASE = 'http://127.0.0.1:5173';
const API = 'http://127.0.0.1:8000/api';
const seed = JSON.parse(readFileSync(path.join(SIM, 'seed.json'), 'utf8').replace(/^\uFEFF/, ''));
const statePath = path.join(SIM, 'state.json');
const readState = () => JSON.parse(readFileSync(statePath, 'utf8').replace(/^\uFEFF/, '') || '{}');
const writeState = (s) => writeFileSync(statePath, JSON.stringify(s, null, 2));
const blocked = [];
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };

const STUB = `window.Razorpay = function (opts) { this.opts = opts; window.__rzpOpts = opts; };
window.Razorpay.prototype.on = function () {};
window.Razorpay.prototype.open = function () {
  window.__rzpOpened = (window.__rzpOpened || 0) + 1;
  const opts = this.opts;
  if (window.__rzpAction === 'dismiss') setTimeout(() => opts.modal && opts.modal.ondismiss && opts.modal.ondismiss(), 300);
};`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE });

async function newPhone() {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'checkout.razorpay.com') return route.fulfill({ contentType: 'application/javascript', body: STUB });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    blocked.push(url.hostname);
    return route.abort();
  });
  const page = await context.newPage();
  return { context, page };
}

async function staffApi(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init, headers: { Authorization: `Bearer ${seed.admin_access}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function signInOnOrders(page) {
  await page.goto(`${BASE}/parent/orders`);
  await page.locator('input[type="tel"]').first().fill('9999990001');
  await page.getByRole('button', { name: /send/i }).first().click();
  const hint = await page.locator('.psi-test').first().textContent({ timeout: 10000 });
  const code = hint.match(/\d{6}/)[0];
  await page.locator('input[inputmode="numeric"]').last().fill(code);
  await page.getByRole('heading', { name: /orders/i }).first().waitFor({ timeout: 15000 });
}

async function fillBag(page) {
  await page.evaluate(async (variants) => {
    const { storeState } = await import('/src/store/storeState.ts');
    storeState.clearCart();
    for (const v of variants) {
      storeState.addItem({ productId: v.productId, variantId: v.id, name: v.name, category: 'Uniform', pricePaise: v.pricePaise, size: 'M', quantity: 1 });
    }
  }, seed.variants);
}

async function spaGo(page, to) {
  await page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
}

async function startShopping(page) {
  // A full load of the home page (the bag starts empty), then the items go into the bag.
  await page.goto(`${BASE}/`);
  const welcome = page.locator('.popup-backdrop button').last();
  if (await welcome.isVisible({ timeout: 2500 }).catch(() => false)) await welcome.click();
  await fillBag(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SIM, 'home-after-fill.png') });
}

async function checkout(page, method, rzpAction, { viaBag = true } = {}) {
  await page.evaluate((a) => { window.__rzpAction = a; window.__rzpOpened = 0; }, rzpAction);
  if (viaBag) {
    // The way a parent gets there: the bag button in the header, then Checkout in the bag.
    await page.locator('.bag-btn:visible, .emerald-bag-btn:visible').first().click();
    await page.locator('.bag-checkout-btn').click();
    await page.getByRole('heading', { name: 'Place your order' }).waitFor();
  } else {
    await spaGo(page, '/checkout');
  }
  // The welcome note shows once per page load on shop pages; a parent taps its button.
  const welcome = page.locator('.popup-backdrop button').last();
  if (await welcome.isVisible({ timeout: 2500 }).catch(() => false)) await welcome.click();
  await page.locator('.popup-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    window.__trace = [];
    const mark = (what) => window.__trace.push(`${Math.round(performance.now())} ${what}`);
    document.addEventListener('click', (e) => mark(`click on ${e.target.className || e.target.tagName}`), true);
    new MutationObserver(() => mark(`dialog=${Boolean(document.querySelector('.psi-sheet'))} choose=${Boolean([...document.querySelectorAll('button')].find((b) => b.textContent === 'Choose your child'))}`))
      .observe(document.body, { childList: true, subtree: true });
  });
  await page.getByText('Choose your child').click();
  await page.waitForTimeout(1500);
  if (!(await page.locator('.psi-sheet').first().isVisible().catch(() => false))) {
    const trace = await page.evaluate(() => [...new Set(window.__trace)].slice(0, 25).join(' | '));
    await page.screenshot({ path: path.join(SIM, `nosheet-${Date.now()}.png`), fullPage: false });
    log('PICKER Choose your child closed by itself; tapped again', false, trace);
    await page.waitForTimeout(1500);
    await page.getByText('Choose your child').click();
  }
  try {
    await page.getByRole('button', { name: /Aarav Test/ }).first().click({ timeout: 10000 });
  } catch (error) {
    await page.screenshot({ path: path.join(SIM, `fail-child-${Date.now()}.png`), fullPage: true });
    const dialogs = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], .psi, [class*="sheet"]')].map((el) => {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return `${el.tagName}.${el.className} vis=${s.visibility} disp=${s.display} op=${s.opacity} rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} text=${(el.textContent || '').trim().slice(0, 80)}`;
    }));
    log('DEBUG dialogs at failure', false, dialogs.join(' || '));
    throw error;
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('heading', { name: 'Delivery' }).waitFor();
  await page.getByLabel('PIN code').fill('395007');
  await page.getByLabel('House and society').fill('101 Review Apartments');
  const cityField = page.getByLabel('City', { exact: true });
  if (!(await cityField.inputValue())) await cityField.fill('Surat');
  await page.getByRole('button', { name: 'Next' }).click();
  try {
    await page.getByRole('heading', { name: 'Payment' }).waitFor({ timeout: 10000 });
    await page.getByText('Cash on delivery').first().waitFor({ timeout: 10000 });
  } catch (error) {
    await page.screenshot({ path: path.join(SIM, `fail-step3-${Date.now()}.png`), fullPage: true });
    throw error;
  }
  await page.locator(`input[value="${method}"]`).check();
  await page.getByRole('button', { name: method === 'COD' ? /Place order/i : /Pay now|Place order/i }).first().click();
}

const parentOrders = async () => (await staffApi('/orders/?page_size=50')).body.results ?? [];

try {
  // A. Paid while away: Checkout opened, browser closed before any callback, fresh sign-in later.
  {
    const before = (await parentOrders()).length;
    const { context, page } = await newPhone();
    await signInOnOrders(page);
    await startShopping(page);
    await checkout(page, 'ONLINE', 'none');
    await page.waitForFunction(() => window.__rzpOpened === 1, null, { timeout: 15000 });
    const opts = await page.evaluate(() => ({ order_id: window.__rzpOpts.order_id, amount: window.__rzpOpts.amount, timeout: window.__rzpOpts.timeout, retry: window.__rzpOpts.retry }));
    log('A1 Checkout opens with the store order\'s Razorpay order id', /^order_sim/.test(opts.order_id) && opts.amount === 80000 && opts.timeout > 0 && opts.retry?.enabled === false, JSON.stringify(opts));
    await context.close();

    const state = readState();
    state.payments = state.payments || {};
    state.payments[opts.order_id] = [{ id: 'pay_simA0000001a', order_id: opts.order_id, amount: 80000, currency: 'INR', status: 'captured', method: 'upi', created_at: Math.floor(Date.now() / 1000) - 30 }];
    writeState(state);

    const storeNumber = readState().created.find((c) => c.id === opts.order_id).store_order;
    const fresh = await newPhone();
    await signInOnOrders(fresh.page);
    const cardA = fresh.page.locator('article.order-card', { hasText: storeNumber });
    await cardA.getByText('Payment received.').waitFor({ timeout: 20000 });
    await fresh.page.screenshot({ path: path.join(OUT, 'A-paid-after-browser-closed.png'), fullPage: true });
    const card = await cardA.innerText();
    log('A2 Fresh browser, empty bag: My Orders finds the order paid with its receipt', /Payment received\./.test(card) && /800/.test(card) && /001a/.test(card), card.replace(/\s+/g, ' ').slice(0, 220));
    log('A3 No payment button on the paid order', (await cardA.getByRole('button', { name: /^Pay /i }).count()) === 0);
    const orders = await parentOrders();
    const paid = orders.filter((o) => o.payment_view.state === 'PAID');
    log('A4 Server: exactly one new order, paid', orders.length === before + 1 && paid.length === 1, `orders ${before} -> ${orders.length}`);
    await fresh.context.close();
  }

  // B. Retry safety: payment window dismissed, parent goes back to the still-full bag and picks cash.
  {
    const before = (await parentOrders()).length;
    const { context, page } = await newPhone();
    await signInOnOrders(page);
    await startShopping(page);
    await checkout(page, 'ONLINE', 'dismiss');
    await page.getByText(/Payment not received|Checking payment/).first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(OUT, 'B1-dismissed.png'), fullPage: true });
    const afterFirst = (await parentOrders()).length;
    // The parent leaves the payment screen by the site's own links (no reload); the bag is still full.
    await page.locator('header a[href="/"]').first().click();
    await page.waitForURL(`${BASE}/`);
    const bagCount = await page.evaluate(async () => (await import('/src/store/storeState.ts')).storeState.getCart().length);
    log('B0 Bag still holds the items after leaving the payment screen', bagCount === 2, `items ${bagCount}`);
    await checkout(page, 'COD', 'none', { viaBag: true });
    await page.getByText(/Order placed|placed/i).first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(OUT, 'B2-same-items-cash.png'), fullPage: true });
    const orders = await parentOrders();
    const opened = await page.evaluate(() => window.__rzpOpened);
    log('B1 Going back to the same bag and picking cash makes no second order', afterFirst === before + 1 && orders.length === afterFirst, `orders ${before} -> ${afterFirst} -> ${orders.length}`);
    log('B2 That order is now cash on delivery and Razorpay was not reopened', orders[0].payment_method === 'COD' && orders[0].payment_view.state === 'COD_DUE' && opened === 0, `${orders[0].order_number} ${orders[0].payment_method} ${orders[0].payment_view.state}`);
    await context.close();
  }

  // C. Payment still in progress when the parent returns: Checking payment, no Pay button, server refuses a retry.
  {
    const { context, page } = await newPhone();
    await signInOnOrders(page);
    await startShopping(page);
    await checkout(page, 'ONLINE', 'none');
    await page.waitForFunction(() => window.__rzpOpened === 1, null, { timeout: 15000 });
    const rid = await page.evaluate(() => window.__rzpOpts.order_id);
    await context.close();
    const state = readState();
    state.payments[rid] = [{ id: 'pay_simC0000003c', order_id: rid, amount: 80000, currency: 'INR', status: 'created', method: 'upi', created_at: Math.floor(Date.now() / 1000) - 20 }];
    writeState(state);

    const fresh = await newPhone();
    await signInOnOrders(fresh.page);
    await fresh.page.getByText('A payment is still in progress. Check your UPI app.').first().waitFor({ timeout: 20000 });
    await fresh.page.screenshot({ path: path.join(OUT, 'C-in-progress.png'), fullPage: true });
    const cNumber = readState().created.find((c) => c.id === rid).store_order;
    const card = fresh.page.locator('article.order-card', { hasText: cNumber });
    log('C1 My Orders shows Checking payment with Refresh status', (await card.getByRole('heading', { name: 'Checking payment' }).count()) === 1 && (await card.getByRole('button', { name: 'Refresh status' }).count()) === 1);
    log('C2 No payment or cash button while the payment may still go through', (await card.getByRole('button', { name: /^Pay |cash/i }).count()) === 0);
    const order = (await parentOrders()).find((o) => o.payment_view.in_progress);
    const parentToken = await fresh.page.evaluate(() => localStorage.getItem('access'));
    const retry = await fetch(`${API}/orders/${order.id}/payment/`, { method: 'POST', headers: { Authorization: `Bearer ${parentToken}` } });
    log('C3 Server refuses a new attempt with 409 payment_in_progress', retry.status === 409 && (await retry.json()).code === 'payment_in_progress', `HTTP ${retry.status}`);

    // The payment then fails at Razorpay; Refresh status turns the order payable again.
    state.payments[rid][0].status = 'failed';
    state.payments[rid][0].error_description = 'Payment was declined by the bank.';
    writeState(state);
    await fresh.page.waitForTimeout(5500);
    await card.getByRole('button', { name: 'Refresh status' }).click();
    await card.getByText(/Your last payment did not go through/).waitFor({ timeout: 15000 });
    await fresh.page.screenshot({ path: path.join(OUT, 'C-then-failed.png'), fullPage: true });
    log('C4 After it fails, the same order offers Pay and Pay cash instead', (await card.getByRole('button', { name: /^Pay \u20B9/ }).count()) === 1 && (await card.getByRole('button', { name: /cash/i }).count()) === 1);
    await fresh.context.close();
  }

  // D. Razorpay unreachable: Checking payment with the outage text, server answers 503.
  {
    const failed = (await parentOrders()).find((o) => o.payment_view.last_failure_reason);
    const state = readState(); state.outage = true; writeState(state);
    const { context, page } = await newPhone();
    await page.addInitScript(STUB);
    await signInOnOrders(page);
    await page.evaluate(() => { window.__rzpOpened = 0; });
    const card = page.locator(`#order-${failed.id}`);
    const pay = card.getByRole('button', { name: /^Pay \u20B9/ });
    if (await pay.isVisible({ timeout: 8000 }).catch(() => false)) {
      // The order was payable a moment ago; the parent taps Pay while Razorpay is down.
      await pay.click();
    }
    await card.getByText('We could not reach the payment service', { exact: false }).waitFor({ timeout: 20000 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'D-provider-outage.png'), fullPage: true });
    const opened = await page.evaluate(() => window.__rzpOpened || 0);
    log('D1 Outage: Checking payment with the outage text, no Pay button, Checkout not opened',
      (await card.getByRole('heading', { name: 'Checking payment' }).count()) === 1
      && (await card.getByRole('button', { name: /^Pay \u20B9|cash/i }).count()) === 0 && opened === 0, `opened ${opened}`);
    const token = await page.evaluate(() => localStorage.getItem('access'));
    const start = await fetch(`${API}/orders/${failed.id}/payment/`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    log('D2 Server answers 503 payment_check_failed during the outage', start.status === 503, `HTTP ${start.status}`);
    delete state.outage; writeState(state);
    await context.close();
  }

  // E. COD delivered: no cash still asked for; the order total is shown.
  {
    const cod = (await parentOrders()).find((o) => o.payment_method === 'COD');
    for (const status of ['CONFIRMED', 'PROCESSING', 'PACKED', 'DISPATCHED', 'DELIVERED']) {
      const r = await staffApi(`/orders/${cod.id}/`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (r.status !== 200) log(`E0 COD move to ${status}`, false, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
    }
    const { context, page } = await newPhone();
    await signInOnOrders(page);
    const card = page.locator(`#order-${cod.id}`);
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'E-cod-delivered.png'), fullPage: true });
    const text = await card.innerText();
    log('E1 Delivered COD order no longer says pay when it arrives, and shows its total', !/when the order arrives/.test(text) && /800/.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
    await context.close();
  }

  // F. Staff: payments to check. Put one order in the queue (outage for 11 minutes), then open it as the city admin.
  {
    const stuck = (await parentOrders()).find((o) => o.payment_view.last_failure_reason);
    const state = readState(); state.outage = true; writeState(state);
    const { execFileSync } = await import('node:child_process');
    execFileSync('python', [path.join(SIM, 'age-outage.py'), stuck.id], { env: process.env, stdio: 'inherit' });
    const queue = await staffApi(`/panel/payments/needs-reconciliation/?school=${seed.school}`);
    const row = (queue.body.results || []).find((o) => o.id === stuck.id);
    log('F1 Queue lists the order with its reason', queue.status === 200 && row?.reconciliation_reasons.includes('PROVIDER_UNREACHABLE'), `count ${queue.body.count}, reasons ${JSON.stringify(row?.reconciliation_reasons)}`);

    const staff = await browser.newContext({ ...devices['Pixel 7'] });
    await staff.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
      blocked.push(url.hostname); return route.abort();
    });
    await staff.addInitScript(([a, r]) => { localStorage.setItem('access', a); localStorage.setItem('refresh', r); }, [seed.admin_access, seed.admin_refresh]);
    const sp = await staff.newPage();
    await sp.goto(`${BASE}/city/orders`);
    const toggle = sp.getByRole('button', { name: /Payments to check/ });
    await toggle.waitFor({ timeout: 20000 });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const staffRow = sp.locator('article', { hasText: stuck.order_number });
    await staffRow.waitFor({ timeout: 20000 });
    await sp.screenshot({ path: path.join(OUT, 'F-staff-payments-to-check.png'), fullPage: true });
    const rowText = await staffRow.innerText();
    log('F2 City admin sees the order, its state and reason on the phone', /CHECKING/.test(rowText) && /provider unreachable/.test(rowText), rowText.replace(/\s+/g, ' ').slice(0, 200));

    // Razorpay comes back: Check with Razorpay clears the outage reason.
    delete state.outage; writeState(state);
    await staffRow.getByRole('button', { name: 'Check with Razorpay' }).click();
    await sp.waitForTimeout(2500);
    if (await sp.getByText('No fresh provider result. Try again shortly.').isVisible().catch(() => false)) {
      // Another check of this order ran in the last 5 seconds (rate limit): the panel says so; staff try again.
      log('F3a Rate limit answered first; panel said try again shortly', true);
      await sp.waitForTimeout(5500);
      await staffRow.getByRole('button', { name: 'Check with Razorpay' }).click();
      await sp.waitForTimeout(2500);
    }
    const after = await staffApi(`/panel/payments/needs-reconciliation/?school=${seed.school}`);
    const still = (after.body.results || []).find((o) => o.id === stuck.id);
    log('F3 Check with Razorpay clears the outage reason', !still || !still.reconciliation_reasons.includes('PROVIDER_UNREACHABLE'), JSON.stringify(still?.reconciliation_reasons ?? 'removed from queue'));
    await staff.close();
  }
} catch (error) {
  log('RUN', false, String(error?.stack || error).slice(0, 600));
} finally {
  await browser.close();
  log('Z No request left this PC (Razorpay stubbed, other hosts blocked)', blocked.length === 0, blocked.length ? [...new Set(blocked)].join(', ') : 'none attempted');
  writeFileSync(path.join(SIM, 'phone-results.json'), JSON.stringify(results, null, 2));
}
