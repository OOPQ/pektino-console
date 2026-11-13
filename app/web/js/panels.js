/* panels.js — 灯箱、抽卡、设置抽屉、SSE、键盘
   灯箱与抽卡共用同一套布局：img + .meta 网格、同一个 fitMedia()、同一份 info 行 */
import { $, state, api, toast, fmtMB, fmtNum, stTag, starsInner, emit, onEvent } from './core.js';
import { render, visible } from './table.js';
import { doPlay } from './rows.js';
import { siteUrl, copyText, setRating, setFav } from './actions.js';

const META_W = 280, GAP = 18;
const boxOf = sel => document.querySelector(sel + ' .box');

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

/* ================= 灯箱（预览 + 浏览器内播放） ================= */
let lbList = [];      // 当前筛选结果里的 token 顺序，用于 ←/→ 切换
let lbIdx = -1;
let lbPlaying = false;

function lbPaint(tk) {
  const r = state.ROWS.find(x => x.token === tk);
  if (!r) return false;
  state.LB_TOKEN = tk;
  const box = boxOf('#lightbox');
  box.classList.remove('nocover');
  loadCover($('#lbImg'), box, tk);
  $('#lbToken').textContent = tk;
  $('#lbMeta').innerHTML = metaRows(r);
  $('#lbFav').textContent = r.fav === '1' ? '★ 已收藏' : '☆ 收藏';
  $('#lbCount').textContent = lbList.length ? `${lbIdx + 1} / ${lbList.length}` : '';
  const multi = lbList.length > 1;
  if ($('#lbPrev')) $('#lbPrev').hidden = !multi;
  if ($('#lbNext')) $('#lbNext').hidden = !multi;

  // 没下载的条目没有可播文件：隐藏播放入口，避免点了报错
  const canPlay = !!r.file_name;
  const img = $('#lbImg'), ov = $('#lbPlayOverlay'), ext = $('#lbPlay');
  if (ov) ov.hidden = !canPlay;
  if (img) {
    img.classList.toggle('canplay', canPlay);
    img.title = canPlay ? '点击用浏览器播放' : '这条还没下载，先下载再播放';
  }
  if (ext) {
    ext.disabled = !canPlay;
    ext.textContent = canPlay ? '本地播放器' : '未下载';
  }
  return true;
}

function lbStopVideo() {
  const v = $('#lbVideo');
  if (!v) return;
  lbPlaying = false;
  try { v.pause(); } catch { }
  v.hidden = true;
  v.removeAttribute('src');
  try { v.load(); } catch { }
  const ov = $('#lbPlayOverlay');
  if (ov) ov.hidden = false;
}

function lbPlayVideo(tk) {
  const row = state.ROWS.find(x => x.token === tk);
  if (!row || !row.file_name) {
    toast('这条还没下载，先下载再播放', 3000);
    return;
  }
  const m = state.MEDIA;
  if (!m || !m.base) {
    toast('媒体服务没有启动：用 start.cmd -Restart 重启控制台后重试', 5000);
    return;
  }
  const v = $('#lbVideo');
  if (!v) return;
  // 视频绝对定位盖在封面上（尺寸跟封面一致），所以不用改封面/容器的尺寸
  v.hidden = false;
  const ov = $('#lbPlayOverlay');
  if (ov) ov.hidden = true;
  v.onerror = () => {
    toast('浏览器播不了这个文件，试试「本地播放器」', 5000);
    v.hidden = true;
    if (ov) ov.hidden = false;
    lbPlaying = false;
  };
  v.src = `${m.base}/${encodeURIComponent(tk)}.mp4?k=${encodeURIComponent(m.key)}`;
  const p = v.play();
  if (p && p.catch) p.catch(() => { });
  lbPlaying = true;
  // 记一次播放（浏览器内播放，不打开系统播放器）
  api('/api/play', { token: tk, count: true }).then(r => {
    if (!r || !r.ok) return;
    const row2 = state.ROWS.find(x => x.token === tk);
    if (row2) { row2.play_count = r.plays; row2.last_play = r.last_play; }
  }).catch(() => { });
}

export function openLightbox(tk) {
  const r = state.ROWS.find(x => x.token === tk);
  if (!r) return;
  // 切换范围 = 当前筛选/排序后的整份列表（跨页也能连续翻）
  lbList = visible().map(x => x.token);
  lbIdx = lbList.indexOf(tk);
  lbPlaying = false;
  lbStopVideo();
  lbPaint(tk);
  $('#lightbox').classList.add('on');
}

