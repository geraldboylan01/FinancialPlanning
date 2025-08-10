// Full Monty all-in-one wizard
// This file implements a small step engine and a central data store that
// feeds the existing calculators (FY Money Calculator, Pension Projection
// and Personal Balance Sheet).

import { animate, addKeyboardNav } from './wizardCore.js';
import { currencyInput, percentInput, numFromInput, clampPercent } from './ui-inputs.js';

const LS_KEY = 'fullMonty.store.v1';
const SCHEMA = 1;

function loadStore(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
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

  // ASSETS (split into mini-steps)
  // Homes you live in / holiday places
  homes: {
    familyHome: { value: 0, hasRent: false, rentAmount: 0 },
    holidayHome: { value: 0, hasRent: false, rentAmount: 0 }
  },

  // Cash-like / liquidity (all € amounts)
  liquidity: {
    currentAccount: 0,
    cashSavings: 0,
    moneyMarket: 0,
    bond100: 0,
    otherInstant: 0
  },

  // Non-pension investments (all € amounts)
  investments: {
    etfIndexFunds: 0,
    mixedEquityFunds: 0,
    brokerageCash: 0,
    otherInvestments: 0
  },

  // Properties for rent (can still be a compact table)
  rentProps: [],   // [{id,name,value,mortgageBalance,grossRent}]

  // Liabilities (all € balances, with optional % rate)
  liabilities: {
    mortgageHome: { balance: 0, rate: 0 },
    mortgageRental: { balance: 0, rate: 0 },
    creditCard: { balance: 0, rate: 0 },
    personalLoan: { balance: 0, rate: 0 },
    carFinance: { balance: 0, rate: 0 },
    studentLoan: { balance: 0, rate: 0 },
    taxOwed: { balance: 0, rate: 0 },
    otherDebt: { balance: 0, rate: 0 }
  },

  // risk profile
  growthProfile: 0.05,

  // assumptions (internal only)
  cpiRate: 2.3,         // fixed, not user-editable
  sftAwareness: true    // fixed, not user-editable
};

const boot = loadStore();
if(boot && typeof boot === 'object'){
  Object.assign(fullMontyStore, boot);
}
window.addEventListener('beforeunload', saveStore);

// Fold older array-based data into new structured buckets once
(function migrateOld(){
  const s = fullMontyStore;

  if (Array.isArray(s.cashLike) && !s.liquidity){
    s.liquidity = { currentAccount:0, cashSavings:0, moneyMarket:0, bond100:0, otherInstant:0 };
    s.cashLike.forEach(r => { const v = +r.value || 0; s.liquidity.otherInstant += v; });
    delete s.cashLike; queueSave();
  }
  if (Array.isArray(s.investments)) {
    const sum = s.investments.reduce((a,r)=>a+(+r.value||0),0);
    s.investments = { etfIndexFunds: sum, mixedEquityFunds: 0, brokerageCash: 0, otherInvestments: 0 };
    queueSave();
  }
  if (Array.isArray(s.homes)) {
    const total = s.homes.reduce((a,r)=>a+(+r.value||0),0);
    s.homes = { familyHome:{value:total,hasRent:false,rentAmount:0}, holidayHome:{value:0,hasRent:false,rentAmount:0} };
    queueSave();
  }
})();

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2);
}

export function getStore() {
  return structuredClone(fullMontyStore);
}

export function setStore(patch) {
  Object.assign(fullMontyStore, patch);
  queueSave();
}

export function pushRow(listKey, row) {
  if (!fullMontyStore[listKey]) fullMontyStore[listKey] = [];
  if (!row.id) row.id = uuid();
  fullMontyStore[listKey].push(row);
  queueSave();
}

