// Tests for the game as a whole: it is deterministic, it is plain data, and scripted input plays out as designed.
// These run the real rules tick by tick, with no page and no browser.
const GM = require("./game.js");

const gameTests = [];
function gtest(name, fn) { gameTests.push({ name, fn }); }
function check(cond, msg) { if (!cond) throw new Error(msg); }

const RIM = GM.HOOP, AIM = { x: RIM.x, y: RIM.y };            // cursor on the rim: aimed straight at it
const HELD = { ...AIM, shot: true };                             // the same, with the mouse button held down
const ticks = seconds => Math.round(seconds/GM.TICK);
const run = (game, seconds, input = AIM) => { for (let i = 0, n = ticks(seconds); i < n; i++) GM.step(game, input); };
const distance = game => Math.hypot(RIM.x - game.P.x, RIM.y - game.P.y);
const speed = game => Math.hypot(game.P.vx, game.P.vy);
function fresh(seed, { defenders = true } = {}) {
  const game = GM.create({ seed });
  if (!defenders) { GM.setDefender(game, "defOn", false); GM.setDefender(game, "rimOn", false); }
  return game;
}
// hold a key until a condition is met (or a few seconds pass)
function until(game, input, done, limit = 6) { for (let i = 0, n = ticks(limit); i < n && !done(game); i++) GM.step(game, input); return done(game); }
const TOWARD = { ...AIM, u: true };                              // the rim is up the floor from the start spot

// Press the button, hold it, and let it go `ms` after the press: one jump and one release. `air` is what is held
// from the jump on.
function shoot(game, ms, at = AIM, air = at) {
  GM.step(game, { ...at, shot: true });
  for (let i = 1, n = Math.round(ms/1000/GM.TICK); i < n; i++) GM.step(game, { ...air, shot: true });
  GM.step(game, air);
}
const TOP = 517;                                                  // ms after the press: the top of the jump, to the nearest tick

// a little of everything: a jumper, a retreat, a drive into a floater, a gather, a pump fake and a shot off the dead dribble
function session(game, each = () => {}) {
  const go = (seconds, input) => { for (let i = 0, n = ticks(seconds); i < n; i++) { GM.step(game, input); each(game); } };
  const up = (ms, input) => { go(GM.TICK, { ...input, shot: true }); go(ms/1000 - GM.TICK, { ...input, shot: true }); go(GM.TICK, input); };
  go(0.5, AIM); up(TOP, AIM); go(3, AIM);
  go(0.6, { ...AIM, d: true }); go(1.2, { ...TOWARD, x: RIM.x + 2 }); up(450, { ...TOWARD, x: RIM.x + 2 }); go(3, AIM);
  go(0.8, { ...AIM, d: true, l: true }); go(0.3, { ...AIM, x: RIM.x - 6 }); go(0.05, { ...AIM, gather: true }); go(0.4, AIM);
  go(0.08, { ...AIM, shot: true }); go(0.5, AIM); up(TOP, AIM); go(3, AIM);         // a tap is the fake
  return game;
}

gtest("The same seed and inputs give the same game, and a different seed gives a different one", () => {
  const a = JSON.stringify(session(fresh(11))), b = JSON.stringify(session(fresh(11))), c = JSON.stringify(session(fresh(12)));
  check(a === b, "two runs from seed 11 ended in different states");
  check(a !== c, "seeds 11 and 12 ended in the same state");
  const g = session(fresh(11));
  check(g.stats.fga >= 1 && g.stats.fga + g.stats.to >= 3, `the session should take a shot and lose the ball a couple of times: ${g.stats.fga} shots, ${g.stats.to} turnovers`);
  return `${ticks(15.1)} ticks, ${g.stats.fga} shots, ${g.stats.to} turnovers, ${a.length} bytes of state`;
});

gtest("A game is plain data: a copy made mid-shot, or sent as JSON, carries on identically", () => {
  const a = fresh(21); run(a, 0.5); GM.step(a, HELD); run(a, 0.3, HELD);                   // 300 ms into a jump
  check(a.shot.state === "shooting", `expected to be mid-shot, was ${a.shot.state}`);
  const b = structuredClone(a), c = JSON.parse(JSON.stringify(a));
  for (const g of [a, b, c]) { run(g, 0.2, HELD); GM.step(g, AIM); run(g, 3); run(g, 0.8, TOWARD); }
  check(a.last && a.stats.fga === 1, "the shot never resolved");
  check(JSON.stringify(a) === JSON.stringify(b), "the structured clone drifted from the original");
  check(JSON.stringify(a) === JSON.stringify(c), "the JSON copy drifted from the original");
  return `copied 300 ms into a jump; all three ended on ${a.last.out.big} / ${a.last.out.sub}`;
});

gtest("Looking at the odds never changes what happens", () => {
  const a = session(fresh(31)), b = session(fresh(31), g => GM.preview(g));
  const sim = g => JSON.stringify({ ...g, view: null });
  check(sim(a) === sim(b), "previewing every tick changed the game");
  check(JSON.stringify(a.view) !== JSON.stringify(b.view), "the preview should have used its own stream");
  return "previewed every tick; everything outside game.view matched";
});

gtest("Pressing the button jumps and letting it go lets the ball go: at the top of the jump, 517 ms after the press, it is a perfectly timed jumper", () => {
  const g = fresh(41); run(g, 0.5);
  GM.step(g, HELD); run(g, 61*GM.TICK, HELD);
  check(g.shot.state === "shooting" && g.shot.kind === "jumper" && g.P.h > 0.75, `61 ticks after the press: ${g.shot.state} ${g.shot.kind}, ${g.P.h.toFixed(2)} of the way up`);
  GM.step(g, AIM);
  check(g.last && g.last.kind === "jumper" && g.stats.fga === 1, "the release did not register");
  check(Math.abs(g.last.e) <= GM.C.PERFECT_MS && g.last.q === 1, `timing error ${g.last.e.toFixed(1)} ms, quality ${g.last.q}`);
  check(Math.abs(g.last.aim.theta) < 1e-9, `aim was ${g.last.aim.theta}`);
  check(g.last.shift === 0 && g.last.air === 0 && !g.last.fade && !g.last.quick, "a standing jumper goes straight up: no lean, and the line is at the top");
  run(g, 4);
  check(g.shot.state === "idle" && g.ball === null && g.P.up < 0 && g.P.h === 0, `afterwards: ${g.shot.state}, ball ${g.ball ? g.ball.phase : "gone"}, ${g.P.h} up`);
  return `${g.last.e.toFixed(1)} ms from the top, ${g.last.dist.toFixed(1)} ft: ${g.last.out.big} / ${g.last.out.sub}`;
});

