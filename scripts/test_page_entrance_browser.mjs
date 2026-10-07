// Real pages: opening/reload, bounded effects, interruption and final geometry.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const pw=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/boshe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.planning/page-entrance-browser');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname==='/api/ping'?{ok:false}:[]));return;}
  let file=resolve(root,'.'+decodeURIComponent(u.pathname));
  if(u.pathname.endsWith('/'))file=resolve(file,'index.html');
  if(!existsSync(file)&&u.pathname.startsWith('/web6/'))file=resolve(root,'web',u.pathname.slice(6));
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,results=[];
async function install(page){
  await page.route('https://**/*',r=>r.abort());
  await page.addInitScript(()=>{
    localStorage.setItem('mochi.settings.v1',JSON.stringify({rating:'general',n:1}));
    localStorage.setItem('mochi.fuse.settings.v1',JSON.stringify({rating:'general',n:1}));
    localStorage.setItem('mochi.hand.v1',JSON.stringify(['1girl']));
    localStorage.setItem('mochi.fuse.hand.v1',JSON.stringify(['1girl']));
    window.entryRecords=[];window.hadViewTransition=false;
    addEventListener('pagereveal',e=>{window.hadViewTransition=!!e.viewTransition;});
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(options?.id==='web6-page-enter')entryRecords.push({id:this.id,className:this.className,fixed:!!this.closest('.fav-hand,.go-float,.trash'),frames,options});
      return animate.call(this,frames,options);
    };
  });
}
async function ready(page,fuse){await page.waitForFunction(fuse?()=>document.body.classList.contains('fuse')&&document.querySelector('.fav-hand')&&document.querySelector('#trials')?.childElementCount===4:()=>!document.body.classList.contains('fuse')&&document.querySelector('.fav-hand')&&document.querySelector('#lib-grid')?.childElementCount>0);}
async function settled(page){await page.waitForFunction(()=>!document.getAnimations().some(a=>a.id==='web6-page-enter'));await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(180);}
async function geometry(page){return page.evaluate(()=>[...document.querySelectorAll('.mast,.library .panel-head,.case-head,#pool .panel-head,.plate-head,.pool-well,.register,.rules,.go-bar,.fav-hand,.go-float,.lib-grid > .card:nth-child(-n+18),.case-grid > .card:nth-child(-n+18)')].map(n=>{
  const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {id:n.id,className:n.className,rect:[r.x,r.y,r.width,r.height],opacity:s.opacity,translate:s.translate,scale:s.scale,transform:s.transform};
}));}
try{
  for(const engine of (process.argv.includes('--chromium-only')?['chromium']:process.argv.includes('--webkit-only')?['webkit']:['chromium','webkit'])){
    const browser=await pw[engine].launch({headless:true});
    try{
      for(const width of [393,1280])for(const fuse of [false,true]){
        const path=fuse?'fuse.html':'index.html',url=origin+'/web6/'+path+'?debug';
        const page=await browser.newPage({viewport:{width,height:852},reducedMotion:'no-preference'}),errors=[];
        page.on('pageerror',e=>errors.push(e.message));await install(page);await page.goto(url);await ready(page,fuse);
        await page.waitForFunction(()=>entryRecords.length>0);
        const records=await page.evaluate(()=>entryRecords);assert.ok(records.length<=38);assert.ok(records.every(r=>!r.fixed));
        assert.ok(records.some(r=>r.className.includes('mast')));assert.ok(records.every(r=>r.options.delay+r.options.duration<650));
        await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='web6-page-enter').forEach(a=>{a.pause();a.currentTime=150;}));
        await page.screenshot({path:resolve(out,`${engine}-${width}-${fuse?'fuse':'mochi'}-enter.png`)});
        await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='web6-page-enter').forEach(a=>a.finish()));await settled(page);
        const normal=await geometry(page);
        await page.screenshot({path:resolve(out,`${engine}-${width}-${fuse?'fuse':'mochi'}-settled.png`)});
        const reduced=await browser.newPage({viewport:{width,height:852},reducedMotion:'reduce'});await install(reduced);await reduced.goto(url);await ready(reduced,fuse);await settled(reduced);
        assert.equal(await reduced.evaluate(()=>entryRecords.length),0);
        assert.deepEqual(await geometry(reduced),normal,'Settled opening must preserve geometry and CSS transforms');await reduced.close();
        await page.reload();await ready(page,fuse);await page.waitForFunction(()=>entryRecords.length>0);
        await page.evaluate(()=>dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})));assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='web6-page-enter').length),0);
        // 手機寬度：墨池、疊印台的字盒都收成挑牌抽屜，搜尋框要打開抽屜才看得到；打完字收回去，下面才點得到換頁。
        const search=page.locator(fuse?'#case-q':'#lib-q');const picker=!(await search.isVisible());
        if(picker){const open=page.locator(fuse?'#case-open':'#lib-toggle');await open.scrollIntoViewIfNeeded();await open.click();}
        await search.fill('kimono');await page.waitForTimeout(100);
        assert.equal(await search.inputValue(),'kimono');assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='web6-page-enter').length),0);
        if(picker){await page.click('.picker-done');await page.waitForTimeout(400);}
        // The Windows WebKit port crashes on this existing native cross-document
        // transition, including HEAD motion.js. Only disable that transition in
        // this runner; direct opening/reload effects above remain fully enabled.
        if(engine==='webkit')await page.addStyleTag({content:'@view-transition { navigation: none; }'});
        if(engine==='chromium')await page.route('**/web6/lexicon.json',async route=>{await new Promise(r=>setTimeout(r,1450));await route.continue();});
        await page.locator(fuse?'.page-switch a[href="./"]':'.page-switch a[href="fuse.html"]').click();await ready(page,!fuse);await settled(page);
        const cross=await page.evaluate(()=>({transition:hadViewTransition,entryEffects:entryRecords.length}));
        if(cross.transition)assert.equal(cross.entryEffects,0,'Native page transition must own the entrance');
        if(engine==='chromium')cross.delayedLexiconMs=1450;
        if(engine==='webkit'){cross.nativeTransitionDisabledInRunner=true;await page.addStyleTag({content:'@view-transition { navigation: none; }'});}
        await page.goBack();await ready(page,fuse);await settled(page);assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='web6-page-enter').length),0);
        assert.deepEqual(errors,[]);results.push({engine,width,page:path,effects:records.length,maximumEndMs:Math.max(...records.map(r=>r.options.delay+r.options.duration)),reduced:true,settledGeometryEqual:true,reload:true,interruptAndSearch:true,cross,history:true});
        await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));
        await page.close();
      }
    }finally{await browser.close();}
  }
  await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{server.close();}
