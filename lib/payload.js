'use strict';

/**
 * 把抓到的原始条目整理成前端消费的数据包。
 * 在线服务（server.js）和静态构建（scripts/build-static.js）共用这一份逻辑，
 * 避免两种部署方式产出不一致。
 */

const { buildIndex } = require('./pipeline');
const { enrichSummaries } = require('./feed');

/** 精简字段，减少流量 */
function compact(it) {
  return {
    id: it.id,
    title: it.title,
    link: it.link,
    summary: it.summary || '',
    publishedAt: it.publishedAt,
    sourceId: it.sourceId,
    sourceName: it.sourceName,
    sourceWeight: it.sourceWeight,
    cats: it.cats,
    lang: it.lang
  };
}

/**
 * @param {Array} all     原始条目（已抓取）
 * @param {Array} status  每个源的抓取状态
 * @param {number} sourceCount 启用的源数量
 */
function shape(all, status, sourceCount) {
  const { items, clusters } = buildIndex(all);

  const now = Date.now();
  const fresh = items.filter((it) => now - Date.parse(it.publishedAt) < 1000 * 60 * 60 * 72);
  const usable = fresh.length > 12 ? fresh : items;
  const usableIds = new Set(usable.map((it) => it.id));
  const events = clusters.filter((c) => usableIds.has(c.lead.id));

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      sources: sourceCount,
      sourcesOk: status.filter((s) => s.ok).length,
      fetched: all.length,
      kept: usable.length,
      events: events.length,
      merged: Math.max(0, usable.length - events.length),
      withSummary: usable.filter((it) => it.summary).length
    },
    sources: status,
    clusters: events.map((c) => ({
      ...c,
      lead: compact(c.lead),
      items: c.items.map(compact)
    }))
  };
}

/** 抓取 → 补摘要 → 整理，静态构建用 */
async function buildPayload(sources, fetchAll) {
  const { all, status } = await fetchAll(sources);
  await enrichSummaries(all, 16);
  return shape(all, status, sources.length);
}

module.exports = { compact, shape, buildPayload };
