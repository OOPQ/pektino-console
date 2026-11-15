/* pektino UI refresh demo — 只做视觉/交互演示，不请求业务接口 */
const $ = (s) => document.querySelector(s);

/* ---------- theme ---------- */
const html = document.documentElement;
const themeSwitch = $('#themeSwitch');
function applyTheme() {
  const dark = !!themeSwitch.checked;
  html.classList.toggle('wa-dark', dark);
  html.classList.toggle('wa-light', !dark);
}
['change', 'wa-change'].forEach(ev => themeSwitch.addEventListener(ev, applyTheme));
// 等 wa-switch 升级完再读 checked，否则初始会被当成 false（页面变浅色）
if (customElements.get('wa-switch')) applyTheme();
else customElements.whenDefined('wa-switch').then(applyTheme);

/* ---------- collection color chip ---------- */
const colChip = $('#colChip');
const colName = $('#colName');
const colSwatches = $('#colSwatches');
const colCustom = $('#colCustom');

function updateChipName() {
  const name = (colName.value || '').trim();
  colChip.textContent = name || '合集';
}
['input', 'change', 'wa-input', 'wa-change'].forEach(ev => colName.addEventListener(ev, updateChipName));

function selectColor(color, custom) {
  colChip.style.setProperty('--c', color);
  colSwatches.querySelectorAll('.swatch').forEach(btn => {
    const on = custom ? btn.classList.contains('custom') : btn.dataset.color === color;
    btn.classList.toggle('on', on);
  });
  colCustom.value = color;
}

colSwatches.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-color]');
  if (!btn) return;
  selectColor(btn.dataset.color, false);
});
colCustom.addEventListener('input', () => selectColor(colCustom.value, true));

/* ---------- demo toast ---------- */
const toastEl = $('#demoToast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2800);
}

function closeDialog(id) {
  const d = document.getElementById(id);
  if (d) d.removeAttribute('open');
}

$('#colSave').addEventListener('click', () => {
  toast('已保存（demo）：颜色会同步到 tab / 标签 / 筛选胶囊');
  closeDialog('collectionDialog');
});
$('#colDelete').addEventListener('click', () => toast('demo 不会真的删除合集'));
$('#previewDialog').querySelectorAll('[data-dialog="close"]').forEach(btn => {
  btn.addEventListener('click', () => closeDialog('previewDialog'));
});

/* ---------- queue demo interactions ---------- */
const queue = $('#queueDrawer');
queue.addEventListener('click', (e) => {
  if (e.target.closest('.dl-actions wa-button')) {
    toast('demo 交互：暂停 / 重试 / 播放会接真实下载器');
  } else if (e.target.closest('.queue-footer wa-button')) {
    toast('demo 交互：暂停全部 / 清理已完成');
  }
});

/* ---------- hero play / preview play ---------- */
document.querySelectorAll('.hero-play, .pv-play').forEach(btn => {
  btn.addEventListener('click', () => toast('demo 交互：这里会打开浏览器播放器'));
});

/* ---------- 让 data-dialog / data-drawer 的 demo 按钮有个轻提示 ---------- */
document.querySelectorAll('[data-dialog="open"], [data-drawer="open"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = (btn.getAttribute('data-dialog') || btn.getAttribute('data-drawer') || '').replace(/^open\s+/, '');
    setTimeout(() => toast(id === 'queueDrawer' ? '下载队列 demo' : id === 'collectionDialog' ? '合集编辑 demo' : '预览详情 demo'), 120);
  });
});
