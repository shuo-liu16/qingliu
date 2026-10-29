'use strict';

const http = require('http');
const https = require('https');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ────────────────────────── 网络 ────────────────────────── */

function fetchRaw(url, { timeout = 9000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const go = (target, left) => {
      let u;
      try { u = new URL(target); } catch (e) { return done(reject, new Error('bad url')); }
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && left > 0) {
          res.resume();
          const next = new URL(res.headers.location, u).toString();
          return go(next, left - 1);
        }
        if (res.statusCode >= 400) { res.resume(); return done(reject, new Error('HTTP ' + res.statusCode)); }

        const chunks = [];
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

        stream.on('data', (c) => {
          chunks.push(c);
          if (chunks.reduce((s, b) => s + b.length, 0) > 6e6) { req.destroy(); done(reject, new Error('too large')); }
        });
        stream.on('end', () => done(resolve, { buffer: Buffer.concat(chunks), headers: res.headers }));
        stream.on('error', (e) => done(reject, e));
      });

      req.setTimeout(timeout, () => { req.destroy(); done(reject, new Error('timeout')); });
      req.on('error', (e) => done(reject, e));
      req.end();
    };

    go(url, redirects);
  });
}

function decodeBody(buffer, headers = {}, sample = '') {
  const ct = String(headers['content-type'] || '');
  let charset = (ct.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = buffer.slice(0, 400).toString('latin1');
    charset = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (charset === 'utf8') charset = 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

/* ────────────────────────── XML 工具 ────────────────────────── */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  laquo: '«', raquo: '»', prime: '′', Prime: '″',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ',
  para: '¶', sect: '§', dagger: '†', Dagger: '‡',
  euro: '€', pound: '£', yen: '¥', cent: '¢', dollar: '$',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  infin: '∞', ne: '≠', le: '≤', ge: '≥', asymp: '≈', equiv: '≡',
  sum: '∑', prod: '∏', radic: '√', int: '∫', part: '∂', forall: '∀', exist: '∃',
  empty: '∅', nabla: '∇', isin: '∈', notin: '∉', cap: '∩', cup: '∪', and: '∧', or: '∨', not: '¬', there4: '∴', sim: '∼',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Omega: 'Ω', Delta: 'Δ',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', shy: ''
};

function decodeEntities(str = '') {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]{1,10});/gi, (m, n) => (ENTITIES[n] !== undefined ? ENTITIES[n] : m));
}

function safeChar(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}

function unwrapCdata(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(html = '') {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    // 块级标签换成空格，行内标签直接删掉，否则 today&rsquo;s 会变成 today ’ s
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|section|article|figure|figcaption|hr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
}

function cleanText(raw = '') {
  let s = unwrapCdata(raw);
  s = decodeEntities(s);
  s = stripTags(s);
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

function pick(block, names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i');
    const m = block.match(re);
    if (m && m[1] && m[1].trim()) return m[1];
  }
  return '';
}

function pickAttrLink(block) {
  // Atom: <link rel="alternate" href="..."/> 或 <link href="..."/>
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (any) return any[1];
  return '';
}

function normalizeDate(raw = '') {
  const s = cleanText(raw);
  if (!s) return null;
  // 2026-10-29 16:13:39  +0800  → 2026-10-29T16:13:39+08:00
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}):?(\d{2})?$/);
  if (m) {
    const [, y, mo, d, h, mi, sec = '00', tzH, tzM = '00'] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec}${tzH}:${tzM}`;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

/* ────────────────────────── Feed 解析 ────────────────────────── */

function parseFeed(xml, source) {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000)) && !/<rss[\s>]/i.test(xml.slice(0, 2000));
  const blocks = isAtom
    ? (xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [])
    : (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []);

  const items = [];
  for (const b of blocks) {
    const title = cleanText(pick(b, ['title']));
    if (!title) continue;

    let link = isAtom ? pickAttrLink(b) : cleanText(pick(b, ['link']));
    if (!link) link = pickAttrLink(b);
    if (!link) continue;

    const descRaw = pick(b, ['content:encoded', 'description', 'summary', 'content']);
    const desc = cleanText(descRaw);
    const dateRaw = pick(b, ['pubDate', 'published', 'updated', 'dc:date', 'date']);
    const author = cleanText(pick(b, ['dc:creator', 'author', 'name'])).slice(0, 40);

    items.push({
      id: hashId(link),
      title: title.slice(0, 200),
      link,
      desc: desc.slice(0, 1200),
      author,
      publishedAt: normalizeDate(dateRaw) || null,
      sourceId: source.id,
      sourceName: source.name,
      sourceWeight: source.weight,
      sourceCat: source.cat,
      lang: source.lang || 'zh'
    });
  }
  return items;
}

function hashId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function fetchFeed(source) {
  const { buffer, headers } = await fetchRaw(source.url);
  const xml = decodeBody(buffer, headers);
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 3000))) throw new Error('不是有效的 RSS/Atom');
  const items = parseFeed(xml, source);
  if (!items.length) throw new Error('解析到 0 条');
  return items;
}

/* ────────────────────────── 正文摘要兜底 ────────────────────────── */

/** 有些源只给标题，这里回抓文章页的 meta description 补一段摘要 */
async function fetchMetaDescription(url) {
  const { buffer, headers } = await fetchRaw(url, { timeout: 7000 });
  const html = decodeBody(buffer, headers).slice(0, 400000);

  const patterns = [
    /<meta[^>]+(?:name|property)=["'](?:og:description|description|twitter:description)["'][^>]*content=["']([^"']{20,})["']/i,
    /<meta[^>]+content=["']([^"']{20,})["'][^>]*(?:name|property)=["'](?:og:description|description)["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const text = cleanText(m[1]);
      if (text.length >= 24) return text;
    }
  }
  return '';
}

const metaCache = new Map();
const NO_META_HOSTS = /(36kr\.com|sspai\.com|ifanr\.com)/i;

async function enrichSummaries(items, limit = 14) {
  const weak = items
    .filter((it) => (!it.desc || it.desc.length < 40) && !NO_META_HOSTS.test(it.link))
    .slice(0, limit);
  if (!weak.length) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < weak.length) {
      const it = weak[cursor++];
      if (metaCache.has(it.link)) {
        const hit = metaCache.get(it.link);
        if (hit) it.desc = hit;
        continue;
      }
      try {
        const desc = await fetchMetaDescription(it.link);
        metaCache.set(it.link, desc);
        if (desc) it.desc = desc;
      } catch {
        metaCache.set(it.link, '');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, weak.length) }, worker));
}

module.exports = { fetchFeed, fetchRaw, parseFeed, cleanText, decodeEntities, stripTags, normalizeDate, hashId, enrichSummaries };
