# Gameplane

Small games in one installable PWA. Friends install it from Pol's Mac (Tailscale Funnel) and
download the games they want while the Mac is reachable. After that, every downloaded game runs
forever with no network, including in airplane mode.

Games: **Sudoku**, **2048** and **Tanks**. Languages: **English** and **Català** (switch in the top bar or in Settings).

No dependencies. Vanilla HTML, CSS and ES modules; Node (≥ 20) is only used for the build, server and tests.

## Commands

```bash
npm run build     # src/ -> dist/, splits it into packs, writes dist/sw.js (VERSION + PACKS) and dist/version.json
npm run serve     # serve dist/ on http://127.0.0.1:8080
npm run host      # build + serve + `tailscale funnel --bg 8080`; prints the public URL. Ctrl-C stops all of it
npm test          # Sudoku uniqueness, 2048 merge rules, Tanks engine + AI, build + server checks, service-worker downloads
npm run icons     # re-render src/icons/*.png (only needed if the icon design changes)
```

`npm run host` runs `tailscale funnel reset` on Ctrl-C. That clears **all** Funnel config on this Mac,
including other projects on ports 8443/10000, so restart those afterwards if you use them.

Funnel prerequisites (one time): MagicDNS and HTTPS certificates enabled in the Tailscale admin console,
and the `funnel` node attribute allowed in the policy. The CLI prints an approval link the first time if
anything is missing.

## Friend install procedure

1. Pol runs `npm run host`.
2. The friend opens the URL in **Safari**. It only shows how to install: tap Share, then
   **Add to Home Screen**.
3. The friend opens the app **from the home-screen icon** while still online. Home-screen
   apps have their own storage, separate from Safari.
4. Wait for "Ready offline" (in Catalan: "Llest sense connexió"), then tap **Download all**
   ("Baixa-ho tot"), or Download on just the games they want. A game is ready when it shows Play.
5. Turn on airplane mode, force-quit the app, reopen it and play a game. If that works,
   they're done for good. Games they skipped show "Connect to host to download" until the next
   time Pol hosts.

## Releasing an update

1. Change files under `src/`, then `npm test`.
2. `npm run host`. The version hash changes automatically with any file change.
3. Friends open the installed app while it's online. It downloads the new version of the games
   they already have (only the ones that changed) and shows "Update available. Reload to update."
   Tapping Reload switches to the new version; downloaded games and saves are kept. Nothing ever
   reloads mid-game. New games appear with a Download button; nothing downloads until they ask.
4. Friends who never come online keep the old version, which keeps working.

Never rename the Mac in Tailscale or change the tailnet name: the origin is where installs and saves live.

## Adding a game

1. Create `src/games/<id>/` with an `index.html` that links `/styles.css`, starts its `<body>` with
   `<div class="status-tint" aria-hidden="true"></div>`, and uses `createStore('<id>')` from
   `/shared/storage.js`. Keep everything the game needs in its folder: the folder is its download.
   Add its strings to `src/shared/i18n.js` (both languages).
2. Add an entry to `src/registry.json` (`id`, `code`, `name`, `path` with a trailing slash,
   `description` as `{ "en": …, "ca": … }`). The build refuses a game folder without one.
3. If the game saves a session under the `session` key with a `summary` such as
   `{ score }`, `{ difficulty, time }` or `{ mission }`, the launcher shows a resume hint for it.
4. `npm run build`; the game's pack and its download size work themselves out. Then release as above.

## Testing checklist (before every hosting session)

- `npm test` passes.
- Chrome: install the app (install icon in the address bar) to get the installed view; a normal tab
  only shows how to install. DevTools → Application: the service worker is activated, the app-shell
  cache is complete, each downloaded game's cache holds its whole pack, and "Offline" plus a hard
  reload still loads every downloaded game.
- Network tab: no request goes to any origin other than the host.
- `curl -I https://<host>/games/sudoku` returns 404 (not 301) and `/games/sudoku/` returns 200.
- Real iPhone: install, Download all, airplane mode, force-quit, relaunch, make a move in each game.
  Kill the app mid-game and confirm it resumes. With the host off, games you didn't download show
  "Connect to host to download". The status bar is solid black, not blurred.
- Update path: change a file, rebuild, open the installed app online, confirm "Update available",
  reload, check the new version in Settings and that every downloaded game still plays offline.

## How it fits together

- `scripts/build.mjs` copies `src/` to `dist/` and splits it into packs: the app shell (everything
  outside `games/`) and one pack per game folder, each with its own content hash. It inlines the packs
  and an overall `VERSION` into `dist/sw.js`.
- `src/sw.template.js` caches the app shell at install, downloads a game's pack when the launcher asks,
  and serves each URL from its pack's cache. Runtime responses are never cached. An update re-downloads
  only the games the device has whose content changed; unchanged games keep their cache.
- `src/shared/sw-client.js` registers the worker, shows the update prompt, reports "Ready offline" only
  after checking every app-shell file is cached, runs downloads with progress, and checks whether the
  host is up (by fetching `/version.json`, which is never cached).
- `src/launcher.js` shows only the install guide in a browser tab. In the installed app it lists each
  game as Play, Download (with its size) or "Connect to host to download", plus "Download all".
- Every page starts with a fixed `status-tint` strip in the header's black: iOS 26+ takes the status
  bar colour from it instead of blurring the top of the app.
- `src/shared/storage.js` keeps saves in `localStorage` as `gh:<game>:<key>` → `{ schema, data }`,
  written 250 ms after each move and immediately when the app is hidden. Settings → Export/Import
  moves all saves as one JSON file.
- Sudoku puzzles are generated in a Web Worker (`worker.js`) from a seeded PRNG; the pure rules live in
  `generator.js` / `solver.js`. 2048's rules live in `logic.js`, separate from the animated UI in `game.js`.
- Tanks keeps its simulation in DOM-free modules: `rules.js` (constants, tank kinds, exact ricochet
  tracing), `engine.js` (the fixed 120 Hz step), `ai.js` (enemy brains) and `missions.js` (the 20 maps).
  `render.js` draws on a canvas, `audio.js` synthesises the sound effects, and `tanks.js` handles input,
  the campaign and saves. The world is plain JSON, so a mission in progress resumes exactly.