gtest("A jump carries half the speed you arrived with, plus up to 5 ft/s the way you lean; nothing steers it after that", () => {
  const air = keys => {
    const g = fresh(45, { defenders: false });
    until(g, TOWARD, x => speed(x) >= 13.4);
    const v0 = speed(g);
    GM.step(g, { ...HELD, ...keys }); run(g, 0.25, { ...HELD, ...keys });
    const v1 = g.P.vy;                                                  // the rim is up the floor: toward it is negative
    run(g, 0.2, { ...HELD, d: true, r: true });                         // in the air now: keys do nothing
    check(Math.abs(g.P.vy - v1) < 1e-9 && Math.abs(g.P.vx) < 1e-9, "the velocity changed in the air");
    return { v0, toward: -v1 };
  };
  const none = air({}), lean = air({ u: true }), stop = air({ d: true });
  check(Math.abs(none.toward - none.v0*GM.C.KEEP) < 0.05, `no keys: ${none.toward.toFixed(2)} ft/s from ${none.v0.toFixed(2)}`);
  check(Math.abs(lean.toward - (lean.v0*GM.C.KEEP + GM.C.LEAN)) < 0.05 && Math.abs(stop.toward - (stop.v0*GM.C.KEEP - GM.C.LEAN)) < 0.05, `leaning in ${lean.toward.toFixed(2)}, leaning back ${stop.toward.toFixed(2)}`);
  // from a standstill, leaning away from the rim is a fadeaway, and its release line is later
  const g = fresh(46, { defenders: false }); run(g, 0.3);
  GM.step(g, { ...HELD, d: true }); run(g, 0.4, { ...HELD, d: true });
  check(Math.abs(g.P.vy - GM.C.LEAN) < 1e-9 && g.shot.line > GM.C.IDEAL + 40 && !g.shot.quick, `standing fade: ${g.P.vy.toFixed(2)} ft/s back, line at ${g.shot.line} ms`);
  run(g, g.shot.line/1000 - 0.4 - 2*GM.TICK, HELD); GM.step(g, AIM);
  check(g.last.fade === "back" && Math.abs(g.last.e) <= GM.C.PERFECT_MS && g.last.carried > 1 && g.last.airIn > 1.9, `fade ${g.last.fade}, ${g.last.e.toFixed(1)} ms off its line, ${g.last.carried.toFixed(1)} ft back, +${g.last.airIn.toFixed(1)} in`);
  return `at ${none.v0.toFixed(1)} ft/s: ${none.toward.toFixed(1)} carried, ${lean.toward.toFixed(1)} leaning in, ${stop.toward.toFixed(1)} leaning back; standing fade ${g.last.carried.toFixed(1)} ft back, line +${g.last.shift} ms`;
});

gtest("A jump has one release line: the top of it, or, off a drive from floater range, a quick one on the way up; momentum moves either", () => {
  const up = (from, keys) => {
    const g = fresh(48, { defenders: false });
    if (from === "drive") until(g, TOWARD, x => distance(x) <= 12); else { Object.assign(g.P, { x: RIM.x, y: RIM.y + 12 }); run(g, 0.2); }
    GM.step(g, { ...HELD, ...keys }); run(g, 0.2, { ...HELD, ...keys });
    return g;
  };
  const onLine = g => { run(g, g.shot.line/1000 - 0.2 - 2*GM.TICK, HELD); GM.step(g, AIM); return g.last; };
  // driving, from 12 ft: the quick line, earlier the faster you are still going at the rim
  const stop = up("drive", { d: true }), none = up("drive", {}), lean = up("drive", { u: true });
  check(stop.shot.quick && none.shot.quick && lean.shot.quick, "a jump off a drive from 12 ft should have the quick line");
  check(stop.shot.line < GM.C.FL_IDEAL && stop.shot.line > none.shot.line && none.shot.line > lean.shot.line && lean.shot.line > GM.C.LOAD + 60,
        `quick line: braking ${stop.shot.line}, no lean ${none.shot.line}, leaning in ${lean.shot.line} ms`);
  const floater = onLine(stop);
  check(floater.kind === "floater" && floater.quick && Math.abs(floater.e) <= GM.C.FL_PERFECT && stop.P.h > 0.2 && stop.P.h < 0.8, `${floater.kind}, ${floater.e.toFixed(1)} ms off, ${stop.P.h.toFixed(2)} of the way up`);
  // standing at the same spot: the top of the jump, and the same shot is tighter and let go higher
  const set = up("stand", {});
  check(!set.shot.quick && set.shot.line === GM.C.IDEAL, `standing at 12 ft: line at ${set.shot.line} ms`);
  const jumper = onLine(set);
  check(jumper.kind === "jumper" && Math.abs(jumper.e) <= GM.C.PERFECT_MS, `${jumper.kind}, ${jumper.e.toFixed(1)} ms off`);
  check(floater.sig.lat > jumper.sig.lat*1.2 && floater.ball.z < jumper.ball.z - 0.3, `pushed up early it is looser and lower: σ ${floater.sig.lat.toFixed(1)} against ${jumper.sig.lat.toFixed(1)} in, let go at ${floater.ball.z.toFixed(1)} against ${jumper.ball.z.toFixed(1)} ft`);
  // there is only the one line: early is early and short of it, whichever line it is
  const early = up("stand", {}); run(early, 0.2, HELD); GM.step(early, AIM);
  check(early.last.kind === "jumper" && early.last.e < -100 && early.last.q === 0, `let go 400 ms after the press, standing: ${early.last.kind}, ${early.last.e.toFixed(0)} ms`);
  // and at the rim there is no timed release at all
  const rim = fresh(48, { defenders: false }); Object.assign(rim.P, { x: RIM.x, y: RIM.y + 3.5 }); run(rim, 0.2); shoot(rim, 400);
  check(rim.last.kind === "layup" && rim.last.near === 1, `at 3.5 ft: ${rim.last.kind}`);
  return `off a drive from 12 ft the line is at ${stop.shot.line} ms braking, ${none.shot.line} with no lean, ${lean.shot.line} leaning in; standing there it is at ${set.shot.line}`;
});

gtest("Moving sideways in the air does not push the ball: with the cursor on the rim it goes at the rim, and what moving costs is touch", () => {
  // 15 ft out with no scatter: straight up, and leaning hard to the right, both let go on the line with the cursor on the rim
  const from = keys => {
    const g = fresh(49, { defenders: false }); Object.assign(g.P, { x: RIM.x, y: RIM.y + 15 }); run(g, 0.2);
    g.forced.push(...Array(400).fill(1));
    GM.step(g, { ...HELD, ...keys }); run(g, 0.3, { ...HELD, ...keys });
    const sideways = Math.abs(g.P.vx);
    run(g, g.shot.line/1000 - 0.3 - 2*GM.TICK, HELD); GM.step(g, AIM);
    return { last: g.last, sideways, at: g.lastPhys.path.find(q => q.z <= 10.05 && q.t > 0.3) };
  };
  const still = from({}), side = from({ r: true });
  check(side.sideways > 4.9 && side.last.carried > 1.5, `leaning right: ${side.sideways.toFixed(1)} ft/s sideways, ${side.last.carried.toFixed(1)} ft from takeoff`);
  check(still.last.out.sub === "Swish" && side.last.out.sub === "Swish", `straight up: ${still.last.out.sub}; moving sideways: ${side.last.out.sub}`);
  check(Math.abs(side.last.aim.theta) < 1e-9 && Math.hypot(side.at.x - RIM.x, side.at.y - RIM.y) < 0.15, `it should come down on the rim's center: ${Math.hypot(side.at.x - RIM.x, side.at.y - RIM.y).toFixed(2)} ft off`);
  check(side.last.sig.lat > still.last.sig.lat + 0.5 && side.last.airIn > 1.9, `the cost is scatter: σ ${side.last.sig.lat.toFixed(1)} in against ${still.last.sig.lat.toFixed(1)}`);
  return `at ${side.sideways.toFixed(1)} ft/s sideways the ball still comes down ${(12*Math.hypot(side.at.x - RIM.x, side.at.y - RIM.y)).toFixed(1)} in from the rim's center; σ ${side.last.sig.lat.toFixed(1)} in against ${still.last.sig.lat.toFixed(1)} standing`;
});

