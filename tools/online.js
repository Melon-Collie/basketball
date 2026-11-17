// Plays an online game between two headless browsers on this machine, over a real WebRTC connection with a bad link
// faked on top, and checks the two stayed together. Unlike the other tools this one runs in real time.
//
//   node tools/online.js [--lag 60] [--jitter 20] [--loss 5] [--seconds 20] [--delay 25]
//
// lag and jitter are ms each way, loss is the percentage of input packets dropped, delay is the input delay in ms.
// Both players move, point and press throughout. At the end it compares the fingerprints the two sides took of the
// game they have agreed on, and reports how often each went back, how long a frame took, and whether either had to
// wait or be resynced. Exits 1 if they disagreed, or a page threw an error.
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const { PROTOTYPE } = require('./harness.js');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : +process.argv[i + 1]; };
const opt = { lag: arg('lag', 60), jitter: arg('jitter', 20), loss: arg('loss', 5), seconds: arg('seconds', 20), delay: arg('delay', NaN) };

// Runs in each page before its own scripts: times every frame, and within it the part that is keeping in step.
function install() {
  const raf = window.requestAnimationFrame.bind(window), t = { cost: [], gap: [], net: [], last: 0 };
  addEventListener('load', () => {
    const lib = window.RollbackLib, frame = lib.frame;
    lib.frame = (...args) => { const a = performance.now(), r = frame(...args); t.net.push(performance.now() - a); return r; };
  });
  window.__frames = t;
  window.requestAnimationFrame = cb => raf(now => {
    if (t.last) t.gap.push(now - t.last);
    t.last = now;
    const a = performance.now(); cb(now); t.cost.push(performance.now() - a);
  });
}
async function player(query) {
  // real addresses in the connection codes, not .local names, which nothing here can look up
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 2600 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.addInitScript(install);
  await page.goto(pathToFileURL(PROTOTYPE).href + '?' + query);
  await page.evaluate(() => { document.querySelector('#online').open = true; });
  return { browser, page, errors };
}
const filled = (page, id) => page.waitForFunction(id => document.querySelector(id).value.length > 100, id, { timeout: 15000 });
const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length*q))] : 0; };

(async () => {
  const query = `lag=${opt.lag}&jitter=${opt.jitter}&loss=${opt.loss}` + (Number.isNaN(opt.delay) ? '' : `&delay=${opt.delay}`);
  const [host, guest] = await Promise.all([player(query), player(query)]);
  try {
    await host.page.click('#netHost'); await filled(host.page, '#netOut');
    await guest.page.fill('#netIn', await host.page.inputValue('#netOut'));
    await guest.page.click('#netJoin'); await filled(guest.page, '#netOut');
    await host.page.fill('#netIn', await guest.page.inputValue('#netOut'));
    await host.page.click('#netConnect');
    for (const p of [host, guest]) await p.page.waitForFunction(() => window.shotLab.net && window.shotLab.net.live, null, { timeout: 15000 });
    console.log(`Connected. Playing ${opt.seconds} s with ${opt.lag}–${opt.lag + opt.jitter} ms each way and ${opt.loss}% of input packets lost.`);

    // both players stay busy: the cursor circles, they move in bursts, and they press and release shot and Space
    const start = Date.now(), keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const drive = async (p, phase) => {
      await p.page.evaluate(() => window.scrollTo(0, 0));
      const box = await p.page.locator('#court').boundingBox();
      let n = 0, down = null, pressed = false;
      while (Date.now() - start < opt.seconds*1000) {
        const s = (Date.now() - start)/1000 + phase;
        await p.page.mouse.move(box.x + box.width*(0.5 + 0.25*Math.sin(s*2.1)), box.y + box.height*(0.35 + 0.2*Math.cos(s*1.3)));
        const want = Math.floor(s/0.7) % 3 === 0 ? null : keys[Math.floor(s/0.7) % 4];
        if (want !== down) { if (down) await p.page.keyboard.up(down); if (want) await p.page.keyboard.down(want); down = want; }
        const press = s % 3.5 > 2.9;
        if (press !== pressed) { if (press) await p.page.mouse.down(); else await p.page.mouse.up(); pressed = press; }
        if (n++ % 90 === 45) await p.page.keyboard.press('Space');
        await new Promise(r => setTimeout(r, 12));
      }
      if (down) await p.page.keyboard.up(down);
      if (pressed) await p.page.mouse.up();
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
      console.log(`       page says: ${r.status} ${r.stats}`);
    }
    console.log(`Score ${a.score}, ${a.shots} shots. Fingerprints compared: ${common}, different: ${differ}. Clocks ${a.clock} and ${b.clock}.`);
    const errors = [...host.errors, ...guest.errors];
    const bad = differ > 0 || common < 5 || errors.length > 0;   // each side keeps its last ten or so fingerprints
    if (errors.length) console.log('Page errors:\n  ' + errors.join('\n  '));
    console.log(bad ? 'FAILED' : 'The two sides agreed throughout.');
    process.exitCode = bad ? 1 : 0;
  } finally { await host.browser.close(); await guest.browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
