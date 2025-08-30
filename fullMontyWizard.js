// Full Monty all-in-one wizard
// This file implements a small step engine and a central data store that
// feeds the existing calculators (FY Money Calculator, Pension Projection
// and Personal Balance Sheet).

import { animate, addKeyboardNav } from './wizardCore.js';
import { currencyInput, percentInput, numFromInput, clampPercent } from './ui-inputs.js';
import { renderStepPensionRisk } from './stepPensionRisk.js';
import { MAX_SALARY_CAP } from './shared/assumptions.js';
import { setUIMode } from './uiMode.js';

// Temporary debug flag: set true to emit fake pension output without engine
const FM_DEBUG_FAKE_PENSION_OUTPUT = false;

const LS_KEY = 'fullMonty.store.v1';
const SCHEMA = 1;

function migrateStoreV2(raw){
  if(!raw) return raw;
  try{
    const parsed = JSON.parse(raw);
    if(parsed && typeof parsed === 'object' && parsed.data){
      let changed = false;
      ['homes','liquidity','investments','rentProps'].forEach(k=>{
        if(k in parsed.data){ delete parsed.data[k]; changed = true; }
      });
      return changed ? JSON.stringify(parsed) : raw;
    }
  }catch{}
  return raw;
}

function loadStore(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const migrated = migrateStoreV2(raw);
    if(migrated !== raw) localStorage.setItem(LS_KEY, migrated);
    const parsed = JSON.parse(migrated);
    if(parsed?.__schema !== SCHEMA) return null;
    return parsed.data || null;
  }catch{ return null; }
}
function saveStore(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({ __schema: SCHEMA, data: fullMontyStore }));
  }catch{}
}
let saveTimer = null;
function queueSave(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveStore, 150); }

// ───────────────────────────────────────────────────────────────
// Data store and helpers
// ----------------------------------------------------------------

const storedRiskKey = localStorage.getItem('fm.pensionRiskKey');
const storedRiskLabel = localStorage.getItem('fm.pensionRiskLabel');
const storedRiskRate = parseFloat(localStorage.getItem('fm.pensionGrowthRate'));
const defaultRiskKey = storedRiskKey || null;
const defaultRiskRate = !isNaN(storedRiskRate) ? storedRiskRate : null;
const defaultRiskLabel = storedRiskLabel || null;

const fullMontyStore = {
  // household
  hasPartner: false,
  dobSelf: null,
  dobPartner: null,
  retireAge: null,

  // income
  grossIncome: null,
  grossIncomePartner: null,

  // retirement goal (LOCKED to percent)
  goalType: 'percent',
  incomePercent: 70,

  // pensions (self/partner as before)
  currentPensionValueSelf: 0,
  personalContribSelf: null,
  personalPctSelf: null,
  employerContribSelf: null,
  employerPctSelf: null,
  hasDbSelf: false,
  dbPensionSelf: null,
  dbStartAgeSelf: null,
  statePensionSelf: false,

  currentPensionValuePartner: 0,
  personalContribPartner: null,
  personalPctPartner: null,
  employerContribPartner: null,
  employerPctPartner: null,
  hasDbPartner: false,
  dbPensionPartner: null,
  dbStartAgePartner: null,
  statePensionPartner: false,
  // other income
  rentalIncomeNow: 0,


  // risk profile
  pensionRisk: defaultRiskLabel,
  pensionRiskKey: defaultRiskKey,
  pensionGrowthRate: defaultRiskRate,

  // assumptions (internal only)
  cpiRate: 2.3,         // fixed, not user-editable
  sftAwareness: true    // fixed, not user-editable
};

const boot = loadStore();
if(boot && typeof boot === 'object'){
  Object.assign(fullMontyStore, boot);
}
window.addEventListener('beforeunload', saveStore);

  export function getStore() {
    return structuredClone(fullMontyStore);
  }

export function setStore(patch) {
  Object.assign(fullMontyStore, patch);
  queueSave();
}

// ───────────────────────────────────────────────────────────────
// DOM helpers
// ----------------------------------------------------------------

function q(id) { return document.getElementById(id); }


function formGroup(id, labelText, input) {
  const g = document.createElement('div');
  g.className = 'form-group';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = labelText;
  input.id = id;
  g.append(lab, input);
  return g;
}

function controlGroup(id, labelText, checked = false) {
  const g = document.createElement('div');
  g.className = 'form-group control';
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.id = id;
  inp.checked = checked;
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = labelText;
  g.append(inp, lab);
  return { group: g, input: inp };
}

function showErrors(errs = {}) {
  container.querySelectorAll('.error').forEach(e => e.remove());
  Object.entries(errs).forEach(([id, msg]) => {
    const field = q(id);
    if (!field) return;
    const grp = field.closest('.form-group');
    if (!grp) return;
    const div = document.createElement('div');
    div.className = 'error';
    div.textContent = msg;
    grp.appendChild(div);
  });
}

