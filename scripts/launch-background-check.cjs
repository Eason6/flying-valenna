const checkOptions = require('./check-options.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..'), out = checkOptions.output('evidence/v6');
const url = checkOptions.url;

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const isWebKit = process.argv.includes('--webkit');
  const browser = isWebKit ? await webkit.launch() : await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const report = { actualDevice: false, browser: browser.version(), audioVerified: !isWebKit, checks: [], errors: [], network: [] };
  async function newPage(options = {}) {
    const context = await browser.newContext({ viewport: { width: 588, height: 871 }, ...options });
    await checkOptions.isolate(context);
    await context.addInitScript(() => {
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      window.__distantDraws = []; window.__distantCount = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
        if (this.canvas.id === 'game' && image.src === new URL(window.VALENNA_ASSETS.images.chichibei, document.baseURI).href) {
          const m = this.getTransform(), sx = this.canvas.width / 450, sy = this.canvas.height / 800;
          window.__distantDraws.push({ x: m.e / sx, y: m.f / sy, angle: Math.atan2(m.b / sy, m.a / sx), alpha: this.globalAlpha, width: args[2], height: args[3] });
          window.__distantDraws = window.__distantDraws.slice(-4); window.__distantCount++;
        }
        return draw.call(this, image, ...args);
      };
    });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('request', r => { if (checkOptions.forbidden(r.url())) report.network.push(r.url()); });
    await page.goto(url); await page.waitForSelector('#stage[data-state=menu]');
    await page.waitForFunction(() => window.__distantDraws.length === 4);
    return page;
  }
  const snapshot = page => page.evaluate(() => window.__distantDraws);
  const playing = page => page.waitForFunction(() => { const a = document.querySelector('#music'); return !a.paused && a.currentTime > .12; });
  const chooseOther = async page => {
    await page.locator('#soundButton').click(); await page.locator('[data-track="2"]').click();
    if (!isWebKit) await playing(page);
    await page.locator('[data-close=soundDialog]').click();
  };
  const assertAnthem = async page => {
    if (!isWebKit) await playing(page);
    assert.equal(await page.locator('#trackList button[aria-pressed=true]').getAttribute('data-track'), '0');
    if (!isWebKit) assert.ok(await page.locator('#music').evaluate(a => a.currentTime < 1));
  };
  try {
    const page = await newPage();
    assert.equal(await page.locator('#menu .title p').textContent(), '舱门已经拦不住她了');
    const before = await snapshot(page);
    assert.equal(before.length, 4); assert.ok(before.every(a => a.alpha < .4 && a.height < 90));
    await page.screenshot({ path: path.join(out, `${isWebKit ? 'webkit' : 'edge'}-chichibei-menu.png`) });
    const samples = [{ at: Date.now(), actors: await snapshot(page) }];
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(1500); samples.push({ at: Date.now(), actors: await snapshot(page) }); }
    const movement = before.map((_, actor) => {
      const segments = samples.slice(1).map((sample, i) => {
        const a = samples[i].actors[actor], b = sample.actors[actor], dt = (sample.at - samples[i].at) / 1000;
        const dx = b.x - a.x, dy = b.y - a.y;
        const turn = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
        return { dx, dy, distance: Math.hypot(dx, dy), speed: Math.hypot(dx, dy) / dt, turn, angularSpeed: Math.abs(turn) / dt };
      });
      assert.ok(segments.every(s => s.speed < 23 && s.angularSpeed < .13), 'Drift and rotation must remain slow');
      assert.ok(segments.reduce((sum, s) => sum + s.distance, 0) > 8, 'Drift should be visible over 12 seconds');
      assert.ok(Math.abs(segments.reduce((sum, s) => sum + s.turn, 0)) > .45, 'Rotation should be visible over 12 seconds');
      const directions = segments.filter(s => s.speed > .4);
      assert.ok(directions.some((a, i) => directions.slice(i + 1).some(b => Math.abs(a.dx * b.dy - a.dy * b.dx) / (a.distance * b.distance) > .2)), 'The path must change direction smoothly');
      return segments;
    });
    report.movement = { samples, segmentsByActor: movement };
    await page.screenshot({ path: path.join(out, `${isWebKit ? 'webkit' : 'edge'}-chichibei-drift.png`) });
    await page.locator('#aboutButton').click(); await page.waitForTimeout(80);
    const frozen = await snapshot(page); await page.waitForTimeout(350); assert.deepEqual(await snapshot(page), frozen);
    await page.locator('[data-close=aboutDialog]').click();
    report.checks.push('four distant sprites visibly rotate and drift on changing paths over 12 seconds; dialog freezes animation');
    await page.locator('#soundButton').click();
    assert.equal(await page.locator('#soundTitle').textContent(), '把打口磁带带回地球');
    for (const [width, height] of [[588, 871], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const title = await page.locator('#soundTitle').boundingBox(), dialog = await page.locator('#soundDialog').boundingBox();
      assert.ok(title.x >= dialog.x && title.x + title.width <= dialog.x + dialog.width && title.y >= dialog.y);
      assert.equal(await page.locator('#soundTitle').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(out, `${isWebKit ? 'webkit' : 'edge'}-radio-title-${width}.png`) });
    }
    await page.setViewportSize({ width: 588, height: 871 });
    await page.locator('[data-close=soundDialog]').click();
    report.checks.push('new radio heading fits 588px, 320px and landscape layouts');
    for (const mode of ['standard', 'tharsis', 'antey']) {
      await page.locator(`input[value=${mode}]`).check(); await chooseOther(page);
      await page.locator('#start').click(); await assertAnthem(page);
      if (mode !== 'antey') {
        await page.locator('#skip').click(); await page.locator('#pauseButton').click();
        await page.waitForTimeout(80); const paused = await snapshot(page);
        await page.waitForTimeout(350); assert.deepEqual(await snapshot(page), paused);
        await page.locator('#pauseHome').click();
      } else {
        await page.waitForSelector('#stage[data-state=success]', { timeout: 28000 });
        await chooseOther(page); await page.locator('#watchAgain').click(); await assertAnthem(page);
        await page.locator('#pauseButton').click(); await page.locator('#pauseHome').click();
      }
    }
    report.checks.push('all three full launches and Antey watch-again override radio selection with anthem', 'game pause freezes distant sprites');
    await page.locator('input[value=standard]').check();
    if (!isWebKit) {
      await page.locator('#music').evaluate(a => { a.currentTime = 20; });
      await page.waitForFunction(() => document.querySelector('#music').currentTime >= 20);
    }
    await page.locator('#start').click(); await assertAnthem(page); await page.locator('#skip').click();
    await page.locator('#game').click({ position: { x: 120, y: 360 } });
    await page.waitForSelector('#stage[data-state=over]', { timeout: 7000 });
    assert.equal(await page.locator('#over h2').textContent(), '瓦莲娜停止了思考');
    for (const [width, height] of [[588, 871], [320, 568]]) {
      await page.setViewportSize({ width, height });
      const bounds = await page.locator('#over h2').boundingBox(), stage = await page.locator('#stage').boundingBox();
      assert.ok(bounds.x >= stage.x && bounds.x + bounds.width <= stage.x + stage.width);
      await page.screenshot({ path: path.join(out, `${isWebKit ? 'webkit' : 'edge'}-new-failure-${width}.png`) });
    }
    report.checks.push(isWebKit ? 'anthem remains selected on repeated launch; playback not asserted in Windows WebKit' : 'an already-playing anthem restarts on full launch', 'both requested captions and result layout at 588px and 320px');
    await page.context().close();
    const reduced = await newPage({ reducedMotion: 'reduce' });
    const staticBefore = await snapshot(reduced); await reduced.waitForTimeout(450);
    assert.deepEqual(await snapshot(reduced), staticBefore);
    assert.ok(await reduced.evaluate(() => window.__distantCount) > 8);
    report.checks.push('reduced motion keeps all four sprites static while frames continue');
    await reduced.context().close();
    assert.deepEqual(report.errors, []); assert.deepEqual(report.network, []); report.passed = true;
  } catch (e) { report.error = e.stack; throw e; }
  finally {
    fs.writeFileSync(path.join(out, `launch-background-${isWebKit ? 'webkit' : 'edge'}.json`), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
