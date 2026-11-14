/* panels.js — 灯箱、抽卡、设置抽屉、SSE、键盘
   灯箱与抽卡共用同一套布局：img + .meta 网格、同一个 fitMedia()、同一份 info 行 */
import { $, state, api, toast, fmtMB, fmtNum, stTag, starsInner, emit, onEvent } from './core.js';
import { render, visible } from './table.js';
import { doPlay } from './rows.js';
import { siteUrl, copyText, setRating, setFav } from './actions.js';

const META_W = 280, GAP = 18;
const boxOf = sel => document.querySelector(sel + ' .box');

/* 预览里点“空白”是否应该关闭：避开视频/图片/按钮/星级/标签等可交互元素 */
function isBlankPreviewTarget(t) {
  if (!t || !t.closest) return false;
  if (t.closest('button, video, img, a, input, select, textarea, .rt, .star, .tag')) return false;
  if (t.id === 'lightbox' || t.id === 'gacha') return true;
  if (t.classList && (t.classList.contains('box') || t.classList.contains('meta') ||
      t.classList.contains('mstats') || t.classList.contains('actions'))) return true;
  if (t.id === 'lbMedia' || t.id === 'gMedia') return true;
  return false;
}

/* ================= 信息行（灯箱 / 抽卡共用） ================= */
function metaRows(r, opts = {}) {
  const { withRating = true, ratingHtml = null, extraTop = '' } = opts;
  const rating = ratingHtml || [1, 2, 3, 4, 5].map(n => n <= (+r.rating || 0) ? '★' : '☆').join('');
  return `${extraTop}
    <div class="mhead"><b>${r.duration || '–'}</b><i>${r.res || '–'}</i></div>
    <div class="mrow"><span>站点观看</span><em>${fmtNum(r.views)}</em></div>
    <div class="mrow"><span>点赞</span><em>${fmtNum(r.likes)}</em></div>
    <div class="mrow"><span>状态</span><em>${stTag(r.status)}</em></div>
    <div class="mrow"><span>本地文件</span><em>${r.file_name ? '✓ ' + fmtMB(r.file_size) : '<span style="color:#7f8ea1">未下载</span>'}</em></div>
    ${withRating ? `<div class="mrow"><span>评分</span><em class="gold">${rating}</em></div>` : ''}
    <div class="mrow"><span>本地播放</span><em>${(+r.play_count || 0) ? '▶ ' + r.play_count + ' 次' : '无记录'}</em></div>
    ${r.file_name ? `<div class="mfile">${r.file_name}</div>` : ''}`;
}

/* ================= 图片自适应（灯箱 / 抽卡共用） ================= */
function fitMedia(img, box) {
  if (!box || !img.naturalWidth) return;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const maxH = Math.min(innerHeight * 0.78, 920);
  const maxImgW = Math.min(innerWidth * 0.94 - META_W - GAP - 24, 900);
  const scale = Math.min(maxH / nh, maxImgW / nw, 1);   // 不放大，避免糊
  const w = Math.max(160, Math.round(nw * scale));
  const h = Math.max(160, Math.round(nh * scale));
  img.style.width = w + 'px';
  img.style.height = h + 'px';
  box.style.width = (w + META_W + GAP) + 'px';
}

function loadCover(img, box, token) {
  img.style.width = ''; img.style.height = ''; box.style.width = '';
  let triedThumb = false;
  img.onload = () => fitMedia(img, box);
  img.onerror = () => {
    if (!triedThumb) {
      // 只回退一次到缩略图；再失败就显示占位，避免同一个 404 反复重试
      triedThumb = true;
      img.src = '/api/cover?token=' + encodeURIComponent(token);
      return;
    }
    img.onload = null; img.onerror = null;
    img.removeAttribute('src');
    box.classList.add('nocover');
    // 没有封面时别撑着一整块空白：按占位尺寸收窄
    box.style.width = (180 + META_W + GAP) + 'px';
  };
  img.src = '/api/cover?token=' + encodeURIComponent(token) + '&full=1';
  if (img.complete && img.naturalWidth) fitMedia(img, box);
}