export function removeRow(listKey, id) {
  if (!Array.isArray(fullMontyStore[listKey])) return;
  fullMontyStore[listKey] = fullMontyStore[listKey].filter(r => r.id !== id);
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

// mini-list renderer for asset/debt steps
function makeListStepRenderer(
  listKey,
  { addLabel = 'Add item', hint = '', fields = [], valueKey = 'value' }
) {
  const renderer = (cont) => {
    cont.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'form';

    const listWrap = document.createElement('div');
    listWrap.className = 'list-wrap';

    const list = document.createElement('div');
    list.className = 'list';
    listWrap.appendChild(list);

    // build one row element
    const rowEl = (row) => {
      const wrap = document.createElement('div');
      wrap.className = 'asset-row form-group';

      fields.forEach(f => {
        const id = uuid();
        let fieldEl;

        if (f.type === 'currency') {
          fieldEl = currencyInput({ id, value: row[f.key] ?? '' });
          const input = fieldEl.querySelector('input');
          input.addEventListener('input', () => {
            row[f.key] = numFromInput(input) || 0;
            queueSave();
          });
        } else if (f.type === 'percent') {
          fieldEl = percentInput({ id, value: row[f.key] ?? '' });
          const input = fieldEl.querySelector('input');
          input.addEventListener('input', () => {
            const v = clampPercent(numFromInput(input));
            input.value = v ?? '';
            row[f.key] = v ?? 0;
            queueSave();
          });
        } else {
          fieldEl = document.createElement('input');
          fieldEl.type = 'text';
          fieldEl.id = id;
          fieldEl.value = row[f.key] ?? '';
          fieldEl.addEventListener('input', () => { row[f.key] = fieldEl.value; queueSave(); });
        }

        wrap.appendChild(formGroup(id, f.label, fieldEl));
      });

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn-row-remove';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        removeRow(listKey, row.id);
        list.removeChild(wrap);
      });
      wrap.appendChild(rm);

      return wrap;
    };

    const refresh = () => {
      list.innerHTML = '';
      (fullMontyStore[listKey] || []).forEach(row => list.appendChild(rowEl(row)));
    };

    // initial paint of existing rows
    refresh();

    // add button
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-list-add';
    add.textContent = addLabel;
    add.addEventListener('click', () => {
      const r = { id: uuid() };
      fields.forEach(f => { r[f.key] = (f.default ?? (f.type === 'currency' || f.type === 'percent' ? 0 : '')); });
      pushRow(listKey, r);
      list.appendChild(rowEl(r));
      // scroll to the new row
      setTimeout(() => {
        const last = list.lastElementChild;
        if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 0);
    });

    form.appendChild(listWrap);
    form.appendChild(add);

    if (hint) {
      const help = document.createElement('div');
      help.className = 'help';
      help.textContent = hint;
      form.appendChild(help);
    }

    cont.appendChild(form);
  };

  renderer.validate = () => {
    const arr = getStore()[listKey] || [];
    arr.forEach(r => {
      Object.keys(r).forEach(k => {
        if (/_amount|value|balance|mortgage|rent|rate/i.test(k) && r[k] != null) {
          const n = +r[k];
          if (!Number.isFinite(n) || n < 0) r[k] = 0;
        }
      });
    });
    setStore({ [listKey]: arr });
    return { ok: true };
  };

  return renderer;
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
// Step 5–9 renderers
function renderStepHomes(container){
  const s = getStore();
  const H = s.homes || (s.homes = {
    familyHome: { value: 0, hasRent: false, rentAmount: 0 },
    holidayHome: { value: 0, hasRent: false, rentAmount: 0 }
  });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className = 'form';

  form.appendChild(homeBlock('Family home', 'familyHome'));
  form.appendChild(homeBlock('Holiday home', 'holidayHome'));

  const help = document.createElement('div');
  help.className = 'help';
  help.textContent = 'Enter estimated current values. If a property generates rent (e.g., room letting/holiday-let), toggle and enter yearly rent.';
  form.appendChild(help);

  container.appendChild(form);

  function homeBlock(label, key){
    const wrap = document.createElement('div');
    wrap.className = 'asset-row form-group card-like';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = label; nameLabel.style.fontWeight = '700';
    nameLabel.style.marginBottom = '.4rem';
    wrap.appendChild(nameLabel);

    const valWrap = currencyInput({ id: `${key}-value`, value: H[key].value || '' });
    const valEl = valWrap.querySelector('input');
    valEl.addEventListener('input', () => { H[key].value = Math.max(0, numFromInput(valEl) ?? 0); queueSave(); });
    wrap.appendChild(formGroup(`${key}-value`, 'Value (€)', valWrap));

    const toggleId = `${key}-hasRent`;
    const ctrl = document.createElement('div'); ctrl.className = 'control control-switch';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.id = toggleId; cb.checked = !!H[key].hasRent;
    const lab = document.createElement('label'); lab.htmlFor = toggleId; lab.textContent = 'This property generates rental income';
    ctrl.append(cb, lab); wrap.appendChild(ctrl);

    const rentGrpWrap = document.createElement('div');
    const rentWrap = currencyInput({ id: `${key}-rent`, value: H[key].rentAmount || '' });
    const rentEl = rentWrap.querySelector('input');
    rentEl.addEventListener('input', () => { H[key].rentAmount = Math.max(0, numFromInput(rentEl) ?? 0); queueSave(); });

    rentGrpWrap.appendChild(formGroup(`${key}-rent`, 'Rental income (yearly)', rentWrap));
    rentGrpWrap.style.display = cb.checked ? '' : 'none';
    cb.addEventListener('change', () => {
      H[key].hasRent = cb.checked;
      if (!cb.checked) { H[key].rentAmount = 0; rentEl.value = ''; }
      rentGrpWrap.style.display = cb.checked ? '' : 'none';
      queueSave();
    });

    wrap.appendChild(rentGrpWrap);
    return wrap;
  }
}
renderStepHomes.validate = () => {
  const H = getStore().homes;
  ['familyHome','holidayHome'].forEach(k => {
    H[k].value = Math.max(0, +H[k].value || 0);
    H[k].rentAmount = H[k].hasRent ? Math.max(0, +H[k].rentAmount || 0) : 0;
  });
  setStore({ homes: H });
  return { ok: true };
};

function renderStepCash(container){
  const s = getStore();
  const L = s.liquidity || (s.liquidity = { currentAccount:0, cashSavings:0, moneyMarket:0, bond100:0, otherInstant:0 });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className = 'form';

  form.appendChild(currencyRow('Cash in current account (€)', 'currentAccount'));
  form.appendChild(currencyRow('Cash savings (€)', 'cashSavings'));
  form.appendChild(currencyRow('Money‑market funds (€)', 'moneyMarket'));
  form.appendChild(currencyRow('100% bond portfolios (€)', 'bond100'));
  form.appendChild(currencyRow('Other instantly‑available assets (€)', 'otherInstant'));

  const help = document.createElement('div'); help.className='help';
  help.textContent = 'Instant or near‑instant access assets.';
  form.appendChild(help);

  container.appendChild(form);

  function currencyRow(label, key){
    const w = currencyInput({ id:`liq-${key}`, value: L[key] || '' });
    w.querySelector('input').addEventListener('input', e => { L[key] = Math.max(0, numFromInput(e.target) ?? 0); queueSave(); });
    return formGroup(`liq-${key}`, label, w);
  }
}
renderStepCash.validate = () => { setStore({ liquidity: getStore().liquidity }); return { ok:true }; };

function renderStepInvest(container){
  const s = getStore();
  const I = s.investments || (s.investments = { etfIndexFunds:0, mixedEquityFunds:0, brokerageCash:0, otherInvestments:0 });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className='form';

  form.appendChild(currencyRow('ETF / Index funds (€)', 'etfIndexFunds'));
  form.appendChild(currencyRow('Mixed / equity funds (non‑pension) (€)', 'mixedEquityFunds'));
  form.appendChild(currencyRow('Brokerage cash (€)', 'brokerageCash'));
  form.appendChild(currencyRow('Other investments (€)', 'otherInvestments'));

  const help = document.createElement('div'); help.className='help';
  help.textContent = 'Exclude pensions (we captured those earlier).';
  form.appendChild(help);

  container.appendChild(form);

  function currencyRow(label, key){
    const w = currencyInput({ id:`inv-${key}`, value: I[key] || '' });
    w.querySelector('input').addEventListener('input', e => { I[key] = Math.max(0, numFromInput(e.target) ?? 0); queueSave(); });
    return formGroup(`inv-${key}`, label, w);
  }
}
renderStepInvest.validate = () => { setStore({ investments: getStore().investments }); return { ok:true }; };

const renderStepRentProps = makeListStepRenderer('rentProps', {
  addLabel: 'Add property',
  hint: 'Properties you rent out (include mortgage balance and gross rent).',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'currency', default: 0 },
    { key: 'mortgageBalance', label: 'Mortgage balance', type: 'currency', default: 0 },
    { key: 'grossRent', label: 'Gross rent', type: 'currency' }
  ]
});

