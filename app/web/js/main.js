/* main.js — 数据加载、工具条、批量操作、初始化 */
import { $, state, PREFS, savePrefs, api, toast, onEvent } from './core.js';
import { render, markActiveKpi, initTable } from './table.js';
import { initRows, doPlay, delFiles } from './rows.js';
import { initPanels, connectSse } from './panels.js';
import { setFav, setWatched, setStatus, setRating, reload, thunderUrl } from './actions.js';

/* ================= 任务进度条 ================= */
const PHASE_LABEL = {
  covers: '下载封面', details: '解析详情', list: '读取榜单',
  scan: '扫描文件', resolve: '核对详情', done: '收尾'
};

function renderJob(job, download) {
  const el = $('#prog');
  const dl = download || state.DOWNLOAD;
  if (dl && dl.running) {
    const total = +dl.total || 0, done = +dl.done || 0;
    el.classList.add('on');
    $('#progLabel').textContent = '下载中';
    $('#progBar').style.width = (total ? Math.round(100 * done / total) : 0) + '%';
    const mb = ((+dl.bytes || 0) / 1048576).toFixed(1);
    const active = (dl.active || []).length;
    $('#progStat').textContent = `${done}/${total} 完成 · ${mb} MB · ${dl.speed || 0} MB/s · 并发 ${active}`;
    return;
  }
  if (!job || !job.running) { el.classList.remove('on'); return; }
  const p = job.progress || {};
  const total = p.total || 0, done = p.done || 0;
  const pages = job.pages || [];
  const contiguous = pages.length > 1 && pages.every((n, i) => n === i + 1);
  el.classList.add('on');
  $('#progLabel').textContent = job.rank === 'import'
    ? '本地入库中'
    : `抓取中 · ${job.rank} ${contiguous ? `前 ${pages.length} 页` : 'p' + pages.join(',')}`;
  $('#progBar').style.width = (total ? Math.round(100 * done / total) : 0) + '%';
  $('#progStat').textContent = `${PHASE_LABEL[p.phase] || '准备'} ${done}/${total} · ${p.speed || 0}/s · ${job.elapsed}s`;
}

/* ================= 数据加载 ================= */
let _WS = null;
function paintKpis(S) {
  $('#kTotal').textContent = S.total;
  $('#kNew').textContent = S.new;
  $('#kSent').textContent = S.sent;
  $('#kDone').textContent = S.done;
  $('#kDisk').textContent = S.downloaded;
  $('#kMiss').textContent = S.missing;
  $('#kFav').textContent = S.favorites || 0;
  $('#kWatch').textContent = S.toWatch != null ? S.toWatch : '–';
  $('#kHours').textContent = S.hours;
  $('#kToday').textContent = S.todayAdded;
}

function paintDir(S) {
  if ($('#dirInput')) $('#dirInput').value = (_WS && _WS.root) || '';
  $('#dirInfo').textContent =
    `${S.dirExists ? '目录 OK' : '目录不存在'} · mp4 ${S.fileCount} 个 / ${S.dirGB} GB` +
    ` · 下载中 ${S.partialCount} · 命中 ${S.downloaded} 条 · 扫描于 ${(S.lastScan || '').slice(11)}`;
}

function paintMetrics(m) {
  if (!m.total) return;
  $('#metricsBox').textContent =
    `请求 ${m.total} 次 · 平均 ${m.avgMs}ms · 最慢 ${m.maxMs}ms（${m.maxPath || '–'}）` +
    ` · 运行 ${m.uptime} 分钟 · 前端告警 ${m.clientWarns || 0} 条`;
  $('#slowList').innerHTML = (m.slow || []).length
    ? m.slow.map(x => `<div><span class="t">${x.t}</span> ${x.path} · ${x.ms}ms</div>`).join('')
    : '<div>没有慢请求（≥800ms）</div>';
  $('#errList').innerHTML = (m.clientErrors || []).length
    ? m.clientErrors.map(x => `<div><span class="t">${x.t}</span> ${x.msg}${x.url ? ' · ' + x.url : ''}</div>`).join('')
    : '<div>没有前端错误</div>';
}