gtest("The whole floor can be walked on: down to the baseline, under the basket, and along it", () => {
  const g = fresh(57, { defenders: false });
  // down the side of the lane to the baseline, then along it under the backboard and out the other side
  check(until(g, { ...AIM, u: true, r: true }, x => x.P.x >= RIM.x + 6, 8), "never got to the right of the lane");
  check(until(g, { ...AIM, u: true }, x => x.P.y <= 0.61, 8), `stopped ${g.P.y.toFixed(2)} ft from the baseline`);
  check(g.P.y < 1 && g.P.y >= 0.6, `on the baseline: ${g.P.y.toFixed(2)} ft from it`);
  let under = false;
  for (let i = 0; i < 600 && g.P.x > RIM.x - 6; i++) { GM.step(g, { ...AIM, l: true }); if (Math.abs(g.P.x - RIM.x) < 0.5 && g.P.y < 1.5) under = true; }
  check(under && g.P.x <= RIM.x - 6, `along the baseline under the backboard: got to x ${g.P.x.toFixed(1)}`);
  // nobody gets inside the rim itself, from behind either
  const h = fresh(57, { defenders: false }); Object.assign(h.P, { x: RIM.x, y: 2 }); run(h, 1, { ...AIM, d: true });
  check(Math.abs(distance(h) - GM.C.KEEP_OUT) < 0.05 && h.P.y < RIM.y, `walking at the rim from behind: stopped ${distance(h).toFixed(2)} ft from its center`);
  // and from directly behind the backboard, a shot at the rim hits the back of the glass
  const b = fresh(57, { defenders: false }); Object.assign(b.P, { x: RIM.x, y: 2 }); run(b, 0.2); shoot(b, TOP);
  check(!b.last.out.make && b.last.out.sub === "Off the back of the backboard", `from behind the backboard: ${b.last.out.big} / ${b.last.out.sub}`);
  // the far end of the half court as well
  const far = fresh(57, { defenders: false }); until(far, { ...AIM, d: true }, x => x.P.y >= 46.39, 8);
  check(far.P.y > 46, `back toward half court: got to ${far.P.y.toFixed(1)} ft`);
  return `to ${g.P.y.toFixed(1)} ft from the baseline and along it under the basket; a shot from behind the backboard: ${b.last.out.sub}`;
});

gtest("A jump that starts as a finish has no timed release and no aim, wherever the ball is let go, and a release line never moves in the air", () => {
  // a euro: gather on a drive at 14 ft, step, step out to the side, and up. The steps use most of the drive, so the
  // jump starts well outside layup range off the dribble
  const euro = letGo => {
    const g = fresh(58, { defenders: false });
    until(g, TOWARD, x => distance(x) <= 14);
    GM.step(g, { ...TOWARD, gather: true }); run(g, 0.2, TOWARD); run(g, 0.2 - GM.TICK, { ...TOWARD, r: true });
    const from = distance(g), out = { x: g.P.x + 1.8, y: g.P.y - 0.6 };                      // the ball held out to the right all the way
    GM.step(g, { ...out, u: true, shot: true });
    const start = { finish: g.shot.finish, kind: g.shot.kind };
    for (let i = 1; i < Math.round(letGo/1000/GM.TICK); i++) GM.step(g, { x: g.P.x + 1.8, y: g.P.y - 0.6, u: true, shot: true });
    GM.step(g, { x: g.P.x + 1.8, y: g.P.y - 0.6, u: true });
    return { from, start, last: g.last };
  };
  const late = euro(650), early = euro(300);
  check(late.from > 8.5 && late.from < 12 && late.start.finish && late.start.kind === "layup", `out of gather steps from ${late.from.toFixed(1)} ft: read as ${late.start.kind}`);
  for (const e of [early, late]) check(e.last.kind === "layup" && e.last.near === 1 && e.last.con.c === 0, `let go ${e.last.upMs.toFixed(0)} ms in, ${e.last.dist.toFixed(1)} ft out: ${e.last.kind}, ${e.last.near} finish`);
  check(early.last.dist > late.last.dist + 1.5 && early.last.sig.lat > late.last.sig.lat + 1, `let go further out it is a heave: σ ${early.last.sig.lat.toFixed(1)} in from ${early.last.dist.toFixed(1)} ft against ${late.last.sig.lat.toFixed(1)} from ${late.last.dist.toFixed(1)}`);
  // a jump with a line: the line is where it is once the feet leave, however far the jump then carries
  const g = fresh(58, { defenders: false }); until(g, TOWARD, x => distance(x) <= 12);
  GM.step(g, { ...TOWARD, shot: true }); run(g, GM.C.LOAD/1000, { ...TOWARD, shot: true });
  const at = g.shot.line, d0 = distance(g); run(g, 0.4, { ...TOWARD, shot: true });
  check(g.shot.quick && g.shot.line === at && d0 - distance(g) > 3, `the quick line was at ${at} ms as the feet left and at ${g.shot.line} ms ${(d0 - distance(g)).toFixed(1)} ft further in`);
  return `a euro going up from ${late.from.toFixed(1)} ft is a finish; let go ${late.last.dist.toFixed(1)} ft out σ ${late.last.sig.lat.toFixed(1)} in, ${early.last.dist.toFixed(1)} ft out σ ${early.last.sig.lat.toFixed(1)}; a floater's line stays at ${at} ms`;
});

gtest("Coming down with the ball is travelling", () => {
  const g = fresh(47); run(g, 0.5);
  GM.step(g, HELD); run(g, 1, HELD);
  check(g.shot.state === "idle" && g.stats.fga === 0 && g.stats.to === 1 && /Travelling/.test(g.drib.lastMove), `${g.shot.state}, ${g.stats.fga} shots, ${g.stats.to} turnovers, "${g.drib.lastMove}"`);
  check(g.P.up < 0 && g.P.h === 0, "they should be back on the floor");
  return "still held when the feet came down: a turnover";
});