function renderStepLiabilities(container){
  const s = getStore();
  const D = s.liabilities || (s.liabilities = {
    mortgageHome:{balance:0,rate:0}, mortgageRental:{balance:0,rate:0},
    creditCard:{balance:0,rate:0}, personalLoan:{balance:0,rate:0},
    carFinance:{balance:0,rate:0}, studentLoan:{balance:0,rate:0},
    taxOwed:{balance:0,rate:0}, otherDebt:{balance:0,rate:0}
  });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className='form';

  const rows = [
    ['Mortgage (home)', 'mortgageHome'],
    ['Mortgage (rental)', 'mortgageRental'],
    ['Credit cards', 'creditCard'],
    ['Personal loans', 'personalLoan'],
    ['Car finance', 'carFinance'],
    ['Student loan', 'studentLoan'],
    ['Tax owed', 'taxOwed'],
    ['Other debt', 'otherDebt']
  ];

  rows.forEach(([label, key]) => form.appendChild(debtRow(label, key)));

  const help = document.createElement('div'); help.className='help';
  help.textContent = 'Enter balances. Interest rate is optional; add it if you know it.';
  form.appendChild(help);

  container.appendChild(form);

  function debtRow(label, key){
    const grp = document.createElement('div'); grp.className='form-group card-like';

    const title = document.createElement('div'); title.textContent = label;
    title.style.fontWeight='700'; title.style.marginBottom='.35rem';
    grp.appendChild(title);

    const balWrap = currencyInput({ id:`debt-${key}-bal`, value: D[key].balance || '' });
    const balEl = balWrap.querySelector('input');
    balEl.addEventListener('input', e => { D[key].balance = Math.max(0, numFromInput(e.target) ?? 0); queueSave(); });
    grp.appendChild(formGroup(`debt-${key}-bal`, 'Balance (€)', balWrap));

    const rateWrap = percentInput({ id:`debt-${key}-rate`, value: D[key].rate || '' });
    const rateEl = rateWrap.querySelector('input');
    rateEl.addEventListener('input', e => { D[key].rate = clampPercent(numFromInput(e.target) ?? 0); queueSave(); });
    grp.appendChild(formGroup(`debt-${key}-rate`, 'Interest rate (%)', rateWrap));

    return grp;
  }
}
renderStepLiabilities.validate = () => {
  const D = getStore().liabilities;
  Object.values(D).forEach(d => {
    d.balance = Math.max(0, +d.balance || 0);
    d.rate = clampPercent(+d.rate || 0);
  });
  setStore({ liabilities: D });
  return { ok:true };
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

const steps = [
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

        const db = controlGroup(`${prefix}HasDb`, 'Defined benefit pension?', fullMontyStore[`hasDb${labelPrefix}`]);
        db.input.addEventListener('change', () => { setStore({ [`hasDb${labelPrefix}`]: db.input.checked }); render(); });
        wrap.appendChild(db.group);

        if (fullMontyStore[`hasDb${labelPrefix}`]) {
          const dbAmt = currencyInput({ id: `${prefix}DbAmt`, value: fullMontyStore[`dbPension${labelPrefix}`] ?? '' });
          dbAmt.querySelector('input').addEventListener('input', () => setStore({ [`dbPension${labelPrefix}`]: numFromInput(dbAmt.querySelector('input')) }));
          wrap.appendChild(formGroup(`${prefix}DbAmt`, 'DB annual amount', dbAmt));

          const dbAge = document.createElement('input');
          dbAge.type = 'number';
          dbAge.min = 50; dbAge.max = 100; dbAge.id = `${prefix}DbAge`;
          if (fullMontyStore[`dbStartAge${labelPrefix}`]) dbAge.value = fullMontyStore[`dbStartAge${labelPrefix}`];
          dbAge.addEventListener('input', () => setStore({ [`dbStartAge${labelPrefix}`]: numFromInput(dbAge) }));
          wrap.appendChild(formGroup(`${prefix}DbAge`, 'DB pension start age', dbAge));
        }

        const sp = controlGroup(`${prefix}State`, 'Qualifies for State Pension?', fullMontyStore[`statePension${labelPrefix}`]);
        sp.input.addEventListener('change', () => setStore({ [`statePension${labelPrefix}`]: sp.input.checked }));
        wrap.appendChild(sp.group);

        return wrap;
      }

      form.appendChild(personBlock('self', 'Self'));
      if (fullMontyStore.hasPartner) form.appendChild(personBlock('partner', 'Partner'));
      cont.appendChild(form);
    },
    validate() {
      const errs = {};
      if (fullMontyStore.hasDbSelf && (!fullMontyStore.dbPensionSelf || !fullMontyStore.dbStartAgeSelf)) {
        if (!fullMontyStore.dbPensionSelf) errs.selfDbAmt = 'This field is required.';
        if (!fullMontyStore.dbStartAgeSelf) errs.selfDbAge = 'This field is required.';
      }
      if (fullMontyStore.hasPartner && fullMontyStore.hasDbPartner && (!fullMontyStore.dbPensionPartner || !fullMontyStore.dbStartAgePartner)) {
        if (!fullMontyStore.dbPensionPartner) errs.partnerDbAmt = 'This field is required.';
        if (!fullMontyStore.dbStartAgePartner) errs.partnerDbAge = 'This field is required.';
      }
      return { ok: Object.keys(errs).length === 0, errors: errs };
    }
  },

  {
    id: 'homes',
    title: 'Homes / holiday homes',
    render: renderStepHomes,
    validate: renderStepHomes.validate
  },

  {
    id: 'cash',
    title: 'Cash & easy-access savings',
    render: renderStepCash,
    validate: renderStepCash.validate
  },

  {
    id: 'investments',
    title: 'Investments (non-pension)',
    render: renderStepInvest,
    validate: renderStepInvest.validate
  },

  {
    id: 'rentProps',
    title: 'Properties you rent out',
    render: renderStepRentProps,
    validate: renderStepRentProps.validate
  },

  {
    id: 'debts',
    title: 'Loans & other debts',
    render: renderStepLiabilities,
    validate: renderStepLiabilities.validate
  }
];

