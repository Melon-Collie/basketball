// Tests for the shot situation rules: context, contests, clean looks, finishing scatter and defenders' hands.
const SIT = (typeof module !== "undefined") ? require("./situation.js") : window.SituationLib;
const PS = (typeof module !== "undefined") ? require("./physics.js") : window.PhysicsLib;
const RIMS = { x: PS.PHYS.RIM.x, y: PS.PHYS.RIM.y };

const situationTests = [];
function stest(name, fn) { situationTests.push({ name, fn }); }
function check(cond, msg) { if (!cond) throw new Error(msg); }
const near = (got, want, tol = 1e-6) => Math.abs(got - want) <= tol;

// a player `dist` ft straight out from the rim, moving `toward` ft/s at it and `side` ft/s to their right
function at(dist, toward = 0, side = 0) { return { x: RIMS.x, y: RIMS.y + dist, vx: side, vy: -toward }; }
// a defender `d` ft from the shooter, `angle` degrees off the shot line (0 = between shooter and rim, 180 = behind)
function defender(p, d, opts = {}) {
  const f = SIT.frame(p), a = (opts.angle || 0)*Math.PI/180;
  const dx = f.u.x*Math.cos(a) + f.r.x*Math.sin(a), dy = f.u.y*Math.cos(a) + f.r.y*Math.sin(a);
  return { x: p.x + dx*d, y: p.y + dy*d, vx: 0, vy: 0, hand: 0, h: 0, land: 0, len: 1, jumpT: -1, jumpAt: null, stand: 8.2, ...opts };
}
const DRIBBLING = { state: "none" };

stest("Context follows the design doc's table, in order", () => {
  const kind = (p, hold = DRIBBLING) => SIT.shotContext(p, hold).kind;
  const rows = [
    ["standing 3 ft", kind(at(3)), "layup"],
    ["driving 6 ft", kind(at(6, 10)), "layup"],
    ["driving 8.5 ft", kind(at(8.5, 10)), "floater"],
    ["driving 13 ft", kind(at(13, 10)), "floater"],
    ["driving 15 ft", kind(at(15, 10)), "jumper"],
    ["standing 10 ft", kind(at(10)), "jumper"],
    ["drifting 10 ft at 3 ft/s", kind(at(10, 3)), "jumper"],
    ["strafing 10 ft", kind(at(10, 0, 10)), "jumper"],
  ];
  for (const [name, got, want] of rows) check(got === want, `${name}: ${got}, expected ${want}`);
  // a dunk is never the answer here: it is what a finish becomes when it is let go with the hand over the rim
  check(rows.every(r => r[1] !== "dunk"), "context should not name a dunk");
  return `${rows.length} situations`;
});

stest("Gather steps count as driving and reach 9 ft; a dead dribble is a set shot unless you step through", () => {
  const steps = { state: "steps" };
  check(SIT.shotContext(at(8.5), steps).kind === "layup", "gather steps at 8.5 ft should be a layup");
  check(SIT.shotContext(at(12), steps).kind === "floater", "gather steps at 12 ft should be a floater");
  const p = at(7), toRim = { state: "pivot", pivot: { x: p.x, y: p.y }, free: { x: p.x, y: p.y - 2 }, ext: 1.5 };
  const away = { ...toRim, free: { x: p.x, y: p.y + 2 } }, short = { ...toRim, ext: 1.0 };
  check(SIT.shotContext(p, { state: "pivot", pivot: null, free: null, ext: 0 }).kind === "jumper", "dead dribble at 7 ft should be a set shot");
  const through = SIT.shotContext(p, toRim);
  check(through.kind === "layup" && through.note === "Step-through finish", `step-through: ${through.kind}`);
  check(SIT.shotContext(p, away).kind === "jumper", "free foot away from the rim is not a step-through");
  check(SIT.shotContext(p, short).kind === "jumper", "free foot not extended is not a step-through");
  check(SIT.shotContext(at(9), toRim).kind === "jumper", "step-through past 8 ft should be a set shot");
  check(SIT.shotContext(at(3), { state: "pivot", pivot: null, free: null, ext: 0 }).kind === "layup", "dead dribble inside 4 ft is a finish");
  return "steps, pivot and step-through";
});