function paintDownload(dl) {
  const el = $('#dlInfo'), list = $('#dlList');
  if (!el || !list) return;
  if (!dl || (!dl.running && !(dl.items && dl.items.length))) {
    el.textContent = '没有进行中的任务';
    list.innerHTML = '';
    return;
  }
  const mb = (n) => ((+n || 0) / 1048576).toFixed(1);
  const items = dl.items || [];
  const activeCount = items.filter(i => i.state === 'downloading').length;
  const queued = items.filter(i => i.state === 'queued').length;
  el.textContent = dl.running
    ? `进行中 · 下载 ${activeCount} · 排队 ${queued} · ${dl.done || 0}/${dl.total || 0} 完成 · ${mb(dl.bytes)} MB · ${dl.speed || 0} MB/s`
    : `已结束 · 成功 ${dl.done || 0} · 失败 ${dl.failed || 0}`;
  const show = items.filter(i => i.state === 'downloading' || i.state === 'queued' || i.state === 'failed').slice(0, 30);
  list.innerHTML = show.map(i => {
    const pct = i.expected ? Math.round(100 * i.bytes / i.expected) : 0;
    const right = i.state === 'downloading'
      ? `${mb(i.bytes)} MB（${pct}%） · ${i.speed || 0} MB/s`
      : i.state === 'failed' ? (i.error || '失败') : '排队中';
    return `<div style="display:flex;gap:8px;align-items:center">
      <span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis">${i.token}</span>
      <span class="sub">${right}</span>
      ${i.state !== 'failed' ? `<button class="ghost rowbtn" data-dl-cancel="${i.token}" title="取消这一条">取消</button>` : ''}
    </div>`;
  }).join('');
}

function paintProject(ws) {
  const el = $('#wsInfo');
  if (!el) return;
  if (!ws) { el.textContent = '–'; return; }
  el.innerHTML = `项目 <span class="mono">${ws.root}</span><br>
    媒体 media\\ · 数据 data\\ · 缓存 cache\\<br>
    ${ws.videoCount} 个视频 / ${ws.videoGB} GB · 封面 ${ws.coverCount} 张 · 库 ${ws.dbMB} MB`;
}

function paintCovers(S) {
  const n = +S.coverMissing || 0;
  const el = $('#coverInfo');
  if (!el) return;
  el.textContent = n > 0 ? `缺 ${n} 张（下载没成功时会出现）` : '完整';
  el.style.color = n > 0 ? '#d29922' : '';
}

function paintOrphans(S) {
  const orph = S.orphans || [];
  $('#orphanInfo').textContent = orph.length ? `共 ${S.orphanCount} 个（目录里有、台账里没有）` : '没有孤立文件';
  $('#orphanList').innerHTML = orph.slice(0, 20)
    .map(o => `<div><span class="mono">${o.name}</span> · ${(o.size / 1048576).toFixed(1)} MB</div>`).join('');
}

async function load() {
  if (location.protocol === 'file:') $('#banner').style.display = 'block';
  try {
    const s = await api('/api/state');
    state.STATS = s.stats || {};
    state.ROWS = s.rows || [];
    _WS = s.project || _WS;
    const S = state.STATS;

    $('#dot').classList.remove('off');
    $('#sub').textContent = `在线 · ${S.total} 条 · 待下载 ${S.new}`;
    paintKpis(S);
    paintDir(S);
    paintMetrics(s.metrics || {});
    paintOrphans(S);
    paintCovers(S);
    paintProject(_WS);
    paintDownload(s.download);

    $('#logbox').innerHTML = (s.log || []).slice().reverse()
      .map(l => `<div><span class="t">${l.time}</span> [${l.kind}] ${l.message}</div>`).join('')
      || '<div>暂无日志</div>';
    $('#diag').textContent = `自检：前端 OK · API OK · 渲染 ${state.ROWS.length} 行 · 磁盘命中 ${S.downloaded}`;

    state.DOWNLOAD = s.download || null;
    state.SETTINGS = s.settings || null;
    renderJob(s.job || {}, s.download);
    render();
    markActiveKpi();
    if ((s.job && s.job.running) || (s.download && s.download.running)) { clearTimeout(load._t); load._t = setTimeout(load, 1200); }
  } catch (e) {
    $('#dot').classList.add('off');
    $('#sub').textContent = '服务未连接 —— 先运行 启动控制台.cmd';
    $('#diag').textContent = `自检：前端 OK · API 失败（${e.message}）`;
  }
}

