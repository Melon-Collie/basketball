// Drives the prototype in headless Chromium so a scripted session plays out the same way every time:
// Math.random is seeded (the page draws its game's seed from it), and the clock only advances when a script steps
// it, one 60 Hz frame at a time. The page exposes its game as window.shotLab.game.
// Needs Playwright: npm install, then npx playwright install chromium.
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const PROTOTYPE = path.join(__dirname, '..', 'prototype', 'shot-model-lab.html');

// Runs in the page before its own scripts.
function install(seed) {
  let a = seed;
  Math.random = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0)/4294967296;
  };
  let now = 1000; const queue = [];
  performance.now = () => now;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.__step = n => { for (let i = 0; i < n; i++) { now += 1000/60; const cbs = queue.splice(0); for (const cb of cbs) cb(now); } };
}

// lab: open the page in free shooting (?lab), with the game rules off. Refs from before the rules ignore it.
async function open({ file = PROTOTYPE, seed = 12345, lab = true } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 2600 } });   // tall enough that the page never scrolls
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // local files only: no web fonts, so it runs offline and draws the same text everywhere
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.addInitScript(install, seed);
  await page.goto(pathToFileURL(file).href + (lab ? '?lab' : ''));

  const step = n => page.evaluate(n => window.__step(n), n);                           // advance the game by n frames
  const at = async (fx, fy) => {                                                       // cursor to a spot on the court, as fractions of its size
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('#court').boundingBox();
    await page.mouse.move(box.x + box.width*fx, box.y + box.height*fy);
  };
  const click = async (frames = 1) => { await page.mouse.down(); await step(frames); await page.mouse.up(); };   // the mouse button: a release in the air, a pump fake on the floor
  // Space, then a click `frames` later: one jump and one release
  const shoot = async frames => { await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space'); await step(frames - 1); await click(1); };
  const key = async (code, frames) => { await page.keyboard.down(code); await step(frames); await page.keyboard.up(code); };
  const text = selector => page.evaluate(s => document.querySelector(s).textContent, selector);
  return { page, errors, step, at, click, shoot, key, text, close: () => browser.close() };
}

module.exports = { open, PROTOTYPE };
