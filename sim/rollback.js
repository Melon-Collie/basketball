// Keeps two copies of a game together over a connection, without either player waiting on the other.
//
// Each side samples its own input once per tick and uses it DELAY ticks later. It does not wait for the other side's
// input for that tick: it guesses that the other player is still doing what they were last seen doing, and plays on.
// When the real input arrives and the guess was wrong, it goes back to the last tick both inputs were known for and
// replays from there with the right one. So a player's own actions always land after the same short delay, whatever
// the connection is like, and what the connection costs is that the other player is occasionally corrected.
//
// To do that each side holds two games: `sure`, which has only ever been stepped with real inputs from both sides,
// and `game`, the one on screen, which runs ahead of it on guesses. Going back is copying sure over game.
//
// The connection is whatever `send` writes to. Inputs ("i") may be lost, repeated or arrive out of order: every
// packet carries all the inputs the other side has not yet said it has. Fingerprints ("h") and whole games ("s") must
// arrive, and in order. Every so often the two sides compare a fingerprint of their sure games; if they have
// drifted, side 0 sends its whole game and side 1 takes it.
const ROLLBACK_EXPORTS = (() => {
"use strict";
const GM = (typeof module !== "undefined") ? require("./game.js") : window.GameLib;

const DELAY = 3;                 // ticks between sampling an input and using it: 25 ms at 120 ticks a second
const MAX_AHEAD = 30;            // most ticks to play on guesses before stopping to wait: 250 ms
const CHECK_EVERY = 60;          // ticks between fingerprints
const KEEP = 600;                // ticks of inputs kept behind the sure game, for replaying after a resync
const MOST = 120;                // most inputs in one packet
const SYNC_OVER = 40;            // packets averaged before judging whether this side's clock is ahead
const SETTLE = 30;               // packets ignored after slowing down, while the other side's view of us catches up
const NEUTRAL = { u: false, d: false, l: false, r: false, shot: false, gather: false, post: false, x: GM.HOOP.x, y: GM.HOOP.y };

// An input on the wire: seven bits and a cursor to the nearest thousandth of a foot. Both sides use the unpacked
// form, so what is sent is exactly what is played.
const pack = i => [(i.u ? 1 : 0) | (i.d ? 2 : 0) | (i.l ? 4 : 0) | (i.r ? 8 : 0) | (i.shot ? 16 : 0) | (i.post ? 32 : 0) | (i.gather ? 64 : 0), Math.round(i.x*1000), Math.round(i.y*1000)];
const unpack = p => ({ u: !!(p[0] & 1), d: !!(p[0] & 2), l: !!(p[0] & 4), r: !!(p[0] & 8), shot: !!(p[0] & 16), post: !!(p[0] & 32), gather: !!(p[0] & 64), x: p[1]/1000, y: p[2]/1000 });
const alike = (a, b) => a.x === b.x && a.y === b.y && a.u === b.u && a.d === b.d && a.l === b.l && a.r === b.r && a.shot === b.shot && a.post === b.post && a.gather === b.gather;

// game: the game on screen. me: 0 or 1, the side this copy plays. Side 0 is the reference when the copies disagree.
// opts.delay: ticks of input delay, if not DELAY. Both sides must be given the same.
// opts.id: which game on this connection this is. Every message carries it, and one from another game is ignored:
//   after a rematch, packets of the game before may still be on their way.
// opts.watch: a function giving a list of numbers read off a game, such as where each player is. Whenever the game
//   on screen is corrected, `jump` is how far each of them moved because of it (what it was less what it is now, at
//   the same tick), added up until whoever is drawing takes it and sets it back to null. Drawing each thing that
//   far from where it now is, and letting that shrink away, turns a snap into a slide.
function create(game, me, send, opts = {}) {
  const delay = opts.delay ?? DELAY, sure = GM.create();
  GM.load(sure, GM.snapshot(game));
  return {
    game, sure, me, send, delay, id: opts.id || 0, watch: opts.watch || null, jump: null,
    clock: 0,                    // ticks sampled so far; the game on screen is run up to this tick
    owed: 0, rate: 1, slow: 0,   // time not yet turned into ticks, and ticks still to give up because this clock is ahead
    mine: new Map(), theirs: new Map(), guess: new Map(),   // inputs by the tick they are used on; guess is what was assumed for theirs
    got: delay - 1,              // the last tick their input is in for, with none missing before it
    acked: delay - 1,            // the last tick of mine they have said they have
    last: NEUTRAL,               // their newest input, which is the guess for every tick after it
    top: -1, leads: [], lead: 0, settle: 0, rtt: 0,   // for keeping the two clocks together
    dirty: false, stuck: 0, stood: 0,   // stuck: ticks stood still in a row; stood: in all
    epoch: 0, prints: new Map(), theirPrints: new Map(),
    rollbacks: 0, depth: 0, resyncs: 0,     // counts, and how many ticks the last rollback replayed
  };
}

// How many ticks the game on screen is running on guesses.
const ahead = p => Math.max(0, p.clock - 1 - p.got);
// This side's clock, less the other side's clock as last heard: the difference between the clocks plus the trip here.
const advantage = p => p.clock - (p.got + 1 - p.delay);

// Schedule the input the player is giving now.
function sample(p, input) {
  p.mine.set(p.clock + p.delay, unpack(pack(input)));
  p.clock++;
}
// Send every input the other side has not said it has, with what has arrived from them.
function flush(p) {
  const from = p.acked + 1, to = Math.min(p.clock + p.delay - 1, from + MOST - 1), flat = [];
  for (let t = from; t <= to; t++) { const i = p.mine.get(t); if (!i) break; flat.push(...pack(i)); }
  p.send({ k: "i", g: p.id, f: from, p: flat, a: p.got, v: p.top < 0 ? null : advantage(p) });   // no view of their clock until they are heard from
}
// Run the sure game through every tick both inputs are in for, go back if a guess was wrong, then run the game on
// screen up to now. Returns how many ticks were replayed because of a wrong guess.
function advance(p) {
  const S = p.sure, G = p.game;
  while (S.tick < p.clock && (S.tick < p.delay || S.tick <= p.got)) {
    const t = S.tick, a = t < p.delay ? NEUTRAL : p.mine.get(t), b = t < p.delay ? NEUTRAL : p.theirs.get(t);
    GM.step(S, p.me === 0 ? [a, b] : [b, a]);
    if (S.tick % CHECK_EVERY === 0) {
      const d = GM.digest(S);
      p.prints.set(S.tick, d); p.send({ k: "h", g: p.id, t: S.tick, d, e: p.epoch });
      compare(p, S.tick);
      for (const m of [p.mine, p.theirs, p.prints, p.theirPrints]) for (const k of m.keys()) { if (k < S.tick - KEEP) m.delete(k); else break; }
    }
  }
  let replayed = 0, was = null, at = -1;
  // note how far the watched numbers have moved once the replay is back at the tick the game was showing
  const moved = () => { const now = p.watch(G); p.jump = was.map((v, i) => v - now[i] + (p.jump ? p.jump[i] : 0)); was = null; };
  if (p.dirty) {
    replayed = Math.max(0, Math.min(G.tick, p.clock) - S.tick);
    if (p.watch) { was = p.watch(G); at = G.tick; }
    GM.load(G, GM.snapshot(S));
    p.guess.clear(); p.dirty = false; p.rollbacks++; p.depth = replayed;
    if (was && G.tick >= at) moved();
  }
  while (G.tick < p.clock) {
    const t = G.tick, a = t < p.delay ? NEUTRAL : p.mine.get(t);
    let b = NEUTRAL;
    if (t >= p.delay) { if (t <= p.got) b = p.theirs.get(t); else { b = p.last; p.guess.set(t, b); } }
    GM.step(G, p.me === 0 ? [a, b] : [b, a]);
    if (was && G.tick === at) moved();
  }
  return replayed;
}
// Once per drawn frame, with the seconds since the last one and a function giving the player's input now. Turns the
// time into whole ticks, samples and sends an input for each, and runs the game. Returns what advance does.
function frame(p, dt, input) {
  // a clock that is ahead of the other side's gives up a tenth of its time until it no longer is
  const give = Math.min(p.slow*GM.TICK, dt*0.1);
  p.slow -= give/GM.TICK; if (p.slow < 1e-6) p.slow = 0;
  p.rate = dt > 0 ? 1 - give/dt : 1;
  for (p.owed = Math.min(p.owed + dt - give, 0.25); p.owed >= GM.TICK - 1e-9; p.owed -= GM.TICK) {
    if (ahead(p) >= MAX_AHEAD) { p.stuck++; p.stood++; continue; }               // too far ahead of what is known: time stands still
    p.stuck = 0;
    sample(p, input());
  }
  flush(p);
  return advance(p);
}
function compare(p, t) {
  const a = p.prints.get(t), b = p.theirPrints.get(t);
  if (p.me !== 0 || a === undefined || b === undefined || a === b) return;
  p.epoch++; p.resyncs++; p.theirPrints.clear();
  p.send({ k: "s", g: p.id, e: p.epoch, game: GM.snapshot(p.sure) });
}
function receive(p, m) {
  if ((m.g || 0) !== p.id) return;                                     // from another game on this connection
  if (m.k === "i") {
    const n = m.p.length/3;
    for (let i = 0; i < n; i++) {
      const t = m.f + i;
      if (t !== p.got + 1) continue;                                   // one we already have
      const inp = unpack([m.p[i*3], m.p[i*3 + 1], m.p[i*3 + 2]]), g = p.guess.get(t);
      p.theirs.set(t, inp); p.got = t; p.last = inp;
      if (g) { if (!alike(g, inp)) p.dirty = true; p.guess.delete(t); }
    }
    if (m.a > p.acked) p.acked = m.a;
    // Their newest packet says how far ahead of us they think they are. Half the difference between that and how
    // far ahead of them we think we are is how far apart the clocks are; the sum is the round trip.
    const newest = m.f + n - 1 >= p.top;
    if (newest) p.top = m.f + n - 1;
    if (newest && m.v !== null) {
      const v = advantage(p);
      p.rtt += ((v + m.v)*GM.TICK*1000 - p.rtt)*(p.rtt ? 0.05 : 1);
      if (p.slow > 0) { p.settle = SETTLE; p.leads = []; }             // what is measured while slowing, or just after, is out of date
      else if (p.settle > 0) p.settle--;
      else if (p.leads.push((v - m.v)/2) >= SYNC_OVER) {
        p.lead = p.leads.reduce((s, x) => s + x, 0)/p.leads.length; p.leads = [];
        if (p.lead > 1) p.slow = p.lead;
      }
    }
  } else if (m.k === "h") {
    if (m.e !== p.epoch) return;                                       // from before the last resync
    p.theirPrints.set(m.t, m.d); compare(p, m.t);
  } else if (m.k === "s" && p.me !== 0 && m.e > p.epoch) {             // take the reference copy and carry on from its tick
    p.epoch = m.e; p.resyncs++;
    GM.load(p.sure, m.game);
    p.prints.clear(); p.theirPrints.clear();
    p.dirty = true;
  }
}
// Has the other side gone quiet? True once this side has stood still for more than `ticks` ticks.
const waiting = (p, ticks = 30) => p.stuck > ticks;
// For a readout: the round trip in ms, how many ticks are being guessed, and the counts.
const info = p => ({ ping: Math.round(p.rtt), ahead: ahead(p), depth: p.depth, rollbacks: p.rollbacks, resyncs: p.resyncs, stood: p.stood, lead: p.lead, rate: p.rate });

return { DELAY, MAX_AHEAD, NEUTRAL, pack, unpack, create, sample, flush, advance, frame, receive, waiting, info };
})();
if (typeof module !== "undefined") module.exports = ROLLBACK_EXPORTS;
else window.RollbackLib = ROLLBACK_EXPORTS;
