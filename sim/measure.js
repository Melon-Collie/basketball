// Make and block rates with defenders' hands in the simulation.
// calibrate.js tunes the noise with nobody's hand in the way, so its numbers leave blocks out. Here the contest and
// the hands both come from where the defender is at release (situation.js), and a hand on the ball is a real block.
// Each cell is one defender state at the moment of release; nothing here plays out the defender's reaction.
const N = require('./noise.js'), SIT = require('./situation.js'), P = require('./physics.js');
Object.assign(N.NOISE, require('./calibration.js'));
const R = P.PHYS.RIM, n = 4000, seed = 7;

// a defender `d` ft from the shooter, `angle` degrees off the shot line (0 = between the shooter and the rim)
function defenderAt(p, d, o = {}) {
  const f = SIT.frame(p), a = (o.angle || 0)*Math.PI/180;
  const dx = f.u.x*Math.cos(a) + f.r.x*Math.sin(a), dy = f.u.y*Math.cos(a) + f.r.y*Math.sin(a);
  return { x: p.x + dx*d, y: p.y + dy*d, vx: 0, vy: 0, hand: 0, h: 0, land: 0, len: 1, jumpT: -1, jumpAt: null, stand: 8.2, ...o };
}
const airborne = t => ({ jumpT: t, h: Math.sin(Math.PI*t/SIT.SITU.JUMP_T) });
const ON_BALL = { len: 1, stand: 8.2 }, BIG = { len: 1.2, stand: 8.9 };
// The defender jumps when they see the shot, one reaction time (250 ms) into it, so at a 520 ms jumper release
// they are 270 ms into a 500 ms jump, and at a 330 ms floater release they are 80 ms in.
const STATES = {
  jumper:  [["hand down", {}], ["hand up", { hand: 1 }], ["in the air", { hand: 1, ...airborne(0.27) }], ["closing, hand up", { hand: 1, closing: 12 }]],
  floater: [["hand down", {}], ["hand up", { hand: 1 }], ["in the air", { hand: 1, ...airborne(0.08) }]],
};
const cell = r => `${r.c.toFixed(2)} ${(r.rate*100).toFixed(0).padStart(3)}% ${(r.blocks*100).toFixed(0).padStart(3)}%`;
function table(title, firstCol, cols, rows) {
  console.log(`\n${title}`);
  console.log(firstCol.padEnd(12) + cols.map(c => c.padEnd(19)).join(''));
  console.log(''.padEnd(12) + cols.map(() => 'c    make block'.padEnd(19)).join(''));
  for (const [name, cells] of rows) console.log(name.padEnd(12) + cells.map(c => cell(c).padEnd(19)).join(''));
}

function timed(kind, dist, move, body, d, state) {
  const p = { x: R.x, y: R.y + dist, vx: 0, vy: -move };
  const defs = d === null ? [] : [defenderAt(p, d, { ...body, ...state })];
  if (defs.length && state.closing) { const f = SIT.frame(p); defs[0].vx = -f.u.x*state.closing; defs[0].vy = -f.u.y*state.closing; }
  const c = (kind === "floater" ? SIT.floaterContest : SIT.jumperContest)(p, defs).c;
  const clean = kind === "jumper" ? SIT.cleanLook(p, defs, false, move) : 0;   // floaters don't get the clean-look premium
  const r = N.makeRate({ kind, dist, move, contest: c, clean, hands: SIT.handPaths(p, defs, null) }, n, seed);
  return { c, rate: r.rate, blocks: r.blocks };
}
function timedTable(title, kind, dist, move, body, gaps) {
  const states = STATES[kind];
  const rows = [["nobody", [timed(kind, dist, move, body, null, {})]]];
  for (const d of gaps) rows.push([`${d.toFixed(1)} ft`, states.map(([, s]) => timed(kind, dist, move, body, d, s))]);
  table(title, "defender", states.map(([name]) => name), rows);
}

// Layups: the shooter is 3 ft out at the end of the finish, arriving at 11 ft/s (under control at finishing 80).
function layup(angle, state, side) {
  const p = { x: R.x, y: R.y + 3, vx: 0, vy: 0 };
  const defs = [defenderAt(p, 2.3, { ...BIG, angle, ...state })];
  const con = SIT.rimContest(p, defs, side);
  const fs = SIT.finishScatter({ speed: 11, vPerp: 0, side, hangMs: 0, euro: 0, contest: con.c, finishing: 80 });
  const r = N.makeRate({ kind: "layup", dist: 3, contest: con.c, extra: Math.hypot(fs.parts[1], fs.parts[2]), hands: SIT.handPaths(p, defs, null) }, n, seed);
  return { c: con.c, rate: r.rate, blocks: r.blocks };
}
function layupTable(title, angle) {
  const states = [["standing", {}], ["rising", airborne(0.1)], ["at the peak", airborne(0.25)], ["just landed", { land: 0.3 }]];
  const sides = [["away", -1], ["middle", 0], ["into them", 1]];
  table(title, "finish", states.map(([name]) => name), sides.map(([name, s]) => [name, states.map(([, st]) => layup(angle, st, s))]));
}

console.log(`Each cell: contest, make rate and block rate over ${n} simulated shots, perfect release, defenders' hands included.`);
timedTable("Three from 24 ft, on-ball defender between the shooter and the rim", "jumper", 24, 0, ON_BALL, [6, 5, 4, 3.5, 3, 2.5, 2, 1.8]);
timedTable("Jumper from 15 ft, on-ball defender between the shooter and the rim", "jumper", 15, 0, ON_BALL, [6, 5, 4, 3.5, 3, 2.5, 2, 1.8]);
timedTable("Floater from 10 ft at 12 ft/s, rim protector between the shooter and the rim", "floater", 10, 12, BIG, [5, 4, 3.5, 3, 2.5, 2.2]);
layupTable("Layup from 3 ft, rim protector 2.3 ft away, straight between the shooter and the rim", 0);
layupTable("Layup from 3 ft, rim protector 2.3 ft away, 40 degrees to the shooter's right", 40);
