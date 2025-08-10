// Full Monty all-in-one wizard
// This file implements a small step engine and a central data store that
// feeds the existing calculators (FY Money Calculator, Pension Projection
// and Personal Balance Sheet).

import { animate, addKeyboardNav } from './wizardCore.js';

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
  homes: [],        // [{id,name,value,notes?}]
  cashLike: [],     // [{id,name,value}]
  investments: [],  // [{id,name,value}]
  rentProps: [],    // [{id,name,value,mortgageBalance?,grossRent?}]
  valuables: [],    // [{id,name,value}]

  // debts
  liabilities: [],  // [{id,name,balance,rate?}]

  // risk profile
  growthProfile: 0.05,

  // assumptions (internal only)
  cpiRate: 2.3,         // fixed, not user-editable
  sftAwareness: true    // fixed, not user-editable
};

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2);
}

export function getStore() {
  return structuredClone(fullMontyStore);
}

export function setStore(patch) {
  Object.assign(fullMontyStore, patch);
}

export function pushRow(listKey, row) {
  if (!fullMontyStore[listKey]) fullMontyStore[listKey] = [];
  if (!row.id) row.id = uuid();
  fullMontyStore[listKey].push(row);
}

export function removeRow(listKey, id) {
  if (!Array.isArray(fullMontyStore[listKey])) return;
  fullMontyStore[listKey] = fullMontyStore[listKey].filter(r => r.id !== id);
}

// ───────────────────────────────────────────────────────────────
// DOM helpers
// ----------------------------------------------------------------

function q(id) { return document.getElementById(id); }

function numFromInput(inp) {
  const v = inp.value.trim();
  if (v === '') return null;
  const n = +v.replace(/[^0-9.-]/g, '');
  return isNaN(n) ? null : n;
}

function percentInput({ id, value = '', min = 0, max = 100 }) {
  const wrap = document.createElement('div');
  wrap.className = 'input-wrap suffix';
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.id = id;
  inp.min = min;
  inp.max = max;
  inp.step = '0.1';
  inp.value = value;
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/[^0-9.-]/g, '');
  });
  const span = document.createElement('span');
  span.textContent = '%';
  span.className = 'unit';
  wrap.append(inp, span);
  return wrap;
}

function currencyInput({ id, value = '', min = 0 }) {
  const wrap = document.createElement('div');
  wrap.className = 'input-wrap prefix';
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.id = id;
  if (min != null) inp.min = min;
  inp.value = value;
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/[^0-9.-]/g, '');
  });
  const span = document.createElement('span');
  span.textContent = '€';
  span.className = 'unit';
  wrap.append(span, inp);
  return wrap;
}

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
  return (cont) => {
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
          });
        } else if (f.type === 'percent') {
          fieldEl = percentInput({ id, value: row[f.key] ?? '' });
          const input = fieldEl.querySelector('input');
          input.addEventListener('input', () => {
            row[f.key] = numFromInput(input) || 0;
          });
        } else {
          fieldEl = document.createElement('input');
          fieldEl.type = 'text';
          fieldEl.id = id;
          fieldEl.value = row[f.key] ?? '';
          fieldEl.addEventListener('input', () => { row[f.key] = fieldEl.value; });
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
}

// Step 3 – percent-only goal
function renderStepGoal(container){
  const s = getStore();
  setStore({ goalType: 'percent' }); // hard lock

  container.innerHTML = `
    <div class="form">
      <div class="form-group">
        <label for="incomePercent">Income you will need at retirement</label>
        <div class="input-wrap suffix">
          <input id="incomePercent" type="number" inputmode="decimal" min="0" max="100" step="0.1"
                 value="${s.incomePercent ?? 70}">
          <span class="unit">%</span>
        </div>
        <div class="help">We’ll target this share of your gross income.</div>
      </div>
    </div>
  `;
  const pct = container.querySelector('#incomePercent');
  pct.addEventListener('input', () => {
    let v = parseFloat(pct.value);
    if (Number.isNaN(v)) v = 0;
    if (v < 0) v = 0; if (v > 100) v = 100;
    pct.value = v;
    setStore({ incomePercent: v, goalType: 'percent' });
  });
}
renderStepGoal.validate = () => {
  const v = getStore().incomePercent;
  return (typeof v === 'number' && v >= 0 && v <= 100)
    ? { ok: true } : { ok: false, message: 'Enter a % between 0 and 100.' };
};
// Step 5–9 renderers
const renderStepHomes = makeListStepRenderer('homes', {
  addLabel: 'Add home',
  hint: 'Family home or holiday home you use yourself.',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'currency', default: 0 },
    { key: 'notes', label: 'Notes', type: 'text' }
  ]
});
renderStepHomes.validate = () => {
  const arr = getStore().homes || [];
  setStore({ homes: arr.filter(r => (r.value || 0) > 0) });
  return { ok: true };
};

