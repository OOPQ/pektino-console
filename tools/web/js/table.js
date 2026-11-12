/* table.js — 过滤 / 排序 / 分页 / 表格渲染 / 列显隐 / KPI 快捷筛选 */
import { $, PREFS, savePrefs, state, onEvent, toast, stTag, fmtMB, starsHtml, starsInner } from './core.js';

export const COLS = [
  { key: 'cover', label: '封面' }, { key: 'rank', label: '排名' }, { key: 'duration', label: '时长' },
  { key: 'res', label: '分辨率' }, { key: 'views', label: '站点观看' }, { key: 'likes', label: '点赞' },
  { key: 'plays', label: '本地播放' }, { key: 'rating', label: '评分' }, { key: 'token', label: 'token' },
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
  const st = state.FILTER.status;
  if (st === 'have' && !r.file_name) return false;
  if (st === 'miss' && r.file_name) return false;
  if (st === 'fav' && r.fav !== '1') return false;
  if (st === 'towatch' && (!r.file_name || r.last_play)) return false;
  if (st === 'watched' && !r.last_play) return false;
  if (st === 'rated' && !(+r.rating > 0)) return false;
  if (st === 'unrated' && (+r.rating > 0)) return false;
  if (st === 'top' && !(+r.rating >= 4)) return false;
  if (st === 'today') {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if ((r.first_seen || '').slice(0, 10) !== iso) return false;
  }
  if (['new', 'sent', 'done', 'ignored'].includes(st) && r.status !== st) return false;
  if (state.FILTER.res !== 'all') {
    const w = parseInt((r.res || '').split('x')[0]) || 0;
    const h = parseInt((r.res || '').split('x')[1]) || 0;
    if (state.FILTER.res === 'portrait') { if (h <= w) return false; }
    else { const need = RES_RANK[state.FILTER.res]; if (w < need && h < need) return false; }
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
  rank: r => (+r.rank || 999999),
  duration: r => (+r.seconds || 0),
  res: r => { const m = (r.res || '').split('x'); return m.length === 2 ? (+m[0]) * (+m[1]) : 0; },
  views: r => (+r.views || 0),
  likes: r => (+r.likes || 0),
  plays: r => (+r.play_count || 0),
  rating: r => (+r.rating || 0),
  token: r => (r.token || ''),
  status: r => ['new', 'sent', 'done', 'ignored'].indexOf(r.status),
  disk: r => (+r.file_size || 0),
  first_seen: r => (r.first_seen || '')
};

export function visible() {
  const f = SORTS[state.SORT.key] || SORTS.rank;
  const d = state.SORT.dir === 'asc' ? 1 : -1;
  return state.ROWS.filter(passFilter).slice().sort((a, b) => {
    const va = f(a), vb = f(b);
    return va < vb ? -d : va > vb ? d : 0;
  });
}

/* ---------- 单元格 ---------- */
function coverCell(r) {
  if (!state.SHOW_COVERS) return '<div class="covbox"><div class="ph"></div></div>';
  const u = '/api/cover?token=' + encodeURIComponent(r.token);
  return `<div class="covbox" data-lb="${r.token}" title="点击放大"><img src="${u}" loading="lazy" alt=""></div>`;
}
function rateCell(r) {
  return starsHtml(r.rating, { token: r.token });
}

/* ---------- 渲染 ---------- */
export function render() {
  const all = visible();
  const per = state.PER > 0 ? state.PER : all.length || 1;
  const pages = Math.max(1, Math.ceil(all.length / per));
  state.PAGE = Math.min(Math.max(1, state.PAGE), pages);
  const start = (state.PAGE - 1) * per;
  const rows = all.slice(start, start + per);

  const tb = $('#tbody');
  if (!all.length) {
    tb.innerHTML = '<tr><td colspan="15" class="empty">没有匹配的条目 —— 换个筛选条件，或点「抓取并入库」</td></tr>';
  } else {
    tb.innerHTML = rows.map((r, i) => `
      <tr data-row="${r.token}">
        <td><input type="checkbox" data-tk="${r.token}" data-idx="${start + i}" ${state.SEL.has(r.token) ? 'checked' : ''}></td>
        <td><button class="star ${r.fav === '1' ? 'on' : ''}" data-fav="${r.token}" title="收藏/取消">${r.fav === '1' ? '★' : '☆'}</button></td>
        <td class="col-cover">${coverCell(r)}</td>
        <td class="num col-rank">${r.rank || ''}</td>
        <td class="num col-duration">${r.duration || ''}</td>
        <td class="mono col-res">${r.res || ''}</td>
        <td class="num col-views">${r.views || ''}</td>
        <td class="num col-likes">${r.likes || ''}</td>
        <td class="num col-plays" title="${r.last_play ? '上次播放 ' + r.last_play : '还没播过'}">${(+r.play_count || 0) > 0 ? '▶' + r.play_count : ''}</td>
        <td class="col-rating">${rateCell(r)}</td>
        <td class="mono playable col-token" data-play="${r.token}" title="${r.file_name || '点击播放'}">${r.token}</td>
        <td class="col-status">${stTag(r.status)}</td>
        <td class="mono col-disk">${r.file_name ? '✓ ' + fmtMB(r.file_size) : '<span style="color:#5b6773">—</span>'}</td>
        <td class="mono col-first_seen">${(r.first_seen || '').slice(5, 16)}</td>
        <td>
          ${r.file_name
            ? `<button class="ghost rowbtn" data-play="${r.token}">播放</button>`
            : `<button class="ghost rowbtn" data-dl="${r.token}" title="用内置下载器下载这一条">下载</button>`}
          <button class="ghost rowbtn" data-reveal="${r.token}">定位</button>
          <button class="ghost rowbtn" data-copy="${r.url || ''}">复制</button>
          <button class="ghost rowbtn" data-th="${r.url || ''}">thunder</button>
        </td>
      </tr>`).join('');
  }

  document.querySelectorAll('th.sortable').forEach(th => {
    const isOn = th.dataset.key === state.SORT.key;
    th.classList.toggle('on', isOn);
    th.querySelector('.ar').textContent = isOn ? (state.SORT.dir === 'asc' ? '▲' : '▼') : '▲';
  });

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
  kTotal: 'all', kNew: 'new', kSent: 'sent', kDone: 'done',
  kDisk: 'have', kMiss: 'miss', kFav: 'fav', kWatch: 'towatch', kToday: 'today'
};
export function markActiveKpi(f) {
  document.querySelectorAll('.kpi').forEach(c => c.classList.toggle('active', KPI_MAP[c.dataset.kpi] === f));
}
export function applyKpiFilter(f) {
  state.FILTER.status = f; state.PAGE = 1;
  PREFS.status = f; savePrefs();
  $('#fStatus').value = f;
  render();
  markActiveKpi(f);
  const opt = $('#fStatus').selectedOptions[0];
  toast(f === 'all' ? '显示全部' : `筛选：${opt ? opt.textContent : f}`, 1800);
}

export function initTable() {
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
    PREFS.status = state.FILTER.status; savePrefs(); render(); markActiveKpi(state.FILTER.status);
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
    state.FILTER = { status: 'all', res: 'all', minDur: '', q: '' };
    state.SORT = { key: 'rank', dir: 'asc' };
    state.PAGE = 1; state.PER = 50; state.SEL.clear();
    Object.assign(PREFS, { status: 'all', res: 'all', minDur: '', q: '', sortKey: 'rank', sortDir: 'asc', per: 50 });
    savePrefs();
    $('#q').value = ''; $('#fStatus').value = 'all'; $('#fRes').value = 'all';
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
        Object.assign(PREFS, { sortKey: 'duration', sortDir: 'desc', status: 'all' });
        state.PAGE = 1; state.FILTER.status = 'all'; $('#fStatus').value = 'all'; savePrefs();
        render(); markActiveKpi('all');
        toast('按时长从长到短排序', 1800);
        return;
      }
      applyKpiFilter(KPI_MAP[vid] || 'all');
    });
  });

  /* 列显隐 */
  $('#btnCols').onclick = e => {
    e.stopPropagation();
    $('#colpop').innerHTML = COLS.map(c =>
      `<label><input type="checkbox" data-col="${c.key}" ${PREFS.cols[c.key] === false ? '' : 'checked'}> ${c.label}</label>`).join('')
      + `<div style="height:1px;background:#262f3a;margin:6px 4px"></div>
         <label><input type="checkbox" id="colAll" checked> 全显</label>`;
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
