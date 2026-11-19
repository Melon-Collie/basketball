// The shot situation: what a defender takes a jump for, how contested a shot from range is, and where the defenders'
// hands are. At the rim there is no contest to work out: a defender there is a body and an arm, and the game has both.
// Pure functions of explicit state, so the rules can be tested and measured without the game loop.
// Units: feet, seconds (ms where noted). x/y on the court, as in physics.js.
//
// A player is { x, y, vx, vy }. A defender is a player plus:
//   hand   0..1, how far their hand is up
//   h      0..1, jump height as a fraction of the peak
//   land   s left recovering from a landing (0 when recovered)
//   len    length multiplier on their contests
//   jumpT  s into a jump, or -1 on the ground
//   jumpAt ms into the shooter's motion at which they will jump, or null
//   stand  standing reach, ft
const PLs = (typeof module !== "undefined") ? require("./physics.js") : window.PhysicsLib;

const SITU = {
  // shot context
  DRIVE_SPEED: 4,                  // ft/s toward the rim to count as driving
  CLOSE_RANGE: 4,                  // inside this, any shot is a finish
  LAYUP_RANGE: 7, STEPS_LAYUP_RANGE: 9, DUNK_RANGE: 9, FLOATER_RANGE: 14,
  DUNK_SPEED: 7,
  STEP_THROUGH_EXT: 1.2, STEP_THROUGH_RANGE: 8,
  // defenders' hands (reach heights are placeholders until frames)
  HAND_RANGE: 7, HAND_R: 0.3, HAND_LOW: 6.2, HAND_JUMP: 2.2, JUMP_T: 0.5,
  ARM: 2.6,                        // shoulder to hand. Standing reach is the arm straight up, so the shoulder is this far below it
  ARM_FOR: 0.6,                    // s after the release that an arm is in the shot. Past that nobody knows where the defender will be
  // finishing
  FINISH_FLOOR: 1.8 + 15*0.045,    // in: the part of a layup's scatter nothing takes away, as shown in the readout
};
const clampS = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Geometry ----------
// The shot line from p: distance to the rim, unit vector toward it (u), and the shooter's right (r).
function frame(p) {
  const dx = PLs.PHYS.RIM.x - p.x, dy = PLs.PHYS.RIM.y - p.y, dist = Math.hypot(dx, dy) || 0.001;
  const u = { x: dx/dist, y: dy/dist };
  return { dist, u, r: { x: -u.y, y: u.x } };
}
function isThree(p) {
  if (p.y <= 14.2) return Math.abs(p.x - 25) >= 22;
  return Math.hypot(p.x - PLs.PHYS.RIM.x, p.y - PLs.PHYS.RIM.y) >= 23.75;
}

// ---------- Context: what would a jump from here be? ----------
// hold: { state: "none" | "steps" | "pivot", pivot, free, ext } (the gathered ball; pivot and free are the feet)
// A dunk is not one of the answers: it is a finish let go with the hand over the rim, which only the jump itself decides.
function shotContext(p, hold) {
  const f = frame(p), vAlong = p.vx*f.u.x + p.vy*f.u.y;
  if (hold.state === "pivot") {
    // stepping through toward the rim with the free foot is a finish; otherwise it's a set shot
    const ex = hold.pivot ? { x: hold.free.x - hold.pivot.x, y: hold.free.y - hold.pivot.y } : { x: 0, y: 0 }, el = Math.hypot(ex.x, ex.y) || 1;
    const through = hold.ext > SITU.STEP_THROUGH_EXT && (ex.x*f.u.x + ex.y*f.u.y)/el > 0.5 && f.dist <= SITU.STEP_THROUGH_RANGE;
    return f.dist <= SITU.CLOSE_RANGE || through ? { kind: "layup", note: through ? "Step-through finish" : "" } : { kind: "jumper", note: "" };
  }
  const driving = vAlong >= SITU.DRIVE_SPEED || hold.state === "steps";   // gather steps are always going somewhere
  // going up early on a drive = floater; keep driving and go up late = layup
  const layupRange = hold.state === "steps" ? SITU.STEPS_LAYUP_RANGE : SITU.LAYUP_RANGE;   // the gather steps carry you in, so they reach a little farther
  const attack = f.dist <= SITU.CLOSE_RANGE || (driving && f.dist <= layupRange);
  if (!attack) return driving && f.dist <= SITU.FLOATER_RANGE ? { kind: "floater", note: "" } : { kind: "jumper", note: "" };
  return { kind: "layup", note: "" };
}

// ---------- Contests ----------
// Several defenders combine as c = 1 - prod(1 - ci); the other fields are the strongest one's.
function combine(list) {
  let keep = 1, top = { c: 0, cos: 0, d: 99, speed: 0, lat: 0 };
  for (const x of list) { keep *= 1 - x.c; if (x.c > top.c) top = x; }
  return { ...top, c: 1 - keep };
}
function jumperContestOne(p, f, def) {
  const tx = def.x - p.x, ty = def.y - p.y, d = Math.hypot(tx, ty) || 0.001;
  const cos = (tx*f.u.x + ty*f.u.y)/d;
  const prox = Math.pow(clampS((5 - d)/3.5, 0, 1), 1.5);
  const inline = 0.25 + 0.75*clampS(cos, 0, 1);
  const closing = clampS((def.vx*(-tx) + def.vy*(-ty))/d/12, 0, 1);
  const handF = 0.35 + 0.65*Math.max(def.hand, def.h)*(def.land > 0 ? 0.3 : 1);   // just landed off a jump: can't get a hand up
  return { c: clampS(prox*inline*handF*(0.85 + 0.35*closing)*def.len, 0, 1), cos, d, speed: Math.hypot(def.vx, def.vy), lat: 0 };
}
function jumperContest(p, defs) { const f = frame(p); return combine(defs.map(d => jumperContestOne(p, f, d))); }

