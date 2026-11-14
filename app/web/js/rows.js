/* rows.js — 行选择、行内操作、右键菜单、播放、删除、批量操作 */
import {
  $, state, STATUS_LABEL, api, toast, starsHtml, emit, onEvent
} from './core.js';
import { visible, render, renderSel } from './table.js';
import {
  siteUrl, copyText, setRating, setFav, setWatched, setStatus, reload
} from './actions.js';

/* ================= 选择（Shift 范围） ================= */
let LAST_IDX = null, LAST_TOKEN = null, SHIFT_DOWN = false;

// 排序/筛选/刷新后可见顺序会变，旧的索引不再可靠 → 用 token 重新定位
onEvent('reload', () => { LAST_IDX = null; LAST_TOKEN = null; });

function handleSelect(cb, shift) {
  const tk = cb.dataset.tk, idx = parseInt(cb.dataset.idx);
  // 用上一次点击的 token 在当前可见列表里重新算下标，避免排序后选错区间
  let lastIdx = LAST_IDX;
  if (shift && LAST_TOKEN) {
    const vi = visible().findIndex(x => x.token === LAST_TOKEN);
    if (vi >= 0) lastIdx = vi;
  }
  if (shift && lastIdx !== null && !isNaN(idx)) {
    const lo = Math.min(lastIdx, idx), hi = Math.max(lastIdx, idx);
    const all = visible();
    for (let k = lo; k <= hi; k++) {
      const r = all[k]; if (!r) continue;
      cb.checked ? state.SEL.add(r.token) : state.SEL.delete(r.token);
    }
  } else {
    cb.checked ? state.SEL.add(tk) : state.SEL.delete(tk);
  }
  LAST_IDX = isNaN(idx) ? null : idx;
  LAST_TOKEN = tk || null;
  document.querySelectorAll('#tbody input[type=checkbox]').forEach(box => {
    box.checked = state.SEL.has(box.dataset.tk);
  });
  const boxes = [...document.querySelectorAll('#tbody input[type=checkbox]')];
  $('#chkAll').checked = boxes.length > 0 && boxes.every(b => b.checked);
  renderSel();
}

/* ================= 多选模式 ================= */
export function toggleMulti() {
  state.MULTI = !state.MULTI;
  document.body.classList.toggle('multi', state.MULTI);
  const b = $('#btnMulti');
  if (b) { b.classList.toggle('on', state.MULTI); b.textContent = state.MULTI ? '多选完成' : '多选'; }
  if (!state.MULTI) state.SEL.clear();
  render();
  renderSel();
}

