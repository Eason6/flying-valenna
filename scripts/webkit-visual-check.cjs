const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { webkit, devices } = require('playwright');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'evidence');
const url = pathToFileURL(path.join(root, 'dist', '飞翔的瓦莲娜.html')).href;
(async () => {
  const browser = await webkit.launch({ headless: true }), results = [];
  try {
    for (const spec of [
      { name: 'webkit-desktop', viewport: { width: 1280, height: 960 } },
      { ...devices['iPhone 13'], name: 'webkit-iphone' },
      { ...devices['iPad Pro 11'], name: 'webkit-ipad' },
    ]) {
      const context = await browser.newContext(spec), page = await context.newPage(), requests = [], errors = [];
      await context.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(url); await page.waitForSelector('#stage[data-state="menu"]');
      await page.screenshot({ path: path.join(evidence, spec.name + '-menu.png') });
      await page.getByRole('button', { name: '开始发射' }).click();
      if (!spec.hasTouch) {
        await page.waitForTimeout(12000);
        await page.screenshot({ path: path.join(evidence, 'webkit-intro-caption.png') });
        assert.ok((await page.locator('#captionText').textContent()).includes('单兵飞出大气层返回地球了…'));
        await page.waitForSelector('#stage[data-state="ready"]');
      } else await page.getByRole('button', { name: '跳过动画' }).tap();
      if (spec.hasTouch) await page.locator('#game').tap(); else await page.keyboard.press('Space');
      await page.waitForSelector('#stage[data-state="playing"]');
      if (!spec.hasTouch) {
        for (let i=0;i<7;i++) { await page.waitForTimeout(630); await page.keyboard.press('Space'); }
        assert.ok(Number(await page.locator('#score').textContent()) >= 1);
        await page.screenshot({ path: path.join(evidence, 'webkit-gameplay.png') });
      }
      await page.getByRole('button', { name: '暂停游戏' }).click();
      await page.waitForSelector('#stage[data-state="paused"]');
      await page.getByRole('button', { name: '继续飞行' }).click();
      await page.waitForSelector('#stage[data-state="over"]', { timeout: 6000 });
      await page.getByRole('button', { name: '再飞一次' }).click();
      await page.waitForSelector('#stage[data-state="ready"]');
      await page.getByRole('button', { name: '声音设置', exact: false }).click();
      await page.getByRole('button', { name: '关闭声音设置' }).click();
      const bounds = await page.locator('#stage').boundingBox();
      assert.ok(bounds.width <= spec.viewport.width + 1 && bounds.height <= spec.viewport.height + 1);
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      results.push({ name: spec.name, passed: true, scope: 'Rendering and game interaction only; audio acceptance is blocked by Windows WebKit media support', browserVersion: browser.version(), actualAppleDevice: false, fileUrl: true, blockedHttpRequests: true, externalRequests: requests, pageErrors: errors, bounds });
      await context.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(evidence, 'webkit-visual-verification.json'), JSON.stringify(results, null, 2)); }
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
