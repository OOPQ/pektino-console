/* main.js — 数据加载、工具条、批量操作、初始化 */
import { $, state, PREFS, savePrefs, api, toast, onEvent } from './core.js';
import { render, markActiveKpi, initTable } from './table.js';
import { initRows, doPlay, delFiles } from './rows.js';
import { initPanels, connectSse } from './panels.js';
import { setFav, setWatched, setStatus, setRating, reload } from './actions.js';

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
  if (!$('#dirInput').value) $('#dirInput').value = S.downloadDir || '';
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
    const S = state.STATS;

    $('#dot').classList.remove('off');
    $('#sub').textContent = `在线 · ${S.total} 条 · 待下载 ${S.new}`;
    paintKpis(S);
    paintDir(S);
    paintMetrics(s.metrics || {});
    paintOrphans(S);

    $('#logbox').innerHTML = (s.log || []).slice().reverse()
      .map(l => `<div><span class="t">${l.time}</span> [${l.kind}] ${l.message}</div>`).join('')
      || '<div>暂无日志</div>';
    $('#diag').textContent = `自检：前端 OK · API OK · 渲染 ${state.ROWS.length} 行 · 磁盘命中 ${S.downloaded}`;

    state.DOWNLOAD = s.download || null;
    state.SETTINGS = s.settings || null;
    renderJob(s.job || {}, s.download);
    render();
    markActiveKpi(state.FILTER.status);
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
  const dir = $('#dirInput').value.trim();
  if (!confirm(`扫描下载目录并入库？\n${dir}\n\n会逐个用文件名(token)去站点查证，能查到的才入库并标记为已完成。`)) return;
  try {
    const r = await api('/api/import', {});
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast('已开始扫描本地文件');
    load();
  } catch (e) { toast('请求失败：' + e.message, 5000); }
}

async function doCancelJob() {
  try {
    const r = await api('/api/job/cancel', {});
    toast(r.ok ? `已取消 ${r.kind}` : (r.error || '取消失败'));
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

async function saveDir() {
  const dir = $('#dirInput').value.trim();
  if (!dir) return toast('先填目录');
  try {
    const r = await api('/api/config', { downloadDir: dir });
    toast(r.ok ? `已保存：${r.dir}（${r.files} 个文件，命中 ${r.downloaded}）` : '失败：' + r.error, 4000);
  } catch (e) { toast('请求失败'); }
  load();
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
  if (!confirm(`用内置下载器下载 ${n} 条？\n保存到：${state.STATS.downloadDir || ''}\n\n支持断点续传，可在进度条上取消。`)) return;
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

function initToolbar() {
  $('#btnScrape').onclick = doScrape;
  $('#btnImport').onclick = doImport;
  $('#btnCancelJob').onclick = doCancelJob;
  $('#btnSendNew').onclick = sendAllNew;
  $('#btnDownload').onclick = downloadNew;
  $('#btnSaveNet').onclick = saveNet;
  $('#btnPreview').onclick = previewLinks;
  $('#btnSaveDir').onclick = saveDir;
  $('#btnScan').onclick = scanDir;
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