/* ================= 收藏（灯箱 / 抽卡共用） ================= */
async function togglePreviewFav(token, kind) {
  const row = state.ROWS.find(x => x.token === token);
  if (!row) { toast('找不到这条数据，刷新页面再试', 3000); return; }
  const btn = kind === 'g' ? $('#gFav') : $('#lbFav');
  const next = row.fav !== '1';
  const r = await setFav([token], next);
  if (!r || !r.ok) { toast('收藏失败：' + ((r && r.error) || '未知错误'), 4000); return; }
  if (btn) {
    btn.textContent = kind === 'g'
      ? (next ? '☆ 取消收藏' : '★ 收藏')
      : (next ? '★ 已收藏' : '☆ 收藏');
  }
  render();
  toast(next ? '已收藏' : '已取消收藏', 1800);
}

/* ================= 播放器（预览灯箱 / 抽卡共用） ================= */
let lbList = [];      // 当前筛选结果里的 token 顺序，用于 Ctrl+←/→ 切换
let lbIdx = -1;
let lbPlaying = false;
let gPlaying = false;

const PLAYERS = {
  lb: { img: '#lbImg', video: '#lbVideo', overlay: '#lbPlayOverlay', pip: '#lbPip' },
  g: { img: '#gImg', video: '#gVideo', overlay: '#gPlayOverlay', pip: '#gPip' }
};

const isPip = v => !!v && document.pictureInPictureElement === v;

/* 长按空格临时 2×：按住生效，松开恢复；短按仍然是 播放/暂停 */
let spaceHold = null;
function showSpeed(key, on) {
  const el = key === 'g' ? $('#gSpeed') : $('#lbSpeed');
  if (el) el.hidden = !on;
}
function startSpaceHold(key, forceHold) {
  if (spaceHold) return;
  const v = $(PLAYERS[key].video);
  if (!v || v.hidden) return;
  const wasPaused = forceHold ? true : v.paused;
  if (wasPaused) { const p = v.play(); if (p && p.catch) p.catch(() => { }); }
  const st = { key, video: v, wasPaused, boosted: false, baseRate: 1, timer: null };
  try { st.baseRate = v.playbackRate || 1; } catch { }
  st.timer = setTimeout(() => {
    if (spaceHold !== st) return;
    st.boosted = true;
    try { st.video.playbackRate = Math.min(16, st.baseRate * 2); } catch { }
    showSpeed(key, true);
  }, 260);
  spaceHold = st;
}
function endSpaceHold() {
  const st = spaceHold;
  if (!st) return;
  spaceHold = null;
  clearTimeout(st.timer);
  if (st.boosted) {
    try { st.video.playbackRate = st.baseRate || 1; } catch { }
    showSpeed(st.key, false);
  } else if (!st.wasPaused && !st.video.hidden) {
    // 短按（一直按着不到 260ms）→ 当作 暂停
    try { st.video.pause(); } catch { }
  }
}

/* ←/→ 快退/快进 5 秒（不需要视频聚焦） */
function showSeekBadge(key, text) {
  const el = key === 'g' ? $('#gSeek') : $('#lbSeek');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  if (el._t) clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 700);
}
function seekBy(key, delta) {
  const v = $(PLAYERS[key].video);
  if (!v || v.hidden) return;
  let t = v.currentTime + delta;
  const dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
  if (t < 0) t = 0;
  if (dur && t > dur - 0.05) t = Math.max(0, dur - 0.05);
  try { v.currentTime = t; } catch { }
  showSeekBadge(key, delta < 0 ? '−5s' : '+5s');
}

