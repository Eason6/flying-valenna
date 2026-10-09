const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{listen}=require('./serve-web.cjs'),{arg,output}=require('./check-options.cjs');
const root=path.resolve(arg('root')),out=output('evidence/online-r01/network-lifecycle');
async function main(){
 const service=await listen(root),browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={browser:browser.version(),actualDevice:false,network:'loopback HTTP with precise route/decoded-buffer faults',checks:[],errors:[]};
 report.indexSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex');
 async function open({fault,setup}={}){
  const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage(),errors=[],warnings=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')warnings.push(m.text());});
  await context.route(/^https?:/,async route=>{if(new URL(route.request().url()).origin!==new URL(service.url).origin)throw Error('Unexpected origin');if(fault&&await fault(route))return;await route.continue();});
  if(setup)await context.addInitScript(setup);
  await page.goto(service.url);await page.waitForSelector('#stage[data-state=menu]');
  return{page,context,errors,warnings,async close(){assert.deepEqual(errors,[]);assert.ok(warnings.every(w=>/Failed to load resource: net::ERR_FAILED|Failed to load resource: net::ERR_ABORTED/.test(w)),JSON.stringify(warnings));await context.close();}};
 }
 const playing=p=>p.waitForFunction(()=>{const a=document.querySelector('#music');return !a.paused&&a.currentTime>.12;});
 try{
  // Actual media starts from a 4 MiB partial response. Seeking into the missing
  // tail forces a real waiting event; pending Range requests are held, not mocked play().
  let cut=true,initial=false;const held=[],ranges=[];report.streamRanges=ranges;
  const h=await open({fault:async route=>{
   if(!cut||!route.request().url().endsWith('.mp3'))return false;
   const range=route.request().headers().range;ranges.push(range||'none');
   if(!initial){initial=true;const file=path.join(root,new URL(route.request().url()).pathname),data=fs.readFileSync(file),part=data.subarray(0,4*1048576);await route.fulfill({status:206,headers:{'content-type':'audio/mpeg','content-range':`bytes 0-${part.length-1}/${data.length}`,'content-length':String(part.length),'accept-ranges':'bytes'},body:part});return true;}
   held.push(route);return true;
  }});
  await h.page.locator('#start').click();await playing(h.page);await h.page.locator('#skip').click();await h.page.locator('#music').evaluate(a=>a.currentTime=180);
  await h.page.waitForSelector('#audioRecover:not([hidden])',{timeout:12000});assert.match(await h.page.locator('#audioRecover').textContent(),/尚未就绪/);
  const position=await h.page.locator('#music').evaluate(a=>a.currentTime);assert.ok(position>=179);
  cut=false;for(const route of held)await route.abort().catch(()=>{});
  await h.page.locator('#audioRecover').click();await h.page.waitForFunction(()=>{const a=document.querySelector('#music');return !a.paused&&a.currentTime>180.1;});
  const after=await h.page.locator('#music').evaluate(a=>a.currentTime);assert.equal(await h.page.locator('#stage').getAttribute('data-state'),'ready');assert.equal(await h.page.locator('#trackList button[aria-pressed=true]').getAttribute('data-track'),'0');
  report.checks.push({name:'A04 real playing → missing Range tail → waiting → 8s retry → metadata/seek recovery',position,after,ranges});await h.close();
  // A delayed request for A must not surface an error after C has started.
  let holdAnthem=true;const late=[];
  const rapid=await open({fault:async route=>{if(holdAnthem&&route.request().url().includes('/anthem.')){late.push(route);return true;}return false;}});
  await rapid.page.locator('#soundButton').click();await rapid.page.locator('[data-track="0"]').click();
  await rapid.page.waitForTimeout(100);await rapid.page.locator('[data-track="1"]').click();await rapid.page.locator('[data-track="2"]').click();await playing(rapid.page);holdAnthem=false;
  for(const route of late)await route.abort().catch(()=>{});await rapid.page.waitForTimeout(250);assert.equal(await rapid.page.locator('#audioRecover').isVisible(),false);assert.equal(await rapid.page.locator('#trackList button[aria-pressed=true]').getAttribute('data-track'),'2');
  report.checks.push({name:'A03 real delayed A aborted after C plays',heldRequests:late.length});await rapid.close();
  // Delay the real failure WAV decoder result; observe actual source.start calls.
  const effects=await open({setup:()=>{
   window.__effectStarts=[];window.__failureDecoded=false;const AC=window.AudioContext||window.webkitAudioContext,decode=AC.prototype.decodeAudioData,create=AC.prototype.createBufferSource;
   AC.prototype.decodeAudioData=function(...args){return decode.apply(this,args).then(buffer=>{if(buffer.duration>1&&buffer.duration<1.5)return new Promise(resolve=>setTimeout(()=>{window.__failureDecoded=true;resolve(buffer);},6500));return buffer;});};
   AC.prototype.createBufferSource=function(...args){const s=create.apply(this,args),start=s.start;s.start=function(...params){window.__effectStarts.push(s.buffer?.duration);return start.apply(this,params);};return s;};
  }});
  await effects.page.locator('#start').click();await effects.page.locator('#skip').click();await effects.page.locator('#game').click({position:{x:110,y:450}});await effects.page.waitForSelector('#stage[data-state=over]');
  await effects.page.waitForFunction(()=>window.__failureDecoded);await effects.page.waitForTimeout(100);assert.equal(await effects.page.evaluate(()=>window.__effectStarts.filter(d=>d>1&&d<1.5).length),0);
  await effects.page.locator('#retry').click();await effects.page.locator('#game').click({position:{x:110,y:450}});await effects.page.waitForSelector('#stage[data-state=over]');assert.equal(await effects.page.evaluate(()=>window.__effectStarts.filter(d=>d>1&&d<1.5).length),1);
  report.checks.push({name:'A05 real delayed decode never plays expired failure; next failure plays once'});await effects.close();
  // Visibility is simulated through the browser document property/event. It is
  // deliberately reported separately from real OS tab/background acceptance.
  const background=await open();await background.page.locator('#start').click();await playing(background.page);await background.page.locator('#skip').click();
  await background.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await background.page.waitForSelector('#stage[data-state=paused]');const before=await background.page.locator('#music').evaluate(a=>a.currentTime);await background.page.waitForTimeout(150);assert.equal(await background.page.locator('#music').evaluate(a=>a.paused),true);
  await background.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));document.querySelector('#audioRecover').click();});
  assert.equal(await background.page.locator('#music').evaluate(a=>a.paused),true);assert.ok(Math.abs(await background.page.locator('#music').evaluate(a=>a.currentTime)-before)<.05);await background.page.locator('#resume').click();await playing(background.page);
  report.checks.push({name:'A06 simulated visibility hidden/visible; late recovery button does not bypass pause'});await background.close();
  report.passed=true;
 }catch(error){report.errors.push(error.stack);throw error;}
 finally{await browser.close();await service.close();fs.writeFileSync(path.join(out,'network-lifecycle.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
