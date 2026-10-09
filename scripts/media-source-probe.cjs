const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'audio/小市民红球 - 俄羅斯航空太空軍軍歌.mp3');
const base64 = fs.readFileSync(file).toString('base64');
(async () => {
  const browser = await webkit.launch(), results = [];
  try {
    for (const kind of ['data', 'blob', 'file']) {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path.join(root, 'evidence/webkit-probe.html')).href);
      await page.evaluate(({ kind, base64, fileUrl }) => {
        const audio = document.createElement('audio'); audio.id = 'probe'; audio.preload = 'auto';
        const bytes = kind === 'blob' ? Uint8Array.from(atob(base64), char => char.charCodeAt(0)) : null;
        audio.src = kind === 'blob' ? URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })) : kind === 'data' ? 'data:audio/mpeg;base64,' + base64 : fileUrl;
        document.body.appendChild(audio);
        const button = document.createElement('button'); button.textContent = 'Play';
        button.onclick = () => { audio.play().catch(error => { window.playError = error.name + ': ' + error.message; }); };
        document.body.appendChild(button); audio.load();
      }, { kind, base64, fileUrl: pathToFileURL(file).href });
      await page.getByRole('button', { name: 'Play' }).click();
      const start = Date.now();
      await page.waitForFunction(() => { const audio = document.querySelector('#probe'); return audio.currentTime > .1 || audio.error; }, null, { timeout: 8000 }).catch(() => {});
      const status = await page.evaluate(() => { const audio = document.querySelector('#probe'); return { readyState: audio.readyState, duration: Number.isFinite(audio.duration) ? audio.duration : null, time: audio.currentTime, error: audio.error && { code: audio.error.code, message: audio.error.message }, playError: window.playError || null }; });
      results.push({ kind, elapsedMs: Date.now() - start, ...status }); await page.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(root, 'evidence/webkit-media-source-probe.json'), JSON.stringify(results, null, 2)); }
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