gtest("Letting go before the feet leave is a pump fake: no shot, the dribble is dead, and a triple threat is kept", () => {
  // off the dribble: let go 100 ms after the press, while the legs are still loading. No defenders, who would take
  // the ball off a player standing still with it.
  const g = fresh(51, { defenders: false }); run(g, 0.5);
  GM.step(g, HELD); run(g, 0.1, HELD); GM.step(g, AIM);
  check(g.stats.fga === 0 && g.shot.state === "idle" && g.P.up < 0 && g.P.h === 0, `a shot was taken: ${g.stats.fga}, ${g.shot.state}, up ${g.P.up}`);
  check(g.hold.state === "pivot" && g.hold.fakeT > 0 && g.drib.lastMove === "Pump fake", `hold ${g.hold.state}, last move "${g.drib.lastMove}"`);
  run(g, 0.5, TOWARD);
  check(speed(g) === 0, "a dead dribble should not be able to run");
  // a tap shorter than a tick is a fake too
  const tap = fresh(51); run(tap, 0.5); GM.step(tap, HELD); GM.step(tap, AIM);
  check(tap.stats.fga === 0 && tap.drib.lastMove === "Pump fake", `a one-tick tap: "${tap.drib.lastMove}", ${tap.stats.fga} shots`);
  // let go once the feet have left and it is a shot, however early
  const late = fresh(51); run(late, 0.5); GM.step(late, HELD); run(late, (GM.C.LOAD + 10)/1000, HELD); GM.step(late, AIM);
  check(late.stats.fga === 1 && late.last.kind === "jumper", `let go ${GM.C.LOAD + 10} ms after the press: ${late.stats.fga} shots`);
  // out of the triple threat, leaning as you go up: the fake leaves you in it, where you were, with the dribble still to come
  const t = GM.create({ seed: 52, rules: true }); run(t, 0.5);
  const from = { x: t.P.x, y: t.P.y, live: t.hold.live, state: t.hold.state };
  GM.step(t, { ...HELD, l: true }); run(t, 0.12, { ...HELD, l: true }); GM.step(t, AIM);
  check(from.state === "pivot" && from.live && t.hold.state === "pivot" && t.hold.live && t.drib.lastMove === "Pump fake", `triple threat before ${from.state}/${from.live}, after ${t.hold.state}/${t.hold.live}, "${t.drib.lastMove}"`);
  check(t.P.x === from.x && t.P.y === from.y, `the fake moved the body: ${(t.P.x - from.x).toFixed(2)}, ${(t.P.y - from.y).toFixed(2)} ft`);
  return `let go inside ${GM.C.LOAD} ms is a fake; from a dribble it kills it, from the triple threat it keeps it`;
});

gtest("On a drive, going up early is a floater and going up late is a layup; let go high and close, either is a dunk", () => {
  const kinds = [];
  for (const [name, range] of [["floater", 12], ["layup", 6.5]]) {
    const g = fresh(61, { defenders: false });
    check(until(g, TOWARD, x => distance(x) <= range), `never got within ${range} ft`);
    const at = distance(g), v = speed(g);
    GM.step(g, { ...TOWARD, shot: true });
    check(g.shot.kind === name, `from ${at.toFixed(1)} ft at ${v.toFixed(1)} ft/s: ${g.shot.kind}, expected ${name}`);
    kinds.push(`${name} from ${at.toFixed(1)} ft`);
  }
  // the same layup, let go at three points of the jump: on the way up it is a layup, at the top by the rim it is a dunk
  const finish = ms => { const g = fresh(61, { defenders: false }); until(g, TOWARD, x => distance(x) <= 6.5); shoot(g, ms, TOWARD); return g.last; };
  const early = finish(330), top = finish(TOP);
  check(early.kind === "layup" && top.kind === "dunk", `let go at 330 ms: ${early.kind}; at the top: ${top.kind}`);
  // a jump from a standstill does not get the hand over the rim
  const still = fresh(61, { defenders: false }); Object.assign(still.P, { x: RIM.x, y: RIM.y + 3.2 }); run(still, 0.2); shoot(still, TOP);
  check(still.last.kind === "layup", `standing under the rim: ${still.last.kind}`);
  return `${kinds.join(", ")}; the layup let go at the top is a dunk, and from a standstill it is not`;
});

gtest("In the air the ball is in the hand, and the cursor is the hand", () => {
  // standing 10 ft out, at the top of the jump, with the cursor in different places
  const at = cursor => {
    const g = fresh(52, { defenders: false }); Object.assign(g.P, { x: RIM.x, y: RIM.y + 10 }); run(g, 0.2);
    const c = cursor(g); GM.step(g, { ...c, shot: true }); run(g, 61*GM.TICK, { ...c, shot: true });
    return { ...GM.airBall(g), px: g.P.x, py: g.P.y, h: g.P.h };
  };
  const form = at(() => AIM), up = at(g => ({ x: g.P.x, y: g.P.y })), right = at(g => ({ x: g.P.x + 1.5, y: g.P.y })), wide = at(g => ({ x: g.P.x + 2.2, y: g.P.y }));
  const jump = GM.C.P_JUMP*form.h;
  check(form.placed === 0 && Math.abs(form.out - GM.C.FORM_OUT) < 1e-9 && Math.abs(form.z - (GM.C.FORM_Z + jump)) < 1e-9 && form.py - form.y > 0.69, `cursor on the rim, far away: a shooting form, ${form.out.toFixed(2)} ft toward it, ${form.z.toFixed(2)} ft up`);
  check(up.placed === 1 && up.out < 0.01 && Math.abs(up.z - (GM.C.P_STAND + jump)) < 1e-9, `cursor on the body: straight up at full reach, ${up.z.toFixed(2)} ft`);
  check(right.placed === 1 && Math.abs(right.x - right.px - 1.5) < 1e-9 && right.side > 0.5 && right.z < up.z - 0.4, `cursor 1.5 ft to the right: the ball is there, and lower: ${right.z.toFixed(2)} ft`);
  check(wide.z < right.z - 0.5 && wide.z < form.z, `held all the way out it is lowest: ${wide.z.toFixed(2)} ft`);
  // right at the rim, the hand keeps a low ball out from under it, and lets a high one go over it
  const under = (v, ms) => { const g = fresh(52, { defenders: false }); if (v) until(g, TOWARD, x => distance(x) <= 6); else Object.assign(g.P, { x: RIM.x, y: RIM.y + 1.2 });
    run(g, v ? 0 : 0.2); GM.step(g, { ...TOWARD, u: v, shot: true }); run(g, ms/1000 - GM.TICK, { ...TOWARD, u: v, shot: true }); const b = GM.airBall(g); return { z: b.z, from: Math.hypot(b.x - RIM.x, b.y - RIM.y) }; };
  const low = under(false, 250), high = under(true, 517);
  check(low.z < 9.2 && low.from >= GM.C.UNDER_LOW - 1e-9, `a low ball, cursor on the rim from 1.2 ft: held ${low.from.toFixed(2)} ft from the rim's center at ${low.z.toFixed(1)} ft up`);
  check(high.z >= GM.C.DUNK_Z && high.from < 0.2, `at the top of a running jump it is over the rim: ${high.from.toFixed(2)} ft from its center, ${high.z.toFixed(1)} ft up`);
  return `shooting form ${form.z.toFixed(1)} ft up; straight up ${up.z.toFixed(1)}; 1.5 ft out ${right.z.toFixed(1)}; 2.2 ft out ${wide.z.toFixed(1)}; kept ${low.from.toFixed(1)} ft from under the rim when low`;
});