// Responsive swap: slider to stepper on mobile
function enhanceInputsForMobile() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  document.querySelectorAll('input.fm-range[type="range"]').forEach(range => {
    const container = range.closest('.fm-control') || range.parentElement;
    if (!container) return;

    if (isMobile && !container.querySelector('.fm-stepper')) {
      const step = Number(range.step || (Number(range.max) > 100 ? 100 : 1));
      const min = Number(range.min || 0);
      const max = Number(range.max || 100);
      const current = Number(range.value || min);

      const stepper = document.createElement('div');
      stepper.className = 'fm-stepper';
      stepper.innerHTML = `\n        <button type="button" class="fm-stepper-dec" aria-label="Decrease">−</button>\n        <input type="text" class="fm-stepper-input" inputmode="numeric" pattern="[0-9]*" aria-label="Value" />\n        <button type="button" class="fm-stepper-inc" aria-label="Increase">+</button>\n      `;

      // maintain labels
      const origId = range.id;
      if (origId) {
        const lab = document.querySelector(`label[for="${origId}"]`);
        range.id = `${origId}__range`;
        stepper.querySelector('.fm-stepper-input').id = origId;
        if (lab) lab.setAttribute('for', origId);
      }

      range.style.display = 'none';
      container.appendChild(stepper);

      const input = stepper.querySelector('.fm-stepper-input');
      const dec = stepper.querySelector('.fm-stepper-dec');
      const inc = stepper.querySelector('.fm-stepper-inc');

      const setValue = (v, fire = true) => {
        const clamped = Math.max(min, Math.min(max, Math.round(v / step) * step));
        input.value = clamped;
        range.value = clamped;
        if (fire) {
          range.dispatchEvent(new Event('input', { bubbles: true }));
          range.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      dec.addEventListener('click', () => setValue(Number(input.value) - step));
      inc.addEventListener('click', () => setValue(Number(input.value) + step));
      input.addEventListener('input', () => setValue(Number(input.value || min), false));
      input.addEventListener('blur', () => setValue(Number(input.value || min)));
      range.addEventListener('input', () => setValue(Number(range.value || min), false));

      setValue(current, false);
    }

    if (!isMobile) {
      const stepper = container.querySelector('.fm-stepper');
      if (stepper) stepper.remove();
      range.style.display = '';
    }
  });
}

// Step 3 – percent-only goal
function renderStepGoal(container){
  const s = getStore();
  setStore({ goalType: 'percent' });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className='form';

  const pctWrap = percentInput({ id:'incomePercent', value: s.incomePercent ?? '' });
  pctWrap.querySelector('input').addEventListener('input', (e)=>{
    const v = clampPercent(numFromInput(e.target)) ?? 0;
    e.target.value = v; // clamp visually
    setStore({ incomePercent: v, goalType: 'percent', retireSpend: null });
  });

  form.appendChild(formGroup('incomePercent', 'Income you will need at retirement', pctWrap));
  const help = document.createElement('div'); help.className='help'; help.textContent='We’ll target this share of your gross income.';
  form.appendChild(help);
  container.appendChild(form);
}
renderStepGoal.validate = () => {
  const v = getStore().incomePercent;
  return (typeof v === 'number' && v >= 0 && v <= 100) ? { ok:true } : { ok:false, message:'Enter a % between 0 and 100.' };
};

// Step engine
// ----------------------------------------------------------------

const modal = q('fullMontyModal');
const container = q('fmStepContainer');
const btnBack = q('fmBack');
const btnNext = q('fmNext');
const dots = q('fmDots');
const progEl = q('fmProgress');
const progFill = q('fmProgressFill');
const titleEl = q('fmTitle');

let cur = 0;
let steps = [];

function closeModal() {
  modal.classList.remove('is-open');
  if (window.__destroyFmWizardUX) window.__destroyFmWizardUX();
  document.body.classList.remove('modal-open');
  setUIMode('results');
}

function initFmWizardMobileUX(){
  const sheet  = document.querySelector('.fm-sheet');
  const header = document.querySelector('.fm-header');
  const footer = document.querySelector('.fm-footer');
  const bodyEl = document.querySelector('.fm-body');
  if(!sheet || !header || !footer || !bodyEl) return;

  const setHeights = () => {
    const hh = header.getBoundingClientRect().height;
    const fh = footer.getBoundingClientRect().height;
    sheet.style.setProperty('--fm-header-h', hh + 'px');
    sheet.style.setProperty('--fm-footer-h', fh + 'px');

    const vv = window.visualViewport;
    if (vv) {
      const usable = vv.height;
      const maxH = usable - hh - fh;
      bodyEl.style.maxHeight = Math.max(240, maxH) + 'px';
    } else {
      bodyEl.style.maxHeight = `calc(100% - ${hh + fh}px)`;
    }
  };

  const rAF = (cb)=>requestAnimationFrame(cb);
  const scrollFieldIntoView = (el) => rAF(()=> el.scrollIntoView({block:'center', behavior:'smooth'}));

  setHeights();
  window.addEventListener('resize', setHeights);
  window.addEventListener('orientationchange', setHeights);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setHeights);
    window.visualViewport.addEventListener('scroll', setHeights);
  }

  const focusHandler = (e)=>{
    const t = e.target.closest('input, select, textarea, [contenteditable="true"]');
    if (t) scrollFieldIntoView(t);
  };
  bodyEl.addEventListener('focusin', focusHandler);

  const nextBtn = document.querySelector('.fm-next');
  const nextHandler = ()=>{
    const firstInvalid = bodyEl.querySelector('.is-invalid, [aria-invalid="true"]');
    if (firstInvalid) scrollFieldIntoView(firstInvalid);
  };
  if (nextBtn) nextBtn.addEventListener('click', nextHandler);

  window.__destroyFmWizardUX = () => {
    window.removeEventListener('resize', setHeights);
    window.removeEventListener('orientationchange', setHeights);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', setHeights);
      window.visualViewport.removeEventListener('scroll', setHeights);
    }
    bodyEl.removeEventListener('focusin', focusHandler);
    if (nextBtn) nextBtn.removeEventListener('click', nextHandler);
  };
}

function paintProgress(){
  const total = steps.length;
  progEl.textContent = `Step ${cur + 1} of ${total}`;
  progFill.style.width = `${((cur + 1) / total) * 100}%`;
  dots.innerHTML = steps.map((_, i) => `<button class="wizDot${i === cur ? ' active' : ''}" data-idx="${i}"></button>`).join('');
  dots.querySelectorAll('button').forEach((b, i) => {
    b.addEventListener('click', () => { if (i <= cur) { cur = i; render(); } });
  });
  titleEl.textContent = steps[cur].title || '';
}

// Helper: focus first input after render
function focusFirst() {
  const el = container.querySelector('input, select, textarea, button');
  if (el) el.focus();
}

// Step definitions ------------------------------------------------

