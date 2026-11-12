# Shot model design: 2K-style basketball

Updated Nov 11, 2026 · @Jackson Schroeder

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

Every shot type resolves the same way: a 2D landing point at the rim, sampled from a Gaussian, tested against an elliptical make window.

```latex
\text{landing} = \text{bias} + \mathcal{N}(0, \sigma), \qquad \text{make} \iff \left(\frac{\text{lat}}{A}\right)^2 + \left(\frac{\text{dep}}{B}\right)^2 \le 1
```

- **Axes.** Lateral is left/right from the shooter's view. Depth is short/long along the shot line. Units are inches at the rim.
- **Bias** is the player's input error plus deterministic pushes: aim error, timing error, carried momentum, contest push.
- **Scatter** components add in quadrature, so the largest one dominates. Depth scatter is the lateral value times a per-shot ratio.

```latex
\sigma_{lat} = \sqrt{\sigma_{rating}^2 + \sigma_{distance}^2 + \sigma_{movement}^2 + \sigma_{contest}^2}, \qquad \sigma_{dep} = k \cdot \sigma_{lat}
```

- **Make window** (A, B) differs by shot type: softer shots get bigger windows. A layup from a 25–65° bank angle gets 1.2× its window.
- **Displayed make chance** comes from a fixed set of 3,000 Monte Carlo samples evaluated at the exact bias and scatter, so readouts don't flicker. The actual shot uses a fresh random draw.
- **Blocks and fouls** are rolled separately before or beside the landing sample. A block skips the landing entirely.

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

**Timing (depth).** The ideal release is 520 ms after the press; auto-release at 820 ms. Depth bias is 0.09 in per ms of timing error, after the assist deadzone. Early misses short, late misses long.

- Perfect window: ±12 ms. Timing assist (default ±15 ms) is a deadzone added on top, where error costs nothing.
- **Perfect release bonus** (default 30%): release quality q is 1 inside the perfect window and fades to 0 over the next 40 ms. It shrinks the shooter's own scatter by bonus × q. It never touches contest scatter.

**Aim (lateral).** Aim error is the signed angle between the shooter→cursor and shooter→rim lines, measured on the floor plane. Lateral bias = distance × tan(angle), so long shots need finer aim. Aim assist (default 40%) scales the whole lateral bias, including uncorrected drift.

**Drift.** Carried momentum at release pushes the ball: 1.6 in of lateral bias per ft/s moving sideways, and 1.0 in of depth bias per ft/s toward or away from the rim. Players aim against lateral drift. Once a jumper starts, momentum bleeds off (τ = 0.4 s) and mid-shot steering is disabled; fades are the only intentional mid-shot motion.

**Scatter (lateral, inches).**

| Component | Formula |
| --- | --- |
| Rating | (3.15 + 0.052 × (95 − rating)) × (1 − bonus × q) |
| Distance | 0.10 × distance in ft |
| Movement | 0.14 × speed at the start of the shot (ft/s), combined with fade scatter |
| Contest | 6.0 × contest |

Depth scatter = 1.16 × lateral. Make window: ±4.3 in lateral, ±5.0 in depth. The contest also pushes the shot 2.5 in long at full strength.

**Zone.** Two versus three is judged from the takeoff spot, so fading across the line doesn't create a three.

**Clean looks.** Total lateral scatter is multiplied by (1 − 0.13 × cleanness × release quality), and misses on a clean perfect release are capped at 1.35 make-window radii so they rim out. See Shot noise and clean looks. The rating row in the scatter table is a placeholder until frames replace it.

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

Fade cost (lateral scatter, combined with movement) = 0.5 + 0.06 × (95 − fadeaway rating): about 2.0 in at 70 and 0.5 in at 95. The sideways push of a side fade is constant, so the cursor correction is constant and learnable. The live scatter rings show it.

**The trade-off emerges from timing.** The later release gives a closeout more time. A fade wins against a defender who is already close and loses against a late closeout. For an 80 shooter at 15 ft, an open perfect release goes about 61% standing versus about 49% on a straight fade at fadeaway 70. In one test from the same spot, the fade cut the contest from 21% to 6%.

## Jumper contests

A contest (0–1) is computed at the moment of release. It adds scatter and pushes the shot long; the timing window never changes.

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

