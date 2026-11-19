// Milestone 1 tests (design doc: "Structure, tests and milestones").
const P = (typeof module !== "undefined") ? require("./physics.js") : window.PhysicsLib;
const { PHYS, idealSpeed, launchVelocity, simulateShot } = P;
const RIM = { x: PHYS.RIM.x, y: PHYS.RIM.y, z: PHYS.RIM.z };
const deg = d => d*Math.PI/180;

// a shooter `dist` ft from the rim center, `angle` degrees off straight-on (positive = to the right of the lane)
function spot(dist, angle = 0, height = 9.0) {
  return { x: RIM.x + Math.sin(deg(angle))*dist, y: RIM.y + Math.cos(deg(angle))*dist, z: height };
}
function shot(from, target, { elev = 48, speedScale = 1, azim = 0 } = {}) {
  const v = idealSpeed(from, target, deg(elev));
  return simulateShot({ pos: from, vel: launchVelocity(from, target, v*speedScale, deg(elev), deg(azim)) }, { quick: true });
}
// small seeded generator so test results are repeatable
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
function gauss(r) { const a = Math.max(1e-9, r()), b = r(); return Math.sqrt(-2*Math.log(a))*Math.cos(2*Math.PI*b); }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function runOne(t) {
  try { const info = t.fn(); return { name: t.name, pass: true, info: info || "" }; }
  catch (e) { return { name: t.name, pass: false, info: e.message }; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// 1. Swishes
test("A perfect launch at the rim center from 15 and 24 ft is a make with no contacts", () => {
  const out = [15, 24].map(d => shot(spot(d), RIM));
  out.forEach((r, i) => assert(r.made && r.label === "Swish", `${[15, 24][i]} ft: ${r.label}`));
  return out.map((r, i) => `${[15, 24][i]} ft: ${r.label}`).join(", ");
});

// 2. Short, long, far off
test("1–2% too slow hits the front rim; 1.5–2% too fast hits the back iron; 5% slow is an airball", () => {
  const from = spot(24), lines = [];
  for (const s of [0.98, 0.99]) {
    const r = shot(from, RIM, { speedScale: s }), first = r.contacts.find(k => k.type !== "floor");
    const along = first ? ((first.x - RIM.x)*(RIM.x - from.x) + (first.y - RIM.y)*(RIM.y - from.y))/Math.hypot(RIM.x - from.x, RIM.y - from.y)/PHYS.RIM.r : 0;
    assert(first && first.type === "rim" && along < -0.3, `${s}: first contact not the front rim (${r.label})`);
    lines.push(`${Math.round((s - 1)*100)}%: ${r.label}`);
  }
  for (const s of [1.015, 1.02]) {
    const r = shot(from, RIM, { speedScale: s }), first = r.contacts.find(k => k.type !== "floor");
    const along = first ? ((first.x - RIM.x)*(RIM.x - from.x) + (first.y - RIM.y)*(RIM.y - from.y))/Math.hypot(RIM.x - from.x, RIM.y - from.y)/PHYS.RIM.r : 0;
    assert(first && (first.type === "board" || along > 0.3), `+${((s - 1)*100).toFixed(1)}%: first contact not the back of the rim (${r.label})`);
    lines.push(`+${((s - 1)*100).toFixed(1)}%: ${r.label}`);
  }
  const far = shot(from, RIM, { speedScale: 0.95 });
  assert(far.label === "Airball", `-5%: ${far.label}`);
  lines.push(`-5%: ${far.label}`);
  return lines.join(", ");
});

// 3. Bank shots: best glass target from each angle, then how robust it is to small errors
function bestBank(angle, dist = 12) {
  const from = spot(dist, angle);
  let best = null;
  for (let zt = 10.2; zt <= 12.2; zt += 0.2) {
    for (let dx = -1.6; dx <= 1.6; dx += 0.2) {
      const target = { x: RIM.x + dx, y: PHYS.BOARD.y + PHYS.BALL_R, z: zt };
      const v = idealSpeed(from, target, deg(50)); if (!v) continue;
      let makes = 0; const r = rng(7);
      for (let i = 0; i < 20; i++) {
        const res = simulateShot({ pos: from, vel: launchVelocity(from, target, v*(1 + 0.012*gauss(r)), deg(50 + 0.8*gauss(r)), deg(0.8*gauss(r))) }, { quick: true });
        if (res.made && res.contacts[0] && res.contacts[0].type === "board") makes++;
      }
      if (!best || makes > best.makes) best = { makes, target, from, v };
    }
  }
  return best;
}
function directRate(from, n = 300) {
  const v = idealSpeed(from, RIM, deg(50)), r = rng(99); let m = 0;
  for (let i = 0; i < n; i++) if (simulateShot({ pos: from, vel: launchVelocity(from, RIM, v*(1 + 0.012*gauss(r)), deg(50 + 0.8*gauss(r)), deg(0.8*gauss(r))) }, { quick: true }).made) m++;
  return m/n;
}
function bankRate(b, n = 300) {
  const r = rng(99); let m = 0;
  for (let i = 0; i < n; i++) {
    const res = simulateShot({ pos: b.from, vel: launchVelocity(b.from, b.target, b.v*(1 + 0.012*gauss(r)), deg(50 + 0.8*gauss(r)), deg(0.8*gauss(r))) }, { quick: true });
    if (res.made && res.contacts[0] && res.contacts[0].type === "board") m++;
  }
  return m/n;
}
test("From 45°, banking beats shooting at the rim; straight on, it doesn't", () => {
  const wing = bestBank(45), front = bestBank(0);
  const wb = bankRate(wing), wd = directRate(wing.from), fb = bankRate(front), fd = directRate(front.from);
  assert(wb > wd, `45°: bank ${Math.round(wb*100)}% vs direct ${Math.round(wd*100)}%`);
  assert(fb <= fd, `straight on: bank ${Math.round(fb*100)}% vs direct ${Math.round(fd*100)}%`);
  return `12 ft with small errors: 45° bank ${Math.round(wb*100)}% vs direct ${Math.round(wd*100)}%; straight on bank ${Math.round(fb*100)}% vs direct ${Math.round(fd*100)}%`;
});

test("The backboard has a back: a ball thrown at the rim from behind it comes off the back of the glass", () => {
  // from under the baseline side of the board, at the rim: the board is in the way
  const from = { x: RIM.x, y: PHYS.BOARD.y - 2.5, z: 9.0 };
  const r = shot(from, RIM, { elev: 60 });
  const hit = r.contacts[0];
  assert(!r.made && hit && hit.type === "board" && hit.back && r.label === "Off the back of the backboard", `straight at it from behind: ${r.label}`);
  assert(r.path.every(q => q.y < PHYS.BOARD.y - PHYS.BOARD.thick - PHYS.BALL_R + 0.02 || q.z < PHYS.BOARD.z0 || q.z > PHYS.BOARD.z1 || q.x < PHYS.BOARD.x0 || q.x > PHYS.BOARD.x1), "the ball got through the glass");
  // faster and flatter, to be sure it cannot tunnel through
  const hard = simulateShot({ pos: from, vel: { x: 0, y: 38, z: 9 } }, { quick: true });
  assert(hard.contacts[0] && hard.contacts[0].back && hard.path[hard.path.length - 1].y < PHYS.BOARD.y, "a hard throw at the back of the board went through it");
  // from the corner on the baseline the board is not in the way, and the front face is as it was
  const corner = shot({ x: RIM.x + 20, y: 1.5, z: 9.0 }, RIM);
  assert(corner.made, `from the baseline corner: ${corner.label}`);
  const bank = shot(spot(8, 45), { x: RIM.x + 1.2, y: PHYS.BOARD.y + PHYS.BALL_R, z: 11.2 });
  assert(bank.contacts[0] && bank.contacts[0].type === "board" && !bank.contacts[0].back, "a bank from the front should hit the front face");
  return `from behind: ${r.label}; from the baseline corner: ${corner.label}`;
});

// 4. In-and-outs exist
test("Small sideways errors produce some rim contacts that fall out", () => {
  const from = spot(20), r = rng(11), counts = {};
  for (let i = 0; i < 400; i++) {
    const res = shot(from, RIM, { speedScale: 1 + 0.01*gauss(r), azim: 1.2*gauss(r) });
    counts[res.label] = (counts[res.label] || 0) + 1;
  }
  assert((counts["In and out"] || 0) > 0, "no in-and-outs in 400 shots");
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
});

// 5. Determinism
test("The same launch produces the identical path", () => {
  const a = shot(spot(22, 20), RIM, { speedScale: 1.01, azim: 0.7 }), b = shot(spot(22, 20), RIM, { speedScale: 1.01, azim: 0.7 });
  assert(JSON.stringify(a) === JSON.stringify(b), "paths differ");
  return `${a.path.length} samples, identical`;
});

// 6. Energy
test("No bounce ever gains speed", () => {
  const r = rng(3); let n = 0;
  for (let i = 0; i < 300; i++) {
    const res = shot(spot(8 + 18*r(), -60 + 120*r()), RIM, { speedScale: 1 + 0.04*gauss(r), azim: 2*gauss(r), elev: 40 + 20*r() });
    for (const k of res.contacts) { n++; assert(k.after <= k.before + 1e-6, `${k.type} contact gained speed: ${k.before.toFixed(2)} to ${k.after.toFixed(2)}`); }
  }
  return `${n} contacts checked`;
});

// ---------- Milestone 5 ----------
function handAt(x, y, z0, rise = 0, dur = 0.5) {   // a hand at (x, y), rising by `rise` ft over `dur` s
  return { r: 0.35, at: t => ({ x, y, z: z0 + rise*Math.sin(Math.PI*Math.min(t, dur)/dur) }) };
}
test("Nothing comes to rest on the rim: a ball set down on it, or wedged against the glass, rolls off", () => {
  const R = PHYS.RIM, B = PHYS.BOARD, full = { tMax: 8, floorBounces: 3 };
  // when the ball was last up at the rim's height, and where it finished
  const down = res => { const high = res.path.filter(q => q.z > R.z - 0.2); return { last: high.length ? high[high.length - 1].t : 0, end: res.path[res.path.length - 1] }; };
  const setDown = pos => down(simulateShot({ pos, vel: { x: 0, y: 0, z: 0 } }, full));
  // lowered onto the top of the ring, a hair to one side of dead center: the old model held it there until time ran out
  const sides = [-0.01, 0.01].map(off => setDown({ x: R.x + R.r + off, y: R.y, z: R.z + PHYS.BALL_R + 0.05 }));
  for (const r of sides) assert(r.last < 2 && r.end.z < 2, `set down on the ring's top it was still up there at ${r.last.toFixed(1)} s, and ended at ${r.end.z.toFixed(1)} ft`);
  // dropped into the gap behind the rim, touching the glass, just off the middle
  const w = setDown({ x: R.x + 0.03, y: B.y + PHYS.BALL_R + 0.01, z: R.z + 0.6 });
  assert(w.last < 4 && w.end.z < 2, `wedged behind the rim it was still up there at ${w.last.toFixed(1)} s, and ended at ${w.end.z.toFixed(1)} ft`);
  // and over a run of ordinary shots that catch the rim, none is still up there three and a half seconds later
  const r = rng(8); let longest = 0, n = 0;
  for (let i = 0; i < 1500; i++) {
    const from = spot(6 + 20*r(), -60 + 120*r()), elev = deg(42 + 14*r()), v = idealSpeed(from, RIM, elev);
    const res = simulateShot({ pos: from, vel: launchVelocity(from, RIM, v*(1 + 0.012*gauss(r)), elev, deg(0.9*gauss(r))) }, full);
    const first = res.contacts.find(k => k.type === "rim"); if (!first || res.made) continue;
    n++; longest = Math.max(longest, down(res).last - first.t);
  }
  assert(n > 300 && longest < 3.5, `${n} shots came off the rim, and one stayed up for ${longest.toFixed(1)} s`);
  return `set on the ring: down in ${sides.map(x => x.last.toFixed(1)).join(" and ")} s; wedged: ${w.last.toFixed(1)} s; longest of ${n} misses off the rim: ${longest.toFixed(1)} s`;
});

test("A hand in the ball's path on the way up blocks it", () => {
  const from = spot(15), v = idealSpeed(from, RIM, deg(48));
  const L = { pos: from, vel: launchVelocity(from, RIM, v, deg(48), 0) };
  // where the ball is 0.12 s after release
  const t = 0.12, px = from.x + L.vel.x*t, py = from.y + L.vel.y*t, pz = from.z + L.vel.z*t - 0.5*PHYS.G*t*t;
  const res = simulateShot(L, { hands: [{ r: 0.35, at: () => ({ x: px, y: py, z: pz }) }] });
  assert(res.label === "Blocked" && !res.made, `got ${res.label}`);
  const clear = simulateShot(L, { hands: [handAt(px, py, 8.0)] });   // a hand that stays low misses the ball
  assert(clear.made, `low hand still blocked: ${clear.label}`);
  return `hand in the path: ${res.label}; hand at 8 ft: ${clear.label}`;
});
test("An arm is solid from shoulder to hand: a ball that would pass under the hand hits the forearm", () => {
  const from = spot(15), v = idealSpeed(from, RIM, deg(48));
  const L = { pos: from, vel: launchVelocity(from, RIM, v, deg(48), 0) };
  const t = 0.12, px = from.x + L.vel.x*t, py = from.y + L.vel.y*t, pz = from.z + L.vel.z*t - 0.5*PHYS.G*t*t;
  const hand = { x: px, y: py, z: pz + 1.2 };                        // the hand is well above where the ball passes
  const handOnly = simulateShot(L, { hands: [{ r: 0.3, at: () => hand }] });
  const withArm = simulateShot(L, { hands: [{ r: 0.3, at: () => ({ ...hand, from: { x: px, y: py - 0.3, z: pz - 1.4 } }) }] });
  assert(handOnly.made && !handOnly.tipped, `a hand 1.2 ft above the ball should not touch it: ${handOnly.label}`);
  assert(withArm.blocked && !withArm.made && withArm.touchBy === 0 && Math.abs(withArm.touchT - t) < 0.05, `the forearm should have stopped it: ${withArm.label}, touched at ${withArm.touchT}`);
  return `hand alone: ${handOnly.label}; with the arm under it: ${withArm.label}`;
});
test("A light touch is a tip: the ball keeps most of its pace and carries on off line", () => {
  const from = spot(15), v = idealSpeed(from, RIM, deg(48));
  const L = { pos: from, vel: launchVelocity(from, RIM, v, deg(48), 0) };
  const t = 0.12, px = from.x + L.vel.x*t, py = from.y + L.vel.y*t, pz = from.z + L.vel.z*t - 0.5*PHYS.G*t*t;
  // a hand to the side of the ball's path, overlapping it by `into` ft
  const beside = into => simulateShot(L, { hands: [{ r: 0.3, at: () => ({ x: px + PHYS.BALL_R + 0.3 - into, y: py, z: pz }) }] });
  const graze = beside(0.06), square = beside(0.5), miss = beside(-0.05);
  const pace = r => r.contacts.find(k => k.type === "hand");
  assert(!miss.tipped && !miss.blocked && miss.made, `a hand just clear of the ball should change nothing: ${miss.label}`);
  assert(graze.tipped && !graze.blocked && pace(graze).after > 0.8*pace(graze).before, `a graze should be a tip that keeps its pace: ${graze.label}, ${pace(graze) && (pace(graze).after/pace(graze).before).toFixed(2)}`);
  assert(square.blocked && !square.made && pace(square).after < 0.8*pace(square).before, `a hand well into the path should block it: ${square.label}`);
  const again = beside(0.06);
  assert(JSON.stringify(again.path) === JSON.stringify(graze.path), "the same touch should give the same path");
  return `clear: ${miss.label}; 0.06 ft in: tipped, ${Math.round(100*pace(graze).after/pace(graze).before)}% of its pace kept, ${graze.label}; 0.5 ft in: ${square.label}`;
});
test("Touching the ball on its way down over the rim is goaltending, and counts", () => {
  const from = spot(15), v = idealSpeed(from, RIM, deg(48));
  const res = simulateShot({ pos: from, vel: launchVelocity(from, RIM, v*0.99, deg(48), 0) }, { hands: [{ r: 0.35, at: () => ({ x: RIM.x, y: RIM.y + 0.9, z: 10.9 }) }] });
  assert(res.label === "Goaltending" && res.made, `got ${res.label}`);
  return res.label;
});

if (typeof module !== "undefined" && require.main === module) {
  const results = tests.map(runOne);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}\n      ${r.info}`);
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
}
if (typeof module !== "undefined") module.exports = { tests, runOne };
else window.PhysicsTests = { tests, runOne, rng, gauss };