/* ================= 工具条 ================= */
/* 抓取前 N 页：页码固定从 1 开始 */
const MAX_PAGES = 20;
function pageList() {
  const raw = parseInt($('#pageCount').value);
  const n = isNaN(raw) ? 3 : Math.max(1, Math.min(MAX_PAGES, raw));
  if (String(n) !== $('#pageCount').value) $('#pageCount').value = String(n);
  return Array.from({ length: n }, (_, i) => i + 1);
}

async function doScrape() {
  const rank = $('#rank').value;
  const pages = pageList();
  const limit = parseInt($('#limit').value) || 0;
  try {
    const r = await api('/api/scrape', { rank, pages, limit, incremental: $('#chkInc').checked });
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast(r.incremental
      ? `已开始：前 ${pages.length} 页（增量，跳过 ${r.skipped} 条）`
      : `已开始：前 ${pages.length} 页`);
    load();
  } catch (e) { toast('请求失败：' + e.message, 5000); }
}

async function doImport() {
  const media = (_WS && _WS.media) || '';
  if (!confirm(`扫描项目里的媒体目录并入库？\n${media}\n\n会逐个用文件名(token)去站点查证，能查到的才入库并标记为已完成。`)) return;
  try {
    const r = await api('/api/import', {});
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast('已开始扫描本地文件');
    load();
  } catch (e) { toast('请求失败：' + e.message, 5000); }
}

async function doCancelJob() {
  // 进度条上的 ✕：下载在跑就取消下载，否则取消抓取/入库任务
  const dl = state.DOWNLOAD;
  try {
    if (dl && dl.running) {
      if (!confirm('取消正在进行的下载？已下载的部分会保留，可续传。')) return;
      const r = await api('/api/download/cancel', {});
      toast(r.ok ? `已取消下载（结束 ${r.killed || 0} 个进程）` : (r.error || '取消失败'), 4000);
    } else {
      const r = await api('/api/job/cancel', {});
      toast(r.ok ? `已取消 ${r.kind}` : (r.error || '取消失败'));
    }
  } catch (e) { toast('取消失败'); }
  load();
}

async function sendAllNew() {
  const n = state.STATS.new || 0;
  if (!n) return toast('没有待下载条目');
  if (!confirm(`把全部 ${n} 条待下载投进迅雷？（约 ${state.STATS.hours} 小时）`)) return;
  try {
    const r = await api('/api/send', { status: 'new' });
    toast(r.ok ? `已投递 ${r.count} 条` : '失败：' + r.error, 4000);
  } catch (e) { toast('请求失败：' + e.message); }
  load();
}

async function previewLinks() {
  try {
    const r = await api('/api/send', { status: 'new', dryRun: true });
    if (!r.ok) return toast('失败：' + r.error);
    if (!r.count) return toast('没有待下载条目');
    await navigator.clipboard.writeText(r.links.join('\n')).catch(() => { });
    toast(`已生成 ${r.count} 条 thunder:// 链接并复制到剪贴板`, 4000);
  } catch (e) { toast('请求失败：' + e.message); }
}

async function openProjectFolder() {
  try { await api('/api/project/open', {}); } catch (e) { toast('打开失败'); }
}

async function scanDir() {
  try {
    const r = await api('/api/scan', {});
    toast(`扫描完成：${r.files} 个 mp4，命中 ${r.downloaded}，更新 ${r.changed}`, 4000);
  } catch (e) { toast('扫描失败'); }
  load();
}

