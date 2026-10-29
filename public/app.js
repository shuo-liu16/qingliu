'use strict';

/* ────────────────────────── 常量 ────────────────────────── */

const CATS = {
  ai: 'AI 与模型',
  product: '产品与体验',
  business: '商业与市场',
  depth: '深度与观点',
  engineering: '工程与开源',
  science: '科学与健康'
};

const CAT_LIST = ['ai', 'product', 'business', 'depth', 'engineering', 'science'];
const DEFAULT_INTERESTS = ['ai', 'product', 'business', 'depth', 'engineering'];
const ROUNDUP_RE = /(8点1氪|早报|晚报|周报|日报|速览|要闻|汇总|盘点|一周|月报|简报|午报|夜读|热榜|榜单)/;
const FLASH_RE = /(净利润|同比增长|同比下降|归母|涨停|跌停|收盘|开盘|盘中|公告|异动|股价涨|市值)/;
const DIGEST_SIZE = 8;
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* ────────────────────────── 状态 ────────────────────────── */

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const state = {
  view: 'today',
  filter: 'all',
  sort: 'value',
  limit: 24,
  data: null,
  loading: true,
  error: null,
  refreshing: false,
  interests: LS.get('ql:interests', DEFAULT_INTERESTS),
  disabled: LS.get('ql:disabled', []),
  custom: LS.get('ql:custom', []),
  saved: LS.get('ql:saved', []),
  read: new Set(LS.get('ql:read', [])),
  hideRead: LS.get('ql:hideRead', false),
  staticMode: false
};

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ────────────────────────── 数据 ────────────────────────── */

function apiURL(force) {
  const p = new URLSearchParams();
  if (state.disabled.length) p.set('sources', defaultSourceIds().filter((id) => !state.disabled.includes(id)).join(','));
  if (state.custom.length) p.set('extra', JSON.stringify(state.custom.map((c) => ({ url: c.url, name: c.name }))));
  if (force) p.set('force', '1');
  const q = p.toString();
  // 相对路径：本地服务在根目录，GitHub Pages 在 /仓库名/ 子路径下都能命中
  return 'api/news' + (q ? '?' + q : '');
}

let knownSources = [];

function defaultSourceIds() {
  return knownSources.length ? knownSources.map((s) => s.id).filter((id) => !id.startsWith('u')) : [];
}

/**
 * 两种运行模式：
 *  1. 本地/自建服务器 —— 请求 /api/news，实时抓取
 *  2. GitHub Pages 等纯静态托管 —— 读构建产物 data/news.json
 * 先试接口，失败就退回静态文件。
 */
async function loadPayload(force) {
  const attempts = state.staticMode
    ? ['data/news.json?v=' + Math.floor(Date.now() / 60000)]
    : [apiURL(force), 'data/news.json?v=' + Math.floor(Date.now() / 60000)];

  let lastErr = null;
  for (const url of attempts) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      state.staticMode = !url.startsWith('api/');
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('加载失败');
}

