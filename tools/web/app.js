/* ============================================================
   pektino 控制台前端
   数据流：SSE 推 rev → 拉 /api/state → 本地过滤/排序/分页渲染
   注意：本文件是 UTF-8（无 BOM），不要用 PowerShell 的
   Get-Content/Set-Content 直接回写，会按 ANSI 解码导致中文损坏。
   ============================================================ */
const $ = s => document.querySelector(s);
const KEY = 'pektino.ui.v3';

const PREFS = Object.assign({
  sortKey: 'rank', sortDir: 'asc', per: 50, covers: true, compact: false,
  page: 1, status: 'all', res: 'all', minDur: '', q: '',
  cols: { cover: true, rank: true, duration: true, res: true, views: true, likes: true, plays: true, rating: true, token: true, status: true, disk: true, first_seen: true }
}, JSON.parse(localStorage.getItem(KEY) || '{}'));
if (!PREFS.cols) PREFS.cols = {};
const savePrefs = () => localStorage.setItem(KEY, JSON.stringify(PREFS));

const COLS = [
  { key: 'cover', label: '封面' }, { key: 'rank', label: '排名' }, { key: 'duration', label: '时长' },
  { key: 'res', label: '分辨率' }, { key: 'views', label: '站点观看' }, { key: 'likes', label: '点赞' },
  { key: 'plays', label: '本地播放' }, { key: 'rating', label: '评分' }, { key: 'token', label: 'token' },
  { key: 'status', label: '状态' }, { key: 'disk', label: '磁盘' }, { key: 'first_seen', label: '入库时间' }
];
function applyCols() {
  COLS.forEach(c => {
    const hide = PREFS.cols[c.key] === false;
    document.querySelectorAll('.col-' + c.key).forEach(el => el.classList.toggle('hidecol', hide));
  });
}

let ROWS = [], STATS = {}, SEL = new Set(), BUSY = false, LB_TOKEN = null, GACHA_TOKEN = null;
let SORT = { key: PREFS.sortKey, dir: PREFS.sortDir };
let PAGE = PREFS.page, PER = PREFS.per;
let SHOW_COVERS = PREFS.covers;
let FILTER = { status: PREFS.status, res: PREFS.res, minDur: PREFS.minDur, q: PREFS.q };
const STATUS_LABEL = { new: '待下载', sent: '已投递', done: '已完成', ignored: '忽略' };

/* ---------------- 基础工具 ---------------- */
function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
const thunder = url => 'thunder://' + btoa('AA' + url + 'ZZ');
const stTag = s => `<span class="tag ${s}">${STATUS_LABEL[s] || s}</span>`;
const fmtMB = n => n ? (n / 1048576).toFixed(1) + ' MB' : '';
const fmtNum = n => (n === '' || n == null) ? '–' : Number(n).toLocaleString('en-US');
function setBusy(on, text) {
  BUSY = on;
  $('#busy').textContent = on ? (text || '处理中…') : '';
  document.querySelectorAll('button').forEach(b => b.disabled = on);
  if (!on) render();
}

/* ---------------- 前端上报 ---------------- */
const REPORT_LAST = {};
function report(level, msg, extra = {}) {
  const key = level + '|' + msg;
  const now = Date.now();
  if (REPORT_LAST[key] && now - REPORT_LAST[key] < 5000) return;
  REPORT_LAST[key] = now;
  try {
    fetch('/api/log', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ level, msg, url: location.pathname }, extra))
    }).catch(() => { });
  } catch (e) { }
}
window.addEventListener('error', e => {
  report('error', e.message || 'js error', {
    stack: ((e.error && e.error.stack) || (e.filename + ':' + e.lineno + ':' + e.colno)).slice(0, 1200)
  });
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason || {};
  report('error', 'unhandledrejection: ' + (r.message || r), { stack: String(r.stack || '').slice(0, 1200) });
});

async function api(path, body) {
  const opt = body === undefined ? {} :
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const t0 = performance.now();
  try {
    const r = await fetch(path, opt);
    const ms = Math.round(performance.now() - t0);
    if (ms > 1000) report('warn', `慢请求 ${path} ${ms}ms`, { url: path, ms });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data && data.ok === false && data.error) report('warn', `接口返回失败 ${path}: ${data.error}`, { url: path, ms });
    return data;
  } catch (e) {
    report('error', `请求失败 ${path}: ${e.message}`, { url: path, ms: Math.round(performance.now() - t0) });
    throw e;
  }
}

