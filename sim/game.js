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
  // The jump with the ball, the same for every shot. Space starts it: LOAD ms with the feet still down while the legs
  // bend, then RISE ms up and RISE ms down. The top of the jump, IDEAL ms after the press, is where a jumper is let
  // go. A floater is let go on the way up, FL_IDEAL ms after it: that is what gets it off before a shot blocker is there.
  LOAD: 170, RISE: 350, IDEAL: 520, FL_IDEAL: 330,
  KEEP: 0.5, LEAN: 5,            // takeoff: this share of the speed you arrived with is carried into the air, plus up to LEAN ft/s the way WASD is held
  P_STAND: 8.3, P_JUMP: 2.3,     // ft: the handler's standing reach, and how much a full jump adds (placeholders until frames)
  RUN_UP: 7, STAND_LIFT: 0.85,   // a jump from a standstill reaches this share of one taken at RUN_UP ft/s or more
  AIR_LAND: 0.25,                // s to recover after coming down
  // The ball in the air is in the hand, and the cursor is the hand. Within REACH ft of the body the ball is where
  // the cursor is, on a straight arm, so the further out it is held the lower it is. With the cursor FORM_R ft or
  // more away the ball is up in a shooting form instead: FORM_OUT ft toward the cursor, FORM_Z ft up before the jump.
  REACH: 2.2, FORM_R: 3.2, FORM_OUT: 0.7, FORM_Z: 7.65,
  NEAR0: 4, NEAR1: 8,            // ft from the rim: inside the first a shot is all finish, and beyond the second it is none
  DUNK_Z: 10.15, DUNK_BALL: 0.9, // a dunk: the ball at least this high, and within this of the rim's center
  UNDER_LOW: 2.0, UNDER_HIGH: 1.35,   // ft from the rim's center the hand keeps a ball that is 9 ft up or lower, and one 10 ft up
  KEEP_OUT: 1.0,                 // nobody's center gets closer to the rim's than this
  BUMP_IN: 2,                    // in of scatter from a body met on the way up
  CHARGE_V: 2, CHARGE_SET: 1.5, RESTRICTED: 4,   // a charge: flying this fast into a defender moving slower than this, who is at least this far from the rim
  KT: 0.09,                      // in of depth bias per ms of post-assist timing error
  PSPEED: 15, PACC: 70,
  DSPEED: 13, DACC: 50, CLOSE_SPEED: 15.5, CLOSE_ACC: 60,
  DRIFT_DEP: 1.0,                // in the release has to make up, per ft/s of speed along the shot line: what moves the release line
  CONTEST_SIG: 6.0,
  PERFECT_MS: 12,
  // dribbling
  STEP_T: 0.2, GATHER_SPEED: 6,   // gather steps
  ARM: 2.6, SHOULDER: 0.75,       // hands: reach from each shoulder (will come from wingspan)
  DEF_SPEED: 14, DEF_ACC: 60, STEAL_R: 0.55,                               // a player on defense: top speed, acceleration, and how close a hand must get to the ball
  DRIB_SPEED: 13.5, ACC0: 85, DECEL: 95, REACH_MIN: 0.7, REACH_MAX: 2.4,   // explosive from a stop, sharper to stop than to start
  // floaters: lenient timed release, high arc
  FL_KT: 0.07, FL_PERFECT: 20, FL_CONTEST_SIG: 5.0,
  // contact: nothing here is rolled. A foul is a hand or a body that was somewhere it had no right to be
  BODY_R: 0.75, ARM_HIT: 0.3,       // a hand within this of the handler's center is on their body; within this of their off arm, on the arm
  REACH_V: 4,                       // ft/s: a hand that got there faster than this reached in. A hand that was already there did not
  HAND_OFF: 0.95,                   // the AI keeps its hand at least this far from the handler's center
  HAND_V: 14, REACH_T: 0.25,        // the AI's reach for the ball: hand speed, and how long it stays out
  OPEN_NEAR: 0.1,                   // a ball under the AI's nose needs to have been left open for only this share of the time one at the end of its reach does
  PULLUP_RESPECT: 0.75,             // how far the AI takes a standing handler in range for a shooter, 0 to 1. The same for everyone
  BAR_JUMPER: 3.15 + 15*0.052, BAR_FLOATER: 3.5 + 20*0.055,   // in: the shooter's own share of the scatter, as the readout's bar draws it
  CONTACT_R: 1.9, FOUL_V: 3.5,      // a defender this close to a shooter and still coming at them this fast has run into them
  ARM_FOUL_R: 0.6,                  // a raised hand within this of a shooter's center is on their arms, not the ball (which leaves 0.7 ft out)
  GLASS_DEPTH: 0.4, GLASS_SIDE: 1.1,  // aiming at the glass: the cursor within this of the backboard's line, and at least this far to the side of the rim's center
  LIVE_GAP: 3.4,                    // the AI stays at least this far off a triple threat: the drive is still there, so it can't crowd the shot
  BITE_R: 3.2,                      // the AI goes up for a jumper only from inside this, where a block is possible; so only there does a fake get it in the air
  SET_V: 0.5, OVER_V: 2,            // rebounding: a player moving this slowly is set; one in the air and coming into them this fast is over their back
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
  CATCH_R: 1.6, CATCH_Z: 8.0,                        // a loose ball is caught inside this reach and below this height, standing (placeholders until frames)
  TOUCH_LOCK: 0.35,                                  // a defender who got a hand to a shot can't also catch it this soon after
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
    prev: [{ shot: false, gather: false, jump: false }, { shot: false, gather: false, jump: false }],   // each side's buttons as of the last tick, to see presses and releases
    // Settings, the same for every player. None of them is a rating: each is the thing itself, in its own units.
    //   tAssist ms, bonus %, aAssist %, drift x       the shot: free timing error, what a perfect release tightens, aim help, how far momentum moves the release line
    //   fadeIn in                                      scatter that moving at 5 ft/s in the air adds to a jumper (a fadeaway's speed)
    //   layupSpeed ft/s                                the speed a layup can be taken at under control
    //   readMs ms, aiSpeed ft/s                        the AI on the ball: how old its picture of the handler is, and its top speed
    //   reachWait s, reachEvery s                      the AI's reach: how long the ball must have been left open at the end of its reach, and the wait before another
    //   stepUp %, sag ft, react ms, length x           the AI's help, its cushion, how late it sees a shot; and the on-ball defender's contest reach
    params: { tAssist: 15, bonus: 30, aAssist: 40, drift: 1, fadeIn: 2, layupSpeed: 11.4, readMs: 260, aiSpeed: 13, reachWait: 1.8, reachEvery: 3, stepUp: 50,
              defOn: true, rimOn: true, sag: 4.5, react: 250, length: 1 },
    // The ball handler. up: s into a jump with the ball, or -1; v0x, v0y: the velocity they arrived with; lift: how
    // much of a full jump this one is. h: how high they are, 0 to 1. jumpT, land: a jump for a loose ball, as for a defender.
    P: { x: 25, y: 26, vx: 0, vy: 0, h: 0, jumpT: -1, land: 0, up: -1, v0x: 0, v0y: 0, lift: 1 },
    D: makeDef(25, 20),                                      // on-ball defender
    R: makeDef(25, 9.5),                                     // rim protector
    mouse: { x: 25, y: 5.25 },                               // the cursor, in court coordinates
    keys: { u: false, d: false, l: false, r: false },        // movement keys held
    shot: { state: "idle", kind: "jumper", t: 0, gatherSpeed: 0, vPerpG: 0, gx: 0, gy: 0, note: "", cooldown: 0, quick: false, line: 520, avx: 0, avy: 0, bump: false },
    ball: null,                                              // the ball in flight, or null while it is in the handler's hands
    drib: { phase: 0, period: 400, side: 1, from: { x: 0.9, y: 0 }, to: { x: 0.9, y: 0 }, len: 0.9,
            top: 3, hold: 0, crossing: false, lastMove: "" },
    // gathered ball: "none" (dribbling), "steps" (gather steps on the move), "pivot" (dead dribble, feet planted)
    hold: { state: "none", step: 0, t: 0, speed: 0, dir: { x: 0, y: -1 }, from: null, to: null, euro: 0, jumpStop: false,
            landedT: 0, center: null, pivot: null, free: null, freeSide: 0, face: { x: 0, y: -1 }, ext: 0, stripT: 0,
            live: false,                                     // a held ball that has not been dribbled yet: the triple threat
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
            loose: false, looseT: 0, lastTouch: "o", value: 2, fouled: false, ft: 0, winner: null, grace: 0 },   // looseT: s the ball has been loose
    last: null,                                              // how the last shot was resolved
    lastPhys: null,                                          // last simulated shot, for the side-on replay
    lastSeq: 0, statsSeq: 0,                                 // bumped when last or stats change, so the page knows to redraw them
    fx: [], meterFlash: null,                                // floating text, rings and the meter's after-image
    // for the live readout only, never read by the rules: its own random stream, running make-chance estimates,
    // and bank targets already worked out
    view: { seed: ((opts.seed ?? 1) ^ 0x9E3779B9) | 0, est: {}, zs: null, glass: { cache: {}, n: 0 } },
  };
  Object.assign(game.R, { len: 1.2, stand: 8.9, mode: null, upX: 25, upY: 13, upDist: 8 });
  if (game.duo) game.params.rimOn = false;                   // one against one: nobody waiting at the rim
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
// What the body is doing in the air does not push the ball anywhere. A shooter makes up for their own motion: toward
// or away from the rim by when they let go, which moves the release line (lineFor), and sideways without being asked.
// Moving is paid for in scatter and in the line moving, not in an error to steer against.
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
const handSpecs = () => SIT.handSpecs(P, defenders(), shot.state === "shooting" ? shot.t : null, true);   // every defender's hand is where they put it
const handPaths = () => handSpecs().map(SIT.handPath);
function physOut(sr, layup) {
  if (!sr) return { make: false, big: "Miss", sub: layup ? "Blown layup" : "Airball" };
  const r = sr.res;
  if (r.blocked) return { make: false, big: "Blocked", sub: layup ? "Swatted at the rim" : "Hand on the ball", touched: true };
  if (r.goaltend) return { make: true, big: "Make", sub: "Goaltending" };
  // a tip: a hand got a piece of it, and it carried on off line
  if (r.tipped) return { make: r.made, big: r.made ? "Make" : "Miss", sub: r.made ? "Tipped, and in anyway" : "Tipped", touched: true };
  return { make: r.made, big: r.made ? "Make" : "Miss", sub: layup ? (LAYUP_LABEL[r.label] || r.label) : r.label };
}
// Aiming at the glass: the cursor on the backboard line, clear of the rim. Height is chosen for you.
// Rim or glass is chosen when the shot starts, by where the cursor is then, and not again: a cursor that slides off
// the rim during the shot is a worse aim at the rim, never a bank nobody asked for. The strip that counts as the
// glass stops short of the rim on every side, so a near miss of the rim is not on it either.
// A shot works its target out exactly. The live readout asks many times a second, so it reuses nearby answers.
function onGlass() {
  const B = PHX.PHYS.BOARD;
  return Math.abs(mouse.y - B.y) <= C.GLASS_DEPTH && mouse.x >= B.x0 + 0.3 && mouse.x <= B.x1 - 0.3 && Math.abs(mouse.x - HOOP.x) >= C.GLASS_SIDE;
}
function glassAimFor(from) {
  const going = shot.state === "shooting";
  if (going ? !shot.glass : !onGlass()) return null;
  // once it is a bank, the cursor slides the target along the glass, on the side of the rim it started
  const B = PHX.PHYS.BOARD, side = going ? shot.glassSide : (mouse.x >= HOOP.x ? 1 : -1);
  const x = +(side > 0 ? clamp(mouse.x, HOOP.x + C.GLASS_SIDE, B.x1 - 0.3) : clamp(mouse.x, B.x0 + 0.3, HOOP.x - C.GLASS_SIDE)).toFixed(1);
  if (!viewing) return LNX.glassTarget({ x: P.x, y: P.y }, "jumper", x, from);
  const half = v => Math.round(v*2)/2, w = from.form;
  const key = `${half(from.pos.x)}:${half(from.pos.y)}:${half(from.pos.z)}:${Math.round(w.layup*4)}:${w.floater > 0 ? 1 : 0}:${x.toFixed(1)}`, gl = g.view.glass;
  if (!gl.cache[key]) { if (++gl.n > 300) { gl.cache = {}; gl.n = 0; } gl.cache[key] = LNX.glassTarget({ x: P.x, y: P.y }, "jumper", x, from); }
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
// hs: the defenders' arms as numbers (handSpecs), to say afterwards whose arm touched the ball
function physShot(inp, sc, hs = []) {
  const L = LNX.buildLaunch({ ...inp, noise: physNoise(inp, sc) });
  if (!L) return null;
  // under the rules a miss stays in play, so follow the ball until it has all but stopped bouncing
  const far = g.flow.on ? { floorBounces: 8, tMax: 8 } : { floorBounces: 2 };
  const res = PHX.simulateShot(L, { ...far, hands: inp.hands || [] }), arm = res.touchBy === null ? null : hs[res.touchBy];
  return { L, res, toucher: arm ? (defenders()[arm.i] === D ? "D" : "R") : null };
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
// toucher: "D" or "R" if that defender's arm touched the ball, at touchT s into its flight
function startPathBall({ L, res, toucher }) {
  const RR = PHX.PHYS.RIM; keep(res);
  g.ball = { phase: "path", t: 0, path: res.path, made: res.made, decideT: decideTime(res), endT: res.path[res.path.length - 1].t,
           announced: false, relZ: L.pos.z, rimDist: Math.hypot(L.pos.x - RR.x, L.pos.y - RR.y) || 1, toucher, touchT: res.touchT };
  g.lastPhys = { path: res.path, contacts: res.contacts, from: L.pos, made: res.made };
}
// Where a ball on a path is at time t into it, and where it is now.
function pathAt(b, t) {
  let i = 0;
  while (i < b.path.length - 1 && b.path[i + 1].t <= t) i++;
  return b.path[i];
}
const pathPoint = b => pathAt(b, b.t);
// Does the handler have the ball? Not while it is in the air, loose, or dead.
const graceOver = () => !g.flow.on || g.flow.grace <= 0;
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

// ---------- What a jump is taken for ----------
// A jump is read as it starts: a shot from range, a floater or a finish. The AI goes by it: a shot blocker goes up
// for a finish on a timer, and stays down for a floater. For the shooter it settles one thing, which release line
// the jump has (see lineFor).
const shotContext = () => SIT.shotContext(P, hold);

// ---------- Jumpers ----------
function inputDir() {
  let ax = 0, ay = 0;
  if (keys.u) ay -= 1; if (keys.d) ay += 1; if (keys.l) ax -= 1; if (keys.r) ax += 1;
  const l = Math.hypot(ax, ay); return l ? { x: ax/l, y: ay/l } : null;
}
// ---------- The jump ----------
// One jump for every shot. What you carry into the air is decided at takeoff and nothing changes it after that:
// KEEP of the speed you arrived with, plus up to LEAN ft/s the way WASD is held while the legs load. So holding away
// from the rim from a standstill is a fadeaway, holding toward it off a drive is a runner, and holding against your
// own momentum is a hard stop.
function airVelocity(vx, vy) {
  const d = inputDir();
  return { x: vx*C.KEEP + (d ? d.x*C.LEAN : 0), y: vy*C.KEEP + (d ? d.y*C.LEAN : 0) };
}
// The release line, ms after Space. A jump has one, settled as the feet leave:
//   the top of the jump, for a set shot
//   quick, on the way up, for a jump off a drive from floater range: what the AI also reads as a floater
// Moving along the shot line would carry the ball long or short, and the release makes up for it: later going away
// from the rim, earlier going at it. The line moves to show where that is, so it is always the release that puts the
// depth right. The quick line moves half as far. Near the rim there is no timed release, and it does not move.
function lineFor(quick, vx, vy, f) {
  const along = (vx*f.u.x + vy*f.u.y)*C.DRIFT_DEP*params.drift/C.KT*(1 - nearOf(f.dist));
  return quick ? C.FL_IDEAL - Math.round(0.5*along) : C.IDEAL - Math.round(along);
}
// What a jumper taken with this velocity in the air is called. Going away from the rim is a fade; anything else is drift.
function fadeOf(vx, vy, f) {
  const along = vx*f.u.x + vy*f.u.y, lat = vx*f.r.x + vy*f.r.y;
  if (along > -2) return false;
  return Math.abs(lat) < 0.4*Math.abs(along) ? "back" : lat < 0 ? "left" : "right";
}
// in of scatter from moving through the air at this speed
const airScatter = speed => params.fadeIn*speed/C.LEAN;
const FADE_NAME = { back: "Fadeaway", left: "Side fade left", right: "Side fade right" };
// How far up the jump is, 0 to 1, t ms after Space.
const jumpCurve = t => { const a = t - C.LOAD; return a <= 0 || a >= 2*C.RISE ? 0 : 1 - ((a - C.RISE)/C.RISE)**2; };
// How much of a full jump one taken at this speed is.
const liftAt = v0 => C.STAND_LIFT + (1 - C.STAND_LIFT)*clamp(v0/C.RUN_UP, 0, 1);
// How much of a shot is a finish: all of it at the rim, none of it from range, and a mix in between.
const nearOf = dist => 1 - clamp((dist - C.NEAR0)/(C.NEAR1 - C.NEAR0), 0, 1);

// ---------- The ball in the air ----------
// Where the ball is: in the hand, and the hand is where the cursor puts it (see REACH, above). h: how far up the
// jump is, which is now unless something else is asked for.
//   out      ft from the body's center      placed   1 when the cursor has it on a straight arm, 0 in a shooting form
//   side     -1 to 1: how far to the shooter's left or right of their line to the rim it is held
function airBall(h = P.h) {
  const f = frame(P), cx = mouse.x - P.x, cy = mouse.y - P.y, cd = Math.hypot(cx, cy);
  const dir = cd > 0.05 ? { x: cx/cd, y: cy/cd } : f.u;
  const form = clamp((cd - C.REACH)/(C.FORM_R - C.REACH), 0, 1);
  const armOut = Math.min(cd, C.REACH), armZ = C.P_STAND - C.ARM + Math.sqrt(C.ARM*C.ARM - armOut*armOut);
  const out = armOut + (C.FORM_OUT - armOut)*form, z = armZ + (C.FORM_Z - armZ)*form + C.P_JUMP*h;
  let x = P.x + dir.x*out, y = P.y + dir.y*out;
  const side = clamp(((x - P.x)*f.r.x + (y - P.y)*f.r.y)/C.REACH, -1, 1);
  // The hand keeps the ball out from under the rim, where a ball let go has nowhere to go but up into it: the lower
  // the ball, the further out it stays. Once it is high enough to go over the rim, it can.
  if (z < C.DUNK_Z) {
    const need = C.UNDER_LOW - (C.UNDER_LOW - C.UNDER_HIGH)*clamp(z - 9, 0, 1), rx = x - HOOP.x, ry = y - HOOP.y, rd = Math.hypot(rx, ry);
    if (rd < need) { const ax = rd > 0.01 ? rx/rd : -f.u.x, ay = rd > 0.01 ? ry/rd : -f.u.y; x = HOOP.x + ax*need; y = HOOP.y + ay*need; }
  }
  return { x, y, z, out, placed: 1 - form, side };
}
// High and close: the ball over the rim. Then it is not shot, it is put through.
const canDunk = ball => shot.state === "shooting" && ball.z >= C.DUNK_Z && Math.hypot(ball.x - HOOP.x, ball.y - HOOP.y) <= C.DUNK_BALL
                        && !(g.flow.on && g.flow.phase === "ft");
const jumperContest = () => SIT.jumperContest(P, defenders());
const floaterContest = () => SIT.floaterContest(P, defenders());
const cleanLook = (fade, moveSpeed) => SIT.cleanLook(P, defenders(), fade, moveSpeed);

// ---------- A shot ----------
// Everything about a ball let go t ms into the jump, as things stand: the launch (inp), its scatter (sc), and what
// went into them. Nothing here is a kind of shot that was chosen. What a shot is follows from two things:
//   how far out     near the rim it is a finish: the hand finds the rim, so the cursor is free to place the ball, and
//                   timing only matters as a hang. From range the cursor has to aim and the release has to be on a line.
//   which line      a jump off a drive from floater range has the quick line, on the way up: the ball is pushed, off
//                   sooner, looser, with more arc. Any other jump has the top line, and the shot is set.
// o: { ball (airBall), av (velocity in the air), v0 and vp0 (speed at the jump, and the part of it across the shot
//      line), quick, euro, bump, foul }, and, for forecasts: t null means on the line; hangMs; perfect means with no
//      aim error.
function shotAt(t, o) {
  const f = frame(P), near = nearOf(f.dist), far = 1 - near, quick = !!o.quick, line = lineFor(quick, o.av.x, o.av.y, f);
  const e = t === null ? 0 : t - line;
  const q = clamp(1 - Math.max(0, Math.abs(e) - (quick ? C.FL_PERFECT : C.PERFECT_MS))/40, 0, 1);
  const eEff = Math.sign(e)*Math.max(0, Math.abs(e) - params.tAssist);
  const form = { jumper: quick ? 0 : far, floater: quick ? far : 0, layup: near };
  const air = Math.hypot(o.av.x, o.av.y), aim = aimOf(P, f), along = o.av.x*f.u.x + o.av.y*f.u.y, assistK = 1 - params.aAssist/100;
  const con = quick ? floaterContest() : jumperContest(), c = con.c*far;   // at the rim a defender is a body and an arm, nothing else
  const clean = cleanLook(false, Math.max(o.v0, air))*form.jumper;
  const hangMs = t === null ? (o.hangMs || 0) : Math.max(0, t - C.IDEAL);            // past the top of the jump is a hang: it costs control
  const fin = SIT.finishScatter({ speed: o.v0, vPerp: o.vp0, side: o.ball.side, hangMs, euro: o.euro || 0, limit: params.layupSpeed });
  const from = { pos: { x: o.ball.x, y: o.ball.y, z: o.ball.z }, form };
  const glass = glassAimFor(from), hs = handSpecs();
  const base = { ...from, player: { x: P.x, y: P.y }, contest: c, hands: hs.map(SIT.handPath), target: glass ? glass.target : undefined };
  const inp = o.perfect ? base : { ...base, aimTheta: glass ? 0 : clamp(aim.theta, -0.6, 0.6)*assistK*far, timingMs: eEff*far };
  const sc = { form, dist: f.dist, q, move: o.v0, contest: c, clean, fadeIn: airScatter(air), bump: o.bump ? C.BUMP_IN : 0,
               extra: Math.hypot(fin.parts[1], fin.parts[2])*(o.foul ? 1.15 : 1) };
  // the same scatter by what it comes from, for the readout's bar: touch, placement and hang, movement, the defense
  const own = Math.sqrt((form.jumper*C.BAR_JUMPER**2 + form.floater*C.BAR_FLOATER**2)*(1 - params.bonus/100*q)**2 + near*fin.parts[0]**2);
  const moved = Math.sqrt(form.jumper*(0.0196*o.v0*o.v0 + airScatter(air)**2) + form.floater*0.0064*o.v0*o.v0 + near*fin.parts[2]**2);
  const parts = [own, Math.sqrt(near)*fin.parts[1], moved, Math.hypot((form.jumper*C.CONTEST_SIG + form.floater*C.FL_CONTEST_SIG)*c, sc.bump)];
  return { inp, sc, hs, f, near, far, quick, e, eEff, q, line, form, air, along, aim, assistK, con: { ...con, c }, clean, hangMs, glass,
           sig: { ...NZX.scatterIn(sc), parts, limit: fin.limit } };
}
// What to call it, afterwards. A name for what was done, and nothing more.
function nameOf(s, dunk, upMs) {
  if (dunk) return "Dunk";
  if (s.near >= 0.5) {
    const how = s.glass ? "Bank" : P.y < HOOP.y - 0.2 ? "Reverse layup" : s.hangMs > 80 ? "Hanging layup" : upMs < C.IDEAL - 130 ? "Scoop" : "Layup";
    return how;
  }
  if (s.quick) return "Floater";
  const fade = fadeOf(P.vx, P.vy, s.f);
  return fade ? FADE_NAME[fade] : s.along > 4 ? "Runner" : shot.gatherSpeed > 6 ? "Pull-up jumper" : "Jump shot";
}

// ---------- Contact ----------
// A shooting foul is contact, worked out at the release from where the defenders and their arms are:
//   "Ran into the shooter"   a defender right on them and still coming
//   "On the arm"             a raised hand that is on the shooter's arms and not out where the ball is
// hs: the defenders' arms as numbers (handSpecs). Returns what the foul was, or null.
function shotFoul(hs) {
  for (const d of defenders()) {
    const dx = P.x - d.x, dy = P.y - d.y, dist = Math.hypot(dx, dy) || 1;
    if (dist <= C.CONTACT_R && (d.vx*dx + d.vy*dy)/dist > C.FOUL_V) return "Ran into the shooter";
  }
  for (const a of hs) {
    if (a.z0 < 7 && !(a.jumpStart !== null && a.jumpStart <= 0.1)) continue;           // the arm is down
    // A hand that is on the shooter now is a foul unless the shooter is the one who brought them together: a jump
    // carries its momentum, and flying into a hand that was already there is not the hand's doing.
    const dx = P.x - a.hx, dy = P.y - a.hy, dl = Math.hypot(dx, dy) || 1, d = defenders()[a.i];
    const hand = ((d.hvx ?? a.vx)*dx + (d.hvy ?? a.vy)*dy)/dl, shooter = -(P.vx*dx + P.vy*dy)/dl;   // how fast each is closing on the other
    if (dl < C.ARM_FOUL_R && hand >= shooter - 0.5) return "On the arm";
    // and where the hand is carried in the next moment, against where the shooter is now
    for (const t of [0.05, 0.1]) if (Math.hypot(a.hx + a.vx*t - P.x, a.hy + a.vy*t - P.y) < C.ARM_FOUL_R) return "On the arm";
  }
  return null;
}
// What a foul does to a shot's outcome: nothing if it went in (an and-one), free throws if it did not.
function fouledOut(out, foul, value) {
  if (!foul) return out;
  out.foul = foul;
  if (out.make) out.sub = "And one"; else { out.big = "Foul"; out.sub = `${foul}: ${value === 3 ? "three" : "two"} free throws`; }
  return out;
}
// A dunk is carried to the rim and put through it: no arc and no scatter. The only thing that stops it is an arm.
// The ball goes with the hand from where it is to just above the rim; an arm in the way there takes it as it would
// take any ball. If nothing is, it goes down through the rim.
function dunkShot(ball, hs) {
  const RR = PHX.PHYS.RIM, hands = hs.map(SIT.handPath);
  const from = { x: ball.x, y: ball.y, z: ball.z }, top = { x: RR.x, y: RR.y, z: RR.z + 0.75 };
  const far = Math.hypot(top.x - from.x, top.y - from.y, top.z - from.z) || 0.01, T = far/14, vel = { x: (top.x - from.x)/T, y: (top.y - from.y)/T, z: (top.z - from.z)/T };
  const opts = g.flow.on ? { floorBounces: 8, tMax: 8 } : { floorBounces: 2 };
  let L = null, res = null;
  for (let t = 0; t < T && !L; t += 0.004) {
    const c = { x: from.x + vel.x*t, y: from.y + vel.y*t, z: from.z + vel.z*t };
    if (hands.some(h => PHX.armContact(c, h, t))) {                    // met on the way: from here it is a ball hit by an arm
      L = { pos: c, vel };
      res = PHX.simulateShot(L, { ...opts, hands: hands.map(h => ({ r: h.r, at: u => h.at(u + t) })) });
    }
  }
  if (!L) { L = { pos: top, vel: { x: 0, y: 0, z: -12 } }; res = PHX.simulateShot(L, { ...opts, hands: hands.map(h => ({ r: h.r, at: u => h.at(u + T) })) }); }
  const arm = res.touchBy === null ? null : hs[res.touchBy];
  return { L, res, toucher: arm ? (defenders()[arm.i] === D ? "D" : "R") : null };
}

// Space, with the ball: leave the floor. What comes of it is up to where the ball is and when it is let go.
function takeOff() {
  if (shot.state !== "idle" || shot.cooldown > 0 || !ballFree() || P.up >= 0 || P.jumpT >= 0 || P.land > 0) return;
  if (g.ball) g.ball = null;
  const fromSteps = hold.state === "steps" ? hold.euro : 0;
  const cx = shotContext(), f = frame(P), v0 = Math.hypot(P.vx, P.vy);
  Object.assign(shot, { state: "shooting", kind: cx.kind, note: cx.note, t: 0, gatherSpeed: v0, vPerpG: P.vx*f.r.x + P.vy*f.r.y,
    gx: P.x, gy: P.y, quick: cx.kind === "floater", line: lineFor(cx.kind === "floater", P.vx*C.KEEP, P.vy*C.KEEP, f),
    avx: P.vx*C.KEEP, avy: P.vy*C.KEEP, euro: fromSteps, bump: false });
  shot.glass = onGlass(); shot.glassSide = mouse.x >= HOOP.x ? 1 : -1;   // rim or glass: settled now
  hold.state = "none";   // going up ends the gather
  Object.assign(P, { up: 0, v0x: P.vx, v0y: P.vy, lift: liftAt(v0) });
  D.jumpAt = null; R.jumpAt = null;
  if (cx.kind === "layup") {
    // the AI's shot blockers leave their feet a set time into a finish; the shooter can go early or hang to beat them
    for (const d of defenders()) { if (g.duo && d === D) continue; d.jumpAt = params.react*0.5 + 130; }
  }
}
// The body through a jump with the ball: the legs load, the feet leave, and it comes down where its momentum takes it.
// The ball may be gone by then. If it isn't, that is travelling.
function jumpMove(dt) {
  if (P.up*1000 < C.LOAD) {
    const v1 = airVelocity(P.v0x, P.v0y), k = clamp((P.up + dt)*1000/C.LOAD, 0, 1);
    P.vx = P.v0x + (v1.x - P.v0x)*k; P.vy = P.v0y + (v1.y - P.v0y)*k;
    if (shot.state === "shooting") { shot.avx = v1.x; shot.avy = v1.y; }
  }
  P.up += dt;
  P.h = jumpCurve(P.up*1000)*P.lift;
  if (shot.state === "shooting") { shot.t = P.up*1000; shot.line = lineFor(shot.quick, shot.avx, shot.avy, frame(P)); }
  if (P.up*1000 >= C.LOAD + 2*C.RISE) {
    Object.assign(P, { up: -1, h: 0, land: C.AIR_LAND });
    if (shot.state === "shooting") travel();
  }
}
function travel() {
  const fl = g.flow;
  shot.state = "idle"; shot.cooldown = 0.5; g.meterFlash = null;
  drib.lastMove = "Travelling: came down with the ball";
  g.fx.push({ kind: "text", text: "Travelling", t: 0, x: P.x, y: P.y });
  if (fl.on && fl.phase === "ft") { recordFreeThrow(false); g.statsSeq++; shotDecided(false, false); return; }
  stats.to++; g.statsSeq++;
  if (fl.on) whistle("Travelling", "change");
}

// ---------- Release ----------
// A click in the air: the ball leaves the hand, from where the hand is, now.
function letGo() {
  const fl = g.flow, ft = fl.on && fl.phase === "ft", f = frame(P), ball = airBall();
  const o = { ball, av: { x: P.vx, y: P.vy }, v0: shot.gatherSpeed, vp0: shot.vPerpG, quick: shot.quick, euro: shot.euro, bump: shot.bump };
  const common = { dist: f.dist, ball, upMs: shot.t, speed: shot.gatherSpeed, carried: Math.hypot(P.x - shot.gx, P.y - shot.gy), bump: shot.bump };
  let s = shotAt(shot.t, o), res;
  const foul = ft ? null : shotFoul(s.hs);
  if (canDunk(ball)) {
    res = dunkShot(ball, s.hs);
    const r = res.res, over = defenders().some(d => Math.hypot(d.x - HOOP.x, d.y - HOOP.y) < 3.5);
    const out = r.blocked ? { make: false, big: "Blocked", sub: "Met at the rim", touched: true }
              : r.made ? { make: true, big: "Dunk", sub: over ? "Posterized" : "Throwdown" }
              : { make: false, big: "Miss", sub: r.tipped ? "Tipped" : r.label, touched: r.tipped };
    fouledOut(out, foul, 2);
    record(out.make, 2, false, true);
    fl.value = 2;
    g.last = { ...common, kind: "dunk", name: "Dunk", out, foul, near: 1, hangMs: 0, block: r.blocked ? 1 : 0, chance: r.made ? 1 : 0 };   // nothing was rolled: it went or it didn't
  } else {
    if (foul) s = shotAt(shot.t, { ...o, foul });                      // contact costs a finish a little more
    const kind = s.near >= 0.5 ? "layup" : s.quick ? "floater" : "jumper";
    const three = isThree({ x: shot.gx, y: shot.gy });                 // zone is where you took off, not where you landed
    const odds = oddsLater(s.inp, s.sc, s.hs);                         // blocks are real collisions, so they're in here
    res = physShot(s.inp, s.sc, s.hs);
    const out = fouledOut(physOut(res, kind === "layup"), foul, three ? 3 : 2);
    if (kind === "floater" && out.sub === "Swish") out.sub = "Dropped in soft";
    if (ft) recordFreeThrow(out.make); else record(out.make, three ? 3 : 2, three, kind === "layup", kind === "floater");
    fl.value = three ? 3 : 2;
    g.last = { ...common, kind, name: nameOf(s, false, shot.t), out, foul, odds, three, e: s.e, eEff: s.eEff, q: s.q, quick: s.quick, near: s.near,
               aim: s.aim, con: s.con, sig: s.sig, glass: !!s.glass, assistK: s.assistK, fade: s.far > 0.5 && !s.quick && fadeOf(P.vx, P.vy, f),
               air: s.air, airIn: airScatter(s.air), hangMs: s.hangMs, line: s.line, shift: s.line - (s.quick ? C.FL_IDEAL : C.IDEAL),
               rimMode: params.rimOn ? R.mode : "off" };
  }
  fl.fouled = !!foul;
  g.meterFlash = { t: 0.8, at: shot.t, line: s.line, near: s.near, quick: s.quick, e: s.e };
  if (res) startPathBall(res); else launchBall(f, 0.4, 3);
  shot.state = "flight";
  g.lastSeq++; g.statsSeq++;
}

function recordFreeThrow(make) { stats.fta++; if (make) { stats.ftm++; stats.pts++; } }
function record(make, value, three, rim, floater = false) {
  stats.fga++; if (three) stats.a3++; if (rim) stats.ar++; if (floater) stats.af++;
  if (make) { stats.fgm++; stats.pts += value; if (three) stats.m3++; if (rim) stats.mr++; if (floater) stats.mf++; }
}
// Canned ball flight for a launch that can't reach its target: it comes up well short and goes out.
function launchBall(f, dur, hmax) {
  const sx = P.x, sy = P.y, sd = drib.side || 1;
  g.ball = { phase: "flight", t: 0, dur, sx, sy, tx: sx + f.r.x*sd*7 + f.u.x*1.5, ty: sy + f.r.y*sd*7 + f.u.y*1.5, hmax, make: false, blocked: true };
}

// ---------- Simulation ----------
// ---------- Dribbling: the cursor is the ball hand ----------
// Nothing is triggered. The ball follows the cursor, the body follows WASD, and the defender reacts to
// what they saw one reaction time ago. "Crossover" and "hesi" are names for what that produces.
// The on-ball defender's hand: where their cursor put it, or where the AI has it (see The defender's hand, below).
function defHand() {
  if (D.hx !== undefined) return { x: D.hx, y: D.hy };
  const tx = P.x - D.x, ty = P.y - D.y, tl = Math.hypot(tx, ty) || 1, reach = Math.min(0.85 + 0.75*D.hand, Math.max(0.3, tl - C.HAND_OFF));
  return { x: D.x + tx/tl*reach, y: D.y + ty/tl*reach };
}
const tightness = () => drib.hold;   // 1 = ball pulled in tight; follows the cursor continuously
// What a defender reads as a pull-up: a shooter in range, slowing down, ball held up and tight.
function pullUpThreat() {
  const f = frame(P), sp = Math.hypot(P.vx, P.vy);
  const respect = C.PULLUP_RESPECT;
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
  if (drib.crossing) drib.lastMove = "Crossover";
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
function turnover(text) {
  stats.to++;
  const dx = P.x - D.x, dy = P.y - D.y, dl = Math.hypot(dx, dy) || 1;
  g.ball = { phase: "bounce", t: 0, bx: P.x + drib.to.x, by: P.y + drib.to.y,
           vx: -dx/dl*9, vy: -dy/dl*9 };                                // it goes the way of whoever took it
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
// Shift changes what the ball is: dribbled to held, and, while the dribble has not been used yet, held to dribbled.
function gather() {
  if (shot.state === "idle" && ballFree() && hold.state === "pivot" && hold.live) return startDribble();
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
// A click with the feet on the floor: the ball goes up and the feet stay down. From a dribble that picks the ball up.
function pumpFake() {
  if (shot.state !== "idle" || shot.cooldown > 0 || !ballFree() || P.up >= 0 || P.jumpT >= 0) return;
  if (hold.state !== "pivot") enterPivot();                            // rising into a shot picks up the dribble
  hold.fakeT = 0.3; shot.cooldown = 0.15;
  drib.lastMove = "Pump fake";
  g.fx.push({ kind: "text", text: "Pump fake", t: 0, x: P.x, y: P.y });
}
// The triple threat: the ball in both hands with the dribble still to come. Everything a dead dribble allows (shoot,
// fake, pivot, jab with the free foot), plus putting it on the floor. A possession starts here, and so does every
// catch: for now that means an offensive rebound.
function tripleThreat() {
  enterPivot();
  hold.live = true;
  drib.lastMove = "Triple threat";
}
// Out of the triple threat and onto the floor. From here it is a dribble like any other: the next gather kills it.
function startDribble() {
  Object.assign(hold, { state: "none", live: false, pivot: null, free: null, prints: [], fakeT: 0 });
  Object.assign(drib, { phase: 0, crossing: false });
  drib.lastMove = "Put it on the floor";
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
}
function heldBallPos() {
  if (hold.state === "steps") return { x: P.x + hold.dir.x*0.6, y: P.y + hold.dir.y*0.6, h: 3.5 };
  return { x: P.x + hold.face.x*0.9, y: P.y + hold.face.y*0.9, h: 3.2 + 6*Math.max(0, hold.fakeT) };
}

// The defender's eyes: a short history of what the ball handler was doing.
function recordSeen() {
  seen.push({ t: g.simT, x: P.x, y: P.y, vx: P.vx, vy: P.vy, side: drib.side, dead: hold.state !== "none" && !hold.live, live: hold.state === "pivot" && hold.live,
              rising: shot.state === "shooting" || hold.fakeT > 0, ...seenBall(),
              threat: shot.state === "idle" && ballFree() ? pullUpThreat() : 0 });
  while (seen.length > 2 && seen[1].t < g.simT - 0.7) seen.shift();
}
// Where the ball is, and whether a hand could get to it: in the handler's hands, past the first second of a
// possession, and not behind their off arm.
function seenBall() {
  if (shot.state !== "idle" || !ballFree() || !graceOver()) return { bx: P.x, by: P.y, open: false };
  const b = hold.state === "none" ? dribbleBallPos() : heldBallPos();
  // a ball tucked away on the move, or up over the head in a fake, is out of a hand's way
  return { bx: b.x, by: b.y, open: hold.state !== "steps" && !(hold.fakeT > 0) && armBarFactor(b.x, b.y) === 1 };
}
function perceived(lag) {
  for (let i = seen.length - 1; i >= 0; i--) if (seen[i].t <= g.simT - lag) return seen[i];
  return seen[0];
}
// reaction lag: quicker defenders read sooner, better handlers are harder to read
const defLag = () => clamp(params.readMs/1000, 0.12, 0.4);

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
      // Boxing out. Each gives back the ground they took: whoever is standing their ground keeps the spot, and the
      // one running into them is stopped there. Two running into each other split it by how fast each came.
      const aP = Math.max(0, P.vx*nx + P.vy*ny), aD = Math.max(0, -(def.vx*nx + def.vy*ny)), tot = aP + aD;
      const kP = tot > 1e-6 ? aP/tot : 0.5, kD = 1 - kP;
      def.x += nx*over*kD; def.y += ny*over*kD; P.x -= nx*over*kP; P.y -= ny*over*kP;
      P.vx -= aP*nx; P.vy -= aP*ny; def.vx += aD*nx; def.vy += aD*ny;
      // over the back: in the air and still coming, into a player who had the spot
      if (def.jumpT >= 0 && aD > C.OVER_V && aP < C.SET_V) foulCall("Over the back", "keep");
      else if (P.jumpT >= 0 && aP > C.OVER_V && aD < C.SET_V) foulCall("Over the back", "change");
    } else {
      // A shooter in the air goes where their momentum takes them. Into a defender who was set, outside the
      // restricted area, that is a charge. Into anyone else it is a bump, which the shot pays for.
      const into = P.vx*nx + P.vy*ny;
      if (shot.state === "shooting" && P.up*1000 >= C.LOAD && into > C.CHARGE_V) {
        const set = def.jumpT < 0 && Math.hypot(def.vx, def.vy) < C.CHARGE_SET && Math.hypot(def.x - HOOP.x, def.y - HOOP.y) > C.RESTRICTED;
        if (set && !(D.foulT > 0)) { stats.to++; foulCall("Charge", "change"); }
        else shot.bump = true;
      }
      def.x += nx*over; def.y += ny*over;
    }
  }
  def.x = clamp(def.x, 0.6, 49.4); def.y = clamp(def.y, 4.8, 40);
}
function update(dt) {
  const fl = g.flow, loose = fl.loose, sawLoose = loose && fl.looseT >= params.react/1000;   // the AI reacts to a miss a reaction time late
  if (fl.on && (fl.phase === "dead" || fl.phase === "over")) { deadTick(dt); return; }
  const still = fl.on && fl.phase === "ft";                           // free throws: the defenders stand and watch
  g.simT += dt; recordSeen();
  if (hold.fakeT > 0) hold.fakeT -= dt;
  let ax = 0, ay = 0;
  if (keys.u) ay -= 1; if (keys.d) ay += 1; if (keys.l) ax -= 1; if (keys.r) ax += 1;
  const al = Math.hypot(ax, ay); if (al) { ax /= al; ay /= al; }

  if (P.up >= 0) { jumpMove(dt);                                      // in a jump with the ball, or coming down from one: no steering
  } else if (hold.state === "steps") { stepMove(dt);
  } else if (hold.state === "pivot") { pivotMove(dt);
  } else {
    if (ballFree()) updateDribble(dt);
    if (P.jumpT >= 0) { P.vx *= Math.exp(-dt*3); P.vy *= Math.exp(-dt*3); }   // no steering in the air
    else {
      const sp0 = Math.hypot(P.vx, P.vy), top = loose ? C.PSPEED : C.DRIB_SPEED;   // faster without the ball, chasing it down
      const tx = ax*top, ty = ay*top, dx = tx - P.vx, dy = ty - P.vy, dl = Math.hypot(dx, dy);
      // explosive from a stop, tapering near top speed; stopping and cutting are sharper than starting
      const speedingUp = (ax || ay) && top > sp0 + 0.01;
      const step = (speedingUp ? C.ACC0*(1 - 0.6*clamp(sp0/top, 0, 1)) : C.DECEL)*dt;
      if (dl <= step || dl < 1e-9) { P.vx = tx; P.vy = ty; } else { P.vx += dx/dl*step; P.vy += dy/dl*step; }
    }
  }
  if (P.jumpT >= 0) {                                                  // a jump for a loose ball: half a second up and down, then a moment to recover
    P.jumpT += dt;
    if (P.jumpT >= 0.5) { P.jumpT = -1; P.h = 0; P.land = 0.45; } else P.h = Math.sin(Math.PI*P.jumpT/0.5);
  }
  if (P.land > 0) P.land -= dt;
  const cap = C.PSPEED;
  const sp = Math.hypot(P.vx, P.vy); if (sp > cap) { P.vx *= cap/sp; P.vy *= cap/sp; }
  P.x = clamp(P.x + P.vx*dt, 0.6, 49.4); P.y = clamp(P.y + P.vy*dt, 4.8, 38.5);
  { const hx = P.x - HOOP.x, hy = P.y - HOOP.y, hd = Math.hypot(hx, hy);
    if (hd < C.KEEP_OUT) { P.x = HOOP.x + hx/(hd || 1)*C.KEEP_OUT; P.y = HOOP.y + (hd ? hy/hd : 1)*C.KEEP_OUT; } }

  // defenders: jumps on finishes
  const shooting = shot.state === "shooting", jumper = shot.kind === "jumper";
  const sawShot = !!(perceived(params.react/1000) || {}).rising;      // they react to the shooting motion they saw
  const reacted = sawShot || shot.state === "flight";
  // The AI goes up for a shot it sees only from where it could block it. Up close it has to respect the shot, so
  // that is also where a fake gets it in the air; from further off it keeps its feet and gets a hand up.
  for (const d of defenders()) {
    if (sawShot && !d.sawPrev && d.jumpT < 0 && d.land <= 0 && !still && !(g.duo && d === D)
        && Math.hypot(d.x - P.x, d.y - P.y) < C.BITE_R) d.jumpT = 0;
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
    if (loose && !sawLoose) { tx = D.x; ty = D.y; maxS = C.CLOSE_SPEED; acc = C.CLOSE_ACC; }            // a miss takes a moment to register
    else if (loose) { const c = looseTarget(); tx = c.x; ty = c.y; maxS = C.CLOSE_SPEED; acc = C.CLOSE_ACC; }   // go and get it
    else if (reacted) { tx = P.x + f.u.x*1.8; ty = P.y + f.u.y*1.8; maxS = C.CLOSE_SPEED; acc = C.CLOSE_ACC; }
    else {
      // act on what they saw `lag` ago, extrapolated forward: a sudden change leaves them guessing wrong
      const lag = defLag(), s0 = perceived(lag) || { x: P.x, y: P.y, vx: 0, vy: 0, side: drib.side, threat: 0 };
      const ex = s0.x + s0.vx*lag*0.8, ey = s0.y + s0.vy*lag*0.8, pf = frame({ x: ex, y: ey });
      const drive = Math.max(0, s0.vx*pf.u.x + s0.vy*pf.u.y);                         // coming at them: give ground
      const cushion = s0.dead ? Math.min(2.0, pf.dist*0.6)                              // dead dribble: no drive threat, crowd them
                              : Math.min(clamp(params.sag - (params.sag - 1.9)*s0.threat + drive*0.12, s0.live ? C.LIVE_GAP : 1.9, params.sag + 2), pf.dist*0.6);
      const shadeT = shot.state === "idle" && ballFree() ? s0.side*0.8 : 0;                // shade toward the ball side they saw
      D.shade += (shadeT - D.shade)*Math.min(1, dt*8);
      D.threat = s0.dead ? 0.8 : s0.threat;
      tx = ex + pf.u.x*cushion + pf.r.x*D.shade; ty = ey + pf.u.y*cushion + pf.r.y*D.shade;
      maxS = params.aiSpeed; acc = C.DACC + (params.aiSpeed - C.DSPEED)*10;      // a quicker defender also gets going sooner
    }
    if (D.jumpT < 0) stepToward(D, tx, ty, maxS, acc, dt);
    moveDef(D, dt);
    D.hand = clamp(D.hand + clamp((loose ? 0 : reacted ? 1 : D.threat*0.8) - D.hand, -dt/0.15, dt/0.15), 0, 1);
    aiHand(D, dt, true);
    handOnHandler();
  }
  if (params.rimOn && !still) {
    const hx = P.x - HOOP.x, hy = P.y - HOOP.y, dP = Math.hypot(hx, hy) || 0.001, nx = hx/dP, ny = hy/dP;
    const isFin = k => k === "layup" || k === "dunk";
    const finishing = (shooting && isFin(shot.kind)) || (shot.state === "flight" && g.last && isFin(g.last.kind));
    // once per drive the big decides: stay home (concede the floater) or step up (concede the lane)
    const drivingIn = -(P.vx*nx + P.vy*ny) >= SIT.SITU.DRIVE_SPEED;
    if (!R.mode && dP < 17 && drivingIn) {
      // Help when the on-ball defender is beaten. `beaten` is how far nearer the rim the handler is than their
      // defender; the slider moves the line, from never (0) through level (50) to always (100).
      const beaten = params.defOn ? Math.hypot(D.x - HOOP.x, D.y - HOOP.y) - dP : 99;
      R.mode = params.stepUp >= 100 || (params.stepUp > 0 && beaten > (50 - params.stepUp)/12.5) ? "up" : "home";
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
    if (loose && sawLoose) { const c = looseTarget(); tx = c.x; ty = c.y; maxS = 12; }
    else if (loose) { tx = R.x; ty = R.y; }
    if (R.jumpT < 0) stepToward(R, tx, ty, maxS, 40, dt);
    moveDef(R, dt, 2.2);
    const handUp = shooting && !isFin(shot.kind) && shot.t >= (shot.kind === "floater" ? params.react*0.6 : params.react) && Math.hypot(R.x - P.x, R.y - P.y) < 8;
    R.hand = clamp(R.hand + clamp((handUp ? 1 : 0) - R.hand, -dt/0.15, dt/0.15), 0, 1);
    aiHand(R, dt, false);
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
      if (g.flow.on) shotDecided(g.ball.made, !!g.last.out.touched);
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

// ---------- The defender's hand ----------
// Every defender has one hand, at (hx, hy), moving at (hvx, hvy). A player's is where their cursor puts it. The AI's
// rests toward the handler, held off their body, and goes for the ball when it has seen it left open.
// What the hand meets decides what happens, for the AI and a player alike:
//   the ball, with nothing in the way        a steal
//   the handler's off arm, or their body     a reach-in foul, if the hand was moving into them. A hand that was
//                                            already there, which the handler ran into, is no foul
function setHand(d, x, y, dt) {
  const was = d.hx === undefined ? { x, y } : { x: d.hx, y: d.hy };
  d.hx = x; d.hy = y; d.hvx = (x - was.x)/dt; d.hvy = (y - was.y)/dt;
}
// The AI's hand. reaches: whether this defender goes for the ball (the on-ball defender does; the rim protector doesn't).
function aiHand(d, dt, reaches) {
  const tx = P.x - d.x, ty = P.y - d.y, dist = Math.hypot(tx, ty) || 1;
  const rest = Math.min(0.85 + 0.75*Math.max(d.hand, d.h), Math.max(0.3, dist - C.HAND_OFF));
  let gx = d.x + tx/dist*rest, gy = d.y + ty/dist*rest;
  if (shot.state === "shooting" && P.up*1000 >= C.LOAD) {
    // A ball in the air: the hand goes to it, as far as the arm reaches, and stops short of the shooter's body.
    const b = airBall(), bx = b.x - d.x, by = b.y - d.y, bd = Math.hypot(bx, by) || 1, r = Math.min(0.85 + 0.75*Math.max(d.hand, d.h), bd);
    gx = d.x + bx/bd*r; gy = d.y + by/bd*r;
    const ox = gx - P.x, oy = gy - P.y, od = Math.hypot(ox, oy);
    if (od < C.HAND_OFF) { gx = P.x + (od ? ox/od : -tx/dist)*C.HAND_OFF; gy = P.y + (od ? oy/od : -ty/dist)*C.HAND_OFF; }
  }
  if (d.reachCd > 0) d.reachCd -= dt;
  if (reaches && d.reach) {                                            // going for it: the hand is out at the spot for a moment, then comes back
    d.reach.t += dt;
    if (d.reach.t >= C.REACH_T) { d.reach = null; d.reachCd = params.reachEvery; }
    else { const rx = d.reach.x - d.x, ry = d.reach.y - d.y, rl = Math.hypot(rx, ry) || 1, r = Math.min(rl, 1.6); gx = d.x + rx/rl*r; gy = d.y + ry/rl*r; }
  } else if (reaches && !(d.reachCd > 0) && d.jumpT < 0 && shot.state === "idle" && ballFree() && graceOver()) {
    // It acts on what it saw a reaction time ago: a ball within reach, with neither an arm nor the handler's body
    // in front of it. One look is not enough: the ball has to have been left there, for longer the further away it
    // is. Then it reaches for where that ball would be now if the handler had done nothing since. If they have,
    // the hand finds an arm, or nothing.
    const lag = defLag(), was = perceived(lag), far = was ? Math.hypot(was.bx - d.x, was.by - d.y) : 99;
    let open = !!was && was.open && g.simT - was.t <= lag + 0.05 && far <= 1.6 + C.STEAL_R;
    if (open) {                                                        // is their body on the way to it?
      const ax = was.bx - d.hx, ay = was.by - d.hy, t = clamp(((was.x - d.hx)*ax + (was.y - d.hy)*ay)/(ax*ax + ay*ay || 1), 0, 1);
      open = Math.hypot(d.hx + ax*t - was.x, d.hy + ay*t - was.y) >= C.BODY_R + 0.1;
    }
    d.openT = open ? (d.openT || 0) + dt : 0;
    if (open && d.openT >= params.reachWait*(C.OPEN_NEAR + (1 - C.OPEN_NEAR)*clamp((far - 1)/1.15, 0, 1)))
      { d.reach = { t: 0, x: was.bx + (P.x - was.x), y: was.by + (P.y - was.y) }; d.openT = 0; }
  } else d.openT = 0;
  // the hand travels; it doesn't jump
  const hx = d.hx === undefined ? gx : d.hx, hy = d.hy === undefined ? gy : d.hy, mx = gx - hx, my = gy - hy, ml = Math.hypot(mx, my), go = C.HAND_V*dt;
  setHand(d, ml <= go ? gx : hx + mx/ml*go, ml <= go ? gy : hy + my/ml*go, dt);
}
// What the on-ball defender's hand has met this tick.
function handOnHandler() {
  if (D.foulT > 0) D.foulT -= TICK;
  if (shot.state !== "idle" || !ballFree() || !graceOver()) return;
  const b = hold.state === "none" ? dribbleBallPos() : heldBallPos();
  if (Math.hypot(D.hx - b.x, D.hy - b.y) < C.STEAL_R && armBarFactor(b.x, b.y) === 1) return turnover(hold.state === "none" ? "Picked clean" : "Stripped");
  // what else is there to hit: their body, or the arm they are holding out to guard the ball
  let hit = Math.hypot(D.hx - P.x, D.hy - P.y) < C.BODY_R ? { x: P.x, y: P.y } : null;
  const hp = hit ? null : handPositions();
  if (hp && hp.guard) {
    const o = shoulder(frame(P), -drib.side), off = drib.side > 0 ? hp.L : hp.R, ax = off.x - o.x, ay = off.y - o.y;
    const t = clamp(((D.hx - o.x)*ax + (D.hy - o.y)*ay)/(ax*ax + ay*ay || 1), 0, 1), q = { x: o.x + ax*t, y: o.y + ay*t };
    if (Math.hypot(D.hx - q.x, D.hy - q.y) < C.ARM_HIT) hit = q;
  }
  if (!hit || D.foulT > 0) return;
  const dx = hit.x - D.hx, dy = hit.y - D.hy, dl = Math.hypot(dx, dy) || 1, into = dl < 1e-6 ? Math.hypot(D.hvx, D.hvy) : (D.hvx*dx + D.hvy*dy)/dl;
  if (into > C.REACH_V) foulCall("Reach-in foul", "keep");
}
// A foul away from a shot: the whistle, and the ball stays with or goes to whoever was fouled. With the rules off
// it is only called out.
function foulCall(why, next) {
  D.foulT = 1;
  g.fx.push({ kind: "text", text: "Foul", t: 0, x: P.x, y: P.y });
  drib.lastMove = why; g.statsSeq++;
  if (g.flow.on) whistle(why, next);
}

// ---------- A player on defense ----------
// WASD moves, the cursor is the hand, Space jumps. Pointing the cursor at the ball handler is a hand up, which is
// what a contest reads. How far the cursor is from the body is how far the arm reaches: close in it goes nearly
// straight up, further away it reaches out, and lower. With the cursor on their own body the hand is down.
function playerDefender(dt) {
  const i = g.defIn;
  if (D.jumpT < 0) {                                                   // no steering in the air
    const ax = (i.r ? 1 : 0) - (i.l ? 1 : 0), ay = (i.d ? 1 : 0) - (i.u ? 1 : 0), al = Math.hypot(ax, ay) || 1;
    const ex = ax/al*C.DEF_SPEED - D.vx, ey = ay/al*C.DEF_SPEED - D.vy, el = Math.hypot(ex, ey), st = C.DEF_ACC*dt;
    if (el <= st) { D.vx += ex; D.vy += ey; } else { D.vx += ex/el*st; D.vy += ey/el*st; }
  }
  moveDef(D, dt);
  const cx = i.x - D.x, cy = i.y - D.y, far = Math.hypot(cx, cy), cd = far || 1, out = clamp((far - 1)/2, 0, 1);
  const px = P.x - D.x, py = P.y - D.y, pd = Math.hypot(px, py) || 1;
  D.hand = far < 0.5 ? 0 : Math.max(0, (cx*px + cy*py)/(cd*pd));
  setHand(D, D.x + cx/cd*(0.85 + 0.75*out), D.y + cy/cd*(0.85 + 0.75*out), dt);
  handOnHandler();
}
function defenderJump() { if (D.jumpT < 0 && D.land <= 0) D.jumpT = 0; }
function handlerJump() { if (P.jumpT < 0 && P.up < 0 && P.land <= 0 && shot.state !== "shooting") P.jumpT = 0; }

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
// blocked: a defender touched it last, whether they blocked it or only tipped it.
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
  else { fl.loose = true; fl.looseT = 0; fl.lastTouch = blocked ? "d" : "o"; }
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
  fl.looseT += TICK;
  // Whoever's reach it comes into first has it: within arm's length of the body, and no higher than their hands,
  // which a jump raises. So of two players under the ball, the one in the air at the right moment takes it first.
  let best = null;
  for (const body of [P, ...defenders()]) {
    if (b.toucher && body === g[b.toucher] && b.t < b.touchT + RULES.TOUCH_LOCK) continue;   // they batted it; they haven't got hold of it
    if (body === P && P.up >= 0) continue;                             // still coming down from their own shot
    const reach = RULES.CATCH_Z + SIT.SITU.HAND_JUMP*body.h, d = Math.hypot(body.x - bp.x, body.y - bp.y);
    if (bp.z <= reach && d <= RULES.CATCH_R && (!best || d < best.d)) best = { body, d };
  }
  // the AI's defenders go up for it when it is about to come within a jump's reach
  for (const body of defenders()) {
    if ((g.duo && body === D) || body.jumpT >= 0 || body.land > 0 || fl.looseT < params.react/1000) continue;
    const soon = pathAt(b, b.t + 0.2);
    if (Math.hypot(body.x - soon.x, body.y - soon.y) <= RULES.CATCH_R && soon.z > RULES.CATCH_Z && soon.z <= RULES.CATCH_Z + SIT.SITU.HAND_JUMP*0.9) body.jumpT = 0;
  }
  if (!best) return;
  if (best.body === P) {                                               // the offense has it back: play on with a fresh clock
    fl.loose = false; fl.clock = RULES.SHOT_CLOCK; g.ball = null; shot.cooldown = 0.25; R.mode = null;
    tripleThreat();                                                    // caught, not dribbled: the dribble is still there
    drib.lastMove = "Offensive rebound";
    g.fx.push({ kind: "text", text: "Offensive rebound", t: 0, x: P.x, y: P.y });
  } else {
    g.fx.push({ kind: "text", text: "Rebound", t: 0, x: best.body.x, y: best.body.y });
    whistle(fl.lastTouch === "d" ? "Block recovered" : "Defensive rebound", "change");
  }
}
// Put everyone in place with the ball in the handler's hands and nothing in progress.
function place(p, d, r) {
  Object.assign(P, { x: p.x, y: p.y, vx: 0, vy: 0, h: 0, jumpT: -1, land: 0, up: -1 });
  Object.assign(D, { x: d.x, y: d.y, vx: 0, vy: 0, hand: 0, h: 0, jumpT: -1, jumpAt: null, land: 0, shade: 0, threat: 0, sawPrev: false,
                     hx: d.x, hy: d.y + 0.85, hvx: 0, hvy: 0, reach: null, reachCd: 0, openT: 0, foulT: 0 });
  Object.assign(R, { x: r.x, y: r.y, vx: 0, vy: 0, hand: 0, h: 0, jumpT: -1, jumpAt: null, land: 0, mode: null, sawPrev: false,
                     hx: r.x, hy: r.y + 0.85, hvx: 0, hvy: 0, reach: null, reachCd: 0 });
  Object.assign(shot, { state: "idle", kind: "jumper", t: 0, note: "", cooldown: 0.4, shift: 0 });
  Object.assign(hold, { state: "none", fakeT: 0, prints: [], live: false });
  Object.assign(drib, { phase: 0, side: 1, from: { x: 0.9, y: 0 }, to: { x: 0.9, y: 0 }, len: 0.9, hold: 0, crossing: false });
  g.ball = null; g.meterFlash = null; seen.length = 0;
}
function checkBall() {
  place(RULES.CHECK, { x: RULES.CHECK.x, y: RULES.CHECK.y - params.sag }, { x: 25, y: 8.5 });
  Object.assign(g.flow, { phase: "live", t: 0, next: null, why: "", clock: RULES.SHOT_CLOCK, loose: false, fouled: false, ft: 0, grace: RULES.GRACE });
  tripleThreat();
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
  if (P.up >= 0) jumpMove(dt);                                         // whoever was in the air comes down
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
function previewNow() {
  const f = frame(P), up = shot.state === "shooting", near = nearOf(f.dist);
  // what the body will be doing in the air: settled once the feet have left, a forecast before that
  const av = up ? { x: shot.avx, y: shot.avy } : airVelocity(P.vx, P.vy);
  const v0 = up ? shot.gatherSpeed : Math.hypot(P.vx, P.vy);
  const quick = up ? shot.quick : shotContext().kind === "floater", line = lineFor(quick, av.x, av.y, f);
  const now = airBall(), dunk = up && canDunk(now);
  // the ball as it will be at the top of the jump, until the jump is past it
  const ball = up && shot.t >= C.IDEAL ? now : airBall(up ? P.lift : liftAt(v0));
  const o = { ball, av, v0, vp0: up ? shot.vPerpG : P.vx*f.r.x + P.vy*f.r.y, euro: up ? shot.euro : hold.state === "steps" ? hold.euro : 0,
              bump: up && shot.bump, quick, hangMs: up ? Math.max(0, shot.t - C.IDEAL) : 0 };
  const s = shotAt(null, o);
  const cx = { kind: dunk ? "dunk" : near >= 0.5 ? "layup" : quick ? "floater" : "jumper", note: "", glass: s.glass, clean: s.clean, air: s.air, line,
               shift: line - (quick ? C.FL_IDEAL : C.IDEAL), fade: near < 0.5 && !quick && fadeOf(av.x, av.y, f) };
  const live = { cx, f, con: s.con, sig: s.sig, near, quick, ball: now, three: isThree(up ? { x: shot.gx, y: shot.gy } : P) };
  if (dunk) {
    const met = dunkShot(now, handSpecs()).res;                         // nothing rolled: with the arms where they are now, it goes or it is met
    return { ...live, sig: { lat: 0, dep: 0, parts: [1, 0, 0, 0] }, v1: met.made ? 1 : 0, v2: met.blocked ? 1 : 0, block: met.blocked ? 1 : 0 };
  }
  // the ceiling with perfect input, and the same shot with this aim and what is being carried
  const best = liveRates("a", shotAt(null, { ...o, perfect: true }).inp, s.sc, liveZ()), mine = liveRates("b", s.inp, s.sc, liveZ(true));
  return { ...live, v1: best.make, v2: mine.make, block: mine.block };
}

// The live readout calls this as often as it likes. It reads the game and writes only to game.view.
function preview() { viewing = true; try { return previewNow(); } finally { viewing = false; } }

// ---------- Input ----------
// A click in the air lets the ball go. While the legs are still loading there is nothing to let go.
function shootNow() { if (shot.state === "shooting" && shot.t >= C.LOAD) letGo(); }
// One tick. An input is plain data: { u, d, l, r } movement keys held, { x, y } the cursor in court coordinates,
// jump (Space is down), shot (the mouse button is down), gather (Shift is down). Presses are read off the change since
// the last tick.
//   jump     with the ball, leave the floor; without it, go up for a loose ball
//   shot     in the air, let the ball go; on the floor, a pump fake
//   gather   pick the dribble up, or put a ball that has not been dribbled yet on the floor
// With one player, pass their input. With two, pass [side 0's input, side 1's input]: the side with the ball plays
// offense and the other controls the on-ball defender, for whom Space is a jump as well.
function step(input) {
  const fl = g.flow, live = !fl.on || fl.phase === "live", ft = fl.on && fl.phase === "ft";
  const two = Array.isArray(input), side = two ? fl.offense : 0, off = two ? input[side] : input;
  keys.u = live && !!off.u; keys.d = live && !!off.d; keys.l = live && !!off.l; keys.r = live && !!off.r;   // nobody moves at the line or on a dead ball
  mouse.x = off.x; mouse.y = off.y;
  const was = g.prev[side], now = { shot: !!off.shot, gather: !!off.gather, jump: !!off.jump };
  if (live && now.gather && !was.gather) gather();
  if (now.jump && !was.jump) { if (live && fl.on && !ballFree()) handlerJump(); else if (live || ft) takeOff(); }
  if ((live || ft) && now.shot && !was.shot) { if (shot.state === "shooting") shootNow(); else pumpFake(); }
  g.prev[side] = now;
  if (two) {
    const def = input[1 - side], dWas = g.prev[1 - side], dNow = { shot: !!def.shot, gather: !!def.gather, jump: !!def.jump };
    Object.assign(g.defIn, { u: live && !!def.u, d: live && !!def.d, l: live && !!def.l, r: live && !!def.r, x: def.x, y: def.y });
    if (g.duo && live && dNow.jump && !dWas.jump) defenderJump();
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
  dribbleBallPos: on(dribbleBallPos), heldBallPos: on(heldBallPos), ballFree: on(ballFree), tightness: on(tightness), airBall: on(airBall),
};
})();
if (typeof module !== "undefined") module.exports = GAME_EXPORTS;
else window.GameLib = GAME_EXPORTS;