// Compute years difference helper
function yearsFrom(dobStr) {
  const dob = new Date(dobStr);
  const diff = Date.now() - dob.getTime();
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

// Wizard navigation ------------------------------------------------

function render() {
  const step = steps[cur];
  paintProgress();
  container.innerHTML = '';
  step.render(container);
  container.querySelectorAll('input, select, textarea, button').forEach(el => {
    el.addEventListener('blur', () => validateStep(true));
    el.addEventListener('input', () => validateStep());
    el.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  });
  validateStep();
  btnBack.style.display = cur === 0 ? 'none' : '';
  btnNext.textContent = cur === steps.length - 1 ? 'Finish' : 'Next';
  focusFirst();
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
    modal.classList.add('hidden');
  }
}

function back() {
  if (cur === 0) return;
  animate(container, 'back');
  cur--; render();
}

btnNext.addEventListener('click', next);
btnBack.addEventListener('click', back);

addKeyboardNav(modal, { back, next, close: () => modal.classList.add('hidden'), getCur: () => cur, getTotal: () => steps.length });

// ───────────────────────────────────────────────────────────────
// Run handler & auto classification
// ----------------------------------------------------------------

function getResolvedTotalRent(){
  const s = getStore();

  const homesRent = ['familyHome','holidayHome'].reduce((sum,k)=>{
    const h = s.homes?.[k]; if(!h) return sum;
    return sum + (h.hasRent ? ( +h.rentAmount || 0 ) : 0);
  }, 0);

  const rentPropsSum = (s.rentProps || [])
    .map(p => +p.grossRent || 0)
    .filter(v => v > 0)
    .reduce((a,b)=>a+b, 0);

  return homesRent + rentPropsSum;
}

