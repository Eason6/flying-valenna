// Original synthetic crowd: layered voiced "woo/yeah" contours, hand claps and
// whistles. Deterministic PCM, no recordings, network service or new dependency.
const fs = require('node:fs'), path = require('node:path');
const random = require('../src/core.js').seededRandom(260108);
const rate=44100, seconds=3.6, length=Math.round(rate*seconds);
const channels=[new Float64Array(length),new Float64Array(length)];
const add=(i,value,pan)=>{channels[0][i]+=value*Math.sqrt((1-pan)/2);channels[1][i]+=value*Math.sqrt((1+pan)/2);};
for(let voice=0;voice<22;voice++) {
  const start=.025+random()*.48, duration=1.5+random()*1.45, pitch=145+random()*245, pan=random()*1.8-.9;
  let phase=random()*Math.PI*2;
  for(let i=Math.floor(start*rate);i<Math.min(length,(start+duration)*rate);i++) {
    const t=i/rate-start,p=t/duration;
    const f=pitch*(.87+.43*Math.sin(Math.PI*p)-.17*p)+Math.sin(t*(29+voice*.7))*3;
    phase+=2*Math.PI*f/rate;
    const envelope=Math.min(1,t/.13)*Math.min(1,(duration-t)/.5)*(.76+.24*Math.sin(t*8+voice));
    const f1=voice%3===0?640:390, f2=voice%3===0?1500:880;
    let sample=0;
    for(let h=1;h<=12;h++) {
      const hz=f*h;
      const weight=(.14+Math.exp(-(((hz-f1)/220)**2))+.48*Math.exp(-(((hz-f2)/360)**2)))/h;
      sample+=Math.sin(phase*h)*weight;
    }
    add(i,(sample*.065+(random()*2-1)*.003)*envelope,pan);
  }
}
for(let clap=0;clap<48;clap++) {
  const start=.06+random()*3.1,pan=random()*2-1;
  for(let j=0;j<rate*.065&&Math.floor(start*rate)+j<length;j++) {
    const t=j/rate,env=Math.exp(-t*65)*Math.min(1,t/.001);
    add(Math.floor(start*rate)+j,(random()*2-1)*env*.11,pan);
  }
}
for(let whistle=0;whistle<3;whistle++) {
  const start=.4+whistle*.65, duration=.75,pan=whistle%2?.7:-.7;let phase=0;
  for(let j=0;j<rate*duration;j++) {
    const t=j/rate,p=t/duration;phase+=Math.PI*2*(1650+whistle*160+420*Math.sin(p*Math.PI))/rate;
    add(Math.floor(start*rate)+j,Math.sin(phase)*Math.sin(Math.PI*p)**2*.033,pan);
  }
}
let peak=0, sum=0;
for(let i=0;i<length;i++)for(const samples of channels) {samples[i]*=Math.min(1,(seconds-i/rate)/.3);peak=Math.max(peak,Math.abs(samples[i]));}
const scale=.82/peak,bytes=Buffer.alloc(44+length*4);
bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);
bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(length*4,40);
for(let i=0;i<length;i++)for(let channel=0;channel<2;channel++){const value=channels[channel][i]*scale;sum+=value*value;bytes.writeInt16LE(Math.round(value*32767),44+(i*2+channel)*2);}
const target=path.resolve(__dirname,'../assets/cheer-v3.wav');
fs.writeFileSync(target,bytes,{flag:'wx'});
console.log(JSON.stringify({target,seconds,channels:2,sampleRate:rate,peak:.82,rms:Math.sqrt(sum/(length*2)),provenance:'Original deterministic procedural synthesis'},null,2));
