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

// a little of everything: a jumper, a retreat, a drive into a floater, a gather and a pump fake
function session(game, each = () => {}) {
  const go = (seconds, input) => { for (let i = 0, n = ticks(seconds); i < n; i++) { GM.step(game, input); each(game); } };
  go(0.5, AIM); go(0.52, { ...AIM, shot: true }); go(3, AIM);
  go(0.6, { ...AIM, d: true }); go(1.2, { ...TOWARD, x: RIM.x + 2 }); go(0.33, { ...TOWARD, shot: true }); go(3, AIM);
  go(0.8, { ...AIM, d: true, l: true }); go(0.3, { ...AIM, x: RIM.x - 6 }); go(0.05, { ...AIM, gather: true }); go(0.4, AIM);
  go(0.08, { ...AIM, shot: true }); go(0.5, AIM); go(0.52, { ...AIM, shot: true }); go(3, AIM);
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
  const a = fresh(21); run(a, 0.5); run(a, 0.3, { ...AIM, shot: true });       // 300 ms into a jumper
  check(a.shot.state === "shooting", `expected to be mid-shot, was ${a.shot.state}`);
  const b = structuredClone(a), c = JSON.parse(JSON.stringify(a));
  for (const g of [a, b, c]) { run(g, 0.22, { ...AIM, shot: true }); run(g, 3); run(g, 0.8, TOWARD); }
  check(a.last && a.stats.fga === 1, "the shot never resolved");
  check(JSON.stringify(a) === JSON.stringify(b), "the structured clone drifted from the original");
  check(JSON.stringify(a) === JSON.stringify(c), "the JSON copy drifted from the original");
  return `copied 300 ms into a jumper; all three ended on ${a.last.out.big} / ${a.last.out.sub}`;
});

gtest("Looking at the odds never changes what happens", () => {
  const a = session(fresh(31)), b = session(fresh(31), g => GM.preview(g, false));
  const sim = g => JSON.stringify({ ...g, view: null });
  check(sim(a) === sim(b), "previewing every tick changed the game");
  check(JSON.stringify(a.view) !== JSON.stringify(b.view), "the preview should have used its own stream");
  return "previewed every tick; everything outside game.view matched";
});

gtest("Holding the shot button for 517 ms from a standstill is a perfectly timed jumper", () => {
  const g = fresh(41); run(g, 0.5);
  for (let i = 0; i < 62; i++) GM.step(g, { ...AIM, shot: true });
  check(g.shot.state === "shooting" && g.shot.kind === "jumper", `after 62 ticks: ${g.shot.state} ${g.shot.kind}`);
  GM.step(g, AIM);
  check(g.last && g.last.kind === "jumper" && g.stats.fga === 1, "the release did not register");
  check(Math.abs(g.last.e) <= GM.C.PERFECT_MS && g.last.q === 1, `timing error ${g.last.e.toFixed(1)} ms, quality ${g.last.q}`);
  check(Math.abs(g.last.aim.theta) < 1e-9, `aim was ${g.last.aim.theta}`);
  run(g, 4);
  check(g.shot.state === "idle" && g.ball === null, `afterwards: ${g.shot.state}, ball ${g.ball ? g.ball.phase : "gone"}`);
  return `${g.last.e.toFixed(1)} ms from ideal, ${g.last.dist.toFixed(1)} ft: ${g.last.out.big} / ${g.last.out.sub}`;
});

gtest("Letting go inside 150 ms is a pump fake: no shot, and the dribble is dead", () => {
  const g = fresh(51); run(g, 0.5);
  run(g, 0.1, { ...AIM, shot: true }); GM.step(g, AIM);
  check(g.stats.fga === 0 && g.shot.state === "idle", `a shot was taken: ${g.stats.fga}, ${g.shot.state}`);
  check(g.hold.state === "pivot" && g.drib.lastMove === "Pump fake", `hold ${g.hold.state}, last move "${g.drib.lastMove}"`);
  run(g, 0.5, TOWARD);
  check(speed(g) === 0, "a dead dribble should not be able to run");
  return "100 ms hold: pump fake, pivoting";
});

gtest("On a drive, clicking early is a floater, clicking late is a layup, and Shift makes it a dunk", () => {
  const kinds = [];
  for (const [name, range, extra] of [["floater", 12, {}], ["layup", 6.5, {}], ["dunk", 8.5, { shift: true }]]) {
    const g = fresh(61, { defenders: false });
    check(until(g, TOWARD, x => distance(x) <= range), `never got within ${range} ft`);
    const at = distance(g), v = speed(g);
    GM.step(g, { ...TOWARD, shot: true, ...extra });
    check(g.shot.kind === name, `from ${at.toFixed(1)} ft at ${v.toFixed(1)} ft/s: ${g.shot.kind}, expected ${name}`);
    kinds.push(`${name} from ${at.toFixed(1)} ft`);
  }
  const slow = fresh(61, { defenders: false }); until(slow, TOWARD, x => distance(x) <= 8.5); run(slow, 0.4);   // let the speed bleed off
  GM.step(slow, { ...AIM, shot: true, shift: true });
  check(slow.shot.kind !== "dunk", "a dunk needs speed toward the rim");
  return kinds.join(", ");
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
  run(open, 0.5, { ...TOWARD, shot: true, shift: true }); run(open, 2);
  check(open.last.kind === "dunk" && open.last.out.make && open.stats.pts === 2 && !open.last.foul, `expected a made dunk: ${JSON.stringify(open.last.out)}`);
  // the same dunk with the rim protector between the dunker and the rim, at the top of a jump as the ball gets there
  const met = fresh(71, { defenders: false });
  until(met, TOWARD, x => distance(x) <= 8.5);
  GM.setDefender(met, "rimOn", true);
  for (let i = 0; i < 80 && !(met.last && met.last.kind === "dunk"); i++) {
    const u = { x: (RIM.x - met.P.x)/distance(met), y: (RIM.y - met.P.y)/distance(met) };
    Object.assign(met.R, { x: met.P.x + u.x*1.8, y: met.P.y + u.y*1.8, vx: 0, vy: 0, jumpT: 0.22, h: 1, hand: 1, jumpAt: null });
    GM.step(met, { ...TOWARD, shot: true, shift: true });
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
      for (let k = 0; k < 62; k++) GM.step(g, { ...AIM, shot: true });
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
