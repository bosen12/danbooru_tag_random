// Real Chromium CSS/hand lifecycle, pixel comparison, and isolated invalidation trace.
// CSS baseline is immutable Git HEAD; other performance work cannot contaminate this comparison.
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {PNG} = require(process.env.PNGJS_MODULE || 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs');
const pixelmatchModule = require(process.env.PIXELMATCH_MODULE || 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const root = resolve(import.meta.dirname, '..');
const baselineRef = '8a6a7da';
const baseline = new Map(['card.css','styles.css','fuse.css','hand.js'].map(name => [name, execFileSync('git',['show',`${baselineRef}:web6/${name}`],{cwd:root,maxBuffer:2**22})]));
// Apply only the intentional mobile toast placement to the historical fixture;
// all other visual/motion declarations must still match. Actual toast/tray gaps,
// safe areas, hidden trays and action clicks are checked by test_hand_dock_browser.
const mobileToastPlacement = `@media (max-width: 640px) {
  body .toast {
    bottom: max(var(--fav-h, 0px), calc(var(--space-lg) + env(safe-area-inset-bottom)));
  }
  .go-float[data-show="true"] ~ .toast {
    bottom: max(var(--fav-h, 0px), calc(var(--space-md) + 3.25rem + var(--space-xs) + env(safe-area-inset-bottom)));
  }
}

`;
baseline.set('styles.css', Buffer.from(baseline.get('styles.css').toString().replace('/* 帶「復原」鈕的提示要點得到。 */', mobileToastPlacement + '/* 帶「復原」鈕的提示要點得到。 */')));
const out = resolve(root,'.planning/style-browser-results');
await mkdir(out,{recursive:true});
const server = createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/ping'?{ok:false}:[]));return;}
  if(url.pathname==='/fixture'){
    const v=url.searchParams.get('v'), fuse=url.searchParams.has('fuse');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<link rel="stylesheet" href="/${v}/card.css"><link rel="stylesheet" href="/${v}/styles.css">${fuse?`<link rel="stylesheet" href="/${v}/fuse.css">`:''}<body class="${fuse?'fuse':''}"><main id="fixture" style="padding:24px"><section><div id="wall-head" class="wall-head"><h2>成品</h2><p>每張用了哪些牌</p><div class="wall-tools"><button>全部展開</button></div></div><div id="wall-empty" class="wall-empty">還沒有成品</div><div id="wall" class="wall"></div></section><div id="sample" class="card" data-tag="alpha" style="width:83px;height:120px"><span>Card alpha</span></div></main><div class="go-float" data-show="false" inert><button class="btn">只抽牌</button></div><button class="trash">Trash</button><div class="toast" data-show="true">復原</div><div class="tray-bridge">偏好卡牌</div><button class="print-float">付印</button></body>`);return;
  }
  const parts=url.pathname.split('/').filter(Boolean);const version=parts.shift();const name=parts.join('/')||'index.html';
  if(version==='baseline'&&baseline.has(name)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(baseline.get(name));return;}
  let file=resolve(root,'web6',name);if(!existsSync(file))file=resolve(root,'web',name);
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const results={baselineRef,lifecycle:[],normalMotion:[],smoke:[],performance:[]};
// Selector rewrites preserve declarations/keyframes/media queries. The separately
// tested dock fix adds safe-area to the old 62px lift (identical when inset is 0).
for(const file of ['card.css','styles.css','fuse.css']){
  const declarations = text => [...text.replace(/\r\n/g,'\n').replace('translate: -50% -62px;', 'translate: -50% calc(-62px - env(safe-area-inset-bottom));').matchAll(/\{([^{}]*)\}/g)].map(m=>m[1].trim());
  assert.deepEqual(declarations(await readFile(resolve(root,'web6',file),'utf8')),declarations(baseline.get(file).toString()),file+' declarations changed');
}
async function fixture(version,width,fuse,cards=0,initial='open'){
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'});
  await page.goto(`${origin}/fixture?v=${version}${fuse?'&fuse':''}`);
  assert.equal(await page.locator('#wall-head h2').innerText(),'成品','Fixture HTML must render UTF-8 text');
  await page.evaluate(async({version,cards,initial})=>{
    localStorage.setItem('style.hand',JSON.stringify(initial==='hidden'?[]:['alpha','beta']));localStorage.setItem('style.hand.open',JSON.stringify(initial==='open'));
    const {createHand}=await import('/'+version+'/hand.js');
    window.hand=createHand({key:'style.hand',makeNode:t=>{const n=document.createElement('div');n.className='card';n.dataset.tag=t;n.textContent='Card '+t;return n;},inPool:()=>false,onPlay(){}});
    const wall=document.querySelector('#wall');for(let i=0;i<cards;i++){const shot=document.createElement('article');shot.className='shot';shot.innerHTML='<div class="shot-frame"><div class="shot-blank">No image</div></div><div class="shot-meta">seed '+i+'</div><div class="shot-cards"></div>';const fan=shot.lastElementChild;for(let j=0;j<24;j++){const n=document.querySelector('#sample').cloneNode(true);n.removeAttribute('id');n.dataset.tag='tag-'+i+'-'+j;fan.append(n);}wall.append(shot);}
    document.querySelector('#wall-empty').hidden=cards>0;document.querySelector('#wall-head').dataset.hasShots=String(cards>0);
  },{version,cards,initial});
  await page.waitForTimeout(650);return page;
}
async function capture(page){return page.evaluate(()=>{
  const props=['display','position','width','height','paddingBottom','bottom','translate','transform','overflow','scrollbarGutter','transitionDuration','transitionTimingFunction','animationDuration','animationDelay'];
  return Object.fromEntries(['html','body','.fav-hand','.trash','.toast','.print-float','.tray-bridge','.wall-tools','.wall-head p'].map(selector=>{const n=document.querySelector(selector),s=getComputedStyle(n);return [selector,{rect:n.getBoundingClientRect().toJSON(),style:Object.fromEntries(props.map(p=>[p,s[p]]))}];}));
});}
async function finish(page){for(let i=0;i<4;i++){await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));await page.waitForTimeout(120);}}
try{
  if(!process.argv.includes('--perf-only')&&!process.argv.includes('--quick'))for(const width of [390,1280])for(const fuse of [false,true])for(const initial of ['open','closed','hidden']){
    const pair=[];
    for(const version of ['baseline','current']){
      const page=await fixture(version,width,fuse,0,initial);const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const states=[],images=[];async function snap(label){await finish(page);states.push({label,data:await capture(page)});images.push(await page.screenshot({path:resolve(out,`${version}-${width}-${fuse}-${initial}-${label}.png`)}));if(version==='current'&&process.argv.includes('--require-state')){const state=await page.evaluate(()=>({exists:document.body.dataset.favHand,open:document.body.dataset.favHandOpen,actual:hand.open}));assert.equal(state.exists,'true');assert.equal(state.open,String(state.actual));}}
      await snap('initial');await page.evaluate(()=>hand.setOpen(true));await snap('open');await page.evaluate(()=>hand.setOpen(false));await snap('close');await page.evaluate(()=>{hand.toggleEdit(true);});await snap('edit');await page.evaluate(()=>{hand.toggleEdit(false);hand.remove('alpha',{quiet:true});hand.remove('beta',{quiet:true});hand.setOpen(false);});await snap('hidden');
      await page.evaluate(()=>{hand.setOpen(true);const n=document.querySelector('.go-float');n.dataset.show='true';n.inert=false;});await snap('float');
      await page.evaluate(()=>{document.querySelector('.go-float').inert=true;});await snap('float-inert');
      await page.evaluate(()=>{const n=document.querySelector('.go-float');n.inert=false;n.hidden=true;});await snap('float-hidden');
      await page.evaluate(()=>{const n=document.querySelector('.go-float');n.dataset.show='false';n.inert=true;});await snap('float-off');
      assert.deepEqual(errors,[]);pair.push({states,images});await page.close();
    }
    assert.ok(JSON.stringify(pair[1].states)===JSON.stringify(pair[0].states),`CSS geometry/styles differ: ${width}/${fuse}/${initial}`);
    const comparisons=[];
    for(let i=0;i<pair[0].images.length;i++){
      const a=PNG.sync.read(pair[0].images[i]),b=PNG.sync.read(pair[1].images[i]);
      assert.equal(a.width,b.width);assert.equal(a.height,b.height);
      let rawDifferentPixels=0;for(let j=0;j<a.data.length;j+=4)if(!a.data.subarray(j,j+4).equals(b.data.subarray(j,j+4)))rawDifferentPixels++;
      // Chromium can rasterize rounded floating-button edges differently even in
      // baseline-vs-baseline captures. Geometry remains exact; exclude only edge
      // antialiasing with a strict 0.01 perceptual threshold for the visual check.
      const visualDifferentPixels=pixelmatch(a.data,b.data,null,a.width,a.height,{threshold:0.01,includeAA:false});
      assert.equal(visualDifferentPixels,0,`Visual pixels differ ${width}/${fuse}/${initial}/${pair[0].states[i].label}`);
      comparisons.push({state:pair[0].states[i].label,rawDifferentPixels,visualDifferentPixels});
    }
    results.lifecycle.push({width,fuse,initial,states:pair[1].states.map(x=>x.label),geometryEqual:true,visualPixelsEqual:true,comparisons});
  }
  if(!process.argv.includes('--perf-only'))for(const width of [390,1280]){
    const pair=[];
    for(const version of ['baseline','current']){
      const page=await fixture(version,width,false,0,'closed');await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>{window.recorded=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){recorded.push({frames,options});return animate.call(this,frames,options);};hand.setOpen(true);});await page.waitForTimeout(750);
      await page.evaluate(()=>hand.setOpen(false));await page.waitForTimeout(650);pair.push(await page.evaluate(()=>recorded));await page.close();
    }
    assert.deepEqual(pair[1],pair[0],'Normal motion keyframes/options changed');results.normalMotion.push({width,keyframesEqual:true,animations:pair[1]});
  }
  if(!process.argv.includes('--perf-only'))for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
    await page.addInitScript(()=>{localStorage.setItem('mochi.hand.v1',JSON.stringify(['1girl']));localStorage.setItem('mochi.fuse.hand.v1',JSON.stringify(['1girl']));localStorage.setItem('mochi.settings.v1',JSON.stringify({rating:'general',n:1}));});
    await page.goto(origin+'/current/?debug');await page.waitForFunction(()=>window.mochi?.lib()&&document.querySelector('.fav-hand'));
    async function checkState(){const s=await page.evaluate(()=>{const h=document.querySelector('.fav-hand');return{exists:document.body.dataset.favHand,open:document.body.dataset.favHandOpen,actual:h.dataset.open==='true'&&h.dataset.hidden!=='true'};});assert.equal(s.exists,'true');assert.equal(s.open,String(s.actual));}
    await checkState();assert.equal(await page.locator('#wall-head').getAttribute('data-has-shots'),'false');
    await page.evaluate(()=>{mochi.settings.n=1;mochi.drawBatch(false);});await page.waitForFunction(()=>document.querySelector('#wall-head').dataset.hasShots==='true');await checkState();
    await page.evaluate(()=>document.querySelector('#wall').scrollIntoView({block:'start'}));await page.waitForTimeout(300);
    const float=await page.evaluate(()=>{const f=document.querySelector('.go-float');return{show:f.dataset.show,inert:f.inert};});assert.equal(float.inert,float.show!=='true');
    await page.locator('.page-switch a[href="fuse.html"]').click();await page.waitForFunction(()=>document.body.classList.contains('fuse')&&document.querySelector('.fav-hand')?.dataset.open!==undefined);await checkState();
    await page.locator('.page-switch a[href="./"]').click();await page.waitForFunction(()=>!document.body.classList.contains('fuse')&&document.querySelector('.fav-hand')?.dataset.open!==undefined);await checkState();
    assert.deepEqual(errors,[],'real page navigation errors');results.smoke.push({width,pages:['mochi','fuse','mochi'],wallLifecycle:true,float});await page.close();
  }
  for(const cards of [0,60])for(const version of ['baseline','current']){
    const page=await fixture(version,1280,false,cards,'closed');const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    // Warm up once. Toggle the watched hand state, then force actual style resolution.
    // This isolates selector cost; it is not an end-to-end pin or drag latency measurement.
    const workload=()=>{const n=document.querySelector('#sample');let total=0;for(let i=0;i<100;i++){const start=performance.now();hand.el.dataset.open=i%2?'true':'false';hand.el.dataset.hidden='false';if(document.body.dataset.favHandOpen!==undefined)document.body.dataset.favHandOpen=i%2?'true':'false';n.dataset.inHand=i%2?'true':'false';void getComputedStyle(n).borderColor;total+=performance.now()-start;}return total;};
    await page.evaluate(workload);const samples=[];let events=[];cdp.on('Tracing.dataCollected',e=>events.push(...e.value));
    await cdp.send('Tracing.start',{categories:'devtools.timeline,blink',transferMode:'ReportEvents'});
    for(let i=0;i<7;i++)samples.push(await page.evaluate(workload));
    const ended=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await ended;
    const styles=events.filter(e=>e.name==='UpdateLayoutTree'&&e.ph==='X');const layouts=events.filter(e=>e.name==='Layout'&&e.ph==='X');
    results.performance.push({version,cards,workload:'hand-open state + card attribute + forced style',domElements:await page.locator('*').count(),cpuThrottle:4,operations:700,samplesMs:samples,median100OperationsMs:[...samples].sort((a,b)=>a-b)[3],styleEvents:styles.length,styleMs:styles.reduce((s,e)=>s+(e.dur||0),0)/1000,styleElements:styles.reduce((s,e)=>s+(e.args?.elementCount||0),0),layoutEvents:layouts.length,layoutMs:layouts.reduce((s,e)=>s+(e.dur||0),0)/1000});
    await writeFile(resolve(out,`trace-${version}-${cards}.json`),JSON.stringify(events));await page.close();
  }
  await writeFile(resolve(out,process.argv.includes('--quick')?'quick-results.json':'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