function stopPlayer(key) {
  const ctx = PLAYERS[key];
  const v = $(ctx.video);
  if (key === 'lb') lbPlaying = false; else gPlaying = false;
  if (!v) return;
  if (spaceHold && spaceHold.key === key) { clearTimeout(spaceHold.timer); spaceHold = null; }
  showSpeed(key, false);
  if (isPip(v)) { try { document.exitPictureInPicture(); } catch { } }
  try { v.playbackRate = 1; } catch { }
  try { v.pause(); } catch { }
  v.hidden = true;
  v.removeAttribute('src');
  try { v.load(); } catch { }
  const ov = $(ctx.overlay);
  if (ov) ov.hidden = false;
  const pip = $(ctx.pip);
  if (pip) pip.disabled = true;
}

function playToken(key, tk, opts = {}) {
  const ctx = PLAYERS[key];
  const row = state.ROWS.find(x => x.token === tk);
  if (!row || !row.file_name) {
    if (!opts.quiet) toast('这条还没下载，先下载再播放', 3000);
    return false;
  }
  const m = state.MEDIA;
  if (!m || !m.base) {
    toast('媒体服务没有启动：用 start.cmd -Restart 重启控制台后重试', 5000);
    return false;
  }
  const v = $(ctx.video);
  if (!v) return false;
  // 视频绝对定位盖在封面上（尺寸跟封面一致），所以不用改封面/容器的尺寸
  v.hidden = false;
  const ov = $(ctx.overlay);
  if (ov) ov.hidden = true;
  const pip = $(ctx.pip);
  if (pip) pip.disabled = false;
  v.onerror = () => {
    toast('浏览器播不了这个文件，试试「本地播放器」', 5000);
    v.hidden = true;
    if (ov) ov.hidden = false;
    if (key === 'lb') lbPlaying = false; else gPlaying = false;
  };
  v.src = `${m.base}/${encodeURIComponent(tk)}.mp4?k=${encodeURIComponent(m.key)}`;
  try { v.playbackRate = 1; } catch { }
  const p = v.play();
  if (p && p.catch) p.catch(() => { });
  if (key === 'lb') lbPlaying = true; else gPlaying = true;
  // 记一次播放（浏览器内播放，不打开系统播放器）
  api('/api/play', { token: tk, count: true }).then(r => {
    if (!r || !r.ok) return;
    const row2 = state.ROWS.find(x => x.token === tk);
    if (row2) { row2.play_count = r.plays; row2.last_play = r.last_play; }
  }).catch(() => { });
  return true;
}

function togglePlay(key, tk) {
  const v = $(PLAYERS[key].video);
  if (!v) return;
  if (v.hidden) { playToken(key, tk); return; }
  if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => { }); }
  else { try { v.pause(); } catch { } }
}

async function togglePip(key) {
  const v = $(PLAYERS[key].video);
  if (!v) return;
  try {
    if (isPip(v)) { await document.exitPictureInPicture(); return; }
    if (!document.pictureInPictureEnabled || !v.requestPictureInPicture) {
      toast('这个浏览器不支持画中画', 3000);
      return;
    }
    if (v.hidden) { toast('先播放再开画中画', 2500); return; }
    await v.requestPictureInPicture();
  } catch (e) {
    toast('画中画失败：' + (e.message || '浏览器不支持'), 4000);
  }
}

function toggleFullscreen(v) {
  if (!v || v.hidden) return;
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => { }); return; }
  if (v.requestFullscreen) v.requestFullscreen().catch(() => { toast('全屏失败', 3000); });
}

