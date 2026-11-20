# Shot model design: 2K-style basketball

Updated Nov 17, 2026 · @Jackson Schroeder

## Problem and principles

The player's input sets where a shot is aimed; ratings and the situation set how much random scatter surrounds that aim. No input can guarantee a make.

2K's timing model ties input quality directly to the outcome: a green release is a make. That creates two problems:

- **No ceiling.** Skilled users shoot 60%+ from three, which collapses shot selection, since 1.8 points per three makes everything else obsolete.
- **Contests only make the button press harder.** A good enough release beats any contest, so wild contested shots still go in.

Tightening the timing window doesn't fix it. It punishes casual players, especially on easy catch-and-shoot threes, and still lets experts reach the same broken ceiling.

Design principles:

1. **Input sets the aim (bias); a universal noise floor and the situation set the scatter (variance).** The make-rate ceiling comes from the situation, never from execution.
2. **Contests change the dice, not the button press.** A contest adds scatter and bias. It never tightens a timing window.
3. **Timing must be learnable.** A jump has one release line. Which one follows from a choice the player made (going up off a drive from floater range, or not), it moves only with what they chose to carry into the air, by the same rule every time, and the meter shows where it is. Early is always short of it and late is always long.
4. **A shooter makes up for their own motion.** Nobody has to aim against where they are going. Speed along the shot line moves the release line, and the meter shows where it has moved to; speed across it does nothing to the ball. What moving costs is touch.
5. **Decisions over dexterity.** Skill expression lives mainly in creating good shots: separation, finish choice, reading the defender.
6. **Expected value keeps the game basketball-shaped.** Points per shot by shot type is the primary tuning metric. If percentages are inflated for fun, inflate them proportionally.
7. **Feedback separates input from outcome.** Release quality is shown immediately (as in MLB The Show's perfect/perfect), so a miss after a perfect release reads as variance, not robbery.
8. **Frames, not ratings.** Height, wingspan and weight shape the mechanics; nobody has a hidden accuracy number. Bodies change outcomes only through physics and geometry.
9. **No move buttons.** Moves emerge from continuous body control (WASD) and ball control (cursor) meeting a defender who reacts with a delay. Gestures and right-stick style sequences are out; the gather button changes state, it doesn't trigger a move.
10. **Protect the feel of a clean look.** A perfect release on a truly open shot gets a capped premium, and its misses rim out rather than brick.
11. **Nothing is rolled except a shot's scatter.** Principle 1 puts chance in exactly one place: where a released ball goes. Everything else is what happened: a steal is a hand that got to the ball, a foul is a hand or a body where it had no right to be, a block is an arm in the ball's way, and a rebound is whoever's reach the ball came into. The AI follows rules, not coin flips, so what beats it can be learned.

## Core resolver

This is the original resolver: a 2D landing point at the rim, sampled from a Gaussian, tested against an elliptical make window. Jumpers, floaters and layups are now simulated instead (see Full physics). The bias and scatter below are still computed the same way: the bias becomes the launch, the scatter becomes launch noise, and the rim and backboard decide the make.

```latex
\text{landing} = \text{bias} + \mathcal{N}(0, \sigma), \qquad \text{make} \iff \left(\frac{\text{lat}}{A}\right)^2 + \left(\frac{\text{dep}}{B}\right)^2 \le 1
```

- **Axes.** Lateral is left/right from the shooter's view. Depth is short/long along the shot line. Units are inches at the rim.
- **Bias** is the player's input error plus deterministic pushes: aim error, timing error, carried momentum, contest push.
- **Scatter** components add in quadrature, so the largest one dominates. Depth scatter is the lateral value times a per-shot ratio.

```latex
\sigma_{lat} = \sqrt{\sigma_{rating}^2 + \sigma_{distance}^2 + \sigma_{movement}^2 + \sigma_{contest}^2}, \qquad \sigma_{dep} = k \cdot \sigma_{lat}
```

- **Make window** (A, B) differed by shot type: softer shots got bigger windows, and a layup from a 25–65° bank angle got 1.2× its window. Physics retired it: the rim is the window.
- **Displayed make chance** comes from simulated shots: 14 per refresh, blended into a running average, and 80 for the last-shot panel, drawn at release and run when the panel is shown. The actual shot uses a fresh random draw.
- **Blocks and fouls.** Neither is rolled. A block is a collision between the ball and a defender's arm during the flight, dunks included. A foul is contact, worked out from where the defenders and their hands are (see Fouls, under The game).

A key property: when scatter is small (open, good shooter), input error matters a lot. When a contest dominates the scatter, input barely matters. So skill counts most on good shots, and nobody can time through a hand in the face.

## Input scheme

Two buttons and the movement keys.

- **WASD** moves. **Cursor** aims from range, and in the air at the rim it is the ball.
- **Left mouse, pressed**, jumps. With the ball that is the start of every shot; without it, it goes up for a loose ball. It is the defender's jump too, so the shot and the contest are the same button.
- **Left mouse, let go**, lets the ball go, the moment it comes up, if you are in the air. Let go while the legs are still loading, before the feet leave, and the jump is called off: a pump fake. So a shot is a hold and a fake is a tap.
- **Shift** gathers the ball, or puts a ball that has not been dribbled yet on the floor.
- **WASD as you take off** is a lean: it decides what you carry into the air (see The jump). Inputs are read relative to the floor, not the shot line.

**How a shot is resolved is not picked from a list.** There used to be a table here: a click was a jumper, a floater, a layup or a dunk according to distance and speed at the moment it was pressed, and each was resolved by its own rules. Now there is one shot, and what it is follows from where the ball was let go (see One shot).

**What a jump is taken for** is where that table survives. A jump is read as it starts. "Driving" means velocity toward the rim of at least 4 ft/s:

| Order | Condition at the jump | Read as | Release line |
| --- | --- | --- | --- |
| 1 | Within 4 ft of the rim, any motion | A finish | None |
| 2 | Driving, within 7 ft (12 ft out of gather steps) | A finish | None |
| 3 | Driving, 7–14 ft | A floater | The quick line, on the way up |
| 4 | Anything else | A shot from range | The top of the jump |

The read does two things. The AI goes by it: a shot blocker goes up for a finish on a timer and stays down for a floater. And it settles what is asked of the release, as the feet leave, with nothing about it moving after that. Going up early on a drive is a floater; keeping the drive going and going up late is a finish; slowing down first is a set shot.

**A finish asks nothing of the release.** No line and no aim, wherever the ball is let go: the cursor is the ball the whole way (see At the rim). It used to be a finish only by distance, so a jump that started 9 ft out and flew to the rim had a line that slid and faded on the way in, and paid for where the cursor was until it got there. Gather steps count out to 12 ft because a euro uses up most of the drive: one gathered at 14 ft goes up from about 9.6 ft.

Two lines on every jump, with the nearer one counting, was tried and taken out before anyone played it. A set shot let go 90 ms early came out as a late quick shot and went long, so early no longer meant short, and the meter carried a line that was seldom wanted.

**Also:**

- **The camera follows the ball handler,** so cursor positions are stable relative to the body (see Dribbling). It holds still while you are in the air with the ball.
- **The aim line and crosshair** only show while you are in the air with the ball, and fade out near the rim, where aim does not count.
- **A cursor parked on your own body** (within 0.5 ft) reads as a badly missed aim from range. At the rim it is the ball held straight up.

## Jump shots

This section is the shot from range, where a finish has no part (beyond 8 ft; see One shot). Timing sets depth and the cursor sets lateral aim. Distance, movement and contest set the scatter.

**Timing (depth).** The ball has to be let go on the jump's release line: the top of the jump, 520 ms after the press, or, off a drive from floater range, the quick line, 330 ms after it (see The quick line). The line is moved by whatever you are carrying along the shot line (see The jump). There is no automatic release: come down with the ball and it is travelling. Timing error, after the assist deadzone, changes launch speed by 0.0158% per ms. That is 0.09 in of depth per ms at 24 ft and less closer in (0.056 at 15 ft). Early misses short, late misses long.

- Perfect window: ±12 ms. Timing assist (default ±15 ms) is a deadzone added on top, where error costs nothing.
- **Perfect release bonus** (default 30%): release quality q is 1 inside the perfect window and fades to 0 over the next 40 ms. It shrinks the shooter's own scatter by bonus × q. It never touches contest scatter.

**Aim (lateral).** Aim error is the signed angle between the shooter→cursor and shooter→rim lines, measured on the floor plane. Lateral bias = distance × tan(angle), so long shots need finer aim. Aim assist (default 40%) scales it down.

**Momentum.** What the body is doing in the air does not push the ball. Speed along the shot line moves the release line (see The jump). Speed across it used to push the ball sideways, 1.6 in per ft/s at 24 ft, and had to be aimed against; that is gone, because steering against your own motion was a chore with nothing to read it from. A moving shot pays in scatter.

**Scatter (lateral, inches).**

| Component | Formula |
| --- | --- |
| Universal floor | 3.93 × (1 − bonus × q). The old rating term at 80, now the same for everyone |
| Distance | None. The physics already makes long shots harder |
| Movement | 0.14 × speed at the jump (ft/s), combined with 0.4 × speed in the air (ft/s): 2.0 in at a fadeaway's 5 ft/s |
| Contest | 6.17 × contest |

Depth scatter = 1.16 × lateral. The total is multiplied by 1.23 (calibration) and converted into launch noise: depth scatter becomes a spread on launch speed, lateral scatter a spread on direction. A contest also raises the arc by up to 6° at full strength, as the shooter goes over the hand.

**Zone.** Two versus three is judged from the takeoff spot, so fading across the line doesn't create a three.

**Clean looks.** Total scatter is multiplied by (1 − 0.04 × cleanness × release quality), and the noise on a clean perfect release is capped at 1.6 spreads so misses rim out. See Shot noise and clean looks.

## The jump

Every shot is the same jump, and a fadeaway, a runner, a leaner and a hard stop are what its one rule produces.

**The timeline.** Pressing the mouse button starts it, and letting it go lets the ball go. For 170 ms the legs load with the feet still down; letting go then calls the jump off, and that is a pump fake. Then 350 ms up and 350 ms down. The top is 520 ms after the press, and the feet are back on the floor at 870 ms.

**What you carry into the air.** Decided while the legs load, and nothing changes it after that:

```latex
\vec{v}_{air} = 0.5 \times \vec{v}_{arrived} + 5\ \text{ft/s} \times \widehat{\text{WASD}}
```

| At the jump | Carried into the air |
| --- | --- |
| Standing, no keys | Nothing: straight up and down |
| Standing, away from the rim | 5 ft/s back: a fadeaway, about 2.2 ft of separation by the top |
| Sprinting at 13.5 ft/s, no keys | 6.75 ft/s the way you were going |
| Sprinting, toward the rim | 11.75 ft/s: a runner, or the last stride of a layup |
| Sprinting, against your momentum | 1.75 ft/s: a hard stop |

**How high.** A jump from a standstill reaches 85% of one taken at 7 ft/s or more. Standing reach is 8.3 ft, and a full jump adds 2.3 ft.

**The release line.** Moving along the shot line would carry the ball long or short, and the release makes up for it: later going away from the rim, earlier going at it. The line is placed where that is while the legs load, and stays there once the feet leave, however far the jump then carries. So the line is always the release that puts the depth right, and it never moves in the air.

```latex
\text{shift} = -\frac{\text{DRIFT\_DEP} \times \text{line shift setting} \times v_{along}}{0.09\ \text{in/ms}}
```

That is +56 ms for a standing fadeaway and −75 ms at 6.75 ft/s toward the rim. The quick line moves half as far. A finish has no line.

**What it costs.** Speed in the air, in any direction, adds scatter to a jumper: 0.4 in per ft/s, so 2.0 in for a fadeaway from a standstill (the "Scatter in the air" slider). A clean look needs less than 3 ft/s both at the jump and in the air. That is all it costs: the ball is not pushed off line.

**What a fade is.** Only a name: a jumper taken going away from the rim at 2 ft/s or more is a fadeaway, or a side fade if it is going sideways as well. Nothing is committed and nothing is canned.

**The trade-off emerges from timing.** A fade's later release gives a closeout more time. It wins against a defender who is already close and loses against a late closeout.

**Travelling.** Coming down with the ball is a turnover. On a free throw it is a miss.

## Jumper contests

A contest (0–1) is computed at the moment of release, for a shot from range. It adds scatter and raises the arc; the timing window never changes. It is weighted by how much of the shot is from range, so it fades out between 8 and 4 ft and is nothing at the rim, where a defender is a body and an arm (see At the rim).

```latex
c = \text{prox} \times \text{inline} \times \text{hand} \times (0.85 + 0.35 \cdot \text{closing}) \times \text{length}
```

| Factor | Formula | Meaning |
| --- | --- | --- |
| prox | clamp((5 − d) / 3.5, 0, 1)^1.5 | Zero beyond 5 ft, full at 1.5 ft. Steep: 4 ft barely matters, 2 ft is a hand in the face |
| inline | 0.25 + 0.75 × max(0, cos) | Defender between shooter and rim counts fully; from behind, a quarter |
| hand | 0.35 + 0.65 × max(hand up, jump height) | A hand up at release is worth almost 3× a hand down |
| closing | clamp(closing speed / 12 ft/s, 0, 1) | Running at the shooter is more disruptive than standing |
| length | slider, 0.7–1.3 (rim protector fixed at 1.2) | Height and wingspan |

- **Effects:** +6.17 × c in of lateral scatter and up to 6° of extra arc (shooting over the hand). The arc replaced the old 2.5 in push long.
- **Several defenders** combine as c = 1 − Π(1 − cᵢ).
- **Blocks** are collisions, not rolls: every defender within 7 ft has a hand in the simulation, and a touch on the ball is a block (see Full physics).

The curve was originally linear out to 6.5 ft and penalized 4 ft "open" looks at 50–60%. It was made steep to match NBA tracking, where open (4–6 ft) and wide-open threes differ by only a few points. The contest is still devastating within 2–3 ft.

## One shot

There is one shot, and two things decide what it is.

**How far out.** A jump that starts as a finish is all finish, wherever the ball is let go. Any other shot is part finish and part shot from range by distance from the rim: all finish inside 4 ft, none beyond 8 ft, and a straight-line mix in between, which is what a set shot from 6 ft is.

| | At the rim | From range |
| --- | --- | --- |
| The cursor | Is the ball (see At the rim) | Aims |
| When to let go | Whenever: only a hang costs | On a line |
| The defender | A body and an arm | A contest as well |
| Touch (scatter floor) | 2.48 in | 3.93 in set, 4.6 in quick |
| What it pays for | Speed over 11.4 ft/s, where the ball is held, hang | Speed at the jump and in the air |
| Arc | Whatever brings the ball down into the rim at 60° | 48° set, 60° quick |
| Aimed | 2 in past the rim's center | At the rim's center (2 in past, quick) |

**Which line.** From range, a jump with the top line is a set shot. One with the quick line (off a drive from 7 to 14 ft) is pushed: off 190 ms sooner, with more arc and less touch.

**In the mix,** each part is weighted: aim error, timing error and the contest are all multiplied by the from-range share, and the scatter is the weighted sum of the variances. So at 6 ft, aim and timing count half.

**Names come afterwards.** A dunk, a layup, a scoop, a hanging layup, a reverse, a bank, a floater, a jump shot, a pull-up, a runner and a fadeaway are what the last-shot panel calls what you did. Stats count a ball let go inside 6 ft as at the rim and one on the quick line beyond that as a floater.

## At the rim

Near the rim the hand finds the rim, so the cursor is free, and it is the ball. Nothing protects the ball but where it is.

**The hand.** In the air the ball is in the hand, and the cursor is the hand.

| Cursor | The ball |
| --- | --- |
| Within 2.2 ft of your body | Is where the cursor is, on a straight arm 2.6 ft long from the shoulder. So it is highest straight up (8.3 ft plus the jump) and lower the further out it is held: 0.5 ft lower at 1.5 ft out, 1.2 ft lower at 2.2 ft |
| 3.2 ft or more away | Is up in a shooting form: 0.7 ft toward the cursor, 7.65 ft up plus the jump, which is 9.6 ft at the top of a standing jump |
| In between | Moves smoothly from one to the other |

So with the cursor on the rim from a few feet out you shoot a normal layup, and bringing the cursor in toward your body takes the ball wherever you put it: out to either side, behind you, or straight up.

**Out from under the rim.** A ball let go right under the rim has nowhere to go but up into it, so the hand keeps a low ball out: at least 2.0 ft from the rim's center at 9 ft up or lower, easing to 1.35 ft at 10 ft. Once the ball is high enough to go over the rim, it can.

**Dunks.** A ball let go at least 10.15 ft up and within 0.9 ft of the rim's center is a dunk. That takes the body within about 1.3 ft of the rim (nobody's center gets closer than 1.0 ft), a running jump, and being within about 100 ms of the top of it. A dunk has no scatter. The ball is carried from the hand to just above the rim and put through, and it goes down unless a defender's arm is in the way of that carry.

