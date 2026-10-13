# Cache Only — offline-first PWA

## What this is

A small collection of games packaged as one installable PWA, published on GitHub Pages at
**https://cache-only.github.io/** (repo `cache-only/cache-only.github.io`; every push to `main`
deploys). Friends only need a connection to install the app, download games or pick up
updates. After that, every downloaded game must run forever with no network. Being offline is
the normal state, not an error.

Games at launch: **Sudoku** and **2048**. **Tanks** came next; more will be added later, and
each friend chooses which ones to keep.

Everything below exists to protect one property: once a game is downloaded, it never needs
the network again.

## Hard rules

- **Zero runtime network dependencies.** No CDNs, no Google Fonts, no analytics, no remote
  images, no `fetch` to anything outside the packs. If it isn't in `dist/`, it doesn't exist.
  The one runtime request is the launcher's `/version.json` check for whether it's online,
  and it is allowed to fail.
- **No app dependencies.** Vanilla HTML, CSS and ES modules. No framework, no bundler.
  Node is used only for the build and dev-server scripts, which use built-ins only (no `npm install`).
- **Every file the app can ever request must be in a pack:** the app shell (everything outside
  `games/`, cached at install) or the pack of the game whose folder it lives in (downloaded on
  request). The build generates the packs automatically, so never hand-maintain a file list,
  and never make a game, or the launcher, depend on a file inside another game's folder.
- **No redirects anywhere.** Safari refuses navigation responses from a service worker that
  were redirected. All links use the trailing-slash form (`/games/sudoku/`), which GitHub Pages
  and the dev server both serve directly. (Pages 301s `/games/sudoku` to the slash form; the
  app never requests that, and the worker refuses any redirected download.)
- **The origin is sacred.** The origin is `https://cache-only.github.io`. It is where every
  install and every save lives. Never rename the `cache-only` organization or the repo, never
  add a custom domain, and never publish anything else on this origin. Changing any of these
  means every friend installs again and moves their saves by hand.
- Target **iOS Safari home-screen web apps** first, then Chrome and Android.

## Layout

```
cache-only/
  CLAUDE.md
  TANKS.md                # Tanks backlog, by category
  package.json            # "type": "module", scripts only, no dependencies
  src/
    index.html            # launcher
    launcher.js
    styles.css            # shared tokens and base styles
    manifest.json         # use .json, not .webmanifest (MIME safety)
    sw.template.js        # service worker source; build injects VERSION and PACKS
    registry.json         # list of games shown in the launcher
    shared/
      storage.js          # namespaced save/load + export/import
      sw-client.js        # registration, update prompt, "ready offline" check, downloads, online check
    icons/
      apple-touch-icon.png  # 180x180, no transparency
      icon-192.png
      icon-512.png
      icon-maskable-512.png
    games/
      sudoku/  index.html  sudoku.js  generator.js  solver.js  styles.css
      2048/    index.html  game.js  styles.css
      tanks/   index.html  tanks.js  engine.js  rules.js  ai.js  missions.js  art.js  render.js  audio.js  styles.css
  scripts/
    build.mjs             # src -> dist, split into packs, write dist/sw.js
    serve.mjs             # static server for dist/ on :8080
    guide.mjs             # builds the Tanks field guide (not part of the app)
  guide/
    page.html             # field guide template: layout, styles, page code (draws with the game's art.js)
    enemies.mjs           # field guide text and card scene per enemy kind
    mapcheck.mjs          # map checks shared by the tests and the guide's map editor
    out/                  # built guide, gitignored
  dist/                   # build output, served, gitignored
  .github/workflows/
    pages.yml             # on push to main: npm test, npm run build, deploy dist/ to Pages
```

Each game is a self-contained folder with its own `index.html`, and that folder is the game's
download pack. The launcher navigates to `/games/<id>/` once the game is downloaded. One
service worker with scope `/` covers everything.

## Build (`scripts/build.mjs`)

1. Wipe `dist/` and copy `src/` into it, excluding `sw.template.js`.
2. Walk `dist/` and split the files into packs: everything under `/games/<id>/` is game `<id>`'s
   pack (a game folder without a `registry.json` entry fails the build), everything else is
   the app shell (`core`). In each pack, every `.../index.html` also gets its directory URL
   `.../` (navigations request the directory form).