- **Effects:** +6.0 × c in of lateral scatter and +2.5 × c in of push long (shooting over the hand).
- **Several defenders** combine as c = 1 − Π(1 − cᵢ). The strongest one is used for block geometry.
- **Blocks:** only when c > 0.8 and the defender is in front (cos > 0.6); chance = (c − 0.8) × 1.2, at most 24%.

The curve was originally linear out to 6.5 ft and penalized 4 ft "open" looks at 50–60%. It was made steep to match NBA tracking, where open (4–6 ft) and wide-open threes differ by only a few points. The contest is still devastating within 2–3 ft.

## Finishing: layups and dunks

Near the rim, the cursor picks the finish side, holding the button is a timing duel with the shot blocker, and the contest acts mainly through blocks and fouls.

**Motion.** A finish is committed: the player steers toward the rim (at most 4 rad/s of turn), keeps at least 4 ft/s, and stops 2.6 ft from the rim. Rise time is 320 ms for a layup and 380 ms for a dunk.

**Finish side.** s ∈ \[−1, 1\] comes from the cursor's lateral offset at rim distance, divided by 1.2 ft. Finishing away from the defender shields the ball; finishing into them makes it worse.

**Hang.** Releasing the button before the rise ends releases at the rise. Holding past it hangs for up to 450 ms, at +0.9 in of scatter per 100 ms. Hang is measured from when the button actually came up.

**Layup scatter (lateral, inches).** Depth scatter = 1.2 × lateral. Window ±5.0 × ±6.0 in, or ×1.2 from a 25–65° bank angle.

| Component | Formula |
| --- | --- |
| Finisher | 1.8 + 0.045 × (95 − finishing) |
| Speed | 0.35 × max(0, speed at the start of the finish − control limit); limit = 9 + 0.08 × (finishing − 50) ft/s, 11.4 at 80 |
| Angle | 2.2 × max(0, −s × lateral momentum) + 0.8 × abs(s), where lateral momentum is clamp(sideways speed / 6) |
| Hang | 0.9 per 100 ms |
| Contest | 3.5 × rim contest |

**Rim contest** = prox × inline × set × reach × side × length × 1.15, measured from the point 1.2 ft toward the rim where the ball goes up.

- prox = clamp((5.5 − d) / 4, 0, 1). inline = 0.35 + 0.65 × max(0, cos), so chase-down blocks are weaker.
- set = 1 − 0.35 × clamp(defender speed / 12): planted beats arriving late.
- reach = 0.45 standing, up to 1.0 at the peak of a jump, 0.3 for 0.45 s after landing.
- side = 1 − 0.4 × shielding, or 1 + 0.2 × finishing into them.

**Shot blockers' jumps.** At the start of a finish, each defender within 7 ft either stays down and vertical (25%) or jumps at reaction × 0.5 + 40 + U(0, 180) ms. A jump lasts 500 ms. Releasing on the rise meets a rising defender; hanging until they land beats them, at a control cost.

**Outcomes.**

- Layup block = 0.5 × c². Dunk block = clamp(c × (0.6 − (dunk − 70)/100), 0, 0.9).
- Foul = c × (0.12 + 0.25 × clamp(defender speed / 10)). A fouled layup gets 1.15× scatter. Labeled as and-one or two free throws, but free throws are not awarded yet.
- Dunks have no meaningful scatter: block roll, then a 4% fumble, then a make ("posterized" above 0.5 contest).

## Floaters

The floater is the early release on a drive: a lenient timed shot whose arc clears a rim protector who stays home. Touch is the cost.

- **Timing:** ideal 330 ms, auto-release 560 ms, perfect window ±20 ms plus the timing assist. Depth bias 0.07 in per ms. The perfect release bonus applies, with the same 40 ms fade.
- **Motion:** a one-step stop. Momentum decays fast (τ = 0.12 s) with no steering, so the release happens about where you clicked.
- **Aim:** cursor aim like a jumper, with aim assist. Carried momentum costs less: 0.6× lateral drift and 0.5× depth drift.
- **Contest:** jumper-style, but prox = clamp((4 − d) / 2.5, 0, 1)^1.5, so the arc clears anyone more than \~4 ft away. Contest scatter 5.0 × c, push long 1.5 × c. Block only above c = 0.75 with the defender in front: (c − 0.75) × 1.2.
- **Scatter (lateral):** touch (3.5 + 0.055 × (95 − floater touch)) × (1 − bonus × q), distance 0.10 × ft, movement 0.08 × ft/s, contest. Depth = 1.45 × lateral, since soft high arcs miss short or long. Window ±4.6 × ±5.6 in.

