# Basketball

A proof-of-concept basketball game exploring a shot model where input sets the aim and the situation sets the scatter, so no input can guarantee a make.

## Contents

- [`prototype/shot-model-lab.html`](prototype/shot-model-lab.html): the playable prototype. A single self-contained HTML file with no build step; open it in a browser.
- [`docs/shot-model-design.md`](docs/shot-model-design.md): the design doc, covering principles, the shot resolver, dribbling, defense, frames, physics, calibration and the roadmap.

## Controls

Mouse and keyboard:

- **WASD** moves; the **cursor** aims and controls the ball hand.
- **Hold left mouse** to start a shot, **release** to let it go. Releasing before 150 ms is a pump fake.
- **Shift** at the click attacks the rim (dunk attempt).
- **Space** gathers the ball.

See the design doc for how context picks the shot type.
