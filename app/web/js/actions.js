/* actions.js — 对单条/多条数据的写操作，统一改本地 state 并同步 KPI
   所有写操作走这里，避免「表格里改一处、右键菜单改一处、灯箱再改一处」各自为政 */
import { api, state, toast, emit } from './core.js';

export const siteUrl = tk => `https://pektino.com/zh-CN/movie/${tk}`;

/* 复制到剪贴板（失败给出提示，不抛异常） */
export async function copyText(text, okMsg = '已复制') {
  if (!text) return toast('没有可复制的内容');
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (e) {
    toast('复制失败（浏览器拒绝了剪贴板）');
  }
}

function syncFavKpi() {
  const el = document.querySelector('#kFav');
  if (el) el.textContent = state.STATS.favorites || 0;
}

/* ---------- 评分 ---------- */
export async function setRating(tokens, value) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  let r;
  try {
    r = await api('/api/rate', { tokens: list, value });
  } catch (e) {
    toast('打分失败：' + e.message);
    return { ok: false, count: 0 };
  }
  if (!r.ok) { toast('打分失败：' + (r.error || '未知错误')); return r; }
  list.forEach(tk => {
    const row = state.ROWS.find(x => x.token === tk);
    if (row) row.rating = value ? String(value) : '';
  });
  return r;
}

/* ---------- 收藏 ---------- */
export async function setFav(tokens, on) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  let r;
  try {
    r = await api('/api/fav', { tokens: list, on });
  } catch (e) {
    toast('收藏失败：' + e.message);
    return { ok: false, count: 0 };
  }
  if (!r.ok) { toast('收藏失败：' + (r.error || '未知错误')); return r; }
  let changed = 0;
  list.forEach(tk => {
    const row = state.ROWS.find(x => x.token === tk);
    if (!row) return;
    const want = on ? '1' : '';
    if (row.fav !== want) changed++;
    row.fav = want;
  });
  state.STATS.favorites = Math.max(0, (state.STATS.favorites || 0) + (on ? changed : -changed));
  syncFavKpi();
  return r;
}

/* ---------- 已看 / 未看 ---------- */
export async function setWatched(tokens, on) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  let r;
  try {
    r = await api('/api/watched', { tokens: list, on });
  } catch (e) {
    toast('操作失败：' + e.message);
    return { ok: false, count: 0 };
  }
  if (!r.ok) { toast('操作失败：' + (r.error || '未知错误')); return r; }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  list.forEach(tk => {
    const row = state.ROWS.find(x => x.token === tk);
    if (row) {
      row.last_play = on ? now : '';
      // 后端"标记未看"会把播放次数清零，前端同步一下，避免表格显示 ▶N 不一致
      row.play_count = on ? (String(+row.play_count || 0) === '0' ? '1' : row.play_count) : '0';
    }
  });
  return r;
}

/* ---------- 状态（完成 / 待下载 / 回收站） ---------- */
export async function setStatus(tokens, status) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  let r;
  try {
    r = await api('/api/mark', { tokens: list, status });
  } catch (e) {
    toast('操作失败：' + e.message);
    return { ok: false, count: 0 };
  }
  if (!r.ok) { toast('操作失败：' + (r.error || '未知错误')); return r; }
  list.forEach(tk => {
    const row = state.ROWS.find(x => x.token === tk);
    if (row) row.status = status;
  });
  return r;
}

/* 数据有结构性变化（删除/导入/抓取）时统一刷新 */
export const reload = () => emit('reload');