export function navLightbox(delta) {
  if (!$('#lightbox').classList.contains('on') || !lbList.length) return;
  lbIdx = (lbIdx + delta + lbList.length) % lbList.length;
  const tk = lbList[lbIdx];
  const wasPlaying = lbPlaying;
  lbStopVideo();
  if (!lbPaint(tk)) return;
  const target = state.ROWS.find(x => x.token === tk);
  if (wasPlaying && target && target.file_name) lbPlayVideo(tk);
}

const closeLightbox = () => {
  lbStopVideo();
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
    ? `${v} 星 · 再点同一颗可清除；按 1–5 改分，R 再抽，Esc 关闭`
    : '点星星打分，或按 1–5；R 再抽，Esc 关闭';
}

export function drawCard() {
  const pool = gachaPool();
  if (!pool.length) return toast('没有可抽的条目 —— 先下载几个', 3000);
  const r = pickWeighted(pool);
  state.GACHA_TOKEN = r.token;

  loadCover($('#gImg'), boxOf('#gacha'), r.token);
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
  $('#lightbox').onclick = e => { if (e.target.id === 'lightbox') closeLightbox(); };
  // 点封面 / 播放按钮：原地切到浏览器内播放（没下载的条目直接忽略）
  $('#lbImg').onclick = () => {
    const r = state.ROWS.find(x => x.token === state.LB_TOKEN);
    if (r && r.file_name) lbPlayVideo(state.LB_TOKEN);
  };
  $('#lbPlayOverlay').onclick = () => { if (state.LB_TOKEN) lbPlayVideo(state.LB_TOKEN); };
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
  $('#lbFav').onclick = async () => {
    const row = state.ROWS.find(x => x.token === state.LB_TOKEN);
    if (!row) return;
    const next = row.fav !== '1';
    const r = await setFav([row.token], next);
    if (r.ok) { $('#lbFav').textContent = next ? '★ 已收藏' : '☆ 收藏'; render(); }
  };

  /* 抽卡 */
  $('#btnGacha').onclick = drawCard;
  $('#gAgain').onclick = drawCard;
  $('#gClose').onclick = () => $('#gacha').classList.remove('on');
  $('#gacha').onclick = e => { if (e.target.id === 'gacha') $('#gacha').classList.remove('on'); };
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
  $('#gFav').onclick = async () => {
    const row = state.ROWS.find(x => x.token === state.GACHA_TOKEN);
    if (!row) return;
    const next = row.fav !== '1';
    const r = await setFav([row.token], next);
    if (r.ok) { $('#gFav').textContent = next ? '☆ 取消收藏' : '★ 收藏'; render(); }
  };

  /* 星星是动态生成的 → 事件委托 */
  document.addEventListener('click', e => {
    const star = e.target.closest('#gRate i');
    if (star) rateGacha(parseInt(star.dataset.v));
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

  /* 键盘 */
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    const gachaOpen = $('#gacha').classList.contains('on');
    const lbOpen = $('#lightbox').classList.contains('on');
    // 预览里用 ←/→ 切换上一项/下一项；视频控件聚焦时让方向键留给进度条
    if (lbOpen && !typing && e.target.tagName !== 'VIDEO' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      navLightbox(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (gachaOpen && /^[1-5]$/.test(e.key) && !typing) { e.preventDefault(); rateGacha(parseInt(e.key)); return; }
    if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
    if ((e.key === 'r' || e.key === 'R') && !typing) { e.preventDefault(); drawCard(); return; }
    if (e.key === 'Escape') {
      if ($('#scrapeModal').classList.contains('on')) $('#scrapeModal').classList.remove('on');
      else if ($('#gacha').classList.contains('on')) $('#gacha').classList.remove('on');
      else if ($('#lightbox').classList.contains('on')) closeLightbox();
      else if ($('#dlDrawer').classList.contains('on')) $('#dlDrawer').classList.remove('on');
      else if ($('#drawer').classList.contains('on')) $('#drawer').classList.remove('on');
      else if ($('#ctxmenu').classList.contains('on')) emit('close-ctx');
      else if (document.activeElement === $('#q')) emit('clear-query');
    }
  });

  onEvent('open-lightbox', tk => openLightbox(tk));
}
