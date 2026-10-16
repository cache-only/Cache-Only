// TEMPORARY test, not a game. Links the devices that have this page open straight to each other
// with WebRTC, to learn whether phones can play together over a network with no internet, such
// as one phone's hotspot. A relay on the Mac (scripts/nearby-relay.mjs) only passes each pair's
// connection details (one offer, one answer, as a QR code each way would) and prints what every
// device reports; once two are linked, their traffic goes straight between them and the link
// outlives the relay. No STUN or TURN server: local addresses only. Delete this folder, its
// registry entry and the relay when the experiment is over.
import { getLang, localize } from '../../shared/i18n.js';
import { registerSW } from '../../shared/sw-client.js';
import { setupSideMenu } from '../../shared/ui.js';

// Kept here rather than in i18n.js, so the test goes away with its folder.
const STRINGS = {
  en: {
    linked: 'Linked',
    thisDevice: 'This device',
    device: 'Device',
    relay: 'Relay',
    relayOk: 'Connected',
    relayDown: 'Out of reach',
    seenAt: 'Relay sees it at',
    offers: 'Addresses it offers',
    camera: 'Show real addresses',
    cameraNote: 'Reloads the page with the camera on from the start (nothing is recorded), so the browser offers its real addresses, the network the page came from too.',
    cameraDenied: 'The camera was not allowed.',
    lead: 'Make the offer',
    leadNote: 'For testing: this device starts every link (when only one side has this on).',
    devices: 'Other devices',
    empty: 'None yet. Open this page on another device on the same network.',
    reconnect: 'Reconnect',
    wave: 'Wave',
    waved: '{name} waved',
    nowLinked: 'Linked to {name}',
    log: 'Log',
    route: 'Route',
    roundTrip: 'Round trip',
    waves: 'Waves',
    noRtc: 'WebRTC is not available here',
    asking: 'Asking',
    connecting: 'Connecting',
    open: 'Linked',
    failed: 'Failed',
    waiting: 'Waiting',
  },
  ca: {
    linked: 'Connectats',
    thisDevice: 'Aquest dispositiu',
    device: 'Dispositiu',
    relay: 'Relé',
    relayOk: 'Connectat',
    relayDown: "Fora d'abast",
    seenAt: 'El relé el veu a',
    offers: 'Adreces que ofereix',
    camera: 'Mostra les adreces reals',
    cameraNote: "Torna a carregar la pàgina amb la càmera encesa des del principi (no es grava res), perquè el navegador ofereixi les adreces reals, també la de la xarxa d'on ve la pàgina.",
    cameraDenied: "No s'ha permès la càmera.",
    lead: "Fes l'oferta",
    leadNote: 'Per provar: aquest dispositiu comença cada connexió (si només un costat ho té activat).',
    devices: 'Altres dispositius',
    empty: 'Encara cap. Obre aquesta pàgina en un altre dispositiu de la mateixa xarxa.',
    reconnect: 'Torna a connectar',
    wave: 'Saluda',
    waved: '{name} et saluda',
    nowLinked: 'Connectat amb {name}',
    log: 'Registre',
    route: 'Camí',
    roundTrip: 'Anada i tornada',
    waves: 'Salutacions',
    noRtc: 'Aquí no hi ha WebRTC',
    asking: 'Demanant',
    connecting: 'Connectant',
    open: 'Connectat',
    failed: 'Ha fallat',
    waiting: 'Esperant',
  },
};

