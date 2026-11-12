// Milestone 3: find the noise multipliers and clean-look settings that hit the design targets.
const N = require('./noise.js');
const NN = N.NOISE, n = 3000;
function solve(kind, situ, target, lo = 0.3, hi = 2.0) {
  for (let i = 0; i < 12; i++) { const m = (lo + hi)/2; NN.MULT[kind] = m; const r = N.makeRate(situ, n).rate; if (r > target) lo = m; else hi = m; }
  NN.MULT[kind] = (lo + hi)/2; return NN.MULT[kind];
}
const out = {};
NN.DIST_IN = 0;                                   // the physics already handles distance
function solveContest() { let lo = 4, hi = 16; for (let i = 0; i < 10; i++) { const c = (lo + hi)/2; NN.CONTEST_IN = c; const r = N.makeRate({ dist: 24, contest: 1 }, n).rate; if (r > 0.155) lo = c; else hi = c; } NN.CONTEST_IN = (lo + hi)/2; }
solve('jumper', { dist: 24 }, 0.50);
// how far past the rim a heavy contest can push a shot: about 3% airballs
for (const ct of [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2]) {
  NN.CONTEST_TAIL_IN = ct; solveContest();
  const h = N.makeRate({ dist: 24, contest: 1 }, n), air = h.airballs/n;
  console.log(`contest tail +${ct} in: heavy contest ${(h.rate*100).toFixed(1)}%, airballs ${(air*100).toFixed(1)}%`);
  out.contestTail = ct; if (air >= 0.03) break;
}
out.jumper = NN.MULT.jumper; out.contestIn = NN.CONTEST_IN;
out.floater = solve('floater', { kind: 'floater', dist: 10, move: 12 }, 0.50);
out.layup = solve('layup', { kind: 'layup', dist: 4, extra: 1.26 }, 0.80, 0.5, 4);
// clean looks: smallest premium whose best cap gives 60% with at least 95% near misses and no airballs
let best = null;
for (const prem of [0.04, 0.06, 0.07, 0.08, 0.09, 0.10, 0.12]) {
  for (const cap of [1.2, 1.4, 1.6, 1.8, 2.0, 2.3]) {
    NN.PREMIUM = prem; NN.CAP = cap;
    const r = N.makeRate({ dist: 24, clean: 1 }, n);
    const ok = r.nearOfMisses >= 0.95 && r.airballs === 0;
    const score = Math.abs(r.rate - 0.60);
    if (ok && (!best || score < best.score)) best = { prem, cap, rate: r.rate, near: r.nearOfMisses, score };
  }
}
NN.PREMIUM = best.prem; NN.CAP = best.cap;
out.clean = best;
console.log(JSON.stringify(out));
require('fs').writeFileSync('calibration.json', JSON.stringify({ MULT: NN.MULT, DIST_IN: NN.DIST_IN, CONTEST_IN: NN.CONTEST_IN, PREMIUM: NN.PREMIUM, CAP: NN.CAP, TAIL_IN: NN.TAIL_IN, CONTEST_TAIL_IN: NN.CONTEST_TAIL_IN }, null, 1));
const checks = {
  'open perfect three 24ft (target 50)': { dist: 24 },
  'clean perfect three 24ft (target 60)': { dist: 24, clean: 1 },
  'open perfect 15ft (old 61)': { dist: 15 },
  'open three, 25 ms off (old 45)': { dist: 24, q: 0.675, timingMs: 13 },
  'heavy contest three (target mid-teens)': { dist: 24, contest: 1 },
  'open 15ft straight fade, fadeaway 70 (old 49)': { dist: 15, fadeIn: 2.0 },
  'floater 10ft moving (target 50)': { kind: 'floater', dist: 10, move: 12 },
  'layup 4ft open sprint (target 80)': { kind: 'layup', dist: 4, extra: 1.26 },
};
for (const [k, s] of Object.entries(checks)) { const r = N.makeRate(s, 4000, 7); console.log(k.padEnd(48), (r.rate*100).toFixed(1)+'%', 'near misses', (r.nearOfMisses*100).toFixed(0)+'%', 'airballs', (r.airballs/40).toFixed(1)+'%'); }