gtest("At the rim a defender is an arm to get the ball past: in front of it the shot is blocked, held away from it the shot gets off", () => {
  // A finish from 4 ft with a player-controlled defender 2 ft in front, arm up toward the shooter, who jumps so as
  // to be at the top when the ball is let go. No scatter: only where the ball is held changes.
  const finish = cursor => {
    const g = GM.create({ seed: 7, duo: true });
    Object.assign(g.P, { x: RIM.x, y: RIM.y + 4 }); Object.assign(g.D, { x: RIM.x, y: RIM.y + 2, vx: 0, vy: 0 });
    g.forced.push(...Array(400).fill(1));
    const def = () => ({ x: g.P.x, y: g.P.y - 0.2 });
    for (let t = 0; t < 20; t++) GM.step(g, [cursor(g), def()]);
    for (let t = 0; t <= 62; t++) GM.step(g, [{ ...cursor(g), shot: t < 62 }, { ...def(), shot: t >= 34 }]);
    return g.last;
  };
  const front = finish(() => AIM), away = finish(g => ({ x: g.P.x + 2.0, y: g.P.y - 0.3 }));
  check(front.kind === "layup" && front.out.big === "Blocked", `held in front, toward the rim: ${front.out.big} / ${front.out.sub}`);
  check(away.kind === "layup" && !away.out.touched && away.ball.side > 0.5, `held 2 ft out to the side: ${away.out.big} / ${away.out.sub}`);
  check(front.con.c === 0 && away.con.c === 0, "at the rim there is no contest number: the defender is the arm and nothing else");
  check(away.sig.lat > front.sig.lat, "holding it out wide costs touch");
  return `in front: ${front.out.big}. Held ${away.ball.out.toFixed(1)} ft out to the side: ${away.out.big} / ${away.out.sub}, at σ ${away.sig.lat.toFixed(1)} in against ${front.sig.lat.toFixed(1)}`;
});

gtest("Flying into a defender who was set is a charge; into one inside the restricted area, or one who is moving, it is a bump", () => {
  // the handler drives down the middle and takes off 3 ft short of a player-controlled defender standing `out` ft from the rim
  const fly = (out, moving) => {
    const g = GM.create({ seed: 9, rules: true, duo: true });
    GM.step(g, [{ ...AIM, gather: true }, AIM]); GM.step(g, [AIM, AIM]);
    const park = () => { if (!moving) Object.assign(g.D, { x: RIM.x, y: RIM.y + out, vx: 0, vy: 0 }); };
    Object.assign(g.D, { x: RIM.x, y: RIM.y + out, vx: 0, vy: 0 });
    const def = () => moving ? { x: g.D.x, y: g.D.y, r: g.tick % 60 < 30, l: g.tick % 60 >= 30 } : { x: g.D.x, y: g.D.y };
    for (let t = 0; t < 600 && distance(g) > out + 3.2 && g.flow.phase === "live"; t++) { park(); GM.step(g, [TOWARD, def()]); }
    GM.step(g, [{ ...TOWARD, shot: true }, def()]);
    for (let t = 0; t < 60 && g.flow.phase === "live" && g.shot.state === "shooting"; t++) GM.step(g, [{ ...TOWARD, shot: true }, def()]);
    return g;
  };
  const set = fly(8, false), under = fly(3, false), sliding = fly(8, true);
  check(set.flow.phase === "dead" && set.flow.why === "Charge" && set.flow.next === "change" && set.stats.to === 1, `into a set defender 8 ft out: ${set.flow.phase}, "${set.flow.why}"`);
  check(under.flow.why !== "Charge" && under.shot.bump, `into one standing 3 ft from the rim: "${under.flow.why}", bumped ${under.shot.bump}`);
  check(sliding.flow.why !== "Charge", `into one who was sliding across: "${sliding.flow.why}"`);
  return `set, 8 ft out: ${set.flow.why}. In the restricted area: play on, with a bump. Sliding: ${sliding.flow.why || "play on"}`;
});

gtest("Rim or glass is chosen when the jump starts: a cursor that slides onto the backboard during it is not a bank", () => {
  const BOARD_Y = 4.0, rim = { x: RIM.x, y: RIM.y }, glass = { x: RIM.x + 1.6, y: BOARD_Y };
  // a standing jumper from the wing, with the cursor in one place at the press and another by the release
  const from = (atPress, atRelease) => {
    const g = fresh(31, { defenders: false });
    Object.assign(g.P, { x: 33, y: 13 }); run(g, 0.3, atPress);
    GM.step(g, { ...atPress, shot: true }); run(g, 2*GM.TICK, { ...atPress, shot: true }); run(g, 59*GM.TICK, { ...atRelease, shot: true });
    GM.step(g, atRelease);
    return g.last;
  };
  const shoot = from;
  check(shoot(rim, rim).glass === false && shoot(glass, glass).glass === true, "on the rim throughout is a shot at the rim, and on the glass throughout is a bank");
  check(shoot(rim, glass).glass === false, "a cursor that started on the rim and ended on the backboard should still be a shot at the rim");
  check(shoot(glass, rim).glass === true, "a bank that was chosen at the press stays a bank");
  // just behind the rim and a little to one side: a near miss of the rim, which used to count as the glass
  const near = { x: RIM.x + 0.9, y: RIM.y - 0.6 };
  check(shoot(near, near).glass === false, "a cursor 0.9 ft to the side and 0.6 ft behind the rim's center is a miss of the rim, not a bank");
  check(Math.abs(shoot(rim, glass).aim.theta) > 0.02, "and sliding off the rim still costs it as aim");
  return "decided at the jump; a near miss of the rim is not the glass";
});

gtest("A ball that has no way to get where it is aimed is a blown shot, not a crash", () => {
  // right by the basket with the cursor on the glass: a bank from there, let go low, has no path. Looking at the
  // odds on the way must not fall over either.
  const g = fresh(55, { defenders: false });
  Object.assign(g.P, { x: RIM.x - 3, y: RIM.y + 0.3 }); const glass = { x: RIM.x - 2.5, y: 4.0 };
  run(g, 0.1, glass); GM.step(g, { ...glass, shot: true });
  for (let i = 1; i < 24; i++) { GM.step(g, { ...glass, shot: true }); GM.preview(g); }
  GM.step(g, glass); GM.preview(g); GM.lastOdds(g);
  check(g.last && g.last.glass && !g.last.out.make && g.last.out.sub === "Blown layup" && g.stats.fga === 1, `expected a blown bank: ${JSON.stringify(g.last && g.last.out)}`);
  run(g, 2);
  check(g.shot.state === "idle", `afterwards: ${g.shot.state}`);
  return `${g.last.name} from ${g.last.dist.toFixed(1)} ft, let go at ${g.last.ball.z.toFixed(1)} ft: ${g.last.out.sub}`;
});

gtest("Nothing in the game is rolled except a shot's scatter", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "game.js"), "utf8");
  const calls = src.split("\n").filter(line => /\brnd\(\)/.test(line) && !/^const rnd = /.test(line));
  check(calls.length === 1 && /^function gauss\(\)/.test(calls[0]), `random numbers are drawn outside the bell curve a shot's scatter comes from:\n${calls.join("\n")}`);
  return "the only draws are the two behind each normal deviate";
});

