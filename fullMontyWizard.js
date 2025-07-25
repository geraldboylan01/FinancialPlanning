import { animate, addKeyboardNav } from './wizardCore.js';

const storageKey = 'fullMontyDraft';
let data = JSON.parse(localStorage.getItem(storageKey) || '{}');
function persist() {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

export const wizardSteps = [
  { title: 'Profile', inputs: [
      { id: 'dob', label: 'Your date of birth', type: 'date', required: true },
      { id: 'partner', label: 'Do you have a partner?', type: 'boolean' },
      { id: 'partnerDob', label: 'Partner date of birth', type: 'date', showIf: 'partner' }
  ]},
  { title: 'Income & Work', inputs: [
      { id: 'salary', label: 'Gross annual salary (€)', type: 'currency', required: true },
      { id: 'rentInc', label: 'Annual rental income (€)', type: 'currency' },
      { id: 'employed', label: 'Are you an employee?', type: 'boolean', default: true }
  ]},
  { title: 'Pension Contributions', inputs: [
      { id: 'potNow', label: 'Current pension value (€)', type: 'currency' },
      { id: 'youPct', label: 'Your contribution (% of salary)', type: 'percent' },
      { id: 'youFixed', label: '\u2026or fixed annual amount (€)', type: 'currency' },
      { id: 'employerPct', label: 'Employer contribution (% of salary)', type: 'percent' },
      { id: 'employerFixed', label: '\u2026or fixed annual amount (€)', type: 'currency' }
  ]},
  { title: 'Retirement Preferences', inputs: [
      { id: 'retAge', label: 'Desired retirement age', type: 'number', min: 50, max: 70, default: 65 },
      { id: 'incomeNeed', label: '% of salary you\u2019ll need in retirement', type: 'percent', default: 70 },
      { id: 'statePenMe', label: 'Will you collect the State Pension?', type: 'boolean', default: true },
      { id: 'statePenPr', label: 'Partner entitled to State Pension?', type: 'boolean', showIf: 'partner' }
  ]},
  { title: 'Other Pensions', inputs: [
      { id: 'hasDB', label: 'Will you receive a Defined-Benefit pension?', type: 'boolean' },
      { id: 'dbAnnual', label: 'DB annual amount at retirement (€)', type: 'currency', showIf: 'hasDB' },
      { id: 'dbStart', label: 'DB pension starts at age', type: 'number', min: 50, max: 100, showIf: 'hasDB' }
  ]},
  { title: 'Risk & Growth', inputs: [
      { id: 'growth', label: 'Choose a growth profile', type: 'select',
        options: [
          { value: 0.04, text: 'Low \u00b7 \u22484 % p.a.' },
          { value: 0.05, text: 'Balanced \u00b7 \u22485 % p.a.' },
          { value: 0.06, text: 'High \u00b7 \u22486 % p.a.' },
          { value: 0.07, text: 'Very-high \u00b7 \u22487 % p.a.' }
        ],
        default: 0.05 }
  ]},
  { title: 'Assets & Liabilities', component: 'balanceSheetWizard' }
];

const modal = document.getElementById('fullMontyModal');
const container = document.getElementById('fmStepContainer');
const btnBack = document.getElementById('fmBack');
const btnNext = document.getElementById('fmNext');
const dots    = document.getElementById('fmDots');
const progEl  = document.getElementById('fmProgress');
const progFill= document.getElementById('fmProgressFill');
let cur = 0;

function visibleInputs(step) {
  if (!step.inputs) return [];
  return step.inputs.filter(inp => !inp.showIf || data[inp.showIf]);
}

function createInput(inp) {
  const wrap = document.createElement('div');
  wrap.className = 'wiz-field';
  if (inp.label) {
    const label = document.createElement('label');
    label.textContent = inp.label;
    label.htmlFor = inp.id;
    wrap.appendChild(label);
  }
  let el;
  if (inp.type === 'boolean') {
    el = document.createElement('select');
    el.id = inp.id;
    el.innerHTML = '<option value="">--</option><option value="true">Yes</option><option value="false">No</option>';
    if (data[inp.id] !== undefined) el.value = String(data[inp.id]);
  } else if (inp.type === 'select') {
    el = document.createElement('select');
    el.id = inp.id;
    inp.options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      el.appendChild(opt);
    });
    el.value = data[inp.id] ?? inp.default ?? inp.options[0].value;
  } else {
    el = document.createElement('input');
    el.id = inp.id;
    el.type = 'number';
    if (inp.type === 'date') el.type = 'date';
    if (inp.min != null) el.min = inp.min;
    if (inp.max != null) el.max = inp.max;
    if (data[inp.id] != null) el.value = data[inp.id];
    else if (inp.default != null) el.value = inp.default;
  }
  el.addEventListener('input', () => {
    let val = el.value;
    if (inp.type === 'boolean') val = val === '' ? null : val === 'true';
    else if (inp.type === 'number' || inp.type === 'currency' || inp.type === 'percent') val = val === '' ? '' : +val;
    data[inp.id] = val;
    persist();
    updateNext();
  });
  wrap.appendChild(el);
  return wrap;
}

function updateNext() {
  const step = wizardSteps[cur];
  let valid = true;
  for (const inp of visibleInputs(step)) {
    const val = data[inp.id];
    if (inp.required && (val === '' || val === null || val === undefined)) valid = false;
    if (inp.min != null && typeof val === 'number' && val < inp.min) valid = false;
    if (inp.max != null && typeof val === 'number' && val > inp.max) valid = false;
  }
  if (cur === wizardSteps.length - 1) {
    btnNext.textContent = 'Continue to Results';
    btnNext.disabled = true;
  } else {
    btnNext.textContent = 'Next';
    btnNext.disabled = !valid;
  }
}

function render() {
  const step = wizardSteps[cur];
  progEl.textContent = `Step ${cur + 1} of ${wizardSteps.length}`;
  progFill.style.width = ((cur + 1) / wizardSteps.length * 100) + '%';
  container.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = step.title;
  container.appendChild(h);
  if (step.component) {
    const p = document.createElement('p');
    p.textContent = 'TODO: Integrate balance sheet wizard.';
    container.appendChild(p);
  } else {
    visibleInputs(step).forEach(inp => container.appendChild(createInput(inp)));
  }
  dots.innerHTML = wizardSteps.map((_, i) => `<button class="wizDot${i===cur?' active':''}" data-idx="${i}"></button>`).join('');
  dots.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cur = +b.dataset.idx; render(); }));
  btnBack.style.display = cur === 0 ? 'none' : '';
  updateNext();
  const focusable = container.querySelector('input,select');
  if (focusable) focusable.focus();
}

function next() {
  if (btnNext.disabled) return;
  animate(container,'next');
  cur++;
  if (cur >= wizardSteps.length) {
    modal.classList.add('hidden');
    return;
  }
  render();
}

function back() {
  if (cur === 0) return;
  animate(container,'back');
  cur--; render();
}

btnNext.addEventListener('click', next);
btnBack.addEventListener('click', back);
addKeyboardNav(modal,{back,next,close:()=>modal.classList.add('hidden'),getCur:()=>cur,getTotal:()=>wizardSteps.length});

export function openFullMontyWizard() {
  cur = 0;
  modal.classList.remove('hidden');
  render();
}

