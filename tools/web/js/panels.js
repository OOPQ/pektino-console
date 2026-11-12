/* panels.js — 灯箱、抽卡、设置抽屉、SSE、键盘 */
import { $, state, api, toast, emit, on, fmtMB, fmtNum, stTag } from './core.js';
import { render, visible } from './table.js';
import { doPlay } from './rows.js';

/* ================= 灯箱 ================= */
const META_W = 280, GAP = 18;

function metaRows(r, withRating = true, ratingHtml = null) {
  return `<div class="mhead"><b>${r.duration || '–'}</b><i>${r.res || '–'}</i></div>
    <div class="mrow"><span>站点观看</span><em>${fmtNum(r.views)}</em></div>
    <div class="mrow"><span>点赞</span><em>${fmtNum(r.likes)}</em></div>
    <div class="mrow"><span>状态</span><em>${stTag(r.status)}</em></div>
    <div class="mrow"><span>本地文件</span><em>${r.file_name ? '✓ ' + fmtMB(r.file_size) : '<span style="color:#7f8ea1">未下载</span>'}</em></div>
    ${withRating ? `<div class="mrow"><span>评分</span><em class="gold">${ratingHtml || [1, 2, 3, 4, 5].map(n => n <= (+r.rating || 0) ? '★' : '☆').join('')}</em></div>` : ''}
    <div class="mrow"><span>本地播放</span><em>${(+r.play_count || 0) ? '▶ ' + r.play_count + ' 次' : '无记录'}</em></div>
    ${r.file_name ? `<div class="mfile">${r.file_name}</div>` : ''}`;
}

function fitMedia(img, box) {
  if (!box || !img.naturalWidth) return;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const maxH = Math.min(innerHeight * 0.78, 920);
  const maxImgW = Math.min(innerWidth * 0.94 - META_W - GAP - 24, 900);
  const scale = Math.min(maxH / nh, maxImgW / nw, 1);
  const w = Math.max(160, Math.round(nw * scale));
  const h = Math.max(160, Math.round(nh * scale));
  img.style.width = w + 'px';
  img.style.height = h + 'px';
  box.style.width = (w + META_W + GAP) + 'px';
}
function bindFit(img, box) {
  img.onload = () => fitMedia(img, box);
  if (img.complete && img.naturalWidth) fitMedia(img, box);
}
function boxOf(sel) { return document.querySelector(sel + ' .box'); }

export function openLightbox(tk) {
  const r = state.ROWS.find(x => x.token === tk);
  if (!r) return;
  state.LB_TOKEN = tk;
  const img = $('#lbImg'), box = boxOf('#lightbox');
  img.style.width = ''; img.style.height = ''; box.style.width = '';
  bindFit(img, box);
  img.onerror = () => { img.onload = null; img.src = '/api/cover?token=' + encodeURIComponent(tk); };
  img.src = '/api/cover?token=' + encodeURIComponent(tk) + '&full=1';
  $('#lbToken').textContent = tk;
  $('#lbMeta').innerHTML = metaRows(r);
  $('#lbFav').textContent = (r.fav === '1' ? '★ 已收藏' : '☆ 收藏');
  $('#lightbox').classList.add('on');
}
const closeLightbox = () => { $('#lightbox').classList.remove('on'); state.LB_TOKEN = null; };