gtest("An open dunk always goes down; with a shot blocker's arm over the rim it is met there", () => {
  const open = fresh(71, { defenders: false });
  until(open, TOWARD, x => distance(x) <= 7);
  shoot(open, TOP, TOWARD); run(open, 2);
  check(open.last.kind === "dunk" && open.last.out.make && open.stats.pts === 2 && !open.last.foul, `expected a made dunk: ${JSON.stringify(open.last.out)}`);
  // the same dunk with the rim protector between the dunker and the rim, at the top of a jump as the ball gets there
  const met = fresh(71, { defenders: false });
  until(met, TOWARD, x => distance(x) <= 7);
  GM.setDefender(met, "rimOn", true);
  for (let i = 0; i < 80 && !(met.last && met.last.kind === "dunk"); i++) {
    const u = { x: (RIM.x - met.P.x)/distance(met), y: (RIM.y - met.P.y)/distance(met) };
    // just touching once the dunker has moved this tick: bodies can't overlap, and the arm is what is being tried
    const gap = 2.2 + Math.min(Math.hypot(met.P.vx, met.P.vy)*GM.TICK, Math.max(0, Math.hypot(RIM.x - met.P.x, RIM.y - met.P.y) - GM.C.KEEP_OUT));
    Object.assign(met.R, { x: met.P.x + u.x*gap, y: met.P.y + u.y*gap, vx: 0, vy: 0, jumpT: 0.22, h: 1, hand: 1, jumpAt: null });
    GM.step(met, { ...TOWARD, shot: i < 60 });   // let go as the dunker gets to the rim: blocks are all or nothing by position (see Calibration)
  }
  check(met.last && met.last.kind === "dunk" && met.last.out.big === "Blocked" && met.last.out.sub === "Met at the rim" && met.stats.pts === 0, `expected it met at the rim: ${JSON.stringify(met.last && met.last.out)}`);
  return `open: ${open.last.out.big} / ${open.last.out.sub}; with an arm there: ${met.last.out.big} / ${met.last.out.sub}`;
});

gtest("On gather steps the cursor holds the ball: it goes after it at hand speed, across the chest and never behind the back, and on into the air", () => {
  const drive = () => { const g = fresh(58, { defenders: false }); until(g, TOWARD, x => speed(x) >= 10); return g; };
  // relative to the way the steps are going: forward, and to the right
  const rel = g => { const b = GM.heldBallPos(g), d = g.hold.stepDir, ox = b.x - g.P.x, oy = b.y - g.P.y; return { fwd: ox*d.x + oy*d.y, side: -ox*d.y + oy*d.x }; };
  const at = (g, dx, dy) => ({ x: g.P.x + dx, y: g.P.y + dy, u: true });   // going up the floor, so +x is to the right and +y behind
  // held out to the right, then swung to the left: a straight line across the chest, at BALL_V
  const g = drive(); GM.step(g, { ...at(g, 2, 0), gather: true });
  for (let i = 0; i < 24; i++) GM.step(g, at(g, 2, 0));
  const right = rel(g);
  check(Math.abs(right.side - GM.C.HOLD_R) < 1e-9 && Math.abs(right.fwd) < 1e-9, `held right: ${right.side.toFixed(2)} ft to the side`);
  for (let i = 0; i < ticks(0.1); i++) GM.step(g, at(g, -2, 0));
  const mid = rel(g);
  check(mid.side > 0.2 && mid.side < 0.6, `0.1 s into the swing it should still be on the way across: ${mid.side.toFixed(2)} ft`);
  for (let i = 0; i < ticks(0.2); i++) GM.step(g, at(g, -2, 0));
  check(Math.abs(rel(g).side + GM.C.HOLD_R) < 1e-9, `0.3 s in it should be all the way across: ${rel(g).side.toFixed(2)} ft`);
  // from behind the right hip to behind the left: the straight way is behind the back, so it goes by the front
  const h = drive(); GM.step(h, { ...at(h, 1.2, 1.2), gather: true });
  for (let i = 0; i < 20; i++) GM.step(h, at(h, 1.2, 1.2));
  let front = -9;
  for (let i = 0; i < 30 && h.hold.state === "steps"; i++) { GM.step(h, at(h, -1.2, 1.2)); front = Math.max(front, rel(h).fwd); }
  check(front > 0 && rel(h).side < -0.8, `going round: as far forward as ${front.toFixed(2)} ft, ending ${rel(h).side.toFixed(2)} ft to the side`);
  // and up: the ball leaves the floor from where it was held
  const k = drive(); GM.step(k, { ...at(k, 2, -0.3), gather: true });
  for (let i = 0; i < 30; i++) GM.step(k, at(k, 2, -0.3));
  const held = GM.heldBallPos(k), was = { x: held.x - k.P.x, y: held.y - k.P.y };
  GM.step(k, { ...at(k, 2, -0.3), shot: true });
  const up = GM.airBall(k), jump = Math.hypot(up.x - k.P.x - was.x, up.y - k.P.y - was.y);
  check(k.shot.state === "shooting" && jump <= GM.C.BALL_V*GM.TICK + 1e-9, `the ball moved ${jump.toFixed(2)} ft against the body as the jump started`);
  return `across the chest in ${(2*GM.C.HOLD_R/GM.C.BALL_V).toFixed(2)} s; from hip to hip by the front; into the air without a jump in the ball`;
});

gtest("On gather steps a ball held toward a defender can be taken, and one held away, behind the body, cannot", () => {
  // a player on defense standing ahead and to the right of a drive, reaching for the ball the whole way past
  const past = hold => {
    const g = GM.create({ seed: 3, duo: true }), park = { x: 45, y: 40 };
    for (let i = 0; i < 600 && speed(g) < 10; i++) { Object.assign(g.D, { x: park.x, y: park.y, vx: 0, vy: 0 }); GM.step(g, [TOWARD, park]); }
    Object.assign(g.D, { x: g.P.x + 1.9, y: g.P.y - 2.2, vx: 0, vy: 0 });
    GM.step(g, [{ ...hold(g), gather: true }, { x: g.D.x, y: g.D.y }]);
    for (let i = 0; i < 50 && g.hold.state === "steps"; i++) { const b = GM.heldBallPos(g); GM.step(g, [hold(g), { x: b.x, y: b.y }]); }
    return g.drib.lastMove;
  };
  const right = past(g => ({ x: g.P.x + 1.8, y: g.P.y - 0.4, u: true })), left = past(g => ({ x: g.P.x - 1.8, y: g.P.y - 0.4, u: true }));
  check(right === "Stripped" && left !== "Stripped", `held toward them: "${right}"; held on the far side: "${left}"`);
  // the AI on-ball defender, there as the steps start: run the ball into its hand and it is gone; on the hip it is not
  const ai = hold => {
    const g = fresh(1); GM.setDefender(g, "rimOn", false); GM.setDefender(g, "defOn", false);
    run(g, 0.3); until(g, { ...AIM, x: g.P.x + 3, y: g.P.y, u: true }, x => speed(x) >= 12);
    GM.setDefender(g, "defOn", true); Object.assign(g.D, { x: g.P.x + 0.6, y: g.P.y - 6 });
    GM.step(g, { ...hold(g), gather: true });
    for (let i = 0; i < 80 && g.hold.state === "steps" && !g.stats.to; i++) GM.step(g, hold(g));
    return g.stats.to === 1;
  };
  const into = ai(g => ({ x: g.D.x, y: g.D.y, u: true })), side = ai(g => ({ x: g.P.x + 2, y: g.P.y, u: true })), hip = ai(g => ({ x: g.P.x - 1.2, y: g.P.y + 1.2, u: true }));
  check(into && !side && !hip, `against the AI: into its hand ${into ? "taken" : "kept"}, out to the side ${side ? "taken" : "kept"}, on the far hip ${hip ? "taken" : "kept"}`);
  return "held toward the hand it is taken; held away it is not, from a player or the AI";
});

