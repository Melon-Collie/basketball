// Tests for the rules of a game: score, possessions, the shot clock, loose balls, out of bounds and free throws.
// Like tests-game.js, these play the real rules tick by tick with no page.
const GM = require("./game.js");

const ruleTests = [];
function rtest(name, fn) { ruleTests.push({ name, fn }); }
function check(cond, msg) { if (!cond) throw new Error(msg); }

const RIM = GM.HOOP, RULES = GM.RULES, AIM = { x: RIM.x, y: RIM.y }, TOWARD = { ...AIM, u: true };
const ticks = seconds => Math.round(seconds/GM.TICK);
const run = (g, seconds, input = AIM) => { for (let i = 0, n = ticks(seconds); i < n; i++) GM.step(g, input); };
// step until something is true; input may be a function of the game
function until(g, input, done, limit = 12) {
  for (let i = 0, n = ticks(limit); i < n && !done(g); i++) GM.step(g, typeof input === "function" ? input(g) : input);
  return done(g);
}
const distance = g => Math.hypot(RIM.x - g.P.x, RIM.y - g.P.y);
const dead = g => g.flow.phase === "dead";
const describe = g => `${g.flow.phase}${g.flow.loose ? ", loose" : ""}, "${g.flow.why}", ${g.flow.score.join("-")}, side ${g.flow.offense} has it`;
function game(seed, { defenders = true } = {}) {
  const g = GM.create({ seed, rules: true });
  if (!defenders) { GM.setDefender(g, "defOn", false); GM.setDefender(g, "rimOn", false); }
  return g;
}
// hold the shot button for this long, then let go
function shoot(g, ms, aim = AIM) { for (let i = 0, n = Math.round(ms/1000/GM.TICK); i < n; i++) GM.step(g, { ...aim, shot: true }); GM.step(g, aim); }
// The next shot gets no noise at all: every random draw comes up 1, which is zero on the bell curve. A jumper draws
// 80 estimates and then the shot itself, two normals each.
const noNoise = g => g.forced.push(...Array(324).fill(1));
const PERFECT = 517, EARLY = 380;                                // ms: on time, and early enough to come up well short
// drive in with nobody home and dunk: a sure two unless the fumble roll comes up
function dunk(g, rolls = [0.5, 0.5, 0.5]) {
  until(g, TOWARD, x => distance(x) <= 8.5);
  g.forced.push(...rolls);                                        // the foul, block and fumble rolls
  run(g, 0.5, { ...TOWARD, shot: true, shift: true });
}
// run at a loose ball: toward where it can first be caught
function chase(g) {
  const b = g.ball, p = b.path.find(q => q.t >= b.t && q.z <= RULES.CATCH_Z) || b.path[b.path.length - 1];
  const dx = p.x - g.P.x, dy = p.y - g.P.y;
  return { ...AIM, l: dx < -0.3, r: dx > 0.3, u: dy < -0.3, d: dy > 0.3 };
}

rtest("A game starts with a check ball at the top: full clock, defender at their cushion, no score", () => {
  const g = game(1), fl = g.flow;
  check(fl.on && fl.phase === "live" && fl.offense === 0 && fl.score.join() === "0,0" && fl.clock === RULES.SHOT_CLOCK, describe(g));
  check(g.P.x === RULES.CHECK.x && g.P.y === RULES.CHECK.y, `handler at ${g.P.x}, ${g.P.y}`);
  check(g.D.y === RULES.CHECK.y - g.params.sag && g.R.y === 8.5, `defenders at y ${g.D.y} and ${g.R.y}`);
  return `handler ${distance(g).toFixed(2)} ft out, behind the arc`;
});