**Rim protector's read.** On each drive, the first time the ball handler is inside 17 ft and driving, the rim protector decides once:

- **Stay home** (concedes the floater): stays near the rim, blending from its home spot 3.25 ft in front of the rim toward the drive line.
- **Step up** (concedes the lane): moves to a spot on the drive line at clamp(distance − 4.5, 6, 10) ft from the rim. Once the driver gets past that spot, it recovers at only 8 ft/s, which opens the layup.

The chance of stepping up is a slider (default 50%). The decision resets after every shot. The rim protector's current choice is shown in the panel, but in the real game reading its position should be the skill.

## Dribbling

There are no dribble moves to trigger. The cursor is the ball hand, WASD is the body, and crossovers and hesis are names for what happens when those change. Gestures and right-stick style move inputs are explicitly out.

**Camera.** The camera follows the ball handler: centered horizontally, leading 7.5 ft toward the baseline, about 36 ft of court tall, with 60 ms of smoothing. The cursor is re-projected every frame, so a still mouse stays at the same spot relative to your body. Everything below depends on that. When the rim is off the top of the screen, an edge marker points to it.

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
- **Pull-up threat** = respect × range × slowness × (0.35 + 0.65 × how tight the ball is held). Respect comes from shooting ability; range is full within 27 ft and fades out by 32 ft. A poor shooter barely moves them.
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

1. **Near-miss shaping:** on a clean look with a perfect release, misses are pulled in to at most 1.35 make-window radii, so they rim out but never brick or airball. Pulling a miss inward never turns it into a make, so the make rate is untouched. The cap loosens as cleanness or release quality drops, so a real brick still means something went wrong.
2. **Clean-look premium:** a clean look is nobody within about 8 ft (phasing in from 5 ft), feet set (phasing in below 3 ft/s, full below 1 ft/s), and not a fade. Multiplied by release quality, it cuts scatter by up to 13%, taking an open perfect three from about 50% to about 60%. A 100,000-shot simulation gave 60.3%, with every miss a rim-out.

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

Players are defined by their bodies, not by ratings. Height, wingspan and weight shape the mechanics, and the user's skill decides what to do with them. Players differ in what they can get away with, never in hidden accuracy. This is decided but not yet built; the prototype still uses rating sliders.

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
| Finishing | Release reach and extension; the finishing floor becomes universal |
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

- **Launch mapping:** timing moves launch speed by 0.0154% per ms; the ball inherits 10.7% of the body's sideways velocity and 6.7% along the shot. Every input lands within 10% of the old model at 24 ft, and timing and drift errors shrink closer in.
- **Release heights raised:** jumpers 9.6 ft and floaters 8.7 ft, near the top of the shooter's jump. At 9 ft, contesting defenders blocked 4 of 10 tight jumpers.
- **Noise:** the old inch-based components are converted into launch-speed and direction noise using each shot's own sensitivities. Jumpers no longer have a distance term: a short shot comes down more steeply, so the rim is effectively bigger, and the old term double-counted that.
- **Calibration:** jumper noise 1.23× the old values, floaters 1.41×, layups 1.40×; contest scatter 6.0 in; clean looks 4% less noise, capped at 1.6 spreads. Results: open perfect three 50.1%, clean 59.1% (100% of misses on the rim, no airballs), 15 ft 60.0%, 25 ms off 45.1%, heavy contest 15.0%, open 15 ft fade 47.5%, floater 50.7%, open layup at a sprint 80.6%.
- **Live readouts:** a few simulated shots per refresh with a running average, instead of precomputed tables. The paired estimates share their random draws, so their difference shows only aim and momentum.
- **Blocks and goaltending:** hands are real collision spheres (0.3 ft), at a standing reach of 8.2 ft (8.9 ft for the rim protector) plus a 2.2 ft jump, all placeholders until frames. A defender right on a jump shooter blocks about 1 in 12.
- **Bank shots:** the cursor on the backboard beside the rim targets the glass, and a marker turns green where a bank can go in from your spot. From about 45° the working band is narrow and right beside the rim; from 63–65° it's over a foot wide; straight on, none.
- **Ratings retired for shooting:** the shooter rating and floater touch sliders are gone; a universal floor replaces them.

