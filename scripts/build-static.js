'use strict';

/**
 * 静态构建：抓取 → 聚类 → 输出 dist/
 * GitHub Actions 每半小时跑一次，GitHub Pages 只托管产物，不需要任何服务器。
 *
 * 用法: node scripts/build-static.js [--out dist]
 */

const fs = require('fs');
const path = require('path');

const { SOURCES } = require('../lib/sources');
const { fetchFeed, enrichSummaries } = require('../lib/feed');
const { shape } = require('../lib/payload');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = path.resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : 'dist');
const PUBLIC = path.join(ROOT, 'public');

async function fetchAll(sources) {
  const all = [];
  const status = [];

  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        const items = await fetchFeed(s);
        return { source: s, items: items.slice(0, 40), ok: true, error: null };
      } catch (e) {
        return { source: s, items: [], ok: false, error: e.message };
      }
    })
  );

  for (const r of results) {
    all.push(...r.items);
    status.push({ id: r.source.id, name: r.source.name, url: r.source.url, ok: r.ok, count: r.items.length, error: r.error });
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.source.name.padEnd(16)} ${r.ok ? r.items.length + ' 条' : r.error}`);
  }
  return { all, status };
}

async function main() {
  console.log(`[1/3] 抓取 ${SOURCES.length} 个源`);
  const started = Date.now();
  const { all, status } = await fetchAll(SOURCES);

  if (!all.length) {
    console.error('所有源都失败了，保留上一次的构建产物，本次不覆盖。');
    process.exit(1);
  }

  console.log(`[2/3] 补摘要 + 聚类（${all.length} 条）`);
  await enrichSummaries(all, 16);
  const payload = shape(all, status, SOURCES.length);

  console.log(`[3/3] 写入 ${path.relative(ROOT, OUT)}/`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  fs.cpSync(PUBLIC, OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  fs.writeFileSync(path.join(OUT, 'data', 'news.json'), JSON.stringify(payload));

  // 兼容：本地用 server.js 时，静态文件放在 public/data 下也能读到
  fs.mkdirSync(path.join(PUBLIC, 'data'), { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, 'data', 'news.json'), JSON.stringify(payload));

  const kb = (fs.statSync(path.join(OUT, 'data', 'news.json')).size / 1024).toFixed(0);
  console.log(
    `完成：${payload.stats.kept} 条 / ${payload.stats.events} 个事件 / ` +
    `合并 ${payload.stats.merged} / 摘要 ${payload.stats.withSummary} 条 · ` +
    `JSON ${kb}KB · 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
}

main().catch((e) => {
  console.error('构建失败:', e);
  process.exit(1);
});
