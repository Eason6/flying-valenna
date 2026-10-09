// Test-only predictive keyboard controller. It reads snapshots and proposes a
// key press; it never alters the running game's gates, physics or collision mask.
const C=require('../src/core.js');
let mask;
module.exports.configure=function(source){
  const cells=new Set();
  for(const [x,y] of source.points)cells.add(Math.floor((x+60.16)/3)+','+Math.floor((y+59.22)/3));
  mask={points:[...cells].map(cell=>{const[x,y]=cell.split(',').map(Number);return[(x+.5)*3-60.16,(y+.5)*3-59.22];}),radius:6.13};
};
module.exports.shouldFlap=function shouldFlap(snapshot) {
  const speed=170+Math.min(48,snapshot.score*1.8),dt=.075;
  // Budget observation/IPC/keyboard latency before the action reaches a frame.
  snapshot={...snapshot,gates:snapshot.gates.map(g=>({...g,x:g.x-speed/40}))};
  for(let sub=0;sub<3;sub++){snapshot.vy=Math.min(570,snapshot.vy+1040/120);snapshot.y+=snapshot.vy/120;}
  const objects=snapshot.gates.flatMap(C.gateObjects);
  let beam=[{y:snapshot.y,vy:snapshot.vy,cost:0,first:false}],best=beam[0];
  for(let step=0;step<18;step++) {
    const time=(step+1)*dt,dx=speed*time,choices=[];
    const nearby=objects.filter(o=>Math.abs(o.x-(114+dx))<155).map(o=>({...o,x:o.x-dx}));
    const earlier=nearby.map(o=>({...o,x:o.x+speed*dt}));
    const nextIndex=snapshot.gates.findIndex(g=>g.x-dx+120>114);
    const next=snapshot.gates[nextIndex];
    const target=(next?.center||snapshot.target)+14;
    for(const node of beam)for(const flap of [false,true]) {
      let vy=flap?-345:node.vy,y=node.y;
      if(flap){const atPress=C.playerSilhouette({x:114,y,vy},mask);if(earlier.some(o=>C.hitsSilhouette(atPress,o)))continue;}
      for(let sub=0;sub<9;sub++){vy=Math.min(570,vy+1040/120);y+=vy/120;}
      const shape=C.playerSilhouette({x:114,y,vy},mask);
      if(shape.top<1||shape.bottom>799||nearby.some(o=>C.hitsSilhouette(shape,o)))continue;
      choices.push({y,vy,first:step===0?flap:node.first,cost:node.cost+(y-target)**2*.0003+(flap?.08:0)});
    }
    if(!choices.length)return best.first;
    choices.sort((a,b)=>a.cost-b.cost);best=choices[0];
    const cells=new Set();beam=[];
    for(const node of choices){const key=Math.round(node.y/7)+','+Math.round(node.vy/45);if(cells.has(key))continue;cells.add(key);beam.push(node);if(beam.length===20)break;}
  }
  return best.first;
};
