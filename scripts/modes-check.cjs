const checkOptions = require('./check-options.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium, webkit, devices } = require('playwright');
const root = path.resolve(__dirname, '..'), out = checkOptions.output('evidence/v5');
fs.mkdirSync(out, {recursive:true});
const url = checkOptions.url;
async function observe(context) {
  await context.addInitScript(() => {
    window.__states=[];window.__frameTimes=[];
    const raf=window.requestAnimationFrame;
    window.requestAnimationFrame=function(callback){return raf.call(window,time=>{
      if(document.querySelector('#stage')?.dataset.state==='intro')window.__frameTimes.push({time,wall:performance.now()});
      callback(time);
    });};
    new MutationObserver(records=>{
      for(const record of records)if(record.target.id==='stage')window.__states.push({state:record.target.dataset.state,time:performance.now(),musicTime:document.querySelector('#music')?.currentTime});
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-state']});
    // Only observe real core/audio objects: no physics, scoring or timing replacement.
    Object.defineProperty(window, 'ValennaCore', { configurable:true, set(core) {
      const Game = core.Game;
      core.Game = class extends Game { constructor(...args) { super(...args); window.__flight = this; } };
      Object.defineProperty(window, 'ValennaCore', { value:core, configurable:true, writable:true });
    }});
    window.__buffers = []; window.__effects = null; window.__music = null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const media = AC.prototype.createMediaElementSource;
    AC.prototype.createMediaElementSource = function (...args) {
      const source = media.apply(this,args), connect = source.connect;
      source.connect = function (target,...rest) { window.__music = target; return connect.call(this,target,...rest); }; return source;
    };
    const buffer = AC.prototype.createBufferSource;
    AC.prototype.createBufferSource = function (...args) {
      const source = buffer.apply(this,args), connect = source.connect, start = source.start;
      source.connect = function (target,...rest) {
        if (source.buffer?.duration > 1) window.__effects = target;
        return connect.call(this,target,...rest);
      };
      source.start = function (...params) {
        window.__buffers.push({ duration:source.buffer?.duration, time:this.context.currentTime });
        return start.apply(this,params);
      }; return source;
    };
  });
}
async function energy(page, which, milliseconds = 200) {
  return page.evaluate(async ({which,milliseconds}) => {
    const gain = window[which]; if (!gain) throw new Error('Missing audio observation '+which);
    const analyser = gain.context.createAnalyser(); analyser.fftSize=1024; gain.connect(analyser);
    const values = new Float32Array(1024); let peak=0;
    for(let i=0;i<Math.ceil(milliseconds/15);i++) { await new Promise(r=>setTimeout(r,15)); analyser.getFloatTimeDomainData(values); peak=Math.max(peak,Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length)); }
    gain.disconnect(analyser); return { rms:peak, gain:gain.gain.value, context:gain.context.state };
  }, {which,milliseconds});
}
async function main() {
  const isWebKit = process.argv.includes('--webkit');
  const browser = isWebKit ? await webkit.launch() : await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const results={engine:isWebKit?'Windows WebKit emulation':(/^https?:/.test(url)?'Edge same-origin HTTP':'Edge offline file'),scope:isWebKit?'UI and mode flows only; this Windows build lacks Web Audio':'UI, mode flows and real audio output',audioVerified:!isWebKit,actualAppleDevice:false,checks:[]};
  try {
    const context = await browser.newContext({viewport:{width:1280,height:960}});
    await checkOptions.isolate(context);
    await observe(context); const page = await context.newPage(), errors=[], network=[];
    page.on('pageerror', e=>errors.push(e.message)); page.on('request',r=>{if(checkOptions.forbidden(r.url()))network.push(r.url());});
    await page.goto(url); await page.waitForSelector('#stage[data-state=menu]');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path:path.join(out,`${results.engine.startsWith('Edge')?'edge':'webkit'}-menu.png`)});
    assert.equal(await page.locator('input[name=mode]').count(),3);
    assert.equal(await page.locator('#volume').inputValue(),'25','Fresh music default');
    await page.locator('#start').click();
    await page.waitForTimeout(1200);await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-nozzles.png`)});
    await page.waitForTimeout(12000);await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-settling.png`)});
    await page.waitForSelector('#stage[data-state=ready]',{timeout:3000});
    const timing=await page.evaluate(()=>{const start=window.__states.find(s=>s.state==='intro'),end=window.__states.find(s=>s.state==='ready');return{elapsed:(end.time-start.time)/1000,musicElapsed:end.musicTime-start.musicTime,firstFrames:window.__frameTimes.slice(0,4),lastFrames:window.__frameTimes.slice(-4),states:window.__states};});
    results.introTiming=timing;
    assert.ok(Math.abs(timing.elapsed-14.5)<.12,JSON.stringify(timing));results.introTiming=timing;
    await page.keyboard.press('KeyP');await page.locator('#pauseHome').click();
    await page.locator('input[value=tharsis]').check(); await page.locator('#start').click(); await page.locator('#skip').click();
    assert.equal(await page.evaluate(()=>window.__flight.mode),'tharsis');
    assert.equal(await page.evaluate(()=>window.__flight.player.r),26);
    assert.ok(await page.evaluate(()=>window.__flight.playerMask.points.length)>3500);
    await page.locator('#game').click({position:{x:150,y:400}});
    if(!isWebKit){
      const gains=await page.evaluate(async()=>{const values=[];for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,10));values.push(window.__music.gain.value);}return values;});
      assert.ok(gains.every(v=>Math.abs(v-.25)<.001),'A normal flap must not duck the music');results.flapMusicGains=gains;
    }
    await page.waitForSelector('#stage[data-state=crash]');
    if (!isWebKit) {
    await page.waitForFunction(()=>window.__buffers.some(b=>b.duration>1&&b.duration<1.5));
    const failure=await energy(page,'__effects',350);
    assert.ok(failure.rms>.03, 'Failure sample must have actual nonzero audio output');
    results.failureAudio=failure;
    const duck=await page.evaluate(()=>window.__music.gain.value);
    assert.ok(duck<.25, 'BGM must duck during failure'); results.duckGain=duck;
    await page.waitForSelector('#stage[data-state=over]'); await page.waitForTimeout(900);
    assert.equal(await page.evaluate(()=>window.__buffers.filter(b=>b.duration>1&&b.duration<1.5).length),1);
    await page.waitForFunction(()=>Math.abs(window.__music.gain.value-.25)<.001,null,{timeout:2000});
    } else await page.waitForSelector('#stage[data-state=over]');
    await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-failure.png`)});
    const musicTime=await page.locator('#music').evaluate(a=>a.currentTime);
    await page.locator('#retry').click();
    if(!isWebKit) assert.ok(await page.locator('#music').evaluate(a=>a.currentTime)>=musicTime);
    await page.locator('#soundButton').click();
    await page.locator('#volume').fill('0'); await page.locator('#effectsVolume').fill('65');
    await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-sound.png`)});
    await page.locator('[data-close=soundDialog]').click();
    await page.locator('#game').click({position:{x:150,y:400}});
    if (!isWebKit) { const flap=await energy(page,'__effects',100);assert.ok(flap.rms>.025);results.flapAudio=flap; }
    await page.locator('#pauseButton').click();
    if (!isWebKit) assert.equal(await page.evaluate(()=>window.__effects.context.state),'suspended');
    await page.locator('#pauseHome').click();
    await page.locator('#aboutButton').click();
    const about=await page.locator('#aboutDialog').textContent();
    assert.ok(about.includes('霍尔果斯纳罗达礼炮八号设计局'));
    assert.ok(!about.includes('游戏美术依据')&&!about.includes('全部内容包含'));
    await page.locator('[data-close=aboutDialog]').click();
    await page.locator('input[value=antey]').check(); await page.locator('#start').click();
    await page.waitForSelector('#stage[data-state=arrival]');
    await page.waitForTimeout(6000); await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-earth-flight.png`)});
    await page.locator('#pauseButton').click(); await page.waitForTimeout(200); await page.locator('#resume').click();
    await page.waitForTimeout(8500); await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-parachute.png`)});
    if(!isWebKit){
      await page.waitForFunction(()=>window.__buffers.some(b=>Math.abs(b.duration-3.6)<.001),null,{timeout:10000});
      const cheer=await energy(page,'__effects',450);assert.ok(cheer.rms>.01);results.cheerAudio=cheer;
      await page.screenshot({path:path.join(out,'edge-touchdown-confetti.png')});
    }
    await page.waitForSelector('#stage[data-state=success]',{timeout:12000});
    await page.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-success.png`)});
    if (!isWebKit) {
      assert.equal(await page.evaluate(()=>window.__buffers.filter(b=>b.duration>1&&b.duration<1.5).length),1,'Success must not play failure');
      assert.equal(await page.evaluate(()=>window.__buffers.filter(b=>Math.abs(b.duration-3.6)<.001).length),1,'Cheer once at touchdown');
    }
    await page.locator('#watchAgain').click(); await page.waitForSelector('#stage[data-state=arrival]');
    await page.keyboard.press('KeyP'); await page.locator('#pauseHome').click();
    await page.locator('input[value=standard]').check(); await page.locator('#start').click(); await page.locator('#skip').click();
    assert.equal(await page.evaluate(()=>window.__flight.player.r),18);
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    results.checks.push('three modes','hard collision settings','requested copy removed','full real-time success animation','success replay and pause/home','standard restored');
    results.checks.push('14.5 second real-time opening','opaque sprite collision configured','25 percent initial music');
    if (!isWebKit) results.checks.push('failure sample played once','actual failure and flap output','no BGM duck on flap','failure-only duck recovery','touchdown cheer once with nonzero PCM','independent volumes','pause suspends audio','retry retains music');
    await context.close();
    for(const spec of [
      {name:'phone',viewport:{width:390,height:844},isMobile:true,hasTouch:true},
      {name:'small-phone',viewport:{width:320,height:568},isMobile:true,hasTouch:true},
      {name:'tablet',viewport:{width:820,height:1180},isMobile:true,hasTouch:true},
      {name:'landscape',viewport:{width:844,height:390},isMobile:true,hasTouch:true}
    ]) {
      const ctx=await browser.newContext(spec);await checkOptions.isolate(ctx);const p=await ctx.newPage();
      await p.goto(url);await p.waitForSelector('#stage[data-state=menu]');
      await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await p.screenshot({path:path.join(out,`${isWebKit?'webkit':'edge'}-${spec.name}.png`)});
      const box=await p.locator('#start').boundingBox(), menu=await p.locator('#stage').boundingBox(), modes=await p.locator('#difficulty').boundingBox();
      assert.ok(modes.y+modes.height<box.y&&box.y+box.height<menu.y+menu.height);
      await p.locator('input[value=tharsis]').check();await p.locator('#start').tap();await p.locator('#skip').tap();
      await p.locator('#game').tap();await p.waitForSelector('#stage[data-state=playing]');
      await ctx.close();results.checks.push(`${spec.name} layout and touch`);
    }
    results.passed=true;
  } catch(error) { results.error=String(error.stack);throw error; }
  finally {fs.writeFileSync(path.join(out,`modes-${isWebKit?'webkit':'edge'}.json`),JSON.stringify(results,null,2));await browser.close();}
  console.log(JSON.stringify(results,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
