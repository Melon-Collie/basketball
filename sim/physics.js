// Shot physics: milestone 1 of the design doc.
// Pure and deterministic: the same launch always produces the same path.
// Units: feet, seconds. x/y on the court (y = 0 is the baseline), z up.

const PHYS = {
  G: 32.17,
  RIM: { x: 25, y: 5.25, z: 10.0, r: 0.75, tube: 0.026 },   // 18 in inner diameter, 5/8 in tube
  BOARD: { y: 4.0, x0: 22, x1: 28, z0: 9.5, z1: 13.0 },     // front face 15 in behind rim center
  BALL_R: 0.39,                                             // 4.7 in
  E_RIM: 0.6, MU_RIM: 0.3,                                  // starting values, to tune
  E_BOARD: 0.75, MU_BOARD: 0.2,
  E_FLOOR: 0.75, MU_FLOOR: 0.1,
  DT: 0.001, DT_NEAR: 0.0005, DT_FAR: 0.01,                 // finer steps near the rim, big ones far from it
  T_MAX: 3.5,
  NET_DEPTH: 0.6,                                           // make confirmed this far below the rim, still inside
};

const v3 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, k) => ({ x: a.x*k, y: a.y*k, z: a.z*k }),
  dot: (a, b) => a.x*b.x + a.y*b.y + a.z*b.z,
  len: a => Math.hypot(a.x, a.y, a.z),
};

// Bounce off a surface with outward normal n: restitution on the normal part, Coulomb friction on the rest.
function bounce(vel, n, e, mu) {
  const vn = v3.dot(vel, n);
  if (vn >= 0) return vel;                                   // already separating
  const velN = v3.mul(n, vn), velT = v3.sub(vel, velN), tl = v3.len(velT);
  const jn = -(1 + e)*vn;                                    // normal impulse per unit mass
  const tScale = tl > 1e-9 ? Math.max(0, 1 - mu*jn/tl) : 0;  // friction can stop sliding, never reverse it
  return v3.add(v3.mul(velT, tScale), v3.mul(velN, -e));
}

// Ideal launch speed through `target` from `from` at elevation `elev` (radians). Null if unreachable.
function idealSpeed(from, target, elev) {
  const d = Math.hypot(target.x - from.x, target.y - from.y), dz = target.z - from.z;
  const denom = 2*Math.cos(elev)**2*(d*Math.tan(elev) - dz);
  return denom > 0 ? Math.sqrt(PHYS.G*d*d/denom) : null;
}

// Build a launch velocity: speed, elevation (radians), and a horizontal heading toward `target`
// rotated by `azimuthOffset` (radians, positive = to the shooter's right).
function launchVelocity(from, target, speed, elev, azimuthOffset = 0) {
  const h = Math.atan2(target.y - from.y, target.x - from.x) + azimuthOffset;  // with y growing away from the baseline, the shooter's right is +angle
  return { x: Math.cos(h)*Math.cos(elev)*speed, y: Math.sin(h)*Math.cos(elev)*speed, z: Math.sin(elev)*speed };
}

function rimContact(c) {
  const R = PHYS.RIM, dx = c.x - R.x, dy = c.y - R.y, hl = Math.hypot(dx, dy);
  const ux = hl > 1e-9 ? dx/hl : 1, uy = hl > 1e-9 ? dy/hl : 0;
  const p = { x: R.x + ux*R.r, y: R.y + uy*R.r, z: R.z };   // closest point on the ring
  const d = v3.sub(c, p), dist = v3.len(d), reach = PHYS.BALL_R + R.tube;
  if (dist >= reach) return null;
  return { p, n: v3.mul(d, 1/(dist || 1e-9)), depth: reach - dist };
}

function boardContact(c) {
  const B = PHYS.BOARD;
  if (c.y - PHYS.BALL_R >= B.y || c.y < B.y - 0.5) return null;          // in front of the face, or long gone behind it
  if (c.x < B.x0 || c.x > B.x1 || c.z < B.z0 || c.z > B.z1) return null;  // edges ignored for now
  return { n: { x: 0, y: 1, z: 0 }, depth: B.y + PHYS.BALL_R - c.y };
}

