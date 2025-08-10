// Full Monty all-in-one wizard
// This file implements a small step engine and a central data store that
// feeds the existing calculators (FY Money Calculator, Pension Projection
// and Personal Balance Sheet).

import { animate, addKeyboardNav } from './wizardCore.js';
import { currencyInput, percentInput, numFromInput, clampPercent } from './ui-inputs.js';
import { renderStepPensionRisk, RISK_OPTIONS } from './stepPensionRisk.js';

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

const storedRiskKey = localStorage.getItem('fm.pensionRiskKey');
const storedRiskRate = parseFloat(localStorage.getItem('fm.pensionGrowthRate'));
const defaultRiskKey = storedRiskKey && RISK_OPTIONS[storedRiskKey] ? storedRiskKey : 'balanced';
const defaultRiskRate = !isNaN(storedRiskRate) ? storedRiskRate : RISK_OPTIONS[defaultRiskKey].rate;

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
    familyHome: { name: '', value: 0, mortgage: 0, hasRent: false, annualRent: 0 },
    holidayHomes: []
  },

  // Cash-like / liquidity (all € amounts)
  liquidity: {
    currentAccount: 0,
    cashSavings: 0,
    moneyMarket: 0,
    bond100: 0
  },

  // Non-pension investments
  investments: {
    nonPension: {
      diversifiedFunds: []
    }
  },

  // Properties for rent (can still be a compact table)
  rentProps: [],   // [{id,name,value,mortgageBalance,grossRent}]

  // Liabilities (all € balances, with optional % rate)
  liabilities: {
    mortgageRental: { balance: 0, rate: 0 },
    creditCard: { balance: 0, rate: 0 },
    personalLoan: { balance: 0, rate: 0 },
    carFinance: { balance: 0, rate: 0 },
    studentLoan: { balance: 0, rate: 0 },
    taxOwed: { balance: 0, rate: 0 },
    otherDebt: { balance: 0, rate: 0 }
  },

  // risk profile
  pensionRisk: RISK_OPTIONS[defaultRiskKey].label,
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

