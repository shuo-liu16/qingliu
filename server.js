'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const { fetchFeed, enrichSummaries } = require('./lib/feed');
const { shape } = require('./lib/payload');
const { SOURCES } = require('./lib/sources');

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');

const FEED_TTL = 15 * 60 * 1000; // 15 分钟
const MAX_ITEMS_PER_FEED = 40;

/* ────────────────────────── 快照 ────────────────────────── */

let snapshot = { savedAt: null, feeds: {} };
try {
  if (fs.existsSync(SNAPSHOT_FILE)) snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
} catch (e) {
  console.warn('[snapshot] 读取失败', e.message);
}

function saveSnapshot() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const feeds = {};
    for (const [url, entry] of feedCache) {
      if (entry.items && entry.items.length) feeds[url] = entry.items;
    }
    const key = Object.keys(feeds).length;
    if (!key) return;
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ savedAt: new Date().toISOString(), feeds }));
  } catch (e) {
    console.warn('[snapshot] 写入失败', e.message);
  }
}

/* ────────────────────────── Feed 缓存 ────────────────────────── */

const feedCache = new Map(); // url -> { ts, items, ok, error, name }

async function loadFeed(source, { force = false } = {}) {
  const cached = feedCache.get(source.url);
  if (!force && cached && Date.now() - cached.ts < FEED_TTL) return cached;

  try {
    const items = await fetchFeed(source);
    const entry = { ts: Date.now(), items: items.slice(0, MAX_ITEMS_PER_FEED), ok: true, error: null, name: source.name };
    feedCache.set(source.url, entry);
    return entry;
  } catch (err) {
    const fallback = (snapshot.feeds && snapshot.feeds[source.url]) || (cached && cached.items) || [];
    const entry = {
      ts: Date.now(),
      items: fallback,
      ok: fallback.length > 0,
      error: err.message,
      name: source.name,
      stale: fallback.length > 0
    };
    feedCache.set(source.url, entry);
    return entry;
  }
}

function normalizeSource(input) {
  const url = String(input.url || '').trim();
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  return {
    id: input.id || ('u' + Math.abs(hashStr(url)).toString(36)),
    name: input.name || u.hostname.replace(/^www\./, ''),
    url,
    weight: Number(input.weight) || 7,
    cat: input.cat || null,
    lang: input.lang || (/\.cn$|zh|36kr|sspai/i.test(url) ? 'zh' : 'en')
  };
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

async function collect(sources, { force = false } = {}) {
  const results = await Promise.all(sources.map((s) => loadFeed(s, { force })));
  const all = [];
  const status = [];
  results.forEach((r, i) => {
    all.push(...r.items);
    status.push({ id: sources[i].id, name: sources[i].name, url: sources[i].url, ok: r.ok, count: r.items.length, error: r.error, stale: !!r.stale });
  });
  return { all, status };
}

/* ────────────────────────── 路由 ────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const acceptsGzip = /gzip/i.test(String(res.req && res.req.headers['accept-encoding'] || ''));
  const out = acceptsGzip && body.length > 2048 ? zlib.gzipSync(body) : body;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': out.length
  };
  if (out !== body) headers['Content-Encoding'] = 'gzip';
  res.writeHead(code, headers);
  res.end(out);
}

/** 精简字段，减少移动端流量（实现在 lib/payload.js，这里仅保留引用） */

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e5) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

async function handleNews(req, res, url) {
  const params = url.searchParams;
  const force = params.get('force') === '1';

  const enabledIds = (params.get('sources') || '').split(',').filter(Boolean);
  let sources = SOURCES.filter((s) => !enabledIds.length || enabledIds.includes(s.id));

  // 用户自定义源（通过 extra 传入 JSON，形如 [{url,name}]）
  let extra = [];
  if (params.get('extra')) {
    try {
      const parsed = JSON.parse(params.get('extra'));
      if (Array.isArray(parsed)) extra = parsed.map(normalizeSource).filter(Boolean).slice(0, 20);
    } catch { /* ignore */ }
  }

  const allSources = [...sources, ...extra];
  if (!allSources.length) return sendJSON(res, 400, { error: '没有启用任何信息源' });

  const { all, status } = await collect(allSources, { force });

  // 只有标题没有摘要的，回抓正文 meta 补一段（有上限，失败就算了）
  await enrichSummaries(all);

  return sendJSON(res, 200, shape(all, status, allSources.length));
}

async function handleProbe(req, res) {
  const body = await readBody(req);
  const src = normalizeSource(body || {});
  if (!src) return sendJSON(res, 400, { ok: false, error: '请输入有效的 http(s) 地址' });
  try {
    const items = await fetchFeed(src);
    feedCache.set(src.url, { ts: Date.now(), items: items.slice(0, MAX_ITEMS_PER_FEED), ok: true, error: null, name: src.name });
    const first = items[0] || {};
    sendJSON(res, 200, {
      ok: true,
      name: src.name,
      count: items.length,
      sample: { title: first.title || '', publishedAt: first.publishedAt || null }
    });
  } catch (e) {
    sendJSON(res, 200, { ok: false, error: e.message });
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // 页面与脚本每次校验，图片走长缓存，避免更新后看到旧版
    headers['Cache-Control'] = ['.png', '.svg', '.ico', '.woff2'].includes(ext)
      ? 'public, max-age=86400'
      : 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/news' && req.method === 'GET') return await handleNews(req, res, url);
    if (url.pathname === '/api/probe' && req.method === 'POST') return await handleProbe(req, res);
    if (url.pathname === '/api/health') {
      return sendJSON(res, 200, { ok: true, uptime: process.uptime(), snapshot: snapshot.savedAt });
    }
    if (url.pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'not found' });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`清流 running → http://localhost:${PORT}`);
  // 预热默认源，并定时保存快照
  collect(SOURCES).then(({ status }) => {
    const ok = status.filter((s) => s.ok).length;
    console.log(`[warmup] ${ok}/${status.length} 源可用`);
    setTimeout(saveSnapshot, 1500);
  });
  setInterval(() => {
    collect(SOURCES, { force: true }).then(saveSnapshot);
  }, 20 * 60 * 1000);
});