**Airballs come from mistakes.** Heavy contests first airballed 15% of the time: their large spread sent the noise's outer tail clean past the rim. Now noise alone can carry a shot at most 12.5 in from the rim's center (a hard clank off the edge, never past it), plus 1.6 in at full contest, so a heavily altered shot airballs about 4% of the time. Bad timing, aim or drift are biases, not noise, so they can still airball any shot. A cap measured in spreads didn't work: it piles outliers onto its boundary, so airballs jump from about 17% to zero depending on whether that boundary falls inside the rim's reach. Recalibrated with the cap: open three 50.1%, clean 59.1%, 15 ft 60.1%, heavy contest 15.3%, floater 50.5%, open layup 80.8%.

Open items: how layups choose glass versus rim from the finish side is still open; dunks don't fly yet.

**The resolver produces a launch instead of a landing point:**

- **Direction** from the cursor (lateral aim), as now.
- **Launch speed** from timing: early is weak and short, late is strong and long, which is what the meter already means.
- **Arc** from the shot type and the frame: jumpers around 45–50°, floaters much higher. Flatter shots get a smaller effective opening into the rim. A contest can raise the arc as the shooter goes over a hand.
- **Release point** from the frame (height, wingspan).
- **Noise** on speed, angle and direction: the universal floor plus situational components, combined as now. Near-miss shaping becomes the shape of this noise.

**What then emerges:** bank shots (aim the cursor at the glass for a deliberate bank), rim rolls, back-iron misses, soft touch, and realistic caroms for rebounding. Blocks become collisions between the defender's hand and the ball's path.

**Costs:**

- **Recalibration.** Make rates come out of simulation, so the noise must be tuned against the targets with thousands of offline simulated shots. The targets themselves don't change.
- **Live make-chance readouts** can't simulate thousands of full ball flights every frame. They'll come from precomputed tables.
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
| Air drag, spin lift | Off at first; added only if trajectories look wrong |

The rim is modeled as a torus: a ring of radius 9 in made of a tube of radius 0.31 in. The net and the rim's mounting hardware are not modeled as solid at first.

### Launch model

At release, the player's inputs and situation become a launch: release point, direction, angle and speed. Noise is then added in launch space.

**Release point.** From the frame and shot type: roughly 9 ft high for jumpers, lower for floaters, near rim height for layups, placed about 0.7 ft in front of the body toward the target. Placeholder values until frames define them.

**Target.** The rim center by default. With the cursor on the backboard, a point on the glass (see Bank shots).

**Arc (launch angle).** From the shot type: about 48° for jumpers, about 60° for floaters, 55–65° for soft layups. A contest raises the arc by up to 6° at full strength, as the shooter goes over the hand. Dunks have no flight: the ball is placed through the rim unless blocked.

**Ideal speed.** The speed that carries the ball's center from the release point through the target at that angle, where d is the horizontal distance and Δz the height gain:

```latex
v^{*2} = \frac{g\,d^2}{2\cos^2\theta\,\left(d\tan\theta - \Delta z\right)}
```

**Inputs become biases on that launch:**

| Input | Becomes | Mapping |
| --- | --- | --- |
| Timing | Speed | v = v\*(1 + k × post-assist timing error). Early is short, late is long. k is set so depth sensitivity near 24 ft matches today's 0.09 in per ms |
| Aim | Direction | The signed angle between the shooter-to-cursor and shooter-to-target lines on the floor plane, as now |
| Carried momentum | Added velocity | The ball inherits part of the body's velocity, tuned to match today's drift sensitivities (1.6 in lateral and 1.0 in depth per ft/s) |
| Fades | Speed shift | The fixed release line still offsets the canned fade exactly; in physics it becomes the speed needed to make up the momentum lost by fading |

The goal of this mapping is continuity: at the same inputs, a physics shot should land within about 10% of where today's model puts it, before calibration starts.

### Simulation and collisions

The whole flight is simulated instantly at release and then replayed for the animation. Same launch, same path: the only randomness is the launch noise, drawn from a seeded generator so shots can be replayed and tested.

