# Ktan: a board game where each phone is a player, and Star, the app's multiplayer layer

Status: design only, nothing built (2026-10-16). Name **Ktan**, the same in Catalan; game id `ktan`.

Ktan is a settle-and-trade game on an island of hexes, in the family of *Catan*: the same kind of
rules, so friends who know that game can play at once, with our own art and wording. Catan is a
trademark: its art and card titles stay out. The name Ktan is a deliberate nod to it, chosen by Pol.

Ktan is the first game to need several phones at once, so it comes with **Star**, the multiplayer
layer every later multiplayer game will share (Tanks too, one day). Part A is Star, Part B is the
game, Part C is the order to build it in.

---

## Part A: Star

### A1. The shape: a star around one phone

- One phone is the **host**. It owns the game: it runs the rules engine, holds the only true state,
  and decides every outcome, the dice too. The host is a player like any other.
- Every other device is a **member**. It sends what its player wants to do and shows what the host
  tells it. Members never talk to each other; everything goes through the host.
- Between the host and each member there is one **link**, of one of two kinds:
  - **Direct:** a WebRTC data channel over the local network. No internet and no Cloudflare. Proven
    on 2026-10-16 between an iPhone and a Mac on the same Wi-Fi: linked in under a second, about 9 ms
    round trip.
  - **Relayed:** a WebSocket to the room on Cloudflare (a Worker and one Durable Object per room),
    which forwards messages between the host and that member.
- The host is always the authority, whatever the links are. The room on Cloudflare only carries
  messages (and keeps a backup, A6); it never runs the rules. So moving a link from relayed to direct
  changes nothing in the game.

### A2. A room's life, online

1. **Create.** The host taps New room. The Worker returns a 4-letter code (from letters that can't be
   misread: no I, O, 0 or 1) and a host token. The room screen shows the code large.
2. **Join.** A member types the code. It connects to the room by WebSocket and gets a seat token,
   kept in its save. The member is now in, relayed.
3. **Try direct.** As soon as a member joins, the host and the member try a direct WebRTC link,
   passing their offer and answer through the room. The link uses `iceServers: []`, local addresses
   only, as in the Nearby test. If its data channel opens within 5 s, that member's link switches to
   direct. If not, it stays relayed. The link opening *is* the test of being on the same network;
   nothing inspects addresses (WebKit hides them anyway).
4. **Go local.** When every member is direct, the room goes **local**: every phone closes its
   WebSocket, and Cloudflare sees nothing more of the game. A room with one remote friend keeps only
   that member relayed; everyone else stays direct.
5. **Start.** The host starts the game. From then on the room takes no new seats; only seat tokens can
   come back.
6. **End.** The host ends the room, or the room deletes itself 24 h after its last activity.

### A3. Coming back

iOS suspends a web app as soon as it goes to the background, and its links drop. That will happen
all the time (a message comes in, someone checks a map), so coming back must be quick and quiet.

- A member that comes back to the foreground reconnects with its seat token. It goes through the
  Worker if online, then tries direct again as in A2.
- In a local room, a member whose link died asks the host for a new link through any phone it can
  still reach. Failing that, it waits for an invite (A4).
- The host keeps the member's seat while it's away. Its turn can wait, or be skipped after a time the
  room sets (an option: Wait / Skip after 1 min).
- A Screen Wake Lock (`navigator.wakeLock`, where Safari supports it) keeps phones awake during a
  game, so screens going dark doesn't count as leaving.

### A4. Wi-Fi without internet

