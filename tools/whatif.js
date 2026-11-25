// Works a saved shot log out again under other settings, to tune the jump shot against real play.
//
//   node tools/whatif.js shot-log.json [setting=value ...]
//
// Save the log from the prototype (Save shot log, under the stats): every shot taken there, kept as the game was the
// moment the ball was let go. Each shot is worked out again, now and with the settings given, over the same simulated
// draws, so the two are compared on the same luck shot for shot. "Expected" is the average make chance; "made" is what
// actually went in when it was played.
//
// A setting names any of:
//   the settings panel (game.params)   tAssist, bonus, aAssist, drift, fadeIn, ...
//   a model constant (sim/game.js C)   PERFECT_MS, FL_PERFECT, SQUARE_IN, ...
//   a noise constant (sim/noise.js)    FLOOR_IN, CONTEST_IN, DIST_IN, ...
//   a launch constant (sim/launch.js)  K_SPEED, CONTEST_ARC, ...
// For example: node tools/whatif.js shot-log.json PERFECT_MS=20 tAssist=15
const fs = require('fs');
const path = require('path');
const GM = require('../sim/game.js');
const NZ = require('../sim/noise.js');
const LN = require('../sim/launch.js');

// Rough reference make rates from recent NBA seasons, for orientation only: the game's situations don't line up with
// the league's tracking categories exactly, and a person playing this is not an NBA shooter.
const REFERENCE = {
  'Three, open': 'about 38%', 'Three, contested': 'about 33%',
  'Two-point jumper, open': 'about 44%', 'Two-point jumper, contested': 'about 39%',
  'Floater': 'about 44%', 'Hook': 'about 50%', 'Layup': 'about 63%', 'Dunk': 'about 90%', 'Free throw': 'about 78%',
};
const OPEN = 0.2;                                    // a contest below this counts as open

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node tools/whatif.js shot-log.json [setting=value ...]');
  process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length) usage();
