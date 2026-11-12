/* main.js — 数据加载、KPI/工具条/批量操作、初始化 */
import { $, state, PREFS, savePrefs, api, toast, emit, on } from './core.js';
import { render, markActiveKpi, initTable } from './table.js';
import { initRows, doPlay, delFiles } from './rows.js';
import { initPanels, connectSse, drawCard } from './panels.js';

/* ---------------- 任务进度条 ---------------- */
function renderJob(job) {
  const el = $('#prog');
  if (!job || !job.running) { el.classList.remove('on'); return; }
  const p = job.progress || {};
  el.classList.add('on');
  const total = p.total || 0, done = p.done || 0;
  const pct = total ? Math.round(100 * done / total) : 0;
  const phaseMap = { covers: '下载封面', details: '解析详情', list: '读取榜单', scan: '扫描文件', resolve: '核对详情', done: '收尾' };
  $('#progLabel').textContent = job.rank === 'import' ? '本地入库中' : `抓取中 · ${job.rank} p${(job.pages || []).join(',')}`;
  $('#progBar').style.width = pct + '%';
  $('#progStat').textContent = `${phaseMap[p.phase] || '准备'} ${done}/${total} · ${p.speed || 0}/s · ${job.elapsed}s`;
}

/* ---------------- 加载 ---------------- */
async function load() {
  if (location.protocol === 'file:') $('#banner').style.display = 'block';
  try {
    const s = await api('/api/state');
    state.STATS = s.stats || {};
    state.ROWS = s.rows || [];
    const S = state.STATS;

    $('#dot').classList.remove('off');
    $('#sub').textContent = `在线 · ${S.total} 条 · 待下载 ${S.new}`;
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

    if (!$('#dirInput').value) $('#dirInput').value = S.downloadDir || '';
    $('#dirInfo').textContent =
      `${S.dirExists ? '目录 OK' : '目录不存在'} · mp4 ${S.fileCount} 个 / ${S.dirGB} GB · 下载中 ${S.partialCount} · 命中 ${S.downloaded} 条 · 扫描于 ${(S.lastScan || '').slice(11)}`;

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

    const orph = S.orphans || [];
    $('#orphanInfo').textContent = orph.length ? `共 ${S.orphanCount} 个（目录里有、台账里没有）` : '没有孤立文件';
    $('#orphanList').innerHTML = orph.slice(0, 20).map(o =>
      `<div><span class="mono">${o.name}</span> · ${(o.size / 1048576).toFixed(1)} MB</div>`).join('');

    $('#logbox').innerHTML = (s.log || []).slice().reverse()
      .map(l => `<div><span class="t">${l.time}</span> [${l.kind}] ${l.message}</div>`).join('') || '<div>暂无日志</div>';
    $('#diag').textContent = `自检：前端 OK · API OK · 渲染 ${state.ROWS.length} 行 · 磁盘命中 ${S.downloaded}`;

    renderJob(s.job || {});
    render();
    markActiveKpi(state.FILTER.status);
    if (s.job && s.job.running) { clearTimeout(load._t); load._t = setTimeout(load, 1200); }
  } catch (e) {
    $('#dot').classList.add('off');
    $('#sub').textContent = '服务未连接 —— 先运行 启动控制台.cmd';
    $('#diag').textContent = `自检：前端 OK · API 失败（${e.message}）`;
  }
}

/* ---------------- 工具条 ---------------- */
function initToolbar() {
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
    try {
      const r = await api('/api/job/cancel', {});
      toast(r.ok ? `已取消 ${r.kind}` : (r.error || '取消失败'));
    } catch (e) { toast('取消失败'); }
    load();
  };

  $('#btnSendNew').onclick = async () => {
    const n = state.STATS.new || 0;
    if (!n) return toast('没有待下载条目');
    if (!confirm(`把全部 ${n} 条待下载投进迅雷？（约 ${state.STATS.hours} 小时）`)) return;
    try {
      const r = await api('/api/send', { status: 'new' });
      toast(r.ok ? `已投递 ${r.count} 条` : '失败：' + r.error, 4000);
    } catch (e) { toast('请求失败：' + e.message); }
    load();
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
}

/* ---------------- 选中批操作 ---------------- */
const selTokens = () => [...state.SEL];

function initBulk() {
  $('#selSend').onclick = async () => {
    if (!state.SEL.size) return;
    try {
      const r = await api('/api/send', { tokens: selTokens(), force: true });
      toast(r.ok ? `已投递 ${r.count} 条` : '失败：' + r.error, 4000);
    } catch (e) { toast('请求失败'); }
    load();
  };

  const bulkFav = async on2 => {
    if (!state.SEL.size) return;
    try {
      const r = await api('/api/fav', { tokens: selTokens(), on: on2 });
      state.ROWS.forEach(x => { if (state.SEL.has(x.token)) x.fav = on2 ? '1' : ''; });
      state.STATS.favorites = Math.max(0, (state.STATS.favorites || 0) + (on2 ? r.count : -r.count));
      $('#kFav').textContent = state.STATS.favorites;
      render();
      toast(on2 ? `已收藏 ${r.count} 条` : `已取消收藏 ${r.count} 条`);
    } catch (e) { toast('操作失败'); }
  };
  $('#selFavToggle').onclick = () => bulkFav($('#selFavToggle').dataset.on !== '1');

  $('#selDone').onclick = async () => {
    if (!state.SEL.size) return;
    try {
      const r = await api('/api/mark', { tokens: selTokens(), status: 'done' });
      toast(`已标记 ${r.count} 条完成`); load();
    } catch (e) { toast('操作失败'); }
  };

  const bulkWatched = async on2 => {
    if (!state.SEL.size) return;
    try {
      const r = await api('/api/watched', { tokens: selTokens(), on: on2 });
      toast(on2 ? `已标记 ${r.count} 条已看` : `已标记 ${r.count} 条未看`);
      load();
    } catch (e) { toast('操作失败'); }
  };
  $('#selWatchedToggle').onclick = () => bulkWatched($('#selWatchedToggle').dataset.on !== '1');

  $('#selRate').addEventListener('click', async e => {
    if (!e.target.matches('i') || !state.SEL.size) return;
    const v = parseInt(e.target.dataset.v);
    try {
      const r = await api('/api/rate', { tokens: selTokens(), value: v });
      toast(`已给 ${r.count} 条打 ${v} 星`);
      load();
    } catch (err) { toast('打分失败'); }
  });

  $('#selDelete').onclick = () => { if (state.SEL.size) delFiles(selTokens(), false); };

  $('#selCopy').onclick = async () => {
    const links = state.ROWS.filter(r => state.SEL.has(r.token) && r.url).map(r => r.url);
    if (!links.length) return toast('没有可复制的链接');
    await navigator.clipboard.writeText(links.join('\n'));
    toast(`已复制 ${links.length} 条 URL`);
  };
}

/* ---------------- 初始化 ---------------- */
function initControls() {
  $('#chkCovers').checked = state.SHOW_COVERS;
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

on('reload', load);
on('play', tk => doPlay(tk));
on('gacha', () => drawCard());
on('delete', d => delFiles(d.tokens, d.purge));

load();
connectSse();
setInterval(() => { if (!state.BUSY) load(); }, 60000);