const s = (key, params = {}) =>
  (STRINGS[getLang()]?.[key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');

const RELAY = `${location.protocol}//${location.hostname}:${location.protocol === 'https:' ? 8444 : 8082}`;
const POLL_MS = 700;
const PING_MS = 1000;
const LINK_TIMEOUT_MS = 15000;
const RETRY_MS = 3000;
const GATHER_MS = 4000;

const $ = (id) => document.getElementById(id);

function deviceName() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : 'Device';
  const where = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches ? 'app'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'browser';
  return `${kind} ${where}`;
}

const ID = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
const NAME = `${deviceName()} · ${ID.slice(0, 4)}`;

localize();
for (const el of document.querySelectorAll('[data-n]')) el.textContent = s(el.dataset.n);
registerSW();

/* ---------- Log: on the page, in the console, and through the relay to the Mac's terminal ---------- */

const logLines = [];
let outbox = [];

function log(line) {
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  logLines.unshift(`${stamp}  ${line}`);
  logLines.length = Math.min(logLines.length, 60);
  outbox.push(line);
  if (outbox.length > 300) outbox.splice(0, outbox.length - 300);
  console.log('[nearby]', line);
  renderSoon();
}

/* ---------- Relay ---------- */

let relayOk = null;
let seenAt = '';
const relayPeers = new Map(); // id -> { id, name, ip, lead }, as the relay last listed them
let lead = false;

/** Whether this device makes the offer to that one: the one leading, or else the smaller id. */
function offers(id) {
  const theirs = !!relayPeers.get(id)?.lead;
  return lead !== theirs ? lead : ID < id;
}

async function relay(route, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    // A string body goes as text/plain, so the request needs no CORS preflight.
    const res = await fetch(RELAY + route, { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const signal = (to, msg) => relay('/send', { id: ID, to, msg }).catch((err) => log(`could not send ${msg.type}: ${err.message}`));

async function poll() {
  const sending = outbox;
  outbox = [];
  try {
    const r = await relay('/poll', { id: ID, name: NAME, lead, log: sending });
    if (relayOk !== true) log(`relay reached at ${RELAY}, it sees this device at ${r.you}`);
    relayOk = true;
    seenAt = r.you;
    relayPeers.clear();
    for (const p of r.peers) relayPeers.set(p.id, p);
    for (const { from, msg } of r.inbox) onSignal(from, msg);
    for (const p of r.peers) {
      if (!links.has(p.id) && offers(p.id)) offer(p.id);
    }
  } catch (err) {
    outbox = sending.concat(outbox);
    if (relayOk !== false) log(`relay out of reach at ${RELAY} (${err.name === 'AbortError' ? 'timed out' : err.message})`);
    relayOk = false;
  }
  render();
  setTimeout(poll, POLL_MS);
}

/* ---------- Addresses ---------- */

const short = (addr) => {
  if (!addr) return 'hidden';
  if (/\.local$/i.test(addr)) return `${addr.slice(0, 8)}….local`;
  return addr.includes(':') ? `[${addr}]` : addr;
};

/** The addresses an SDP offers: "udp 172.20.10.1:56000 host". */
function candidates(sdp = '') {
  const out = [];
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const p = line.slice('a=candidate:'.length).split(' ');
    if (p[1] !== '1') continue;
    const item = `${p[2].toLowerCase()} ${short(p[4])}:${p[5]} ${p[7]}`;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

const describe = (c) => (c ? `${short(c.address ?? c.ip)}:${c.port} ${c.candidateType}${c.protocol === 'tcp' ? ' tcp' : ''}` : '?');

function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && finish();
    const timer = setTimeout(finish, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

let selfOffers = [];

/** What this browser offers to anyone, from an offer that goes nowhere. */
async function probe() {
  if (!window.RTCPeerConnection) {
    selfOffers = [s('noRtc')];
    log('no RTCPeerConnection in this browser');
    return render();
  }
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    pc.createDataChannel('probe');
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    selfOffers = candidates(pc.localDescription.sdp);
    log(`this device offers ${selfOffers.length} addresses${camera ? ' (camera on)' : ''}: ${selfOffers.join(', ') || 'none'}`);
  } catch (err) {
    log(`probe failed: ${err.message}`);
  } finally {
    pc.close();
  }
  render();
}

/* ---------- Links ---------- */

const links = new Map(); // peer id -> link
const gens = new Map(); // peer id -> the last offer's number, so a stale answer is ignored

const nameOf = (id) => links.get(id)?.name ?? relayPeers.get(id)?.name ?? id;

function newLink(id, initiator, gen) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const link = {
    id, initiator, gen, pc,
    name: nameOf(id),
    dc: null,
    state: initiator ? 'asking' : 'connecting',
    local: [], remote: [],
    route: '', rtt: null, rttMin: Infinity, rttMax: 0, pings: 0,
    waves: 0, timers: [], pinger: 0,
  };
  links.set(id, link);
  pc.onconnectionstatechange = () => {
    log(`${link.name}: connection ${pc.connectionState}`);
    if (pc.connectionState === 'failed') fail(link, 'connection failed');
    render();
  };
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    log(`${link.name}: ICE ${state}`);
    if (state === 'disconnected' || state === 'failed') {
      snapshot(link)
        .then((snap) => log(`${link.name}: pairs at ${state}: ${snap.all.join(' || ') || 'none'}`))
        .catch(() => {});
    }
  };
  link.timers.push(setTimeout(() => link.state !== 'open' && fail(link, `not linked after ${LINK_TIMEOUT_MS / 1000} s`), LINK_TIMEOUT_MS));
  return link;
}

function shut(link) {
  for (const timer of link.timers) clearTimeout(timer);
  link.timers = [];
  clearInterval(link.pinger);
  link.pc.onconnectionstatechange = link.pc.oniceconnectionstatechange = null;
  if (link.dc) link.dc.onclose = link.dc.onmessage = link.dc.onopen = null;
  try {
    link.dc?.close();
    link.pc.close();
  } catch {}
}

function fail(link, why) {
  if (links.get(link.id) !== link || link.state === 'failed') return;
  log(`${link.name}: ${why}`);
  shut(link);
  link.state = 'failed';
  render();
  link.timers.push(setTimeout(() => {
    if (links.get(link.id) !== link || !relayPeers.has(link.id)) return;
    if (link.initiator) offer(link.id);
    else signal(link.id, { type: 'restart' });
  }, RETRY_MS));
}

async function offer(id) {
  const prev = links.get(id);
  if (prev) shut(prev);
  const gen = (gens.get(id) || 0) + 1;
  gens.set(id, gen);
  const link = newLink(id, true, gen);
  try {
    link.dc = link.pc.createDataChannel('game');
    wire(link);
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await gathered(link.pc);
    if (links.get(id) !== link) return;
    link.local = candidates(link.pc.localDescription.sdp);
    log(`${link.name}: offer sent with ${link.local.length} addresses: ${link.local.join(', ') || 'none'}`);
    await signal(id, { type: 'offer', gen, name: NAME, sdp: link.pc.localDescription.sdp });
  } catch (err) {
    fail(link, `offer failed: ${err.message}`);
  }
  render();
}

async function answer(from, msg) {
  const prev = links.get(from);
  if (prev) shut(prev);
  const link = newLink(from, false, msg.gen);
  if (msg.name) link.name = String(msg.name).slice(0, 60);
  link.remote = candidates(msg.sdp);
  log(`${link.name}: offer received with ${link.remote.length} addresses: ${link.remote.join(', ') || 'none'}`);
  link.pc.ondatachannel = (event) => {
    link.dc = event.channel;
    wire(link);
  };
  try {
    await link.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await gathered(link.pc);
    if (links.get(from) !== link) return;
    link.local = candidates(link.pc.localDescription.sdp);
    log(`${link.name}: answer sent with ${link.local.length} addresses: ${link.local.join(', ') || 'none'}`);
    await signal(from, { type: 'answer', gen: msg.gen, sdp: link.pc.localDescription.sdp });
  } catch (err) {
    fail(link, `answer failed: ${err.message}`);
  }
  render();
}

async function onSignal(from, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (msg.type === 'offer' && typeof msg.sdp === 'string') return answer(from, msg);
  if (msg.type === 'answer' && typeof msg.sdp === 'string') {
    const link = links.get(from);
    if (!link || !link.initiator || link.gen !== msg.gen || link.state !== 'asking') return;
    link.state = 'connecting';
    link.remote = candidates(msg.sdp);
    log(`${link.name}: answer received with ${link.remote.length} addresses: ${link.remote.join(', ') || 'none'}`);
    try {
      await link.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } catch (err) {
      fail(link, `answer rejected: ${err.message}`);
    }
    return render();
  }
  if (msg.type === 'restart' && offers(from)) {
    log(`${nameOf(from)} asked to start over`);
    offer(from);
  }
}

function wire(link) {
  const dc = link.dc;
  dc.onopen = () => {
    if (links.get(link.id) !== link) return;
    link.state = 'open';
    for (const timer of link.timers) clearTimeout(timer);
    link.timers = [];
    log(`${link.name}: linked`);
    announce(s('nowLinked', { name: link.name }));
    link.pinger = setInterval(() => ping(link), PING_MS);
    readRoute(link);
    trace(link);
    render();
  };
  dc.onclose = () => {
    if (links.get(link.id) === link && link.state === 'open') fail(link, 'channel closed');
  };
  dc.onmessage = (event) => {
    let m;
    try {
      m = JSON.parse(event.data);
    } catch {
      return;
    }
    if (m.t === 'ping') send(link, { t: 'pong', at: m.at });
    else if (m.t === 'pong') {
      const ms = performance.now() - m.at;
      link.rtt = ms;
      link.rttMin = Math.min(link.rttMin, ms);
      link.rttMax = Math.max(link.rttMax, ms);
    } else if (m.t === 'wave') {
      link.waves++;
      log(`${link.name} waved`);
      announce(s('waved', { name: link.name }));
      flash(link.id);
    }
    renderSoon();
  };
}

function send(link, m) {
  if (link.dc?.readyState === 'open') link.dc.send(JSON.stringify(m));
}

function ping(link) {
  send(link, { t: 'ping', at: performance.now() });
  link.pings++;
  if (link.pings % 5 === 0) readRoute(link);
  if (link.pings % 10 === 0 && link.rtt != null) {
    log(`${link.name}: round trip ${Math.round(link.rtt)} ms (${Math.round(link.rttMin)}–${Math.round(link.rttMax)}) over ${link.route || '?'}`);
  }
}

/** The pair of addresses the link really uses. */
async function readRoute(link) {
  try {
    const stats = await link.pc.getStats();
    let pair = null;
    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
    });
    if (!pair) {
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair ??= r;
      });
    }
    if (!pair) return;
    const route = `${describe(stats.get(pair.localCandidateId))} ↔ ${describe(stats.get(pair.remoteCandidateId))}`;
    if (route !== link.route) log(`${link.name}: route ${route}`);
    link.route = route;
    renderSoon();
  } catch {}
}

