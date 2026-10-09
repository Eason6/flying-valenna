const checkOptions = require('./check-options.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const hard = process.argv.includes('--tharsis');
const output = checkOptions.output('evidence/v3');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 960 } });
    await checkOptions.isolate(page.context());
    // Observation only: constructor, physics, collisions, and scoring stay intact.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'ValennaCore', { configurable: true, set(core) {
        const OriginalGame = core.Game;
        core.Game = class extends OriginalGame { constructor(...args) { super(...args); window.__flightObservation = this; } };
        Object.defineProperty(window, 'ValennaCore', { configurable: true, writable: true, value: core });
      } });
    });
    await page.goto(checkOptions.url);
    await page.waitForSelector('#stage[data-state="menu"]');
    if (hard) {
      await page.evaluate(() => localStorage.setItem('valenna.best', '41'));
      await page.locator('input[value=tharsis]').check();
    }
    await page.getByRole('button', { name: '开始发射' }).click();
    await page.getByRole('button', { name: '跳过动画' }).click();
    if(hard)require('./flight-controller.cjs').configure(await page.evaluate(()=>window.VALENNA_ASSETS.playerMask));
    await page.keyboard.press('Space');
    const seen = new Set(), started = Date.now(), trace=[];
    while (Date.now() - started < 32000) {
      const cycleStarted=Date.now();
      const data = await page.evaluate(() => {
        const game = window.__flightObservation, next = game.gates.find(gate => gate.x + (game.mode==='tharsis'?140:100) > game.player.x);
        return { y: game.player.y, vy: game.player.vy, alive: game.alive, cause:game.cause, score: game.score, target: (next?.center || 400)+(game.mode==='tharsis'?14:0), type: next?.type, x: next?.x, gates:game.gates };
      });
      if(!data.alive){await page.screenshot({path:path.join(output,'flight-controller-failure-'+Date.now()+'.png')});fs.writeFileSync(path.join(output,'flight-controller-failure-'+Date.now()+'.json'),JSON.stringify({...data,trace:trace.slice(-20)},null,2));}
      assert.equal(data.alive, true, 'Feedback-controlled keyboard flight should remain inside the safe corridor: '+JSON.stringify(data));
      const press=hard ? require('./flight-controller.cjs').shouldFlap(data) : data.y > data.target + 8 && data.vy > -120;
      trace.push({seconds:(Date.now()-started)/1000,y:data.y,vy:data.vy,gateX:data.x,press,decisionMs:Date.now()-cycleStarted});
      if(press)await page.keyboard.press('Space');
      if (data.x < 310 && data.x > 190 && !seen.has(data.type)) {
        seen.add(data.type); await page.screenshot({ path: path.join(output, (hard ? 'hard-' : '') + 'gate-' + data.type + '.png') });
      }
      await page.waitForTimeout(hard?Math.max(1,75-(Date.now()-cycleStarted)):30);
    }
    const score = Number(await page.locator('#score').textContent());
    assert.ok(score >= 10); assert.equal(seen.size, 3);
    await page.screenshot({ path: path.join(output, (hard ? 'hard-' : '') + 'late-starfield.png') });
    if (hard) {
      await page.waitForSelector('#stage[data-state=over]', {timeout:5000});
      assert.ok(Number(await page.locator('#finalBest').textContent()) >= score);
      assert.equal(await page.evaluate(() => localStorage.getItem('valenna.best')), '41');
      await page.locator('#home').click();await page.locator('input[value=standard]').check();
      assert.equal(await page.locator('#menuBest').textContent(),'41');
    }
    const result = { passed: true, difficulty: hard ? 'tharsis' : 'standard', mode: 'Real game, observed state and keyboard input only; collisions and score unmodified', seconds: 32, score, obstacleTypes: [...seen], fileUrl: true, networkOffline: true, separateRecords: hard };
    fs.writeFileSync(path.join(output, (hard ? 'hard-' : '') + 'flight-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