// Simulate a whole shot. Returns the path (every ~10 ms), the contact log, and the outcome.
function simulateShot(launch, opts = {}) {
  const R = PHYS.RIM;
  let c = { ...launch.pos }, vel = { ...launch.vel }, t = 0;
  const path = [{ t, ...c }], contacts = [];
  let wentIn = false, made = false, madeAt = null, sinceSample = 0, floorBounces = 0, blocked = false, goaltend = false;
  const hands = opts.hands || [];                            // defenders' hands: { at: t => {x, y, z}, r }
  let maxSpeedAfter = [];                                    // for the energy check
  while (t < (opts.tMax ?? PHYS.T_MAX)) {
    const hR = Math.hypot(c.x - R.x, c.y - R.y);
    const nearRim = hR < 2 && Math.abs(c.z - R.z) < 1.5;
    const far = hR > 3.2 && c.z > 1.5;                       // nothing to hit out here: take big steps
    const dt = nearRim ? PHYS.DT_NEAR : far ? PHYS.DT_FAR : PHYS.DT;
    const prevZ = c.z;
    c = { x: c.x + vel.x*dt, y: c.y + vel.y*dt, z: c.z + vel.z*dt - 0.5*PHYS.G*dt*dt };   // exact free flight
    vel = { x: vel.x, y: vel.y, z: vel.z - PHYS.G*dt };
    t += dt;

    const rc = rimContact(c);
    if (rc) {
      const before = v3.len(vel);
      c = v3.add(c, v3.mul(rc.n, rc.depth));
      vel = bounce(vel, rc.n, PHYS.E_RIM, PHYS.MU_RIM);
      const last = contacts[contacts.length - 1];
      if (!last || last.type !== "rim" || t - last.t > 0.02) contacts.push({ type: "rim", t, x: rc.p.x, y: rc.p.y, z: rc.p.z, before, after: v3.len(vel) });
      else last.after = v3.len(vel);
    }
    const bc = boardContact(c);
    if (bc && vel.y < 0) {
      const before = v3.len(vel);
      c = v3.add(c, v3.mul(bc.n, bc.depth));
      vel = bounce(vel, bc.n, PHYS.E_BOARD, PHYS.MU_BOARD);
      contacts.push({ type: "board", t, x: c.x, y: PHYS.BOARD.y, z: c.z, before, after: v3.len(vel) });
    }
    // hands: a touch on the way up is a block; on the way down over the rim it's goaltending (counts as a make)
    if (hands.length && !made && !blocked) for (const h of hands) {
      const hp = h.at(t), d = v3.sub(c, hp), dist = v3.len(d), reach = PHYS.BALL_R + (h.r || 0.35);
      if (dist >= reach) continue;
      const before = v3.len(vel);
      if (vel.z < 0 && c.z > R.z && Math.hypot(c.x - R.x, c.y - R.y) < 1.6) {
        goaltend = true; made = true; madeAt = t;
        contacts.push({ type: "goaltend", t, x: hp.x, y: hp.y, z: hp.z, before, after: before });
      } else {
        blocked = true;
        const n = v3.mul(d, 1/(dist || 1e-9));
        c = v3.add(hp, v3.mul(n, reach));
        vel = bounce(vel, n, 0.45, 0.3);                     // swatted: loses most of its pace
        vel.z = Math.min(vel.z, -4);                         // and goes down
        contacts.push({ type: "block", t, x: hp.x, y: hp.y, z: hp.z, before, after: v3.len(vel) });
      }
      break;
    }
    // make detection: down through the rim plane with the center inside the ring, then on into the net
    const hl = Math.hypot(c.x - R.x, c.y - R.y);
    if (prevZ >= R.z && c.z < R.z && vel.z < 0) wentIn = hl < R.r;
    if (wentIn && c.z > R.z) wentIn = false;                 // popped back out
    if (!made && !blocked && wentIn && c.z <= R.z - PHYS.NET_DEPTH && hl < R.r) {
      made = true; madeAt = t;
      vel = v3.mul(vel, 0.3);                               // the net takes the pace off
    }
    if (c.z - PHYS.BALL_R < 0) {
      c.z = PHYS.BALL_R;
      const before = v3.len(vel);
      vel = bounce(vel, { x: 0, y: 0, z: 1 }, PHYS.E_FLOOR, PHYS.MU_FLOOR);
      contacts.push({ type: "floor", t, x: c.x, y: c.y, z: 0, before, after: v3.len(vel) });
      if (++floorBounces >= (opts.floorBounces ?? 2)) break;
    }
    if (opts.quick && (made || (c.z < R.z - 1.5 && vel.z < 0))) break;   // outcome decided: stop early
    sinceSample += dt;
    if (sinceSample >= 0.01) { path.push({ t, ...c }); sinceSample = 0; }
  }
  path.push({ t, ...c });
  return { path, contacts, made, madeAt, blocked, goaltend, label: labelFor(launch, contacts, made, madeAt) };
}

function labelFor(launch, contacts, made, madeAt) {
  const early = contacts.filter(k => k.type !== "floor" && (madeAt === null || k.t <= madeAt));
  const R = PHYS.RIM;
  if (contacts.some(k => k.type === "goaltend")) return "Goaltending";
  if (contacts.some(k => k.type === "block")) return "Blocked";
  if (made) {
    if (!early.length) return "Swish";
    return early[0].type === "board" ? "Bank" : "In off the rim";
  }
  const hits = contacts.filter(k => k.type !== "floor");
  if (!hits.length) return "Airball";
  const first = hits[0];
  if (first.type === "board") return "Off the glass";
  // which part of the rim: along the shot's horizontal direction
  const ux = R.x - launch.pos.x, uy = R.y - launch.pos.y, ul = Math.hypot(ux, uy) || 1;
  const along = ((first.x - R.x)*ux + (first.y - R.y)*uy)/ul/R.r;
  const rimHits = hits.filter(k => k.type === "rim").length;
  if (rimHits >= 2) return "In and out";
  if (along < -0.5) return "Front rim";
  if (along > 0.5) return "Back iron";
  return "Off the side";
}

if (typeof module !== "undefined") module.exports = { PHYS, v3, bounce, idealSpeed, launchVelocity, simulateShot, rimContact };
else window.PhysicsLib = { PHYS, v3, bounce, idealSpeed, launchVelocity, simulateShot, rimContact };
