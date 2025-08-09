// Full Monty all-in-one wizard
// This file implements a small step engine and a central data store that
// feeds the existing calculators (FY Money Calculator, Pension Projection
// and Personal Balance Sheet).

import { animate, addKeyboardNav } from './wizardCore.js';

// ───────────────────────────────────────────────────────────────
// Data store and helpers
// ----------------------------------------------------------------

const fullMontyStore = {
  // step 1 – household
  hasPartner: false,
  dobSelf: null,
  dobPartner: null,
  retireAge: null,

  // step 2 – income
  grossIncome: null,
  grossIncomePartner: null,

  // step 3 – retirement goal
  goalType: 'percent',
  incomePercent: 70,
  retireSpend: null,

  // step 4 – pensions (defined contribution + DB + SP)
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

  // step 5 – other income
  rentalIncomeNow: null,
  rentalInflatesWithCPI: true,

  // step 6 – assets
  homes: [],
  cashLike: [],
  investments: [],
  rentProps: [],
  valuables: [],

  // step 7 – liabilities
  liabilities: [],

  // step 8 – growth profile
  growthProfile: 0.05,

  // step 9 – assumptions
  cpiRate: 2.0,
  sftAwareness: true,
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
    title: 'Retirement goal',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      const sel = document.createElement('select');
      sel.id = 'goalType';
      sel.innerHTML = '<option value="percent">Percent of income</option><option value="spend">Annual spending</option>';
      sel.value = fullMontyStore.goalType;
      sel.addEventListener('change', () => { setStore({ goalType: sel.value }); render(); });
      form.appendChild(formGroup('goalType', 'Goal type', sel));

      if (fullMontyStore.goalType === 'percent') {
        const pct = percentInput({ id: 'incomePercent', value: fullMontyStore.incomePercent ?? '' });
        pct.querySelector('input').addEventListener('input', () => setStore({ incomePercent: numFromInput(pct.querySelector('input')) ?? 0 }));
        form.appendChild(formGroup('incomePercent', 'Income you will need at retirement', pct));
      } else {
        const spend = currencyInput({ id: 'retireSpend', value: fullMontyStore.retireSpend ?? '' });
        spend.querySelector('input').addEventListener('input', () => setStore({ retireSpend: numFromInput(spend.querySelector('input')) }));
        form.appendChild(formGroup('retireSpend', 'Desired annual spending in retirement', spend));
      }

      cont.appendChild(form);
    },
    validate() {
      const errs = {};
      if (fullMontyStore.goalType === 'percent') {
        const v = fullMontyStore.incomePercent;
        if (v == null) errs.incomePercent = 'This field is required.';
        else if (v < 0 || v > 100) errs.incomePercent = 'Enter a % between 0 and 100.';
      } else {
        const v = fullMontyStore.retireSpend;
        if (v == null) errs.retireSpend = 'This field is required.';
        else if (v < 0) errs.retireSpend = 'Please enter a number ≥ 0.';
      }
      return { ok: Object.keys(errs).length === 0, errors: errs };
    }
  },

  {
    id: 'pensions',
    title: 'Pensions',
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
    id: 'otherIncome',
    title: 'Other income',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      const rent = currencyInput({ id: 'rentalIncome', value: fullMontyStore.rentalIncomeNow ?? '' });
      rent.querySelector('input').addEventListener('input', () => setStore({ rentalIncomeNow: numFromInput(rent.querySelector('input')) }));
      form.appendChild(formGroup('rentalIncome', 'Rental income today', rent));

      const chk = controlGroup('rentInfl', 'Rental income grows with CPI', fullMontyStore.rentalInflatesWithCPI);
      chk.input.addEventListener('change', () => setStore({ rentalInflatesWithCPI: chk.input.checked }));
      form.appendChild(chk.group);

      cont.appendChild(form);
    },
    validate() { return { ok: true, errors: {} }; }
  },

  {
    id: 'assets',
    title: 'Assets',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';

      const groups = [
        { key: 'homes', label: 'Homes' },
        { key: 'cashLike', label: 'Cash & cash-like' },
        { key: 'investments', label: 'Investments (non-pension)' },
        { key: 'rentProps', label: 'Rental properties' },
        { key: 'valuables', label: 'Valuables / collectibles' },
      ];

      groups.forEach(g => {
        const sec = document.createElement('div');
        sec.className = 'form-group';
        const h = document.createElement('h4');
        h.textContent = g.label;
        sec.appendChild(h);
        const list = document.createElement('div');
        fullMontyStore[g.key].forEach(row => list.appendChild(assetRow(g.key, row)));
        sec.appendChild(list);
        const add = document.createElement('button');
        add.textContent = 'Add';
        add.type = 'button';
        add.addEventListener('click', () => {
          const r = { id: uuid(), name: '', value: 0 };
          fullMontyStore[g.key].push(r);
          render();
        });
        sec.appendChild(add);
        form.appendChild(sec);
      });

      cont.appendChild(form);

      function assetRow(key, row) {
        const wrap = document.createElement('div');
        wrap.className = 'asset-row form-group';

        const nameId = uuid();
        const nameGrp = document.createElement('div');
        nameGrp.className = 'form-group';
        const nameLab = document.createElement('label');
        nameLab.htmlFor = nameId; nameLab.textContent = 'Name';
        const name = document.createElement('input');
        name.type = 'text'; name.id = nameId; name.value = row.name || '';
        name.addEventListener('input', () => row.name = name.value);
        nameGrp.append(nameLab, name);
        wrap.appendChild(nameGrp);

        const valId = uuid();
        const val = currencyInput({ id: valId, value: row.value || '' });
        val.querySelector('input').addEventListener('input', () => row.value = numFromInput(val.querySelector('input')) || 0);
        wrap.appendChild(formGroup(valId, 'Value', val));

        if (key === 'rentProps') {
          const mortId = uuid();
          const mort = currencyInput({ id: mortId, value: row.mortgageBalance || '' });
          mort.querySelector('input').addEventListener('input', () => row.mortgageBalance = numFromInput(mort.querySelector('input')) || null);
          wrap.appendChild(formGroup(mortId, 'Mortgage', mort));
          const grId = uuid();
          const gr = currencyInput({ id: grId, value: row.grossRent || '' });
          gr.querySelector('input').addEventListener('input', () => row.grossRent = numFromInput(gr.querySelector('input')) || null);
          wrap.appendChild(formGroup(grId, 'Gross rent', gr));
        }

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = 'Remove';
        rm.addEventListener('click', () => {
          removeRow(key, row.id);
          render();
        });
        wrap.appendChild(rm);
        return wrap;
      }
    },
    validate() { return { ok: true, errors: {} }; }
  },

  {
    id: 'debts',
    title: 'Debts',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';
      const list = document.createElement('div');
      fullMontyStore.liabilities.forEach(row => list.appendChild(debtRow(row)));
      form.appendChild(list);
      const add = document.createElement('button');
      add.textContent = 'Add liability';
      add.type = 'button';
      add.addEventListener('click', () => { fullMontyStore.liabilities.push({ id: uuid(), name: '', balance: 0 }); render(); });
      form.appendChild(add);
      cont.appendChild(form);

      function debtRow(row) {
        const wrap = document.createElement('div');
        wrap.className = 'debt-row form-group';

        const nameId = uuid();
        const nameGrp = document.createElement('div');
        nameGrp.className = 'form-group';
        const nameLab = document.createElement('label');
        nameLab.htmlFor = nameId; nameLab.textContent = 'Name';
        const name = document.createElement('input');
        name.type = 'text'; name.id = nameId; name.value = row.name || '';
        name.addEventListener('input', () => row.name = name.value);
        nameGrp.append(nameLab, name);
        wrap.appendChild(nameGrp);

        const balId = uuid();
        const bal = currencyInput({ id: balId, value: row.balance || '' });
        bal.querySelector('input').addEventListener('input', () => row.balance = numFromInput(bal.querySelector('input')) || 0);
        wrap.appendChild(formGroup(balId, 'Balance', bal));

        const rateId = uuid();
        const rate = percentInput({ id: rateId, value: row.rate || '' });
        rate.querySelector('input').addEventListener('input', () => row.rate = numFromInput(rate.querySelector('input')) || null);
        wrap.appendChild(formGroup(rateId, 'Rate', rate));

        const rm = document.createElement('button');
        rm.textContent = 'Remove';
        rm.type = 'button';
        rm.addEventListener('click', () => { removeRow('liabilities', row.id); render(); });
        wrap.appendChild(rm);
        return wrap;
      }
    },
    validate() { return { ok: true, errors: {} }; }
  },

  {
    id: 'growth',
    title: 'Growth profile',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';
      const opts = [
        { val: 0.04, title: 'Low', desc: '≈4% p.a.' },
        { val: 0.05, title: 'Balanced', desc: '≈5% p.a.' },
        { val: 0.06, title: 'High', desc: '≈6% p.a.' },
        { val: 0.07, title: 'Very high', desc: '≈7% p.a.' }
      ];
      const wrap = document.createElement('div');
      wrap.className = 'risk-options';
      opts.forEach((o, i) => {
        const id = `growth${i}`;
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'growth';
        radio.id = id;
        radio.value = o.val;
        if (fullMontyStore.growthProfile === o.val) radio.checked = true;
        radio.addEventListener('change', () => {
          fullMontyStore.growthProfile = o.val;
          wrap.querySelectorAll('.risk-card').forEach(c => c.classList.remove('selected'));
          wrap.querySelector(`label[for="${id}"]`).classList.add('selected');
          validateStep();
        });
        const label = document.createElement('label');
        label.className = 'risk-card';
        label.htmlFor = id;
        if (radio.checked) label.classList.add('selected');
        const t = document.createElement('span'); t.className = 'risk-title'; t.textContent = o.title; label.appendChild(t);
        const d = document.createElement('span'); d.className = 'risk-desc'; d.textContent = o.desc; label.appendChild(d);
        wrap.append(radio, label);
      });
      form.appendChild(wrap);
      cont.appendChild(form);
    },
    validate() { return { ok: fullMontyStore.growthProfile != null, errors: {} }; }
  },

  {
    id: 'assumptions',
    title: 'Assumptions',
    render(cont) {
      cont.innerHTML = '';
      const form = document.createElement('div');
      form.className = 'form';
      const cpi = percentInput({ id: 'cpi', value: fullMontyStore.cpiRate });
      cpi.querySelector('input').addEventListener('input', () => setStore({ cpiRate: numFromInput(cpi.querySelector('input')) ?? 0 }));
      form.appendChild(formGroup('cpi', 'Inflation (CPI)', cpi));
      const sft = controlGroup('sftWarn', 'Warn about SFT threshold', fullMontyStore.sftAwareness);
      sft.input.addEventListener('change', () => setStore({ sftAwareness: sft.input.checked }));
      form.appendChild(sft.group);
      cont.appendChild(form);
    },
    validate() { return { ok: true, errors: {} }; }
  },

  {
    id: 'review',
    title: 'Review',
    render(cont, nav) {
      cont.innerHTML = '';
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(fullMontyStore, null, 2);
      cont.appendChild(pre);
      const runBtn = document.createElement('button');
      runBtn.textContent = 'Run my plan';
      runBtn.type = 'button';
      runBtn.addEventListener('click', runAll);
      cont.appendChild(runBtn);
    },
    validate() { return { ok: true, errors: {} }; }
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
  progEl.textContent = `Step ${cur + 1} of ${steps.length}`;
  progFill.style.width = ((cur + 1) / steps.length * 100) + '%';
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
  animate(container, 'next');
  if (cur < steps.length - 1) { cur++; render(); }
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
  const itemized = fullMontyStore.rentProps.map(r => r.grossRent).filter(v => v);
  if (itemized.length) return itemized.reduce((a, b) => a + b, 0);
  return fullMontyStore.rentalIncomeNow || 0;
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
    targetType: fullMontyStore.goalType,
    incomePercent: fullMontyStore.incomePercent,
    retireSpend: fullMontyStore.retireSpend,
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

