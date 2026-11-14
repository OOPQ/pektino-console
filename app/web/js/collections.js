/* collections.js — 合集：维护 / 加入 / 筛选 */
import { $, state, api, toast } from './core.js';
import { render } from './table.js';

let pickTokens = [];
let itemsCollection = null;

/* ---------- 数据 ---------- */
export async function loadCollections() {
  try {
    const r = await api('/api/collections');
    if (!r || !r.ok) return;
    state.COLLECTIONS = r.items || [];
    paintCount();
    renderColList();
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

/* ---------- 抽屉 ---------- */
export function openCollectionsDrawer() {
  itemsCollection = null;
  $('#colItemsView').hidden = true;
  $('#colList').hidden = false;
  $('#colNewName').value = '';
  $('#colDrawer').classList.add('on');
  loadCollections();
}

function renderColList() {
  const el = $('#colList');
  if (!el) return;
  const cols = state.COLLECTIONS || [];
  if (!cols.length) {
    el.innerHTML = '<div class="bin-empty">还没有合集<br><span class="sub">在上面的输入框新建，或右键条目「加入合集」</span></div>';
    return;
  }
  el.innerHTML = cols.map(c => `<div class="col-row" data-col-row="${c.id}">
      <span class="name" data-col-open="${c.id}" title="查看合集内容">${safe(c.name)}</span>
      <span class="cnt">${c.count} 条</span>
      <button class="ghost" data-col-rename="${c.id}" title="重命名">重命名</button>
      <button class="ghost danger" data-col-del="${c.id}" title="删除合集（不删条目）">删除</button>
    </div>`).join('');
}

async function openCollectionItems(id) {
  const col = (state.COLLECTIONS || []).find(c => c.id === id);
  if (!col) return;
  itemsCollection = col;
  $('#colList').hidden = true;
  $('#colItemsView').hidden = false;
  $('#colItemsName').textContent = col.name;
  $('#colItemsList').innerHTML = '<div class="sub">加载中…</div>';
  try {
    const r = await api(`/api/collections/items?id=${id}`);
    const tokens = (r && r.tokens) || [];
    const rows = tokens.map(tk => state.ROWS.find(x => x.token === tk)).filter(Boolean);
    $('#colItemsCount').textContent = `${rows.length} 条`;
    if (!rows.length) {
      $('#colItemsList').innerHTML = '<div class="bin-empty">合集是空的</div>';
      return;
    }
    $('#colItemsList').innerHTML = rows.map(r2 => `<div class="bin-row">
        <div class="bin-main"><span class="mono">${safe(r2.token)}</span>
          <span class="sub">${[r2.duration, r2.res, r2.status].filter(Boolean).join(' · ')}</span></div>
        <div class="bin-actions"><button class="ghost" data-col-remove="${safe(r2.token)}">移出</button></div>
      </div>`).join('');
  } catch {
    $('#colItemsList').innerHTML = '<div class="bin-empty">加载失败</div>';
  }
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

/* ---------- 选择弹窗 ---------- */
export function openCollectionPicker(tokens) {
  pickTokens = (tokens || []).filter(Boolean);
  if (!pickTokens.length) { toast('先选中条目'); return; }
  $('#colPickCount').textContent = `(${pickTokens.length} 条)`;
  $('#colPickNew').value = '';
  renderPickList();
  $('#colPick').classList.add('on');
  loadCollections();
}

function renderPickList() {
  const el = $('#colPickList');
  if (!el) return;
  const cols = state.COLLECTIONS || [];
  if (!cols.length) {
    el.innerHTML = '<div class="sub" style="padding:8px 0">还没有合集，下面直接新建</div>';
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
  $('#colPick').classList.remove('on');
}

/* ---------- 初始化 ---------- */
export function initCollections() {
  $('#btnCollections').onclick = openCollectionsDrawer;
  $('#colClose').onclick = () => $('#colDrawer').classList.remove('on');
  $('#colDrawer').onclick = e => { if (e.target.id === 'colDrawer') $('#colDrawer').classList.remove('on'); };
  $('#colCreate').onclick = async () => {
    const name = $('#colNewName').value.trim();
    if (!name) return toast('先输入合集名称', 2500);
    const r = await api('/api/collections', { action: 'create', name });
    if (!r || !r.ok) return toast((r && r.error) || '新建失败', 3500);
    $('#colNewName').value = '';
    await loadCollections();
    toast(`已新建合集「${name}」`, 2500);
  };
  $('#colNewName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#colCreate').click(); });

  $('#colList').addEventListener('click', async e => {
    const open = e.target.closest('[data-col-open]');
    if (open) { openCollectionItems(+open.dataset.colOpen); return; }
    const ren = e.target.closest('[data-col-rename]');
    if (ren) {
      const col = (state.COLLECTIONS || []).find(c => c.id === +ren.dataset.colRename);
      if (!col) return;
      const name = prompt('新的合集名称', col.name);
      if (!name || name.trim() === col.name) return;
      const r = await api('/api/collections', { action: 'rename', id: col.id, name: name.trim() });
      if (!r || !r.ok) return toast((r && r.error) || '重命名失败', 3500);
      await loadCollections();
      toast('已重命名', 2000);
      return;
    }
    const del = e.target.closest('[data-col-del]');
    if (del) {
      const col = (state.COLLECTIONS || []).find(c => c.id === +del.dataset.colDel);
      if (!col) return;
      if (!confirm(`删除合集「${col.name}」？只会删合集，不会删条目。`)) return;
      const r = await api('/api/collections', { action: 'delete', id: col.id });
      if (!r || !r.ok) return toast((r && r.error) || '删除失败', 3500);
      if (state.COL_FILTER && state.COL_FILTER.id === col.id) clearColFilter();
      await loadCollections();
      toast('合集已删除', 2000);
      return;
    }
  });

  $('#colBack').onclick = () => {
    itemsCollection = null;
    $('#colItemsView').hidden = true;
    $('#colList').hidden = false;
    loadCollections();
  };
  $('#colViewFilter').onclick = () => {
    if (!itemsCollection) return;
    setColFilter(itemsCollection);
    $('#colDrawer').classList.remove('on');
  };
  $('#colItemsList').addEventListener('click', async e => {
    const rm = e.target.closest('[data-col-remove]');
    if (!rm || !itemsCollection) return;
    const r = await api('/api/collections', { action: 'remove', id: itemsCollection.id, tokens: [rm.dataset.colRemove] });
    if (!r || !r.ok) return toast((r && r.error) || '移出失败', 3500);
    openCollectionItems(itemsCollection.id);
    await loadCollections();
    if (state.COL_FILTER && state.COL_FILTER.id === itemsCollection.id) setColFilter(itemsCollection);
  });

  $('#colFilterClear').onclick = clearColFilter;

  $('#colPickCancel').onclick = closePick;
  $('#colPick').onclick = e => { if (e.target.id === 'colPick') closePick(); };
  $('#colPickList').addEventListener('click', async e => {
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
