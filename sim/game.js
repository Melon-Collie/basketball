// The game: one ball handler against an on-ball defender and a rim protector. All of the rules that used to live in
// the prototype's page are here: movement, dribbling, gathers and pivots, the defenders' AI, shots and their release.
// Nothing in this file touches the page. The page feeds it input, steps it, and draws the state it finds.
//
// A game is one plain object made by create(): no functions, so it can be copied, saved or sent. Copies share only
// the paths of balls already in flight, which are never changed once worked out.
// step(game, input) advances it by one tick of TICK seconds. The same seed and the same inputs always produce the
// same game, which is what replays, tests and networked play all rest on.
//
// Every exported function takes the game first. Inside the module, use(game) points the working names below
// (P, D, shot, ...) at that game's parts, so the rules read as they always have. State that gets replaced, not just
// changed, is reached through g (g.ball, g.last, ...).
//
// Units: feet, seconds, and ms where noted.
const GAME_EXPORTS = (() => {
"use strict";
const NODE = typeof module !== "undefined";
const PHX = NODE ? require("./physics.js") : window.PhysicsLib, LNX = NODE ? require("./launch.js") : window.LaunchLib;
const NZX = NODE ? require("./noise.js") : window.NoiseLib, SIT = NODE ? require("./situation.js") : window.SituationLib;
if (NODE) Object.assign(NZX.NOISE, require("./calibration.js"));   // in the page, calibration.js applies itself

// ---------- Model constants (inches, feet, ms) ----------
const C = {
  IDEAL: 520, MAX: 820,          // jumper: perfect release point, auto-release
  KT: 0.09,                      // in of depth bias per ms of post-assist timing error
  TAU: 0.40,                     // s, momentum bleed once a jumper starts
  PSPEED: 15, PACC: 70,
  DSPEED: 13, DACC: 50, CLOSE_SPEED: 15.5, CLOSE_ACC: 60,
  DRIFT_LAT: 1.6, DRIFT_DEP: 1.0,
  CONTEST_SIG: 6.0,
  PERFECT_MS: 12,
  // dribbling
  STEP_T: 0.2, GATHER_SPEED: 6,   // gather steps
  COMMIT_MS: 150,                  // release before this and the shot is a pump fake
  ARM: 2.6, SHOULDER: 0.75,       // hands: reach from each shoulder (will come from wingspan)
  DEF_SPEED: 14, DEF_ACC: 60, STEAL_R: 0.55,                               // a player on defense: top speed, acceleration, and how close a hand must get to the ball
  DRIB_SPEED: 13.5, ACC0: 85, DECEL: 95, REACH_MIN: 0.7, REACH_MAX: 2.4,   // explosive from a stop, sharper to stop than to start
  FADE_SPEED: 5, FADE_COMMIT: 150,   // canned fade: always the same, so its release timing is learnable
  // finishing
  RISE_LAYUP: 320, RISE_DUNK: 380, MAX_HANG: 450,
  // floaters: lenient timed release, high arc
  FL_IDEAL: 330, FL_MAX: 560, FL_KT: 0.07, FL_PERFECT: 20, FL_CONTEST_SIG: 5.0,
  DUNK_FUMBLE: 0.04
};
const HOOP = { x: PHX.PHYS.RIM.x, y: PHX.PHYS.RIM.y };
const TICK = 1/120;                                  // seconds per step
// The rules of a game, for when they are switched on (game.flow.on).
const RULES = {
  SHOT_CLOCK: 14, TARGET: 21,                        // seconds to get a shot off; points that win
  CHECK: { x: 25, y: 31 },                           // where a possession starts: the top of the key, behind the arc
  FT_LINE: 13.75,                                    // the free-throw line, ft from the rim's center
  DEAD_T: 1.5, FT_GAP: 0.9,                          // pause after a whistle, and between free throws, s
  GRACE: 1.0,                                        // the ball can't be taken this soon after a check
  CATCH_R: 1.6, CATCH_Z: 8.0,                        // a loose ball is caught inside this reach and below this height (placeholders until frames)
  REST_T: 1.5,                                       // a ball left lying this long is whistled dead
  COURT: { x0: 0, x1: 50, y0: 0, y1: 47 },
};

// ---------- State ----------
// len: length multiplier on contests. stand: standing reach, ft. Both are placeholders until frames.
function makeDef(x, y) { return { x, y, vx: 0, vy: 0, hand: 0, h: 0, jumpT: -1, jumpAt: null, land: 0, len: 1, stand: 8.2 }; }
function create(opts = {}) {
  const game = {
    tick: 0,                                                 // steps taken
    duo: !!opts.duo,                                         // two players: whoever is not on offense controls the on-ball defender
    defIn: { u: false, d: false, l: false, r: false, x: 25, y: 20 },   // that defender's keys and cursor this tick
    seed: (opts.seed ?? 1) | 0,                              // the game's random stream
    forced: [],                                              // values the next random rolls will take, for tests
    prev: [{ shot: false, gather: false }, { shot: false, gather: false }],   // each side's buttons as of the last tick, to see presses and releases
    params: { rating: 80, fadeR: 70, handle: 80, dQuick: 70, dSteal: 60, tAssist: 15, bonus: 30, aAssist: 40, drift: 1, finish: 80, floater: 75, dunk: 75, stepUp: 50,
              defOn: true, rimOn: true, sag: 4.5, react: 250, length: 1 },
    P: { x: 25, y: 26, vx: 0, vy: 0 },                       // the ball handler
    D: makeDef(25, 20),                                      // on-ball defender
    R: makeDef(25, 9.5),                                     // rim protector
    mouse: { x: 25, y: 5.25 },                               // the cursor, in court coordinates
    keys: { u: false, d: false, l: false, r: false },        // movement keys held
    shot: { state: "idle", kind: "jumper", t: 0, held: false, gatherSpeed: 0, vPerpG: 0, gx: 0, gy: 0, note: "", cooldown: 0 },
    ball: null,                                              // the ball in flight, or null while it is in the handler's hands
    drib: { phase: 0, period: 400, side: 1, from: { x: 0.9, y: 0 }, to: { x: 0.9, y: 0 }, len: 0.9,
            top: 3, hold: 0, crossing: false, lastMove: "" },
    // gathered ball: "none" (dribbling), "steps" (gather steps on the move), "pivot" (dead dribble, feet planted)
    hold: { state: "none", step: 0, t: 0, speed: 0, dir: { x: 0, y: -1 }, from: null, to: null, euro: 0, jumpStop: false,
            landedT: 0, center: null, pivot: null, free: null, freeSide: 0, face: { x: 0, y: -1 }, ext: 0, stripT: 0,
            firstFoot: 1, prints: [], stepDir: { x: 0, y: -1 }, stopping: false, fakeT: 0 },
    seen: [],                                                // what the defender has watched the handler do
    simT: 0,
    stats: { fga: 0, fgm: 0, a3: 0, m3: 0, ar: 0, mr: 0, af: 0, mf: 0, fta: 0, ftm: 0, pts: 0, to: 0 },
    // The rules: two sides take turns on offense. With on false none of this applies and the ball simply comes back
    // to the handler after every shot, which is the shot lab.
    //   phase     "live", "ft" (free throws), "dead" (whistle blown, t seconds until next happens) or "over"
    //   loose     the ball is up for grabs after a miss or a block; lastTouch says which side touched it last
    //   value, fouled   what the shot in the air is worth, and whether the shooter was fouled
    flow: { on: !!opts.rules, phase: "live", t: 0, next: null, why: "", offense: 0, score: [0, 0], clock: RULES.SHOT_CLOCK,
            loose: false, lastTouch: "o", value: 2, fouled: false, ft: 0, winner: null, grace: 0 },
    last: null,                                              // how the last shot was resolved
    lastPhys: null,                                          // last simulated shot, for the side-on replay
    lastSeq: 0, statsSeq: 0,                                 // bumped when last or stats change, so the page knows to redraw them
    fx: [], meterFlash: null,                                // floating text, rings and the meter's after-image
    // for the live readout only, never read by the rules: its own random stream, running make-chance estimates,
    // and bank targets already worked out
    view: { seed: ((opts.seed ?? 1) ^ 0x9E3779B9) | 0, est: {}, zs: null, glass: { cache: {}, n: 0 } },
  };
  Object.assign(game.R, { len: 1.2, stand: 8.9, mode: null, upX: 25, upY: 13, upDist: 8 });
  Object.assign(game.D, { shade: 0, threat: 0 });
  if (game.flow.on) { use(game); checkBall(); }
  return game;
}
let g, P, D, R, mouse, keys, shot, drib, hold, seen, stats, params;
function use(game) {
  g = game; ({ P, D, R, mouse, keys, shot, drib, hold, seen, stats, params } = game);
  D.len = params.length; D.stand = 8.2*(0.94 + 0.06*params.length);
}
const defenders = () => { const a = []; if (params.defOn) a.push(D); if (params.rimOn) a.push(R); return a; };
// Seeded random numbers (mulberry32). The live readout draws from its own stream, so looking at the odds never
// changes what happens next.
function nextRandom(o) { o.seed = o.seed + 0x6D2B79F5 | 0; let t = Math.imul(o.seed ^ o.seed >>> 15, 1 | o.seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }
let viewing = false;
const rnd = () => viewing ? nextRandom(g.view) : g.forced.length ? g.forced.shift() : nextRandom(g);

function gauss(){ const u1 = Math.max(1e-9, rnd()), u2 = rnd(); return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Physics shots (milestone 4) ----------
// Jumpers, floaters and layups are launched and simulated against a real rim and backboard.
// carried momentum split along the shot, each part scaled (aim assist on the sideways part, as before)
function liftBody(f, vx, vy, latK = 1, depK = 1) {
  const bl = vx*f.r.x + vy*f.r.y, ba = vx*f.u.x + vy*f.u.y;
  return { vx: (f.r.x*bl*latK + f.u.x*ba*depK)*params.drift, vy: (f.r.y*bl*latK + f.u.y*ba*depK)*params.drift };
}
function physNoise(inp, sc, z) { NZX.NOISE.BONUS = params.bonus/100; return NZX.sampleNoise(inp, sc, z || [gauss(), gauss()]); }
function physRates(inp, sc, n, zs) {
  let m = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const L = LNX.buildLaunch({ ...inp, noise: physNoise(inp, sc, zs && zs[i]) });
    if (!L) continue;
    const r = PHX.simulateShot(L, { quick: true, hands: inp.hands || [] });
    if (r.made) m++; if (r.blocked) b++;
  }
  return { make: m/n, block: b/n };
}
// A release used to run 80 simulated shots on the spot to report its odds, which made that one tick a thousand times
// dearer than any other. Now it only takes the random draws those shots would have used and keeps them with what
// went into the shot. lastOdds() runs them when the readout asks. The draws are the same ones, so so are the odds.
// hands: the defenders' hands as numbers (handSpecs), since a game holds no functions.
const oddsLater = (inp, sc, hands, n = 80) => ({ inp: { ...inp, hands }, sc, zs: Array.from({ length: n }, () => [gauss(), gauss()]) });
const oddsCache = new Map();                         // outside any game: the odds follow from the draws, so they can be shared
function lastOdds() {
  const L = g.last;
  if (!L) return null;
  if (!L.odds) return { make: L.chance, block: L.block };
  const key = JSON.stringify([L.odds, params.bonus]);
  let r = oddsCache.get(key);
  if (!r) { if (oddsCache.size > 20) oddsCache.clear(); r = physRates({ ...L.odds.inp, hands: L.odds.inp.hands.map(SIT.handPath) }, L.odds.sc, L.odds.zs.length, L.odds.zs); oddsCache.set(key, r); }
  return r;
}
const handSpecs = () => SIT.handSpecs(P, defenders(), shot.state === "shooting" ? shot.t : null);
const handPaths = () => handSpecs().map(SIT.handPath);
function physOut(sr, layup) {
  if (!sr) return { make: false, big: "Miss", sub: layup ? "Blown layup" : "Airball" };
  const r = sr.res;
  if (r.blocked) return { make: false, big: "Blocked", sub: layup ? "Swatted at the rim" : "Hand on the ball" };
  if (r.goaltend) return { make: true, big: "Make", sub: "Goaltending" };
  return { make: r.made, big: r.made ? "Make" : "Miss", sub: layup ? (LAYUP_LABEL[r.label] || r.label) : r.label };
}
// Aiming at the glass: the cursor on the backboard line, away from the rim. Height is chosen for you.
// A shot works its target out exactly. The live readout asks many times a second, so it reuses nearby answers.
function glassAimFor(kind) {
  if (kind !== "jumper" && kind !== "floater") return null;
  const B = PHX.PHYS.BOARD;
  if (Math.abs(mouse.y - B.y) > 0.7 || mouse.x < B.x0 + 0.3 || mouse.x > B.x1 - 0.3 || Math.abs(mouse.x - HOOP.x) < 0.8) return null;
  if (!viewing) return LNX.glassTarget({ x: P.x, y: P.y }, kind, +mouse.x.toFixed(1));
  const key = `${kind}:${(Math.round(P.x*2)/2)}:${(Math.round(P.y*2)/2)}:${mouse.x.toFixed(1)}`, gl = g.view.glass;
  if (!gl.cache[key]) { if (++gl.n > 300) { gl.cache = {}; gl.n = 0; } gl.cache[key] = LNX.glassTarget({ x: P.x, y: P.y }, kind, +mouse.x.toFixed(1)); }
  return gl.cache[key];
}
const liveZ = reuse => (reuse && g.view.zs) ? g.view.zs : (g.view.zs = Array.from({ length: 14 }, () => [gauss(), gauss()]));
// running estimate: a few simulated shots per refresh. Estimates sharing a refresh share their random draws (zs),
// so the gap between them is the effect of aim and momentum, not noise.
function liveRates(key, inp, sc, zs) {
  const p = physRates(inp, sc, 14, zs), e = g.view.est[key];
  g.view.est[key] = e === undefined ? p : { make: e.make + (p.make - e.make)*0.12, block: e.block + (p.block - e.block)*0.12 };
  return g.view.est[key];
}
const liveChance = (key, inp, sc, zs) => liveRates(key, inp, sc, zs).make;
function physShot(inp, sc) {
  const L = LNX.buildLaunch({ ...inp, noise: physNoise(inp, sc) });
  // under the rules a miss stays in play, so follow the ball until it has all but stopped bouncing
  const far = g.flow.on ? { floorBounces: 8, tMax: 8 } : { floorBounces: 2 };
  return L ? { L, res: PHX.simulateShot(L, { ...far, hands: inp.hands || [] }) } : null;
}
// when the result is known: through the net, or the first time the ball drops below the rim after its peak
function decideTime(res) {
  if (res.made) return res.madeAt;
  const p = res.path; let apex = 0;
  for (let i = 1; i < p.length; i++) if (p[i].z > p[apex].z) apex = i;
  for (let i = apex + 1; i < p.length; i++) if (p[i].z < 9.2) return p[i].t;
  return p[p.length - 1].t;
}
// A simulated flight is written once and only read after that, so copies of a game share it instead of copying it.
const fixed = new WeakSet();
const keep = res => { fixed.add(res.path); fixed.add(res.contacts); return res; };
function startPathBall(L, res) {
  const RR = PHX.PHYS.RIM; keep(res);
  g.ball = { phase: "path", t: 0, path: res.path, made: res.made, decideT: decideTime(res), endT: res.path[res.path.length - 1].t,
           announced: false, relZ: L.pos.z, rimDist: Math.hypot(L.pos.x - RR.x, L.pos.y - RR.y) || 1 };
  g.lastPhys = { path: res.path, contacts: res.contacts, from: L.pos, made: res.made };
}
function pathPoint(b) {
  let i = 0;
  while (i < b.path.length - 1 && b.path[i + 1].t <= b.t) i++;
  return b.path[i];
}
// Does the handler have the ball? Not while it is in the air, loose, or dead.
const graceOver = () => !g.flow.on || g.flow.grace <= 0;
const canSteal = () => !g.duo && graceOver();              // the AI's steal rolls; a player on defense has to get a hand on it
const inPlay = () => !g.flow.on || g.flow.phase === "live" || g.flow.phase === "ft";
const ballFree = () => inPlay() && !g.flow.loose && (!g.ball || (g.ball.phase === "path" && g.ball.announced));
const LAYUP_LABEL = { "Swish": "Finished", "Bank": "Kissed off the glass", "In off the rim": "Rolled in", "In and out": "In and out",
  "Front rim": "Short off the front", "Back iron": "Too strong", "Off the side": "Off the side", "Off the glass": "Too strong off the glass", "Airball": "Blown layup" };

// ---------- Geometry ----------
const { frame, isThree } = SIT;
function aimOf(p, f) {
  const ax = mouse.x - p.x, ay = mouse.y - p.y;
  if (Math.hypot(ax, ay) < 0.5) return { theta: 0.5, lat: f.dist*12*Math.tan(0.5) };   // cursor on your own body is not aiming
  const cross = f.u.x*ay - f.u.y*ax, dot = f.u.x*ax + f.u.y*ay;
  const theta = Math.atan2(cross, dot);
  return { theta, lat: f.dist*12*Math.tan(clamp(theta, -0.6, 0.6)) };
}
function driftOf(vx, vy, f) {
  const vPerp = vx*f.r.x + vy*f.r.y, vAlong = vx*f.u.x + vy*f.u.y;
  return { vPerp, vAlong, speed: Math.hypot(vx, vy), lat: C.DRIFT_LAT*params.drift*vPerp, dep: C.DRIFT_DEP*params.drift*vAlong };
}

// ---------- Context: what does a click do right now? ----------
const shotContext = shift => SIT.shotContext(P, hold, shift, params.dunk);

// ---------- Jumpers ----------
function inputDir() {
  let ax = 0, ay = 0;
  if (keys.u) ay -= 1; if (keys.d) ay += 1; if (keys.l) ax -= 1; if (keys.r) ax += 1;
  const l = Math.hypot(ax, ay); return l ? { x: ax/l, y: ay/l } : null;
}
// Fades are read relative to the shot line: any input with a component away from the rim.
// Straight back = fadeaway; back plus a side = side fade at 45 degrees.
function fadeIntent(f) {
  const d = inputDir(); if (!d) return null;
  const along = d.x*f.u.x + d.y*f.u.y, lat = d.x*f.r.x + d.y*f.r.y;
  if (along > -0.3) return null;
  if (Math.abs(lat) < 0.38) return { type: "back", x: -f.u.x, y: -f.u.y, along: 1 };
  const sg = Math.sign(lat), k = Math.SQRT1_2;
  return { type: sg < 0 ? "left" : "right", x: -f.u.x*k + f.r.x*sg*k, y: -f.u.y*k + f.r.y*sg*k, along: k };
}
// The later release offsets the depth part of the fade exactly; the sideways part is left for the cursor.
const fadeShiftFor = along => Math.round(C.DRIFT_DEP*params.drift*C.FADE_SPEED*along/C.KT);
const fadeSigmaFor = type => (0.5 + (95 - params.fadeR)*0.06)*(type === "back" ? 1 : 1.25);
const FADE_NAME = { back: "Fadeaway", left: "Side fade left", right: "Side fade right" };
function commitFade(fi) {
  const along = shot.bvx*fi.x + shot.bvy*fi.y;   // momentum already heading the fade's way folds into it
  let start = 0;
  if (along > 0) { shot.bvx -= along*fi.x; shot.bvy -= along*fi.y; start = Math.min(C.FADE_SPEED, along); }
  Object.assign(shot, { fade: fi.type, fadeV: start, fux: fi.x, fuy: fi.y, fadeAlong: fi.along,
                        shift: fadeShiftFor(fi.along), gatherSpeed: Math.hypot(shot.bvx, shot.bvy) });
}
const jumperContest = () => SIT.jumperContest(P, defenders());
function releaseQ(e) { return clamp(1 - Math.max(0, Math.abs(e) - C.PERFECT_MS)/40, 0, 1); }
// Component sizes for the breakdown bar in the live readout. The scatter a shot is resolved with comes from the noise model.
function jumperParts(distFt, moveSpeed, c, q, fs = 0) {
  const r = (3.15 + (95 - params.rating)*0.052)*(1 - params.bonus/100*q);
  return [r, 0.10*distFt, Math.hypot(0.14*moveSpeed, fs), C.CONTEST_SIG*c];
}
const cleanLook = (fade, moveSpeed) => SIT.cleanLook(P, defenders(), fade, moveSpeed);

// ---------- Finishes ----------
// side: -1 = finish on the left side of the rim, +1 = right, from the cursor.
function finishSideOf(f) {
  const a = aimOf(P, f);
  return clamp(f.dist*Math.tan(clamp(a.theta, -1.2, 1.2))/1.2, -1, 1);
}
function bankOf(x, y) {
  const deg = Math.atan2(Math.abs(x - 25), Math.max(0.1, y - HOOP.y))*180/Math.PI;
  return deg >= 25 && deg <= 65 ? 1.2 : 1.0;
}
const rimContest = side => SIT.rimContest(P, defenders(), side);
function finishSigma(gatherSpeed, vPerpG, side, hangMs, c) {
  const euro = shot.state === "shooting" ? (shot.euro || 0) : hold.state === "steps" ? hold.euro : 0;
  return SIT.finishScatter({ speed: gatherSpeed, vPerp: vPerpG, side, hangMs, euro, contest: c, finishing: params.finish });
}
const blockChanceDunk = c => clamp(c*(0.6 - (params.dunk - 70)/100), 0, 0.9);
const foulChance = con => con.c*(0.12 + 0.25*clamp(con.speed/10, 0, 1));

// ---------- Floaters ----------
const floaterContest = () => SIT.floaterContest(P, defenders());
function floaterQ(e) { return clamp(1 - Math.max(0, Math.abs(e) - C.FL_PERFECT)/40, 0, 1); }
function floaterParts(distFt, moveSpeed, c, q) {                           // for the breakdown bar, like jumperParts
  const r = (3.5 + (95 - params.floater)*0.055)*(1 - params.bonus/100*q);   // touch is the cost
  return [r, 0.10*distFt, 0.08*moveSpeed, C.FL_CONTEST_SIG*c];             // built for moving, so movement costs little
}
function floaterBias(e, f, vx, vy) {
  const eEff = Math.sign(e)*Math.max(0, Math.abs(e) - params.tAssist);
  return { eEff, aim: aimOf(P, f), dr: driftOf(vx, vy, f), assistK: 1 - params.aAssist/100 };
}

function startShot(shift) {
  if (shot.state !== "idle" || shot.cooldown > 0 || !ballFree()) return;
  if (g.ball) g.ball = null;
  const fromSteps = hold.state === "steps" ? hold.euro : 0;
  const cx = shotContext(shift), f = frame(P);
  Object.assign(shot, { state: "shooting", kind: cx.kind, note: cx.note, t: 0, held: true, upAt: null,
    gatherSpeed: Math.hypot(P.vx, P.vy), vPerpG: P.vx*f.r.x + P.vy*f.r.y, gx: P.x, gy: P.y,
    fade: false, fadeV: 0, fux: 0, fuy: 0, fadeAlong: 0, shift: 0, bvx: P.vx, bvy: P.vy, euro: fromSteps });
  shot.fakeable = cx.kind === "jumper" || cx.kind === "floater" || hold.state === "pivot";
  shot.prev = hold.state === "pivot" && hold.pivot ? { pivot: { ...hold.pivot }, free: { ...hold.free }, freeSide: hold.freeSide,
                                                     center: { ...hold.center }, face: { ...hold.face } } : null;
  hold.state = "none";   // going up ends the gather
  if (cx.kind === "jumper") { const fi = fadeIntent(f); if (fi) commitFade(fi); }
  D.jumpAt = null; R.jumpAt = null;
  if (cx.kind === "layup" || cx.kind === "dunk") {
    // shot blockers pick a moment to leave their feet; the shooter can hang to wait them out
    for (const d of defenders()) { if (g.duo && d === D) continue; d.jumpAt = rnd() < 0.25 ? null : params.react*0.5 + 40 + rnd()*180; }
  }
}

// ---------- Release ----------
function releaseJumper() {
  const fade = shot.fade, ideal = C.IDEAL + shot.shift;
  const e = shot.t - ideal;
  const eEff = Math.sign(e)*Math.max(0, Math.abs(e) - params.tAssist);
  const f = frame(P);
  // drift comes from the momentum you carried in; the fade itself is canned and paid for by the later release
  const aim = aimOf(P, f), dr = driftOf(shot.bvx, shot.bvy, f), con = jumperContest();
  const q = releaseQ(e);
  const clean = cleanLook(fade, shot.gatherSpeed);
  const fadeBack = fade ? (P.x - shot.gx)*shot.fux + (P.y - shot.gy)*shot.fuy : 0;
  const fadeLat = fade ? C.DRIFT_LAT*params.drift*shot.fadeV*(shot.fux*f.r.x + shot.fuy*f.r.y) : 0;
  const assistK = 1 - params.aAssist/100;
  // physics: the same inputs, as a launch. Clean-look shaping and calibration live in the noise model.
  const fadeAng = fade ? Math.atan(fadeLat/12/f.dist) : 0;
  const glass = glassAimFor("jumper");
  const hs = handSpecs();
  const inp = { kind: "jumper", player: { x: P.x, y: P.y }, aimTheta: glass ? 0 : (clamp(aim.theta, -0.6, 0.6) + fadeAng)*assistK, timingMs: eEff,
                body: liftBody(f, shot.bvx, shot.bvy, assistK, 1), contest: con.c, hands: hs.map(SIT.handPath), target: glass ? glass.target : undefined };
  const sc = { kind: "jumper", dist: f.dist, q, move: shot.gatherSpeed, contest: con.c, clean, fadeIn: fade ? fadeSigmaFor(fade) : 0 };
  const odds = oddsLater(inp, sc, hs);                 // blocks are real collisions now, so they're in here
  const sig = NZX.scatterIn(sc);
  const shotRes = physShot(inp, sc), out = physOut(shotRes);
  const three = isThree({ x: shot.gx, y: shot.gy });   // zone is where you took off, not where you landed
  if (g.flow.on && g.flow.phase === "ft") recordFreeThrow(out.make); else record(out.make, three ? 3 : 2, three, false);
  g.flow.value = three ? 3 : 2; g.flow.fouled = false;
  g.last = { kind: "jumper", out, e, eEff, q, aim, dr, con, sig, odds, three, dist: f.dist, assistK, fade, fadeBack, fadeLat, shift: shot.shift };
  g.meterFlash = { e, t: 0.8, kind: fade ? "fade" : "jumper", shift: shot.shift };
  if (shotRes) startPathBall(shotRes.L, shotRes.res); else launchBall(f, true, false, 0.4, 3);
  shot.state = "flight";
  g.lastSeq++; g.statsSeq++;
}

function releaseFinish() {
  const f = frame(P), dunk = shot.kind === "dunk";
  const rise = dunk ? C.RISE_DUNK : C.RISE_LAYUP;
  const hangMs = dunk ? 0 : Math.max(0, (shot.upAt !== null ? Math.min(shot.upAt, shot.t) : shot.t) - rise);
  const side = finishSideOf(f);
  const con = rimContest(side);
  const bank = bankOf(shot.gx, shot.gy);
  const foul = rnd() < foulChance(con);
  let out, chance, block, odds, sig = null, layupShot = null;
  if (dunk) {
    block = blockChanceDunk(con.c);
    chance = (1 - block)*(1 - C.DUNK_FUMBLE);
    if (rnd() < block) out = { make: false, big: "Blocked", sub: "Met at the rim" };
    else if (rnd() < C.DUNK_FUMBLE) out = { make: false, big: "Miss", sub: "Rattled out" };
    else out = { make: true, big: "Dunk", sub: con.c > 0.5 ? "Posterized" : "Throwdown" };
  } else {
    sig = finishSigma(shot.gatherSpeed, shot.vPerpG, side, hangMs, con.c);
    // physics: finish-side, speed and hang costs come through as extra scatter; contact costs a little more
    const hs = handSpecs(), inp = { kind: "layup", player: { x: P.x, y: P.y }, contest: con.c, hands: hs.map(SIT.handPath) };
    const sc = { kind: "layup", dist: f.dist, extra: Math.hypot(sig.parts[1], sig.parts[2])*(foul ? 1.15 : 1), contest: con.c };
    odds = oddsLater(inp, sc, hs);
    layupShot = physShot(inp, sc);
    out = physOut(layupShot, true);
  }
  const blocked = out.big === "Blocked";
  if (foul && !blocked) out.sub = out.make ? "And one" : "Fouled, two free throws";
  record(out.make, 2, false, true);
  g.flow.value = 2; g.flow.fouled = foul && !blocked;
  g.last = { kind: shot.kind, out, side, con, hangMs, sig, block, foulP: foulChance(con), chance, odds, bank,
           speed: shot.gatherSpeed, note: shot.note, dist: f.dist };
  g.lastSeq++; g.statsSeq++;
  if (blocked && !layupShot) g.fx.push({ kind: "text", text: "Blocked", t: 0 });
  if (g.flow.on && dunk && !out.make) {
    // under the rules a dunk that doesn't go down is a live ball off the rim, or free throws if it was a foul
    shot.state = "idle"; shot.cooldown = 0.35; R.mode = null;
    if (!blocked) g.fx.push({ kind: "text", text: out.sub, t: 0 });
    if (g.flow.fouled) shotDecided(false, false); else looseOffRim(f, blocked);
    return;
  }
  if (layupShot) startPathBall(layupShot.L, layupShot.res); else launchBall(f, blocked, out.make, dunk ? 0.18 : 0.38, dunk ? 1 : 3);
  shot.state = "flight";
}

function releaseFloater() {
  const e = shot.t - C.FL_IDEAL, f = frame(P);
  const con = floaterContest(), q = floaterQ(e);
  const b = floaterBias(e, f, P.vx, P.vy);
  const glass = glassAimFor("floater"), hs = handSpecs();
  const inp = { kind: "floater", player: { x: P.x, y: P.y }, aimTheta: glass ? 0 : clamp(b.aim.theta, -0.6, 0.6)*b.assistK, timingMs: b.eEff,
                body: liftBody(f, P.vx, P.vy, 0.6*b.assistK, 0.5), contest: con.c, hands: hs.map(SIT.handPath), target: glass ? glass.target : undefined };
  const sc = { kind: "floater", dist: f.dist, q, move: shot.gatherSpeed, contest: con.c };
  const odds = oddsLater(inp, sc, hs);
  const sig = NZX.scatterIn(sc);
  const shotRes = physShot(inp, sc), out = physOut(shotRes);
  if (out.sub === "Swish") out.sub = "Dropped in soft";
  record(out.make, 2, false, false, true);
  g.flow.value = 2; g.flow.fouled = false;
  g.last = { kind: "floater", out, e, q, b, con, sig, odds, dist: f.dist, rimMode: params.rimOn ? R.mode : "off" };
  g.meterFlash = { e, t: 0.8, kind: "floater" };
  if (shotRes) startPathBall(shotRes.L, shotRes.res); else launchBall(f, true, false, 0.4, 3);
  shot.state = "flight";
  g.lastSeq++; g.statsSeq++;
}

function recordFreeThrow(make) { stats.fta++; if (make) { stats.ftm++; stats.pts++; } }
function record(make, value, three, rim, floater = false) {
  stats.fga++; if (three) stats.a3++; if (rim) stats.ar++; if (floater) stats.af++;
  if (make) { stats.fgm++; stats.pts += value; if (three) stats.m3++; if (rim) stats.mr++; if (floater) stats.mf++; }
}
// Canned ball flight to the rim, for shots that aren't simulated: dunks, and a launch that can't reach its target.
function launchBall(f, blocked, make, dur, hmax) {
  const sx = P.x, sy = P.y;
  if (blocked) {
    const sd = rnd() < 0.5 ? -1 : 1;
    g.ball = { phase: "flight", t: 0, dur: 0.4, sx, sy, tx: sx + f.r.x*sd*7 + f.u.x*1.5, ty: sy + f.r.y*sd*7 + f.u.y*1.5, hmax: 3, make: false, blocked: true };
  } else {
    g.ball = { phase: "flight", t: 0, dur, sx, sy, hmax, make, tx: HOOP.x, ty: HOOP.y, u: f.u };
  }
}

// ---------- Simulation ----------
// ---------- Dribbling: the cursor is the ball hand ----------
// Nothing is triggered. The ball follows the cursor, the body follows WASD, and the defender reacts to
// what they saw one reaction time ago. "Crossover" and "hesi" are names for what that produces.
function defHand() {
  if (g.duo && D.hx !== undefined) return { x: D.hx, y: D.hy };       // a player's hand is where their cursor puts it
  const tx = P.x - D.x, ty = P.y - D.y, tl = Math.hypot(tx, ty) || 1, reach = 0.85 + 0.75*D.hand;
  return { x: D.x + tx/tl*reach, y: D.y + ty/tl*reach };
}
const stealFactor = () => clamp(1 + (params.dSteal - params.handle)/60, 0.3, 2);
const tightness = () => drib.hold;   // 1 = ball pulled in tight; follows the cursor continuously
// What a defender reads as a pull-up: a shooter in range, slowing down, ball held up and tight.
function pullUpThreat() {
  const f = frame(P), sp = Math.hypot(P.vx, P.vy);
  const respect = clamp((params.rating - 50)/40, 0, 1);
  const range = f.dist <= 27 ? 1 : clamp(1 - (f.dist - 27)/5, 0, 1);
  const slow = 1 - clamp(sp/C.DRIB_SPEED, 0, 1);
  return respect*range*slow*(0.35 + 0.65*tightness());
}
function updateDribble(dt) {
  const cd = Math.hypot(mouse.x - P.x, mouse.y - P.y);
  drib.hold += ((1 - clamp((cd - 2)/8, 0, 1)) - drib.hold)*Math.min(1, dt/0.1);   // the hand reacts now, not at the next bounce
  const sf = clamp(Math.hypot(P.vx, P.vy)/C.DRIB_SPEED, 0, 1), tight = tightness();
  drib.period = 430 - 110*sf + 190*tight*(1 - sf);     // slow and tight: the ball hangs at the top
  drib.top = 3 + 1.2*tight*(1 - sf);
  drib.phase += dt*1000/drib.period;
  if (drib.phase >= 1) { drib.phase -= 1; newBounce(); }
}
function newBounce() {
  const f = frame(P);
  const cdx = mouse.x - P.x, cdy = mouse.y - P.y, cd = Math.hypot(cdx, cdy);
  const latC = cdx*f.r.x + cdy*f.r.y, oldSide = drib.side;
  if (Math.abs(latC) > 0.6) drib.side = Math.sign(latC);                        // deadzone: jitter can't cross you
  // toward the cursor, but never straight ahead into the defender: at least 30 degrees to the ball side
  let ang = cd > 0.3 ? Math.atan2(latC, cdx*f.u.x + cdy*f.u.y) : drib.side*Math.PI/2;
  ang = drib.side > 0 ? clamp(ang, Math.PI/6, Math.PI - 0.2) : clamp(ang, -(Math.PI - 0.2), -Math.PI/6);
  const len = C.REACH_MIN + (C.REACH_MAX - C.REACH_MIN)*clamp((cd - 2)/8, 0, 1);
  const fw = Math.cos(ang)*len, lt = Math.sin(ang)*len;
  drib.from = drib.to;
  drib.to = { x: f.u.x*fw + f.r.x*lt, y: f.u.y*fw + f.r.y*lt };
  { const o = shoulder(f, drib.side), t = reachFrom(o, P.x + drib.to.x, P.y + drib.to.y, C.ARM); drib.to = { x: t.x - P.x, y: t.y - P.y }; }
  drib.len = len;
  drib.crossing = drib.side !== oldSide;
  if (drib.crossing) onCross(f);
  else if (params.defOn && canSteal()) {
    const h = defHand(), dm = Math.hypot(h.x - (P.x + drib.to.x), h.y - (P.y + drib.to.y));
    const bx = P.x + drib.to.x, by = P.y + drib.to.y;
    if (dm < 1.6 && rnd() < 0.06*(1.6 - dm)/1.6*(len/1.5)*stealFactor()*armBarFactor(bx, by)) turnover("Reached in and picked an exposed dribble");
  }
}
// ---------- Hands ----------
// Two hands, each reaching from its own shoulder. The ball hand carries the dribble; on a crossover the ball
// travels between them; the free hand guards the ball against the defender's reach (an arm bar).
const shoulder = (f, s) => ({ x: P.x + f.r.x*C.SHOULDER*s, y: P.y + f.r.y*C.SHOULDER*s });
function reachFrom(o, tx, ty, maxR) {
  let dx = tx - o.x, dy = ty - o.y; const d = Math.hypot(dx, dy);
  if (d > maxR) { dx *= maxR/d; dy *= maxR/d; }
  return { x: o.x + dx, y: o.y + dy };
}
function handPositions() {
  const f = frame(P), s = drib.side;
  if (hold.state !== "none") {                                    // held ball: both hands on it
    const b = heldBallPos();
    return { L: reachFrom(shoulder(f, -1), b.x - f.r.x*0.3, b.y - f.r.y*0.3, C.ARM), R: reachFrom(shoulder(f, 1), b.x + f.r.x*0.3, b.y + f.r.y*0.3, C.ARM), guard: false };
  }
  const b = dribbleBallPos();
  let ballHand, offHand, guard = false;
  if (drib.crossing && drib.phase < 0.5) {
    // mid-crossover: the receiving hand reaches for the landing spot, the other follows through; nobody guards
    ballHand = reachFrom(shoulder(f, s), P.x + drib.to.x, P.y + drib.to.y, C.ARM);
    offHand = reachFrom(shoulder(f, -s), b.x, b.y, C.ARM);
  } else {
    ballHand = reachFrom(shoulder(f, s), b.x, b.y, C.ARM);
    const o = shoulder(f, -s);
    if (params.defOn && Math.hypot(D.x - P.x, D.y - P.y) < 6) {   // off arm up between the defender's reach and the ball
      const h = defHand(), mx = (h.x + b.x)/2, my = (h.y + b.y)/2;
      offHand = reachFrom(o, mx, my, 1.4); guard = true;
    } else offHand = { x: o.x + f.u.x*0.6, y: o.y + f.u.y*0.6 };
  }
  return s > 0 ? { R: ballHand, L: offHand, guard } : { L: ballHand, R: offHand, guard };
}
// Does the off arm sit between the defender's hand and the ball? Then a reach mostly hits arm.
function armBarFactor(bx, by) {
  if (hold.state !== "none" || (drib.crossing && drib.phase < 0.5)) return 1;
  const hp = handPositions(); if (!hp.guard) return 1;
  const off = drib.side > 0 ? hp.L : hp.R, h = defHand();
  const sx = bx - h.x, sy = by - h.y, sl = sx*sx + sy*sy || 1;
  const t = clamp(((off.x - h.x)*sx + (off.y - h.y)*sy)/sl, 0, 1);
  const d = Math.hypot(h.x + sx*t - off.x, h.y + sy*t - off.y);
  return d < 0.6 ? 0.4 : 1;
}
function onCross(f) {
  drib.lastMove = "Crossover";
  if (!params.defOn || !canSteal()) return;
  const dd = Math.hypot(D.x - P.x, D.y - P.y);
  if (dd > 8) return;
  // the ball crosses in front of the body: the moment a close defender can poke it
  const mx = P.x + f.u.x*0.9, my = P.y + f.u.y*0.9, h = defHand(), dm = Math.hypot(h.x - mx, h.y - my);
  const cos = ((D.x - P.x)*f.u.x + (D.y - P.y)*f.u.y)/(dd || 1);
  const exposure = (Math.hypot(drib.from.x, drib.from.y) + drib.len)/3;
  const pSteal = dm < 2.4 && cos > 0.3 ? clamp((2.4 - dm)/2.4*0.22*stealFactor()*exposure, 0, 0.35) : 0;
  if (pSteal > 0.005) drib.lastMove = `Crossover in front of a close defender: ${Math.round(pSteal*100)}% steal risk`;
  if (rnd() < pSteal) turnover("Poked on the crossover");
}
function turnover(text) {
  stats.to++;
  const dx = P.x - D.x, dy = P.y - D.y, dl = Math.hypot(dx, dy) || 1;
  g.ball = { phase: "bounce", t: 0, bx: P.x + drib.to.x, by: P.y + drib.to.y,
           vx: -dx/dl*9 + (rnd() - 0.5)*6, vy: -dy/dl*9 + (rnd() - 0.5)*6 };
  g.fx.push({ kind: "text", text: "Stolen", t: 0, x: P.x, y: P.y });
  drib.lastMove = text; shot.cooldown = 1.0; hold.state = "none";
  g.statsSeq++;
  if (g.flow.on) whistle("Stolen", "change");
}
function dribbleBallPos() {
  const ph = drib.phase, top = drib.top, f = frame(P);
  const mix = (a, b, t) => ({ x: a.x + (b.x - a.x)*t, y: a.y + (b.y - a.y)*t });
  let o, h;
  if (ph < 0.5) {
    const t = ph/0.5;
    o = mix({ x: drib.from.x*0.75, y: drib.from.y*0.75 }, drib.to, t);
    if (drib.crossing) { const b = Math.sin(Math.PI*t)*0.5; o.x += f.u.x*b; o.y += f.u.y*b; }   // crosses in front of the body
    h = top*(1 - t);
  } else {
    const t = (ph - 0.5)/0.5;
    o = mix(drib.to, { x: drib.to.x*0.75, y: drib.to.y*0.75 }, t); h = top*t;
  }
  return { x: P.x + o.x, y: P.y + o.y, h };
}
// ---------- Gather: a state change, not a move ----------
function gather() {
  if (shot.state !== "idle" || !ballFree() || hold.state !== "none" || shot.cooldown > 0) return;
  const sp = Math.hypot(P.vx, P.vy);
  if (sp < C.GATHER_SPEED) { enterPivot(); drib.lastMove = "Gathered: dead dribble"; return; }
  // the ball-side foot steps first, then the other
  Object.assign(hold, { state: "steps", step: 0, t: 0, speed: sp, dir: { x: P.vx/sp, y: P.vy/sp }, euro: 0, jumpStop: false,
                        landedT: 0, firstFoot: drib.side, prints: [] });
  drib.lastMove = "Gathered on the move";
  beginStep();
}
function beginStep() { hold.step++; hold.t = 0; hold.from = { x: P.x, y: P.y }; aimStep(); }
// The landing spot follows WASD for the whole step: you steer the foot until it plants.
function aimStep() {
  const d = inputDir();
  hold.stopping = hold.step === 2 && !d;                               // nothing held on the second step: two-foot stop
  const dir = d || hold.dir;
  const len = hold.stopping ? 0.8 : clamp(hold.speed*0.2, 1.2, 3.0);
  hold.stepDir = dir;
  hold.to = { x: hold.from.x + dir.x*len, y: hold.from.y + dir.y*len };
}
const stepFoot = k => (k === 1 ? 1 : -1)*hold.firstFoot;              // +1 right foot, -1 left foot
const footSpot = (at, dir, foot) => ({ x: at.x - dir.y*0.6*foot, y: at.y + dir.x*0.6*foot });   // feet sit either side of the line of travel
function stepMove(dt) {
  if (hold.t < C.STEP_T) {
    hold.t += dt;
    aimStep();
    const rem = Math.max(0.02, C.STEP_T - hold.t);
    P.vx = (hold.to.x - P.x)/rem; P.vy = (hold.to.y - P.y)/rem;
    if (hold.step === 2) {                                             // sideways off the first step's line, so far = euro
      hold.euro = Math.abs((P.x - hold.from.x)*(-hold.dir.y) + (P.y - hold.from.y)*hold.dir.x);
    }
    if (hold.t >= C.STEP_T) plantStep();
    return;
  }
  hold.landedT += dt;                                                  // planted on the second step: go up now or stop
  P.vx *= Math.exp(-dt/0.08); P.vy *= Math.exp(-dt/0.08);
  if (hold.landedT > 0.3) { enterPivot(); drib.lastMove = "Stopped on the second step: dead dribble"; }
}
function plantStep() {
  if (hold.step === 2 && hold.stopping) {
    hold.prints.push(footSpot(hold.to, hold.dir, stepFoot(2)));
    enterPivot(); drib.lastMove = "Jump stop: dead dribble"; return;
  }
  hold.prints.push(footSpot(hold.to, hold.stepDir, stepFoot(hold.step)));
  if (hold.step === 1) {
    const dx = hold.to.x - hold.from.x, dy = hold.to.y - hold.from.y, dl = Math.hypot(dx, dy) || 1;
    hold.dir = { x: dx/dl, y: dy/dl };                                 // the first step is the reference line
    beginStep();
  } else if (hold.euro > 0.8) drib.lastMove = `Euro step: ${hold.euro.toFixed(1)} ft sideways`;
}
function pumpFake() {
  const prev = shot.prev;
  shot.state = "idle"; shot.cooldown = 0.15; g.meterFlash = null;
  enterPivot();                                                        // rising into a shot picks up the dribble
  if (prev) Object.assign(hold, prev);
  hold.fakeT = 0.3;
  drib.lastMove = "Pump fake";
  g.fx.push({ kind: "text", text: "Pump fake", t: 0, x: P.x, y: P.y });
}
function enterPivot() {
  P.vx = 0; P.vy = 0;
  Object.assign(hold, { state: "pivot", center: { x: P.x, y: P.y }, pivot: null, free: null, freeSide: 0, ext: 0, stripT: 0 });
}
function pivotMove(dt) {
  P.vx = 0; P.vy = 0;
  const f = frame(P);
  const cdx = mouse.x - P.x, cdy = mouse.y - P.y, cd = Math.hypot(cdx, cdy);
  if (cd > 0.5) hold.face = { x: cdx/cd, y: cdy/cd };                // the body turns to follow the ball
  const face = hold.face, perp = { x: -face.y, y: face.x };          // perp = the body's right
  const d = inputDir();
  if (!hold.pivot) {
    if (!d) return;
    // the first foot to move is the free foot: the one on the ball's side
    hold.freeSide = (cdx*f.r.x + cdy*f.r.y) >= 0 ? 1 : -1;
    hold.pivot = { x: hold.center.x - perp.x*0.7*hold.freeSide, y: hold.center.y - perp.y*0.7*hold.freeSide };
    hold.free = { x: hold.center.x + perp.x*0.7*hold.freeSide, y: hold.center.y + perp.y*0.7*hold.freeSide };
    drib.lastMove = `Pivot set: ${hold.freeSide > 0 ? "left" : "right"} foot`;
  }
  // free foot reaches in the WASD direction, otherwise returns to stance beside the pivot (which turns with the body)
  const base = { x: hold.pivot.x + perp.x*1.4*hold.freeSide, y: hold.pivot.y + perp.y*1.4*hold.freeSide };
  const tgt = d ? { x: hold.pivot.x + d.x*2.6, y: hold.pivot.y + d.y*2.6 } : base;
  const mx = tgt.x - hold.free.x, my = tgt.y - hold.free.y, ml = Math.hypot(mx, my), stepL = 14*dt;
  if (ml <= stepL) { hold.free.x = tgt.x; hold.free.y = tgt.y; } else { hold.free.x += mx/ml*stepL; hold.free.y += my/ml*stepL; }
  hold.ext = Math.hypot(hold.free.x - base.x, hold.free.y - base.y);
  P.x = (hold.pivot.x + hold.free.x)/2; P.y = (hold.pivot.y + hold.free.y)/2;
  // a held ball can be stripped if it's left where the defender's hand can reach
  hold.stripT += dt;
  if (hold.stripT > 0.25 && params.defOn && canSteal()) {
    hold.stripT = 0;
    const h = defHand(), b = heldBallPos(), dm = Math.hypot(h.x - b.x, h.y - b.y);
    if (dm < 1.2 && rnd() < 0.12*(1.2 - dm)/1.2*stealFactor()) turnover("Stripped on a dead dribble");
  }
}
function heldBallPos() {
  if (hold.state === "steps") return { x: P.x + hold.dir.x*0.6, y: P.y + hold.dir.y*0.6, h: 3.5 };
  return { x: P.x + hold.face.x*0.9, y: P.y + hold.face.y*0.9, h: 3.2 + 6*Math.max(0, hold.fakeT) };
}

// The defender's eyes: a short history of what the ball handler was doing.
function recordSeen() {
  seen.push({ t: g.simT, x: P.x, y: P.y, vx: P.vx, vy: P.vy, side: drib.side, dead: hold.state !== "none",
              rising: shot.state === "shooting" || hold.fakeT > 0,
              threat: shot.state === "idle" && ballFree() ? pullUpThreat() : 0 });
  while (seen.length > 2 && seen[1].t < g.simT - 0.7) seen.shift();
}
function perceived(lag) {
  for (let i = seen.length - 1; i >= 0; i--) if (seen[i].t <= g.simT - lag) return seen[i];
  return seen[0];
}
// reaction lag: quicker defenders read sooner, better handlers are harder to read
const defLag = () => clamp(0.32 - (params.dQuick - 40)*0.0025 + (params.handle - 70)*0.0015, 0.12, 0.4);

function stepToward(def, tx, ty, maxS, acc, dt) {
  const dx = tx - def.x, dy = ty - def.y, dd = Math.hypot(dx, dy);
  const want = Math.min(maxS, dd*4);
  const wx = dd ? dx/dd*want : 0, wy = dd ? dy/dd*want : 0;
  const ex = wx - def.vx, ey = wy - def.vy, el = Math.hypot(ex, ey), st = acc*dt;
  if (el <= st || el < 1e-9) { def.vx = wx; def.vy = wy; } else { def.vx += ex/el*st; def.vy += ey/el*st; }
}
function moveDef(def, dt, sep = 1.7) {
  if (def.jumpT >= 0) { def.vx *= Math.exp(-dt*3); def.vy *= Math.exp(-dt*3); }
  def.x += def.vx*dt; def.y += def.vy*dt;
  const sx = def.x - P.x, sy = def.y - P.y, sd = Math.hypot(sx, sy);
  if (sd < sep) {
    const nx = sx/(sd || 1), ny = sy/(sd || 1), over = sep - sd;
    if (shot.state === "idle" && ballFree()) {
      // a defender holds their ground: you can't run through them, only around them
      def.x += nx*over*0.35; def.y += ny*over*0.35;
      P.x -= nx*over*0.65; P.y -= ny*over*0.65;
      const into = P.vx*nx + P.vy*ny; if (into > 0) { P.vx -= into*nx; P.vy -= into*ny; }
    } else if (g.flow.loose) {
      def.x += nx*over*0.5; def.y += ny*over*0.5; P.x -= nx*over*0.5; P.y -= ny*over*0.5;
    } else { def.x += nx*over; def.y += ny*over; }
  }
  def.x = clamp(def.x, 0.6, 49.4); def.y = clamp(def.y, 4.8, 40);
}
function finishMove(dt) {
  const f = frame(P);
  if (f.dist <= 2.6) { P.vx = 0; P.vy = 0; return; }
  const cur = Math.hypot(P.vx, P.vy), sp = Math.max(4, cur)*Math.exp(-dt/1.2);
  const want = Math.atan2(f.u.y, f.u.x);
  let heading = cur < 0.1 ? want : Math.atan2(P.vy, P.vx);
  let da = want - heading; while (da > Math.PI) da -= 2*Math.PI; while (da < -Math.PI) da += 2*Math.PI;
  heading += clamp(da, -4*dt, 4*dt);
  P.vx = Math.cos(heading)*sp; P.vy = Math.sin(heading)*sp;
}
function update(dt) {
  const fl = g.flow, loose = fl.loose;
  if (fl.on && (fl.phase === "dead" || fl.phase === "over")) { deadTick(dt); return; }
  const still = fl.on && fl.phase === "ft";                           // free throws: the defenders stand and watch
  g.simT += dt; recordSeen();
  if (hold.fakeT > 0) hold.fakeT -= dt;
  let ax = 0, ay = 0;
  if (keys.u) ay -= 1; if (keys.d) ay += 1; if (keys.l) ax -= 1; if (keys.r) ax += 1;
  const al = Math.hypot(ax, ay); if (al) { ax /= al; ay /= al; }

  if (shot.state === "shooting" && shot.kind === "jumper") {
    if (!shot.fade && shot.t <= C.FADE_COMMIT) { const fi = fadeIntent(frame(P)); if (fi) commitFade(fi); }
    const k = Math.exp(-dt/C.TAU);
    shot.bvx *= k; shot.bvy *= k;                                  // carried momentum bleeds off; no steering mid-shot
    if (shot.fade) shot.fadeV += (C.FADE_SPEED - shot.fadeV)*(1 - Math.exp(-dt/0.15));
    P.vx = shot.bvx + shot.fux*shot.fadeV; P.vy = shot.bvy + shot.fuy*shot.fadeV;
    shot.t += dt*1000;
    if (shot.t >= C.MAX + shot.shift) releaseJumper();
  } else if (shot.state === "shooting" && shot.kind === "floater") {
    const k = Math.exp(-dt/0.12);                   // one-step stop: a little carry, no steering
    P.vx *= k; P.vy *= k;
    shot.t += dt*1000;
    if (shot.t >= C.FL_MAX) releaseFloater();
  } else if (shot.state === "shooting") {
    finishMove(dt);
    shot.t += dt*1000;
    const dunk = shot.kind === "dunk", rise = dunk ? C.RISE_DUNK : C.RISE_LAYUP;
    if (shot.t >= rise && (dunk || !shot.held || shot.t >= rise + C.MAX_HANG)) releaseFinish();
  } else if (hold.state === "steps") { stepMove(dt);
  } else if (hold.state === "pivot") { pivotMove(dt);
  } else {
    if (ballFree()) updateDribble(dt);
    const sp0 = Math.hypot(P.vx, P.vy), top = loose ? C.PSPEED : C.DRIB_SPEED;   // faster without the ball, chasing it down
    const tx = ax*top, ty = ay*top, dx = tx - P.vx, dy = ty - P.vy, dl = Math.hypot(dx, dy);
    // explosive from a stop, tapering near top speed; stopping and cutting are sharper than starting
    const speedingUp = (ax || ay) && top > sp0 + 0.01;
    const step = (speedingUp ? C.ACC0*(1 - 0.6*clamp(sp0/top, 0, 1)) : C.DECEL)*dt;
    if (dl <= step || dl < 1e-9) { P.vx = tx; P.vy = ty; } else { P.vx += dx/dl*step; P.vy += dy/dl*step; }
  }
  const cap = C.PSPEED;
  const sp = Math.hypot(P.vx, P.vy); if (sp > cap) { P.vx *= cap/sp; P.vy *= cap/sp; }
  P.x = clamp(P.x + P.vx*dt, 0.6, 49.4); P.y = clamp(P.y + P.vy*dt, 4.8, 38.5);
  { const hx = P.x - HOOP.x, hy = P.y - HOOP.y, hd = Math.hypot(hx, hy);
    if (hd < 2.6) { P.x = HOOP.x + hx/(hd || 1)*2.6; P.y = HOOP.y + (hd ? hy/hd : 1)*2.6; } }

  // defenders: jumps on finishes
  const shooting = shot.state === "shooting", jumper = shot.kind === "jumper";
  const sawShot = !!(perceived(params.react/1000) || {}).rising;      // they react to the shooting motion they saw
  const reacted = sawShot || shot.state === "flight";
  for (const d of defenders()) {                                       // close defenders may leave their feet, so a fake can get them in the air
    if (sawShot && !d.sawPrev && d.jumpT < 0 && d.land <= 0 && !still && !(g.duo && d === D)) {
      const dist = Math.hypot(d.x - P.x, d.y - P.y);
      if (dist < (d === R ? 7 : 5) && rnd() < (d === R ? 0.6 : 0.5)) d.jumpT = 0;
    }
    d.sawPrev = sawShot;
  }
  for (const d of defenders()) {
    if (shooting && !jumper && d.jumpAt !== null && shot.t >= d.jumpAt) {
      d.jumpAt = null;
      if (Math.hypot(d.x - P.x, d.y - P.y) < 7 && d.land <= 0 && d.jumpT < 0) d.jumpT = 0;
    }
    if (d.jumpT >= 0) {
      d.jumpT += dt;
      if (d.jumpT >= 0.5) { d.jumpT = -1; d.h = 0; d.land = 0.45; } else d.h = Math.sin(Math.PI*d.jumpT/0.5);
    }
    if (d.land > 0) d.land -= dt;
  }
  if (params.defOn && !still && g.duo) playerDefender(dt);
  else if (params.defOn && !still) {
    const f = frame(P);
    let tx, ty, maxS, acc;
    if (loose) { const c = looseTarget(); tx = c.x; ty = c.y; maxS = C.CLOSE_SPEED; acc = C.CLOSE_ACC; }   // go and get it
    else if (reacted) { tx = P.x + f.u.x*1.8; ty = P.y + f.u.y*1.8; maxS = C.CLOSE_SPEED; acc = C.CLOSE_ACC; }
    else {
      // act on what they saw `lag` ago, extrapolated forward: a sudden change leaves them guessing wrong
      const lag = defLag(), s0 = perceived(lag) || { x: P.x, y: P.y, vx: 0, vy: 0, side: drib.side, threat: 0 };
      const ex = s0.x + s0.vx*lag*0.8, ey = s0.y + s0.vy*lag*0.8, pf = frame({ x: ex, y: ey });
      const drive = Math.max(0, s0.vx*pf.u.x + s0.vy*pf.u.y);                         // coming at them: give ground
      const cushion = s0.dead ? Math.min(2.0, pf.dist*0.6)                              // dead dribble: no drive threat, crowd them
                              : Math.min(clamp(params.sag - (params.sag - 1.9)*s0.threat + drive*0.12, 1.9, params.sag + 2), pf.dist*0.6);
      const shadeT = shot.state === "idle" && ballFree() ? s0.side*0.8 : 0;                // shade toward the ball side they saw
      D.shade += (shadeT - D.shade)*Math.min(1, dt*8);
      D.threat = s0.dead ? 0.8 : s0.threat;
      tx = ex + pf.u.x*cushion + pf.r.x*D.shade; ty = ey + pf.u.y*cushion + pf.r.y*D.shade;
      maxS = C.DSPEED + (params.dQuick - 70)*0.04; acc = C.DACC + (params.dQuick - 70)*0.4;
    }
    if (D.jumpT < 0) stepToward(D, tx, ty, maxS, acc, dt);
    moveDef(D, dt);
    D.hand = clamp(D.hand + clamp((loose ? 0 : reacted ? 1 : D.threat*0.8) - D.hand, -dt/0.15, dt/0.15), 0, 1);
  }
  if (params.rimOn && !still) {
    const hx = P.x - HOOP.x, hy = P.y - HOOP.y, dP = Math.hypot(hx, hy) || 0.001, nx = hx/dP, ny = hy/dP;
    const isFin = k => k === "layup" || k === "dunk";
    const finishing = (shooting && isFin(shot.kind)) || (shot.state === "flight" && g.last && isFin(g.last.kind));
    // once per drive the big decides: stay home (concede the floater) or step up (concede the lane)
    const drivingIn = -(P.vx*nx + P.vy*ny) >= SIT.SITU.DRIVE_SPEED;
    if (!R.mode && dP < 17 && drivingIn) {
      R.mode = rnd()*100 < params.stepUp ? "up" : "home";
      R.upDist = clamp(dP - 4.5, 6, 10); R.upX = HOOP.x + nx*R.upDist; R.upY = HOOP.y + ny*R.upDist;
    }
    if (R.mode && dP > 19 && shot.state === "idle") R.mode = null;
    const homeX = 25, homeY = 8.5;
    let tx = homeX, ty = homeY, maxS = 11;
    if (R.mode === "up" && dP > R.upDist - 0.5) { tx = R.upX; ty = R.upY; maxS = 12; }
    else if (finishing || dP < 16) {
      const k = finishing ? Math.min(3, dP*0.6) : Math.min(4.5, dP*0.45), w = finishing ? 0.75 : 0.6;
      tx = homeX + (HOOP.x + nx*k - homeX)*w; ty = homeY + (HOOP.y + ny*k - homeY)*w;
      maxS = R.mode === "up" ? 8 : finishing ? 12 : 11;   // a big who stepped up has to recover
    }
    if (loose) { const c = looseTarget(); tx = c.x; ty = c.y; maxS = 12; }
    if (R.jumpT < 0) stepToward(R, tx, ty, maxS, 40, dt);
    moveDef(R, dt, 2.2);
    const handUp = shooting && !isFin(shot.kind) && shot.t >= (shot.kind === "floater" ? params.react*0.6 : params.react) && Math.hypot(R.x - P.x, R.y - P.y) < 8;
    R.hand = clamp(R.hand + clamp((handUp ? 1 : 0) - R.hand, -dt/0.15, dt/0.15), 0, 1);
  }

  tickBall(dt);
  if (fl.on && inPlay()) {
    if (fl.loose) looseTick();
    else if (fl.phase === "live" && shot.state !== "flight") {       // the clock runs until the shot is in the air
      fl.clock -= dt; if (fl.grace > 0) fl.grace -= dt;
      if (fl.clock <= 0) { fl.clock = 0; g.fx.push({ kind: "text", text: "Shot clock", t: 0 }); whistle("Shot clock violation", "change"); }
    }
  }
}
// The ball in the air, and the timers that run whether or not the ball is live.
function tickBall(dt) {
  if (g.ball && g.ball.phase === "path") {
    g.ball.t += dt;
    if (!g.ball.announced && g.ball.t >= g.ball.decideT) {
      g.ball.announced = true;
      if (g.ball.made) { g.fx.push({ kind: "ring", t: 0 }); g.fx.push({ kind: "text", text: g.last.out.sub === "And one" ? "And one!" : g.last.out.big, t: 0 }); }
      else g.fx.push({ kind: "text", text: g.last.out.big === "Blocked" ? "Blocked" : g.last.out.sub, t: 0 });
      shot.state = "idle"; shot.cooldown = 0.35; R.mode = null;
      if (g.flow.on) shotDecided(g.ball.made, g.last.out.big === "Blocked");
    }
    if (g.ball.t > g.ball.endT + 0.2 && !g.flow.loose) g.ball = null;
  } else if (g.ball) {
    g.ball.t += dt;
    if (g.ball.phase === "flight" && g.ball.t >= g.ball.dur) {
      const made = g.ball.make;
      g.ball.t = 0;
      if (g.ball.blocked) { g.ball.phase = "bounce"; g.ball.bx = g.ball.tx; g.ball.by = g.ball.ty; g.ball.vx = (g.ball.tx - g.ball.sx)*1.2; g.ball.vy = (g.ball.ty - g.ball.sy)*1.2; }
      else if (g.ball.make) { g.ball.phase = "drop"; g.fx.push({ kind: "ring", t: 0 }); g.fx.push({ kind: "text", text: g.last.out.sub === "And one" ? "And one!" : g.last.out.big, t: 0 }); }
      else {
        g.ball.phase = "bounce"; g.ball.bx = g.ball.tx; g.ball.by = g.ball.ty; g.ball.vx = g.ball.u.x*11; g.ball.vy = g.ball.u.y*11;
        g.fx.push({ kind: "text", text: g.last.out.sub, t: 0 });
      }
      shot.state = "idle"; shot.cooldown = 0.35; R.mode = null;   // the big re-reads every possession
      if (g.flow.on && inPlay()) { if (made) shotDecided(true, false); else whistle("Out of bounds", "change"); }   // a made dunk, or a shot that never had a chance
    } else if (g.ball.phase === "bounce") {
      g.ball.bx += g.ball.vx*dt; g.ball.by += g.ball.vy*dt; g.ball.vx *= Math.exp(-dt*1.5); g.ball.vy *= Math.exp(-dt*1.5);
      if (g.ball.t > 0.9) g.ball = null;
    } else if (g.ball.phase === "drop" && g.ball.t > 0.4) g.ball = null;
  }
  if (shot.cooldown > 0) shot.cooldown -= dt;
  if (g.meterFlash) { g.meterFlash.t -= dt; if (g.meterFlash.t <= 0) g.meterFlash = null; }
  g.fx = g.fx.filter(o => (o.t += dt) < 1.1);
}

// ---------- A player on defense ----------
// WASD moves, the cursor is the hand, Space jumps. How far the cursor is from the body is how far the arm is out;
// pointing it at the ball handler raises it into a contest, and getting it onto the ball takes the ball.
function playerDefender(dt) {
  const i = g.defIn;
  if (D.jumpT < 0) {                                                   // no steering in the air
    const ax = (i.r ? 1 : 0) - (i.l ? 1 : 0), ay = (i.d ? 1 : 0) - (i.u ? 1 : 0), al = Math.hypot(ax, ay) || 1;
    const ex = ax/al*C.DEF_SPEED - D.vx, ey = ay/al*C.DEF_SPEED - D.vy, el = Math.hypot(ex, ey), st = C.DEF_ACC*dt;
    if (el <= st) { D.vx += ex; D.vy += ey; } else { D.vx += ex/el*st; D.vy += ey/el*st; }
  }
  moveDef(D, dt);
  const cx = i.x - D.x, cy = i.y - D.y, cd = Math.hypot(cx, cy) || 1, out = clamp((cd - 1)/2, 0, 1);
  const px = P.x - D.x, py = P.y - D.y, pd = Math.hypot(px, py) || 1;
  D.hand = out*Math.max(0, (cx*px + cy*py)/(cd*pd));
  D.hx = D.x + cx/cd*(0.85 + 0.75*out); D.hy = D.y + cy/cd*(0.85 + 0.75*out);
  // a hand on a ball that is being dribbled or held takes it, unless the handler's off arm is in the way
  if (shot.state !== "idle" || !ballFree() || !graceOver()) return;
  const b = hold.state === "none" ? dribbleBallPos() : heldBallPos();
  if (Math.hypot(D.hx - b.x, D.hy - b.y) < C.STEAL_R && armBarFactor(b.x, b.y) === 1) turnover(hold.state === "none" ? "Picked clean" : "Stripped");
}
function defenderJump() { if (D.jumpT < 0 && D.land <= 0) D.jumpT = 0; }

// ---------- Rules: score, shot clock, possessions ----------
// Blow the whistle: play stops for a moment, then `next` happens: "change" (the other side's ball), "keep" (same
// side, from the top), "ft" (free throws) or "over".
function whistle(why, next, pause = RULES.DEAD_T) {
  const fl = g.flow;
  if (!inPlay()) return;
  Object.assign(fl, { phase: "dead", t: pause, why, next, loose: false });
  if (shot.state === "shooting") shot.state = "idle";
  P.vx = 0; P.vy = 0;
}
function addPoints(n) {
  const fl = g.flow;
  fl.score[fl.offense] += n;
  if (fl.score[fl.offense] >= RULES.TARGET) { fl.winner = fl.offense; return true; }
  return false;
}
// A shot's result is known: it went in, or it is coming down off the rim, the glass or a hand.
function shotDecided(made, blocked) {
  const fl = g.flow;
  if (fl.phase === "ft") {
    const won = made && addPoints(1);
    fl.ft--;
    if (won) whistle("Game", "over");
    else if (fl.ft > 0) whistle(made ? "Good" : "No good", "ft", RULES.FT_GAP);
    else whistle(made ? "Good" : "No good", "change");               // no rebound off the last one yet: the other side takes it
  } else if (made) {
    if (addPoints(fl.value)) whistle("Game", "over");
    else if (fl.fouled) { fl.ft = 1; whistle("And one", "ft"); }
    else whistle("Score", "change");
  } else if (fl.fouled) { fl.ft = fl.value; whistle("Foul", "ft"); }
  else { fl.loose = true; fl.lastTouch = blocked ? "d" : "o"; }
}
// A dunk that was blocked or rattled out: the ball comes off the front of the rim, live.
function looseOffRim(f, blocked) {
  const side = rnd() < 0.5 ? -1 : 1, k = blocked ? { out: 3, across: 8, up: 1 } : { out: 5, across: 2, up: 4 };
  const pos = { x: HOOP.x - f.u.x*1.6, y: HOOP.y - f.u.y*1.6, z: PHX.PHYS.RIM.z + 0.3 };
  const vel = { x: -f.u.x*k.out + f.r.x*side*k.across, y: -f.u.y*k.out + f.r.y*side*k.across, z: k.up };
  const res = keep(PHX.simulateShot({ pos, vel }, { floorBounces: 8, tMax: 8 }));
  g.ball = { phase: "path", t: 0, path: res.path, made: false, decideT: 0, endT: res.path[res.path.length - 1].t, announced: true, relZ: pos.z, rimDist: 1 };
  g.flow.loose = true; g.flow.lastTouch = blocked ? "d" : "o";
}
// Where a loose ball can first be caught: the spot it comes down to reaching height, or where it is now.
function looseTarget() {
  const b = g.ball, p = b.path;
  for (let i = 0; i < p.length; i++) if (p[i].t >= b.t && p[i].z <= RULES.CATCH_Z) return p[i];
  return p[p.length - 1];
}
// A loose ball goes to whoever gets a hand to it first. Out of bounds, it goes against the side that touched it last.
function looseTick() {
  const fl = g.flow, b = g.ball, bp = pathPoint(b), K = RULES.COURT;
  const out = bp.x < K.x0 || bp.x > K.x1 || bp.y < K.y0 || bp.y > K.y1;
  if (out || b.t > b.endT + RULES.REST_T) {
    g.fx.push({ kind: "text", text: out ? "Out of bounds" : "Dead ball", t: 0 });
    whistle(out ? "Out of bounds" : "Dead ball", fl.lastTouch === "o" ? "change" : "keep");
    return;
  }
  let best = null;
  for (const body of [P, ...defenders()]) {
    const reach = RULES.CATCH_Z + (body === P ? 0 : SIT.SITU.HAND_JUMP*body.h), d = Math.hypot(body.x - bp.x, body.y - bp.y);
    if (bp.z <= reach && d <= RULES.CATCH_R && (!best || d < best.d)) best = { body, d };
  }
  if (!best) return;
  if (best.body === P) {                                               // the offense has it back: play on with a fresh clock
    fl.loose = false; fl.clock = RULES.SHOT_CLOCK; g.ball = null; shot.cooldown = 0.25; R.mode = null;
    drib.lastMove = "Offensive rebound";
    g.fx.push({ kind: "text", text: "Offensive rebound", t: 0, x: P.x, y: P.y });
  } else {
    g.fx.push({ kind: "text", text: "Rebound", t: 0, x: best.body.x, y: best.body.y });
    whistle(fl.lastTouch === "d" ? "Block recovered" : "Defensive rebound", "change");
  }
}
// Put everyone in place with the ball in the handler's hands and nothing in progress.
function place(p, d, r) {
  Object.assign(P, { x: p.x, y: p.y, vx: 0, vy: 0 });
  Object.assign(D, { x: d.x, y: d.y, vx: 0, vy: 0, hand: 0, h: 0, jumpT: -1, jumpAt: null, land: 0, shade: 0, threat: 0, sawPrev: false });
  Object.assign(R, { x: r.x, y: r.y, vx: 0, vy: 0, hand: 0, h: 0, jumpT: -1, jumpAt: null, land: 0, mode: null, sawPrev: false });
  Object.assign(shot, { state: "idle", kind: "jumper", t: 0, held: false, note: "", cooldown: 0.4, fade: false });
  Object.assign(hold, { state: "none", fakeT: 0, prints: [] });
  Object.assign(drib, { phase: 0, side: 1, from: { x: 0.9, y: 0 }, to: { x: 0.9, y: 0 }, len: 0.9, hold: 0, crossing: false });
  g.ball = null; g.meterFlash = null; seen.length = 0;
}
function checkBall() {
  place(RULES.CHECK, { x: RULES.CHECK.x, y: RULES.CHECK.y - params.sag }, { x: 25, y: 8.5 });
  Object.assign(g.flow, { phase: "live", t: 0, next: null, why: "", clock: RULES.SHOT_CLOCK, loose: false, fouled: false, ft: 0, grace: RULES.GRACE });
}
// Free throws: the shooter at the line, the defenders outside the lane, more than 8 ft away so every one is a clean look.
function freeThrows() {
  place({ x: HOOP.x, y: HOOP.y + RULES.FT_LINE }, { x: 19, y: 13 }, { x: 31, y: 13 });
  Object.assign(g.flow, { phase: "ft", t: 0, next: null, why: "", loose: false, fouled: false });
}
// A dead ball: nobody moves, the ball finishes what it was doing, and when the pause is up the next thing happens.
function deadTick(dt) {
  const fl = g.flow;
  g.simT += dt;
  P.vx = 0; P.vy = 0;
  for (const d of [D, R]) { d.vx = 0; d.vy = 0; }
  tickBall(dt);
  if (fl.phase !== "dead") return;
  fl.t -= dt;
  if (fl.t > 0) return;
  if (fl.next === "over") { fl.phase = "over"; return; }
  if (fl.next === "ft") { freeThrows(); return; }
  if (fl.next === "change") fl.offense = 1 - fl.offense;
  checkBall();
}
function newGame() {
  resetStats();
  Object.assign(g.flow, { offense: 0, score: [0, 0], winner: null, value: 2, lastTouch: "o" });
  checkBall();
}
// Switching the rules on starts a game. Switching them off goes back to the shot lab, from its usual starting spots.
function setRules(on) {
  g.flow.on = !!on;
  if (on) { newGame(); return; }
  Object.assign(g.flow, { phase: "live", loose: false, why: "" });
  place({ x: 25, y: 26 }, { x: 25, y: 20 }, { x: 25, y: 9.5 }); shot.cooldown = 0;
}

// ---------- Preview: what would a shot from here be? ----------
function previewNow(shift) {
  let live;
  const f = frame(P);
  const cx = shot.state === "shooting" ? { kind: shot.kind, note: shot.note } : shotContext(shift);
  if (cx.kind === "jumper") {
    const con = jumperContest();
    const shooting = shot.state === "shooting";
    const fi = shooting ? (shot.fade ? { type: shot.fade, x: shot.fux, y: shot.fuy, along: shot.fadeAlong } : null) : fadeIntent(f);
    const fade = fi ? fi.type : false;
    let bvx = shooting ? shot.bvx : P.vx, bvy = shooting ? shot.bvy : P.vy;
    if (fi && !shooting) { const al = bvx*fi.x + bvy*fi.y; if (al > 0) { bvx -= al*fi.x; bvy -= al*fi.y; } }
    const moving = shooting ? shot.gatherSpeed : Math.hypot(bvx, bvy);
    const clean = cleanLook(fade, moving);
    cx.clean = clean;
    const shift = shooting ? shot.shift : (fi ? fadeShiftFor(fi.along) : 0);
    const ideal = C.IDEAL + shift;
    const fadeLat = fi ? C.DRIFT_LAT*params.drift*C.FADE_SPEED*(fi.x*f.r.x + fi.y*f.r.y) : 0;
    const remain = shooting ? Math.max(0, ideal - shot.t) : ideal;
    const k = Math.exp(-remain/1000/C.TAU);
    const aim = aimOf(P, f);
    cx.fade = fade; cx.shift = shift;
    const assistK = 1 - params.aAssist/100;
    const glass = glassAimFor("jumper"); cx.glass = glass;
    const base = { kind: "jumper", player: { x: P.x, y: P.y }, contest: con.c, hands: handPaths(), target: glass ? glass.target : undefined };
    const sc = { kind: "jumper", dist: f.dist, q: 1, move: moving, contest: con.c, clean, fadeIn: fade ? fadeSigmaFor(fade) : 0 };
    const fadeAng = fi ? Math.atan(fadeLat/12/f.dist) : 0;
    const withAim = { ...base, aimTheta: glass ? 0 : (clamp(aim.theta, -0.6, 0.6) + fadeAng)*assistK, body: liftBody(f, bvx*k, bvy*k, assistK, 1) };
    const sig = { ...NZX.scatterIn(sc), parts: jumperParts(f.dist, moving, con.c, 1, fade ? fadeSigmaFor(fade) : 0) };
    live = { cx, f, con, sig, three: isThree(P),
             v1: liveChance("j1", base, sc, liveZ()), v2: liveChance("j2", withAim, sc, liveZ(true)) };
  } else if (cx.kind === "floater") {
    const con = floaterContest();
    const moving = shot.state === "shooting" ? shot.gatherSpeed : Math.hypot(P.vx, P.vy);
    const remain = shot.state === "shooting" ? Math.max(0, C.FL_IDEAL - shot.t) : C.FL_IDEAL;
    const k = Math.exp(-remain/1000/0.12);
    const b = floaterBias(0, f, P.vx*k, P.vy*k);
    const glass = glassAimFor("floater"); cx.glass = glass;
    const base = { kind: "floater", player: { x: P.x, y: P.y }, contest: con.c, hands: handPaths(), target: glass ? glass.target : undefined };
    const sc = { kind: "floater", dist: f.dist, q: 1, move: moving, contest: con.c };
    const withAim = { ...base, aimTheta: glass ? 0 : clamp(b.aim.theta, -0.6, 0.6)*b.assistK, body: liftBody(f, P.vx*k, P.vy*k, 0.6*b.assistK, 0.5) };
    const sig = { ...NZX.scatterIn(sc), parts: floaterParts(f.dist, moving, con.c, 1) };
    live = { cx, f, con, sig, three: false,
             v1: liveChance("f1", base, sc, liveZ()), v2: liveChance("f2", withAim, sc, liveZ(true)) };
  } else {
    const side = finishSideOf(f), con = rimContest(side);
    const gs = shot.state === "shooting" ? shot.gatherSpeed : Math.hypot(P.vx, P.vy);
    const vp = shot.state === "shooting" ? shot.vPerpG : P.vx*f.r.x + P.vy*f.r.y;
    const hang = shot.state === "shooting" && shot.kind === "layup" ? Math.max(0, shot.t - C.RISE_LAYUP) : 0;
    if (cx.kind === "dunk") {
      const block = blockChanceDunk(con.c);
      live = { cx, f, con, side, sig: { lat: 1.2, dep: 1.2, parts: [1, 0, 0, 0] },
               v1: (1 - block)*(1 - C.DUNK_FUMBLE), v2: block, three: false };
    } else {
      const sig = finishSigma(gs, vp, side, hang, con.c);
      const lsc = { kind: "layup", dist: f.dist, extra: Math.hypot(sig.parts[1], sig.parts[2]), contest: con.c };
      const lr = liveRates("l1", { kind: "layup", player: { x: P.x, y: P.y }, contest: con.c, hands: handPaths() }, lsc);
      live = { cx, f, con, side, sig, v1: lr.make, v2: lr.block, three: false };
    }
  }
  return live;
}

// The live readout calls this as often as it likes. It reads the game and writes only to game.view.
function preview(shift) { viewing = true; try { return previewNow(shift); } finally { viewing = false; } }

// ---------- Input ----------
function letGo() { if (shot.kind === "jumper") releaseJumper(); else if (shot.kind === "floater") releaseFloater(); else { shot.held = false; shot.upAt = shot.t; } }
// the shot button came up: a pump fake if it is early enough, otherwise the release (or the end of a finish's hang)
function releaseShot() {
  if (shot.state !== "shooting") return;
  if (shot.fakeable && shot.t < C.COMMIT_MS) { pumpFake(); return; }
  letGo();
}
// One tick. An input is plain data: { u, d, l, r } movement keys held, { x, y } the cursor in court coordinates,
// shot (the shot button is down), shift (held, read when the shot starts), gather (Space is down). Presses and
// releases are read off the change since the last tick.
// With one player, pass their input. With two, pass [side 0's input, side 1's input]: the side with the ball plays
// offense and the other controls the on-ball defender, for whom Space is a jump.
function step(input) {
  const fl = g.flow, live = !fl.on || fl.phase === "live", ft = fl.on && fl.phase === "ft";
  const two = Array.isArray(input), side = two ? fl.offense : 0, off = two ? input[side] : input;
  keys.u = live && !!off.u; keys.d = live && !!off.d; keys.l = live && !!off.l; keys.r = live && !!off.r;   // nobody moves at the line or on a dead ball
  mouse.x = off.x; mouse.y = off.y;
  const was = g.prev[side], now = { shot: !!off.shot, gather: !!off.gather };
  if (live && now.gather && !was.gather) gather();
  if (live || ft) {
    if (now.shot && !was.shot) startShot(!!off.shift);
    else if (!now.shot && was.shot) releaseShot();
  }
  g.prev[side] = now;
  if (two) {
    const def = input[1 - side], dWas = g.prev[1 - side], dNow = { shot: !!def.shot, gather: !!def.gather };
    Object.assign(g.defIn, { u: live && !!def.u, d: live && !!def.d, l: live && !!def.l, r: live && !!def.r, x: def.x, y: def.y });
    if (g.duo && live && dNow.gather && !dWas.gather) defenderJump();
    g.prev[1 - side] = dNow;
  }
  g.tick++;
  update(TICK);
}
// For keeping two copies of a game in step: a short fingerprint to compare, a copy to send, and a way to take one in.
function digest() {
  const r = v => Math.round(v*1000), fl = g.flow;
  return [g.tick, g.seed, r(P.x), r(P.y), r(D.x), r(D.y), r(R.x), r(R.y), fl.score[0], fl.score[1], fl.offense, fl.phase, shot.state, stats.fga].join(",");
}
// The copy is made by hand, not through JSON: rolling back takes one every time a guess about the other player
// turns out wrong, many times a second.
function copyOf(v) {
  if (v === null || typeof v !== "object" || fixed.has(v)) return v;
  if (Array.isArray(v)) { const a = new Array(v.length); for (let i = 0; i < v.length; i++) a[i] = copyOf(v[i]); return a; }
  const o = {};
  for (const k in v) { const x = v[k]; if (x !== undefined) o[k] = copyOf(x); }
  return o;
}
function snapshot() {
  const o = {};
  for (const k in g) if (k !== "view" && g[k] !== undefined) o[k] = copyOf(g[k]);
  return o;
}
// Takes a snapshot into this game in place, so anything holding on to its parts (the page does) still sees them.
function load(snap) {
  for (const k of Object.keys(snap)) {
    const a = g[k], b = snap[k];
    if (Array.isArray(a) && Array.isArray(b)) { a.length = 0; a.push(...b); }
    else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) { for (const kk of Object.keys(a)) delete a[kk]; Object.assign(a, b); }
    else g[k] = b;
  }
  if (g.ball && g.ball.path) fixed.add(g.ball.path);
  if (g.lastPhys) keep(g.lastPhys);
}
function setDefender(which, on) {
  params[which] = on;
  if (which === "defOn") Object.assign(D, { hand: 0, h: 0, jumpT: -1, land: 0, x: P.x, y: Math.max(5, P.y - 6), vx: 0, vy: 0 });
  else Object.assign(R, { hand: 0, h: 0, jumpT: -1, land: 0, x: 25, y: 9.5, vx: 0, vy: 0, mode: null });
}
function resetStats() { Object.assign(stats, { fga: 0, fgm: 0, a3: 0, m3: 0, ar: 0, mr: 0, af: 0, mf: 0, fta: 0, ftm: 0, pts: 0, to: 0 }); drib.lastMove = ""; g.last = null; }

// Every export binds the game it was given before running.
const on = fn => (game, ...args) => { use(game); return fn(...args); };
return {
  C, HOOP, TICK, RULES, FADE_NAME, clamp, frame, footSpot, pathPoint, create,
  step: on(step), preview: on(preview), setDefender: on(setDefender), resetStats: on(resetStats), setRules: on(setRules), newGame: on(newGame),
  digest: on(digest), snapshot: on(snapshot), load: on(load), lastOdds: on(lastOdds),
  // read-only helpers for drawing and readouts
  shotContext: on(shotContext), handPositions: on(handPositions), shoulder: on(shoulder), stepFoot: on(stepFoot),
  dribbleBallPos: on(dribbleBallPos), heldBallPos: on(heldBallPos), ballFree: on(ballFree), tightness: on(tightness), fadeSigmaFor: on(fadeSigmaFor),
};
})();
if (typeof module !== "undefined") module.exports = GAME_EXPORTS;
else window.GameLib = GAME_EXPORTS;
