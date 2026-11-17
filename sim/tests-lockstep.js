// Tests for two-player play: a player-controlled defender, and two copies of a game kept in step over a link that
// delivers messages late. No browser and no network: the link here is a queue.
const GM = require("./game.js"), LS = require("./lockstep.js");

const lockTests = [];
function ltest(name, fn) { lockTests.push({ name, fn }); }
function check(cond, msg) { if (!cond) throw new Error(msg); }
const RIM = GM.HOOP, same = (a, b) => JSON.stringify({ ...a, view: null }) === JSON.stringify({ ...b, view: null });

// Two copies of one game joined by a link that takes `lag` ticks each way. Each tick both sides sample an input
// (from a script of what each side's player is doing at that tick) and run what they can.
function pair(seed, lag) {
  const games = [0, 1].map(() => GM.create({ seed, rules: true, duo: true })), wire = [];
  const peers = games.map((g, me) => LS.create(g, me, m => wire.push({ at: clock + lag, to: 1 - me, m: JSON.parse(JSON.stringify(m)) })));
  let clock = 0;
  const tick = script => {
    while (wire.length && wire[0].at <= clock) { const w = wire.shift(); LS.receive(peers[w.to], w.m); }
    for (const p of peers) { LS.sample(p, script(p.me, clock)); LS.advance(p); }
    clock++;
  };
  return { games, peers, tick, run: (n, script) => { for (let i = 0; i < n; i++) tick(script); } };
}
const idle = (x, y) => ({ ...LS.NEUTRAL, x, y });
// side 0 has the ball first: it holds, shoots, drives; side 1 defends: moves, reaches, jumps
function script(me, t) {
  const s = t/120;
  if (me === 0) return { ...idle(RIM.x + 3*Math.sin(s), RIM.y), u: s > 3 && s < 3.6, shot: (s > 1 && s < 1.52) || (s > 6 && s < 6.3), gather: s > 5 && s < 5.05, l: s > 7 && s < 7.5 };
  return { ...idle(25 + 2*Math.cos(s*2), 28), d: s > 0.3 && s < 0.6, l: s > 2 && s < 2.4, r: s > 4 && s < 4.5, gather: (s > 1.3 && s < 1.35) || (s > 6.2 && s < 6.25), shot: s > 8 && s < 8.5 };
}

ltest("The side without the ball controls the on-ball defender: WASD moves, the cursor raises a hand, Space jumps", () => {
  const g = GM.create({ seed: 1, rules: true, duo: true }), start = { ...g.D };
  const step = (n, def, off = idle(g.P.x - 3, g.P.y + 3)) => { for (let i = 0; i < n; i++) GM.step(g, [off, def]); };   // the handler keeps the ball away
  step(60, idle(g.D.x, g.D.y));
  check(g.D.x === start.x && g.D.y === start.y && g.D.hand === 0, "with no input the defender should stand still with their hand down");
  step(60, { ...idle(g.D.x, g.D.y), r: true });
  check(g.D.x > start.x + 3 && Math.abs(g.D.y - start.y) < 1e-9, `moving right for half a second: x went from ${start.x} to ${g.D.x.toFixed(2)}`);
  const moved = g.D.x - start.x;
  step(1, idle(g.P.x, g.P.y));                                       // cursor on the ball handler, arm's length away
  check(g.D.hand > 0.9, `pointing at the handler from range should raise the hand: ${g.D.hand.toFixed(2)}`);
  step(1, idle(g.D.x, g.D.y - 6));                                   // cursor straight away from them
  check(g.D.hand < 0.5, `pointing away should not: ${g.D.hand.toFixed(2)}`);
  step(1, { ...idle(g.D.x, g.D.y), gather: true });
  check(g.D.jumpT >= 0, "Space should jump");
  step(70, idle(g.D.x, g.D.y));
  check(g.D.jumpT < 0 && g.D.land > 0, "half a second later they should have landed");
  return `moved ${moved.toFixed(1)} ft in half a second`;
});

