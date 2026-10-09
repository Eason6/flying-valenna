const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { webkit, chromium, devices } = require('playwright');
const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'dist', '飞翔的瓦莲娜.html')).href;
const evidence = path.join(root, 'evidence/v3');
async function attachAudioInspection(context) {
  await context.addInitScript(() => {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) return;
    const original = Constructor.prototype.createMediaElementSource;
    Constructor.prototype.createMediaElementSource = function (element) {
      const source = original.call(this, element), connect = source.connect;
      source.connect = function (destination, ...args) {
        window.__audioObservation = { context: source.context, gain: destination };
        return connect.call(source, destination, ...args);
      };
      return source;
    };
  });
}
async function energy(page) {
  return page.evaluate(async () => {
    const observation = window.__audioObservation;
    if (!observation) return { error: 'No Web Audio media graph' };
    const analyser = observation.context.createAnalyser(); analyser.fftSize = 1024;
    observation.gain.connect(analyser);
    let peak = 0;
    const samples = new Float32Array(1024);
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 45));
      analyser.getFloatTimeDomainData(samples);
      peak = Math.max(peak, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length));
    }
    observation.gain.disconnect(analyser);
    return { rmsPeak: peak, contextState: observation.context.state, gain: observation.gain.gain.value };
  });
}
async function run() {
  const results = [];
  const engineName = process.argv.includes('--edge-audio') ? 'edge' : 'webkit';
  const browser = engineName === 'edge'
    ? await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
    : await webkit.launch({ headless: true });
  try {
    for (const spec of engineName === 'edge' ? [{ name: 'edge-audio', viewport: { width: 1100, height: 900 } }] : [
      { name: 'webkit-desktop', viewport: { width: 1280, height: 960 } },
      { ...devices['iPhone 13'], name: 'webkit-iphone' },
      { ...devices['iPad Pro 11'], name: 'webkit-ipad' },
    ]) {
      const context = await browser.newContext(spec);
      // Windows Playwright WebKit rejects even a 160-byte local HTML when its
      // offline-emulation flag is set. The retained minimal reproduction proves
      // this is outside the game. Block HTTP(S) explicitly, preserving file reads.
      if (engineName === 'edge') await context.setOffline(true);
      else await context.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
      await attachAudioInspection(context);
      const page = await context.newPage(), errors = [], requests = [], messages = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') messages.push(message.text().slice(0, 500)); });
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(url); await page.waitForSelector('#stage[data-state="menu"]');
      await page.screenshot({ path: path.join(evidence, spec.name + '-menu.png') });
      if (spec.hasTouch) await page.getByRole('button', { name: '开始发射' }).tap();
      else await page.getByRole('button', { name: '开始发射' }).click();
      await page.waitForFunction(() => { const audio = document.querySelector('#music'); return !audio.paused && audio.currentTime > .25; }, null, { timeout: 15000 });
      await page.locator('#music').evaluate(audio => { audio.currentTime = 25; });
      await page.waitForTimeout(500);
      const firstEnergy = await energy(page);
      assert.ok(firstEnergy.rmsPeak > .0001, 'Decoded BGM must reach the actual Web Audio output graph: ' + JSON.stringify(firstEnergy));
      await page.getByRole('button', { name: '跳过动画' }).click();
      await page.waitForSelector('#stage[data-state="ready"]');
      if (spec.hasTouch) await page.locator('#game').tap(); else await page.keyboard.press('Space');
      await page.waitForSelector('#stage[data-state="playing"]');
      await page.getByRole('button', { name: '暂停游戏' }).click();
      await page.waitForSelector('#stage[data-state="paused"]');
      assert.equal(await page.locator('#music').evaluate(audio => audio.paused), true);
      await page.getByRole('button', { name: '继续飞行' }).click();
      await page.waitForSelector('#stage[data-state="over"]', { timeout: 6000 });
      const beforeRetry = await page.locator('#music').evaluate(audio => audio.currentTime);
      await page.getByRole('button', { name: '再飞一次' }).click();
      await page.waitForSelector('#stage[data-state="ready"]');
      const afterRetry = await page.locator('#music').evaluate(audio => audio.currentTime);
      assert.ok(afterRetry >= beforeRetry);
      const trackChecks = [];
      // Verify every embedded original song decodes and produces real nonzero PCM.
      for (let index = 0; index < 4; index++) {
        await page.evaluate(index => {
          const audio = document.querySelector('#music'); audio.src = window.VALENNA_ASSETS.tracks[index].src; audio.load();
        }, index);
        await page.getByRole('button', { name: '声音设置', exact: false }).click();
        await page.getByRole('button', { name: '静音', exact: true }).click();
        await page.getByRole('button', { name: '开启声音', exact: true }).click();
        await page.getByRole('button', { name: '关闭声音设置' }).click();
        await page.waitForFunction(() => { const audio = document.querySelector('#music'); return audio.readyState >= 2 && audio.duration > 100 && !audio.paused; });
        await page.locator('#music').evaluate(audio => { audio.currentTime = 25; });
        await page.waitForTimeout(350);
        const sample = await energy(page), duration = await page.locator('#music').evaluate(audio => audio.duration);
        assert.ok(sample.rmsPeak > .0001);
        trackChecks.push({ index, duration, ...sample });
      }
      await page.getByRole('button', { name: '声音设置', exact: false }).click();
      await page.locator('#volume').fill('25');
      // Volume now ramps smoothly to avoid clicks; verify its settled value.
      await page.waitForFunction(() => Math.abs(window.__audioObservation.gain.gain.value - .25) < .001, null, {timeout:1000});
      const quarterGain = await page.evaluate(() => window.__audioObservation.gain.gain.value);
      assert.ok(Math.abs(quarterGain - .25) < .001);
      await page.getByRole('button', { name: '静音', exact: true }).click();
      const silence = await energy(page); assert.equal(silence.rmsPeak, 0);
      await page.getByRole('button', { name: '关闭声音设置' }).click();
      const bounds = await page.locator('#stage').boundingBox();
      assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.deepEqual(messages, []);
      results.push({ name: spec.name, passed: true, browserVersion: browser.version(), engine: engineName, actualAppleSafari: false, fileUrl: true, networkIsolation: engineName === 'edge' ? 'setOffline(true)' : 'All HTTP(S) requests blocked by route; file and data remain available', firstEnergy, trackChecks, quarterGain, mutedOutputZero: true, bounds, pageErrors: errors, externalRequests: requests });
      await context.close();
    }
  } catch (error) {
    results.push({ name: engineName, passed: false, actualAppleSafari: false, error: error.message, status: 'Blocked or failed; completed cases above retain their own scope.' });
    throw error;
  } finally {
    await browser.close(); fs.writeFileSync(path.join(evidence, engineName + '-audio-verification.json'), JSON.stringify(results, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
