// Real viewport geometry and hit testing, including native safe-area env overrides.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.planning/hand-dock-results');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/fixture'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/web6/fonts.css"><link rel="stylesheet" href="/web6/card.css"><link rel="stylesheet" href="/web6/styles.css"><main style="height:1600px">字盒</main><div id="go-float" class="go-float" data-show="true"><span class="go-float-state">池裡 1 張</span><button class="btn btn-small btn-ghost" data-action="draw">只抽牌</button><button class="btn btn-small btn-primary" data-action="generate">抽並生圖 <span class="count">×2</span></button></div><div id="safe-probe" style="position:fixed;bottom:env(safe-area-inset-bottom)"></div>');return;
  }
  let file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!existsSync(file)&&u.pathname.startsWith('/web6/'))file=resolve(root,'web',u.pathname.slice(6));
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),results=[];
try{
  for(const width of [320,393,640,768,1280,1920])for(const safe of (width<=640?[0,21,34]:[0])){
    const page=await browser.newPage({viewport:{width,height:852},isMobile:width<=640,hasTouch:width<=640,reducedMotion:'reduce'});await page.route('https://**/*',r=>r.abort());
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,right:0,bottom:safe,left:0}});
    await page.goto(origin+'/fixture');
    await page.evaluate(async()=>{localStorage.setItem('dock.hand',JSON.stringify(['alpha','beta']));localStorage.setItem('dock.hand.open','false');const {createHand}=await import('/web6/hand.js');window.hand=createHand({key:'dock.hand',makeNode:t=>{const n=document.createElement('div');n.className='card';n.textContent=t;return n;},inPool:()=>false,onPlay(){}});window.clicks=[];document.querySelectorAll('#go-float button').forEach(b=>b.addEventListener('click',()=>clicks.push(b.dataset.action)));await document.fonts.ready;});
    await page.waitForTimeout(250);
    for(const open of [false,true]){
      await page.evaluate(open=>hand.setOpen(open),open);await page.waitForTimeout(80);
      const data=await page.evaluate(()=>{const h=hand.el.getBoundingClientRect(),f=document.querySelector('#go-float').getBoundingClientRect();return{safe:parseFloat(getComputedStyle(document.querySelector('#safe-probe')).bottom),hand:h.toJSON(),float:f.toJSON(),gap:f.top-h.bottom,buttons:[...document.querySelectorAll('#go-float button')].map(b=>{const r=b.getBoundingClientRect(),points=[[r.x+r.width/2,r.y+2],[r.x+r.width/2,r.y+r.height/2],[r.x+r.width/2,r.bottom-2]];return{action:b.dataset.action,uncovered:points.every(([x,y])=>b.contains(document.elementFromPoint(x,y)))};})};});
      assert.equal(data.safe,safe,'Native safe-area env override must be active');results.push({width,safe,open,...data});
      await page.screenshot({path:resolve(out,`${width}-${safe}-${open?'open':'closed'}.png`)});
    }
    if(results.slice(-2).every(x=>x.buttons.every(b=>b.uncovered))){await page.locator('[data-action="draw"]').click();await page.locator('[data-action="generate"]').click();assert.deepEqual(await page.evaluate(()=>clicks),['draw','generate']);}
    await page.close();
  }
  await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));
  const failures=results.filter(x=>x.gap<0||x.buttons.some(b=>!b.uncovered));
  console.log(JSON.stringify({scenarios:results.length,results:results.map(x=>({width:x.width,safe:x.safe,open:x.open,gap:x.gap,buttons:x.buttons})),failures:failures.length},null,2));
  assert.deepEqual(failures,[],'Favorite tray must sit above the floating draw buttons without intercepting clicks');
}finally{await browser.close();server.close();}
