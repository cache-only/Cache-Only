# Tanks: planned changes

The backlog for the Tanks game, grouped by category. Add new ideas to the category they belong
to (or start a new one). Each entry has an id so we can say "do W1". When something ships, set
its status to **done**, with the date.

**Status:** idea → planned → in progress → done. **Size:** S (an hour or two), M (an afternoon),
L (a day or more).

## Every change includes

- `engine.js`, `ai.js` and `rules.js` stay free of the DOM and deterministic: no `Math.random`,
  only `rand(s)`. The whole world stays plain JSON. If the shape of the world changes, bump
  `WORLD_VERSION` so old mid-mission saves are dropped instead of loaded wrong.
- Every new string in English and Catalan (`src/shared/i18n.js`).
- Tests in `tests/tanks.test.mjs` for the new rule or behaviour.
- Reduced motion respected (no shake, fewer particles, no blinking that matters for play).
- The field guide updated and republished (see "Tanks field guide" in CLAUDE.md).

---

## R. Readability: tell a tank's abilities at a glance

Today a tank's colour is the only clue to what it does. You have to learn that teal fires
rockets and yellow lays mines, and every new enemy needs another colour. The fix is a visual
language where **shape tells you abilities and colour only tells you who it is**.

### R1. Make the weapon an explicit stat
**Status:** done 2026-10-13 · **Size:** S

The engine, renderer and field guide decide "rocket" with `T.shot > 6`. Missiles and mortar bombs
can't be told apart by speed. Add `weapon: 'shell' | 'rocket' | 'missile' | 'bomb'` to each kind
in `TYPES`, and put `weapon` on each bullet instead of `rocket: true`.

- Touches: `rules.js` (TYPES), `engine.js` (`fire`, bullets), `render.js` (`drawShell`, smoke),
  `audio.js` (shot sounds), `guide/` (rocket checks), tests.
- Done when: nothing reads `shot > 6` any more and every test passes unchanged.
- Groundwork for W1 and W2.

**Shipped:** every kind in `TYPES` has a `weapon`; bullets and `shot` events carry it (missiles
also carry their `fuel`), and nothing reads `shot > 6` any more (a test checks the sources). The
existing tests passed unchanged before their test data moved from `rocket: true` to
`weapon: 'rocket'`.

### R2. A visual language for abilities
**Status:** done 2026-10-13 · **Size:** M

One rule per part of the tank, so the patterns are learnable:

| Part | Tells you | Proposal |
| --- | --- | --- |
| Barrel | Weapon | Shell: the current thin barrel. Rocket: a thicker barrel with a fire-orange muzzle band, the same orange as the rocket flame. Missile: two short launch pods side by side, plus a red light. Mortar: no long barrel, a wide round tube pointing up (a big dark circle seen from above). |
| Treads | Moves or not | Stationary tanks lose their treads and sit on a square bolted base plate, so "can't move" reads instantly. Movers keep treads. |
| Rear deck | Mines | Minelayers carry mine discs on the back of the hull, one per mine they can have down (yellow 4; violet, white and black 2). A disc disappears when its mine is laid, so you can also see how many are left. |
| Barrel rings | Ricochets (maybe) | One ring per extra ricochet. Only if it still reads on a phone. |
| Turret marks | Brains (maybe) | Small chevrons for aim skill (direct, bank, lead). Probably too small at phone size; test before committing. |

- Draw a mock-up sheet first (all 9 tanks plus W1 and W2) and check it at phone size on a real
  iPhone before changing `render.js`. The field guide cards are a good place for the mock-up.
- Touches: `render.js` (`drawTank`), `guide/page.html` (its copy of `drawTank`), the mission banner
  chips in `tanks.js` if they show tank art.
- Done when: someone who hasn't played can say which tanks fire rockets, lay mines or can't move,
  just from a screenshot.

**Shipped:** the parts are drawn by a new `art.js`, which the game and the field guide both use,
so the guide no longer keeps its own copy of `drawTank`.

- **Barrel:** thin for shells; thick with a fire-orange band for rockets (now a muzzle brake, R5); twin launch pods and a
  light, lit while a missile flies, for missiles; a wide round tube for mortars.
- **Treads or a pad:** stationary tanks sit on a bolted concrete pad (`--tk-plate`). A dark plate
  with bolts read like treads at phone size, worst in dark mode, so the pad is a lighter
  octagon.
- **Rear deck:** one disc per mine, an empty socket while that mine is down. Your tank has them
  too.
- The mission banner and the results tally now show small tank badges drawn by the game instead
  of colour chips, so the banner teaches the language as each enemy arrives.
- **Barrel rings and turret marks: not done.** At iPhone SE scale a whole barrel is about 3 px
  wide, so rings would be under a pixel. Ricochets and aim skill stay in the guide's cards and
  table.
- The mock-up sheet is the guide's "Read a tank at a glance" section: the parts enlarged, and
  every kind at true SE size. It was checked in headless Chrome at iPhone SE and Pro Max scale
  (DPR 3, light and dark). **Still to do:** look at it on a real iPhone, and try the
  "someone who hasn't played" test.
- From "Every change includes": a mine's light no longer blinks under reduced motion. It stays
  lit and turns red for its last seconds.

### R3. A colour plan that won't run out
**Status:** done 2026-10-13 · **Size:** S

Once R2 carries the abilities, colour only has to tell kinds apart.

- **Off limits:** the player's blue family, fire orange (explosions and rocket flames), and the
  crate yellow next to the existing yellow tank (crate grey since 2026-10-14, see R4).