gtest("The rim protector reads a change of direction a reaction time late: for that long, a euro either way looks the same to it", () => {
  // staying home, where it keeps between the handler and the rim, so where the handler goes is what moves it
  const drive = side => {
    const g = fresh(5); GM.setDefender(g, "defOn", false); g.params.stepUp = 0;
    until(g, TOWARD, x => distance(x) <= 13);
    GM.step(g, { ...AIM, u: true, gather: true }); run(g, 0.2, TOWARD);
    const path = [];
    for (let i = 0; i < 60; i++) { GM.step(g, { ...AIM, u: true, l: side < 0, r: side > 0 }); path.push({ x: g.R.x, y: g.R.y }); }
    return { g, path };
  };
  const right = drive(1), left = drive(-1), lag = right.g.params.readMs/1000;
  const split = right.path.findIndex((p, i) => Math.hypot(p.x - left.path[i].x, p.y - left.path[i].y) > 1e-9);
  check(right.g.hold.euro > 1 && left.g.hold.euro > 1 && right.g.R.mode === "home", `euros of ${right.g.hold.euro.toFixed(1)} and ${left.g.hold.euro.toFixed(1)} ft, the big ${right.g.R.mode}`);
  check(split >= ticks(lag) - 2, `the rim protector told the two apart ${split} ticks in, inside its ${Math.round(lag*1000)} ms read`);
  // and a finish: straight at it, it is there; off a euro, it is not
  const finish = (euro, seed) => {
    const g = fresh(seed); GM.setDefender(g, "defOn", false);
    until(g, TOWARD, x => distance(x) <= 13);
    GM.step(g, { ...TOWARD, gather: true }); run(g, 0.2, TOWARD); run(g, 23*GM.TICK, { ...AIM, u: true, r: euro });
    shoot(g, 417, TOWARD);
    return g.last.out.big;
  };
  const blocked = euro => [1, 2, 3, 4, 5, 6].filter(s => finish(euro, s) === "Blocked").length;
  const a = blocked(false), b = blocked(true);
  check(a >= 5 && b === 0, `blocked straight at it ${a} of 6, off a euro ${b} of 6`);
  return `it told a euro right from one left after ${Math.round(split*GM.TICK*1000)} ms; blocked ${a} of 6 straight at it, ${b} of 6 off a euro`;
});

gtest("Bodies meeting: a runner is stopped at a set body's back and barely moves it, and knocks one still on the move off its line", () => {
  // a dribbler at full speed up the floor into a player on defense standing in the way, or sliding across it
  const into = slide => {
    const g = GM.create({ seed: 5, duo: true }), away = () => ({ x: g.P.x + 2, y: g.P.y + 1.5 });   // the ball on the far side, out of reach
    Object.assign(g.P, { x: 25, y: 30 }); Object.assign(g.D, { x: slide ? 19 : 25, y: 22.6, vx: 0, vy: 0 });
    let met = null;
    for (let i = 0; i < 120; i++) {
      const v = Math.hypot(g.P.vx, g.P.vy);
      GM.step(g, [{ ...away(), u: true }, { x: g.D.x, y: g.D.y, r: slide && g.D.x < 31 }]);
      if (!met && Math.hypot(g.D.x - g.P.x, g.D.y - g.P.y) < 1.705) met = { before: v, after: Math.hypot(g.P.vx, g.P.vy), back: -g.D.vy };
    }
    return { met, gave: 22.6 - g.D.y, to: g.stats.to };
  };
  const set = into(false), slid = into(true);
  check(set.met && set.gave < 0.1 && set.met.after < 2, `a set defender gave ${set.gave.toFixed(2)} ft and the dribbler kept ${set.met && set.met.after.toFixed(1)} ft/s`);
  check(slid.met && slid.met.back > 3 && slid.met.after > 5, `one sliding across was knocked back at ${slid.met && slid.met.back.toFixed(1)} ft/s and the dribbler kept ${slid.met && slid.met.after.toFixed(1)} ft/s`);
  return `set: gave ${set.gave.toFixed(2)} ft, the dribbler stopped; sliding across: knocked back at ${slid.met.back.toFixed(1)} ft/s, the dribbler on at ${slid.met.after.toFixed(1)}`;
});

gtest("Bodies meeting: two of a size leaning on each other go nowhere, and it takes half again the weight to move someone holding their ground", () => {
  // the handler leans into a player on defense who stands still, for a second
  const lean = mD => {
    const g = GM.create({ seed: 5, duo: true }), away = () => ({ x: g.P.x + 2, y: g.P.y + 1.5 });
    g.D.m = mD; Object.assign(g.P, { x: 25, y: 26 }); Object.assign(g.D, { x: 25, y: 24.25, vx: 0, vy: 0 });
    for (let i = 0; i < 30; i++) GM.step(g, [away(), { x: g.D.x, y: g.D.y }]);
    const d0 = { x: g.D.x, y: g.D.y };
    for (let i = 0; i < 120; i++) GM.step(g, [{ ...away(), u: true }, { x: g.D.x, y: g.D.y }]);
    return Math.hypot(g.D.x - d0.x, g.D.y - d0.y);
  };
  const same = lean(1), lighter = lean(0.8), half = lean(0.5);
  check(same < 0.05 && lighter < 0.1, `holding: the same size gave ${same.toFixed(2)} ft, four fifths of it ${lighter.toFixed(2)} ft`);
  check(half > 1.5, `half the weight should be backed down: ${half.toFixed(2)} ft in a second`);
  return `in a second of leaning: ${same.toFixed(2)} ft against the same size, ${lighter.toFixed(2)} against four fifths of it, ${half.toFixed(1)} against half`;
});

// Driving in from the top with the ball out to one side, to 15 ft, then posted up for a while so the defender is on their back.
function postedUp(seed, { mD = 1, side = 1, settle = 150 } = {}) {
  const g = fresh(seed); GM.setDefender(g, "rimOn", false); g.D.m = mD;
  run(g, 0.5);
  until(g, { ...AIM, u: true }, x => distance(x) <= 15, 4);
  for (let i = 0; i < 300 && distance(g) > 15; i++) GM.step(g, { x: g.P.x + 2.5*side, y: g.P.y, u: true });
  for (let i = 0; i < settle; i++) GM.step(g, { ...AIM, post: true });
  return g;
}

