// 墨池牌面挑圖（web6/card-images.js）：真的 Chromium、真的卡圖（web/cards），自己起靜態伺服器。
// 有細縮圖（scripts/make_card_thumbs.py --mini-only 做的）才測挑圖；沒有就只測「照舊」那一半。
//   node scripts/test_web6_card_images.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { pw = require(name); break; } catch {}
}
if (!pw) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module');
const root = resolve(import.meta.dirname, '..');
let failed = 0;
const ok = (name, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${!cond && detail ? '\n  ' + detail : ''}`); };

const manifest = JSON.parse(readFileSync(resolve(root, 'web/cards/manifest.json'), 'utf8'));
const TAG = ['1girl', 'blonde hair', 'smile'].find((t) => manifest[t]?.mini) || Object.keys(manifest).find((t) => manifest[t]?.mini);
const hasMini = !!TAG;
// 改動前的 cards.js（幾何比較用）
const baselineCards = execFileSync('git', ['show', 'HEAD:web6/cards.js'], { cwd: root, maxBuffer: 2 ** 22 });

const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname + url.search);
  if (url.pathname === '/fixture') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><link rel="stylesheet" href="/web6/tokens.css"><link rel="stylesheet" href="/web6/card.css"><style>body{margin:0;background:#fff}#row{display:flex;gap:8px;padding:8px;flex-wrap:wrap}</style><div id="row"></div>`);
    return;
  }
  let file;
  if (url.pathname === '/baseline/cards.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(baselineCards); return; }
  if (url.pathname.startsWith('/baseline/')) url.pathname = '/web6/' + url.pathname.slice(10);
  if (url.pathname.startsWith('/cards/')) file = resolve(root, 'web' + decodeURIComponent(url.pathname));
  else file = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!existsSync(file) && url.pathname.startsWith('/web6/')) file = resolve(root, 'web', url.pathname.slice(6));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp' })[extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch({ headless: true });

async function open(dpr, viewport = { width: 900, height: 700 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
  await page.goto(origin + '/fixture');
  await page.evaluate(async (manifest) => {
    window.M = await import('/web6/card-images.js');
    window.C = await import('/web6/cards.js');
    window.manifest = manifest;
    window.card = (tag) => ({ tag, zh: '測試牌', suit: 'look', seal: '', rating: 'general', groupZh: '', item: {} });
    window.frames = (n = 2) => new Promise((r) => { const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step); });
    window.loaded = (img) => new Promise((r) => { if (img.complete && img.naturalWidth) r(); else { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); } });
  }, manifest);
  return page;
}