With no internet (a travel router, a cabin's Wi-Fi), there's no Worker, so the first handshake goes
phone to phone by **QR codes**:

- The newcomer scans the host's invite QR (the offer). The host scans the newcomer's reply QR (the
  answer). That's two scans per newcomer.
- Any seated phone can invite: it passes the newcomer's link setup on to the host over its own link,
  so several people can join at once.
- With local addresses only, an offer or an answer packs into about 100–150 bytes: a small QR code.
- Safari has no built-in barcode reader for pages (BarcodeDetector is off by default), and the app
  takes no libraries, so this needs our own QR encoder and decoder. That's why it comes last (Part C).
  Until then, a room on an offline Wi-Fi needs internet once to form. It can then go local and the
  internet can drop.

### A5. The hotspot rule (tested 2026-10-16)

An iPhone sharing its Personal Hotspot **cannot send** over WebRTC to the devices joined to its
hotspot. iOS drops its packets right after the handshake (seen in a packet capture). No page-level
switch changes this (camera on first, page served on the hotspot by name and by IP, Feature Flags).

So:

- The hotspot phone never gets a direct link. When it has signal, it plays relayed, over cellular,
  and that works fine.
- The hotspot phone shouldn't host: its direct links would all fail and the whole room would stay
  relayed. When the host's direct tries fail with every member, the room screen suggests handing the
  host role to someone else (A6). The join screen also says: "Sharing your hotspot? Let someone else
  create the room."
- With no signal at all, the hotspot phone can't play. Only a native app could change that.

### A6. Handing over the host, and losing it

- The game's state is small: a few KB of JSON. After every action, the host saves it on the phone and,
  while online, sends a copy to the room as a backup.
- **Hand over:** the host picks a member. It sends that member the full state, the new host takes
  over, and the links re-form around it (through the Worker, or through the old host while it's still
  there).
- **Host lost** (app killed, phone off):
  - *Online:* the room notices (its WebSocket closed for more than 20 s), names the next seat as
    host, and gives it the last backup. Play goes on from the last action.
  - *Local, offline:* the room waits ("Waiting for Pol"). The host reopens the app and the room
    resumes from its save; members come back as in A3 or A4. Automatic takeover offline can come
    later.

### A7. Messages

One format for both kinds of link: JSON on one reliable, ordered data channel (direct) or on the
WebSocket (relayed).

```
{ v: 1, n: <sequence>, t: <type>, ...body }
```

- **Member to host:** `hello { token, name, release }`, `act { id, action }`, `ping`.
- **Host to member:**
  - `welcome { seat, players }`;
  - `view { rev, view }`: that member's own view of the whole state, sent in full each time
    (it's small, so there are no diffs to get wrong);
  - `reject { id, reason }`;
  - `event { … }`: what to animate and play (dice, a robber move, a trade offer);
  - `pong`.
- **Secrets stay on the host.** No phone ever receives another player's hand or development cards,
  or the random seed (A9, B5).
- **Versions:** `hello` carries the app's release. The host refuses a mismatch with "Update the app
  to play in this room". Every phone updates itself through the service worker.
- While relayed, the Worker can read the messages (they're encrypted only to Cloudflare). That's fine
  for a board game between friends. End-to-end encryption can come later if wanted.

### A8. The Cloudflare side (`worker/`)

- **One Worker** on its own origin (`cache-only-rooms.<account>.workers.dev`).
  `https://cache-only.github.io` stays untouched.
- **Routes:** `POST /rooms` returns `{ code, hostToken }`. `GET /rooms/<code>` upgrades to a
  WebSocket, with a token, or with a name for a new seat.
- **One Durable Object per room.** It uses SQLite storage (the only kind on the free plan) and the
  WebSocket Hibernation API, so an idle room costs nothing. It holds the seats, tokens, who is
  connected, and the last state backup. It forwards host–member messages and the offers and answers
  for direct tries. An alarm deletes it 24 h after its last activity.
- **Who may connect:** it checks the `Origin` header: only `https://cache-only.github.io` and the dev
  origins (`npm run lan`, `npm run serve`). It also limits how fast rooms can be created.
- **It fits the free plan.** Durable Objects allow 100,000 requests a day. Incoming WebSocket
  messages count as 1/20 of a request and outgoing ones are free. A whole game of Ktan is a few
  hundred actions, so a few dozen requests; thousands of games a day fit. No TURN is needed:
  relayed links go through the room, not through TURN.
  (For later: real-time Tanks, relayed, at 20 messages a second from 12 phones, would use the free
  day's requests in about 2.3 hours. Direct links cost nothing, so Tanks would lean on local play.)
- **Deploy** with `scripts/worker.mjs`: Node built-ins only, calling the Cloudflare API with an API
  token from an environment variable. Or paste the code into the dashboard. No wrangler and no
  `npm install`.

### A9. The client module (`src/shared/star.js`)

Shared (it lives in the app shell), DOM-free, and used by every multiplayer game. It repeats what the
connection test of 2026-10-16 did (its code was removed afterwards; it's in commit `08a3d47` on `dev`):
one offer and one answer, no trickle, `iceServers: []`, and a per-second link trace (packets sent and
received from `getStats`) behind a debug switch.

```js
const room = await Star.create({ game: 'ktan', name });     // host
const room = await Star.join(code, { name });               // member (or { token } to come back)

room.on('members', fn);   // who's in, and each one's link: 'direct' | 'relayed' | 'away'
room.on('message', fn);   // (from, msg)
room.on('host', fn);      // the host changed (A6)
room.send(msg);           // member: to the host
room.sendTo(seat, msg);   // host: to one member
room.broadcast(msg);      // host: to every member
room.local;               // true when no link uses the Worker
room.handOver(seat);      // host
room.leave();
```

### A10. Changes to CLAUDE.md, once approved

- **Zero runtime network dependencies:** playing on one device never touches the network. Multiplayer
  may reach the rooms Worker's origin, and nothing else (no STUN, no TURN: direct links use local
  addresses only).
- **Layout:** `worker/`, `src/shared/star.js`, `src/games/ktan/`.
- **Tests:**
  - `tests/star.test.mjs`: the protocol over fake transports (join, go local, come back, hand over,
    lose the host, version mismatch);
  - `tests/worker.test.mjs`: the Durable Object with a fake storage and fake sockets;
  - `tests/ktan.test.mjs`: the rules.

---

## Part B: Ktan, the game

### B1. In one paragraph

Settle an island of hexes, collect resources when their numbers are rolled, and build roads,
settlements and cities. Trade with each other and with the bank, buy development cards, and be first
to 10 points. For 3 to 6 players, each on their own phone. Everyone sees the whole board; each hand
is private. Optional extra devices with no seat (a "table": an iPad or a laptop) show the board large
for everyone, with the dice and the log.

### B2. Rules

These follow the classic base game. The five- and six-player numbers below are to be checked against
that edition's rulebook before building.

- **Island (3–4 players):**
  - 19 land hexes: 4 forest (wood), 4 pasture (wool), 4 fields (grain), 3 hills (brick),
    3 mountains (ore), 1 desert.
  - A sea ring with 9 harbours: 4 generic (3:1) and 5 for one resource each (2:1).
  - 18 number tokens: 2, 12, and two each of 3–6 and 8–11. A 6 and an 8 are never adjacent.
- **Island (5–6 players):**
  - 30 land hexes: 6 forest, 6 pasture, 6 fields, 5 hills, 5 mountains, 2 deserts.
  - 28 number tokens and 11 harbours.
  - Development deck 34, bank 24 of each resource.
  - A special building phase after each turn, when the others may build.
- **Layouts:** generated from a seed, with the 6/8 rule and an even spread of resources. Or the fixed
  starter layout, for a first game.
- **Setup:** in snake order (1 to N, then N to 1), each player places a settlement and a road. The
  second settlement collects one of each resource around it.
- **A turn:**
  1. **Roll:** a knight may be played first. Every settlement on a hex with the rolled number gets
     1 of its resource, and every city 2, unless the robber sits on that hex.
     On a 7: everyone holding more than 7 cards discards half, rounded down, all at once. The roller
     then moves the robber and steals 1 random card from a player beside it.
  2. **Then, in any order:**
     - trade with players (offers, B3);
     - trade with the bank at 4:1, or at a harbour where you have a settlement or city (3:1 or 2:1);
     - build;
     - play at most one development card. A card bought this turn can't be played this turn.
       Victory point cards don't count toward this; they stay hidden until they win the game.
  3. **End turn.**
- **Costs:**
  - road: brick + wood;
  - settlement: brick + wood + wool + grain;
  - city: 3 ore + 2 grain (it replaces a settlement);
  - development card: ore + wool + grain.
- **Placing:**
  - No settlement on a corner next to another settlement or city (the distance rule).
  - After setup, a settlement must touch your own road, and a road must touch your road, settlement
    or city.
  - Each player has 15 roads, 5 settlements and 4 cities.
- **Development deck (25):**
  - 14 Knights: move the robber and steal;
  - 5 victory points;
  - 2 Road building: two free roads;
  - 2 Harvest: take any 2 resources from the bank;
  - 2 Embargo: name a resource, and every player gives you all of it.
  These are our names. None of the original card titles.
- **Bonuses, worth 2 points each:**
  - Longest road: at least 5 connected roads, which another player's settlement can break.
  - Largest army: at least 3 knights played.
  On a tie, the current holder keeps the bonus.
- **Bank:** 19 of each resource. If the bank can't pay everyone a resource, nobody gets it, unless
  only one player is owed it; that player gets what's left.
- **Winning:** reach 10 points during your own turn.

### B3. What each phone shows

- **Portrait:**
  - The board fills the width at the top. It is never zoomed (no zoom anywhere in the app).
  - Under the board: your hand (five resource counts, then your development cards) and the moves:
    Roll, Build, Trade, Cards, End turn.
  - The header: home (side menu), whose turn it is, and your points.
- **Landscape:** the board on the left; the hand and the moves beside it, as in Sudoku.
- **The others:** a strip with each player's colour, name, visible points, card count, knights played
  and road length.
- **Placing on the board:** a phone's hex corners and edges are smaller than a finger. So while
  building, the legal places blink. A tap picks the nearest legal place to the finger, it lights up,
  and Build confirms it. Never a single tap that builds by accident.
- **Trading:** a sheet.
  - "Give 2 wool, want 1 ore" goes to everyone at once. Each phone gets an offer sheet with Accept,
    Decline and Counter.
  - The proposer picks one of the acceptances.
  - Bank and harbour trades are in the same sheet, already priced at your best rate.
- **The robber:** tap a hex, then pick whom to steal from among the players next to it.
- **Discarding on a 7:** a docked sheet on each phone that has to discard, all at the same time. The
  game waits for everyone.
- **Shared moments:** the host announces each roll as an event. Every phone shakes its dice at the
  same moment, and resources fly into the hands that earned them. Sound comes through
  `shared/sound.js`, so it follows the app's Sound switch.
- **Table device:** the board large, the dice, the log and the players around the edge. It has no
  hand and no buttons.

### B4. Fitting the design system

- Everything outside the board comes from `styles.css`: sheets, the side menu, buttons, the stat
  header, segmented controls. The game's own stylesheet draws the board and nothing else.
- Colour lives only on the board, as Tanks' kinds do in the arena:
  - terrains in muted tones that read on `--bg`;
  - six player colours, for roads, settlements and cities.
  - Each player also gets a mark, so colour is never the only clue.
- The five resources and the pieces become pixel icons in `shared/icons.js`, like every other icon.
- The side menu: Resume, Rules (a sheet), Room (code, links, hand over), Leave game, Back to games.

### B5. The engine (`src/games/ktan/rules.js` and friends)

- DOM-free and deterministic, with the whole state as plain JSON (like Tanks).
  - `newGame(seed, players, options)`;
  - `legalActions(state, seat)`;
  - `apply(state, seat, action)` returns `{ state, events }` or refuses;
  - `view(state, seat)` returns what that seat may see.
- **Randomness:** a seeded PRNG (mulberry32, as in Sudoku) inside the state. It drives the board, the
  dice, steals and the deck order. `view` strips the seed, or a member could predict every roll.
- **Geometry:** axial hex coordinates. Corners and edges get stable ids, and the adjacency tables are
  built once.
- **Tests:**
  - setup order and the second settlement's resources;
  - production, and the robber's hex;
  - sevens: discards and steals;
  - the distance rule and road connection;
  - longest road: loops, branches, broken by another settlement, ties;
  - largest army, and harbour rates;
  - running out of bank cards;
  - development card timing;
  - winning only on your own turn;
  - the same seed gives the same game;
  - a view never shows another player's secrets.

### B6. Saves

- **Host:** `gh:ktan:game`, the full state plus the room, written after every action.
- **Members:** `gh:ktan:seat`, the room code, the seat token and the last view, so a killed app comes
  back to its seat.
- **Later:** pass-and-play on one device, with a "hand the phone to Anna" screen hiding the last
  player's hand. It's also the easiest way to build and test the board before Star exists.

---

## Part C: Build order

0. **Done (2026-10-16):** a connection test (since removed). Direct links work on the same Wi-Fi. The
   hotspot phone can't send (A5).
1. **Engine:** the Ktan engine and its tests, with no UI.
2. **Board on one device:** the board and hand UI, playable pass-and-play on one phone (B6). This is
   where the placing, trading and robber screens get right.
3. **Star, relayed:** the Worker and its Durable Object, `star.js`, and the room screen (create, join
   by code, seats). Ktan playable across phones through Cloudflare.
4. **Star, direct:** direct tries, going local, coming back, handing over and losing the host.
5. **Offline:** QR invites for Wi-Fi with no internet (A4): our own QR encoder and decoder.
6. **Polish:** the table device, generated islands, the 5–6 player island, and a rules page.

## Part D: Open questions for Pol

- **Players:** stop at 6, as the classic game does, or allow bigger islands for 7–8 (our own
  variant)?
- **Table device:** in the first version, or later?
- **Dice:** trust the host (friends), or have every phone add its own randomness, so even the host
  can't fix a roll?
- **Cloudflare:** whose account, and the Worker's name.
- **Spectators:** phones with no seat that only watch, like the table device?