/* ---------------- 加载 ---------------- */
async function load() {
  if (location.protocol === 'file:') $('#banner').style.display = 'block';
  try {
    const s = await api('/api/state');
    STATS = s.stats || {}; ROWS = s.rows || [];
    $('#dot').classList.remove('off');
    $('#sub').textContent = `在线 · ${STATS.total} 条 · 待下载 ${STATS.new}`;
    $('#kTotal').textContent = STATS.total;
    $('#kNew').textContent = STATS.new;
    $('#kSent').textContent = STATS.sent;
    $('#kDone').textContent = STATS.done;
    $('#kDisk').textContent = STATS.downloaded;
    $('#kMiss').textContent = STATS.missing;
    $('#kFav').textContent = STATS.favorites || 0;
    $('#kWatch').textContent = STATS.toWatch != null ? STATS.toWatch : '–';
    $('#kHours').textContent = STATS.hours;
    $('#kToday').textContent = STATS.todayAdded;

    if (!$('#dirInput').value) $('#dirInput').value = STATS.downloadDir || '';
    $('#dirInfo').textContent =
      `${STATS.dirExists ? '目录 OK' : '目录不存在'} · mp4 ${STATS.fileCount} 个 / ${STATS.dirGB} GB · 下载中 ${STATS.partialCount} · 命中 ${STATS.downloaded} 条 · 扫描于 ${(STATS.lastScan || '').slice(11)}`;

    const m = s.metrics || {};
    if (m.total) {
      $('#metricsBox').textContent =
        `请求 ${m.total} 次 · 平均 ${m.avgMs}ms · 最慢 ${m.maxMs}ms（${m.maxPath || '–'}）· 运行 ${m.uptime} 分钟 · 前端告警 ${m.clientWarns || 0} 条`;
      $('#slowList').innerHTML = (m.slow || []).length
        ? (m.slow || []).map(x => `<div><span class="t">${x.t}</span> ${x.path} · ${x.ms}ms</div>`).join('')
        : '<div>没有慢请求（≥800ms）</div>';
      $('#errList').innerHTML = (m.clientErrors || []).length
        ? (m.clientErrors || []).map(x => `<div><span class="t">${x.t}</span> ${x.msg}${x.url ? ' · ' + x.url : ''}</div>`).join('')
        : '<div>没有前端错误</div>';
    }

    const orph = STATS.orphans || [];
    $('#orphanInfo').textContent = orph.length ? `共 ${STATS.orphanCount} 个（目录里有、台账里没有）` : '没有孤立文件';
    $('#orphanList').innerHTML = orph.slice(0, 20).map(o =>
      `<div><span class="mono">${o.name}</span> · ${(o.size / 1048576).toFixed(1)} MB</div>`).join('');

    $('#logbox').innerHTML = (s.log || []).slice().reverse()
      .map(l => `<div><span class="t">${l.time}</span> [${l.kind}] ${l.message}</div>`).join('') || '<div>暂无日志</div>';
    $('#diag').textContent = `自检：前端 OK · API OK · 渲染 ${ROWS.length} 行 · 磁盘命中 ${STATS.downloaded}`;

    renderJob(s.job || {});
    render();
    markActiveKpi(FILTER.status);
    if (s.job && s.job.running) { clearTimeout(load._t); load._t = setTimeout(load, 1200); }
  } catch (e) {
    $('#dot').classList.add('off');
    $('#sub').textContent = '服务未连接 —— 先运行 启动控制台.cmd';
    $('#diag').textContent = `自检：前端 OK · API 失败（${e.message}）`;
  }
}

function renderJob(job) {
  const el = $('#prog');
  if (!job.running) { el.classList.remove('on'); return; }
  const p = job.progress || {};
  el.classList.add('on');
  const total = p.total || 0, done = p.done || 0, pct = total ? Math.round(100 * done / total) : 0;
  const phaseMap = { covers: '下载封面', details: '解析详情', list: '读取榜单', scan: '扫描文件', resolve: '核对详情', done: '收尾' };
  $('#progLabel').textContent = job.rank === 'import' ? '本地入库中' : `抓取中 · ${job.rank} p${(job.pages || []).join(',')}`;
  $('#progBar').style.width = pct + '%';
  $('#progStat').textContent = `${phaseMap[p.phase] || '准备'} ${done}/${total} · ${p.speed || 0}/s · ${job.elapsed}s`;
}

/* ---------------- 过滤 / 排序 ---------------- */
const RES_RANK = { '4k': 2160, '1080': 1080, '720': 720 };
function passFilter(r) {
  const st = FILTER.status;
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
  if (FILTER.res !== 'all') {
    const w = parseInt((r.res || '').split('x')[0]) || 0;
    const h = parseInt((r.res || '').split('x')[1]) || 0;
    if (FILTER.res === 'portrait') { if (h <= w) return false; }
    else { const need = RES_RANK[FILTER.res]; if (w < need && h < need) return false; }
  }
  if (FILTER.minDur) {
    const min = parseFloat(FILTER.minDur);
    if (min > 0 && (parseInt(r.seconds) || 0) < min * 60) return false;
  }
  if (FILTER.q) {
    const t = FILTER.q.toLowerCase();
    if (!((r.token + ' ' + r.res + ' ' + r.duration).toLowerCase().includes(t))) return false;
  }
  return true;
}
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
function sortRows(list) {
  const f = SORTS[SORT.key] || SORTS.rank, d = SORT.dir === 'asc' ? 1 : -1;
  return list.slice().sort((a, b) => {
    const va = f(a), vb = f(b);
    return va < vb ? -d : va > vb ? d : 0;
  });
}
const visible = () => sortRows(ROWS.filter(passFilter));

/* ---------------- 渲染 ---------------- */
function coverCell(r) {
  if (!SHOW_COVERS) return '<div class="covbox"><div class="ph"></div></div>';
  const u = '/api/cover?token=' + encodeURIComponent(r.token);
  return `<div class="covbox" data-lb="${r.token}" title="点击放大"><img src="${u}" loading="lazy" alt=""></div>`;
}
function rateCell(r) {
  const v = +r.rating || 0;
  const stars = [1, 2, 3, 4, 5].map(n => `<i class="${n <= v ? 'on' : ''}" data-v="${n}">★</i>`).join('');
  return `<span class="rt" data-rate="${r.token}">${stars}</span>`;
}

