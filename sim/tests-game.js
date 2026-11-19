// Tests for the game as a whole: it is deterministic, it is plain data, and scripted input plays out as designed.
// These run the real rules tick by tick, with no page and no browser.
const GM = require("./game.js");

const gameTests = [];
function gtest(name, fn) { gameTests.push({ name, fn }); }
function check(cond, msg) { if (!cond) throw new Error(msg); }

const RIM = GM.HOOP, AIM = { x: RIM.x, y: RIM.y };            // cursor on the rim: aimed straight at it
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

// Space, then a click `ms` after it: one jump and one release. `air` is what is held from the jump on.
function shoot(game, ms, at = AIM, air = at) {
  GM.step(game, { ...at, jump: true });
  for (let i = 1, n = Math.round(ms/1000/GM.TICK); i < n; i++) GM.step(game, air);
  GM.step(game, { ...air, shot: true });
}
const TOP = 517;                                                  // ms after Space: the top of the jump, to the nearest tick

// a little of everything: a jumper, a retreat, a drive into a floater, a gather, a pump fake and a shot off the dead dribble
function session(game, each = () => {}) {
  const go = (seconds, input) => { for (let i = 0, n = ticks(seconds); i < n; i++) { GM.step(game, input); each(game); } };
  const up = (ms, input) => { go(GM.TICK, { ...input, jump: true }); go(ms/1000 - GM.TICK, input); go(GM.TICK, { ...input, shot: true }); };
  go(0.5, AIM); up(TOP, AIM); go(3, AIM);
  go(0.6, { ...AIM, d: true }); go(1.2, { ...TOWARD, x: RIM.x + 2 }); up(450, { ...TOWARD, x: RIM.x + 2 }); go(3, AIM);
  go(0.8, { ...AIM, d: true, l: true }); go(0.3, { ...AIM, x: RIM.x - 6 }); go(0.05, { ...AIM, gather: true }); go(0.4, AIM);
  go(0.08, { ...AIM, shot: true }); go(0.5, AIM); up(TOP, AIM); go(3, AIM);
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
  const a = fresh(21); run(a, 0.5); GM.step(a, { ...AIM, jump: true }); run(a, 0.3);       // 300 ms into a jump
  check(a.shot.state === "shooting", `expected to be mid-shot, was ${a.shot.state}`);
  const b = structuredClone(a), c = JSON.parse(JSON.stringify(a));
  for (const g of [a, b, c]) { run(g, 0.2); GM.step(g, { ...AIM, shot: true }); run(g, 3); run(g, 0.8, TOWARD); }
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

gtest("Space jumps and a click lets the ball go: at the top of the jump, 517 ms after Space, it is a perfectly timed jumper", () => {
  const g = fresh(41); run(g, 0.5);
  GM.step(g, { ...AIM, jump: true }); run(g, 61*GM.TICK);
  check(g.shot.state === "shooting" && g.shot.kind === "jumper" && g.P.h > 0.8, `61 ticks after Space: ${g.shot.state} ${g.shot.kind}, ${g.P.h.toFixed(2)} of the way up`);
  GM.step(g, { ...AIM, shot: true });
  check(g.last && g.last.kind === "jumper" && g.stats.fga === 1, "the release did not register");
  check(Math.abs(g.last.e) <= GM.C.PERFECT_MS && g.last.q === 1, `timing error ${g.last.e.toFixed(1)} ms, quality ${g.last.q}`);
  check(Math.abs(g.last.aim.theta) < 1e-9, `aim was ${g.last.aim.theta}`);
  check(g.last.shift === 0 && g.last.air === 0 && !g.last.fade, "a standing jumper goes straight up: no lean, and the line is at the top");
  run(g, 4);
  check(g.shot.state === "idle" && g.ball === null && g.P.up < 0 && g.P.h === 0, `afterwards: ${g.shot.state}, ball ${g.ball ? g.ball.phase : "gone"}, ${g.P.h} up`);
  // a click while the legs are still bending does nothing: the feet have not left
  const early = fresh(41); run(early, 0.5); GM.step(early, { ...AIM, jump: true }); run(early, 0.1); GM.step(early, { ...AIM, shot: true });
  check(early.shot.state === "shooting" && early.stats.fga === 0, "a click 100 ms after Space should not have released anything");
  return `${g.last.e.toFixed(1)} ms from the top, ${g.last.dist.toFixed(1)} ft: ${g.last.out.big} / ${g.last.out.sub}`;
});

gtest("A jump carries half the speed you arrived with, plus up to 5 ft/s the way you lean; nothing steers it after that", () => {
  const air = keys => {
    const g = fresh(45, { defenders: false });
    until(g, TOWARD, x => speed(x) >= 13.4);
    const v0 = speed(g);
    GM.step(g, { ...AIM, ...keys, jump: true }); run(g, 0.25, { ...AIM, ...keys });
    const v1 = g.P.vy;                                                  // the rim is up the floor: toward it is negative
    run(g, 0.2, { ...AIM, d: true, r: true });                          // in the air now: keys do nothing
    check(Math.abs(g.P.vy - v1) < 1e-9 && Math.abs(g.P.vx) < 1e-9, "the velocity changed in the air");
    return { v0, toward: -v1 };
  };
  const none = air({}), lean = air({ u: true }), stop = air({ d: true });
  check(Math.abs(none.toward - none.v0*GM.C.KEEP) < 0.05, `no keys: ${none.toward.toFixed(2)} ft/s from ${none.v0.toFixed(2)}`);
  check(Math.abs(lean.toward - (lean.v0*GM.C.KEEP + GM.C.LEAN)) < 0.05 && Math.abs(stop.toward - (stop.v0*GM.C.KEEP - GM.C.LEAN)) < 0.05, `leaning in ${lean.toward.toFixed(2)}, leaning back ${stop.toward.toFixed(2)}`);
  // from a standstill, leaning away from the rim is a fadeaway, and its release line is later
  const g = fresh(46, { defenders: false }); run(g, 0.3);
  GM.step(g, { ...AIM, d: true, jump: true }); run(g, 0.4, { ...AIM, d: true });
  check(Math.abs(g.P.vy - GM.C.LEAN) < 1e-9 && g.shot.shift > 40, `standing fade: ${g.P.vy.toFixed(2)} ft/s back, line ${g.shot.shift} ms`);
  run(g, (GM.C.IDEAL + g.shot.shift)/1000 - 0.4 - 2*GM.TICK); GM.step(g, { ...AIM, shot: true });
  check(g.last.fade === "back" && Math.abs(g.last.e) <= GM.C.PERFECT_MS && g.last.carried > 1 && g.last.airIn > 1.9, `fade ${g.last.fade}, ${g.last.e.toFixed(1)} ms off its line, ${g.last.carried.toFixed(1)} ft back, +${g.last.airIn.toFixed(1)} in`);
  return `at ${none.v0.toFixed(1)} ft/s: ${none.toward.toFixed(1)} carried, ${lean.toward.toFixed(1)} leaning in, ${stop.toward.toFixed(1)} leaning back; standing fade ${g.last.carried.toFixed(1)} ft back, line +${g.last.shift} ms`;
});

gtest("A floater is let go on the way up, and the faster you are still going at the rim the earlier its line is", () => {
  const line = keys => {
    const g = fresh(48, { defenders: false });
    until(g, TOWARD, x => distance(x) <= 12);
    GM.step(g, { ...AIM, ...keys, jump: true }); run(g, 0.2, { ...AIM, ...keys });
    check(g.shot.kind === "floater", `expected a floater: ${g.shot.kind}`);
    return g;
  };
  const stop = line({ d: true }), none = line({}), lean = line({ u: true });
  check(stop.shot.line < GM.C.FL_IDEAL && stop.shot.line > none.shot.line && none.shot.line > lean.shot.line && lean.shot.line > GM.C.LOAD + 60,
        `lines: braking ${stop.shot.line}, no lean ${none.shot.line}, leaning in ${lean.shot.line} ms`);
  check(GM.C.FL_IDEAL < GM.C.IDEAL - 100, "a floater's line should be well before the top of the jump");
  // let go on its line it is a well-timed floater, from lower in the jump than a jumper's release
  const g = none; run(g, none.shot.line/1000 - 0.2 - 2*GM.TICK); GM.step(g, { ...AIM, shot: true });
  check(g.last.kind === "floater" && Math.abs(g.last.e) <= GM.C.FL_PERFECT && g.P.h > 0.2 && g.P.h < 0.8, `${g.last.kind}, ${g.last.e.toFixed(1)} ms off, ${g.P.h.toFixed(2)} of the way up`);
  return `line at ${stop.shot.line} ms braking, ${none.shot.line} with no lean, ${lean.shot.line} leaning in; a jumper's is at ${GM.C.IDEAL}`;
});

gtest("Coming down with the ball is travelling", () => {
  const g = fresh(47); run(g, 0.5);
  GM.step(g, { ...AIM, jump: true }); run(g, 1);
  check(g.shot.state === "idle" && g.stats.fga === 0 && g.stats.to === 1 && /Travelling/.test(g.drib.lastMove), `${g.shot.state}, ${g.stats.fga} shots, ${g.stats.to} turnovers, "${g.drib.lastMove}"`);
  check(g.P.up < 0 && g.P.h === 0, "they should be back on the floor");
  return "no click by the time the feet came down: a turnover";
});

gtest("A click with the feet on the floor is a pump fake: no shot, and the dribble is dead", () => {
  const g = fresh(51); run(g, 0.5);
  GM.step(g, { ...AIM, shot: true }); GM.step(g, AIM);
  check(g.stats.fga === 0 && g.shot.state === "idle", `a shot was taken: ${g.stats.fga}, ${g.shot.state}`);
  check(g.hold.state === "pivot" && g.hold.fakeT > 0 && g.drib.lastMove === "Pump fake", `hold ${g.hold.state}, last move "${g.drib.lastMove}"`);
  run(g, 0.5, TOWARD);
  check(speed(g) === 0, "a dead dribble should not be able to run");
  return "pump fake, pivoting";
});

gtest("On a drive, going up early is a floater and going up late is a layup; let go high and close, either is a dunk", () => {
  const kinds = [];
  for (const [name, range] of [["floater", 12], ["layup", 6.5]]) {
    const g = fresh(61, { defenders: false });
    check(until(g, TOWARD, x => distance(x) <= range), `never got within ${range} ft`);
    const at = distance(g), v = speed(g);
    GM.step(g, { ...TOWARD, jump: true });
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

gtest("Rim or glass is chosen when the jump starts: a cursor that slides onto the backboard during it is not a bank", () => {
  const BOARD_Y = 4.0, rim = { x: RIM.x, y: RIM.y }, glass = { x: RIM.x + 1.6, y: BOARD_Y };
  // a standing jumper from the wing, with the cursor in one place at the press and another by the release
  const from = (atPress, atRelease) => {
    const g = fresh(31, { defenders: false });
    Object.assign(g.P, { x: 33, y: 13 }); run(g, 0.3, atPress);
    GM.step(g, { ...atPress, jump: true }); run(g, 2*GM.TICK, atPress); run(g, 59*GM.TICK, atRelease);
    GM.step(g, { ...atRelease, shot: true });
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

gtest("Nothing in the game is rolled except a shot's scatter", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "game.js"), "utf8");
  const calls = src.split("\n").filter(line => /\brnd\(\)/.test(line) && !/^const rnd = /.test(line));
  check(calls.length === 1 && /^function gauss\(\)/.test(calls[0]), `random numbers are drawn outside the bell curve a shot's scatter comes from:\n${calls.join("\n")}`);
  return "the only draws are the two behind each normal deviate";
});

gtest("An open dunk always goes down; with a shot blocker's arm over the rim it is met there", () => {
  const open = fresh(71, { defenders: false });
  until(open, TOWARD, x => distance(x) <= 8.5);
  shoot(open, TOP, TOWARD); run(open, 2);
  check(open.last.kind === "dunk" && open.last.out.make && open.stats.pts === 2 && !open.last.foul, `expected a made dunk: ${JSON.stringify(open.last.out)}`);
  // the same dunk with the rim protector between the dunker and the rim, at the top of a jump as the ball gets there
  const met = fresh(71, { defenders: false });
  until(met, TOWARD, x => distance(x) <= 8.5);
  GM.setDefender(met, "rimOn", true);
  for (let i = 0; i < 80 && !(met.last && met.last.kind === "dunk"); i++) {
    const u = { x: (RIM.x - met.P.x)/distance(met), y: (RIM.y - met.P.y)/distance(met) };
    Object.assign(met.R, { x: met.P.x + u.x*1.8, y: met.P.y + u.y*1.8, vx: 0, vy: 0, jumpT: 0.22, h: 1, hand: 1, jumpAt: null });
    GM.step(met, { ...TOWARD, jump: i === 0, shot: i === 62 });
  }
  check(met.last && met.last.kind === "dunk" && met.last.out.big === "Blocked" && met.last.out.sub === "Met at the rim" && met.stats.pts === 0, `expected it met at the rim: ${JSON.stringify(met.last && met.last.out)}`);
  return `open: ${open.last.out.big} / ${open.last.out.sub}; with an arm there: ${met.last.out.big} / ${met.last.out.sub}`;
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
      for (let k = 0; k < 62; k++) GM.step(g, { ...AIM, jump: k === 0 });
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
