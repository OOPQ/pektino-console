/* collections.js — 合集：弹窗内浏览（卡片墙）+ 维护 */
import { $, state, api, toast, confirmDialog, escHtml, emit } from './core.js';
import { render, cardHtml } from './table.js';
import { onRowClick } from './rows.js';

/* 与后端 store.ps1 的 CollectionPalette 保持一致；老数据没有颜色时按 id 取色 */
export const COL_COLORS = ['#4f8cff', '#f2a33c', '#3fb950', '#d2a8ff', '#f778ba', '#39c5cf', '#e3b341', '#ff7b72'];
export function colColor(col) {
  const v = col && String(col.color || '').toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const i = col && col.id ? Math.abs(Number(col.id)) % COL_COLORS.length : 0;
  return COL_COLORS[i];
}

/* 色卡选择器：预设色 + 自定义取色。选色只调用 onPick，不重建控件（避免自定义取色框被关掉） */
function paintColorPicker(host, current, onPick) {
  if (!host) return;
  const cur = String(current || '').toLowerCase();
  const inPalette = COL_COLORS.includes(cur);
  host.innerHTML = COL_COLORS.map(c => `<button type="button" class="swatch ${c === cur ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')
    + `<label class="swatch custom ${inPalette ? '' : 'on'}" title="自定义颜色"><input type="color" value="${cur || COL_COLORS[0]}" data-color-custom></label>`;
  host.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.color;
    host.querySelectorAll('.swatch').forEach(el => el.classList.toggle('on', el === b));
    const customEl = host.querySelector('[data-color-custom]');
    if (customEl) customEl.value = v;
    onPick(v);
  }));
  const custom = host.querySelector('[data-color-custom]');
  if (custom) custom.addEventListener('input', () => {
    host.querySelectorAll('.swatch').forEach(el => el.classList.toggle('on', el.classList.contains('custom')));
    onPick(String(custom.value).toLowerCase());
  });
}

let pickTokens = [];
let newColor = COL_COLORS[0];
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
    emit('collections-changed');
  } catch { }
}

function paintCount() {
  const el = $('#colCount');
  if (!el) return;
  const n = (state.COLLECTIONS || []).length;
  el.textContent = n ? `(${n})` : '';
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
  el.innerHTML = cols.map(c => `<button class="colb-tab ${browserCol && browserCol.id === c.id ? 'on' : ''}" data-colb-tab="${c.id}" style="--col:${colColor(c)}"><i class="cdot"></i>${escHtml(c.name)} <span class="sub">${c.count}</span></button>`).join('');
  const has = !!browserCol;
  if ($('#colbEdit')) $('#colbEdit').disabled = !has;
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
      <button class="colb-remove" data-colb-remove="${escHtml(r.token)}" title="移出合集">×</button>
    </div>`).join('')}</div>`;
}

/* ---------- 维护 ---------- */
async function createCollection() {
  const name = $('#colbNew').value.trim();
  if (!name) return toast('先输入合集名称', 2500);
  const color = newColor;
  const r = await api('/api/collections', { action: 'create', name, color });
  if (!r || !r.ok) return toast((r && r.error) || '新建失败', 3500);
  $('#colbNew').value = '';
  await loadCollections();
  await selectCollection(r.id);
  toast(`已新建合集「${name}」`, 2500);
}

/* ---------- 合集编辑（预览/抽卡标签 / 合集弹窗共用） ---------- */
let editCol = null, editToken = '', editColor = COL_COLORS[0];

function updateEditPreview() {
  const name = ($('#colEditName').value || '').trim() || '合集';
  const chip = $('#colEditPreview');
  if (chip) {
    chip.textContent = name;
    chip.style.setProperty('--col', editColor);
  }
}

export function openCollectionEditor(id, opts = {}) {
  const col = (state.COLLECTIONS || []).find(c => c.id === id);
  if (!col) return toast('合集不存在', 3000);
  editCol = col;
  editToken = opts.token || '';
  editColor = colColor(col);
  $('#colEditName').value = col.name;
  $('#colEditCount').textContent = `${col.count || 0} 条`;
  $('#colEditRemove').hidden = !editToken;
  paintColorPicker($('#colEditPalette'), editColor, c => { editColor = c; updateEditPreview(); });
  updateEditPreview();
  $('#colEdit').classList.add('on');
  setTimeout(() => { try { $('#colEditName').focus(); } catch { } }, 30);
}

function closeCollectionEditor() {
  $('#colEdit').classList.remove('on');
  editCol = null;
  editToken = '';
  editColor = COL_COLORS[0];
}

function refreshBrowserCol() {
  if (!browserCol) return;
  const fresh = (state.COLLECTIONS || []).find(c => c.id === browserCol.id);
  browserCol = fresh || null;
  if (!browserCol) { browserRows = []; renderBrowser(); }
}

async function saveCollectionEditor() {
  if (!editCol) return;
  const name = $('#colEditName').value.trim();
  const color = editColor;
  if (!name) return toast('合集名称不能为空', 2500);
  if (name.length > 60) return toast('合集名称最长 60 字', 2500);
  const calls = [];
  if (name !== editCol.name) calls.push(api('/api/collections', { action: 'rename', id: editCol.id, name }));
  if (color.toLowerCase() !== colColor(editCol)) calls.push(api('/api/collections', { action: 'color', id: editCol.id, color }));
  if (!calls.length) { closeCollectionEditor(); return; }
  const results = await Promise.all(calls);
  const bad = results.find(r => !r || !r.ok);
  if (bad) return toast((bad && bad.error) || '保存失败', 3500);
  await loadCollections();
  refreshBrowserCol();
  closeCollectionEditor();
  toast('合集已保存', 2000);
}

async function removeFromCollectionEditor() {
  if (!editCol || !editToken) return;
  const colId = editCol.id;
  const r = await api('/api/collections', { action: 'remove', id: colId, tokens: [editToken] });
  if (!r || !r.ok) return toast((r && r.error) || '移出失败', 3500);
  await loadCollections();
  refreshBrowserCol();
  if (browserCol && browserCol.id === colId) {
    browserRows = await fetchCollectionRows(colId);
    renderBrowser();
  }
  closeCollectionEditor();
  toast('已移出合集', 2000);
}

async function deleteFromCollectionEditor() {
  if (!editCol) return;
  const col = editCol;
  if (!(await confirmDialog(`删除合集「${col.name}」？只会删合集，不会删条目。`, { title: '删除合集', danger: true, okText: '删除' }))) return;
  const r = await api('/api/collections', { action: 'delete', id: col.id });
  if (!r || !r.ok) return toast((r && r.error) || '删除失败', 3500);
  if (state.COL_FILTER && state.COL_FILTER.id === col.id) clearColFilter();
  await loadCollections();
  if (browserCol && browserCol.id === col.id) {
    browserCol = null;
    browserRows = [];
    const cols = state.COLLECTIONS || [];
    if (cols.length) await selectCollection(cols[0].id); else renderBrowser();
  }
  closeCollectionEditor();
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
    const col = (state.COLLECTIONS || []).find(c => c.id === state.COL_FILTER.id) || { id: state.COL_FILTER.id, name: state.COL_FILTER.name };
    const color = colColor(col);
    chip.style.setProperty('--col', color);
    if (nameEl) nameEl.innerHTML = `<i class="cdot" style="--col:${color}"></i>合集：${escHtml(state.COL_FILTER.name)}`;
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
      emit('collections-changed');
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
        <i class="cdot" style="--col:${colColor(c)}"></i>
        <span class="name">${escHtml(c.name)}</span>
        <span class="cnt">${c.count} 条</span>
        <button class="${c.has ? '' : 'ghost'}" data-pick-toggle="${c.id}">${c.has ? '✓ 已在 · 移出' : '加入'}</button>
      </div>`).join('');
    return;
  }
  el.innerHTML = cols.map(c => `<div class="col-row">
      <i class="cdot" style="--col:${colColor(c)}"></i>
      <span class="name" data-pick="${c.id}">${escHtml(c.name)}</span>
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
  $('#colbEdit').onclick = () => { if (browserCol) openCollectionEditor(browserCol.id); };
  paintColorPicker($('#colbNewPalette'), newColor, c => { newColor = c; });

  /* 预览/抽卡里的合集标签编辑器 */
  $('#colEditCancel').onclick = closeCollectionEditor;
  $('#colEdit').onclick = e => { if (e.target.id === 'colEdit') closeCollectionEditor(); };
  $('#colEditSave').onclick = saveCollectionEditor;
  $('#colEditRemove').onclick = removeFromCollectionEditor;
  $('#colEditDelete').onclick = deleteFromCollectionEditor;
  $('#colEditName').addEventListener('input', updateEditPreview);
  $('#colEditName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCollectionEditor(); } });
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
