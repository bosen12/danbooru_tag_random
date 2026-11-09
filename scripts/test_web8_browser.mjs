// web8 墨池工作台：真的頁面＋假的 API（自己開伺服器，照 WEB_BASE 的順序 web8 → web6 → web 找檔）。
// 生圖走假的串流（排隊、進度、預覽、成品），永遠不碰 ComfyUI。
//   node scripts/test_web8_browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of [process.env.PLAYWRIGHT_MODULE, 'playwright', resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(p); } catch {}
  }
  throw new Error('Playwright not found. Run: npm install --no-save playwright && npx playwright install chromium');
})();

const root = resolve(import.meta.dirname, '..');
const DIRS = ['web8', 'web6', 'web'].map((d) => resolve(root, d));
// 1×1 的 PNG：假成品、假預覽（不靠 web/cards 有沒有下載）。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png' };
const genBodies = [];

const json = (res, obj, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (path === '/api/ping') return json(res, { ok: true });
  if (path === '/api/setup') return json(res, { ok: true, started: false, items: [] });
  if (path === '/api/checkpoints') return json(res, { ok: true, items: ['base/test_model.safetensors'], current: 'base/test_model.safetensors' });
  if (path === '/api/loras') return json(res, { ok: true, items: [{ folder: 'style', file: 'ink_style.safetensors', title: '水墨風', trainedWords: ['inkwash style', 'monochrome'] }] });
  if (path === '/fake.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(PNG);
  }
  if (path === '/api/gen' && req.method === 'POST') {
    let raw = '';
    for await (const part of req) raw += part;
    genBodies.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Gen-Job': 'job' + genBodies.length, 'Cache-Control': 'no-store' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('queued', { prompt_id: 'p' + genBodies.length });
    for (let v = 1; v <= 6; v++) {
      await new Promise((r) => setTimeout(r, 60));
      send('progress', { value: v, max: 6 });
      if (v === 3) send('preview', { image: '/fake.png?preview' });
    }
    send('done', { image: '/fake.png?done=' + genBodies.length, seed: 7 });
    return res.end();
  }
  if (path.startsWith('/api/')) return json(res, { ok: false, error: 'not in test' }, 404);
  const rel = decodeURIComponent(path === '/' ? '/index.html' : path).replace(/^\//, '');
  for (const dir of DIRS) {
    const file = resolve(dir, rel);
    if (!file.startsWith(dir + sep) || !existsSync(file)) continue;
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      return res.end(await readFile(file));
    } catch {
      break;
    }
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

  // ---------- 電腦 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('https://**/*', (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(origin + '/');
  await page.waitForFunction(() => document.documentElement.dataset.boot === 'ready', null, { timeout: 30000 });
  assert.ok((await page.locator('#lib-grid .tile').count()) > 20, 'library shows cards');
  assert.match(await page.locator('#lib-status').innerText(), /張/, 'library shows a count');
  assert.equal(await page.locator('#rating [aria-checked="true"]').getAttribute('data-rating'), 'general', 'all-ages by default, like Mochi');

  // 起手
  await page.locator('.chip-starter').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#recipe-tray .rc').length > 0);

  // 找牌、Enter 放第一張
  await page.fill('#lib-q', '海邊');
  await page.waitForFunction(() => document.querySelector('#lib-grid .tile')?.getAttribute('aria-label')?.includes('海邊'));
  const firstTag = await page.locator('#lib-grid .tile').first().getAttribute('data-tag');
  await page.press('#lib-q', 'Enter');
  await page.waitForFunction((tag) => [...document.querySelectorAll('#recipe-tray .rc')].some((n) => n.dataset.tag === tag), firstTag);
  assert.equal(await page.locator(`#lib-grid .tile[data-tag="${firstTag}"]`).getAttribute('aria-pressed'), 'true', 'pinned tile is marked');

  // 右鍵丟廢字簍、復原
  await page.fill('#lib-q', '');
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .tile').length > 20);
  const banTag = await page.locator('#lib-grid .tile:not([aria-pressed="true"])').nth(3).getAttribute('data-tag');
  await page.locator(`#lib-grid .tile[data-tag="${banTag}"]`).click({ button: 'right' });
  await page.waitForFunction(() => !document.querySelector('#recipe-bans').hidden);
  assert.ok(await page.evaluate((tag) => JSON.parse(localStorage.getItem('mochi.bans.v1')).includes(tag), banTag), 'bans are shared with Mochi');
  await page.locator('.toast-act', { hasText: '復原' }).last().click();
  await page.waitForFunction(() => document.querySelector('#recipe-bans').hidden);

  // 份量
  const rc = page.locator('#recipe-tray .rc').first();
  await rc.hover();
  await rc.locator('.rc-btn').nth(1).click();
  await page.waitForFunction(() => document.querySelector('#recipe-tray .rc .rc-weight')?.textContent === '×1.2');

  // 分級：色情時走光、性愛按得了
  await page.locator('#rating [data-rating="explicit"]').click();
  assert.equal(await page.locator('.chip-heat[data-heat="flash"]').isDisabled(), false, 'explicit unlocks flash');
  await page.locator('#rating [data-rating="general"]').click();
  assert.equal(await page.locator('.chip-heat[data-heat="flash"]').isDisabled(), true, 'all-ages blocks flash');

  // LoRA：加一個，抽出來的提示詞有觸發詞
  await page.locator('.rules-models button', { hasText: '加 LoRA' }).click();
  await page.locator('.pick-item', { hasText: '水墨風' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.lora').length === 1);

  // 只抽牌（D）
  await page.locator('#canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('d');
  await page.waitForFunction(() => document.querySelector('#strip .st[data-status="drawn"]'));
  assert.ok(await page.locator('#canvas button', { hasText: '印這張' }).isVisible(), 'drawn shot offers to print');
  await page.locator('#insp-tabs [data-panel="detail"]').click();
  assert.ok((await page.locator('#detail .dc').count()) > 5, 'detail lists the cards the shot used');
  const detailText = await page.locator('#detail').innerText();
  assert.ok(!/\[object|null/.test(detailText), 'detail renders nodes, not strings');
  assert.match(await page.locator('#detail .dt-prompt').innerText(), /inkwash style/, 'LoRA trigger word goes into the prompt');

  // 生圖（Ctrl＋Enter）：假的串流畫完，成品存起來
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('.cv-done .cv-img'), null, { timeout: 15000 });
  assert.equal(genBodies.length, 1, 'one generation request');
  const body = genBodies[0];
  assert.equal(body.origin, 'mochi');
  assert.equal(body.rating, 'general');
  assert.ok(body.width > 0 && body.height > 0 && typeof body.positive === 'string' && body.positive.length > 20, 'size and prompt are sent');
  assert.deepEqual(body.loras.map((l) => [l.file, l.trigger]), [['ink_style.safetensors', 'inkwash style']], 'LoRA payload like Mochi');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mochi8.shots.v1') || '[]'));
  assert.equal(saved.length, 1, 'drawn-only shots are not saved, printed ones are');
  assert.equal(saved[0].status, 'done');

  // 重新整理：成品還在，配方照分頁留著
  const pinsBefore = await page.locator('#recipe-tray .rc').count();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.boot === 'ready');
  assert.equal(await page.locator('#strip .st[data-status="done"]').count(), 1, 'printed shot survives reload');
  assert.equal(await page.locator('#recipe-tray .rc').count(), pinsBefore, 'recipe survives reload in this tab');

  // 卡冊「送去墨池」的交接便條
  await page.evaluate(() => localStorage.setItem('mochi.pool.handoff.v1', JSON.stringify({ tags: ['smile'], weights: { smile: 1.2 }, at: Date.now() })));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.boot === 'ready');
  assert.deepEqual(await page.locator('#recipe-tray .rc').evaluateAll((n) => n.map((x) => x.dataset.tag)), ['smile'], 'handoff replaces the recipe');
  assert.equal(await page.evaluate(() => localStorage.getItem('mochi.pool.handoff.v1')), null, 'handoff note is taken once');

  // 其他房間（借 web6 的頁）
  await page.locator('#rooms').click();
  assert.deepEqual(await page.locator('.room').evaluateAll((n) => n.map((a) => a.getAttribute('href'))).then((x) => x.slice(0, 4)), ['fuse.html', 'book.html', 'album.html', 'parse.html']);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, [], 'no page errors on desktop');
  await ctx.close();

  // ---------- 手機 ----------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.route('https://**/*', (r) => r.abort());
  const p2 = await phone.newPage();
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(e.message));
  await p2.goto(origin + '/');
  await p2.waitForFunction(() => document.documentElement.dataset.boot === 'ready', null, { timeout: 30000 });
  for (const view of ['lib', 'stage', 'insp']) {
    await p2.locator(`#tabs [data-view="${view}"]`).click();
    assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `no sideways scroll on the ${view} tab`);
    assert.ok(await p2.locator('#cap-gen').isVisible(), `generate button stays on the ${view} tab`);
  }
  await p2.locator('#tabs [data-view="lib"]').click();
  await p2.locator('#lib-grid .tile').first().click();
  await p2.waitForFunction(() => document.querySelectorAll('#recipe-tray .rc').length > 0);
  assert.deepEqual(errors2, [], 'no page errors on phone');
  await phone.close();

  console.log('web8 studio (library, recipe, rules, LoRA trigger, draw, fake print, reload, handoff, phone tabs): passed');
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