/* ================= 抽卡 ================= */
function gachaPool() {
  let pool = visible().filter(r => r.file_name);
  if (!pool.length) pool = state.ROWS.filter(r => r.file_name);
  return pool;
}
function pickWeighted(pool) {
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

export function drawCard() {
  const pool = gachaPool();
  if (!pool.length) return toast('没有可抽的条目 —— 先下载几个', 3000);
  const r = pickWeighted(pool);
  state.GACHA_TOKEN = r.token;

  const img = $('#gImg'), box = boxOf('#gacha');
  img.style.width = ''; img.style.height = ''; box.style.width = '';
  bindFit(img, box);
  img.onerror = () => { img.src = '/api/cover?token=' + encodeURIComponent(r.token); };
  img.src = '/api/cover?token=' + encodeURIComponent(r.token) + '&full=1';

  $('#gTok').textContent = r.token;
  $('#gInfo').innerHTML =
    `<div class="mrow"><span>抽到</span><em>${r.last_play ? '看过了' : '还没看'}</em></div>`
    + metaRows(r, true, '<span class="rt" id="gRate"></span>');
  renderGRate(+r.rating || 0);
  $('#gFav').textContent = r.fav === '1' ? '☆ 取消收藏' : '★ 收藏';
  $('#gacha').classList.add('on');
}

async function rateGacha(v) {
  const row = state.ROWS.find(x => x.token === state.GACHA_TOKEN);
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

/* ================= 抽屉 / SSE / 键盘 ================= */
export function connectSse() {
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('hello', () => { $('#sseInfo').textContent = 'SSE 已连接'; });
    es.addEventListener('state', () => { if (!state.BUSY) emit('reload'); });
    es.onerror = () => { $('#sseInfo').textContent = 'SSE 重连中…'; };
  } catch (e) { $('#sseInfo').textContent = 'SSE 不可用（走轮询）'; }
}

export function initPanels() {
  /* 灯箱 */
  $('#lbClose').onclick = closeLightbox;
  $('#lightbox').onclick = e => { if (e.target.id === 'lightbox') closeLightbox(); };
  $('#lbPlay').onclick = () => { if (state.LB_TOKEN) doPlay(state.LB_TOKEN); };
  $('#lbReveal').onclick = async () => {
    try { await api('/api/reveal', { token: state.LB_TOKEN }); } catch (e) { }
  };
  $('#lbCopy').onclick = async () => {
    const r = state.ROWS.find(x => x.token === state.LB_TOKEN);
    if (r && r.url) { await navigator.clipboard.writeText(r.url); toast('URL 已复制'); }
  };
  $('#lbOpen').onclick = () => { if (state.LB_TOKEN) window.open('https://pektino.com/zh-CN/movie/' + state.LB_TOKEN, '_blank'); };
  $('#lbCopyToken').onclick = async () => { if (state.LB_TOKEN) { await navigator.clipboard.writeText(state.LB_TOKEN); toast('token 已复制'); } };
  $('#lbFav').onclick = async () => {
    const row = state.ROWS.find(x => x.token === state.LB_TOKEN);
    if (!row) return;
    const on2 = row.fav !== '1';
    try {
      const res = await api('/api/fav', { tokens: [row.token], on: on2 });
      if (res.ok) { row.fav = on2 ? '1' : ''; $('#lbFav').textContent = on2 ? '★ 已收藏' : '☆ 收藏'; render(); }
    } catch (e) { toast('收藏失败'); }
  };
  window.addEventListener('resize', () => {
    if ($('#lightbox').classList.contains('on')) fitMedia($('#lbImg'), boxOf('#lightbox'));
    if ($('#gacha').classList.contains('on')) fitMedia($('#gImg'), boxOf('#gacha'));
  });

  /* 抽卡 */
  $('#btnGacha').onclick = drawCard;
  $('#gAgain').onclick = drawCard;
  $('#gClose').onclick = () => $('#gacha').classList.remove('on');
  $('#gacha').onclick = e => { if (e.target.id === 'gacha') $('#gacha').classList.remove('on'); };
  $('#gPlay').onclick = () => { if (state.GACHA_TOKEN) doPlay(state.GACHA_TOKEN); };
  $('#gReveal').onclick = async () => {
    if (!state.GACHA_TOKEN) return;
    try { const r = await api('/api/reveal', { token: state.GACHA_TOKEN }); if (!r.ok) toast(r.error); }
    catch (e) { toast('定位失败'); }
  };
  $('#gOpen').onclick = () => { if (state.GACHA_TOKEN) window.open('https://pektino.com/zh-CN/movie/' + state.GACHA_TOKEN, '_blank'); };
  $('#gCopy').onclick = async () => {
    const r = state.ROWS.find(x => x.token === state.GACHA_TOKEN);
    if (r && r.url) { await navigator.clipboard.writeText(r.url); toast('URL 已复制'); }
  };
  $('#gFav').onclick = async () => {
    const r = state.ROWS.find(x => x.token === state.GACHA_TOKEN);
    if (!r) return;
    const on2 = r.fav !== '1';
    try {
      const res = await api('/api/fav', { tokens: [r.token], on: on2 });
      if (res.ok) {
        r.fav = on2 ? '1' : '';
        $('#gFav').textContent = on2 ? '☆ 取消收藏' : '★ 收藏';
        state.STATS.favorites = Math.max(0, (state.STATS.favorites || 0) + (on2 ? 1 : -1));
        const kf = $('#kFav'); if (kf) kf.textContent = state.STATS.favorites;
        render();
      }
    } catch (e) { toast('操作失败'); }
  };
  /* 评分星星是每次抽卡动态生成的，用事件委托绑定 */
  document.addEventListener('click', e => {
    const star = e.target.closest('#gRate i');
    if (star) rateGacha(parseInt(star.dataset.v));
  });

  /* 抽屉 */
  $('#btnSettings').onclick = () => $('#drawer').classList.add('on');
  $('#btnLog').onclick = () => $('#drawer').classList.add('on');
  $('#drawer').onclick = e => { if (e.target.id === 'drawer') $('#drawer').classList.remove('on'); };

  /* 键盘 */
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
      else if ($('#ctxmenu').classList.contains('on')) emit('close-ctx');
      else if (document.activeElement === $('#q')) {
        $('#q').value = ''; state.FILTER.q = ''; PREFS_q(''); render();
      }
    }
  });

  /* 灯箱请求 → 打开 */
  on('open-lightbox', tk => openLightbox(tk));
}

/* 小工具：清空查询时同步偏好（避免 panels 直接依赖 PREFS 模块级导入） */
function PREFS_q(v) {
  try {
    const raw = JSON.parse(localStorage.getItem('pektino.ui.v3') || '{}');
    raw.q = v;
    localStorage.setItem('pektino.ui.v3', JSON.stringify(raw));
  } catch (e) { }
}
