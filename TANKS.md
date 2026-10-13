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
**Status:** idea · **Size:** S

The engine, renderer and field guide decide "rocket" with `T.shot > 6`. Missiles and mortar bombs
can't be told apart by speed. Add `weapon: 'shell' | 'rocket' | 'missile' | 'bomb'` to each kind
in `TYPES`, and put `weapon` on each bullet instead of `rocket: true`.

- Touches: `rules.js` (TYPES), `engine.js` (`fire`, bullets), `render.js` (`drawShell`, smoke),
  `audio.js` (shot sounds), `guide/` (rocket checks), tests.
- Done when: nothing reads `shot > 6` any more and every test passes unchanged.
- Groundwork for W1 and W2.

### R2. A visual language for abilities
**Status:** idea · **Size:** M

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

### R3. A colour plan that won't run out
**Status:** idea · **Size:** S

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

---

## W. New enemies and weapons

### W1. Guided missile tank
**Status:** idea · **Size:** M · **Needs:** R1 (R2 nice to have)

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

### W2. Mortar tank (indirect fire, a new category)
**Status:** idea · **Size:** L · **Needs:** R1

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

---

## A. AI

### A1. Tanks jam in narrow gaps and shove each other
**Status:** idea · **Size:** M

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

### A2. Smarter aim: shoot where you're going
**Status:** idea · **Size:** M

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

---

## M. Maps and missions

### M1. A map editor
**Status:** idea · **Size:** M

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

### M2. Stronger layouts
**Status:** idea · **Size:** M (plus time per map)

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

### M3. Map quality checks
**Status:** idea · **Size:** S

Extra tests or editor warnings, beyond "is it winnable":

- No enemy has a clear straight shot at your start position.
- No two missions have identical block layouts.
- Warn when more than about 75% of the floor is open, or when the map is mirrored (a nudge, not a
  failure).

---

## Suggested order

1. **A1** fixes a bug you can see in today's game.
2. **R1, R2, R3** are the groundwork, so new enemies arrive readable.
3. **M1** then **M2**: an editor makes it fast to rework the weak maps and design missions for new
   enemies.
4. **W1**, then **W2**, each introduced in missions designed for it.
5. **A2** last. Lead, missiles and mortars all make the game harder, so tune them together.

## Parking lot

Loose ideas that don't have an entry yet:

- Mission names and a one-line briefing for each mission (EN and CA).