3. Hash each pack's files (path and content) into a 12-hex version. Caches are named
   `gamehost-core-<hash>` and `gamehost-game-<id>-<hash>`, so a game that didn't change keeps
   its cache across releases. `VERSION` is the first 12 hex characters of a SHA-256 over every
   file and the SW template.
4. Write `dist/sw.js` from the template with `VERSION` and `PACKS` (`{ core, games }`, each pack
   with `cache`, `files`, `hashes` (16 hex of each file's SHA-256) and `bytes`) **inlined as
   literals**. Do not use `importScripts` for the
   manifest, because the byte change has to live in `sw.js` itself for updates to be detected
   reliably.
5. Write `dist/version.json` with `{ version, builtAt, files, bytes, core, games }`. It is never
   cached: the launcher fetches it to learn whether it's online.
6. Print each pack's size and warn when everything together is above 25 MB.

## Dev server (`scripts/serve.mjs`)

- For local testing only (production is GitHub Pages). Uses Node `http` only and serves `dist/`
  on `127.0.0.1:8080`.
- Sets correct MIME types: `.js`/`.mjs` → `text/javascript`, `.json`, `.png`, `.svg`,
  `.woff2`, `.html`.
- Serves `/` and `/games/x/` by sending `index.html` directly, with no redirect. A
  directory URL without its trailing slash gets a 404, not a 301.
- Sends `Cache-Control: no-cache` on `sw.js`, `index.html` files and `version.json`.
- Logs each request so installs can be watched live.

## Service worker (`sw.template.js`)

- **install:** fill the app-shell cache; then, for an update, re-download at the new version
  every game the device already has in any cache (including the single cache from before packs
  existed). Fetch each file as `<url>?v=<hash>` with `{ cache: 'reload' }` and store it under
  the plain URL. If any response is not `ok`, has `redirected === true`, or its SHA-256 doesn't
  match the hash, throw so the install fails as a whole and the old version keeps serving.
  GitHub Pages' CDN caches files for up to 10 minutes and ignores `cache: 'reload'`, so right
  after a push it can serve the previous release; the hash check keeps that out of the caches.
  Downloads use the same check. Files that already arrived stay, so a retry only fetches the rest. Do not call
  `skipWaiting()` here.
- **activate:** delete every cache that isn't the current app shell or a current game pack, then
  call `clients.claim()`.
- **fetch:** handle same-origin GET requests only, from the cache of the pack that owns the URL.
  - Navigations: normalize the path (add a trailing slash if a pack holds the `.../` form) and
    look it up with `ignoreSearch: true`. A game that isn't downloaded goes to the network, and
    while offline falls back to the cached launcher `/`.
  - Everything else: cache-first. On a miss, try the network, but **never write runtime
    responses into the cache**. Only an explicit download fills a pack.
- **message:** `SKIP_WAITING` calls `self.skipWaiting()`. `GET_MANIFEST` replies
  `{ version, core, games }`. `REPAIR` refills missing app-shell files. `DOWNLOAD { ids }` fills
  those game packs one after another, replying `progress`, `game` and `done` on the port.
- **Updates:** while offline, the update check fails quietly and the old worker keeps serving,
  which is correct. When online and a new worker is waiting, the launcher shows "Update
  available. Reload to update." A push reaches phones within about 10 minutes (the CDN's cache
  time; `sw.js` is registered with `updateViaCache: 'none'`). Never auto-reload mid-game. A game
  downloaded while an update waits is also sent to the waiting worker, so the reload keeps it.

## Launcher

- **In a browser tab** (not standalone: `navigator.standalone !== true` and not
  `display-mode: standalone`) the launcher shows only how to install: "Tap Share, then Add to
  Home Screen, then open the app from the new icon." No game list and nothing to download.
- **In the installed app**, a list of games from `registry.json` (`id`, `name`, `path`,
  `description`). A game is on this device (Play, plus a resume hint if it has a saved
  session), downloadable (Download with its size), downloading (a percentage, or "Queued"), or
  out of reach.
- **Downloads** are offered only while the host answers. The launcher fetches `/version.json`
  (no-store, cache-busting query, 5 s timeout) on start, every 15 s while visible, on
  `online`/`offline`, and when the app comes back to the foreground. While it answers,
  "Download all · size" sits on top of the list. When it doesn't, the download buttons disappear
  and games that aren't downloaded move to the bottom as "Go online to download".
- **"Ready offline" check:** after `navigator.serviceWorker.ready`, confirm every app-shell file is
  in its cache; show "Ready offline" with the version, or "Preparing the app… x/y". A game shows
  Play only when every file of its pack is cached, and "Every game is downloaded. Safe to switch
  on airplane mode." appears once nothing is left. These tell a friend it's safe to go
  offline, so they must be accurate.
- Call `navigator.storage.persist()` once and show the result in a small settings or info view.
- Settings view: export all saves (JSON via the share sheet or download), import saves,
  current version, games downloaded, storage persisted yes or no, and "Check for update".

## iOS / PWA requirements

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
- `<meta name="apple-mobile-web-app-capable" content="yes">` plus `mobile-web-app-capable`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black">`. Not `black-translucent`:
  older iOS lays a progressive blur over whatever sits under a translucent status bar. iOS 26+
  ignores this tag and `theme-color`, and draws installed apps under the status bar anyway. The
  header is pure black (`--bar`) so it continues the status bar seamlessly.
- **iOS 26/27 status-bar blur:** every page's `<body>` starts with
  `<div class="status-tint" aria-hidden="true"></div>`, a fixed strip in the header's black at
  the very top (at least 6px tall, at least 80% wide, within 4px of the top; iOS only). iOS then
  paints the status bar that solid colour instead of blurring what's under it, and keeps it solid
  while the launcher scrolls. It looks transparent because it matches the header; a truly
  transparent status bar can't avoid the blur. Source:
  https://modernwebweekly.substack.com/p/so-whats-up-with-the-ios27-blur
- The header sits directly under the status bar (`env(safe-area-inset-top)` padding only). The
  40px black band that used to keep text clear of the blur (`--edge-clear`) was removed once the
  tint fix made it unnecessary.
- iOS reads the status-bar style only when the app is added to the Home Screen: to test a change
  to it, delete the home-screen app and add it again.
- `manifest.json`: `display: "standalone"`, `start_url: "/"`, `scope: "/"`, `id: "/"`, plus
  `theme_color`, `background_color` and the icons.
- Respect safe areas with `env(safe-area-inset-*)` padding on the app shell.
- Add `touch-action: manipulation` on interactive elements (kills double-tap zoom) and
  `user-select: none` on game boards. Touch targets are at least 44×44 pt.
- iOS has no `navigator.vibrate`, so don't rely on haptics.
- Support both light and dark mode via `prefers-color-scheme`.

## Saves (`shared/storage.js`)

- Use `localStorage` with keys namespaced as `gh:<gameId>:<key>`. Store JSON with a
  `schema` number per game so formats can be migrated later.
- Write after every move, debounced to 250 ms, and on `visibilitychange` to hidden. iOS
  kills backgrounded web apps without warning.
- Export and import cover all `gh:*` keys in one JSON blob.

## Design

- Pick a deliberate, specific visual identity for the launcher and keep both games
  consistent with it through shared CSS tokens in `styles.css`. Avoid generic template looks
  such as identical rounded cards with soft grey shadows or gradient washes.
- Use system font stacks only, or a `.woff2` file committed under `src/fonts/` (it ships with
  the app shell automatically). Never a remote font.
- Game boards must stay square and fully visible on an iPhone SE and on a Pro Max in
  portrait, with no page scrolling during play.
- Respect `prefers-reduced-motion`.

## Game: Sudoku

- **Generator** (`generator.js`): fill a full grid with randomized backtracking, then remove
  cells in random symmetric pairs, keeping each removal only if the solver still finds
  **exactly one** solution (the count stops at 2). Difficulty targets givens:
  Easy 38–42, Medium 32–36, Hard 28–31, Expert 24–27. Use a seeded PRNG (mulberry32) so a
  seed reproduces the same puzzle.
- Run generation in a **Web Worker** (the worker file ships in the Sudoku pack like any other
  file) so Expert never freezes the UI. Show a brief "Generating…" state.
- **Sharing:** a puzzle can be shared as an 81-character string (`0` for empty). "Enter
  puzzle" accepts one, validates it, and rejects puzzles without a unique solution.
- **Input:** tap a cell, then use the on-screen number pad. Also support a notes (pencil)
  toggle, erase, undo and redo (unlimited, stored in the save), and a hint that fills one
  correct cell and counts toward stats.
- **Feedback:** highlight the selected row, column and box, highlight cells with the same
  digit, and mark conflicts (toggleable). Placing a digit clears that digit from the notes
  of its peers. A number on the pad dims once all nine of it are placed.
- **Timer** pauses on `visibilitychange` and when the pause overlay is shown.
- **Completion:** detected when the grid matches the solution. Show time, difficulty and
  hints used, and record best times per difficulty.
- **Save:** puzzle, solution, current grid, notes, undo stack, elapsed time and difficulty.
  Resume exactly where the player left off.

## Game: 2048

- Implemented from scratch: 4×4 grid, a new tile after each valid move (2 at 90%, 4 at 10%).
- **Input:** swipes on the board using pointer events with a ~30 px threshold and the
  dominant axis winning. Arrow keys work too. Call `preventDefault` on the board so swipes
  never scroll or trigger iOS back-swipe behaviour.
- **Correct merge rules:** each tile merges at most once per move, merges resolve from the
  direction of movement (`[2,2,2,2]` → `[4,4]`, `[2,2,2]` moving left → `[4,2]`), and a move
  that changes nothing doesn't spawn a tile.
- **Animation:** slide and merge transitions of about 100 ms using CSS transforms on
  absolutely positioned tiles. Inputs during an animation are queued, not dropped. Use
  instant updates under reduced motion.
- **Game states:** reaching 2048 shows a win prompt with "Keep playing" and "New game". When
  no moves remain, show game over.
- **Score and best score,** plus a single-step undo.
- **Save:** grid, score, best, won flag and undo snapshot, written after every move.
- Use a tile colour scale of my own design from the shared tokens, not a copy of the
  original game's palette.

## Game: Tanks

- Top-down tank battles in the style of Wii Play's *Tanks!*, with original code, art and sound.
  The arena is 20 × 15 cells. On a tall screen the renderer turns it 90°, so the player's side
  (the left of every map) sits at the bottom, next to the thumbs. Up on screen is always up for input.
- **Rules** (`rules.js`, `engine.js`): one hit destroys a tank. Shells ricochet off walls and crates;
  the player has 5 shells in flight with 1 ricochet each and 2 mines. Shells that meet cancel out
  (missiles too), your own shell can destroy you after a ricochet, and a barrel inside a wall fizzles.
  Each kind has a `weapon`: shells and rockets fly straight; missiles steer toward you (up to 2.2
  rad/s for 4 s, only while you are within 90° of the nose) and die on the first wall; mortar bombs
  fly over everything and land 1.5 s later on a spot marked on the floor. Mines go off after 10 s,
  when any tank comes close (the layer only once it has driven off), or when shot. A blast (a mine's
  1.5 cells, a landing bomb's 1.0) destroys tanks, shells and striped crates, sets off nearby mines,
  and never touches walls. Holes stop tanks, not shells.
- **Enemies** (`ai.js`, kinds in `rules.js`): brown, grey, teal, yellow, pink, green, violet, red,
  white, black and olive, differing in speed, weapon, ricochets, shots in flight, mines, aim (sweep,
  direct, bank shots found by mirroring the target in wall faces, guided missiles, or lobbed bombs),
  lead (an exact intercept on your smoothed velocity, stopped at walls), dodging, and invisibility for
  white. Enemies hold fire for the first 1.2 s of a mission and avoid hitting each other. Movers claim
  the cell they drive to, take turns by right of way, line up before narrow gaps, and back off when
  stuck, so they never jam.
- **Art** (`art.js`, drawn by `render.js` and by the field guide): shape tells you what a tank can do
  (barrel: weapon; treads or a concrete pad: moves or not; rear-deck discs: mines left), colour only
  which kind it is. The colour plan sits above the `--tk-*` colours in `tanks/styles.css`, and a test
  holds new colours to it.
- **Campaign** (`missions.js`): 20 missions, 3 lives, a bonus tank after missions 5, 10 and 15,
  which also unlock checkpoints (start at 6, 11 or 16). A retry keeps destroyed enemies destroyed.
  Each mission has one idea, a name and a one-line briefing (`tanks.name.<n>`, `tanks.brief.<n>`),
  shown on its banner. Every map must pass `guide/mapcheck.mjs` (the tests run it): every enemy
  reachable, no enemy with a clear shot at your start, no two missions with the same blocks.
- **Input:** touch has a floating drive stick (left), an aim stick that fires on release (right), a
  round mine button, and tap-to-fire on the arena. Keyboard and mouse: WASD/arrows, mouse to aim,
  click to fire, Space or right-click for a mine, P to pause. The on-screen controls only appear on
  touch devices.
- **Simulation:** fixed 120 Hz step, seeded RNG, and the whole world is plain JSON, so it is
  deterministic. Shells move along exact ricochet paths (`advance`/`tracePath`), so the aiming guide
  and the AI's bank shots match what really happens. Keep `engine.js`, `ai.js` and `rules.js` free of
  the DOM, and `art.js` drawing only on the context it is given.
- **Save:** the campaign at every mission start and end; the whole world on pause, hide and
  pagehide, so a killed app reopens paused mid-battle. `summary: { mission }` feeds the launcher.
- **Sound** is synthesised with Web Audio (no audio files). It follows the iOS silent switch
  (`navigator.audioSession.type = 'ambient'`) and can be muted from the pause screen.
- Leaving the app or the window pauses the battle. Under reduced motion there is no screen shake,
  fewer particles, no banner slide, steady lights on mines and missiles, and a static bomb mark.
- **Planned work** lives in `TANKS.md`, grouped by category with ids (R1, W1, A1…). New Tanks ideas
  go there; when one ships, mark it done with the date.

## Tanks field guide (keep it in sync)

A reference page for Tanks, published as a private claude.ai artifact:
**https://claude.ai/artifact/YKPsuThAVXPnPLm4Wwa5gN**. It shows every enemy kind (card, scene,
stats table, shared AI behaviour, aim styles), how to read a tank at a glance and the colour plan,
all missions as drawn maps with their names and an enemy matrix, how a map is written, and a map
editor that runs the tests' map checks live. It is not part of the app: it lives in `guide/`,
never under `src/`, and never ships in a pack.

`npm run guide` (`scripts/guide.mjs`) builds `guide/out/tanks-field-guide.html` from the game
itself: stats, kinds and spawn letters from `rules.js`, maps, checkpoints and bonus tanks from
`missions.js`, English kind names, mission names, briefings and kind warnings from `i18n.js`,
`LIVES` from `tanks.js`, and the `--tk-*` colours from the game's `styles.css`. The build also
bundles the game's `rules.js`, `ai.js`, `engine.js` and `art.js` and `guide/mapcheck.mjs` into the
page, so every tank, map and shot is drawn by the game's own art and the editor runs the same
checks as the tests. Enemy text and card scenes are in `guide/enemies.mjs`. Their numbers come
from `TYPES` and the rule constants, but behaviour written into the prose (sweep timing, the
bank-shot search, mine rules, lead, the missile's steering, the mortar's aim, the white tank's
fade) is copied by hand from `ai.js`, `engine.js` and `render.js`. So is the shared-rules text
in `guide/page.html` (right of way, stuck tanks and the rest).

**Rule: any change to the Tanks game ends with the guide updated and republished.** That covers
anything under `src/games/tanks/` and the `tanks.*` strings in `i18n.js`. In the same task:

1. If behaviour changed (AI, rules, weapons, mines or blocks), update the matching prose in
   `guide/enemies.mjs` and `guide/page.html`. Art changes need nothing: the guide draws with
   `art.js`. A new enemy kind needs a text entry and a scene in `guide/enemies.mjs`; the build and
   `tests/guide.test.mjs` fail without them.
2. Run `npm run guide` and `npm test`.
3. Republish with the Artifact tool: `file_path` = `guide/out/tanks-field-guide.html`,
   `url` = the link above, so the link stays the same. Then tell Pol it was updated.

## Adding a game later

1. Create `src/games/<id>/` with an `index.html` that links the shared `styles.css`, starts its
   `<body>` with the `status-tint` strip, and uses `shared/storage.js` with namespace `<id>`.
   Everything the game needs that isn't shared (scripts, workers, images) lives in its folder.
2. Add an entry to `src/registry.json`. The build fails if a game folder has no entry.
3. Run `npm run build`. The game's pack, its size and the version update automatically.
4. Follow the release steps below. Friends see the new game with a Download button the next
   time they open the app online; nothing downloads until they ask.

## Commands

```bash
npm run build                 # node scripts/build.mjs
npm run serve                 # node scripts/serve.mjs  (dist/ on :8080, local testing)
npm run guide                 # rebuild the Tanks field guide into guide/out/ (then republish it)
npm test                      # every test file, one at a time
```

## Releasing

Pushing to `main` is a release. `.github/workflows/pages.yml` runs `npm test`, then
`npm run build`, then deploys `dist/` with GitHub's Pages actions (Settings → Pages → Source is
"GitHub Actions"). A failing test stops the deploy and the live site stays as it was. No
`npm install` step: the scripts use Node built-ins only. Check the run in the repo's Actions tab.
Friends see the update within about 10 minutes, the next time they open the app online.