- **Integration:** fixed 1 ms steps, semi-implicit Euler with gravity only, with finer substeps near the rim if contacts need them. A full flight is a few thousand steps.
- **Rim contact:** find the closest point on the rim's ring to the ball's center. Contact when they're closer than ball radius plus tube radius. The contact normal points from that ring point to the ball's center. Push the ball out, reverse its velocity along the normal times the rim restitution, and reduce the sideways part by friction.
- **Backboard contact:** a plane at the board's front face, bounded by its width and height. Same response with the board's values. Edge hits are ignored at first.
- **Floor:** bounces continue after a miss, so we know where the rebound goes.

**Make detection.** A make is confirmed when the ball's center comes down through the rim plane inside the ring and reaches about 0.6 ft below the rim while still inside it, which is where the net takes over. Once in, the net damps the ball's speed for the animation. A miss is the ball dropping below the rim outside the ring, or 3 s passing without a make.

**Outcome labels come from the contact log:** swish (no contact), in off the rim, bank (glass first), in and out, front rim, back iron, off the glass, airball (touched neither rim nor glass). This replaces today's labels, which are guessed from the landing point.

### Noise and calibration

Noise moves into launch space: a spread on speed (as a fraction), launch angle and direction. Calibration tunes its size against the same targets as today, by simulating many shots offline.

**Noise components,** each combined the same way as today (added in quadrature) on each launch axis:

- **Universal floor:** the same for every frame, replacing the rating term. The perfect release bonus still shrinks it by up to 30%.
- **Distance:** largely falls out of the physics, since a fixed angle error grows with distance. An explicit term is added only if calibration needs it.
- **Movement and fades:** from speed at the start of the shot, and the fade cost.
- **Contest:** spread grows with the contest, alongside the arc increase from the launch model.

**Clean looks.** The premium still multiplies all noise by (1 − premium × cleanness × release quality), starting at 0.13. Near-miss shaping becomes a cap on how far, in units of spread, a clean perfect shot's noise can reach. One difference: unlike the ellipse model, pulling noise inward can turn a near miss into a make, so the premium and the cap are tuned together to land on 60%.

**Procedure.** An offline script simulates about 20,000 shots for each cell of a grid: distance 2–28 ft in 1 ft steps, shot type, contest in 0.1 steps, movement, and clean or not. It records make rates and the mix of outcomes. Tuning order:

1. Set the universal floor so an open, perfectly released, non-clean three at 24 ft goes in about 50%.
2. Tune the premium and the cap together: clean perfect threes at 60%, with at least 95% of their misses touching the rim and no airballs.
3. Check the rest and adjust component weights: open perfect 15 ft jumper, floaters around 50% open, layups around 80% open, heavy contests in the mid-teens, an open straight fade around 49%.

**Live readouts** come from the calibration tables (distance × total noise × bias), interpolated, instead of simulating shots every frame. The last-shot panel can afford a small simulation (a few hundred shots) once, at release.

### Blocks, bank shots and feedback

**Blocks.** Each defender's hand becomes a sphere (about 0.35 ft) at their reach height: standing reach from the frame plus their current jump height, out in the direction they're contesting. It's checked against the ball at every simulation step. Contact while the ball is rising is a block, and the ball takes the hand's velocity. This replaces the block probability rolls entirely.

**Goaltending.** Touching the ball on its way down above rim height, or while it's in the cylinder above the rim, counts as a make.

**Bank shots.** In the top-down view the backboard is a line behind the rim, from x = 22 to 28. With the cursor on that line away from the rim, the target becomes a point on the glass, at the height that would send the ball in from the shooter's angle; the physics decides the rest. From the wing, a bank naturally beats a direct shot; straight on, it doesn't, because the glass already rescues long straight-on misses. No bonus is written in. Layups use the same targeting: the finish side picks glass or rim. While aiming at the glass, the target spot is shown on the board.

**Feedback view.** A side-on replay of each shot replaces the top-down landing chart: the arc from release to the rim, the rim and board drawn to scale, and markers where the ball touched. The court view keeps animating the ball from above.

### Structure, tests and milestones

This is the point where the prototype becomes a real project. The physics is built and tested on its own before it touches the game.

**Modules:**

- **Physics:** pure and deterministic. Steps the ball, resolves contacts, and simulates a whole shot from a launch into a path, a contact log and an outcome.
- **Launch:** turns inputs and situation into the ideal launch, the biases and the noise.
- **Calibration:** an offline script that runs the grid and writes tables to a data file.
- **Game and rendering:** movement, dribbling, defense, input, the court view and the side-on replay.
- **Data:** constants and calibration tables live in data files, not in code.

