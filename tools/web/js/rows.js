/* rows.js — 行选择、行内操作、右键菜单、播放、删除、批量操作 */
import { $, state, PREFS, savePrefs, api, toast, stTag, thunder, STATUS_LABEL, emit, on } from './core.js';
import { visible, render, renderSel } from './table.js';

/* ---------- 选择（Shift 范围） ---------- */
let LAST_IDX = null, SHIFT_DOWN = false;

function handleSelect(cb, shift) {
  const tk = cb.dataset.tk, idx = parseInt(cb.dataset.idx);
  if (shift && LAST_IDX !== null && !isNaN(idx)) {
    const lo = Math.min(LAST_IDX, idx), hi = Math.max(LAST_IDX, idx);
    const all = visible();
    for (let k = lo; k <= hi; k++) {
      const r = all[k]; if (!r) continue;
      cb.checked ? state.SEL.add(r.token) : state.SEL.delete(r.token);
    }
  } else {
    cb.checked ? state.SEL.add(tk) : state.SEL.delete(tk);
  }
  LAST_IDX = isNaN(idx) ? null : idx;
  document.querySelectorAll('#tbody input[type=checkbox]').forEach(box => {
    box.checked = state.SEL.has(box.dataset.tk);
  });
  const boxes = [...document.querySelectorAll('#tbody input[type=checkbox]')];
  $('#chkAll').checked = boxes.length > 0 && boxes.every(b => b.checked);
  renderSel();
}

/* ---------- 播放 ---------- */
export async function doPlay(tk) {
  const row = state.ROWS.find(r => r.token === tk);
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

/* ---------- 删除 ---------- */
export async function delFiles(tokens, purge) {
  const rows = state.ROWS.filter(r => tokens.includes(r.token) && r.file_name);
  if (!rows.length) return toast('选中的条目本地没有文件');
  const size = rows.reduce((s, r) => s + (+r.file_size || 0), 0);
  const extra = purge ? '，并从台账中移除这些条目' : '（进回收站，可从回收站还原）';
  if (!confirm(`删除 ${rows.length} 个本地文件，共 ${(size / 1048576).toFixed(1)} MB${extra}？`)) return;
  try {
    const r = await api('/api/delete', { tokens, purge });
    if (!r.ok) return toast('失败：' + r.error, 5000);
    toast(`已删除 ${r.deleted} 个文件，释放 ${(r.freed / 1048576).toFixed(1)} MB${purge ? '，台账已移除' : ''}` +
      (r.failed && r.failed.length ? `（${r.failed.length} 个失败）` : ''), 4500);
    if (purge) state.SEL.clear();
    emit('reload');
  } catch (e) { toast('请求失败：' + e.message, 5000); }
}

/* ---------- 右键菜单 ---------- */
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
const closeCtx = () => $('#ctxmenu').classList.remove('on');

async function handleCtxAction(e) {
  const rateEl = e.target.closest('.ctxrate');
  if (rateEl) {
    const tk = CTX_TOKEN, row = state.ROWS.find(r => r.token === tk);
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
  const row = state.ROWS.find(r => r.token === tk);
  if (!row) return;
  try {
    if (act === 'play') return doPlay(tk);
    if (act === 'reveal') { const r = await api('/api/reveal', { token: tk }); if (!r.ok) toast(r.error); return; }
    if (act === 'copy') { await navigator.clipboard.writeText(row.url || ''); return toast('URL 已复制'); }
    if (act === 'thunder') { await navigator.clipboard.writeText(thunder(row.url || '')); return toast('thunder:// 已复制'); }
    if (act === 'copytoken') { await navigator.clipboard.writeText(tk); return toast('token 已复制'); }
    if (act === 'open') { window.open('https://pektino.com/zh-CN/movie/' + tk, '_blank'); return; }
    if (act === 'toggleFav') {
      const on2 = row.fav !== '1';
      const r = await api('/api/fav', { tokens: [tk], on: on2 });
      if (r.ok) { row.fav = on2 ? '1' : ''; render(); toast(on2 ? '已收藏' : '已取消收藏'); }
      return;
    }
    if (act === 'toggleWatched') {
      const on2 = !row.last_play;
      const r = await api('/api/watched', { tokens: [tk], on: on2 });
      if (r.ok) { toast(on2 ? '已标记已看' : '已标记未看'); emit('reload'); }
      return;
    }
    if (act === 'delete') return delFiles([tk], false);
    if (act === 'purge') return delFiles([tk], true);
    if (act === 'done' || act === 'new' || act === 'ignore') {
      const st = act === 'ignore' ? 'ignored' : act;
      const r = await api('/api/mark', { tokens: [tk], status: st });
      if (r.ok) { toast(`已标记 ${STATUS_LABEL[st] || st}`); emit('reload'); }
      else toast('失败：' + (r.error || '未知错误'), 4000);
      return;
    }
  } catch (err) { toast('操作失败：' + err.message); }
}

export function initRows() {
  /* 选择 */
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
  $('#selClear').onclick = () => { state.SEL.clear(); render(); };

  /* 行内点击 */
  $('#tbody').addEventListener('click', async e => {
    const star = e.target.closest('.rt i');
    if (star) {
      const tk = star.closest('.rt').dataset.rate;
      const row = state.ROWS.find(r => r.token === tk);
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
      const tk = fav.dataset.fav, row = state.ROWS.find(r => r.token === tk), on2 = !(row && row.fav === '1');
      try {
        const r = await api('/api/fav', { tokens: [tk], on: on2 });
        if (r.ok && row) {
          row.fav = on2 ? '1' : '';
          state.STATS.favorites = Math.max(0, (state.STATS.favorites || 0) + (on2 ? 1 : -1));
          const kf = $('#kFav'); if (kf) kf.textContent = state.STATS.favorites;
        }
        render();
      } catch (err) { toast('收藏失败：' + err.message); }
      return;
    }
    const lb = e.target.closest('[data-lb]');
    if (lb) { emit('open-lightbox', lb.dataset.lb); return; }

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

  /* 右键 */
  $('#tbody').addEventListener('contextmenu', e => {
    const tr = e.target.closest('tr[data-row]');
    if (!tr) return;
    e.preventDefault();
    CTX_TOKEN = tr.dataset.row;
    const row = state.ROWS.find(r => r.token === CTX_TOKEN);
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
  $('#ctxmenu').addEventListener('click', handleCtxAction);
  document.addEventListener('click', e => { if (!e.target.closest('#ctxmenu')) closeCtx(); });
  document.addEventListener('scroll', closeCtx, true);
  on('close-ctx', closeCtx);
}
