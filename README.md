# Gameplane

Small games in one installable PWA, published at **https://cache-only.github.io/**. Friends
install it and download the games they want while online. After that, every downloaded game runs
forever with no network, including in airplane mode.

Games: **Sudoku**, **2048** and **Tanks**. Languages: **English** and **Català** (switch in the top bar or in Settings).

No dependencies. Vanilla HTML, CSS and ES modules; Node (≥ 20) is only used for the build, server and tests.

## Commands

```bash
npm run build     # src/ -> dist/, splits it into packs, writes dist/sw.js (VERSION + PACKS) and dist/version.json
npm run serve     # serve dist/ on http://127.0.0.1:8080 (local testing)
npm test          # Sudoku uniqueness, 2048 merge rules, Tanks engine + AI, build + server checks, service-worker downloads
npm run icons     # re-render src/icons/*.png (only needed if the icon design changes)
```

Hosting is GitHub Pages: `.github/workflows/pages.yml` runs `npm test`, builds, and deploys `dist/` on
every push to `main` (repo Settings → Pages → Source: GitHub Actions).

## Friend install procedure

1. The friend opens https://cache-only.github.io/ in **Safari**. It only shows how to install:
   tap Share, then **Add to Home Screen**.
2. The friend opens the app **from the home-screen icon** while still online. Home-screen
   apps have their own storage, separate from Safari.
3. Wait for "Ready offline" (in Catalan: "Llest sense connexió"), then tap **Download all**
   ("Baixa-ho tot"), or Download on just the games they want. A game is ready when it shows Play.
4. Turn on airplane mode, force-quit the app, reopen it and play a game. If that works,
   they're done for good. Games they skipped show "Go online to download" until they're back
   online.

## Releasing an update

1. Change files under `src/`, then `npm test`.
2. Commit and push to `main`. The Actions run tests, builds and deploys; a failing test stops it.
   The version hash changes automatically with any file change.
3. Within about 10 minutes (GitHub's CDN cache), friends who open the installed app online get it. It downloads the new version of the games
   they already have (only the ones that changed) and shows "Update available. Reload to update."
   Tapping Reload switches to the new version; downloaded games and saves are kept. Nothing ever
   reloads mid-game. New games appear with a Download button; nothing downloads until they ask.
4. Friends who never come online keep the old version, which keeps working.

Never rename the `cache-only` organization or the repo, and never add a custom domain: the origin
(`https://cache-only.github.io`) is where installs and saves live.

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

## Testing checklist (before every release)

- `npm test` passes.
- Chrome: install the app (install icon in the address bar) to get the installed view; a normal tab
  only shows how to install. DevTools → Application: the service worker is activated, the app-shell
  cache is complete, each downloaded game's cache holds its whole pack, and "Offline" plus a hard
  reload still loads every downloaded game.
- Network tab: no request goes to any origin other than `cache-only.github.io`.
- `curl -I https://cache-only.github.io/games/sudoku/` returns 200. (The slashless form is a 301 on
  Pages; nothing in the app requests it.)
- Real iPhone: install, Download all, airplane mode, force-quit, relaunch, make a move in each game.
  Kill the app mid-game and confirm it resumes. In airplane mode, games you didn't download show
  "Go online to download". The status bar is solid black, not blurred.
- Update path: change a file, push, wait for the deploy plus ~10 minutes, open the installed app online, confirm "Update available",
  reload, check the new version in Settings and that every downloaded game still plays offline.

## How it fits together

- `scripts/build.mjs` copies `src/` to `dist/` and splits it into packs: the app shell (everything
  outside `games/`) and one pack per game folder, each with its own content hash. It inlines the packs
  and an overall `VERSION` into `dist/sw.js`.
- `src/sw.template.js` caches the app shell at install, downloads a game's pack when the launcher asks,
  and serves each URL from its pack's cache. Every file is fetched as `?v=<hash>` and checked against
  that hash, so a stale copy from GitHub's CDN right after a push never gets cached. Runtime responses are never cached. An update re-downloads
  only the games the device has whose content changed; unchanged games keep their cache.
- `src/shared/sw-client.js` registers the worker, shows the update prompt, reports "Ready offline" only
  after checking every app-shell file is cached, runs downloads with progress, and checks whether it's
  online (by fetching `/version.json`, which is never cached).
- `src/launcher.js` shows only the install guide in a browser tab. In the installed app it lists each
  game as Play, Download (with its size) or "Go online to download", plus "Download all".
- Every page starts with a fixed `status-tint` strip in the header's black: iOS 26+ takes the status
  bar colour from it instead of blurring the top of the app.
- `src/shared/storage.js` keeps saves in `localStorage` as `gh:<game>:<key>` → `{ schema, data }`,
  written 250 ms after each move and immediately when the app is hidden. Settings → Export/Import
  moves all saves as one JSON file.
- Sudoku puzzles are generated in a Web Worker (`worker.js`) from a seeded PRNG; the pure rules live in
  `generator.js` / `solver.js`. 2048's rules live in `logic.js`, separate from the animated UI in `game.js`.
- Tanks keeps its simulation in DOM-free modules: `rules.js` (constants, tank kinds, exact ricochet
  tracing), `engine.js` (the fixed 120 Hz step), `ai.js` (enemy brains) and `missions.js` (the 20 maps).
  `art.js` draws tanks, shots, bombs and the floor on whatever canvas it is given; `render.js` uses it
  for the arena, and so does the field guide in `guide/`. `audio.js` synthesises the sound effects,
  and `tanks.js` handles input, the campaign and saves. The world is plain JSON, so a mission in
  progress resumes exactly. `TANKS.md` holds the Tanks backlog.