- **Next colours:** crimson red for W1 (it matches the missile's red light) and olive drab for
  W2 (artillery). Still free after those: sand/tan, maroon, navy (if it stays clearly apart from
  the player), lime.
- **Beyond about 12 kinds,** reuse a colour with a pattern (stripes, spots, camo) for a variant,
  such as an "elite" version of an existing tank, instead of finding another hue.
- Every colour needs a light and a dark value in `tanks/styles.css`, and a check that the chip
  text has enough contrast (the guide build already picks dark or light text automatically).

**Shipped:** Red `#b81d33` (dark `#c2213a`) for W1 and Olive `#526228` (dark `#566426`) for W2.
Brown moved from `#9a6a3c` to `#96673a`, a shift you can't see, so its chip text reaches 4.5:1.
The plan is written above the colours in `tanks/styles.css`, shown in the guide, and enforced by
a test in both modes: every kind at least 10 apart (OKLab ×100) from every other kind and from
the off-limits colours (your blue, fire orange, crate yellow, which Yellow is exempt from), and
chip text at 4.5:1 or better.

### R4. Grey crates that join like walls
**Status:** done 2026-10-14 · **Size:** S

Crates were yellow hazard squares, each with its own border, so a row of them read as separate
tiles. Now a crate is a lighter grey than a wall (`--tk-crate`, with `--tk-crate-lit`,
`--tk-crate-dark` and `--tk-stripe`), and crates that touch draw as one block the way walls do:
one fill, edges lit and shaded only on the outside. The diagonal stripes are anchored to the arena,
not to each cell, so they run on unbroken across a group, rising to the right on screen whichever
way the arena is turned. Crate grey replaces crate yellow as an off-limits colour, and Yellow no
longer needs its exemption. The field guide's map legend, source grid and editor brushes show the
stripes too.

### R5. A rocket barrel without the orange tip
**Status:** done 2026-10-14 · **Size:** S

The rocket barrel was a thick barrel with a fire-orange band at the muzzle: a colour cue, when the
plan is that shape says what a tank does. It is now a heavy barrel ending in a **muzzle brake**,
two wide baffles across the tip, so it reads as a hammerhead where a shell barrel stays thin. It
still reads at phone size (checked at an iPhone SE's 23 points a cell). Rocket flames keep their
orange; only the barrel changed. Teal, Green and Black carry it.

### R6. No outlines: one light, brick, toy crates and broken floor
**Status:** done 2026-10-14 · **Size:** M

Every part of a tank had a black ink outline. Now nothing does: one light from the top left of the
screen (`LIGHT` in `art.js`), fixed however the arena turns, lights every part on the edges that
face it and shades the edges that face away, and each part casts a soft shadow on the one under it.
Each part has a height (treads 0.10, hull 0.18, barrel 0.24, turret 0.27, what sits on it 0.31),
and a tank's shadow on the floor is built from all of them, each moved along the light by its
height, so the turret and barrel are in it. The cleats run across each tread from edge to edge, and
the plates at the front and back of the hull have rounded corners.

- **Soft and cheap:** a tank's lit edges, shaded edges and layer shadows go into three masks,
  each blurred once (`paintSoft`); every tank's floor shadow goes into one mask, blurred once a
  frame (`drawShadows`). Blurs are done by drawing a mask down to a small canvas and back up
  (`soften`), never with canvas shadows: an iPhone dropped canvas shadows when one spare canvas
  was drawn onto another, so tanks lost all their light in game while the badges kept it. Under
  about 1.5 px of blur (a small tank on a 2x screen) a tank is lit hard, part by part
  (`paintHard`), with plain clipped fills, each edge in two steps so it fades like a blur. No edge
  is narrower than 2.6 device px and no layer shadow shorter than 2.2: at a cell's true width they
  came out one pixel wide on an iPhone. Canvas shadows are left only where they draw on a canvas
  the page shows or the static floor (blocks, shots, mines, bombs). `render.js` and the guide give
  the art a kit of spare canvases (`makeKit`), so `art.js` still has no DOM.
- **Shots:** today's shapes and pale, with their own shape blurred on the floor below them and a
  shaded edge. Only a missile glows (flame and nose light) and wears its owner's colour. A bomb is
  a dark ball shaded round, with a soft pale glow at its edge, over a shadow that sharpens as it
  lands. A mine has a soft shadow, a lit casing, its owner's colour as a raised cap and a light
  that glows on the floor, red and wider in its last seconds. `--tk-signal` gives mine lights and
  the start beacon their yellow (art.js read an undefined `--signal` before).
- **Obstacles:** walls are brick, three courses a cell in running bond laid along the screen;
  crates are toy crates braced with an X, one box a cell, since a blast clears them a cell at a
  time (`--tk-stripe` is gone); pits are holes broken in the floor, uneven at the edge, a dark
  recess inside with a crack off a corner now and then (`--tk-hole-rim` is gone). The floor has a
  seeded tone per slab, dims into its corners and darkens softly round every block. All of it is
  in the static floor layer, so it costs nothing a frame.
- **Colours:** one per kind, as before. Hornet is cream (`#e8d4a2`) instead of Yellow with hazard
  stripes, so `VARIANTS` is empty; the art still draws stripes for any kind named in it.
- Worked out in the Tank Paint Study artifact (https://claude.ai/artifact/6vxgbpAqSoL9y26pLp1KQS).
  Its ideas for later are R7, R8, P1–P4, M9 and M10. Its on-hold colour plan (a V2 in its V1's
  colour, renamed after animals) is dropped with the lines (N1); its darker-body V2 look becomes
  the night look.
- **Passed over in the study:** tall walls with a face and long shadows, low crates and sunken
  pits; wood crates with boards and nails; toy-brick studs on walls; a kerb round pits (it looks
  like something a shell would hit, and shells fly over pits); a recessed panel on every wall;
  crates built from the logo's pixels; a signal-yellow band round every pit.

### R7. Tells: see what a tank is about to do
**Status:** in progress (Hot minigun done 2026-10-15) · **Size:** M

From the Paint Study. Each one shows something the game knows but doesn't show, so each is a rule
change as much as art: the field guide and the reduced-motion rules need them too.

- **Muzzle tell:** an enemy's barrel tip glows for 0.2 s before it fires. Fairer dodging, above all
  against Black.
- **Reload light:** a shell tank's hatch dims while it reloads and lights when it can fire again.
- **Hot minigun** (**done** 2026-10-15)**:** Lime's barrels glow orange after a long spray and cool
  over its 2.5 s spin-down, so you can see when it is ready again. Shipped: each round heats the
  barrels by 1/25 (full after 2.5 s of spray); 0.2 s after the last round they cool at the
  spin-down's rate, and the glow never outlasts the spin, so dark barrels mean a full spin-up. They
  glow orange toward their tips, white-hot near full, and light the floor round the muzzle
  (`heat` in `drawTank`, kept by `render.js`; the guide's Lime card shows it).
- **Empty pods:** a missile pod shows a dark bore while its missile is out, beside the light that
  already says so.
- **White's shimmer:** White still fades out, but a faint shimmer shows where it drives. Its tread
  marks already give it away.

### R8. Identity: your emblem and kind glyphs
**Status:** idea · **Size:** S

- **Your emblem:** your tank wears the app's cent mark on its rear deck. No other tank does.
- **Kind glyphs:** each kind's spawn letter in the logo's pixels on its turret top, so shape says
  the kind as well as colour, for colour-blind players.
- **Keep:** no tank is drawn bigger for being heavy. Art bigger than the hit circle lies about
  where a shot lands.

---

## W. New enemies and weapons

### W1. Guided missile tank
**Status:** done 2026-10-13 · **Size:** M · **Needs:** R1 (R2 nice to have)

A tank whose missiles steer toward you, with a limited turn rate, so a late sidestep makes them
overshoot.

- **Look:** crimson hull, launch pods (R2). Each missile has a blinking red light and a smoke
  trail; the light stays on without blinking under reduced motion. The tank's own red light is lit
  while one of its missiles is in the air.
- **Steering:** each step, before `advance`, turn the missile's velocity toward the player by at
  most `turn × dt`. Only steer while the player is within ±90° of the missile's nose (lock cone),
  so it can't loop back once it has passed. After its fuel runs out it flies straight.
- **Starting numbers (to tune):** missile 3.2 cells/s (a normal shell is 4.6), turn 2.2 rad/s
  (about 126°/s, a turning circle of about 1.5 cells), fuel 4 s, 0 ricochets, 1 missile at a time,
  3 s reload. Tank speed 1.0, dodge 0.3, keeps 5–10 cells away.
- **Counterplay that already works:** shells that meet cancel out, so you can shoot a missile
  down. It dies on the first wall it touches. Mine blasts clear it.
- **AI:** the current rule fires only when a straight line would hit you. Decide whether a
  missile tank also fires when you're in range but around a corner (scarier), or only with line
  of sight (fairer).
- **Friendly fire:** the "don't hit allies" check traces straight lines and can't predict a
  curve, so a missile can hit an ally. That fits the one-hit rules; keep it.
- **Sound:** a short lock-on beep when it fires, synthesised in `audio.js`.
- **Campaign:** a map letter (`r` is free; `o` is taken by holes), names in EN and CA (Red /
  Vermell), a banner note like the white tank's ("Missiles here follow you. Shoot them down or lead
  them into a wall."), and a place in a few missions from about 12 on. The tests expect exactly 20
  missions, so it replaces enemies in existing missions unless we add missions and update the test.
- **Tests:** steering is deterministic and never turns faster than the limit; the lock cone and
  fuel work; a missile can be shot down; a mid-flight save resumes exactly.
- **Field guide:** a card whose scene shows a curved dotted path, and a new aim style ("Guided").

**Shipped:** kind `red`, map letter `r`, Red / Vermell, with the starting numbers above.

- **Decision: line of sight only** (the fairer option). It aims and checks its shot like a
  Direct tank, and the missile does the chasing. That keeps the mortar as the one enemy that
  needs no line at all, and homing already punishes stepping out of the line.
- Lock-on beep, smoke trail and a blinking nose light (steady under reduced motion).
- Missions: introduced in 12 (Lock-on), then 16, 18 and 20.

### W2. Mortar tank (indirect fire, a new category)
**Status:** done 2026-10-13 · **Size:** L · **Needs:** R1

Lobs bombs over walls. It's the first enemy that doesn't need a line of sight, so it needs a
clear warning.

- **Flight:** a bomb flies from the tank to a target point in a fixed time (about 1.5 s, whatever
  the distance), over walls, crates, holes and tanks. It can't be shot down in the air.
- **Warning:** a target mark appears on the floor where it will land and shrinks as it falls. The
  bomb is drawn above its own shadow, higher in mid-flight, so you can read where it is going.
- **Landing:** a small blast, about 1.0 cell (a mine's is 1.5). It destroys tanks and shells and
  sets off mines, like a mine blast. Decide whether it clears crates.
- **Aim:** at where you're heading (lead), with a little landing scatter. It has a minimum range
  of about 3 cells, so getting close is the counter. Range about 4–12 cells. It won't target a
  spot near an ally.
- **Starting numbers (to tune):** stationary or very slow (0.6), 1 bomb in the air, 3.5 s reload.
- **Look and sound:** olive drab, round mortar tube (R2). A thump on launch and a falling whistle.
  Under reduced motion: no shake, a static target mark.
- **Maps:** walls stop being full cover, so missions with mortars need open space to dodge in.
- **World data:** bombs need their own list, `{ x0, y0, tx, ty, t, flight, owner }`, which changes
  the world shape (bump `WORLD_VERSION`).
- **Campaign:** letter (`d`, for olive drab, is free), names in EN and CA (Olive / Oliva), banner
  note, missions.
- **Tests:** a bomb lands exactly where and when planned, the blast radius, minimum range, no
  targeting near allies, and save/resume mid-flight.

**Shipped:** kind `olive`, map letter `d`, Olive / Oliva, stationary, with the starting numbers
above (1.5 s flight, blast 1.0, range 3–12, lead 0.8, scatter 0.45, reload 3.5 s). Bombs live in
`s.bombs`; `WORLD_VERSION` is 2.

- **Decision: a landing bomb clears crates,** like a mine: one blast rule with two radii.
- Its tube turns toward the mark before it fires, as a tell.
- The target mark has a closing ring (a static mark under reduced motion). The bomb is drawn
  above its shadow with a pale rim, so it shows over walls. A thump and a falling whistle at
  launch, a shorter blast at landing.
- Missions: introduced in 15 (Artillery), then 19 and 20.
- **To tune:** in bot playtests, mortars almost never land a kill. 1.5 s of warning is enough
  to drive out of a 1-cell blast, so they work as area denial that pushes you out of cover into
  other guns. If that feels toothless in real play, shorten `BOMB_FLIGHT` first.

### W3. Minigun tank
**Status:** done 2026-10-14 · **Size:** M

A machine-gun tank that sprays rounds non-stop, with a spin-up as its warning.

- **Spin-up:** six barrels take `SPIN_UP` (1.2 s) to come up to speed from rest, whining as they
  go. It starts them only once it has a straight line on you (and the mission's opening hold is
  over), and fires only at full speed. With no line on you they run down over `SPIN_DOWN` (2.5 s),
  so a short break in cover doesn't reset it.
- **Spray:** at full speed it fires a round every 0.1 s, up to 10 in the air, each within ±5.7° of
  its aim, for as long as its line passes within `SPRAY_R` (0.6 cells) of you (`aim: 'spray'`).
  No react pause on a new angle: the spin-up is its reaction time.
- **Rounds:** 6.4 cells a second, no ricochet. Like any shot they cancel out with whatever they
  meet (shells, missiles, other rounds), so a shell fired back down the stream rarely gets through:
  hit it while it spins up, or from the side. They set off mines. (It shipped with rounds that
  passed through other shots; changed the same day, so they collide like everything else.)
- **Counter:** its turret drags as the barrels speed up, from 86° a second down to `SPRAY_TURN`
  (29°) at full speed, so up close you can circle it faster than it turns.
- **Moves:** 1.2 cells a second, keeps 4–8 cells away, dodges 15%.
- **Look and sound:** lime (`--tk-lime`, `#9cc93a`; 12.3 from Yellow, 17.6 from Green). Its gun
  is a motor housing bolted over the turret with six barrels bound by a clamp; seen from above,
  the barrels slide across each other as they spin (`roll`, kept by the renderer; a quarter speed
  under reduced motion). Tracer rounds with a short streak and a faint smoke trail (fainter and
  shorter than a shell's, and the first effect dropped on a busy screen), a small flash and an
  ejected casing per round, a rising whine on spin-up and a dry crack per round.
- **World data:** minigun tanks carry `spin` (0–1) and `rev` (driving the barrels). No world saved
  before them has one, so `WORLD_VERSION` stays 2.
- **Campaign:** letter `l`, Lime / Llima, banner note. **In no mission yet:** it plays on the test
  range (C7). Playtest on the range, 16 seeds, expert / casual bot wins: 1 lime 15 / 10, 3 limes
  14 / 0, 6 limes 15 / 0 (3 Greys: 16 / 13; 3 Blacks: 15 / 1). With colliding rounds the casual
  bot loses its return fire, so 3 limes play harder than 3 Blacks. **To tune** before it goes in
  a mission (M6): fewer rounds in the air, a slower fire rate or a wider spread.

---

### W4. Hornet: a trap layer (now Night Yellow, N1)
**Status:** done 2026-10-14 · **Size:** L

Yellow with a plan: it mines your way to it, watches each mine, and sets it off as you pass.

- **Look:** cream (`#e8d4a2`, since 2026-10-14, see R6), its own colour; it used to be Yellow's
  colour with black hazard stripes, a variant in `art.js`. Kind `hornet`, map letter `h`, Hornet /
  Vespa.
- **Stats:** like Yellow, sharper: speed 1.8, turret 2.2 rad/s, thinks every 0.15 s, reacts in
  0.35 s, ±3.4°, dodges 45%, keeps 4–8 cells away, 4 mines.
- **The plan** (`planTrap` in `ai.js`, state in `ai.plan`, `pc`, `wc`, `planT`, `since`):
  1. **Pick a spot** (`trapSpot`): a cell on your shortest way to it that it reaches at least two
     steps before you, within 8 of its steps, clear of other mines (1.7), of allies and of the spots
     other Hornets mean to use; best in a narrow way, against cover, and 4–8 steps ahead of you.
     While you are still far off, only a narrow way nearer you than it is will do, so it mines its
     way toward you instead of backing into a corner.
  2. **Lay it,** then drive to a **lookout** (`watchSpot`): no nearer you than the mine, 2.5 to 6.5
     cells from it with a straight line to it, clear of other mines, best at its fighting distance
     and with room round it.
  3. **Watch** for about a second, or up to 4 s while you are near one of its mines, and shoot the
     mine when you pass (`detonation`, unchanged from the smart Yellow).
  4. **Close in:** within 3 steps of you it drops one where it stands, but only with a lookout to
     get clear to.
- **Its own side's mines:** a quiet mine laid by an enemy (not within 4 s of going off, you not near
  it, no shot close by) only goes off when driven onto, and no enemy shoots a mine beside a friend,
  so it keeps just clear of setting those off (`mineReach`); yours, and any about to blow, it keeps
  out of their blast. Its routes go round the cells it must keep off (`trapField`).
- **Getting clear:** inside the blast of a mine about to go off, it drives to the nearest free cell
  out of reach (`clearCell`), along a way that never gets nearer that mine, and stays out until it
  has gone off. This replaced fleeing step by step, which left it boxed in corners.
- **Banner note:** "Hornets here mine the way to them, then shoot a mine the moment you pass it.
  Give every mine a wide berth." (`tanks.note.hornet`; Yellow's note is gone).
- **Measured** on the test range against the casual bot holding fire: 3 Hornets lay about 2.2 times
  as many mines as 3 Yellows, one Hornet 1.7 times one Yellow. Over 16 seeds of 45 s, no Hornet blew
  itself up in the four Yellow missions with Yellows swapped for Hornets, nor 3 on the range; 6
  crammed on the range still lose one now and then, boxed into a corner.
- **In no mission yet:** the test range only. Playtest bots keep 2 cells from every mine, so none
  shows how often a person gets caught by the mine shot: try it on a phone first (M7).

### W5. Laser tank
**Status:** done 2026-10-15 · **Size:** L

Kind `indigo` (`i`, colour `--tk-indigo` #5a45c8, "Anyil" in Catalan), weapon `laser`. It stops and
shows a thin red line for `LASER_CHARGE` (0.9 s), its turret locked on it, then burns down the line for
`LASER_BEAM` (1 s): every tank and shot within `LASER_W` of the line goes, a mine on it goes off, and a
wall or crate stops it (holes don't). Reload (2.6 s) counts from the end of the beam. It never fires
with an ally anywhere on its line (`laserClear`), and every mover keeps off a line that is charging or
burning (`fleeBeams`, and `chooseCell` scores such cells down). **Night Indigo** (`indigoNight`, `I`)
turns its beam after you as it burns, at up to `track` (0.4 rad/s): from about 4.75 cells out you
can outrun it sideways, closer you need a wall. Banner notes for both. Not in a mission yet: the
test range and the editor only.

---

## N. Night versions

### N1. Night versions instead of lines
**Status:** done 2026-10-15 · **Size:** L

**Built:** the lines are gone (`upgrade` and `twin` left `TYPES`; Grey and Green stand alone).
`NIGHT` in `rules.js` lays only what changes over the day kind, as `TYPES.pinkNight` and
`TYPES.yellowNight` (`base`, `night: true`). Violet became **Night Pink** (`P`, the same numbers
Violet had) and Hornet became **Night Yellow** (`Y`, Hornet's numbers and its trap-laying plan).
Grey took Hornet's cream and is now called **Cream** / Crema (key `ash` kept). Pink itself got
Violet's way of fighting at its own pace: 3 shells spaced 0.6 s apart instead of a burst, 20% lead
and 40% dodging (casual bot on M7 Bank shots: 8/8 wins before, 6/8 after; expert 8/8). The night
test holds every night number to its day kind's. Names are one string per kind ("Night Pink" /
"Rosa de nit"), and night versions sit in the test range's kind grid rather than behind a Night
switch. Saved maps with the old letters `v` and `h` load as `P` and `Y`; saved prefs move too.

The design as planned:

Lines (A5) grouped kinds as a first version and its upgrade (Brown → Grey and so on). They go.
Every kind stands alone, told apart by its own colour, as on the field today: Grey, Green, Violet,
White and Hornet are kinds of their own, not upgrades of another. A stronger version of a kind is
its **night version**.

- **What it is:** the same kind with better numbers or a better behaviour. It keeps the kind's
  colour, weapon and shape, so you read it as that kind, only worse news. Any kind can have one;
  none has one yet.
- **Rule:** a night version is at least as good as its day kind everywhere and better somewhere.
  The test that held a V2 to its V1 (reacts and thinks at least as fast) moves here and grows: no
  night number is worse than the day's.
- **Data:** `NIGHT` in `rules.js`, per kind, holds only what changes: numbers that replace the
  day's (`{ ...TYPES[kind], ...NIGHT[kind] }`) and behaviour flags the engine and AI read. Two
  ways to put it on a tank: a generated entry in `TYPES` (a key such as `redNight` with
  `base: 'red'`), which keeps every `TYPES[t.type]` lookup as it is, or a `night` flag on the tank
  and a stats helper everywhere `TYPES[t.type]` is read today. The generated key is less to change;
  colour and name then come from `base`.
- **Maps:** the kind's spawn letter in upper case (`R` night Red, `L` night Lime). Nothing uses
  upper case today. `engine.js`, `maps.js` and `mapcheck.js` read letters through `SPAWN_CODES`,
  so one place maps an upper-case letter to the night version.
- **Look:** the Paint Study's on-hold V2 look, which reads as night: the hull a deep shade of the
  kind's colour (about half way to black), the cleats (a pad's bolts) bright on black treads, the
  turret and weapon as the day kind. Worked out from the kind's colour, so no new tokens, and the
  colour plan's test still holds. Headlights were another V2 look the study drew, if it needs more.
- **Name:** "Night Red" / "Vermell de nit", built from the kind's name with one string per
  language, not one per kind.
- **Where it shows:** the test range gets a Night switch next to the kind; the field guide shows a
  night version on its kind's card (what changes, and a scene) and as its own row in the stats
  table.
- **Not night missions:** a night version is a tank; M10 is the arena going dark. They would suit
  each other, but neither needs the other.
- **What changes in the code when built:** `upgrade` and `twin` leave `TYPES`; the lines test
  becomes the night test; the guide stops grouping kinds by line (roster, intelligence table and
  what a V2 gains and gives up); `guide/plans.mjs` drops its V2 reasons; CLAUDE.md's Tanks
  section follows.

### N2. Night Red: twin missiles that find their way
**Status:** done 2026-10-15 · **Size:** M · **Needs:** N1

**Built:** kind `redNight` (`R`). Fires its left pod, then its right `PAIR_GAP` (0.25 s) later (`pair`,
`t.salvo`; at first both fired together, changed the same day), each 10° to its side of its aim
(`TWIN_SPREAD`), needing room for both (2 in the air). Missiles fly at 3.8, turn at 3.2 rad/s for
5 s, and steer for the furthest visible cell on the shortest open way to you (`path`, `routeTo()` in
`ai.js`), so they follow you round a wall, swerving round any tank or mine ahead (`waypoint()` in
`engine.js`). The two of a pair never cancel each other out (`pair`): they used to clash just after
launch. It also fires round a corner along the open way when you hide within its range + 4 steps
(`launchClear` checks the first stretch and allies). Each pod kicks back on its own shot.

Red already has two launch pods. At night it uses both.

- **Two at once:** each shot fires a missile from each pod, about 10° apart either side of its
  aim, so they come at you from two sides and close in. Up to 2 in the air (one pair); reload as
  today.
- **Faster:** 3.2 → about 3.8 cells a second. Still slower than your shell (4.6), so it still
  reads as a missile and you can still meet it with a shell.
- **Tighter turn:** 2.2 → about 3.2 rad a second. Its turning circle goes from about 1.45 cells
  to about 1.2 (radius = speed ÷ turn), so a sidestep has to come later.
- **Finds its way:** today a missile steers straight at you and dies on the first wall. A night
  missile steers along the shortest open path to you (the AI's path map from your cell): toward
  the next turn while a wall is in the way, then straight at you. It steers round tanks in its
  way, so it stops hitting allies. It still dies on any wall it touches. The lock cone becomes "the
  next point on its path is within 90° of its nose", and fuel may need 5 s instead of 4 for the
  longer way round. The path map lives in `ai.js`; the engine would need it from a DOM-free shared
  place, and it must stay deterministic.
- **Counterplay left:** two shells shoot down a pair; a mine blast clears both; a turn tighter
  than its circle still beats it; a corner cut too fine still kills it. Cover still helps for a
  moment, but not for long.
- **AI:** fires with a line on you, as today. Option (W1's old question): at night it also fires
  round a corner, since the missile can find you. Scarier; playtest first.
- **Look and sound:** both pod lights lit while their missiles fly; a double lock-on beep.
- **Tests:** the pair leaves symmetric; each missile obeys the new turn limit; one reaches you
  round a corner on a test map; none steers into an ally; a save mid-flight with two missiles
  resumes exactly.
- **To tune:** if a pair is too much, fire them 0.3 s apart instead of together.

### N3. Night Lime: a minigun that moves
**Status:** done 2026-10-15 (two of the ideas) · **Size:** M · **Needs:** N1, and day Lime tuned first (W3, M6)

**Built:** kind `limeNight` (`L`): dodges faster (50%, re-plans every 0.12 s, speed 1.4) and walks its
stream from side to side up to a cell either side of you (`walk`), firing while its line passes
within `SPRAY_R + walk`. Not built: bouncing rounds and firing from your blind side.

Ideas to pick from, not all at once: three day Limes already play harder than three Blacks.

- **Dodges faster:** day Lime notices 15% of shots, and only checks when it re-plans (every
  0.2 s). At night it notices about half, re-plans every 0.12 s and steps aside quicker. Its turret
  still drags while the barrels spin, so circling it close in stays the counter.
- **From where you aren't looking:** it picks a firing spot as far round from your turret's
  direction as it can reach at its distance, so its stream starts on your blind side. (To settle:
  is this the "furthest angle from you", or is the next one?)
- **Sweeps the edges:** instead of holding the stream on you, it walks it across the arc you could
  sidestep into, so a dodge runs into rounds.
- **Bouncing rounds:** its rounds get one ricochet, so it can hose you round a corner off a wall.
  The strongest of the four, and its own stream becomes a danger to it and its allies (the ally
  check already traces ricochets).
- **Look:** the night look (N1). The hot barrels (R7) would suit both versions.

---

## A. AI

### A6. Dodging that doesn't swing back and forth
**Status:** done 2026-10-15 · **Size:** M

A noticed shot made a tank step across its line for a fixed 0.3 s, checking only that the cell 0.75
ahead was open, then its route pulled it back and the next think tick dodged again: against a wall it
shuffled in place and died. Now `escape()` looks in 24 directions for the nearest spot the hull can
really reach in time (walls, crates, holes, tanks, mines, and the time to turn) that is off the
shot's line or behind something that stops it, drives there and waits until the shot has passed
(`ai.dodge`); with no way clear it doesn't dodge. Measured over every mission against the expert bot:
reversals near a shell 41.6 → 10.2 a minute; over 909 wall-side cases, dying 25 → 4 and swinging back
and forth 36% → 12%. The casual bot's M7 went 6/8 → 4/8 (same deaths per run); expert ≥ 7/8
everywhere.

### A1. Tanks jam in narrow gaps and shove each other
**Status:** done 2026-10-13 · **Size:** M

What happens: a tank grinds against the edge of a one-cell gap, or two tanks meet in a corridor
and push each other back and forth without either giving way.

Why, from the code:

- **No right of way.** `chooseCell` in `ai.js` only gives cells near another tank a small
  penalty (−2.5), while getting closer to its preferred distance from you is worth 1.6 per step plus
  a random bonus. Two tanks can pick cells into each other. `collideTanks` in `engine.js` then
  pushes both equally, so neither wins.
- **No stuck detection.** A blocked tank keeps its goal for up to 1.6 s (`goalT`), and when it
  picks again its heading bonus (+0.7 for keeping the same direction) often sends it the same way.
- **Corner cutting.** Steering aims straight at the next cell's centre. Coming at a gap at an
  angle, the hull clips the corner and `collideWalls` pushes it back every step: that's the
  grinding.
- **It looks tighter than it is.** The hull is 0.76 cells wide (`TANK_R` 0.38) but drawn 1.1× larger
  (`ART`), about 0.95 cells, so every one-cell gap looks like a squeeze.

Fixes, roughly in order of value:

1. **Stuck detection:** if a tank trying to move covers under 0.1 cells in 0.4 s, it drops its goal,
   treats that cell as closed for about 2 s, and backs up a little.
2. **Right of way:** when two movers are about 1 cell apart and heading at each other, the one
   with lower priority steps aside or waits. Use something deterministic, such as the higher slot
   number, or whichever has more room behind it.
3. **Cell claims:** each mover claims the cell it is heading for. Other movers treat claimed cells
   as closed, instead of only slightly worse.
4. **No heading bonus after a failed move.**
5. **Line up before a squeeze:** when the next cell is a one-wide gap, turn the hull in place and
   drive along the gap's centre line instead of cutting the corner.
6. **Maybe:** draw tanks at `ART` 1.0 so the art matches the hull size.

- **Tests:** a scripted corridor where two tanks pass each other in a set time; in every mission
  (3 seeds), no enemy that wants to move stays within 0.2 cells of the same spot for more than
  1.5 s.

**Shipped:** fixes 1–5; 6 decided against.

1. Stuck detection: a tank pushing toward the same cell for 0.4 s without covering 0.1 cells
   avoids that cell for 2 s, backs off for 0.3 s and chooses again.
2. Right of way: the tank with somewhere to be (outside its preferred distance) goes first;
   between equals, the lower slot. The other steps out of its line, or backs ahead of it in a
   one-wide corridor, and waits until it has passed (at most 4 s).
3. Cell claims: no tank picks a cell another tank stands in or is heading for. The spacing
   penalty fell from 2.5 to 1, below a step of progress, so tanks can pass side by side.
4. No heading bonus after a failed move.
5. Lining up: the further off a narrow way's centre line, the steeper it heads for the line.
   The blend is smooth: a hard threshold made tanks flip between two headings and stall.
6. `ART` stays 1.1: the R2 parts need the size to read on a phone, and with the jams fixed in
   the AI the tight look matters less.

Measured with non-firing enemies on every mission (60 s, 3 seeds): the old AI left tanks pinned
for up to 28 s (two Blacks in mission 17). Now none stays pinned past 1.5 s, and grinding into
walls adds up to about 0.2 s in 10,000 s of driving. **Known limit:** two tanks that both need
to get past each other in a long one-wide corridor, whose only passing bay is behind one of
them, can still take turns backing up. The maps give roaming tanks two-wide routes where they
meet (M2).

### A2. Smarter aim: shoot where you're going
**Status:** done 2026-10-13 · **Size:** M

Only the black tank leads its shots today (`lead: 0.6`). It aims at where you'd be after
`distance ÷ shell speed × 0.6` seconds, using your velocity at that instant. Bank shots already
use the predicted point, so a tank with both bank and lead would bounce shots at where you're going.

- **Exact intercept:** solve for the moment a shell meets a target moving at constant speed,
  instead of the straight-distance estimate.
- **Stop predictions at walls:** you can't drive through a wall, so clamp the predicted point
  where your path would hit one, instead of aiming into the wall.
- **Smooth your velocity:** average it over the last 0.2–0.3 s, so a twitchy stick doesn't throw
  the aim off and zig-zagging stays a real counter.
- **Tiers:** give some lead to the late tanks (for example violet and white 0.3, teal 0.5) and
  keep early tanks without it, so the first missions stay readable. Show it in the field guide.
- **Later ideas:** aim at choke points you have to pass; hide behind cover after firing; flank;
  avoid every tank firing at the same moment.
- **Tests:** a lead tank hits a target moving in a straight line; a target that turns at the
  right moment makes it miss.

**Shipped:** exact intercept (`intercept` in `ai.js`, counting the muzzle), predictions that stop
at walls (`predict`), and your velocity smoothed over about a quarter second (`svx`, `svy` on
your tank, part of the saved world). Lead tiers: Teal 0.5, Violet 0.3, White 0.3, Black 0.6,
and Olive's bombs 0.8; the early tanks have none. The guide lists each kind's lead. The later
ideas moved to A3.

---

### A3. Tactics
**Status:** idea · **Size:** M

Moved here from A2's later ideas: aim at choke points you have to pass; hide behind cover after
firing; flank; avoid every tank firing at the same moment. Tune together with Red and Olive.

### A4. Two minelayers, and no shots through mines
**Status:** done 2026-10-14 · **Size:** M

Violet, White and Black carried 2 mines each, and Yellow laid its 4 only now and then, at random.

- **Who lays mines:** only Yellow (2) and Hornet (4, see W4). Violet, White and Black carry none.
- **Yellow stays simple:** it drops one now and then where it stands, when 2 to 9 steps from you
  with no ally or other mine close by (`wantsMine` in `ai.js`). For part of the day it carried 6 and
  laid them by worth, backing off from each and shooting them as you passed; it still got trapped
  between its own mines and showed no plan, so the smart version became a kind of its own, Hornet.
- **No shot through a mine:** every enemy's shot check (`shotTarget`) counts a mine on the line as
  where the shot ends. It fires only if that blast would catch you and spare every enemy (a mine
  beside you on its line is as good as a hit). Enemies used to blow up mines beside their friends,
  and Hornets their own fresh mines, by firing back at you across them.
- **Mines in the way of moving:** cells near a mine score worse the nearer they are (`mineCost`),
  so a tank inside a blast always has a better way out; it never waits in such a cell; and fleeing a
  mine or dodging a shell never runs it onto another mine (`clearMove`).
- **Mine discs:** Yellow's rear deck holds 2, Hornet's 4, in one row as before.

### A5. Lines (V1 → V2) and five axes of intelligence
**Status:** lines done 2026-10-14, dropped 2026-10-15 (N1: Violet is Night Pink, Hornet Night Yellow); behaviours planned ·
**Size:** L

**2026-10-15:** the lines go (N1). Every kind stands alone in its own colour, and the stronger
version of a kind is its night version. The five axes and the plan below stay; read "V2" in them
as "the stronger kind" until they are rewritten. A ladder per axis (a tier is a behaviour, numbers
are tuning, a ★ god tier at the top such as shooting shells down) is drawn in the Tanks
Intelligence artifact (https://claude.ai/artifact/5GzqxRK63bc1jDfxZ7S1c1); not adopted yet.

Stats were one flat list (aim, think, react, spread, dodge, range, lead, layRate, trap, detonate), and
Hornet's planning had no place on it. Now kinds are grouped into **lines** and rated on **five axes**.

**Lines** (`upgrade` in `TYPES`; White also has `twin`). A V2 is the upgraded version of a first
version (V1):

| Line | V1 | V2 |
| --- | --- | --- |
| Brown | Brown | Grey |
| Teal | Teal | Green (can't move) |
| Yellow | Yellow | Hornet |
| Pink | Pink | Violet, and White (Violet's twin, invisible) |

Red, Black, Olive and Lime stand alone. A test holds every V2 to reacting and thinking at least as fast
as its V1. The field guide groups the roster by line and says what each V2 gains and gives up,
worked out from the stats.

**Five axes**, each with named levels, shown in the guide's Intelligence table (worked out from the
stats, so it stays true):

| Axis | Question | Levels today |
| --- | --- | --- |
| Aim | How does it find a line on you? | sweep, direct (or guided, lob, spray), bank, bank ×2; plus lead and accuracy |
| Awareness | How fast does it notice? | slow, steady, quick, sharp (reaction time; think rate alongside) |
| Defence | What does it do about a shot coming at it? | none, sidesteps, often, nearly all (+ invisible) |
| Tactics | What does it do with no shot? | fixed, roams / snipes, hunts, ambush |
| Mines | How does it use mines? | none, scatters, traps |

**Gaps the table shows:**

- Every mover only *roams* when it has no shot: it wanders at random at its distance. With you
  hiding, Grey, Teal, Red and Pink spend 46–67% of their time like that, which reads as a bug.
- Green gives up Teal's movement (by design) and Teal's 50% lead (probably not).
- Violet and White gain no Tactics over Pink.
- Nobody shoots a shell down, the Defence level the expert playtest bot already uses.

**Plan, in order** (each step playtested so the expert bot keeps 6 wins in 8):

1. **Tactics: seek.** A mover at its distance with no shot drives to the nearest cell in its band that
   has a line on you (bank lines for bank aimers) instead of roaming; it pauses only to line up a
   shot, watch a mine, give way or take cover. Test: with a firing spot within a few steps, it is
   heading there.
2. **Defence: shoot down.** A share of noticed shells it fires at instead of (or as well as) stepping
   aside, aiming at where the shell will be (shells that meet cancel out). For Black, Violet, White
   and Hornet.
3. **Tactics: cover.** Violet and White fire, then step back behind a wall until reloaded (A3's
   "hide after firing"), so the Pink line's V2 gains a Tactics level.
4. **Aim for Green:** give it lead, so the Teal line's V2 is the better aimer.
5. **Mines for Black:** 2 on the ground at once, dropped behind it as it hunts, so chasing it head-on
   is a risk (it carried 2 until A4).
6. **Targets per line once done:** Grey seeks; Hornet ambushes (done); Violet and White seek and take
   cover and shoot down; Black hunts, shoots down and drops mines; Red, Lime and Teal seek; Brown,
   Green and Olive stay fixed. Then extend the test so a V2 is at least its V1's level on every axis
   it can use.

The field guide shows these as **Proposed** next to each kind's level today, and lists them under
"What we could add". They live in `guide/plans.mjs` (with the aimless-time measurement); when one
ships, take it out of there and the guide shows it as the kind's level from the stats.

## M. Maps and missions

### M1. A map editor
**Status:** done 2026-10-13 · **Size:** M

Maps are typed by hand as 15 strings of 20 characters, which makes them slow to try out and
easy to keep simple.

- Paint cells with a palette (floor, wall, crate, hole, you, each enemy letter); toggle top-bottom
  mirroring; load any existing mission; "Copy as missions.js entry".
- Live checks, the same rules the tests use: size, one `@`, 1–8 enemies, every enemy reachable.
  Plus warnings from M3.
- Live preview drawn the way the game draws it.
- **Where:** most natural as a new section of the field guide (it already draws maps from text,
  shows the source and has "Copy map text"). It stays a dev tool, never part of the app.
- **Later:** playtest inside the editor by bundling `engine.js`, `ai.js` and `rules.js` into the
  page (they are DOM-free, so they run anywhere).

**Shipped:** the guide's "Map editor" section: a brush for every map character (typing the
character picks it), top-bottom mirroring, start from any mission or a blank map, undo,
"Copy as missions.js entry", and a text box to edit or paste a map. The checks run live (the
same `guide/mapcheck.mjs` the tests use) and ring the cells they point at, on a preview drawn
by the game's own art. The draft stays in the browser. The guide build bundles `rules.js`,
`ai.js`, `engine.js`, `art.js` and `mapcheck.mjs` into the page, and a test checks the bundle
behaves exactly like the game. Playtesting in the editor is M5.

### M2. Stronger layouts
**Status:** done 2026-10-13 · **Size:** M (plus time per map)

What makes today's maps feel weak (from `missions.js`):

- 19 of 20 are mirrored top to bottom, so both flanks always play the same.
- You always start at row 7, column 2 (mission 12 uses column 1), and enemies always start on the
  right half.
- Blocks are mostly 2×2 squares and straight bars over lots of open floor, so few maps have
  corridors, pockets or flanking routes.
- Crates and holes are mostly scattered, not used for their mechanics.

Guidelines for new and reworked maps:

- Give each mission one idea: a corridor fight, a crate wall that a mine opens, a hole lane
  that's a firing line you can't cross, a sniper in a pocket, a maze.
- Vary where you start (bottom-left corner, top-left, mid-left) and break the symmetry sometimes.
- Give stationary tanks cover pockets you have to work around; put minelayers where corridors
  make mines count.
- Use crates as gates (mine them to open a shortcut) and holes as lanes (shells cross, tanks
  don't).
- Make room for the new enemies: open ground for mortars (W2), corners and walls for missiles
  (W1) to break on.

**Shipped:** all 20 maps rebuilt, one idea each (see M4 for the list), with Red and Olive
introduced in missions designed for them (12 and 15). Starts are in 9 different places. Only
Mirror match (10) is mirrored, on purpose. Crates are gates (Crate gate, Switchbacks, Fortress),
holes are a lane (Across the pits), turrets sit in pockets (Crossfire, Pillboxes), and the
mortar missions keep open ground. Every map passes the M3 checks and the AI tests, and was
playtested with the bot in `scripts/playtest.mjs` (`npm run playtest`) in two modes: an expert
that wins every mission at least 6 times in 8, and a casual one that shows the difficulty
curve (easy through mission 9, then a climb to a finale it rarely wins, with easier
introductions for Red and Olive).

**Not met:** density. Most maps are 76–89% open, so the 75% nudge fires on 19 of 20. Denser
drafts gave Pinks and Violets many more walls to bank off, and the middle of the campaign got
much harder. Worth another pass with the editor.

### M3. Map quality checks
**Status:** done 2026-10-13 · **Size:** S

Extra tests or editor warnings, beyond "is it winnable":

- No enemy has a clear straight shot at your start position.
- No two missions have identical block layouts.
- Warn when more than about 75% of the floor is open, or when the map is mirrored (a nudge, not a
  failure).

**Shipped:** `guide/mapcheck.mjs` (now `src/games/tanks/mapcheck.js`, M8). Errors, which the tests reject: the parser's rules, 1–8
enemies, every enemy reachable, no clear straight shot at your start (mortars excepted, since
they lob), and no two missions with the same blocks. Nudges, shown in the editor: more than 75%
open, and mirrored. The tests run it over every mission and check that it catches each problem.

---

### M4. Mission names and briefings
**Status:** done 2026-10-13 · **Size:** S

Each mission gets a name and a one-line briefing that states its idea, in English and Catalan
(`tanks.name.<n>`, `tanks.brief.<n>` in `i18n.js`).

**Shipped:** shown on the mission banner, with any warnings for the kinds present (the banner
stays up a little longer when there's more to read; a tap still skips it), and in the guide's
map tiles and viewer. The missions: 1 First contact, 2 Crossfire, 3 Patrol, 4 Crate gate,
5 Rocket range, 6 Switchbacks, 7 Bank shots, 8 Across the pits, 9 The maze, 10 Mirror match,
11 Pillboxes, 12 Lock-on, 13 Ghosts, 14 Hunter, 15 Artillery, 16 Crossroads, 17 Fortress,
18 Night shift, 19 Siege, 20 Last stand.

### M5. Playtest in the editor
**Status:** idea · **Size:** M

The guide already bundles `engine.js`, `ai.js` and `rules.js`, so a Play button could run the
map being edited with keyboard controls. The playtest bot (`scripts/playtest.mjs`) already plays
a draft from the command line (`npm run playtest -- --map draft.txt`); bundled into the page
too, it could show a win rate per map while editing.

### M6. Put Lime in the campaign
**Status:** idea · **Size:** M · **Needs:** W3

Lime only plays on the test range so far. Give it a mission with its one idea (cover you can
break line of sight behind, room to circle it), or add it to a late mission, then run
`npm run playtest` and keep the expert bot at 6 wins in 8.

### M7. Put Hornet (now Night Yellow, `Y`) in the campaign
**Status:** idea · **Size:** M · **Needs:** W4

Hornet plays on the test range only. Try it on a phone first, then give it a mission whose idea is
mines (a long approach with choke points, or Switchbacks-style corridors), or swap it in for a
Yellow in a late mission, and keep the expert bot at 6 wins in 8.

### M8. Your own maps: a map editor in the game
**Status:** done 2026-10-14 · **Size:** L

Next to Test and Play on the start sheet, players draw their own maps, save them on the phone
and play them. M1's editor is for writing campaign missions in the field guide; this one is for
players, so it works on a phone with a thumb.

**Shipped:** a Maps button opens "Your maps" (a docked sheet: the list, Edit, New map, Play). The
editor puts the tools under the arena in portrait and beside it in landscape: Wall, Crate, Hole,
Erase, You, Enemy (a sheet with every kind) and Undo, drawn with the game's art, with a line
saying what the map still needs and a square Play in the header. Drags paint every cell they
cross; a tank follows the finger until it lifts. The side menu has Your maps, Mirror painting,
Rename and Delete map. The rules a map must meet live in `maps.js` (`mapReport`, on top of
`mapcheck.js`, which moved from `guide/` into the game so the game can ship it): your tank, 1 to 8
enemies, each within reach; a clear shot at your start is only a note. A map plays like a test
(nothing saved mid-battle, no record) and ends back where it started. Maps are saved in
`gh:tanks:maps`, so Settings' Export and Import carry them.

**Later:**

- Share a map with a friend as a short code (like Sudoku's 81-character puzzle string) and
  enter one to add it to Your maps.
- Start a new map from a campaign mission or the test range instead of open floor.
- A best time per map of yours.

### M9. Crates that warn
**Status:** idea · **Size:** S

From the Paint Study.

- **Cracks as warning:** a crate within reach of a mine or a landing bomb shows a crack while the
  danger lasts, so you see what the blast will clear.
- **Cracked crates:** if crates ever take two hits, a hit crate shows a crack.

### M10. Night missions
**Status:** idea · **Size:** L

From the Paint Study: the arena goes dark and the light comes from the field (flames, mine lights,
missile lights, burning wrecks). Needs a rule for what the AI can see in the dark; today every
enemy knows where you are, through walls. Not the same thing as night versions (N1), though they
would suit each other.

### M11. Fewer one-cell gaps
**Status:** idea · **Size:** S (the check) + M (the maps)

The campaign has too many places a tank can only squeeze through. Measured as *tight spots*
(groups of floor cells that no 2 × 2 square of drivable floor covers, the arena's edge counting
as wall): today's maps average 5.6 each (up to 12 in Night shift), the Alpha maps 3.0. Pol
prefers the older, more open maps; a one-cell gap is good now and then, not everywhere. Tight
spots are also where tanks jam (A1).

- In `mapcheck.js`, replace the "more than 75% open" nudge (it pushes toward denser maps, which
  is how the gaps crept in) with a nudge for more than about 2 tight spots, ringing each one.
  The measure is there already: `tightSpots` (M13).
- Rework the worst maps with the editor, then `npm run playtest`.

### M12. Random battles: generated maps that suit their enemies
**Status:** idea · **Size:** L · **Needs:** M13 (done: the generator and the sizes)

A mode beside Play, Test and Maps: battle after battle, each with a roster and a map made for it
from a seed, so a battle can be shared as a short code (or a daily seed everyone plays).

- **Shape of a map:** pieces (pillars, 2 × 2 blocks, bars, Ls, Ts, bays, crate lines, pits)
  placed one by one, each kept only if the map still has at most the theme's 0 to 2 tight spots
  and every floor cell can be reached. Pieces keep apart unless they join on purpose, so blocks
  read as shapes. Symmetry varies (none, top to bottom, turned 180°), and so does your start.
- **Themes from the roster:** banks (Pink, Green, White: long straight faces), open
  (Lime, Black, Olive: room to circle and dodge, a few things to break sight), corners (Red, Cream:
  short walls a missile breaks on), lanes (Yellow and its night version: two-wide routes where a
  mine counts), pockets (Brown: turrets dug in). The lead kind picks the theme (`themeOf` in
  `mapgen.js`, from what the kind does, so a new kind gets one too).
- **Every map winnable:** `checkMap`, then the expert bot (moved from `scripts/playtest.mjs` into
  the game folder, DOM-free) must win it; otherwise try the next seed. Make the next battle in a
  worker while this one plays.
- **Difficulty:** a threat budget per battle buys the roster, calibrated against the casual bot.
  The same roster can be easy or hard depending on the map, so measure, don't guess.
- **Prototype (2026-10-15, scratch):** 12 maps over the five themes at 20 × 15, 2 to 8 ms each,
  0 to 2 tight spots (0.8 on average), 85% open, expert bot 8/8 on 11 of them (5/8 on one).
  The casual bot won anywhere from 0/8 to 8/8, which is why difficulty needs its own step.
- **Arena size:** any of M13's sizes. Try them on a phone in the editor first: a cell is about
  23 pt on an iPhone SE in portrait at 20 × 15, about 15 pt at 32 × 24.
- **Generated maps today (M13, 8 seeds a size, 3 runs each):** the expert bot won 132 of 144
  (20 to 24 of 24 at every size); the casual bot 20 of 24 at 12 × 9, down to 6 of 24 at 28 × 21
  and 32 × 24, which get 5 or 6 enemies. Its hardest maps: three or four Limes at 20 × 15, four
  Blacks with two Reds at 32 × 24.

### M13. Map sizes and a Generate button in the editor
**Status:** done 2026-10-15 · **Size:** M

Maps of your own come in six 4:3 sizes, 12 × 9 to 32 × 24 (`SCALES` in `rules.js`); missions
stay 20 × 15. A world's grid says its own size (`gridSize`): `cellAt`, the engine, the AI (`fit`
at every exported function), the renderer (laid out again when the size shown changes), the
editor, `mapcheck.js` and the playtest bot all read it from there. In the editor, the side menu's
Map size resizes a map round its middle (one undo step; you are never cut off), and a new map
starts at the size last picked. Generate (a die, beside Play) makes a map at the current size
with `mapgen.js`: the M12 generator, with a lead kind at random, a kind or two beside it, and the
line under the arena saying what the map was made for ("Made for Green: long walls to bank shots
off."). `tests/mapgen.test.mjs` covers both.

## C. Controls and screen

### C1. A 4:3 arena that fills the screen
**Status:** done 2026-10-13 · **Size:** M

The arena is 20 × 15 cells, 4:3 (`COLS` in `rules.js`). It was briefly 27 × 15 (16:9), with the
missions only padded with blank floor; it went back to 4:3, which is shorter when upright on a
phone, and the maps to their 20 columns. On a phone in portrait it is turned upright and
fills the width right under the header; any room left below stays empty. In landscape there is
no header band: the home button floats in the top-left corner and mission and lives in the
top-right, and the arena fills the height, centred on the screen. (Since 2026-10-14 every game
page does this in landscape, from the shared header.) (A rail
down the right side came first, but it pushed the arena and the aim stick off centre.) The
controls float over the play area instead of taking a band of their own.

### C2. Brawl Stars controls
**Status:** done 2026-10-13 · **Size:** M

- The touch controls float over the whole play area at 20% opacity (`--pad-alpha`). The sticks
  rest in the bottom corners and jump to wherever a thumb lands on their half, in portrait and
  landscape alike. Since 2026-10-14 only the bottom half of the screen starts a stick; touches
  higher up do nothing.
- Left half: drive. Right half: drag to aim (the aiming guide shows), let go to fire; drag back
  into the middle quarter of the stick's reach to cancel (the knob, a shell pointing along the
  aim, goes hollow). A tap that never leaves the middle fires straight at the nearest enemy you
  can see, with no ricochet or lead (since 2026-10-14: only one in sight within 6.5 cells, see C5).
  Invisible tanks are skipped, so the auto-aim can't give them away.
- The mine button sits on the right edge, halfway down, in line with the aim stick (in portrait,
  since 2026-10-14: in the middle of the bottom row, between the two sticks).
- Touching the arena no longer fires. The mouse still aims and clicks to fire.

### C3. A drive stick that stayed stuck
**Status:** done 2026-10-13 · **Size:** S

The old sticks followed pointer events and let go only on that pointer's `pointerup` or
`pointercancel`. When iOS dropped one (it can with several fingers down, or when a system
gesture takes over), the stick stayed held at its last deflection and ignored new thumbs on its
pad until the next pause. The sticks now follow touches by identifier, and every touch event
(on the pads or anywhere else) checks its `touches` list: any stick or button whose finger isn't
on it is let go. A new thumb on that half takes over at once. Losing focus or hiding the app
also lets everything go. On a Mac, pressing Cmd clears held keys, because macOS sends no keyup
for keys released while Cmd is down.

### C4. A home button with a side menu instead of back and pause
**Status:** done 2026-10-13 · **Size:** S

The header had a back button that left mid-battle and a separate pause button. Now one home
button opens a side menu: the options run down the left edge over a progressive blur, hardest at
that edge and sharp again toward the right. Opening it pauses the battle (or holds a banner),
and closing it plays on: Resume, tapping beside the list, the home button again, Escape or P.
The home button keeps its icon while the menu is open: Resume already says how to get back, so
a close icon only repeated it (dropped 2026-10-14). The list holds Resume, Quit campaign and Back to games; Quit only
while a mission is on. Since 2026-10-14 Resume is always there, the list has no title, the arena
fades out and blurs behind it instead of a blur from the left edge, holding the home button goes
straight back to the games, and Sound is one switch for the whole app in Settings. Leaving the app opens it, so a killed app reopens with it open. The menu
is shared (`.side-menu` in `styles.css`, `setupSideMenu` in `shared/ui.js`), so Sudoku can switch
to it too.

### C5. A tap that doesn't waste its shot on a wall
**Status:** done 2026-10-14 · **Size:** S

A tap on the aim stick fired at the nearest enemy, even one behind a wall, so the shell died on
the wall. Now it picks the nearest enemy a straight shell would reach (`tapTarget` in `ai.js`):
one behind a wall or crate is passed over for the next nearest in sight, while holes don't hide
anything because shells fly over them. Only enemies within 6.5 cells count (`TAP_RANGE` in
`rules.js`; it shipped at 5, then 8, and settled on 6.5 the same day). With none, the turret stays
where you last aimed and the tap fires that way. Invisible tanks are still skipped.

### C6. A stick that shows when a tap will hit
**Status:** done 2026-10-14 · **Size:** S

While a tap would fire at an enemy (C5), the aim stick shines: it leaves the controls' 20%
opacity for a brighter rim, its shell turns white with a glow, and a ring keeps spreading from the
shell out to the rim. The turret follows that enemy and the shell points at it, so you see where a
tap will go. As soon as a thumb drags the stick it aims by hand and the stick looks as usual; the
thumb that started the mission (which can't fire) doesn't make it shine either. Under reduced
motion the ring doesn't spread; the rest still shows. `showTapAim` in `tanks.js`, `.stick-aim.ready`
in `tanks/styles.css`.

### C7. Test range
**Status:** done 2026-10-14 · **Size:** S

A **Test** button on the start sheet opens a docked "Test range" sheet: pick one enemy kind (a
grid of the game's own badges, `.segmented.is-grid`) and how many, 1 to 6, and the range is drawn
behind the sheet as you choose. The map (`testMap` in `missions.js`) is four short walls, columns
2, 6, 13 and 17 down rows 4 to 10, so side on your half reads `_|__|__` and theirs `__|__|_`. You
start at the far left; the enemies take fixed spots on the right. A test leaves the campaign
alone: it is never saved, nothing counts toward the record, the header shows Mission "Test" with
no lives, and the side menu's Quit becomes **End test**. When it ends (cleared or destroyed) the
banner shows and you are back on the range sheet. The last pick is kept in `prefs.test`.

### C8. Ammo in the header, and a cleaner mine button
**Status:** done 2026-10-14 · **Size:** S

- **Meters:** under Mission and Lives, one small icon per shell (5) and per mine (2) you hold,
  filled while ready and hollow while out: a row in portrait, columns down the right edge in
  landscape. They are a shared header part (`.stat-meters`, `.meter` and the two-state `.slot` icon
  in `styles.css`); `renderAmmo` in `tanks.js` updates them only when a count changes, and the group
  reads "Shells ready: 4 of 5. Mines ready: 1 of 2." to a screen reader (`tanks.ammo`).
- **Mine button:** the two dots under its icon are gone (the meters count instead). It has the
  sticks' 3 px rim and fill with a button's 8 px corners, 68 px (64 on narrow phones), its mine turns
  hollow while both of yours are down, and it shrinks a little while pressed. The pixel mine icon
  comes from `shared/icons.js` (`i-mine`, `i-mine-empty`).

### C9. An arena that runs to the screen's edges
**Status:** done 2026-10-15 · **Size:** M

The dark frame round the arena and the page's side padding are gone. The arena's canvas covers
the whole screen, and all of it round the field is brick wall (the rules already call everything
outside the map wall).

- **Portrait:** the field fills the width but for half a cell of wall each side, with two cells of
  wall over it starting right under the header (it used to sit 10 px lower, then centred). Past
  those two cells, above and below the field, the wall blurs out deeper toward the screen's top and
  bottom under a shade to the background, the launcher's top edge (`.pblur-deep`, shared).
- **Landscape:** the field fills the height but for half a cell of wall top and bottom, centred.
  Past two cells of wall left and right, the wall in the gutters blurs out toward the screen's
  sides, with no shade.
- **Cost:** everything past the wall's first cell is drawn once per layout; a crate blown away or
  an editor stroke redraws only the field and that cell (`buildFloor` in `render.js`).
  `drawGround` in `art.js` takes an `area`, so it can draw cells past the field.

A first version (same day) kept floor past the field, blurred toward the edges in the canvas, with
a single wall only on the sides facing the header or the gutters; it went for wall all round.

## P. Polish

Art only: none of it changes what a player can learn or do. From the Paint Study, under R6's
light. Time each on an iPhone (a 3x screen).

### P1. Tanks with weight
**Status:** in progress (Recoil and Exhaust puffs done 2026-10-15) · **Size:** M

- **Recoil** (**done** 2026-10-15)**:** the barrel kicks back about 0.06 cells as it fires and eases
  out over 150 ms. One number per tank. Shipped, then redone the same day because 0.06 cells (about
  1.4 px on a phone) couldn't be seen: `drawTank` takes `fired` (seconds since the shot, world time,
  so it holds while paused) and `recoilAt` in `art.js` works out the rest from `RECOIL`. The gun
  slides back in 30 ms, holds a beat and runs out over about 300 ms (shell 0.15 cells, a third of
  its visible barrel; rocket 0.17; missile pod 0.12; minigun 0.04 a round, so it shudders while it
  sprays). The turret jolts back 0.035 to 0.05 cells (the hull a third of that, a pad not at all)
  and settles like a spring, about 15% past rest and back. A mortar's tube punches down 32% of its
  size on the same spring and its turret gives a little; dust bursts out from under the pad.
  Everything is at rest by 0.85 s. Kept pictures cover it (the slide in eighths in `POSE`, the jolt
  as where the parts are laid), and a test holds the timing.
- **Red's launcher** (**done** 2026-10-15, from a bug report)**:** its pods looked as if they swung
  round the turret's edge instead of turning about its centre: the bright light sat behind the
  centre and circled as the turret turned, and two parallel pods offset sideways slide round the
  rim. The light is now on the turret's axis and the pods sit in a mount fixed to the turret; they
  still fire in turn, and only the pod that fired slides back through the mount.
- **Exhaust puffs** (**done** 2026-10-15)**:** two small puffs from the rear as a tank pulls away or
  turns hard, from the smoke the game already draws. Shipped: on moving after 0.3 s still, or after
  turning 0.8 rad at over 60% of its turn rate, at most every 0.5 s. Never from White, which they
  would give away.
- **Sprockets:** a wheel at each end of each tread, turning with the cleats, so a tank turning on
  the spot shows it.
- **Suspension:** the hull rides a hair up and down over its treads while it drives.
- **Drop-in:** in the 1.2 s hold at a mission's start each tank lands: its shadow grows first,
  then it settles with a small dust ring.
- **A toy's shine:** a small soft highlight on every turret toward the light.

### P2. Shots
**Status:** in progress (Ricochet sparks and a muzzle done 2026-10-15) · **Size:** S

- **Ricochet sparks** (**done** 2026-10-15)**:** a short spark and a pale chip on the wall face where
  a shell bounces, fading in a second. It teaches the bank shots the AI makes. Shipped: `bounce`
  and `pop` events carry the face's normal and the weapon, so sparks fly off the face (white and a
  few orange streaks), with a flash and a puff of the block's dust; the chip is P3's Wall wear,
  held a second and faded over two, so it stays long enough to read a bank line.
- **Muzzle** (**done** 2026-10-15, added on the way)**:** a flame along the shot, white-hot at its
  root (a rocket's muzzle brake also blows out of its sides), a flash of its light on the floor,
  smoke pushed out after it and a few sparks. A missile's backblast blows smoke out behind the
  tank; a minigun round gets a small flame and its casing.
- **Trails by owner:** a rocket's smoke takes a hint of its owner's colour.
- **Drawn, then left out:** a rocket's flame lighting the floor; a band in the owner's colour on
  rockets and rounds.

### P3. The arena
**Status:** idea · **Size:** M to L

- **Wrecks:** a destroyed tank leaves its hull, dark and without its turret, on its scorch mark for
  the rest of the mission. Decoration only; it never blocks.
- **Crate rubble** (**done** 2026-10-15)**:** a broken crate leaves a few splinters where it stood.
  Shipped: four to six slivers and two chunks in the crate's greys, each over a small shadow along
  the light, on the static floor for the rest of the mission (`drawRubble`).
- **Wall wear** (**done** 2026-10-15)**:** a ricochet leaves a pale chip on the wall that fades in a
  few seconds. Shipped (`chip` and `drawChips` in `render.js`): on the block, a soft bloom of dust
  along the face; a pale flake spalled off the edge with a thin shadow under its rim toward the
  light; a dark pock in it whose far rim catches the light; a short fan of tapering cracks into the
  block; and crumbs on the floor in front. A shot that dies on the face leaves a bigger one with
  more cracks, scorched by a rocket or missile; a minigun round, a small one with no cracks for
  1.5 s. Clipped to the blocks, gone with a crate, at most 90. A first version (a pale blob with
  hooked black cracks) looked cheap and was redrawn the same day.
- **Soft scorch:** scorch marks as soft dark stains, darkest in the middle, in place of today's
  crossed strokes.
- **Spawn marks:** faint corner brackets where each enemy and you start, so a retry shows which
  ones come back.
- **A tray:** the arena's frame drawn as a wall under the same light, so the tanks sit in a tray.
- **Dust in the light:** a few slow motes drifting through the light; off under reduced motion.
- **Pits you can see into:** a faint glow or a grate far down, so a pit never reads as a black
  tile on a dark floor.
- **Hazard edging:** low yellow-and-black kerbs where a pit meets open floor.
- **Chapters:** a second wall material for later chapters (steel plates with rivets), a floor per
  five missions (concrete, packed earth, steel deck, a dark hangar, all dark enough that the kind
  colours still lead), and the light moving from morning to evening across the campaign.

### P4. Sprites per angle
**Status:** idea · **Size:** M

Only if soft tanks cost too much on a phone: draw each kind's lit hull and turret once at 64
angles and reuse them, with cleats and moving parts drawn over.

## Suggested order

Every entry has shipped (the last, M8, on 2026-10-14) except A3, M5, M6, M7 and the ideas added
on 2026-10-15 (R7, R8, N1–N3, M9, M10, P1–P4). Next:

1. **C1 and C2 on a real iPhone:** the floating home button and stats in landscape, the stick
   size, the cancel zone and the 20% opacity.
2. **Tuning:** Red, Olive and the new lead tiers together (W2's flight time first), then **A3**.
3. **M5.**
4. **N1:** drop the lines (mostly removal), then N2 and N3 once Red and Lime are tuned.

## Parking lot

Loose ideas that don't have an entry yet. Nothing waiting.
