const checkOptions = require('./check-options.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const evidence = checkOptions.output('evidence/v5');
const url = checkOptions.url;
async function run() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url()) && (!/^https?:/.test(url) || new URL(request.url()).origin !== new URL(url).origin)) network.push(request.url()); });
    await checkOptions.isolate(page.context());
    await page.goto(url);
    await page.waitForSelector('#stage[data-state="menu"]');
    await page.screenshot({ path: path.join(evidence, 'desktop-menu.png') });
    await page.getByRole('button', { name: '开始发射' }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('#music'); return !audio.paused && audio.currentTime > .3; });
    const firstTrack = await page.locator('#trackName').textContent();
    assert.ok(firstTrack.includes('俄罗斯航空太空军军歌'));
    await page.waitForTimeout(4600);
    await page.screenshot({ path: path.join(evidence, 'intro-launch-caption.png') });
    const secondCaption = await page.locator('#captionText').textContent();
    assert.ok(secondCaption.includes('诺克斯上空'));
    await page.waitForTimeout(7200);
    await page.screenshot({ path: path.join(evidence, 'intro-flight-caption.png') });
    const finalCaption = await page.locator('#captionText').textContent();
    assert.ok(finalCaption.includes('单兵飞出大气层返回地球了…'));
    await page.waitForSelector('#stage[data-state="ready"]', { timeout: 12000 });
    await page.screenshot({ path: path.join(evidence, 'ready.png') });
    await page.keyboard.press('Space');
    await page.waitForSelector('#stage[data-state="playing"]');
    for (let i = 0; i < 7; i++) { await page.waitForTimeout(630); await page.keyboard.press('Space'); }
    const score = Number(await page.locator('#score').textContent());
    assert.ok(score >= 1, 'Real keyboard flight should pass the first gate');
    await page.screenshot({ path: path.join(evidence, 'gameplay.png') });
    await page.keyboard.press('KeyP');
    await page.waitForSelector('#stage[data-state="paused"]');
    const pauseTime = await page.locator('#music').evaluate(audio => audio.currentTime);
    await page.waitForTimeout(350);
    const pauseTimeAfter = await page.locator('#music').evaluate(audio => audio.currentTime);
    assert.ok(Math.abs(pauseTimeAfter - pauseTime) < .05);
    await page.getByRole('button', { name: '继续飞行' }).click();
    await page.waitForSelector('#stage[data-state="over"]', { timeout: 6000 });
    await page.screenshot({ path: path.join(evidence, 'result.png') });
    const beforeRetry = await page.locator('#music').evaluate(audio => audio.currentTime);
    await page.getByRole('button', { name: '再飞一次' }).click();
    await page.waitForSelector('#stage[data-state="ready"]');
    const afterRetry = await page.locator('#music').evaluate(audio => audio.currentTime);
    assert.ok(afterRetry >= beforeRetry && afterRetry - beforeRetry < 2, 'Retry must retain music position');
    // Real media seeking to the tail, then waiting for the genuine ended event.
    await page.locator('#music').evaluate(audio => { audio.currentTime = audio.duration - .3; });
    await page.waitForFunction(() => !document.querySelector('#trackName').textContent.includes('俄罗斯航空太空军军歌'));
    const nextTrack = await page.locator('#trackName').textContent();
    await page.waitForFunction(() => { const audio = document.querySelector('#music'); return !audio.paused && audio.currentTime > .1; });
    await page.getByRole('button', { name: '声音设置', exact: false }).click();
    await page.locator('#volume').fill('25');
    assert.equal(await page.locator('#volumeValue').textContent(), '25%');
    await page.getByRole('button', { name: '静音', exact: true }).click();
    assert.equal(await page.locator('#music').evaluate(audio => audio.muted), true);
    await page.getByRole('button', { name: '开启声音', exact: true }).click();
    await page.getByRole('button', { name: '关闭声音设置' }).click();
    const beforeKey = await page.evaluate(() => ({ state: document.querySelector('#stage').dataset.state, focused: document.activeElement?.outerHTML.slice(0,200), dialog: document.querySelector('#soundDialog').open }));
    await page.keyboard.press('KeyP');
    const afterKey = await page.evaluate(() => ({ state: document.querySelector('#stage').dataset.state, focused: document.activeElement?.outerHTML.slice(0,200), dialog: document.querySelector('#soundDialog').open }));
    fs.writeFileSync(path.join(evidence, 'pause-key-observation.json'), JSON.stringify({beforeKey,afterKey},null,2));
    await page.getByRole('button', { name: '返回起点', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: '关于这次飞行' }).click();
    assert.ok((await page.locator('#aboutDialog').textContent()).includes('霍尔果斯纳罗达礼炮八号设计局'));
    await page.getByRole('button', { name: '关闭关于' }).click();
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    results.push({ name: /^https?:/.test(url) ? 'Edge desktop, same-origin HTTP' : 'Edge desktop, offline file URL', passed: true, firstTrack, nextTrack, passedGates: score, pageErrors: errors, networkRequests: network, checks: ['complete intro','launch caption','flight caption','keyboard flap','scoring','pause audio','death','retry retains music','genuine ended event advances playlist','volume','mute','about'] });
    await page.close();
    for (const device of [
      { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      { name: 'tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
      { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
    ]) {
      const context = await browser.newContext(device);
      await checkOptions.isolate(context);
      const mobile = await context.newPage(), mobileErrors = [];
      mobile.on('pageerror', error => mobileErrors.push(error.message));
      await mobile.goto(url); await mobile.waitForSelector('#stage[data-state="menu"]');
      await mobile.screenshot({ path: path.join(evidence, `${device.name}-menu.png`) });
      const bounds = await mobile.locator('#stage').boundingBox();
      assert.ok(bounds.width <= device.viewport.width + 1 && bounds.height <= device.viewport.height + 1);
      await mobile.getByRole('button', { name: '开始发射' }).tap();
      await mobile.getByRole('button', { name: '跳过动画' }).tap();
      await mobile.locator('#game').tap({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
      await mobile.waitForSelector('#stage[data-state="playing"]');
      await mobile.getByRole('button', { name: '暂停游戏' }).tap();
      await mobile.waitForSelector('#stage[data-state="paused"]');
      await mobile.getByRole('button', { name: '继续飞行' }).tap();
      await mobile.waitForSelector('#stage[data-state="over"]', { timeout: 6000 });
      assert.deepEqual(mobileErrors, []);
      results.push({ name: device.name, passed: true, bounds, touchFlow: true, actualDevice: false, pageErrors: mobileErrors });
      await context.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(evidence, 'browser-verification.json'), JSON.stringify(results, null, 2)); }
  console.log(JSON.stringify(results, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