rtest("A made three scores three for the side with the ball, and the other side takes it from the top", () => {
  const g = game(2, { defenders: false }); run(g, 0.5);
  noNoise(g); shoot(g, PERFECT);
  check(g.last.out.make && g.last.three, `expected a made three: ${JSON.stringify(g.last.out)}`);
  check(until(g, AIM, dead, 4) && g.flow.why === "Score" && g.flow.score.join() === "3,0", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.phase === "live" && g.flow.offense === 1 && g.P.y === RULES.CHECK.y && g.ball === null, describe(g));
  check(g.flow.clock > RULES.SHOT_CLOCK - 0.1, `clock ${g.flow.clock}`);
  return "3-0, then the other side's ball";
});

rtest("A miss is a live ball: the defense gets to it first and takes over", () => {
  const g = game(3); run(g, 0.5);
  g.forced.push(...Array(400).fill(1));                            // no noise and no defender leaving their feet: just a shot that is short
  shoot(g, EARLY); g.forced.length = 0;
  check(until(g, AIM, x => x.flow.loose, 4), `the miss never came loose: ${describe(g)}`);
  check(g.shot.state === "idle" && g.ball !== null, "a loose ball should be nobody's");
  GM.step(g, { ...AIM, shot: true }); GM.step(g, AIM);
  check(g.stats.fga === 1, "the shooter should not be able to shoot without the ball");
  check(until(g, AIM, dead, 8) && g.flow.why === "Defensive rebound", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.offense === 1 && g.flow.score.join() === "0,0", describe(g));
  return `${g.last.out.sub}, defensive rebound`;
});

rtest("With nobody else there, the shooter can run down their own miss and play on with a fresh clock", () => {
  const g = game(7, { defenders: false }); run(g, 2);
  shoot(g, EARLY);
  check(until(g, AIM, x => x.flow.loose, 4), describe(g));
  const before = g.flow.clock;
  check(until(g, x => x.flow.loose ? chase(x) : AIM, x => !x.flow.loose, 10), "never got to the ball");
  check(g.flow.phase === "live" && g.flow.offense === 0 && g.ball === null && g.drib.lastMove === "Offensive rebound", describe(g));
  check(before < RULES.SHOT_CLOCK - 2 && g.flow.clock === RULES.SHOT_CLOCK, `clock went from ${before.toFixed(1)} to ${g.flow.clock.toFixed(1)}`);
  run(g, 0.5); shoot(g, PERFECT);
  check(g.stats.fga === 2, "should be able to shoot again after the rebound");
  return `clock ${before.toFixed(1)} back to ${RULES.SHOT_CLOCK}`;
});

// ---------- Two players: rebounding ----------
// A two-player game with a miss in the air: side 0 shoots early from the top and it comes up short. `set` is called once,
// the moment the ball comes loose, to put the two players where the test wants them. Returns what happened.
function rebound(seed, set, inputs) {
  const g = GM.create({ seed, rules: true, duo: true });
  run(g, 0.5, [AIM, AIM]);
  g.forced.push(...Array(400).fill(1));
  for (let i = 0, n = Math.round(EARLY/1000/GM.TICK); i < n; i++) GM.step(g, [{ ...AIM, shot: true }, AIM]);
  GM.step(g, [AIM, AIM]); g.forced.length = 0;
  if (!until(g, [AIM, AIM], x => x.flow.loose, 4)) throw new Error(`the miss never came loose: ${describe(g)}`);
  const b = g.ball, spot = b.path.find(q => q.t >= b.t && q.z <= RULES.CATCH_Z) || b.path[b.path.length - 1];   // where it comes down to standing reach
  set(g, spot);
  const start = { P: { ...g.P }, D: { ...g.D } };
  let z = null;
  for (let i = 0; i < ticks(6) && g.flow.loose; i++) { z = GM.pathPoint(g.ball).z; GM.step(g, inputs(g, spot, i)); }
  return { g, spot, start, z, who: g.flow.loose ? "nobody" : g.flow.phase === "dead" ? "defense" : "offense" };
}
const stand = (g, body, x, y) => Object.assign(g[body], { x, y, vx: 0, vy: 0 });