async function downloadNew() {
  const n = state.STATS.new || 0;
  if (!n) return toast('没有可下载的条目');
  if (!confirm(`用内置下载器下载 ${n} 条？\n保存到：${state.STATS.contentDir || ''}\n\n支持断点续传，可在进度条上取消。`)) return;
  try {
    const r = await api('/api/download', { status: 'new' });
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast(`已开始下载 ${r.count} 条（并发 ${r.concurrent}）`, 3500);
    load();
  } catch (e) { toast('请求失败：' + e.message); }
}

async function saveNet() {
  const proxy = $('#proxyInput').value.trim();
  const concurrent = parseInt($('#concInput').value) || 3;
  try {
    const r = await api('/api/config', { proxy, concurrent });
    toast(r.ok ? `已保存：代理 ${proxy || '跟随系统'}，并发 ${concurrent}` : '失败：' + r.error, 3500);
  } catch (e) { toast('请求失败'); }
}

async function cancelAllDownloads() {
  if (!confirm('取消全部下载？已下载的部分会保留，下次可续传。')) return;
  try {
    const r = await api('/api/download/cancel', {});
    toast(r.ok ? '已取消全部下载' : (r.error || '取消失败'), 3500);
  } catch (e) { toast('请求失败：' + e.message); }
  load();
}

async function onCancelOne(e) {
  const btn = e.target.closest('[data-dl-cancel]');
  if (!btn) return;
  const tk = btn.dataset.dlCancel;
  try {
    const r = await api('/api/download/cancel', { tokens: [tk] });
    toast(r.ok ? `已取消 ${tk}` : (r.error || '取消失败'), 3000);
  } catch (err) { toast('请求失败'); }
  load();
}

async function repairParts() {
  try {
    const r = await api('/api/download/repair', {});
    toast(r.ok ? `.part 整理：改名 ${r.renamed}，删除 ${r.deleted}，保留 ${r.kept}` : '失败', 5000);
  } catch (e) { toast('请求失败'); }
  load();
}

async function repairCovers() {
  const btn = $('#btnRepairCovers');
  btn.disabled = true;
  btn.textContent = '修复中…';
  try {
    const r = await api('/api/covers/repair', { limit: 60 });
    if (!r.ok) toast('修复失败：' + r.error, 5000);
    else toast(`补了 ${r.fixed} 张，失败 ${r.failed}，仍缺 ${r.missing}`, 5000);
  } catch (e) { toast('请求失败：' + e.message, 5000); }
  btn.disabled = false;
  btn.textContent = '修复缺失封面';
  load();
}

function initToolbar() {
  $('#btnScrape').onclick = doScrape;
  $('#btnImport').onclick = doImport;
  $('#btnCancelJob').onclick = doCancelJob;
  $('#btnSendNew').onclick = sendAllNew;
  $('#btnDownload').onclick = downloadNew;
  $('#btnSaveNet').onclick = saveNet;
  $('#btnPreview').onclick = previewLinks;
  $('#btnOpenContent').onclick = openProjectFolder;
  $('#btnScan').onclick = scanDir;
  $('#btnWsOpen').onclick = async () => { try { await api('/api/workspace/open', {}); } catch (e) { toast('打开失败'); } };
  $('#btnWsImport').onclick = async () => {
    try {
      const r = await api('/api/workspace/import', {});
      toast(r.ok ? `识别完成：新增 ${r.added} 条，跳过 ${r.skipped} 条` : '失败', 4000);
    } catch (e) { toast('请求失败'); }
    load();
  };
  $('#btnRepairCovers').onclick = repairCovers;
  $('#btnCancelAll').onclick = cancelAllDownloads;
  $('#btnRepairParts').onclick = repairParts;
  $('#dlList').addEventListener('click', onCancelOne);
  $('#btnRefresh').onclick = () => load();
}

