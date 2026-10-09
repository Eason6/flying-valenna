const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.mp3':'audio/mpeg','.wav':'audio/wav'};
function createServer(root, { basePath = '/' } = {}) {
  root = fs.realpathSync(root);
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('Invalid basePath');
  return http.createServer((req,res) => {
    const end = (status, body) => { res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?'':body); };
    if (!['GET','HEAD'].includes(req.method)) return end(405,'Method not allowed');
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { return end(400,'Invalid URL'); }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p => p==='..' || p==='.' || p.includes(':'))) return end(403,'Forbidden path');
    if (!pathname.startsWith(basePath)) return end(404,'Not found');
    const relative = pathname.slice(basePath.length) || 'index.html';
    const file = path.resolve(root,relative);
    if (!file.startsWith(root+path.sep) || relative === '_headers') return end(404,'Not found');
    let stat;
    try { if (!fs.realpathSync(file).startsWith(root+path.sep)) return end(403,'Forbidden path'); stat=fs.statSync(file); } catch { return end(404,'Not found'); }
    if (!stat.isFile()) return end(404,'Not found');
    let start=0,endByte=stat.size-1,status=200;
    const headers={'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':relative.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache'};
    if(req.headers.range){
      const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!m || (!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
      if(!m[1]) start=Math.max(0,stat.size-Number(m[2]));
      else {start=Number(m[1]);if(m[2])endByte=Math.min(endByte,Number(m[2]));}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(endByte)||start>endByte||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
      status=206;headers['Content-Range']=`bytes ${start}-${endByte}/${stat.size}`;
    }
    headers['Content-Length']=endByte-start+1;res.writeHead(status,headers);
    if(req.method==='HEAD'||stat.size===0)return res.end();
    const stream=fs.createReadStream(file,{start,end:endByte});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  });
}
async function listen(root, options={}) {
  const server=createServer(root,options);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port||0,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}${options.basePath||'/'}`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
module.exports={createServer,listen,MIME};
if(require.main===module){const {arg}=require('./check-options.cjs');if(arg('host','127.0.0.1')!=='127.0.0.1')throw new Error('This tool only binds loopback');listen(path.resolve(arg('root','dist/web/releases/online-r05')),{port:Number(arg('port',4173))}).then(({url})=>console.log(url)).catch(e=>{console.error(e);process.exitCode=1;});}
