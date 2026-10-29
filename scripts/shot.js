'use strict';

/**
 * 无头 Chrome 截图工具（零依赖，走 CDP）
 * 用法: node scripts/shot.js <out.png> [--js "表达式"] [--full] [--w 390] [--h 844]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

const args = process.argv.slice(2);
const out = args[0] || 'shot.png';
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const js = getArg('--js', '');
const full = args.includes('--full');
const wait = Number(getArg('--wait', 3500));
const logConsole = args.includes('--log');
const width = Number(getArg('--w', 390));
const height = Number(getArg('--h', 844));
const url = getArg('--url', 'http://localhost:4173/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--force-device-scale-factor=2', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* retry */ }
  }
  if (!target) throw new Error('无法连接 Chrome');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (logConsole && msg.method === 'Runtime.consoleAPICalled') {
      console.log('[console]', msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (logConsole && msg.method === 'Runtime.exceptionThrown') {
      console.log('[error]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description || '');
    } else if (logConsole && msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (/news\.json|api\/news/.test(r.url)) console.log('[net]', r.status, r.url.slice(-60));
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await new Promise((r) => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: true
  });
  await send('Page.navigate', { url });
  await sleep(wait);

  if (js) {
    await send('Runtime.evaluate', { expression: js, awaitPromise: true });
    await sleep(900);
  }

  let clip;
  if (full) {
    const m = await send('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    clip = { x: 0, y: 0, width, height: Math.min(cs.height, 4200), scale: 1 };
  }

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !!full,
    ...(clip ? { clip } : {})
  });

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);

  ws.close();
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
