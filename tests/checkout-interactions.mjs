import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('output/checkout', { recursive: true });
let paid = false, current = null, creates = 0, freeCreates = 0, statusCalls = 0, currencyFailure = false, pollFailure = false;
let createRelease, restoreRelease, gatewayFailure = true, delayRestore = true;
const checkoutKeys = [];
const requests = [], pageErrors = [];
const quote = () => ({ id: 'payment-ui-fixture', status: 'waiting', amount: '2.99', currency: 'usd', discountCode: null, payCurrency: 'usdcbsc', payAmount: '3.123456', payAddress: '0x1111111111111111111111111111111111111111', network: 'BNB Smart Chain (BEP-20)', payinExtraId: '13579', expiresAt: new Date(Date.now() + 900000).toISOString(), activatedAt: null, createdAt: new Date().toISOString() });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const waitUntil = async (predicate) => { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for controlled request'); await new Promise((resolve) => setTimeout(resolve, 10)); } };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    requests.push(url.pathname);
    if (url.pathname === '/api/auth/session') return json(route, { user: { id: 'checkout-ui-user', name: 'Checkout Test', email: 'checkout@example.test' }, expires: '2099-01-01T00:00:00.000Z', subscription: { plan: paid ? 'paid' : 'free', status: paid ? 'active' : 'free', isOwner: false, currentPeriodStart: paid ? '2026-09-09T00:00:00.000Z' : null, currentPeriodEnd: paid ? '2099-02-01T00:00:00.000Z' : null } });
    if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'local-test-only' });
    if (url.pathname === '/api/saved') return json(route, { plan: paid ? 'paid' : 'free', count: 0, limit: paid ? 50 : 10, remaining: paid ? 50 : 10, bookmarks: [], items: [] });
    if (url.pathname === '/api/billing/status') return json(route, { ok: true, plan: paid ? 'paid' : 'free', limits: { summary: paid ? 20 : 5, digest: paid ? 10 : 3 }, remaining: { summary: 3, digest: 2 } });
    if (url.pathname === '/api/billing/currencies') return currencyFailure ? json(route, { ok: false, error: 'Networks temporarily unavailable' }, 503) : json(route, { ok: true, currencies: [{ code: 'usdcbsc', asset: 'USDC', network: 'BNB Smart Chain (BEP-20)', label: 'USDC · BNB Smart Chain (BEP-20)', minimum: 1 }, { code: 'usdttrc20', asset: 'USDT', network: 'Tron (TRC-20)', label: 'USDT · Tron (TRC-20)', minimum: 2 }, { code: 'usdcbase', asset: 'USDC', network: 'Base', label: 'USDC · Base', minimum: 5 }] });
    if (url.pathname === '/api/billing/payments/current') {
      if (delayRestore) { delayRestore = false; return new Promise((resolve) => { restoreRelease = async () => { await json(route, { ok: true, payment: current }); resolve(); }; }); }
      return json(route, { ok: true, payment: current });
    }
    if (url.pathname.startsWith('/api/billing/payments/')) { statusCalls++; return pollFailure ? json(route, { ok: false, error: 'Connection interrupted' }, 503) : json(route, { ok: true, payment: current }); }
    if (url.pathname === '/api/billing/checkout/crypto') {
      const body = req.postDataJSON();
      assert.match(body.requestId, /^[a-f0-9-]{36}$/); assert.equal(body.payCurrency, 'usdcbsc');
      assert.ok(!('amount' in body), 'Price is decided on the server');
      checkoutKeys.push(body.requestId);
      if (gatewayFailure) {
        gatewayFailure = false;
        return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
      }
      creates++;
      return new Promise((resolve) => { createRelease = async () => { current = quote(); await json(route, { ok: true, payment: current }); resolve(); }; });
    }
    if (url.pathname === '/api/billing/discount') return req.postDataJSON().code === 'HALF' ? json(route, { ok: true, code: 'HALF', percentOff: 50, price: { currency: 'usd', finalAmount: '1.50' } }) : json(route, { ok: true, code: 'FREE', percentOff: 100, price: { currency: 'usd', finalAmount: '0.00' } });
    if (url.pathname === '/api/billing/checkout/free') { freeCreates++; paid = true; current = { ...quote(), id: 'free-ui-fixture', status: 'finished', amount: '0.00', activatedAt: new Date().toISOString() }; return json(route, { ok: true, payment: current }); }
    return json(route, { ok: true, items: [], meta: { updatedAt: new Date().toISOString(), translateEnabled: false, translationAllowed: true } });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const externalNavigations = [];
  page.on('request', (request) => { if (request.isNavigationRequest() && new URL(request.url()).origin !== new URL(base).origin) externalNavigations.push(request.url()); });
  await page.goto(base + '/saved', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Subscription/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Subscription and limits' });
  await dialog.getByText('3/5 today', { exact: true }).waitFor();
  assert.equal(await dialog.locator('input').count(), 0, 'The small panel is for limits, not checkout');
  await dialog.getByRole('link', { name: 'View plans & subscribe' }).click();
  await page.waitForURL('**/pricing');
  await page.getByLabel('Coin & network', { exact: true }).waitFor();
  assert.equal(creates, 0, 'Opening pricing must not create a payment');
  assert.ok(await page.getByRole('button', { name: 'Show payment details' }).isDisabled(), 'A network must be selected explicitly');
  const networkPicker = page.getByRole('combobox', { name: 'Coin & network', exact: true });
  await networkPicker.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('option', { name: 'USDT · Tron (TRC-20)' }).evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await networkPicker.getAttribute('aria-expanded'), 'false');
  await networkPicker.click();
  const networks = page.getByRole('listbox');
  assert.equal(await networks.getByRole('img', { name: 'USDC logo' }).count(), 1);
  assert.equal(await networks.getByRole('img', { name: 'USDT logo' }).count(), 1);
  assert.equal(await networks.getByRole('option', { name: 'USDC · Base' }).count(), 0, 'Unsupported amounts must never be selectable');
  await page.screenshot({ path: 'output/checkout/network-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Network options fit on mobile');
  await page.screenshot({ path: 'output/checkout/network-picker-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('option', { name: 'USDC · BNB Smart Chain (BEP-20)' }).click();
  assert.ok(await page.getByRole('button', { name: 'Show payment details' }).isDisabled(), 'Form is usable while restoring, but cannot create duplicate pending payments');
  await restoreRelease();
  await page.getByRole('button', { name: 'Show payment details' }).click();
  await page.getByRole('alert').filter({ hasText: 'HTTP 502' }).waitFor();
  await page.getByRole('button', { name: 'Show payment details' }).click();
  await waitUntil(() => createRelease);
  assert.equal(checkoutKeys[0], checkoutKeys[1], 'A gateway error must retry the same order, not create another');
  assert.equal(creates, 1); assert.ok(await page.getByRole('button', { name: 'Preparing checkout…' }).isDisabled());
  await createRelease();
  await page.getByRole('img', { name: 'Payment address QR code' }).waitFor();
  assert.match(page.url(), /\/pricing\?payment=payment-ui-fixture$/);
  await page.getByRole('button', { name: 'Copy Payment address', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), current.payAddress);
  await page.getByRole('button', { name: 'Copy Required memo / destination tag', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '13579');
  await page.screenshot({ path: 'output/checkout/embedded-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile checkout must fit');
  await page.screenshot({ path: 'output/checkout/embedded-mobile.png', fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('img', { name: 'Payment address QR code' }).waitFor();
  assert.equal(creates, 1, 'Reload resumes the same payment');
  pollFailure = true;
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await page.getByRole('alert').filter({ hasText: 'Connection interrupted' }).waitFor();
  assert.equal(await page.getByRole('img', { name: 'Payment address QR code' }).count(), 1, 'Network failure preserves the address');
  pollFailure = false; current = { ...current, status: 'confirmed' };
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await page.getByText('Transfer confirmed · finalizing', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Payment complete', exact: true }).count(), 0, 'Confirmed is not finished');
  current = { ...current, status: 'partially_paid' };
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await page.getByText('Partial payment received', { exact: true }).waitFor();
  assert.equal(await page.getByRole('img', { name: 'Payment address QR code' }).count(), 0, 'Partial payment must not ask the user to send the full amount again');
  current = { ...current, status: 'finished', activatedAt: new Date().toISOString() }; paid = true;
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await page.getByRole('heading', { name: 'Payment complete', exact: true }).waitFor();
  assert.equal(creates, 1); assert.deepEqual(externalNavigations, []);
  await page.screenshot({ path: 'output/checkout/success-mobile.png', fullPage: true });

  paid = false; current = { ...quote(), expiresAt: new Date(Date.now() - 1000).toISOString() };
  await page.goto(base + '/pricing?payment=payment-ui-fixture', { waitUntil: 'networkidle' });
  await page.getByText(/This quote has expired/).waitFor();
  assert.equal(await page.getByRole('img', { name: 'Payment address QR code' }).count(), 0);
  current = { ...current, status: 'expired' };
  await page.getByRole('button', { name: 'Check payment status' }).click();
  await page.getByRole('button', { name: 'Start a new checkout' }).waitFor();
  await page.getByRole('button', { name: 'Start a new checkout' }).click();
  await page.getByRole('combobox', { name: 'Coin & network', exact: true }).click();
  await page.getByRole('option', { name: 'USDT · Tron (TRC-20)' }).click();
  await page.getByLabel('Discount code (optional)').fill('HALF');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByText('50% off applied · HALF', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Show payment details' }).isDisabled(), 'A discount clears a network that cannot support the discounted amount');
  await page.getByRole('combobox', { name: 'Coin & network', exact: true }).click();
  assert.equal(await page.getByRole('option').count(), 1);
  assert.equal(await page.getByRole('option', { name: 'USDT · Tron (TRC-20)' }).count(), 0);
  await page.keyboard.press('Escape');
  current = null; currencyFailure = true;
  await page.goto(base + '/pricing', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Retry networks' }).waitFor();
  await page.getByLabel('Discount code (optional)').fill('FREE');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Activate free Pro', exact: true }).click();
  await page.getByRole('heading', { name: 'Payment complete', exact: true }).waitFor();
  assert.equal(freeCreates, 1); assert.equal(creates, 1, '100% discount needs no provider payment or network');
  assert.deepEqual(pageErrors, []);
  console.log('PASS: Saved-page limits panel links to pricing; explicit network selection; embedded QR/address/memo; clipboard; no redirect; single create; resume after reload; network failure recovery; confirmed/partial/expired/finished states; 100% discount without provider; mobile layout; no page errors.');

  const guest = await browser.newContext();
  await guest.route('**/api/**', (route) => json(route, new URL(route.request().url()).pathname === '/api/auth/session' ? {} : { ok: true }));
  const guestPage = await guest.newPage();
  await guestPage.goto(base + '/pricing', { waitUntil: 'networkidle' });
  await guestPage.getByRole('button', { name: 'Continue with Google' }).waitFor();
  assert.equal(await guestPage.getByRole('button', { name: 'Show payment details' }).count(), 0);
  console.log('PASS: Guests see pricing and sign-in without starting a checkout.');
} finally { await browser.close(); }