async function fetchNews({ force = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  $('#btnRefresh').classList.add('is-loading');

  try {
    const data = await loadPayload(force);
    if (!data || !data.clusters) throw new Error('数据格式不对');

    state.data = data;
    state.error = null;
    knownSources = (data.sources || []).filter((s) => !String(s.id).startsWith('u'));
    LS.set('ql:cache', { at: Date.now(), payload: data });

    const extra = (data.sources || []).filter((s) => String(s.id).startsWith('u'));
    if (extra.length) {
      state.custom = state.custom.map((c) => {
        const hit = extra.find((e) => e.url === c.url);
        return hit ? { ...c, ok: hit.ok, count: hit.count, error: hit.error } : c;
      });
      LS.set('ql:custom', state.custom);
    }
  } catch (e) {
    state.error = e.message || '加载失败';
  } finally {
    state.loading = false;
    state.refreshing = false;
    $('#btnRefresh').classList.remove('is-loading');
    render();
  }
}

/* ────────────────────────── 排序与筛选 ────────────────────────── */

function scoreOf(cluster, now) {
  const lead = cluster.lead;
  const ageH = Math.max(0, (now - Date.parse(lead.publishedAt)) / 36e5);
  let s = 24 * Math.exp(-ageH / 15);                      // 新鲜度
  s += (lead.sourceWeight || 6) * 1.1;                     // 源质量
  s += Math.min((lead.summary || '').length / 14, 10);      // 信息量
  const hit = cluster.cats.filter((c) => state.interests.includes(c));
  s += hit.length ? 12 + 4 * (Math.min(hit.length, 3) - 1) : -20;
  s += Math.min(cluster.sourceCount - 1, 4) * 7;            // 多源报道 = 更重要
  if (ROUNDUP_RE.test(lead.title)) s -= 10;                 // 大杂烩降权
  if (FLASH_RE.test(lead.title)) s -= 7;                    // 纯行情快讯降权
  if ((lead.summary || '').length < 30) s -= 6;             // 没摘要的多半是通稿
  if (lead.lang && lead.lang !== 'zh') s -= 5;              // 中文界面下外文内容稍微靠后
  if (state.read.has(lead.id)) s -= 4;
  return s;
}

function rankedClusters(now = Date.now()) {
  const list = (state.data && state.data.clusters) || [];
  return list
    .filter((c) => !state.disabled.includes(c.lead.sourceId))
    .map((c) => ({ ...c, score: scoreOf(c, now) }))
    .sort((a, b) => (state.sort === 'time' ? Date.parse(b.latestAt) - Date.parse(a.latestAt) : b.score - a.score));
}

/** 今日精选：按分数取，同类目 / 同来源最多 2 条，保证信息面 */
function digest(now = Date.now()) {
  let pool = rankedClusters(now).filter((c) => now - Date.parse(c.lead.publishedAt) < 1000 * 60 * 60 * 40);
  if (!pool.length) pool = rankedClusters(now); // 数据源异常时退回最新内容，不留白屏
  const picked = [];
  const perCat = {};
  const perSrc = {};

  const take = (c, catCap = 2, srcCap = 2) => {
    const cat = c.cats[0] || 'product';
    const src = c.lead.sourceId;
    if ((perCat[cat] || 0) >= catCap) return false;
    if ((perSrc[src] || 0) >= srcCap) return false;
    perCat[cat] = (perCat[cat] || 0) + 1;
    perSrc[src] = (perSrc[src] || 0) + 1;
    picked.push(c);
    return true;
  };

  for (const c of pool) {
    take(c);
    if (picked.length >= DIGEST_SIZE) break;
  }
  if (picked.length < 6) {
    for (const c of pool) {
      if (picked.includes(c)) continue;
      take(c, 3, 3);
      if (picked.length >= 6) break;
    }
  }
  return picked;
}

function filteredFeed(now = Date.now()) {
  const list = rankedClusters(now);
  return list.filter((c) => {
    if (state.filter === 'mine') return c.cats.some((x) => state.interests.includes(x));
    if (state.filter !== 'all') return c.cats.includes(state.filter);
    return true;
  }).filter((c) => !state.hideRead || !state.read.has(c.lead.id));
}

/* ────────────────────────── 格式化 ────────────────────────── */

function fmtTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.round(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = new Date(t);
  const days = Math.floor(diff / 864e5);
  if (days === 1) return '昨天 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (days < 7) return days + ' 天前';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function todayLabel() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK[d.getDay()]}`;
}

/* ────────────────────────── 渲染：今日 ────────────────────────── */

function renderToday() {
  const box = $('#todayBody');
  if (state.loading && !state.data) { box.innerHTML = skeleton(4); return; }
  if (state.error && !state.data) { box.innerHTML = errorState(state.error); return; }
  if (!state.data) { box.innerHTML = errorState('暂无数据'); return; }

  const now = Date.now();
  const picks = digest(now);
  const st = state.data.stats || { fetched: 0, kept: 0, merged: 0, sources: 0 };

  const hero = `
    <div class="brief">
      <div class="brief__eyebrow">
        <span>每日精选</span>
        <span class="dot"></span>
        <span>${esc(greeting())}</span>
      </div>
      <h2 class="brief__title">今天值得读的 <em>${picks.length}</em> 件事</h2>
      <p class="brief__sub">从 ${st.sources} 个信息源、${st.fetched} 条更新里筛出来的。重复报道已合并，与你无关的直接沉底。</p>
      <div class="brief__stats">
        <div><div class="stat__n">${st.fetched}</div><div class="stat__l">抓取</div></div>
        <div><div class="stat__n">${st.merged}</div><div class="stat__l">重复合并</div></div>
        <div><div class="stat__n">${picks.length}</div><div class="stat__l">今日精选</div></div>
      </div>
      ${updatedNote()}
    </div>`;

  if (!picks.length) {
    box.innerHTML = hero + emptyState('今天还没有新内容', '试试刷新，或在「我的」里添加更多信息源。');
    return;
  }

  box.innerHTML = hero + picks.map((c, i) => pickHTML(c, i)).join('');
}

function updatedNote() {
  const at = state.data && state.data.generatedAt;
  if (!at) return '';
  const mins = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (mins < 12) return '';
  return `<div class="brief__upd">数据更新于 ${fmtTime(at)}${mins > 180 ? ' · 源站可能暂时不可达' : ''}</div>`;
}

function pickHTML(c, i) {
  const lead = c.lead;
  const read = state.read.has(lead.id);
  const reasons = [];
  if (c.sourceCount > 1) reasons.push(`<span class="badge badge--multi">${c.sourceCount} 家媒体</span>`);
  const hitCat = c.cats.find((x) => state.interests.includes(x));
  if (hitCat) reasons.push(`<span class="badge badge--tag">${esc(CATS[hitCat])}</span>`);

  return `
  <article class="pick ${i === 0 ? 'pick--lead' : ''} ${read ? 'is-read' : ''}" data-id="${esc(lead.id)}">
    <div class="pick__num">${String(i + 1).padStart(2, '0')}</div>
    <div class="pick__body">
      <h3 class="pick__title">${esc(lead.title)}</h3>
      ${lead.summary ? `<p class="pick__sum">${esc(lead.summary)}</p>` : ''}
      <div class="pick__meta">
        <span class="meta-src">${esc(lead.sourceName)}</span>
        <span class="meta-sep">·</span>
        <span>${fmtTime(lead.publishedAt)}</span>
        ${reasons.join('')}
      </div>
    </div>
  </article>`;
}

/* ────────────────────────── 渲染：全部 ────────────────────────── */

function renderFilters() {
  const opts = [['all', '全部'], ['mine', '我关注的'], ...CAT_LIST.map((c) => [c, CATS[c]])];
  $('#filters').innerHTML = opts
    .map(([k, label]) => `<button class="chip ${state.filter === k ? 'is-on' : ''}" data-filter="${k}">${esc(label)}</button>`)
    .join('');
}

function renderFeed() {
  if (state.loading && !state.data) { $('#feedBody').innerHTML = skeleton(6); $('#feedhead').innerHTML = ''; return; }
  if (!state.data) { $('#feedBody').innerHTML = errorState(state.error || '暂无数据'); return; }

  renderFilters();
  const list = filteredFeed();
  $('#feedhead').innerHTML = `
    <span>${list.length} 个事件${state.hideRead ? ' · 已隐藏读过' : ''}</span>
    <span class="sortsel">
      <button data-sort="value" class="${state.sort === 'value' ? 'is-on' : ''}">有价值</button>
      <button data-sort="time" class="${state.sort === 'time' ? 'is-on' : ''}">最新</button>
    </span>`;

  if (!list.length) {
    $('#feedBody').innerHTML = emptyState('这个分类下暂时没有内容', '换个分类，或者刷新看看。');
    return;
  }

  const shown = list.slice(0, state.limit);
  $('#feedBody').innerHTML =
    shown.map(rowHTML).join('') +
    (list.length > shown.length
      ? `<button class="loadmore" data-action="more">再看 ${Math.min(24, list.length - shown.length)} 条</button>`
      : '');
}

function rowHTML(c) {
  const lead = c.lead;
  const read = state.read.has(lead.id);
  const cat = c.cats[0];
  return `
  <article class="row ${read ? 'is-read' : ''}" data-id="${esc(lead.id)}">
    <h3 class="row__title">${esc(lead.title)}</h3>
    ${lead.summary ? `<p class="row__sum">${esc(lead.summary)}</p>` : ''}
    <div class="row__meta">
      <span class="meta-src">${esc(lead.sourceName)}</span>
      <span class="meta-sep">·</span>
      <span>${fmtTime(lead.publishedAt)}</span>
      ${c.sourceCount > 1 ? `<span class="badge badge--multi">${c.sourceCount} 源</span>` : ''}
      ${cat ? `<span class="badge badge--tag">${esc(CATS[cat])}</span>` : ''}
    </div>
  </article>`;
}

/* ────────────────────────── 渲染：我的 ────────────────────────── */

function renderMe() {
  const box = $('#meBody');
  const sources = (state.data && state.data.sources) || [];
  const st = (state.data && state.data.stats) || {};

  box.innerHTML = `
    <div class="group">
      <div class="group__head"><h2 class="group__title">我关心什么</h2><span class="group__hint">影响排序</span></div>
      <p class="group__desc">选中的方向会被推到前面，其余内容不会消失，只是往后排。</p>
      <div class="interest-grid">
        ${CAT_LIST.map((c) => `
          <button class="pill ${state.interests.includes(c) ? 'is-on' : ''}" data-interest="${c}">
            <span class="pill__tick">✓</span>${esc(CATS[c])}
          </button>`).join('')}
      </div>
    </div>

    <div class="group">
      <div class="group__head"><h2 class="group__title">信息源</h2><span class="group__hint">${sources.filter((s) => s.ok).length}/${sources.length} 正常</span></div>
      <div id="srcList">
        ${sources.filter((s) => !String(s.id).startsWith('u')).map((s) => `
          <div class="srcrow">
            <span class="srcrow__dot ${s.ok ? 'ok' : 'bad'}" title="${esc(s.error || '')}"></span>
            <div class="srcrow__main">
              <div class="srcrow__name">${esc(s.name)}</div>
              <div class="srcrow__url">${s.ok ? `${s.count} 条 · 更新正常` : esc(s.error || '抓取失败')}</div>
            </div>
            <button class="switch ${state.disabled.includes(s.id) ? '' : 'is-on'}" data-src="${esc(s.id)}" aria-label="开关"></button>
          </div>`).join('')}
      </div>

      ${state.staticMode
        ? `<p class="addsrc__msg" style="margin-top:12px">在线版由 GitHub Actions 定时更新，没有后端接口可以实时验证新源。想加源就编辑仓库里的 <b>sources.json</b>，下一次自动更新时生效。</p>`
        : `<div class="addsrc">
            <input id="srcInput" type="url" placeholder="粘贴 RSS / Atom 地址" autocomplete="off">
            <button id="srcAdd">添加</button>
          </div>
          <div class="addsrc__msg" id="srcMsg"></div>`}

      ${state.custom.length ? `<div class="srcrow" style="margin-top:6px;border-top:1px solid var(--line)">
        ${state.custom.map((c) => `
          <div class="srcrow" style="border:0;padding:8px 0;width:100%">
            <span class="srcrow__dot ${c.ok === false ? 'bad' : c.ok ? 'ok' : ''}"></span>
            <div class="srcrow__main">
              <div class="srcrow__name">${esc(c.name || c.url)}</div>
              <div class="srcrow__url">${esc(c.url)}</div>
            </div>
            <button class="saverow__x" data-delsrc="${esc(c.url)}" aria-label="删除">✕</button>
          </div>`).join('')}
      </div>` : ''}
    </div>

    <div class="group">
      <div class="group__head">
        <h2 class="group__title">稍后读</h2>
        <span class="group__hint">${state.saved.length} 篇</span>
      </div>
      ${state.saved.length ? state.saved.slice().reverse().map((s) => `
        <div class="saverow" data-open-saved="${esc(s.id)}">
          <div style="flex:1;min-width:0">
            <div class="saverow__t">${esc(s.title)}</div>
            <div class="saverow__m">${esc(s.sourceName)} · 收藏于 ${fmtTime(s.savedAt)}</div>
          </div>
          <button class="saverow__x" data-unsave="${esc(s.id)}" aria-label="移除">✕</button>
        </div>`).join('')
        : `<p class="group__desc" style="margin:0">还没有收藏。读的时候点右上角的书签，就能存到这里。</p>`}
    </div>

    <div class="group">
      <div class="group__head"><h2 class="group__title">阅读偏好</h2></div>
      <div class="srcrow">
        <div class="srcrow__main">
          <div class="srcrow__name">隐藏已读</div>
          <div class="srcrow__url">在「全部」里不再显示点开过的条目</div>
        </div>
        <button class="switch ${state.hideRead ? 'is-on' : ''}" data-toggle="hideRead" aria-label="隐藏已读"></button>
      </div>
      <div class="srcrow">
        <div class="srcrow__main">
          <div class="srcrow__name">清空阅读记录</div>
          <div class="srcrow__url">已读 ${state.read.size} 条</div>
        </div>
        <button class="saverow__x" data-action="clearRead" aria-label="清空">↺</button>
      </div>
    </div>

    <div class="about">
      <b>清流</b> · 把 ${st.sources || 0} 个信息源压成一页。<br>
      ${state.staticMode ? '由 GitHub Actions 每半小时自动抓取并重建，再发布成静态页面。' : '每 15 分钟抓取一次，自动去重、合并同一事件的重复报道，再按你的兴趣排序。'}<br>
      摘要由正文首段抽取，完整内容请点开原文。
    </div>`;
}

/* ────────────────────────── 状态块 ────────────────────────── */

function skeleton(n) {
  return Array.from({ length: n }).map(() => `
    <div class="skel">
      <div class="skel__line w90"></div>
      <div class="skel__line w70"></div>
      <div class="skel__line w40"></div>
    </div>`).join('');
}

function emptyState(t, d) {
  return `<div class="empty"><div class="empty__icon">○</div><div class="empty__t">${esc(t)}</div><div class="empty__d">${esc(d || '')}</div>
    <button data-action="refresh">刷新试试</button></div>`;
}

function errorState(msg) {
  return `<div class="empty"><div class="empty__icon">!</div><div class="empty__t">没能拉到内容</div>
    <div class="empty__d">${esc(msg || '网络可能不太顺畅')}</div>
    <button data-action="refresh">重试</button></div>`;
}

/* ────────────────────────── 详情浮层 ────────────────────────── */

let sheetItem = null;

function openSheet(id) {
  const cluster = ((state.data && state.data.clusters) || []).find((c) => c.lead.id === id);
  if (!cluster) return;
  const lead = cluster.lead;
  sheetItem = lead;

  state.read.add(lead.id);
  LS.set('ql:read', [...state.read].slice(-500));

  const saved = state.saved.some((s) => s.id === lead.id);

  const content = `
    <div class="sheet__eyebrow">
      <span>${esc(lead.sourceName)}</span><span class="meta-sep">·</span><span>${fmtTime(lead.publishedAt)}</span>
      ${cluster.cats[0] ? `<span class="badge badge--tag">${esc(CATS[cluster.cats[0]])}</span>` : ''}
    </div>
    <h2 class="sheet__title">${esc(lead.title)}</h2>
    ${lead.summary ? `<div class="sheet__sum">${esc(lead.summary)}</div>` : ''}
    ${cluster.items.length > 1 ? `
      <div class="sheet__section">同一事件 · ${cluster.sourceCount} 家媒体的角度</div>
      <div class="sheet__rel">
        ${cluster.items.slice(1).map((it) => `<a href="${esc(it.link)}" target="_blank" rel="noopener"><span>${esc(it.sourceName)}</span>${esc(it.title)}</a>`).join('')}
      </div>` : ''}
    <div class="sheet__section" style="margin-top:22px">为什么给你看这条</div>
    <p class="group__desc" style="margin:6px 0 8px">${esc(reasonText(cluster))}</p>`;

  const sheet = $('#sheet');
  sheet.innerHTML = `
    <div class="sheet__grab"></div>
    <div class="sheet__scroll">${content}</div>
    <div class="sheet__actions">
      <a class="btn-primary" href="${esc(lead.link)}" target="_blank" rel="noopener">阅读全文</a>
      <button class="btn-ghost ${saved ? 'is-on' : ''}" data-action="save" aria-label="收藏">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
          <path d="M6 4h12v16l-6-4.2L6 20z"/>
        </svg>
      </button>
    </div>`;

  $('#sheetMask').hidden = false;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';

  render();
}

function reasonText(c) {
  const bits = [];
  if (c.sourceCount > 1) bits.push(`${c.sourceCount} 家媒体在同一时间报道同一件事，这种交叉验证通常意味着它值得知道。`);
  const hit = c.cats.find((x) => state.interests.includes(x));
  if (hit) bits.push(`它落在你关注的「${CATS[hit]}」方向里。`);
  const ageH = (Date.now() - Date.parse(c.lead.publishedAt)) / 36e5;
  if (ageH < 3) bits.push('刚刚发生，还在扩散。');
  if (!bits.length) bits.push('来自你启用的信息源，信息密度较高。');
  return bits.join('');
}

function closeSheet() {
  $('#sheetMask').hidden = true;
  const sheet = $('#sheet');
  sheet.hidden = true;
  sheet.style.transform = '';
  sheet.style.transition = '';
  document.body.style.overflow = '';
  sheetItem = null;
  render();
}

/* 下拉关闭浮层 */
(function bindSheetDrag() {
  const sheet = $('#sheet');
  let startY = 0, offset = 0, dragging = false;

  sheet.addEventListener('touchstart', (e) => {
    const scroller = sheet.querySelector('.sheet__scroll');
    if (!scroller || scroller.scrollTop > 0) return;
    dragging = true;
    startY = e.touches[0].clientY;
    offset = 0;
    sheet.style.transition = 'none';
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    offset = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translate(-50%, ${offset}px)`;
  }, { passive: true });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = 'transform .22s cubic-bezier(.3,.9,.3,1)';
    if (offset > 110) closeSheet();
    else sheet.style.transform = 'translate(-50%, 0)';
    setTimeout(() => { if (!sheet.hidden) sheet.style.transition = ''; }, 240);
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
})();

function toggleSave() {
  if (!sheetItem) return;
  const id = sheetItem.id;
  const idx = state.saved.findIndex((s) => s.id === id);
  if (idx >= 0) {
    state.saved.splice(idx, 1);
    toast('已从稍后读移除');
  } else {
    state.saved.push({ id, title: sheetItem.title, sourceName: sheetItem.sourceName, link: sheetItem.link, savedAt: new Date().toISOString() });
    toast('已加入稍后读');
  }
  LS.set('ql:saved', state.saved);
  closeSheet();
  render();
}

/* ────────────────────────── 交互 ────────────────────────── */

function switchView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach((n) => { n.hidden = n.id !== 'view-' + v; });
  document.querySelectorAll('.tab').forEach((n) => n.classList.toggle('is-active', n.dataset.view === v));
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 1800);
}

async function addSource() {
  const input = $('#srcInput');
  const msg = $('#srcMsg');
  const url = input.value.trim();
  if (!url) return;
  msg.className = 'addsrc__msg';
  msg.textContent = '正在验证…';
  $('#srcAdd').disabled = true;

  try {
    const res = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!data.ok) {
      msg.className = 'addsrc__msg err';
      msg.textContent = '这个地址读不到 RSS：' + data.error;
      return;
    }
    if (state.custom.some((c) => c.url === url)) {
      msg.className = 'addsrc__msg';
      msg.textContent = '这个源已经在列表里了。';
      return;
    }
    state.custom.push({ url, name: data.name, ok: true, count: data.count });
    LS.set('ql:custom', state.custom);
    input.value = '';
    msg.className = 'addsrc__msg ok';
    msg.textContent = `已添加，读到 ${data.count} 条。正在重新排序…`;
    await fetchNews({ force: true });
    render();
  } catch (e) {
    msg.className = 'addsrc__msg err';
    msg.textContent = '验证失败：' + e.message;
  } finally {
    $('#srcAdd').disabled = false;
  }
}

/* ────────────────────────── 绑定 ────────────────────────── */

document.addEventListener('click', async (e) => {
  const t = e.target;

  const tab = t.closest('.tab');
  if (tab) return switchView(tab.dataset.view);

  if (t.closest('#btnRefresh')) return fetchNews({ force: true });

  const pick = t.closest('[data-id]');
  if (pick && !t.closest('a')) { openSheet(pick.dataset.id); return; }

  const chip = t.closest('[data-filter]');
  if (chip) { state.filter = chip.dataset.filter; state.limit = 24; return render(); }

  const sortBtn = t.closest('[data-sort]');
  if (sortBtn) { state.sort = sortBtn.dataset.sort; return render(); }

  const interest = t.closest('[data-interest]');
  if (interest) {
    const c = interest.dataset.interest;
    const i = state.interests.indexOf(c);
    if (i >= 0) state.interests.splice(i, 1);
    else state.interests.push(c);
    LS.set('ql:interests', state.interests);
    return render();
  }

  const src = t.closest('[data-src]');
  if (src) {
    const id = src.dataset.src;
    const i = state.disabled.indexOf(id);
    if (i >= 0) state.disabled.splice(i, 1);
    else state.disabled.push(id);
    LS.set('ql:disabled', state.disabled);
    render();
    // 静态模式下关闭某个源是纯前端过滤，不必重新抓取
    if (!state.staticMode) fetchNews({ force: true });
    return;
  }

  const toggle = t.closest('[data-toggle]');
  if (toggle) {
    state.hideRead = !state.hideRead;
    LS.set('ql:hideRead', state.hideRead);
    return render();
  }

  if (t.closest('#srcAdd')) return addSource();
  if (t.closest('#sheetMask')) return closeSheet();
  if (t.closest('#sheet')) { /* 内容区不再传递 */ }

  const del = t.closest('[data-delsrc]');
  if (del) {
    state.custom = state.custom.filter((c) => c.url !== del.dataset.delsrc);
    LS.set('ql:custom', state.custom);
    render();
    return fetchNews({ force: true });
  }

  const unsave = t.closest('[data-unsave]');
  if (unsave) {
    state.saved = state.saved.filter((s) => s.id !== unsave.dataset.unsave);
    LS.set('ql:saved', state.saved);
    return render();
  }

  const openSaved = t.closest('[data-open-saved]');
  if (openSaved) {
    const s = state.saved.find((x) => x.id === openSaved.dataset.openSaved);
    if (s) window.open(s.link, '_blank', 'noopener');
    return;
  }

  const action = t.closest('[data-action]');
  if (action) {
    const a = action.dataset.action;
    if (a === 'refresh') return fetchNews({ force: true });
    if (a === 'more') { state.limit += 24; return render(); }
    if (a === 'save') return toggleSave();
    if (a === 'clearRead') {
      state.read.clear();
      LS.set('ql:read', []);
      toast('阅读记录已清空');
      return render();
    }
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

window.addEventListener('scroll', () => {
  $('#topbar').classList.toggle('is-scrolled', window.scrollY > 4);
}, { passive: true });

/* ────────────────────────── 启动 ────────────────────────── */

function render() {
  $('#todayLabel').textContent = todayLabel();
  if (state.view === 'today') renderToday();
  else if (state.view === 'all') renderFeed();
  else renderMe();
}

(function boot() {
  const cache = LS.get('ql:cache', null);
  if (cache && cache.payload) {
    state.data = cache.payload;
    knownSources = (cache.payload.sources || []).filter((s) => !String(s.id).startsWith('u'));
    state.loading = false;
  }
  render();
  fetchNews();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