function floaterContestOne(p, f, def) {
  const tx = def.x - p.x, ty = def.y - p.y, d = Math.hypot(tx, ty) || 0.001;
  const cos = (tx*f.u.x + ty*f.u.y)/d;
  const prox = Math.pow(clampS((4 - d)/2.5, 0, 1), 1.5);   // the arc clears anyone more than ~4 ft away
  const inline = 0.25 + 0.75*clampS(cos, 0, 1);
  const handF = 0.35 + 0.65*Math.max(def.hand, def.h)*(def.land > 0 ? 0.3 : 1);   // just landed off a jump: can't get a hand up
  return { c: clampS(prox*inline*handF*def.len, 0, 1), cos, d, speed: Math.hypot(def.vx, def.vy), lat: 0 };
}
function floaterContest(p, defs) { const f = frame(p); return combine(defs.map(d => floaterContestOne(p, f, d))); }

// A clean look: nobody within ~8 ft, feet set, not a fade. Ramps in from 5 ft and from 3 ft/s.
function cleanLook(p, defs, fade, moveSpeed) {
  if (fade) return 0;
  let dmin = 99;
  for (const d of defs) dmin = Math.min(dmin, Math.hypot(d.x - p.x, d.y - p.y));
  return clampS((dmin - 5)/3, 0, 1)*clampS((3 - moveSpeed)/2, 0, 1);
}

// ---------- Finishing scatter ----------
// What a ball let go at the rim pays for, in inches at the rim: [the floor nothing takes away, where the ball was
// held and how long it was hung on to, speed]. side: -1 to 1, how far to the shooter's left or right of their line
// to the rim the ball was held. limit is the speed, in ft/s, that a finish can be taken at under control; every foot
// per second over it costs.
function finishScatter(s) {
  const r = SITU.FINISH_FLOOR, limit = s.limit;
  const sp = 0.35*Math.max(0, s.speed - limit);
  const vp = clampS(s.vPerp/6, -1, 1);
  const turn = 2.2*Math.max(0, -s.side*vp) + 0.8*Math.abs(s.side) + 0.6*(s.euro || 0);   // the ball held across your momentum, held out wide, euro footwork
  const hang = 0.9*(s.hangMs || 0)/100;
  const lat = Math.sqrt(r*r + sp*sp + turn*turn + hang*hang);
  return { lat, dep: lat*1.2, parts: [r, Math.hypot(turn, hang), sp], limit };
}

// ---------- Hands ----------
// Defenders' arms during the ball's flight, for physics.simulateShot.
// An arm is a fixed length from the shoulder, so a hand cannot be both far out and high: reaching `reach` ft toward
// the ball puts the hand sqrt(ARM^2 - reach^2) above the shoulder, against the full ARM when it goes straight up.
// The hand is carried by the defender's motion, and rises with any jump in progress or already scheduled.
// shotT: ms into the shooter's motion, or null if nobody is shooting.
// own: a defender whose hand is where they put it (hx, hy), or true if that goes for all of them. The others reach toward p.
// handSpecs gives each arm as plain numbers, which can be kept or sent; handPath turns one into the moving arm.
function handSpecs(p, defs, shotT, own = null) {
  const out = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i], dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist > SITU.HAND_RANGE) continue;
    let dx = p.x - d.x, dy = p.y - d.y, reach = 0.85 + 0.75*Math.max(d.hand, d.h);
    if ((own === true || d === own) && d.hx !== undefined) { dx = d.hx - d.x; dy = d.hy - d.y; reach = Math.hypot(dx, dy); }
    const dl = Math.hypot(dx, dy) || 1;
    reach = Math.min(reach, SITU.ARM*0.95);
    const up = Math.max(d.hand, d.jumpT >= 0 ? 1 : 0), shoulder = d.stand - SITU.ARM;
    const z0 = SITU.HAND_LOW + (shoulder + Math.sqrt(SITU.ARM*SITU.ARM - reach*reach) - SITU.HAND_LOW)*up;
    const jumpStart = d.jumpT >= 0 ? -d.jumpT : (d.jumpAt !== null && shotT !== null ? Math.max(0, (d.jumpAt - shotT)/1000) : null);
    out.push({ r: SITU.HAND_R, hx: d.x + dx/dl*reach, hy: d.y + dy/dl*reach, vx: d.vx, vy: d.vy, z0, jumpStart, sx: d.x, sy: d.y, sz: shoulder, i });   // i: which of defs this is
  }
  return out;
}
function handPath({ r, hx, hy, vx, vy, z0, jumpStart, sx, sy, sz }) {
  return { r, at: t => {
    if (t > SITU.ARM_FOR) return null;                              // a ball that comes back out later is a loose ball, not a block
    const tt = Math.min(t, 0.35), jt = jumpStart === null ? -1 : t - jumpStart;
    const up = jt >= 0 && jt < SITU.JUMP_T ? SITU.HAND_JUMP*Math.sin(Math.PI*jt/SITU.JUMP_T) : 0;
    return { x: hx + vx*tt, y: hy + vy*tt, z: z0 + up, from: { x: sx + vx*tt, y: sy + vy*tt, z: sz + up } };
  } };
}
const handPaths = (p, defs, shotT, own) => handSpecs(p, defs, shotT, own).map(handPath);

const SIT_EXPORTS = { SITU, frame, isThree, shotContext, combine, jumperContestOne, jumperContest, floaterContestOne, floaterContest,
                       cleanLook, finishScatter, handSpecs, handPath, handPaths };
if (typeof module !== "undefined") module.exports = SIT_EXPORTS;
else window.SituationLib = SIT_EXPORTS;
