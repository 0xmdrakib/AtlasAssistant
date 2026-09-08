import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:3000';
const errors = [];
const requests = [];
const held = [];
let sessionRelease;
const sessionGate = new Promise((resolve) => { sessionRelease = resolve; });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const story = (id, section = 'tech') => ({ id, section, title: `Performance story ${id}`, summary: 'A readable story, ready before login finishes.', sourceName: 'Test source', url: `https://example.test/${id}`, topics: ['science'], country: 'BD', score: 1, createdAt: new Date().toISOString(), publishedAt: new Date().toISOString() });
const payload = (id, section) => ({ items: [story(id, section)], meta: { updatedAt: new Date().toISOString(), translateEnabled: true, translationAllowed: true } });
const spin = async (predicate) => { for (let i = 0; i < 500 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(predicate()); };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {} } });
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname === '/api/auth/session') {
      await sessionGate;
      return json(route, { user: { id: 'performance-user', name: 'Performance Test', email: 'perf@example.test' }, expires: '2099-01-01T00:00:00.000Z',
        subscription: { plan: 'paid', status: 'owner', isOwner: true, currentPeriodStart: null, currentPeriodEnd: null } });
    }
    if (url.pathname === '/api/items') {
      const section = url.searchParams.get('section');
      if (url.searchParams.get('days') === '7') return new Promise((resolve) => held.push(async () => { await json(route, payload('older-window', section)); resolve(); }));
      return json(route, payload(section === 'tech' ? 'ready' : 'global', section));
    }
    if (url.pathname === '/api/saved') return json(route, { plan: 'paid', count: 0, limit: 50, remaining: 50, bookmarks: [], items: [] });
    return json(route, { ok: true });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/tech`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Refresh feed', exact: true }).waitFor();
  if (!(await page.getByText('Performance story ready', { exact: true }).count())) {
    await page.getByRole('button', { name: 'Refresh feed', exact: true }).click();
  }
  await page.getByText('Performance story ready', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Speak', exact: true }).click();
  await page.evaluate(() => { window.__originalStory = [...document.querySelectorAll('div')].find((el) => el.textContent === 'Performance story ready'); });
  const feedCount = () => requests.filter((url) => url.startsWith('/api/items')).length;
  const beforeSession = feedCount();
  sessionRelease();
  await page.getByRole('button', { name: 'Save this post', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Save this post"]').disabled);
  await spin(() => requests.includes('/api/saved'));
  assert.ok(await page.evaluate(() => window.__originalStory.isConnected), 'Session resolution must preserve the post DOM');
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1, 'Session resolution must preserve audio');
  assert.equal(feedCount(), beforeSession, 'Session resolution must not fetch the feed again');

  const start = Date.now();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Owner access', { exact: true }).waitFor();
  const menuMs = Date.now() - start;
  assert.ok(menuMs < 750, `Menu took ${menuMs}ms`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.ok(!requests.some((url) => ['/api/billing/status', '/api/billing/config', '/api/ai/status'].includes(url)), 'Menu and feed must use existing session/public config');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const filterRequests = feedCount();
  await page.getByRole('textbox').first().fill('US');
  await page.getByText('Performance story ready', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('textbox').first().fill('BD');
  await page.getByText('Performance story ready', { exact: true }).waitFor();
  await page.getByRole('textbox').first().fill('');
  assert.equal(feedCount(), filterRequests, 'Typing filters must not fetch each keystroke');

  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await spin(() => held.length === 1);
  await page.getByRole('button', { name: '1 day', exact: true }).click();
  await page.getByText('Performance story ready', { exact: true }).waitFor();
  await held[0]();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByText('Performance story older-window', { exact: true }).count(), 0, 'A late old-window response cannot overwrite the selected window');

  const techRequests = () => requests.filter((url) => url.startsWith('/api/items') && url.includes('section=tech')).length;
  const beforeNavigation = techRequests();
  await page.getByRole('link', { name: 'Global news', exact: true }).click();
  await page.getByRole('link', { name: 'Tech news', exact: true }).click();
  await page.getByText('Performance story ready', { exact: true }).waitFor();
  assert.equal(techRequests(), beforeNavigation, 'Returning to a fresh tab must reuse its feed');
  assert.equal(await page.getByRole('link', { name: /faith/i }).count(), 0);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const speaker = await page.getByRole('button', { name: 'Speak', exact: true }).first().boundingBox();
    const save = await page.getByRole('button', { name: 'Save this post', exact: true }).first().boundingBox();
    const summary = await page.getByRole('button', { name: 'Item summary', exact: true }).first().boundingBox();
    assert.ok(speaker.y < save.y && save.y + save.height <= summary.y, 'Save sits below speaker and above Item summary');
    assert.ok(Math.abs(save.x + save.width - summary.x - summary.width) < 2, 'Save aligns with the summary at the right edge');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `output/performance/feed-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: menu displays session subscription in ${menuMs}ms with zero billing/config requests; no session remount or duplicate feed; local filters; cache on tab return; stale response ignored; desktop/mobile speaker and save placement; Faith removed.`);
} finally { await browser.close(); }
