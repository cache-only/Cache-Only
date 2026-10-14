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
    styles.css            # the design system: tokens and the one component set every page uses
    manifest.json         # use .json, not .webmanifest (MIME safety)
    sw.template.js        # service worker source; build injects VERSION and PACKS
    registry.json         # list of games shown in the launcher
    shared/
      storage.js          # namespaced save/load + export/import
      sound.js            # the app's one sound switch (Settings), which every game follows
      sw-client.js        # registration, update prompt, "ready offline" check, downloads, online check
      app.js              # app feel on every page (no zoom) and the icon sprite; the build adds it, never link it by hand
      ui.js               # sheets, confirm sheet, side menu, progressive-blur layers, board sizing
      i18n.js             # English and Catalan strings
      logo.js             # the pixel logo as a grid of spans, its focus (progress) states, and the field around it (fieldShade)
      pixel-field.js      # the install page's background: the app icon's field across the page, blurring out and in at random
      icons.js            # every icon, as 9 x 9 pixel bitmaps
      game-art.js         # board art for the launcher's tiles and hero (never reads a game's folder)
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
    lan.mjs               # build + serve dist/ over HTTPS to phones on the same Wi-Fi (testing)
    guide.mjs             # builds the Tanks field guide (not part of the app)
    playtest.mjs          # a bot plays Tanks missions: winnable? how hard? (not part of the app)
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

1. Wipe `dist/` and copy `src/` into it, excluding `sw.template.js`. Into every `.html` page,
   right after `<meta charset="utf-8">`, insert the viewport meta and
   `<script type="module" src="/shared/app.js">` (`APP_HEAD`). A page with its own viewport meta
   fails the build, so there is one source of truth.
2. Walk `dist/` and split the files into packs: everything under `/games/<id>/` is game `<id>`'s
   pack (a game folder without a `registry.json` entry fails the build), everything else is
   the app shell (`core`). In each pack, every `.../index.html` also gets its directory URL
   `.../` (navigations request the directory form).
3. Hash each pack's files (path and content) into a 12-hex version. Caches are named
   `gamehost-core-<hash>` and `gamehost-game-<id>-<hash>`, so a game that didn't change keeps
   its cache across releases. `VERSION` is the first 12 hex characters of a SHA-256 over every
   file, the SW template and `RELEASE`. `RELEASE` is the `version` in `package.json` (`x.y.z`,
   now 0.1.0), the number Settings shows. It is bumped by hand, whenever Pol chooses; never bump it
   on your own. The build fails if it isn't `x.y.z`. Every push still updates phones through `VERSION`, bumped or not.