/** What a link's address pairs have sent and received so far. */
async function snapshot(link) {
  const stats = await link.pc.getStats();
  const pairs = [];
  let chosen = null;
  stats.forEach((r) => {
    if (r.type === 'candidate-pair') pairs.push(r);
    if (r.type === 'transport' && r.selectedCandidatePairId) chosen = r.selectedCandidatePairId;
  });
  const end = (id) => {
    const c = stats.get(id);
    return c ? `${c.candidateType}${c.networkType ? `/${c.networkType}` : ''} ${short(c.address ?? c.ip)}:${c.port}` : '?';
  };
  const ago = (r, at) => (at ? `${Math.round(r.timestamp - at)}ms ago` : '?');
  const text = (p) =>
    `${p.state}${p.nominated ? ' nominated' : ''} ${end(p.localCandidateId)} ↔ ${end(p.remoteCandidateId)}` +
    `, checks sent ${p.requestsSent ?? '?'} answered ${p.responsesReceived ?? '?'}, checks got ${p.requestsReceived ?? '?'} answered ${p.responsesSent ?? '?'}` +
    `, sent ${p.packetsSent ?? '?'}p ${p.bytesSent ?? '?'}B (last ${ago(p, p.lastPacketSentTimestamp)})` +
    `, got ${p.packetsReceived ?? '?'}p ${p.bytesReceived ?? '?'}B (last ${ago(p, p.lastPacketReceivedTimestamp)})`;
  const selected = (chosen && stats.get(chosen)) || pairs.find((p) => p.nominated && p.state === 'succeeded');
  return { selected: selected && text(selected), all: pairs.map(text) };
}

