// Native Chromium glyph, weight, vertical-text, and request-byte contracts.
// Optional network baseline: FONT_BASELINE_CSS=/path/to/Google-Chrome-response.css
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
let pw;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { pw = require(name); break; } catch {}
}
if (!pw) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module');
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.planning/font-browser-results');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(root, 'web6/fonts/chiron-subset.json')));
const source = JSON.parse(await readFile(resolve(root, 'web6/fonts/chiron-source.json')));
const localCss = await readFile(resolve(root, 'web6/fonts.css'), 'utf8');
const covered = new Set(manifest.unicodes);
const testGlyph = source.fallback_faces.flatMap(face => {
  const tokens = face.unicode_range.split(',').map(x => x.trim());
  return tokens.flatMap(x => {
    const [a,b=a] = x.slice(2).split('-').map(v => parseInt(v,16));
    return Array.from({length:b-a+1}, (_,i) => i+a);
  });
}).find(c => c >= 0x4e00 && c < 0x9fff && !covered.has(c));
assert.ok(testGlyph, 'Need a supported future Chinese vocabulary character');
const cache = new Map();
const pending = new Map();
const hash = data => createHash('sha256').update(data).digest('hex');
async function remote(url) {
  if (!pending.has(url)) pending.set(url, (async()=> {
    const response = await fetch(url);
    assert.ok(response.ok, `Font source ${response.status}: ${url}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    cache.set(url,bytes);return bytes;
  })());
  return pending.get(url);
}
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/ping'?{ok:true}:[]));return;
  }
  if (url.pathname === '/fixture') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="probe">墨池疊印台</div></body></html>');return;
  }
  let path=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!existsSync(path)&&url.pathname.startsWith('/web6/'))path=resolve(root,'web',decodeURIComponent(url.pathname).slice(6));
  if (!path.startsWith(root)) {res.writeHead(403).end();return;}
  try {
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');
    res.end(await readFile(path));
  } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await pw.chromium.launch({headless:true});
const results={subsetBytes:manifest.bytes, sourceVersion:source.version, tests:[],pages:[]};
try {
  const uaPage=await browser.newPage();
  const ua=await uaPage.evaluate(()=>navigator.userAgent);await uaPage.close();
  const baselineCss = process.env.FONT_BASELINE_CSS
    ? await readFile(process.env.FONT_BASELINE_CSS,'utf8')
    : await (await fetch(source.fallback_css_url, {headers:{'User-Agent':ua}})).text();
  assert.ok(baselineCss.includes('@font-face'), 'Google CSS baseline is required for comparison');
  await writeFile(resolve(output,'google-baseline.css'),baselineCss);
  for (const dpr of [1,1.25,2]) {
    const comparisons=[];
    for (const version of ['baseline','local']) {
      const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:dpr});
      const requested=[];
      await context.route('https://fonts.gstatic.com/**',async route=>{
        const bytes=await remote(route.request().url());requested.push({url:route.request().url(),bytes:bytes.length,gzipBytes:gzipSync(bytes).length});
        await route.fulfill({body:bytes,headers:{'Access-Control-Allow-Origin':'*'},contentType:route.request().url().endsWith('.ttf')?'font/ttf':'font/woff2'});
      });
      const page=await context.newPage();
      page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/chiron-hei-hk-web6.woff2'))requested.push({url:r.url(),bytes:manifest.bytes});});
      await page.goto(origin+'/fixture');
      await page.addStyleTag({content:(version==='baseline'?baselineCss:localCss.replaceAll('fonts/chiron','/web6/fonts/chiron'))+'\n#probe{font:800 32px "Chiron Hei HK";}'});
      const data=await page.evaluate(async ({codes})=>{
        const text=String.fromCodePoint(...codes);
        await Promise.all([700,800].map(w=>document.fonts.load(`${w} 24px "Chiron Hei HK"`,text)));
        await document.fonts.ready;
        const captures=[];
        for (const weight of [700,800]) for (const size of [12,24,42]) {
          const canvas=document.createElement('canvas');const dpr=devicePixelRatio;
          canvas.width=1200*dpr;canvas.height=Math.ceil(codes.length/40)*(size+12)*dpr;
          const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
          ctx.font=`${weight} ${size}px "Chiron Hei HK"`;ctx.textBaseline='top';ctx.fillStyle='#171a22';
          const metrics=[];
          codes.forEach((code,i)=>{const glyph=String.fromCodePoint(code);ctx.fillText(glyph,(i%40)*30,Math.floor(i/40)*(size+12));metrics.push(ctx.measureText(glyph).width);});
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(x=>x.toString(16).padStart(2,'0')).join('');
          captures.push({weight,size,pixels:digest,metrics});
        }
        const vertical=document.createElement('div');vertical.textContent='墨池疊印台容衣姿景風鏡表';vertical.style.cssText='font:800 18px "Chiron Hei HK";writing-mode:vertical-rl;text-orientation:upright;width:max-content;letter-spacing:.02em';document.body.append(vertical);
        await document.fonts.load('800 18px "Chiron Hei HK"',vertical.textContent);await document.fonts.ready;
        return {dpr:devicePixelRatio,captures,vertical:vertical.getBoundingClientRect().toJSON(),probe:getComputedStyle(document.querySelector('#probe')).font};
      },{codes:manifest.unicodes});
      const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
      const document=await cdp.send('DOM.getDocument');
      const node=await cdp.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#probe'});
      const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
      await page.screenshot({path:resolve(output,`${version}-dpr${dpr}-diagnostic.png`)});
      assert.ok(fonts.fonts.length>0 && fonts.fonts.every(f=>f.isCustomFont && /Chiron|昭源/.test(f.familyName)),`${version} must render downloaded Chiron glyphs: ${JSON.stringify(fonts.fonts)}`);
      const image=await page.screenshot({path:resolve(output,`${version}-dpr${dpr}.png`)});
      comparisons.push({version,data,requested,fonts:fonts.fonts,screenshot:hash(image)});
      if(version==='local') {
        assert.equal(requested.length,1,'Current corpus must request only one local Chiron subset');
        const before=requested.length;
        const fallback=await page.evaluate(async code=>{
          const probe=document.querySelector('#probe');probe.textContent=String.fromCodePoint(code);probe.style.fontWeight='700';
          await document.fonts.load('700 32px "Chiron Hei HK"',probe.textContent);await document.fonts.ready;
          probe.style.fontWeight='800';await document.fonts.load('800 32px "Chiron Hei HK"',probe.textContent);await document.fonts.ready;
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          return probe.getBoundingClientRect().toJSON();
        },testGlyph);
        const fallbackFonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
        assert.ok(fallbackFonts.fonts.length && fallbackFonts.fonts.every(f=>f.isCustomFont && /Chiron|昭源/.test(f.familyName)),`New vocabulary U+${testGlyph.toString(16)} must render original Chiron, not system fallback: ${JSON.stringify(fallbackFonts.fonts)} requests: ${JSON.stringify(requested.slice(before))}`);
        const extra=requested.slice(before);assert.equal(extra.length,1,'One new glyph must load only its one complementary shard, shared by weights');
        assert.ok(extra[0].bytes<100000,'One future glyph must not fetch the broad Chinese/full font');
        comparisons.at(-1).fallback={code:`U+${testGlyph.toString(16).toUpperCase()}`,requested:extra,fonts:fallbackFonts.fonts,rect:fallback};
      }
      await context.close();
    }
    assert.deepEqual(comparisons[0].data,comparisons[1].data,`All ${manifest.unicodes.length} glyphs must have identical native pixels/advances/vertical geometry at DPR ${dpr}`);
    assert.equal(comparisons[0].screenshot,comparisons[1].screenshot,`Native screenshot mismatch at DPR ${dpr}`);
    results.tests.push({dpr,...Object.fromEntries(comparisons.map(c=>[c.version,{...c,data:{...c.data,captures:c.data.captures.map(({metrics,...x})=>x)}}]))});
  }
  // The actual index/fuse DOM must use this font on the heading and cards. Keep
  // network/server services stubbed; no Comfy workflow or generation can run.
  for(const filename of ['index.html','fuse.html']) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1.25,reducedMotion:'reduce'});
    const fontRequests=[];
    await context.route('https://fonts.googleapis.com/**',async route=>route.fulfill({body:'',contentType:'text/css'}));
    await context.route('https://fonts.gstatic.com/**',async route=>{fontRequests.push(route.request().url());await route.abort();});
    const page=await context.newPage();
    page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/chiron-hei-hk-web6.woff2'))fontRequests.push(r.url());});
    await page.goto(origin+'/web6/'+filename);
    await page.waitForSelector('.card-name');await page.evaluate(()=>document.fonts.ready);
    const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const document=await cdp.send('DOM.getDocument');const rendered=[];
    for(const selector of ['.wordmark','.card-name']) {
      const node=await cdp.send('DOM.querySelector',{nodeId:document.root.nodeId,selector});
      const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
      const style=await page.locator(selector).first().evaluate(n=>({text:n.textContent,font:getComputedStyle(n).fontFamily,weight:getComputedStyle(n).fontWeight}));
      assert.ok(fonts.fonts.length&&fonts.fonts.every(f=>f.isCustomFont&&/Chiron|昭源/.test(f.familyName)),`${filename} ${selector} must render downloaded Chiron`);
      rendered.push({selector,...style,fonts:fonts.fonts});
    }
    assert.equal(fontRequests.length,1,`${filename} initial Chiron request must be only the local subset`);
    results.pages.push({filename,dpr:1.25,fontRequests,bytes:manifest.bytes,rendered});await context.close();
  }
  await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(`PASS: ${manifest.unicodes.length} glyphs at 700/800, 12/24/42px, native DPR 1/1.25/2; identical pixels, metrics and vertical layout.`);
  console.log(JSON.stringify(results.tests.map(x=>({dpr:x.dpr,baselineBytes:x.baseline.requested.reduce((a,f)=>a+f.bytes,0),baselineGzipBytes:x.baseline.requested.reduce((a,f)=>a+(f.gzipBytes||f.bytes),0),localBytes:x.local.requested[0].bytes,futureGlyph:x.local.fallback})),null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));}
