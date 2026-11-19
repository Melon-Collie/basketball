// Plays an online game between two headless browsers on this machine, over a real WebRTC connection with a bad link
// faked on top, and checks the two stayed together. Unlike the other tools this one runs in real time.
//
//   node tools/online.js [--lag 60] [--jitter 20] [--loss 5] [--seconds 20] [--delay 25] [--smooth 100] [--link | --broker ws://localhost:9000/]
//
// lag and jitter are ms each way, loss is the percentage of input packets dropped, delay is the input delay in ms,
// and smooth is how long a correction takes to slide away, in ms (0 turns sliding off).
// The two connect by exchanging codes, which needs nothing outside this machine. With --link they connect the way
// players do, by an invite link, with the introduction service played by this script (see stand-in, below). With
// --broker they use a real one at that address: `--broker wss://0.peerjs.com/` is the public one the page uses by
// default. If HTTPS_PROXY is set, the browsers reach it through that.
// Both players move, point and press throughout. At the end it compares the fingerprints the two sides took of the
// game they have agreed on, and reports how often each went back, how long a frame took, and whether either had to
// wait or be resynced. Exits 1 if they disagreed, or a page threw an error.
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const { PROTOTYPE } = require('./harness.js');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : +process.argv[i + 1]; };
const opt = { lag: arg('lag', 60), jitter: arg('jitter', 20), loss: arg('loss', 5), seconds: arg('seconds', 20), delay: arg('delay', NaN), smooth: arg('smooth', NaN) };
const broker = process.argv.includes('--broker') ? process.argv[process.argv.indexOf('--broker') + 1] : null;
const link = broker !== null || process.argv.includes('--link');

// A stand-in for the introduction service, for --link: it answers the pages' connections to it without anything
// leaving the browser, and does what the public PeerJS service was seen to do. A new id is told OPEN and one in use
// ID-TAKEN; a message is passed to the id it names with the sender's id added; one for an id nobody holds comes back
// as EXPIRE half a second later. Like the public service, and unlike the server code PeerJS publishes, it hangs up
// on a sender whose message is not shaped like the library's.
const waiting = new Map();
const has = (o, ...keys) => !!o && keys.every(k => o[k] !== undefined && o[k] !== null);
const wellFormed = m => {
  const p = m.payload, real = p && p.sdp && typeof p.sdp.sdp === 'string' && p.sdp.sdp.startsWith('v=0\r\n') && has(p.sdp, 'type');
  if (m.type === 'OFFER') return real && has(p, 'type', 'connectionId', 'label', 'reliable', 'serialization');
  if (m.type === 'ANSWER') return real && has(p, 'type', 'connectionId');
  if (m.type === 'CANDIDATE') return has(p, 'candidate', 'type', 'connectionId');
  return false;
};
const standIn = page => page.routeWebSocket(/\/peerjs\?/, ws => {
  const id = new URL(ws.url()).searchParams.get('id');
  if (waiting.has(id)) { ws.send(JSON.stringify({ type: 'ID-TAKEN' })); ws.close(); return; }
  waiting.set(id, ws); ws.send(JSON.stringify({ type: 'OPEN' }));
  ws.onMessage(text => {
    const m = JSON.parse(text), to = waiting.get(m.dst);
    if (m.type === 'HEARTBEAT') return;
    if (!wellFormed(m)) { waiting.delete(id); ws.close(); return; }
    if (to) to.send(JSON.stringify({ type: m.type, src: id, dst: m.dst, payload: m.payload }));
    else setTimeout(() => { if (waiting.get(id) === ws) ws.send(JSON.stringify({ type: 'EXPIRE', src: m.dst, dst: id })); }, 500);
  });
  ws.onClose(() => { if (waiting.get(id) === ws) waiting.delete(id); });
});