stest("Jumper contest: zero beyond 5 ft, 0.85 for a set hand at 1.5 ft, a hand up worth almost 3x a hand down", () => {
  const p = at(20), c = (d, o) => SIT.jumperContest(p, [defender(p, d, o)]).c;
  check(c(5, { hand: 1 }) === 0 && c(8, { hand: 1 }) === 0, "should be zero at 5 ft and beyond");
  check(near(c(1.5, { hand: 1 }), 0.85), `set hand at 1.5 ft: ${c(1.5, { hand: 1 })}`);
  const ratio = c(2.5, { hand: 1 })/c(2.5, { hand: 0 });
  check(near(ratio, 1/0.35), `hand up vs down: ${ratio}`);
  check(c(4, { hand: 1 }) < 0.15 && c(2, { hand: 1 }) > 0.6, `4 ft should barely matter and 2 ft should: ${c(4, { hand: 1 })}, ${c(2, { hand: 1 })}`);
  return `4 ft ${c(4, { hand: 1 }).toFixed(2)}, 3 ft ${c(3, { hand: 1 }).toFixed(2)}, 2 ft ${c(2, { hand: 1 }).toFixed(2)}, 1.5 ft ${c(1.5, { hand: 1 }).toFixed(2)}; hand down at 2 ft ${c(2, { hand: 0 }).toFixed(2)}`;
});

stest("Jumper contest: weaker from behind, stronger closing, weaker just after landing, scaled by length", () => {
  const p = at(20), c = o => SIT.jumperContest(p, [defender(p, 2.5, { hand: 1, ...o })]).c, base = c({});
  check(near(c({ angle: 180 }), base*0.25), `from behind: ${c({ angle: 180 })} vs ${base}`);
  const closing = c({ vx: 0, vy: 12 });                       // straight at a shooter who is up the floor from them
  check(near(closing, base*1.2/0.85), `closing at 12 ft/s: ${closing} vs ${base}`);
  check(near(c({ h: 1, hand: 0, land: 0.2 }), base*(0.35 + 0.65*0.3)), "just landed should keep 30% of the hand");
  check(near(c({ len: 1.2 }), base*1.2) && near(c({ len: 0.7 }), base*0.7), "length should scale the contest");
  return `set ${base.toFixed(2)}, behind ${c({ angle: 180 }).toFixed(2)}, closing ${closing.toFixed(2)}, just landed ${c({ h: 1, hand: 0, land: 0.2 }).toFixed(2)}`;
});

stest("Several defenders combine as 1 - prod(1 - c), keeping the strongest one's details", () => {
  const p = at(20), a = defender(p, 2.5, { hand: 1 }), b = defender(p, 3.5, { hand: 1, angle: 40 });
  const ca = SIT.jumperContest(p, [a]).c, cb = SIT.jumperContest(p, [b]).c, both = SIT.jumperContest(p, [a, b]);
  check(near(both.c, 1 - (1 - ca)*(1 - cb)), `combined ${both.c}`);
  check(near(both.d, 2.5), `strongest defender should be the one at 2.5 ft, got ${both.d}`);
  check(SIT.jumperContest(p, []).c === 0, "nobody around should be zero");
  return `${ca.toFixed(2)} and ${cb.toFixed(2)} make ${both.c.toFixed(2)}`;
});

stest("Floater contest: the arc clears anyone 4 ft away, and closing speed doesn't matter", () => {
  const p = at(10, 8), c = (d, o) => SIT.floaterContest(p, [defender(p, d, { hand: 1, ...o })]).c;
  check(c(4) === 0, "should be zero at 4 ft");
  check(near(c(1.5), 1), `set hand at 1.5 ft: ${c(1.5)}`);
  check(near(c(2.5, { vy: 12 }), c(2.5)), "closing speed should not change a floater contest");
  check(c(3) < SIT.jumperContest(p, [defender(p, 3, { hand: 1 })]).c, "at 3 ft a floater should be less contested than a jumper");
  return `3 ft ${c(3).toFixed(2)}, 2.5 ft ${c(2.5).toFixed(2)}, 2 ft ${c(2).toFixed(2)}`;
});