## Friend install procedure (keep this in README.md too)

1. The friend opens https://cache-only.github.io/ in **Safari**. It only shows how to install: tap Share, then
   **Add to Home Screen**.
2. The friend opens the app **from the home-screen icon** while still online. Home-screen
   apps have their own storage, separate from Safari.
3. Wait for "Ready offline", then tap **Download all**, or Download on just the games they want.
   A game is ready when it shows Play.
4. Turn on airplane mode, force-quit the app, reopen it and play a game. If that works,
   they're done for good. Games they skipped show "Go online to download" until they're back
   online.

## Testing checklist (run before every release)

- `npm test` passes. It runs the test files one at a time, because two of them build `dist/`.
- Chrome: install the app (the install icon in the address bar) to see the installed view; a
  normal tab only shows how to install. DevTools, Application tab: the service worker is
  activated, the app-shell cache is complete, each downloaded game's cache holds its whole pack,
  and "Offline" plus a hard reload still loads every downloaded game.
- No request in the Network tab goes to any origin other than `cache-only.github.io`.
- `curl -I https://cache-only.github.io/games/sudoku/` returns 200 (the slashless form is a
  301 on Pages and a 404 locally; nothing in the app requests it).
- On a real iPhone: install, Download all, go to airplane mode, force-quit, relaunch, and finish
  a move in each game. Kill the app mid-game and confirm it resumes. In airplane mode, games
  you didn't download show "Go online to download". The status bar is solid, not blurred.