export function toggleCardSel(tk) {
  if (!tk) return;
  if (state.SEL.has(tk)) state.SEL.delete(tk); else state.SEL.add(tk);
  render();
  renderSel();
}
/* ================= 画廊滑动多选 ================= */
let GALLERY_DRAG = null, SUPPRESS_GALLERY_CLICK = false;
function paintCardSelected(tk) {
  const c = [...document.querySelectorAll('#gallery .card')].find(x => x.dataset.row === tk);
  if (!c) return;
  const on = state.SEL.has(tk);
  c.classList.toggle('sel', on);
  const b = c.querySelector('.selcard');
  if (b) b.classList.toggle('on', on);
}
function setCardSelected(tk, on) {
  if (!tk) return;
  if (on) state.SEL.add(tk); else state.SEL.delete(tk);
  paintCardSelected(tk);
  renderSel();
}
function initGalleryDrag() {
  const gal = $('#gallery');
  if (!gal) return;
  gal.addEventListener('pointerdown', e => {
    if (!state.MULTI) return;
    const card = e.target.closest('#gallery .card');
    if (!card) return;
    if (e.target.closest('[data-sel], button[data-fav], button[data-play], button[data-dl], button[data-dl-cancel], .rt')) return;
    e.preventDefault();
    GALLERY_DRAG = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      add: !state.SEL.has(card.dataset.row), moved: false, startToken: card.dataset.row
    };
    try { gal.setPointerCapture(e.pointerId); } catch { }
  });
  gal.addEventListener('pointermove', e => {
    const d = GALLERY_DRAG;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = Math.abs(e.clientX - d.startX), dy = Math.abs(e.clientY - d.startY);
    if (!d.moved && dx < 6 && dy < 6) return;
    if (!d.moved && dy > dx * 1.4) { GALLERY_DRAG = null; return; } // 纵向手势让页面滚动
    d.moved = true;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const card = el && el.closest ? el.closest('#gallery .card') : null;
    if (card) setCardSelected(card.dataset.row, d.add);
  });
  const finish = e => {
    const d = GALLERY_DRAG;
    if (!d || (e.pointerId !== undefined && e.pointerId !== d.pointerId)) return;
    GALLERY_DRAG = null;
    try { gal.releasePointerCapture(d.pointerId); } catch { }
    if (!d.moved) {
      if (state.SEL.has(d.startToken)) state.SEL.delete(d.startToken); else state.SEL.add(d.startToken);
      paintCardSelected(d.startToken);
      renderSel();
    }
    SUPPRESS_GALLERY_CLICK = true;
    setTimeout(() => { SUPPRESS_GALLERY_CLICK = false; }, 350);
  };
  gal.addEventListener('pointerup', finish);
  gal.addEventListener('pointercancel', finish);
}
/* ================= 播放 / 删除 ================= */
export async function doPlay(tk) {
  const row = state.ROWS.find(r => r.token === tk);
  if (!row || !row.file_name) return toast('本地还没有这个文件，先下载');
  try {
    const r = await api('/api/play', { token: tk });
    if (!r || r.ok === false) return toast('播放失败：' + ((r && r.error) || '未知错误'), 4000);
    row.play_count = r.plays || String((+row.play_count || 0) + 1);
    row.last_play = r.last_play || row.last_play;
    render();
    toast(r.name ? `已用系统播放器打开：${r.name}` : '已用系统播放器打开', 2200);
  } catch (e) {
    toast('播放失败：' + (e.message || '未知错误'));
  }
}

export async function delFiles(tokens, purge) {
  // purge 时即使没有本地文件也要发请求（把记录从台账移除）；只有"删文件"才要求有文件
  const rows = purge ? state.ROWS.filter(r => tokens.includes(r.token)) : state.ROWS.filter(r => tokens.includes(r.token) && r.file_name);
  if (!rows.length) return toast(purge ? '选中条目不在列表里' : '选中的条目本地没有文件');
  const size = rows.reduce((sum, r) => sum + (+r.file_size || 0), 0);
  const extra = purge ? '，并从台账中移除这些条目' : '（进回收站，可从回收站还原）';
  if (!confirm(`删除 ${rows.length} 个本地文件，共 ${(size / 1048576).toFixed(1)} MB${extra}？`)) return;
  try {
    const r = await api('/api/delete', { tokens, purge });
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast(`已删除 ${r.deleted} 个文件，释放 ${(r.freed / 1048576).toFixed(1)} MB` +
      (purge ? '，台账已移除' : '') +
      (r.failed && r.failed.length ? `（${r.failed.length} 个失败）` : ''), 4500);
    if (purge) state.SEL.clear();
    reload();
  } catch (e) {
    toast('请求失败：' + e.message, 5000);
  }
}

/* ================= 右键菜单 ================= */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ctxItemsFor(row) {
  const favOn = !!row && row.fav === '1';
  const seen = !!row && !!row.last_play;
  const hasFile = !!row && !!row.file_name;
  return [
    { act: 'play', label: '▶ 播放', off: !hasFile },
    { act: 'reveal', label: '📂 在文件夹中定位', off: !hasFile },
    { sep: true },
    { act: 'copy', label: (row && row.download_kind === 'hls') ? '复制 HLS 直链（可给迅雷）' : '复制下载直链' },
    { act: 'copytoken', label: '复制 token' },
    { sep: true },
    { act: 'download', label: '⬇ 用内置下载器下载', off: !row || !row.url || !!row.file_name },
    { act: 'toggleFav', label: favOn ? '☆ 取消收藏' : '★ 收藏' },
    { act: 'toggleWatched', label: seen ? '↺ 标记未看' : '✓ 标记已看' },
    { act: 'addcol', sub: true, label: '📚 加入合集 ▸' },
    { rate: true, value: +((row && row.rating) || 0) },
    { sep: true },
    { act: 'done', label: '标记完成' },
    { act: 'new', label: '重置为待下载' },
    { act: 'recycle', label: '🗑 移入回收站' },
    { sep: true },
    { act: 'delete', label: '🗑 删除本地文件（回收站）', off: !hasFile },
    { act: 'purge', label: '🗑 删除文件并从台账移除' },
    { sep: true },
    { act: 'refresh', label: '🔄 刷新源地址（下架/换源后重试用）' },
    { act: 'check', label: '🔍 检查源地址（看 HTTP 状态）' },
    { act: 'forceRetry', label: '⚡ 强制重试（跳过源检查）' },
    { act: 'open', label: '在站点打开' }
  ];
}

