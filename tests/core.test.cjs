const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

test('standard preserves the frozen pre-update gate and flight trajectories', () => {
  const baseline = require('./fixtures/standard-baseline.json');
  const game = new C.Game(41, 'standard'), gates = [];
  for (let i = 0; i < 120; i++) { game.score = i; game.addGate(590); gates.push(game.gates.at(-1)); }
  assert.deepEqual(gates, baseline.gates);
  game.reset(); const frames = [];
  for (let i = 0; i < 600; i++) {
    if (i % 73 === 0) game.flap(); game.step(1/120);
    if (i % 20 === 0) frames.push({ player: {...game.player}, score: game.score, alive: game.alive, distance: game.distance });
  }
  assert.deepEqual(frames, baseline.frames);
});
test('Tharsis tightens near misses, gap width and height changes while preserving a safe center', () => {
  const normal = new C.Game(41), hard = new C.Game(41, 'tharsis');
  const obstacle = { kind: 'satellite', x: 150, y: 400, w: 128, h: 380 };
  const near = { ...normal.player, x: 65, y: 400 };
  assert.equal(C.hitsObject(near, obstacle), false);
  assert.equal(C.hitsObject({ ...near, r: hard.player.r }, obstacle), true);
  let previous = hard.gates.at(-1).center;
  for (let i = 0; i < 300; i++) {
    hard.score = i; hard.addGate(114); const gate = hard.gates.at(-1);
    assert.ok(gate.gap < 218 && gate.gap >= 170);
    assert.ok(Math.abs(gate.center - previous) >= 140);
    assert.ok(Math.abs(gate.center - previous) <= 221);
    assert.ok(C.gateObjects(gate).every(o => !C.hitsObject({ ...hard.player, y: gate.center }, o)));
    previous = gate.center;
  }
  normal.step(1/120); hard.step(1/120);
  assert.ok(hard.distance > normal.distance);
});

test('opening anthem is first; first random track excludes it; all tracks can return later', () => {
  const playlist = new C.Playlist(4, () => 0);
  assert.equal(playlist.index, 0);
  assert.equal(playlist.next(), 1);
  assert.equal(playlist.next(), 0);
  const firstChoices = [0, .4, .99].map(value => new C.Playlist(4, () => value).next());
  assert.deepEqual(firstChoices, [1, 2, 3]);
});
test('random playback never repeats the immediately previous song over 10000 transitions', () => {
  const playlist = new C.Playlist(4, C.seededRandom(41));
  const visited = new Set();
  for (let i = 0; i < 10000; i++) { const prior = playlist.index; const next = playlist.next(); assert.notEqual(next, prior); visited.add(next); }
  assert.deepEqual([...visited].sort(), [0, 1, 2, 3]);
});
test('rectangular and rounded obstacles respect clear near misses and impacts', () => {
  assert.equal(C.circleRect({ x: 5, y: 5, r: 2 }, { x: 8, y: 8, w: 4, h: 4 }), false);
  assert.equal(C.circleRect({ x: 7, y: 7, r: 2 }, { x: 8, y: 8, w: 4, h: 4 }), true);
  assert.equal(C.circleCircle({ x: 0, y: 0, r: 2 }, { x: 5, y: 0, r: 2 }), false);
  assert.equal(C.circleCircle({ x: 0, y: 0, r: 2 }, { x: 4, y: 0, r: 2 }), true);
  const polygon = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  assert.equal(C.circlePolygon({x:5,y:5,r:1}, polygon), true);
  assert.equal(C.circlePolygon({x:13,y:5,r:1}, polygon), false);
});
test('every generated gate leaves a traversable corridor and bounded next-gate displacement', () => {
  const game = new C.Game(2901);
  let previous = game.gates[game.gates.length - 1].center;
  for (let i = 0; i < 300; i++) {
    game.score = i; game.addGate(114);
    const gate = game.gates[game.gates.length - 1];
    assert.ok(gate.gap >= 218);
    assert.ok(Math.abs(gate.center - previous) <= 108.000001);
    for (const offset of [-65, 0, 65]) {
      const player = {x:114, y:gate.center + offset, r:18};
      assert.ok(C.gateObjects(gate).every(object => !C.hitsObject(player, object)));
    }
    previous = gate.center;
  }
});
test('one press supplies upward impulse; holding no input falls; a dead game cannot score', () => {
  const game = new C.Game(41);
  game.flap(); game.step(1/120); assert.ok(game.player.y < 400);
  for (let i = 0; i < 600; i++) game.step(1/120);
  assert.equal(game.alive, false);
  const score = game.score, y = game.player.y;
  game.flap(); game.step(.05);
  assert.equal(game.score, score); assert.equal(game.player.y, y);
});
test('passing a gate scores once, and reset restores a fresh round', () => {
  const game = new C.Game(1);
  game.gates[0].x = 0; game.gates[0].center = 400;
  game.step(1/120); assert.equal(game.score, 1);
  game.step(1/120); assert.equal(game.score, 1);
  game.reset(); assert.equal(game.score, 0); assert.equal(game.alive, true); assert.equal(game.player.y, 400);
});
test('equivalent physics substeps produce equal movement on different display refresh rates', () => {
  const at60 = new C.Game(1), at120 = new C.Game(1);
  at60.flap(); at120.flap();
  for (let frame = 0; frame < 60; frame++) { at60.step(1/120); at60.step(1/120); }
  for (let frame = 0; frame < 120; frame++) at120.step(1/120);
  assert.deepEqual(at60.player, at120.player);
  assert.equal(at60.distance, at120.distance);
});