function render() {
  const all = visible();
  const per = PER > 0 ? PER : all.length || 1;
  const pages = Math.max(1, Math.ceil(all.length / per));
  PAGE = Math.min(Math.max(1, PAGE), pages);
  const start = (PAGE - 1) * per;
  const rows = all.slice(start, start + per);

  const tb = $('#tbody');
  if (!all.length) {
    tb.innerHTML = '<tr><td colspan="15" class="empty">没有匹配的条目 —— 换个筛选条件，或点「抓取并入库」</td></tr>';
  } else {
    tb.innerHTML = rows.map((r, i) => `
      <tr data-row="${r.token}">
        <td><input type="checkbox" data-tk="${r.token}" data-idx="${start + i}" ${SEL.has(r.token) ? 'checked' : ''}></td>
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
          <button class="ghost rowbtn" data-play="${r.token}">播放</button>
          <button class="ghost rowbtn" data-reveal="${r.token}">定位</button>
          <button class="ghost rowbtn" data-copy="${r.url || ''}">复制</button>
          <button class="ghost rowbtn" data-th="${r.url || ''}">thunder</button>
        </td>
      </tr>`).join('');
  }

  document.querySelectorAll('th.sortable').forEach(th => {
    const on = th.dataset.key === SORT.key;
    th.classList.toggle('on', on);
    th.querySelector('.ar').textContent = on ? (SORT.dir === 'asc' ? '▲' : '▼') : '▲';
  });

  const from = all.length ? start + 1 : 0, to = Math.min(start + per, all.length);
  $('#pgInfo').textContent = `${from}-${to} / 共 ${all.length} 条 · 第 ${PAGE}/${pages} 页`;
  const nums = []; const win = 5;
  let a = Math.max(1, PAGE - 2), b = Math.min(pages, a + win - 1); a = Math.max(1, b - win + 1);
  if (a > 1) nums.push(`<button class="ghost pg" data-pg="1">1</button><span class="sub">…</span>`);
  for (let k = a; k <= b; k++) nums.push(`<button class="ghost pg ${k === PAGE ? 'on' : ''}" data-pg="${k}">${k}</button>`);
  if (b < pages) nums.push(`<span class="sub">…</span><button class="ghost pg" data-pg="${pages}">${pages}</button>`);
  $('#pgNums').innerHTML = nums.join('');
  $('#pgFirst').disabled = $('#pgPrev').disabled = PAGE <= 1;
  $('#pgNext').disabled = $('#pgLast').disabled = PAGE >= pages;
  $('#chkAll').checked = rows.length > 0 && rows.every(r => SEL.has(r.token));

  applyCols();
  renderSel();
  PREFS.page = PAGE; savePrefs();
}

function renderSel() {
  const bar = $('#selbar');
  bar.classList.toggle('on', SEL.size > 0);
  $('#selCount').textContent = `已选 ${SEL.size}`;
  const rows = ROWS.filter(r => SEL.has(r.token));
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
  $('#selRate').innerHTML = [1, 2, 3, 4, 5]
    .map(n => `<i class="${same && n <= minR ? 'on' : ''}" data-v="${n}">★</i>`).join('');
}

/* ---------------- 选中（Shift 范围） ---------------- */
let LAST_IDX = null, SHIFT_DOWN = false;
function handleSelect(cb, shift) {
  const tk = cb.dataset.tk, idx = parseInt(cb.dataset.idx);
  if (shift && LAST_IDX !== null && !isNaN(idx)) {
    const lo = Math.min(LAST_IDX, idx), hi = Math.max(LAST_IDX, idx);
    const all = visible();
    for (let k = lo; k <= hi; k++) {
      const r = all[k]; if (!r) continue;
      cb.checked ? SEL.add(r.token) : SEL.delete(r.token);
    }
  } else {
    cb.checked ? SEL.add(tk) : SEL.delete(tk);
  }
  LAST_IDX = isNaN(idx) ? null : idx;
  document.querySelectorAll('#tbody input[type=checkbox]').forEach(box => { box.checked = SEL.has(box.dataset.tk); });
  const boxes = [...document.querySelectorAll('#tbody input[type=checkbox]')];
  $('#chkAll').checked = boxes.length > 0 && boxes.every(b => b.checked);
  renderSel();
}
$('#tbody').addEventListener('mousedown', e => { if (e.target.matches('input[type=checkbox]')) SHIFT_DOWN = e.shiftKey; });
$('#tbody').addEventListener('change', e => {
  if (e.target.matches('input[type=checkbox]')) { handleSelect(e.target, SHIFT_DOWN); SHIFT_DOWN = false; }
});
$('#chkAll').addEventListener('change', e => {
  const per = PER > 0 ? PER : 999999;
  visible().slice((PAGE - 1) * per, PAGE * per).forEach(r => e.target.checked ? SEL.add(r.token) : SEL.delete(r.token));
  render();
});
$('#selClear').onclick = () => { SEL.clear(); render(); };

/* ---------------- 行内点击 ---------------- */
$('#tbody').addEventListener('click', async e => {
  const star = e.target.closest('.rt i');
  if (star) {
    const tk = star.closest('.rt').dataset.rate;
    const row = ROWS.find(r => r.token === tk);
    const v = parseInt(star.dataset.v);
    const val = (row && (+row.rating || 0) === v) ? 0 : v;
    try {
      const res = await api('/api/rate', { tokens: [tk], value: val });
      if (res.ok && row) { row.rating = val ? String(val) : ''; render(); toast(val ? `已打 ${val} 星` : '已清除评分'); }
    } catch (err) { toast('打分失败'); }
    return;
  }
  if (e.target.closest('input[type=checkbox]')) return;

  const fav = e.target.closest('[data-fav]');
  if (fav) {
    const tk = fav.dataset.fav, row = ROWS.find(r => r.token === tk), on = !(row && row.fav === '1');
    try {
      const r = await api('/api/fav', { tokens: [tk], on });
      if (r.ok && row) {
        row.fav = on ? '1' : '';
        STATS.favorites = Math.max(0, (STATS.favorites || 0) + (on ? 1 : -1));
        $('#kFav').textContent = STATS.favorites;
      }
      render();
    } catch (err) { toast('收藏失败：' + err.message); }
    return;
  }
  const lb = e.target.closest('[data-lb]');
  if (lb) { openLightbox(lb.dataset.lb); return; }

  const play = e.target.closest('[data-play]');
  if (play) { doPlay(play.dataset.play); return; }

  const rev = e.target.closest('[data-reveal]');
  if (rev) {
    try { const r = await api('/api/reveal', { token: rev.dataset.reveal }); if (!r.ok) toast(r.error); }
    catch (err) { toast('定位失败'); }
    return;
  }
  if (e.target.dataset.copy !== undefined) { await navigator.clipboard.writeText(e.target.dataset.copy); toast('URL 已复制'); }
  else if (e.target.dataset.th !== undefined) { await navigator.clipboard.writeText(thunder(e.target.dataset.th)); toast('thunder:// 已复制'); }
});