**Tests:**

- A perfect launch at the rim center from 15 and 24 ft is a make with no contacts.
- At 24 ft, 1–2% too slow hits the front rim, 1.5–2% too fast hits the back iron, and 5% slow is an airball. (Speed is that sensitive: 3% slow is already an airball.)
- From 45°, the best bank beats shooting straight at the rim; straight on, it doesn't. (Measured at 12 ft with small errors: 76% vs 67% from 45°, 79% vs 81% straight on.)
- Small sideways errors produce some rim contacts that fall out (in-and-outs exist).
- The same seed produces the identical path.
- No bounce ever gains speed.
- Before calibration, inputs land within about 10% of where today's model puts them.

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

## Prototype defense AI

The defenders exist to exercise the model, not as a design for game AI; in the real game the on-ball defender is a person. The on-ball defender's perception model is described above (The on-ball defender).

|  | On-ball defender | Rim protector |
| --- | --- | --- |
| Default position | Between ball and rim at the cushion from the perception model (guarding distance default 4.5 ft), shaded 0.8 ft toward the ball side they saw | Home 3.25 ft in front of the rim; inside 16 ft, blends 60% toward a point min(4.5, 0.45 × distance) ft out on the drive line |
| Speed | 13 ft/s, accel 50 ft/s², both scaling with quickness | 11 ft/s (12 when contesting a finish), accel 40 ft/s² |
| On a shot | Reacts to the shooting motion they saw, real or fake, after the shot reaction time (default 250 ms): closes out to 1.8 ft in front at 15.5 ft/s | Finishes: blends 75% toward a point min(3, 0.6 × distance) ft out. Stay-home / step-up read on drives (see Floaters) |
| Hand | Up once they react; 0.8 up against a pull-up threat or a dead dribble | Rises for jumpers and floaters within 8 ft |
| Jumps | Within 5 ft of a shot they saw: 50%. On finishes, at a scheduled moment if within 7 ft | Within 7 ft of a shot they saw: 60%. Same finish jumps |
| Body | Holds ground while you dribble: you can't run through them. 1.7 ft minimum separation | 2.2 ft minimum separation; length fixed at 1.2 |

For comparison, the ball handler dribbles at up to 13.5 ft/s (15 ft/s when not dribbling, such as during gather steps or finishes).

## Calibration

With perfect input, a good shooter makes about half of open threes and everyone drops to the mid-teens under a heavy contest. The game balance holds as long as realized averages, not ceilings, stay near real basketball.

**Model output at default settings** (computed from the formulas; jumpers include the 30% perfect release bonus):

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
- **These tables are rating-based.** They will be redone once frames and physics replace ratings and the landing-point resolver. The targets carry over; the formulas producing them don't.

## Constants reference

Values as of the current prototype. Distances in feet, rim offsets in inches, times in milliseconds.

| Constant | Value | Used for |
| --- | --- | --- |
| IDEAL / MAX | 520 / 820 ms | Jumper perfect release / auto-release |
| KT | 0.09 in/ms | Jumper depth bias per ms of timing error |
| PERFECT\_MS | 12 ms | Jumper perfect window (±) |
| WIN\_A / WIN\_B | 4.3 / 5.0 in | Jumper make window half-sizes |
| DEP\_RATIO | 1.16 | Jumper depth scatter ÷ lateral |
| TAU | 0.40 s | Momentum bleed once a jumper starts |
| DRIFT\_LAT / DRIFT\_DEP | 1.6 / 1.0 in per ft/s | Drift bias from carried momentum |
| CONTEST\_SIG / CONTEST\_BIAS | 6.0 / 2.5 in | Jumper contest scatter / push long at full contest |
| FADE\_SPEED / FADE\_COMMIT | 5 ft/s / 150 ms | Canned fade speed / commit window |
| FIN\_A / FIN\_B | 5.0 / 6.0 in | Layup make window (×1.2 from a bank angle) |
| RISE\_LAYUP / RISE\_DUNK / MAX\_HANG | 320 / 380 / 450 ms | Finish rise times / maximum hang |
| RIM\_CONTEST\_SIG | 3.5 in | Layup contest scatter |
| DUNK\_FUMBLE | 4% | Dunk miss chance when not blocked |
| LAYUP\_RANGE / DUNK\_RANGE / FLOATER\_RANGE | 7 / 9 / 14 ft | Context cutoffs on a drive |
| DRIVE\_SPEED / DUNK\_SPEED | 4 / 7 ft/s | Minimum speed toward the rim to count as driving / to dunk |
| FL\_IDEAL / FL\_MAX / FL\_PERFECT | 330 / 560 / 20 ms | Floater timing |
| FL\_KT | 0.07 in/ms | Floater depth bias per ms |
| FL\_A / FL\_B / FL\_DEP\_RATIO | 4.6 / 5.6 in / 1.45 | Floater window and depth scatter ratio |
| FL\_CONTEST\_SIG / FL\_CONTEST\_BIAS | 5.0 / 1.5 in | Floater contest scatter / push long |
| PSPEED / PACC | 15 ft/s / 70 ft/s² | Ball handler movement |
| DSPEED / DACC | 13 ft/s / 50 ft/s² | On-ball defender guarding |
| CLOSE\_SPEED / CLOSE\_ACC | 15.5 ft/s / 60 ft/s² | Closeouts |

