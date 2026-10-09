const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const {listen}=require('./serve-web.cjs');
const {arg,output}=require('./check-options.cjs');
const root=path.resolve(arg('root','dist/web/releases/online-r05')),out=output('evidence/online-r01/http-edge'),isWebKit=process.argv.includes('--webkit');
const report={actualDevice:false,engine:isWebKit?'Windows WebKit (visual only)':'Edge',root,network:'127.0.0.1 HTTP; cold browser contexts; no public network',checks:[],expectedFaults:[],errors:[],performance:[]};
report.provenance={indexSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),baseline:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),viewport:{width:390,height:844},cache:'fresh contexts; routing disables HTTP cache; performance CDP additionally disables cache'};
const child=(script,url)=>new Promise((resolve,reject)=>{
  const args=[path.join(__dirname,script+'.cjs'),'--url',url,'--evidence-dir',path.join(out,script),...(isWebKit?['--webkit']:[])];
  const processHandle=spawn(process.execPath,args,{env:process.env,windowsHide:true});let log='';
  processHandle.stdout.on('data',b=>log+=b);processHandle.stderr.on('data',b=>log+=b);processHandle.on('error',reject);
  processHandle.on('close',code=>{fs.writeFileSync(path.join(out,script+'.log'),log);code===0?resolve():reject(new Error(script+' failed; see log'));});
});
async function main(){
 const service=await listen(root),sub=await listen(root,{basePath:'/game/'});
 const browser=isWebKit?await webkit.launch():await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});report.browser=browser.version();
 async function pageFor(url=service.url,{fault=null,setup=null,throttle=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await context.newPage(),requests=[],unexpected=[],warnings=[];
  page.on('pageerror',e=>unexpected.push(e.message));page.on('console',m=>{if(['warning','error'].includes(m.type()))warnings.push(m.text());});
  page.on('request',r=>requests.push({url:r.url(),type:r.resourceType()}));
  await context.route(/^https?:/,async route=>{if(new URL(route.request().url()).origin!==new URL(url).origin){unexpected.push('External request '+route.request().url());return route.abort();}if(fault&&await fault(route))return;return route.continue();});
  if(setup)await context.addInitScript(setup);
  if(throttle){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:500000,uploadThroughput:500000,connectionType:'cellular4g'});}
  const start=Date.now();await page.goto(url,{waitUntil:'domcontentloaded'});
  return {page,context,requests,unexpected,warnings,start,async close(expected=false){if(expected)report.expectedFaults.push({warnings,errors:unexpected});else{assert.deepEqual(unexpected,[]);assert.deepEqual(warnings,[]);}await context.close();}};
 }
 const menu=p=>p.waitForSelector('#stage[data-state=menu]');
 const playing=p=>p.waitForFunction(()=>{const a=document.querySelector('#music');return !a.paused&&a.currentTime>.12;});
 try{
  for(const url of [service.url,sub.url]){
   const h=await pageFor(url);await menu(h.page);await h.page.waitForTimeout(150);
   assert.equal(h.requests.filter(r=>r.url.endsWith('.mp3')).length,0);assert.equal(await h.page.locator('#music').getAttribute('src'),null);
   report.checks.push({name:'L01/H01 menu, zero MP3 before gesture, relative base',url,menuMs:Date.now()-h.start});await h.close();
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const music=fs.readdirSync(path.join(root,'assets/music')).find(file=>file.startsWith('anthem.'));
  const range=await fetch(service.url+'assets/music/'+music,{headers:{Range:'bytes=10-73'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-type'),'audio/mpeg');assert.equal(range.headers.get('content-length'),'64');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),fs.readFileSync(path.join(root,'assets/music',music)).subarray(10,74));
  report.checks.push({name:'H01 actual MP3 Range bytes match original',status:range.status,headers:Object.fromEntries(range.headers)});
  for(const extension of ['png','mp3','js'])assert.equal((await fetch(service.url+'missing.'+extension)).status,404);
  for(const rel of ['index.html',...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(v=>typeof v==='string'?v:v[1])){
   const res=await fetch(service.url+rel,{method:'HEAD'});assert.equal(res.status,200);report.checks.push({name:'HTTP headers',file:rel,status:res.status,headers:Object.fromEntries(res.headers)});
  }
  for(const failure of ['404','corrupt','timeout']){
   let failing=true;const delayed=[];
   const h=await pageFor(service.url,{fault:async route=>{
    if(failing&&/\/images\/head\./.test(route.request().url())){
     if(failure==='timeout') { delayed.push(route); return true; }
     await route.fulfill({status:failure==='404'?404:200,contentType:'image/png',body:failure==='404'?'missing':'invalid PNG bytes'});return true;
    }return false;
   },setup:()=>{const raf=requestAnimationFrame;window.__pendingFrames=0;window.__maxFrames=0;window.requestAnimationFrame=fn=>{window.__pendingFrames++;window.__maxFrames=Math.max(window.__maxFrames,window.__pendingFrames);return raf(t=>{window.__pendingFrames--;fn(t);});};}});
   await h.page.waitForSelector('#retryImages:not([hidden])',{timeout:19000});assert.match(await h.page.locator('#loadingText').textContent(),/素材加载失败/);failing=false;
   for(const route of delayed)await route.abort().catch(()=>{});
   await h.page.locator('#retryImages').click();await menu(h.page);await h.page.waitForTimeout(150);assert.equal(await h.page.locator('#trackList button').count(),4);assert.equal(await h.page.evaluate(()=>window.__maxFrames),1);
   assert.deepEqual(h.unexpected,[]);assert.ok(h.warnings.some(w=>w.includes('Image loading:')));assert.ok(h.warnings.every(w=>/Image loading:|Failed to load resource:/.test(w)));
   report.checks.push({name:'L02 image '+failure+' then retry; one frame loop and four song buttons',passed:true});await h.close(true);
  }
  for(const name of ['app','core','resources','style']){
   const h=await pageFor(service.url,{fault:async route=>{if(new RegExp('/'+name+'\\.[a-f0-9]+\\.(?:js|css)$').test(route.request().url())){await route.fulfill({status:404,contentType:'text/plain',body:'missing'});return true;}return false;}});
   await h.page.waitForSelector('#bootError:not([hidden])');assert.deepEqual(h.unexpected,[]);assert.equal(await h.page.locator('#trackList button').count(),0,'A missing dependency must not initialize the game');assert.ok(h.warnings.every(w=>/Failed to load resource:/.test(w)));report.checks.push({name:'L03 '+name+' 404 gives reload instruction',passed:true});await h.close(true);
  }
  if(!isWebKit){
   const h=await pageFor();await menu(h.page);await h.page.locator('#start').click();await playing(h.page);await h.page.locator('#skip').click();await h.page.locator('#pauseButton').click();
   const before=h.requests.filter(r=>r.url.endsWith('.mp3')).length;await h.page.locator('#soundButton').click();await h.page.locator('[data-track="2"]').click();await h.page.waitForTimeout(250);assert.equal(h.requests.filter(r=>r.url.endsWith('.mp3')).length,before);assert.equal(await h.page.locator('#music').evaluate(a=>a.paused),true);
   await h.page.locator('[data-close=soundDialog]').click();await h.page.locator('#resume').click();await playing(h.page);report.checks.push({name:'A03 paused selection makes zero new MP3 requests',passed:true});await h.close();
   for(const faultType of ['404','blocked-play']){
    let failing=true;const h=await pageFor(service.url,{fault:async route=>{if(failing&&faultType==='404'&&route.request().url().endsWith('.mp3')){await route.fulfill({status:404,contentType:'text/plain',body:'missing'});return true;}return false;},setup:faultType==='blocked-play'?()=>{const play=HTMLMediaElement.prototype.play;let block=true;HTMLMediaElement.prototype.play=function(){if(block){block=false;return Promise.reject(new DOMException('Injected autoplay rejection','NotAllowedError'));}return play.call(this);};}:null});
    await menu(h.page);await h.page.locator('#start').click();await h.page.waitForSelector('#audioRecover:not([hidden])');await h.page.locator('#skip').click();const state=await h.page.locator('#stage').getAttribute('data-state');failing=false;await h.page.locator('#audioRecover').click();await playing(h.page);assert.equal(await h.page.locator('#stage').getAttribute('data-state'),state);assert.equal(await h.page.locator('#trackList button[aria-pressed=true]').getAttribute('data-track'),'0');assert.deepEqual(h.unexpected,[]);assert.ok(h.warnings.every(w=>/Failed to load resource:/.test(w)));report.checks.push({name:'A04 '+faultType+' explicit recovery preserves scene and track',passed:true});await h.close(true);
   }
   for(const [key,kind] of [['failure','404'],['cheer','404'],['failure','corrupt'],['cheer','corrupt']]){
    let failing=true;const h=await pageFor(service.url,{fault:async route=>{if(failing&&new RegExp('/effects/'+key+'\\.').test(route.request().url())){await route.fulfill({status:kind==='404'?404:200,contentType:'audio/wav',body:'invalid WAV bytes'});return true;}return false;}});
    await menu(h.page);await h.page.locator('#start').click();await playing(h.page);await h.page.waitForSelector('#retryEffects:not([hidden])',{state:'attached'});await h.page.locator('#skip').click();await h.page.locator('#pauseButton').click();await h.page.locator('#soundButton').click();assert.equal(await h.page.locator('#retryEffects').isVisible(),true);failing=false;await h.page.locator('#retryEffects').click();await h.page.waitForFunction(()=>document.querySelector('#retryEffects').hidden);assert.equal(await h.page.locator('#music').evaluate(a=>a.paused),true);assert.deepEqual(h.unexpected,[]);assert.ok(h.warnings.every(w=>/Failed to load resource:|Effect read |Effect unavailable /.test(w)));report.checks.push({name:'A05 independent '+key+' '+kind+' and paused retry',passed:true});await h.close(true);
   }
   for(let attempt=1;attempt<=3;attempt++){
    const h=await pageFor(service.url,{throttle:true,setup:()=>{const AC=window.AudioContext||window.webkitAudioContext,create=AC.prototype.createMediaElementSource;AC.prototype.createMediaElementSource=function(...args){const s=create.apply(this,args),connect=s.connect;s.connect=function(g,...rest){window.__perfGain=g;return connect.call(this,g,...rest);};return s;};}});
    await menu(h.page);const menuMs=Date.now()-h.start;const click=Date.now();await h.page.locator('#start').click();await playing(h.page);const playingMs=Date.now()-click;
    const pcm=await h.page.evaluate(async()=>{const g=window.__perfGain,a=g.context.createAnalyser();a.fftSize=1024;g.connect(a);const samples=new Float32Array(1024),start=performance.now();let rms=0;while(performance.now()-start<10000){await new Promise(r=>setTimeout(r,20));a.getFloatTimeDomainData(samples);rms=Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length);if(rms>.001)break;}g.disconnect(a);return{rms,afterPlayingMs:performance.now()-start};});assert.ok(pcm.rms>.001);report.performance.push({attempt,menuMs,playingMs,pcmMs:playingMs+pcm.afterPlayingMs,rms:pcm.rms,throttle:'CDP Network.emulateNetworkConditions; 500000 bytes/s both ways, 150ms; cache disabled; all page HTTP including media; local simulation'});await h.close();
   }
   report.menuMedianMs=report.performance.map(p=>p.menuMs).sort((a,b)=>a-b)[1];report.menuTargetMet=report.menuMedianMs<=8000;
  }
  if(!process.argv.includes('--network-only')){
   for(const script of [...(isWebKit?[]:['browser-check']),'radio-check','modes-check','launch-background-check',...(isWebKit?[]:['landing-sequence'])]){console.log('Running',script);await child(script,service.url);report.checks.push({name:script,passed:true});}
  }
  report.passed=true;
 }catch(error){report.errors.push(error.stack);throw error;}
 finally{await browser.close();await service.close();await sub.close();fs.writeFileSync(path.join(out,'online-verification.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({passed:true,checks:report.checks.length,menuMedianMs:report.menuMedianMs,menuTargetMet:report.menuTargetMet,browser:report.browser}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