const baseSteps = [
  {
    id: 'household',
    title: 'About you',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      const partnerToggle = controlGroup('hasPartner', 'Do you plan your money together with a partner?', fullMontyStore.hasPartner);
      form.appendChild(partnerToggle.group);

      const row = document.createElement('div');
      row.className = 'form-2col';

      const dobSelf = document.createElement('input');
      dobSelf.type = 'date';
      if (fullMontyStore.dobSelf) dobSelf.value = fullMontyStore.dobSelf;
      dobSelf.addEventListener('input', () => setStore({ dobSelf: dobSelf.value || null }));
      row.appendChild(formGroup('dobSelf', 'Your date of birth', dobSelf));

      const retireAge = document.createElement('input');
      retireAge.type = 'number';
      retireAge.min = 18;
      if (fullMontyStore.retireAge != null) retireAge.value = fullMontyStore.retireAge;
      retireAge.addEventListener('input', () => setStore({ retireAge: numFromInput(retireAge) }));
      row.appendChild(formGroup('retireAge', 'Target retirement age', retireAge));

      form.appendChild(row);

      const partnerBlock = formGroup('dobPartner', 'Partner’s date of birth', (() => {
        const inp = document.createElement('input');
        inp.type = 'date';
        if (fullMontyStore.dobPartner) inp.value = fullMontyStore.dobPartner;
        inp.addEventListener('input', () => setStore({ dobPartner: inp.value || null }));
        return inp;
      })());
      partnerBlock.id = 'partnerBlock';
      partnerBlock.style.display = fullMontyStore.hasPartner ? '' : 'none';
      form.appendChild(partnerBlock);

      partnerToggle.input.addEventListener('change', () => {
        const chk = partnerToggle.input.checked;
        setStore({ hasPartner: chk, dobPartner: null });
        partnerBlock.style.display = chk ? '' : 'none';
        const p = partnerBlock.querySelector('input');
        if (!chk) { p.value = ''; }
        validateStep();
      });

      cont.appendChild(form);
    },
    validate() {
      const errs = {};
      if (!fullMontyStore.dobSelf) errs.dobSelf = 'This field is required.';
      if (fullMontyStore.hasPartner && !fullMontyStore.dobPartner) errs.dobPartner = 'This field is required.';
      if (fullMontyStore.retireAge == null) errs.retireAge = 'This field is required.';
      else if (fullMontyStore.retireAge < 0) errs.retireAge = 'Please enter a number ≥ 0.';
      const age = yearsFrom(fullMontyStore.dobSelf);
      if (fullMontyStore.retireAge != null && age && fullMontyStore.retireAge < age) errs.retireAge = 'Retirement age must be at least your current age.';
      return { ok: Object.keys(errs).length === 0, errors: errs };
    }
  },

  {
    id: 'income',
    title: 'Your income today',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      const gross = currencyInput({ id: 'grossIncome', value: fullMontyStore.grossIncome ?? '' });
      gross.querySelector('input').addEventListener('input', () => setStore({ grossIncome: numFromInput(gross.querySelector('input')) }));
      form.appendChild(formGroup('grossIncome', 'Your gross annual income', gross));

      if (fullMontyStore.hasPartner) {
        const gp = currencyInput({ id: 'grossIncomePartner', value: fullMontyStore.grossIncomePartner ?? '' });
        gp.querySelector('input').addEventListener('input', () => setStore({ grossIncomePartner: numFromInput(gp.querySelector('input')) }));
        form.appendChild(formGroup('grossIncomePartner', "Partner's gross annual income", gp));
      }

      cont.appendChild(form);
    },
    validate() {
      const errs = {};
      if (fullMontyStore.grossIncome == null) errs.grossIncome = 'This field is required.';
      else if (fullMontyStore.grossIncome < 0) errs.grossIncome = 'Please enter a number ≥ 0.';
      if (fullMontyStore.hasPartner) {
        if (fullMontyStore.grossIncomePartner == null) errs.grossIncomePartner = 'This field is required.';
        else if (fullMontyStore.grossIncomePartner < 0) errs.grossIncomePartner = 'Please enter a number ≥ 0.';
      }
      return { ok: Object.keys(errs).length === 0, errors: errs };
    }
  },

  {
    id: 'goal',
    title: 'Retirement income target',
    render: renderStepGoal,
    validate: renderStepGoal.validate
  },

  {
    id: 'pensions',
    title: 'Pensions & entitlements',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      function personBlock(prefix, labelPrefix) {
        const wrap = document.createElement('div');
        const h = document.createElement('h4');
        h.textContent = labelPrefix;
        wrap.appendChild(h);

        const cur = currencyInput({ id: `${prefix}Cur`, value: fullMontyStore[`currentPensionValue${labelPrefix}`] ?? 0 });
        cur.querySelector('input').addEventListener('input', () => setStore({ [`currentPensionValue${labelPrefix}`]: numFromInput(cur.querySelector('input')) || 0 }));
        wrap.appendChild(formGroup(`${prefix}Cur`, 'Current pension value', cur));

        const pc = currencyInput({ id: `${prefix}Pers€`, value: fullMontyStore[`personalContrib${labelPrefix}`] ?? '' });
        const pp = percentInput({ id: `${prefix}Pers%`, value: fullMontyStore[`personalPct${labelPrefix}`] ?? '' });
        pc.querySelector('input').addEventListener('input', () => {
          const v = numFromInput(pc.querySelector('input'));
          setStore({ [`personalContrib${labelPrefix}`]: v, [`personalPct${labelPrefix}`]: null });
          pp.querySelector('input').disabled = v != null && v !== 0;
        });
        pp.querySelector('input').addEventListener('input', () => {
          const v = numFromInput(pp.querySelector('input'));
          setStore({ [`personalPct${labelPrefix}`]: v, [`personalContrib${labelPrefix}`]: null });
          pc.querySelector('input').disabled = v != null && v !== 0;
        });
        wrap.appendChild(formGroup(`${prefix}Pers€`, 'Your contribution', pc));
        wrap.appendChild(formGroup(`${prefix}Pers%`, '…or % of salary', pp));

        const ec = currencyInput({ id: `${prefix}Emp€`, value: fullMontyStore[`employerContrib${labelPrefix}`] ?? '' });
        const ep = percentInput({ id: `${prefix}Emp%`, value: fullMontyStore[`employerPct${labelPrefix}`] ?? '' });
        ec.querySelector('input').addEventListener('input', () => {
          const v = numFromInput(ec.querySelector('input'));
          setStore({ [`employerContrib${labelPrefix}`]: v, [`employerPct${labelPrefix}`]: null });
          ep.querySelector('input').disabled = v != null && v !== 0;
        });
        ep.querySelector('input').addEventListener('input', () => {
          const v = numFromInput(ep.querySelector('input'));
          setStore({ [`employerPct${labelPrefix}`]: v, [`employerContrib${labelPrefix}`]: null });
          ec.querySelector('input').disabled = v != null && v !== 0;
        });
        wrap.appendChild(formGroup(`${prefix}Emp€`, 'Employer contribution', ec));
        wrap.appendChild(formGroup(`${prefix}Emp%`, '…or % of salary', ep));
        return wrap;
      }

      form.appendChild(personBlock('self', 'Self'));
      if (fullMontyStore.hasPartner) form.appendChild(personBlock('partner', 'Partner'));
      cont.appendChild(form);
    },
    validate() { return { ok: true, errors: {} }; }
  },

  {
    id: 'otherIncome',
    title: 'Other income at / after retirement',
    render(cont){
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      // ---------- Rental income (simple) ----------
      const rentWrap = currencyInput({
        id: 'rentalIncomeNow',
        value: fullMontyStore.rentalIncomeNow ?? ''
      });
      rentWrap.querySelector('input')
        .addEventListener('input', () => setStore({
          rentalIncomeNow: numFromInput(rentWrap.querySelector('input')) || 0
        }));
      form.appendChild(formGroup('rentalIncomeNow', 'Current annual rental income (if any)', rentWrap));

      // ---------- Pretty toggle helpers ----------
      const togglePill = (id, label, checked, onChange) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill-toggle' + (checked ? ' is-on' : '');
        btn.id = id;
        btn.innerHTML = `
        <span class="dot"></span>
        <span class="txt">${label}</span>
      `;
        btn.addEventListener('click', () => {
          const nowOn = !btn.classList.contains('is-on');
          btn.classList.toggle('is-on', nowOn);
          onChange(nowOn);
        });
        return btn;
      };

      const card = (title, bodyEl, initiallyOpen=false) => {
        const el = document.createElement('div');
        el.className = 'income-card' + (initiallyOpen ? ' open' : '');
        el.innerHTML = `
        <div class="ic-head">
          <div class="ic-title">${title}</div>
          <div class="ic-actions"><button type="button" class="ic-toggle" aria-expanded="${initiallyOpen}">Details</button></div>
        </div>
        <div class="ic-body"></div>
      `;
        el.querySelector('.ic-body').appendChild(bodyEl);
        el.querySelector('.ic-toggle').addEventListener('click', () => {
          const open = !el.classList.contains('open');
          el.classList.toggle('open', open);
          el.querySelector('.ic-toggle').setAttribute('aria-expanded', String(open));
        });
        return el;
      };

      // ---------- State Pension pills ----------
      const spRow = document.createElement('div');
      spRow.className = 'pill-row';
      const spSelf = togglePill(
        'spSelf',
        'You: State Pension',
        !!fullMontyStore.statePensionSelf,
        (on) => setStore({ statePensionSelf: on })
      );
      spRow.appendChild(spSelf);

      if (fullMontyStore.hasPartner) {
        const spPartner = togglePill(
          'spPartner',
          'Partner: State Pension',
          !!fullMontyStore.statePensionPartner,
          (on) => setStore({ statePensionPartner: on })
        );
        spRow.appendChild(spPartner);
      }
      form.appendChild(spRow);

      const hint = document.createElement('p');
      hint.className = 'help';
      hint.textContent = 'We\u2019ll include State Pension from age 66 for each person selected.';
      form.appendChild(hint);

      // ---------- DB cards (expandable per person) ----------
      const mkDbBody = (who) => {
        const wrap = document.createElement('div');
        wrap.className = 'stack';

        const editor = document.createElement('div');

        const dbPill = togglePill(
          `${who}DbPill`,
          'Has a Defined\u2011Benefit pension',
          !!fullMontyStore[`hasDb${who}`],
          (on) => {
            setStore({
              [`hasDb${who}`]: on,
              [`dbPension${who}`]: on ? fullMontyStore[`dbPension${who}`] : null,
              [`dbStartAge${who}`]: on ? fullMontyStore[`dbStartAge${who}`] : null
            });
            editor.style.display = on ? '' : 'none';
          }
        );
        wrap.appendChild(dbPill);

        editor.style.display = fullMontyStore[`hasDb${who}`] ? '' : 'none';
        const amt = currencyInput({
          id: `${who}DbAmt`,
          value: fullMontyStore[`dbPension${who}`] ?? ''
        });
        amt.querySelector('input').addEventListener('input', () => {
          setStore({ [`dbPension${who}`]: numFromInput(amt.querySelector('input')) || 0 });
        });

        const age = document.createElement('input');
        age.type = 'number'; age.min = 50; age.max = 100; age.id = `${who}DbAge`;
        if (fullMontyStore[`dbStartAge${who}`] != null) age.value = fullMontyStore[`dbStartAge${who}`];
        age.addEventListener('input', () => setStore({ [`dbStartAge${who}`]: numFromInput(age) || null }));
        age.addEventListener('blur', () => {
          if (!age.value && fullMontyStore.retireAge) {
            age.value = fullMontyStore.retireAge;
            setStore({ [`dbStartAge${who}`]: fullMontyStore.retireAge });
          }
        });

        editor.appendChild(formGroup(`${who}DbAmt`, 'DB annual amount (€/yr)', amt));
        editor.appendChild(formGroup(`${who}DbAge`, 'DB pension start age', age));
        wrap.appendChild(editor);

        return wrap;
      };

      const dbSelfBody = mkDbBody('Self');
      form.appendChild(card('Your Defined\u2011Benefit pension', dbSelfBody, !!fullMontyStore.hasDbSelf));

      if (fullMontyStore.hasPartner) {
        const dbPartnerBody = mkDbBody('Partner');
        form.appendChild(card('Partner\u2019s Defined\u2011Benefit pension', dbPartnerBody, !!fullMontyStore.hasDbPartner));
      }

      cont.appendChild(form);
    },
    validate(){
      const errs = {};
      if (fullMontyStore.hasDbSelf) {
        if (!fullMontyStore.dbPensionSelf) errs.SelfDbAmt = 'Enter DB amount';
        if (!fullMontyStore.dbStartAgeSelf) errs.SelfDbAge = 'Enter start age';
      }
      if (fullMontyStore.hasPartner && fullMontyStore.hasDbPartner) {
        if (!fullMontyStore.dbPensionPartner) errs.PartnerDbAmt = 'Enter DB amount';
        if (!fullMontyStore.dbStartAgePartner) errs.PartnerDbAge = 'Enter start age';
      }
      if ((fullMontyStore.rentalIncomeNow ?? 0) < 0) errs.rentalIncomeNow = 'Must be ≥ 0';
      const ok = Object.keys(errs).length === 0;
      return { ok, errors: ok ? {} : errs };
    }
  },

  {
    id: 'pensionRisk',
    title: 'Select an investment-growth (risk) profile for your pension',
    render(cont){
      cont.innerHTML = '';
      const helper = document.createElement('p');
      helper.textContent = 'We use this to project how your pension could grow over time. It\u2019s a long-term assumption, not a guarantee\u2014you can change it later.';
      cont.appendChild(helper);
      const sel = document.createElement('div');
      sel.id = 'risk-selection';
      cont.appendChild(sel);
      console.debug('[fullMontyWizard] renderStepPensionRisk Step 6');
      renderStepPensionRisk(sel, fullMontyStore, setStore, btnNext);
    },
    validate(){
      return (renderStepPensionRisk.validate && renderStepPensionRisk.validate()) || { ok:false, message:'Please choose a risk profile.' };
    }
  }
];