rtest("Two players: there is no rim protector, and the on-ball defender is the only other body", () => {
  const g = GM.create({ seed: 1, rules: true, duo: true }), solo = game(1);
  check(g.params.rimOn === false && solo.params.rimOn === true, `two players: ${g.params.rimOn}; one: ${solo.params.rimOn}`);
  // a miss with both players out of the way: one against the AI the rim protector goes and gets it; here nobody does
  let home = null;
  const r = rebound(2, (x, s) => { stand(x, "P", 3, 36); stand(x, "D", 47, 36); home = { ...x.R }; }, (x, s, i) => i < ticks(1.5) ? [{ x: 3, y: 36 }, { x: 47, y: 36 }] : [{ x: 3, y: 36, u: true }, { x: 47, y: 36 }]);
  check(r.g.R.x === home.x && r.g.R.y === home.y, "the rim protector should not have moved");
  check(r.g.flow.why !== "Defensive rebound", `nobody on defense was near it: ${describe(r.g)}`);
  return `the ball was left alone: ${r.who === "nobody" ? "still loose" : describe(r.g)}`;
});

rtest("Space goes up for a loose ball, and the player in the air takes it before it comes down to the other", () => {
  // both stand the same distance from where it is coming down, either side of it
  const either = (x, s) => { stand(x, "P", s.x + 1, s.y); stand(x, "D", s.x - 1, s.y); };
  const none = rebound(3, either, () => [AIM, AIM]);
  const offense = rebound(3, either, (x, s, i) => [{ ...AIM, gather: i === 0 }, AIM]);
  const defense = rebound(3, either, (x, s, i) => [AIM, { ...AIM, gather: i === 0 }]);
  check(none.who !== "nobody" && none.z <= RULES.CATCH_Z + 0.2, `standing, it is caught at standing reach: ${none.who} at ${none.z.toFixed(2)} ft`);
  check(offense.who === "offense" && offense.g.drib.lastMove === "Offensive rebound" && offense.z > RULES.CATCH_Z + 0.3, `the shooter went up: ${offense.who} at ${offense.z.toFixed(2)} ft`);
  check(defense.who === "defense" && defense.g.flow.why === "Defensive rebound" && defense.z > RULES.CATCH_Z + 0.3, `the defender went up: ${defense.who} at ${defense.z.toFixed(2)} ft, ${describe(defense.g)}`);
  check(offense.g.P.jumpT >= 0 || offense.g.P.land > 0, "the shooter should be in the air or just landed");
  // a jump is half a second up and down with no steering, and then a moment before another
  const g = offense.g; run(g, 0.6, [AIM, AIM]);
  check(g.P.jumpT < 0 && g.P.h === 0, "half a second later they should be back on the floor");
  return `nobody jumps: ${none.who} at ${none.z.toFixed(1)} ft. Shooter jumps: theirs at ${offense.z.toFixed(1)} ft. Defender jumps: theirs at ${defense.z.toFixed(1)} ft`;
});

