// npm run host: build, serve dist/ on :8080, expose it with Tailscale Funnel,
// print the public URL, and on Ctrl-C stop the server and reset Funnel.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8080;

// interactive: let tailscale talk to the terminal (it may print an approval link and wait).
function tailscale(args, { quiet = false, interactive = false } = {}) {
  const r = spawnSync('tailscale', args, interactive ? { stdio: 'inherit' } : { encoding: 'utf8' });
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new Error('The `tailscale` CLI was not found on PATH.');
    throw r.error;
  }
  if (!interactive && !quiet && r.stderr.trim()) process.stderr.write(r.stderr);
  return r;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      process.stdout.write(chunk);
      if (String(chunk).includes('Serving dist/')) resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('exit', (code) => reject(new Error(`Server exited early (code ${code}).`)));
  });
}

const info = await build();

const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping server and taking Funnel offline…');
  server.kill('SIGTERM');
  try {
    tailscale(['funnel', 'reset']);
    console.log('Funnel reset. Gameplane is offline (installed apps keep working).');
  } catch (err) {
    console.error(`Could not reset Funnel: ${err.message}. Run \`tailscale funnel reset\` by hand.`);
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

try {
  await waitForServer(server);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
server.on('exit', (code) => {
  if (!stopping) {
    console.error(`Server stopped unexpectedly (code ${code}).`);
    stop(1);
  }
});

try {
  const up = tailscale(['funnel', '--bg', String(PORT)], { interactive: true });
  if (up.status !== 0) {
    console.error('`tailscale funnel --bg 8080` failed. If it printed an approval link, open it, then rerun.');
    stop(1);
  }
  const status = tailscale(['funnel', 'status'], { quiet: true });
  const url = (status.stdout.match(/https:\/\/[^\s)]+/) || [])[0];
  console.log('');
  console.log('──────────────────────────────────────────────');
  console.log(`  Gameplane ${info.version} is live at:`);
  console.log(`  ${url ? url.replace(/\/$/, '') + '/' : '(see below)'}`);
  console.log('──────────────────────────────────────────────');
  if (!url) console.log(status.stdout);
  console.log('Friends: open it in Safari → Share → Add to Home Screen →');
  console.log('open from the icon → wait for "Ready offline".');
  console.log('Ctrl-C stops the server and resets Funnel.\n');
} catch (err) {
  console.error(err.message);
  stop(1);
}
