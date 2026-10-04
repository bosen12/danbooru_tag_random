import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

// Execute the actual tray morph and cleanup with a controlled browser frame loop.
const source=readFileSync(new URL('../web6/hand.js',import.meta.url),'utf8');
const begin=source.indexOf('  let morphEnd = null;');
const end=source.indexOf('  /** 牌從底下一張一張浮上來',begin);
assert.ok(begin>=0&&end>begin);
function runtime({hidden=false,reduced=false,initialHidden=false}={}){
  const classes=new Set(),frames=new Map(),animations=[],cards=[];let next=0;
  const document={hidden,addEventListener(type,fn){this[type]=fn;}};
  const expanded={top:450,left:16,right:376,bottom:750,width:360,height:300};
  const collapsed={top:700,left:100,right:292,bottom:750,width:192,height:50};
  const el={dataset:{open:'true',hidden:String(initialHidden)},style:{},classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));}},getBoundingClientRect(){return this.dataset.open==='true'?expanded:collapsed;},animate(frames,options){const a={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;}};
  const context={el,document,fan:{querySelectorAll:()=>cards},open:true,reduced:()=>reduced,getComputedStyle:()=>({padding:'8px 12px 14px',borderRadius:'16px'}),DUR:{medium:300,micro:120},CURVE:{out:'out',inOut:'inOut',exit:'exit'},css:x=>x,riseCards(){},requestAnimationFrame(fn){const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);}};
  const api=vm.runInNewContext(source.slice(begin,end)+'\n({morphTo})',context);
  return {classes,frames,animations,document,el,open(value,changed=true){context.open=value;api.morphTo(()=>{el.dataset.open=String(value);el.dataset.hidden='false';},changed);},step(){const q=[...frames.values()];frames.clear();q.forEach(fn=>fn());}};
}

test('closing releases size and clipping before restoring backdrop on a later painted frame',()=>{
  const r=runtime();r.open(false);const a=r.animations[0];
  assert.equal(a.options.duration,300);assert.equal(r.el.style.width,'360px');
  a.onfinish();
  for(const name of ['width','height','padding','borderRadius','overflow'])assert.equal(r.el.style[name],'');
  assert.equal(r.classes.has('is-collapsing'),false);assert.equal(a.cancelled,true);
  assert.equal(r.classes.has('is-morphing'),true,'backdrop must remain off until the settled size has painted');
  r.step();assert.equal(r.classes.has('is-morphing'),true);
  r.step();assert.equal(r.classes.has('is-morphing'),false);assert.equal(r.frames.size,0);
});

test('opening retains its 360ms choreography and restores backdrop after settled paint',()=>{
  const r=runtime();r.el.dataset.open='false';r.open(true);
  const a=r.animations[0];assert.equal(a.options.duration,360);a.onfinish();
  assert.equal(r.classes.has('is-morphing'),true);r.step();r.step();
  assert.equal(r.classes.has('is-morphing'),false);
});

test('a new morph cancels old queued restoration, which cannot clear the new morph state',()=>{
  const r=runtime();r.open(false);r.animations[0].onfinish();r.step();
  r.open(true);assert.equal(r.frames.size,0);r.step();
  assert.equal(r.classes.has('is-morphing'),true);
  const old=r.animations[0];old.oncancel();assert.equal(r.classes.has('is-morphing'),true);
  r.animations[1].onfinish();r.step();r.step();assert.equal(r.classes.has('is-morphing'),false);
});

test('interrupting an active morph releases old dimensions and keeps only the latest cleanup',()=>{
  const r=runtime();r.open(false);const old=r.animations[0];r.open(true);
  assert.equal(old.cancelled,true);assert.equal(r.el.style.width,'');assert.equal(r.frames.size,0);
  old.onfinish();assert.equal(r.classes.has('is-morphing'),true);
  r.animations[1].oncancel();r.step();r.step();assert.equal(r.classes.has('is-morphing'),false);
});

test('hidden-page cleanup restores immediately, and hiding a settling page cancels its frames',()=>{
  const hidden=runtime({hidden:true});hidden.open(false);hidden.animations[0].onfinish();
  assert.equal(hidden.classes.has('is-morphing'),false);assert.equal(hidden.frames.size,0);
  const r=runtime();r.open(false);r.animations[0].onfinish();r.document.hidden=true;r.document.visibilitychange();
  assert.equal(r.classes.has('is-morphing'),false);assert.equal(r.frames.size,0);
});

test('reduced motion changes immediately; a newly appearing tray also cleans its entrance',()=>{
  const reduced=runtime({reduced:true});reduced.open(false);assert.equal(reduced.animations.length,0);assert.equal(reduced.frames.size,0);
  const r=runtime({initialHidden:true});r.open(true);r.animations[0].onfinish();
  assert.equal(r.animations[0].cancelled,true);assert.equal(r.classes.has('is-morphing'),true);
  r.step();r.step();assert.equal(r.classes.has('is-morphing'),false);
});