**When to let go.** Any time the feet are off the floor. On the way up the ball is lower: quicker than a shot blocker, and easier for a hand to reach. Past the top is a hang, at +0.9 in of scatter per 100 ms, for up to 350 ms before the feet come down.

**Scatter (lateral, inches),** for the finish share of a shot. Depth scatter = 1.2 × lateral, and the total is multiplied by 1.74 (calibration).

| Component | Formula |
| --- | --- |
| Floor | 2.48 |
| Speed | 0.35 × max(0, speed at the jump − 11.4 ft/s) |
| Where the ball is held | 0.8 × abs(s) + 2.2 × max(0, −s × sideways momentum), where s is how far to your left or right of the line to the rim the ball is, −1 to 1 at arm's length, and sideways momentum is clamp(sideways speed / 6). Plus 0.6 per ft of euro step |
| Hang | 0.9 per 100 ms |
| Let go far out | 0.8 per ft beyond 4 ft, for a jump that started as a finish: it is a heave. Open, at a sprint: 79% from 4 ft, 65% from 5, 52% from 6, 43% from 7, 26% from 10. Without it a finish from 10 ft, which asks for no timing and no aim, went in as often as a floater |
| A bump | 2.0, for a body met on the way up |

**The defender is a body and an arm.**

- **The arm** is the one in Full physics: a block is a collision between it and the ball's flight, which starts at the hand. Hold the ball where the arm is and it is blocked; hold it away and it gets off, at a cost in touch. The AI's hand goes to a ball in the air as far as its arm reaches, at 14 ft/s, and stays 0.95 ft off the shooter's body.
- **Shot blockers' jumps.** The AI's defenders within 7 ft go up at reaction × 0.5 + 130 ms into a jump they read as a finish (255 ms at the default), and a jump lasts 500 ms, so they are at their highest just before the top of yours. Letting go on the way up beats them to it; hanging until they are coming down beats them the other way.
- **The body.** A shooter in the air goes where their momentum takes them. Into a defender who was set (moving slower than 1.5 ft/s, feet down) and at least 4 ft from the rim, at more than 2 ft/s, it is a charge: the other side's ball. Into anyone else it is a bump, which adds 2 in of scatter. A defender who runs into a shooter, or whose hand comes onto them, has fouled, as before (see Fouls, under The game); a hand the shooter flew into has not.
- A fouled finish gets 1.15× its placement, hang and speed scatter. One that goes in is an and-one; one that misses is two free throws.

**Euros.** Open, going up out of the second step and leaning at the rim: gathered at 10 ft, the jump starts 5.7 ft out and the ball is let go 3 ft out at the top, 78%. Gathered at 12 ft, 68%. Gathered at 14 ft the jump starts 9.6 ft out and only gets to 6.7 ft, 47%.

