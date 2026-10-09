const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { packAssets, hash } = require('./asset-pack.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'src', file), 'utf8');
function replaceOnce(text, marker, value) {
  if (text.split(marker).length !== 2) throw new Error('Expected exactly one template marker: ' + marker);
  return text.replace(marker, () => value);
}
async function build({ target = 'offline', release } = {}) {
  if (!['offline','online'].includes(target)) throw new Error('Unknown build target');
  if (target === 'online' && !/^[a-z0-9][a-z0-9-]*$/.test(release || '')) throw new Error('Online build requires a safe --release name');
  const destination = path.join(root, 'dist/web/releases', release || '_unused');
  const manifestPath = path.join(root, 'dist/web/manifests', (release || '_unused') + '.json');
  if (target === 'online' && (fs.existsSync(destination) || fs.existsSync(manifestPath))) throw new Error('Release already exists; choose a NEW release name');
  const packed = await packAssets();
  const { imageManifest, packedTracks, failure, cheer, playerMask } = packed;
  const data = { delivery: target, images:{}, playerMask, tracks:packedTracks.map(t=>({...t})), effects: { failure:{...failure}, cheer:{...cheer} } };
  const files = [];
  function emit(relative, bytes, metadata = {}) {
    bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (bytes.length > 24 * 1048576) throw new Error('File exceeds 24 MiB budget: ' + relative);
    const full = path.join(destination, relative);
    if (fs.existsSync(full)) throw new Error('Duplicate path / short hash collision: ' + relative);
    fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, bytes, { flag: 'wx' });
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), ...metadata });
    return './' + relative;
  }
  function hashed(name, extension, bytes, metadata) {
    return emit(`assets/${name}.${hash(bytes).slice(0,12)}.${extension}`, bytes, metadata);
  }
  if (target === 'online') { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.mkdirSync(destination); }
  let musicIndex = 0;
  for (const resource of packed.resources) {
    const { key, category, extension, mime, data: bytes, ...metadata } = resource;
    const src = target === 'online' ? hashed(category + '/' + key, extension, bytes, { category, key, mime, ...metadata }) : 'data:' + mime + ';base64,' + bytes.toString('base64');
    if (category === 'images') data.images[key] = src;
    if (category === 'music') { data.tracks[musicIndex] = { ...(target === 'online' ? { title: packedTracks[musicIndex].title } : packedTracks[musicIndex]), src }; musicIndex++; }
    if (category === 'effects') data.effects[key] = { ...(target === 'online' ? {} : data.effects[key]), src };
  }
  const assets = 'window.VALENNA_ASSETS=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';\n' + read('asset-io-' + target + '.js');
  let html = read('template.html');
  const chunks = [['STYLE',read('style.css'),'style','css','text/css'],['ASSETS',assets,'resources','js','text/javascript'],['CORE',read('core.js'),'core','js','text/javascript'],['APP',read('app.js'),'app','js','text/javascript']];
  for (const [key, content, name, extension, mime] of chunks) {
    const marker = '/*__' + key + '__*/';
    if (target === 'offline') html = replaceOnce(html, marker, content);
    else {
      const src = hashed(name, extension, content, { category: extension === 'css' ? 'style' : 'script', mime });
      const error = "document.getElementById('bootError').hidden=false";
      html = replaceOnce(html, key === 'STYLE' ? `<style>${marker}</style>` : `<script>${marker}</script>`, key === 'STYLE' ? `<link rel="stylesheet" href="${src}" onerror="if(document.readyState==='loading'){window.addEventListener('DOMContentLoaded',function(){${error}})}else{${error}}">` : `<script defer src="${src}" onerror="${error}"></script>`);
    }
  }
  const sourceFiles = ['template.html','style.css','core.js','app.js','asset-io-' + target + '.js'].map(file => ({file:'src/'+file,sha256:hash(read(file))}));
  const buildFiles = ['scripts/build.cjs','scripts/asset-pack.cjs','scripts/player-mask.cjs'].map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
  const collision = { source:'assets/valenna.png',size:playerMask.size,alphaThreshold:playerMask.alphaThreshold,samples:playerMask.points.length,sha256:hash(JSON.stringify(playerMask)) };
  fs.mkdirSync(path.join(root,'dist'), {recursive:true});
  let manifest;
  if (target === 'offline') {
    fs.writeFileSync(path.join(root,'dist/飞翔的瓦莲娜.html'), html);
    manifest = { artifact:'dist/飞翔的瓦莲娜.html',bytes:Buffer.byteLength(html),sha256:hash(html),images:imageManifest,tracks:packedTracks.map(({src,...track})=>track),effects:[{...failure,src:undefined},{...cheer,src:undefined}],collision,sourceFiles,buildFiles };
    fs.writeFileSync(path.join(root,'dist/build-manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  } else {
    emit('index.html', html, {category:'entry',mime:'text/html'});
    emit('404.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页面未找到</title><h1>页面未找到</h1><p>请检查链接，或重新打开游戏首页。</p></html>\n',{category:'error',mime:'text/html'});
    emit('_headers','/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/404.html\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',{category:'config',mime:'text/plain'});
    manifest = { release, target, sourceBaseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceFiles,buildFiles,collision,trackOrder:data.tracks.map(t=>t.title),files,totalBytes:files.reduce((sum,f)=>sum+f.bytes,0),tools:{node:process.version,sharp:require('sharp').versions},builtAt:new Date().toISOString() };
    fs.mkdirSync(path.dirname(manifestPath),{recursive:true});fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  }
  return manifest;
}
module.exports = {build,replaceOnce};
if (require.main === module) {
  const {arg} = require('./check-options.cjs');
  build({target:arg('target','offline'),release:arg('release')}).then(m=>console.log(JSON.stringify({target:m.target||'offline',release:m.release,bytes:m.totalBytes||m.bytes,sha256:m.sha256},null,2))).catch(error=>{console.error(error);process.exitCode=1;});
}
