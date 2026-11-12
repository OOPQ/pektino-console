/* core.js — 常量、全局状态、事件总线、通用工具、API 封装、错误上报 */

export const $ = s => document.querySelector(s);
const KEY = 'pektino.ui.v3';
export const STATUS_LABEL = { new: '待下载', sent: '已投递', done: '已完成', ignored: '忽略', downloading: '下载中' };

/* ---------- 偏好（localStorage） ---------- */
export const PREFS = Object.assign({
  sortKey: 'rank', sortDir: 'asc', per: 50, covers: true, compact: false, pageCount: 3,
  page: 1, status: 'all', res: 'all', minDur: '', q: '',
  cols: {
    cover: true, rank: true, duration: true, res: true, views: true, likes: true,
    plays: true, rating: true, token: true, status: true, disk: true, first_seen: true
  }
}, JSON.parse(localStorage.getItem(KEY) || '{}'));
if (!PREFS.cols) PREFS.cols = {};
// 旧版本的筛选把「标记」混在 status 里，这里迁移到 flag
const LEGACY_FLAGS = ['have', 'miss', 'fav', 'towatch', 'watched', 'rated', 'unrated', 'top', 'today'];
if (LEGACY_FLAGS.includes(PREFS.status)) {
  PREFS.flag = PREFS.status === 'unrated' ? 'none' : PREFS.status;
  PREFS.status = 'all';
}
if (!PREFS.flag) PREFS.flag = 'none';
export const savePrefs = () => localStorage.setItem(KEY, JSON.stringify(PREFS));

/* ---------- 全局状态 ---------- */
export const state = {
  ROWS: [], STATS: {},
  SEL: new Set(),
  BUSY: false,
  SORT: { key: PREFS.sortKey, dir: PREFS.sortDir },
  FILTER: { status: PREFS.status || 'all', flag: PREFS.flag || 'none', res: PREFS.res, minDur: PREFS.minDur, q: PREFS.q },
  PAGE: PREFS.page,
  PER: PREFS.per,
  SHOW_COVERS: PREFS.covers,
  LB_TOKEN: null,
  GACHA_TOKEN: null
};

/* ---------- 事件总线（解耦模块之间的调用） ---------- */
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const onEvent = (name, fn) => bus.addEventListener(name, e => fn(e.detail));

/* ---------- 基础工具 ---------- */
export function toast(msg, ms = 2500) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
export const stTag = s => `<span class="tag ${s}">${STATUS_LABEL[s] || s}</span>`;
export const fmtMB = n => n ? (n / 1048576).toFixed(1) + ' MB' : '';
export const fmtNum = n => (n === '' || n == null) ? '–' : Number(n).toLocaleString('en-US');

/* ---------- 前端上报 ---------- */
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
    stack: ((e.error && e.error.stack) || (`${e.filename}:${e.lineno}:${e.colno}`)).slice(0, 1200)
  });
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason || {};
  report('error', 'unhandledrejection: ' + (r.message || r), { stack: String(r.stack || '').slice(0, 1200) });
});

/* ---------- API 封装（计时 + 上报） ---------- */
export async function api(path, body) {
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

/* ---------- 评分星（表格 / 灯箱 / 抽卡 / 右键菜单 共用一套） ---------- */
export function starsInner(value) {
  const v = Math.max(0, Math.min(5, +value || 0));
  return [1, 2, 3, 4, 5]
    .map(n => `<i class="${n <= v ? 'on' : ''}" data-v="${n}">★</i>`)
    .join('');
}
export function starsHtml(value, opts = {}) {
  const cls = ['rt', opts.cls || ''].filter(Boolean).join(' ');
  const attr = opts.token ? ` data-rate="${opts.token}"` : '';
  return `<span class="${cls}"${attr}>${starsInner(value)}</span>`;
}