rtest("Boxing out: a player standing their ground keeps the spot, and the one running into their back is stopped", () => {
  const toward = (x, body, tx, ty) => { const dx = tx - x[body].x, dy = ty - x[body].y; return { ...AIM, l: dx < -0.2, r: dx > 0.2, u: dy < -0.2, d: dy > 0.2 }; };
  // away from the ball, so it is only the two bodies: one stands, the other runs at them from 6 ft for a second
  const bump = runner => {
    const stander = runner === "P" ? "D" : "P", at = { x: 8, y: 30 };
    const r = rebound(4, x => { stand(x, stander, at.x, at.y); stand(x, runner, at.x, at.y + 6); },
                      (x, s, i) => i >= ticks(1) ? [{ ...AIM, shot: false }, AIM] : runner === "P" ? [toward(x, "P", at.x, at.y), AIM] : [AIM, toward(x, "D", at.x, at.y)]);
    const moved = body => Math.hypot(r.g[body].x - r.start[body].x, r.g[body].y - r.start[body].y);
    return { stood: moved(stander), ran: moved(runner), gap: Math.hypot(r.g.P.x - r.g.D.x, r.g.P.y - r.g.D.y) };
  };
  for (const runner of ["D", "P"]) {
    const b = bump(runner);
    check(b.stood < 0.05, `with ${runner} running in, the one standing was moved ${b.stood.toFixed(2)} ft`);
    check(b.ran > 3.5 && b.gap >= 1.69 && b.gap < 2.6, `${runner} should have run to their back and stopped there: ran ${b.ran.toFixed(1)} ft, ended ${b.gap.toFixed(2)} ft away`);
  }
  // and under the ball: the one on the spot has it, with the other at their back
  const off = rebound(4, (x, s) => { stand(x, "P", s.x, s.y); stand(x, "D", s.x, s.y + 1.8); }, (x, s) => [AIM, toward(x, "D", s.x, s.y)]);
  const def = rebound(4, (x, s) => { stand(x, "D", s.x, s.y); stand(x, "P", s.x, s.y + 1.8); }, (x, s) => [toward(x, "P", s.x, s.y), AIM]);
  check(off.who === "offense" && def.who === "defense", `the one on the spot should get it: ${off.who}, then ${def.who}`);
  const b = bump("D");
  return `the one standing moved ${b.stood.toFixed(2)} ft; the runner covered ${b.ran.toFixed(1)} ft and was stopped ${b.gap.toFixed(2)} ft away`;
});

rtest("Against the AI, a miss takes a reaction time to register before the defenders go after it", () => {
  const g = game(3); run(g, 0.5);
  g.forced.push(...Array(400).fill(1));
  shoot(g, EARLY); g.forced.length = 0;
  check(until(g, AIM, x => x.flow.loose, 4), describe(g));
  const at0 = { x: g.R.x, y: g.R.y }, wait = g.params.react/1000;
  run(g, wait - 0.05);
  const early = Math.hypot(g.R.x - at0.x, g.R.y - at0.y);
  run(g, 0.4);
  const later = Math.hypot(g.R.x - at0.x, g.R.y - at0.y);
  check(early < 0.5 && later > 1, `the rim protector moved ${early.toFixed(2)} ft in the first ${(wait - 0.05).toFixed(2)} s and ${later.toFixed(2)} ft soon after`);
  return `${early.toFixed(2)} ft before reacting, ${later.toFixed(1)} ft after`;
});

rtest("The shot clock runs while the handler has the ball, and running out gives it away", () => {
  const g = game(8, { defenders: false });
  run(g, 5);
  check(Math.abs(g.flow.clock - (RULES.SHOT_CLOCK - 5)) < 0.02, `after 5 s the clock read ${g.flow.clock}`);
  check(until(g, AIM, dead, 10) && g.flow.why === "Shot clock violation", describe(g));
  const at = g.simT;
  check(Math.abs(at - RULES.SHOT_CLOCK) < 0.05, `whistled at ${at.toFixed(2)} s`);
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.offense === 1 && g.flow.clock > RULES.SHOT_CLOCK - 0.1, describe(g));
  return `violation at ${at.toFixed(1)} s`;
});

rtest("An airball out of bounds goes to the other side", () => {
  const g = game(9, { defenders: false }); run(g, 0.5);
  shoot(g, PERFECT, { x: RIM.x + 14, y: RIM.y });                  // aimed well wide
  check(until(g, AIM, dead, 14) && g.flow.why === "Out of bounds", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.offense === 1, describe(g));
  return `${g.last.out.sub}, out of bounds`;
});

rtest("A steal ends the possession", () => {
  const g = game(11);
  // every steal roll comes up in the defender's favor
  check(until(g, x => { x.forced.length = 0; x.forced.push(0); return AIM; }, dead, 8) && g.flow.why === "Stolen", describe(g));
  check(g.stats.to === 1, `turnovers ${g.stats.to}`);
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.offense === 1, describe(g));
  return `picked ${g.simT.toFixed(1)} s in`;
});

