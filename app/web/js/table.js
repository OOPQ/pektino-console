/* table.js — 过滤 / 排序 / 分页 / 表格渲染 / 列显隐 / KPI 快捷筛选 */
import { $, PREFS, savePrefs, state, onEvent, toast, stTag, fmtMB, starsHtml, starsInner } from './core.js';

export const COLS = [
  { key: 'cover', label: '封面' }, { key: 'title', label: '标题' }, { key: 'rank', label: '排名' }, { key: 'duration', label: '时长' },
  { key: 'res', label: '分辨率' }, { key: 'views', label: '站点观看' }, { key: 'likes', label: '点赞' },
  { key: 'plays', label: '本地播放' }, { key: 'rating', label: '评分' }, { key: 'source', label: '来源' }, { key: 'token', label: 'token' },
  { key: 'status', label: '状态' }, { key: 'disk', label: '磁盘' }, { key: 'first_seen', label: '入库时间' }
];

export function applyCols() {
  COLS.forEach(c => {
    const hide = PREFS.cols[c.key] === false;
    document.querySelectorAll('.col-' + c.key).forEach(el => el.classList.toggle('hidecol', hide));
  });
}

/* ---------- 过滤 ---------- */
const RES_RANK = { '4k': 2160, '1080': 1080, '720': 720 };
function passFilter(r) {
  /* 回收站条目只在「更多 → 回收站」里出现 */
  if (r.status === 'recycled' || r.status === 'ignored') return false;
  /* 「本次新增」临时筛选：只看新增，不再叠加其他筛选（否则容易筛成空列表） */
  if (state.SHOW_ADDED && state.ADDED && state.ADDED.size) return state.ADDED.has(r.token);
  /* 来源筛选 */
  if (state.FILTER.source && state.FILTER.source !== 'all' && (r.source || 'pektino') !== state.FILTER.source) return false;
  /* 合集筛选（可与其他筛选叠加） */
  if (state.COL_FILTER && state.COL_TOKENS && !state.COL_TOKENS.has(r.token)) return false;
  /* 状态：任务生命周期（单选） */
  const st = state.FILTER.status;
  if (['new', 'done', 'failed'].includes(st) && r.status !== st) return false;

  /* 标记：资源属性（单选，可与状态叠加） */
  const fl = state.FILTER.flag;
  if (fl && fl !== 'none') {
    switch (fl) {
      case 'have': if (!r.file_name) return false; break;
      case 'miss': if (r.file_name) return false; break;
      case 'fav': if (r.fav !== '1') return false; break;
      case 'towatch': if (!r.file_name || r.last_play) return false; break;
      case 'watched': if (!r.last_play) return false; break;
      case 'rated': if (!(+r.rating > 0)) return false; break;
      case 'top': if (!(+r.rating >= 4)) return false; break;
      case 'today': {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if ((r.first_seen || '').slice(0, 10) !== iso) return false;
        break;
      }
    }
  }
  if (state.FILTER.res !== 'all') {
    const w = parseInt((r.res || '').split('x')[0]) || 0;
    const h = parseInt((r.res || '').split('x')[1]) || 0;
    if (state.FILTER.res === 'portrait') { if (h <= w) return false; }
    else { const need = RES_RANK[state.FILTER.res]; const short = Math.min(w, h); if (short < need) return false; }
  }
  if (state.FILTER.minDur) {
    const min = parseFloat(state.FILTER.minDur);
    if (min > 0 && (parseInt(r.seconds) || 0) < min * 60) return false;
  }
  if (state.FILTER.q) {
    const t = state.FILTER.q.toLowerCase();
    if (!((r.token + ' ' + r.res + ' ' + r.duration).toLowerCase().includes(t))) return false;
  }
  return true;
}