function lbPaint(tk) {
  const r = state.ROWS.find(x => x.token === tk);
  if (!r) return false;
  state.LB_TOKEN = tk;
  const box = boxOf('#lightbox');
  box.classList.remove('nocover');
  loadCover($('#lbImg'), box, tk);
  $('#lbToken').textContent = tk;
  $('#lbMeta').innerHTML = metaRows(r, { ratingHtml: '<span class="rt" id="lbRate" title="点击打分，再点同一颗清除；数字键 1–5"></span>' });
  renderLRate(+r.rating || 0);
  $('#lbFav').textContent = r.fav === '1' ? '★ 已收藏' : '☆ 收藏';
  $('#lbCount').textContent = lbList.length ? `${lbIdx + 1} / ${lbList.length}` : '';
  const multi = lbList.length > 1;
  if ($('#lbPrev')) $('#lbPrev').hidden = !multi;
  if ($('#lbNext')) $('#lbNext').hidden = !multi;

  // 没下载的条目没有可播文件：隐藏播放入口，避免点了报错
  const canPlay = !!r.file_name;
  const img = $('#lbImg'), ov = $('#lbPlayOverlay'), ext = $('#lbPlay'), pip = $('#lbPip');
  if (ov) ov.hidden = !canPlay;
  if (pip) pip.disabled = true;   // 播放后才允许画中画
  if (img) {
    img.classList.toggle('canplay', canPlay);
    img.title = canPlay ? '点击用浏览器播放（空格播放/暂停，F 全屏）' : '这条还没下载，先下载再播放';
  }
  if (ext) {
    ext.disabled = !canPlay;
    ext.textContent = canPlay ? '本地播放器' : '未下载';
  }
  return true;
}

export function openLightbox(tk, opts = {}) {
  const r = state.ROWS.find(x => x.token === tk);
  if (!r) return;
  // 切换范围 = 当前筛选/排序后的整份列表（跨页也能连续翻）。
  // 从下载队列点进来时，条目可能不在当前筛选结果里 → 退回全量列表
  let list = visible().map(x => x.token);
  if (!list.includes(tk)) list = state.ROWS.map(x => x.token);
  lbList = list;
  lbIdx = lbList.indexOf(tk);
  lbPlaying = false;
  stopPlayer('lb');
  lbPaint(tk);
  $('#lightbox').classList.add('on');
  // 从下载队列进来：直接开播（预览封面 + 视频立即播放）
  if (opts.autoplay && r.file_name) playToken('lb', tk);
}

export function navLightbox(delta) {
  if (!$('#lightbox').classList.contains('on') || !lbList.length) return;
  lbIdx = (lbIdx + delta + lbList.length) % lbList.length;
  const tk = lbList[lbIdx];
  const wasPlaying = lbPlaying;
  stopPlayer('lb');
  if (!lbPaint(tk)) return;
  const target = state.ROWS.find(x => x.token === tk);
  if (wasPlaying && target && target.file_name) playToken('lb', tk, { quiet: true });
}

const closeLightbox = () => {
  const v = $('#lbVideo');
  // 画中画里还在播：关掉灯箱但别停视频，让画中画继续
  if (isPip(v)) { lbPlaying = false; }
  else stopPlayer('lb');
  $('#lightbox').classList.remove('on');
  state.LB_TOKEN = null;
};

/* ================= 抽卡 ================= */
function gachaPool() {
  const pool = visible().filter(r => r.file_name);
  return pool.length ? pool : state.ROWS.filter(r => r.file_name);
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
  if (el) el.innerHTML = starsInner(v);
  $('#gRateHint').textContent = v > 0
    ? `${v} 星 · 再点同一颗可清除；按 1–5 改分，空格播放/暂停，F 全屏，R 再抽，Esc 关闭`
    : '点星星打分，或按 1–5；空格播放/暂停，F 全屏，R 再抽，Esc 关闭';
}

export function drawCard() {
  const pool = gachaPool();
  if (!pool.length) return toast('没有可抽的条目 —— 先下载几个', 3000);
  const r = pickWeighted(pool);
  state.GACHA_TOKEN = r.token;

  stopPlayer('g');
  const box = boxOf('#gacha');
  box.classList.remove('nocover');
  loadCover($('#gImg'), box, r.token);
  $('#gPlayOverlay').hidden = false;
  $('#gPip').disabled = true;
  $('#gTok').textContent = r.token;
  $('#gInfo').innerHTML = metaRows(r, {
    ratingHtml: '<span class="rt" id="gRate"></span>',
    extraTop: `<div class="mrow"><span>抽到</span><em>${r.last_play ? '看过了' : '还没看'}</em></div>`
  });
  renderGRate(+r.rating || 0);
  $('#gFav').textContent = r.fav === '1' ? '☆ 取消收藏' : '★ 收藏';
  $('#gacha').classList.add('on');
}

