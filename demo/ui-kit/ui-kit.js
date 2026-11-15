const ICONS = [
  'menu', 'panel-left-close', 'panel-left-open', 'logs', 'settings', 'refresh-cw',
  'search', 'filter', 'rotate-ccw', 'list', 'columns-3', 'layout-grid',
  'more-horizontal', 'download', 'link', 'dices', 'library', 'plus', 'x',
  'play', 'pause', 'folder-open', 'copy', 'external-link', 'chevron-left',
  'chevron-right', 'maximize', 'picture-in-picture', 'star', 'trash-2',
  'undo-2', 'eye', 'tag', 'clock', 'hard-drive', 'calendar', 'check',
  'circle-alert', 'info', 'loader-circle', 'file-video', 'image', 'folder',
  'sliders-horizontal', 'arrow-up-down', 'chevrons-left', 'chevrons-right',
  'ban', 'circle-check', 'triangle-alert', 'heart', 'ellipsis', 'chevron-down',
  'chevron-up', 'circle-play', 'square', 'grid-2x2', 'table-2',
  'volume-2', 'volume-x', 'minimize-2', 'maximize-2', 'skip-back',
  'skip-forward', 'list-filter', 'folder-plus', 'pencil', 'save', 'circle-x',
  'rotate-cw'
];

const $ = s => document.querySelector(s);
const root = document.documentElement;

/* ---------- boot: WA 组件定义后再显示，避免首屏半成品 ---------- */
function ready() {
  root.classList.remove('kit-booting');
  root.classList.add('kit-ready');
}
const waitComponents = Promise.all([
  customElements.whenDefined('wa-button'),
  customElements.whenDefined('wa-dialog'),
  customElements.whenDefined('wa-drawer'),
  customElements.whenDefined('wa-tab-group')
]);
Promise.race([waitComponents, new Promise(resolve => setTimeout(resolve, 900))])
  .then(() => requestAnimationFrame(() => requestAnimationFrame(ready)))
  .catch(() => ready());

/* ---------- icon grid ---------- */
const grid = $('#iconGrid');
if (grid) {
  grid.innerHTML = ICONS.map(name => `
    <div class="kit-icon-cell" title="icon-${name}">
      <svg class="ui-icon" aria-hidden="true"><use href="/app/web/vendor/lucide/icons.svg#icon-${name}"></use></svg>
      <small>${name}</small>
    </div>`).join('');
}

/* ---------- theme ---------- */
const sw = $('#themeSwitch');
const themeLabel = $('#themeLabel');
function applyTheme(light, persist = true) {
  root.classList.toggle('wa-dark', !light);
  root.classList.toggle('wa-light', light);
  if (sw) sw.checked = !light;
  if (themeLabel) themeLabel.textContent = light ? '亮色' : '暗色';
  if (persist) {
    try { localStorage.setItem('kit-theme', light ? 'wa-light' : 'wa-dark'); } catch (e) {}
  }
}
if (sw) {
  sw.addEventListener('change', () => applyTheme(!sw.checked));
  applyTheme(root.classList.contains('wa-light'), false);
}

/* ---------- overlays ---------- */
function show(el) {
  if (!el) return;
  el.open = true;
  el.setAttribute('open', '');
}
function hide(el) {
  if (!el) return;
  el.open = false;
  el.removeAttribute('open');
}
$('#openPreview')?.addEventListener('click', () => show($('#kitPreview')));
$('#openQueue')?.addEventListener('click', () => show($('#kitQueue')));
$('#kitClosePreview')?.addEventListener('click', () => hide($('#kitPreview')));
$('#kitCloseQueue')?.addEventListener('click', () => hide($('#kitQueue')));
