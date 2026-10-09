const {webkit}=require('playwright');
const fs=require('node:fs'), path=require('node:path'), {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await webkit.launch(), page=await browser.newPage();
  const logs=[];page.on('console',m=>logs.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>logs.push({error:e.message}));
  try {
    await page.goto(pathToFileURL(path.resolve('dist/飞翔的瓦莲娜.html')).href);await page.waitForSelector('#stage[data-state=menu]');
    await page.locator('#start').click();await page.locator('#skip').click();await page.locator('#game').click();
    await page.waitForSelector('#stage[data-state=over]');
    const direct=await page.evaluate(async()=>{
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC)return{available:false,AudioContext:typeof window.AudioContext,webkitAudioContext:typeof window.webkitAudioContext};
      const context=new AC();
      const raw=Uint8Array.from(atob(VALENNA_ASSETS.effects.failure.src.split(',')[1]),c=>c.charCodeAt(0));
      try {const buffer=await context.decodeAudioData(raw.buffer);return{decoded:true,duration:buffer.duration};}
      catch(e){return{decoded:false,name:e.name,message:e.message};}
      finally{await context.close();}
    });
    const result={logs,direct,status:await page.locator('#effectStatus').textContent(),browser:browser.version(),platform:process.platform};
    fs.writeFileSync('evidence/v2/webkit-failure-audio-probe.json',JSON.stringify(result,null,2));console.log(result);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
