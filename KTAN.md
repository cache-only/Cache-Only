# Ktan: a board game where each phone is a player, and Star, the app's multiplayer layer

Status: design only, nothing built (2026-10-16). Name **Ktan**, the same in Catalan; game id `ktan`.
The look is drawn on a design canvas: B8 links it and says what's settled.

Ktan is a settle-and-trade game on an island of hexes, in the family of *Catan*: the same kind of
rules, so friends who know that game can play at once, with our own art and wording. Catan is a
trademark: its art and card titles stay out. The name Ktan is a deliberate nod to it, chosen by Pol.

Ktan is the first game to need several phones at once, so it comes with **Star**, the multiplayer
layer every later multiplayer game will share (Tanks too, one day). Part A is Star, Part B is the
game, Part C is the order to build it in.

---

## Part A: Star

### A1. The shape: a star around one host

- One device is the **host**. It owns the game: it runs the rules engine, holds the only true state,
  and decides every outcome, the dice too. Without a table the host is one of the phones, a player
  like any other. With a table in the room (B4), the table hosts and has no seat. It stays in the
  foreground, awake and plugged in, for the whole game, while a phone goes to the background every
  time its player reads a message (A3). A host in the background stops the game for everyone; a
  member in the background only holds up its own seat.
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

1. **Create.** The host (the table, if there is one) taps New room. The Worker returns a 4-letter code (from letters that can't be
   misread: no I, O, 0 or 1) and a host token. The room screen shows the code large.
2. **Join.** A phone on the host's network sees the room listed by itself ("On this Wi-Fi": the
   room is listed under its host's public address, an IPv4 address or an IPv6 /64, while it takes
   seats and the host is in) and taps it; from anywhere else, a member types the code. Either way it
   connects to the room by WebSocket, gets a seat token kept in its save, and **knocks**: the seat
   waits, unadmitted, reaching the host only to try a direct link. A seat that links directly is let
   in by itself, since a link that uses only local addresses only opens on the same network; any
   other waits until the host taps Let in (or Turn away). (Added 2026-10-16. On a public Wi-Fi, a
   café's, anyone on it can get in the same way; a few internet providers also put several homes
   behind one address, so a neighbour could see the room listed, though not get in.)
   **iCloud Private Relay** (found 2026-10-16 on Pol's iPhone and Mac: their requests came from
   Apple's Barcelona relay range, `2a09:bac3:3110::/45`) hides the home's address from the Worker,
   and its addresses are shared with strangers. So the Worker never lists or looks up by a relay's
   address (it tells them by ASN: Cloudflare, Akamai, Fastly). Each phone instead asks Cloudflare's
   STUN server for its network's public address (WebRTC doesn't go through the relay), at most once
   a minute on a throwaway connection, and names it with every connection (`&at=`). Behind a relay
   that's taken as it is; otherwise only alongside the address the Worker sees, so a device can't
   simply claim someone else's network. A false claim shows a room's name and code, nothing more.
3. **Try direct.** As soon as a member is in, it offers the host a direct WebRTC link, passing the
   offer and the answer through the room. The link uses `iceServers: []`, local addresses only, as
   in the Nearby test. If its data channel opens within 6 s, that member's link switches to direct.
   If not, it stays relayed and tries again after 2, 5, 15 and 30 s, then every minute, and at once
   when the app comes back to the foreground or the host comes back. The link opening *is* the test
   of being on the same network; nothing inspects addresses (WebKit hides them anyway). Each side
   pings a direct link every 5 s; one that goes 3 s without an answer has ended (the phone left the
   Wi-Fi or slept), and that member is relayed again until the next try links. The host tells every
   member how each one reaches it, for their lists.
4. **Go local.** When every member is direct, the room is **local**: every message goes phone to
   phone, and Cloudflare sees nothing of the game. Each phone keeps its WebSocket to the room open
   while it can, idle but for a ping every 20 s that the runtime answers without waking the room
   (free), so the room still knows who's there and can replace a lost host (A6). If the internet
   goes, the direct links carry on alone. A room with one remote friend keeps only that member
   relayed; everyone else stays direct. (Decided 2026-10-16, when building it: closing the WebSockets
   saved nothing and would have lost A6 online.)
5. **Start.** The host starts the game. From then on the room takes no new seats; only seat tokens can
   come back.
6. **End.** The host ends the room, or the room deletes itself 24 h after its last activity.

### A3. Coming back

iOS suspends a web app as soon as it goes to the background, and its links drop. That will happen
all the time (a message comes in, someone checks a map), so coming back must be quick and quiet.

