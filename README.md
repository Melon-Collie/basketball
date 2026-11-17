# Basketball

A proof-of-concept basketball game exploring a shot model where input sets the aim and the situation sets the scatter, so no input can guarantee a make.

The prototype opens as a game: two sides take turns with the ball against an AI defense, first to 21, with a shot clock, live rebounds and free throws. Add `?lab` to the address, or untick Game rules on the page, for free shooting with the rules off.

Two people can play each other from the "Play online" panel under the court: one presses Host a game and sends the other the link it gives, and the game starts when they open it. A free public service introduces the two browsers; if it is down, the panel offers a way to connect by passing codes by hand. Whoever doesn't have the ball controls the on-ball defender. Your own input always lands after 25 ms; the other player is guessed and corrected, so a slow connection doesn't make you wait. The design doc lists its limits.

## Contents

- [`prototype/shot-model-lab.html`](prototype/shot-model-lab.html): the playable prototype. There is no build step: open it in a browser. The page only handles input and drawing; the game itself is loaded from `sim/`, so keep the two folders side by side.
- [`docs/shot-model-design.md`](docs/shot-model-design.md): the design doc, covering principles, the shot resolver, dribbling, defense, frames, physics, calibration and the roadmap.
- [`sim/`](sim): the shot simulation. The prototype loads these files directly, and they also run in Node for tests and calibration.
  - `physics.js`: ball flight, rim, backboard and hand collisions, make detection and outcome labels.
  - `situation.js`: the rules that read the floor: what a click would produce, contests, clean looks, finishing scatter and defenders' hands.
  - `launch.js`: turns aim, timing, momentum and contest into a launch.
  - `game.js`: the game itself: movement, dribbling, the defenders' AI, shots and the rules, advanced in fixed ticks from plain input. Deterministic for a given seed.
  - `noise.js`: launch-space noise and simulated make rates.
  - `rollback.js`: keeps two copies of a game together over a connection, for online play. Each side plays on with a guess at the other's input and replays when the guess was wrong.
  - `calibrate.js`: solves the noise settings against the design targets and writes `calibration.js`.
  - `calibration.js`: the generated settings, applied to the noise model when the prototype loads.
  - `measure.js`: reports make and block rates with defenders' hands in the simulation.
  - `tests.js`, `tests-launch.js`, `tests-situation.js`, `tests-game.js`, `tests-rules.js`, `tests-rollback.js`: physics tests, the launch continuity check, the situation rules, the game played from scripted input, the rules of a game, and two-player play.

## Running the simulation

The modules need only Node, with no dependencies:

```bash
node sim/tests.js
```

```bash
node sim/tests-launch.js
```

```bash
node sim/tests-situation.js
```

```bash
node sim/tests-game.js
```

```bash
node sim/tests-rules.js
```

```bash
node sim/tests-rollback.js
```

Calibration takes about a minute and rewrites `sim/calibration.js`:

```bash
node sim/calibrate.js
```

The measurement with defenders' hands takes about three minutes and prints its tables:

```bash
node sim/measure.js
```

## Hosting on GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes the prototype whenever it or `sim/` changes on `main`. It needs Pages enabled for the repository with GitHub Actions as its source, under Settings > Pages.

The site holds only the prototype, the `sim/` scripts it loads and an index page that redirects to it. To build the same folder locally:

```bash
tools/build-site.sh _site
```

## Browser tools

The scripts in [`tools/`](tools) drive the prototype in headless Chromium. The first two use a seeded random generator and a clock they step by hand, so a run plays out the same way every time. They need Playwright:

```bash
npm install
```

```bash
npx playwright install chromium
```

`replay.js` is a check that a refactor didn't change behavior. It plays one scripted session of free shooting, covering every shot type, in the working tree and in a git ref (`HEAD` by default), compares the panels and both canvases at each checkpoint, and exits 1 on any difference:

```bash
node tools/replay.js
```

`ingame.js` measures make and block rates for standing jumpers with the defenders reacting as they do in play. See the top of the file for its options:

```bash
node tools/ingame.js
```

`online.js` plays an online game between two headless browsers on this machine, over a real connection with lag, jitter and lost packets added, and checks the two sides agreed throughout. Unlike the other two it runs in real time:

```bash
node tools/online.js --lag 60 --jitter 20 --loss 5 --seconds 20
```

Add `--link` to have them connect by invite link, as players do, with the introduction service played by the script.

To try a bad connection by hand, open the prototype with `?lag=80&jitter=20&loss=5` on the end of the address, host, and open the link it gives in a second window. The link carries the same settings.

## Controls

Mouse and keyboard:

- **WASD** moves; the **cursor** aims and controls the ball hand.
- **Hold left mouse** to start a shot, **release** to let it go. Releasing before 150 ms is a pump fake.
- **Shift** at the click attacks the rim (dunk attempt).
- **Space** gathers the ball.

On defense, in an online game: **WASD** moves, the **cursor** is your hand (point it at the ball handler to contest, get it onto the ball to take it), and **Space** jumps.

See the design doc for how context picks the shot type.