async function doPlay(tk) {
  const row = ROWS.find(r => r.token === tk);
  if (!row || !row.file_name) return toast('本地还没有这个文件，先下载');
  try {
    const r = await api('/api/play', { token: tk });
    if (r.ok) {
      row.play_count = r.plays || String((+row.play_count || 0) + 1);
      row.last_play = r.last_play || row.last_play;
      render();
      toast('已调用播放器：' + r.name, 2200);
    } else toast('播放失败：' + r.error, 4000);
  } catch (e) { toast('播放失败：' + e.message); }
}

/* ---------------- 灯箱 ---------------- */
function metaRows(r, withRating = true) {
  return `<div class="mhead"><b>${r.duration || '–'}</b><i>${r.res || '–'}</i></div>
    <div class="mrow"><span>站点观看</span><em>${fmtNum(r.views)}</em></div>
    <div class="mrow"><span>点赞</span><em>${fmtNum(r.likes)}</em></div>
    <div class="mrow"><span>状态</span><em>${stTag(r.status)}</em></div>
    <div class="mrow"><span>本地文件</span><em>${r.file_name ? '✓ ' + fmtMB(r.file_size) : '<span style="color:#7f8ea1">未下载</span>'}</em></div>
    ${withRating ? `<div class="mrow"><span>评分</span><em class="gold">${[1, 2, 3, 4, 5].map(n => n <= (+r.rating || 0) ? '★' : '☆').join('')}</em></div>` : ''}
    <div class="mrow"><span>本地播放</span><em>${(+r.play_count || 0) ? '▶ ' + r.play_count + ' 次' : '无记录'}</em></div>
    ${r.file_name ? `<div class="mfile">${r.file_name}</div>` : ''}`;
}

/* 按图片实际比例决定展示尺寸：竖图不顶满屏幕、横图不缩成小方块 */
const META_W = 280, GAP = 18;
function fitLightbox(img) {
  const box = document.querySelector('#lightbox .box');
  if (!box || !img.naturalWidth) return;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const maxH = Math.min(innerHeight * 0.78, 920);          // 上下各留一点，不顶满
  const maxImgW = Math.min(innerWidth * 0.94 - META_W - GAP - 24, 900);
  const scale = Math.min(maxH / nh, maxImgW / nw, 1);       // 不放大，避免糊
  const w = Math.max(160, Math.round(nw * scale));
  const h = Math.max(160, Math.round(nh * scale));
  img.style.width = w + 'px';
  img.style.height = h + 'px';
  box.style.width = (w + META_W + GAP) + 'px';
}
function openLightbox(tk) {
  const r = ROWS.find(x => x.token === tk);
  if (!r) return;
  LB_TOKEN = tk;
  const img = $('#lbImg');
  img.style.width = ''; img.style.height = '';
  document.querySelector('#lightbox .box').style.width = '';
  img.onload = () => fitLightbox(img);
  img.onerror = () => { img.onload = null; img.src = '/api/cover?token=' + encodeURIComponent(tk); };
  img.src = '/api/cover?token=' + encodeURIComponent(tk) + '&full=1';
  if (img.complete && img.naturalWidth) fitLightbox(img);
  $('#lbToken').textContent = tk;
  $('#lbMeta').innerHTML = metaRows(r);
  $('#lbFav').textContent = (r.fav === '1' ? '★ 已收藏' : '☆ 收藏');
  $('#lightbox').classList.add('on');
}
const closeLightbox = () => { $('#lightbox').classList.remove('on'); LB_TOKEN = null; };
window.addEventListener('resize', () => { if ($('#lightbox').classList.contains('on')) fitLightbox($('#lbImg')); });
$('#lbClose').onclick = closeLightbox;
$('#lightbox').onclick = e => { if (e.target.id === 'lightbox') closeLightbox(); };
$('#lbPlay').onclick = () => LB_TOKEN && doPlay(LB_TOKEN);
$('#lbReveal').onclick = async () => { try { await api('/api/reveal', { token: LB_TOKEN }); } catch (e) { } };
$('#lbCopy').onclick = async () => {
  const r = ROWS.find(x => x.token === LB_TOKEN);
  if (r && r.url) { await navigator.clipboard.writeText(r.url); toast('URL 已复制'); }
};
$('#lbFav').onclick = async () => {
  const row = ROWS.find(x => x.token === LB_TOKEN);
  if (!row) return;
  const on = row.fav !== '1';
  try {
    const res = await api('/api/fav', { tokens: [row.token], on });
    if (res.ok) { row.fav = on ? '1' : ''; $('#lbFav').textContent = on ? '★ 已收藏' : '☆ 收藏'; render(); }
  } catch (e) { toast('收藏失败'); }
};

/* ---------------- 排序 / 分页 / 筛选 ---------------- */
document.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.key;
  if (SORT.key === key) SORT.dir = SORT.dir === 'asc' ? 'desc' : 'asc';
  else { SORT.key = key; SORT.dir = (key === 'rank' || key === 'status' || key === 'token') ? 'asc' : 'desc'; }
  PREFS.sortKey = SORT.key; PREFS.sortDir = SORT.dir; savePrefs(); render();
}));
$('#pgSize').addEventListener('change', e => { PER = parseInt(e.target.value) || 0; PAGE = 1; PREFS.per = PER; savePrefs(); render(); });
$('#pgFirst').onclick = () => { PAGE = 1; render(); };
$('#pgPrev').onclick = () => { PAGE = Math.max(1, PAGE - 1); render(); };
$('#pgNext').onclick = () => { PAGE += 1; render(); };
$('#pgLast').onclick = () => { const per = PER > 0 ? PER : 999999; PAGE = Math.max(1, Math.ceil(visible().length / per)); render(); };
$('#pgNums').addEventListener('click', e => { const b = e.target.closest('button[data-pg]'); if (b) { PAGE = parseInt(b.dataset.pg); render(); } });

