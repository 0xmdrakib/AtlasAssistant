import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.UI_TEST_BASE || 'http://127.0.0.1:3000';
await mkdir('output/speech', { recursive: true });
const errors = [];
const story = (id) => ({ id, section: 'tech', title: `Science report ${id}`, summary: 'Researchers share a new discovery and explain what it means for the world. '.repeat(12), sourceName: 'Science desk', url: `https://example.test/${id}`, topics: ['science'], score: 1, createdAt: new Date().toISOString(), publishedAt: new Date().toISOString() });
const items = [story('A'), story('B')];
const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__speech = { spoken: [], current: null, cancels: 0 };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speaking: false, paused: false, getVoices() { return []; },
      speak(u) { this.speaking = true; window.__speech.current = u; window.__speech.spoken.push({ text: u.text, rate: u.rate }); queueMicrotask(() => u.onstart?.({})); },
      cancel() { this.speaking = false; window.__speech.cancels++; const old = window.__speech.current; window.__speech.current = null; setTimeout(() => old?.onerror?.({ error: 'interrupted' }), 0); },
      pause() { this.paused = true; window.__speech.current?.onpause?.({}); },
      resume() { this.paused = false; window.__speech.current?.onresume?.({}); },
    } });
  });
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return json(route, { user: { id: 'speech-user', name: 'Reader', email: 'reader@example.test' }, expires: '2099-01-01T00:00:00Z' });
    if (path === '/api/items') return json(route, { items, meta: { updatedAt: new Date().toISOString(), translateEnabled: false, translationAllowed: true } });
    if (path === '/api/saved') return json(route, { plan: 'free', count: 0, limit: 10, remaining: 10, bookmarks: [], items: [] });
    return json(route, { ok: true });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/tech', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Refresh feed', exact: true }).click();
  await page.getByText('Science report A', { exact: true }).waitFor();
  const card = (id) => page.locator('div.rounded-2xl').filter({ has: page.getByText(`Science report ${id}`, { exact: true }) }).last();
  const player = page.getByRole('region', { name: 'Audio player', exact: true });
  assert.equal(await player.count(), 0);
  await card('A').getByRole('button', { name: 'Speak', exact: true }).click();
  await player.getByRole('button', { name: 'Pause audio' }).waitFor();
  await player.getByRole('button', { name: 'Playback speed: 1x' }).waitFor();
  await player.getByRole('button', { name: 'Pause audio' }).click();
  const slider = player.getByRole('slider');
  const pausedAt = await slider.inputValue();
  await page.waitForTimeout(650);
  assert.equal(await slider.inputValue(), pausedAt, 'Paused clock stays frozen');
  await player.getByRole('button', { name: 'Forward 10 seconds' }).click();
  assert.ok(Number(await slider.inputValue()) > 9);
  await player.getByRole('button', { name: 'Play audio', exact: true }).waitFor();
  await player.getByRole('button', { name: 'Back 10 seconds' }).click();
  assert.ok(Number(await slider.inputValue()) < 1);
  await slider.focus(); await page.keyboard.press('ArrowRight');
  assert.ok(Number(await slider.inputValue()) > 9, 'Keyboard seeking must cross word boundaries');
  await page.keyboard.press('ArrowLeft'); assert.ok(Number(await slider.inputValue()) < 1);
  for (const speed of [1, 2, 3]) await player.getByRole('button', { name: `Playback speed: ${speed}x` }).click();
  await player.getByRole('button', { name: 'Playback speed: 1x' }).waitFor();
  await player.getByRole('button', { name: 'Play audio', exact: true }).click();
  await slider.focus(); await page.keyboard.press('End');
  await player.getByRole('button', { name: 'Replay audio' }).waitFor();
  await player.getByRole('button', { name: 'Replay audio' }).click();
  await player.getByRole('button', { name: 'Pause audio' }).waitFor();
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height / 2, { steps: 5 }); await page.mouse.up();
  assert.ok(Number(await slider.inputValue()) > Number(await slider.getAttribute('max')) * .4, 'Dragging seeks through the story');
  await card('B').getByRole('button', { name: 'Speak', exact: true }).click();
  await page.locator('[data-audio-player][data-playback="playing"]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
  assert.match(await page.evaluate(() => window.__speech.spoken.at(-1).text), /^Science report B/);
  await player.getByRole('button', { name: 'Playback speed: 1x' }).click();
  await player.getByRole('button', { name: 'Close audio player' }).click();
  assert.equal(await player.count(), 0);
  assert.equal(await card('B').getByRole('button', { name: 'Speak', exact: true }).evaluate((element) => element === document.activeElement), true, 'Closing restores keyboard focus to the source');
  await card('B').getByRole('button', { name: 'Speak', exact: true }).click();
  await player.getByRole('button', { name: 'Playback speed: 1x' }).waitFor();
  await page.locator('[data-audio-player][data-playback="playing"]').waitFor();
  assert.ok(Number(await slider.inputValue()) < 1, 'Reopening resets the story and speed');
  for (const width of [1280, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await player.boundingBox();
    assert.ok(box.x >= 10 && box.x + box.width <= width - 10, `Player fits at ${width}px`);
    assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 1, 'Player stays centered');
    assert.ok(box.y + box.height <= 890 && box.y + box.height >= 875, 'Player floats near the bottom');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    assert.ok((await slider.boundingBox()).height >= 28, 'Seeking has a usable touch area');
    await player.getByText('Science report B', { exact: true }).waitFor();
    const nav = page.getByRole('navigation', { name: 'News categories' });
    const navBox = await nav.boundingBox();
    if (width >= 640) {
      const first = await nav.getByRole('link').first().boundingBox(), last = await nav.getByRole('link').last().boundingBox();
      assert.ok(Math.abs(first.x - navBox.x) < 1);
      assert.ok(Math.abs(last.x + last.width - navBox.x - navBox.width) < 1, 'Categories span the full card width');
    }
    await page.screenshot({ path: `output/speech/player-${width}.png`, fullPage: false, animations: 'disabled' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'output/speech/player-dark-mobile.png' });
  await player.getByRole('button', { name: 'Pause audio' }).click();
  await page.keyboard.press('Escape'); assert.equal(await player.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: play/pause, +/-10s, 1/2/3x, keyboard and drag seeking, replay, single ownership, close/reset/focus, responsive player and full-width category navigation.');
} finally { await browser.close(); }