let CTX_TOKEN = null;
let CTX_FROM_GALLERY = false;
const closeCtx = () => {
  $('#ctxmenu').classList.remove('on');
  const sub = $('#ctxSub');
  if (sub) sub.classList.remove('on');
};

async function onCtxRate(e) {
  const row = state.ROWS.find(r => r.token === CTX_TOKEN);
  let val = 0;
  if (e.target.matches('i')) {
    const v = parseInt(e.target.dataset.v);
    val = (row && (+row.rating || 0) === v) ? 0 : v;
  }
  closeCtx();
  const r = await setRating([CTX_TOKEN], val);
  if (r.ok) { render(); toast(val ? `已打 ${val} 星` : '已清除评分'); }
}

async function onCtxAction(act) {
  const tk = CTX_TOKEN;
  const row = state.ROWS.find(r => r.token === tk);
  if (!row) return;
  switch (act) {
    case 'play':
      // 画廊右键的播放也走预览内播放，和卡片上的行为一致
      if (CTX_FROM_GALLERY) return emit('open-lightbox', { token: tk, autoplay: true });
      return doPlay(tk);
    case 'reveal': {
      const r = await api('/api/reveal', { token: tk });
      if (!r.ok) toast(r.error);
      return;
    }
    case 'copy': return copyText(row.url || '', 'URL 已复制');
    case 'copytoken': return copyText(tk, 'token 已复制');
    case 'check': {
      const r = await api('/api/check-url', { token: tk });
      if (!r.ok) return toast('检查失败：' + r.error, 4000);
      toast('源地址 HTTP ' + r.code + ((r.code === 200 || r.code === 206) ? '（可用）' : '（不可用）'), 6000);
      return;
    }
    case 'forceRetry': {
      const r = await api('/api/download', { tokens: [tk], force: true });
      toast(r.ok ? '已强制重试' : (r.error || '重试失败'), 5000);
      if (r.ok) reload();
      return;
    }
    case 'refresh': {
      const r = await api('/api/refresh-url', { tokens: [tk] });
      if (!r.ok) return toast('刷新失败：' + r.error, 4000);
      toast(`源地址：更新 ${r.refreshed}，未变 ${r.unchanged}，已下架 ${r.removed}`, 4500);
      reload();
      return;
    }
    case 'open': return window.open(siteUrl(tk), '_blank');
    case 'download': {
      const r2 = await api('/api/download', { tokens: [tk] });
      toast(r2.ok ? '已加入下载队列' : '下载失败：' + r2.error, 4000);
      if (r2.ok) reload();
      return;
    }
    case 'toggleFav': {
      const next = row.fav !== '1';
      const r = await setFav([tk], next);
      if (r.ok) { render(); toast(next ? '已收藏' : '已取消收藏'); }
      return;
    }
    case 'toggleWatched': {
      const next = !row.last_play;
      const r = await setWatched([tk], next);
      if (r.ok) { render(); toast(next ? '已标记已看' : '已标记未看'); }
      return;
    }
    case 'delete': return delFiles([tk], false);
    case 'purge': return delFiles([tk], true);
    case 'done':
    case 'new':
    case 'recycle': {
      const st = act === 'recycle' ? 'recycled' : act;
      const r = await setStatus([tk], st);
      if (r.ok) { render(); toast(st === 'recycled' ? '已移入回收站' : `已标记 ${STATUS_LABEL[st] || st}`); }
      return;
    }
  }
}

