// Make and block rates for standing jumpers in the real prototype, with the defenders reacting as they do in play.
// sim/measure.js takes one defender position at release; this lets the on-ball defender read the shot, close out
// and jump on their own. Every shot is released 517 ms in, inside the perfect window, aimed straight at the rim.
//
//   node tools/ingame.js [--shots 150] [--seed 12345] [--back 0] [--guard 4.5]
//
// --back: frames spent backing straight up first, to shoot from farther out. --guard: the guarding distance slider.
const { open } = require('./harness.js');

const opts = { shots: 150, seed: 12345, back: 0, guard: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i].replace(/^--/, '');
  if (!(name in opts) || process.argv[i + 1] === undefined) { console.error(`Unknown or incomplete option: ${process.argv[i]}`); process.exit(2); }
  opts[name] = +process.argv[i + 1];
}

(async () => {
  const h = await open({ seed: opts.seed }), { page, step, at, click, key } = h;
  if (opts.guard !== null) await page.locator('#sag').fill(String(opts.guard));
  await at(0.5, 0.15); await step(10);
  if (opts.back) { await key('KeyS', opts.back); await step(60); }
  const counts = {}, contests = []; let made = 0, blocked = 0;
  for (let i = 0; i < opts.shots; i++) {
    await step(40);                                        // let the defender settle back into their stance
    await click(31); await step(4);
    const r = await page.evaluate(() => ({ big: document.querySelector('#last .big').textContent, sub: document.querySelector('#last .sub').textContent,
      contest: +(document.querySelector('#last').textContent.match(/Contest\s*\w+ \((\d+)%\)/) || [])[1] }));
    const k = r.big === 'Make' ? 'Make' : r.big === 'Blocked' ? 'Blocked' : `Miss: ${r.sub}`;
    counts[k] = (counts[k] || 0) + 1; contests.push(r.contest);
    if (r.big === 'Make') made++; if (r.big === 'Blocked') blocked++;
    await step(170);
  }
  contests.sort((x, y) => x - y);
  const pct = x => `${(x/opts.shots*100).toFixed(1)}%`;
  console.log(`${await h.text('#lDist')}${opts.guard !== null ? `, guarding distance ${opts.guard} ft` : ''}: ${opts.shots} standing jumpers, seed ${opts.seed}`);
  console.log(`  made ${pct(made)}, blocked ${pct(blocked)}, contest at release median ${contests[opts.shots >> 1]}% (${contests[0]}% to ${contests[opts.shots - 1]}%)`);
  console.log(`  ${Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const e of h.errors) console.log(`page error: ${e}`);
  await h.close();
  if (h.errors.length) process.exitCode = 1;
})();
