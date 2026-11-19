// Launch model: milestone 2 of the design doc.
// Turns what the player did (aim, timing, carried momentum) and the situation (shot type, contest)
// into a launch for the physics: release point, velocity, and the ideal launch it was built from.
const PL = (typeof module !== "undefined") ? require("./physics.js") : window.PhysicsLib;

const LAUNCH = {
  ELEV: { jumper: 48, floater: 60 },                  // degrees the ball leaves the hand at
  // A layup is let go from anywhere between right under the rim and several feet out, and from low or high in the
  // jump, so no one angle suits it: from close and low, a fixed one runs into the front of the rim. What stays the
  // same is the angle it comes down into the rim at, and the hand finds whatever angle up gives that.
  ENTRY: { layup: 60 },                               // degrees
  REL_Z: { jumper: 9.6, floater: 9.2, layup: 9.6 },   // release height, ft, when nobody says where the ball is: the game does, from the hand
  // ft past the rim's center that a shot is aimed. Up close a ball that is a little long still drops and one that is
  // a little short hits the front of the rim, so the middle of what goes in is behind the center.
  PAST: { jumper: 0, floater: 2/12, layup: 2/12 },
  REL_FWD: 0.7,                                       // release point this far in front of the body, toward the target
  CONTEST_ARC: 6,                                     // degrees of extra arc at full contest
  // Calibrated by calibrateLaunch() so sensitivities match today's model at 24 ft (see below)
  K_SPEED: 0,                                         // fraction of launch speed per ms of post-assist timing error
  F_LAT: 0, F_DEP: 0,                                 // share of body velocity the ball inherits, sideways and along the shot
  // Today's model, the targets for continuity
  OLD: { KT: 0.09, DRIFT_LAT: 1.6, DRIFT_DEP: 1.0 },
};
const RIMC = () => ({ x: PL.PHYS.RIM.x, y: PL.PHYS.RIM.y, z: PL.PHYS.RIM.z });
const rad = d => d*Math.PI/180;

// Where a launch's free flight comes down through rim height, as offsets from the rim center in inches:
// lateral (+ = shooter's right) and depth (+ = long). Pure kinematics, no collisions.
function rimPlaneOffset(L, from) {
  const R = RIMC(), g = PL.PHYS.G;
  const a = -g/2, b = L.vel.z, c = L.pos.z - R.z;
  const disc = b*b - 4*a*c; if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc))/(2*a);                 // the later root: on the way down
  const x = L.pos.x + L.vel.x*t, y = L.pos.y + L.vel.y*t;
  const ux = R.x - from.x, uy = R.y - from.y, ul = Math.hypot(ux, uy);
  const u = { x: ux/ul, y: uy/ul }, r = { x: -u.y, y: u.x };
  const dx = x - R.x, dy = y - R.y;
  return { lat: (dx*r.x + dy*r.y)*12, dep: (dx*u.x + dy*u.y)*12, t };
}

// The angle a shot of this kind leaves the hand at, in degrees. For a layup: the one that brings it down to the
// target at the entry angle, tan(up) = tan(down) + 2*(rise needed)/(distance), and no steeper than 82.
function elevFor(kind, pos, target) {
  if (LAUNCH.ENTRY[kind] === undefined) return LAUNCH.ELEV[kind];
  const d = Math.hypot(target.x - pos.x, target.y - pos.y) || 1e-6;
  return Math.min(82, Math.atan(Math.tan(rad(LAUNCH.ENTRY[kind])) + 2*(target.z - pos.z)/d)*180/Math.PI);
}

