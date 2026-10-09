const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require('../src/core.js');
let mask;
test.before(async () => { mask = await require('../scripts/player-mask.cjs')(path.join(__dirname, '../assets/valenna.png')); });

test('Tharsis hat touching a solar panel fails while the original standard near miss survives', () => {
  for (const mode of ['standard', 'tharsis']) {
    const game = new C.Game(41, mode, mask);
    game.player.vy = -1040 / 120; // Level sprite after this physics step.
    game.gates = [{ x: 140, center: 452, gap: 200, type: 'satellite', id: 0, scored: false }];
    game.step(1/120);
    assert.equal(game.alive, mode === 'standard', mode + ': the visible hat overlaps the top panel');
  }
});

test('Tharsis hat leaving the screen fails before the face reaches the old circular boundary', () => {
  const game = new C.Game(41, 'tharsis', mask);
  game.player.y = 42; game.player.vy = -1040/120;
  game.step(1/120);
  assert.equal(game.alive, false);
  assert.equal(game.cause, 'boundary');
});

test('rotated opaque pixels hit each obstacle while transparent sprite margins stay clear', () => {
  for (const vy of [-345, 0, 570]) {
    const player = { x:114, y:400, vy, r:26 };
    const shape = C.playerSilhouette(player, mask);
    const top = shape.points.reduce((a,b) => a.y < b.y ? a : b);
    for (const kind of ['rocket', 'satellite', 'asteroid']) {
      const obstacle = { kind, x:top.x, y:top.y, w:10, h:10, r:1, seed:4 };
      assert.equal(C.hitsSilhouette(shape, obstacle), true, kind + ' misses the rotated hat');
      obstacle.x -= 220;
      assert.equal(C.hitsSilhouette(shape, obstacle), false);
    }
    const angle=C.playerAngle(player),cos=Math.cos(angle),sin=Math.sin(angle);
    assert.equal(C.hitsSilhouette(shape,{kind:'asteroid',x:114-50*cos+48*sin,y:400-50*sin-48*cos,r:1,seed:1}),false,'Transparent top-left sprite margin stays clear');
    assert.ok(shape.points.length > 3500, 'Use opaque image coverage, not a larger generic circle');
  }
});

test('minimum Tharsis gaps still have a safe center for all sprite inclinations', () => {
  const game = new C.Game(41, 'tharsis', mask);
  for (let i=0; i<60; i++) {
    game.score = 100; game.addGate(114); const gate=game.gates.at(-1);
    for (const vy of [-345, 0, 570]) {
      const shape=C.playerSilhouette({...game.player,y:gate.center,vy},mask);
      assert.ok(C.gateObjects(gate).every(o=>!C.hitsSilhouette(shape,o)));
    }
  }
});