$('#q').addEventListener('input', e => { FILTER.q = e.target.value.trim(); PAGE = 1; PREFS.q = FILTER.q; savePrefs(); render(); });
$('#fStatus').addEventListener('change', e => { FILTER.status = e.target.value; PAGE = 1; PREFS.status = FILTER.status; savePrefs(); render(); markActiveKpi(FILTER.status); });
$('#fRes').addEventListener('change', e => { FILTER.res = e.target.value; PAGE = 1; PREFS.res = FILTER.res; savePrefs(); render(); });
$('#fMinDur').addEventListener('input', e => { FILTER.minDur = e.target.value; PAGE = 1; PREFS.minDur = FILTER.minDur; savePrefs(); render(); });
$('#fSortQuick').addEventListener('change', e => {
  const v = e.target.value; if (!v) return;
  SORT.key = v; SORT.dir = 'desc'; PREFS.sortKey = v; PREFS.sortDir = 'desc'; savePrefs();
  e.target.value = ''; render();
});
$('#btnReset').onclick = () => {
  FILTER = { status: 'all', res: 'all', minDur: '', q: '' };
  SORT = { key: 'rank', dir: 'asc' };
  PAGE = 1; PER = 50; SEL.clear();
  Object.assign(PREFS, { status: 'all', res: 'all', minDur: '', q: '', sortKey: 'rank', sortDir: 'asc', per: 50 });
  savePrefs();
  $('#q').value = ''; $('#fStatus').value = 'all'; $('#fRes').value = 'all'; $('#fMinDur').value = ''; $('#pgSize').value = '50';
  render(); markActiveKpi('all');
};
$('#chkCovers').addEventListener('change', e => { SHOW_COVERS = e.target.checked; PREFS.covers = SHOW_COVERS; savePrefs(); render(); });
$('#chkCompact').addEventListener('change', e => { document.body.classList.toggle('compact', e.target.checked); PREFS.compact = e.target.checked; savePrefs(); });

/* ---------------- 看板卡片 = 快捷筛选 ---------------- */
const KPI_MAP = {
  kTotal: 'all', kNew: 'new', kSent: 'sent', kDone: 'done',
  kDisk: 'have', kMiss: 'miss', kFav: 'fav', kWatch: 'towatch', kToday: 'today'
};
function markActiveKpi(f) {
  document.querySelectorAll('.kpi').forEach(c => c.classList.toggle('active', KPI_MAP[c.dataset.kpi] === f));
}
function applyKpiFilter(f) {
  FILTER.status = f; PAGE = 1; PREFS.status = f; savePrefs();
  $('#fStatus').value = f;
  render(); markActiveKpi(f);
  const label = $('#fStatus').selectedOptions[0] ? $('#fStatus').selectedOptions[0].textContent : f;
  toast(f === 'all' ? '显示全部' : `筛选：${label}`, 1800);
}
document.querySelectorAll('.kpi').forEach(card => {
  const vid = (card.querySelector('.v') || {}).id;
  if (!vid) return;
  card.dataset.kpi = vid;
  const hint = { kHours: '点击按时长从长到短排序', kTotal: '点击显示全部' }[vid];
  if (hint) card.title = hint;
  card.addEventListener('click', () => {
    if (vid === 'kHours') {
      SORT = { key: 'duration', dir: 'desc' };
      Object.assign(PREFS, { sortKey: 'duration', sortDir: 'desc', status: 'all' });
      PAGE = 1; FILTER.status = 'all'; $('#fStatus').value = 'all'; savePrefs();
      render(); markActiveKpi('all');
      toast('按时长从长到短排序', 1800);
      return;
    }
    applyKpiFilter(KPI_MAP[vid] || 'all');
  });
});

/* ---------------- 列显隐 ---------------- */
function buildColPop() {
  $('#colpop').innerHTML = COLS.map(c =>
    `<label><input type="checkbox" data-col="${c.key}" ${PREFS.cols[c.key] === false ? '' : 'checked'}> ${c.label}</label>`).join('')
    + `<div style="height:1px;background:#262f3a;margin:6px 4px"></div>
       <label><input type="checkbox" id="colAll" checked> 全显</label>`;
}
$('#btnCols').onclick = e => { e.stopPropagation(); buildColPop(); $('#colpop').classList.toggle('on'); };
document.addEventListener('click', e => { if (!e.target.closest('#colpop') && e.target.id !== 'btnCols') $('#colpop').classList.remove('on'); });
$('#colpop').addEventListener('change', e => {
  if (e.target.id === 'colAll') COLS.forEach(c => PREFS.cols[c.key] = e.target.checked);
  else if (e.target.dataset.col) PREFS.cols[e.target.dataset.col] = e.target.checked;
  savePrefs(); applyCols();
});

