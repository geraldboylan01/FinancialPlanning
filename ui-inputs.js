// ui-inputs.js
export function attachZeroClear(inputEl, { clampPercent: doClamp = false } = {}){
  inputEl.addEventListener('focus', () => {
    if (inputEl.value === '' || inputEl.value === '0' || inputEl.value === '0.0') {
      inputEl.select?.();
      inputEl.value = '';
    }
  });
  inputEl.addEventListener('blur', () => {
    if (inputEl.value.trim() === '') inputEl.value = '';
    if (doClamp) {
      let v = parseFloat(inputEl.value);
      if (!Number.isNaN(v)) {
        if (v < 0) v = 0;
        if (v > 100) v = 100;
        inputEl.value = v;
      }
    }
  });
}

export function currencyInput({ id, value = '', placeholder = '' } = {}){
  const wrap = document.createElement('div'); wrap.className = 'input-wrap prefix';
  const unit = document.createElement('span'); unit.className='unit'; unit.textContent='€';
  const inp = document.createElement('input'); inp.type='number';
  inp.id=id || (globalThis.crypto?.randomUUID?.() || ('id-'+Math.random().toString(36).slice(2)));
  inp.inputMode='decimal';
  inp.pattern='[0-9]*';
  inp.placeholder = placeholder || '0';
  if (value !== null && value !== undefined && value !== 0) inp.value = String(value);
  wrap.append(unit, inp);
  attachZeroClear(inp);
  return wrap;
}

export function percentInput({ id, value = '', placeholder = '' } = {}){
  const wrap = document.createElement('div'); wrap.className = 'input-wrap suffix';
  const unit = document.createElement('span'); unit.className='unit'; unit.textContent='%';
  const inp = document.createElement('input'); inp.type='number';
  inp.id=id || (globalThis.crypto?.randomUUID?.() || ('id-'+Math.random().toString(36).slice(2)));
  inp.inputMode='numeric';
  inp.pattern='[0-9]*';
  inp.min='0'; inp.max='100'; inp.step='0.1';
  inp.placeholder = placeholder || '0';
  if (value !== null && value !== undefined && value !== 0) inp.value = String(value);
  wrap.append(inp, unit);
  attachZeroClear(inp, { clampPercent: true });
  return wrap;
}
export function numFromInput(inputEl){
  const raw = String(inputEl.value).replace(/[^0-9.\-]/g, '');
  const v = parseFloat(raw);
  return Number.isNaN(v) ? null : v;
}
export function clampPercent(n){
  if(n == null) return null;
  if(n < 0) return 0;
  if(n > 100) return 100;
  return +n;
}
