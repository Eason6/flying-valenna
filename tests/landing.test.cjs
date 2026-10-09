const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
// Exercise the actual drawing trajectory without starting audio or a browser.
const trajectory=app.slice(app.indexOf('  const smooth ='),app.indexOf('  function drawCelebration'));
const scope={C:require('../src/core.js'),TOUCHDOWN_AT:20.5,reducedMotion:false};
vm.createContext(scope);vm.runInContext(trajectory,scope);
test('capsule descends within the scene and stays grounded after touchdown',()=>{
  let previous=scope.landingY(12);
  for(let t=12.01;t<24;t+=.01){const y=scope.landingY(t);assert.ok(Number.isFinite(y)&&y>=250&&y<=659.001);assert.ok(y>=previous-.001);previous=y;}
  assert.equal(scope.landingY(24),659);
});
test('descent speed stays continuous through deployment, braking and touchdown',()=>{
  const h=.0001;
  for(const t of [13.4,14.8,19.4,20.5]){
    const left=(scope.landingY(t)-scope.landingY(t-h))/h;
    const right=(scope.landingY(t+h)-scope.landingY(t))/h;
    assert.ok(Math.abs(right-left)<.1,`Velocity jumps at ${t}s: ${left} -> ${right}`);
  }
});
