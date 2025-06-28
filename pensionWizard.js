// Wizard for pension projection tool
import { profile, saveProfile } from './profile.js';

const steps = [
  { id: 'dob', q: "What's your date of birth?", type: 'date' },
  { id: 'salary', q: 'Gross annual salary (€)?', type: 'number', min: 0 },
  { id: 'currentValue', q: 'Current pension value (€)?', type: 'number', min: 0 },
  {
    id: 'personalPair',
    q: 'Your annual contribution (€) or % of salary if no € amount',
    type: 'pair',
    fields: [
      { id: 'personalContrib', label: 'Your annual contribution (€)', type: 'number', min: 0, optional: true },
      { id: 'personalPct', label: 'or % of salary if no € amount', type: 'number', min: 0, max: 100, step: 0.1, optional: true }
    ]
  },
  {
    id: 'employerPair',
    q: 'Employer annual contribution (€) or % of salary if no € amount',
    type: 'pair',
    fields: [
      { id: 'employerContrib', label: 'Employer annual contribution (€)', type: 'number', min: 0, optional: true },
      { id: 'employerPct', label: 'or % of salary if no € amount', type: 'number', min: 0, max: 100, step: 0.1, optional: true }
    ]
  },
  { id: 'retireAge', q: 'Desired retirement age?', type: 'number', min: 50, max: 75 },
  { id: 'growth', q: 'Choose a growth profile', type: 'riskCard' }
];

const modal = document.getElementById('wizardModal');
const stepContainer = document.getElementById('wizardStepContainer');
const btnBack = document.getElementById('wizBack');
const btnNext = document.getElementById('wizNext');
const dots = document.getElementById('wizDots');
const progEl = document.getElementById('wizProgress');
let visibleSteps = [];
let cur = 0;

function btn(txt) {
  const b = document.createElement('button');
  b.textContent = txt;
  return b;
}

function refresh() {
  visibleSteps = steps; // no conditional visibility
}