try {
  /* ---------- 純函式：miniSet、chooseArt ---------- */
  {
    const page = await open(1);
    const r = await page.evaluate(() => {
      const { miniSet, chooseArt, coverWidth } = M;
      const e = { file: 'x_y.webp', v: 'aaaaaaaaaa', mini: { src: 'aaaaaaaaaa', w: { 320: '3333333333', 160: '1111111111', 240: '2222222222' } } };
      const set = miniSet(e);
      const pick = (need) => chooseArt(set, need).replace(/^cards\//, '').replace(/\?.*/, '');
      return {
        set,
        stale: miniSet({ ...e, v: 'bbbbbbbbbb' }),
        noV: miniSet({ ...e, v: undefined }),
        none: miniSet({ file: 'x_y.webp', v: 'aaaaaaaaaa' }),
        junk: miniSet({ ...e, mini: { src: 'aaaaaaaaaa', w: { 160: '../../evil', abc: '1111111111', 480: '4444444444' } } }),
        picks: Object.fromEntries([[70, 1], [90.42, 1], [92, 1], [111.9, 1], [90.42, 1.25], [90.42, 1.5], [90.42, 2], [60, 3], [70, 3], [85, 3], [92, 3], [104, 3], [400, 1]].map(([w, d]) => [`${w}@${d}`, pick(w * d)])),
        cover: [coverWidth(66.92, 132.23), coverWidth(70, 102.375)],
      };
    });
    ok('miniSet：排好、網址帶自己的雜湊', JSON.stringify(r.set.list.map((c) => c.url)) === JSON.stringify(['cards/mini/160/x_y-1111111111.webp?v=1111111111', 'cards/mini/240/x_y-2222222222.webp?v=2222222222', 'cards/mini/320/x_y-3333333333.webp?v=3333333333']), JSON.stringify(r.set));
    ok('miniSet：原圖網址跟 card-art.js 的 artUrl 一樣（共用快取）', r.set.full === 'cards/x_y.webp?v=aaaaaaaaaa');
    ok('miniSet：原圖重烤過（v 對不上）不用', r.stale === null);
    ok('miniSet：沒有 v、沒有 mini 不用', r.noV === null && r.none === null);
    ok('miniSet：怪檔名、比原圖大的寬一律濾掉', r.junk === null, JSON.stringify(r.junk));
    const want = { '70@1': 'mini/160/x_y-1111111111.webp', '90.42@1': 'mini/160/x_y-1111111111.webp', '92@1': 'mini/160/x_y-1111111111.webp', '111.9@1': 'mini/160/x_y-1111111111.webp', '90.42@1.25': 'mini/160/x_y-1111111111.webp', '90.42@1.5': 'mini/240/x_y-2222222222.webp', '90.42@2': 'mini/240/x_y-2222222222.webp', '60@3': 'mini/240/x_y-2222222222.webp', '70@3': 'mini/320/x_y-3333333333.webp', '85@3': 'mini/320/x_y-3333333333.webp', '92@3': 'mini/320/x_y-3333333333.webp', '104@3': 'x_y.webp', '400@1': 'x_y.webp' };
    ok('chooseArt：各種牌寬 × DPR 挑到實測最好的那張', JSON.stringify(r.picks) === JSON.stringify(want), JSON.stringify(r.picks));
    ok('coverWidth：牌面格子（窄）是高 × 480/702、手牌（同比例）是自己的寬', Math.abs(r.cover[0] - 90.4) < 0.1 && Math.abs(r.cover[1] - 70) < 0.01, JSON.stringify(r.cover));
    await page.close();
  }

  /* ---------- 版面：跟改動前的 cards.js 一模一樣 ---------- */
  for (const dpr of [1, 2]) {
    const page = await open(dpr);
    const geo = await page.evaluate(async (tag) => {
      const B = await import('/baseline/cards.js');
      const out = {};
      for (const [name, mod] of [['base', B], ['now', C]]) {
        const row = document.getElementById('row');
        row.replaceChildren();
        const assets = mod.createAssets(manifest);
        const nodes = [mod.cardNode(card(tag), assets), mod.eagerArt(mod.cardNode(card(tag), assets, { tagName: 'div', flag: { kind: 'ban', text: '分級擋掉' } }))];
        nodes[1].style.setProperty('--card-w', '92px');
        row.append(...nodes);
        await Promise.all([...row.querySelectorAll('img')].map(loaded));
        // 圖到齊的標記（data-ready，收掉等待掃光）是之後加的，舊版不會標：兩邊一樣標上再比版面。
        for (const i of row.querySelectorAll('img')) i.dataset.ready = '1';
        await frames();
        out[name] = nodes.map((n) => [...n.querySelectorAll('*'), n].map((x) => {
          const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
          return [x.tagName, x.className, r.x, r.y, r.width, r.height, s.fontSize, s.fontWeight, s.fontFamily, s.objectFit, s.objectPosition, s.transform, s.transition, s.animationName, x.getAttribute('loading'), x.getAttribute('decoding')].join('|');
        }));
      }
      return out;
    }, TAG || Object.keys(manifest)[0]);
    ok(`DPR ${dpr}：牌的每個元素位置、大小、字、object-fit/position、transform/transition 都跟改動前一樣`, JSON.stringify(geo.base) === JSON.stringify(geo.now), JSON.stringify(geo).slice(0, 600));
    await page.close();
  }

  if (!hasMini) {
    console.log('skip: web/cards/manifest.json 沒有細縮圖（先跑 python scripts/make_card_thumbs.py --mini-only）');
  } else {
    /* ---------- 真的牌：DPR 1／1.25／2／3 挑到的圖（3 是 iPhone：拿 320，不拿原圖） ---------- */
    const expect = { 1: '/mini/160/', 1.25: '/mini/160/', 1.5: '/mini/240/', 2: '/mini/240/', 3: '/mini/320/' };
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const page = await open(dpr);
      requests.length = 0;
      const r = await page.evaluate(async (tag) => {
        const assets = C.createAssets(manifest);
        const row = document.getElementById('row');
        const lazy = C.cardNode(card(tag), assets);
        lazy.style.setProperty('--card-w', '90.421875px');
        const eager = C.eagerArt(C.cardNode(card(tag), assets));
        eager.style.setProperty('--card-w', '92px');
        row.append(lazy, eager);
        const imgs = [lazy, eager].map((n) => n.querySelector('img'));
        await Promise.all(imgs.map(loaded));
        await frames();
        return { src: imgs.map((i) => i.currentSrc), loading: imgs.map((i) => i.loading), srcset: imgs.map((i) => i.srcset), stats: M._artStats() };
      }, TAG);
      ok(`DPR ${dpr}：字盒（lazy）、合成池（eager）都拿 ${expect[dpr]}`, r.src.every((s) => s.includes(expect[dpr])), JSON.stringify(r.src));
      ok(`DPR ${dpr}：lazy／eager 跟以前一樣、不再掛 srcset`, r.loading.join() === 'lazy,eager' && r.srcset.every((s) => !s), JSON.stringify(r));
      const art = requests.filter((u) => u.startsWith('/cards/'));
      ok(`DPR ${dpr}：沒有多抓（只抓挑到的那一張，原圖、舊縮圖都沒碰）`, art.length === 1 && art[0].includes(expect[dpr]), JSON.stringify(art));
      ok(`DPR ${dpr}：量完就放掉觀察`, r.stats.pending === 0, JSON.stringify(r.stats));
      await page.close();
    }

    /* ---------- 先猜錯（還沒量過）：lazy 的圖排版後才抓，不會先抓猜的那張 ---------- */
    {
      const page = await open(3, { width: 500, height: 700 });
      requests.length = 0;
      const r = await page.evaluate(async (tag) => {
        const assets = C.createAssets(manifest);
        const n = C.cardNode(card(tag), assets);
        n.style.setProperty('--card-w', '60px');
        const before = n.querySelector('img').getAttribute('src');
        document.getElementById('row').append(n);
        const img = n.querySelector('img');
        await loaded(img);
        return { before, after: img.currentSrc, guess: M._artStats().guess.card };
      }, TAG);
      const art = requests.filter((u) => u.startsWith('/cards/'));
      ok('手機 DPR 3、60px 的牌：先猜 320（不是原圖），排版後改挑 240', r.before.includes('/mini/320/') && r.after.includes('/mini/240/'), JSON.stringify(r));
      ok('lazy 的圖只抓了改挑的那一張', art.length === 1 && art[0].includes('/mini/240/'), JSON.stringify(art));
      ok('量到的大小記下來，下一張重畫的牌直接猜對', Math.abs(r.guess - 60) < 0.5, String(r.guess));
      await page.close();
    }

    /* ---------- 視窗變了：畫面上的牌再量一次、改挑 ---------- */
    {
      const page = await open(1, { width: 1000, height: 700 });
      const first = await page.evaluate(async (tag) => {
        const n = C.cardNode(card(tag), C.createAssets(manifest));
        n.style.setProperty('--card-w', '9vw');
        document.getElementById('row').append(n);
        const img = n.querySelector('img');
        await loaded(img);
        window.img = img;
        return img.currentSrc;
      }, TAG);
      await page.setViewportSize({ width: 2200, height: 700 });
      await page.waitForFunction(() => img.currentSrc.includes('/mini/240/') && img.complete, null, { timeout: 4000 }).catch(() => {});
      const after = await page.evaluate(() => ({ src: img.currentSrc, w: img.closest('.card').getBoundingClientRect().width, pending: M._artStats().pending }));
      ok('視窗放大、牌變 198px：從 160 換成 240', first.includes('/mini/160/') && after.src.includes('/mini/240/'), JSON.stringify({ first, after }));
      ok('換完放掉觀察', after.pending === 0, JSON.stringify(after));
      await page.close();
    }

    /* ---------- DPR 變了（視窗拖到另一個螢幕、瀏覽器縮放）：再量一次 ---------- */
    {
      const page = await open(1, { width: 900, height: 700 });
      const first = await page.evaluate(async (tag) => {
        const n = C.cardNode(card(tag), C.createAssets(manifest));
        n.style.setProperty('--card-w', '90.421875px');
        document.getElementById('row').append(n);
        window.img = n.querySelector('img');
        await loaded(img);
        return img.currentSrc;
      }, TAG);
      const cdp = await page.context().newCDPSession(page);
      // 只改 DPR、尺寸不變時 headless 的模擬不發 resize／media change（真的縮放、換螢幕會發），所以寬度也動 1px。
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 901, height: 700, deviceScaleFactor: 2, mobile: false });
      await page.waitForFunction(() => img.currentSrc.includes('/mini/240/') && img.complete, null, { timeout: 4000 }).catch(() => {});
      const after = await page.evaluate(() => ({ dpr: devicePixelRatio, src: img.currentSrc, pending: M._artStats().pending }));
      ok('DPR 1 → 2：從 160 換成 240', first.includes('/mini/160/') && after.dpr === 2 && after.src.includes('/mini/240/'), JSON.stringify({ first, after }));
      await page.close();
    }

    /* ---------- 過期、缺檔、拆掉 ---------- */
    {
      const page = await open(1);
      requests.length = 0;
      const r = await page.evaluate(async (tag) => {
        const row = document.getElementById('row');
        const e = manifest[tag];
        // 原圖重烤過、mini 還沒補：照舊用 srcset（舊縮圖）
        const stale = C.cardNode(card(tag), C.createAssets({ [tag]: { ...e, mini: { ...e.mini, src: 'ffffffffff' } } }));
        // mini 指的檔不在：退回原圖
        const gone = C.cardNode(card(tag), C.createAssets({ [tag]: { ...e, mini: { src: e.v, w: { 160: '0000000000', 240: '0000000000', 320: '0000000000' } } } }));
        // mini 跟原圖都不在：拿掉 <img>，露出字（跟以前一樣）
        const none = C.cardNode(card('no such'), C.createAssets({ 'no such': { file: 'no_such.webp', v: '1234567890', mini: { src: '1234567890', w: { 160: '0000000000' } } } }));
        row.append(stale, gone, none);
        const imgs = [stale, gone].map((n) => n.querySelector('img'));
        await Promise.all(imgs.map(loaded));
        for (let i = 0; i < 40 && (!imgs[1].complete || !imgs[1].naturalWidth || none.querySelector('img')); i++) await new Promise((r) => setTimeout(r, 50));
        // 建了、還沒排版就丟掉（重畫掉的牌）：之後的定時掃描要放掉
        const assets = C.createAssets(manifest);
        for (let i = 0; i < 30; i++) C.cardNode(card(tag), assets);
        const pendingNow = M._artStats().pending;
        return { stale: [imgs[0].currentSrc, imgs[0].srcset], gone: [imgs[1].currentSrc, imgs[1].naturalWidth, imgs[1].dataset.artFallback], noneImg: !!none.querySelector('img'), pendingNow };
      }, TAG);
      ok('原圖重烤過、mini 過期：照舊（srcset＋舊縮圖）', !r.stale[0].includes('/mini/') && r.stale[1].includes('/thumb/'), JSON.stringify(r.stale));
      ok('mini 缺檔：退回原圖、圖照樣出來', r.gone[0].includes(`/cards/${manifest[TAG].file}?v=`) && r.gone[1] > 0 && r.gone[2] === '1', JSON.stringify(r.gone));
      ok('mini 跟原圖都沒有：拿掉 <img>（露出字）', r.noneImg === false);
      ok('還沒排版就丟掉的牌在等量', r.pendingNow >= 30, String(r.pendingNow));
      await page.waitForTimeout(4600);
      const later = await page.evaluate(() => M._artStats().pending);
      ok('定時掃描放掉沒接上的牌（不常駐）', later === 0, String(later));
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