4. Write `dist/sw.js` from the template with `VERSION`, `RELEASE` and `PACKS` (`{ core, games }`, each pack
   with `cache`, `files`, `hashes` (16 hex of each file's SHA-256) and `bytes`) **inlined as
   literals**. Do not use `importScripts` for the
   manifest, because the byte change has to live in `sw.js` itself for updates to be detected
   reliably.
5. Write `dist/version.json` with `{ version, release, builtAt, files, bytes, core, games }`. It is never
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

## Testing on a phone without deploying (`scripts/lan.mjs`)

- `npm run lan` builds, then serves `dist/` with the same handler as `serve.mjs` over HTTPS at
  `https://<mac>.local:8443/` (the Mac's Bonjour name, stable across networks) on every
  interface. Service workers need HTTPS, and plain `http://<lan-ip>` isn't a secure context.
- The certificate comes from a local CA made once with the system `openssl` and kept in `.lan/`
  (gitignored). Its name constraints allow only `.local`, `localhost` and private IPs, so its key
  can't impersonate a real site. The server certificate is reissued by itself when the Mac's
  address changes; phones that trust the CA need nothing new.
- `http://<mac>.local:8081/` is the setup page: it hands out the CA and says how to trust it
  (iPhone: install the profile, then switch it on under Certificate Trust Settings).
- That origin is not the real app's: test installs and saves stay separate from
  `https://cache-only.github.io`. No tunnels or public exposure: it's reachable only on the
  local network.
- `npm run lan --stop` stops a running server from any terminal (it finds the process on its
  ports and leaves anything that isn't `lan.mjs` alone). The phone only needs it to install,
  download or update; a stopped server reads as offline.

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
  which is correct. When online and a new worker is waiting, the launcher's settings
  button turns into a white "Update" button. A push reaches phones within about 10 minutes (the CDN's cache
  time; `sw.js` is registered with `updateViaCache: 'none'`). Never auto-reload mid-game. A game
  downloaded while an update waits is also sent to the waiting worker, so the reload keeps it.

## Launcher

- **In a browser tab** (not standalone: `navigator.standalone !== true` and not
  `display-mode: standalone`) the launcher shows only how to install, over a pixel field
  (`shared/pixel-field.js`): the app icon's field (`fieldShade()` in `shared/logo.js`) laid across
  the whole page on the big logo's grid, the mark lit white as its brightest pixels. The field stays
  whole under the text: pixels near a line of text only dim, easing back over a few cells and a
  little unevenly, so no edge or hole shows. About a quarter of the field's pixels are blurring
  out or back in at any moment (`blurOut()`/`blurIn()`, slowed to `--t-twinkle`); the mark loses
  about one pixel at a time; the step icons stay still; nothing moves under reduced motion. Over
  it: the logo with "Cache Only" under it in Display as one lockup (this page has no header), then
  "Install the app" (32/800, centred) heading three steps (Tap Share, Add to Home Screen, Open it
  from the new icon; browser-menu steps off iOS). Each step is a `.glass-row`: its icon in a 44 glass tile (the last step's is `app`, a tile with
  a C cut out of it), a
  "Step n" eyebrow over the line, on a panel that blurs like a sheet (`--sheet`, `--blur-sheet`).
  Landscape puts the lockup on the left and the steps in the wider right column. No game list and
  nothing to download.
  A tab also keeps no offline copy: `registerSW()` does nothing outside the installed app, and
  `dropBrowserCopy()` unregisters any worker and deletes every cache left by an earlier visit,
  then reloads once if that old copy served the page. So the tab always shows the current
  release, and an app installed from it starts from the host. It leaves storage alone when any
  `/games/` file is cached, because then the tab shares storage with an installed app (Chrome,
  Android) whose downloaded games must survive. When Chrome turns the tab into the app window,
  the `display-mode` change starts the worker.
- **In the installed app** the header is only the settings button, floating at the top right
  over whatever scrolls under it (the rest of its row lets taps through). No wordmark, no title
  and no status text on screen. There is no fixed bottom bar. The pixel logo is in the page, large
  (120 wide, with its glow), centred over the suggested game's art (`.home-mark`), or over nothing
  while nothing is downloaded.
  - **Portrait:** one vertically scrolling page from right under the status bar: a square as wide
    as the page (`.lead`) holding the logo over the suggested game's art with the suggested game
    at its foot, then the grid. The top blur runs from the top of the screen down to the foot of
    the settings button (`--bar-total`), and the logo centres in the room under it, so it sits sharp.
    At rest the top blur stays out of the way and slides in with whatever scrolls under it
    (`--scrolled`, set by `launcher.js`), so the art is seen right up to the edge.
  - **Landscape:** everything runs left to right in one strip that scrolls sideways, from the top
    of the screen down with no header band (the body is the scroller; the page itself never
    scrolls), never a rail or a side-by-side split. It starts with the same square as in
    portrait, two tiles wide and as tall as the two rows (`--lead`): the art, the logo in the
    middle of it, the eyebrow and panel at its foot. The other tiles follow in two rows
    (`--tile`: two rows and their gap fill the height). Settings (and Update) floats, fixed at the
    top right, over the tiles. Progressive blurs at the left and right edges (`.edge-left/-right`)
    take the place of the top and bottom ones; the left one, like the top one in portrait, stays
    out of the way at rest and slides in with the strip. A mouse wheel scrolls the strip too.
  - **Status:** the logo is the status. It stays out of focus until every app-shell file is
    confirmed in its cache, then comes into focus with download progress: pixels go from blurred
    grey to sharp white in a fixed pseudo-random order (`shared/logo.js`). The logo is the only
    progress indicator anywhere in the app. The words ("Ready offline · 2 of 3 games",
    "Downloading · 64%", "Offline · 2 of 3 games", "Checking offline files…") are still written to
    a visually hidden live region (`#statusLine`) for screen readers.
  - **Suggested:** the most played game on this device, as a "Suggested" eyebrow over a glass
    panel with its title and a primary Resume (saved session) or Play button. The panel is shaped
    like a game tile: radius 18, its button inset 10 with radius 8 (the tile art's), its title
    starting 18 in like a tile's, and it blurs what's behind it like a sheet (`--sheet`,
    `--blur-sheet`). Plays are counted in
    `gh:app:plays` (`{ id: n }`) whenever a game is opened from the launcher; ties and no history
    fall back to registry order. Its board art (`.hero`) is a square that runs out to the
    screen's edges and never past them, so all of it is seen (Tanks' 4:3 arena fills it and loses
    an eighth at each side). In portrait it starts at the top of the screen, as wide as the page,
    and fades out toward the panel. In landscape it is exactly as tall as the screen and starts at
    the column's gutter (the screen's left edge, or the safe area's), so it sits centred on the
    column, and fades out to the right, toward the tiles.
  - **Nothing downloaded yet:** the same layout, with the same panel offering every game
    (`.is-all`): no art behind it, the eyebrow hidden but keeping its room, the title "Download all
    games" (two lines where one won't fit), and for its button a square primary with only the
    download icon (`.btn-icon`). It downloads every game not on the device, one after another; it
    is disabled while the host doesn't answer or while every missing game is already downloading.
    Once the first game arrives, the panel suggests it. It shows only once the packs are known, so
    a returning friend never sees it flash.
  - **Games:** right under (portrait) or after (landscape) the suggested game, with no heading,
    square game tiles (2 columns in portrait, 2 rows in landscape) for every game
    except the suggested one, then 10 fillers (`SOON` in `launcher.js`): empty tiles labelled
    "Coming soon" where a title would be, with nothing to press, hidden from screen readers and
    never counted as games. The grid sits 12 from the suggested game, the same gap the tiles keep between them. A tile shows the game's own board as art (`shared/game-art.js`, from the game's save when
    there is one, with a generic pixel field for an id it doesn't know) and its title at the
    bottom left over a progressive blur. No sizes, scores or records are shown (sizes live only in
    the code; aria-labels say what a tile does). States: on this device = sharp, the whole tile is
    a link to play; downloadable = art blurred and a plain download icon, the whole tile is the
    download button; downloading or queued = no icon, the art unblurs as the pack arrives
    (blur = (1 − p) · 8px); out of reach = icon at 40%, art dimmed.
  - A muted line right under the suggested game (so the fillers never push it out of sight) says
    "Offline. Downloaded games still work." while the host is out of reach and games are left to
    download, or that a download failed. Nothing once every game is downloaded.
- **First launch** (the app shell still downloading, or failed): "Preparing the app" with the big
  pixel logo coming into focus file by file, "x / y files", "Keep the app open and stay online…",
  and blurred placeholder tiles. A failed install shows "Download failed" and how to recover.
- **Downloads** are offered only while the host answers. The launcher fetches `/version.json`
  (no-store, cache-busting query, 5 s timeout) on start, every 15 s while visible, on
  `online`/`offline`, and when the app comes back to the foreground. While it answers, tiles that
  aren't downloaded are download buttons, one game each (and, while nothing is downloaded, the
  panel's button downloads them all). When it doesn't, those tiles dim their icon and move to the
  bottom.
- **"Ready offline" check:** after `navigator.serviceWorker.ready`, confirm every app-shell file is
  in its cache; only then does the logo come into focus (and the hidden status say "Ready
  offline"; Settings shows the version).
  A tile is sharp only when every file of its pack is cached. These tell a friend it's safe to go
  offline, so they must be accurate.
- **Update available:** no banner. The header's settings button turns white in place (solid
  `--ink`, radius 8, 44 tall): the update icon takes the settings icon's exact spot and "Update"
  grows out to its left. Tapping it reloads to the new version (aria-label "Update available. Tap
  to reload and update."). Settings is out of reach until then. The white button is the screen's
  one primary, so the suggested game's button turns secondary while it shows.
- Call `navigator.storage.persist()` once at start. Nothing shows the answer.
- Settings is a sheet: Language (English / Català segmented control), Sound ("Sound effects"
  with a switch on the right, in a `.toggle-row`: one switch for every sound in the app, saved as
  `gh:app:sound`), Saves (Export / Import),
  "This phone" facts (Version, the `RELEASE` number such as 0.1.0, and Games downloaded) and
  "Check for update". That button answers in its own label, never in a message under it:
  "Checking…", then "No updates" (or a short offline or failed note), or it turns white
  (`btn-primary`) and says "Update", and a tap reloads into the new version (the header's
  settings button turns into Update at the same time). It resets each time Settings opens.
  In landscape it lays out in two columns.

## iOS / PWA requirements

- Viewport (added to every page by the build, never written in a page):
  `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`
- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
- `<meta name="apple-mobile-web-app-capable" content="yes">` plus `mobile-web-app-capable`
- `<meta name="apple-mobile-web-app-status-bar-style" content="default">` plus
  `<meta name="theme-color" content="#000000">`, the black the status bar takes; the page itself
  is `--bg` (#0b0b0b), a step above it. Not `black-translucent`: it lays a
  progressive blur over whatever sits under the status bar. No page draws a strip of its own at
  the top (the old fixed `status-tint` strip is gone; `tests/build.test.mjs` keeps it out).
- The header sits directly under the status bar (`env(safe-area-inset-top)` padding only, which
  reads 0 wherever iOS puts the status bar above the page). In landscape a phone has no status
  bar, and `viewport-fit=cover` lets backgrounds run behind the side safe areas; only controls and
  text stay inside `env(safe-area-inset-*)`.
- iOS reads the status-bar style only when the app is added to the Home Screen: to test a change
  to it, delete the home-screen app and add it again.
- `manifest.json`: `display: "standalone"`, `start_url: "/"`, `scope: "/"`, `id: "/"`, plus
  `theme_color`, `background_color` and the icons.
- Respect safe areas with `env(safe-area-inset-*)` padding on the app shell.
- No zoom, no web-page feel, globally: the viewport has `maximum-scale=1, user-scalable=no`, every element
  gets `touch-action: pan-x pan-y` (no pinch or double-tap zoom; boards that need raw touches use
  `none`), and `shared/app.js` cancels iOS `gesture*` events and ctrl+wheel, since iOS ignores
  `user-scalable=no`. Text selection and long-press callouts are off except in `input`/`textarea`
  (and anything that opts back in, like Sudoku's share code). Touch targets are at least 44×44 pt.
  No tap highlight on anything, and no focus ring after a touch or click: `shared/app.js` sets
  `data-input` on `<html>` (`keyboard` on a key press, `pointer` on any pointerdown), and
  `styles.css` draws `:focus-visible` outlines only under `data-input="keyboard"`.
- iOS has no `navigator.vibrate`, so don't rely on haptics.
- Rotating while a sheet is scrolled can leave iOS hit-testing at the old scroll offset (every tap
  lands lower than it looks). `shared/ui.js` scrolls the page and every open sheet back to the top
  and rebuilds each sheet's scroller after every resize; keep that when touching sheets.
- Dark only. There is no light mode and no `prefers-color-scheme` theming anywhere (the Tanks
  colour test checks the arena has one palette).

## Saves (`shared/storage.js`)

- Use `localStorage` with keys namespaced as `gh:<gameId>:<key>`. Store JSON with a
  `schema` number per game so formats can be migrated later.
- Write after every move, debounced to 250 ms, and on `visibilitychange` to hidden. iOS
  kills backgrounded web apps without warning.
- Export and import cover all `gh:*` keys in one JSON blob.

## Design

The approved design is dark, monochrome and built from the logo's rounded-square pixels. Every
page (launcher, settings, first launch, install, and all three games) uses only the parts defined
in `src/styles.css`; a game's own stylesheet draws its board or arena and nothing else. Never
style a button, header, card, sheet or menu locally.

- **Colour:** dark only, no accent colour. `--bg #0b0b0b`, `--card #151515`, `--raised #1d1d1d`,
  `--quiet #4a4a4a`, `--muted #a8a8a8`, `--ink #efefef`. Glass is a `rgba(255,255,255,0.07)` fill,
  a 1px `rgba(255,255,255,0.14)` edge and a 20–24px backdrop blur, used only over art or content.
  Tanks keeps its kind colours inside the arena (game content); everything around it is grey.
- **Type:** system stacks only (or a `.woff2` under `src/fonts/`, never a remote font). Display
  52/800, Title 30/800 (−0.04em), Heading 18/750, Body 15 muted, Eyebrow = mono 12 uppercase
  0.06em muted for numbers, versions and section labels. Nothing smaller than 13 except eyebrows.
- **Buttons, one shape:** no pills and no circles; every button has the icon button's radius 8
  (`--r-btn`). `.btn` is 48 tall (650 16px), glass (secondary); `.btn-primary` is solid `--ink`
  with `--bg` text, at most one per screen. `.icon-btn` is a 44 glass rounded square (home,
  settings, close, the moves under a board, pressed = solid white), its pixel icon filling it to
  one gap from the edge. `.btn-icon` makes a `.btn` a 48 square holding only its icon, filled the
  same way (the launcher's "Download all games"). `.btn-small` is 32 tall with 13px text, only in a section header next to
  a 12px label, its tap area still 44. Disabled is the same button at 40% opacity, never a new
  style. (Tanks' thumbsticks are round: they are sticks, not buttons.)
- **Concentric radii:** an outer radius is the inner radius plus the inset between them, starting
  from the button's 8. 8 every button and control (number keys, side-menu rows, the segmented
  control, the switch track, fields) and the rows and text cards beside them; 4 a chip inset 4
  inside one (the selected segment); 5 the switch knob, inset 3; 24 a sheet,
  holding its close button and buttons inset 16; 18 a launcher game tile (8 art + 10) and the
  suggested game's panel (its button inset 10); 16 an install step's panel (its icon tile inset
  8); 26 a game board (16 tile + 10). Check every nested shape.
- **Pixels:** the logo and every icon are rounded-square pixels, 3/4 of their pitch with a 1/4 gap
  and corners at 34% (`--r-pixel`). The logo (`shared/logo.js`) is a solid 11 × 13 cent sign and
  nothing else, `--logo-w` wide. Icons (`shared/icons.js`) are 9 × 9 bitmaps (`#` lit,
  `+` dimmed) with the four corner pixels always dark. Shapes are solid with their details cut
  out, and lines (close, new, update, share) are one pixel. The one exception is Tanks' shell and mine
  (`SHAPES` in the same file): smooth shapes, not pixels, solid while ready and outlined while in
  use (`-empty`). `shared/app.js` puts every icon on every page as one sprite, and pages write
  `<svg class="icon"><use href="#i-name"/></svg>`. Never add a `<symbol>` to a page; add a bitmap
  to `ICONS`. `npm run icons` redraws the app icons from the logo: the white mark on `#070707`,
  centred on its box, not optically (the field shares its grid, which must stay centred, its dots
  cut evenly at opposite edges), one empty cell around it, nothing inside its box but the C's open mouth and, in its bowl, a
  column of three dim pixels between the C and the bar (the field's noise, never left out and
  never the darkest grey), and past that a seeded
  scatter of dim pixels in five greys with gaps (`fieldShade()` and `SEED` in `shared/logo.js`), the
  outermost cut by the icon's edge at every size. The outer app icons and the browser tab's
  install page get the scatter (`shared/pixel-field.js` carries the same field on across the
  page); the logo inside the installed app stays the plain mark.
- **Progressive blur** (`.pblur` with `.pblur-top/-bottom/-side/-tile/-left`, or `blurLayers()` in
  `shared/ui.js`): stacked backdrop-filter layers with staggered mask gradients, at the top and
  bottom edges of scrolling screens (left and right where one scrolls sideways), behind the side
  menu and under each game tile's title.
  Nothing that wraps the layers may set opacity, filter or mask.
- **Blur out and blur in** (`.blur-out` / `.blur-in` in `styles.css`, `blurOut()` / `blurIn()` in
  `shared/ui.js`): the one animation for something that steps away and comes back in place. Blur
  out fades it while it goes soft (`--blur-fade`, over `--t-blur`) and leaves it untouchable; blur
  in fades it back as it comes into focus. The home button uses it while the side menu is open,
  and the install page's pixel field at random, slowed to `--t-twinkle`.
- **Progress** is the pixel logo coming into focus (`shared/logo.js`), and a downloading tile
  unblurring. There are no spinners or progress bars.
- **Header:** portrait, a row under the status bar (icon button, stats right-aligned as a mono
  label over a 17/750 tabular value, and optionally `.stat-meters` under them: a row of small
  two-state icons, filled while ready and hollow while used, such as Tanks' shells and mines;
  in a landscape game header each meter runs down the right edge). No page shows a title in the
  header (a game's name is on its start sheet); the launcher's header is only settings, floating
  at the top right, its logo being in the page (Launcher, above). A game page's header stays in
  the page (never
  `position: fixed`) and shares the shell's grid cell with the play area, so the home button floats
  in the top-left corner and the stats stack down the top-right, each in a `--side-w` gutter the
  play area keeps free, with the board centred between them. The side menu's list starts under
  the home button.
- **Overlays, two kinds only.** The side menu (`.side-menu`, `setupSideMenu`): a list of choices
  from the header's home button, down the left edge over a progressive blur, with no title over
  it. As it opens the home button blurs out, and as it closes (Resume, or a tap beside the list)
  the button blurs back in. Opening it pauses. Holding the home button for half a second goes
  straight back to the games, without waiting for the finger to lift. Every game's menu
  starts with Resume, always there even before a game has started, and ends with "Back to games"
  set slightly apart. The sheet (`dialog.sheet`, `openSheet`):
  content such as settings, confirmations and results, glass from the bottom with top corners 24,
  padding 16 and a 44 close button where one is needed. A sheet is barely tinted (`--sheet`, 40%)
  and blurs what's behind it (`--blur-sheet`, 40px); a modal one dims the page only lightly, and
  the flat surfaces on it (segmented control, toggle rows, cards, facts, fields) turn to glass too. A sheet that belongs to the game state (a
  start screen or a result) is docked: opened with `show()`, so the header and menu still work.
- **Games:** no back or pause buttons. Moves during play stay on screen (Sudoku: Undo, Redo, Erase,
  Notes, Hint as labelled icon buttons over a 3×3 number pad; 2048: an Undo button); anything about
  the whole session lives in the side menu. Boards must stay square and fully visible on an iPhone
  SE and a Pro Max in portrait and in landscape, with no page scrolling during play.
- Respect `prefers-reduced-motion`: state changes are instant, with no blur or scale animations.

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
- **Timer** pauses on `visibilitychange` (which opens the side menu) and while the side menu or
  a modal sheet is open.
- **Menu:** the home button's side menu: Resume, New puzzle, Enter puzzle, Share this puzzle, Show
  conflicts (switch), Back to games. "New puzzle" is a sheet with a Difficulty segmented control;
  with no puzzle going it is docked and opens on its own. "Solved" is a docked results sheet.
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
  original game's palette: grey steps up to white, then ringed and inverted tiles (`--tile-*` and
  `.t2`…`.tmax` in `styles.css`, shared with the launcher's tile art).
- **Menu:** Resume, New game, Back to games. The win and game-over prompts are docked sheets.

## Game: Tanks

- Top-down tank battles in the style of Wii Play's *Tanks!*, with original code, art and sound.
  The arena is 20 × 15 cells (4:3). On a tall screen the renderer turns it 90°, so the player's side
  (the left of every map) sits at the bottom, next to the thumbs. In portrait it fills the width right
  under the header; spare room stays empty below it. In landscape there is no header band: the home
  button floats in the top-left corner, mission and lives in the top-right, and the arena fills the
  height, centred on the screen with equal room on both sides. Up on screen is always up for input.
- **Rules** (`rules.js`, `engine.js`): one hit destroys a tank. Shells ricochet off walls and crates;
  the player has 5 shells in flight with 1 ricochet each and 2 mines. Shells that meet cancel out
  (missiles and minigun rounds too), your own shell can destroy you after a ricochet, and a barrel inside a wall fizzles.
  Each kind has a `weapon`: shells and rockets fly straight; missiles steer toward you (up to 2.2
  rad/s for 4 s, only while you are within 90° of the nose) and die on the first wall; mortar bombs
  fly over everything and land 1.5 s later on a spot marked on the floor; a minigun spins its
  barrels up for 1.2 s, then sprays a round every 0.1 s (they run down over 2.5 s once it loses
  you); its rounds never ricochet. Mines go off after 10 s,
  when any tank comes close (the layer only once it has driven off), or when shot. A blast (a mine's
  1.5 cells, a landing bomb's 1.0) destroys tanks, shells and striped crates, sets off nearby mines,
  and never touches walls. Holes stop tanks, not shells.
- **Enemies** (`ai.js`, kinds in `rules.js`): brown, grey, teal, yellow, pink, green, violet, red,
  white, black, olive, lime and hornet, differing in speed, weapon, ricochets, shots in flight, aim
  (sweep, direct, bank shots found by mirroring the target in wall faces, guided missiles, lobbed
  bombs, or a minigun's spray, whose turret drags as its barrels speed up),
  lead (an exact intercept on your smoothed velocity, stopped at walls), dodging, and invisibility for
  white. Kinds come in lines: a V2 names the first version it upgrades (`upgrade` in `TYPES`):
  Brown → Grey, Teal → Green, Yellow → Hornet, Pink → Violet and White (Violet's twin, `twin`); Red,
  Black, Olive and Lime stand alone. A V2 reacts and thinks at least as fast as its V1 (a test
  checks), and the field guide rates every kind on five axes: Aim, Awareness, Defence, Tactics,
  Mines (TANKS.md A5 plans the rest). Yellow and Hornet lay mines. Yellow drops one of its 2 now and then. Hornet lays its 4 by
  plan: at a cell on your shortest way to it that it reaches well before you, then watches the mine
  from a lookout and shoots it as you pass (only when the blast spares every enemy); it knows its
  side's quiet mines only go off when driven onto, and drives clear of any about to blow. No enemy
  fires through a mine whose blast would reach an ally, or flees onto one. Enemies hold fire for the first 1.2 s of a mission and avoid hitting each other. Movers claim
  the cell they drive to, take turns by right of way, line up before narrow gaps, and back off when
  stuck, so they never jam.
- **Art** (`art.js`, drawn by `render.js` and by the field guide): shape tells you what a tank can do
  (barrel: weapon, from a thin shell barrel to a rocket's muzzle brake, a missile's twin pods, a
  mortar tube and a minigun's spinning bundle; treads or a concrete pad: moves or not; rear-deck
  discs: mines left), colour only
  which kind it is. The colour plan sits above the `--tk-*` colours in `tanks/styles.css`, and a test
  holds new colours to it; past about a dozen kinds, a variant wears another kind's colour with a
  pattern (`VARIANTS` in `art.js`: Hornet is Yellow with hazard stripes, off its rear deck). Walls are flat grey; crates a lighter grey with diagonal stripes. Blocks of
  a kind that touch draw as one, edged only outside, and the stripes run on across them.
- **Campaign** (`missions.js`): 20 missions, 3 lives, a bonus tank after missions 5, 10 and 15,
  which also unlock checkpoints (start at 6, 11 or 16). A retry keeps destroyed enemies destroyed.
  Each mission has one idea, a name and a one-line briefing (`tanks.name.<n>`, `tanks.brief.<n>`),
  shown on its banner. Every map must pass `guide/mapcheck.mjs` (the tests run it): every enemy
  reachable, no enemy with a clear shot at your start, no two missions with the same blocks.
  Playtest new or changed maps with `npm run playtest` (`scripts/playtest.mjs`): its expert bot
  should win each mission at least 6 times in 8, and its casual bot shows how hard the mission is
  next to the others. `--map file` plays a draft copied from the field guide's editor. Lime and
  Hornet are in no mission yet.
- **Test range:** the start sheet's Test button opens a docked sheet to pick one enemy kind and
  how many (1 to 6), on `testMap` in `missions.js`: four short walls (columns 2, 6, 13, 17, rows 4
  to 10), side on `_|__|__` and `__|__|_`, you at the far left. A test never touches the campaign:
  it isn't saved, counts toward no record, shows Mission "Test" with no lives, its side menu says
  End test, and it ends back on the range sheet.
- **Input:** touch works like Brawl Stars. The controls float over the whole play area at 20% opacity.
  The sticks start only on the bottom half of the screen, in portrait and landscape alike. A thumb
  anywhere on its left half drives, with the stick centred where it lands. On its right half,
  drag to aim and let go to fire, drag back to the middle to cancel, or tap to fire straight at the
  nearest enemy in sight within 6.5 cells (`tapTarget` in `ai.js`: one behind a wall or crate is
  passed over for the next; no ricochet or lead; invisible tanks are skipped). While there is one,
  the aim stick shines (its shell turns white and glows, and a ring spreads from it to the rim) and
  the turret follows that enemy, until a thumb drags the stick. With none, a tap fires where you
  last aimed. The aim knob is a shell pointing along the aim. The mine button sits on the right edge, halfway down, above the aim stick in landscape, and
  in portrait in the middle of the bottom row, between the two sticks. It has the sticks' rim
  and fill with a button's corners (`--r-btn`), and its mine turns hollow while both of yours are down. Under Mission and
  Lives, the header's meters show your 5 shells and 2 mines, filled while ready and hollow while
  out (a row in portrait, columns down the right edge in landscape).
  Touching the arena doesn't fire. The sticks follow touches by identifier and let go of any finger
  missing from a touch event's `touches`, so a lost `touchend` can't leave one held. Keyboard and mouse: WASD/arrows, mouse to aim, click to fire, Space or right-click for a mine,
  P or Escape for the menu. The on-screen controls only appear on touch devices.
- **Menu:** no back or pause button. The header's home button opens a side menu (Resume, Quit
  campaign or End test, Back to games) down the left edge over a progressive blur (`.side-menu` in
  `styles.css`, `setupSideMenu` in `shared/ui.js`). Opening it pauses the battle; closing it plays on.
  The home button blurs out while the menu is open and blurs back in when it closes: Resume is the
  way back, so there is no close icon.
- **Simulation:** fixed 120 Hz step, seeded RNG, and the whole world is plain JSON, so it is
  deterministic. Shells move along exact ricochet paths (`advance`/`tracePath`), so the aiming guide
  and the AI's bank shots match what really happens. Keep `engine.js`, `ai.js` and `rules.js` free of
  the DOM, and `art.js` drawing only on the context it is given.
- **Save:** the campaign at every mission start and end; the whole world on pause, hide and
  pagehide, so a killed app reopens paused mid-battle. `summary: { mission }` feeds the launcher.
- **Sound** is synthesised with Web Audio (no audio files). It follows the iOS silent switch
  (`navigator.audioSession.type = 'ambient'`) and the app's Sound switch in Settings
  (`shared/sound.js`); the game has no sound setting of its own.
- Leaving the app or the window pauses the battle (the side menu opens). Under reduced motion there is no screen shake,
  fewer particles, no banner slide, steady lights on mines and missiles, and a static bomb mark.
- **Planned work** lives in `TANKS.md`, grouped by category with ids (R1, W1, A1…). New Tanks ideas
  go there; when one ships, mark it done with the date.

## Tanks field guide (keep it in sync)

A reference page for Tanks, published as a private claude.ai artifact:
**https://claude.ai/artifact/YKPsuThAVXPnPLm4Wwa5gN**. It shows every enemy kind grouped into lines
(card, scene, what each V2 gains and gives up), a stats table, an intelligence table (five axes,
levels worked out from the stats, with proposed levels marked as such), what we could add
(`guide/plans.mjs`, nothing in it is built), shared AI behaviour and aim styles, how to read a tank at a glance and the colour plan,
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
   uses the same head tags as the other pages (status-bar style `default`), and uses `shared/storage.js` with namespace `<id>`. No
   viewport meta: the build adds it and the no-zoom script to every page.
   Everything the game needs that isn't shared (scripts, workers, images) lives in its folder.
   Build its page only from the parts in `styles.css` (header, side menu, sheets, buttons); its own
   stylesheet draws the board. Optionally give it tile art in `src/shared/game-art.js`; without
   that its launcher tile shows a generic pixel field.
2. Add an entry to `src/registry.json`. The build fails if a game folder has no entry.
3. Run `npm run build`. The game's pack, its size and the version update automatically.
4. Follow the release steps below. Friends see the new game as a blurred tile to download the next
   time they open the app online; nothing downloads until they ask.

## Commands

```bash
npm run build                 # node scripts/build.mjs
npm run serve                 # node scripts/serve.mjs  (dist/ on :8080, local testing)
npm run lan                   # build + https://<mac>.local:8443 for phones on the same Wi-Fi
npm run lan --stop            # stop that server, from any terminal
npm run guide                 # rebuild the Tanks field guide into guide/out/ (then republish it)
npm run playtest              # Tanks: a bot plays every mission (--missions 4,12  --map draft.txt)
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
3. Wait for the big logo to come into focus (sharp white: the app is ready offline), then
   tap the tile of each game they want. A game is ready when its tile is sharp.
4. Turn on airplane mode, force-quit the app, reopen it and play a game. If that works,
   they're done for good. Games they skipped keep a dimmed download icon until they're back
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
- On a real iPhone: install, download every game, go to airplane mode, force-quit, relaunch, and finish
  a move in each game. Kill the app mid-game and confirm it resumes. In airplane mode, games
  you didn't download keep a dimmed download icon. The status bar is solid, not blurred.
- Update path: change a file, push, wait for the Actions run plus about 10 minutes, open the
  installed app online, and confirm "Update available" appears, then reload and check the new version shows and every downloaded game
  still plays offline.
- Sudoku: generated puzzles always have a unique solution. Add a script test that generates
  200 puzzles per difficulty and verifies uniqueness.
- 2048: unit-test merge rules with the edge cases listed above.
- Tanks: `tests/tanks.test.mjs` covers the map checks on every mission (reachable enemies, no free
  shot at your start, no repeated layouts), ricochets, bank shots, cancelling shells, limits,
  fizzles, mines and chain blasts, the two minelayers (Hornet lays far more than Yellow, watches each
  mine from no nearer you and never blows itself up), Hornet's shot into a mine beside you (never
  one whose blast reaches an ally), no shot through a mine beside an ally, collisions, exact path prediction, weapons, guided missiles
  (turn limit, lock cone, fuel, shot down), mortar bombs (where and when they land, blast radius,
  minimum range, allies), the minigun (spin-up before the first round, spin-down, spray, turret
  drag, rounds that cancel out with other shots), deterministic save/resume with missiles, bombs and a
  spinning minigun, the test range map (its walls, and the map checks for every kind at 1 to 6),
  jam-free movement (corridor passing, stuck recovery, no tank pinned over 1.5 s in any mission),
  lead aim, the colour plan, and mission names in both languages.
- Field guide: `tests/guide.test.mjs` builds the guide from the game and fails if an enemy kind has
  no text or scene, a mission has no name or briefing, a colour is missing, or the page script
  doesn't parse. It also checks that the game code bundled into the page behaves exactly like the
  game.
- Playtest: `tests/playtest.test.mjs` keeps the bot working against the engine: it wins the first
  mission and mines its way into Crate gate's vault.
- Downloads: `tests/sw.test.mjs` runs the built service worker against an in-memory cache and a
  fake host. The shell installs alone, games download on request and resume after a failure,
  every file is fetched as `?v=<hash>` and a stale CDN copy is refused, and updates keep the games a device has (re-fetching only those that changed), including
  from the single cache used before packs.
- Icons and logo: `tests/icons.test.mjs` checks that every `#i-<name>` a page or script uses is in
  `shared/icons.js`, that no icon lights a corner pixel, that no page carries its own sprite, and
  that the logo keeps its solid 11 × 13 mark.
