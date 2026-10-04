import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

function runtime({reduce=false, hidden=false, history=false, vt=false, vtPlayed=false, scroll=0}={}) {
  const events=[], frames=new Map(), listeners=new Map(), documentListeners=new Map(), mediaListeners=new Set(), pending=[];
  let id=0;
  const media={matches:reduce,addEventListener:(type,fn)=>mediaListeners.add(fn),removeEventListener:(type,fn)=>mediaListeners.delete(fn)};
  const node=(name,top=100)=>({name,isConnected:true, getBoundingClientRect(){events.push('read');return {top,left:20,right:100,bottom:top+60,width:80,height:60};},animate(keyframes,options){events.push('write');let finish;const finished=new Promise(r=>finish=r);const animation={keyframes,options,finished,cancelled:false,cancel(){this.cancelled=true;},finish};pending.push(animation);this.animation=animation;return animation;}});
  const mast=node('mast',10),cards=Array.from({length:18},(_,i)=>node('card'+i)),offscreen=node('offscreen',1000);
  const document={hidden,documentElement:{dataset:{...(vt?{vtIn:'fwd'}:{}),...(vtPlayed?{vtPlayed:'true'}:{})}},addEventListener:(type,fn)=>documentListeners.set(type,fn),removeEventListener:(type,fn)=>{if(documentListeners.get(type)===fn)documentListeners.delete(type);},querySelectorAll(selector){if(selector.includes('.mast'))return [mast];if(selector.includes('.lib-grid'))return [...cards,offscreen];if(selector.includes('.pool-well'))return [node('pool')];return [];}};
  const window={scrollY:scroll,innerWidth:390,innerHeight:852,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
  const context={document,window,innerWidth:390,innerHeight:852,matchMedia:()=>media,performance:{getEntriesByType:()=>[{type:history?'back_forward':'navigate'}]},getSfx:()=>({}),requestAnimationFrame(fn){const n=++id;frames.set(n,fn);return n;},cancelAnimationFrame(n){frames.delete(n);},setTimeout,clearTimeout,queueMicrotask,console};
  const source=readFileSync(new URL('../web6/motion.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'');
  const api=vm.runInNewContext(source+'\n({playPageEntrance:typeof playPageEntrance === "function" ? playPageEntrance:null})',context);
  assert.equal(typeof api.playPageEntrance,'function','Page entrance runtime must exist');
  return {...api,events,frames,listeners,documentListeners,mediaListeners,pending,mast,cards,offscreen,document,window,media,flush(){const f=[...frames.values()];frames.clear();f.forEach(fn=>fn());}};
}

test('opening batches measurements before animation and caps/staggers visible cards',()=>{
  const r=runtime();r.playPageEntrance();r.flush();
  assert.ok(r.mast.animation);assert.ok(r.cards.every(n=>n.animation));assert.equal(r.offscreen.animation,undefined);
  assert.ok(r.pending.length<=38);assert.equal(r.events.slice(r.events.indexOf('write')).includes('read'),false);
  const delays=r.cards.map(n=>n.animation.options.delay);assert.ok(delays.every((d,i)=>i===0||d>delays[i-1]));
  assert.ok(r.pending.every(a=>a.options.duration+a.options.delay<650));
  assert.ok(r.pending.every(a=>a.keyframes.every(f=>Object.keys(f).every(k=>['opacity','translate','scale'].includes(k)))));
  const count=r.pending.length;r.playPageEntrance();r.flush();assert.equal(r.pending.length,count);
});
test('a card outside the viewport remains static',()=>{
  const r=runtime();r.cards[0].getBoundingClientRect=()=>({top:900,bottom:960,left:20,right:100,width:80,height:60});
  r.playPageEntrance();r.flush();assert.equal(r.cards[0].animation,undefined);assert.ok(r.cards[1].animation);
});
for(const [name,options] of [['reduced motion',{reduce:true}],['background tab',{hidden:true}],['history restoration',{history:true}],['view transition',{vt:true}],['completed transition with late data',{vtPlayed:true}],['restored scroll',{scroll:100}]])test(name+' keeps content static and schedules no effects',()=>{
  const r=runtime(options);r.playPageEntrance();r.flush();assert.equal(r.pending.length,0);assert.equal(r.listeners.size,0);
});
test('a view transition arriving before the first frame takes ownership',()=>{
  const r=runtime();r.playPageEntrance();r.document.documentElement.dataset.vtIn='fwd';r.flush();assert.equal(r.pending.length,0);assert.equal(r.listeners.size,0);
});
test('user input lands immediately, cancels pending fill effects and removes listeners',()=>{
  const r=runtime();r.playPageEntrance();r.flush();const event={defaultPrevented:false};r.listeners.get('pointerdown')(event);
  assert.ok(r.pending.every(a=>a.cancelled));assert.equal(event.defaultPrevented,false);assert.equal(r.listeners.size,0);assert.equal(r.mediaListeners.size,0);
});
test('natural completion removes animation effects and event/media listeners',async()=>{
  const r=runtime();r.playPageEntrance();r.flush();r.pending.forEach(a=>a.finish());await new Promise(setImmediate);
  assert.ok(r.pending.every(a=>a.cancelled));assert.equal(r.listeners.size,0);assert.equal(r.mediaListeners.size,0);
});
test('pagehide before first frame cancels the scheduled entrance',()=>{
  const r=runtime();r.playPageEntrance();r.listeners.get('pagehide')();r.flush();assert.equal(r.pending.length,0);assert.equal(r.listeners.size,0);
});
test('changing reduced motion while entering cancels every effect',()=>{
  const r=runtime();r.playPageEntrance();r.flush();r.media.matches=true;[...r.mediaListeners][0]();assert.ok(r.pending.every(a=>a.cancelled));assert.equal(r.mediaListeners.size,0);
});
test('switching to a background tab lands immediately and removes its visibility listener',()=>{
  const r=runtime();r.playPageEntrance();r.flush();r.document.hidden=true;r.documentListeners.get('visibilitychange')();
  assert.ok(r.pending.every(a=>a.cancelled));assert.equal(r.documentListeners.size,0);assert.equal(r.listeners.size,0);
});