function hasDcPension(){
  const s = fullMontyStore;
  return (
    (s.currentPensionValueSelf || 0) > 0 ||
    (s.currentPensionValuePartner || 0) > 0 ||
    (s.personalContribSelf || 0) > 0 ||
    (s.personalPctSelf || 0) > 0 ||
    (s.employerContribSelf || 0) > 0 ||
    (s.employerPctSelf || 0) > 0 ||
    (s.personalContribPartner || 0) > 0 ||
    (s.personalPctPartner || 0) > 0 ||
    (s.employerContribPartner || 0) > 0 ||
    (s.employerPctPartner || 0) > 0
  );
}

function refreshSteps(){
  const showRisk = hasDcPension();
  steps = baseSteps.filter(s => s.id !== 'pensionRisk' || showRisk);
  if(!showRisk){
    setStore({ pensionRisk: 'Not applicable (DB only)', pensionRiskKey: 'dbOnly', pensionGrowthRate: 0 });
    localStorage.setItem('fm.pensionRiskKey','dbOnly');
    localStorage.setItem('fm.pensionRiskLabel','Not applicable (DB only)');
    localStorage.setItem('fm.pensionGrowthRate','0');
  }
}

// Compute years difference helper
function yearsFrom(dobStr) {
  const dob = new Date(dobStr);
  const diff = Date.now() - dob.getTime();
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

// Wizard navigation ------------------------------------------------

function render() {
  setUIMode('wizard');
  hideEditFab();
  refreshSteps();
  if (cur >= steps.length) cur = steps.length - 1;
  const step = steps[cur];
  paintProgress();
  container.innerHTML = '';
  step.render(container);
  enhanceInputsForMobile();
  container.querySelectorAll('input, select, textarea, button').forEach(el => {
    el.addEventListener('blur', () => validateStep(true));
    el.addEventListener('input', () => validateStep());
    el.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  });
  validateStep();
  btnBack.style.display = cur === 0 ? 'none' : '';
  btnNext.textContent = cur === steps.length - 1 ? 'Finish' : 'Next';
  focusFirst();
  window.dispatchEvent(new Event('resize'));
}

function validateStep(show = false) {
  const res = steps[cur].validate();
  btnNext.disabled = !res.ok;
  if (show) showErrors(res.errors || {}); else showErrors();
  return res.ok;
}

function next() {
  if (!validateStep(true)) return;
  if (cur < steps.length - 1) {
    animate(container, 'next');
    cur++;
    render();
  } else {
    runAll();   // fire both calcs; runAll() already closes the modal at the end
  }
}

function back() {
  if (cur === 0) return;
  animate(container, 'back');
  cur--; render();
}

btnNext.addEventListener('click', next);
btnBack.addEventListener('click', back);

addKeyboardNav(modal, { back, next, close: closeModal, getCur: () => cur, getTotal: () => steps.length });

window.addEventListener('resize', () => {
  clearTimeout(window._fm_rsz);
  window._fm_rsz = setTimeout(enhanceInputsForMobile, 150);
});
document.addEventListener('DOMContentLoaded', enhanceInputsForMobile);

// ───────────────────────────────────────────────────────────────
// Run handler & auto classification
// ----------------------------------------------------------------


function runAll() {
  const pensionArgs = {
    salary: Math.min(fullMontyStore.grossIncome || 0, MAX_SALARY_CAP),
    currentValue: fullMontyStore.currentPensionValueSelf || 0,
    personalContrib: fullMontyStore.personalContribSelf,
    personalPct: fullMontyStore.personalPctSelf,
    employerContrib: fullMontyStore.employerContribSelf,
    employerPct: fullMontyStore.employerPctSelf,
    dob: fullMontyStore.dobSelf,
    retireAge: Math.max(50, Math.min(70, fullMontyStore.retireAge || 0)),
    growth: fullMontyStore.pensionGrowthRate || 0.05,
    pensionRisk: fullMontyStore.pensionRisk,
    sftAwareness: fullMontyStore.sftAwareness
  };
  document.dispatchEvent(new CustomEvent('fm-run-pension', { detail: pensionArgs }));

  if (FM_DEBUG_FAKE_PENSION_OUTPUT) {
    const ageNow = (fullMontyStore.dobSelf
      ? Math.floor((Date.now() - new Date(fullMontyStore.dobSelf)) / (365.25*24*3600*1000))
      : 40);
    const ageRet = Math.max(50, Math.min(70, fullMontyStore.retireAge || 65));
    const years = Math.max(1, ageRet - ageNow);
    const start = fullMontyStore.currentPensionValueSelf || 0;
    const g = fullMontyStore.pensionGrowthRate ?? 0.05;
    const balances = Array.from({ length: years + 1 }, (_, i) => ({
      age: ageNow + i,
      value: start * Math.pow(1 + g, i)
    }));
    document.dispatchEvent(new CustomEvent('fm-pension-output', {
      detail: {
        balances,
        projValue: balances.at(-1).value,
        retirementYear: new Date().getFullYear() + years,
        contribsBase: Array(balances.length).fill(0),
        growthBase: Array(balances.length).fill(0),
        sftLimit: undefined,
        showMax: false
      }
    }));
  }

  const fyArgs = {
    grossIncome: fullMontyStore.grossIncome || 0,
    targetType: 'percent',
    incomePercent: fullMontyStore.incomePercent || 70,
    dob: fullMontyStore.dobSelf,
    partnerDob: fullMontyStore.dobPartner,
    retireAge: fullMontyStore.retireAge,
    statePensionSelf: !!fullMontyStore.statePensionSelf,
    hasDbSelf: !!fullMontyStore.hasDbSelf,
    dbPensionSelf: fullMontyStore.dbPensionSelf || 0,
    dbStartAgeSelf: fullMontyStore.dbStartAgeSelf || null,
    rentalIncomeNow: fullMontyStore.rentalIncomeNow || 0,
    growthRate: fullMontyStore.pensionGrowthRate || 0.05,
    pensionRisk: fullMontyStore.pensionRisk,
    hasPartner: !!fullMontyStore.hasPartner,
    statePensionPartner: !!fullMontyStore.statePensionPartner,
    hasDbPartner: !!fullMontyStore.hasDbPartner,
    dbPensionPartner: fullMontyStore.dbPensionPartner || 0,
    dbStartAgePartner: fullMontyStore.dbStartAgePartner || null
  };
  document.dispatchEvent(new CustomEvent('fm-run-fy', { detail: fyArgs }));

  closeModal();
}

// ====== STATE & UTILITIES ======
let baselineSnapshot = null;            // snapshot of inputs when results first render
const actionStack = [];                 // for Undo (last change)
let deltaContribEuro = 0;               // cumulative € change vs baseline
let deltaRetireYears = 0;               // cumulative years change vs baseline
const store = fullMontyStore;

function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }

function announce(msg){
  const live = document.getElementById('resultsView');
  if (live) live.setAttribute('aria-label', msg); // quick SR announcement
}

function formatEUR(x){
  try{ return new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(x); }
  catch(e){ return '€'+Math.round(+x||0).toLocaleString('en-IE'); }
}

function recomputeAndRefreshUI(){
  runAll();
  const view = document.getElementById('resultsView');
  if (view && typeof window.renderResults === 'function'){
    window.renderResults(view, store);
  }
}

function withBusyState(button, fn){
  if (!button) return fn();
  button.disabled = true;
  button.classList.add('is-busy');
  Promise.resolve().then(fn).finally(()=>{
    button.disabled = false;
    button.classList.remove('is-busy');
  });
}

// Central setter for the "Use max contributions" scenario.
function setUseMaxContributions(enabled){
  // Normalize boolean
  store.useMaxContributions = !!enabled;

  // Propagate to global helpers that rely on this flag
  if (typeof window !== 'undefined') {
    window.useMax = store.useMaxContributions;
    if (typeof setMaxToggle === 'function') setMaxToggle(store.useMaxContributions);
    if (typeof onMaxContribsToggleChanged === 'function') onMaxContribsToggleChanged(store.useMaxContributions);
  }

  // Recompute and re-render EVERYTHING (hero + charts)
  recomputeAndRefreshUI();

  // Accessible announcement
  announce(enabled
    ? 'Max contributions scenario enabled.'
    : 'Max contributions scenario disabled.');
}

