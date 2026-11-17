// Tests for two-player play: a player-controlled defender, and two copies of a game kept together over a link that
// delivers messages late, out of order, or not at all. No browser and no network: the link here is a queue.
const GM = require("./game.js"), RB = require("./rollback.js");

const lockTests = [];
function ltest(name, fn) { lockTests.push({ name, fn }); }
function check(cond, msg) { if (!cond) throw new Error(msg); }
const RIM = GM.HOOP, same = (a, b) => JSON.stringify({ ...a, view: null }) === JSON.stringify({ ...b, view: null });

// Two copies of one game joined by a link. Each tick of the test both sides are given one tick of time and the input
// their player is giving at that moment (from a script), as the page does once per drawn frame.
//   lag, jitter   ticks each way, and up to this many more at random
//   loss          the share of input packets that never arrive. The rest arrive in whatever order their lag gives.
//   late          side 1 starts this many ticks after side 0, as a guest does who starts when the host's word arrives
// Fingerprints and whole games take the same lag but always arrive, and in order, as on the page.
function pair(seed, { lag = 0, jitter = 0, loss = 0, late = 0, delay, watch } = {}) {
  const games = [0, 1].map(() => GM.create({ seed, rules: true, duo: true })), wire = [], rand = RB_RAND(seed);
  let clock = 0, sent = 0, bytes = 0, lastSure = [0, 0];
  const peers = games.map((g, me) => RB.create(g, me, m => {
    const text = JSON.stringify(m), loose = m.k === "i";
    if (loose) { sent++; bytes += text.length; if (rand() < loss) return; }
    let at = clock + lag + (loose ? Math.floor(rand()*(jitter + 1)) : jitter);
    if (!loose) at = lastSure[me] = Math.max(at, lastSure[me]);
    wire.push({ at, to: 1 - me, m: JSON.parse(text) });
  }, { delay, watch }));
  const deliver = () => { for (let i = 0; i < wire.length;) { if (wire[i].at <= clock) { const w = wire.splice(i, 1)[0]; RB.receive(peers[w.to], w.m); } else i++; } };
  const stats = { replayed: 0, deepest: 0, stood: [0, 0] }, given = [new Map(), new Map()];   // given: every input each side gave, by the tick it is used on
  const tick = script => {
    deliver();
    for (const p of peers) {
      if (p.me === 1 && clock < late) continue;
      const was = p.clock, n = RB.frame(p, GM.TICK, () => { const i = script(p.me, p.clock); given[p.me].set(p.clock + p.delay, RB.unpack(RB.pack(i))); return i; });
      if (p.clock === was) stats.stood[p.me]++;
      stats.replayed += n; stats.deepest = Math.max(stats.deepest, n);
    }
    clock++;
  };
  // let everything in flight arrive, with nobody sampling, so both sides know every input and can be compared
  const settle = () => { for (let i = 0; i < 400; i++) { clock++; deliver(); for (const p of peers) { RB.flush(p); RB.advance(p); } } };
  return { games, peers, tick, settle, stats, given, run: (n, script) => { for (let i = 0; i < n; i++) tick(script); }, wire: () => ({ sent, bytes }) };
}
function RB_RAND(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
// The game these two sides should both have: a fresh one stepped with every input each of them actually gave.
function truth(p, seed) {
  const g = GM.create({ seed, rules: true, duo: true }), a = p.peers[0];
  for (let t = 0; t < a.sure.tick; t++) GM.step(g, t < a.delay ? [RB.NEUTRAL, RB.NEUTRAL] : [p.given[0].get(t), p.given[1].get(t)]);
  return g;
}
const idle = (x, y) => ({ ...RB.NEUTRAL, x, y });
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

// A 15 ft jumper with a perfect release against a player-controlled defender `gap` ft away, who jumps `before` ms
// ahead of the release (null: stays down) with their cursor `out` ft from their own body, toward the shooter.
function contested(gap, before, out, seed = 1) {
  const g = GM.create({ seed, rules: true, duo: true });
  Object.assign(g.P, { x: 25, y: RIM.y + 15 }); Object.assign(g.D, { x: 25, y: RIM.y + 15 - gap });
  const press = 60, hold = 62, jump = before === null ? -1 : press + hold - Math.round(before/1000/GM.TICK);
  for (let t = 0; t < 600 && !(g.last && g.ball && g.ball.announced); t++)
    GM.step(g, [{ ...idle(RIM.x, RIM.y), shot: t >= press && t < press + hold }, { ...idle(g.D.x, g.D.y + out), gather: t === jump }]);
  return g;
}
ltest("A defender close enough who goes up in time blocks a jumper; from further out, late, or flat-footed, the ball clears them", () => {
  const big = g => g.last.out.big, touched = g => !!g.last.out.touched;
  const block = contested(2.4, 250, 0.9);
  check(big(block) === "Blocked" && touched(block) && block.ball.toucher === "D", `2.4 ft away, hand up, up 250 ms early: ${big(block)} / ${block.last.out.sub}`);
  check(block.flow.loose && block.flow.lastTouch === "d" && block.stats.fga === 1 && block.stats.fgm === 0, "a block is a miss, live, last touched by the defense");
  for (const [why, g] of [["standing", contested(2.4, null, 0.9)], ["from 4 ft", contested(4, 250, 2.5)], ["leaving the floor 30 ms before the release", contested(2.4, 30, 0.9)],
                          ["already coming down, up 480 ms early", contested(2.4, 480, 0.9)]])
    check(!touched(g), `${why} they should not get a hand on it: ${big(g)} / ${g.last.out.sub}`);
  return `2.4 ft away, up 250 ms early: ${big(block)}; standing, 4 ft away, 30 ms early or 480 ms early: untouched`;
});

ltest("An arm is one length: reaching out gets a hand to shots that straight up cannot, and straight up is better close in", () => {
  const got = (gap, out) => { let n = 0; for (let ms = 100; ms <= 350; ms += 25) if (contested(gap, ms, out).last.out.big === "Blocked") n++; return n; };
  const farOut = got(3.2, 3.2), farUp = got(3.2, 0.9), nearOut = got(2.0, 2.0), nearUp = got(2.0, 0.9);
  check(farOut >= 3 && farUp === 0, `from 3.2 ft: reaching out blocked ${farOut} of 11 timings, straight up ${farUp}`);
  check(nearUp > nearOut, `from 2 ft: straight up blocked ${nearUp} of 11 timings, reaching out ${nearOut}`);
  return `of 11 jump timings, 3.2 ft away: ${farOut} reaching out, ${farUp} straight up. 2 ft away: ${nearOut} reaching out, ${nearUp} straight up`;
});

ltest("The defender who gets a hand to a shot has to wait a moment before they can also catch it", () => {
  const g = contested(2.4, 250, 0.9);
  check(g.last.out.big === "Blocked", `expected a block: ${g.last.out.big}`);
  // keep the shooter out of it, and the defender under the ball
  const b = g.ball; let at = null;
  for (let t = 0; t < 600 && g.flow.loose; t++) {
    const bp = GM.pathPoint(g.ball); at = g.ball.t;
    Object.assign(g.P, { x: bp.x, y: bp.y + 6, vx: 0, vy: 0 }); Object.assign(g.D, { x: bp.x, y: bp.y - 0.5, vx: 0, vy: 0 });
    GM.step(g, [idle(RIM.x, RIM.y), idle(g.D.x, g.D.y + 0.9)]);
  }
  check(!g.flow.loose && g.flow.why === "Block recovered", `the defender should end up with it: ${g.flow.phase}, "${g.flow.why}"`);
  check(at >= b.touchT + GM.RULES.TOUCH_LOCK - 0.01, `touched at ${b.touchT.toFixed(2)} s and holding it at ${at.toFixed(2)} s`);
  return `touched ${b.touchT.toFixed(2)} s into the flight, held no sooner than ${at.toFixed(2)} s`;
});

ltest("Reaching in is a foul: a hand that goes into the handler's body is whistled, one that was already there is not", () => {
  // the defender is right up on a handler who keeps the ball away on the far side
  const setup = () => {
    const g = GM.create({ seed: 6, rules: true, duo: true });
    Object.assign(g.P, { x: 25, y: 31 }); Object.assign(g.D, { x: 25, y: 31 - 1.8 }); g.flow.grace = 0;
    return g;
  };
  const away = g => idle(g.P.x + 3, g.P.y + 5), near = g => idle(g.D.x, g.D.y + 0.7), through = g => idle(g.P.x, g.P.y + 2);
  const reach = setup();
  for (let i = 0; i < 30; i++) GM.step(reach, [away(reach), near(reach)]);          // hand up beside their own body: nothing
  check(reach.flow.phase === "live", `standing close with the hand in should be fine: ${reach.flow.phase}, "${reach.flow.why}"`);
  GM.step(reach, [away(reach), through(reach)]);                                     // then a stab through the handler at the ball
  check(reach.flow.phase === "dead" && reach.flow.why === "Reach-in foul" && reach.flow.next === "keep", `expected a reach-in foul: ${reach.flow.phase}, "${reach.flow.why}"`);
  for (let i = 0; i < Math.round((GM.RULES.DEAD_T + 0.05)/GM.TICK); i++) GM.step(reach, [away(reach), near(reach)]);
  check(reach.flow.phase === "live" && reach.flow.offense === 0 && reach.flow.clock > GM.RULES.SHOT_CLOCK - 0.1 && reach.stats.to === 0, "the offense should keep the ball, from the top, with a fresh clock");
  // the same hand, put there before the handler arrives, and left still while they walk into it
  const still = setup(); Object.assign(still.P, { y: 31 + 3 });
  const out = g => idle(g.D.x, g.D.y + 4);
  for (let i = 0; i < 60; i++) GM.step(still, [away(still), out(still)]);
  for (let i = 0; i < 90 && still.flow.phase === "live"; i++) GM.step(still, [{ ...away(still), u: true }, out(still)]);
  const gap = Math.hypot(still.D.hx - still.P.x, still.D.hy - still.P.y);
  check(still.flow.phase === "live" && gap < GM.C.BODY_R, `walking into a hand that was already out is no foul: ${still.flow.phase}, "${still.flow.why}", hand ${gap.toFixed(2)} ft from them`);
  return `stab through the body: ${reach.flow.why || "Reach-in foul"}, offense keeps it; hand held still and walked into: play on`;
});

ltest("A hand on the shooter's arms is a foul and free throws; straight up beside the ball is a clean contest", () => {
  const out = g => g.last.out;
  const over = contested(1.8, 250, 3.0), up = contested(1.8, 250, 0.9), stood = contested(1.8, null, 3.0);
  check(out(over).foul === "On the arm" && out(over).big === "Foul" && !out(over).make, `reaching over a shooter 1.8 ft away: ${JSON.stringify(out(over))}`);
  check(!out(up).foul, `straight up from the same spot: ${JSON.stringify(out(up))}`);
  check(out(stood).foul === "On the arm", `the arm doesn't have to be in the air: ${JSON.stringify(out(stood))}`);
  const g = over;
  for (let i = 0; i < 600 && g.flow.phase !== "dead"; i++) GM.step(g, [idle(RIM.x, RIM.y), idle(g.D.x, g.D.y)]);
  check(g.flow.why === "Foul" && g.flow.next === "ft" && g.flow.ft === 2 && !g.flow.loose, `a fouled two that misses is two free throws: "${g.flow.why}", ${g.flow.ft} to shoot`);
  return `reaching over: ${out(over).sub}; straight up: ${out(up).big} / ${out(up).sub}`;
});

ltest("A defender who is still running when they get to a shooter has fouled them; one who stops short has not", () => {
  const run = stopAt => {
    const g = GM.create({ seed: 8, rules: true, duo: true });
    Object.assign(g.P, { x: 25, y: RIM.y + 15 }); Object.assign(g.D, { x: 25, y: RIM.y + 15 - 6 });
    const press = 60, hold = 62;
    for (let t = 0; t < 400 && !g.last; t++) {
      const gap = g.P.y - g.D.y, go = t >= press && gap > stopAt;                      // sets off as the shot goes up
      GM.step(g, [{ ...idle(RIM.x, RIM.y), shot: t >= press && t < press + hold }, { ...idle(g.D.x, g.D.y + 0.7), d: go }]);
    }
    return g;
  };
  const through = run(0), short = run(3.2);
  check(through.last.out.foul === "Ran into the shooter", `ran straight into them: ${JSON.stringify(through.last.out)}`);
  check(!short.last.out.foul, `pulled up 3 ft away: ${JSON.stringify(short.last.out)}`);
  return `never stopped: ${through.last.out.sub}; pulled up short: ${short.last.out.big} / ${short.last.out.sub}`;
});

ltest("With no lag beyond the input delay nothing is guessed, and the two copies match a game played on one machine", () => {
  const p = pair(3, { lag: 2 });
  p.run(120*5, script); p.settle();
  check(p.peers[0].rollbacks === 0 && p.peers[1].rollbacks === 0, `went back ${p.peers[0].rollbacks} and ${p.peers[1].rollbacks} times`);
  check(same(p.games[0], p.games[1]) && same(p.games[0], truth(p, 3)), "the copies should match each other and the game played straight through");
  check(p.games[0].tick === 120*5, `fell behind: ${p.games[0].tick} of ${120*5} ticks`);
  return `${p.games[0].tick} ticks, no guesses needed`;
});

ltest("Your own input lands after the same 25 ms however slow the link is", () => {
  const when = lag => {
    const p = pair(6, { lag }), x0 = p.games[0].P.x;
    for (let t = 0; t < 120; t++) { p.tick((me, c) => ({ ...idle(RIM.x, RIM.y), r: me === 0 && c >= 40 })); if (p.games[0].P.x !== x0) return t - 40; }
    return -1;
  };
  const near = when(2), far = when(24);
  check(near === RB.DELAY && far === RB.DELAY, `moved ${near} ticks after the key on a fast link and ${far} on a 200 ms one; both should be ${RB.DELAY}`);
  return `${RB.DELAY} ticks after the key at 17 ms and at 200 ms each way`;
});

ltest("Over 100 ms each way neither side waits, wrong guesses are replayed, and both end with the true game", () => {
  const p = pair(3, { lag: 12 });
  p.run(120*10, script); p.settle();
  check(p.stats.stood[0] === 0 && p.stats.stood[1] === 0, `stood still for ${p.stats.stood} ticks`);
  check(p.peers[0].rollbacks > 20 && p.peers[1].rollbacks > 20, `the script changes input often, so both should have gone back: ${p.peers[0].rollbacks}, ${p.peers[1].rollbacks}`);
  check(p.stats.deepest <= 12 - RB.DELAY + 2, `a replay should be about the lag less the input delay: ${p.stats.deepest} ticks`);
  check(p.games[0].tick === 120*10 && p.games[1].tick === 120*10, `ticks ${p.games[0].tick} and ${p.games[1].tick}`);
  check(same(p.games[0], p.games[1]), "the two copies ended in different states");
  check(same(p.games[0], truth(p, 3)), "going back and replaying should give the game that was actually played");
  check(same(p.games[0], p.peers[0].sure) && p.peers[0].resyncs === 0 && p.peers[1].resyncs === 0, "no resync should have been needed");
  check(p.games[0].stats.fga >= 1 && p.games[0].D.x !== 25, "the script should have produced a shot and a moving defender");
  return `${p.games[0].tick} ticks, went back ${p.peers[0].rollbacks} and ${p.peers[1].rollbacks} times, at most ${p.stats.deepest} ticks; ${p.games[0].stats.fga} shots, score ${p.games[0].flow.score.join("-")}`;
});

ltest("Lost, late and out-of-order packets cost nothing but deeper replays", () => {
  const p = pair(7, { lag: 6, jitter: 6, loss: 0.15 });                // 50 to 100 ms each way, one packet in seven lost
  p.run(120*10, script); p.settle();
  check(p.stats.stood[0] + p.stats.stood[1] === 0, `stood still for ${p.stats.stood} ticks`);
  check(same(p.games[0], p.games[1]) && same(p.games[0], truth(p, 7)), "the copies should match each other and the true game");
  check(p.peers[0].resyncs === 0 && p.peers[1].resyncs === 0, "they should not have needed a resync");
  const w = p.wire();
  check(w.bytes/w.sent < 600, `packets averaged ${Math.round(w.bytes/w.sent)} characters`);
  return `deepest replay ${p.stats.deepest} ticks; packets averaged ${Math.round(w.bytes/w.sent)} characters`;
});

ltest("When the link is slower than the limit on guessing, both wait and still end identical", () => {
  const p = pair(4, { lag: 50 });                                      // 417 ms each way against 250 ms of guessing
  p.run(120*6, script); p.settle();
  check(same(p.games[0], p.games[1]) && same(p.games[0], truth(p, 4)), "the copies should match each other and the true game");
  check(p.stats.stood[0] > 60 && p.stats.stood[1] > 60, `expected both to stand still at times: ${p.stats.stood}`);
  check(p.stats.deepest <= RB.MAX_AHEAD + 1, `no replay should be longer than the limit: ${p.stats.deepest}`);
  return `${p.games[0].tick} of ${120*6} ticks played; stood still ${p.stats.stood.join(" and ")} ticks`;
});

ltest("A side whose clock is ahead slows until the two agree, so both guess about as much", () => {
  const p = pair(8, { lag: 6, late: 18 });                             // the guest starts 150 ms after the host
  p.run(120*2, script);
  const early = p.peers[0].clock - p.peers[1].clock;
  p.run(120*10, script);
  const gap = p.peers[0].clock - p.peers[1].clock;
  check(early < 18 && Math.abs(gap) <= 2, `the clocks were 18 ticks apart, ${early} after two seconds, and ${gap} at the end`);
  check(p.peers[1].slow === 0 && p.peers[1].clock === 120*12 - 18, "the side that was behind should never have slowed");
  p.settle();
  check(same(p.games[0], p.games[1]) && same(p.games[0], truth(p, 8)), "the copies should match each other and the true game");
  return `18 ticks apart at the start, ${early} after two seconds, ${gap} at the end`;
});

ltest("A correction reports how far it moved each player, so drawing can slide them instead of snapping", () => {
  const p = pair(9, { lag: 14, watch: g => [g.D.x, g.D.y] }), g = p.games[0], side0 = p.peers[0];
  // the defender, played by the far side, runs right, then cuts back left
  const cut = (me, c) => ({ ...idle(RIM.x, RIM.y), r: me === 1 && c >= 150 && c < 260, l: me === 1 && c >= 260 && c < 330 });
  let x = g.D.x, shown = g.D.x, off = 0, raw = 0, slid = 0;
  for (let t = 0; t < 420; t++) {
    p.tick(cut);
    if (side0.jump) { off += side0.jump[0]; side0.jump = null; }      // drawn this far from where the game now has them
    raw = Math.max(raw, Math.abs(g.D.x - x)); slid = Math.max(slid, Math.abs(g.D.x + off - shown));
    x = g.D.x; shown = g.D.x + off;
  }
  const stride = 14*GM.TICK;                                          // the furthest a defender runs in one tick
  check(side0.rollbacks >= 3, `the cuts should have been guessed wrong: went back ${side0.rollbacks} times`);
  check(raw > 2*stride, `uncorrected, the defender should snap: at most ${raw.toFixed(2)} ft in a tick`);
  check(slid <= stride*1.05, `with the reported jumps taken off, no tick should move them more than a stride (${stride.toFixed(3)} ft): ${slid.toFixed(3)}`);
  p.settle();
  check(same(p.games[0], p.games[1]) && same(p.games[0], truth(p, 9)), "watching should not change the game");
  return `biggest move in one tick: ${raw.toFixed(2)} ft as corrected, ${slid.toFixed(2)} ft with the jumps taken off`;
});

ltest("If the copies drift, side 1 takes side 0's game and they are identical again", () => {
  const p = pair(5, { lag: 8 });
  p.run(120*2, script);
  p.peers[1].sure.P.x += 0.25; p.peers[1].dirty = true;              // knock one copy out of step
  p.run(120*3, script); p.settle();
  check(p.peers[0].resyncs === 1 && p.peers[1].resyncs === 1, `resyncs: ${p.peers[0].resyncs} sent, ${p.peers[1].resyncs} taken`);
  check(p.games[0].tick === p.games[1].tick && same(p.games[0], p.games[1]), "they should be identical again");
  check(same(p.games[1], p.peers[1].sure), "the game on screen should have been brought back to the corrected one");
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