/* ---------------- 右键菜单 ---------------- */
function ctxItemsFor(row) {
  const favOn = !!row && row.fav === '1';
  const seen = !!row && !!row.last_play;
  const hasFile = !!row && !!row.file_name;
  return [
    { act: 'play', label: '▶ 播放', off: !hasFile },
    { act: 'reveal', label: '📂 在文件夹中定位', off: !hasFile },
    { sep: true },
    { act: 'copy', label: '复制 URL' }, { act: 'thunder', label: '复制 thunder://' }, { act: 'copytoken', label: '复制 token' },
    { sep: true },
    { act: 'toggleFav', label: favOn ? '☆ 取消收藏' : '★ 收藏' },
    { act: 'toggleWatched', label: seen ? '↺ 标记未看' : '✓ 标记已看' },
    { rate: true, value: +((row && row.rating) || 0) },
    { sep: true },
    { act: 'done', label: '标记完成' }, { act: 'new', label: '重置为待下载' }, { act: 'ignore', label: '忽略' },
    { sep: true },
    { act: 'delete', label: '🗑 删除本地文件（回收站）', off: !hasFile },
    { act: 'purge', label: '🗑 删除文件并从台账移除' },
    { sep: true },
    { act: 'open', label: '在站点打开' }
  ];
}
let CTX_TOKEN = null;
$('#tbody').addEventListener('contextmenu', e => {
  const tr = e.target.closest('tr[data-row]');
  if (!tr) return;
  e.preventDefault();
  CTX_TOKEN = tr.dataset.row;
  const row = ROWS.find(r => r.token === CTX_TOKEN);
  const menu = $('#ctxmenu');
  menu.innerHTML = ctxItemsFor(row).map(i => {
    if (i.sep) return '<div class="sep"></div>';
    if (i.rate) {
      const stars = [1, 2, 3, 4, 5].map(n => `<i class="${n <= i.value ? 'on' : ''}" data-v="${n}">★</i>`).join('');
      return `<div class="ctxrate">${stars}<span class="clr">清除</span></div>`;
    }
    return `<button data-act="${i.act}" ${i.off ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>${i.label}</button>`;
  }).join('');
  menu.classList.add('on');
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(6, Math.min(e.clientX, innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(6, Math.min(e.clientY, innerHeight - h - 8)) + 'px';
});
const closeCtx = () => $('#ctxmenu').classList.remove('on');
document.addEventListener('click', e => { if (!e.target.closest('#ctxmenu')) closeCtx(); });
document.addEventListener('scroll', closeCtx, true);

$('#ctxmenu').addEventListener('click', async e => {
  const rateEl = e.target.closest('.ctxrate');
  if (rateEl) {
    const tk = CTX_TOKEN, row = ROWS.find(r => r.token === tk);
    let val = 0;
    if (e.target.matches('i')) {
      const v = parseInt(e.target.dataset.v);
      val = (row && (+row.rating || 0) === v) ? 0 : v;
    }
    closeCtx();
    try {
      const r = await api('/api/rate', { tokens: [tk], value: val });
      if (r.ok && row) { row.rating = val ? String(val) : ''; render(); toast(val ? `已打 ${val} 星` : '已清除评分'); }
    } catch (err) { toast('打分失败'); }
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act, tk = CTX_TOKEN;
  closeCtx();
  const row = ROWS.find(r => r.token === tk);
  if (!row) return;
  try {
    if (act === 'play') return doPlay(tk);
    if (act === 'reveal') { const r = await api('/api/reveal', { token: tk }); if (!r.ok) toast(r.error); return; }
    if (act === 'copy') { await navigator.clipboard.writeText(row.url || ''); return toast('URL 已复制'); }
    if (act === 'thunder') { await navigator.clipboard.writeText(thunder(row.url || '')); return toast('thunder:// 已复制'); }
    if (act === 'copytoken') { await navigator.clipboard.writeText(tk); return toast('token 已复制'); }
    if (act === 'open') { window.open('https://pektino.com/zh-CN/movie/' + tk, '_blank'); return; }
    if (act === 'toggleFav') {
      const on = row.fav !== '1';
      const r = await api('/api/fav', { tokens: [tk], on });
      if (r.ok) { row.fav = on ? '1' : ''; render(); toast(on ? '已收藏' : '已取消收藏'); }
      return;
    }
    if (act === 'toggleWatched') {
      const on = !row.last_play;
      const r = await api('/api/watched', { tokens: [tk], on });
      if (r.ok) { toast(on ? '已标记已看' : '已标记未看'); load(); }
      return;
    }
    if (act === 'delete') return delFiles([tk], false);
    if (act === 'purge') return delFiles([tk], true);
    if (act === 'done' || act === 'new' || act === 'ignore') {
      const st = act === 'ignore' ? 'ignored' : act;
      const r = await api('/api/mark', { tokens: [tk], status: st });
      if (r.ok) { toast(`已标记 ${STATUS_LABEL[st] || st}`); load(); }
      else toast('失败：' + (r.error || '未知错误'), 4000);
      return;
    }
  } catch (err) { toast('操作失败：' + err.message); }
});

/* ---------------- 删除 ---------------- */
async function delFiles(tokens, purge) {
  const rows = ROWS.filter(r => tokens.includes(r.token) && r.file_name);
  if (!rows.length) return toast('选中的条目本地没有文件');
  const size = rows.reduce((s, r) => s + (+r.file_size || 0), 0);
  const extra = purge ? '，并从台账中移除这些条目' : '（进回收站，可从回收站还原）';
  if (!confirm(`删除 ${rows.length} 个本地文件，共 ${(size / 1048576).toFixed(1)} MB${extra}？`)) return;
  try {
    const r = await api('/api/delete', { tokens, purge });
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast(`已删除 ${r.deleted} 个文件，释放 ${(r.freed / 1048576).toFixed(1)} MB${purge ? '，台账已移除' : ''}` +
      (r.failed && r.failed.length ? `（${r.failed.length} 个失败）` : ''), 4500);
    if (purge) SEL.clear();
    load();
  } catch (e) { toast('请求失败：' + e.message, 5000); }
}

/* ---------------- 抓取 / 入库 / 投递 ---------------- */
$('#btnScrape').onclick = async () => {
  const rank = $('#rank').value;
  const pages = $('#pages').value.split(',').map(x => parseInt(x.trim())).filter(x => x > 0);
  const limit = parseInt($('#limit').value) || 0;
  if (!pages.length) return toast('页码填一下，例如 1,2,3');
  try {
    const r = await api('/api/scrape', { rank, pages, limit, incremental: $('#chkInc').checked });
    if (!r.ok) toast('失败：' + r.error, 5000);
    else { toast(r.incremental ? `已开始（增量，跳过 ${r.skipped} 条）` : '已开始（全量）'); load(); }
  } catch (e) { toast('请求失败：' + e.message, 5000); }
};
$('#btnImport').onclick = async () => {
  const dir = $('#dirInput').value.trim();
  if (!confirm(`扫描下载目录并入库？\n${dir}\n\n会逐个用文件名(token)去站点查证，能查到的才入库并标记为已完成。`)) return;
  try {
    const r = await api('/api/import', {});
    if (!r.ok) toast('失败：' + r.error, 5000); else { toast('已开始扫描本地文件'); load(); }
  } catch (e) { toast('请求失败：' + e.message, 5000); }
};
$('#btnCancelJob').onclick = async () => {
  try { const r = await api('/api/job/cancel', {}); toast(r.ok ? `已取消 ${r.kind}` : (r.error || '取消失败')); }
  catch (e) { toast('取消失败'); }
  load();
};
$('#btnSendNew').onclick = async () => {
  const n = STATS.new || 0;
  if (!n) return toast('没有待下载条目');
  if (!confirm(`把全部 ${n} 条待下载投进迅雷？（约 ${STATS.hours} 小时）`)) return;
  setBusy(true, '投递中…');
  try {
    const r = await api('/api/send', { status: 'new' });
    toast(r.ok ? `已投递 ${r.count} 条` : '失败：' + r.error, 4000);
  } catch (e) { toast('请求失败：' + e.message); }
  setBusy(false); load();
};
$('#btnPreview').onclick = async () => {
  try {
    const r = await api('/api/send', { status: 'new', dryRun: true });
    if (!r.ok) return toast('失败：' + r.error);
    if (!r.count) return toast('没有待下载条目');
    await navigator.clipboard.writeText(r.links.join('\n')).catch(() => { });
    toast(`已生成 ${r.count} 条 thunder:// 链接并复制到剪贴板`, 4000);
  } catch (e) { toast('请求失败：' + e.message); }
};

/* ---------------- 选中批操作 ---------------- */
const selTokens = () => [...SEL];
$('#selSend').onclick = async () => {
  if (!SEL.size) return;
  setBusy(true, '投递中…');
  try { const r = await api('/api/send', { tokens: selTokens(), force: true }); toast(r.ok ? `已投递 ${r.count} 条` : '失败：' + r.error, 4000); }
  catch (e) { toast('请求失败'); }
  setBusy(false); load();
};
const bulkFav = async on => {
  if (!SEL.size) return;
  try {
    const r = await api('/api/fav', { tokens: selTokens(), on });
    ROWS.forEach(x => { if (SEL.has(x.token)) x.fav = on ? '1' : ''; });
    STATS.favorites = Math.max(0, (STATS.favorites || 0) + (on ? r.count : -r.count));
    $('#kFav').textContent = STATS.favorites;
    render(); toast(on ? `已收藏 ${r.count} 条` : `已取消收藏 ${r.count} 条`);
  } catch (e) { toast('操作失败'); }
};
$('#selFavToggle').onclick = () => bulkFav($('#selFavToggle').dataset.on !== '1');
$('#selDone').onclick = async () => {
  if (!SEL.size) return;
  try { const r = await api('/api/mark', { tokens: selTokens(), status: 'done' }); toast(`已标记 ${r.count} 条完成`); load(); }
  catch (e) { toast('操作失败'); }
};
const bulkWatched = async on => {
  if (!SEL.size) return;
  try {
    const r = await api('/api/watched', { tokens: selTokens(), on });
    toast(on ? `已标记 ${r.count} 条已看` : `已标记 ${r.count} 条未看`);
    load();
  } catch (e) { toast('操作失败'); }
};
$('#selWatchedToggle').onclick = () => bulkWatched($('#selWatchedToggle').dataset.on !== '1');
$('#selRate').addEventListener('click', async e => {
  if (!e.target.matches('i') || !SEL.size) return;
  const v = parseInt(e.target.dataset.v);
  try {
    const r = await api('/api/rate', { tokens: selTokens(), value: v });
    toast(`已给 ${r.count} 条打 ${v} 星`);
    load();
  } catch (err) { toast('打分失败'); }
});
$('#selDelete').onclick = () => { if (SEL.size) delFiles(selTokens(), false); };
$('#selCopy').onclick = async () => {
  const links = ROWS.filter(r => SEL.has(r.token) && r.url).map(r => r.url);
  if (!links.length) return toast('没有可复制的链接');
  await navigator.clipboard.writeText(links.join('\n'));
  toast(`已复制 ${links.length} 条 URL`);
};

/* ---------------- 抽卡 ---------------- */
function gachaPool() {
  let pool = visible().filter(r => r.file_name);
  if (!pool.length) pool = ROWS.filter(r => r.file_name);
  return pool;
}
function pickWeighted(pool) {
  // 没看过的权重 3、看过的 1、收藏的 ×1.5
  const w = pool.map(r => (r.last_play ? 1 : 3) * (r.fav === '1' ? 1.5 : 1));
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function renderGRate(v) {
  const el = $('#gRate');
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4, 5].map(n => `<i class="${n <= v ? 'on' : ''}" data-v="${n}">★</i>`).join('');
  $('#gRateHint').textContent = v > 0
    ? `${v} 星 · 再点同一颗可清除；按 1–5 改分，R 再抽，Esc 关闭`
    : '点星星打分，或按 1–5；R 再抽，Esc 关闭';
}
function drawCard() {
  const pool = gachaPool();
  if (!pool.length) return toast('没有可抽的条目 —— 先下载几个', 3000);
  const r = pickWeighted(pool);
  GACHA_TOKEN = r.token;
  const card = $('#gCard');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  $('#gImg').src = '/api/cover?token=' + encodeURIComponent(r.token) + '&full=1';
  $('#gImg').onerror = () => { $('#gImg').src = '/api/cover?token=' + encodeURIComponent(r.token); };
  $('#gLab').textContent = r.last_play ? '🎲 抽到 · 看过了' : '🎲 抽到 · 还没看';
  $('#gTok').textContent = r.token;
  $('#gInfo').innerHTML = metaRows(r, false);
  renderGRate(+r.rating || 0);
  $('#gFav').textContent = r.fav === '1' ? '☆ 取消收藏' : '★ 收藏';
  $('#gacha').classList.add('on');
}
async function rateGacha(v) {
  const row = ROWS.find(x => x.token === GACHA_TOKEN);
  if (!row) return;
  const val = ((+row.rating || 0) === v) ? 0 : v;
  try {
    const res = await api('/api/rate', { tokens: [row.token], value: val });
    if (res.ok) {
      row.rating = val ? String(val) : '';
      renderGRate(val); render();
      toast(val ? `已打 ${val} 星` : '已清除评分');
    }
  } catch (e) { toast('打分失败'); }
}
$('#gRate').addEventListener('click', e => { if (e.target.matches('i')) rateGacha(parseInt(e.target.dataset.v)); });
$('#btnGacha').onclick = drawCard;
$('#gAgain').onclick = drawCard;
$('#gClose').onclick = () => $('#gacha').classList.remove('on');
$('#gacha').onclick = e => { if (e.target.id === 'gacha') $('#gacha').classList.remove('on'); };
$('#gPlay').onclick = () => { if (GACHA_TOKEN) doPlay(GACHA_TOKEN); };
$('#gReveal').onclick = async () => {
  if (!GACHA_TOKEN) return;
  try { const r = await api('/api/reveal', { token: GACHA_TOKEN }); if (!r.ok) toast(r.error); } catch (e) { toast('定位失败'); }
};
$('#gCopy').onclick = async () => {
  const r = ROWS.find(x => x.token === GACHA_TOKEN);
  if (r && r.url) { await navigator.clipboard.writeText(r.url); toast('URL 已复制'); }
};
$('#gFav').onclick = async () => {
  const r = ROWS.find(x => x.token === GACHA_TOKEN);
  if (!r) return;
  const on = r.fav !== '1';
  try {
    const res = await api('/api/fav', { tokens: [r.token], on });
    if (res.ok) {
      r.fav = on ? '1' : '';
      $('#gFav').textContent = on ? '☆ 取消收藏' : '★ 收藏';
      STATS.favorites = Math.max(0, (STATS.favorites || 0) + (on ? 1 : -1));
      $('#kFav').textContent = STATS.favorites;
      render();
    }
  } catch (e) { toast('操作失败'); }
};

/* ---------------- 设置抽屉 ---------------- */
$('#btnSettings').onclick = () => $('#drawer').classList.add('on');
$('#btnLog').onclick = () => $('#drawer').classList.add('on');
$('#drawer').onclick = e => { if (e.target.id === 'drawer') $('#drawer').classList.remove('on'); };
$('#btnSaveDir').onclick = async () => {
  const dir = $('#dirInput').value.trim();
  if (!dir) return toast('先填目录');
  try {
    const r = await api('/api/config', { downloadDir: dir });
    toast(r.ok ? `已保存：${r.dir}（${r.files} 个文件，命中 ${r.downloaded}）` : '失败：' + r.error, 4000);
  } catch (e) { toast('请求失败'); }
  load();
};
$('#btnScan').onclick = async () => {
  try {
    const r = await api('/api/scan', {});
    toast(`扫描完成：${r.files} 个 mp4，命中 ${r.downloaded}，更新 ${r.changed}`, 4000);
  } catch (e) { toast('扫描失败'); }
  load();
};
$('#btnRefresh').onclick = () => load();

/* ---------------- SSE ---------------- */
let es = null;
function connectSse() {
  try {
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => { $('#sseInfo').textContent = 'SSE 已连接'; });
    es.addEventListener('state', () => { if (!BUSY) load(); });
    es.onerror = () => { $('#sseInfo').textContent = 'SSE 重连中…'; };
  } catch (e) { $('#sseInfo').textContent = 'SSE 不可用（走轮询）'; }
}

/* ---------------- 键盘 ---------------- */
document.addEventListener('keydown', e => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  const gachaOpen = $('#gacha').classList.contains('on');
  if (gachaOpen && /^[1-5]$/.test(e.key) && !typing) { e.preventDefault(); rateGacha(parseInt(e.key)); return; }
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); }
  else if ((e.key === 'r' || e.key === 'R') && !typing) { e.preventDefault(); drawCard(); }
  else if (e.key === 'Escape') {
    if ($('#gacha').classList.contains('on')) $('#gacha').classList.remove('on');
    else if ($('#lightbox').classList.contains('on')) closeLightbox();
    else if ($('#drawer').classList.contains('on')) $('#drawer').classList.remove('on');
    else if ($('#ctxmenu').classList.contains('on')) closeCtx();
    else if (document.activeElement === $('#q')) { $('#q').value = ''; FILTER.q = ''; PREFS.q = ''; savePrefs(); render(); }
  }
});

/* ---------------- 初始化 ---------------- */
$('#chkCovers').checked = SHOW_COVERS;
document.body.classList.toggle('compact', !!PREFS.compact);
$('#chkCompact').checked = !!PREFS.compact;
$('#q').value = FILTER.q;
$('#fStatus').value = FILTER.status;
$('#fRes').value = FILTER.res;
$('#fMinDur').value = FILTER.minDur;
$('#pgSize').value = String(PER);

load();
connectSse();
setInterval(() => { if (!BUSY) load(); }, 60000);