function syncMaxToggleUI(){
  const maxTgl = document.getElementById('maxContribsChk');
  if (maxTgl) maxTgl.checked = !!store.useMaxContributions;
}

// ====== MAX CONTRIBUTION HELPERS ======
const CONTRIB_KEYS = {
  monthlyEuro: ['personalContribSelf','personalMonthlyContribution','employeeContributionMonthly','contribMonthly'],
  percent:     ['personalPctSelf','employeeContributionPct','personalContributionPct'],
  maxMonthly:  ['maxContribMonthly','maxAllowedMonthlyContribution','taxRelievedMonthlyCap']
};

function keyIn(obj, keys){ return keys.find(k => Object.prototype.hasOwnProperty.call(obj, k)); }

function getCurrentMonthlyContrib(){
  const k = keyIn(store, CONTRIB_KEYS.monthlyEuro);
  return k ? Number(store[k] || 0) : 0;
}
function setCurrentMonthlyContrib(val){
  const k = keyIn(store, CONTRIB_KEYS.monthlyEuro);
  if (k){
    setStore({ [k]: Math.max(0, Number(val) || 0) });
    return true;
  }
  const pk = keyIn(store, CONTRIB_KEYS.percent);
  const salary = Number(store.grossIncome || store.salary || 0);
  if (pk && salary > 0){
    const monthlySalary = salary/12;
    const pct = Math.max(0, Math.min(100, ((Number(val) || 0)/monthlySalary)*100));
    setStore({ [pk]: pct });
    return true;
  }
  return false;
}