function buildBalanceSheet() {
  const s = fullMontyStore;
  const lifestyle = [
    { name: 'Family home', value: s.homes.familyHome.value },
    { name: 'Holiday home', value: s.homes.holidayHome.value }
  ].filter(r => r.value > 0);

  const liquidity = [
    ['Cash in current account', s.liquidity.currentAccount],
    ['Cash savings', s.liquidity.cashSavings],
    ['Money-market funds', s.liquidity.moneyMarket],
    ['100% bond portfolios', s.liquidity.bond100],
    ['Other instantly-available assets', s.liquidity.otherInstant]
  ].map(([name, value]) => ({ name, value })).filter(r => r.value > 0);

  const longevity = [
    ['ETF / Index funds', s.investments.etfIndexFunds],
    ['Mixed / equity funds (non-pension)', s.investments.mixedEquityFunds],
    ['Brokerage cash', s.investments.brokerageCash],
    ['Other investments', s.investments.otherInvestments]
  ].map(([name, value]) => ({ name, value })).filter(r => r.value > 0);

  const legacy = (s.rentProps || [])
    .filter(r => r.value > 0)
    .map(({ name, value }) => ({ name, value }));

  const liabs = [
    ...Object.entries(s.liabilities || {}).map(([key, val]) => {
      const names = {
        mortgageHome: 'Mortgage (home)',
        mortgageRental: 'Mortgage (rental)',
        creditCard: 'Credit cards',
        personalLoan: 'Personal loans',
        carFinance: 'Car finance',
        studentLoan: 'Student loan',
        taxOwed: 'Tax owed',
        otherDebt: 'Other debt'
      };
      return { name: names[key], balance: val.balance };
    }).filter(r => r.balance > 0),
    ...(s.rentProps || []).filter(r => r.mortgageBalance > 0)
      .map(r => ({ name: r.name + ' mortgage', balance: r.mortgageBalance }))
  ];

  return { lifestyle, liquidity, longevity, legacy, liabilities: liabs };
}

