// Keeps two copies of a game in step over a connection.
// Each side samples its own input once per tick and sends it DELAY ticks ahead of when it will be used. Neither side
// advances a tick until it has both inputs for it, so both run the same step with the same inputs. Every so often
// they compare a fingerprint of the game; if the copies have drifted, side 0 sends its whole game and side 1 takes it.
// The delay is the same for a press and a release, so shot timing is as fair online as off.
//
// The connection is whatever `send` writes to: messages are small plain objects, and must arrive in order.
const LOCKSTEP_EXPORTS = (() => {
"use strict";
const GM = (typeof module !== "undefined") ? require("./game.js") : window.GameLib;

const DELAY = 8;                 // ticks between sampling an input and using it: 67 ms at 120 ticks a second
const CHECK_EVERY = 60;          // ticks between fingerprints
const KEEP = 1200;               // ticks of inputs kept, for replaying after a resync
const NEUTRAL = { u: false, d: false, l: false, r: false, shot: false, shift: false, gather: false, x: GM.HOOP.x, y: GM.HOOP.y };

// An input on the wire: seven bits and a cursor to the nearest thousandth of a foot. Both sides use the unpacked
// form, so what is sent is exactly what is played.
const pack = i => [(i.u ? 1 : 0) | (i.d ? 2 : 0) | (i.l ? 4 : 0) | (i.r ? 8 : 0) | (i.shot ? 16 : 0) | (i.shift ? 32 : 0) | (i.gather ? 64 : 0), Math.round(i.x*1000), Math.round(i.y*1000)];
const unpack = p => ({ u: !!(p[0] & 1), d: !!(p[0] & 2), l: !!(p[0] & 4), r: !!(p[0] & 8), shot: !!(p[0] & 16), shift: !!(p[0] & 32), gather: !!(p[0] & 64), x: p[1]/1000, y: p[2]/1000 });

// me: 0 or 1, the side this copy plays. Side 0 is the reference when the copies disagree.
function create(game, me, send) {
  return { game, me, send, clock: 0, mine: new Map(), theirs: new Map(), prints: new Map(), theirPrints: new Map(), sentAt: -1, stuck: 0, resyncs: 0 };
}
// Once per tick of this side's own clock: schedule the input the player is giving now.
function sample(p, input) {
  const t = p.clock + DELAY, packed = pack(input);
  p.mine.set(t, unpack(packed));
  p.send({ k: "i", t, p: packed });
  p.clock++;
}
// Run every tick that is due and that both inputs have arrived for. Returns how many ran.
function advance(p, most = 12) {
  let ran = 0;
  while (ran < most && p.game.tick < p.clock) {
    const t = p.game.tick, a = t < DELAY ? NEUTRAL : p.mine.get(t), b = t < DELAY ? NEUTRAL : p.theirs.get(t);
    if (!a || !b) break;
    GM.step(p.game, p.me === 0 ? [a, b] : [b, a]);
    ran++;
    if (p.game.tick % CHECK_EVERY === 0) {
      const d = GM.digest(p.game);
      p.prints.set(p.game.tick, d); p.send({ k: "h", t: p.game.tick, d });
      compare(p, p.game.tick);
      for (const m of [p.mine, p.theirs, p.prints, p.theirPrints]) for (const k of m.keys()) { if (k < p.game.tick - KEEP) m.delete(k); else break; }
    }
  }
  p.stuck = ran === 0 && p.game.tick < p.clock ? p.stuck + 1 : 0;      // calls in a row spent waiting on the other side
  return ran;
}
function compare(p, t) {
  const a = p.prints.get(t), b = p.theirPrints.get(t);
  if (a === undefined || b === undefined || a === b || p.me !== 0 || t <= p.sentAt) return;
  p.sentAt = p.game.tick; p.resyncs++;
  p.send({ k: "s", g: GM.snapshot(p.game) });
}
function receive(p, m) {
  if (m.k === "i") p.theirs.set(m.t, unpack(m.p));
  else if (m.k === "h") { p.theirPrints.set(m.t, m.d); compare(p, m.t); }
  else if (m.k === "s" && p.me !== 0) {                                // take the reference copy and carry on from its tick
    GM.load(p.game, m.g);
    for (const k of [...p.prints.keys()]) if (k >= p.game.tick) p.prints.delete(k);
    p.resyncs++;
  }
}
// Has the other side gone quiet? True when this side has been waiting for more than `calls` calls to advance.
const waiting = (p, calls = 30) => p.stuck > calls;

return { DELAY, NEUTRAL, pack, unpack, create, sample, advance, receive, waiting };
})();
if (typeof module !== "undefined") module.exports = LOCKSTEP_EXPORTS;
else window.LockstepLib = LOCKSTEP_EXPORTS;
