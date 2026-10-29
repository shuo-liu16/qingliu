'use strict';

const { KEYWORDS, CATS } = require('./sources');

/* ────────────────────────── 摘要抽取 ────────────────────────── */

const BOILERPLATE = [
  /点击查看原文[>》]?/g,
  /阅读原文/g,
  /原文链接[:：]?\s*\S*/g,
  /The post .*? appeared first on .*/gi,
  /Continue reading.*$/i,
  /本文来自微信公众号.*$/i,
  /扫码关注.*$/i
];

/** 整句都是版权/署名信息 → 丢弃 */
const META_SENT_RE = /^(文|作者|撰文|编辑|责编|校对|编译|来源|题图|题图来源|图片来源|图源|视觉中国|本文作者|关于作者|实习生)\s*[|｜:：]/;
const META_ANY_RE = /(经授权发布|本文来自|原文链接|扫码关注|转载请注明|图片来源[:：]|题图来自|视觉中国|appeared first on|Continue reading|Read more)/i;
const MEDIA_LEAD_RE = /^(36氪|少数派|爱范儿|极客公园|钛媒体|雷峰网|InfoQ|IT\s*之家|Solidot|界面新闻|虎嗅|雷锋网|机器之心|量子位)\s*(获悉|消息|报道|原创|独家)?\s*[，,、：:]\s*/;
/** 「IT之家 10 月 29 日消息，」「10月29日消息，」这类电头 */
const DATELINE_RE = /^([\u4e00-\u9fa5A-Za-z]{0,10}\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日\s*(消息|电|讯|报道)?\s*[，,]\s*/;

function cleanSentence(s = '') {
  let t = s.trim();
  // 整句被括号包住且是署名
  const wrapped = t.match(/^[（(]([^）)]{2,100})[）)]$/);
  if (wrapped && /(作者|编辑|授权|来源|发布|编译)/.test(wrapped[1])) return '';
  if (META_SENT_RE.test(t)) return '';
  if (META_ANY_RE.test(t)) return '';
  // 句首的括号署名，剥掉后继续用
  t = t.replace(/^[（(][^）)]{0,90}[）)]\s*/, '').trim();
  t = t.replace(/^(文|作者|编辑|编译|来源|题图|图片来源|图源)\s*[|｜:：]\s*/, '').trim();
  t = t.replace(MEDIA_LEAD_RE, '').trim();
  t = t.replace(DATELINE_RE, '').trim();
  if (t.length < 8) return '';
  return t;
}

function summarize(text = '', lang = 'zh') {
  let s = text;
  for (const re of BOILERPLATE) s = s.replace(re, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  const isZh = lang === 'zh' || /[\u4e00-\u9fa5]/.test(s.slice(0, 30));
  const limit = isZh ? 96 : 190;
  const parts = s.split(isZh ? /(?<=[。！？；!?])/ : /(?<=[.!?])\s+/);

  const kept = [];
  for (const p of parts) {
    const t = cleanSentence(p);
    if (t) kept.push(t);
  }

  let out = '';
  for (const t of kept) {
    if (!out) { out = t; }
    else if ((out + t).length <= limit * 1.45) { out += (isZh ? '' : ' ') + t; }
    else break;
    if (out.length >= limit * 0.75) break;
  }
  if (out.length > limit * 1.6) out = out.slice(0, limit * 1.6);
  return out.trim();
}

/* ────────────────────────── 分类 ────────────────────────── */

function categorize(item) {
  const hay = (item.title + ' ' + item.desc).toLowerCase();
  const scores = {};
  let best = null, bestScore = 0;

  for (const [cat, words] of Object.entries(KEYWORDS)) {
    let n = 0;
    for (const w of words) {
      const lw = w.toLowerCase();
      if (!hay.includes(lw)) continue;
      // 标题命中权重更高
      n += item.title.toLowerCase().includes(lw) ? 2.2 : 0.9;
    }
    if (n > 0) scores[cat] = n;
    if (n > bestScore) { bestScore = n; best = cat; }
  }

  const cats = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c);

  if (!cats.length && item.sourceCat) cats.push(item.sourceCat);
  if (!cats.length) cats.push('product');

  return { cats, primary: cats[0], confidence: Math.min(1, bestScore / 6) };
}

