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

- **Barrel:** thin for shells; thick with a fire-orange band for rockets; twin launch pods and a
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
  crate yellow next to the existing yellow tank.
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

---

## A. AI

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

**Shipped:** `guide/mapcheck.mjs`. Errors, which the tests reject: the parser's rules, 1–8
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

## C. Controls and screen

### C1. A 4:3 arena that fills the screen
**Status:** done 2026-10-13 · **Size:** M

The arena is 20 × 15 cells, 4:3 (`COLS` in `rules.js`). It was briefly 27 × 15 (16:9), with the
missions only padded with blank floor; it went back to 4:3, which is shorter when upright on a
phone, and the maps to their 20 columns. On a phone in portrait it is turned upright and
fills the width right under the header; any room left below stays empty. In landscape there is
no header band: the home button floats in the top-left corner and mission and lives in the
top-right, each on a black plate, and the arena fills the height, centred on the screen. (A rail
down the right side came first, but it pushed the arena and the aim stick off centre.) The
controls float over the play area instead of taking a band of their own.

### C2. Brawl Stars controls
**Status:** done 2026-10-13 · **Size:** M

- The touch controls float over the whole play area at 20% opacity (`--pad-alpha`). The sticks
  rest in the bottom corners and jump to wherever a thumb lands on their half, in portrait and
  landscape alike.
- Left half: drive. Right half: drag to aim (the aiming guide shows), let go to fire; drag back
  into the middle quarter of the stick's reach to cancel (the knob, a shell pointing along the
  aim, goes hollow). A tap that never leaves the middle fires straight at the nearest enemy you
  can see, with no ricochet or lead.
  Invisible tanks are skipped, so the auto-aim can't give them away.
- The mine button sits on the right edge, halfway down, in line with the aim stick.
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
a close icon only repeated it (dropped 2026-10-14). The list holds Resume, Sound, Quit campaign and Back to games; Resume and Quit only
while a mission is on. Leaving the app opens it, so a killed app reopens with it open. The menu
is shared (`.side-menu` in `styles.css`, `setupSideMenu` in `shared/ui.js`), so Sudoku and 2048
can switch to it too.

## Suggested order

Every entry except A3 and M5 has shipped (the last on 2026-10-13). Next:

1. **C1 and C2 on a real iPhone:** the floating home button and stats in landscape, the stick
   size, the cancel zone and the 20% opacity.
2. **Tuning:** Red, Olive and the new lead tiers together (W2's flight time first), then **A3**.
3. **M5.**

## Parking lot

Loose ideas that don't have an entry yet. Nothing waiting.