/* ================= 行内交互 ================= */
export async function onRowClick(e) {
  /* 评分星 */
  const star = e.target.closest('.rt i');
  if (star) {
    const host = star.closest('.rt');
    const tk = host.dataset.rate;
    const row = state.ROWS.find(r => r.token === tk);
    const v = parseInt(star.dataset.v);
    const val = (row && (+row.rating || 0) === v) ? 0 : v;
    const r = await setRating([tk], val);
    if (r.ok) { render(); toast(val ? `已打 ${val} 星` : '已清除评分'); }
    return;
  }
  if (e.target.closest('input[type=checkbox]')) return;

  /* 画廊多选：滑动勾选后抑制这一次 click；单击仍走原逻辑 */
  if (SUPPRESS_GALLERY_CLICK && e.target.closest('#gallery .card')) { SUPPRESS_GALLERY_CLICK = false; return; }
  /* 画廊多选：点卡片切换勾选；卡片内按钮仍走各自功能 */
  const selBtn = e.target.closest('[data-sel]');
  if (selBtn) { toggleCardSel(selBtn.dataset.sel); return; }
  if (state.MULTI && e.target.closest('#gallery .card')) {
    const interactive = e.target.closest('button[data-fav], [data-play], [data-dl], [data-dl-cancel], .rt');
    if (!interactive) { toggleCardSel(e.target.closest('#gallery .card').dataset.row); return; }
  }

  /* 收藏 */
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    const tk = favBtn.dataset.fav;
    const row = state.ROWS.find(r => r.token === tk);
    const next = !(row && row.fav === '1');
    const r = await setFav([tk], next);
    if (r.ok) { render(); toast(next ? '已收藏' : '已取消收藏'); }
    return;
  }

  /* 播放（画廊里是封面内的浮层按钮，优先级要高于封面灯箱） */
  const play = e.target.closest('[data-play]');
  if (play) {
    // 画廊/合集浏览器里的播放：打开预览并直接播放（表格里仍走系统播放器）
    if (play.closest('#gallery, #colbBody')) {
      return emit('open-lightbox', { token: play.dataset.play, autoplay: true });
    }
    return doPlay(play.dataset.play);
  }

  /* 封面 → 灯箱（只预览，不自动播） */
  const cover = e.target.closest('[data-lb]');
  if (cover) return emit('open-lightbox', cover.dataset.lb);
  const reveal = e.target.closest('[data-reveal]');
  if (reveal) {
    try {
      const r = await api('/api/reveal', { token: reveal.dataset.reveal });
      if (!r.ok) toast(r.error);
    } catch (err) { toast('定位失败'); }
    return;
  }

  const dlCancel = e.target.closest('[data-dl-cancel]');
  if (dlCancel) {
    const r = await api('/api/download/cancel', { tokens: [dlCancel.dataset.dlCancel] });
    toast(r.ok ? '已取消这条下载（进度已保留）' : (r.error || '取消失败'), 3000);
    return emit('reload');
  }

  const dlBtn = e.target.closest('[data-dl]');
  if (dlBtn) {
    const r = await api('/api/download', { tokens: [dlBtn.dataset.dl] });
    if (!r.ok) return toast('下载失败：' + r.error, 5000);
    toast(`开始下载 1 条（并发 ${r.concurrent}）`, 3000);
    return emit('reload');
  }

  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) return copyText(copyBtn.dataset.copy, 'URL 已复制');
}