rtest("A dunk that rattles out is a live ball off the rim; left alone it is whistled dead and given away", () => {
  const g = game(10, { defenders: false });
  dunk(g, [0.5, 0.5, 0.01]);
  check(g.last.out.sub === "Rattled out" && g.flow.loose && g.ball && g.ball.phase === "path", describe(g));
  check(until(g, AIM, dead, 14) && g.flow.why === "Dead ball" && g.flow.score.join() === "0,0", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.offense === 1, describe(g));
  return "loose, then dead";
});

rtest("A foul on a made finish is an and-one: one free throw, worth one, from a clean look at the line", () => {
  const g = game(12, { defenders: false });
  dunk(g);
  check(g.last.out.make && g.shot.state === "flight", `expected a dunk in the air: ${JSON.stringify(g.last.out)}`);
  g.flow.fouled = true;                                            // call the foul by hand: with nobody defending there is no one to commit it
  check(until(g, AIM, dead, 3) && g.flow.why === "And one" && g.flow.score.join() === "2,0", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.phase === "ft" && g.flow.ft === 1, describe(g));
  check(Math.abs(distance(g) - RULES.FT_LINE) < 1e-9, `shooter ${distance(g)} ft out`);
  const far = Math.min(...[g.D, g.R].map(d => Math.hypot(d.x - g.P.x, d.y - g.P.y)));
  check(far >= 8, `a defender is ${far.toFixed(1)} ft from the shooter`);
  const spot = { ...g.P }, dSpot = { ...g.D };
  run(g, 0.6, { ...AIM, u: true, l: true });
  check(g.P.x === spot.x && g.P.y === spot.y && g.D.x === dSpot.x && g.D.y === dSpot.y, "nobody should move at the line");
  const fga = g.stats.fga;
  noNoise(g); shoot(g, PERFECT);
  check(g.last.kind === "jumper" && g.last.out.make, `free throw: ${JSON.stringify(g.last.out)}`);
  check(until(g, AIM, dead, 4) && g.flow.score.join() === "3,0" && g.flow.why === "Good", describe(g));
  check(g.stats.fta === 1 && g.stats.ftm === 1 && g.stats.fga === fga, `free throws ${g.stats.ftm}/${g.stats.fta}, field goals ${g.stats.fga}`);
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.phase === "live" && g.flow.offense === 1, describe(g));
  return "2 + 1, then the other side's ball";
});

rtest("A foul on a missed finish is two free throws; a miss at the line scores nothing", () => {
  const h = game(13, { defenders: false });
  until(h, TOWARD, x => distance(x) <= 6.5);
  run(h, 0.2, { ...TOWARD, shot: true });                          // going up for a layup
  check(h.shot.kind === "layup" && h.shot.state === "shooting", `expected a layup in progress: ${h.shot.kind}, ${h.shot.state}`);
  // the foul roll, 80 estimates with no noise, then the layup itself with as much noise as there can be: a clank
  h.forced.push(0.5, ...Array(320).fill(1), 1e-12, 0, 1e-12, 0);
  check(until(h, AIM, x => x.shot.state === "flight", 1) && !h.last.out.make, `expected a missed layup in the air: ${JSON.stringify(h.last && h.last.out)}`);
  h.flow.fouled = true;                                            // call the foul by hand, as above
  check(until(h, AIM, dead, 4) && h.flow.why === "Foul" && h.flow.ft === 2 && !h.flow.loose, describe(h));
  run(h, RULES.DEAD_T + 0.05);
  check(h.flow.phase === "ft" && h.flow.ft === 2, describe(h));
  run(h, 0.5); noNoise(h); shoot(h, PERFECT);                      // a press in the first moment after a whistle is ignored
  check(until(h, AIM, dead, 4) && h.flow.score.join() === "1,0" && h.flow.next === "ft", describe(h));
  run(h, RULES.FT_GAP + 0.05);
  check(h.flow.phase === "ft" && h.flow.ft === 1, describe(h));
  run(h, 0.5); shoot(h, PERFECT, { x: RIM.x + 8, y: RIM.y });      // aimed well wide
  check(!h.last.out.make, `the second should miss: ${JSON.stringify(h.last.out)}`);
  check(until(h, AIM, dead, 6) && h.flow.score.join() === "1,0" && h.flow.why === "No good" && h.flow.next === "change", describe(h));
  check(h.stats.fta === 2 && h.stats.ftm === 1, `free throws ${h.stats.ftm}/${h.stats.fta}`);
  return `${h.last.out.sub} on the second: 1 of 2`;
});

