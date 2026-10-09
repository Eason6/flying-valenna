const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error('Missing --' + name);
  return process.argv[i + 1];
}
const url = arg('url', pathToFileURL(path.join(root, 'dist/飞翔的瓦莲娜.html')).href);
function output(fallback) {
  const dir = path.resolve(root, arg('evidence-dir', fallback));
  fs.mkdirSync(dir, { recursive: true }); return dir;
}
async function isolate(context) {
  const online = /^https?:/.test(url), origin = online ? new URL(url).origin : null;
  const violations = [];
  await context.route(/^https?:/, route => {
    if (online && new URL(route.request().url()).origin === origin) return route.continue();
    violations.push(route.request().url()); return route.abort('internetdisconnected');
  });
  context.on('close', () => {
    if (violations.length) { console.error('Forbidden network requests:', violations); process.exitCode = 1; }
  });
}
const forbidden = value => /^https?:/.test(value) && (!/^https?:/.test(url) || new URL(value).origin !== new URL(url).origin);
module.exports = { arg, url, output, isolate, forbidden };
