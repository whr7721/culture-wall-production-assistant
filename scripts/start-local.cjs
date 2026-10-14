const { spawn } = require('node:child_process');
const { mkdirSync, openSync, closeSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const site = 'http://127.0.0.1:5173/';
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}
async function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}
async function start(name, args, port, url) {
  if (await ready(url)) return;
  if (await occupied(port)) throw new Error(`Port ${port} is occupied. No existing process was stopped.`);
  const logs = path.join(root, 'output', 'local-launcher');
  mkdirSync(logs, { recursive: true });
  const stamp = Date.now();
  const out = openSync(path.join(logs, `${name}-${stamp}.stdout.log`), 'a');
  const errPath = path.join(logs, `${name}-${stamp}.stderr.log`);
  const err = openSync(errPath, 'a');
  const child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
  let failure;
  child.on('error', error => { failure = error; });
  child.unref();
  closeSync(out); closeSync(err);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await ready(url)) return;
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error(`${name} failed. See ${errPath}`);
    await pause(500);
  }
  throw new Error(`${name} startup timed out. See ${errPath}`);
}
(async () => {
  console.log('Starting Culture Wall Studio...');
  await start('server', ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], 8787, 'http://127.0.0.1:8787/api/health');
  await start('web', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 5173, site);
  if (!await ready(`${site}api/health`)) throw new Error('Backend connection is not ready.');
  console.log(`Ready: ${site}`);
  if (!process.argv.includes('--no-browser')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', site], { detached: true, windowsHide: true, stdio: 'ignore' });
    browser.on('error', error => console.error(`Open ${site} manually: ${error.message}`));
    browser.unref();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