/* ---------- 排序 ---------- */
const SORTS = {
  rank: r => (r.rank === '' || r.rank == null) ? null : +r.rank,
  duration: r => {
    const s = (r.seconds === '' || r.seconds == null) ? 0 : +r.seconds;
    if (s > 0) return s;
    // 兜底：老数据 seconds 可能是 0，用时长文本回算
    const parts = (r.duration || '').split(':').map(Number);
    if (!parts.length || parts.some(isNaN)) return null;
    return parts.reduce((a, x) => a * 60 + x, 0) || null;
  },
  res: r => { const m = (r.res || '').split('x'); return m.length === 2 ? (+m[0]) * (+m[1]) : 0; },
  views: r => (+r.views || 0),
  likes: r => (+r.likes || 0),
  plays: r => (+r.play_count || 0),
  rating: r => (+r.rating || 0),
  token: r => (r.token || ''),
  status: r => ['failed', 'new', 'done', 'recycled', 'ignored'].indexOf(r.status),
  disk: r => (+r.file_size || 0),
  first_seen: r => (r.first_seen || '')
};

export function visible() {
  const f = SORTS[state.SORT.key] || SORTS.rank;
  const d = state.SORT.dir === 'asc' ? 1 : -1;
  // 缺失值（没有时长的本地文件等）永远排最后，避免"看起来没排序"
  const isNil = v => v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v));
  return state.ROWS.filter(passFilter).slice().sort((a, b) => {
    const va = f(a), vb = f(b);
    const na = isNil(va), nb = isNil(vb);
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return va < vb ? -d : va > vb ? d : 0;
  });
}