gtest("Holding Space on the dribble is the post stance: back to the defender, the ball low on the far side, no faster than a walk", () => {
  const g = postedUp(7, { settle: 0 });
  let toward = -9, high = 0, fastest = 0;
  for (let i = 0; i < 120; i++) {
    GM.step(g, { ...AIM, post: true, l: i > 60 });
    const away = { x: g.P.x - g.D.x, y: g.P.y - g.D.y }, al = Math.hypot(away.x, away.y), b = GM.dribbleBallPos(g);
    if (i >= 45) { toward = Math.max(toward, -((b.x - g.P.x)*away.x + (b.y - g.P.y)*away.y)/al); high = Math.max(high, b.h); }
    if (i > 70) fastest = Math.max(fastest, speed(g));
  }
  const f = GM.bodyFrame(g), away = { x: g.P.x - g.D.x, y: g.P.y - g.D.y }, al = Math.hypot(away.x, away.y);
  check(g.drib.post && (f.u.x*away.x + f.u.y*away.y)/al > 0.98, `facing ${((f.u.x*away.x + f.u.y*away.y)/al).toFixed(2)} of the way from the defender`);
  check(toward < 0.3, `once turned, the ball should stay on the far side, at most at the hip: it came ${toward.toFixed(2)} ft toward them`);
  check(high <= GM.C.POST_TOP + 1e-9 && fastest <= GM.C.POST_SPEED + 1e-9, `bounced ${high.toFixed(1)} ft high, moved at up to ${fastest.toFixed(1)} ft/s`);
  return `back to them, the ball at most ${toward.toFixed(2)} ft toward them and ${high.toFixed(1)} ft up, ${fastest.toFixed(1)} ft/s sideways`;
});

gtest("Backing down: against the same size it barely gets anywhere, and half the size is walked back to the rim", () => {
  const back = mD => {
    const g = postedUp(7, { mD });
    for (let i = 0; i < 120 && Math.hypot(g.D.x - g.P.x, g.D.y - g.P.y) > 1.71; i++) GM.step(g, { ...AIM, post: true, u: true });   // into their chest first
    const d0 = distance(g); run(g, 2, { ...AIM, post: true, u: true });
    return { gained: d0 - distance(g), to: g.stats.to };
  };
  const same = back(1), half = back(0.5);
  check(same.to === 0 && half.to === 0, "nobody should have lost the ball backing down");
  check(same.gained < 1.2 && half.gained > 5, `in two seconds: ${same.gained.toFixed(1)} ft against the same size, ${half.gained.toFixed(1)} ft against half of it`);
  return `in two seconds: ${same.gained.toFixed(1)} ft against the same size (sliding off them), ${half.gained.toFixed(1)} ft against half of it`;
});

gtest("Letting go of Space faces up; doing it moving sideways is a spin, and a spin to the open side gets past a defender still leaning on where they were", () => {
  // posted up, then: let go and drive at the rim; or step sideways along them, let go still going, and then drive
  const go = (seed, spin) => {
    const g = postedUp(seed, { side: -1 }), lat = spin < 0 ? { l: true } : spin > 0 ? { r: true } : {};
    if (spin) for (let i = 0; i < 15; i++) GM.step(g, { ...AIM, post: true, ...lat });
    let move = null;
    for (let i = 0; i < 240 && distance(g) > 6 && !g.stats.to; i++) {
      GM.step(g, { ...AIM, u: true, ...(i < 30 ? lat : {}) });
      if (!move && /Spin|Face up/.test(g.drib.lastMove)) move = g.drib.lastMove;
    }
    const between = Math.hypot(g.D.x - RIM.x, g.D.y - RIM.y) < distance(g) - 0.5;            // the defender still between them and the rim
    return { move, between, to: g.stats.to };
  };
  // the defender is never exactly behind: a spin toward the side they are on runs into them, so try both ways
  const seeds = [1, 2, 3, 4], up = seeds.map(s => go(s, 0)), spun = seeds.map(s => [go(s, 1), go(s, -1)]);
  check(up.every(r => r.move === "Face up") && spun.flat().every(r => r.move === "Spin"), `named ${up.map(r => r.move).join(", ")} / ${spun.flat().map(r => r.move).join(", ")}`);
  check(up.every(r => r.between) && up.every(r => !r.to), "facing up and driving should leave the defender between them and the rim");
  const open = spun.filter(([a, b]) => !a.between || !b.between).length;
  check(open === seeds.length && spun.flat().every(r => !r.to), `a spin one way or the other got past in ${open} of ${seeds.length}`);
  return `facing up: the defender still in the way ${up.filter(r => r.between).length} of ${up.length}; spinning to the open side: past them ${open} of ${seeds.length} (${spun.flat().filter(r => !r.between).length} of ${spun.flat().length} spins either way)`;
});

gtest("Gathering on the move gives two steps and then a dead dribble; gathering while stopped is a dead dribble at once", () => {
  const g = fresh(81, { defenders: false });
  until(g, TOWARD, x => speed(x) >= 10);
  GM.step(g, { ...TOWARD, gather: true });
  check(g.hold.state === "steps" && g.hold.step === 1, `after gathering at speed: ${g.hold.state}, step ${g.hold.step}`);
  run(g, 0.25, TOWARD);
  check(g.hold.state === "steps" && g.hold.step === 2, `0.25 s later: ${g.hold.state}, step ${g.hold.step}`);
  run(g, 0.6);
  check(g.hold.state === "pivot", `after the second step lands and 0.3 s pass: ${g.hold.state}`);
  const still = fresh(82); run(still, 0.3); GM.step(still, { ...AIM, gather: true });
  check(still.hold.state === "pivot", `gathering while stopped: ${still.hold.state}`);
  GM.step(still, { ...AIM, gather: true }); GM.step(still, AIM); GM.step(still, { ...AIM, gather: true });
  check(still.hold.state === "pivot", "holding or re-pressing gather should change nothing");
  return "two steps, then pivot";
});

gtest("The AI closes out on a shot it sees, and leaves its feet only from where it could block it", () => {
  // The handler either dribbles with the ball out in front, which keeps the defender at its cushion, or pulls it
  // in tight for a second, which reads as a pull-up and brings the defender up close.
  const from = tight => {
    let shots = 0, jumped = 0, closer = 0;
    for (let i = 0; i < 12; i++) {
      const g = fresh(100 + i);
      for (let k = 0; k < 120; k++) GM.step(g, tight ? { x: g.P.x + 0.3, y: g.P.y - 0.6 } : AIM);
      const before = Math.hypot(g.D.x - g.P.x, g.D.y - g.P.y);
      for (let k = 0; k < 62; k++) GM.step(g, HELD);
      if (g.shot.state !== "shooting") continue;
      shots++;
      if (g.D.jumpT >= 0 || g.D.land > 0) jumped++; else if (Math.hypot(g.D.x - g.P.x, g.D.y - g.P.y) < before - 0.3) closer++;
      check(g.D.hand > 0.9 || g.D.jumpT >= 0 || g.D.land > 0, `defender neither raised a hand nor jumped (seed ${100 + i})`);
    }
    return { shots, jumped, closer };
  };
  const usual = from(false), tight = from(true);
  check(usual.shots === 12 && usual.jumped === 0 && usual.closer === 12, `from its cushion it is too far to get there, so it should keep its feet and close out: ${JSON.stringify(usual)}`);
  check(tight.shots === 12 && tight.jumped === 12, `from inside ${GM.C.BITE_R} ft it should go up every time: ${JSON.stringify(tight)}`);
  return `from its cushion: closed out ${usual.closer} of ${usual.shots}, never jumped. Brought in close: jumped ${tight.jumped} of ${tight.shots}`;
});

if (require.main === module) {
  let pass = 0;
  for (const t of gameTests) {
    try { const info = t.fn(); pass++; console.log(`PASS  ${t.name}\n      ${info || ""}`); }
    catch (e) { console.log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  console.log(`\n${pass}/${gameTests.length} passed`);
  if (pass < gameTests.length) process.exitCode = 1;
}
module.exports = { gameTests };