const renderStepCash = makeListStepRenderer('cashLike', {
  addLabel: 'Add item',
  hint: 'Cash on deposit, savings accounts, money market funds, 100% bond portfolio.',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'currency', default: 0 }
  ]
});
renderStepCash.validate = () => {
  const arr = getStore().cashLike || [];
  setStore({ cashLike: arr.filter(r => (r.value || 0) > 0) });
  return { ok: true };
};

const renderStepInvest = makeListStepRenderer('investments', {
  addLabel: 'Add investment',
  hint: 'Investment accounts/funds (mixed asset or equity funds). Exclude pensions (we captured those earlier).',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'currency', default: 0 }
  ]
});
renderStepInvest.validate = () => {
  const arr = getStore().investments || [];
  setStore({ investments: arr.filter(r => (r.value || 0) > 0) });
  return { ok: true };
};

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
renderStepRentProps.validate = () => {
  const arr = getStore().rentProps || [];
  setStore({ rentProps: arr.filter(r => (r.value || 0) > 0) });
  return { ok: true };
};

const renderStepLiabilities = makeListStepRenderer('liabilities', {
  addLabel: 'Add liability',
  hint: 'Loans, credit cards, other debts.',
  valueKey: 'balance',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'balance', label: 'Balance', type: 'currency', default: 0 },
    { key: 'rate', label: 'Rate', type: 'percent' }
  ]
});
renderStepLiabilities.validate = () => {
  const arr = getStore().liabilities || [];
  setStore({ liabilities: arr.filter(r => (r.balance || 0) > 0) });
  return { ok: true };
};

// ───────────────────────────────────────────────────────────────
// Step engine
// ----------------------------------------------------------------

const modal = q('fullMontyModal');
const container = q('fmStepContainer');
const btnBack = q('fmBack');
const btnNext = q('fmNext');
const dots = q('fmDots');
const progEl = q('fmProgress');
const progFill = q('fmProgressFill');

let cur = 0;

// Helper: focus first input after render
function focusFirst() {
  const el = container.querySelector('input, select, textarea, button');
  if (el) el.focus();
}

// Step definitions ------------------------------------------------

const steps = [
  {
    id: 'household',
    title: 'Household',
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
    title: 'Income today',
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
    title: 'Retirement goal (percent-only)',
    render: renderStepGoal,
    validate: renderStepGoal.validate
  },

  {
    id: 'pensions',
    title: 'Pensions (DC/DB/State)',
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
    title: 'Homes you live in / holiday places',
    render: renderStepHomes,
    validate: renderStepHomes.validate
  },

  {
    id: 'cash',
    title: 'Cash & easy-access savings (incl. 100% bonds)',
    render: renderStepCash,
    validate: renderStepCash.validate
  },

  {
    id: 'investments',
    title: 'Investments (funds/accounts, not pensions)',
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
  const total = steps.length;
  progEl.textContent = `Step ${cur + 1} of ${total}`;
  progFill.style.width = ((cur + 1) / total * 100) + '%';
  container.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = step.title;
  container.appendChild(h);
  step.render(container);
  dots.innerHTML = steps.map((_, i) => `<button class="wizDot${i === cur ? ' active' : ''}" data-idx="${i}"></button>`).join('');
  dots.querySelectorAll('button').forEach((b, i) => {
    b.addEventListener('click', () => { if (i <= cur) { cur = i; render(); } });
  });
  container.querySelectorAll('input, select, textarea, button').forEach(el => {
    el.addEventListener('blur', () => validateStep(true));
    el.addEventListener('input', () => validateStep());
    el.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  });
  validateStep();
  btnBack.style.display = cur === 0 ? 'none' : '';
  btnNext.textContent = cur === total - 1 ? 'Finish' : 'Next';
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

function computeResolvedRental() {
  const rents = fullMontyStore.rentProps
    .map(r => r.grossRent)
    .filter(v => typeof v === 'number' && v > 0);
  return rents.length ? rents.reduce((a, b) => a + b, 0) : 0;
}

function buildBalanceSheet() {
  const lifestyle = fullMontyStore.homes.filter(r => r.value > 0);
  const liquidity = fullMontyStore.cashLike.filter(r => r.value > 0);
  const longevity = fullMontyStore.investments.filter(r => r.value > 0);
  const legacy = [
    ...fullMontyStore.rentProps.filter(r => r.value > 0).map(({ name, value }) => ({ name, value })),
    ...fullMontyStore.valuables.filter(r => r.value > 0)
  ];
  const liabs = [
    ...fullMontyStore.liabilities.filter(r => r.balance > 0).map(({ name, balance }) => ({ name, balance })),
    ...fullMontyStore.rentProps.filter(r => r.mortgageBalance > 0).map(({ name, mortgageBalance }) => ({ name: name + ' mortgage', balance: mortgageBalance }))
  ];
  return { lifestyle, liquidity, longevity, legacy, liabilities: liabs };
}

function runAll() {
  const rent = computeResolvedRental();

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

