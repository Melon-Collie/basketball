// Noise in launch space: milestone 3.
// Today's scatter components (inches at the rim, already tuned in play) are converted into launch noise
// (speed fraction, direction angle) using each shot's own sensitivities, then scaled by one multiplier per
// shot type found by calibration. Ratings are gone: the shooter term is a universal floor.
const PLn = (typeof module !== "undefined") ? require("./physics.js") : window.PhysicsLib;
const LLn = (typeof module !== "undefined") ? require("./launch.js") : window.LaunchLib;

const NOISE = {
  FLOOR_IN: 3.93,            // universal floor, inches (today's 80-rated shooter term)
  BONUS: 0.30,               // perfect release shrinks the floor by up to this
  DIST_IN: 0.10, MOVE_IN: 0.14, CONTEST_IN: 6.0,
  DEP_RATIO: { jumper: 1.16, floater: 1.45, layup: 1.2 },
  FLOATER_FLOOR_IN: 4.6, FLOATER_MOVE_IN: 0.08, FLOATER_CONTEST_IN: 5.0,
  LAYUP_FLOOR_IN: 2.48,      // today's 80 finisher
  MULT: { jumper: 1, floater: 1, layup: 1 },   // set by calibration
  PREMIUM: 0.13, CAP: 1.35,                    // clean looks; set by calibration
  TAIL_IN: 12.5, CONTEST_TAIL_IN: 0,           // a contest can push past that: a heavily altered shot can airball (set by calibration)
                                // noise alone can carry a shot at most this far from the rim's center (in):
                                               // a hard clank off the rim's edge, never clean past it. Airballs come from mistakes.
};

// Today's components, in inches: { lat, dep }
function scatterIn(s) {
  const q = s.q ?? 1, kind = s.kind || "jumper";
  let lat;
  if (kind === "floater") {
    const r = NOISE.FLOATER_FLOOR_IN*(1 - NOISE.BONUS*q);
    lat = Math.hypot(r, NOISE.DIST_IN*s.dist, NOISE.FLOATER_MOVE_IN*(s.move || 0), NOISE.FLOATER_CONTEST_IN*(s.contest || 0));
  } else if (kind === "layup") {
    lat = Math.hypot(NOISE.LAYUP_FLOOR_IN, s.extra || 0, 3.5*(s.contest || 0));
  } else {
    const r = NOISE.FLOOR_IN*(1 - NOISE.BONUS*q);
    lat = Math.hypot(r, NOISE.DIST_IN*s.dist, Math.hypot(NOISE.MOVE_IN*(s.move || 0), s.fadeIn || 0), NOISE.CONTEST_IN*(s.contest || 0));
  }
  lat *= NOISE.MULT[kind]*(1 - NOISE.PREMIUM*(s.clean || 0)*q);
  return { lat, dep: lat*NOISE.DEP_RATIO[kind] };
}

// Local sensitivities of a launch: inches at the rim per radian of direction and per unit of speed fraction
function sensitivity(inp) {
  const base = LLn.rimPlaneOffset(LLn.buildLaunch(inp), inp.player);
  const a = LLn.rimPlaneOffset(LLn.buildLaunch({ ...inp, noise: { dv: 0, de: 0, da: 0.1 } }), inp.player);
  const v = LLn.rimPlaneOffset(LLn.buildLaunch({ ...inp, noise: { dv: 0.002, de: 0, da: 0 } }), inp.player);
  return { latPerRad: (a.lat - base.lat)/(0.1*Math.PI/180), depPerFrac: (v.dep - base.dep)/0.002 };
}

// Draw one shot's launch noise. z = two standard normals (lateral, depth); clean perfect shots get capped.
function sampleNoise(inp, sc, z) {
  const sens = sensitivity(inp);
  const shape = (sc.clean || 0)*(sc.q ?? 1);
  let zl = z[0], zd = z[1];
  if (shape > 0.05) { const zr = Math.hypot(zl, zd), cap = NOISE.CAP/shape; if (zr > cap) { zl *= cap/zr; zd *= cap/zr; } }
  const s = scatterIn(sc);
  { const rin = Math.hypot(zl*s.lat, zd*s.dep); const lim = NOISE.TAIL_IN + NOISE.CONTEST_TAIL_IN*(sc.contest || 0); if (rin > lim) { zl *= lim/rin; zd *= lim/rin; } }
  return { dv: zd*s.dep/sens.depPerFrac, de: 0, da: (zl*s.lat/sens.latPerRad)*180/Math.PI };
}

function rngN(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
function gaussN(r) { const a = Math.max(1e-9, r()), b = r(); return Math.sqrt(-2*Math.log(a))*Math.cos(2*Math.PI*b); }

// Make rate (and outcome mix) for a situation, by simulation. situ.hands (defenders' hands, as physics takes them)
// are optional: with them, blocks are real collisions and count as misses.
const NEAR_MISS_IN = 11;
function makeRate(situ, n = 3000, seed = 1) {
  const R = PLn.PHYS.RIM, r = rngN(seed), player = situ.player || { x: R.x, y: R.y + situ.dist };
  const base = { kind: situ.kind || "jumper", player, contest: situ.contest || 0, timingMs: situ.timingMs || 0, relZ: situ.relZ };
  const sc = { kind: base.kind, dist: situ.dist, q: situ.q ?? 1, move: situ.move || 0, contest: situ.contest || 0,
               clean: situ.clean || 0, fadeIn: situ.fadeIn || 0, extra: situ.extra || 0 };
  let made = 0, near = 0, misses = 0, air = 0, blocks = 0; const labels = {};
  for (let i = 0; i < n; i++) {
    const noise = sampleNoise(base, sc, [gaussN(r), gaussN(r)]);
    const L = LLn.buildLaunch({ ...base, noise }), res = PLn.simulateShot(L, { quick: true, hands: situ.hands || [] });
    labels[res.label] = (labels[res.label] || 0) + 1;
    if (res.blocked) blocks++;
    if (res.made) made++;
    else {
      misses++; if (res.label === "Airball") air++;
      const o = LLn.rimPlaneOffset(L, player);                // a near miss comes down on the rim, not off its front or back
      if (o && Math.hypot(o.lat, o.dep) <= NEAR_MISS_IN) near++;
    }
  }
  return { rate: made/n, blocks: blocks/n, nearOfMisses: misses ? near/misses : 1, airballs: air, labels };
}

if (typeof module !== "undefined") module.exports = { NOISE, scatterIn, sensitivity, sampleNoise, makeRate, rngN, gaussN };
else window.NoiseLib = { NOISE, scatterIn, sensitivity, sampleNoise, makeRate, rngN, gaussN };