**Added since the first version:**

| Constant | Value | Used for |
| --- | --- | --- |
| CLEAN\_PREMIUM / NEAR\_MISS\_CAP | 0.13 / 1.35 window radii | Clean-look scatter cut / furthest a clean perfect miss can land |
| COMMIT\_MS | 150 ms | Release before this and the shot is a pump fake |
| STEP\_T / GATHER\_SPEED | 0.2 s / 6 ft/s | Gather step duration / speed that gives gather steps instead of a dead dribble |
| DRIB\_SPEED | 13.5 ft/s | Dribbling top speed |
| ACC0 / DECEL | 85 / 95 ft/s² | Acceleration from a stop (tapering 60% near top speed) / stopping and cutting |
| REACH\_MIN / REACH\_MAX | 0.7 / 2.4 ft | Closest and farthest a dribble lands from the body |
| Camera | 36 ft tall view, 7.5 ft lead, 60 ms smoothing | Follow camera |
| Defender lag | 0.12–0.4 s (about 0.25 s at defaults) | On-ball perception delay |

**Tuning sliders and defaults:** shooter rating 80, fadeaway rating 70, timing assist ±15 ms, perfect release bonus 30%, aim assist 40%, drift strength 1.0×, ball handling 80, finishing 80, floater touch 75, dunk 75, on-ball defender and rim protector on, rim protector steps up 50%, guarding distance 4.5 ft, on-ball quickness 70, on-ball steals 60, shot reaction time 250 ms, on-ball length 1.0×. The rating sliders are placeholders until frames replace them.

## Known gaps and roadmap

Next up is full physics, then frames. The prototype should become a real project before passing and multiple players.

**Known gaps:**

- **Ratings still drive the prototype;** frames are decided but not built.
- **Makes still come from the landing-point resolver;** the ball flight is cosmetic until physics lands. Blocks are probability rolls, not collisions.
- **No free throws:** fouls and and-ones are labeled but award nothing, so rim attempts are undervalued.
- **Forward momentum on pull-up jumpers** is still a depth bias with no clean correction, which conflicts with principle 4.
- **Dribbling isn't final:** no between the legs, behind the back or spins yet.
- **Live-ball triple threat and jab steps** need passing.
- **The rim protector's step-up choice is shown in the panel;** in the real game, reading its position should be the skill.
- **Floaters don't get the clean-look premium yet.**

**Roadmap:**

1. **Full physics:** standalone physics, calibration, then wiring into the game with a side-on feedback view.
2. **Frames:** height, wingspan and weight replace the rating sliders.
3. **Fouls and free throws.**
4. **Passing and teammates:** catch-and-shoot, live-ball triple threat, lobs, and the open-three problem.
5. **Rebounding:** real caroms from the physics.
6. **Post play:** back-to-the-basket dribbling into the same pivot system.
7. **Human defense controls:** WASD movement with the mouse for contests, steals and passing-lane deflections.

**Engineering:** the single-file prototype is now well past 1,100 lines. The physics work is the natural point to split the resolver from rendering so it can be unit-tested and calibrated offline.

Prototype: [Shot model lab](https://claude.ai/artifact/DuHBqQzcuPA4ZuQT8VSBxf)
