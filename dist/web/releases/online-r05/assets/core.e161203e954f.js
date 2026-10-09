(function (root) {
  'use strict';
  const W = 450, H = 800;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function seededRandom(seed) {
    let state = (seed >>> 0) || 0x6d2b79f5;
    return function () {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }
  function nextTrackIndex(previous, count, random = Math.random) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('A playlist needs at least one track.');
    if (count === 1) return 0;
    const available = Array.from({ length: count }, (_, i) => i).filter(i => i !== previous);
    return available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  }
  class Playlist {
    constructor(count, random = Math.random) { this.count = count; this.random = random; this.index = 0; }
    next() { this.index = nextTrackIndex(this.index, this.count, this.random); return this.index; }
  }
  function circleRect(circle, rect) {
    const dx = circle.x - clamp(circle.x, rect.x, rect.x + rect.w);
    const dy = circle.y - clamp(circle.y, rect.y, rect.y + rect.h);
    return dx * dx + dy * dy <= circle.r * circle.r;
  }
  function circleCircle(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= (a.r + b.r) ** 2; }
  function circlePolygon(circle, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[j], b = vertices[i];
      if (((a.y > circle.y) !== (b.y > circle.y)) && circle.x < (b.x - a.x) * (circle.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      const vx = b.x - a.x, vy = b.y - a.y;
      const t = clamp(((circle.x - a.x) * vx + (circle.y - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
      if ((circle.x - a.x - t * vx) ** 2 + (circle.y - a.y - t * vy) ** 2 <= circle.r ** 2) return true;
    }
    return inside;
  }
  // These normalized points follow the opaque body of the generated rocket;
  // soft surrounding glow and empty sprite margins do not collide.
  const rocketProfile = [
    [.48, .043], [.40, .17], [.38, .33], [.33, .33], [.285, .47], [.275, .74],
    [.264, .875], [.31, .93], [.55, .94], [.64, .88], [.68, .84], [.81, .84],
    [.70, .70], [.70, .48], [.66, .35], [.63, .32], [.58, .43], [.575, .17],
  ];
  function rocketPolygon(object) {
    return rocketProfile.map(([x, y]) => ({
      x: object.x + (x - .5) * object.w,
      y: object.y + ((object.flip ? 1 - y : y) - .5) * object.h,
    }));
  }
  function gateObjects(gate) {
    const upper = gate.center - gate.gap / 2, lower = gate.center + gate.gap / 2;
    const objects = [];
    if (gate.type === 'rocket') {
      // The visible nose (4.3% from the sprite edge) aligns with the safe corridor.
      const height = 520;
      objects.push({ kind: 'rocket', x: gate.x, y: upper - height * .457, w: 230, h: height, flip: true });
      objects.push({ kind: 'rocket', x: gate.x, y: lower + height * .457, w: 230, h: height, flip: false });
    } else if (gate.type === 'satellite') {
      objects.push({ kind: 'satellite', x: gate.x, y: upper - 190, w: 128, h: 380 });
      objects.push({ kind: 'satellite', x: gate.x, y: lower + 190, w: 128, h: 380 });
    } else {
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < 8; i++) {
          const y = side ? lower + 43 + i * 70 : upper - 43 - i * 70;
          if (y < -55 || y > H + 55) break;
          objects.push({ kind: 'asteroid', x: gate.x + Math.sin(gate.id * 4 + i * 7 + side) * 12, y, r: 43, seed: gate.id * 23 + i * 13 + side * 17 });
        }
      }
    }
    return objects;
  }
  function satelliteRects(object) {
    const { x, y, h } = object;
    return [
      { x: x - 62, y: y - h / 2 + 3, w: 39, h: h - 6 },
      { x: x + 23, y: y - h / 2 + 3, w: 39, h: h - 6 },
      { x: x - 19, y: y - 37, w: 38, h: 74 },
      { x: x - 26, y: y - 5, w: 52, h: 10 },
    ];
  }
  function hitsObject(player, object) {
    if (object.kind === 'rocket') return circlePolygon(player, rocketPolygon(object));
    if (object.kind === 'satellite') return satelliteRects(object).some(rect => circleRect(player, rect));
    return circleCircle(player, { x: object.x, y: object.y, r: object.r * .91 });
  }
  const playerAngle = player => clamp(player.vy / 950, -.36, .65);
  function playerSilhouette(player, mask) {
    const angle = playerAngle(player), cos = Math.cos(angle), sin = Math.sin(angle);
    let left=Infinity, right=-Infinity, top=Infinity, bottom=-Infinity;
    const points = mask.points.map(([x,y]) => {
      const point = { x:player.x+x*cos-y*sin, y:player.y+x*sin+y*cos, r:mask.radius };
      left=Math.min(left,point.x-point.r); right=Math.max(right,point.x+point.r);
      top=Math.min(top,point.y-point.r); bottom=Math.max(bottom,point.y+point.r);
      return point;
    });
    return { points, left, right, top, bottom };
  }
  function asteroidPolygon(object) {
    const random=seededRandom(object.seed+900);
    return Array.from({length:13},(_,i)=>{
      const angle=i/13*Math.PI*2+object.seed*.72, radius=object.r*(.92+random()*.15);
      return {x:object.x+Math.cos(angle)*radius,y:object.y+Math.sin(angle)*radius};
    });
  }
  function hitsSilhouette(shape, object) {
    let polygons=[], rects=[];
    if (object.kind==='rocket') polygons=[rocketPolygon(object)];
    else if (object.kind==='asteroid') polygons=[asteroidPolygon(object)];
    else rects=[
      // Include visible gold panel frames and antenna in the strict mode.
      {x:object.x-65,y:object.y-object.h/2,w:45,h:object.h},
      {x:object.x+21,y:object.y-object.h/2,w:45,h:object.h},
      {x:object.x-20,y:object.y-43,w:40,h:82},
      {x:object.x-39,y:object.y-5,w:78,h:10},
      {x:object.x-1,y:object.y-72,w:2,h:29},
      {x:object.x-15,y:object.y-69,w:30,h:10},
    ];
    for(const polygon of polygons) {
      const xs=polygon.map(p=>p.x),ys=polygon.map(p=>p.y);
      if(shape.right<Math.min(...xs)||shape.left>Math.max(...xs)||shape.bottom<Math.min(...ys)||shape.top>Math.max(...ys))continue;
      if(shape.points.some(point=>circlePolygon(point,polygon)))return true;
    }
    for(const rect of rects) {
      if(shape.right<rect.x||shape.left>rect.x+rect.w||shape.bottom<rect.y||shape.top>rect.y+rect.h)continue;
      if(shape.points.some(point=>circleRect(point,rect)))return true;
    }
    return false;
  }
  class Game {
    constructor(seed = Date.now(), mode = 'standard', playerMask = null) { this.seed = seed; this.mode = mode === 'tharsis' ? mode : 'standard'; this.playerMask = playerMask; this.reset(); }
    reset() {
      this.random = seededRandom(this.seed);
      this.player = { x: 114, y: 400, vy: 0, r: this.mode === 'tharsis' ? 26 : 18 };
      this.gates = []; this.score = 0; this.elapsed = 0; this.distance = 0;
      this.alive = true; this.cause = ''; this.lastCenter = 400; this.serial = 0;
      this.addGate(590); this.addGate(915);
    }
    addGate(x) {
      const hard = this.mode === 'tharsis';
      const gap = hard ? Math.max(174, 206 - this.score * 1.1) : Math.max(218, 258 - this.score * 1.2);
      let center = 400;
      if (this.serial > 0) {
        if (hard) {
          const change = 150 + this.random() * 70;
          const low = 90 + gap / 2, high = 740 - gap / 2;
          let direction = this.random() < .5 ? -1 : 1;
          if (this.lastCenter + direction * change < low || this.lastCenter + direction * change > high) direction *= -1;
          center = this.lastCenter + direction * change;
        } else center = clamp(this.lastCenter + (this.random() * 2 - 1) * 108, 130 + gap / 2, 710 - gap / 2);
      }
      const types = ['rocket', 'satellite', 'asteroid'];
      this.gates.push({ x, center, gap, type: types[this.serial % 3], id: this.serial++, scored: false });
      this.lastCenter = center;
    }
    flap() { if (this.alive) this.player.vy = -345; }
    step(dt) {
      if (!this.alive || !(dt > 0)) return;
      // The caller uses 1/120 s substeps; this cap also prevents giant resume jumps.
      dt = Math.min(dt, .05);
      this.elapsed += dt;
      const speed = this.mode === 'tharsis' ? 170 + Math.min(48, this.score * 1.8) : 146 + Math.min(40, this.score * 1.6);
      this.distance += speed * dt;
      this.player.vy = Math.min(570, this.player.vy + 1040 * dt);
      this.player.y += this.player.vy * dt;
      for (const gate of this.gates) gate.x -= speed * dt;
      const silhouette = this.mode === 'tharsis' && this.playerMask ? playerSilhouette(this.player, this.playerMask) : null;
      if (silhouette ? silhouette.top < 0 || silhouette.bottom > H : this.player.y - this.player.r < 0 || this.player.y + this.player.r > H) {
        this.alive = false; this.cause = 'boundary'; return;
      }
      for (const gate of this.gates) {
        if (Math.abs(gate.x - this.player.x) < 150 && gateObjects(gate).some(object => silhouette ? hitsSilhouette(silhouette, object) : hitsObject(this.player, object))) {
          this.alive = false; this.cause = gate.type; return;
        }
        if (!gate.scored && gate.x + 84 < this.player.x - this.player.r) {
          gate.scored = true; this.score++;
        }
      }
      this.gates = this.gates.filter(gate => gate.x > -180);
      if (this.gates[this.gates.length - 1].x < W + 80) this.addGate(this.gates[this.gates.length - 1].x + 325);
    }
  }
  const api = { W, H, clamp, seededRandom, nextTrackIndex, Playlist, circleRect, circleCircle, circlePolygon, rocketPolygon, gateObjects, satelliteRects, hitsObject, playerAngle, playerSilhouette, hitsSilhouette, asteroidPolygon, Game };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ValennaCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
