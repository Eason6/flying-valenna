const evidence = require('./check-options.cjs').output('evidence/v6');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const html = fs.readFileSync(path.join(root, 'dist', '飞翔的瓦莲娜.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'build-manifest.json'), 'utf8'));
assert.equal(hash(Buffer.from(html)), manifest.sha256);
assert.equal(/<(?:script|link|img|audio|video|source)[^>]+(?:src|href)\s*=\s*["'](?:https?:|\/\/|\.\.\/|\.\/)/i.test(html), false, 'External or relative asset dependency');
assert.equal(/\b(?:fetch\s*\(|XMLHttpRequest\b|import\s*\()/m.test(html), false, 'Unexpected runtime network/import loader');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 3);
scripts.forEach((script, i) => new vm.Script(script, { filename: 'embedded-' + i + '.js' }));
const context = vm.createContext({ window: {} });
new vm.Script(scripts[0]).runInContext(context);
const data = context.window.VALENNA_ASSETS;
assert.equal(data.tracks.length, 4); assert.equal(Object.keys(data.images).length, 7);
for (const track of data.tracks) {
  const bytes = Buffer.from(track.src.slice(track.src.indexOf(',') + 1), 'base64');
  assert.equal(hash(bytes), track.sha256);
  assert.equal(hash(fs.readFileSync(path.join(root, track.source))), track.sha256, 'Embedded song must match source byte-for-byte');
}
for (const image of manifest.images) {
  assert.equal(hash(Buffer.from(data.images[image.key].split(',')[1], 'base64')), image.embeddedSha256);
}
const effect = data.effects.failure;
assert.equal(hash(Buffer.from(effect.src.split(',')[1], 'base64')), effect.sha256);
assert.equal(hash(fs.readFileSync(path.join(root, effect.source))), effect.sha256);
assert.equal(hash(fs.readFileSync(path.join(root, effect.original))), effect.originalSha256);
assert.equal(hash(Buffer.from(data.effects.cheer.src.split(',')[1], 'base64')), data.effects.cheer.sha256);
assert.equal(hash(fs.readFileSync(path.join(root, data.effects.cheer.source))), data.effects.cheer.sha256);
assert.equal(data.playerMask.points.length, manifest.collision.samples);
assert.ok(data.playerMask.points.length>3500);
const result = { passed: true, embeddedScripts: 3, images: 7, intactOriginalTracks: 4, failureEffects: 1, cheerEffects:1, silhouetteSamples:data.playerMask.points.length, externalDependencies: 0, sizeMiB: +(Buffer.byteLength(html)/1048576).toFixed(2), artifactSha256: manifest.sha256 };
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(evidence, 'bundle-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
