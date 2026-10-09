const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tracks = [
  { file: '小市民红球 - 俄羅斯航空太空軍軍歌.mp3', title: '俄罗斯航空太空军军歌 · 小市民红球' },
  { file: '小市民红球 - 光榮的引路人.mp3', title: '光荣的引路人 · 小市民红球' },
  { file: 'Группа Малыши - Прекрасное далеко.mp3', title: 'Прекрасное далеко · Группа Малыши' },
  { file: 'Сергей Скачков - Трава у дома.mp3', title: 'Трава у дома · Сергей Скачков' },
];
async function packAssets() {
  const imageManifest = [], resources = [];
  for (const [key, file, width, jpeg] of [['head','valenna.png',512,false],['rocket','rocket.png',512,false],['blue','nebula-blue.png',768,true],['rose','nebula-rose.png',768,true],['capsule','capsule-v3.png',512,false],['parachute','parachute-v3.png',768,false],['chichibei','chichibei-v5.png',256,false]]) {
    const original = fs.readFileSync(path.join(root, 'assets', file));
    let pipeline = sharp(original).resize({ width, withoutEnlargement: true });
    pipeline = jpeg ? pipeline.jpeg({ quality: 88, mozjpeg: true }) : pipeline.png({ compressionLevel: 9 });
    const bytes = await pipeline.toBuffer();
    resources.push({key, category:'images', extension:jpeg?'jpg':'png', mime:jpeg?'image/jpeg':'image/png', data:bytes, source:'assets/'+file, sourceSha256:hash(original), transform:{width,withoutEnlargement:true,...(jpeg?{quality:88,mozjpeg:true}:{compressionLevel:9})}});
    imageManifest.push({ key, source: 'assets/' + file, sourceSha256: hash(original), embeddedSha256: hash(bytes), bytes: bytes.length });
  }
  const packedTracks = tracks.map((track, index) => {
    const bytes = fs.readFileSync(path.join(root, 'audio', track.file));
    resources.push({key:['anthem','guide','far-away','grass-home'][index],category:'music',extension:'mp3',mime:'audio/mpeg',data:bytes,source:'audio/'+track.file,sourceSha256:hash(bytes)});
    return { title: track.title, source: 'audio/' + track.file, bytes: bytes.length, sha256: hash(bytes) };
  });
  const failureBytes = fs.readFileSync(path.join(root, 'assets/failure-v2.wav'));
  const failure = { source: 'assets/failure-v2.wav', original: 'audio/失败音效.m4s', originalSha256: hash(fs.readFileSync(path.join(root, 'audio/失败音效.m4s'))), sha256: hash(failureBytes), bytes: failureBytes.length };
  const cheerBytes = fs.readFileSync(path.join(root, 'assets/cheer-v3.wav'));
  const cheer = { source:'assets/cheer-v3.wav', provenance:'Original procedural crowd cheers, claps and whistles; scripts/generate-cheer.cjs', sha256:hash(cheerBytes), bytes:cheerBytes.length };
  const playerMask = await require('./player-mask.cjs')(resources.find(resource => resource.key === 'head').data);
  for (const [key,effect,data] of [['failure',failure,failureBytes],['cheer',cheer,cheerBytes]]) resources.push({key,category:'effects',extension:'wav',mime:'audio/wav',data,source:effect.source,sourceSha256:hash(data)});
  return { imageManifest, packedTracks, failure, cheer, playerMask, resources };
}
module.exports = {packAssets,hash};
