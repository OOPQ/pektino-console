/* ui/select.js — 原生 select / Web Awesome wa-select 的统一选项写入 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function setSelectOptions(sel, options, value) {
  if (!sel) return;
  const opts = (options || []).map(o => (typeof o === 'string' || typeof o === 'number')
    ? { value: String(o), label: String(o), group: '' }
    : { value: String(o.value), label: String(o.label == null ? o.value : o.label), group: o.group || '' });
  if (sel.localName === 'wa-select') {
    sel.innerHTML = opts.map(o => `<wa-option value="${esc(o.value)}">${esc(o.group ? o.group + ' · ' + o.label : o.label)}</wa-option>`).join('');
  } else {
    sel.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.group ? o.group + ' · ' + o.label : o.label)}</option>`).join('');
  }
  if (value != null) sel.value = String(value);
}

export function selectOptionsFromHtml(sel, html) {
  if (!sel) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = html || '';
  const options = [...wrap.querySelectorAll('option')].map(o => ({
    value: o.value,
    label: o.textContent.trim(),
    group: o.closest('optgroup') ? (o.closest('optgroup').getAttribute('label') || '') : ''
  }));
  setSelectOptions(sel, options);
  return options;
}