ltest("A hand on the ball takes it, but not through the handler's body or inside the check-ball grace", () => {
  // the handler dribbles out to their right; the defender either stays in front and reaches across, or comes round to the ball
  const reach = side => {
    const g = GM.create({ seed: 2, rules: true, duo: true });
    for (let i = 0; i < 600; i++) {
      const b = GM.dribbleBallPos(g), goal = side ? { x: g.P.x + 2.7, y: g.P.y } : { x: g.P.x, y: g.P.y - 2.4 }, dx = goal.x - g.D.x, dy = goal.y - g.D.y;
      GM.step(g, [idle(g.P.x + 6, g.P.y), { ...idle(b.x, b.y), r: dx > 0.2, l: dx < -0.2, d: dy > 0.2, u: dy < -0.2 }]);
      if (g.flow.phase === "dead") return { g, at: i/120 };
    }
    return { g, at: -1 };
  };
  const front = reach(false), beside = reach(true);
  check(front.at < 0, `reaching across from in front should not get it: taken ${front.at} s in`);
  check(beside.at >= 0 && beside.g.flow.why === "Stolen" && beside.g.stats.to === 1, `from the ball side: ${beside.g.flow.phase}, "${beside.g.flow.why}"`);
  check(beside.at > GM.RULES.GRACE, `the steal came ${beside.at.toFixed(2)} s in, inside the grace`);
  return `from the ball side, taken ${beside.at.toFixed(1)} s in; from in front, never`;
});

ltest("Two copies stay identical over a link with 40 ms of lag each way", () => {
  const p = pair(3, 5);
  p.run(120*10, script);
  check(p.games[0].tick === p.games[1].tick, `ticks ${p.games[0].tick} and ${p.games[1].tick}`);
  check(same(p.games[0], p.games[1]), "the two copies ended in different states");
  check(p.peers[0].resyncs === 0 && p.peers[1].resyncs === 0, "they should not have needed a resync");
  check(p.games[0].tick >= 120*10 - LS.DELAY - 2, `fell behind: ${p.games[0].tick} of ${120*10} ticks`);
  check(p.games[0].stats.fga >= 1 && p.games[0].D.x !== 25, "the script should have produced a shot and a moving defender");
  return `${p.games[0].tick} ticks, ${p.games[0].stats.fga} shots, score ${p.games[0].flow.score.join("-")}`;
});

ltest("With more lag than the input delay covers, both wait and still stay identical", () => {
  const p = pair(4, 20);                                             // 167 ms each way against a 67 ms delay
  p.run(120*6, script);
  check(same(p.games[0], p.games[1]), "the two copies ended in different states");
  check(p.games[0].tick < 120*6 - 10 && p.games[0].tick > 120*6 - 40, `expected to trail by the extra lag: ${p.games[0].tick} of ${120*6}`);
  return `trailing by ${120*6 - p.games[0].tick} ticks`;
});

ltest("If the copies drift, side 1 takes side 0's game and they are identical again", () => {
  const p = pair(5, 5);
  p.run(120*2, script);
  p.games[1].P.x += 0.25;                                            // knock one copy out of step
  check(!same(p.games[0], p.games[1]), "the knock should have made them differ");
  p.run(120*3, script);
  check(p.peers[0].resyncs === 1 && p.peers[1].resyncs === 1, `resyncs: ${p.peers[0].resyncs} sent, ${p.peers[1].resyncs} taken`);
  check(p.games[0].tick === p.games[1].tick && same(p.games[0], p.games[1]), "they should be identical again");
  return "one resync";
});

if (require.main === module) {
  let pass = 0;
  for (const t of lockTests) {
    try { const info = t.fn(); pass++; console.log(`PASS  ${t.name}\n      ${info || ""}`); }
    catch (e) { console.log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  console.log(`\n${pass}/${lockTests.length} passed`);
  if (pass < lockTests.length) process.exitCode = 1;
}
module.exports = { lockTests };