async function rateGacha(v) {
  const row = state.ROWS.find(x => x.token === state.GACHA_TOKEN);
  if (!row) return;
  const val = ((+row.rating || 0) === v) ? 0 : v;
  const r = await setRating([row.token], val);
  if (!r.ok) return;
  renderGRate(val);
  render();
  toast(val ? `已打 ${val} 星` : '已清除评分');
}

/* 灯箱预览里的打分：点同一颗清空，数字键 1–5 也可以 */
function renderLRate(v) {
  const el = $('#lbRate');
  if (el) el.innerHTML = starsInner(v);
}
async function rateLightbox(v) {
  const row = state.ROWS.find(x => x.token === state.LB_TOKEN);
  if (!row) return;
  const val = ((+row.rating || 0) === v) ? 0 : v;
  const r = await setRating([row.token], val);
  if (!r || !r.ok) { toast((r && r.error) || '打分失败', 4000); return; }
  renderLRate(val);
  render();
  toast(val ? `已打 ${val} 星` : '已清除评分', 1800);
}

const closeGacha = () => {
  const v = $('#gVideo');
  if (isPip(v)) { gPlaying = false; }
  else stopPlayer('g');
  $('#gacha').classList.remove('on');
};

/* ================= SSE ================= */
export function connectSse() {
  try {
    const es = new EventSource('/api/events');
    // 重连后补一次全量：断线期间的变化不会自己冒出来
    es.addEventListener('hello', () => { $('#sseInfo').textContent = 'SSE 已连接'; emit('reload'); });
    es.addEventListener('state', () => { if (!state.BUSY) emit('reload'); });
    es.onerror = () => { $('#sseInfo').textContent = 'SSE 重连中…'; };
  } catch (e) {
    $('#sseInfo').textContent = 'SSE 不可用（走轮询）';
  }
}

