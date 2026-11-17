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
3. **Timing must be learnable.** Release timing can differ between shot types, but only when it follows from a choice the player made, is the same every time for that choice, and is shown on the meter.
4. **Every drift axis needs a control.** Lateral error is corrected with the cursor. Depth error can only be corrected through timing, so canned depth motion is compensated by a fixed release line, never left as a hidden bias.
5. **Decisions over dexterity.** Skill expression lives mainly in creating good shots: separation, finish choice, reading the defender.
6. **Expected value keeps the game basketball-shaped.** Points per shot by shot type is the primary tuning metric. If percentages are inflated for fun, inflate them proportionally.
7. **Feedback separates input from outcome.** Release quality is shown immediately (as in MLB The Show's perfect/perfect), so a miss after a perfect release reads as variance, not robbery.
8. **Frames, not ratings.** Height, wingspan and weight shape the mechanics; nobody has a hidden accuracy number. Bodies change outcomes only through physics and geometry.
9. **No move buttons.** Moves emerge from continuous body control (WASD) and ball control (cursor) meeting a defender who reacts with a delay. Gestures and right-stick style sequences are out; the gather button changes state, it doesn't trigger a move.
10. **Protect the feel of a clean look.** A perfect release on a truly open shot gets a capped premium, and its misses rim out rather than brick.

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
- **Blocks and fouls.** Fouls are rolled separately. Blocks on jumpers, floaters and layups are collisions between the ball and a defender's hand during the flight; only dunks still roll for a block.

A key property: when scatter is small (open, good shooter), input error matters a lot. When a contest dominates the scatter, input barely matters. So skill counts most on good shots, and nobody can time through a hand in the face.

## Input scheme and shot context

One context-sensitive shot button on mouse and keyboard: the distance and motion at the moment you click decide the shot type.

- **WASD** moves. **Cursor** aims, or picks the finish side near the rim.
- **Hold left mouse** to start a shot; **release** to let it go (jumpers, floaters) or to end the hang (layups).
- **Shift** held at the click means "attack the rim" (dunk attempt).
- **Away-from-rim input** at the start of a jumper commits a fade. Inputs are read relative to the shot line, not the screen.
- Right mouse is reserved as a possible explicit "touch shot" override if context picks the wrong shot too often in playtests.

"Driving" means velocity toward the rim of at least 4 ft/s. Rules are checked in this order:

| Order | Condition at the click | Shot |
| --- | --- | --- |
| 1 | Within 4 ft of the rim, any motion | Layup (Shift: dunk if eligible) |
| 2 | Driving, within 7 ft | Layup (Shift: dunk if eligible) |
| 3 | Driving, within 9 ft, Shift held | Dunk if eligible, else layup |
| 4 | Driving, 7–14 ft | Floater |
| 5 | Anything else | Jumper (fade if away-from-rim input) |

Dunk eligibility: within 9 ft, at least 7 ft/s toward the rim, dunk rating 55 or higher. When Shift is held but the dunk is not eligible, the shot is a layup and the UI says why.

Clicking early on a drive gives a floater; keeping the drive going and clicking late gives a layup. The timing of the click is the decision, so there is no separate floater button. A tag under the player always shows what a click would produce.

**Added since the first version:**

- **Space** gathers the ball (see Gather and pivoting).
- **Releasing before 150 ms** pump fakes instead of shooting (see Pump fakes).
- **The camera follows the ball handler,** so cursor positions are stable relative to the body (see Dribbling).
- **The aim line and crosshair** only show while the shot button is held.
- **A cursor parked on your own body** (within 0.5 ft) reads as a badly missed aim, not a perfect one. This closed an exploit where pulling up off a hang dribble skipped aiming.
- **Context while gathered:** out of gather steps, the shot always counts as driving and layups reach 9 ft. From a dead dribble, it's a set shot unless you're within 4 ft or your free foot is reaching toward the rim within 8 ft (a step-through finish).

## Jump shots

Timing sets depth, the cursor sets lateral aim, and carried momentum drifts the ball. Ratings, distance, movement and contest set the scatter.

**Timing (depth).** The ideal release is 520 ms after the press; auto-release at 820 ms. Timing error, after the assist deadzone, changes launch speed by 0.0158% per ms. That is 0.09 in of depth per ms at 24 ft and less closer in (0.056 at 15 ft). Early misses short, late misses long.

- Perfect window: ±12 ms. Timing assist (default ±15 ms) is a deadzone added on top, where error costs nothing.
- **Perfect release bonus** (default 30%): release quality q is 1 inside the perfect window and fades to 0 over the next 40 ms. It shrinks the shooter's own scatter by bonus × q. It never touches contest scatter.

**Aim (lateral).** Aim error is the signed angle between the shooter→cursor and shooter→rim lines, measured on the floor plane. Lateral bias = distance × tan(angle), so long shots need finer aim. Aim assist (default 40%) scales the whole lateral bias, including uncorrected drift.

**Drift.** The ball inherits part of the body's momentum at release: 10.6% of its sideways speed and 6.6% of its speed along the shot. At 24 ft that is 1.6 in of lateral push per ft/s and 1.0 in of depth per ft/s; at 15 ft, 1.25 and 0.78. Players aim against lateral drift. Once a jumper starts, momentum bleeds off (τ = 0.4 s) and mid-shot steering is disabled; fades are the only intentional mid-shot motion.

**Scatter (lateral, inches).**

| Component | Formula |
| --- | --- |
| Universal floor | 3.93 × (1 − bonus × q). The old rating term at 80, now the same for everyone |
| Distance | None. The physics already makes long shots harder |
| Movement | 0.14 × speed at the start of the shot (ft/s), combined with fade scatter |
| Contest | 6.17 × contest |

Depth scatter = 1.16 × lateral. The total is multiplied by 1.23 (calibration) and converted into launch noise: depth scatter becomes a spread on launch speed, lateral scatter a spread on direction. A contest also raises the arc by up to 6° at full strength, as the shooter goes over the hand.

**Zone.** Two versus three is judged from the takeoff spot, so fading across the line doesn't create a three.

**Clean looks.** Total scatter is multiplied by (1 − 0.04 × cleanness × release quality), and the noise on a clean perfect release is capped at 1.6 spreads so misses rim out. See Shot noise and clean looks.

## Fadeaways

A fade is a committed shot variant with a fixed motion and its own fixed release line, so its timing is learnable. It trades consistency for separation.

**Committing.** Away-from-rim input at the press, or within the first 150 ms of a jumper. Input with a back component (along the shot line < −0.3) counts. A meaningful side component (|lateral| ≥ 0.38) makes it a 45° side fade. Strafing alone (A or D) is a normal moving jumper, not a fade.

**Motion.** The fade ramps to 5 ft/s along its direction (τ = 0.15 s), giving about 2.5–2.8 ft of separation by release. Momentum already heading the fade's way folds into it, so backpedaling doesn't add a separate penalty.

**Release line.** The meter's target moves later by exactly the amount that offsets the fade's depth push:

```latex
\text{shift} = \frac{\text{DRIFT\_DEP} \times \text{drift strength} \times 5\ \text{ft/s} \times \text{back fraction}}{0.09\ \text{in/ms}}
```

| Fade | Back fraction | Release shift | Sideways push | Scatter cost |
| --- | --- | --- | --- | --- |
| Straight (S) | 1.0 | +56 ms | none | fade cost |
| Side (S+A / S+D) | 0.707 | +39 ms | \~5.7 in toward the fade side, before aim assist | 1.25 × fade cost |

Fade cost (lateral scatter, combined with movement) = 0.5 + 0.06 × (95 − fadeaway rating): about 2.0 in at 70 and 0.5 in at 95. The sideways push of a side fade is constant, so the cursor correction is constant and learnable.

**The trade-off emerges from timing.** The later release gives a closeout more time. A fade wins against a defender who is already close and loses against a late closeout. At 15 ft, an open perfect release goes about 60% standing versus about 48% on a straight fade at fadeaway 70. In one test from the same spot, the fade cut the contest from 21% to 6%.

## Jumper contests

A contest (0–1) is computed at the moment of release. It adds scatter and raises the arc; the timing window never changes.

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

## Finishing: layups and dunks

Near the rim, the cursor picks the finish side, holding the button is a timing duel with the shot blocker, and the contest acts mainly through blocks and fouls.

**Motion.** A finish is committed: the player steers toward the rim (at most 4 rad/s of turn), keeps at least 4 ft/s, and stops 2.6 ft from the rim. Rise time is 320 ms for a layup and 380 ms for a dunk.

**Finish side.** s ∈ \[−1, 1\] comes from the cursor's lateral offset at rim distance, divided by 1.2 ft. Finishing away from the defender shields the ball; finishing into them makes it worse.

**Hang.** Releasing the button before the rise ends releases at the rise. Holding past it hangs for up to 450 ms, at +0.9 in of scatter per 100 ms. Hang is measured from when the button actually came up.

**Layup scatter (lateral, inches).** Depth scatter = 1.2 × lateral. The total is multiplied by 1.40 (calibration) and converted into launch noise. A layup is launched at the rim's center; the finish side changes the contest and the scatter, not the target.

| Component | Formula |
| --- | --- |
| Universal floor | 2.48. The old finisher term at 80, now the same for everyone |
| Speed | 0.35 × max(0, speed at the start of the finish − control limit); limit = 9 + 0.08 × (finishing − 50) ft/s, 11.4 at 80 |
| Angle | 2.2 × max(0, −s × lateral momentum) + 0.8 × abs(s), where lateral momentum is clamp(sideways speed / 6). Plus 0.6 per ft of euro step |
| Hang | 0.9 per 100 ms |
| Contest | 3.5 × rim contest |

**Rim contest** = prox × inline × set × reach × side × length × 1.15, measured from the point 1.2 ft toward the rim where the ball goes up.

- prox = clamp((5.5 − d) / 4, 0, 1). inline = 0.35 + 0.65 × max(0, cos), so chase-down blocks are weaker.
- set = 1 − 0.35 × clamp(defender speed / 12): planted beats arriving late.
- reach = 0.45 standing, up to 1.0 at the peak of a jump, 0.3 for 0.45 s after landing.
- side = 1 − 0.4 × shielding, or 1 + 0.2 × finishing into them.

**Shot blockers' jumps.** At the start of a finish, each defender within 7 ft either stays down and vertical (25%) or jumps at reaction × 0.5 + 40 + U(0, 180) ms. A jump lasts 500 ms. Releasing on the rise meets a rising defender; hanging until they land beats them, at a control cost.

**Outcomes.**

- Layup blocks are collisions with a defender's hand (see Full physics). Dunk block = clamp(c × (0.6 − (dunk − 70)/100), 0, 0.9).
- Foul = c × (0.12 + 0.25 × clamp(defender speed / 10)). A fouled layup gets 1.15× its speed, angle and hang scatter. Labeled as and-one or two free throws. Under the game rules they are shot (see The game).
- Dunks have no meaningful scatter: block roll, then a 4% fumble, then a make ("posterized" above 0.5 contest).

## Floaters

The floater is the early release on a drive: a lenient timed shot whose arc clears a rim protector who stays home. Touch is the cost.

- **Timing:** ideal 330 ms, auto-release 560 ms, perfect window ±20 ms plus the timing assist. Timing error changes launch speed by the same 0.0158% per ms as a jumper: about 0.04 in of depth per ms at 10 ft. The perfect release bonus applies, with the same 40 ms fade.
- **Motion:** a one-step stop. Momentum decays fast (τ = 0.12 s) with no steering, so the release happens about where you clicked.
- **Aim:** cursor aim like a jumper, with aim assist. Carried momentum costs less: 0.6× lateral drift and 0.5× depth drift.
- **Contest:** jumper-style without the closing-speed factor, and with prox = clamp((4 − d) / 2.5, 0, 1)^1.5, so the arc clears anyone more than \~4 ft away. Contest scatter 5.0 × c, plus up to 6° of extra arc. Blocks are collisions with a defender's hand.
- **Scatter (lateral):** a universal floor of 4.6 in × (1 − bonus × q) (the old touch term at 75), movement 0.08 × ft/s, contest. No distance term. Depth = 1.45 × lateral, since soft high arcs miss short or long. The total is multiplied by 1.42 (calibration) and converted into launch noise.

**Rim protector's read.** On each drive, the first time the ball handler is inside 17 ft and driving, the rim protector decides once:

- **Stay home** (concedes the floater): stays near the rim, blending from its home spot 3.25 ft in front of the rim toward the drive line.
- **Step up** (concedes the lane): moves to a spot on the drive line at clamp(distance − 4.5, 6, 10) ft from the rim. Once the driver gets past that spot, it recovers at only 8 ft/s, which opens the layup.

The chance of stepping up is a slider (default 50%). The decision resets after every shot. The rim protector's current choice is shown in the panel, but in the real game reading its position should be the skill.

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
- **The off hand guards automatically.** With the defender within 6 ft, the free arm comes up between their reaching hand and the ball. A reach that has to go through it keeps only 40% of its steal chance. There's no input for this; it follows from where the ball and the defender are.
- **Held ball:** during gather steps and pivots, both hands are on the ball.

**How moves emerge.**

| Move | What produces it |
| --- | --- |
| Crossover | Cursor moves to the other side of the body; the ball follows on the next bounce |
| Hang dribble | Slow, with the cursor pulled in tight: the ball rides higher and slower |
| Hesi | Decelerating in range with the ball pulled in. A defender who respects the shot steps up; accelerating then catches them moving forward |
| Change of pace | Any sharp speed change; the defender's reaction delay does the rest |

**Turnovers.**

- **Crossing in front of a close defender:** if their hand is within 2.4 ft of where the ball crosses, steal chance up to 35%, scaled by exposure and steals versus handling.
- **Reach-ins:** an exposed bounce within 1.6 ft of the defender's hand carries a small steal chance, up to about 6% a bounce.

Status: much improved but not final. Between the legs and behind the back (from the path the cursor takes behind the body) and spins are not built yet.

## The on-ball defender

In the real game, the defender is a person: WASD moves them, and the mouse controls contests, steals and deflections in passing lanes. The prototype's AI stands in for that person, and its reaction delay plays the role of human reaction time. Moves are designed to beat a delay, not a dice roll.

**Perception.** The defender acts on the ball handler as they were one reaction time ago, projected forward by 0.8 of that time using the velocity they saw. A sudden change leaves them heading the wrong way until the delay catches up, and separation comes from that delay plus their acceleration limits. No move ever rolls dice to decide whether it worked.

```latex
\text{lag} = \mathrm{clamp}\big(0.32 - 0.0025\,(\text{quickness} - 40) + 0.0015\,(\text{handling} - 70),\ 0.12,\ 0.4\big)\ \text{s}
```

At the defaults, that's about 0.25 s.

**What they do with it.**

- **Cushion:** the guarding distance (default 4.5 ft), plus 0.12 ft per ft/s the handler is driving at them, shrinking toward 1.9 ft as the pull-up threat rises. Never more than 0.6 × the handler's distance to the rim.
- **Pull-up threat** = respect × range × slowness × (0.35 + 0.65 × how tight the ball is held). Respect came from the shooter rating and is fixed at 0.75 (its value at 80) now that the slider is gone; range is full within 27 ft and fades out by 32 ft. A poor shooter barely moves them.
- **Shading:** 0.8 ft toward the ball side they saw, so a crossover leaves them shaded the wrong way for one reaction time.
- **Dead dribble:** with no drive threat left, they crowd to 2 ft with a hand up.
- **Shots:** they react to the shooting motion they saw, real or fake, after the shot reaction time (default 250 ms): closing out, raising a hand, and, if close, sometimes leaving their feet (see Pump fakes).
- **Movement:** 13 ft/s top speed and 50 ft/s² acceleration at default quickness, each scaling with quickness.

Quickness, handling and shooting are placeholders in this model. Under frames (below), they come from the bodies involved.

## Gather and pivoting

The gather button (Space) is a state change, not a move: it turns a dribbled ball into a held one, which changes what WASD and the cursor mean. Inside each state, control stays continuous.

**Gathering on the move** (6 ft/s or faster) gives two gather steps of 0.2 s each.

- The ball-side foot steps first. Each foot's landing spot follows WASD until it plants, and a ghost circle shows where it will land, so you can steer it mid-step.
- Step length is speed × 0.2 s, between 1.2 and 3.0 ft. With nothing held, the first step continues your momentum.
- **Euro:** sideways movement off the first step's line during the second step, tracked continuously. It costs 0.6 in of finishing scatter per foot.
- **Jump stop:** nothing held on the second step plants both feet (0.8 ft) and kills the dribble.
- **Going up:** click any time, off either step. Out of gather steps, layups count up to 9 ft (7 ft normally), floaters to 14 ft, jumpers beyond. If you haven't gone up within 0.3 s of planting the second step, you stop with a dead dribble.

**Gathering while stopped** gives a dead dribble with feet planted.

- The cursor holds the ball 0.9 ft from the body, and the body turns to face it, so sweeping the ball around rotates you around the pivot foot. Front and reverse pivots come from the direction of the sweep.
- **Pivot foot:** the first foot you move is the free foot, the one on the ball's side, and the other becomes the pivot and locks.
- **Free foot:** WASD extends it up to 2.6 ft in that direction; letting go returns it to stance, 1.4 ft beside the pivot.
- **Travels are impossible by construction:** the pivot never lifts and there is never a third gather step.
- **Shots:** a set shot by default. With the free foot reaching toward the rim (more than 1.2 ft) within 8 ft, it's a step-through finish. Holding the away-from-rim key as you shoot gives a step-back fade.
- **Strips:** every 0.25 s, a ball held within 1.2 ft of the defender's hand can be stripped, up to 12%.

| Move | What produces it |
| --- | --- |
| Euro step / jump stop | Footfall directions during gather steps |
| Front or reverse pivot | Sweeping the ball around the body one way or the other |
| Step-through | Free foot reaching past the defender toward the rim, then going up |
| Rip through | Sweeping the ball low across the body |
| Jab step | Free foot extended toward the defender and brought back. Mostly matters against a live ball, which comes with passing |

**Dead versus live ball.** Gathering out of a dribble kills it. A live-ball triple threat, where you can still start a dribble, only comes from catching a pass, so jab steps mostly matter once passing exists.

**Simplification:** after a one-two stop, real rules make the first foot down the pivot. The prototype leaves the pivot unset until you move a foot.

Post moves are planned to use this same system from a back-to-the-basket stance: drop steps, up-and-unders and spins built from the free foot, ball position and pump fakes, with no post-specific moves.

## Pump fakes

A pump fake is a shot you abandon early: release the button before the commit point, 150 ms into the motion, and the ball comes back down. It isn't a gesture. It depends on how far into the shot you go.

- **What can be faked:** jumpers, floaters, and finishes started from a dead dribble (step-throughs). Layups and dunks on the move can't be faked, since momentum is already carrying you up.
- **After a fake, your dribble is dead,** because rising into a shot picks up the ball. If you were already pivoting, you keep the same pivot foot.
- **Defenders react to the motion they saw,** real or fake, one shot reaction time later. On first seeing a shot, an on-ball defender within 5 ft leaves their feet half the time; the rim protector within 7 ft, 60% of the time. The jump lasts 0.5 s.
- **The payoff window:** in the air, a defender drifts and can't close out. For 0.45 s after landing, they can only get about 30% of a hand up on a jumper or floater. Shooting into that window, or stepping through, is the reward; shooting while they're still in the air runs into the full contest.

In a test of six fakes from a dead dribble, the defender jumped on three. The 50% and 60% bite chances are placeholders for a defender discipline trait, or simply a human defender's judgment.

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

The panel shows "clean look" on the contest line when the premium applies. Floaters don't get the premium yet.

## Frames instead of ratings

Players are defined by their bodies, not by ratings. Height, wingspan and weight shape the mechanics, and the user's skill decides what to do with them. Players differ in what they can get away with, never in hidden accuracy. This is decided but not yet built. The prototype has dropped the shooter rating and floater touch sliders; the other rating sliders remain.

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
| Dunk eligibility | Reach, vertical | Can get the ball 6 in above the rim: reach + vertical (+4 in running) at least 126 in. Replaces the dunk rating gate |
| Contest hand | Reach, vertical | Hand up at reach − 4 in; a contest jump adds 0.75 × vertical. Replaces the 8.2 ft and 2.2 ft placeholders |
| Dribble height and rhythm | Height | Bounce height ≈ waist (0.38 × H); rhythm scales with the square root of that. Lower and quicker is harder to reach |
| Dribble reach | Wingspan | Arm reach ≈ 0.39 × W (anchor 2.6 ft) |
| Speed and acceleration | Height, weight over lean | Top speed and acceleration drop a little per inch of height and per pound over lean; stopping and cutting likewise |
| Contact | Weight | Overlap splits by mass instead of the fixed rule that the defender holds ground |
| Steal and block reach | Wingspan, reach | The defender's hand reach comes from the arms, not a steals slider |

Two things stay universal on purpose: the shot noise floor (no accuracy by body) and the AI defender's reaction lag. Reaction time belongs to the person; in the real game a human is defending.

### Sliders that go away

| Slider today | Replaced by |
| --- | --- |
| Ball handling | Dribble height, rhythm and reach |
| Finishing | Release reach and extension. The finishing floor is already universal; the slider now only sets the speed control limit |
| Dunk | Dunk eligibility from reach and vertical; poster duels from reach and mass |
| Fadeaway | A universal fade cost. Height still matters because taller frames release higher |
| On-ball quickness | The defender's speed and acceleration from their frame |
| On-ball steals | Hand reach from wingspan |
| On-ball length | Wingspan |

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
2. **Shooting from frames:** release time and height, contest hands and jumps, blocks. Retire the fadeaway and length sliders.
3. **Movement and dribbling from frames:** speed and acceleration, dribble height, rhythm and reach, contact by mass. Retire handling, quickness and steals.
4. **Finishing and dunks from frames:** release reach and extension, dunk eligibility, poster duels. Retire finishing and dunk.
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
- **Calibration:** jumper noise 1.23× the old values, floaters 1.42×, layups 1.40×; contest scatter 6.17 in; clean looks 4% less noise, capped at 1.6 spreads. Results: open perfect three 50.1%, clean 59.1% (100% of misses near the rim, no airballs), 15 ft 60.1%, 25 ms off 45.1%, heavy contest 15.3%, open 15 ft fade 47.9%, floater 50.5%, open layup at a sprint 80.8%.
- **Live readouts:** 14 simulated shots per refresh with a running average, instead of precomputed tables. The paired estimates share their random draws, so their difference shows only aim and momentum.
- **Blocks and goaltending:** hands are real collision spheres (0.3 ft), at a standing reach of 8.2 ft (8.9 ft for the rim protector) plus a 2.2 ft jump, all placeholders until frames. Blocks turned out to be all-or-nothing for a given defender position: see Calibration, where standing jumpers against the default on-ball defender go from never blocked to blocked on every jump with a small change in distance or timing.
- **Bank shots:** the cursor on the backboard beside the rim targets the glass, and a marker turns green where a bank can go in from your spot. From about 45° the working band is narrow and right beside the rim; from 63–65° it's over a foot wide; straight on, none.
- **Ratings retired for shooting:** the shooter rating and floater touch sliders are gone; a universal floor replaces them.

**Airballs come from mistakes.** Heavy contests first airballed 15% of the time: their large spread sent the noise's outer tail clean past the rim. Now noise alone can carry a shot at most 12.5 in from the rim's center (a hard clank off the edge, never past it), plus 1.6 in at full contest, so a heavily altered shot airballs about 4% of the time. Bad timing, aim or drift are biases, not noise, so they can still airball any shot. A cap measured in spreads didn't work: it piles outliers onto its boundary, so airballs jump from about 17% to zero depending on whether that boundary falls inside the rim's reach. The calibration results above include this cap.

Open items: how layups choose glass versus rim from the finish side is still open; dunks don't fly yet.

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
| Backboard | Front face at y = 4.0 ft (rim center 15 in from it). 6 ft wide (x 22–28) by 3.5 ft tall (z 9.5–13.0) |
| Ball | Radius 4.7 in (0.39 ft). Mass 22 oz |
| Gravity | 32.17 ft/s² |
| Rim bounce | Restitution 0.6, friction 0.3 (starting values) |
| Backboard bounce | Restitution 0.75, friction 0.2 (starting values) |
| Floor bounce | Restitution 0.75, friction 0.1 (starting values) |
| Air drag, spin lift | Off at first; added only if trajectories look wrong |

The rim is modeled as a torus: a ring of radius 9 in made of a tube of radius 0.31 in. The net and the rim's mounting hardware are not modeled as solid at first.

### Launch model

At release, the player's inputs and situation become a launch: release point, direction, angle and speed. Noise is then added in launch space.

**Release point.** From the frame and shot type: 9.6 ft high for jumpers and layups and 8.7 ft for floaters, placed 0.7 ft in front of the body toward the rim. Placeholder values until frames define them.

**Target.** The rim center by default. With the cursor on the backboard, a point on the glass (see Bank shots).

**Arc (launch angle).** From the shot type: 48° for jumpers, 60° for floaters, 58° for layups. A contest raises the arc by up to 6° at full strength, as the shooter goes over the hand. Dunks have no flight: the ball is placed through the rim unless blocked.

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
- **Backboard contact:** a plane at the board's front face, bounded by its width and height. Same response with the board's values. Edge hits are ignored at first.
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

**Blocks.** Each defender's hand becomes a sphere (0.3 ft in the prototype) at their reach height: standing reach plus their current jump height, out in the direction they're contesting. It's checked against the ball at every simulation step. Any touch that isn't goaltending is a block: the ball comes off the hand with most of its pace gone and heads down. This replaces the block probability rolls for everything except dunks.

**Goaltending.** Touching the ball on its way down, above rim height and within 1.6 ft of the rim's center, counts as a make.

**Bank shots.** In the top-down view the backboard is a line behind the rim, from x = 22 to 28. With the cursor on that line away from the rim, on a jumper or floater, the target becomes a point on the glass, at the height that would send the ball in from the shooter's angle; the physics decides the rest. From the wing, a bank naturally beats a direct shot; straight on, it doesn't, because the glass already rescues long straight-on misses. No bonus is written in. Layups don't use this yet: they always go at the rim's center (see the open items above). While aiming at the glass, the target spot is shown on the board.

**Feedback view.** A side-on replay of each shot replaces the top-down landing chart: the arc from release to the rim, the rim and board drawn to scale, and markers where the ball touched. The court view keeps animating the ball from above.

### Structure, tests and milestones

This is the point where the prototype becomes a real project. The physics is built and tested on its own before it touches the game.

**Modules:**

- **Physics** (`sim/physics.js`): pure and deterministic. Steps the ball, resolves contacts, and simulates a whole shot from a launch into a path, a contact log and an outcome.
- **Situation** (`sim/situation.js`): the rules that read the floor. What a click would produce, the jumper, floater and rim contests, clean looks, finishing scatter, and where the defenders' hands are during the flight.
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
- A hand in the ball's path on the way up blocks it; a hand that stays low doesn't.
- A touch on the way down over the rim is goaltending, and counts.
- Before calibration, inputs at 24 ft land within 10% of where today's model puts them. Closer in, aim still matches, and timing and drift errors shrink.
- The situation rules behave as this doc describes them: the context table, each contest factor, clean looks, finishing scatter, and the reach and jump timing of defenders' hands.
- The game is deterministic and plain data: the same seed and inputs give the same game, a copy made mid-shot or sent as JSON carries on identically, and previewing the odds changes nothing.
- Scripted input plays out as designed, with no browser: a 517 ms hold is a perfect jumper, a release inside 150 ms is a pump fake, a drive gives a floater, layup or dunk by distance and Shift, a gather gives two steps and then a dead dribble, and the defender closes out or jumps on a shot they see.
- The rules hold: a check ball to start, scores and changes of possession, defensive and offensive rebounds, the shot clock, out of bounds, steals, live balls off a missed dunk, and-ones and two-shot fouls at the line, and a game that ends at 21. With the rules off none of it applies.
- Two players: the side without the ball moves, contests, jumps and takes the ball with their own input. Over a link with lag, jitter and lost packets, a player's own input lands after the same 25 ms, neither side waits, and both end with exactly the game a single machine would have played from the same inputs. Each correction reports how far it moved each player, and with that taken off nobody moves more than a stride in a tick. Past 250 ms each way both wait and still agree. A side whose clock is ahead slows until the two match, and a copy that drifts is replaced by the host's.

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
- How exactly do layups choose glass versus rim from the finish side?
- How tolerant should make detection be where the net catches the ball?

## The game: possessions and rules

With the rules on, the prototype is a game: two sides take turns with the ball against the same defense, first to 21. With them off it is the shot lab as before, where the ball comes straight back after every shot. The rules live in `sim/game.js` beside everything else and are covered by `sim/tests-rules.js`.

**Sides and turns.** Home and Away alternate on every change of possession, including after a score. Until a second player can defend, one person plays offense for both sides and the AI defends both.

| Rule | How it works |
| --- | --- |
| Check ball | Every possession starts at the top of the key, 25.75 ft out and behind the arc, with the defender at their guarding distance and the rim protector home. The ball can't be taken for the first second |
| Shot clock | 14 s. It runs while the handler has the ball, including the shooting motion, and stops once the shot is in the air. Running out gives the ball away |
| Scoring | Twos and threes as before, one for a free throw. First to 21 wins |
| Loose ball | A miss or a block is a live ball. It keeps flying and bouncing as the physics says, and goes to whoever first gets within 1.6 ft of it while it is below 8 ft |
| Offensive rebound | The handler gets it: play on with a fresh clock |
| Defensive rebound | A defender gets it: the other side's ball |
| Out of bounds | Against the side that touched it last: the shooter, or the defense after a block. A ball left lying for 1.5 s is whistled dead the same way |
| Steals and strips | End the possession at once |
| Fouls | A fouled finish that goes in is an and-one: one free throw. One that misses is two |
| Free throws | An ordinary jumper from the line, 13.75 ft out, with the defenders more than 8 ft away, so each is a clean look. Nobody moves. After the last one the other side takes the ball |
| Dunks | A dunk that is blocked or rattles out comes off the front of the rim as a live ball |
| Whistles | Play stops for 1.5 s, then the next thing happens |

**Chasing the ball.** Without the ball the handler runs at 15 ft/s, against 13.5 ft/s dribbling. The defenders go straight to the spot where the ball can first be caught. Bodies meeting over a loose ball split the bump evenly. The ball is drawn with its height while it is loose, so you can see when it is coming down.

**Nothing new to press.** Rebounding is running to the ball, and a free throw is the same hold and release as any jumper. That keeps to the principle of no move buttons.

**First guesses, to revisit:**

- **Rebounding is bare.** There is no jumping for the ball, no boxing out, and the defenders react to a miss instantly, so the rim protector takes most of them.
- **The last free throw is never rebounded.** The other side simply takes the ball.
- **14 seconds and 21 points** are starting values, as is the one-second grace after a check.
- **Steals are still dice rolls,** and now they cost the possession.
- **Every possession starts from the same spot,** so the first few seconds can become routine.

## Two players online

Two people can now play each other: each plays their own side, and whoever doesn't have the ball controls the on-ball defender. It is bare bones, built to find out how defending feels. The rim protector is still the AI for both.

**Defending.** The same keys as on offense, so there is still nothing new to learn and no move buttons.

| Input | On defense |
| --- | --- |
| WASD | Moves the defender: 14 ft/s, a little quicker than a dribbler's 13.5 |
| Cursor | The hand. How far it is from the body is how far the arm is out. Pointed at the ball handler it is a hand up, which is what the contest formulas read |
| Cursor on the ball | Takes it, if the hand gets within 0.55 ft of a ball that is being dribbled or held and the handler's off arm is not in the way. Not during the first second after a check |
| Space | Jumps. No steering in the air, and the usual recovery on landing |

Two things this changes. **Steals are no longer dice:** the AI's reach-in, poke and strip rolls are off when a player defends, and the ball has to be reached. From in front, across the handler's body, it can't be; from the ball's side it can. **Blocks are the defender's timing:** the jump is theirs to choose, so the knife-edge found in Calibration is now a matter of skill, not of when an AI happens to leave its feet.

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
- **A public address lookup** (Google's STUN) tells each browser its own outside address.

If the introduction service can't be reached, the panel says so and opens the old way of connecting, which needs no service: the players carry the two messages themselves, as codes of about 830 characters, the host's first and then the guest's back. `?broker=wss://…/` on the page's address points it at a different introduction service that speaks the same protocol, such as one you run yourself.

**Trying a bad connection.** Once a game starts, the panel shows the round trip it measures and how far ahead it is guessing. Adding `?lag=80&jitter=20&loss=5` to the page's address holds everything that page sends for 80 to 100 ms and drops 5% of its input packets; put it on both pages for both directions. `?delay=40` on the host's page sets the input delay, in ms, for both players. `node tools/online.js` does the whole thing between two headless browsers and checks they agreed; with `--link` they connect by invite link, with the introduction service played by the script, and with `--broker wss://0.peerjs.com/` through the real one.

**Measured** between two headless browsers on one machine, both players moving, pointing and shooting throughout:

| Link each way | Input packets lost | Waited | Resyncs | Keeping in step, per frame |
| --- | --- | --- | --- | --- |
| 60–80 ms | 5% | Never | 0 | 0.2 ms median, 5 ms worst |
| 150–210 ms | 15% | One side, 0.2 s in 12 s | 0 | 0.2 ms median, 7 ms worst |

The worst frames are the ones that replay a shot's release, which simulates the ball's whole flight.

**Limits, for now:**

- **The introduction service is somebody else's free service.** It can be down, slow or limited, and there is no promise it stays up. It is also stricter than the server code PeerJS publishes: it hangs up on any sender whose message is not shaped like the library's own, which is why the first version of the link failed with "Lost touch with the invite service" the moment a guest joined. The page now sends what it expects, the link has been checked against the real service, and the stand-in used by `tools/online.js --link` is as strict.
- **Some networks won't connect.** With no relay server, two players behind strict firewalls can't reach each other. The guest is told so after 20 seconds.
- **A code is the only key.** Anyone who has the link can take the one open seat. Once a game has started the code is dead.
- **Not yet played across the internet, or between two different browsers.** Everything above is two copies of Chromium on one machine with the lag faked. Two different browsers may drift and lean on resyncs.
- **Sliding only covers where players are.** A jump or a shot that the other player started a moment ago still appears already under way, and a ball leaving a sliding player's hands steps to its true path.
- **A shot can change after release.** If the defender's real hand was somewhere other than guessed when you let go, the flight is worked out again. It settles within the lag, long before the ball arrives.
- **Packets are plain text,** about 200 characters each at 60 a second. Fine for two players; a binary format would be a tenth of that.
- **No rematch and no tuning online.** The host's settings are used; when a game ends, leave and host again.
- **The numbers are first guesses:** the 25 ms and 250 ms above, the 100 ms slide, the defender's speed, the reach that takes the ball, and the off arm stopping a reach outright.

## Prototype defense AI

The defenders exist to exercise the model, not as a design for game AI; in the real game the on-ball defender is a person. The on-ball defender's perception model is described above (The on-ball defender).

|  | On-ball defender | Rim protector |
| --- | --- | --- |
| Default position | Between ball and rim at the cushion from the perception model (guarding distance default 4.5 ft), shaded 0.8 ft toward the ball side they saw | Home 3.25 ft in front of the rim; inside 16 ft, blends 60% toward a point min(4.5, 0.45 × distance) ft out on the drive line |
| Speed | 13 ft/s, accel 50 ft/s², both scaling with quickness | 11 ft/s (12 when contesting a finish), accel 40 ft/s² |
| On a shot | Reacts to the shooting motion they saw, real or fake, after the shot reaction time (default 250 ms): closes out to 1.8 ft in front at 15.5 ft/s | Finishes: blends 75% toward a point min(3, 0.6 × distance) ft out. Stay-home / step-up read on drives (see Floaters) |
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

**With defenders' hands** (from `sim/measure.js`: the contest and the hands both come from one defender position at release, 4,000 shots each, perfect release). "In the air" means the defender jumped when they saw the shot, one reaction time in.

| Situation | Made | Blocked |
| --- | --- | --- |
| Three, on-ball defender 4 ft away, hand up | 49% | 0% |
| Three, defender 3 ft away, hand up | 37% | 0% |
| Three, defender 2 ft away, hand up | 22% | 0% |
| Three, defender 2.5 to 3.5 ft away, in the air | 0% | 100% |
| Three, defender 2 ft away or closer, in the air | 20–22% | 0% |
| 15 ft jumper, defender 3 ft away, hand up | 48% | 0% |
| Floater from 10 ft, rim protector 3.5 ft away, hand up | 50% | 0% |
| Floater from 10 ft, rim protector 3 ft away or closer, hand up | 0% | 100% |
| Layup, standing rim protector 40° to one side: away / middle / into them | 78% / 76% / 72% | 0% |
| Layup, that rim protector at the peak of a jump: away / middle / into them | 63% / 57% / 56% | 4–7% |
| Layup, rim protector straight in front, in the air | 0% | 100% |

What this shows:

- **Blocks are all-or-nothing.** Launch noise barely moves the ball in its first few feet, so a hand is either in the path or it isn't: a given defender position blocks every shot or none. Block rates only come from the mix of positions and jumps a defender ends up in.
- **A raised hand inside 3 ft blocks every floater.** The floater leaves at 8.7 ft and the rim protector's standing reach is 8.9 ft.
- **A standing rim protector barely costs a layup:** 72–78%, against 81% open. The landing-point model had about 48% finishing away and 33% into them. Their hand stays down on a finish unless they jump, and the contest scatter alone is small.

**In play** (the last section of `sim/measure.js`: whole shots played through the game, so the on-ball defender reads the shot, closes out and jumps on their own; 600 standing jumpers per row, each with a perfect release):

| Guarding distance | Made | Blocked | Defender jumped |
| --- | --- | --- | --- |
| Default (4.5 ft), from 20.8 ft | 39% | 0% | 48% |
| Default, from 26.4 ft | 39% | 0% | 51% |
| Tight (3 ft) | 13% | 48% | 48% |
| Loose (7 ft) | 44% | 0% | 0% |

The defender leaves their feet half the time when they start within 5 ft. At the default distance they are 3.8 ft away at the release and the ball clears their hand every time. Guarded a little tighter, every jump is a block. `tools/ingame.js` plays the same shots in the page and agrees: 0 blocked in 300.

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
| IDEAL / MAX | 520 / 820 ms | Jumper perfect release / auto-release |
| KT | 0.09 in/ms | Jumper depth bias per ms of timing error |
| PERFECT\_MS | 12 ms | Jumper perfect window (±) |
| DEP\_RATIO | 1.16 / 1.45 / 1.2 | Depth scatter ÷ lateral: jumper / floater / layup (in `sim/noise.js`) |
| TAU | 0.40 s | Momentum bleed once a jumper starts |
| DRIFT\_LAT / DRIFT\_DEP | 1.6 / 1.0 in per ft/s | Drift bias from carried momentum |
| CONTEST\_SIG | 6.0 in | Jumper contest share in the live scatter breakdown. Outcomes use the calibrated CONTEST\_IN below |
| FADE\_SPEED / FADE\_COMMIT | 5 ft/s / 150 ms | Canned fade speed / commit window |
| RISE\_LAYUP / RISE\_DUNK / MAX\_HANG | 320 / 380 / 450 ms | Finish rise times / maximum hang |
| RIM\_CONTEST\_SIG | 3.5 in | Layup contest scatter |
| DUNK\_FUMBLE | 4% | Dunk miss chance when not blocked |
| LAYUP\_RANGE / DUNK\_RANGE / FLOATER\_RANGE | 7 / 9 / 14 ft | Context cutoffs on a drive |
| DRIVE\_SPEED / DUNK\_SPEED | 4 / 7 ft/s | Minimum speed toward the rim to count as driving / to dunk |
| FL\_IDEAL / FL\_MAX / FL\_PERFECT | 330 / 560 / 20 ms | Floater timing |
| FL\_KT | 0.07 in/ms | Depth estimate per ms in the floater's last-shot readout. Outcomes use K\_SPEED below |
| FL\_CONTEST\_SIG | 5.0 in | Floater contest scatter |
| PSPEED / PACC | 15 ft/s / 70 ft/s² | Ball handler movement |
| DSPEED / DACC | 13 ft/s / 50 ft/s² | On-ball defender guarding |
| CLOSE\_SPEED / CLOSE\_ACC | 15.5 ft/s / 60 ft/s² | Closeouts |

The context cutoffs, drive speeds and RIM\_CONTEST\_SIG now live in `sim/situation.js`. Physics retired the make windows (WIN, FIN, FL\_A / FL\_B), the push-long biases (CONTEST\_BIAS, FL\_CONTEST\_BIAS) and the landing-point clean-look values (CLEAN\_PREMIUM, NEAR\_MISS\_CAP), and they have been removed from the prototype. KT and the drift values still set the fade release line and the last-shot readout, and are the targets the launch mapping was fitted to at 24 ft.

**Added since the first version:**

| Constant | Value | Used for |
| --- | --- | --- |
| COMMIT\_MS | 150 ms | Release before this and the shot is a pump fake |
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
| ELEV | 48° / 60° / 58° | Launch angle: jumper / floater / layup |
| REL\_Z | 9.6 / 8.7 / 9.6 ft | Release height: jumper / floater / layup |
| REL\_FWD | 0.7 ft | Release point in front of the body |
| CONTEST\_ARC | 6° | Extra arc at full contest |
| K\_SPEED | 0.000158 per ms | Launch speed change per ms of timing error, fitted at 24 ft |
| F\_LAT / F\_DEP | 0.106 / 0.066 | Share of body velocity the ball inherits, sideways / along the shot, fitted at 24 ft |
| FLOOR\_IN / FLOATER\_FLOOR\_IN / LAYUP\_FLOOR\_IN | 3.93 / 4.6 / 2.48 in | Universal noise floors: jumper / floater / layup |
| MULT | 1.23 / 1.42 / 1.40 | Calibrated noise multipliers: jumper / floater / layup |
| CONTEST\_IN | 6.17 in | Jumper contest scatter at full contest (calibrated) |
| PREMIUM / CAP | 0.04 / 1.6 spreads | Clean-look noise cut / noise cap (calibrated) |
| TAIL\_IN / CONTEST\_TAIL\_IN | 12.5 / 1.6 in | Furthest noise alone can carry a shot from the rim's center / extra at full contest |
| DT / DT\_NEAR / DT\_FAR | 1 / 0.5 / 10 ms | Simulation step: normal / near the rim / nothing to hit |
| T\_MAX / NET\_DEPTH | 3.5 s / 0.6 ft | Longest flight / depth below the rim that confirms a make |
| Hands | 0.3 ft sphere; reach 8.2 ft (rim protector 8.9 ft); 2.2 ft jump | Block collisions. Placeholders until frames |

**Tuning sliders and defaults:** fadeaway rating 70, timing assist ±15 ms, perfect release bonus 30%, aim assist 40%, drift strength 1.0×, ball handling 80, finishing 80, dunk 75, on-ball defender and rim protector on, rim protector steps up 50%, guarding distance 4.5 ft, on-ball quickness 70, on-ball steals 60, shot reaction time 250 ms, on-ball length 1.0×. The rating sliders are placeholders until frames replace them. The shooter rating and floater touch sliders are gone.

**Display:** the shot meter sits beside the player, or beside the cursor if the player ticks "Shot meter follows the cursor". Beside the cursor, the meter's release line is level with the cursor, so the bar reaches the cursor's height at the moment to let go, and aim and timing can be read in one place. It moves to the cursor's left where there is no room on the right. The choice is the player's own: it is remembered by their browser, is not one of the host's settings online, and applies only to their own shots.

## Known gaps and roadmap

Full physics is built, the game runs outside the page, and there is a first set of rules. Two players can now play each other online, with rollback so neither waits on the other. Next is playing it across a real connection, then the block model and frames.

**Known gaps:**

- **Ratings still drive everything except shooting accuracy;** frames are decided but not built.
- **Dunks don't fly:** they keep the old block and fumble rolls. Layups always go at the rim's center; choosing glass versus rim from the finish side is still open.
- **Free throws only exist under the game rules.** In the shot lab, fouls and and-ones are still only labeled.
- **The rules are a first pass:** bare rebounding, no rebound off the last free throw, and one person plays both sides (see The game).
- **Forward momentum on pull-up jumpers** is still a depth bias with no clean correction, which conflicts with principle 4.
- **Dribbling isn't final:** no between the legs, behind the back or spins yet.
- **Live-ball triple threat and jab steps** need passing.
- **The rim protector's step-up choice is shown in the panel;** in the real game, reading its position should be the skill.
- **Floaters don't get the clean-look premium yet.**
- **Blocks are all-or-nothing for a given defender position, and turn on a few milliseconds of jump timing** (see Calibration). The frames target of about 1 in 12 tight contests can only come from the mix of positions and jumps, unless something adds variation to where the hand or the release point is.
- **A standing rim protector barely costs a layup,** and a raised hand inside 3 ft blocks every floater (see Calibration).
- **The live scatter breakdown bar still uses the landing-point component sizes,** including a distance share the physics no longer has. The scatter figure beside it comes from the noise model.

**Roadmap:**

1. **Full physics:** done. Standalone physics, calibration, then wiring into the game with a side-on feedback view.
2. **Frames:** height, wingspan and weight replace the rating sliders.
3. **Fouls and free throws:** a first version is in, under the game rules.
4. **Passing and teammates:** catch-and-shoot, live-ball triple threat, lobs, and the open-three problem.
5. **Rebounding:** a first version is in: misses are live balls on real caroms. Jumping, boxing out and reaction time are still to come.
6. **Post play:** back-to-the-basket dribbling into the same pivot system.
7. **Human defense controls:** a first version is in for the on-ball defender (see Two players online). Passing-lane deflections wait for passing.

**Engineering:** the whole game now runs outside the page. Physics, launch, noise, the situation rules and the game itself are modules in `sim/`, tested in Node, and the page only handles input and drawing. The game is deterministic on one JavaScript engine. Across engines that is not guaranteed, because functions like `Math.sin` may differ in their last digits, which matters for how online play keeps two machines in step.

Prototype: [Shot model lab](https://claude.ai/artifact/DuHBqQzcuPA4ZuQT8VSBxf). Source: [`prototype/shot-model-lab.html`](../prototype/shot-model-lab.html)