// Fold older array-based data into new structured buckets once
(function migrateOld(){
  const s = fullMontyStore;

  if (Array.isArray(s.cashLike) && !s.liquidity){
    s.liquidity = { currentAccount:0, cashSavings:0, moneyMarket:0, bond100:0 };
    s.cashLike.forEach(r => { const v = +r.value || 0; s.liquidity.cashSavings += v; });
    delete s.cashLike; queueSave();
  }
  if (Array.isArray(s.investments)) {
    const sum = s.investments.reduce((a,r)=>a+(+r.value||0),0);
    s.investments = { nonPension: { diversifiedFunds: sum ? [{ label:'', provider:'', amount: sum }] : [], diversifiedFundsTotal: sum } };
    queueSave();
  } else if (s.investments && !s.investments.nonPension) {
    const legacySum = ['etfIndexFunds','mixedEquityFunds','brokerageCash','otherInvestments']
      .map(k => +s.investments[k] || 0)
      .reduce((a,b)=>a+b,0);
    s.investments = { nonPension: { diversifiedFunds: legacySum ? [{ label:'', provider:'', amount: legacySum }] : [], diversifiedFundsTotal: legacySum } };
    queueSave();
  } else if (s.investments && !Array.isArray(s.investments.nonPension?.diversifiedFunds)) {
    s.investments.nonPension.diversifiedFunds = [];
    s.investments.nonPension.diversifiedFundsTotal = 0;
  }
  if (s.investments && s.investments.nonPension) {
    s.investments.nonPension.diversifiedFundsTotal = (s.investments.nonPension.diversifiedFunds || [])
      .reduce((a,f)=>a+(+f.amount||0),0);
  }
  if (Array.isArray(s.homes)) {
    const total = s.homes.reduce((a,r)=>a+(+r.value||0),0);
    s.homes = { familyHome:{name:'', value:total,mortgage:0,hasRent:false,annualRent:0}, holidayHomes: [] };
    queueSave();
  }
  if (s.homes && s.homes.familyHome) {
    const fh = s.homes.familyHome;
    if (fh.rentAmount != null && fh.annualRent == null) {
      fh.annualRent = fh.rentAmount; delete fh.rentAmount;
    }
    if (fh.mortgage == null) fh.mortgage = 0;
    if (fh.hasRent == null) fh.hasRent = false;
    if (fh.value == null) fh.value = 0;
    if (fh.name == null) fh.name = '';
  }
  if (s.homes && s.homes.holidayHome && !Array.isArray(s.homes.holidayHomes)) {
    const old = s.homes.holidayHome;
    const arr = [];
    const val = +old.value || 0;
    const rent = old.hasRent ? (+old.rentAmount || 0) : 0;
    if (val || rent) {
      arr.push({
        id: uuid(),
        name: 'Holiday home #1',
        value: val,
        mortgage: 0,
        hasRent: !!old.hasRent,
        annualRent: rent
      });
    }
    s.homes.holidayHomes = arr;
    delete s.homes.holidayHome;
    queueSave();
  }
  if (s.homes && Array.isArray(s.homes.holidayHomes)) {
    s.homes.holidayHomes.forEach((h, i) => {
      if (h.label && !h.name) { h.name = h.label; delete h.label; }
      if (h.name == null) h.name = '';
      if (h.mortgage == null) h.mortgage = 0;
      if (h.hasRent == null) h.hasRent = false;
      if (h.value == null) h.value = 0;
      if (h.annualRent == null) h.annualRent = 0;
    });
  }
  if (s.liabilities && s.liabilities.mortgageHome) {
    if (!s.homes.familyHome.mortgage) {
      s.homes.familyHome.mortgage = +s.liabilities.mortgageHome.balance || 0;
    }
    delete s.liabilities.mortgageHome;
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

// defensive helpers
function normalizeFamilyHomeMortgageField(root) {
  const container = root || document;
  const input = container.querySelector('#familyHome-mortgage');
  if (input) {
    input.placeholder = '';
    input.removeAttribute('aria-describedby');
  }
  const helper = container.querySelector('#familyHome-mortgage ~ .help');
  if (helper) helper.remove();
}

function normalizePropertyNameFields(root) {
  const container = root || document;
  container.querySelectorAll('label').forEach(lab => {
    const txt = lab.textContent.trim();
    if (/^Property name/i.test(txt)) {
      lab.textContent = 'Property name';
    }
  });

  container.querySelectorAll('input[type="text"], input:not([type])').forEach(inp => {
    const ph = (inp.getAttribute('placeholder') || '').trim();
    const isNameByName = /\b(name|_name\[\]|propertyName)\b/i.test(inp.name || '');
    const labelTxt = inp.closest('.field, div')?.querySelector('label')?.textContent?.trim();
    const isNameByLabel = labelTxt === 'Property name';
    if (isNameByName || isNameByLabel) {
      inp.setAttribute('placeholder', 'e.g., Dublin Apartment');
    }
    if (/\(optional.*\)/i.test(ph)) {
      inp.setAttribute('placeholder', 'e.g., Dublin Apartment');
    }
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
          fieldEl = currencyInput({ id, value: row[f.key] ?? '', placeholder: f.placeholder });
          const input = fieldEl.querySelector('input');
          input.addEventListener('input', () => {
            row[f.key] = numFromInput(input) || 0;
            queueSave();
          });
        } else if (f.type === 'percent') {
          fieldEl = percentInput({ id, value: row[f.key] ?? '', placeholder: f.placeholder });
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
          if (f.placeholder) fieldEl.placeholder = f.placeholder;
          fieldEl.addEventListener('input', () => { row[f.key] = fieldEl.value; queueSave(); });
        }

        const group = formGroup(id, f.label, fieldEl);
        if (f.help) {
          const h = document.createElement('div');
          h.className = 'help';
          h.textContent = f.help;
          group.appendChild(h);
        }
        wrap.appendChild(group);
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
      normalizePropertyNameFields(cont);
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
        normalizePropertyNameFields(cont);
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
    familyHome: { value: 0, mortgage: 0, hasRent: false, annualRent: 0 },
    holidayHomes: []
  });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className = 'form';

  form.appendChild(homeBlock('Family home', H.familyHome, 'familyHome'));
  const fhNote = document.createElement('div');
  fhNote.className = 'help';
  fhNote.textContent = 'Your family home is a Lifestyle asset. Mortgage is counted under liabilities. Rent (if any) is optional.';
  form.appendChild(fhNote);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-list-add';
  addBtn.id = 'addHolidayHomeBtn';
  addBtn.textContent = '+ Add holiday home';

  const listWrap = document.createElement('div');
  listWrap.className = 'list-wrap';
  const list = document.createElement('div');
  list.className = 'list';
  list.id = 'holidayHomeList';
  listWrap.appendChild(list);

  const help = document.createElement('div');
  help.className = 'help';
  help.textContent = 'Enter estimated current values. If a property generates rent (e.g., holiday‑let), toggle and enter yearly rent.';

  form.appendChild(listWrap);
  form.appendChild(addBtn);
  form.appendChild(help);

  container.appendChild(form);

    function refresh(){
      list.innerHTML = '';
      (H.holidayHomes || []).forEach((hh, i) => {
        list.appendChild(holidayBlock(hh, i));
      });
      normalizePropertyNameFields(container);
    }

    addBtn.addEventListener('click', () => {
      const hh = { id: uuid(), name: '', value: 0, mortgage: 0, hasRent: false, annualRent: 0 };
      H.holidayHomes.push(hh);
      queueSave();
      refresh();
      validateStep();
    });

    refresh();
    normalizeFamilyHomeMortgageField(container);

  function homeBlock(label, obj, key){
    const wrap = document.createElement('div');
    wrap.className = 'asset-row form-group card-like';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = label; nameLabel.style.fontWeight = '700';
    nameLabel.style.marginBottom = '.4rem';
    wrap.appendChild(nameLabel);

    const propName = document.createElement('input');
    propName.type = 'text';
    propName.id = `${key}-name`;
    propName.value = obj.name || '';
    propName.placeholder = 'e.g., Dublin Apartment';
    propName.addEventListener('input', () => { obj.name = propName.value; queueSave(); });
    wrap.appendChild(formGroup(`${key}-name`, 'Property name', propName));

    const valWrap = currencyInput({ id: `${key}-value`, value: obj.value || '' });
    const valEl = valWrap.querySelector('input');
    valEl.addEventListener('input', () => {
      obj.value = Math.max(0, numFromInput(valEl) ?? 0);
      queueSave();
      warn.style.display = obj.mortgage > obj.value ? '' : 'none';
      validateStep();
    });
    wrap.appendChild(formGroup(`${key}-value`, 'Value (€)', valWrap));

    const mortWrap = currencyInput({ id: `${key}-mortgage`, value: obj.mortgage || '', placeholder: '' });
    const mortEl = mortWrap.querySelector('input');
    mortEl.placeholder = '';
    mortEl.setAttribute('aria-describedby', '');
    const mortGroup = formGroup(`${key}-mortgage`, 'Remaining mortgage balance (€)', mortWrap);
    const warn = document.createElement('div');
    warn.textContent = 'Mortgage exceeds value.';
    warn.style.color = '#ffb74d';
    warn.style.marginTop = '.25rem';
    warn.style.display = obj.mortgage > obj.value ? '' : 'none';
    mortGroup.appendChild(warn);
    mortEl.addEventListener('input', () => {
      obj.mortgage = Math.max(0, numFromInput(mortEl) ?? 0);
      queueSave();
      warn.style.display = obj.mortgage > obj.value ? '' : 'none';
      validateStep();
    });
    wrap.appendChild(mortGroup);

    const toggleId = `${key}-hasRent`;
    const ctrl = document.createElement('div'); ctrl.className = 'control control-switch';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.id = toggleId; cb.checked = !!obj.hasRent;
    const lab = document.createElement('label'); lab.htmlFor = toggleId; lab.textContent = 'This property generates rental income';
    ctrl.append(cb, lab); wrap.appendChild(ctrl);

    const rentGrpWrap = document.createElement('div');
    const rentWrap = currencyInput({ id: `${key}-rent`, value: obj.annualRent || '' });
    const rentEl = rentWrap.querySelector('input');
    rentEl.addEventListener('input', () => {
      obj.annualRent = Math.max(0, numFromInput(rentEl) ?? 0);
      queueSave();
      validateStep();
    });

    rentGrpWrap.appendChild(formGroup(`${key}-rent`, 'Yearly rent (€)', rentWrap));
    rentGrpWrap.style.display = cb.checked ? '' : 'none';
    cb.addEventListener('change', () => {
      obj.hasRent = cb.checked;
      if (!cb.checked) { obj.annualRent = 0; rentEl.value = ''; }
      rentGrpWrap.style.display = cb.checked ? '' : 'none';
      queueSave();
      validateStep();
    });

    wrap.appendChild(rentGrpWrap);
    return wrap;
  }

  function holidayBlock(hh, idx){
    const wrap = document.createElement('div');
    wrap.className = 'asset-row form-group card-like';
    wrap.setAttribute('aria-label', `Holiday home #${idx+1}`);

    const title = document.createElement('label');
    title.textContent = `Holiday home #${idx+1}`;
    title.style.fontWeight = '700';
    title.style.marginBottom = '.4rem';
    wrap.appendChild(title);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = `hh-${hh.id}-name`;
    nameInput.value = hh.name || '';
    nameInput.placeholder = 'e.g., Dublin Apartment';
    nameInput.addEventListener('input', () => { hh.name = nameInput.value; queueSave(); });
    wrap.appendChild(formGroup(`hh-${hh.id}-name`, 'Property name', nameInput));

    const valWrap = currencyInput({ id: `hh-${hh.id}-value`, value: hh.value || '' });
    const valEl = valWrap.querySelector('input');
    valEl.addEventListener('input', () => {
      hh.value = Math.max(0, numFromInput(valEl) ?? 0);
      queueSave();
      warn.style.display = hh.mortgage > hh.value ? '' : 'none';
      validateStep();
    });
    wrap.appendChild(formGroup(`hh-${hh.id}-value`, 'Value (€)', valWrap));

    const mortWrap = currencyInput({ id: `hh-${hh.id}-mortgage`, value: hh.mortgage || '' });
    const mortEl = mortWrap.querySelector('input');
    mortEl.placeholder = '';
    mortEl.setAttribute('aria-describedby', '');
    const mortGroup = formGroup(`hh-${hh.id}-mortgage`, 'Remaining mortgage balance (€)', mortWrap);
    const warn = document.createElement('div');
    warn.textContent = 'Mortgage exceeds value.';
    warn.style.color = '#ffb74d';
    warn.style.marginTop = '.25rem';
    warn.style.display = hh.mortgage > hh.value ? '' : 'none';
    mortGroup.appendChild(warn);
    mortEl.addEventListener('input', () => {
      hh.mortgage = Math.max(0, numFromInput(mortEl) ?? 0);
      queueSave();
      warn.style.display = hh.mortgage > hh.value ? '' : 'none';
      validateStep();
    });
    wrap.appendChild(mortGroup);

    const toggleId = `hh-${hh.id}-hasRent`;
    const ctrl = document.createElement('div'); ctrl.className = 'control control-switch';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.id = toggleId; cb.checked = !!hh.hasRent;
    const lab = document.createElement('label'); lab.htmlFor = toggleId; lab.textContent = 'This property generates rental income';
    ctrl.append(cb, lab); wrap.appendChild(ctrl);

    const rentGrpWrap = document.createElement('div');
    const rentWrap = currencyInput({ id: `hh-${hh.id}-rent`, value: hh.annualRent || '' });
    const rentEl = rentWrap.querySelector('input');
    rentEl.addEventListener('input', () => {
      hh.annualRent = Math.max(0, numFromInput(rentEl) ?? 0);
      queueSave();
      validateStep();
    });
    rentGrpWrap.appendChild(formGroup(`hh-${hh.id}-rent`, 'Yearly rent (€)', rentWrap));
    rentGrpWrap.style.display = cb.checked ? '' : 'none';
    cb.addEventListener('change', () => {
      hh.hasRent = cb.checked;
      if (!cb.checked) { hh.annualRent = 0; rentEl.value = ''; }
      rentGrpWrap.style.display = cb.checked ? '' : 'none';
      queueSave();
      validateStep();
    });
    wrap.appendChild(rentGrpWrap);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn-row-remove';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove Holiday home #${idx+1}`);
    rm.addEventListener('click', () => {
      if (confirm('Remove this holiday home? This can’t be undone.')) {
        H.holidayHomes = H.holidayHomes.filter(x => x.id !== hh.id);
        queueSave();
        refresh();
        validateStep();
      }
    });
    wrap.appendChild(rm);

    return wrap;
  }
}
renderStepHomes.validate = () => {
  const H = getStore().homes;
  const errs = {};

  const famVal = +H.familyHome.value;
  if (!Number.isFinite(famVal) || famVal < 0) errs['familyHome-value'] = 'Enter a non-negative amount.';
  H.familyHome.value = Math.max(0, famVal || 0);

  const famMort = +H.familyHome.mortgage;
  if (!Number.isFinite(famMort) || famMort < 0) errs['familyHome-mortgage'] = 'Enter a non-negative amount.';
  H.familyHome.mortgage = Math.max(0, famMort || 0);

  if (H.familyHome.hasRent) {
    const rent = +H.familyHome.annualRent;
    if (!Number.isFinite(rent) || rent < 0) errs['familyHome-rent'] = 'Enter a non-negative amount.';
    H.familyHome.annualRent = Math.max(0, rent || 0);
  } else {
    H.familyHome.annualRent = 0;
  }

  (H.holidayHomes || []).forEach(h => {
    const v = +h.value;
    if (!Number.isFinite(v) || v < 0) errs[`hh-${h.id}-value`] = 'Enter a non-negative amount.';
    h.value = Math.max(0, v || 0);

    const m = +h.mortgage;
    if (!Number.isFinite(m) || m < 0) errs[`hh-${h.id}-mortgage`] = 'Enter a non-negative amount.';
    h.mortgage = Math.max(0, m || 0);

    if (h.hasRent) {
      const r = +h.annualRent;
      if (!Number.isFinite(r) || r < 0) errs[`hh-${h.id}-rent`] = 'Enter a non-negative amount.';
      h.annualRent = Math.max(0, r || 0);
    } else {
      h.annualRent = 0;
    }
  });

  setStore({ homes: H });
  return { ok: Object.keys(errs).length === 0, errors: errs };
};

function renderStepProperties(container){
  const s = getStore();
  const H = s.homes || (s.homes = {
    familyHome:{ name:'', value:0, mortgage:0, hasRent:false, annualRent:0 },
    holidayHomes: []
  });
  const R = s.rentProps || (s.rentProps = []);

  container.innerHTML = `\
<section id="propertiesStep" data-step="properties">\
  <div id="familyHomeSection" class="subsection">\
    <h3>Family home</h3>\
    <div id="familyHomeCard" class="prop-card">\
      <label class="field-label">Property name</label>\
      <input class="text-input" name="fh_name" placeholder="e.g., Dublin Apartment" />\
      <label class="field-label">Value (€)</label>\
      <input class="money-input" name="fh_value" inputmode="decimal" />\
      <label class="field-label">Remaining mortgage balance (€)</label>\
      <input class="money-input" name="fh_mortgage" inputmode="decimal" />\
    </div>\
  </div>\
  <div id="holidayHomesSection" class="subsection">\
    <h3>Holiday homes</h3>\
    <div id="holidayHomeList" class="stack"></div>\
    <button id="addHolidayHomeBtn" type="button" class="btn-secondary">+ Add holiday home</button>\
  </div>\
  <div id="investmentPropsSection" class="subsection">\
    <h3>Properties you rent out</h3>\
    <div id="investmentList" class="stack"></div>\
    <button id="addInvestmentBtn" type="button" class="btn-secondary">+ Add investment property</button>\
  </div>\
</section>\
<template id="holidayHomeTpl">\
  <div class="prop-card">\
    <label class="field-label">Property name</label>\
    <input class="text-input" name="hh_name[]" placeholder="e.g., Dublin Apartment" />\
    <label class="field-label">Value (€)</label>\
    <input class="money-input" name="hh_value[]" inputmode="decimal" />\
    <label class="field-label">Remaining mortgage balance (€)</label>\
    <input class="money-input" name="hh_mortgage[]" inputmode="decimal" />\
  </div>\
</template>\
<template id="investmentTpl">\
  <div class="prop-card">\
    <label class="field-label">Property name</label>\
    <input class="text-input" name="ip_name[]" placeholder="e.g., Dublin Apartment" />\
    <label class="field-label">Value (€)</label>\
    <input class="money-input" name="ip_value[]" inputmode="decimal" />\
    <label class="field-label">Remaining mortgage balance (€)</label>\
    <input class="money-input" name="ip_mortgage[]" inputmode="decimal" />\
    <label class="field-label">Gross rent (€ per year)</label>\
    <input class="money-input" name="ip_rent[]" inputmode="decimal" />\
  </div>\
</template>`;

  function attachMoneyFormatting(nodes){
    nodes.forEach(inp => {
      inp.addEventListener('input', () => {
        const v = inp.value.replace(/[^\d.]/g,'');
        if (inp.value !== v) inp.value = v;
      });
    });
  }

  function normalizeMortgageFields(step){
    if(!step) return;
    step.querySelectorAll('label').forEach(l=>{
      if(/Remaining mortgage/i.test(l.textContent)) l.textContent = 'Remaining mortgage balance (€)';
    });
    step.querySelectorAll('input.money-input[name$="mortgage"], input[name*="mortgage"]').forEach(inp=>{
      inp.placeholder='';
      const helper = inp.closest('.prop-card')?.querySelector('.helper-text');
      if(helper) helper.remove();
    });
  }

  const stepEl = container.querySelector('#propertiesStep');

  const fhName = stepEl.querySelector('input[name="fh_name"]');
  const fhValue = stepEl.querySelector('input[name="fh_value"]');
  const fhMort = stepEl.querySelector('input[name="fh_mortgage"]');
  fhName.value = H.familyHome.name || '';
  fhValue.value = H.familyHome.value || '';
  fhMort.value = H.familyHome.mortgage || '';
  fhName.addEventListener('input',()=>{ H.familyHome.name = fhName.value; queueSave(); });
  fhValue.addEventListener('input',()=>{ H.familyHome.value = Math.max(0, numFromInput(fhValue) ?? 0); queueSave(); });
  fhMort.addEventListener('input',()=>{ H.familyHome.mortgage = Math.max(0, numFromInput(fhMort) ?? 0); queueSave(); });
  attachMoneyFormatting([fhValue, fhMort]);

  const hhList = stepEl.querySelector('#holidayHomeList');
  const hhBtn = stepEl.querySelector('#addHolidayHomeBtn');
  const hhTpl = stepEl.querySelector('#holidayHomeTpl');

  function addHolidayCard(hh){
    const obj = hh || { id: uuid(), name:'', value:0, mortgage:0, hasRent:false, annualRent:0 };
    if(!hh){ H.holidayHomes.push(obj); queueSave(); }
    const node = hhTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = obj.id;
    const nameEl = node.querySelector('input[name="hh_name[]"]');
    const valEl = node.querySelector('input[name="hh_value[]"]');
    const mortEl = node.querySelector('input[name="hh_mortgage[]"]');
    nameEl.value = obj.name || '';
    valEl.value = obj.value || '';
    mortEl.value = obj.mortgage || '';
    nameEl.addEventListener('input',()=>{ obj.name = nameEl.value; queueSave(); });
    valEl.addEventListener('input',()=>{ obj.value = Math.max(0, numFromInput(valEl) ?? 0); queueSave(); });
    mortEl.addEventListener('input',()=>{ obj.mortgage = Math.max(0, numFromInput(mortEl) ?? 0); queueSave(); });
    attachMoneyFormatting([valEl, mortEl]);
    hhList.appendChild(node);
    hhBtn.remove();
    hhList.insertAdjacentElement('afterend', hhBtn);
    node.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  H.holidayHomes.forEach(h=>addHolidayCard(h));
  hhBtn.addEventListener('click',()=>addHolidayCard());

  const ipList = stepEl.querySelector('#investmentList');
  const ipBtn = stepEl.querySelector('#addInvestmentBtn');
  const ipTpl = stepEl.querySelector('#investmentTpl');

  function addInvestmentCard(p){
    const obj = p || { id: uuid(), name:'', value:0, mortgageBalance:0, grossRent:0 };
    if(!p){ R.push(obj); queueSave(); }
    const node = ipTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = obj.id;
    const nameEl = node.querySelector('input[name="ip_name[]"]');
    const valEl = node.querySelector('input[name="ip_value[]"]');
    const mortEl = node.querySelector('input[name="ip_mortgage[]"]');
    const rentEl = node.querySelector('input[name="ip_rent[]"]');
    nameEl.value = obj.name || '';
    valEl.value = obj.value || '';
    mortEl.value = obj.mortgageBalance || '';
    rentEl.value = obj.grossRent || '';
    nameEl.addEventListener('input',()=>{ obj.name = nameEl.value; queueSave(); });
    valEl.addEventListener('input',()=>{ obj.value = Math.max(0, numFromInput(valEl) ?? 0); queueSave(); });
    mortEl.addEventListener('input',()=>{ obj.mortgageBalance = Math.max(0, numFromInput(mortEl) ?? 0); queueSave(); });
    rentEl.addEventListener('input',()=>{ obj.grossRent = Math.max(0, numFromInput(rentEl) ?? 0); queueSave(); });
    attachMoneyFormatting([valEl, mortEl, rentEl]);
    ipList.appendChild(node);
    ipBtn.remove();
    ipList.insertAdjacentElement('afterend', ipBtn);
    node.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  R.forEach(p=>addInvestmentCard(p));
  ipBtn.addEventListener('click',()=>addInvestmentCard());

  normalizeMortgageFields(stepEl);
}

renderStepProperties.validate = () => {
  const H = getStore().homes;
  const R = getStore().rentProps || [];
  const errs = {};

  const fv = +H.familyHome.value;
  if(!Number.isFinite(fv) || fv < 0) errs['fh_value'] = 'Enter a non-negative amount.';
  H.familyHome.value = Math.max(0, fv || 0);
  const fm = +H.familyHome.mortgage;
  if(!Number.isFinite(fm) || fm < 0) errs['fh_mortgage'] = 'Enter a non-negative amount.';
  H.familyHome.mortgage = Math.max(0, fm || 0);

  (H.holidayHomes||[]).forEach((h,i)=>{
    const v = +h.value; const m = +h.mortgage;
    if(!Number.isFinite(v) || v < 0) errs[`hh_value_${i}`] = 'Enter a non-negative amount.';
    if(!Number.isFinite(m) || m < 0) errs[`hh_mortgage_${i}`] = 'Enter a non-negative amount.';
    h.value = Math.max(0, v || 0);
    h.mortgage = Math.max(0, m || 0);
  });

  R.forEach((p,i)=>{
    const v = +p.value; const m = +p.mortgageBalance; const r = +p.grossRent;
    if(!Number.isFinite(v) || v < 0) errs[`ip_value_${i}`] = 'Enter a non-negative amount.';
    if(!Number.isFinite(m) || m < 0) errs[`ip_mortgage_${i}`] = 'Enter a non-negative amount.';
    if(!Number.isFinite(r) || r < 0) errs[`ip_rent_${i}`] = 'Enter a non-negative amount.';
    p.value = Math.max(0, v || 0);
    p.mortgageBalance = Math.max(0, m || 0);
    p.grossRent = Math.max(0, r || 0);
  });

  setStore({ homes:H, rentProps:R });
  return { ok: Object.keys(errs).length === 0, errors: errs };
};

function renderStepCash(container){
  const s = getStore();
  const L = s.liquidity || (s.liquidity = { currentAccount:0, cashSavings:0, moneyMarket:0, bond100:0 });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className = 'form';

  form.appendChild(currencyRow('Cash in current account (€)', 'currentAccount'));
  form.appendChild(currencyRow('Cash savings (€)', 'cashSavings'));
  form.appendChild(currencyRow('Money‑market funds (€)', 'moneyMarket'));
  form.appendChild(currencyRow('100% bond portfolios (€)', 'bond100'));

  const help = document.createElement('div'); help.className='help';
  help.textContent = 'These are instantly accessible, very low-risk assets.';
  form.appendChild(help);

  container.appendChild(form);

  function currencyRow(label, key){
    const w = currencyInput({ id:`liq-${key}`, value: L[key] || '' });
    w.querySelector('input').addEventListener('input', e => { L[key] = Math.max(0, numFromInput(e.target) ?? 0); queueSave(); });
    return formGroup(`liq-${key}`, label, w);
  }
}
renderStepCash.validate = () => { setStore({ liquidity: getStore().liquidity }); return { ok:true }; };

const STORAGE_KEY = 'fm_step7_funds';
let funds = [];
let fundListEl = null;

function load() {
  try { funds = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { funds = []; }
}
function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(funds)); }
function parseAmount(v){ return Number(String(v).replace(/[^\d.]/g,'')); }
function formatEuro(n){ return '€' + (n||0).toLocaleString(undefined,{maximumFractionDigits:0}); }
function updateEmptyState(){
  const empty = funds.length === 0;
  const emptyEl = document.getElementById('empty-state');
  if(emptyEl) emptyEl.style.display = empty ? '' : 'none';
  const addBtn = document.getElementById('add-fund');
  if(addBtn) addBtn.textContent = empty ? 'Add first fund' : 'Add another fund';
}

function createFundRow(fund, index){
  const row = document.createElement('div');
  row.className = 'fund-row card-like';
  row.dataset.index = index;

  const labelGroup = document.createElement('div');
  labelGroup.className = 'form-group';
  const labelLabel = document.createElement('label');
  labelLabel.setAttribute('for', `fund-label-${index}`);
  labelLabel.textContent = 'Fund label (nickname)';
  labelGroup.appendChild(labelLabel);
  const labelHelper = document.createElement('div');
  labelHelper.className = 'helper';
  labelHelper.textContent = 'Short name you use for this fund (e.g., Global Balanced A)';
  labelGroup.appendChild(labelHelper);
  const labelWrap = document.createElement('div');
  labelWrap.className = 'input-wrap';
  const labelInput = document.createElement('input');
  labelInput.id = `fund-label-${index}`;
  labelInput.name = 'label';
  labelInput.placeholder = 'e.g., Global Balanced A';
  labelInput.required = true;
  labelInput.value = fund.label || '';
  labelWrap.appendChild(labelInput);
  labelGroup.appendChild(labelWrap);
  const labelErr = document.createElement('div');
  labelErr.className = 'error';
  labelErr.setAttribute('aria-live','polite');
  labelGroup.appendChild(labelErr);
  row.appendChild(labelGroup);

  const provGroup = document.createElement('div');
  provGroup.className = 'form-group';
  const provLabel = document.createElement('label');
  provLabel.setAttribute('for', `fund-provider-${index}`);
  provLabel.textContent = 'Provider';
  provGroup.appendChild(provLabel);
  const provHelper = document.createElement('div');
  provHelper.className = 'helper';
  provHelper.textContent = 'Company that manages the fund (e.g., Vanguard, iShares, Irish Life)';
  provGroup.appendChild(provHelper);
  const provWrap = document.createElement('div');
  provWrap.className = 'input-wrap';
  const provInput = document.createElement('input');
  provInput.id = `fund-provider-${index}`;
  provInput.name = 'provider';
  provInput.setAttribute('list','provider-suggestions');
  provInput.placeholder = 'e.g., Vanguard / iShares / Irish Life';
  provInput.required = true;
  provInput.value = fund.provider || '';
  provWrap.appendChild(provInput);
  provGroup.appendChild(provWrap);
  const provErr = document.createElement('div');
  provErr.className = 'error';
  provErr.setAttribute('aria-live','polite');
  provGroup.appendChild(provErr);
  row.appendChild(provGroup);

  const amtGroup = document.createElement('div');
  amtGroup.className = 'form-group';
  const amtLabel = document.createElement('label');
  amtLabel.setAttribute('for', `fund-amount-${index}`);
  amtLabel.textContent = 'Amount (€)';
  amtGroup.appendChild(amtLabel);
  const amtHelper = document.createElement('div');
  amtHelper.className = 'helper';
  amtHelper.textContent = 'Current value';
  amtGroup.appendChild(amtHelper);
  const amtWrap = document.createElement('div');
  amtWrap.className = 'input-wrap prefix';
  const euro = document.createElement('span');
  euro.className = 'unit';
  euro.textContent = '€';
  amtWrap.appendChild(euro);
  const amtInput = document.createElement('input');
  amtInput.id = `fund-amount-${index}`;
  amtInput.name = 'amount';
  amtInput.inputMode = 'decimal';
  amtInput.placeholder = '0';
  amtInput.required = true;
  amtInput.value = fund.amount || '';
  amtWrap.appendChild(amtInput);
  amtGroup.appendChild(amtWrap);
  const amtErr = document.createElement('div');
  amtErr.className = 'error';
  amtErr.setAttribute('aria-live','polite');
  amtGroup.appendChild(amtErr);
  row.appendChild(amtGroup);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-row-remove';
  remove.setAttribute('aria-label','Remove fund');
  remove.textContent = '✕';
  remove.addEventListener('click', () => {
    funds.splice(index,1);
    renderFunds();
    persist();
    updateEmptyState();
    updateNextState();
  });
  row.appendChild(remove);

  function onInput(){
    funds[index] = { label: labelInput.value, provider: provInput.value, amount: amtInput.value };
    validateRow(index);
    updateTotal();
    persist();
    updateNextState();
  }

  labelInput.addEventListener('input', onInput);
  provInput.addEventListener('input', onInput);
  amtInput.addEventListener('input', onInput);
  labelInput.addEventListener('blur', () => validateRow(index));
  provInput.addEventListener('blur', () => validateRow(index));
  amtInput.addEventListener('blur', () => validateRow(index));

  return row;
}

function renderFunds(){
  if(!fundListEl) return;
  fundListEl.innerHTML = '';
  funds.forEach((f,i) => fundListEl.appendChild(createFundRow(f,i)));
  updateTotal();
  updateEmptyState();
}

function validateRow(i){
  const f = funds[i];
  const wrap = el => el.closest('.input-wrap');

  const labelEl = document.getElementById(`fund-label-${i}`);
  const providerEl = document.getElementById(`fund-provider-${i}`);
  const amountEl = document.getElementById(`fund-amount-${i}`);

  [labelEl, providerEl, amountEl].forEach(el => {
    el.classList.remove('invalid');
    wrap(el)?.classList.remove('invalid');
  });
  document.querySelector(`[data-index="${i}"] .form-group:nth-child(1) .error`).textContent = '';
  document.querySelector(`[data-index="${i}"] .form-group:nth-child(2) .error`).textContent = '';
  document.querySelector(`[data-index="${i}"] .form-group:nth-child(3) .error`).textContent = '';

  let ok = true;
  if(!f.label?.trim()){
    labelEl.classList.add('invalid'); wrap(labelEl)?.classList.add('invalid');
    document.querySelector(`[data-index="${i}"] .form-group:nth-child(1) .error`).textContent = 'Enter a label';
    ok = false;
  }
  if(!f.provider?.trim()){
    providerEl.classList.add('invalid'); wrap(providerEl)?.classList.add('invalid');
    document.querySelector(`[data-index="${i}"] .form-group:nth-child(2) .error`).textContent = 'Enter a provider';
    ok = false;
  }
  const a = parseAmount(f.amount);
  if(!Number.isFinite(a) || a < 0){
    amountEl.classList.add('invalid'); wrap(amountEl)?.classList.add('invalid');
    document.querySelector(`[data-index="${i}"] .form-group:nth-child(3) .error`).textContent = 'Enter a non‑negative amount';
    ok = false;
  }
  return ok;
}

function updateTotal(){
  const total = funds.reduce((s,f)=> s + (parseAmount(f.amount)||0), 0);
  const el = document.getElementById('fund-total');
  if(el) el.textContent = formatEuro(total);
}

function updateNextState(){
  const allValid = funds.length > 0 && funds.every((_,i)=>validateRow(i));
  btnNext.disabled = !allValid;
  return allValid;
}

function renderStepInvest(container){
  load();

  container.innerHTML = '';
  const section = document.createElement('section');
  section.id = 'step-7';
  section.className = 'step active';
  section.dataset.step = '7';
  section.setAttribute('aria-labelledby','step7-title');
  section.innerHTML = `
  <h2 id="step7-title">Investments (non‑pension)</h2>

  <div class="helper">
    <p>This section is for <strong>diversified investment funds</strong> you hold outside pensions, such as:</p>
    <ul>
      <li>Multi‑asset funds</li>
      <li>Broad index funds</li>
    </ul>
    <p class="muted">These are pooled investments spread across many holdings — <strong>not</strong> single shares or crypto.</p>
  </div>

  <p id="step7-intro" class="muted">Add each diversified investment fund you hold outside pensions.</p>
  <div id="empty-state" class="empty muted">No funds added yet.</div>

  <div id="fund-list" class="fund-list"></div>

  <div class="actions-row">
    <button type="button" id="add-fund" class="btn-list-add">Add first fund</button>
    <div class="total"><span>Total diversified investments:</span> <strong id="fund-total">€0</strong></div>
  </div>

  <datalist id="provider-suggestions">
    <option value="Vanguard"></option>
    <option value="iShares"></option>
    <option value="Irish Life"></option>
    <option value="Fidelity"></option>
    <option value="Amundi"></option>
    <option value="Dimensional"></option>
  </datalist>
  `;
  container.appendChild(section);

  fundListEl = section.querySelector('#fund-list');

  section.querySelector('#add-fund').addEventListener('click', () => {
    funds.push({label:'', provider:'', amount:''});
    renderFunds();
    persist();
    updateEmptyState();
    updateNextState();
    fundListEl.querySelector(`#fund-label-${funds.length-1}`)?.focus();
  });

  renderFunds();
  updateNextState();
}

renderStepInvest.validate = () => {
  const allValid = updateNextState();
  if(allValid){
    const fundsForSubmit = funds.map(f => ({
      label: f.label.trim(),
      provider: f.provider.trim(),
      amount: parseAmount(f.amount) || 0
    }));
    const total = fundsForSubmit.reduce((s,x)=>s+(x.amount||0),0);
    const s = getStore();
    if(!s.investments) s.investments = {};
    if(!s.investments.nonPension) s.investments.nonPension = {};
    s.investments.nonPension.diversifiedFunds = fundsForSubmit;
    s.investments.nonPension.diversifiedFundsTotal = total;
    setStore({ investments: s.investments });
    queueSave();
  } else {
    const first = funds.findIndex((_,i)=>!validateRow(i));
    if(first >= 0){
      const row = fundListEl.children[first];
      const inp = row?.querySelector('input.invalid');
      row?.scrollIntoView({behavior:'smooth', block:'center'});
      inp?.focus();
    }
  }
  return { ok: allValid };
};

const renderStepRentProps = makeListStepRenderer('rentProps', {
  addLabel: 'Add property',
  hint: 'Properties you rent out (include the remaining mortgage balance—i.e., the amount you still owe today—and gross rent).',
    fields: [
      { key: 'name', label: 'Property name', type: 'text', placeholder: 'e.g., Dublin Apartment' },
      { key: 'value', label: 'Value', type: 'currency', default: 0 },
      { key: 'mortgageBalance', label: 'Remaining mortgage balance (€)', type: 'currency', default: 0, placeholder: 'Please enter the remaining mortgage balance on this property (i.e., the amount you still owe today, not the original loan amount).', help: 'Please enter the remaining mortgage balance on this property (i.e., the amount you still owe today, not the original loan amount).' },
      { key: 'grossRent', label: 'Gross rent', type: 'currency' }
    ]
  });

function renderStepLiabilities(container){
  const s = getStore();
  const D = s.liabilities || (s.liabilities = {
    mortgageRental:{balance:0,rate:0},
    creditCard:{balance:0,rate:0}, personalLoan:{balance:0,rate:0},
    carFinance:{balance:0,rate:0}, studentLoan:{balance:0,rate:0},
    taxOwed:{balance:0,rate:0}, otherDebt:{balance:0,rate:0}
  });

  container.innerHTML = '';
  const form = document.createElement('div'); form.className='form';

  const rows = [
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

    const balWrap = currencyInput({ id:`debt-${key}-bal`, value: D[key].balance || '', placeholder: label === 'Mortgage (rental)' ? 'Please enter the remaining mortgage balance on this property (i.e., the amount you still owe today, not the original loan amount).' : '' });
    const balEl = balWrap.querySelector('input');
    balEl.addEventListener('input', e => { D[key].balance = Math.max(0, numFromInput(e.target) ?? 0); queueSave(); });
    const balGroup = formGroup(`debt-${key}-bal`, label === 'Mortgage (rental)' ? 'Remaining mortgage balance (€)' : 'Balance (€)', balWrap);
    if (label === 'Mortgage (rental)') {
      const h = document.createElement('div');
      h.className = 'help';
      h.textContent = 'Please enter the remaining mortgage balance on this property (i.e., the amount you still owe today, not the original loan amount).';
      balGroup.appendChild(h);
    }
    grp.appendChild(balGroup);

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
let steps = [];

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
    id: 'properties',
    title: 'Properties',
    render: renderStepProperties,
    validate: renderStepProperties.validate
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
    id: 'debts',
    title: 'Loans & other debts',
    render: renderStepLiabilities,
    validate: renderStepLiabilities.validate
  },
  {
    id: 'pensionRisk',
    title: 'Select an investment-growth (risk) profile for your pension',
    render(cont){ renderStepPensionRisk(cont, fullMontyStore, setStore, btnNext); },
    validate(){ return renderStepPensionRisk.validate(); }
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
  refreshSteps();
  if (cur >= steps.length) cur = steps.length - 1;
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
  const rentPropsSum = (s.rentProps || [])
    .map(p => +p.grossRent || 0)
    .filter(v => v > 0)
    .reduce((a,b)=>a+b, 0);
  return rentPropsSum;
}

export function buildBalanceSheet() {
  const s = fullMontyStore;
  const lifestyle = [
    {
      name: s.homes.familyHome.name || 'Family home',
      value: s.homes.familyHome.value,
      mortgage: s.homes.familyHome.mortgage,
      net: s.homes.familyHome.value - s.homes.familyHome.mortgage
    },
    ...(s.homes.holidayHomes || []).map((h, i) => ({
      name: h.name || `Holiday home #${i+1}`,
      value: h.value,
      mortgage: h.mortgage,
      net: h.value - h.mortgage
    }))
  ].filter(r => (r.value > 0) || (r.mortgage > 0));

  const liquidity = [
    ['Cash in current account', s.liquidity.currentAccount],
    ['Cash savings', s.liquidity.cashSavings],
    ['Money-market funds', s.liquidity.moneyMarket],
    ['100% bond portfolios', s.liquidity.bond100]
  ].map(([name, value]) => ({ name, value })).filter(r => r.value > 0);

  const longevity = (s.investments?.nonPension?.diversifiedFunds || [])
    .map(f => ({ name: f.label || 'Investment fund', value: f.amount }))
    .filter(r => r.value > 0);
  const longevityTotal = s.investments?.nonPension?.diversifiedFundsTotal ||
    longevity.reduce((a,r)=>a+(r.value||0),0);

  const legacy = (s.rentProps || [])
    .filter(r => (r.value > 0) || (r.mortgageBalance > 0))
    .map(({ name, value, mortgageBalance }) => ({
      name: name || 'Investment property',
      value,
      mortgage: mortgageBalance,
      net: value - mortgageBalance
    }));

  const liabs = [
    ...Object.entries(s.liabilities || {}).map(([key, val]) => {
      const names = {
        mortgageRental: 'Mortgage (rental)',
        creditCard: 'Credit cards',
        personalLoan: 'Personal loans',
        carFinance: 'Car finance',
        studentLoan: 'Student loan',
        taxOwed: 'Tax owed',
        otherDebt: 'Other debt'
      };
      return { name: names[key], balance: val.balance };
    }).filter(r => r.balance > 0)
  ];

  const income = {
    familyHomeAnnualRent: s.homes.familyHome.hasRent ? s.homes.familyHome.annualRent : 0
  };

  return { lifestyle, liquidity, longevity, longevityTotal, legacy, liabilities: liabs, income };
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
    growth: fullMontyStore.pensionGrowthRate,
    pensionRisk: fullMontyStore.pensionRisk,
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
    growthRate: fullMontyStore.pensionGrowthRate,
    pensionRisk: fullMontyStore.pensionRisk,
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

