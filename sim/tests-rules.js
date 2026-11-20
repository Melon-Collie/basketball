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
// Press the button, and let it go this long after: one jump and one release
function shoot(g, ms, aim = AIM) {
  GM.step(g, { ...aim, shot: true });
  for (let i = 1, n = Math.round(ms/1000/GM.TICK); i < n; i++) GM.step(g, { ...aim, shot: true });
  GM.step(g, aim);
}
// The next shot gets no noise at all: every random draw comes up 1, which is zero on the bell curve. A jumper draws
// 80 estimates and then the shot itself, two normals each.
const noNoise = g => g.forced.push(...Array(324).fill(1));
const PERFECT = 517, EARLY = 380;                                // ms after the press: at the top of the jump, and early enough to come up well short
// A possession starts with the ball held. One press of Shift puts it on the floor.
const floor = g => { GM.step(g, { ...AIM, gather: true }); GM.step(g, AIM); return g; };
// drive in with nobody home and dunk: a sure two. Stops as the ball leaves the hand.
function dunk(g) {
  floor(g);
  until(g, TOWARD, x => distance(x) <= 7);
  shoot(g, PERFECT, TOWARD);
  if (!g.last || g.last.kind !== "dunk") throw new Error(`expected a dunk: ${g.last && g.last.kind}`);
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

rtest("A possession starts in a triple threat: jab, shoot or fake with the dribble still there, and Shift puts it on the floor", () => {
  const g = game(21, { defenders: false }), at = { ...g.P };
  const moved = () => Math.hypot(g.P.x - at.x, g.P.y - at.y);
  check(g.hold.state === "pivot" && g.hold.live && g.drib.lastMove === "Triple threat", `${g.hold.state}, live ${g.hold.live}`);
  // WASD is the free foot: a jab goes out and comes back, and the player goes nowhere
  run(g, 0.4, TOWARD);
  const jab = moved();
  run(g, 0.5);
  check(jab > 0.5 && jab < 1.8 && moved() < 0.05 && g.hold.live, `the jab took them ${jab.toFixed(2)} ft and they ended ${moved().toFixed(2)} ft from where they began`);
  // a pump fake, a tap of the button, does not use the dribble up
  run(g, 0.08, { ...AIM, shot: true }); run(g, 0.5);
  check(g.drib.lastMove === "Pump fake" && g.hold.state === "pivot" && g.hold.live && g.stats.fga === 0, `after a fake: ${g.drib.lastMove}, ${g.hold.state}, live ${g.hold.live}`);
  // Shift puts it on the floor, and now WASD runs
  floor(g);
  check(g.hold.state === "none" && !g.hold.live && g.drib.lastMove === "Put it on the floor", `${g.hold.state}, "${g.drib.lastMove}"`);
  run(g, 0.6, TOWARD);
  check(moved() > 4, `dribbling for 0.6 s should cover ground: ${moved().toFixed(1)} ft`);
  // picking it up again is the end of the dribble: Shift will not start another
  run(g, 0.4); floor(g);
  check(g.hold.state === "pivot" && !g.hold.live, `gathered at a standstill: ${g.hold.state}, live ${g.hold.live}`);
  floor(g); const stuck = { ...g.P }; run(g, 0.5, TOWARD); run(g, 0.5);
  check(g.hold.state === "pivot" && Math.hypot(g.P.x - stuck.x, g.P.y - stuck.y) < 0.05, "a dead dribble stays dead");
  // and a shot straight out of the triple threat is an ordinary jumper
  const h = game(21, { defenders: false }); run(h, 0.5); noNoise(h); shoot(h, PERFECT);
  check(h.last.kind === "jumper" && Math.abs(h.last.e) <= GM.C.PERFECT_MS, `shooting from the catch: ${h.last.kind}, ${h.last.e.toFixed(0)} ms off`);
  return `jab ${jab.toFixed(1)} ft and back; a fake keeps the dribble; Shift, then ${moved().toFixed(0)} ft of dribbling; picked up, it stays dead`;
});

rtest("The AI gives a triple threat room, because the drive is still there, and crowds a dead dribble", () => {
  const gap = g => Math.hypot(g.D.x - g.P.x, g.D.y - g.P.y);
  const live = game(22); run(live, 3);
  check(live.hold.live && gap(live) >= GM.C.LIVE_GAP - 0.1 && live.stats.to === 0, `against a held, live ball it stood ${gap(live).toFixed(2)} ft off`);
  const dead = floor(game(22)); run(dead, 0.6); floor(dead); run(dead, 2, { x: dead.P.x + 3, y: dead.P.y + 6 });   // on the floor, picked up again, ball held away
  check(!dead.hold.live && dead.hold.state === "pivot" && gap(dead) < 2.4, `against a dead dribble it closed to ${gap(dead).toFixed(2)} ft`);
  return `${gap(live).toFixed(1)} ft off a triple threat, ${gap(dead).toFixed(1)} ft off a dead dribble`;
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
  GM.step(g, { ...AIM, shot: true }); GM.step(g, { ...AIM, shot: true }); GM.step(g, AIM);
  check(g.stats.fga === 1 && g.shot.state === "idle", "the shooter should not be able to shoot without the ball");
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
  check(g.hold.state === "pivot" && g.hold.live, "a rebound is a catch: held, with the dribble still there");
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

rtest("A press goes up for a loose ball, and the player in the air takes it before it comes down to the other", () => {
  // both stand the same distance from where it is coming down, either side of it
  const either = (x, s) => { stand(x, "P", s.x + 1, s.y); stand(x, "D", s.x - 1, s.y); };
  const none = rebound(3, either, () => [AIM, AIM]);
  const offense = rebound(3, either, (x, s, i) => [{ ...AIM, shot: i === 0 }, AIM]);
  const defense = rebound(3, either, (x, s, i) => [AIM, { ...AIM, shot: i === 0 }]);
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

rtest("Over the back: jumping into a player who has the spot gives them the ball", () => {
  const toward = (x, body, tx, ty) => { const dx = tx - x[body].x, dy = ty - x[body].y; return { ...AIM, l: dx < -0.2, r: dx > 0.2, u: dy < -0.2, d: dy > 0.2 }; };
  // away from the ball: one stands, the other runs at their back from 6 ft and leaves the floor just before getting there
  const crash = runner => {
    const stander = runner === "P" ? "D" : "P", at = { x: 8, y: 30 };
    return rebound(4, x => { stand(x, stander, at.x, at.y); stand(x, runner, at.x, at.y + 6); }, (x, s, i) => {
      const gap = Math.hypot(x.P.x - x.D.x, x.P.y - x.D.y), mine = { ...toward(x, runner, at.x, at.y), shot: gap < 3.2 };
      return runner === "P" ? [mine, AIM] : [AIM, mine];
    });
  };
  const byDefense = crash("D"), byOffense = crash("P");
  check(byDefense.g.flow.why === "Over the back" && byDefense.g.flow.next === "keep", `the defender went over the shooter's back: ${describe(byDefense.g)}`);
  check(byOffense.g.flow.why === "Over the back" && byOffense.g.flow.next === "change", `the shooter went over the defender's back: ${describe(byOffense.g)}`);
  // running into their back without leaving the floor is not a foul: it just stops you
  const ran = rebound(4, x => { stand(x, "P", 8, 30); stand(x, "D", 8, 36); }, (x, s, i) => i < ticks(1) ? [AIM, toward(x, "D", 8, 30)] : [AIM, AIM]);
  check(ran.g.flow.why !== "Over the back", `staying on the floor should not be a foul: ${describe(ran.g)}`);
  return "into the back in the air: the ball goes to the player who had the spot, whichever side they are";
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

rtest("Dribbling the ball into a defender's hand loses it, and that ends the possession", () => {
  const g = game(11); g.params.sag = 3; floor(g);
  // dribbling on the spot with the ball out in front, and a defender who plays 3 ft off: it bounces into their hand
  check(until(g, AIM, dead, 8) && g.flow.why === "Stolen", describe(g));
  check(g.stats.to === 1 && g.simT > RULES.GRACE, `turnovers ${g.stats.to}, ${g.simT.toFixed(2)} s in`);
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.offense === 1, describe(g));
  // standing off with the ball, the same defender never gets it
  const h = game(11); run(h, 10);
  check(h.stats.to === 0 && h.flow.why !== "Stolen", `left alone at a distance the ball should be safe: ${describe(h)}`);
  return `picked ${g.simT.toFixed(1)} s in`;
});

rtest("A dunk met at the rim is a live ball; left alone it is whistled dead and given away", () => {
  const g = floor(game(10, { defenders: false }));
  until(g, TOWARD, x => distance(x) <= 7);
  GM.setDefender(g, "rimOn", true);
  for (let i = 0; i < 80 && !(g.last && g.last.kind === "dunk"); i++) {       // the rim protector in the way, at the top of a jump
    const u = { x: (RIM.x - g.P.x)/distance(g), y: (RIM.y - g.P.y)/distance(g) };
    Object.assign(g.R, { x: g.P.x + u.x*1.8, y: g.P.y + u.y*1.8, vx: 0, vy: 0, jumpT: 0.22, h: 1, hand: 1, jumpAt: null });
    GM.step(g, { ...TOWARD, shot: i < 62 });
  }
  check(g.last && g.last.out.sub === "Met at the rim" && g.ball && g.ball.phase === "path", `${JSON.stringify(g.last && g.last.out)}; ${describe(g)}`);
  GM.setDefender(g, "rimOn", false);                               // and now nobody goes after it:
  Object.assign(g.P, { x: 3, y: 36, vx: 0, vy: 0, up: -1, h: 0 });  // the dunker, who would come down right under it, is taken away too
  check(until(g, x => ({ x: 3, y: 36, l: x.P.x > 4, d: x.P.y < 36 }), dead, 14) && ["Dead ball", "Out of bounds"].includes(g.flow.why) && g.flow.score.join() === "0,0", describe(g));
  run(g, RULES.DEAD_T + 0.05);
  check(g.flow.phase === "live", describe(g));
  return `loose, then ${g.flow.why === "" ? "dead" : "whistled"}`;
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
  const h = floor(game(13, { defenders: false }));
  until(h, TOWARD, x => distance(x) <= 6.5);
  GM.step(h, { ...TOWARD, shot: true }); run(h, 0.2, { ...TOWARD, shot: true });   // going up for a layup
  check(h.shot.kind === "layup" && h.shot.state === "shooting", `expected a layup in progress: ${h.shot.kind}, ${h.shot.state}`);
  // 80 estimates with no noise, then the layup itself with as much noise as there can be: a clank
  h.forced.push(...Array(320).fill(1), 1e-12, 0, 1e-12, 0);
  run(h, 0.13, { ...TOWARD, shot: true }); GM.step(h, TOWARD);      // let go on the way up, before the hand is over the rim
  check(h.shot.state === "flight" && h.last.kind === "layup" && !h.last.out.make, `expected a missed layup in the air: ${JSON.stringify(h.last && h.last.out)}`);
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