/* ================= 初始化 ================= */
export function initPanels() {
  /* 灯箱 */
  $('#lbClose').onclick = closeLightbox;
  $('#lightbox').onclick = e => { if (isBlankPreviewTarget(e.target)) closeLightbox(); };
  // 点封面/播放浮层/空白处：原地切到浏览器内播放（没下载的条目直接忽略；视频控件区域除外）
  $('#lbImg').onclick = e => {
    e.stopPropagation();
    const r = state.ROWS.find(x => x.token === state.LB_TOKEN);
    if (r && r.file_name) playToken('lb', state.LB_TOKEN);
  };
  $('#lbPlayOverlay').onclick = e => {
    e.stopPropagation();
    if (state.LB_TOKEN) playToken('lb', state.LB_TOKEN);
  };
  $('#lbMedia').onclick = e => {
    if (e.target.closest('video')) return;
    const r = state.ROWS.find(x => x.token === state.LB_TOKEN);
    if (r && r.file_name) playToken('lb', state.LB_TOKEN);
  };
  $('#lbPip').onclick = () => togglePip('lb');
  $('#lbPrev').onclick = () => navLightbox(-1);
  $('#lbNext').onclick = () => navLightbox(1);
  $('#lbPlay').onclick = () => { if (state.LB_TOKEN) doPlay(state.LB_TOKEN); };
  $('#lbReveal').onclick = async () => {
    try { const r = await api('/api/reveal', { token: state.LB_TOKEN }); if (!r.ok) toast('定位失败：' + (r.error || '文件不在本地')); } catch (e) { toast('定位失败'); }
  };
  $('#lbCopy').onclick = () => {
    const r = state.ROWS.find(x => x.token === state.LB_TOKEN);
    return copyText(r && r.url, 'URL 已复制');
  };
  $('#lbCopyToken').onclick = () => copyText(state.LB_TOKEN, 'token 已复制');
  $('#lbOpen').onclick = () => { if (state.LB_TOKEN) window.open(siteUrl(state.LB_TOKEN), '_blank'); };
  $('#lbFav').onclick = () => togglePreviewFav(state.LB_TOKEN, 'lb');

  /* 抽卡 */
  $('#btnGacha').onclick = drawCard;
  $('#gAgain').onclick = drawCard;
  $('#gClose').onclick = closeGacha;
  $('#gacha').onclick = e => { if (isBlankPreviewTarget(e.target)) closeGacha(); };
  $('#gImg').onclick = e => { e.stopPropagation(); if (state.GACHA_TOKEN) playToken('g', state.GACHA_TOKEN); };
  $('#gPlayOverlay').onclick = e => { e.stopPropagation(); if (state.GACHA_TOKEN) playToken('g', state.GACHA_TOKEN); };
  $('#gMedia').onclick = e => {
    if (e.target.closest('video')) return;
    if (state.GACHA_TOKEN) playToken('g', state.GACHA_TOKEN);
  };
  $('#gPip').onclick = () => togglePip('g');
  $('#gPlay').onclick = () => { if (state.GACHA_TOKEN) doPlay(state.GACHA_TOKEN); };
  $('#gReveal').onclick = async () => {
    if (!state.GACHA_TOKEN) return;
    try {
      const r = await api('/api/reveal', { token: state.GACHA_TOKEN });
      if (!r.ok) toast(r.error);
    } catch (e) { toast('定位失败'); }
  };
  $('#gCopy').onclick = () => {
    const r = state.ROWS.find(x => x.token === state.GACHA_TOKEN);
    return copyText(r && r.url, 'URL 已复制');
  };
  $('#gOpen').onclick = () => { if (state.GACHA_TOKEN) window.open(siteUrl(state.GACHA_TOKEN), '_blank'); };
  $('#gFav').onclick = () => togglePreviewFav(state.GACHA_TOKEN, 'g');

  /* 星星是动态生成的 → 事件委托 */
  document.addEventListener('click', e => {
    const gstar = e.target.closest('#gRate i');
    if (gstar) { rateGacha(parseInt(gstar.dataset.v)); return; }
    const lstar = e.target.closest('#lbRate i');
    if (lstar) rateLightbox(parseInt(lstar.dataset.v));
  });

  /* 窗口缩放时重新适配图片 */
  window.addEventListener('resize', () => {
    if ($('#lightbox').classList.contains('on')) fitMedia($('#lbImg'), boxOf('#lightbox'));
    if ($('#gacha').classList.contains('on')) fitMedia($('#gImg'), boxOf('#gacha'));
  });

  /* 抽屉 */
  $('#btnSettings').onclick = () => $('#drawer').classList.add('on');
  $('#btnLog').onclick = () => $('#drawer').classList.add('on');
  $('#drawer').onclick = e => { if (e.target.id === 'drawer') $('#drawer').classList.remove('on'); };

  /* 键盘：capture 阶段拦截，避免视频控件先吃掉方向键/空格 */
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    const gachaOpen = $('#gacha').classList.contains('on');
    const lbOpen = $('#lightbox').classList.contains('on');
    // 预览里用 Ctrl+←/→ 切换上一项/下一项（不用单按方向键，避免和视频/页面快捷键冲突）
    if (lbOpen && !typing && e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); e.stopPropagation();
      navLightbox(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    // 单按 ←/→：快退/快进 5 秒（不需要先点视频）
    if ((lbOpen || gachaOpen) && !typing && !e.ctrlKey && !e.altKey && !e.metaKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); e.stopPropagation();
      seekBy(gachaOpen ? 'g' : 'lb', e.key === 'ArrowLeft' ? -5 : 5);
      return;
    }
    // 单按 ↑/↓：音量 ±5%
    if ((lbOpen || gachaOpen) && !typing && !e.ctrlKey && !e.altKey && !e.metaKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      const vkey = gachaOpen ? 'g' : 'lb';
      const v = $(PLAYERS[vkey].video);
      if (v && !v.hidden) {
        const step = e.key === 'ArrowUp' ? 0.05 : -0.05;
        let vol = Math.round((v.volume + step) * 100) / 100;
        vol = Math.max(0, Math.min(1, vol));
        v.volume = vol;
        if (vol > 0 && v.muted) v.muted = false;
        showSeekBadge(vkey, v.muted ? '静音' : `音量 ${Math.round(vol * 100)}%`);
      }
      return;
    }
    if (lbOpen && !typing && /^[1-5]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); rateLightbox(parseInt(e.key)); return; }
    if (gachaOpen && /^[1-5]$/.test(e.key) && !typing) { e.preventDefault(); e.stopPropagation(); rateGacha(parseInt(e.key)); return; }
    // 播放快捷键：空格 播放/暂停（长按 2×），F 全屏，M 静音（灯箱和抽卡都生效）
    if ((lbOpen || gachaOpen) && !typing) {
      const pkey = gachaOpen ? 'g' : 'lb';
      const ptoken = gachaOpen ? state.GACHA_TOKEN : state.LB_TOKEN;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat) return;
        const v = $(PLAYERS[pkey].video);
        if (!v) return;
        let started = false;
        if (v.hidden) { togglePlay(pkey, ptoken); started = true; }
        if (!v.hidden) startSpaceHold(pkey, started);
        return;
      }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopPropagation(); toggleFullscreen($(PLAYERS[pkey].video)); return; }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault(); e.stopPropagation();
        const v = $(PLAYERS[pkey].video);
        if (v && !v.hidden) { v.muted = !v.muted; toast(v.muted ? '已静音' : '已取消静音', 1500); }
        return;
      }
    }
    if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
    if ((e.key === 'r' || e.key === 'R') && !typing) { e.preventDefault(); drawCard(); return; }
    if (e.key === 'Escape') {
      if ($('#scrapeModal').classList.contains('on')) $('#scrapeModal').classList.remove('on');
      else if ($('#gacha').classList.contains('on')) closeGacha();
      else if ($('#lightbox').classList.contains('on')) closeLightbox();
      else if ($('#dlDrawer').classList.contains('on')) $('#dlDrawer').classList.remove('on');
      else if ($('#binDrawer').classList.contains('on')) $('#binDrawer').classList.remove('on');
      else if ($('#colBrowser').classList.contains('on')) $('#colBrowser').classList.remove('on');
      else if ($('#colPick').classList.contains('on')) $('#colPick').classList.remove('on');
      else if ($('#drawer').classList.contains('on')) $('#drawer').classList.remove('on');
      else if ($('#ctxmenu').classList.contains('on')) emit('close-ctx');
      else if (document.activeElement === $('#q')) emit('clear-query');
    }
  }, true);

  /* 松开空格：结束长按加速；短按的播放/暂停在 endSpaceHold 里处理 */
  document.addEventListener('keyup', e => {
    if ((e.code === 'Space' || e.key === ' ') && spaceHold) {
      e.preventDefault(); e.stopPropagation();
      endSpaceHold();
    }
  }, true);
  window.addEventListener('blur', () => { if (spaceHold) endSpaceHold(); });

  /* 点视频后浏览器会把焦点留在 video 上（控件出现各种外框），
     播放/暂停、快进、全屏等快捷键我们已经接管 → 任何时候都不让 video 保持焦点 */
  ['#lbVideo', '#gVideo'].forEach(sel => {
    const v = $(sel);
    if (!v) return;
    v.tabIndex = -1;
    const dropFocus = () => { try { v.blur(); } catch { } };
    v.addEventListener('focus', () => { setTimeout(dropFocus, 0); });
    v.addEventListener('pointerup', dropFocus);
    v.addEventListener('click', dropFocus);
  });

  onEvent('open-lightbox', payload => {
    if (payload && typeof payload === 'object') openLightbox(payload.token, payload);
    else openLightbox(payload);
  });
}