function runAll() {
  const rent = getResolvedTotalRent();

  // dispatch events for external modules
  const pensionArgs = {
    salary: Math.min(fullMontyStore.grossIncome || 0, 115000),
    currentValue: fullMontyStore.currentPensionValueSelf,
    personalContrib: fullMontyStore.personalContribSelf,
    personalPct: fullMontyStore.personalPctSelf,
    employerContrib: fullMontyStore.employerContribSelf,
    employerPct: fullMontyStore.employerPctSelf,
    dob: fullMontyStore.dobSelf,
    retireAge: Math.max(50, Math.min(70, fullMontyStore.retireAge || 0)),
    growth: fullMontyStore.growthProfile,
    sftAwareness: fullMontyStore.sftAwareness,
  };
  document.dispatchEvent(new CustomEvent('fm-run-pension', { detail: pensionArgs }));

  const fyArgs = {
    grossIncome: fullMontyStore.grossIncome,
    targetType: 'percent',
    incomePercent: fullMontyStore.incomePercent,
    dob: fullMontyStore.dobSelf,
    retireAge: fullMontyStore.retireAge,
    statePensionSelf: fullMontyStore.statePensionSelf,
    hasDbSelf: fullMontyStore.hasDbSelf,
    dbPensionSelf: fullMontyStore.dbPensionSelf,
    dbStartAgeSelf: fullMontyStore.dbStartAgeSelf,
    rentalIncomeNow: rent,
    growthRate: fullMontyStore.growthProfile,
    statePensionPartner: fullMontyStore.statePensionPartner,
    hasPartner: fullMontyStore.hasPartner,
    hasDbPartner: fullMontyStore.hasDbPartner,
    dbPensionPartner: fullMontyStore.dbPensionPartner,
    dbStartAgePartner: fullMontyStore.dbStartAgePartner,
  };
  document.dispatchEvent(new CustomEvent('fm-run-fy', { detail: fyArgs }));

  const bsArgs = buildBalanceSheet();
  document.dispatchEvent(new CustomEvent('fm-render-balance-sheet', { detail: bsArgs }));

  modal.classList.add('hidden');
}

// ───────────────────────────────────────────────────────────────
// Public API
// ----------------------------------------------------------------

export function openFullMontyWizard() {
  cur = 0;
  modal.classList.remove('hidden');
  render();
}

export function getFullMontyData() { return getStore(); }

// Auto-launch if script loaded directly
if (document.readyState !== 'loading') {
  openFullMontyWizard();
} else {
  document.addEventListener('DOMContentLoaded', openFullMontyWizard);
}

