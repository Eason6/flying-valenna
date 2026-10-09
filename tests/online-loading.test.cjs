const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {listen}=require('../scripts/serve-web.cjs');
const root=path.resolve(__dirname,'..');
function io(fetchImpl){const context=vm.createContext({window:{},document:{baseURI:'https://game.test/sub/'},location:{origin:'https://game.test'},URL,AbortController,setTimeout,clearTimeout,fetch:fetchImpl});vm.runInContext(fs.readFileSync(path.join(root,'src/asset-io-online.js'),'utf8'),context);return context.window.ValennaAssetIO;}
test('online effect adapter rejects cross-origin, 404, timeout; next attempt succeeds',async()=>{
  let calls=0;const adapter=io(async(url,{signal})=>{calls++;if(calls===1)return {ok:false,status:404};if(calls===2)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));return{ok:true,arrayBuffer:async()=>new Uint8Array([4,5]).buffer};});
  await assert.rejects(adapter.readArrayBuffer('https://other.test/a.wav'),/same-origin/);assert.equal(calls,0);
  await assert.rejects(adapter.readArrayBuffer('./a.wav'),/404/);
  await assert.rejects(adapter.readArrayBuffer('./a.wav',{timeoutMs:10}),/timeout/);
  assert.deepEqual([...new Uint8Array(await adapter.readArrayBuffer('./a.wav'))],[4,5]);
});
test('offline effect adapter decodes bytes without network',async()=>{const c=vm.createContext({window:{},atob});vm.runInContext(fs.readFileSync(path.join(root,'src/asset-io-offline.js'),'utf8'),c);assert.deepEqual([...new Uint8Array(await c.window.ValennaAssetIO.readArrayBuffer('data:audio/wav;base64,AQID'))],[1,2,3]);});
test('HTTP range bytes, suffix, HEAD, MIME, cache and encoded traversal',async()=>{
  const service=await listen(path.join(root,'assets'));
  try {
    const bytes=fs.readFileSync(path.join(root,'assets/failure-v2.wav'));
    const response=await fetch(service.url+'failure-v2.wav',{headers:{Range:'bytes=20-39'}});
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 20-39/${bytes.length}`);assert.equal(response.headers.get('content-length'),'20');assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('content-type'),'audio/wav');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(20,40));
    const suffix=await fetch(service.url+'failure-v2.wav',{headers:{Range:'bytes=-8'}});assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),bytes.subarray(-8));
    const head=await fetch(service.url+'failure-v2.wav',{method:'HEAD'});assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
    assert.equal((await fetch(service.url+'failure-v2.wav',{headers:{Range:'bytes=9999999-'}})).status,416);
    assert.equal((await fetch(service.url+'missing.mp3')).status,404);
    const status=await new Promise(resolve=>http.get(service.url+'%2e%2e%2fpackage.json',res=>{res.resume();resolve(res.statusCode);}));assert.equal(status,403);
    assert.equal((await fetch(service.url+'failure-v2.wav',{method:'POST'})).status,405);
  }finally{await service.close();}
});
