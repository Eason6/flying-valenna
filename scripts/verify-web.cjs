const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {hash}=require('./asset-pack.cjs');
const project=path.resolve(__dirname,'..');
function enumerate(dir,prefix='') {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{assert.ok(!entry.isSymbolicLink(),'No symlinks in release');return entry.isDirectory()?enumerate(path.join(dir,entry.name),prefix+entry.name+'/'):[prefix+entry.name];}).sort();}
function verify(root, manifestPath) {
  const manifest=JSON.parse(fs.readFileSync(manifestPath)),offline=JSON.parse(fs.readFileSync(path.join(project,'dist/build-manifest.json')));
  const allowed=/^(?:index\.html|404\.html|_headers|assets\/(?:app|core|resources|style)\.[a-f0-9]{12}\.(?:js|css)|assets\/(?:images|music|effects)\/[a-z-]+\.[a-f0-9]{12}\.(?:png|jpg|mp3|wav))$/;
  assert.deepEqual(enumerate(root),manifest.files.map(f=>f.path).sort());
  assert.equal(manifest.totalBytes,manifest.files.reduce((sum,file)=>sum+file.bytes,0));
  for(const source of [...manifest.sourceFiles,...manifest.buildFiles])assert.equal(hash(fs.readFileSync(path.join(project,source.file))),source.sha256,'Source/build drift: '+source.file);
  for(const file of manifest.files){
    assert.match(file.path,allowed);assert.ok(file.bytes<=24*1048576);
    const bytes=fs.readFileSync(path.join(root,file.path));assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.mp3':'audio/mpeg','.wav':'audio/wav'}[path.extname(file.path)]||'text/plain';assert.equal(file.mime,mime);
    if(file.path.startsWith('assets/')) assert.ok(file.path.includes('.'+file.sha256.slice(0,12)+'.'));
    if(file.source){assert.equal(hash(fs.readFileSync(path.join(project,file.source))),file.sourceSha256);if(file.category!=='images')assert.equal(file.sha256,file.sourceSha256);}
    if(file.category==='images')assert.equal(file.sha256,offline.images.find(i=>i.key===file.key).embeddedSha256);
  }
  const resource=manifest.files.find(f=>f.path.startsWith('assets/resources.'));
  const context=vm.createContext({window:{}});new vm.Script(fs.readFileSync(path.join(root,resource.path),'utf8')).runInContext(context);
  const data=context.window.VALENNA_ASSETS;assert.equal(data.delivery,'online');assert.equal(Object.keys(data.images).length,7);assert.equal(data.tracks.length,4);assert.equal(Object.keys(data.effects).length,2);
  assert.equal(hash(JSON.stringify(data.playerMask)),offline.collision.sha256);assert.equal(manifest.collision.sha256,offline.collision.sha256);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const scripts=[...html.matchAll(/<script ([^>]+)>/g)];assert.equal(scripts.length,3);
  ['resources','core','app'].forEach((name,i)=>{assert.match(scripts[i][1],new RegExp('^defer src="\\./assets/'+name+'\\.'));assert.ok(!scripts[i][1].includes('async'));});
  const refs=[...Object.values(data.images),...data.tracks.map(t=>t.src),...Object.values(data.effects).map(e=>e.src),...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1])];
  const referenced=new Set(['index.html','404.html','_headers']);
  for(const ref of refs){assert.match(ref,/^\.\/assets\/[a-z0-9/.-]+$/);assert.ok(!ref.includes('..'));const relative=ref.slice(2);assert.ok(manifest.files.some(f=>f.path===relative),'Missing ref '+ref);referenced.add(relative);}
  assert.deepEqual([...referenced].sort(),enumerate(root),'Every publish file must be referenced or an explicit entry/config');
  for(const file of manifest.files.filter(f=>/\.(js|css|html)$/.test(f.path))){const text=fs.readFileSync(path.join(root,file.path),'utf8');assert.ok(!/https?:\/\/|[A-Z]:[\\/]|serviceWorker|sourceMappingURL/i.test(text),'External/private reference in '+file.path);}
  assert.ok(manifest.totalBytes<=26000000);const bootBytes=manifest.files.filter(f=>['entry','script','style'].includes(f.category)).reduce((s,f)=>s+f.bytes,0);assert.ok(bootBytes<=350*1024);
  return {passed:true,release:manifest.release,files:manifest.files.length,totalBytes:manifest.totalBytes,bootBytes,maxFileBytes:Math.max(...manifest.files.map(f=>f.bytes)),images:7,intactOriginalTracks:4,effects:2,collisionSha256:manifest.collision.sha256,indexSha256:manifest.files.find(f=>f.path==='index.html').sha256};
}
module.exports={verify,enumerate};
if(require.main===module){const {arg,output}=require('./check-options.cjs');const result=verify(path.resolve(arg('root')),path.resolve(arg('manifest')));fs.writeFileSync(path.join(output('evidence/online-r01'),'web-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(result);}
