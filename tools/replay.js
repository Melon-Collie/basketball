// Regression check for changes that should not alter behavior.
// Plays one scripted session (every shot type, gathers, a pump fake, crossovers) in the working tree's prototype and
// in the one from a git ref, and compares them at each checkpoint, part by part: the text of every element with an
// id, the scatter bar, the last-shot panel, and the pixels of both canvases. Text is compared on the elements both
// versions have, so adding a panel is not a difference; changing what an existing one says is.
//
//   node tools/replay.js [ref] [--verbose]      ref defaults to HEAD
//
// Exits 1 if any checkpoint differs, and says which parts. A change that is meant to alter behavior will differ too:
// this only tells you whether behavior changed, not whether it should have.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, PROTOTYPE } = require('./harness.js');

// Everything a player can see, read in the page.
function capture() {
  const text = {};
  for (const e of document.querySelectorAll('[id]')) if (!/^(court|inset)$/.test(e.id) && e.tagName !== 'INPUT') text[e.id] = e.textContent.replace(/\s+/g, ' ').trim();
  const bar = [...document.querySelector('#lBar').children].map(c => c.style.width).join(',');
  const big = document.querySelector('#last .big'), sub = document.querySelector('#last .sub');
  return { outcome: big ? `${big.textContent} / ${sub.textContent}` : '', text,
           parts: { bar, 'last shot': document.querySelector('#last').innerHTML,
                    court: document.querySelector('#court').toDataURL(), 'side view': document.querySelector('#inset').toDataURL() } };
}
// which parts of two captures differ
function differences(a, b) {
  const out = Object.keys(a.parts).filter(k => a.parts[k] !== b.parts[k]);
  const ids = Object.keys(a.text).filter(id => id in b.text && a.text[id] !== b.text[id]);
  if (ids.length) out.unshift(`text of ${ids.slice(0, 4).map(id => '#' + id).join(', ')}${ids.length > 4 ? ` and ${ids.length - 4} more` : ''}`);
  return out;
}