stest("Rim contest: shielding the ball helps, finishing into the defender hurts, and a jump beats standing", () => {
  const p = at(4, 10), big = o => defender(p, 2.4, { angle: 35, stand: 8.9, len: 1.2, ...o });   // to the shooter's right
  const c = (side, o) => SIT.rimContest(p, [big(o)], side).c;
  check(c(-1) < c(0) && c(0) < c(1), `away ${c(-1)}, middle ${c(0)}, into ${c(1)}`);
  check(c(0, { h: 1 }) > c(0) && c(0, { land: 0.3 }) < c(0), "airborne should beat standing, and just landed should be weakest");
  check(c(0, { vx: 8, vy: 0 }) < c(0), "arriving late should be weaker than set");
  check(SIT.rimContest(p, [defender(p, 2.4, { angle: 180, len: 1.2 })], 0).c < 0.5*c(0), "a chase-down should be much weaker");
  return `standing: away ${c(-1).toFixed(2)}, middle ${c(0).toFixed(2)}, into ${c(1).toFixed(2)}; at the peak of a jump ${c(0, { h: 1 }).toFixed(2)}; just landed ${c(0, { land: 0.3 }).toFixed(2)}`;
});

stest("A clean look needs nobody within 8 ft, feet set, and no fade", () => {
  const p = at(24), cl = (d, speed = 0, fade = false) => SIT.cleanLook(p, [defender(p, d)], fade, speed);
  check(cl(8) === 1 && cl(12) === 1 && SIT.cleanLook(p, [], false, 0) === 1, "wide open and set should be fully clean");
  check(cl(5) === 0 && cl(3) === 0, "a defender within 5 ft is never clean");
  check(near(cl(6.5), 0.5), `halfway in: ${cl(6.5)}`);
  check(cl(10, 3) === 0 && cl(10, 1) === 1 && near(cl(10, 2), 0.5), "movement should phase out between 1 and 3 ft/s");
  check(cl(10, 0, "back") === 0, "a fade is never clean");
  return "ramps from 5 to 8 ft and from 3 to 1 ft/s";
});

stest("Finishing scatter: speed past the control limit, cutting back, hang and euro steps all cost", () => {
  const fs = o => SIT.finishScatter({ speed: 10, vPerp: 0, side: 0, hangMs: 0, euro: 0, contest: 0, limit: 11.4, ...o });
  const base = fs({});
  check(near(base.limit, 11.4) && near(base.parts[0], 2.475) && base.parts[1] === 0 && base.parts[2] === 0, `base: ${JSON.stringify(base)}`);
  check(near(fs({ speed: 13.4 }).parts[2], 0.7), "2 ft/s over the limit should cost 0.7 in");
  check(near(fs({ hangMs: 200 }).parts[1], 1.8), "200 ms of hang should cost 1.8 in");
  check(near(fs({ euro: 2 }).parts[1], 1.2), "a 2 ft euro step should cost 1.2 in");
  check(near(fs({ side: 1 }).parts[1], 0.8), "finishing at the side of the rim should cost 0.8 in");
  check(near(fs({ side: 1, vPerp: -6 }).parts[1], 3.0) && near(fs({ side: 1, vPerp: 6 }).parts[1], 0.8), "cutting back across your momentum should cost 2.2 in more");
  check(near(fs({ contest: 1 }).parts[3], 3.5), "a full contest should add 3.5 in");
  check(near(fs({ limit: 9, speed: 11 }).parts[2], 0.7) && fs({ limit: 13, speed: 11 }).parts[2] === 0, "the limit is the speed it is given: 2 ft/s over a 9 ft/s limit costs, and 11 ft/s under a 13 ft/s one does not");
  return `limit ${base.limit.toFixed(1)} ft/s; floor ${base.parts[0].toFixed(2)} in`;
});