function computeMaxTaxRelievedMonthly(s){
  const dob = s.dobSelf || s.dob;
  if(!dob) return Infinity;
  const age = Math.floor((Date.now() - new Date(dob)) / (365.25*24*3600*1000));
  const salary = Number(s.grossIncome || s.salary || 0);
  const salaryCapped = Math.min(salary, MAX_SALARY_CAP);
  const bands = [ { max:29,pct:0.15 }, { max:39,pct:0.20 }, { max:49,pct:0.25 }, { max:54,pct:0.30 }, { max:59,pct:0.35 }, { max:120,pct:0.40 } ];
  const pct = bands.find(b => age <= b.max).pct;
  return (salaryCapped * pct) / 12;
}

function getMaxMonthlyContrib(){
  const k = keyIn(store, CONTRIB_KEYS.maxMonthly);
  if (k) return Number(store[k] || 0);
  return computeMaxTaxRelievedMonthly(store);
}

function contributionsAtMax(){
  const cur = getCurrentMonthlyContrib();
  const max = getMaxMonthlyContrib();
  return (isFinite(max) && cur >= max - 1);
}

// ====== ACTION HANDLERS ======
function increaseMonthlyContributionBy(deltaEuro){
  const cur = getCurrentMonthlyContrib();
  const max = getMaxMonthlyContrib();
  let next = cur + deltaEuro;
  if (isFinite(max) && next > max) next = max;
  const ok = setCurrentMonthlyContrib(next);
  if (!ok) return;
  deltaContribEuro += (next - cur);
  actionStack.push({ type:'contrib', delta: next - cur });
  recomputeAndRefreshUI();
  if (contributionsAtMax()){
    announce('You have reached the maximum tax-relieved contribution for your current age.');
  } else {
    announce(`Contributions increased to ${formatEUR(next)} per month.`);
  }
}

function delayRetirementByYears(years){
  const key = 'retireAge';
  const minAge = 50; const maxAge = 75;
  const from = Number(store[key] || 65);
  const to = Math.max(minAge, Math.min(maxAge, from + years));
  if (to === from) return;
  setStore({ [key]: to });
  deltaRetireYears += (to - from);
  actionStack.push({ type:'age', delta: (to - from) });
  recomputeAndRefreshUI();
  announce(`Retirement age set to ${to}.`);
}

function undoLast(){
  const last = actionStack.pop();
  if (!last) return;
  if (last.type === 'contrib'){
    const cur = getCurrentMonthlyContrib();
    setCurrentMonthlyContrib(Math.max(0, cur - last.delta));
    deltaContribEuro -= last.delta;
  } else if (last.type === 'age'){
    const key = 'retireAge';
    setStore({ [key]: Number(store[key] || 65) - last.delta });
    deltaRetireYears -= last.delta;
  }
  recomputeAndRefreshUI();
  announce('Last change undone.');
}

function restoreBaseline(){
  if (!baselineSnapshot) return;
  const k = keyIn(store, CONTRIB_KEYS.monthlyEuro);
  const pk = keyIn(store, CONTRIB_KEYS.percent);
  const patch = {};
  if (k && baselineSnapshot[k] !== undefined) patch[k] = baselineSnapshot[k];
  if (pk && baselineSnapshot[pk] !== undefined) patch[pk] = baselineSnapshot[pk];
  if (baselineSnapshot.retireAge !== undefined) patch.retireAge = baselineSnapshot.retireAge;
  setStore(patch);
  deltaContribEuro = 0;
  deltaRetireYears = 0;
  actionStack.length = 0;
  setUseMaxContributions(baselineSnapshot.useMaxContributions);
  announce('Inputs restored to your original values.');
}

// ====== FAB VISIBILITY ======
function showEditFab(onClick){
  const fab = document.getElementById('editInputsFab');
  if(!fab) return;
  fab.style.display = 'flex';
  fab.onclick = onClick;
}

function hideEditFab(){
  const fab = document.getElementById('editInputsFab');
  if(!fab) return;
  fab.style.display = 'none';
  fab.onclick = null;
}

function makeMetricChip(label, value){
  const chip = document.createElement('div');
  chip.className = 'metric-chip';
  chip.innerHTML = `<span class="metric-label">${label}</span><span class="metric-value">${value}</span>`;
  return chip;
}