- A member that comes back to the foreground reconnects with its seat token. It goes through the
  Worker if online, then tries direct again as in A2.
- A member whose direct link died goes back to relayed and offers a new link through the room
  (A2, step 3). With no internet as well, it needs another phone to pass its offer on, or an
  invite (A4): still to build.
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
- A table host shows its invite QR large. Its front camera faces the ceiling, so a newcomer holds
  their phone face down over it to show the reply.
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
  there). A table can hand over to a phone too (its battery is low, say); the phones then get their
  boards back (B3).
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
  or the random seed (A9, B6).
- **Versions:** `hello` carries the app's release. The host refuses a mismatch with "Update the app
  to play in this room". Every phone updates itself through the service worker.
- While relayed, the Worker can read the messages (they're encrypted only to Cloudflare). That's fine
  for a board game between friends. End-to-end encryption can come later if wanted.

### A8. The Cloudflare side (`worker/`)

- **One Worker** on its own origin (`cache-only-rooms.cache-only.workers.dev`, A11).
  `https://cache-only.github.io` stays untouched.
- **Why Cloudflare, not a server of our own** (Oracle's free VMs were the other choice): a room
  server sits idle almost all the time, and Oracle reclaims Always Free VMs that stay idle for a
  week. A VM also needs a domain for its certificate, firewall rules and OS updates, all ours to
  keep. The Worker needs none of that: `workers.dev` gives it HTTPS, and Cloudflare runs it. A VM
  would only win if we needed TURN or a long-running process, and we need neither.
- **Routes:** every connection is a WebSocket, so there is no separate request to create a room
  (and no CORS):
  - `/rooms/new?game=ktan&name=Anna` creates a room and seats its host;
  - `/rooms/ABCD?game=ktan&name=Pol` takes a new seat, until the host starts;
  - `/rooms/ABCD?game=ktan&token=…` brings a seat back.
  `&table=1` marks a table. The first message is `welcome { code, seat, token, host, started,
  admitted }`.
  A refusal still opens the socket and closes it with a code, since a browser can't read why a
  handshake failed: 4004 no such room, 4005 another game, 4003 unknown token, 4009 started,
  4008 full (12 seats), 4011 busy (too many waiting), 4006 turned away, 4029 flooding, 4000
  replaced by a newer socket of the same seat, 4010 ended. `GET /nearby?game=ktan` lists the rooms
  on the asker's network as `[{ code, name }]`.
- **Messages:** a member sends `{ msg }`, always to the host; the host sends `{ to: seat | 'all',
  msg }`; both receive `{ from, msg }`. The room sends `seats { host, started, seats }` whenever
  someone comes, goes or is let in, and `host { host, backup }` to a new host. The host sends
  `admit`, `refuse`, `backup`, `start`, `handover` and `end`; a member sends `leave`. `to: 'all'`
  skips seats still waiting. The text `ping` gets `pong`, answered by
  the runtime without waking the room.
- **One Durable Object per room.** It uses SQLite storage (the only kind on the free plan) and the
  WebSocket Hibernation API, so an idle room costs nothing. It holds the seats, tokens, who is
  connected, and the last state backup (up to 100 KB). It forwards host–member messages and, later,
  the offers and answers for direct tries. One alarm serves the host's 20 s grace (A6) and the
  room's expiry, 24 h after its last activity.
- **Who may connect, and what stops abuse** (2026-10-16). There are no accounts and no secret in
  the app (its code is public, so a secret wouldn't stay one). Instead:
  - `Origin` must be the app's (`https://cache-only.github.io`) or a dev server's: this keeps other
    websites out, though not a script that fakes the header.
  - The nearby list shows a room only to its host's network, as above: by the address seen, or
    behind a privacy relay by the address STUN gave, never by the relay's own.
  - A new seat gets in only when the host lets it in, or when it links to the host directly with
    local addresses only. Each side strips every non-local address from its own offer or answer
    and from the other's (`localOnly` in `star.js`), so an outsider can't make a direct link by
    offering a public address, or by reaching one of the host's.
  - A seat comes back only with its token (128 random bits). Only the host's socket can admit,
    refuse, start, hand over, back up or end, and members only ever reach the host.
  - Limits per network (one object per network, `Net`): 10 new rooms, 20 knocks and 120 nearby
    lookups a minute. Per room: 12 seats, 6 waiting at once and 2 from any one network but the
    host's (so one outsider can't block the door), a waiting seat that disconnects is gone, and the
    start turns away whoever is still waiting.
  - Per socket: a member may send 16 KB a message and 20 messages a second (bursts of 40), the
    host 128 KB and 200 a second; past that the room closes the socket (4029).
  - What's left: anyone can still spend the free plan's daily allowance by connecting over and
    over, which stops rooms until 00:00 UTC (no cost: there's no card). Direct links carry on.
- **It fits the free plan.** Durable Objects allow 100,000 requests a day. Incoming WebSocket
  messages count as 1/20 of a request and outgoing ones are free. A 2-hour game with 4 phones and
  300 actions comes to about 170 requests relayed, or 107 when local, most of them the room pings
  (counting each as a message): about 600 relayed games a day. The tighter limit is 100,000 rows
  written a day: each backup writes about 3 (the backup, the room record, its alarm), so backing up
  after every action allows about 100 full games a day. If that ever matters, write the room record
  at most hourly and back up at most every few seconds. No TURN is needed: relayed links go through
  the room, not through TURN.
  (For later: real-time Tanks, relayed, at 20 messages a second from 12 phones, would use the free
  day's requests in about 2.3 hours. Direct links cost nothing, so Tanks would lean on local play.)
- **Deploy** with `npm run worker` (`scripts/worker.mjs`): Node built-ins only, calling the
  Cloudflare API with the account token (A11). It uploads `worker/rooms.js` with its Durable Object
  binding and migration, turns on its `workers.dev` address, then plays a short game of messages
  against it as the app would. `npm run worker --check` only checks. No wrangler and no
  `npm install`. **Deployed 2026-10-16.**

### A9. The client module (`src/shared/star.js`)

Shared (it lives in the app shell), DOM-free, and used by every multiplayer game. **Built
2026-10-16, relayed and direct links.** Direct links repeat what the connection test of 2026-10-16
did (its code was removed afterwards; it's in commit `08a3d47` on `dev`): one offer and one answer,
no trickle, `iceServers: []`. Still to add: a per-second link trace (packets sent and received from
`getStats`) behind a debug switch. On both ways a game's message travels as `{ a: msg }` and Star's
own as `{ s: … }` (offer, answer, links, and ping and pong on a direct link), so the Worker needs no
change for direct links.

```js
const room = await Star.create({ game: 'ktan', name });         // host
const room = await Star.create({ game: 'ktan', seat: false });  // a table: hosts, with no seat
const room = await Star.join(code, { game: 'ktan', name });     // member
const room = await Star.join(code, { game: 'ktan', token });    // a seat coming back
const rooms = await Star.nearby({ game: 'ktan' });               // [{ code, name }] on this network
// A failed create or join rejects with err.reason: offline, room, game, token, started, full, busy.
// A new seat starts waiting (room.admitted false) until the host lets it in.

room.on('members', fn);   // who's in, and how each reaches the host: 'host' | 'direct' | 'relayed' | 'away'
room.on('message', fn);   // (from, msg)
room.on('host', fn);      // ({ host, backup }): the host changed (A6); backup is for the new host
room.on('status', fn);    // the room's connection: 'open' | 'reconnecting' | 'closed'
room.on('link', fn);      // (seat, link, why): a direct link opened ('direct') or ended
room.on('knock', fn);     // host: (member) a new seat waits to be let in
room.on('admitted', fn);  // member: the host let this seat in
room.on('closed', fn);    // (reason): left, ended, replaced, …
room.send(msg);           // member: to the host
room.sendTo(seat, msg);   // host: to one member
room.broadcast(msg);      // host: to every member
room.admit(seat);         // host: lets a waiting seat in (a direct link does it by itself)
room.refuse(seat);        // host: turns a waiting seat away for good
room.backup(state);       // host: kept by the room for whoever hosts next
room.start();             // host: no new seats from now on
room.handOver(seat);      // host
room.end();               // host: closes the room for everyone
room.leave();             // member: gives up the seat
room.close();             // lets go of the link, keeping the seat
room.wake();              // the app is back in the foreground: check the link now
room.local;               // true when none of this device's messages go through the Worker
```

Messages sent while the room is out of reach (and the link isn't direct) wait in a queue and go once
it's back; what was queued as host is dropped if the room changed hands meanwhile. Messages arrive at
most once and in order on each way, but one sent just as a link changes way can overtake another or
be lost, so a game sends whole views with a revision (A7) and the host answers every act.

### A10. Changes to CLAUDE.md (approved and made, 2026-10-16)

- **Zero runtime network dependencies:** playing on one device never touches the network. Multiplayer
  may reach the rooms Worker's origin and, to find rooms on the same Wi-Fi, Cloudflare's STUN server
  for the network's address (approved 2026-10-16), and nothing else (no TURN, and no STUN in a
  link: direct links use local addresses only).
- **Layout:** `worker/`, `src/shared/star.js`, `src/games/ktan/`.
- **Tests:**
  - `tests/star.test.mjs`: `star.js` against the real Worker in memory (join, come back, hand over,
    lose the host; later: go local, version mismatch);
  - `tests/worker.test.mjs`: the Worker and its Durable Object with a fake storage and fake sockets
    (`tests/fake-rooms.mjs`);
  - `tests/ktan.test.mjs`: the rules (with the engine).

### A11. Setting up Cloudflare (Pol, once)

Only Pol can do these. Everything else is code, and none of it needs the account until the first
deploy.

1. Make a free Cloudflare account (the free plan needs no card), confirm the email, and turn on
   two-factor login: the token below can deploy code under that account.
2. Make an **account** API token (owned by the account, not by Pol's user), under Manage account →
   Account API tokens → Create Token, with one permission: Workers Scripts → Edit. Copy the
   account ID from the dashboard. `scripts/worker.mjs` checks the token at
   `/accounts/<id>/tokens/verify` (an account token fails the user endpoint, `/user/tokens/verify`).
3. Keep both in the shell (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, in `~/.zshrc` for
   instance), never in the repo or a chat. `scripts/worker.mjs` reads them. The Worker is deployed
   by hand; the Pages workflow never touches it.
4. For direct links at home, the Wi-Fi must let devices see each other: a guest network with client
   isolation keeps every link relayed (it still plays, through Cloudflare).

**Done (2026-10-16):** the account exists, its token is in Pol's `~/.zshrc` (checked valid), and
its `workers.dev` subdomain is `cache-only`, claimed through the API
(`PUT /accounts/<id>/workers/subdomain`), since the dashboard didn't show the setting. The Worker
will answer at **`cache-only-rooms.cache-only.workers.dev`**. Unlike the app's origin this name
isn't sacred: nothing a phone keeps lives there, so a release can move it.

Free-plan limits, checked on 2026-10-16: 100,000 Durable Object requests a day (incoming WebSocket
messages count 1/20 each, outgoing are free), 13,000 GB-s of duration and 5 GB of SQLite storage.
Past a limit, calls fail until 00:00 UTC. A game of Ktan uses a few dozen requests, so the limit is
far away, and a room that has gone local doesn't use Cloudflare at all.

---

## Part B: Ktan, the game

### B1. In one paragraph

Settle an island of hexes, collect resources when their numbers are rolled, and build roads,
settlements and cities. Trade with each other and with the bank, buy development cards, and be first
to 10 points. For 3 to 6 players, each on their own phone. Everyone sees the whole board; each hand
is private. An iPad lying in the middle of the real table can be the **table** (B4): it shows the
board large for everyone, turns it toward whoever is playing, flies the cards to where each player
sits, and hosts the game. The phones then need no board at all.

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

- **Without a table: the board on top, the panel under it.**
  - **Portrait:** the board right under the status bar, as wide as the screen and tilted toward
    the player (B8), so it is about three quarters as tall as it is wide. Under it, the panel: the
    others, your hand, the pieces you have left and the moves. The board's top corners are open
    sea: the home button floats in the top-left one and your points in the top-right one, as
    Sudoku's and Tanks' headers float, with no header band. The dice sit in its bottom-right corner.
  - **Landscape:** the board on the left, centred on the screen's height; the panel on the right,
    a little narrower than the board.
  - The board is never zoomed (no zoom anywhere in the app). Each phone always tilts it toward its
    own player.
- **With a table (B4): no board and no squares.** The board lives on the table, and placing happens
  there, so the whole phone is your cards and the moves, with room to show the cards themselves: a
  resource is a fanned stack, one card per card you hold, with its count on it.
  - **Portrait:** the others across the top, between home and your points; your hand filling the
    middle, large; the moves along the bottom, under the thumbs.
  - **Landscape:** your cards in one long row across the screen, resources then development cards,
    so more of them show at once; the others above them, and the moves down the right edge.
  - If the table leaves the room, the board comes back.
- **The panel**, top to bottom:
  - **The others:** a chip per player, in turn order: colour and mark, visible points, cards in
    hand, and a brass badge for Longest road or Largest army. The player whose turn it is is lit.
  - **Your hand:** the five resources as illustrated cards in their terrain's colour, each with its
    count (dim at 0), then your development cards, face up. Tapping any card lifts it up close (B8).
  - **Pieces left:** roads, settlements and cities, each drawn with how many you have left.
  - **The moves:** Roll, Build and Trade. Roll turns into End turn once you've rolled, so the one
    primary on the screen is always the next step of your turn. While it isn't your turn the moves
    are off; an offer to you comes as a sheet.
- **A turn:**
  1. **Roll** (or play a Knight first, from your hand). The host rolls. Every phone shakes its dice
     at the same moment, and resources fly from the hexes into the hands that earned them: into
     your hand on your phone, into the others' chips on theirs.
  2. **Build:** a sheet with road, settlement, city and development card, each with its cost in
     resource icons. Anything you can't afford, have no pieces left for, or have no legal place for
     is off, and says which. A phone's hex corners and edges are smaller than a finger, so picking a
     piece closes the sheet and the legal places blink. A tap picks the nearest one to the finger
     and shows the piece there as a ghost; Build (primary) builds it and Cancel steps back. Never
     one tap that builds by accident. A development card comes face down off the deck and turns
     over in your hand.
  3. **Trade** (below), as often as you like.
  4. **Play a development card:** tap it in your hand: it lifts up close (B8), and its sheet says
     what it does, with Play. Play
     is off for a card bought this turn, once you've played one this turn, and on victory points:
     those count in the points in your corner, and the others' phones don't count them until the
     end.
  5. **End turn.**
- **Trading** happens on the trader's own turn: only the player whose turn it is proposes, once
  they've rolled, and the others answer (the classic rule: the others don't trade among themselves).
  - The trade sheet: **Give** and **Want**, the five resources each with − and + (Give stops at what
    you hold), and **To**: Everyone, one player, or the bank. Then Send.
  - **Everyone:** every other phone gets the offer as a sheet ("Anna gives 2 wool for 1 ore") with
    Accept, Decline and Counter; Accept is off for a player who can't pay. Anna's sheet fills in as
    the answers come (waiting, yes, no, a counter), and she taps one of the players who said yes to
    trade with them. The other offer sheets close.
  - **One player:** only that phone gets the offer, and its Accept trades at once.
  - **Counter** opens the trade sheet on the answering phone with the offer turned round, addressed
    to the proposer, who gets it as a one-player offer.
  - **Bank:** each row shows your rate for that resource (4:1, or 3:1 and 2:1 at your harbours).
    Give moves in steps of that rate, Want takes as many cards as it buys, and it trades at once.
  - No gifts: each side gives at least one card, and never the same resource both ways. An offer
    lasts until it's taken, withdrawn or replaced, or the turn ends. The host checks both hands
    again at the moment of the trade.
  - The cards fly from hand to hand on the two phones. With a table, they leave the giver's phone
    by its top, cross the table from the giver's edge to the taker's, and drop into the taker's
    phone from its top (B4).
- **The robber** (a 7 or a Knight): on a 7, every phone holding more than 7 cards first gets a docked
  sheet to discard half, rounded down, all at the same time; the game waits for everyone. Then the
  roller taps a hex, picks whom to steal from among the players with a building on it and a card in
  hand, and one card goes from that player to the roller, face down: only those two phones see what
  it was.
- **Setup:** in snake order, each player places a settlement and then a road, by the same blink, tap
  and Build.
- **Shared moments:** the host sends each roll, trade and steal as an event (A7), so every phone and
  the table show it at once. Sound comes through `shared/sound.js`, so it follows the app's Sound
  switch.
- **The end:** every phone shows the final points, with every victory point card turned over.

### B4. The table: an iPad in the middle

An optional device with no seat: an iPad (or a laptop) lying flat in the middle of the real table,
with everyone sitting round it. It shows only what everyone may see: the island, the dice and the
bank. Never a hand, and no names: each player is a glow on the edge in front of them, and their
numbers (points, cards, knights, road) are on the phones' chips.

- **It hosts** (A1). The table taps New room and shows the code large in the middle; the players
  join from their phones. It keeps its screen awake (wake lock) and is best plugged in.
- **Seats are picked on the phones.** Each phone draws the table's screen in its real proportions
  (the table says what screen it has, and its camera dot is drawn on the side where it really is,
  so the drawing is easy to turn the right way), with everyone seated so far round it; the player
  taps the edge in front of them. The table shows the seat at once: a glow on that edge carrying a
  disc with their mark, which slides along the edge with their finger. Someone who has joined but
  not picked waits as a disc in the middle. A seat is a point along the edge, so two players can
  share a long side. Play goes clockwise round the table, as the classic game passes to the left,
  from a first player the host picks at random.
- **A seat is a glow,** in its player's colour: a line of light on the screen's edge in front of
  them and a glow spreading inward. No name, no panel. It breathes on its player's turn.
- **The island faces the player whose turn it is,** drawn tilted toward them (B8), so the numbers
  read the right way up and the buildings stand up for them. It fills the middle, leaving a band
  along every edge for the glows. When the turn passes it is never spun as one picture:
  - to a seat at the side (a quarter turn), everything morphs: each tile, piece, lantern and
    plaque slides straight to its new spot and turns in place to face the new player, the rim a
    moment before the middle, while the sea dissolves from one view into the other;
  - to the seat across the table (a half turn), it is a mirror: the island folds flat along its
    middle, catching the light, and unfolds facing the other side.
  The glow passes from one edge to the other with it. The dice roll in front of the new seat.
  Under reduced motion the island changes at once.
- **Cards leave by the player's edge.** They never fly into a seat: each slides off the screen
  through its player's glow, which flares as it passes, and drops into that player's phone from the
  top on the same beat, so it reads as one movement from the table into the hand. The phone and the
  table run the animation on the same clock.
  - a roll: each hex that produces sends its cards toward every seat that earned them, one per
    settlement and two per city;
  - a trade: the open offer (its cards and a trade sign, no words) waits by the proposer's glow;
    each answer shows by the answering glow as an icon disc facing its player (yes, no, thinking);
    on a deal the cards come in from the giver's edge and leave by the taker's, both ways at once;
  - the bank (building, bank trades, discards, Harvest) is the middle of the island: cards paid to
    it come in from the payer's edge, fly there and fade; cards it pays come out of it and leave by
    the player's edge;
  - a steal: one card, face down, in from one edge and out by the other;
  - an Embargo: every seat sends that resource in from its edge, and it all leaves by the edge of
    the player who played it;
  - a development card: face down, from the middle out by the seat's edge.
- **Placing: tap on the table, confirm on the phone.** On the table a corner or an edge is bigger
  than a finger. The player picks a piece on the phone (Build, Road building, the robber, or a
  setup turn), and the legal places blink on the table. A tap there puts the piece down as a ghost,
  and another tap moves it. The phone says where it is ("Settlement: wood 6, brick 8, wool 10"),
  with Build (primary) to build it there and Cancel to step back. For the robber, the phone then
  asks whom to steal from. The table doesn't ask whose finger it is: it takes taps only while
  someone is placing, as theirs. A disc with the piece being placed shows by that player's glow.
- **Which way is up.** iPadOS turns the screen on its own when an iPad lying flat is nudged, and a
  web app can't lock it. So the seats are kept in the iPad's own frame, not the screen's: the table
  reads `screen.orientation.angle` and lays them out again, so each stays on the same physical edge
  whatever iOS does.
- **No log on the table:** text there can only face one way. The log is in each phone's side menu.
- **Leaving:** a table that leaves mid-game hands the host to a phone first (A6), and the phones get
  their boards back. Without a table, everything here happens on the phones (B3).

### B5. Fitting the design system

- Everything outside the board comes from `styles.css`: sheets, the side menu, buttons, the stat
  header, segmented controls. The game's own stylesheet draws the board and nothing else.
- Colour lives on the board and the cards, as Tanks' kinds do in the arena (the look is in B8):
  - each terrain in its resource's colour, and that resource's cards in the same colour;
  - six player colours, for roads, settlements, cities and the glows on the table;
  - brass and ivory for the details: tokens, port plaques, development cards, awards.
  - Each player also gets a mark, so colour is never the only clue.
  - The app around them (sheets, buttons, header) stays grey.
- Ktan's own icons (the resources, points, cards, knight, road, settlement, city, trade, dice, the
  marks) are smooth shapes in `SHAPES` (`shared/icons.js`), solid with their details cut out, as
  Tanks' shell and mine are. Only the app's chrome (home, close, plus, minus) keeps its pixels.
- The side menu: Resume, Log, Rules (a sheet), Room (code, links, hand over), Leave game, Back to
  games.
- The table is read from across a real table: nothing on it smaller than Heading, and no names.

### B6. The engine (`src/games/ktan/rules.js` and friends)

- DOM-free and deterministic, with the whole state as plain JSON (like Tanks).
  - `newGame(seed, players, options)`;
  - `legalActions(state, seat)`;
  - `apply(state, seat, action)` returns `{ state, events }` or refuses;
  - `view(state, seat)` returns what that seat may see, and `view(state, null)` what the table may
    (nobody's hand).
- **Turn order:** the order of `players`: clockwise round the table when there is one (B4).
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
  - trades: open, one-player and counter offers, no gifts, and a hand that can no longer pay;
  - running out of bank cards;
  - development card timing;
  - winning only on your own turn;
  - the same seed gives the same game;
  - a view never shows another player's secrets.

### B7. Saves

- **Host** (a phone or the table): `gh:ktan:game`, the full state plus the room, written after every
  action.
- **Members:** `gh:ktan:seat`, the room code, the seat token and the last view, so a killed app comes
  back to its seat.
- **Later:** pass-and-play on one device, with a "hand the phone to Anna" screen hiding the last
  player's hand. It's also the easiest way to build and test the board before Star exists.

### B8. The look: the design canvas

The look was designed with Pol on 2026-10-16 and lives on a claude.ai Design canvas (private to
Pol's account): **https://claude.ai/artifact/WMSS59EueoKaYmwd56Y1RF**. Build Ktan's screens to it.

- **Reading it:** with the Artifact tool, `action: "read"` on that link, then `path:
  "project/<file>"` for each artboard (`action: "list"`, `scope: "files"` lists them). Never
  web-fetch it. Each artboard is a `.dc.html` file whose script works out every shape, position
  and colour from a few numbers. Those scripts are the reference to port, not code to copy: the
  canvas draws each layer as a small SVG in the page, which suits a design tool, not a phone. In
  the game, draw the island on a canvas like Tanks' floor (once per layout and per view; a frame
  paints nothing new), with every tile, piece, lantern and plaque its own sprite so they can move
  and turn (B4), and keep the DOM for the parts from `styles.css`.
- **What's on it:** the look sheet (`Main`) and the parts every screen uses (`Board`, `Hex`,
  `Piece`, `Card`, `Die`, `Icon`, `Chip`, `Glow`); phones without a table (`PhonePortrait`: Anna
  rolls 8 on Pol's phone; `PhoneOffer`, `PhonePlacing`, `PhoneTrade`, `PhoneLandscape`); the table
  (`TableSeats`, `TableRoll`, `TableTrade`, `TablePlacing`, `TableTurnMorph`, `TableTurnMirror`);
  phones at a table (`SeatPick`, `HandPortrait`, `HandPlacing`, `HandLandscape`, and `CardInspect`
  and `CardInspectWool`, which work in Play). The game in them: Pol south, Jordi west, Marta north,
  Anna east, on the starter island in mid-game.
- **Identity:** a storybook island on a night sea. The sea is the app's own dark grey, with
  waterlines following the coast and nothing else. Ports are lantern-lit: a jetty, sometimes a
  boat, lanterns on the two corners the port serves, and a brass plaque on a post. Pieces are
  painted wood with their windows lit. Brass and ivory do the details, and game numerals and card
  names are set in the system serif (`ui-serif`, New York on Apple). Tanks shows the level of
  detail to aim for, not a style to copy.
- **One projection.** The board is a plane tilted toward its viewer, with no horizon:
  - widths stay level, depth runs straight up the screen foreshortened to 0.68, and heights stand
    straight up;
  - the ground, the sea, roads, jetties and tokens lie flat; trees, sheep, peaks, kilns,
    buildings, lanterns and plaques stand upright on their spot, back to front;
  - nothing recedes on a slant: a house shows its front and its roof planes rising straight back,
    a brick its front with its top straight above;
  - one light from the top left, with cool shadows cast down and to the right, and no ink outlines.
- **The island in numbers** (`Board`, `Hex`): R = size / 11. The drawing is 0.75 R of sky over
  size × 0.68 of tilted board. Tiles are thick slabs with rounded corners, each terrain drawn on
  its own (forest canopy; clay hills with a kiln and bricks; meadow, fence and sheep; crop rows, a
  track, stooks and a scarecrow; peaks with snow, a mine and crystals; dunes and a cactus). The
  middle stays clear for the token. The token lies flat: a dark disc 0.38 of the tile's width with
  a brass ring and an ivory serif number. The 6 and 8 are red (`#f0654a`) and the pips brass. A
  rolled token turns ivory and glows, and the other tiles dim. The coast has a beach, wet sand,
  broken surf and shallows, with waterlines out to 3.7 R, fainter and more broken the further out.
- **Colours:**
  - terrain (top, side): wood `#2c693c` `#1c4428`; brick `#b35a3b` `#74331e`; wool `#86b85a`
    `#527733`; grain `#ddab3c` `#94701f`; ore `#6f7a8b` `#454c59`; desert `#b49a69` `#786443`;
  - card (frame, art): wood `#24502f` `#68a873`; brick `#7a321f` `#e79a73`; wool `#4c7631`
    `#bfe093`; grain `#8f6212` `#f8de8c`; ore `#454e5c` `#bcc6d3`; the border ivory `#efe6d2`.
    Development cards are charcoal `#1b1a18` with a brass line;
  - players: `#efefef`, `#5b8cff`, `#ff6b5b`, `#b07cff`, `#3fc9d6`, `#ff8fd0`, with the marks
    diamond, circle, triangle, square, plus and star;
  - brass `#b8995a` (rims) and `#c9a961` (icons), ivory `#f3ecdc` (text), lantern `#ffd58a`.
- **Corners are strictly concentric** (CLAUDE.md's rule, checked on every nested shape). A card is
  1 : 1.4. Its frame's radius is 12% of its width; the ivory border is inset 5% with radius 7%;
  the art window is inset 8% with radius 4%; the count badge and the tag sit in the corners, inset
  4.5% with radius 7.5%. Chips, panels and dice follow the same rule.
- **A card up close** (`CardInspect`): a tap lifts the card from its stack to the front while the
  hand dims and blurs.
  - Dragging tilts it under the finger (about 20° by 16°), with a glare that follows; on release
    it springs back.
  - A hard horizontal swipe (over 60 px, faster than about 0.65 px a millisecond, mostly sideways)
    flings it a half turn in that direction, to its back. There is no button for that.
  - A sheet under it explains it. A resource: where you earn it (your hexes and numbers, ×2 for a
    city), what it builds, your bank rate, and Trade. A development card: what it does, two facts
    and Play.
- **Dice:** one ivory with charcoal pips and one charcoal with brass pips. Beside the island they
  are drawn in its projection: top face foreshortened, front face below.
- **The glow** (`Glow`): a 5 px line of light along the edge, 300 px long, with a glow 110 to
  150 px deep in the player's colour. It breathes on their turn. While seats are taken it carries
  a 64 px disc with their mark.
- **Motion:** everything that moves has a reduced-motion state that shows the end at once. The
  phone and the table run shared moments on the same clock.
- **Not drawn yet:** the Build sheet; the robber and discard screens; setup; the end of a game;
  the side menu and Rules; the room screens without a table (create, join, nearby); the giver's
  phone in a trade at a table; the Harvest, Embargo and Road building flows; the 5 to 6 player
  island. Draw them in the same language.
- **Rough spots:** port plaques and token numbers come out at about 9 to 10 px on a phone. The
  side-seat morph looks busy halfway through (Part D).

---

## Part C: Build order

0. **Done (2026-10-16):** a connection test (since removed). Direct links work on the same Wi-Fi. The
   hotspot phone can't send (A5).
1. **Engine:** the Ktan engine and its tests, with no UI.
2. **Board on one device:** the board and hand UI, playable pass-and-play on one phone (B7). This is
   where the placing, trading and robber screens get right. Build it to the look in B8: the
   canvas's `Board`, `Hex`, `Piece` and `Card` parts are the reference for the drawing.
3. **Star, relayed:** the Worker and its Durable Object, `star.js`, and the room screen (create, join
   by code, seats). Ktan playable across phones through Cloudflare.
   **Done so far (2026-10-16):** the Worker (deployed), `star.js`, their tests, and a test page in
   `src/games/ktan/` (create, join, who's in, round trips, waves, hand over). Next: test it on
   phones, then the engine; the room screen for the game comes with step 2's UI. A host with no seat works from
   here on, ready for the table. Star doesn't need the engine, so it can be built alongside steps 1
   and 2; its tests run on fake transports, and only the first deploy needs the account (A11).
4. **The table** (B4, B8): seats picked on the phones and shown as glows, the island morphing or
   folding to face each turn, cards leaving by the edges into the phones, placing on the table.
5. **Star, direct:** direct tries, going local, coming back, handing over and losing the host.
   **Done so far (2026-10-16):** direct tries and retries, local rooms, falling back to relayed,
   direct links outliving the internet, handing over and losing the host online (built with step 3).
   Two headless Chrome tabs linked directly in about a second: 1–2 ms there and back, against
   about 47 ms through the room. Left: a member's new link with no internet (A3), a lost host while
   offline (A6), versions (A7).
6. **Offline:** QR invites for Wi-Fi with no internet (A4): our own QR encoder and decoder.
7. **Polish:** generated islands, the 5–6 player island, and a rules page.

## Part D: Open questions for Pol

- **Players:** stop at 6, as the classic game does, or allow bigger islands for 7–8 (our own
  variant)?
- **Dice:** trust the host (friends), or have every phone add its own randomness, so even the host
  can't fix a roll?
- **Spectators:** phones with no seat that only watch, like the table device?
- **The side-seat morph** (B4, B8): halfway through, every tile is turning at once and it looks
  busy. Keep it, or let the tiles slide square and turn only once they land?