stest("Arms: only within 7 ft, a fixed length from the shoulder, lifted by a jump in progress or scheduled", () => {
  const p = at(20), ARM = SIT.SITU.ARM;
  const top = (stand, reach) => stand - ARM + Math.sqrt(ARM*ARM - reach*reach);   // hand height with the arm up and that far out
  check(SIT.handPaths(p, [defender(p, 7.5, { hand: 1 })], null).length === 0, "a defender past 7 ft has no hand in the shot");
  const z = (o, t = 0, shotT = null) => SIT.handPaths(p, [defender(p, 3, o)], shotT)[0].at(t).z;
  check(near(top(8.2, 0), 8.2), "straight up, the hand is at standing reach");
  check(near(z({ hand: 0 }), 6.2) && near(z({ hand: 1 }), top(8.2, 1.6)) && near(z({ hand: 1, stand: 8.9 }), top(8.9, 1.6)), `hand down is 6.2 ft; up and 1.6 ft out it is ${top(8.2, 1.6).toFixed(2)}, not the full 8.2: ${z({ hand: 1 }).toFixed(2)}`);
  check(near(z({ jumpT: 0.25, h: 1 }), top(8.2, 1.6) + 2.2), `peak of a jump: ${z({ jumpT: 0.25, h: 1 })}`);
  check(near(z({ jumpT: 0.1, h: 0.6 }, 0.4), top(8.2, 1.3)), "the hand should be back down once the jump is over");
  check(near(z({ hand: 1, jumpAt: 300 }, 0.1, 100), top(8.2, 1.6)) && near(z({ hand: 1, jumpAt: 300 }, 0.45, 100), top(8.2, 1.6) + 2.2), "a scheduled jump should start on time");
  check(near(z({ hand: 1, jumpAt: 300 }, 0.45, null), top(8.2, 1.6)), "a scheduled jump needs a shot in progress");
  const h = SIT.handPaths(p, [defender(p, 3, { hand: 1, vy: 10 })], null)[0];
  check(h.r === 0.3 && near(h.at(0).y, p.y - 3 + 1.6) && near(h.at(0.2).y - h.at(0).y, 2) && near(h.at(0.5).y - h.at(0).y, 3.5), "the hand reaches 1.6 ft toward the shooter and is carried by their motion for 0.35 s");
  check(h.at(0.6) !== null && h.at(0.61) === null, "an arm is only in the shot for 0.6 s: a ball that comes back out later is a loose ball");
  const s0 = h.at(0).from, s1 = h.at(0.2).from;
  check(near(s0.x, p.x) && near(s0.y, p.y - 3) && near(s0.z, 8.2 - ARM) && near(s1.y - s0.y, 2), "the arm starts at the shoulder, over the defender's feet and an arm's length below standing reach, and moves with them");
  // a defender played by a person: the hand goes where they put it, so close in is high and far out is low
  const d = defender(p, 3, { hand: 1 }), mine = (out) => SIT.handPaths(p, [{ ...d, hx: d.x, hy: d.y + out }], null, null);
  const own = out => { const me = { ...d, hx: d.x, hy: d.y + out }; return SIT.handPaths(p, [me], null, me)[0].at(0); };
  check(near(own(0.85).z, top(8.2, 0.85)) && near(own(1.6).z, top(8.2, 1.6)) && own(0.85).z > own(1.6).z + 0.3, `close in ${own(0.85).z.toFixed(2)} ft, far out ${own(1.6).z.toFixed(2)} ft`);
  check(near(own(1.6).y, d.y + 1.6) && near(mine(0.85)[0].at(0).y, d.y + 1.6), "only the defender named as a person's uses the hand they placed");
  check(near(own(9).z, top(8.2, ARM*0.95)), "an arm can't reach further than it is long");
  return `hand 0.85 ft out: ${own(0.85).z.toFixed(2)} ft up; 1.6 ft out: ${own(1.6).z.toFixed(2)} ft`;
});

stest("Geometry: the shot line points at the rim, and the three-point line is 22 ft in the corners and 23.75 above", () => {
  const f = SIT.frame({ x: RIMS.x + 3, y: RIMS.y + 4 });
  check(near(f.dist, 5) && near(f.u.x, -0.6) && near(f.u.y, -0.8) && near(f.r.x, 0.8) && near(f.r.y, -0.6), JSON.stringify(f));
  check(SIT.isThree({ x: 3, y: 8 }) && !SIT.isThree({ x: 3.5, y: 8 }), "corner three is at 22 ft from the middle");
  check(SIT.isThree({ x: 25, y: RIMS.y + 23.75 }) && !SIT.isThree({ x: 25, y: RIMS.y + 23.5 }), "above the break it is 23.75 ft from the rim");
  return "frame and three-point line";
});

if (typeof module !== "undefined" && require.main === module) {
  let pass = 0;
  for (const t of situationTests) {
    try { const info = t.fn(); pass++; console.log(`PASS  ${t.name}\n      ${info || ""}`); }
    catch (e) { console.log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  console.log(`\n${pass}/${situationTests.length} passed`);
  if (pass < situationTests.length) process.exitCode = 1;
}
if (typeof module !== "undefined") module.exports = { situationTests };
else window.SituationTests = { situationTests };