/* ---- Dynamic bottom UI compensation using visualViewport ---- */
function updateViewportChromeOffset(){
  try{
    const vv = window.visualViewport;
    if (!vv) return; // older browsers
    // The amount of layout viewport hidden by bottom browser UI (rough estimate):
    const bottomUI = Math.max(0, (window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--viewport-bottom-ui', bottomUI + 'px');
  }catch(e){}
}

// Call on load, resize, and orientation changes
window.addEventListener('DOMContentLoaded', updateViewportChromeOffset, { once:true });
window.addEventListener('resize', updateViewportChromeOffset);
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', updateViewportChromeOffset);
  window.visualViewport.addEventListener('scroll', updateViewportChromeOffset);
}

/* ---- Hide the scroll affordance once the user starts scrolling ---- */
function attachHeroScrollAffordance(heroEl){
  if (!heroEl) return;
  const onScroll = () => {
    if (window.scrollY > 10) {
      heroEl.classList.add('scrolled');
      window.removeEventListener('scroll', onScroll);
    }
  };
  window.addEventListener('scroll', onScroll, { passive:true });
}

function renderResults(container, storeRef){
  container.innerHTML = '';

  const store = storeRef || {};

  const projected = Number(store.projectedPotAtRetirement || store.projectedPot || 0);
  const required  = Number(store.financialFreedomTarget || store.fyTarget || 0);
  const age       = Number(store.desiredRetirementAge || store.retirementAge || store.retireAge || 65);
  const partnerIncluded = !!(store.partnerDOB || store.partnerIncluded || store.hasPartner);

  const deficit = Math.max(required - projected, 0);
  const surplus = Math.max(projected - required, 0);

  const hero = document.createElement('section');
  hero.className = 'results-hero fullscreen-hero reveal';

  const num = document.createElement('h2');
  num.className = 'hero-number';
  num.textContent = deficit ? formatEUR(deficit) : formatEUR(surplus);

  const line = document.createElement('p');
  line.className = 'hero-headline-text';
  line.textContent = deficit ? 'below your retirement goal' : 'above your retirement goal';

  hero.appendChild(num);
  hero.appendChild(line);

  const pensionLabel   = partnerIncluded ? 'your combined projected pensions are' : 'your projected pension is';
  const lifestyleLabel = partnerIncluded ? 'your household’s lifestyle'           : 'your desired lifestyle';

  const sub = document.createElement('p');
  sub.className = 'hero-sub';
  sub.textContent = `At age ${age}, ${pensionLabel} ${formatEUR(projected)}. To sustain ${lifestyleLabel} in retirement, we estimate you’ll need ${formatEUR(required)}.`;
  hero.appendChild(sub);

  const chips = document.createElement('div'); chips.className = 'metrics-chips';
  chips.appendChild(makeMetricChip('Your pension', formatEUR(projected)));
  chips.appendChild(makeMetricChip('Required',     formatEUR(required)));
  hero.appendChild(chips);

  const actions = document.createElement('div'); actions.className = 'actions-row';
  const rowMoney = document.createElement('div'); rowMoney.className = 'nudge-row';
  const rowTime  = document.createElement('div'); rowTime.className  = 'nudge-row';

  const btnRemove200 = document.createElement('button');
  btnRemove200.className = 'btn btn-pill';
  btnRemove200.textContent = '– Remove €200/mo';
  btnRemove200.setAttribute('aria-label','Reduce contributions by €200 per month');
  btnRemove200.addEventListener('click', () =>
    withBusyState(btnRemove200, () => increaseMonthlyContributionBy(-200))
  );

  const btnAdd200 = document.createElement('button');
  btnAdd200.className = 'btn btn-pill';
  btnAdd200.textContent = '+ Add €200/mo';
  btnAdd200.setAttribute('aria-label','Increase contributions by €200 per month');
  btnAdd200.addEventListener('click', () =>
    withBusyState(btnAdd200, () => increaseMonthlyContributionBy(200))
  );

  const btnEarlier = document.createElement('button');
  btnEarlier.className = 'btn btn-pill';
  btnEarlier.textContent = '⏪ Retire 1 yr earlier';
  btnEarlier.setAttribute('aria-label','Retire one year earlier');
  btnEarlier.addEventListener('click', () =>
    withBusyState(btnEarlier, () => delayRetirementByYears(-1))
  );

  const btnLater = document.createElement('button');
  btnLater.className = 'btn btn-pill';
  btnLater.textContent = '⏩ Retire 1 yr later';
  btnLater.setAttribute('aria-label','Retire one year later');
  btnLater.addEventListener('click', () =>
    withBusyState(btnLater, () => delayRetirementByYears(1))
  );

  rowMoney.appendChild(btnRemove200);
  rowMoney.appendChild(btnAdd200);
  rowTime.appendChild(btnEarlier);
  rowTime.appendChild(btnLater);
  actions.appendChild(rowMoney);
  actions.appendChild(rowTime);
  hero.appendChild(actions);

  const atMaxContrib = contributionsAtMax();
  const minAge = 50, maxAge = 75;

  restyleNudgesForContext(
    {
      shortfall: deficit,
      atMaxContrib,
      minAgeReached: age <= minAge,
      maxAgeReached: age >= maxAge
    },
    { btnRemove200, btnAdd200, btnEarlier, btnLater }
  );

  container.appendChild(hero);
  requestAnimationFrame(()=> hero.classList.add('reveal--in'));
}

/* Context-aware styling function */
function restyleNudgesForContext(context, refs){
  const { shortfall, atMaxContrib, minAgeReached, maxAgeReached } = context;
  const { btnRemove200, btnAdd200, btnEarlier, btnLater } = refs;

  [btnRemove200, btnAdd200, btnEarlier, btnLater].forEach(b=>{
    b.classList.remove('btn-green','btn-outline','is-disabled');
    b.removeAttribute('aria-disabled');
    b.disabled = false; b.title='';
  });

  const isShortfall = shortfall > 0;

  if (isShortfall){
    btnAdd200.classList.add('btn-green');
    btnLater.classList.add('btn-green');
    btnRemove200.classList.add('btn-outline');
    btnEarlier.classList.add('btn-outline');
  } else {
    btnRemove200.classList.add('btn-green');
    btnEarlier.classList.add('btn-green');
    btnAdd200.classList.add('btn-outline');
    btnLater.classList.add('btn-outline');
  }

  if (atMaxContrib){
    btnAdd200.classList.remove('btn-green');
    btnAdd200.classList.add('btn-outline','is-disabled');
    btnAdd200.disabled = true;
    btnAdd200.setAttribute('aria-disabled','true');
    btnAdd200.title = 'Max tax-relieved contribution reached for your current age.';
  }
  if (minAgeReached){
    btnEarlier.classList.add('is-disabled');
    btnEarlier.disabled = true;
    btnEarlier.setAttribute('aria-disabled','true');
    btnEarlier.title = 'Minimum retirement age reached.';
  }
  if (maxAgeReached){
    btnLater.classList.add('is-disabled');
    btnLater.disabled = true;
    btnLater.setAttribute('aria-disabled','true');
    btnLater.title = 'Maximum retirement age reached.';
  }
}

// ───────────────────────────────────────────────────────────────
// Public API
// ----------------------------------------------------------------

export function openFullMontyWizard() {
  cur = 0;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');
  render();
  initFmWizardMobileUX();
}

export function getFullMontyData() { return getStore(); }

document.addEventListener('fm-open-wizard', openFullMontyWizard);

// Auto-launch if script loaded directly
if (document.readyState !== 'loading') {
  openFullMontyWizard();
} else {
  document.addEventListener('DOMContentLoaded', openFullMontyWizard);
}

window.showEditFab = showEditFab;
window.hideEditFab = hideEditFab;
window.renderResults = renderResults;
window.navigateToInputs = openFullMontyWizard;
window.setUseMaxContributions = setUseMaxContributions;