/** For 30 s after a link opens, what its chosen pair has sent and received, each second. */
function trace(link) {
  const started = performance.now();
  const tick = async () => {
    if (links.get(link.id) !== link) return;
    const t = Math.round((performance.now() - started) / 1000);
    try {
      const snap = await snapshot(link);
      log(`${link.name}: +${t}s ICE ${link.pc.iceConnectionState}, ${snap.selected ?? 'no chosen pair'}`);
    } catch {}
    if (t < 30 && links.get(link.id) === link) link.timers.push(setTimeout(tick, 1000));
  };
  tick();
}

function restartAll() {
  for (const id of new Set([...links.keys(), ...relayPeers.keys()])) {
    if (offers(id)) offer(id);
    else signal(id, { type: 'restart' });
  }
}

/* ---------- Camera: browsers show a page its real addresses only while it captures ---------- */

// WebKit settles once per page which interfaces WebRTC may use. Only if the camera is already on
// then does it add the interface that reaches the page's own host (LibWebRTCNetworkManager), the
// hotspot's when the page came from a device on it. So the switch reloads the page, and the camera
// starts before the first RTCPeerConnection.
const CAMERA_FIRST = new URLSearchParams(location.search).has('camera');
let camera = null;

$('cameraToggle').checked = CAMERA_FIRST;
$('cameraToggle').addEventListener('change', (event) => {
  location.search = event.target.checked ? '?camera' : '';
});