// Runs in each page before its own scripts: times every frame, and within it the part that is keeping in step.
function install() {
  const raf = window.requestAnimationFrame.bind(window), t = { cost: [], gap: [], net: [], last: 0, moved: [], drawn: [], seen: null };
  addEventListener('load', () => {
    const lib = window.RollbackLib, frame = lib.frame;
    lib.frame = (...args) => { const a = performance.now(), r = frame(...args); t.net.push(performance.now() - a); return r; };
  });
  window.__frames = t;
  window.requestAnimationFrame = cb => raf(now => {
    if (t.last) t.gap.push(now - t.last);
    t.last = now;
    const a = performance.now(); cb(now); t.cost.push(performance.now() - a);
    // how far the other player moved since the last frame: as the game has them, and as they are drawn
    const lab = window.shotLab, n = lab && lab.net;
    if (!n || !n.live) return;
    const g = lab.game, who = g.flow.offense === n.me ? 'D' : 'P', b = g[who], e = lab.ease[who];
    const cur = { who, live: g.flow.phase === 'live', now, x: b.x, y: b.y, dx: b.x + e.x, dy: b.y + e.y }, was = t.seen;
    if (was && was.who === who && was.live && cur.live && now - was.now < 30) {
      t.moved.push(Math.hypot(cur.x - was.x, cur.y - was.y)); t.drawn.push(Math.hypot(cur.dx - was.dx, cur.dy - was.dy));
    }
    t.seen = cur;
  });
}
// address: the page to open, or nothing for the prototype with `query` on the end
async function player(query, address) {
  // real addresses in the connection codes, not .local names, which nothing here can look up
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
                                          proxy: broker && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const page = await browser.newPage({ viewport: { width: 1300, height: 2600 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.addInitScript(install);
  if (link && !broker) await standIn(page);
  await page.goto(address || pathToFileURL(PROTOTYPE).href + '?' + query);
  await page.evaluate(() => { document.querySelector('#online').open = true; document.querySelector('#netManual').open = true; });
  return { browser, page, errors };
}
const STRIDE = 0.45;   // ft: more than anyone runs between two frames, so a bigger move is a correction
const filled = (page, id) => page.waitForFunction(id => document.querySelector(id).value.length > 100, id, { timeout: 15000 });
const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length*q))] : 0; };