rtest("First to 21 wins: the game stops, and a new game starts from nothing", () => {
  const g = game(14, { defenders: false });
  g.flow.score = [19, 6];
  dunk(g);
  check(until(g, AIM, dead, 3) && g.flow.why === "Game" && g.flow.score.join() === "21,6", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.phase === "over" && g.flow.winner === 0, describe(g));
  const spot = { ...g.P };
  run(g, 1, TOWARD); shoot(g, PERFECT);
  check(g.P.x === spot.x && g.P.y === spot.y && g.flow.phase === "over" && g.stats.fga === 1, "nothing should happen after the game is over");
  GM.newGame(g);
  check(g.flow.phase === "live" && g.flow.score.join() === "0,0" && g.flow.winner === null && g.stats.fga === 0 && g.P.y === RULES.CHECK.y, describe(g));
  return "21-6, then a new game";
});

rtest("With the rules off none of this applies, and switching them on starts a game", () => {
  const g = GM.create({ seed: 15 });
  check(!g.flow.on && g.P.y === 26, `rules ${g.flow.on}, handler at y ${g.P.y}`);
  run(g, 0.5); shoot(g, EARLY); run(g, 20);
  check(g.flow.phase === "live" && !g.flow.loose && g.flow.score.join() === "0,0" && g.flow.clock === RULES.SHOT_CLOCK, describe(g));
  check(g.shot.state === "idle" && g.P.y === 26, "in the shot lab the handler just gets the ball back");
  GM.setRules(g, true);
  check(g.flow.on && g.P.y === RULES.CHECK.y && g.stats.fga === 0, describe(g));
  GM.setRules(g, false);
  check(!g.flow.on && g.P.y === 26, "switching off goes back to the lab's starting spot");
  return "lab, game, lab";
});

rtest("A game under the rules is still deterministic and still plain data", () => {
  const play = g => { for (let k = 0; k < 5; k++) { run(g, 0.7); shoot(g, k % 2 ? EARLY : PERFECT); run(g, 6, k % 2 ? TOWARD : AIM); } return g; };
  const a = play(game(16)), b = play(game(16));
  check(JSON.stringify(a) === JSON.stringify(b), "two runs from the same seed differed");
  const c = game(17); run(c, 0.7); shoot(c, EARLY); until(c, AIM, x => x.flow.loose, 4);
  const d = JSON.parse(JSON.stringify(c));
  run(c, 8, TOWARD); run(d, 8, TOWARD);
  check(JSON.stringify(c) === JSON.stringify(d), "a copy made while the ball was loose drifted");
  return `${a.flow.score.join("-")} after five trips; copied mid-rebound`;
});

if (require.main === module) {
  let pass = 0;
  for (const t of ruleTests) {
    try { const info = t.fn(); pass++; console.log(`PASS  ${t.name}\n      ${info || ""}`); }
    catch (e) { console.log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  console.log(`\n${pass}/${ruleTests.length} passed`);
  if (pass < ruleTests.length) process.exitCode = 1;
}
module.exports = { ruleTests };