/* ────────────────────────── 分词与相似度 ────────────────────────── */

const ZH_STOP = new Set(['的', '了', '是', '在', '和', '与', '及', '对', '为', '也', '都', '就', '而', '被', '把', '这', '那', '有', '我', '你', '他', '她', '它', '们', '一个', '我们', '他们', '以及', '但是', '因为', '所以', '可以', '已经', '正在', '如何', '什么', '为什么', '怎么', '这个', '那个', '这些', '那些', '没有', '不是', '就是', '还是', '或者', '如果', '虽然', '不过', '然后', '现在', '目前']);

const EN_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'will', 'has', 'have', 'had', 'not', 'but', 'you', 'your', 'its', 'our', 'their', 'into', 'about', 'after', 'over', 'than', 'then', 'they', 'them', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'can', 'could', 'would', 'should', 'here', 'there', 'now', 'new', 'says', 'said', 'more', 'most', 'out', 'all', 'one', 'two', 'first']);

function tokenize(title = '') {
  const t = title.toLowerCase().replace(/[【】\[\]（）()「」『』《》〈〉"'“”‘’]/g, ' ');
  const tokens = new Set();

  for (const w of t.match(/[a-z][a-z0-9+#.]{2,}/g) || []) {
    if (EN_STOP.has(w)) continue;
    tokens.add(w.replace(/[.]+$/, ''));
  }

  const hanRuns = t.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const run of hanRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (ZH_STOP.has(bg)) continue;
      if (/^[\u4e00-\u9fa5]{2}$/.test(bg)) tokens.add(bg);
    }
  }
  return tokens;
}

/** 高频模板词：出现在大量标题里，不携带「同一事件」信息 */
const BOILER_TOKENS = new Set(['同比', '增长', '下滑', '亿元', '万元', '季度', '前三', '三季', '归母', '母净', '净利', '利润', '营收', '发布', '宣布', '表示', '认为', '成为', '已经', '正在', '开始', '今年', '去年', '明年', '今日', '昨日', '今日', '独家', '首发', '最新', '全文', '报道', '消息', '亿元', '同比', '增幅', '股价', '市值']);

function buildIdf(docs) {
  const df = new Map();
  for (const d of docs) {
    for (const t of d) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length || 1;
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log((N + 1) / (c + 0.5)));
  return idf;
}

/** IDF 加权余弦相似度：专有名词权重高，模板句权重趋近 0 */
function weightedSim(a, b, idf) {
  if (!a.size || !b.size) return 0;
  const w = (t) => {
    if (BOILER_TOKENS.has(t)) return 0.05;
    const v = idf.get(t);
    return v === undefined ? 2.6 : Math.max(0.25, v);
  };
  let dot = 0, na = 0, nb = 0;
  for (const t of a) { const v = w(t); na += v * v; if (b.has(t)) dot += v * v; }
  for (const t of b) { const v = w(t); nb += v * v; }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/* ────────────────────────── 聚类 ────────────────────────── */

/** 提取标题里的「实质性数字」（金额、百分比），年份和序号不算 */
function keyNumbers(title = '') {
  const out = new Set();
  for (const m of title.match(/\d+\.\d+|\d{3,}/g) || []) {
    const n = Number(m);
    if (!Number.isFinite(n)) continue;
    if (/^\d{4}$/.test(m) && n >= 1990 && n <= 2100) continue; // 年份
    out.add(m);
  }
  return out;
}

function shareNumber(a, b) {
  if (!a.size || !b.size) return true; // 有一方没有数字，不以此否决
  for (const x of a) if (b.has(x)) return true;
  return false;
}

const ROUNDUP_RE = /(8点1氪|早报|晚报|周报|日报|速览|要闻|汇总|盘点|一周|月报|简报|午报|夜读|热榜|榜单)/;
const FIN_RE = /(净利润|归母|营收|同比|环比|亿元|万元|财报|季报|Q[1-4]|季度)/;

function clusterArticles(items) {
  const prepared = items.map((it) => ({
    ...it,
    tokens: tokenize(it.title),
    nums: keyNumbers(it.title),
    roundup: ROUNDUP_RE.test(it.title),
    fin: FIN_RE.test(it.title)
  }));

  const idf = buildIdf(prepared.map((p) => p.tokens));

  // 文档频率，用于识别「稀有词」（专名 / 品牌）
  const df = new Map();
  for (const p of prepared) for (const t of p.tokens) df.set(t, (df.get(t) || 0) + 1);
  const rareCut = Math.max(3, Math.round(prepared.length * 0.015));

  const anchorCount = (a, b) => {
    let n = 0;
    for (const t of a) if (b.has(t) && !BOILER_TOKENS.has(t) && (df.get(t) || 0) <= rareCut) n++;
    return n;
  };

  // 时间新的在前，作为聚类代表更合理
  prepared.sort((a, b) => ts(b.publishedAt) - ts(a.publishedAt));

  const clusters = [];
  for (const it of prepared) {
    let best = null, bestSim = 0;
    if (!it.roundup) {
      for (const c of clusters) {
        const lead = c.items[0];
        if (lead.sourceId === it.sourceId) continue; // 同源不合并，避免同栏目串联
        if (lead.roundup) continue;
        const sim = weightedSim(it.tokens, lead.tokens, idf);
        if (sim < 0.3) continue;
        // 两家都在讲财报数字时，数字对不上就是两件事（Q3 vs 前三季度）
        if (it.fin && lead.fin && !shareNumber(it.nums, lead.nums)) continue;
        // 要么整体很像，要么共享至少两个稀有专名
        const anchors = anchorCount(it.tokens, lead.tokens);
        // 英文标题共享通用词更容易误判，阈值抬高一档
        const anchorGate = (it.lang === 'en' || lead.lang === 'en') ? 0.46 : 0.31;
        const ok = (sim >= 0.5 && anchors >= 1) || (anchors >= 2 && sim >= anchorGate);
        if (!ok) continue;
        if (sim > bestSim) { bestSim = sim; best = c; }
      }
    }
    if (best) {
      best.items.push(it);
    } else {
      clusters.push({ items: [it] });
    }
  }

  return clusters.map((c, i) => {
    const items = c.items.map(({ tokens, ...rest }) => rest);
    const lead = items[0];
    const cats = [...new Set(items.flatMap((x) => x.cats))];
    const sources = [...new Set(items.map((x) => x.sourceName))];
    const times = items.map((x) => ts(x.publishedAt)).filter(Boolean);
    return {
      id: 'c' + i,
      lead,
      items,
      sourceCount: sources.length,
      sources,
      cats,
      latestAt: new Date(Math.max(...times) || Date.now()).toISOString(),
      earliestAt: new Date(Math.min(...times) || Date.now()).toISOString(),
      categoryName: CATS[cats[0]] || ''
    };
  });
}

function ts(d) {
  const t = d ? Date.parse(d) : 0;
  return Number.isNaN(t) ? 0 : t;
}

/* ────────────────────────── 主处理 ────────────────────────── */

function buildIndex(rawItems) {
  const seenLink = new Set();
  const seenTitle = new Set();
  const kept = [];

  for (const it of rawItems) {
    const key = it.link.split('?')[0].replace(/\/$/, '');
    const tkey = it.title.toLowerCase().replace(/[\s\p{P}]/gu, '');
    if (seenLink.has(key)) continue;
    if (tkey && seenTitle.has(tkey)) continue;
    if (it.title.length < 4) continue;

    seenLink.add(key);
    if (tkey) seenTitle.add(tkey);

    const { cats, primary, confidence } = categorize(it);
    kept.push({
      ...it,
      cats,
      primary,
      confidence,
      summary: summarize(it.desc, it.lang),
      publishedAt: it.publishedAt || new Date().toISOString()
    });
  }

  const clusters = clusterArticles(kept);
  clusters.sort((a, b) => ts(b.latestAt) - ts(a.latestAt));

  return { items: kept, clusters };
}

module.exports = { buildIndex, summarize, categorize, tokenize, clusterArticles };
