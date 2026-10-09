const checkOptions = require('./check-options.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=checkOptions.output('evidence/v5');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const result={actualDevice:false,scope:'Real-time mobile touch landing sequence and stored music preference',frames:[]};
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    await checkOptions.isolate(context);
    await context.addInitScript(()=>{
      localStorage.setItem('valenna.volume','0.47');window.__capsuleFrames=[];
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
        if(this.canvas.id==='game'&&image.src === new URL(window.VALENNA_ASSETS.images.capsule, document.baseURI).href){
          const m=this.getTransform(),sx=this.canvas.width/450,sy=this.canvas.height/800;
          window.__capsuleFrames.push({time:performance.now(),x:m.e/sx,y:m.f/sy,angle:Math.atan2(m.b/sy,m.a/sx)});
        }
        return draw.call(this,image,...args);
      };
    });
    const page=await context.newPage();
    await page.goto(checkOptions.url);
    await page.waitForSelector('#stage[data-state=menu]');
    assert.equal(await page.locator('#volume').inputValue(),'47');
    await page.locator('input[value=antey]').check();
    await page.locator('#start').tap();
    const start=Date.now();
    for(const seconds of [3.8,4.25,6.4,12.8,13.4,14.7,16.8,19.9,20.65,21.4,23.2]){
      await page.waitForTimeout(Math.max(1,seconds*1000-(Date.now()-start)));
      const file=`phone-landing-${seconds.toFixed(2)}.png`;
      await page.screenshot({path:path.join(out,file)});result.frames.push({seconds:(Date.now()-start)/1000,file});
    }
    assert.equal(await page.locator('#stage').getAttribute('data-state'),'success');
    const samples=await page.evaluate(()=>window.__capsuleFrames);
    assert.ok(samples.length>150,'Capture actual moving frames');
    let maxSpeed=0,maxAngleRate=0;
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i],dt=(b.time-a.time)/1000;if(dt<.008)continue;
      maxSpeed=Math.max(maxSpeed,Math.hypot(b.x-a.x,b.y-a.y)/dt);maxAngleRate=Math.max(maxAngleRate,Math.abs(b.angle-a.angle)/dt);
    }
    assert.ok(maxSpeed<200,`Capsule position jumps: ${maxSpeed}`);assert.ok(maxAngleRate<1,`Capsule angle jumps: ${maxAngleRate}`);
    result.observedMotion={frames:samples.length,maxSpeed,maxAngleRate,finalPosition:samples.at(-1)};
    fs.writeFileSync(path.join(out,'capsule-motion.json'),JSON.stringify(samples,null,2)+'\n');
    const stage=await page.locator('#stage').boundingBox();
    for(const id of ['watchAgain','successHome']){const box=await page.locator('#'+id).boundingBox();assert.ok(box.y>=stage.y&&box.y+box.height<=stage.y+stage.height);}
    await page.locator('#watchAgain').tap();await page.locator('#pauseButton').tap();
    await page.waitForSelector('#stage[data-state=paused]');await page.locator('#pauseHome').tap();
    await page.waitForSelector('#stage[data-state=menu]');
    result.passed=true;result.savedMusicVolume=.47;result.mobileSuccessControls=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{fs.writeFileSync(path.join(out,'landing-sequence.json'),JSON.stringify(result,null,2));await browser.close();}
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