const file = args[0];
let log;
try { log = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { usage(`Could not read ${file}: ${e.message}`); }
if (!log || !Array.isArray(log.shots)) usage(`${file} is not a shot log`);

// settings to try: where each one lives, and its value
const changes = args.slice(1).map(a => {
  const m = /^([A-Za-z_][\w.]*)=(-?[\d.]+)$/.exec(a);
  if (!m) usage(`Not a setting: ${a}`);
  const name = m[1], value = +m[2], probe = GM.create();
  const where = name in probe.params ? 'params' : name in GM.C ? 'C' : name in NZ.NOISE ? 'NOISE' : name in LN.LAUNCH ? 'LAUNCH' : null;
  if (!where) usage(`No setting called ${name}`);
  if (typeof (where === 'params' ? probe.params[name] : where === 'C' ? GM.C[name] : where === 'NOISE' ? NZ.NOISE[name] : LN.LAUNCH[name]) !== 'number')
    usage(`${name} is not a number to change`);
  return { name, value, where };
});
const tables = { C: GM.C, NOISE: NZ.NOISE, LAUNCH: LN.LAUNCH };
// constants are shared by every game, so they are set for the second pass and put back after it
function withChanges(game, fn) {
  const was = [];
  for (const c of changes) {
    if (c.where === 'params') game.params[c.name] = c.value;
    else { was.push([tables[c.where], c.name, tables[c.where][c.name]]); tables[c.where][c.name] = c.value; }
  }
  try { return fn(); } finally { for (const [t, k, v] of was) t[k] = v; }
}

const situation = (r, snap) => {
  if (snap.flow && snap.flow.on && snap.flow.phase === 'ft') return 'Free throw';
  if (r.kind === 'dunk') return 'Dunk';
  if (r.kind === 'hook') return 'Hook';
  if (r.kind === 'layup') return 'Layup';
  if (r.kind === 'floater') return 'Floater';
  return `${r.three ? 'Three' : 'Two-point jumper'}, ${r.c < OPEN ? 'open' : 'contested'}`;
};

const rows = new Map(), timing = [];
const t0 = Date.now();
for (const shot of log.shots) {
  const g = GM.create();
  GM.load(g, shot.snap);
  const now = GM.releaseOdds(g);
  const changed = changes.length ? withChanges(g, () => GM.releaseOdds(g)) : null;
  const key = situation(now, shot.snap);
  if (!rows.has(key)) rows.set(key, { n: 0, made: 0, now: 0, changed: 0 });
  const row = rows.get(key);
  row.n++; row.made += shot.result && shot.result.make ? 1 : 0; row.now += now.make; if (changed) row.changed += changed.make;
  if ((now.kind === 'jumper' || now.kind === 'floater') && key !== 'Free throw')
    timing.push({ e: now.e, window: now.kind === 'floater' ? GM.C.FL_PERFECT : GM.C.PERFECT_MS, aim: now.aim, q: now.q, qChanged: changed ? changed.q : null, kind: now.kind });
}

const pct = x => `${Math.round(x*100)}%`.padStart(5);
const first = log.shots[0] && log.shots[0].snap.params;
console.log(`${log.shots.length} shots from ${path.basename(file)}${log.build ? `, build ${log.build}` : ''}, worked out in ${((Date.now() - t0)/1000).toFixed(1)} s`);
if (first) console.log(`Logged with: timing assist ${first.tAssist} ms, perfect-release bonus ${first.bonus}%, aim assist ${first.aAssist}%`);
if (changes.length) console.log(`Trying: ${changes.map(c => `${c.name} = ${c.value}`).join(', ')}`);

if (timing.length) {
  const abs = timing.map(t => Math.abs(t.e)).sort((a, b) => a - b), med = abs[Math.floor(abs.length/2)];
  const share = f => pct(timing.filter(f).length/timing.length);
  const early = timing.filter(t => t.e < 0).length;
  console.log(`\nYour timing, over ${timing.length} jump shots and floaters (ms off the release line):`);
  console.log(`  in the perfect window ${share(t => Math.abs(t.e) <= t.window)}   within 30 ms ${share(t => Math.abs(t.e) <= 30)}   within 60 ms ${share(t => Math.abs(t.e) <= 60)}   further off ${share(t => Math.abs(t.e) > 60)}`);
  console.log(`  typically ${Math.round(med)} ms off; ${pct(early/timing.length).trim()} of releases early, ${pct(1 - early/timing.length).trim()} late`);
  const aims = timing.filter(t => t.kind === 'jumper').map(t => Math.abs(t.aim)*180/Math.PI).sort((a, b) => a - b);
  if (aims.length) console.log(`  aim: typically ${aims[Math.floor(aims.length/2)].toFixed(1)}° off the rim`);
  if (changes.length) console.log(`  release quality (0 to 1, 1 is perfect) averages ${(timing.reduce((s, t) => s + t.q, 0)/timing.length).toFixed(2)} now, ${(timing.reduce((s, t) => s + t.qChanged, 0)/timing.length).toFixed(2)} with the changes`);
}

const order = ['Three, open', 'Three, contested', 'Two-point jumper, open', 'Two-point jumper, contested', 'Floater', 'Hook', 'Layup', 'Dunk', 'Free throw'];
console.log(`\n${'Situation'.padEnd(30)}${'shots'.padStart(6)}${'made'.padStart(7)}${'expected now'.padStart(14)}${changes.length ? 'with changes'.padStart(14) : ''}   reference`);
for (const key of order) {
  const r = rows.get(key); if (!r) continue;
  console.log(`${key.padEnd(30)}${String(r.n).padStart(6)}${pct(r.made/r.n).padStart(7)}${pct(r.now/r.n).padStart(14)}${changes.length ? pct(r.changed/r.n).padStart(14) : ''}   ${REFERENCE[key] || ''}`);
}
console.log('\nExpected is the average make chance over 400 simulated shots each; made is what went in when it was played.');
console.log('The reference is rough: real-game categories differ from these, and nobody is an NBA shooter on their first day.');