/* ================= 初始化 ================= */
export function initRows() {
  $('#tbody').addEventListener('mousedown', e => {
    if (e.target.matches('input[type=checkbox]')) SHIFT_DOWN = e.shiftKey;
  });
  $('#tbody').addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) { handleSelect(e.target, SHIFT_DOWN); SHIFT_DOWN = false; }
  });
  $('#chkAll').addEventListener('change', e => {
    const per = state.PER > 0 ? state.PER : 999999;
    visible().slice((state.PAGE - 1) * per, state.PAGE * per)
      .forEach(r => e.target.checked ? state.SEL.add(r.token) : state.SEL.delete(r.token));
    render();
  });
  $('#btnMulti').onclick = toggleMulti;
  if ($('#selPurge')) $('#selPurge').onclick = () => { if (state.SEL.size) delFiles([...state.SEL], true); };
  $('#selClear').onclick = () => { state.SEL.clear(); render(); };
  if ($('#selAll')) $('#selAll').onclick = () => {
    const per = state.PER > 0 ? state.PER : 999999;
    visible().slice((state.PAGE - 1) * per, state.PAGE * per).forEach(r => state.SEL.add(r.token));
    render();
  };

  $('#tbody').addEventListener('click', onRowClick);
  // 画廊视图复用同一套行内交互（播放/收藏/评分/下载/取消/灯箱）
  const gal = $('#gallery');
  if (gal) gal.addEventListener('click', onRowClick);
  initGalleryDrag();

  const onContextMenu = e => {
    // 表格行和画廊卡片都用 data-row 标记，一套右键菜单通吃
    const item = e.target.closest('[data-row]');
    if (!item) return;
    e.preventDefault();
    CTX_TOKEN = item.dataset.row;
    CTX_FROM_GALLERY = !!item.closest('#gallery');
    const row = state.ROWS.find(r => r.token === CTX_TOKEN);
    const menu = $('#ctxmenu');
    menu.innerHTML = ctxItemsFor(row).map(i => {
      if (i.sep) return '<div class="sep"></div>';
      if (i.rate) return `<div class="ctxrate">${starsHtml(i.value)}<span class="clr">清除</span></div>`;
      if (i.sub) return `<button data-act="${i.act}" data-sub="1"${i.off ? ' disabled' : ''}>${i.label}</button>`;
      return `<button data-act="${i.act}"${i.off ? ' disabled' : ''}>${i.label}</button>`;
    }).join('') + '<div class="ctx-sub" id="ctxSub"></div>';
    menu.classList.add('on');
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(e.clientX, innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(6, Math.min(e.clientY, innerHeight - h - 8)) + 'px';

    // 「加入合集 ▸」二级菜单
    const subBtn = menu.querySelector('button[data-sub]');
    const sub = menu.querySelector('#ctxSub');
    if (subBtn && sub) {
      const showSub = () => {
        const cols = state.COLLECTIONS || [];
        sub.innerHTML = (cols.length
          ? cols.map(c => `<button data-col="${c.id}">${escapeHtml(c.name)}</button>`).join('')
          : '<div class="sub" style="padding:6px 10px">还没有合集</div>')
          + '<button data-col-new="1">＋ 新建合集…</button>';
        const r = subBtn.getBoundingClientRect();
        sub.style.left = Math.max(6, Math.min(r.right + 2, innerWidth - 180)) + 'px';
        sub.style.top = Math.max(6, Math.min(r.top, innerHeight - 80)) + 'px';
        sub.classList.add('on');
      };
      subBtn.addEventListener('mouseenter', showSub);
      subBtn.addEventListener('click', showSub);
    }
  };
  $('#tbody').addEventListener('contextmenu', onContextMenu);
  if (gal) gal.addEventListener('contextmenu', onContextMenu);

  $('#ctxmenu').addEventListener('click', async e => {
    // 二级菜单：加入已有合集 / 新建合集
    const colBtn = e.target.closest('#ctxSub button[data-col]');
    if (colBtn) {
      const id = +colBtn.dataset.col;
      const tk = CTX_TOKEN;
      closeCtx();
      const m = await import('./collections.js');
      m.addToCollection(id, [tk]);
      return;
    }
    const colNew = e.target.closest('#ctxSub button[data-col-new]');
    if (colNew) {
      const name = prompt('新合集名称');
      const tk = CTX_TOKEN;
      closeCtx();
      if (name && name.trim()) {
        const m = await import('./collections.js');
        m.createCollectionAndAdd(name.trim(), [tk]);
      }
      return;
    }
    if (e.target.closest('.ctxrate')) return onCtxRate(e);
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    closeCtx();
    await onCtxAction(act);
  });

  document.addEventListener('click', e => { if (!e.target.closest('#ctxmenu')) closeCtx(); });
  document.addEventListener('scroll', closeCtx, true);
  onEvent('close-ctx', closeCtx);
}