/* ================= 批量操作 ================= */
function initBulk() {
  const sel = () => [...state.SEL];

  $('#selSend').onclick = async () => {
    if (!state.SEL.size) return;
    try {
      const r = await api('/api/send', { tokens: sel(), force: true });
      toast(r.ok ? `已投递 ${r.count} 条` : '失败：' + r.error, 4000);
    } catch (e) { toast('请求失败'); }
    load();
  };

  $('#selFavToggle').onclick = async () => {
    if (!state.SEL.size) return;
    const on = $('#selFavToggle').dataset.on !== '1';
    const r = await setFav(sel(), on);
    if (!r.ok) return;
    render();
    toast(on ? `已收藏 ${r.count} 条` : `已取消收藏 ${r.count} 条`);
  };

  $('#selDone').onclick = async () => {
    if (!state.SEL.size) return;
    const r = await setStatus(sel(), 'done');
    if (!r.ok) return;
    render();
    toast(`已标记 ${r.count} 条完成`);
  };

  $('#selWatchedToggle').onclick = async () => {
    if (!state.SEL.size) return;
    const on = $('#selWatchedToggle').dataset.on !== '1';
    const r = await setWatched(sel(), on);
    if (!r.ok) return;
    render();
    toast(on ? `已标记 ${r.count} 条已看` : `已标记 ${r.count} 条未看`);
  };

  $('#selRate').addEventListener('click', async e => {
    if (!e.target.matches('i') || !state.SEL.size) return;
    const v = parseInt(e.target.dataset.v);
    const r = await setRating(sel(), v);
    if (!r.ok) return;
    render();
    toast(`已给 ${r.count} 条打 ${v} 星`);
  });

  $('#selDelete').onclick = () => { if (state.SEL.size) delFiles(sel(), false); };

  $('#selThunder').onclick = async () => {
    const links = state.ROWS.filter(r => state.SEL.has(r.token) && r.url).map(r => thunderUrl(r.url));
    if (!links.length) return toast('没有可转换的链接');
    await navigator.clipboard.writeText(links.join('\n'));
    toast(`已复制 ${links.length} 条 thunder:// 链接，粘到迅雷即可`, 4000);
  };
  $('#selCopy').onclick = async () => {
    const links = state.ROWS.filter(r => state.SEL.has(r.token) && r.url).map(r => r.url);
    if (!links.length) return toast('没有可复制的链接');
    await navigator.clipboard.writeText(links.join('\n'));
    toast(`已复制 ${links.length} 条 URL`);
  };
}

/* ================= 初始化 ================= */
function initControls() {
  $('#chkCovers').checked = state.SHOW_COVERS;
  $('#pageCount').value = String(PREFS.pageCount || 3);
  if (state.SETTINGS) {
    $('#proxyInput').value = state.SETTINGS.proxy || '';
    $('#concInput').value = String(state.SETTINGS.concurrent || 3);
  }
  $('#pageCount').addEventListener('change', e => {
    const raw = parseInt(e.target.value);
    PREFS.pageCount = isNaN(raw) ? 3 : Math.max(1, Math.min(MAX_PAGES, raw));
    savePrefs();
    e.target.value = String(PREFS.pageCount);
  });
  document.body.classList.toggle('compact', !!PREFS.compact);
  $('#chkCompact').checked = !!PREFS.compact;
  $('#q').value = state.FILTER.q;
  $('#fStatus').value = state.FILTER.status;
  $('#fFlag').value = state.FILTER.flag || 'none';
  $('#fRes').value = state.FILTER.res;
  $('#fMinDur').value = state.FILTER.minDur;
  $('#pgSize').value = String(state.PER);
}

initTable();
initRows();
initPanels();
initControls();
initToolbar();
initBulk();

onEvent('reload', load);
onEvent('play', tk => doPlay(tk));
onEvent('delete', d => delFiles(d.tokens, d.purge));
onEvent('clear-query', () => {
  $('#q').value = '';
  state.FILTER.q = '';
  PREFS.q = '';
  localStorage.setItem('pektino.ui.v3', JSON.stringify(PREFS));
  render();
});

load();
connectSse();
setInterval(() => { if (!state.BUSY) load(); }, 60000);