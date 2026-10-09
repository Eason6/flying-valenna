const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function harness(readArrayBuffer=async()=>new ArrayBuffer(2)) {
  const elements={};
  const element=()=>({textContent:'',dataset:{},children:[],hidden:true,addEventListener(){},setAttribute(){},appendChild(child){this.children.push(child);}});
  const listeners={};let time=0;
  const audio={...element(),src:'',currentSrc:'',currentTime:0,readyState:0,paused:true,error:null,ended:false,plays:[],loads:0,
    addEventListener(name,fn){(listeners[name]??=new Set()).add(fn);},removeEventListener(name,fn){listeners[name]?.delete(fn);},
    removeAttribute(){this.src='';},load(){this.loads++;this.currentTime=0;this.error=null;this.ended=false;},pause(){this.paused=true;},
    play(){this.currentSrc=this.src;this.paused=false;return new Promise((resolve,reject)=>this.plays.push({resolve,reject}));},
    dispatch(name){for(const fn of [...(listeners[name]||[])])fn();}};
  elements.music=audio;
  const scope={C:require('../src/core.js'),A:{delivery:'online',tracks:[0,1,2,3].map(i=>({title:String(i),src:'./'+i+'.mp3'})),effects:{failure:{src:'./f.wav'},cheer:{src:'./c.wav'}}},$:id=>elements[id]??=element(),storage:{read:(k,f)=>f},document:{hidden:false,baseURI:'https://game.test/',createElement:element},location:{origin:'https://game.test'},URL,window:{ValennaAssetIO:{readArrayBuffer}},setTimeout,clearTimeout,console:{warn(){},info(){}},performance:{now:()=>time},state:'menu',chooseTrack(){}};
  vm.createContext(scope);vm.runInContext(app.slice(app.indexOf('  class Sound {'),app.indexOf('  const sound = new Sound();'))+'\nthis.sound=new Sound();',scope);
  return {...scope,scope,audio,elements,setTime:t=>{time=t;},async flush(){await new Promise(r=>setImmediate(r));},close(){scope.sound.pause();}};
}
test('selection has no MP3 src until play; forced anthem reset and retry preserve distinct semantics',async()=>{
 const h=harness();try{const s=h.sound;assert.equal(h.audio.src,'');assert.equal(h.audio.loads,0);s.active=true;s.play();h.audio.currentTime=42;s.play();assert.equal(h.audio.currentTime,42);s.select(0);assert.equal(h.audio.src,'');s.play();assert.equal(h.audio.currentTime,0);s.pause();h.scope.state='paused';s.select(2);s.resume(true);assert.equal(h.audio.src,'');assert.equal(h.audio.paused,true);}finally{h.close();}
});
test('late A rejection/error/ended cannot fail C or advance the current selection',async()=>{
 const h=harness();try{const s=h.sound;s.active=true;s.play();const old=h.audio.plays[0];s.select(1);s.play();s.select(2);s.play();old.reject(new Error('late'));await h.flush();assert.equal(s.blocked,false);h.audio.dispatch('error');h.audio.dispatch('ended');assert.equal(s.list.index,2);assert.equal(s.blocked,false);s.pause();h.audio.dispatch('playing');h.audio.dispatch('ended');assert.equal(s.list.index,2);assert.equal(h.audio.paused,true);}finally{h.close();}
});
test('clicking an already playing song does not leave a false buffering state',()=>{
 const h=harness();try{h.sound.active=true;h.sound.play();h.audio.readyState=4;h.audio.dispatch('playing');assert.equal(h.sound.buffering,false);h.sound.play();assert.equal(h.sound.buffering,false);}finally{h.close();}
});
test('WAV concurrent reads are shared; failure is explicit retry only and independent',async()=>{
 let count=0,resolveRead;const h=harness(()=>{count++;return new Promise(resolve=>{resolveRead=resolve;});});
 const p=h.sound.readEffect('failure'),q=h.sound.readEffect('failure');assert.equal(p,q);assert.equal(count,1);resolveRead(new ArrayBuffer(4));await p;await h.sound.readEffect('failure');assert.equal(count,1);
 h.scope.window.ValennaAssetIO.readArrayBuffer=async()=>{count++;throw Error('404');};await assert.rejects(h.sound.readEffect('cheer'));await assert.rejects(h.sound.readEffect('cheer'));assert.equal(count,2);
 h.scope.window.ValennaAssetIO.readArrayBuffer=async()=>{count++;return new ArrayBuffer(4);};await h.sound.readEffect('cheer',true);assert.equal(count,3);assert.ok(h.sound.effectBytes.failure);h.close();
});
test('corrupt WAV decode can recover with a fresh read after explicit retry',async()=>{
 let reads=0,decodes=0;const h=harness(async()=>{reads++;return new ArrayBuffer(4);});
 h.sound.context={decodeAudioData:async()=>{decodes++;if(decodes===1)throw Error('corrupt');return{duration:1.2};}};
 assert.equal(await h.sound.prepareEffect('failure'),null);assert.equal(reads,1);
 assert.ok(await h.sound.prepareEffect('failure',true));assert.equal(reads,2);
});
test('late decoded events expire and pause invalidates callbacks; explicit effect retry never plays',async()=>{
 const h=harness();let starts=0,resolveDecode;const s=h.sound;
 s.context={state:'running',decodeAudioData:()=>new Promise(resolve=>{resolveDecode=resolve;}),createBufferSource:()=>({buffer:null,connect(){},start(){starts++;},disconnect(){}})};
 s.gain={};s.muted=false;s.effectsVolume=.85;s.musicGain=null;h.scope.state='crash';
 s.playFailure();await h.flush();h.setTime(1001);resolveDecode({duration:1.2});await h.flush();assert.equal(starts,0);
 s.playFailure();s.failureGeneration++;await h.flush();assert.equal(starts,0);
 h.scope.state='menu';s.prepareEffect('failure',true);await h.flush();assert.equal(starts,0);
 h.scope.state='crash';s.playFailure();await h.flush();assert.equal(starts,1);
});