$('leadToggle').addEventListener('change', (event) => {
  lead = event.target.checked;
  log(lead ? 'this device now makes the offer' : 'this device no longer makes the offer');
  // Start over once the relay has told the other device.
  setTimeout(restartAll, POLL_MS * 2);
});

/* ---------- Page ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fillFacts(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([label, value, num]) => [el('dt', '', label), el('dd', num ? 'is-num' : '', value)]));
}

function fillLines(ul, lines) {
  ul.replaceChildren(...lines.map((line) => el('li', '', line)));
}

const rows = new Map(); // peer id -> its section on the page

function peerRow(id) {
  let row = rows.get(id);
  if (row) return row;
  row = el('section', 'nearby-peer');
  const head = el('div', 'nearby-peer-head');
  head.append(el('h3', 't-heading'), el('span', 'eyebrow'));
  row.append(head, el('dl', 'facts'), el('h4', 'eyebrow', s('offers')), el('ul', 'card nearby-lines'));
  rows.set(id, row);
  $('peerList').append(row);
  return row;
}

function flash(id) {
  const row = rows.get(id);
  if (!row) return;
  row.classList.remove('is-waved');
  void row.offsetWidth;
  row.classList.add('is-waved');
}

let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const linked = [...links.values()].filter((l) => l.state === 'open');
  $('linkedStat').textContent = String(linked.length);
  $('waveBtn').disabled = !linked.length;

  fillFacts($('selfFacts'), [
    [s('device'), NAME],
    [s('relay'), relayOk ? s('relayOk') : relayOk === false ? s('relayDown') : '…'],
    [s('seenAt'), seenAt || '—', true],
  ]);
  fillLines($('selfOffers'), selfOffers);

  // A device stays listed while the relay lists it or its link is up, so a link that outlives
  // the relay stays on screen.
  for (const [id, link] of links) {
    if (!relayPeers.has(id) && link.state !== 'open' && relayOk) {
      shut(link);
      links.delete(id);
    }
  }
  const ids = new Set([...relayPeers.keys(), ...links.keys()]);
  for (const [id, row] of rows) {
    if (!ids.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  for (const id of ids) {
    const link = links.get(id);
    const row = peerRow(id);
    row.querySelector('.t-heading').textContent = nameOf(id);
    row.querySelector('.nearby-peer-head .eyebrow').textContent = s(link?.state ?? 'waiting');
    fillFacts(row.querySelector('.facts'), [
      [s('route'), link?.route || '—', true],
      [s('roundTrip'), link?.rtt != null ? `${Math.round(link.rtt)} ms (${Math.round(link.rttMin)}–${Math.round(link.rttMax)})` : '—', true],
      [s('seenAt'), relayPeers.get(id)?.ip || '—', true],
      [s('waves'), String(link?.waves ?? 0), true],
    ]);
    fillLines(row.querySelector('.nearby-lines'), link?.remote ?? []);
  }
  $('emptyNote').hidden = ids.size > 0;
  fillLines($('logList'), logLines);
}

function announce(text) {
  $('announce').textContent = text;
}

const menu = setupSideMenu($('sideMenu'), $('homeBtn'));
$('resumeBtn').addEventListener('click', () => menu.close());

$('waveBtn').addEventListener('click', () => {
  const open = [...links.values()].filter((l) => l.state === 'open');
  for (const link of open) send(link, { t: 'wave' });
  log(`waved to ${open.map((l) => l.name).join(', ')}`);
});

$('reconnectBtn').addEventListener('click', async () => {
  log('reconnecting');
  await probe();
  restartAll();
});

addEventListener('pagehide', () => {
  navigator.sendBeacon?.(RELAY + '/leave', JSON.stringify({ id: ID }));
  for (const link of links.values()) shut(link);
});
// Back from the games with the page kept: its links were closed on the way out.
addEventListener('pageshow', (event) => event.persisted && location.reload());

log(`${NAME} opened ${location.origin}, relay ${RELAY}`);
if (CAMERA_FIRST) {
  try {
    camera = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    log('camera on before the first connection');
  } catch (err) {
    $('cameraToggle').checked = false;
    log(`camera refused: ${err.name}`);
    announce(s('cameraDenied'));
  }
}
render();
probe();
poll();