async function session(file) {
  const h = await open({ file }), { page, step, at, click, key } = h;
  const checkpoints = [];
  const snap = async name => {
    const s = await page.evaluate(capture);
    for (const k of Object.keys(s.parts)) s.parts[k] = crypto.createHash('sha1').update(s.parts[k]).digest('hex');   // the canvases are large
    checkpoints.push({ name, ...s });
  };
  const until = async (re, max = 240) => { for (let i = 0; i < max; i += 2) { if (re.test(await h.text('#lKind'))) return; await step(2); } };
  const retreat = async () => { await key('KeyS', 110); await step(25); };

  await step(5); await snap('start');                     // the harness opens the page in free shooting: this session exercises the shot lab
  // 1. standing jumpers aimed at the rim, on time, early and late
  for (const frames of [31, 28, 36]) { await at(0.5, 0.26); await step(3); await click(frames); await step(4); await snap(`jumper held ${frames}`); await step(200); await snap(`after jumper ${frames}`); }
  // 2. cursor on the glass from straight on, then a fadeaway
  await at(0.56, 0.1); await step(8); await snap('glass aim'); await click(31); await step(220); await snap('after bank attempt');
  await at(0.5, 0.26); await page.keyboard.down('KeyS'); await step(2); await click(34); await page.keyboard.up('KeyS'); await step(220); await snap('after fade');
  // 3. on-ball defender off so the lane is open: drive and click early for a floater
  await page.locator('#defOn').uncheck(); await at(0.5, 0.3); await step(5);
  for (const frames of [20, 24]) { await retreat(); await page.keyboard.down('KeyW'); await until(/Floater/); await snap('floater ready'); await click(frames); await page.keyboard.up('KeyW'); await step(220); await snap(`after floater ${frames}`); }
  // 4. keep driving and click late: layups released on the rise and with hang, to either side.
  //    The rim protector is told to stay home from here on, so a step-up can't stop the drive short of the rim.
  await page.locator('#stepUp').fill('0');
  for (const [frames, fx] of [[12, 0.5], [34, 0.42], [26, 0.58]]) { await retreat(); await at(fx, 0.3); await page.keyboard.down('KeyW'); await until(/Layup/); await snap('layup ready'); await click(frames); await page.keyboard.up('KeyW'); await step(220); await snap(`after layup ${frames}`); }
  // 5. Shift on the drive: dunks against the rim protector
  for (let i = 0; i < 3; i++) { await retreat(); await at(0.5, 0.3); await page.keyboard.down('Shift'); await page.keyboard.down('KeyW'); await until(/Dunk attempt/); await snap('dunk ready'); await click(30); await page.keyboard.up('KeyW'); await page.keyboard.up('Shift'); await step(220); await snap(`after dunk ${i}`); }
  // 6. rim protector off too: clean dunks, then a fumble (the foul, block and fumble rolls are forced low)
  await page.locator('#rimOn').uncheck();
  for (let i = 0; i < 3; i++) {
    await retreat(); await at(0.5, 0.3); await page.keyboard.down('Shift'); await page.keyboard.down('KeyW'); await until(/Dunk attempt/);
    if (i === 2) await page.evaluate(() => window.shotLab && window.shotLab.game.forced.push(0.01, 0.01, 0.01));   // refs from before the game had its own random stream have no such hook
    await click(30); await page.keyboard.up('KeyW'); await page.keyboard.up('Shift');
    await step(12); await snap(`dunk in flight ${i}`); await step(40); await snap(`dunk bounce ${i}`); await step(170); await snap(`after open dunk ${i}`);
  }
  await page.locator('#rimOn').check();
  // 7. gather on the move and go up off the steps, with a euro step
  await retreat(); await page.keyboard.down('KeyW'); await until(/Floater/); await page.keyboard.press('Space'); await step(13); await page.keyboard.down('KeyD'); await step(8); await snap('gather steps'); await click(24); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW'); await step(220); await snap('after gather finish');
  // 8. defender back on: dead dribble, pump fake, pivot, then a set shot
  await page.locator('#stepUp').fill('50'); await page.locator('#defOn').check(); await retreat(); await key('KeyW', 30); await step(30); await at(0.5, 0.3);
  await page.keyboard.press('Space'); await step(10); await click(5); await step(20); await snap('pump fake'); await key('KeyA', 12); await snap('pivot'); await click(31); await step(220); await snap('after set shot');
  // 9. crossovers while moving, then a pull-up
  for (let i = 0; i < 6; i++) { await at(i % 2 ? 0.62 : 0.38, 0.5); await key(i % 2 ? 'KeyA' : 'KeyD', 22); }
  await snap('after crossovers'); await at(0.5, 0.2); await page.keyboard.down('KeyW'); await step(20); await click(31); await page.keyboard.up('KeyW'); await step(220); await snap('after pull-up');
  // 10. open jumpers for a spread of outcomes
  await page.locator('#defOn').uncheck(); await retreat(); await key('KeyW', 40); await step(30); await at(0.5, 0.3);
  for (const frames of [31, 31, 32, 30, 31, 33]) { await step(3); await click(frames); await step(220); await snap(`open jumper ${frames}`); }
  await page.locator('#reset').click(); await step(5); await snap('after reset');
  await h.close();
  return { checkpoints, errors: h.errors };
}

(async () => {
  const args = process.argv.slice(2), verbose = args.includes('--verbose'), ref = args.find(a => !a.startsWith('--')) || 'HEAD';
  const root = path.join(__dirname, '..'), base = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  try {
    execFileSync('tar', ['-x', '-C', base], { input: execFileSync('git', ['archive', ref], { cwd: root, maxBuffer: 1 << 28 }) });
    const [now, then] = await Promise.all([session(PROTOTYPE), session(path.join(base, path.relative(root, PROTOTYPE)))]);
    let same = 0;
    now.checkpoints.forEach((c, i) => {
      const o = then.checkpoints[i], diff = o ? differences(c, o) : ['missing'], ok = diff.length === 0; if (ok) same++;
      if (verbose || !ok) console.log(`${ok ? 'same' : 'DIFF'}  ${c.name}${c.outcome ? `: ${c.outcome}` : ''}${!ok && o && o.outcome !== c.outcome ? ` (${ref}: ${o.outcome})` : ''}${ok ? '' : ` [${diff.join('; ')}]`}`);
    });
    for (const [who, r] of [['working tree', now], [ref, then]]) for (const e of r.errors) console.log(`page error in ${who}: ${e}`);
    const outcomes = [...new Set(now.checkpoints.map(c => c.outcome).filter(Boolean))];
    console.log(`Outcomes covered: ${outcomes.join(', ')}`);
    console.log(`${same}/${now.checkpoints.length} checkpoints identical to ${ref}`);
    if (same < now.checkpoints.length || now.errors.length || then.errors.length) process.exitCode = 1;
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
})();
