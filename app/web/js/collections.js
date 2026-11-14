/* collections.js — 合集：弹窗内浏览（卡片墙）+ 维护 */
import { $, state, api, toast, confirmDialog } from './core.js';
import { render, cardHtml } from './table.js';
import { onRowClick } from './rows.js';

let pickTokens = [];
let pickMode = 'add';   // add = 批量加入；toggle = 单条加入/移出
let browserCol = null;
let browserRows = [];
let browserQuery = '';
let browserStatus = 'all';

/* ---------- 数据 ---------- */
export async function loadCollections() {
  try {
    const r = await api('/api/collections');
    if (!r || !r.ok) return;
    state.COLLECTIONS = r.items || [];
    paintCount();
    renderTabs();
    paintColFilterChip();
  } catch { }
}

function paintCount() {
  const el = $('#colCount');
  if (!el) return;
  const n = (state.COLLECTIONS || []).length;
  el.textContent = n ? `(${n})` : '';
}

function safe(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 弹窗 ---------- */
export async function openCollections() {
  $('#colbSearch').value = '';
  $('#colbStatus').value = 'all';
  browserQuery = '';
  browserStatus = 'all';
  $('#colBrowser').classList.add('on');
  await loadCollections();
  const cols = state.COLLECTIONS || [];
  if (!cols.length) {
    browserCol = null;
    browserRows = [];
    renderBrowser();
    return;
  }
  const keep = browserCol && cols.find(c => c.id === browserCol.id);
  await selectCollection((keep || cols[0]).id);
}

function closeBrowser() {
  $('#colBrowser').classList.remove('on');
  browserCol = null;
  browserRows = [];
}

function renderTabs() {
  const el = $('#colbTabs');
  if (!el) return;
  const cols = state.COLLECTIONS || [];
  el.innerHTML = cols.map(c => `<button class="colb-tab ${browserCol && browserCol.id === c.id ? 'on' : ''}" data-colb-tab="${c.id}">${safe(c.name)} <span class="sub">${c.count}</span></button>`).join('');
  const has = !!browserCol;
  if ($('#colbRename')) $('#colbRename').disabled = !has;
  if ($('#colbDelete')) $('#colbDelete').disabled = !has;
}

async function fetchCollectionRows(id) {
  const r = await api(`/api/collections/items?id=${id}`);
  const tokens = (r && r.tokens) || [];
  return tokens.map(tk => state.ROWS.find(x => x.token === tk)).filter(Boolean);
}

async function selectCollection(id) {
  const col = (state.COLLECTIONS || []).find(c => c.id === id);
  if (!col) return;
  browserCol = col;
  renderTabs();
  browserRows = [];
  renderBrowser();
  browserRows = await fetchCollectionRows(id);
  renderBrowser();
}

function activeDownloadSet() {
  return new Set(((state.DOWNLOAD && state.DOWNLOAD.items) || [])
    .filter(i => ['downloading', 'queued', 'paused'].includes(i.state))
    .map(i => i.token));
}

function filteredBrowserRows() {
  const q = browserQuery.trim().toLowerCase();
  return browserRows.filter(r => {
    if (browserStatus !== 'all' && r.status !== browserStatus) return false;
    if (q) {
      const hay = `${r.token} ${r.duration || ''} ${r.res || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBrowser() {
  renderTabs();
  const el = $('#colbBody');
  if (!el) return;
  if (!browserCol) {
    el.innerHTML = '<div class="bin-empty">还没有合集<br><span class="sub">在上方输入名称，点「新建」</span></div>';
    return;
  }
  const rows = filteredBrowserRows();
  if (!rows.length) {
    el.innerHTML = `<div class="bin-empty">${browserRows.length ? '没有匹配的条目' : '这个合集还是空的'}<br><span class="sub">在台账里右键条目 →「加入合集」</span></div>`;
    return;
  }
  const active = activeDownloadSet();
  el.innerHTML = `<div class="colb-grid">${rows.map(r => `
    <div class="colb-card">
      ${cardHtml(r, active)}
      <button class="colb-remove" data-colb-remove="${r.token}" title="移出合集">×</button>
    </div>`).join('')}</div>`;
}

/* ---------- 维护 ---------- */
async function createCollection() {
  const name = $('#colbNew').value.trim();
  if (!name) return toast('先输入合集名称', 2500);
  const r = await api('/api/collections', { action: 'create', name });
  if (!r || !r.ok) return toast((r && r.error) || '新建失败', 3500);
  $('#colbNew').value = '';
  await loadCollections();
  await selectCollection(r.id);
  toast(`已新建合集「${name}」`, 2500);
}

async function renameCurrent() {
  if (!browserCol) return;
  const name = prompt('新的合集名称', browserCol.name);
  if (!name || name.trim() === browserCol.name) return;
  const r = await api('/api/collections', { action: 'rename', id: browserCol.id, name: name.trim() });
  if (!r || !r.ok) return toast((r && r.error) || '重命名失败', 3500);
  browserCol.name = name.trim();
  await loadCollections();
  renderTabs();
  toast('已重命名', 2000);
}

async function deleteCurrent() {
  if (!browserCol) return;
  const col = browserCol;
  if (!(await confirmDialog(`删除合集「${col.name}」？只会删合集，不会删条目。`, { title: '删除合集', danger: true, okText: '删除' }))) return;
  const r = await api('/api/collections', { action: 'delete', id: col.id });
  if (!r || !r.ok) return toast((r && r.error) || '删除失败', 3500);
  if (state.COL_FILTER && state.COL_FILTER.id === col.id) clearColFilter();
  browserCol = null;
  browserRows = [];
  await loadCollections();
  const cols = state.COLLECTIONS || [];
  if (cols.length) await selectCollection(cols[0].id);
  else renderBrowser();
  toast('合集已删除', 2000);
}

/* ---------- 筛选 ---------- */
function paintColFilterChip() {
  const chip = $('#colFilterChip');
  if (!chip) return;
  const on = !!state.COL_FILTER;
  chip.hidden = !on;
  chip.classList.toggle('on', on);
  if (on) {
    const nameEl = $('#colFilterName');
    if (nameEl) nameEl.textContent = `合集：${state.COL_FILTER.name}`;
  }
}

async function setColFilter(col) {
  try {
    const r = await api(`/api/collections/items?id=${col.id}`);
    state.COL_FILTER = { id: col.id, name: col.name };
    state.COL_TOKENS = new Set((r && r.tokens) || []);
    paintColFilterChip();
    render();
    toast(`只看合集「${col.name}」`, 2000);
  } catch { toast('合集加载失败', 3000); }
}

function clearColFilter() {
  state.COL_FILTER = null;
  state.COL_TOKENS = null;
  paintColFilterChip();
  render();
}

/* ---------- 加入 ---------- */
export async function addToCollection(id, tokens) {
  const list = (tokens || []).filter(Boolean);
  if (!list.length) return;
  try {
    const r = await api('/api/collections', { action: 'add', id, tokens: list });
    if (!r || !r.ok) { toast((r && r.error) || '加入失败', 3500); return; }
    toast(`已加入 ${r.added || 0} 条`, 2500);
    await loadCollections();
    if (browserCol && browserCol.id === id) {
      browserRows = await fetchCollectionRows(id);
      renderBrowser();
    }
  } catch { toast('加入失败', 3500); }
}

export async function createCollectionAndAdd(name, tokens) {
  const n = String(name || '').trim();
  if (!n) return;
  try {
    const r = await api('/api/collections', { action: 'create', name: n });
    if (!r || !r.ok) { toast((r && r.error) || '新建失败', 3500); return; }
    await addToCollection(r.id, tokens);
  } catch { toast('新建失败', 3500); }
}

/* ---------- 选择弹窗（批量 / 右键加入 / 预览单条切换） ---------- */
export function openCollectionPicker(tokens) {
  pickMode = 'add';
  pickTokens = (tokens || []).filter(Boolean);
  if (!pickTokens.length) { toast('先选中条目'); return; }
  $('#colPickCount').textContent = `(${pickTokens.length} 条)`;
  $('#colPickNew').value = '';
  renderPickList();
  $('#colPick').classList.add('on');
  loadCollections();
}

export async function openCollectionPickerForToken(token) {
  if (!token) return;
  pickMode = 'toggle';
  pickTokens = [token];
  $('#colPickCount').textContent = '（点「加入 / 移出」切换）';
  $('#colPickNew').value = '';
  $('#colPick').classList.add('on');
  await fetchCollectionsForToken(token);
  renderPickList();
}

async function fetchCollectionsForToken(token) {
  try {
    const r = await api(`/api/collections?token=${encodeURIComponent(token)}`);
    if (r && r.ok) {
      state.COLLECTIONS = r.items || [];
      paintCount();
      renderTabs();
    }
  } catch { }
}

function renderPickList() {
  const el = $('#colPickList');
  if (!el) return;
  const cols = state.COLLECTIONS || [];
  if (!cols.length) {
    el.innerHTML = '<div class="sub" style="padding:8px 0">还没有合集，下面直接新建</div>';
    return;
  }
  if (pickMode === 'toggle') {
    el.innerHTML = cols.map(c => `<div class="col-row">
        <span class="name">${safe(c.name)}</span>
        <span class="cnt">${c.count} 条</span>
        <button class="${c.has ? '' : 'ghost'}" data-pick-toggle="${c.id}">${c.has ? '✓ 已在 · 移出' : '加入'}</button>
      </div>`).join('');
    return;
  }
  el.innerHTML = cols.map(c => `<div class="col-row">
      <span class="name" data-pick="${c.id}">${safe(c.name)}</span>
      <span class="cnt">${c.count} 条</span>
      <button data-pick="${c.id}">加入</button>
    </div>`).join('');
}

function closePick() {
  pickTokens = [];
  pickMode = 'add';
  $('#colPick').classList.remove('on');
}

/* ---------- 初始化 ---------- */
export function initCollections() {
  $('#btnCollections').onclick = openCollections;
  $('#colbClose').onclick = closeBrowser;
  $('#colBrowser').onclick = e => { if (e.target.id === 'colBrowser') closeBrowser(); };
  $('#colbApply').onclick = () => {
    if (!browserCol) return;
    const col = { id: browserCol.id, name: browserCol.name };
    closeBrowser();
    setColFilter(col);
  };
  $('#colbSearch').addEventListener('input', e => { browserQuery = e.target.value || ''; renderBrowser(); });
  $('#colbStatus').addEventListener('change', e => { browserStatus = e.target.value; renderBrowser(); });
  $('#colbTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-colb-tab]');
    if (b) selectCollection(+b.dataset.colbTab);
  });
  $('#colbCreate').onclick = createCollection;
  $('#colbNew').addEventListener('keydown', e => { if (e.key === 'Enter') createCollection(); });
  $('#colbRename').onclick = renameCurrent;
  $('#colbDelete').onclick = deleteCurrent;
  $('#colbBody').addEventListener('click', async e => {
    const rm = e.target.closest('[data-colb-remove]');
    if (rm) {
      if (!browserCol) return;
      const r = await api('/api/collections', { action: 'remove', id: browserCol.id, tokens: [rm.dataset.colbRemove] });
      if (!r || !r.ok) return toast((r && r.error) || '移出失败', 3500);
      browserRows = await fetchCollectionRows(browserCol.id);
      renderBrowser();
      await loadCollections();
      return;
    }
    onRowClick(e);
  });

  $('#colFilterClear').onclick = clearColFilter;

  /* 选择弹窗 */
  $('#colPickCancel').onclick = closePick;
  $('#colPick').onclick = e => { if (e.target.id === 'colPick') closePick(); };
  $('#colPickList').addEventListener('click', async e => {
    const tg = e.target.closest('[data-pick-toggle]');
    if (tg) {
      const id = +tg.dataset.pickToggle;
      const col = (state.COLLECTIONS || []).find(c => c.id === id);
      const action = col && col.has ? 'remove' : 'add';
      const r = await api('/api/collections', { action, id, tokens: pickTokens });
      if (!r || !r.ok) return toast((r && r.error) || '操作失败', 3500);
      await fetchCollectionsForToken(pickTokens[0]);
      renderPickList();
      return;
    }
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const id = +btn.dataset.pick;
    const tokens = pickTokens.slice();
    closePick();
    await addToCollection(id, tokens);
  });
  $('#colPickCreate').onclick = async () => {
    const name = $('#colPickNew').value.trim();
    if (!name) return toast('先输入合集名称', 2500);
    const tokens = pickTokens.slice();
    closePick();
    await createCollectionAndAdd(name, tokens);
  };
  $('#colPickNew').addEventListener('keydown', e => { if (e.key === 'Enter') $('#colPickCreate').click(); });

  loadCollections();
}