/* ================= 表格列宽 ================= */
function colKey(th, i) {
  const m = (th.className || '').match(/col-([\w-]+)/);
  return th.dataset.key || (m ? m[1] : ('c' + i));
}
function applyColWidths() {
  const widths = PREFS.colWidths || {};
  document.querySelectorAll('#tablewrap thead th').forEach((th, i) => {
    const w = widths[colKey(th, i)];
    if (w) th.style.width = w + 'px';
  });
}
function initColResize() {
  const ths = [...document.querySelectorAll('#tablewrap thead th')];
  ths.forEach((th, i) => {
    if (i === 0) return; // 勾选列固定
    if (!th.querySelector('.colresize')) {
      const h = document.createElement('span');
      h.className = 'colresize';
      th.appendChild(h);
    }
    const h = th.querySelector('.colresize');
    if (!h || h._bound) return;
    h._bound = true;
    h.addEventListener('click', e => e.stopPropagation());
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const key = colKey(th, i);
      const startX = e.clientX, startW = th.getBoundingClientRect().width;
      const move = ev => {
        const w = Math.max(48, Math.round(startW + ev.clientX - startX));
        th.style.width = w + 'px';
        PREFS.colWidths = PREFS.colWidths || {};
        PREFS.colWidths[key] = w;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-col');
        h.classList.remove('dragging');
        savePrefs();
      };
      document.body.classList.add('resizing-col');
      h.classList.add('dragging');
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
}
/* ---------- 单元格 ---------- */
function coverCell(r) {
  if (!state.SHOW_COVERS) return '<div class="covbox"><div class="ph"></div></div>';
  // 列表也用高清原图；加载失败回退缩略图（120px），再失败才显示占位
  const u = '/api/cover?token=' + encodeURIComponent(r.token) + '&full=1';
  return `<div class="covbox" data-lb="${r.token}" title="点击放大">
      <img src="${u}" loading="lazy" alt=""
           onerror="if(!this.dataset.f){this.dataset.f=1;this.src=this.src.replace('&full=1','');}else{this.parentNode.classList.add('nocover');this.remove();}">
    </div>`;
}
function rateCell(r) {
  return starsHtml(r.rating, { token: r.token });
}

/* ---------- 画廊（卡片）视图 ---------- */
export function cardHtml(r, active) {
  const fav = r.fav === '1';
  const hasFile = !!r.file_name;
  const isActive = active && active.has(r.token);
  const selected = state.SEL.has(r.token);
  const dlBtn = hasFile
    ? ''
    : (isActive
      ? `<button class="dlbtn danger" data-dl-cancel="${r.token}">取消</button>`
      : `<button class="dlbtn" data-dl="${r.token}">下载</button>`);
  return `<div class="card ${selected ? 'sel' : ''}" data-row="${r.token}">
    <button class="selcard ${selected ? 'on' : ''}" data-sel="${r.token}" title="选择"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="cover" data-lb="${r.token}" title="点击放大">
      <img src="/api/cover?token=${encodeURIComponent(r.token)}&full=1" loading="lazy" alt=""
           onerror="if(!this.dataset.f){this.dataset.f=1;this.src=this.src.replace('&full=1','');}else{this.parentNode.classList.add('nocover');this.remove();}">
      <span class="st">${stTag(r.status)}</span>
      ${hasFile ? `<span class="playbtn" data-play="${r.token}">▶</span>` : ''}
    </div>
    <div class="body">
      <div class="name mono" title="${r.token}">${r.title || r.token}</div>
      <div class="meta">${r.duration || '—'} · ${r.res || '—'}${(+r.play_count) ? ' · ▶' + r.play_count : ''}${r.source && r.source !== 'pektino' ? ' · ' + r.source : ''}</div>
      <div class="stars">
        <button class="star ${fav ? 'on' : ''}" data-fav="${r.token}" title="收藏">${fav ? '★' : '☆'}</button>
        <span class="rt" data-rate="${r.token}">${starsInner(r.rating)}</span>
      </div>
      ${dlBtn ? `<div class="foot">${dlBtn}</div>` : ''}
    </div>
  </div>`;
}

function renderGallery(rows, active) {
  const el = $('#gallery');
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty">没有匹配的条目</div>'; return; }
  el.innerHTML = rows.map(r => cardHtml(r, active)).join('');
}

/* ---------- 渲染 ---------- */
export function render() {
  applyColWidths();
  const all = visible();
  const per = state.PER > 0 ? state.PER : all.length || 1;
  const pages = Math.max(1, Math.ceil(all.length / per));
  state.PAGE = Math.min(Math.max(1, state.PAGE), pages);
  const start = (state.PAGE - 1) * per;
  const rows = all.slice(start, start + per);

  const tb = $('#tbody');
  // 当前在下载队列里的 token（用于把「下载」按钮换成「取消」，并给状态加个下载中圆点）
  const active = new Set(((state.DOWNLOAD && state.DOWNLOAD.items) || [])
    .filter(i => ['downloading', 'queued', 'paused'].includes(i.state))
    .map(i => i.token));
  if (!all.length) {
    tb.innerHTML = '<tr><td colspan="15" class="empty">没有匹配的条目 —— 换个筛选条件，或点「抓取并入库」</td></tr>';
  } else {
    tb.innerHTML = rows.map((r, i) => `
      <tr data-row="${r.token}" class="${state.SEL.has(r.token) ? 'sel' : ''}">
        <td><input type="checkbox" data-tk="${r.token}" data-idx="${start + i}" ${state.SEL.has(r.token) ? 'checked' : ''}></td>
        <td><button class="star ${r.fav === '1' ? 'on' : ''}" data-fav="${r.token}" title="收藏/取消">${r.fav === '1' ? '★' : '☆'}</button></td>
        <td class="col-cover">${coverCell(r)}</td>
        <td class="col-title" title="${r.title || r.token}"><span class="ttl">${r.title || r.token}</span></td>
        <td class="num col-rank">${r.rank || ''}</td>
        <td class="num col-duration">${r.duration || '—'}</td>
        <td class="mono col-res">${r.res || ''}</td>
        <td class="num col-views">${r.views || ''}</td>
        <td class="num col-likes">${r.likes || ''}</td>
        <td class="num col-plays" title="${r.last_play ? '上次播放 ' + r.last_play : '还没播过'}">${(+r.play_count || 0) > 0 ? '▶' + r.play_count : ''}</td>
        <td class="col-rating">${rateCell(r)}</td>
        <td class="mono col-source">${r.source || 'pektino'}</td>
        <td class="mono playable col-token" data-play="${r.token}" title="${r.token}${r.file_name ? ' · 点击播放' : ''}">${r.token}</td>
        <td class="col-status"${r.note ? ` title="${r.note}"` : ''}>${stTag(r.status)}${active.has(r.token) ? '<span class="dl-dot" title="下载中"></span>' : ''}</td>
        <td class="mono col-disk">${r.file_name ? '✓ ' + fmtMB(r.file_size) : '<span style="color:#5b6773">—</span>'}</td>
        <td class="mono col-first_seen">${(r.first_seen || '').slice(5, 16)}</td>
        <td class="col-actions">
          ${r.file_name
            ? `<button class="ghost rowbtn" data-play="${r.token}">播放</button>`
            : (active.has(r.token)
              ? `<button class="ghost rowbtn danger" data-dl-cancel="${r.token}" title="取消这一条下载">取消</button>`
              : `<button class="ghost rowbtn accent" data-dl="${r.token}" title="用内置下载器下载这一条">下载</button>`)}
          <button class="ghost rowbtn" data-reveal="${r.token}">定位</button>
          <button class="ghost rowbtn" data-copy="${r.url || ''}">复制</button>
        </td>
      </tr>`).join('');
  }

  document.querySelectorAll('th.sortable').forEach(th => {
    const isOn = th.dataset.key === state.SORT.key;
    th.classList.toggle('on', isOn);
    th.querySelector('.ar').textContent = isOn ? (state.SORT.dir === 'asc' ? '▲' : '▼') : '▲';
  });

  // 表格 / 画廊两种显示方式
  const galleryMode = state.VIEW === 'gallery';
  const tw = $('#tablewrap'), gal = $('#gallery');
  if (tw) tw.hidden = galleryMode;
  if (gal) {
    gal.hidden = !galleryMode;
    if (galleryMode) renderGallery(rows, active);
  }

  const from = all.length ? start + 1 : 0, to = Math.min(start + per, all.length);
  $('#pgInfo').textContent = `${from}-${to} / 共 ${all.length} 条 · 第 ${state.PAGE}/${pages} 页`;
  const nums = []; const win = 5;
  let a = Math.max(1, state.PAGE - 2), b = Math.min(pages, a + win - 1);
  a = Math.max(1, b - win + 1);
  if (a > 1) nums.push(`<button class="ghost pg" data-pg="1">1</button><span class="sub">…</span>`);
  for (let k = a; k <= b; k++) nums.push(`<button class="ghost pg ${k === state.PAGE ? 'on' : ''}" data-pg="${k}">${k}</button>`);
  if (b < pages) nums.push(`<span class="sub">…</span><button class="ghost pg" data-pg="${pages}">${pages}</button>`);
  $('#pgNums').innerHTML = nums.join('');
  $('#pgFirst').disabled = $('#pgPrev').disabled = state.PAGE <= 1;
  $('#pgNext').disabled = $('#pgLast').disabled = state.PAGE >= pages;
  $('#chkAll').checked = rows.length > 0 && rows.every(r => state.SEL.has(r.token));

  applyCols();
  renderSel();
  PREFS.page = state.PAGE;
  savePrefs();
}

export function renderSel() {
  const bar = $('#selbar');
  const n = state.SEL.size;
  bar.classList.toggle('on', n > 0);
  $('#selCount').textContent = `已选 ${n}`;
  const rows = state.ROWS.filter(r => state.SEL.has(r.token));
  const allFav = rows.length > 0 && rows.every(r => r.fav === '1');
  const allSeen = rows.length > 0 && rows.every(r => !!r.last_play);
  const favBtn = $('#selFavToggle'), watchBtn = $('#selWatchedToggle');
  favBtn.textContent = allFav ? '☆ 取消收藏' : '★ 收藏';
  watchBtn.textContent = allSeen ? '↺ 标记未看' : '✓ 标记已看';
  favBtn.dataset.on = allFav ? '1' : '';
  watchBtn.dataset.on = allSeen ? '1' : '';
  const ratings = rows.map(r => +r.rating || 0);
  const minR = ratings.length ? Math.min(...ratings) : 0;
  const same = ratings.length > 0 && ratings.every(v => v === minR);
  $('#selRate').innerHTML = starsInner(same ? minR : 0);
}

/* ---------- KPI 快捷筛选 ---------- */
const KPI_MAP = {
  kTotal: { status: 'all', flag: 'none' },
  kNew: { status: 'new', flag: 'none' },
  kDone: { status: 'done', flag: 'none' },
  kDisk: { status: 'all', flag: 'have' },
  kMiss: { status: 'all', flag: 'miss' },
  kFav: { status: 'all', flag: 'fav' },
  kWatch: { status: 'all', flag: 'towatch' },
  kToday: { status: 'all', flag: 'today' }
};

function kpiOf(card) { return KPI_MAP[card.dataset.kpi] || { status: 'all', flag: 'none' }; }

export function markActiveKpi() {
  const st = state.FILTER.status, fl = state.FILTER.flag;
  document.querySelectorAll('.kpi').forEach(c => {
    const m = kpiOf(c);
    c.classList.toggle('active', m.status === st && m.flag === fl);
  });
}

export function applyKpiFilter(entry) {
  state.FILTER.status = entry.status || 'all';
  state.FILTER.flag = entry.flag || 'none';
  state.PAGE = 1;
  PREFS.status = state.FILTER.status;
  PREFS.flag = state.FILTER.flag;
  savePrefs();
  $('#fStatus').value = state.FILTER.status;
  $('#fFlag').value = state.FILTER.flag;
  render();
  markActiveKpi();
  const sOpt = $('#fStatus').selectedOptions[0];
  const fOpt = $('#fFlag').selectedOptions[0];
  const parts = [];
  if (state.FILTER.status !== 'all') parts.push(sOpt ? sOpt.textContent : state.FILTER.status);
  if (state.FILTER.flag !== 'none') parts.push(fOpt ? fOpt.textContent : state.FILTER.flag);
  toast(parts.length ? `筛选：${parts.join(' + ')}` : '显示全部', 1800);
}

export function initTable() {
  initColResize();
  /* 表格 / 画廊切换 */
  document.querySelectorAll('#viewSeg button').forEach(b => {
    b.classList.toggle('on', b.dataset.view === state.VIEW);
    b.onclick = () => {
      state.VIEW = b.dataset.view;
      PREFS.view = state.VIEW; savePrefs();
      document.querySelectorAll('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.view === state.VIEW));
      render();
    };
  });
  /* 排序 */
  document.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (state.SORT.key === key) state.SORT.dir = state.SORT.dir === 'asc' ? 'desc' : 'asc';
    else { state.SORT.key = key; state.SORT.dir = (key === 'rank' || key === 'status' || key === 'token') ? 'asc' : 'desc'; }
    PREFS.sortKey = state.SORT.key; PREFS.sortDir = state.SORT.dir; savePrefs();
    render();
  }));

  /* 分页 */
  $('#pgSize').addEventListener('change', e => {
    state.PER = parseInt(e.target.value) || 0; state.PAGE = 1;
    PREFS.per = state.PER; savePrefs(); render();
  });
  $('#pgFirst').onclick = () => { state.PAGE = 1; render(); };
  $('#pgPrev').onclick = () => { state.PAGE = Math.max(1, state.PAGE - 1); render(); };
  $('#pgNext').onclick = () => { state.PAGE += 1; render(); };
  $('#pgLast').onclick = () => {
    const per = state.PER > 0 ? state.PER : 999999;
    state.PAGE = Math.max(1, Math.ceil(visible().length / per)); render();
  };
  $('#pgNums').addEventListener('click', e => {
    const b = e.target.closest('button[data-pg]');
    if (b) { state.PAGE = parseInt(b.dataset.pg); render(); }
  });

  /* 筛选 */
  $('#q').addEventListener('input', e => {
    state.FILTER.q = e.target.value.trim(); state.PAGE = 1;
    PREFS.q = state.FILTER.q; savePrefs(); render();
  });
  $('#fStatus').addEventListener('change', e => {
    state.FILTER.status = e.target.value; state.PAGE = 1;
    PREFS.status = state.FILTER.status; savePrefs(); render(); markActiveKpi();
  });
  $('#fSource').addEventListener('change', e => {
    state.FILTER.source = e.target.value; state.PAGE = 1;
    PREFS.source = state.FILTER.source; savePrefs(); render();
  });
  $('#fFlag').addEventListener('change', e => {
    state.FILTER.flag = e.target.value; state.PAGE = 1;
    PREFS.flag = state.FILTER.flag; savePrefs(); render(); markActiveKpi();
  });
  $('#fRes').addEventListener('change', e => {
    state.FILTER.res = e.target.value; state.PAGE = 1;
    PREFS.res = state.FILTER.res; savePrefs(); render();
  });
  $('#fMinDur').addEventListener('input', e => {
    state.FILTER.minDur = e.target.value; state.PAGE = 1;
    PREFS.minDur = state.FILTER.minDur; savePrefs(); render();
  });
  $('#fSortQuick').addEventListener('change', e => {
    const v = e.target.value; if (!v) return;
    state.SORT.key = v; state.SORT.dir = 'desc';
    PREFS.sortKey = v; PREFS.sortDir = 'desc'; savePrefs();
    e.target.value = ''; render();
  });
  $('#btnReset').onclick = () => {
    state.FILTER = { status: 'all', source: 'all', flag: 'none', res: 'all', minDur: '', q: '' };
    state.SORT = { key: 'rank', dir: 'asc' };
    state.PAGE = 1; state.PER = 50; state.SEL.clear();
    Object.assign(PREFS, { status: 'all', source: 'all', flag: 'none', res: 'all', minDur: '', q: '', sortKey: 'rank', sortDir: 'asc', per: 50 });
    savePrefs();
    $('#q').value = ''; $('#fStatus').value = 'all'; $('#fFlag').value = 'none'; $('#fRes').value = 'all';
    $('#fMinDur').value = ''; $('#pgSize').value = '50';
    render(); markActiveKpi('all');
  };
  $('#chkCovers').addEventListener('change', e => {
    state.SHOW_COVERS = e.target.checked; PREFS.covers = state.SHOW_COVERS; savePrefs(); render();
  });
  $('#chkCompact').addEventListener('change', e => {
    document.body.classList.toggle('compact', e.target.checked);
    PREFS.compact = e.target.checked; savePrefs();
  });

  /* KPI 卡片 */
  document.querySelectorAll('.kpi').forEach(card => {
    const vid = (card.querySelector('.v') || {}).id;
    if (!vid) return;
    card.dataset.kpi = vid;
    const hint = { kHours: '点击按时长从长到短排序', kTotal: '点击显示全部' }[vid];
    if (hint) card.title = hint;
    card.addEventListener('click', () => {
      if (vid === 'kHours') {
        state.SORT = { key: 'duration', dir: 'desc' };
        Object.assign(PREFS, { sortKey: 'duration', sortDir: 'desc', status: 'all', flag: 'none' });
        state.PAGE = 1; state.FILTER = { status: 'all', flag: 'none', res: state.FILTER.res, minDur: state.FILTER.minDur, q: state.FILTER.q }; $('#fStatus').value = 'all'; $('#fFlag').value = 'none'; savePrefs();
        render(); markActiveKpi('all');
        toast('按时长从长到短排序', 1800);
        return;
      }
      applyKpiFilter(kpiOf(card));
    });
  });

  /* 列显隐 */
  $('#btnCols').onclick = e => {
    e.stopPropagation();
    $('#colpop').innerHTML = COLS.map(c =>
      `<label><input type="checkbox" data-col="${c.key}" ${PREFS.cols[c.key] === false ? '' : 'checked'}> ${c.label}</label>`).join('')
      + `<div style="height:1px;background:#262f3a;margin:6px 4px"></div>
         <label><input type="checkbox" id="colAll" ${COLS.every(c => PREFS.cols[c.key] !== false) ? 'checked' : ''}> 全显</label>`;
    $('#colpop').classList.toggle('on');
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#colpop') && e.target.id !== 'btnCols') $('#colpop').classList.remove('on');
  });
  $('#colpop').addEventListener('change', e => {
    if (e.target.id === 'colAll') COLS.forEach(c => PREFS.cols[c.key] = e.target.checked);
    else if (e.target.dataset.col) PREFS.cols[e.target.dataset.col] = e.target.checked;
    savePrefs(); applyCols();
  });

  /* 状态变化时自动重绘 */
  onEvent('render', render);
}
