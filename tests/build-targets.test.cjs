const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {packAssets,hash}=require('../scripts/asset-pack.cjs');
const {build,replaceOnce}=require('../scripts/build.cjs');
const root=path.resolve(__dirname,'..');
test('shared pack keeps baseline image/music/effect bytes and silhouette unchanged',async()=>{
  const old=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/asset-baseline.json'),'utf8'));
  const pack=await packAssets();
  for(const image of old.images)assert.equal(hash(pack.resources.find(r=>r.key===image.key).data),image.embeddedSha256);
  for(let i=0;i<4;i++)assert.equal(pack.packedTracks[i].sha256,old.tracks[i].sha256);
  assert.equal(pack.failure.sha256,old.effects[0].sha256);assert.equal(pack.cheer.sha256,old.effects[1].sha256);
  assert.equal(hash(JSON.stringify(pack.playerMask)),old.collision.sha256);
});
test('template replacement rejects missing and repeated markers',()=>{assert.throws(()=>replaceOnce('a','x','b'));assert.throws(()=>replaceOnce('xx','x','b'));assert.equal(replaceOnce('axb','x','$&'),'a$&b');});
test('invalid online release names fail before writing',async()=>{await assert.rejects(build({target:'online',release:'../escape'}),/safe/);await assert.rejects(build({target:'other'}),/Unknown/);});
