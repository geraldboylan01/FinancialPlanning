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
  const n = +v.replace(/[,\s]/g, '');
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
  const span = document.createElement('span');
  span.textContent = '€';
  span.className = 'unit';
  wrap.append(span, inp);
  return wrap;
}

function labelled(labelText, field) {
  const wrap = document.createElement('label');
  wrap.className = 'wiz-field';
  wrap.textContent = labelText;
  if (field) {
    field.id = field.id || uuid();
    wrap.htmlFor = field.id;
    wrap.appendChild(field);
  }
  return wrap;
}

function checkbox({ id, checked = false }) {
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.id = id;
  inp.checked = checked;
  return inp;
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

      const hasPartner = checkbox({ id: 'fmHasPartner', checked: fullMontyStore.hasPartner });
      hasPartner.addEventListener('change', () => {
        setStore({ hasPartner: hasPartner.checked });
        render();
      });
      cont.appendChild(labelled('Do you have a partner?', hasPartner));

      const dobSelf = document.createElement('input');
      dobSelf.type = 'date';
      dobSelf.id = 'fmDobSelf';
      if (fullMontyStore.dobSelf) dobSelf.value = fullMontyStore.dobSelf;
      dobSelf.addEventListener('change', () => setStore({ dobSelf: dobSelf.value || null }));
      cont.appendChild(labelled('Your date of birth', dobSelf));

      if (fullMontyStore.hasPartner) {
        const dobP = document.createElement('input');
        dobP.type = 'date';
        dobP.id = 'fmDobPartner';
        if (fullMontyStore.dobPartner) dobP.value = fullMontyStore.dobPartner;
        dobP.addEventListener('change', () => setStore({ dobPartner: dobP.value || null }));
        cont.appendChild(labelled("Partner's date of birth", dobP));
      }

      const retireAge = document.createElement('input');
      retireAge.type = 'number';
      retireAge.min = 18; retireAge.max = 100;
      retireAge.id = 'fmRetireAge';
      if (fullMontyStore.retireAge != null) retireAge.value = fullMontyStore.retireAge;
      retireAge.addEventListener('input', () => setStore({ retireAge: numFromInput(retireAge) }));
      cont.appendChild(labelled('Target retirement age', retireAge));
    },
    validate() {
      if (!fullMontyStore.dobSelf) return { ok: false, message: 'Enter your date of birth' };
      if (fullMontyStore.hasPartner && !fullMontyStore.dobPartner) return { ok: false, message: 'Enter partner DOB' };
      if (!fullMontyStore.retireAge) return { ok: false, message: 'Enter retirement age' };
      const age = yearsFrom(fullMontyStore.dobSelf);
      if (fullMontyStore.retireAge < age) return { ok: false, message: 'Retirement age must be at least your current age.' };
      return { ok: true };
    }
  },

  {
    id: 'income',
    title: 'Income today',
    render(cont) {
      cont.innerHTML = '';

      const gross = currencyInput({ id: 'fmGross', value: fullMontyStore.grossIncome ?? '' });
      gross.querySelector('input').addEventListener('input', () => setStore({ grossIncome: numFromInput(gross.querySelector('input')) }));
      cont.appendChild(labelled('Your gross annual income', gross));

      if (fullMontyStore.hasPartner) {
        const gp = currencyInput({ id: 'fmGrossPartner', value: fullMontyStore.grossIncomePartner ?? '' });
        gp.querySelector('input').addEventListener('input', () => setStore({ grossIncomePartner: numFromInput(gp.querySelector('input')) }));
        cont.appendChild(labelled("Partner's gross annual income", gp));
      }
    },
    validate() {
      if (!fullMontyStore.grossIncome) return { ok: false, message: 'Enter your income' };
      return { ok: true };
    }
  },

  {
    id: 'goal',
    title: 'Retirement goal',
    render(cont) {
      cont.innerHTML = '';

      const sel = document.createElement('select');
      sel.id = 'fmGoalType';
      sel.innerHTML = '<option value="percent">Percent of income</option><option value="spend">Annual spending</option>';
      sel.value = fullMontyStore.goalType;
      sel.addEventListener('change', () => { setStore({ goalType: sel.value }); render(); });
      cont.appendChild(labelled('Goal type', sel));

      if (fullMontyStore.goalType === 'percent') {
        const pct = percentInput({ id: 'fmIncomePct', value: fullMontyStore.incomePercent });
        pct.querySelector('input').addEventListener('input', () => setStore({ incomePercent: numFromInput(pct.querySelector('input')) ?? 0 }));
        cont.appendChild(labelled('Income you will need at retirement', pct));
      } else {
        const spend = currencyInput({ id: 'fmRetireSpend', value: fullMontyStore.retireSpend ?? '' });
        spend.querySelector('input').addEventListener('input', () => setStore({ retireSpend: numFromInput(spend.querySelector('input')) }));
        cont.appendChild(labelled('Desired annual spending in retirement', spend));
      }
    },
    validate() {
      if (fullMontyStore.goalType === 'percent') {
        if (fullMontyStore.incomePercent == null) return { ok: false, message: 'Enter percent of income' };
      } else {
        if (!fullMontyStore.retireSpend) return { ok: false, message: 'Enter annual spending' };
      }
      return { ok: true };
    }
  },

  {
    id: 'pensions',
    title: 'Pensions',
    render(cont) {
      cont.innerHTML = '';

      // Helper to render block for person (self/partner)
      function personBlock(prefix, labelPrefix) {
        const wrap = document.createElement('div');
        wrap.className = 'person-block';
        const h = document.createElement('h4');
        h.textContent = labelPrefix;
        wrap.appendChild(h);

        const cur = currencyInput({ id: `${prefix}Cur`, value: fullMontyStore[`currentPensionValue${labelPrefix}`] ?? 0 });
        cur.querySelector('input').addEventListener('input', () => setStore({ [`currentPensionValue${labelPrefix}`]: numFromInput(cur.querySelector('input')) || 0 }));
        wrap.appendChild(labelled('Current pension value', cur));

        // personal contrib – euro or percent
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
        wrap.appendChild(labelled('Your contribution', pc));
        wrap.appendChild(labelled('…or % of salary', pp));

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
        wrap.appendChild(labelled('Employer contribution', ec));
        wrap.appendChild(labelled('…or % of salary', ep));

        const dbToggle = checkbox({ id: `${prefix}HasDb`, checked: fullMontyStore[`hasDb${labelPrefix}`] });
        dbToggle.addEventListener('change', () => { setStore({ [`hasDb${labelPrefix}`]: dbToggle.checked }); render(); });
        wrap.appendChild(labelled('Defined benefit pension?', dbToggle));

        if (fullMontyStore[`hasDb${labelPrefix}`]) {
          const dbAmt = currencyInput({ id: `${prefix}DbAmt`, value: fullMontyStore[`dbPension${labelPrefix}`] ?? '' });
          dbAmt.querySelector('input').addEventListener('input', () => setStore({ [`dbPension${labelPrefix}`]: numFromInput(dbAmt.querySelector('input')) }));
          wrap.appendChild(labelled('DB annual amount', dbAmt));
          const dbAge = document.createElement('input');
          dbAge.type = 'number'; dbAge.min = 50; dbAge.max = 100; dbAge.value = fullMontyStore[`dbStartAge${labelPrefix}`] ?? '';
          dbAge.addEventListener('input', () => setStore({ [`dbStartAge${labelPrefix}`]: numFromInput(dbAge) }));
          wrap.appendChild(labelled('DB pension start age', dbAge));
        }

        const sp = checkbox({ id: `${prefix}State`, checked: fullMontyStore[`statePension${labelPrefix}`] });
        sp.addEventListener('change', () => setStore({ [`statePension${labelPrefix}`]: sp.checked }));
        wrap.appendChild(labelled('Qualifies for State Pension?', sp));

        return wrap;
      }

      cont.appendChild(personBlock('self', 'Self'));
      if (fullMontyStore.hasPartner) cont.appendChild(personBlock('partner', 'Partner'));
    },
    validate() {
      if (fullMontyStore.hasDbSelf && (!fullMontyStore.dbPensionSelf || !fullMontyStore.dbStartAgeSelf))
        return { ok: false, message: 'Enter DB pension details for yourself' };
      if (fullMontyStore.hasPartner && fullMontyStore.hasDbPartner && (!fullMontyStore.dbPensionPartner || !fullMontyStore.dbStartAgePartner))
        return { ok: false, message: 'Enter DB pension details for partner' };
      return { ok: true };
    }
  },

  {
    id: 'otherIncome',
    title: 'Other income',
    render(cont) {
      cont.innerHTML = '';
      const rent = currencyInput({ id: 'fmRent', value: fullMontyStore.rentalIncomeNow ?? '' });
      rent.querySelector('input').addEventListener('input', () => setStore({ rentalIncomeNow: numFromInput(rent.querySelector('input')) }));
      cont.appendChild(labelled('Rental income today', rent));
      const chk = checkbox({ id: 'fmRentInfl', checked: fullMontyStore.rentalInflatesWithCPI });
      chk.addEventListener('change', () => setStore({ rentalInflatesWithCPI: chk.checked }));
      cont.appendChild(labelled('Rental income grows with CPI', chk));
    },
    validate() { return { ok: true }; }
  },

  {
    id: 'assets',
    title: 'Assets',
    render(cont) {
      cont.innerHTML = '';

      const groups = [
        { key: 'homes', label: 'Homes' },
        { key: 'cashLike', label: 'Cash & cash-like' },
        { key: 'investments', label: 'Investments (non-pension)' },
        { key: 'rentProps', label: 'Rental properties' },
        { key: 'valuables', label: 'Valuables / collectibles' },
      ];

      groups.forEach(g => {
        const sec = document.createElement('div');
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
        cont.appendChild(sec);
      });

      function assetRow(key, row) {
        const wrap = document.createElement('div');
        wrap.className = 'asset-row';

        const name = document.createElement('input');
        name.type = 'text';
        name.value = row.name || '';
        name.placeholder = 'name';
        name.addEventListener('input', () => row.name = name.value);
        wrap.appendChild(name);

        const val = currencyInput({ id: uuid(), value: row.value || '' });
        val.querySelector('input').addEventListener('input', () => row.value = numFromInput(val.querySelector('input')) || 0);
        wrap.appendChild(val);

        if (key === 'rentProps') {
          const mort = currencyInput({ id: uuid(), value: row.mortgageBalance || '' });
          mort.querySelector('input').addEventListener('input', () => row.mortgageBalance = numFromInput(mort.querySelector('input')) || null);
          wrap.appendChild(labelled('Mortgage', mort));
          const gr = currencyInput({ id: uuid(), value: row.grossRent || '' });
          gr.querySelector('input').addEventListener('input', () => row.grossRent = numFromInput(gr.querySelector('input')) || null);
          wrap.appendChild(labelled('Gross rent', gr));
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
    validate() { return { ok: true }; }
  },

  {
    id: 'debts',
    title: 'Debts',
    render(cont) {
      cont.innerHTML = '';
      const list = document.createElement('div');
      fullMontyStore.liabilities.forEach(row => list.appendChild(debtRow(row)));
      cont.appendChild(list);
      const add = document.createElement('button');
      add.textContent = 'Add liability';
      add.type = 'button';
      add.addEventListener('click', () => { fullMontyStore.liabilities.push({ id: uuid(), name: '', balance: 0 }); render(); });
      cont.appendChild(add);

      function debtRow(row) {
        const wrap = document.createElement('div');
        wrap.className = 'debt-row';
        const name = document.createElement('input');
        name.type = 'text'; name.placeholder = 'name'; name.value = row.name || '';
        name.addEventListener('input', () => row.name = name.value);
        wrap.appendChild(name);
        const bal = currencyInput({ id: uuid(), value: row.balance || '' });
        bal.querySelector('input').addEventListener('input', () => row.balance = numFromInput(bal.querySelector('input')) || 0);
        wrap.appendChild(bal);
        const rate = percentInput({ id: uuid(), value: row.rate || '' });
        rate.querySelector('input').addEventListener('input', () => row.rate = numFromInput(rate.querySelector('input')) || null);
        wrap.appendChild(rate);
        const rm = document.createElement('button'); rm.textContent = 'Remove'; rm.type = 'button';
        rm.addEventListener('click', () => { removeRow('liabilities', row.id); render(); });
        wrap.appendChild(rm);
        return wrap;
      }
    },
    validate() { return { ok: true }; }
  },

  {
    id: 'growth',
    title: 'Growth profile',
    render(cont) {
      cont.innerHTML = '';
      const opts = [
        { val: 0.04, title: 'Low', desc: '≈4% p.a.' },
        { val: 0.05, title: 'Balanced', desc: '≈5% p.a.' },
        { val: 0.06, title: 'High', desc: '≈6% p.a.' },
        { val: 0.07, title: 'Very high', desc: '≈7% p.a.' }
      ];
      const wrap = document.createElement('div');
      wrap.className = 'risk-options';
      opts.forEach(o => {
        const card = document.createElement('label');
        card.className = 'risk-card';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'fmGrowth';
        radio.value = o.val;
        radio.style.display = 'none';
        if (fullMontyStore.growthProfile === o.val) {
          radio.checked = true; card.classList.add('selected');
        }
        radio.addEventListener('change', () => { fullMontyStore.growthProfile = o.val; wrap.querySelectorAll('.risk-card').forEach(c => c.classList.remove('selected')); card.classList.add('selected'); });
        card.appendChild(radio);
        const t = document.createElement('div'); t.className = 'risk-title'; t.textContent = o.title; card.appendChild(t);
        const d = document.createElement('div'); d.className = 'risk-desc'; d.textContent = o.desc; card.appendChild(d);
        wrap.appendChild(card);
      });
      cont.appendChild(wrap);
    },
    validate() { return { ok: true }; }
  },

  {
    id: 'assumptions',
    title: 'Assumptions',
    render(cont) {
      cont.innerHTML = '';
      const cpi = percentInput({ id: 'fmCpi', value: fullMontyStore.cpiRate });
      cpi.querySelector('input').addEventListener('input', () => setStore({ cpiRate: numFromInput(cpi.querySelector('input')) ?? 0 }));
      cont.appendChild(labelled('Inflation (CPI)', cpi));
      const sft = checkbox({ id: 'fmSft', checked: fullMontyStore.sftAwareness });
      sft.addEventListener('change', () => setStore({ sftAwareness: sft.checked }));
      cont.appendChild(labelled('Warn about SFT threshold', sft));
    },
    validate() { return { ok: true }; }
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
    validate() { return { ok: true }; }
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
  dots.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { if (i <= cur) { cur = +b.dataset.idx; render(); } });
  });
  btnBack.style.display = cur === 0 ? 'none' : '';
  btnNext.textContent = cur === steps.length - 1 ? 'Finish' : 'Next';
  focusFirst();
}

function validateStep() {
  const res = steps[cur].validate();
  if (res.ok) return true;
  alert(res.message || 'Please fill required fields');
  return false;
}

function next() {
  if (!validateStep()) return;
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

