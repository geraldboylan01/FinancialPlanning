// ui-inputs.js
export function attachZeroClear(input){
  if(!input) return;
  input.addEventListener('focus', () => { if(input.value === '0') input.value = ''; });
  input.addEventListener('blur', () => { if(input.value === '') input.value = '0'; });
  return input;
}

export function currencyInput({ id, value = '', placeholder = '0' } = {}){
  const wrap = document.createElement('div'); wrap.className = 'input-wrap prefix';
  const unit = document.createElement('span'); unit.className='unit'; unit.textContent='€';
  const inp = document.createElement('input'); inp.type='number'; inp.id=id || (globalThis.crypto?.randomUUID?.() || ('id-'+Math.random().toString(36).slice(2)));
  inp.inputMode='decimal'; inp.placeholder=placeholder;
  if(value !== '' && value != null) inp.value=value;
  attachZeroClear(inp);
  wrap.append(unit, inp);
  return wrap;
}

export function percentInput({ id, value = '', placeholder = '0' } = {}){
  const wrap = document.createElement('div'); wrap.className = 'input-wrap suffix';
  const unit = document.createElement('span'); unit.className='unit'; unit.textContent='%';
  const inp = document.createElement('input'); inp.type='number'; inp.id=id || (globalThis.crypto?.randomUUID?.() || ('id-'+Math.random().toString(36).slice(2)));
  inp.inputMode='decimal'; inp.min='0'; inp.max='100'; inp.step='0.1'; inp.placeholder=placeholder;
  if(value !== '' && value != null) inp.value=value;
  attachZeroClear(inp);
  wrap.append(inp, unit);
  return wrap;
}
export function numFromInput(inputEl){
  const v = parseFloat(inputEl.value);
  return Number.isNaN(v) ? null : v;
}
export function clampPercent(n){
  if(n == null) return null;
  if(n < 0) return 0;
  if(n > 100) return 100;
  return +n;
}
