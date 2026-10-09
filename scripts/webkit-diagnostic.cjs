const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await webkit.launch({ headless: true }), results = [];
  try {
    for (const spec of [
      { file: 'evidence/webkit-probe.html', offline: false },
      { file: 'evidence/webkit-probe.html', offline: true },
      { file: 'dist/飞翔的瓦莲娜.html', offline: false },
    ]) {
      const context = await browser.newContext({ offline: spec.offline }), page = await context.newPage();
      try { await page.goto(pathToFileURL(path.join(root, spec.file)).href, { timeout: 15000 }); await page.waitForSelector(spec.file.startsWith('dist') ? '#stage[data-state="menu"]' : '#result', { timeout: 15000 }); results.push({ ...spec, passed: true, title: await page.title() }); }
      catch (error) { results.push({ ...spec, passed: false, error: error.message.split('\n')[0] }); }
      await context.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(root, 'evidence/webkit-file-diagnostic.json'), JSON.stringify(results, null, 2)); }
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