(async () => {
  const query = `lag=${opt.lag}&jitter=${opt.jitter}&loss=${opt.loss}` + (Number.isNaN(opt.delay) ? '' : `&delay=${opt.delay}`) + (Number.isNaN(opt.smooth) ? '' : `&smooth=${opt.smooth}`)
              + (broker ? `&broker=${encodeURIComponent(broker)}` : '');
  const host = await player(query);
  let guest = null;
  try {
    if (link) {
      // the host gets a link; the guest does nothing but open it
      await host.page.click('#netHost');
      await host.page.waitForFunction(() => document.querySelector('#netLink').value.includes('#join='), null, { timeout: 15000 });
      const invite = await host.page.inputValue('#netLink');
      console.log(`Invite link ends ${invite.slice(invite.indexOf('#'))}`);
      guest = await player(query, invite);
    } else {
      guest = await player(query);
      await host.page.click('#manHost'); await filled(host.page, '#manOut');
      await guest.page.fill('#manIn', await host.page.inputValue('#manOut'));
      await guest.page.click('#manJoin'); await filled(guest.page, '#manOut');
      await host.page.fill('#manIn', await guest.page.inputValue('#manOut'));
      await host.page.click('#manConnect');
    }
    for (const p of [host, guest]) await p.page.waitForFunction(() => window.shotLab.net && window.shotLab.net.live, null, { timeout: 15000 });
    console.log(`Connected. Playing ${opt.seconds} s with ${opt.lag}–${opt.lag + opt.jitter} ms each way and ${opt.loss}% of input packets lost.`);

    // both players stay busy: the cursor circles, they move in bursts, they jump and click half a second later, and
    // now and then they press Shift
    const start = Date.now(), keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const drive = async (p, phase) => {
      await p.page.evaluate(() => window.scrollTo(0, 0));
      const box = await p.page.locator('#court').boundingBox();
      let n = 0, down = null, pressed = false, up = false;
      while (Date.now() - start < opt.seconds*1000) {
        const s = (Date.now() - start)/1000 + phase;
        await p.page.mouse.move(box.x + box.width*(0.5 + 0.25*Math.sin(s*2.1)), box.y + box.height*(0.35 + 0.2*Math.cos(s*1.3)));
        const want = Math.floor(s/0.7) % 3 === 0 ? null : keys[Math.floor(s/0.7) % 4];
        if (want !== down) { if (down) await p.page.keyboard.up(down); if (want) await p.page.keyboard.down(want); down = want; }
        const press = s % 3.5 > 2.9;
        if (press !== pressed) { if (press) await p.page.mouse.down(); else await p.page.mouse.up(); pressed = press; }
        const jump = s % 3.5 > 2.4 && s % 3.5 < 2.6;                  // Space half a second before the click: a shot let go near the top
        if (jump !== up) { if (jump) await p.page.keyboard.down('Space'); else await p.page.keyboard.up('Space'); up = jump; }
        if (n++ % 90 === 45) await p.page.keyboard.press('ShiftLeft');
        await new Promise(r => setTimeout(r, 12));
      }
      if (down) await p.page.keyboard.up(down);
      if (pressed) await p.page.mouse.up();
      if (up) await p.page.keyboard.up('Space');
    };
    await Promise.all([drive(host, 0), drive(guest, 1.7)]);
    await new Promise(r => setTimeout(r, 1500));                       // hands off, so everything in flight arrives

    const read = p => p.page.evaluate(() => {
      const n = window.shotLab.net, r = n.peer, g = r.sure;
      return { prints: [...r.prints], rollbacks: r.rollbacks, resyncs: r.resyncs, stood: r.stood, clock: r.clock, tick: g.tick, rtt: Math.round(r.rtt), lead: r.lead,
               score: g.flow.score.join('-'), shots: g.stats.fga, status: document.querySelector('#netStatus').textContent, stats: document.querySelector('#netStats').textContent,
               frames: window.__frames };
    });
    const [a, b] = await Promise.all([read(host), read(guest)]);
    const theirs = new Map(b.prints); let common = 0, differ = 0;
    for (const [t, d] of a.prints) if (theirs.has(t)) { common++; if (theirs.get(t) !== d) differ++; }
    for (const [name, r] of [['Host ', a], ['Guest', b]]) {
      console.log(`${name}: ${r.tick} ticks agreed, went back ${r.rollbacks} times, stood still for ${r.stood} ticks, resynced ${r.resyncs}; round trip read as ${r.rtt} ms; `
        + `frames over 25 ms apart: ${r.frames.gap.filter(x => x > 25).length} of ${r.frames.gap.length}`);
      const line = (what, list) => `${what} median ${pct(list, 0.5).toFixed(2)} ms, 99th ${pct(list, 0.99).toFixed(2)} ms, worst ${Math.max(0, ...list).toFixed(1)} ms`;
      console.log(`       ${line('a whole frame', r.frames.cost)}; ${line('of which keeping in step', r.frames.net)}`);
      const far = list => `${Math.max(0, ...list).toFixed(2)} ft at most, over ${STRIDE} ft in ${list.filter(x => x > STRIDE).length} of ${list.length} frames`;
      console.log(`       the other player, frame to frame: ${far(r.frames.moved)} as the game has them; ${far(r.frames.drawn)} as drawn`);
      console.log(`       page says: ${r.status} ${r.stats}`);
    }
    console.log(`Score ${a.score}, ${a.shots} shots. Fingerprints compared: ${common}, different: ${differ}. Clocks ${a.clock} and ${b.clock}.`);
    const errors = [...host.errors, ...guest.errors];
    const bad = differ > 0 || common < 5 || errors.length > 0;   // each side keeps its last ten or so fingerprints
    if (errors.length) console.log('Page errors:\n  ' + errors.join('\n  '));
    console.log(bad ? 'FAILED' : 'The two sides agreed throughout.');
    process.exitCode = bad ? 1 : 0;
  } catch (e) {
    for (const [name, p] of [['Host', host], ['Guest', guest]]) if (p) console.log(`${name} page says: ${await p.page.textContent('#netStatus').catch(() => '?')}`);
    throw e;
  } finally { await host.browser.close(); if (guest) await guest.browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