function buildInput(step) {
  let input;
  if (step.type === 'boolean') {
    const ctr = document.createElement('div');
    const yes = btn('Yes'), no = btn('No');
    yes.onclick = () => { profile[step.id] = true; saveProfile(); next(); };
    no.onclick = () => { profile[step.id] = false; saveProfile(); next(); };
    ctr.append(yes, no);
    btnNext.style.visibility = 'hidden';
    input = ctr;
  } else if (step.type === 'riskCard') {
    const opts = [
      { val: 0.04, title: 'Low risk', desc: '≈ 30% stocks / 70% bonds<br>≈ 4% p.a.' },
      { val: 0.05, title: 'Balanced', desc: '≈ 50% stocks / 50% bonds<br>≈ 5% p.a.' },
      { val: 0.06, title: 'High risk', desc: '≈ 70% stocks / 30% bonds<br>≈ 6% p.a.' },
      { val: 0.07, title: 'Very-high', desc: '100% stocks<br>≈ 7% p.a.' }
    ];
    const wrap = document.createElement('div');
    wrap.className = 'risk-options';
    opts.forEach(o => {
      const card = document.createElement('div');
      card.className = 'risk-card';
      card.innerHTML = `<span class="risk-title">${o.title}</span>` +
                       `<span class="risk-desc">${o.desc}</span>`;
      card.onclick = () => {
        wrap.querySelectorAll('.risk-card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        profile.growth = o.val; saveProfile(); btnNext.disabled = false;
      };
      if (profile.growth === o.val) card.classList.add('selected');
      wrap.appendChild(card);
    });
    btnNext.style.visibility = 'visible';
    btnNext.disabled = !profile.growth;
    input = wrap;
  } else if (step.type === 'pair') {
    const wrap = document.createElement('div');
    const inputs = [];
    step.fields.forEach(f => {
      const label = document.createElement('label');
      label.textContent = f.label;
      label.htmlFor = `wiz-${f.id}`;
      const inp = document.createElement('input');
      inp.id = `wiz-${f.id}`;
      inp.type = f.type || 'number';
      if (f.min != null) inp.min = f.min;
      if (f.max != null) inp.max = f.max;
      if (f.step != null) inp.step = f.step;
      inp.value = profile[f.id] ?? '';
      wrap.appendChild(label);
      wrap.appendChild(inp);
      inputs.push(inp);
    });
    const error = document.createElement('div');
    error.className = 'error';
    error.style.display = 'none';
    wrap.appendChild(error);
    btnNext.style.visibility = 'visible';
    const update = () => {
      const filled = inputs.filter(i => i.value !== '');
      if (filled.length > 1) {
        error.textContent = 'Please fill in only one of these fields.';
        error.style.display = 'block';
        btnNext.disabled = true;
      } else {
        error.style.display = 'none';
        btnNext.disabled = false;
      }
    };
    inputs.forEach(inp => inp.addEventListener('input', update));
    update();
    input = wrap;
  } else {
    btnNext.style.visibility = 'visible';
    if (step.type === 'number' || step.type === 'date') {
      input = document.createElement('input');
      input.type = step.type;
      if (step.min != null) input.min = step.min;
      if (step.max != null) input.max = step.max;
      if (step.step != null) input.step = step.step;
      input.value = profile[step.id] ?? '';
    }
  }
  if (step.type !== 'pair') input.id = 'wizInput';
  return input;
}

function render() {
  refresh();
  if (cur < 0) cur = 0;
  if (cur >= visibleSteps.length) { finalize(); return; }
  const step = visibleSteps[cur];
  progEl.textContent = `Step ${cur + 1} of ${visibleSteps.length}`;
  stepContainer.innerHTML = '';
  const q = document.createElement('p');
  q.textContent = step.q;
  stepContainer.appendChild(q);
  stepContainer.appendChild(buildInput(step));
  btnBack.style.display = cur === 0 ? 'none' : '';
  btnNext.textContent = cur === visibleSteps.length - 1 ? 'Submit' : 'Next';
  dots.innerHTML = visibleSteps.map((_, i) => `<span class="dot${i === cur ? ' active' : ''}"></span>`).join('');
}

function getValue(step) {
  if (step.type === 'pair') {
    const vals = {};
    step.fields.forEach(f => {
      const el = document.getElementById(`wiz-${f.id}`);
      vals[f.id] = el && el.value ? +el.value : '';
    });
    return vals;
  }
  const el = document.getElementById('wizInput');
  if (step.type === 'boolean') return profile[step.id] ?? null;
  if (step.type === 'riskCard') return profile[step.id];
  if (step.type === 'number') return el.value ? +el.value : '';
  return el.value;
}

function valid(step, val) {
  if (step.type === 'pair') {
    const filled = step.fields.filter(f => {
      const v = val[f.id];
      return v !== '' && v !== null;
    });
    if (filled.length > 1) return false;
    return step.fields.every(f => {
      const v = val[f.id];
      if (f.optional && (v === '' || v === null)) return true;
      if (f.type === 'number') {
        if (v === '' || isNaN(v)) return false;
        if (f.min != null && v < f.min) return false;
        if (f.max != null && v > f.max) return false;
      } else if (f.type === 'date') {
        if (!v) return false;
      }
      return true;
    });
  }
  if (step.optional && (val === null || val === '')) return true;
  if (step.type === 'number') {
    if (val === '' || isNaN(val)) return false;
    if (step.min != null && val < step.min) return false;
    if (step.max != null && val > step.max) return false;
  } else if (step.type === 'date') {
    if (!val) return false;
  } else if (step.type === 'boolean') {
    if (val === null) return false;
  }
  return true;
}

function next() {
  refresh();
  const step = visibleSteps[cur];
  const val = step.type === 'boolean' ? profile[step.id] : getValue(step);
  if (!valid(step, val)) return;
  if (step.type === 'pair') {
    step.fields.forEach(f => { profile[f.id] = val[f.id]; });
    saveProfile();
  } else if (step.type !== 'riskCard') {
    profile[step.id] = val; saveProfile();
  }
  // riskCard value already stored on selection
  cur++; render();
}

function back() { cur--; render(); }

btnNext.onclick = next;
btnBack.onclick = back;

function copyToForm() {
  steps.forEach(s => {
    if (s.type === 'pair') {
      s.fields.forEach(f => {
        const field = document.getElementById(f.id);
        if (!field) return;
        const val = profile[f.id];
        field.value = val ?? '';
      });
    } else if (s.type === 'riskCard') {
      const val = profile[s.id];
      if (val == null) return;
      const field = document.querySelector(`input[name="${s.id}"][value="${val}"]`);
      if (field) field.checked = true;
    } else {
      const field = document.getElementById(s.id);
      if (!field) return;
      const val = profile[s.id];
      field.value = val ?? '';
    }
  });
}

function finalize() {
  modal.classList.add('hidden');
  copyToForm();
  document.getElementById('proj-form').requestSubmit();
}

export const wizard = { open(id) { refresh(); cur = id ? steps.findIndex(s => s.id === id) : 0; if (cur < 0) cur = 0; modal.classList.remove('hidden'); render(); } };
window.wizard = wizard;

document.addEventListener('DOMContentLoaded', () => wizard.open());
