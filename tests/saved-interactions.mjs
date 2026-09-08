import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:3000';
const makeItem = (id) => ({ id, title: `Story ${id}`, summary: `Summary for story ${id}.`, section: 'tech', sourceName: 'Test source', url: `https://example.test/${id}`, topics: ['science'], score: 1, createdAt: new Date().toISOString(), publishedAt: new Date().toISOString() });
const stories = ['A', 'B', 'C'].map(makeItem);
const savedAt = '2026-09-09T02:00:00.000Z';
let confirmed = [stories[0]];
let gets = 0;
const mutations = [];
const errors = [];
const snapshot = () => ({ ok: true, count: confirmed.length, remaining: 10 - confirmed.length, limit: 10, plan: 'free', bookmarks: confirmed.map((item) => ({ itemId: item.id, savedAt })) });
const full = () => ({ ...snapshot(), items: confirmed.map((item) => ({ ...item, savedAt })) });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const spinUntil = async (predicate) => { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for controlled request'); await new Promise((r) => setTimeout(r, 10)); } };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Deterministic speech implementation in this isolated browser, with no device audio.
  await context.addInitScript(() => {
    window.__audioTest = { spoken: [], cancels: 0 };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(u) { window.__audioTest.spoken.push({ text: u.text, lang: u.lang }); },
      cancel() { window.__audioTest.cancels++; },
    } });
  });
  await context.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname === '/api/auth/session') return json(route, { user: { id: 'ui-fixture', name: 'UI Test', email: 'ui-test@example.test' }, expires: '2099-01-01T00:00:00.000Z' });
    if (url.pathname === '/api/items') return json(route, { items: stories, meta: { updatedAt: new Date().toISOString(), translateEnabled: false, translationAllowed: true } });
    if (url.pathname === '/api/saved') { gets++; return json(route, full()); }
    if (url.pathname.startsWith('/api/saved/')) {
      assert.equal(url.searchParams.get('compact'), '1');
      return new Promise((resolve) => mutations.push({
        id: url.pathname.split('/').at(-1), method: req.method(),
        async finish(ok = true) {
          if (ok) {
            const item = stories.find((story) => story.id === this.id);
            confirmed = confirmed.filter((story) => story.id !== this.id);
            if (this.method === 'PUT') confirmed.unshift(item);
          }
          await json(route, ok ? snapshot() : { ok: false, code: 'SAVED_UNAVAILABLE' }, ok ? 200 : 500);
          resolve();
        },
      }));
    }
    return json(route, { ok: true, enabled: false, price: { amount: '2.99', currency: 'USD' } });
  });

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/tech`, { waitUntil: 'networkidle' });
  // Also exercises the API fixture when testing a deployment with server-rendered posts.
  await page.getByRole('button', { name: 'Refresh feed', exact: true }).click();
  await page.getByText('Story A', { exact: true }).waitFor();
  const card = (id) => page.locator('div.rounded-2xl').filter({ has: page.getByText(`Story ${id}`, { exact: true }) }).last();
  assert.equal(await page.getByRole('button', { name: 'Speak', exact: true }).count(), 3, 'Speaker is present on every feed post');
  const initialGets = gets;

  const bSave = card('B').getByRole('button', { name: 'Save this post', exact: true });
  const before = Date.now();
  await bSave.click();
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label="Remove from saved"]').length === 2, { timeout: 750 });
  const immediateMs = Date.now() - before;
  assert.ok(immediateMs < 750, `Optimistic feedback took ${immediateMs}ms`);
  await spinUntil(() => mutations.length === 1);
  assert.equal(await card('B').getByRole('button', { name: 'Remove from saved', exact: true }).getAttribute('aria-busy'), 'true');
  // The server response is held open while the UI already shows the saved state.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Saved 2 / 10', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await mutations[0].finish();
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
  assert.equal(gets, initialGets, 'Successful save must not trigger a full collection reload');

  await card('B').getByRole('button', { name: 'Remove from saved', exact: true }).click();
  await spinUntil(() => mutations.length === 2);
  await card('C').getByRole('button', { name: 'Save this post', exact: true }).click();
  assert.equal(await card('C').getByRole('button', { name: 'Remove from saved', exact: true }).getAttribute('aria-pressed'), 'true');
  await mutations[1].finish(false);
  await spinUntil(() => mutations.length === 3);
  await card('B').getByRole('button', { name: 'Remove from saved', exact: true }).waitFor();
  assert.equal(await card('C').getByRole('button', { name: 'Remove from saved', exact: true }).getAttribute('aria-busy'), 'true', 'A failed remove cannot undo a later pending save');
  await mutations[2].finish();
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));

  await card('A').getByRole('button', { name: 'Speak', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await card('B').getByRole('button', { name: 'Speak', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.equal((await page.evaluate(() => window.__audioTest)).spoken.at(-1).text, 'Story B. Summary for story B.');

  await page.goto(`${base}/saved`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('button', { name: 'Speak', exact: true }).count(), 3, 'Speaker is present on every saved post');
  await card('A').getByRole('button', { name: 'Speak', exact: true }).click();
  const cancels = await page.evaluate(() => window.__audioTest.cancels);
  await card('C').getByRole('button', { name: 'Remove from saved', exact: true }).click();
  await page.getByRole('heading', { name: 'Story C', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1, 'Removing a different save must not stop the playing post');
  assert.equal(await page.evaluate(() => window.__audioTest.cancels), cancels);
  await spinUntil(() => mutations.length === 4);
  await mutations[3].finish();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Saved speaker and bookmark fit on mobile');
  await page.screenshot({ path: 'output/saved-tests/speaker-saved-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`PASS: save feedback in ${immediateMs}ms while response withheld; no full-list reload on success; failed remove rolls back without losing another save; feed + saved speakers; one active audio; unrelated removal does not interrupt speech; mobile layout.`);
} finally { await browser.close(); }