// inputs: kind, player {x, y}, aimTheta (radians, + = right), timingMs (post-assist), body {vx, vy}, contest 0..1,
// noise { dv (fraction), de (deg), da (deg) } added on top.
// form: a weight for each kind, adding to 1, in place of one kind: the arc and the aim point are then mixed by weight.
// pos: where the ball leaves from {x, y, z}, if not the usual spot in front of the body.
function buildLaunch(inp) {
  const R = RIMC(), form = inp.form || { [inp.kind || "jumper"]: 1 };
  const mix = of => { let v = 0; for (const k in form) if (form[k] > 0) v += form[k]*of(k); return v; };
  const ux = R.x - inp.player.x, uy = R.y - inp.player.y, ul = Math.hypot(ux, uy) || 1;
  const u = { x: ux/ul, y: uy/ul }, r = { x: -u.y, y: u.x };
  const pos = inp.pos || { x: inp.player.x + u.x*LAUNCH.REL_FWD, y: inp.player.y + u.y*LAUNCH.REL_FWD, z: inp.relZ ?? mix(k => LAUNCH.REL_Z[k]) };
  const past = mix(k => LAUNCH.PAST[k]), target = inp.target || { x: R.x + u.x*past, y: R.y + u.y*past, z: R.z };
  const n = inp.noise || { dv: 0, de: 0, da: 0 };
  const elev = rad(mix(k => elevFor(k, pos, target)) + LAUNCH.CONTEST_ARC*(inp.contest || 0));
  const ideal = PL.idealSpeed(pos, target, elev);
  if (!ideal) return null;
  const speed = ideal*(1 + LAUNCH.K_SPEED*(inp.timingMs || 0) + n.dv);
  const vel = PL.launchVelocity(pos, target, speed, elev + rad(n.de), (inp.aimTheta || 0) + rad(n.da));
  // carried momentum: the ball inherits part of the body's velocity, split into sideways and along-the-shot parts
  const b = inp.body || { vx: 0, vy: 0 };
  const bl = b.vx*r.x + b.vy*r.y, ba = b.vx*u.x + b.vy*u.y;
  vel.x += r.x*bl*LAUNCH.F_LAT + u.x*ba*LAUNCH.F_DEP;
  vel.y += r.y*bl*LAUNCH.F_LAT + u.y*ba*LAUNCH.F_DEP;
  return { pos, vel, ideal, elev, target, from: inp.player };
}

// Set K_SPEED, F_LAT and F_DEP so a jumper from 24 ft responds like today's model:
// 0.09 in of depth per ms, 1.6 in sideways and 1.0 in of depth per ft/s of carried momentum.
function calibrateLaunch(dist = 24) {
  const R = RIMC(), player = { x: R.x, y: R.y + dist };
  const base = () => rimPlaneOffset(buildLaunch({ kind: "jumper", player }), player);
  const o = { K_SPEED: LAUNCH.K_SPEED, F_LAT: LAUNCH.F_LAT, F_DEP: LAUNCH.F_DEP };
  // depth per unit of speed fraction
  LAUNCH.K_SPEED = 1e-4; const dT = rimPlaneOffset(buildLaunch({ kind: "jumper", player, timingMs: 10 }), player).dep - base().dep;
  LAUNCH.K_SPEED = 1e-4*LAUNCH.OLD.KT*10/dT;
  // sideways inheritance: body moving to the shooter's right is +x here (shooter faces -y)
  LAUNCH.F_LAT = 0.1; const dL = rimPlaneOffset(buildLaunch({ kind: "jumper", player, body: { vx: 1, vy: 0 } }), player).lat - base().lat;
  LAUNCH.F_LAT = 0.1*LAUNCH.OLD.DRIFT_LAT/dL;
  LAUNCH.F_DEP = 0.1; const dD = rimPlaneOffset(buildLaunch({ kind: "jumper", player, body: { vx: 0, vy: -1 } }), player).dep - base().dep;
  LAUNCH.F_DEP = 0.1*LAUNCH.OLD.DRIFT_DEP/dD;
  return { before: o, after: { K_SPEED: LAUNCH.K_SPEED, F_LAT: LAUNCH.F_LAT, F_DEP: LAUNCH.F_DEP } };
}
calibrateLaunch();

// The spot on the glass, at lateral position aimX, that banks a perfect shot from here into the rim:
// the middle of the range of heights that work. works = false if no height banks it in from here.
// from: what else is known about the launch: { relZ } or { pos, form }, as buildLaunch takes them.
function glassTarget(player, kind, aimX, from = {}) {
  const B = PL.PHYS.BOARD, y = B.y + PL.PHYS.BALL_R, zs = [];
  for (let z = 10.1; z <= 12.6; z += 0.1) {
    const L = buildLaunch({ kind, player, ...from, target: { x: aimX, y, z } });
    if (!L) continue;
    const r = PL.simulateShot(L, { quick: true });
    if (r.made && r.contacts[0] && r.contacts[0].type === "board") zs.push(z);
  }
  return zs.length ? { target: { x: aimX, y, z: zs[Math.floor(zs.length/2)] }, works: true, range: zs.length*0.1 }
                   : { target: { x: aimX, y, z: 11.2 }, works: false, range: 0 };
}

if (typeof module !== "undefined") module.exports = { LAUNCH, buildLaunch, rimPlaneOffset, calibrateLaunch, glassTarget };
else window.LaunchLib = { LAUNCH, buildLaunch, rimPlaneOffset, calibrateLaunch, glassTarget };
