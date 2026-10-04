// Real Chromium contract comparison. No application server or generation service required.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let pw;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { pw = require(name); break; } catch {}
}
if (!pw) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module');
const root = resolve(import.meta.dirname, '..');
// Read the immutable pre-change modules from Git so a fresh checkout can compare them.
const baselineRef = '7dda64f32f2ed66c312f019e4926a3d33609a3a5';
const baselineModules = new Map(['app.js','motion.js','drag.js','gen.js','hires.js','store.js','fuse.js'].map(name =>
  [name, execFileSync('git', ['show', `${baselineRef}:web6/${name}`], { cwd: root, maxBuffer: 2 ** 22 })]));
const out = resolve(root, '.planning/motion-browser-results');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture') { res.setHeader('Content-Type','text/html'); res.end('<style>body{margin:0;background:#eee;--color-shine:#fff;--color-shade:#0005}.target{position:absolute;left:440px;top:230px;width:72px;height:105px;transform:rotate(13deg)}.ghost{height:146px;background:#abc;border:2px solid #234;border-radius:8px;box-sizing:border-box}</style>'); return; }
  if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(url.pathname === '/api/ping' ? {ok:true} : [])); return; }
  let file = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (url.pathname.startsWith('/baseline/')) { const name = url.pathname.slice(10) || 'index.html'; if (baselineModules.has(name)) { res.setHeader('Content-Type','text/javascript');res.end(baselineModules.get(name));return; } file = resolve(root,'web6',name);if(!existsSync(file))file=resolve(root,'web',name); }
  if (!existsSync(file) && url.pathname.startsWith('/web6/')) file = resolve(root,'web',url.pathname.slice(6));
  if (file.endsWith('\\') || (url.pathname.endsWith('/') && extname(file)!=='.html')) file = resolve(file,'index.html');
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const bytes=await readFile(file); res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'})[extname(file)] || 'application/octet-stream');res.end(bytes); } catch { res.writeHead(404).end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch({headless:true});
const results = { flights: [], flip: [], drag: [], smoke: [] };
try {
  for (const reduced of [false,true]) for (const version of ['baseline','web6']) {
    const page = await browser.newPage({viewport:{width:800,height:600},reducedMotion:reduced?'reduce':'no-preference'});
    await page.goto(origin+'/fixture');
    const data = await page.evaluate(async ({version}) => {
      let next=1; const queue=new Map(); window.requestAnimationFrame=fn=>{const id=next++;queue.set(id,fn);return id;};window.cancelAnimationFrame=id=>queue.delete(id);
      window.tick = now => { const batch=[...queue.values()];queue.clear();batch.forEach(fn=>fn(now)); };
      const m=await import('/'+version+'/motion.js');
      const target=document.createElement('div');target.className='target';document.body.append(target);let current=target;let reads=0;let phases=[];
      const track=n=>{const fn=n.getBoundingClientRect.bind(n);n.getBoundingClientRect=()=>{reads++;phases.push('read');return fn();};};track(target);
      const ghosts=[];let landed=0;
      const handles=Array.from({length:3},(_,i)=>{const g=document.createElement('div');g.className='ghost';g.textContent='CARD '+i;Object.defineProperty(g.style,'transform',{get(){return this.getPropertyValue('transform');},set(v){phases.push('write');this.setProperty('transform',v);}});ghosts.push(g);return m.flight(g,{left:20,top:30,width:100,height:146},()=>current,{duration:480,delay:40,tilt:-9,startRotate:7,endRotate:13,startScale:.7,endScale:.8,scaleLate:.7,endOpacity:.3,onLand:()=>landed++});});
      const frames=[];
      for(const now of [0,20,40,80,160,240,320,400,500,520]) {
        if(now===160)current.style.left='510px';
        if(now===320){const n=current.cloneNode(true);n.style.top='310px';current.replaceWith(n);current=n;track(n);}
        const before=reads;phases=[];tick(now);
        frames.push({now,reads:reads-before,phases:[...phases],landed,ghosts:ghosts.map(g=>({connected:g.isConnected,transform:g.style.transform,shadow:g.style.boxShadow,opacity:g.style.opacity,rect:g.getBoundingClientRect().toJSON()}))});
        if(now===240)window.pixelReady=true;
      }
      handles.forEach(h=>h.cancel());
      const canceled=document.createElement('div');const h=m.flight(canceled,{left:0,top:0,width:20},()=>current,{onLand:()=>landed++});h.cancel();h.cancel();tick(600);
      return {frames,totalReads:reads,landed,cancelConnected:canceled.isConnected,queued:queue.size,reduced:m.reducedMotion()};
    },{version});
    await page.screenshot({path:resolve(out,`${version}-${reduced?'reduced':'normal'}-landing.png`)});
    results.flights.push({version,reduced,data});await page.close();
  }
  for(const reduced of [false,true]) {
    const pair=results.flights.filter(x=>x.reduced===reduced);
    const comparable=d=>({frames:d.frames.map(({reads,phases,...f})=>f),landed:d.landed,cancelConnected:d.cancelConnected,queued:d.queued,reduced:d.reduced});
    assert.deepEqual(comparable(pair[1].data),comparable(pair[0].data),'Flight rendered geometry/style/lifecycle mismatch');
    assert.equal(pair[1].data.landed,4);assert.equal(pair[1].data.cancelConnected,false);
    if(process.argv.includes('--require-drag-batching'))for(const frame of pair[1].data.frames){assert.equal(frame.reads,1,'Shared target needs only one geometry read per frame');assert.deepEqual(frame.phases,['read','write','write','write'],'Flight geometry reads must precede all ghost transform writes');}
  }
  for(const version of ['baseline','web6']) {
    const page=await browser.newPage();await page.goto(origin+'/fixture');
    const data=await page.evaluate(async version=>{const m=await import('/'+version+'/motion.js');const c=document.createElement('div');c.style.display='flex';document.body.append(c);const log=[];for(let i=0;i<4;i++){const n=document.createElement('div');n.style.cssText='width:50px;height:50px';c.append(n);const read=n.getBoundingClientRect.bind(n);n.getBoundingClientRect=()=>{log.push('read');return read();};n.animate=(frames,options)=>{log.push('animate');return {frames,options};};}m.flip(c,()=>{c.prepend(c.lastChild);log.push('mutate');});return log;},version);
    results.flip.push({version,events:data});await page.close();
  }
  if(process.argv.includes('--require-drag-batching')){const events=results.flip[1].events;assert.deepEqual(events.slice(events.indexOf('mutate')+1),['read','read','read','read','animate','animate','animate','animate']);}
  const pixelImages=[];
  for(const version of ['baseline','web6']) {
    const page=await browser.newPage({viewport:{width:800,height:600}});await page.goto(origin+'/fixture');
    await page.evaluate(async version=>{let q=[];window.requestAnimationFrame=fn=>{q.push(fn);return q.length;};window.cancelAnimationFrame=()=>{};const tick=now=>{const old=q;q=[];old.forEach(fn=>fn(now));};const m=await import('/'+version+'/motion.js');const target=document.createElement('div');target.className='target';document.body.append(target);const g=document.createElement('div');g.className='ghost';g.innerHTML='<b>CARD</b><hr>Corner and shadow';m.flight(g,{left:20,top:30,width:100,height:146},target,{duration:480,delay:40,tilt:-9,startRotate:7,endRotate:13,startScale:.7,endScale:.8,scaleLate:.7,endOpacity:.3});tick(0);tick(40);tick(80);target.style.left='510px';tick(160);tick(240);},version);
    pixelImages.push(await page.screenshot({path:resolve(out,`${version}-midflight.png`)}));await page.close();
  }
  assert.ok(pixelImages[0].equals(pixelImages[1]),'Real Chromium midflight PNG pixels differ');
  results.pixelEquality=true;
  // Fixture-only experiment: the same outer rectangle does not preserve image, corner or shadow pixels.
  const viewerImages=[],viewerRects=[];
  for(const mode of ['geometry','transform']){
    const page=await browser.newPage({viewport:{width:800,height:600}});await page.goto(origin+'/fixture');
    viewerRects.push(await page.evaluate(async mode=>{const svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#179"/><circle cx="60" cy="90" r="40" fill="#ed7"/><path d="M0 0L120 180M120 0L0 180" stroke="#fff" stroke-width="5"/></svg>';const img=document.createElement('img');img.src='data:image/svg+xml,'+encodeURIComponent(svg);img.style.cssText='position:fixed;object-fit:contain;pointer-events:none;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);transform-origin:0 0';document.body.append(img);await img.decode();const from={left:30,top:30,width:100,height:146},to={left:240,top:120,width:360,height:240};const p=.5;const at={left:from.left+(to.left-from.left)*p,top:from.top+(to.top-from.top)*p,width:from.width+(to.width-from.width)*p,height:from.height+(to.height-from.height)*p};Object.assign(img.style,{left:at.left+'px',top:at.top+'px',borderRadius:(2+10*p)+'px'});if(mode==='geometry'){img.style.width=at.width+'px';img.style.height=at.height+'px';}else{img.style.width=from.width+'px';img.style.height=from.height+'px';img.style.transform=`scale(${at.width/from.width},${at.height/from.height})`;}return img.getBoundingClientRect().toJSON();},mode));
    viewerImages.push(await page.screenshot({path:resolve(out,`viewer-experiment-${mode}.png`)}));await page.close();
  }
  const decodePage=await browser.newPage();const mismatch=await decodePage.evaluate(async images=>{const pixels=[];for(const src of images){const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);pixels.push(ctx.getImageData(0,0,c.width,c.height).data);}let changed=0;for(let i=0;i<pixels[0].length;i+=4)if([0,1,2,3].some(k=>pixels[0][i+k]!==pixels[1][i+k]))changed++;return {changedPixels:changed,totalPixels:pixels[0].length/4};},viewerImages.map(b=>'data:image/png;base64,'+b.toString('base64')));await decodePage.close();assert.ok(mismatch.changedPixels>0);results.viewerExperiment={rects:viewerRects,...mismatch,decision:'Retain geometry animation; straightforward anisotropic transform changes object-fit/corner/shadow pixels.'};
  results.dragBurst=[];
  for(const version of ['baseline','web6']) {
    const page=await browser.newPage();await page.goto(origin+'/fixture');
    const data=await page.evaluate(async version=>{
      let q=new Map(),id=0,now=0;window.requestAnimationFrame=fn=>{q.set(++id,fn);return id;};window.cancelAnimationFrame=id=>q.delete(id);Object.defineProperty(performance,'now',{value:()=>now});
      const tick=()=>{const old=[...q.values()];q.clear();old.forEach(fn=>fn(now));};const {createDrag}=await import('/'+version+'/drag.js');const n=document.createElement('div');n.style.cssText='position:absolute;left:20px;top:30px;width:100px;height:146px';document.body.append(n);const z=document.createElement('div');z.style.cssText='position:absolute;left:300px;top:100px;width:400px;height:400px';document.body.append(z);let moves=0;const animations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){animations.push({frames,options});return animate.call(this,frames,options);};const drag=createDrag({zones:()=>[{id:'zone',el:z,accepts:()=>true}],onMove:()=>moves++,onDrop:()=>z});drag.attach(n,{});
      const pointer=(type,x,y)=>{now+=8;(type==='pointerdown'?n:window).dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,bubbles:true}));};pointer('pointerdown',50,60);pointer('pointermove',80,80);tick();const ghost=document.querySelector('.drag-ghost');const style=ghost.style;let paints=0;Object.defineProperty(style,'transform',{get(){return this.getPropertyValue('transform');},set(value){paints++;this.setProperty('transform',value);}});
      const movesBefore=moves;for(let i=0;i<8;i++)pointer('pointermove',320+i*10,220+i);const beforeFrame=paints;tick();const afterFrame=paints;const rendered={transform:ghost.style.transform,tilt:ghost.firstElementChild.style.getPropertyValue('--g-tilt')};pointer('pointermove',440,240);pointer('pointerup',440,240);
      return {beforeFrame,afterFrame,moves:moves-movesBefore,rendered,landing:animations.find(a=>a.options.duration===480)};
    },version);results.dragBurst.push({version,data});await page.close();
  }
  assert.deepEqual(results.dragBurst[1].data.rendered,results.dragBurst[0].data.rendered);
  assert.deepEqual(results.dragBurst[1].data.landing,results.dragBurst[0].data.landing);
  assert.equal(results.dragBurst[1].data.moves,results.dragBurst[0].data.moves);
  await writeFile(resolve(out,'drag-burst.json'),JSON.stringify(results.dragBurst,null,2));
  if(process.argv.includes('--require-drag-batching'))assert.equal(results.dragBurst[1].data.afterFrame,1,'Eight pointer moves should paint once at next rAF');
  results.edgeScroll=[];
  for(const version of ['baseline','web6']){
    const page=await browser.newPage({viewport:{width:800,height:600}});await page.goto(origin+'/fixture');
    const data=await page.evaluate(async version=>{let q=new Map(),id=0,now=16;window.requestAnimationFrame=fn=>{q.set(++id,fn);return id;};window.cancelAnimationFrame=id=>q.delete(id);Object.defineProperty(performance,'now',{value:()=>now});const tick=()=>{const old=[...q.entries()];for(const [key,fn]of old){if(!q.has(key))continue;q.delete(key);fn(now);}now+=16;};document.body.style.height='2400px';const n=document.createElement('div');n.style.cssText='position:absolute;left:20px;top:30px;width:100px;height:146px';document.body.append(n);const {createDrag}=await import('/'+version+'/drag.js');let moves=0;const drag=createDrag({zones:()=>[],onMove:()=>moves++});drag.attach(n,{});const pointer=(type,x,y)=>(type==='pointerdown'?n:window).dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,bubbles:true}));pointer('pointerdown',50,60);pointer('pointermove',80,80);tick();pointer('pointermove',400,590);const frames=[];for(let i=0;i<8;i++){tick();const g=document.querySelector('.drag-ghost');frames.push({scrollY,transform:g.style.transform,tilt:g.firstElementChild.style.getPropertyValue('--g-tilt'),moves});}window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return frames;},version);results.edgeScroll.push({version,data});await page.close();
  }
  assert.deepEqual(results.edgeScroll[1].data,results.edgeScroll[0].data,'Continuous edge-scroll frame/tilt/callback mismatch');assert.ok(results.edgeScroll[1].data.at(-1).scrollY>0,'Edge-scroll fixture must really scroll');
  for(const version of ['baseline','web6']) for(const touch of [false,true]) for(const reduced of [false,true]) for(const outcome of ['land','escape','reject']) {
    const page=await browser.newPage({viewport:{width:800,height:600},hasTouch:touch,reducedMotion:reduced?'reduce':'no-preference'});await page.goto(origin+'/fixture');
    await page.evaluate(async ({version,touch,outcome})=>{
      window.clockNow=0;Object.defineProperty(performance,'now',{value:()=>window.clockNow});let q=[];window.requestAnimationFrame=fn=>{q.push(fn);return q.length;};window.cancelAnimationFrame=()=>{};window.dragTick=now=>{window.clockNow=now;const old=q;q=[];old.forEach(fn=>fn(now));};
      window.animations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.animations.push({frames,options});return animate.call(this,frames,options);};
      const {createDrag}=await import('/'+version+'/drag.js');const n=document.createElement('div');n.id='source';n.style.cssText='position:absolute;left:20px;top:30px;width:100px;height:146px;background:#abc';document.body.append(n);const z=document.createElement('div');z.id='zone';z.style.cssText='position:absolute;left:400px;top:200px;width:180px;height:250px';document.body.append(z);window.drops=[];window.moves=[];window.drag=createDrag({zones:()=>[{id:'zone',el:z,accepts:()=>true}],onMove:(id,p,x,y)=>window.moves.push({id,x,y}),onDrop:(p,id,point)=>{window.drops.push({id,point});return outcome === 'reject' ? false : z;}});window.drag.attach(n,{tag:'test'});window.touchMode=touch;
      window.dragOutcome=outcome;
    },{version,touch,outcome});
    // Real browser DOM PointerEvents exercise the same mobile pointer branch; no mocked drag API.
    const pointer=async(type,x,y,time)=>page.evaluate(({type,x,y,time})=>{window.clockNow=time;(type==='pointerdown'?document.querySelector('#source'):window).dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:1,pointerType:window.touchMode?'touch':'mouse',button:0,bubbles:true,cancelable:true}));},{type,x,y,time});
    await pointer('pointerdown',50,60,0);if(touch)await page.waitForTimeout(300);await pointer('pointermove',80,80,16);await page.evaluate(()=>dragTick(16));await pointer('pointermove',430,250,32);await page.evaluate(()=>dragTick(32));if(outcome==='escape')await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));else await pointer('pointerup',445,260,48);await page.waitForTimeout(700);
    const data=await page.evaluate(()=>({drops,moves,animations,dragging:drag.dragging,sourceDragging:document.querySelector('#source').dataset.dragging||null,hidden:document.querySelector('#zone').style.visibility}));results.drag.push({version,touch,reduced,outcome,data});assert.equal(data.drops.length,outcome==='escape'?0:1);assert.equal(data.dragging,false);assert.equal(data.hidden,'');if(!reduced&&outcome==='land')assert.ok(data.animations.some(a=>a.options.duration===480),'drag landing must remain 480ms');await page.close();
  }
  for(const touch of [false,true])for(const reduced of [false,true])for(const outcome of ['land','escape','reject']){const pair=results.drag.filter(d=>d.touch===touch&&d.reduced===reduced&&d.outcome===outcome);assert.deepEqual(pair[1].data,pair[0].data,'Drag event/lifecycle/keyframe mismatch');}
  results.deal=[];const dealImages=[];
  for(const version of ['baseline','web6']){
    const page=await browser.newPage({viewport:{width:1000,height:600}});await page.goto(origin+'/fixture');
    const data=await page.evaluate(async version=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/web6/styles.css';document.head.append(link);await new Promise(r=>link.onload=r);const c=document.createElement('div');c.style.cssText='display:grid;grid-template-columns:repeat(10,80px);gap:6px;position:absolute;left:30px;top:40px';document.body.append(c);let reads=0;const measure=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetWidth').get;for(let i=0;i<20;i++){const n=document.createElement('div');n.className='card dealt';n.textContent='Card '+i;n.style.cssText='width:80px;height:100px;background:#abc';n.style.setProperty('--i',String(i));c.append(n);Object.defineProperty(n,'offsetWidth',{get(){reads++;return measure.call(this);}});}Object.defineProperty(c,'offsetWidth',{get(){reads++;return measure.call(this);}});await new Promise(requestAnimationFrame);c.getAnimations({subtree:true}).forEach(a=>a.finish());if(version==='baseline'){[...c.querySelectorAll('.card')].forEach((n,i)=>{n.classList.remove('dealt');void n.offsetWidth;n.style.setProperty('--i',String(i));n.classList.add('dealt');});}else{const {replayDeal}=await import('/web6/motion.js');replayDeal(c);}const animations=c.getAnimations({subtree:true});animations.forEach(a=>{a.pause();a.currentTime=300;});return {reads,animations:animations.map(a=>({frames:a.effect.getKeyframes(),timing:a.effect.getTiming()})),indices:[...c.children].map(n=>n.style.getPropertyValue('--i'))};},version);results.deal.push({version,data});dealImages.push(await page.screenshot({path:resolve(out,`${version}-deal.png`)}));await page.close();
  }
  assert.equal(results.deal[0].data.reads,20);assert.equal(results.deal[1].data.reads,1);assert.deepEqual(results.deal[1].data.animations,results.deal[0].data.animations);assert.deepEqual(results.deal[1].data.indices,results.deal[0].data.indices);assert.ok(dealImages[0].equals(dealImages[1]),'Deal CSS animation screenshot pixels differ');
  results.batch=[];
  for(const version of ['baseline','web6'])for(const n of [12,50]){
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());await page.addInitScript(({n})=>{localStorage.setItem('mochi.settings.v1',JSON.stringify({rating:'general',n}));}, {n});await page.goto(origin+'/'+version+'/?debug');await page.waitForFunction(()=>window.mochi?.lib());
    await page.evaluate(n=>{mochi.settings.n=n;window.seedCounter=1000;crypto.getRandomValues=array=>{for(let i=0;i<array.length;i++)array[i]=window.seedCounter++;return array;};window.framesBeforeCommit=0;window.batchStart=false;const watch=()=>{if(window.batchStart&&mochi.shots.length===0)window.framesBeforeCommit++;if(mochi.shots.length===0)requestAnimationFrame(watch);};requestAnimationFrame(watch);},n);
    await page.evaluate(()=>document.addEventListener('click',e=>{if(e.target.closest('button')?.textContent.trim()==='只抽牌'){window.batchStart=true;window.framesBeforeCommit=0;}},{capture:true,once:true}));await page.getByRole('button',{name:'只抽牌',exact:true}).first().click();await page.waitForFunction(n=>mochi.shots.length===n,n,{timeout:60000});
    const data=await page.evaluate(()=>({framesBeforeCommit,shots:mochi.shots.map(s=>({seed:s.seed,positive:s.positive,drawn:s.drawn,width:s.width,height:s.height,rating:s.rating})),domOrder:[...document.querySelectorAll('#wall > .shot')].map(n=>n.dataset.id),shotOrder:mochi.shots.map(s=>s.id),count:document.querySelectorAll('#wall > .shot').length}));assert.equal(data.count,n);assert.deepEqual(data.domOrder,data.shotOrder.slice().reverse(),'Baseline DOM prepend order contract');assert.equal(errors.length,0);results.batch.push({version,n,errors,data});await page.close();
  }
  for(const n of [12,50]){const pair=results.batch.filter(b=>b.n===n);assert.deepEqual(pair[1].data.shots,pair[0].data.shots,'Seeded batch shot order/content mismatch');}assert.ok(results.batch.find(b=>b.version==='web6'&&b.n===50).data.framesBeforeCommit>0,'Large batch must yield to actual animation frames');
  results.batchCancellation=[];
  for(const action of ['stop','escape','queued-stop-restart','float-stop']){
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());await page.addInitScript(()=>localStorage.setItem('mochi.settings.v1',JSON.stringify({rating:'general',n:50})));await page.goto(origin+'/web6/?debug');await page.waitForFunction(()=>window.mochi?.lib());
    const idle=await page.evaluate(()=>({shots:mochi.shots.length,stopButtons:[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='停').length}));assert.equal(idle.shots,0);assert.equal(idle.stopButtons,0,'Preparation starts from an idle UI');
    if(action==='float-stop')await page.evaluate(()=>mochi.pin('blue_eyes'));
    // Hold the batch's cooperative continuation and its paired timeout fallback.
    // All other browser/UI timers and animation frames remain live.
    // This gives the Stop click an unambiguous preparation window even on very fast hosts.
    await page.evaluate(()=>{const raf=requestAnimationFrame.bind(window),timer=setTimeout.bind(window);let gateId=900000;window.batchGate=[];window.batchFallbacks=0;window.holdBatch=true;window.requestAnimationFrame=callback=>{if(window.holdBatch&&new Error().stack.includes('drawBatchNow')){window.batchGate.push(callback);return ++gateId;}return raf(callback);};window.setTimeout=(callback,delay,...args)=>{if(window.holdBatch&&(delay===50||delay===0)&&new Error().stack.includes('drawBatchNow')){window.batchFallbacks++;window.batchGate.push(()=>callback(...args));return ++gateId;}return timer(callback,delay,...args);};window.releaseBatch=()=>{window.holdBatch=false;for(const callback of window.batchGate.splice(0))raf(callback);};});
    await page.getByRole('button',{name:'只抽牌',exact:true}).first().click();await page.waitForFunction(()=>window.batchGate.length>0,{},{timeout:30000});
    if(action==='queued-stop-restart'){await page.getByRole('button',{name:'只抽牌',exact:true}).first().click();await page.getByRole('button',{name:'只抽牌',exact:true}).first().click();}
    const preparing=await page.evaluate(()=>({shots:mochi.shots.length,heldContinuations:batchGate.length,heldFallbacks:batchFallbacks,stopButtons:[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='停').length}));assert.equal(preparing.shots,0);assert.ok(preparing.heldFallbacks>0,'Batch timeout fallback must also be held');assert.ok(preparing.stopButtons>0,'Stop must be visible during idle-start preparation');
    if(action==='float-stop'){await page.evaluate(()=>{const space=document.createElement('div');space.style.height='1800px';document.body.append(space);window.scrollTo(0,document.documentElement.scrollHeight);});await page.waitForFunction(()=>document.querySelector('#go-float')?.dataset.show==='true'&&!document.querySelector('#go-float').inert);await page.locator('#go-float').getByRole('button',{name:'停',exact:true}).click();}
    else if(action==='escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:'停',exact:true}).first().click();await page.evaluate(()=>releaseBatch());await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='停'),{},{timeout:30000});
    const canceled=await page.evaluate(()=>({shots:mochi.shots.length,domShots:document.querySelectorAll('#wall > .shot').length,heldContinuations:batchGate.length,statuses:mochi.shots.map(s=>s.status)}));assert.ok(canceled.shots>0&&canceled.shots<50,'Stop retains only the active round cards already drawn');assert.equal(canceled.domShots,canceled.shots);assert.ok(canceled.statuses.every(s=>s==='drawn'));await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>mochi.shots.length),canceled.shots,'Canceled queued epochs must not start another round');
    let restarted=null;if(action==='queued-stop-restart'){const expectedCount=canceled.shots+12;await page.evaluate(()=>mochi.settings.n=12);await page.getByRole('button',{name:'只抽牌',exact:true}).first().click();await page.waitForFunction(count=>mochi.shots.length===count,expectedCount,{timeout:60000});await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='停'));restarted=await page.evaluate(()=>({shots:mochi.shots.length,domShots:document.querySelectorAll('#wall > .shot').length,statuses:mochi.shots.map(s=>s.status)}));assert.equal(restarted.domShots,expectedCount);assert.ok(restarted.statuses.every(s=>s==='drawn'));}
    assert.equal(errors.length,0,JSON.stringify(errors));results.batchCancellation.push({action,idle,preparing,canceled,restarted,errors});await page.close();
  }
  for(const mobile of [false,true]) for(const path of ['/web6/','/web6/fuse.html','/web/']) {
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
    await page.goto(origin+path);await page.waitForTimeout(1500);const state=await page.evaluate(()=>({title:document.title,text:document.body.innerText.length,buttons:document.querySelectorAll('button').length,overflow:document.documentElement.scrollWidth>innerWidth+1}));
    await page.screenshot({path:resolve(out,`smoke-${path.includes('fuse')?'fuse':path.includes('web6')?'web6':'web'}-${mobile?'mobile':'desktop'}.png`),fullPage:true});results.smoke.push({path,mobile,errors,...state});assert.ok(state.buttons>0);assert.equal(errors.length,0,JSON.stringify(errors));await page.close();
  }
  await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({flightCases:results.flights.length,flip:results.flip,dragCases:results.drag.length,smoke:results.smoke},null,2));
} finally {await browser.close();server.close();}
