# Basketball

A proof-of-concept basketball game exploring a shot model where input sets the aim and the situation sets the scatter, so no input can guarantee a make.

The prototype opens as a game: two sides take turns with the ball against an AI defense, first to 21, with a shot clock, live rebounds and free throws. Home is always white and Away always purple, on the court and on the scoreboard, whichever of them has the ball. Add `?lab` to the address, or untick Game rules on the page, for free shooting with the rules off.

Two people can play each other, one against one with no rim protector, from the "Play online" panel under the court: one presses Host a game and sends the other the link it gives, and the game starts when they open it. A free public service introduces the two browsers; if it is down, the panel offers a way to connect by passing codes by hand. Whoever doesn't have the ball controls the on-ball defender. When a game ends, both press Play again for a rematch on the same connection; the side that lost has the ball first. Your own input always lands after 25 ms; the other player is guessed and corrected, so a slow connection doesn't make you wait. The design doc lists its limits.

## Contents

- [`prototype/shot-model-lab.html`](prototype/shot-model-lab.html): the playable prototype. There is no build step: open it in a browser. The page only handles input and drawing; the game itself is loaded from `sim/`, so keep the two folders side by side.
- [`docs/shot-model-design.md`](docs/shot-model-design.md): the design doc, covering principles, the shot resolver, dribbling, defense, frames, physics, calibration and the roadmap.
- [`sim/`](sim): the shot simulation. The prototype loads these files directly, and they also run in Node for tests and calibration.
  - `physics.js`: ball flight, rim, backboard and hand collisions, make detection and outcome labels.
  - `situation.js`: the rules that read the floor: what a jump would be, contests, clean looks, finishing scatter and defenders' hands.
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

Each published build is stamped: the page asks for its scripts by the stamp, so a browser holding an old copy of one fetches the new one, and if a page and a game from different builds still meet, the page says so and offers to reload. Two players on different builds are told before a game starts.

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

`replay.js` is a check that a refactor didn't change behavior. It plays one scripted session of free shooting, covering every way of shooting, in the working tree and in a git ref (`HEAD` by default), compares the panels and both canvases at each checkpoint, and exits 1 on any difference:

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

Add `--link` to have them connect by invite link, as players do, with the introduction service played by the script, or `--broker wss://0.peerjs.com/` to go through the real one.

To try a bad connection by hand, open the prototype with `?lag=80&jitter=20&loss=5` on the end of the address, host, and open the link it gives in a second window. The link carries the same settings. `&smooth=0` turns off the sliding of corrections, to see what it is hiding; any other number is how long a correction takes to slide away, in ms.

## Controls

Mouse and keyboard:

- A possession starts in a **triple threat**: the ball in your hands, your dribble still to come. Go up and shoot, pump fake, or jab and pivot with **WASD**, which moves your free foot. **Shift** puts the ball on the floor.
- Once you are dribbling, **WASD** moves you; the **cursor** aims and controls the ball hand. You can go anywhere on the half court, the baseline and under the basket included. The backboard is solid from behind too.
- **Press the left mouse button** to jump and **let it go** to let the ball go. Every shot is the same jump: about half a second to the top, and then down again. Come down still holding the ball and it is travelling. The court holds still while you are in the air, so your cursor stays where you put it.
- The jump carries half the speed you arrived with, plus up to 5 ft/s the way you hold **WASD** as you take off. Nothing steers it after that. Hold away from the rim for a fadeaway, toward it for a runner, against your own momentum to stop.
- Away from the rim the ball has to be let go on the meter's **release line**, and the cursor aims. For most jumps the line is the top of the jump: the set shot. Jump while driving at the rim from about 7 to 14 ft and it is on the way up instead: a floater, off sooner, with more arc and less touch.
- A jump inside 4 ft, on a drive inside about 7 ft, or out of gather steps inside about 12 ft is a **finish**: no release line and no aim, and **the cursor is the ball**. Close to your body it puts the ball there, to either side, behind you or straight up; out at the rim it is up in a shooting form. A defender there is a body and an arm, and the ball has to get past the arm. Let go on the way up to beat a shot blocker, or on the way down to wait them out, and let go close: from further out than 4 ft it gets worse with every foot. Get the ball over the rim near the top of a running jump and it is a dunk.
- Bodies can't share a spot, and what happens when they meet is physics: a set player (planted, nearly still) is hard to move, and one still on the move gets knocked off their line. Leaning on someone of the same size goes nowhere. Going up into a defender who was set is a charge; into one who was not, a bump, and the shot pays for it by how hard it was.
- **Let go before your feet leave the floor**, in the first 170 ms, and the jump is called off: a pump fake. A tap is a fake, a hold is a shot. Off a dribble the fake kills it; out of a triple threat you keep it.
- To bank a shot, have the cursor on the backboard, clear of the rim, when you jump.
- **Hold Space** on the dribble to post up: your back to the defender, the ball low on your far hip (the cursor picks which), and no faster than a walk. Back into them to back them down; you'll only move someone smaller. Let go of Space to face up, or let go while moving sideways to spin past their shoulder. It works anywhere on the floor.
- **Shooting out of the post:** inside 10 ft a jump is a **hook**, a finish where the cursor is the ball: hold it high, or out wide, away from the defender's arm, and it carries further than a layup. Further out it is a **turnaround jumper**: you turn to the rim in the air, so let it go once you're square, and lean away as you go up for a turnaround fadeaway.
- **Shift in the post** is a **drop step**: two big gather steps, the first round the defender's hip (on the ball's side, or the way you steer it) and the second on to the rim, then go up for a finish. It gets you past a defender of your own size, but the rim protector is still there: hold the ball away from its arm.
- **Shift** gathers the ball again, and that is the end of your dribble. On the move it gives you two gather steps, steered with **WASD**: step the second one sideways for a euro.
- On the gather steps **the cursor holds the ball**: out to either side, tucked in, or anywhere between. It moves at hand speed, so swinging it across takes a moment, and never behind your back. Keep it away from the defender's hand: one that gets to it takes it, unless your body is in the way. The defenders read your steps a reaction time late, so a euro goes where they saw nothing coming.

On defense, in an online game: **WASD** moves, the **cursor** is your hand (point it at the ball handler to contest, get it onto the ball to take it), and **pressing the left mouse button** jumps. Your arm is one length: with the cursor close to your body the hand goes straight up, as high as you can reach; further away it reaches out toward the ball, and lower.

Nothing but a shot's scatter is left to chance. Reaching into the handler, getting a hand on a shooter's arms, running into a shooter and jumping over a rebounder's back are fouls, called from what the bodies and hands actually did, and the AI is held to the same rules.

After a miss the ball is live. **Pressing the left mouse button** jumps for it, for whoever is on offense as well, and it goes to whoever's reach it comes into first. Stand your ground under it and a player running into your back is stopped there. That holds from the moment a shooter lands, too: the AI boxes the shooter out while the shot is in the air, and goes for the ball a reaction time after it comes off the rim, reading the arc it saw.

The shot meter sits beside your player. Tick **Shot meter follows the cursor**, under Display, to have it beside your cursor instead, with its release line level with the cursor, so you can time a shot without looking away from your aim. The choice is remembered by your browser and is yours alone in an online game.

See the design doc for how the jump and the one shot work.