- Update path: change a file, push, wait for the Actions run plus about 10 minutes, open the
  installed app online, and confirm "Update available" appears, then reload and check the new version shows and every downloaded game
  still plays offline.
- Sudoku: generated puzzles always have a unique solution. Add a script test that generates
  200 puzzles per difficulty and verifies uniqueness.
- 2048: unit-test merge rules with the edge cases listed above.
- Tanks: `tests/tanks.test.mjs` covers the map checks on every mission (reachable enemies, no free
  shot at your start, no repeated layouts), ricochets, bank shots, cancelling shells, limits,
  fizzles, mines and chain blasts, collisions, exact path prediction, weapons, guided missiles
  (turn limit, lock cone, fuel, shot down), mortar bombs (where and when they land, blast radius,
  minimum range, allies), deterministic save/resume with missiles and bombs in the air, jam-free
  movement (corridor passing, stuck recovery, no tank pinned over 1.5 s in any mission), lead aim,
  the colour plan, and mission names in both languages.
- Field guide: `tests/guide.test.mjs` builds the guide from the game and fails if an enemy kind has
  no text or scene, a mission has no name or briefing, a colour is missing, or the page script
  doesn't parse. It also checks that the game code bundled into the page behaves exactly like the
  game.
- Downloads: `tests/sw.test.mjs` runs the built service worker against an in-memory cache and a
  fake host. The shell installs alone, games download on request and resume after a failure,
  every file is fetched as `?v=<hash>` and a stale CDN copy is refused, and updates keep the games a device has (re-fetching only those that changed), including
  from the single cache used before packs.
