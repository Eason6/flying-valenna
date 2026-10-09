const checkOptions = require('./check-options.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),out=checkOptions.output('evidence/v5');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const isWebKit=process.argv.includes('--webkit');
  const browser=isWebKit?await webkit.launch():await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const result={scope:isWebKit?'Windows WebKit radio UI only; no audio acceptance':(/^https?:/.test(checkOptions.url)?'Online same-origin real media radio controls':'Offline real media radio controls'),actualDevice:false,checks:[],errors:[]};
  try{
    const context=await browser.newContext({viewport:{width:1280,height:960}});
    await checkOptions.isolate(context);
    await context.addInitScript(()=>{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      const create=AC.prototype.createMediaElementSource;
      AC.prototype.createMediaElementSource=function(...args){const source=create.apply(this,args),connect=source.connect;source.connect=function(target,...rest){window.__radioGain=target;return connect.call(this,target,...rest);};return source;};
    });
    const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
    await page.goto(checkOptions.url);await page.waitForSelector('#stage[data-state=menu]');
    for(const [name,check] of [
      ['new user music defaults to 25%',async()=>assert.equal(await page.locator('#volume').inputValue(),'25')],
      ['four direct song choices are available',async()=>assert.equal(await page.locator('#trackList button').count(),4)],
      ['next song control is available',async()=>assert.equal(await page.locator('#nextTrack').count(),1)],
    ]){try{await check();result.checks.push({name,passed:true});}catch(e){result.checks.push({name,passed:false,error:e.message});}}
    assert.ok(result.checks.every(c=>c.passed),'Radio requirements failed');
    if(!isWebKit){
    const playing=()=>page.waitForFunction(()=>{const a=document.querySelector('#music');return !a.paused&&a.currentTime>.12;});
    const selected=()=>page.locator('#trackList button[aria-pressed=true]').getAttribute('data-track');
    const currentTime=()=>page.locator('#music').evaluate(a=>a.currentTime);
    await page.locator('#start').click();await playing();assert.equal(await selected(),'0');
    await page.locator('#skip').click();await page.locator('#soundButton').click();
    await page.locator('#nextTrack').click();await playing();assert.notEqual(await selected(),'0');
    result.checks.push({name:'first song is anthem, first next excludes anthem',passed:true});
    const songs=[];
    for(let i=0;i<4;i++){
      await page.locator(`[data-track="${i}"]`).click();await playing();
      assert.equal(await selected(),String(i));
      assert.ok(await page.locator('#soundTrack').textContent());
      const song=await page.locator('#music').evaluate(a=>({time:a.currentTime,duration:a.duration,paused:a.paused,error:a.error}));
      assert.ok(song.duration>100);assert.equal(song.error,null);
      await page.locator('#music').evaluate(a=>{a.currentTime=10;});await page.waitForTimeout(150);
      song.rms=await page.evaluate(async()=>{
        const g=window.__radioGain,a=g.context.createAnalyser();a.fftSize=1024;g.connect(a);const samples=new Float32Array(1024);let rms=0;
        for(let j=0;j<25;j++){await new Promise(r=>setTimeout(r,15));a.getFloatTimeDomainData(samples);rms=Math.max(rms,Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length));}
        g.disconnect(a);return rms;
      });assert.ok(song.rms>.003,'Selected track must reach real audio output');songs.push(song);
    }
    result.songs=songs;
    const sameTime=await currentTime();await page.locator('[data-track="3"]').click();await page.waitForTimeout(120);assert.ok(await currentTime()>=sameTime,'Current song click must not rewind');
    // Rapid native clicks exercise cancellation of previous play promises.
    await page.evaluate(()=>{for(const i of [2,0,1,3,0,2])document.querySelector(`[data-track="${i}"]`).click();});
    await playing();assert.equal(await selected(),'2');assert.equal(await page.locator('#audioRecover').isVisible(),false);
    await page.locator('#music').evaluate(a=>{a.currentTime=a.duration-.25;});
    await page.waitForFunction(()=>document.querySelector('#trackList button[aria-pressed=true]').dataset.track!=='2');await playing();
    result.checks.push({name:'all four songs play, rapid changes cancel old requests, genuine ended continues queue',passed:true});
    await page.locator('[data-close="soundDialog"]').click();await page.locator('#pauseButton').click();
    await page.locator('#soundButton').click();await page.locator('#nextTrack').click();
    await page.waitForTimeout(220);assert.equal(await page.locator('#music').evaluate(a=>a.paused),true);assert.equal(await currentTime(),0);
    await page.locator('[data-close="soundDialog"]').click();await page.locator('#resume').click();await playing();
    await page.locator('#nowPlaying').click();assert.equal(await page.locator('#soundDialog').isVisible(),true);
    await page.locator('#mute').click();await page.locator('#nextTrack').click();await playing();assert.equal(await page.locator('#music').evaluate(a=>a.muted),true);
    await page.locator('#mute').click();await page.locator('[data-close="soundDialog"]').click();
    await page.locator('#game').click({position:{x:110,y:450}});await page.waitForSelector('#stage[data-state=over]',{timeout:7000});
    const before=await currentTime(),beforeSong=await selected();await page.locator('#retry').click();assert.equal(await selected(),beforeSong);assert.ok(await currentTime()>=before);
    result.checks.push({name:'paused selection stays paused, now-playing opens radio, mute survives switch, retry keeps song and progress',passed:true});
    await page.locator('#soundButton').click();await page.locator('#volume').fill('47');await page.reload();await page.waitForSelector('#stage[data-state=menu]');
    assert.equal(await page.locator('#volume').inputValue(),'47');result.checks.push({name:'existing 47% preference survives reload',passed:true});
    await page.locator('#soundButton').click();await page.locator('[data-track="2"]').click();await playing();await page.locator('[data-close="soundDialog"]').click();await page.locator('#start').click();await playing();assert.equal(await selected(),'0');assert.ok(await currentTime()<1,'Launch must restart anthem from its beginning');
    result.checks.push({name:'launch overrides menu selection and restarts anthem',passed:true});
    }
    for(const [name,width,height] of [['desktop',1280,960],['phone',390,844],['narrow',320,568],['tablet',820,1180],['landscape',844,390]]){
      const view=await browser.newPage({viewport:{width,height},hasTouch:name!=='desktop'});
      view.on('pageerror',e=>result.errors.push(name+': '+e.message));
      await checkOptions.isolate(view.context());
      await view.goto(checkOptions.url);await view.waitForSelector('#stage[data-state=menu]');
      await view.screenshot({path:path.join(out,`${isWebKit?'webkit-':''}${name}-menu.png`)});
      const stage=await view.locator('#stage').boundingBox();
      for(const id of ['start','difficulty','aboutButton','soundButton']){const b=await view.locator('#'+id).boundingBox();assert.ok(b.x>=stage.x-1&&b.y>=stage.y-1&&b.x+b.width<=stage.x+stage.width+1&&b.y+b.height<=stage.y+stage.height+1,`${name} ${id} outside stage`);}
      await view.locator('#soundButton')[name==='desktop'?'click':'tap']();
      const dialog=await view.locator('#soundDialog').boundingBox();assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=width&&dialog.y+dialog.height<=height);
      await view.locator('[data-track="3"]')[name==='desktop'?'click':'tap']();
      assert.equal(await view.locator('[data-track="3"]').getAttribute('aria-pressed'),'true');
      if(!isWebKit)await view.waitForFunction(()=>!document.querySelector('#music').paused);
      await view.locator('#nextTrack').focus();await view.keyboard.press('Enter');
      assert.notEqual(await view.locator('#trackList button[aria-pressed=true]').getAttribute('data-track'),'3');
      await view.locator('#volume').fill('32');assert.equal(await view.locator('#volumeValue').textContent(),'32%');
      await view.screenshot({path:path.join(out,`${isWebKit?'webkit-':''}${name}-radio.png`)});
      await view.locator('#soundDialog').evaluate(d=>{d.scrollTop=d.scrollHeight;});
      // WebKit's unsupported-audio notice can resize/recenter the dialog after
      // selection. Compare against the current bounds, not its pre-play bounds.
      const scrolledDialog=await view.locator('#soundDialog').boundingBox();
      const close=await view.locator('[data-close="soundDialog"]').boundingBox();assert.ok(close.y>=scrolledDialog.y&&close.y+close.height<=scrolledDialog.y+scrolledDialog.height,'Close remains visible after scrolling');
      await view.locator('[data-close="soundDialog"]')[name==='desktop'?'click':'tap']();assert.equal(await view.locator('#soundDialog').isVisible(),false);
      await view.close();
    }
    result.checks.push({name:'desktop, phone, narrow, tablet and landscape controls and radio remain usable',passed:true});
    assert.deepEqual(result.errors,[]);result.passed=true;
  }catch(e){result.error=e.stack;throw e;}finally{
    fs.writeFileSync(path.join(out,process.argv.includes('--before')?'radio-before.json':isWebKit?'radio-webkit.json':'radio-verification.json'),JSON.stringify(result,null,2)+'\n');await browser.close();
  }
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