**What the AI gives up.** (Measured before the rim protector read the handler late; see Rim protector's read.) On blunt straight-line drives with no moves, against the rim protector waiting at home: the ball in front and let go on the way up was blocked about 60% of the time and scored 3%; at the top, a dunk attempt, 39% and 61%; held out away from the arm at the top, 11% and 29%; held straight up and hung until the blocker was coming down, 0% and 59%. Before this, the same drives were blocked two times in three or more whatever was done.

## The quick line

The quick line is the early release: let go on the way up, 330 ms after the press, 160 ms after the feet leave and 190 ms before the top. A jump has it when it starts on a drive from 7 to 14 ft, and that shot is a floater.

- **Timing:** perfect window ±20 ms plus the timing assist, against ±12 on the top line. The perfect release bonus applies.
- **Touch:** a floor of 4.6 in × (1 − bonus × q) against 3.93, movement 0.08 × ft/s against 0.14 and with no cost for speed in the air: it is built for moving. Depth = 1.45 × lateral, since soft high arcs miss short or long. The total is multiplied by 1.50 (calibration).
- **Arc:** 60° against 48°, aimed 2 in past the rim's center.
- **Lean:** you keep moving. Leaning into it carries you toward a defender who is giving ground, and into their hand; leaning against your momentum stops you short of them, which is the pull-up floater. Against the on-ball defender on a straight drive from 12 ft, that is the difference between about 18% and about 52%.
- **Contest:** without the closing-speed factor, and with prox = clamp((4 − d) / 2.5, 0, 1)^1.5, so the arc clears anyone more than \~4 ft away. Contest scatter 5.0 × c, plus up to 6° of extra arc.

**Rim protector's read.** On each drive, the first time the ball handler is inside 17 ft and driving, the rim protector decides once:

- **Stay home** (concedes the floater): stays near the rim, blending from its home spot 3.25 ft in front of the rim toward the drive line.
- **Step up** (concedes the lane): moves to a spot on the drive line at clamp(distance − 4.5, 6, 10) ft from the rim. Once the driver gets past that spot, it recovers at only 8 ft/s, which opens the layup.

Whether it steps up is a rule on a slider (default 50: when the handler is level with their defender). The decision resets after every shot. The rim protector's current choice is shown in the panel, but in the real game reading its position should be the skill.

Like the on-ball defender, it goes by where it saw the handler a reaction time ago (260 ms by default), carried on the way they were going then. A straight drive it sees coming; a euro, or any change of direction, is a reaction time old before it moves for it. Its arm still goes for the ball where the ball is.

## Dribbling

There are no dribble moves to trigger. The cursor is the ball hand, WASD is the body, and crossovers and hesis are names for what happens when those change. Gestures and right-stick style move inputs are explicitly out.

**Camera.** The camera follows the ball handler: centered horizontally, leading 7.5 ft toward the baseline, about 36 ft of court tall, with 60 ms of smoothing. Under the game rules it shows 42 ft and leads by 9 ft, so the rim stays on screen from the top of the key. The cursor is re-projected every frame, so a still mouse stays at the same spot relative to your body. Everything below depends on that. When the rim is off the top of the screen, an edge marker points to it.

**Ball.**

- Each bounce lands toward the cursor, relative to the body, but never straight ahead into the defender: at least 30 degrees to the ball side.
- Cursor distance sets how far out the ball goes: 0.7 ft with the cursor within 2 ft of the body, up to 2.4 ft with it 10 ft or more away. Farther out is faster but more exposed.
- The ball switches hands when the cursor's lateral offset passes 0.6 ft on the other side. That deadzone keeps jitter from crossing you over.
- Rhythm: a bounce takes 430 ms standing and 320 ms at full speed, plus up to 190 ms when slow with the ball pulled in tight (a hang dribble). Bounce height is 3 ft, up to 4.2 ft when hanging.
- How tight the ball is held follows the cursor continuously (0.1 s smoothing); only the next landing spot waits for the bounce. This removed a lag of up to 0.4 s on hesis.

**Body.** Dribbling tops out at 13.5 ft/s. Acceleration is 85 ft/s² from a stop, tapering by 60% near top speed; stopping and cutting are 95 ft/s². That asymmetry is what makes a hesi feel like a released spring. You can't run through a defender: on contact while dribbling, 65% of the overlap pushes you back and your velocity into them is removed, so you slide around them instead.

**Hands.** Both hands are modeled, each reaching from its own shoulder (0.75 ft either side of center).

- **The ball hand** carries the dribble. Every bounce must land within 2.6 ft of the ball-side shoulder; this reach will come from wingspan under frames.
- **Crossovers are hand-to-hand.** During the transit, the receiving hand reaches for the landing spot and the other follows through, and neither protects the ball.
- **The off hand guards automatically.** With the defender within 6 ft, the free arm comes up between their reaching hand and the ball. A reach that has to go through it does not get the ball, and a hand that goes into the arm is a reach-in foul. There's no input for this; it follows from where the ball and the defender are.
- **Held ball:** during gather steps and pivots, both hands are on the ball.

**How moves emerge.**

| Move | What produces it |
| --- | --- |
| Crossover | Cursor moves to the other side of the body; the ball follows on the next bounce |
| Hang dribble | Slow, with the cursor pulled in tight: the ball rides higher and slower |
| Hesi | Decelerating in range with the ball pulled in. A defender who respects the shot steps up; accelerating then catches them moving forward |
| Change of pace | Any sharp speed change; the defender's reaction delay does the rest |

**Turnovers.** The ball is lost when a defender's hand gets to it: within 0.55 ft, with the handler's off arm not in the way (see The defender's hand, below). There is no steal chance. What exposes the ball is where it is: dribbled out toward a defender, crossed in front of a close one, or held out where they can reach it. What protects it is the handler's body and off arm, distance, and not leaving it in one place.

Status: much improved but not final. Between the legs and behind the back (from the path the cursor takes behind the body) and spins are not built yet.

## The on-ball defender

In the real game, the defender is a person: WASD moves them, and the mouse controls contests, steals and deflections in passing lanes. The prototype's AI stands in for that person, and its reaction delay plays the role of human reaction time. Moves are designed to beat a delay, and nothing the defender does is a roll.

**Perception.** The defender acts on the ball handler as they were one reaction time ago, projected forward by 0.8 of that time using the velocity they saw. A sudden change leaves them heading the wrong way until the delay catches up, and separation comes from that delay plus their acceleration limits. No move ever rolls dice to decide whether it worked.

The age of that picture is one setting, 260 ms, the same against every handler. It used to be worked out from a quickness rating and a ball-handling rating.

**What they do with it.**

- **Cushion:** the guarding distance (default 4.5 ft), plus 0.12 ft per ft/s the handler is driving at them, shrinking toward 1.9 ft as the pull-up threat rises. Never more than 0.6 × the handler's distance to the rim.
- **Pull-up threat** = respect × range × slowness × (0.35 + 0.65 × how tight the ball is held). Respect came from the shooter rating and is fixed at 0.75 (its value at 80) now that the slider is gone; range is full within 27 ft and fades out by 32 ft. A poor shooter barely moves them.
- **Shading:** 0.8 ft toward the ball side they saw, so a crossover leaves them shaded the wrong way for one reaction time.
- **Dead dribble:** with no drive threat left, they crowd to 2 ft with a hand up.
- **Shots:** they react to the shooting motion they saw, real or fake, after the shot reaction time (default 250 ms): closing out, raising a hand, and, if close, sometimes leaving their feet (see Pump fakes).
- **Movement:** 13 ft/s top speed and 50 ft/s² acceleration. Acceleration rises with the top-speed setting, 10 ft/s² per ft/s.

Quickness, handling and shooting are placeholders in this model. Under frames (below), they come from the bodies involved.

## Gather and pivoting

The gather button (Shift) is a state change, not a move: it turns a dribbled ball into a held one, which changes what WASD and the cursor mean. Inside each state, control stays continuous.

**Gathering on the move** (6 ft/s or faster) gives two gather steps of 0.2 s each.

- The ball-side foot steps first. Each foot's landing spot follows WASD until it plants, and a ghost circle shows where it will land, so you can steer it mid-step.
- Step length is speed × 0.2 s, between 1.2 and 3.0 ft. With nothing held, the first step continues your momentum.
- **The ball on the steps is where the cursor holds it.** The gather picks the dribble up from wherever it was, and from there the ball goes after the cursor, at most 1.8 ft out, 3.6 ft up. It moves in a straight line at 14 ft/s, a defender's hand speed, so a swing from one side to the other takes 0.26 s and comes across the chest. It never goes behind the back: when the straight way would, it goes by the front. Cursor on the body is the ball tucked in. The ball carries on into the jump from where it was, and in the air goes on after the cursor at the same speed, out to where the shooting form begins.
- **On the steps a hand can take it.** A defender's hand that gets to the ball takes it, as on the dribble, unless the handler's body is in the way: a ball held on the far side from the defender, or behind the hip, is safe; one run into their hand is gone. The AI goes for it as it does for a dribble, once it has seen it left open.
- **Euro:** sideways movement off the first step's line during the second step, tracked continuously. It costs 0.6 in of finishing scatter per foot. What it buys is not a rule: the defenders read the handler a reaction time late (see Rim protector's read), so the second step goes where they saw nothing coming, and the ball can be carried on the side away from them.
- **Jump stop:** nothing held on the second step plants both feet (0.8 ft) and kills the dribble.
- **Going up:** press any time, off either step. Out of gather steps, layups count up to 9 ft (7 ft normally), floaters to 14 ft, jumpers beyond. If you haven't gone up within 0.3 s of planting the second step, you stop with a dead dribble.

**Gathering while stopped** gives a dead dribble with feet planted.

- The cursor holds the ball 0.9 ft from the body, and the body turns to face it, so sweeping the ball around rotates you around the pivot foot. Front and reverse pivots come from the direction of the sweep.
- **Pivot foot:** the first foot you move is the free foot, the one on the ball's side, and the other becomes the pivot and locks.
- **Free foot:** WASD extends it up to 2.6 ft in that direction; letting go returns it to stance, 1.4 ft beside the pivot.
- **Travels are impossible by construction:** the pivot never lifts and there is never a third gather step.
- **Shots:** a set shot by default. With the free foot reaching toward the rim (more than 1.2 ft) within 8 ft, it's a step-through finish. Holding the away-from-rim key as you shoot gives a step-back fade.
- **Strips:** a defender's hand that gets to the ball takes it, unless the handler's body is between them and it.

| Move | What produces it |
| --- | --- |
| Euro step / jump stop | Footfall directions during gather steps |
| Front or reverse pivot | Sweeping the ball around the body one way or the other |
| Step-through | Free foot reaching past the defender toward the rim, then going up |
| Rip through | Sweeping the ball low across the body |
| Jab step | Free foot extended toward the defender and brought back. It matters from the triple threat, where the drive is still there |

**The triple threat.** A possession starts with the ball held and the dribble still to come, and so does every catch, which for now means an offensive rebound. It is the same held-ball state as a dead dribble, with everything that allows (a set shot, a pump fake, pivots, a jab with the free foot), plus one thing more: Shift puts the ball on the floor. Shift is already the state change from dribbled to held; while the dribble is unused it is the same change the other way. A pump fake from here leaves the dribble alone. Once the ball has been dribbled and gathered again it is dead, and Shift does nothing.

- **Why a key, and not movement.** In a held-ball stance WASD is the free foot, which is what makes a jab possible. Something has to tell a jab from a first step, and a key press does it without a hidden timer.
- **The defender has to honor all three.** The AI stays at least 3.4 ft off a live held ball, because the drive is still there; against a dead dribble it closes to 2 ft. So a jab at it brings the ball into its reach, and a fake from that range does not get it in the air (see Pump fakes).
- **With the rules off** (the shot lab) the handler starts dribbling, as before.

**Simplification:** after a one-two stop, real rules make the first foot down the pivot. The prototype leaves the pivot unset until you move a foot.

Post moves are planned to use this same system from a back-to-the-basket stance: drop steps, up-and-unders and spins built from the free foot, ball position and pump fakes, with no post-specific moves.

## Pump fakes

A pump fake is a jump called off: press the mouse button to go up and let it go again while the legs are still loading, in the first 170 ms. The ball goes up and you stay down. Once the feet have left, letting go is a shot, however early, so a fake is a tap and a shot is a hold. The two share a button, as the real things share a motion: the start of a shot and a fake look the same to a defender because they are the same, until the feet leave.

- **When:** any time you have the ball and are not in the air: off the dribble, during gather steps, from a dead dribble or a triple threat.
- **After a fake, your dribble is dead,** because rising into a shot picks up the ball. Out of a triple threat you still have it to come. If you were already pivoting, you keep the same pivot foot, and the body is back where it went up from: a lean while the legs loaded does not move it.
- **Defenders react to the motion they saw,** real or fake, one shot reaction time later. The AI leaves its feet for a shot it sees only from inside 3.2 ft, which is as far as a block reaches. Up close it has to respect the shot, so that is also where a fake gets it in the air. From further off it keeps its feet, closes out and gets a hand up. The jump lasts 0.5 s.
- **The payoff window:** in the air, a defender drifts and can't close out. For 0.45 s after landing, they can only get about 30% of a hand up on a jumper or floater. Shooting into that window, or stepping through, is the reward; shooting while they're still in the air runs into the full contest.

The AI's choice is a rule, so it can be learned: bring it in close (pulling the ball in tight reads as a pull-up and does that) and it will go up for anything that looks like a shot. A person defending makes their own call.

## Shot noise and clean looks

Every shot carries a universal noise floor, the same for every body, plus situational noise on top. Clean looks get a capped premium, and their misses rim out instead of clanging.

**Why player input can't be the only error.** Mouse and timing error is too small for skilled players to cap make rates. The lateral make window is about ±6 px of cursor at the rim, and practiced timing of roughly ±15–30 ms is only 1.5–3 in of depth. Noise-free open shots would go in 85–95% of the time for good players. Input error also measures the user, not the player's body, so frames could only matter by making inputs harder, which is the 2K model.

**Decisions.**

- **Universal noise floor:** human motor noise. With physics, it becomes small variation in launch speed, angle and direction, which naturally grows with distance.
- **Situational noise on top:** contest, movement, fatigue, and later catch quality. These are what players influence by creating better shots.
- **Frames change outcomes only through physics,** never through a hidden accuracy number (see Frames).
- **Rejected: visible noise** (a wobbling aim the player times around). It would make contests act on the input again.

**The real-world anchor.** Curry, the best shooter ever, has hit about 47% of wide-open threes (closest defender 6+ ft) per FiveThirtyEight, and about 48% in 2015–16. Even for him, wide open and lightly guarded differ by only a few points.

**The feel problem.** Bricking a truly wide-open shot you executed perfectly feels terrible. Two measures:

1. **Near-miss shaping:** on a clean look with a perfect release, the noise is capped at 1.6 spreads, so misses rim out but never brick or airball. Under physics, pulling a shot inward can turn a near miss into a make, so the cap and the premium are tuned together. The cap loosens as cleanness or release quality drops, so a real brick still means something went wrong.
2. **Clean-look premium:** a clean look is nobody within about 8 ft (phasing in from 5 ft), feet set (phasing in below 3 ft/s, full below 1 ft/s), and not a fade. Multiplied by release quality, it cuts scatter by up to 4%. With the cap, that takes an open perfect three from about 50% to about 59%. The calibration check gave 59.1% over 4,000 shots, with every miss near the rim and no airballs.

| Ceiling for a clean look | Misses per 10 | Points per shot |
| --- | --- | --- |
| 50% (about Curry, wide open) | 5 | 1.50 |
| 60% (chosen) | 4 | 1.80 |
| 65% | 3.5 | 1.95 |
| 75% | 2.5 | 2.25 |

NBA wide-open threes average about 1.15 points per shot (approximate, from memory), Curry's about 1.4. A 60% ceiling makes clean looks the best shot in the game, which is acceptable only while they stay a defensive mistake rather than something offenses manufacture every trip. If a quarter of threes are clean at 65% and the rest go in at 35%, a team shoots 42.5%; the risk is skilled teams pushing that quarter toward half, so this depends on help defense and rotations.

**Held in reserve:** anti-streak smoothing (quietly raising the odds after a perfect clean miss). It works, but it's hidden manipulation; use it only if playtests show streaks are still the problem.

The panel shows "clean look" on the contest line when the premium applies. It is for the set shot only: a floater, or a ball let go at the rim, does not get it.

## Frames instead of ratings

Players are defined by their bodies, not by ratings. Height, wingspan and weight shape the mechanics, and the user's skill decides what to do with them. Players differ in what they can get away with, never in hidden accuracy. This is decided but not yet built. The prototype no longer has any ratings: every number that used to be one is now a setting in its own units, the same for every player, and those values are the anchor frame's (see Settings, not ratings, below).

| Frame | Helps | Costs |
| --- | --- | --- |
| Shorter | Quicker release, less time for a closeout. Lower dribble: faster rhythm, harder to reach. Sharper acceleration and cuts | Lower release point, easier to contest. Less reach on finishes. Moved off spots by contact |
| Taller | Higher release, shoots over smaller defenders. More reach at the rim, on contests and on blocks | Slower release that needs more space. Higher, slower, more exposed dribble. Slower to change direction |
| Longer wingspan | Contest, steal and block reach. Finishing extension away from shot blockers | A longer handle that's easier to poke at |
| Heavier | Wins contact: holds position, finishes through bumps, posts up | Slower to accelerate, lower vertical, tires faster |

**What frames replace:**

- **Release time:** from height instead of a fixed 520 ms, roughly 440 ms for a small guard to 600 ms for a center.
- **Contests:** geometry instead of a formula: the defender's reach (height plus wingspan plus jump) against the release point. With physics, it is literally whether the hand intersects the ball's path.
- **Dribble height and rhythm:** from height. This is where small players' handling advantage comes from, with no handling rating.
- **Acceleration and cutting:** from height and weight.
- **Body contact:** splits by mass instead of the fixed rule that the defender holds ground.
- **Dunks and finishing reach:** from height, wingspan, and a vertical derived from weight.

**The consequence.** With a universal noise floor and no accuracy rating, a point guard and a center hit the same percentage on a truly open look with perfect input. Frames separate them by how often each gets that look, and from where: how quickly the shot gets off, from what height, against what reach. The clean-look premium is tuned so every frame lands at about 60% on a clean three.

### Frame attributes

A frame is three numbers. The anchor frame (6'5", +3 in wingspan, 210 lb) must reproduce today's calibration exactly, so every placeholder in the prototype becomes the anchor's value.

| Attribute | Range | Anchor |
| --- | --- | --- |
| Height (H) | 5'9" to 7'4" (69–88 in) | 6'5" (77 in) |
| Wingspan (W) | H − 2 in to H + 8 in | 80 in |
| Weight | 160–290 lb, limited by height | 210 lb |

Two values are derived from those, not chosen: standing reach and vertical. These formulas are starting points to check against real combine data.

```latex
\text{reach}_{in} = 0.62\,H + 0.70\,W \qquad \text{lean}_{lb} = 2.9\,H - 18
```

```latex
\text{vertical}_{in} = \mathrm{clamp}\big(32 - 0.12\,(\text{weight} - \text{lean}) - 0.15\,(H - 77),\ 22,\ 38\big)
```

For the anchor that gives a reach of about 8'8" and a vertical of about 31 in.

### What each body sets

Each row replaces a placeholder or a rating. Multipliers are relative to the anchor, so the anchor keeps today's values.

| Mechanic | Comes from | Starting rule |
| --- | --- | --- |
| Jumper release time | Height | 520 ms + 8 ms per inch above 6'5": about 455 ms at 5'9", 610 ms at 7'4". The ±12 ms perfect window doesn't change |
| Jumper release height | Reach, vertical | Reach + 0.37 × vertical (anchor 9.6 ft) |
| Floater and layup release | Reach, vertical, wingspan | Floater: reach + a few inches. Layups: reach + vertical, released further out the longer the arms |
| Dunk eligibility | Reach, vertical | Can get the ball 6 in above the rim: reach + vertical (+4 in running) at least 126 in. Replaces today's rule that everyone can |
| Contest hand | Reach, vertical | Hand up at reach − 4 in; a contest jump adds 0.75 × vertical. Replaces the 8.2 ft and 2.2 ft placeholders |
| Dribble height and rhythm | Height | Bounce height ≈ waist (0.38 × H); rhythm scales with the square root of that. Lower and quicker is harder to reach |
| Dribble reach | Wingspan | Arm reach ≈ 0.39 × W (anchor 2.6 ft) |
| Speed and acceleration | Height, weight over lean | Top speed and acceleration drop a little per inch of height and per pound over lean; stopping and cutting likewise |
| Contact | Weight | Overlap splits by mass instead of the fixed rule that the defender holds ground |
| Steal and block reach | Wingspan, reach | The defender's hand reach comes from the arms, not a steals slider |

Two things stay universal on purpose: the shot noise floor (no accuracy by body) and the AI defender's reaction lag. Reaction time belongs to the person; in the real game a human is defending.

### Settings, not ratings

There are no ratings left. What used to be a 40 to 99 number per skill is now the mechanic itself, in its own units, with one value shared by every player. Online there has only ever been one set, the host's, applied to whichever side has the ball. These are the values frames will later derive from a body, with today's numbers as the anchor's.

| Was | Is now | Value | Frames will take it from |
| --- | --- | --- | --- |
| Shooter rating | Gone. Scatter was already one floor for everyone; its last uses were a constant for how far the AI takes a handler for a shooter, and the readout's bar | 0.75 | Nothing |
| Floater touch | Gone. It only fed the readout's bar | | Nothing |
| Fadeaway rating | Scatter in the air | 2.0 in at 5 ft/s | A universal cost per ft/s of speed in the air; height matters through release height |
| Finishing rating | Layup speed limit | 11.4 ft/s | Release reach and extension |
| Dunk rating | Gone. It was only a gate at 55; everyone can dunk | | Reach plus vertical clearing the rim |
| Ball handling, on-ball quickness | The AI's read of the handler | 260 ms | Reaction belongs to the person; dribble height and rhythm from height |
| On-ball quickness | The AI's top speed, with acceleration following | 13 ft/s | The defender's frame |
| On-ball steals, ball handling | How long the ball must be left open before the AI reaches, and the wait before another | 1.8 s, 3 s | Hand reach from wingspan |
| On-ball length | The defender's contest reach, still a multiplier | 1.0× | Wingspan |

The change kept every default exactly: the scripted replay is identical at all 49 checkpoints.

### Balance checks

Frames should make players different without making any frame the answer. Four archetypes get checked against each other in every role:

| Archetype | Height | Wingspan | Weight |
| --- | --- | --- | --- |
| Small guard | 6'0" | +2 in | 180 lb |
| Anchor wing | 6'5" | +3 in | 210 lb |
| Long wing | 6'8" | +6 in | 220 lb |
| Big | 7'0" | +5 in | 255 lb |

**What has to hold:**

- **Clean looks:** every archetype makes about 60% of clean, perfectly released threes. Differences appear only once a defender is involved.
- **Space versus height:** against the same closeout, the small guard's quicker release beats it more often than the big's. Against a small defender in their face, the big shoots over the contest more often than the guard does.
- **Blocks:** about 1 in 12 tight contests between two anchors, more when a big contests a guard, fewer the other way.
- **Handling:** the small guard loses the ball less often to reach-ins and crossover pokes than the big at the same exposure.
- **Separation:** the guard beats the big off the dribble; the big holds position on contact.
- **Dunks:** the guard can't dunk from a standstill, the anchor can on the move, the big can from almost anywhere near the rim.

The output of this step is a 4 × 4 matrix (shooter against defender) of contested make rates, block rates and separation. No row or column should dominate.

### Build plan

1. **Frame module:** pure functions from a frame to every derived value, with tests that the anchor reproduces today's constants exactly and that each relationship moves the right way (taller means a slower and higher release, and so on).
2. **Shooting from frames:** release time and height, contest hands and jumps, blocks. Replace the fade scatter and contest reach settings.
3. **Movement and dribbling from frames:** speed and acceleration, dribble height, rhythm and reach, contact by mass. Replace the AI's read, speed and reach settings.
4. **Finishing and dunks from frames:** release reach and extension, dunk eligibility, poster duels. Replace the layup speed limit and the rule that everyone can dunk.
5. **Balance pass:** build the archetype matrix and tune until no frame dominates.

The prototype gets frame pickers for you and the on-ball defender: archetype presets plus height, wingspan and weight sliders. The rim protector stays a big.

### Open questions

- Do the reach and vertical formulas match real combine data closely enough, or should they come from a lookup table?
- Should weight matter for stamina once there's a stamina system?
- Should players choose a shooting form within their frame's limits, for example a quicker, lower release against a slower, higher one? That would be a choice about mechanics, not a rating.
- How much should running vertical exceed standing vertical, and does it depend on the frame?

## Full physics

Makes will be decided by a simulated ball hitting a real rim and backboard, not by a landing point tested against an ellipse. Chosen over keeping the statistical make decision with physics only for misses.

### Status: built

All five milestones are done. Jumpers, floaters and layups in the prototype are simulated against a real rim and backboard; dunks keep their old resolution. The plan below is kept as the reference, with these results and changes:

- **Launch mapping:** timing moves launch speed by 0.0158% per ms; the ball inherits 10.6% of the body's sideways velocity and 6.6% along the shot. Every input lands within 10% of the old model at 24 ft, and timing and drift errors shrink closer in.
- **Release heights raised:** jumpers and layups 9.6 ft, floaters 8.7 ft, near the top of the shooter's jump. At 9 ft, contesting defenders blocked 4 of 10 tight jumpers.
- **Noise:** the old inch-based components are converted into launch-speed and direction noise using each shot's own sensitivities. Jumpers and floaters no longer have a distance term: a short shot comes down more steeply, so the rim is effectively bigger, and the old term double-counted that.
- **Calibration:** jumper noise 1.23× the old values, the quick line 1.50×, finishes 1.74×; contest scatter 6.19 in; clean looks 4% less noise, capped at 1.6 spreads. Results: open perfect three 50.1%, clean 59.1% (100% of misses near the rim, no airballs), 15 ft 60.1%, 25 ms off 45.1%, heavy contest 15.3%, open 15 ft fade 47.9%, floater 50.6%, open layup at a sprint from 3 ft 79.6% (67.9% from 5 ft, 76.3% let go a foot lower).
- **Live readouts:** 14 simulated shots per refresh with a running average, instead of precomputed tables. The paired estimates share their random draws, so their difference shows only aim and momentum.
- **Blocks and goaltending:** hands are real collision spheres (0.3 ft), at a standing reach of 8.2 ft (8.9 ft for the rim protector) plus a 2.2 ft jump, all placeholders until frames. Blocks turned out to be all-or-nothing for a given defender position: see Calibration, where standing jumpers against the default on-ball defender go from never blocked to blocked on every jump with a small change in distance or timing.
- **Bank shots:** the cursor on the backboard beside the rim targets the glass, and a marker turns green where a bank can go in from your spot. From about 45° the working band is narrow and right beside the rim; from 63–65° it's over a foot wide; straight on, none.
- **Ratings retired for shooting:** the shooter rating and floater touch sliders are gone; a universal floor replaces them.

**Airballs come from mistakes.** Heavy contests first airballed 15% of the time: their large spread sent the noise's outer tail clean past the rim. Now noise alone can carry a shot at most 12.5 in from the rim's center (a hard clank off the edge, never past it), plus 1.6 in at full contest, so a heavily altered shot airballs about 4% of the time. Bad timing, aim or drift are biases, not noise, so they can still airball any shot. A cap measured in spreads didn't work: it piles outliers onto its boundary, so airballs jump from about 17% to zero depending on whether that boundary falls inside the rim's reach. The calibration results above include this cap.

Open items: dunks don't fly yet.

**The resolver produces a launch instead of a landing point:**

- **Direction** from the cursor (lateral aim), as now.
- **Launch speed** from timing: early is weak and short, late is strong and long, which is what the meter already means.
- **Arc** from the shot type and the frame: jumpers around 45–50°, floaters much higher. Flatter shots get a smaller effective opening into the rim. A contest can raise the arc as the shooter goes over a hand.
- **Release point** from the frame (height, wingspan).
- **Noise** on speed and direction: the universal floor plus situational components, combined as now. Launch-angle noise is left at zero. Near-miss shaping becomes the shape of this noise.

**What then emerges:** bank shots (aim the cursor at the glass for a deliberate bank), rim rolls, back-iron misses, soft touch, and realistic caroms for rebounding. Blocks become collisions between the defender's hand and the ball's path.

**Costs:**

- **Recalibration.** Make rates come out of simulation, so the noise must be tuned against the targets with thousands of offline simulated shots. The targets themselves don't change.
- **Live make-chance readouts** can't simulate thousands of full ball flights every frame. They average a few simulated shots per refresh instead.
- **New feedback view:** a side-on view of the arc and what the ball hit, replacing the top-down landing chart.

### Geometry and constants

Coordinates stay in feet, with x and y on the court as in the prototype and z up. Court dimensions are regulation; bounciness and friction are starting values to tune against real footage and our targets.

| Object | Value |
| --- | --- |
| Rim | Center (25, 5.25, 10.0) ft. Inner radius 9 in (0.75 ft). Tube radius 0.31 in (5/8 in diameter) |
| Backboard | Front face at y = 4.0 ft (rim center 15 in from it), back face 0.12 ft behind it. 6 ft wide (x 22–28) by 3.5 ft tall (z 9.5–13.0), so its bottom edge is above head height and the floor under it is open |
| The floor | A player's center can be anywhere on the half court up to 0.6 ft from its lines: x 0.6–49.4, y 0.6–46.4. That includes the baseline and the floor under the backboard. Nobody's center gets closer than 1.0 ft to the rim's |
| Ball | Radius 4.7 in (0.39 ft). Mass 22 oz |
| Gravity | 32.17 ft/s² |
| Rim bounce | Restitution 0.6, friction 0.3 (starting values) |
| Backboard bounce | Restitution 0.75, friction 0.2 (starting values) |
| Floor bounce | Restitution 0.75, friction 0.1 (starting values) |
| Air drag, spin lift | Off at first; added only if trajectories look wrong |

The rim is modeled as a torus: a ring of radius 9 in made of a tube of radius 0.31 in. The net and the rim's mounting hardware are not modeled as solid at first.

### Launch model

At release, the player's inputs and situation become a launch: release point, direction, angle and speed. Noise is then added in launch space.

**Release point.** Where the hand is (see At the rim): 0.7 ft in front of the body and 9.6 ft up at the top of a standing jump, in a shooting form, or wherever the cursor has put the ball. Reach and jump are placeholder values until frames define them.

**Target.** The rim center by default. With the cursor on the backboard, a point on the glass (see Bank shots).

**Arc (launch angle).** 48° for a set shot and 60° on the quick line. A finish is let go from anywhere between right under the rim and several feet out, low or high in the jump, so no one angle suits it: from close and low, a fixed one runs into the front of the rim. What stays the same is the angle it comes down into the rim at, 60°, and the launch angle is whatever gives that: tan(up) = tan(60°) + 2 × (rise needed) / (distance), capped at 82°. Finishes and quick releases are aimed 2 in past the rim's center: up close a ball that is a little long still drops and one that is a little short hits the front of the rim, so the middle of what goes in is behind the center. Between 4 and 8 ft the arc and the aim point are mixed by how much of the shot is a finish. A contest raises the arc by up to 6° at full strength, as the shooter goes over the hand. Dunks have no flight: the ball is placed through the rim unless blocked.

**Ideal speed.** The speed that carries the ball's center from the release point through the target at that angle, where d is the horizontal distance and Δz the height gain:

```latex
v^{*2} = \frac{g\,d^2}{2\cos^2\theta\,\left(d\tan\theta - \Delta z\right)}
```

**Inputs become biases on that launch:**

| Input | Becomes | Mapping |
| --- | --- | --- |
| Timing | Speed | v = v\*(1 + k × post-assist timing error). Early is short, late is long. k is set so depth sensitivity at 24 ft matches today's 0.09 in per ms: k = 0.000158 |
| Aim | Direction | The signed angle between the shooter-to-cursor and shooter-to-target lines on the floor plane, as now |
| Carried momentum | Added velocity | The ball inherits part of the body's velocity, tuned to match today's drift sensitivities at 24 ft (1.6 in lateral and 1.0 in depth per ft/s): 10.6% sideways, 6.6% along the shot |
| Fades | Aim offset | The fade's backward motion isn't added to the launch; the later release line stands in for it. Its sideways push becomes a fixed aim offset for the cursor to correct |

The goal of this mapping is continuity: at the same inputs, a physics shot from 24 ft should land within about 10% of where today's model puts it, before calibration starts.

### Simulation and collisions

The whole flight is simulated instantly at release and then replayed for the animation. Same launch, same path: the only randomness is the launch noise. Calibration and tests draw it from a seeded generator so results repeat; the prototype uses fresh random draws.

- **Integration:** exact free flight under gravity between contacts, in steps of 1 ms, 0.5 ms near the rim, and 10 ms where there is nothing to hit.
- **Rim contact:** find the closest point on the rim's ring to the ball's center. Contact when they're closer than ball radius plus tube radius. The contact normal points from that ring point to the ball's center. Push the ball out, reverse its velocity along the normal times the rim restitution, and reduce the sideways part by friction.
- **Backboard contact:** a slab with two faces, bounded by its width and height. A ball is on whichever side of the board's middle its center is on, and that face pushes it out its own way, so a ball thrown at the rim from behind the board comes off the back of the glass ("Off the back of the backboard"). Same response with the board's values on both faces. Steps stay small within a foot of the board, so a hard throw cannot pass through. Edge hits are ignored at first.
- **Resting contact:** a ball that has all but stopped bouncing on the rim or the glass (touching it at under 0.5 ft/s) is resting on it, and a ball at rest on a slope rolls. Nothing bounces, the velocity that is left runs along the surface, and gravity carries the ball off whichever way the surface tilts. Without this, friction held a ball on the curved top of the rim as it would hold a block: about 1 shot in 150 came to rest up there, three quarters of them balanced on the ring and the rest wedged against the glass, and stayed for the whole 8 s of the flight. Now one set down on the ring is off it in 0.7 s and a wedged one in under 2 s, and none stays. The calibrated make rates moved by 1 point or less.
- **Stopped:** if a ball does stop dead off the floor for half a second, the flight ends there, and the game whistles it dead a moment later.
- **Floor:** the flight runs on through two floor bounces, so we know where the rebound goes.

**Make detection.** A make is confirmed when the ball's center comes down through the rim plane inside the ring and reaches about 0.6 ft below the rim while still inside it, which is where the net takes over. Once in, the net damps the ball's speed for the animation. Anything else is a miss; the simulation gives up after 3.5 s.

**Outcome labels come from the contact log:** swish (no contact), in off the rim, bank (glass first), in and out (a miss off two or more rim hits), front rim, back iron, off the side, off the glass, airball (touched neither rim nor glass), blocked, and goaltending. This replaces today's labels, which are guessed from the landing point.

### Noise and calibration

Noise moves into launch space: a spread on speed (as a fraction) and on direction. Launch-angle noise is left at zero. Calibration tunes its size against the same targets as today, by simulating many shots offline.

**Noise components,** each combined the same way as today (added in quadrature) on each launch axis:

- **Universal floor:** the same for every frame, replacing the rating term. The perfect release bonus still shrinks it by up to 30%.
- **Distance:** largely falls out of the physics, since a fixed angle error grows with distance. Calibration set the explicit term to zero.
- **Movement and fades:** from speed at the start of the shot, and the fade cost.
- **Contest:** spread grows with the contest, alongside the arc increase from the launch model.

**Clean looks.** The premium still multiplies all noise by (1 − premium × cleanness × release quality). It started at 0.13 and calibration set it to 0.04. Near-miss shaping becomes a cap on how far, in units of spread, a clean perfect shot's noise can reach: 1.6. One difference: unlike the ellipse model, pulling noise inward can turn a near miss into a make, so the premium and the cap are tuned together to land on 60%.

**Procedure.** `sim/calibrate.js` solves each setting against its target, using 3,000 seeded shots per evaluation, and writes the results to `sim/calibration.js`. The planned grid of tables was not needed. Tuning order:

1. Set the jumper noise multiplier, by bisection, so an open, perfectly released, non-clean three at 24 ft goes in 50%.
2. Set the contest scatter, by bisection, so a fully contested three goes in about 15.5%. The contest tail (how far past the rim's edge a full contest can carry a shot) is raised in 0.1 in steps until those shots airball at least 3% of the time.
3. Set the floater and layup multipliers, by bisection: a 10 ft floater at 12 ft/s at 50%, an open layup at a sprint at 80%.
4. Tune the premium and the cap together, by grid search: the pair closest to 60% for a clean perfect three, with at least 95% of misses near the rim (within 11 in of its center) and no airballs.

The script then prints every target at 4,000 shots, along with the open perfect 15 ft jumper, a three 25 ms off, and an open straight fade.

**Live readouts** simulate 14 shots per refresh and blend them into a running average, instead of reading precomputed tables. The last-shot panel runs 80 shots once per shot. Their random draws are taken at release and kept with the shot; the shots themselves are run when the panel asks, so the release tick costs about 3 ms and not 16.

### Blocks, bank shots and feedback

**Blocks.** A defender's arm is in the shot for the first 0.6 s of the ball's flight, and the ball collides with it like anything else.

- **An arm is one length.** It is 2.6 ft from shoulder to hand, and the shoulder is that far below standing reach. Reaching out toward the ball lowers the hand: 1.6 ft out, it is 0.55 ft lower than straight up. So a hand cannot be both close to the ball and as high as it goes.
- **The whole arm is solid.** The hand is a 0.3 ft sphere and the forearm a rod from the shoulder to it. A ball that would pass under the hand hits the arm.
- **A touch is a collision with something soft.** The ball loses nearly all the speed it had into the arm and keeps the rest, and a rising hand carries it. A square hit stops it: a block. A graze turns it a little: a tip, which carries on off line and can still go in. The line between them is the ball's velocity changing by 40% of its speed.
- **Then it is a loose ball.** Whoever touched it can't also catch it for 0.35 s.
- **The arm is where the defender put it at the release.** A jump that starts after the ball is gone changes nothing; by then the ball is out of reach anyway. After 0.6 s the arm is out of the simulation, so a ball coming back off the rim is rebounded under the rules of the game and is never a late "block" by an arm that is no longer there.

This replaces the block probability rolls for everything except dunks.

**Goaltending.** Touching the ball on its way down, above rim height and within 1.6 ft of the rim's center, counts as a make.

**Bank shots.** In the top-down view the backboard is a line behind the rim, from x = 22 to 28. With the cursor on that line, clear of the rim, when a jumper or floater starts, the target becomes a point on the glass, at the height that would send the ball in from the shooter's angle; the physics decides the rest. From the wing, a bank naturally beats a direct shot; straight on, it doesn't, because the glass already rescues long straight-on misses. No bonus is written in. Layups don't use this yet: they always go at the rim's center (see the open items above). While aiming at the glass, the target spot is shown on the board.

- **Rim or glass is chosen when the shot starts,** by where the cursor is at the press, and not again. A cursor that slides off the rim onto the backboard during the shot is a worse aim at the rim, never a bank. Once it is a bank, the cursor slides the target along the glass on the side of the rim it started.
- **The strip that counts as the glass stops short of the rim:** within 0.4 ft of the backboard's line and at least 1.1 ft to the side of the rim's center. It used to be 0.7 ft and 0.8 ft, which took in the back of the rim itself, and the choice was made at the release. A cursor typically 16 px off the rim turned 11% of shots into banks that went in 0 to 3% of the time; now it is 4%, and none of them from a cursor that drifted during the shot.
- **The court holds still while you shoot.** The camera normally keeps the player in place and slides the floor under them, which slides it under the cursor too. Running on a diagonal with the mouse untouched, the aim point moved 2.8 ft across the court (45 px) in the first quarter second of a shot. During your own shot the camera now stays where it was, so the cursor stays on the spot it was put and only the hand moves it, and the camera catches up once the ball is away.

**Feedback view.** A side-on replay of each shot replaces the top-down landing chart: the arc from release to the rim, the rim and board drawn to scale, and markers where the ball touched. The court view keeps animating the ball from above.

### Structure, tests and milestones

This is the point where the prototype becomes a real project. The physics is built and tested on its own before it touches the game.

**Modules:**

- **Physics** (`sim/physics.js`): pure and deterministic. Steps the ball, resolves contacts, and simulates a whole shot from a launch into a path, a contact log and an outcome.
- **Situation** (`sim/situation.js`): the rules that read the floor. What a defender takes a jump for, the contests from range, clean looks, finishing scatter, and where the defenders' hands are during the flight.
- **Launch** (`sim/launch.js`): turns inputs and situation into the ideal launch and the biases.
- **Noise** (`sim/noise.js`): the scatter components, their conversion into launch noise, and simulated make rates.
- **Game** (`sim/game.js`): everything that happens on the floor: movement, dribbling, gathers and pivots, the defenders' AI, shots and their release, and the rules of a game (score, shot clock, possessions, loose balls, free throws). A game is one plain object, advanced by `step(game, input)` in fixed ticks of 1/120 s. Its random stream is part of the object, so a seed and a list of inputs replay exactly, and a copy carries on identically. The live readout draws from a separate stream, so looking at the odds never changes the outcome.
- **Rollback** (`sim/rollback.js`): keeps two copies of a game together over a connection. Each side plays on with a guess at the other's input, and goes back and replays when the guess was wrong. Resyncs from the host if the copies drift.
- **Calibration** (`sim/calibrate.js`): an offline script that solves the noise settings and writes them to `sim/calibration.js`.
- **Measurement** (`sim/measure.js`): an offline script that reports make and block rates with defenders' hands in the simulation, first for fixed defender positions and then with whole shots played through the game.
- **Browser tools** (`tools/`, need Playwright): `replay.js` plays a scripted session in the prototype with a seeded random generator and a stepped clock, and compares every checkpoint against a git ref, as a check that a refactor didn't change behavior. `ingame.js` measures standing jumpers with the defenders reacting as they do in play. `online.js` plays an online game between two headless browsers over a faked bad link and checks they stayed together.
- **The page** (`prototype/shot-model-lab.html`): canvas, input, camera, drawing and the panels, about 520 lines. Input events only record what is held; each tick the page hands the game one plain input (keys, cursor position, shot, Shift, gather).
- **Data:** the calibration output is its own generated file. Other constants still sit at the top of each module.

**Tests** (`sim/tests.js`, `sim/tests-launch.js`, `sim/tests-situation.js`, `sim/tests-game.js`, `sim/tests-rules.js` and `sim/tests-rollback.js`):

- A perfect launch at the rim center from 15 and 24 ft is a make with no contacts.
- At 24 ft, 1–2% too slow hits the front rim, 1.5–2% too fast hits the back iron, and 5% slow is an airball. (Speed is that sensitive: 3% slow is already an airball.)
- From 45°, the best bank beats shooting straight at the rim; straight on, it doesn't. (Measured at 12 ft with small errors: 76% vs 68% from 45°, 58% vs 81% straight on.)
- Small sideways errors produce some rim contacts that fall out (in-and-outs exist).
- The same launch produces the identical path.
- No bounce ever gains speed.
- Nothing comes to rest on the rim: a ball set down on the ring rolls off, one wedged against the glass comes down, and no miss off the rim is still up there 3.5 s later.
- A hand in the ball's path on the way up blocks it; a hand that stays low doesn't. An arm is solid from shoulder to hand, a graze is a tip that keeps most of its pace, and the same touch always gives the same path.
- A touch on the way down over the rim is goaltending, and counts.
- Before calibration, inputs at 24 ft land within 10% of where today's model puts them. Closer in, aim still matches, and timing and drift errors shrink.
- The situation rules behave as this doc describes them: the context table, each contest factor, clean looks, finishing scatter, and the reach and jump timing of defenders' arms: one length, so lower the further out, and in the shot for 0.6 s.
- The game is deterministic and plain data: the same seed and inputs give the same game, a copy made mid-shot or sent as JSON carries on identically, and previewing the odds changes nothing.
- Rim or glass is chosen at the press: a cursor that ends on the backboard is not a bank, one that started there stays one, and a near miss of the rim is not the glass.
- Scripted input plays out as designed, with no browser: letting go 517 ms after the press is a perfect jumper, letting go before the feet leave is a pump fake, a jump carries half its speed plus the lean, coming down with the ball is travelling, a jump has one release line, the quick one off a drive from floater range and the top of the jump otherwise, and it does not move in the air, a jump that starts as a finish has no line and no aim wherever it is let go, the ball in the air is where the cursor puts it and stays out from under the rim, a ball held in front of an arm is blocked and one held away gets off, flying into a set defender is a charge, a ball over the rim near the top of a running jump is a dunk, a gather gives two steps and then a dead dribble, on the steps the ball goes after the cursor across the chest and never behind the back and a hand can take it only when the body is not in the way, the rim protector reads a euro a reaction time late, and the defender closes out or jumps on a shot they see.
- A possession starts in a triple threat: a jab goes out and comes back, a pump fake leaves the dribble alone, Shift puts the ball on the floor, and a dribble picked up again stays dead. The AI stands off a live held ball and crowds a dead one.
- The rules hold: a check ball to start, scores and changes of possession, defensive and offensive rebounds, the shot clock, out of bounds, a ball dribbled into a defender's hand, a dunk met at the rim as a live ball, and-ones and two-shot fouls at the line, and a game that ends at 21. With the rules off none of it applies.
- Nothing is rolled: the only random draws in the game are the two behind each normal deviate of a shot's scatter. An open dunk always goes down, and the AI jumps for a shot only from where it could block it.
- Fouls are contact: a hand that goes into the handler is a reach-in and one that was already there is not; a hand on a shooter's arms or a defender who runs into them is free throws, and straight up beside the ball is clean; jumping into the back of a player who has the spot gives them the ball.
- Two players: there is no rim protector, and the side without the ball moves, contests, jumps and takes the ball with their own input. A defender close enough who goes up in time blocks a jumper, and from further out, late or flat-footed does not; reaching out gets to shots that straight up cannot. After a miss, the player in the air takes the ball before it comes down to the other, and a player standing on the spot is not moved by one running into their back. Over a link with lag, jitter and lost packets, a player's own input lands after the same 25 ms, neither side waits, and both end with exactly the game a single machine would have played from the same inputs. Each correction reports how far it moved each player, and with that taken off nobody moves more than a stride in a tick. Past 250 ms each way both wait and still agree. A side whose clock is ahead slows until the two match, a copy that drifts is replaced by the host's, and packets from the game before a rematch are ignored.

**Milestones:**

1. **Physics core and a test page** for firing shots with sliders for speed, angle and direction, with a side view. Done when the tests pass.
2. **Launch model.** Done when the continuity check passes.
3. **Calibration.** Done when every target is hit within 2 points, clean perfect misses touch the rim at least 95% of the time with no airballs, and the tables are generated.
4. **Integration.** Every shot type uses physics, the side-on replay replaces the landing chart, and misses carom realistically.
5. **Blocks, goaltending and bank-shot aiming.**

**Open questions:**

- Are air drag or spin lift needed at all?
- Backspin softens rim bounces ("touch"): should it be universal or come from the frame?
- Release heights and arcs per frame depend on the frames work, which comes after physics. Until then, placeholders.
- How stiff is the rim, and do breakaway rims matter for dunks?
- How tolerant should make detection be where the net catches the ball?

## The game: possessions and rules

With the rules on, the prototype is a game: two sides take turns with the ball against the same defense, first to 21. With them off it is the shot lab as before, where the ball comes straight back after every shot. The rules live in `sim/game.js` beside everything else and are covered by `sim/tests-rules.js`.

**Sides and turns.** Home and Away alternate on every change of possession, including after a score. Each side keeps one color all game, on the court and on the scoreboard: Home is white and Away is purple. Whoever has the ball is drawn in their side's color and the defense in the other's, so the colors stay with the players when possession changes. The scoreboard rings the side that has the ball. Until a second player can defend, one person plays offense for both sides and the AI defends both.

| Rule | How it works |
| --- | --- |
| Check ball | Every possession starts at the top of the key, 25.75 ft out and behind the arc, in a triple threat: the ball held, the dribble still to come. The defender is at their guarding distance and the rim protector home. The ball can't be taken for the first second |
| Shot clock | 14 s. It runs while the handler has the ball, including the shooting motion, and stops once the shot is in the air. Running out gives the ball away |
| Scoring | Twos and threes as before, one for a free throw. First to 21 wins |
| Loose ball | A miss, a tip or a block is a live ball. It keeps flying and bouncing as the physics says, and goes to whoever's reach it comes into first: within 1.6 ft of their body and no higher than their hands, which are at 8 ft standing and up to 10.2 ft at the top of a jump |
| Offensive rebound | The handler gets it: play on with a fresh clock, from a triple threat |
| Defensive rebound | A defender gets it: the other side's ball |
| Out of bounds | Against the side that touched it last: the shooter, or the defense after a block. A ball left lying for 1.5 s is whistled dead the same way |
| Steals and strips | A hand on the ball takes it, and that ends the possession at once |
| Shooting fouls | Contact on any shot: reaching onto the shooter's arms, or running into them. If it goes in, an and-one: one free throw. If not, two, or three for a three |
| Other fouls | A reach-in, or going over a rebounder's back. The player who was fouled gets the ball, from the top, with a fresh clock |
| Free throws | An ordinary jumper from the line, 13.75 ft out, with the defenders more than 8 ft away, so each is a clean look. Nobody moves. After the last one the other side takes the ball |
| Dunks | A dunk met at the rim is a live ball from wherever the arm knocked it |
| Whistles | Play stops for 1.5 s, then the next thing happens |

**Rebounding.** Three things decide who gets a loose ball, and none of them is a roll.

- **Getting there.** Without the ball the handler runs at 15 ft/s, against 13.5 ft/s dribbling. The ball is drawn with its height while it is loose, so you can see where and when it is coming down.
- **Going up.** The mouse button jumps for a loose ball, for the handler as well as a player on defense. A jump is half a second with no steering and a moment to recover, and it raises the hands by up to 2.2 ft. Of two players under the ball, the one in the air at the right moment takes it first. Too early or too late and it is the other player's.
- **Boxing out.** Two bodies can't share a spot. When they meet over a loose ball each gives back the ground they took: a player standing still is not moved at all, and the one running into them is stopped at their back, 1.7 ft away. That is further than the 1.6 ft a ball can be caught from, so a player who gets to the spot first and holds it has the rebound unless they mistime it. Two players running into each other split the bump by how fast each came.

**It is the same button.** Pressing the mouse button is the jump for everyone, with the ball or without it, so the shot and the contest are one motion. A free throw is the same press and release as any jumper.

**Against the AI.** The defenders take a reaction time to register a miss before they go after it, and they go up for a ball that is about to come within a jump's reach.

**Fouls.** A foul is contact the defender caused. None is rolled, and the AI is held to the same rules as a player.

| Foul | When | What follows |
| --- | --- | --- |
| Reach-in | The defender's hand goes into the handler's body (within 0.75 ft of their center) or onto the arm they are guarding the ball with, moving into them faster than 4 ft/s | The offense keeps the ball |
| On the arm | At a release, a raised hand within 0.6 ft of the shooter's center. The ball leaves 0.7 ft out, so a hand that close is on their arms, not the ball | Free throws, or an and-one |
| Ran into the shooter | At a release, a defender within 1.9 ft who is still coming at them faster than 3.5 ft/s | Free throws, or an and-one |
| Over the back | After a miss, a player in the air and still moving at more than 2 ft/s into one who had the spot and was all but still | The ball goes to the player who had the spot |

- **Whose movement it was decides it.** A hand that was already there, which the handler dribbles or drives into, is no foul. Nor is a defender who is standing still when a shooter goes into them, or a rebounder who runs into a back without leaving the floor: they are simply stopped.
- **So over-reaching costs something.** A defender inside 2.2 ft who reaches as far as their arm goes fouls every shot. From the same spot with the hand straight up they block about half the jump timings and foul none (see Calibration).
- **There are no offensive fouls yet.** A driver who runs over a defender standing their ground is not called for a charge.
- **Nothing accumulates.** A reach-in costs the defense only the chance at the ball: there is no foul count and no bonus.

**First guesses, to revisit:**

- **Rebounding is by position and timing only.** Catching is automatic once the ball is in reach: the cursor plays no part. Every body is the same size and strength until frames, so a box-out can't be moved by anyone.
- **A ball only comes loose once it has dropped below the rim.** A player already in the air has it the moment it does, so the first chance at most rebounds is at about 9 ft.
- **The last free throw is never rebounded.** The other side simply takes the ball.
- **14 seconds and 21 points** are starting values, as is the one-second grace after a check.
- **The foul thresholds are first guesses:** how fast a hand has to be moving to count as a reach, how close to the shooter counts as on the arm, and how fast into a back is over it.
- **Every possession starts from the same spot,** so the first few seconds can become routine.

## Two players online

Two people can now play each other: each plays their own side, and whoever doesn't have the ball controls the on-ball defender. It is one against one: there is no rim protector. It is built to find out how defending feels.

**Defending.** The same keys as on offense, so there is still nothing new to learn and no move buttons.

| Input | On defense |
| --- | --- |
| WASD | Moves the defender: 14 ft/s, a little quicker than a dribbler's 13.5 |
| Cursor | The hand. Pointed at the ball handler it is a hand up, which is what the contest formulas read, however far out it is. How far it is from the body is how far the arm reaches, between 0.85 ft (nearly straight up, and as high as it goes) and 1.6 ft (reaching out, and lower). On the defender's own body, the hand is down |
| Cursor on the ball | Takes it, if the hand gets within 0.55 ft of a ball that is being dribbled or held and the handler's off arm is not in the way. Not during the first second after a check |
| Left mouse | Pressed, jumps, to block a shot or go up for a rebound. No steering in the air, and the usual recovery on landing. Letting it go does nothing |

**The defender's hand.** Every defender has one hand, and what it meets decides what happens, for the AI and a player alike: the ball with nothing in the way is a steal, and the handler's body or off arm, if the hand was moving into them, is a reach-in foul. From in front, across the handler's body, the ball can't be reached without going through them; from the ball's side it can. A player's hand is where their cursor puts it. The AI's rests toward the handler, held off their body, and it reaches when it has seen the ball left open: within its reach, with neither the handler's arm nor their body in the way, for long enough. Under its nose that is 0.12 s; at the end of its reach, 1.2 s; both stretched for a better handler and shortened for a better thief. It reaches for where that ball would be now if the handler had done nothing since, a reaction time on. If they have moved it, the hand finds an arm, or nothing. **Blocks are the defender's timing and reach:** the jump is theirs to choose and the hand is where they put it (see Blocks, under Full physics, and the measurements under Calibration).

**Staying together** (`sim/rollback.js`). Both browsers run the whole game, and neither waits for the other.

- **Your own input lands after 25 ms, always.** Each side samples its input once per tick and uses it 3 ticks later, whatever the connection is like. The delay is the same on a press and a release, so shot timing is as fair online as off.
- **The other player is guessed, then corrected.** Their input for the current tick has usually not arrived yet, so the game plays on as if they were still doing what they were last seen doing. When the real input arrives and differs, the game goes back to the last tick both inputs were known for and replays to the present with the right one. On screen that is the other player jumping to where they really are; how far depends on the lag and on how sharply they changed what they were doing.
- **Two games per side.** One has only ever been stepped with real inputs from both players; the one on screen runs ahead of it on guesses. Going back is copying the first over the second, which takes about 0.06 ms, and replaying a tick takes about 0.015 ms. The last-shot panel and the stats read the first, so a result is never shown and then taken back.
- **How far ahead.** With the two clocks together, the game on screen runs ahead of what is known by the one-way lag less the 25 ms. At 100 ms each way that is about 9 ticks. Past 30 ticks (250 ms) a side stops and waits, so nobody plays far into a game that may not have happened.
- **Corrections slide.** A correction puts everyone where they really are at once, which drawn as is would be a snap. So the page draws each player where they were, plus what is left of the correction, and that remainder shrinks by about two thirds every 100 ms. On a 100–130 ms link the other player's biggest move between two frames fell from 2.0 ft to 0.6 ft. Only the drawing lags: contests and a hand on the ball are always judged on the corrected positions, so for a moment a player can be drawn up to a foot or so from where they count as being. A correction of more than 5 ft is a move to a new spot and is not slid. `?smooth=150` sets the time in ms and `?smooth=0` turns it off.
- **Clocks.** Every packet says how far ahead of the other side the sender thinks it is. From the two views each side works out the gap between the clocks, and the one that is ahead gives up a tenth of its time until they match. Without this the host, who starts first, would do all the guessing and the guest none.
- **Lost packets cost nothing.** Inputs go on a channel that never resends, so a lost packet can't hold up the ones behind it. Every packet carries all the inputs the other side has not yet acknowledged, so the next one fills the gap.
- **A hidden tab keeps playing.** A browser gives a hidden tab no frames to draw, which would stop its game and leave the other player waiting on its input. So while a tab is hidden during an online game, a worker's timer keeps the game stepping, with nothing drawn and no keys held: that player stands still, and the other plays on. This is also what lets one person try both sides on one machine, where one tab is usually behind the other.
- **Drift.** Every 60 ticks the two sides compare a short fingerprint of the game they have agreed on; if they differ, the host sends its whole game and the guest takes it. That covers the case where two browsers' maths differs in the last digit.

**Connecting.** The host presses Host a game and gets a link ending in a six-character code. The game starts when the other player opens it, in a new tab or pasted into a tab that already has the page. Someone who already has the page open can also type the code.

The browsers talk directly over WebRTC, but two browsers can't find each other unaided: each has to be told how to reach the other. Two outside services help, and neither sees the game:

- **An introduction service** passes those few messages between the two browsers. The page uses the free public one run for the PeerJS library, speaking its protocol directly, with no library loaded. The host waits there under the code; the guest calls that code; they exchange how to reach each other and the page hangs up on the service. Both players' network addresses pass through it, as they must for any service doing this job.
- **Public address lookups** (Google's and Cloudflare's STUN) tell each browser its own outside address. Two are asked so the page can tell when a network answers each one differently.

**When a direct connection isn't possible.** Some networks will not accept a connection from outside however it is introduced: ones that give a different outside address to every destination, and ones that block this kind of traffic altogether. Two players on such networks, or one on a strict one and one on an ordinary one, cannot connect directly. The only way through is a relay: a server both can reach that passes the traffic between them, still encrypted end to end. A relay needs an account with someone who runs one, so the page has none by default.

- `?relay=<address>` on the page (or `RELAY_URL` in it) names an address that answers with a list of relay servers in the form browsers take. The credential addresses of Metered and of Cloudflare's TURN service both do. The invite link carries it to the guest.
- `?relayonly` connects only through the relay, to check that one works.
- Once a game starts, the panel says whether it is connected directly or through a relay.
- When a connection fails to come up, each side is told what its own browser found: no outside address at all, a different one for every destination, or a network that looks open (so the other player's is probably the one in the way), and whether a relay was available.

If the introduction service can't be reached, the panel says so and opens the old way of connecting, which needs no service: the players carry the two messages themselves, as codes of about 830 characters, the host's first and then the guest's back. `?broker=wss://…/` on the page's address points it at a different introduction service that speaks the same protocol, such as one you run yourself.

**Playing again.** When a game ends the scoreboard offers Play again. Online both players have to press it: the first to do so waits, and the other's button says they are ready. Then the host deals a new game on the same connection, exactly as it dealt the first, and the side that lost has the ball first. Every network message carries the number of the game it belongs to, so packets of the finished game that are still on their way are ignored and cannot be taken for the new game's. On your own, Play again simply starts a new game.

**Trying a bad connection.** Once a game starts, the panel shows the round trip it measures and how far ahead it is guessing. Adding `?lag=80&jitter=20&loss=5` to the page's address holds everything that page sends for 80 to 100 ms and drops 5% of its input packets; put it on both pages for both directions. `?delay=40` on the host's page sets the input delay, in ms, for both players. `node tools/online.js` does the whole thing between two headless browsers and checks they agreed; with `--link` they connect by invite link, with the introduction service played by the script, and with `--broker wss://0.peerjs.com/` through the real one.

**Measured** between two headless browsers on one machine, both players moving, pointing and shooting throughout:

| Link each way | Input packets lost | Waited | Resyncs | Keeping in step, per frame |
| --- | --- | --- | --- | --- |
| 60–80 ms | 5% | Never | 0 | 0.2 ms median, 5 ms worst |
| 150–210 ms | 15% | One side, 0.2 s in 12 s | 0 | 0.2 ms median, 7 ms worst |

The worst frames are the ones that replay a shot's release, which simulates the ball's whole flight.

**Limits, for now:**

- **The introduction service is somebody else's free service.** It can be down, slow or limited, and there is no promise it stays up. It is also stricter than the server code PeerJS publishes: it hangs up on any sender whose message is not shaped like the library's own, which is why the first version of the link failed with "Lost touch with the invite service" the moment a guest joined. The page now sends what it expects, the link has been checked against the real service, and the stand-in used by `tools/online.js --link` is as strict.
- **Some networks won't connect, and this has happened in a real game between two networks.** With no relay set up, players behind a strict firewall can't be reached. Each side is told what its own network looks like when it fails. The relay support above is untested against a real relay.
- **A code is the only key.** Anyone who has the link can take the one open seat. Once a game has started the code is dead.
- **Not yet played across the internet, or between two different browsers.** Everything above is two copies of Chromium on one machine with the lag faked. Two different browsers may drift and lean on resyncs.
- **Sliding only covers where players are.** A jump or a shot that the other player started a moment ago still appears already under way, and a ball leaving a sliding player's hands steps to its true path.
- **A shot can change after release.** If the defender's real hand was somewhere other than guessed when you let go, the flight is worked out again. It settles within the lag, long before the ball arrives.
- **Packets are plain text,** about 200 characters each at 60 a second. Fine for two players; a binary format would be a tenth of that.
- **No tuning online.** The host's settings are used, and carry over into a rematch.
- **The numbers are first guesses:** the 25 ms and 250 ms above, the 100 ms slide, the defender's speed, the reach that takes the ball, and the off arm stopping a reach outright.

## Prototype defense AI

The defenders exist to exercise the model, not as a design for game AI; in the real game the on-ball defender is a person. The on-ball defender's perception model is described above (The on-ball defender).

|  | On-ball defender | Rim protector |
| --- | --- | --- |
| Default position | Between ball and rim at the cushion from the perception model (guarding distance default 4.5 ft), shaded 0.8 ft toward the ball side they saw | Home 3.25 ft in front of the rim; inside 16 ft, blends 60% toward a point min(4.5, 0.45 × distance) ft out on the drive line |
| Speed | 13 ft/s, accel 50 ft/s² | 11 ft/s (12 when contesting a finish), accel 40 ft/s² |
| On a shot | Reacts to the shooting motion they saw, real or fake, after the shot reaction time (default 250 ms): closes out to 1.8 ft in front at 15.5 ft/s | Finishes: blends 75% toward a point min(3, 0.6 × distance) ft out. Stay-home / step-up read on drives (see The quick line) |
| Hand | Up once they react. Before that, 0.8 × the pull-up threat, or 0.64 against a dead dribble | Rises for jumpers and floaters within 8 ft |
| Jumps | Within 5 ft of a shot they saw: 50%. On finishes, at a scheduled moment if within 7 ft | Within 7 ft of a shot they saw: 60%. Same finish jumps |
| Body | Holds ground while you dribble: you can't run through them. 1.7 ft minimum separation | 2.2 ft minimum separation; length fixed at 1.2 |

For comparison, the ball handler dribbles at up to 13.5 ft/s (15 ft/s when not dribbling, such as during gather steps or finishes).

## Calibration

With perfect input, a shooter makes about half of open threes and drops to the mid-teens under a heavy contest. The game balance holds as long as realized averages, not ceilings, stay near real basketball.

**Physics build** (simulated with `sim/noise.js` at 4,000 shots each, with the 30% perfect release bonus; no defenders' hands, so blocks are not included):

| Situation | Make chance |
| --- | --- |
| Open three (24 ft), perfect | 50.1% |
| Clean three, perfect | 59.1% |
| Open three, \~25 ms off | 45.1% |
| Three under full contest, perfect | 15.3%, with 3.8% airballs |
| Open 15 ft jumper, perfect | 60.1% |
| Open 15 ft straight fade, fadeaway 70, perfect | 47.9% |
| Floater, 10 ft, moving, open and perfect | 50.5% |
| Floater, 60 ms off | 37% |
| Floater under full contest | 25% |
| Layup at a full sprint, open | 80.8% |
| Uncontested dunk | 96% |

The floater under full contest was about 15% in the landing-point model. Floater contest scatter was not part of the calibration.

**With defenders' arms** (from `sim/measure.js`: the contest and the arm both come from one defender position at release, 4,000 shots each, perfect release). "In the air" means the defender jumped when they saw the shot, one reaction time in. These are the AI's arms, which reach toward the shooter.

| Situation | Made | Blocked |
| --- | --- | --- |
| Three, on-ball defender 4 ft away, hand up | 49% | 0% |
| Three, defender 3 ft away, hand up | 37% | 0% |
| Three, defender 2 ft away, hand up | 22% | 0% |
| Three, defender 3 ft away, in the air | 0% | 100% |
| Three, defender 2.5 ft away, in the air | 0% | 89% |
| Three, defender 3.5 ft away or further, or 2 ft or closer, in the air | 20–51% | 0% |
| 15 ft jumper, defender 3 ft away, hand up | 48% | 0% |
| Floater from 10 ft, rim protector 2.2 to 5 ft away, hand up | 31–51% | 0% |
| Floater from 10 ft, rim protector 4 ft away or closer, in the air | 0% | 100% |
| Layup, standing rim protector straight in front, or 40° to one side | 71–78% | 0% |
| Layup, rim protector 40° to one side at the peak of a jump: away / middle / into them | 44% / 31% / 30% | 35% / 45% / 45% |
| Layup, rim protector straight in front, in the air | 0% | 100% |

**A player's arm** (a 15 ft jumper with a perfect release against a defender who jumps; each cell is every jump timing from 400 ms before the release to the release itself):

| Defender | Cursor close to their body: straight up | Cursor on the shooter: reaching out | Cursor past the shooter: as far as the arm goes |
| --- | --- | --- | --- |
| 1.8 ft away | Blocked on 56%, tipped on 26% | Never blocked; tipped on 79% | A foul, every time |
| 2.2 ft | Blocked on 67%, tipped on 10% | Blocked on 41%, tipped on 35% | A foul, every time |
| 2.6 ft | Blocked on 47%, tipped on 8% | Blocked on 43%, tipped on 26% | Blocked on 29%, tipped on 39% |
| 3.0 ft | Blocked on 2%, tipped on 17% | Blocked on 44%, tipped on 11% | Blocked on 44%, tipped on 11% |
| 3.4 ft | Never touched | Never blocked; tipped on 17% | Never blocked; tipped on 17% |
| 3.6 ft or more | Never touched | Never touched | Never touched |

Only the last column fouls: from inside 2.2 ft a full reach puts the hand on the shooter's arms whether or not the defender jumps.

What this shows:

- **A block needs the defender inside about 3.2 ft, and a jump that left the floor between about 320 and 150 ms before the release.** Before the arm had a length, the same jumper was blocked from anywhere inside 3.5 ft over a 350 ms span of timings, and a jump at the right moment from 4 ft still got there.
- **Reaching out and reaching up are different tools.** Out gets a hand to shots from 3 to 3.4 ft that straight up cannot touch. Up is better inside 2.6 ft, where an arm reaching out ends up behind the ball.
- **The edges are tips, not a cliff.** Around the block timings, and at the far end of the reach, the hand only grazes the ball.
- **The timing is the contest.** A jumper takes 520 ms to its release, and can be called off only in the first 170 ms, while the legs load: that is the pump fake. A defender who goes on the first movement is up in time, and is beaten by the fake. One who waits to see the feet leave, 170 ms in, and then reacts in 200 ms has a hand up about 30 ms before a perfect release: an early release beats them, at a small cost in distance.
- **A hand held up no longer blocks a floater.** Reaching toward the shooter now puts it below the ball. It takes a jump.
- **A standing rim protector still barely costs a layup:** 71–78%, against 81% open. Their hand stays down on a finish unless they jump, and the contest scatter alone is small.
- **Against the AI, a block is all-or-nothing for a given position,** because the AI's jump follows a rule. The variation comes from a player's timing and reach, and from whether the AI was brought in close.

**In play** (the last section of `sim/measure.js`: whole shots played through the game, so the on-ball defender reads the shot, closes out and jumps on their own; 600 standing jumpers per row, each with a perfect release):

| Situation | Ball taken first | Made | Blocked | Defender jumped |
| --- | --- | --- | --- | --- |
| Default guarding distance (4.5 ft), from 20.8 ft | 0 | 29% | 0% | 0% |
| The same, from 26.4 ft | 0 | 28% | 0% | 0% |
| The same, with the ball pulled in tight first | 0 | 0% | 100% | 100% |
| Guarded tight (3 ft), ball dribbled out in front | All 600 | – | – | – |
| Guarded tight (3 ft), ball pulled in | 0 | 0% | 100% | 100% |
| Loose (7 ft) | 0 | 44% | 0% | 0% |

The AI is now a set of rules, and these are their edges.

- **From its cushion it never jumps,** because it is 3.8 ft away at the release and could not get there. It closes out with a hand up, which costs more than its old half-hearted jumps did: 29% made, against 39%.
- **Brought in close it always jumps, and always gets there.** Pulling the ball in reads as a pull-up and brings it to 1.9 ft. A jumper from there is blocked every time. The answer is the one a real defender forces: a fake first, since from that close it goes up for anything.
- **Dribbling the ball out in front of a defender 3 ft away loses it every time.** It is dribbled into their hand.
- **None of the 3,600 shots was fouled.** The AI keeps its hand off the shooter and stops short of them.

Before these rules the same defender jumped on half the shots it saw inside 5 ft and blocked 48% of the tight ones, by coin flip.

**The block rate also turned on 8 ms of timing.** Before the game had a fixed tick, it advanced once per frame, and at 60 frames a second the same shots were blocked about a quarter of the time (25% of 450 in the page). The defender stood in the same place. The only difference was that their jump began one frame after they saw the shot, where at 120 ticks a second it begins half as late. That 8 ms left the hand under half an inch higher as the ball went by: the ball passed 0.686 ft from the hand's center, where at 120 ticks it passes 0.712 ft away, and a touch is anything inside 0.69 ft. On a faster display the old loop would have given a different answer again.

**Landing-point model output at default settings** (the original resolver, computed from its formulas; jumpers include the 30% perfect release bonus). Kept for reference: the shooter rating and floater touch no longer exist, and their values at 80 and 75 became the universal floors.

| Situation | Rating 95 | Rating 80 | Rating 60 |
| --- | --- | --- | --- |
| Open three (24 ft), perfect | 58% | 50% | 40% |
| Open three, \~25 ms off | 54% | 45% | 35% |
| Three under heavy contest, perfect | 17% | 17% | 15% |
| Open 15 ft jumper, perfect | 73% | 61% | 48% |

| Situation | Make chance |
| --- | --- |
| Open 15 ft straight fade, shooter 80, fadeaway 70, perfect | \~49% |
| Layup, finishing 80 at full sprint, open | \~80% |
| Layup vs set rim protector, finishing away from them | \~48% |
| Layup vs set rim protector, finishing into them | \~33% |
| Uncontested dunk | 96% |
| Floater, touch 75, 10 ft, moving, open and perfect | \~50% |
| Floater, sloppy timing | low 30s |
| Floater under heavy contest | \~15% |

**Real-world anchors** (approximate, from memory, not sourced): league-average three \~36%, elite wide-open catch-and-shoot \~45%, floaters \~40–45%, restricted area \~65%. Open and wide-open threes differ by only a few points.

**First playtest** (defaults, one ball handler against two defenders, before fades were fixed): 21/64 overall (33%), 0.77 points per shot.

| Shot type | Made | Points per shot |
| --- | --- | --- |
| Threes | 7/21 | 1.00 |
| At the rim | 8/16 | 1.00 |
| Floaters | 4/11 | 0.73 |
| Midrange jumpers (derived) | 2/16 | 0.25 |

Midrange was mostly fadeaways, which landed a perfect release on the front rim before the fixed release line existed. Rim value is understated because free throws aren't awarded.

**Watch item:** if open threes run well above 1.5 points per shot while twos sit around 1.2, the shot diet will tilt toward 2K's.

**Since the first playtest:**

- **Midrange fades** now have a fixed release line, so a perfect fade no longer lands on the front rim.
- **Clean-look target: 60%** for an open, perfectly released three, for every frame.
- **The landing-point tables are rating-based.** Physics has replaced that resolver and the shooter rating; the physics table above carries the same targets, and the table with defenders' hands re-measures contested shots and layups against a rim protector.

## Constants reference

Values as of the current prototype. Distances in feet, rim offsets in inches, times in milliseconds.

| Constant | Value | Used for |
| --- | --- | --- |
| LOAD / RISE / IDEAL | 170 / 350 / 520 ms | The jump with the ball: legs loading, time up (and down), and the top of it, where a jumper is let go |
| KEEP / LEAN | 0.5 / 5 ft/s | Takeoff: share of the arriving speed carried into the air, and the most a lean adds |
| P\_STAND / P\_JUMP / STAND\_LIFT / RUN\_UP | 8.3 ft / 2.3 ft / 0.85 / 7 ft/s | The handler's reach standing, what a full jump adds, and how much of one a standing jump is |
| REACH / FORM\_R / FORM\_OUT / FORM\_Z | 2.2 / 3.2 / 0.7 / 7.65 ft | The ball in the air: at the cursor within the first; in a shooting form beyond the second, this far toward the cursor and this high before the jump |
| NEAR0 / NEAR1 | 4 / 8 ft | A shot is all finish inside the first and none beyond the second |
| DUNK\_Z / DUNK\_BALL | 10.15 / 0.9 ft | A dunk: the ball at least this high, and within this of the rim's center |
| UNDER\_LOW / UNDER\_HIGH | 2.0 / 1.35 ft | How far from the rim's center the hand keeps a ball 9 ft up or lower, and one 10 ft up |
| KEEP\_OUT | 1.0 ft | Nobody's center gets closer to the rim's than this |
| BUMP\_IN | 2 in | Scatter from a body met on the way up |
| CHARGE\_V / CHARGE\_SET / RESTRICTED | 2 ft/s / 1.5 ft/s / 4 ft | A charge: this fast into a defender moving slower than this, at least this far from the rim |
| KT | 0.09 in/ms | Jumper depth bias per ms of timing error |
| PERFECT\_MS | 12 ms | Jumper perfect window (±) |
| DEP\_RATIO | 1.16 / 1.45 / 1.2 | Depth scatter ÷ lateral: jumper / floater / layup (in `sim/noise.js`) |
| AIR\_LAND | 0.25 s | Recovery after coming down |
| DRIFT\_DEP | 1.0 in per ft/s | What the release makes up for speed along the shot line: it sets how far the release line moves |
| CONTEST\_SIG | 6.0 in | Jumper contest share in the live scatter breakdown. Outcomes use the calibrated CONTEST\_IN below |
| ENTRY / PAST | 60° / 2 in | A finish's angle down into the rim; how far past the rim's center finishes and quick releases are aimed (in `sim/launch.js`) |
| BODY\_R / ARM\_HIT / REACH\_V | 0.75 ft / 0.3 ft / 4 ft/s | Reach-in: a hand this close to the handler's center or off arm, moving into them this fast |
| ARM\_FOUL\_R / CONTACT\_R / FOUL\_V | 0.6 ft / 1.9 ft / 3.5 ft/s | Shooting fouls: a raised hand this close to the shooter; a defender this close and coming this fast |
| SET\_V / OVER\_V | 0.5 / 2 ft/s | Over the back: how slow counts as having the spot, and how fast into them is a foul |
| BITE\_R | 3.2 ft | The AI leaves its feet for a shot only from inside this |
| HAND\_V / REACH\_T / REACH\_CD / LEFT\_OPEN | 14 ft/s / 0.25 s / 2 s / 0.12–1.2 s | The AI's reach for the ball: hand speed, time out, wait before another, and how long the ball must have been left open |
| LAYUP\_RANGE / FLOATER\_RANGE | 7 / 14 ft | Context cutoffs on a drive |
| DRIVE\_SPEED | 4 ft/s | Minimum speed toward the rim to count as driving |
| FL\_IDEAL / FL\_PERFECT | 330 / 20 ms | The quick line after the press, and its perfect window |
| FL\_KT | 0.07 in/ms | Depth estimate per ms in the floater's last-shot readout. Outcomes use K\_SPEED below |
| FL\_CONTEST\_SIG | 5.0 in | Floater contest scatter |
| PSPEED / PACC | 15 ft/s / 70 ft/s² | Ball handler movement |
| DSPEED / DACC | 13 ft/s / 50 ft/s² | On-ball defender guarding |
| CLOSE\_SPEED / CLOSE\_ACC | 15.5 ft/s / 60 ft/s² | Closeouts |

The context cutoffs, drive speeds and RIM\_CONTEST\_SIG now live in `sim/situation.js`. Physics retired the make windows (WIN, FIN, FL\_A / FL\_B), the push-long biases (CONTEST\_BIAS, FL\_CONTEST\_BIAS) and the landing-point clean-look values (CLEAN\_PREMIUM, NEAR\_MISS\_CAP), and they have been removed from the prototype. KT and the drift values still set the fade release line and the last-shot readout, and are the targets the launch mapping was fitted to at 24 ft.

**Added since the first version:**

| Constant | Value | Used for |
| --- | --- | --- |
| STEP\_T / GATHER\_SPEED | 0.2 s / 6 ft/s | Gather step duration / speed that gives gather steps instead of a dead dribble |
| DRIB\_SPEED | 13.5 ft/s | Dribbling top speed |
| ACC0 / DECEL | 85 / 95 ft/s² | Acceleration from a stop (tapering 60% near top speed) / stopping and cutting |
| REACH\_MIN / REACH\_MAX | 0.7 / 2.4 ft | Closest and farthest a dribble lands from the body |
| Camera | 36 ft tall view, 7.5 ft lead, 60 ms smoothing | Follow camera |
| Defender lag | 0.12–0.4 s (about 0.25 s at defaults) | On-ball perception delay |
| TICK | 1/120 s | One step of the game |
| SHOT\_CLOCK / TARGET | 14 s / 21 | Game rules: time to get a shot off / points that win |
| CHECK / FT\_LINE | 25.75 ft / 13.75 ft from the rim | Where a possession starts / where free throws are shot |
| CATCH\_R / CATCH\_Z | 1.6 ft / 8.0 ft | A loose ball is caught inside this reach, below this height |
| DEAD\_T / FT\_GAP / GRACE / REST\_T | 1.5 / 0.9 / 1.0 / 1.5 s | Pause after a whistle / between free throws / no steals after a check / a ball left lying is whistled dead |

**Physics build** (in `sim/`):

| Constant | Value | Used for |
| --- | --- | --- |
| ELEV | 48° / 60° | Launch angle: set / quick. A finish's comes from ENTRY |
| REL\_Z | 9.6 / 9.2 / 9.6 ft | Release height when no hand position is given, as in calibration: set / quick / finish |
| REL\_FWD | 0.7 ft | Release point in front of the body |
| CONTEST\_ARC | 6° | Extra arc at full contest |
| K\_SPEED | 0.000158 per ms | Launch speed change per ms of timing error, fitted at 24 ft |
| F\_LAT / F\_DEP | 0.106 / 0.066 | Share of body velocity a ball would inherit, sideways / along the shot, fitted at 24 ft. The launch model can still do this; the game no longer asks it to |
| FLOOR\_IN / FLOATER\_FLOOR\_IN / LAYUP\_FLOOR\_IN | 3.93 / 4.6 / 2.48 in | Universal noise floors: jumper / floater / layup |
| MULT | 1.23 / 1.50 / 1.74 | Calibrated noise multipliers: jumper / floater / layup |
| CONTEST\_IN | 6.19 in | Jumper contest scatter at full contest (calibrated) |
| PREMIUM / CAP | 0.04 / 1.6 spreads | Clean-look noise cut / noise cap (calibrated) |
| TAIL\_IN / CONTEST\_TAIL\_IN | 12.5 / 1.6 in | Furthest noise alone can carry a shot from the rim's center / extra at full contest |
| DT / DT\_NEAR / DT\_FAR | 1 / 0.5 / 10 ms | Simulation step: normal / near the rim / nothing to hit |
| T\_MAX / NET\_DEPTH | 3.5 s / 0.6 ft | Longest flight / depth below the rim that confirms a make |
| Arms | 2.6 ft from shoulder to a 0.3 ft hand, 0.17 ft forearm; standing reach 8.2 ft (rim protector 8.9 ft); 2.2 ft jump; in the shot for 0.6 s | Block collisions. Placeholders until frames |
| Touches | Restitution 0.2, friction 0.3; a block changes the ball's velocity by 40% of its speed or more | A hand on the ball: block or tip |
| Rebounds | Caught within 1.6 ft, at 8 ft standing plus up to 2.2 ft of jump; 0.35 s before whoever touched a shot can catch it | Loose balls |

**Tuning sliders and defaults:** timing assist ±15 ms, perfect release bonus 30%, scatter in the air 2.0 in at 5 ft/s, aim assist 40%, release line shift 1.0×, layup speed limit 11.4 ft/s, on-ball defender and rim protector on, rim protector steps up 50% (when the handler is level with their defender), guarding distance 4.5 ft, the AI's read of you 260 ms, AI top speed 13 ft/s, AI reaches after 1.8 s and again after 3 s, AI sees a shot after 250 ms, defender's contest reach 1.0×. None is a rating: each is the mechanic in its own units, the same for every player.

**Display:** the shot meter sits beside the player, or beside the cursor if the player ticks "Shot meter follows the cursor". Beside the cursor, the meter's release line is level with the cursor, so the bar reaches the cursor's height at the moment to let go, and aim and timing can be read in one place. It moves to the cursor's left where there is no room on the right. The choice is the player's own: it is remembered by their browser, is not one of the host's settings online, and applies only to their own shots.

## Known gaps and roadmap

Full physics is built, the game runs outside the page, and there is a first set of rules. Two players can now play each other online, with rollback so neither waits on the other. Next is playing it across a real connection, then the block model and frames.

**Known gaps:**

- **Every body is the same.** There are no ratings, and frames are decided but not built, so nothing yet makes one player different from another.
- **Nobody has played the reworked shot.** Every number in it (reach, the lines, the finish range, the charge, the bump) is a first value, checked by tests and by scripted drives, and waiting for hands.
- **The ball cannot be taken out of a shooter's hand.** In the air it can only be met after it is let go, though a ball let go into a hand is met at once.
- **The AI contests with the hand it has,** going to the ball as far as its arm reaches. It does not anticipate, and it does not choose between taking a charge and going for the block.
- **Three ways of letting go are still mixed, not one.** Set, quick and finish each have their own touch and arc. Finish is weighted in by distance, continuously. Set or quick is settled at the jump, by whether it started on a drive from floater range, so that part is still a choice the game reads off the player and not something that follows from the release.
- **A dunk's carry is a straight line at a fixed speed,** not a simulated arm.
- **Free throws only exist under the game rules.** In the shot lab, fouls and and-ones are still only labeled.
- **The rules are a first pass:** bare rebounding, no rebound off the last free throw, and one person plays both sides (see The game).
- **Dribbling isn't final:** no between the legs, behind the back or spins yet.
- **The triple threat is only reached by starting a possession or catching a rebound.** Catching a pass will be the third way, once there is passing.
- **The rim protector's step-up choice is shown in the panel;** in the real game, reading its position should be the skill.
- **How often a player blocks a tight jumper is not known yet.** The arm now has a length, a block has a window of about 170 ms, and its edges are tips (see Calibration). Whether that lands near the frames target of about 1 in 12 tight contests depends on how people time their jumps, which only play will show.
- **A defender's jump after the release does nothing,** because a shot's flight is worked out at the release. For a jumper the ball is out of reach by then anyway; for a floater or a layup near the rim it may not be.
- **The live scatter breakdown bar still uses the landing-point component sizes,** including a distance share the physics no longer has. The scatter figure beside it comes from the noise model.

**Roadmap:**

1. **Full physics:** done. Standalone physics, calibration, then wiring into the game with a side-on feedback view.
2. **Frames:** height, wingspan and weight replace the rating sliders.
3. **Fouls and free throws:** a first version is in, under the game rules.
4. **Passing and teammates:** catch-and-shoot, live-ball triple threat, lobs, and the open-three problem.
5. **Rebounding:** misses are live balls on real caroms, and jumping, boxing out and the AI's reaction time are in. Size and strength wait for frames.
6. **Post play:** back-to-the-basket dribbling into the same pivot system.
7. **Human defense controls:** a first version is in for the on-ball defender (see Two players online). Passing-lane deflections wait for passing.

**Engineering:** the whole game now runs outside the page. Physics, launch, noise, the situation rules and the game itself are modules in `sim/`, tested in Node, and the page only handles input and drawing. The game is deterministic on one JavaScript engine. Across engines that is not guaranteed, because functions like `Math.sin` may differ in their last digits, which matters for how online play keeps two machines in step.

Prototype: [Shot model lab](https://claude.ai/artifact/DuHBqQzcuPA4ZuQT8VSBxf). Source: [`prototype/shot-model-lab.html`](../prototype/shot-model-lab.html)
