# Basketball

A proof-of-concept basketball game exploring a shot model where input sets the aim and the situation sets the scatter, so no input can guarantee a make.

## Contents

- [`prototype/shot-model-lab.html`](prototype/shot-model-lab.html): the playable prototype. There is no build step: open it in a browser. It loads the simulation from `sim/`, so keep the two folders side by side.
- [`docs/shot-model-design.md`](docs/shot-model-design.md): the design doc, covering principles, the shot resolver, dribbling, defense, frames, physics, calibration and the roadmap.
- [`sim/`](sim): the shot simulation. The prototype loads these files directly, and they also run in Node for tests and calibration.
  - `physics.js`: ball flight, rim, backboard and hand collisions, make detection and outcome labels.
  - `launch.js`: turns aim, timing, momentum and contest into a launch.
  - `noise.js`: launch-space noise and simulated make rates.
  - `calibrate.js`: solves the noise settings against the design targets and writes `calibration.js`.
  - `calibration.js`: the generated settings, applied to the noise model when the prototype loads.
  - `tests.js`, `tests-launch.js`: physics tests and the launch continuity check.

## Running the simulation

The modules need only Node, with no dependencies:

```bash
node sim/tests.js
```

```bash
node sim/tests-launch.js
```

Calibration takes about a minute and rewrites `sim/calibration.js`:

```bash
node sim/calibrate.js
```

## Controls

Mouse and keyboard:

- **WASD** moves; the **cursor** aims and controls the ball hand.
- **Hold left mouse** to start a shot, **release** to let it go. Releasing before 150 ms is a pump fake.
- **Shift** at the click attacks the rim (dunk attempt).
- **Space** gathers the ball.

See the design doc for how context picks the shot type.
