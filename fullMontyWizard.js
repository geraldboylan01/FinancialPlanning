// Full Monty all-in-one wizard
// This file implements a small step engine and a central data store that
// feeds the existing calculators (FY Money Calculator, Pension Projection
// and Personal Balance Sheet).

import { animate, addKeyboardNav } from './wizardCore.js';
import { currencyInput, percentInput, numFromInput, clampPercent } from './ui-inputs.js';
import { renderStepPensionRisk } from './stepPensionRisk.js';
import { MAX_SALARY_CAP, sftForYear } from './shared/assumptions.js';

// === UI mode controller: 'wizard' | 'results' ===
function setUIMode(mode) {
  const body = document.body;
  if (!body) return;

  // Remove any previous value and set new one
  body.removeAttribute('data-ui-mode');
  if (mode === 'results') body.setAttribute('data-ui-mode', 'results');

  // Also reflect visibility explicitly as a safety net
  const fab = document.getElementById('editInputsFab');
  if (fab) {
    const shouldShow = mode === 'results';
    // never use 'hidden' attr because CSS already governs display
    fab.classList.toggle('is-visible', shouldShow); // optional utility class
    // ensure inline display isn't forced elsewhere
    fab.style.removeProperty('display');
    fab.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    fab.tabIndex = shouldShow ? 0 : -1;
  }

  // Show/hide wizard modal
  const modal = document.getElementById('fullMontyModal');
  if (modal) {
    modal.classList.toggle('is-open', mode === 'wizard');
  }

  body.classList.toggle('modal-open', mode === 'wizard');
}
window.setUIMode = setUIMode; // expose for other modules if needed

document.addEventListener('click', (e) => {
  const btn = e.target && typeof e.target.closest === 'function'
    ? e.target.closest('#editInputsFab')
    : null;
  if (!btn) return;
  e.preventDefault();
  setUIMode('wizard');
  openFullMontyWizard();
});

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

let _salaryEvtBound = false;

function toNumber(v) {
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Revenue age bands (personal contributions only)
const IRL_AGE_BANDS = [
  { min: 0,  max: 29, pct: 15 },
  { min: 30, max: 39, pct: 20 },
  { min: 40, max: 49, pct: 25 },
  { min: 50, max: 54, pct: 30 },
  { min: 55, max: 59, pct: 35 },
  { min: 60, max: 200, pct: 40 }
];

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
  personalContribSelfAnnual: null,
  personalPctSelf: null,
  employerContribSelf: null,
  employerContribSelfAnnual: null,
  employerPctSelf: null,
  hasDbSelf: false,
  dbPensionSelf: null,
  dbStartAgeSelf: null,
  statePensionSelf: false,

  currentPensionValuePartner: 0,
  personalContribPartner: null,
  personalContribPartnerAnnual: null,
  personalPctPartner: null,
  employerContribPartner: null,
  employerContribPartnerAnnual: null,
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


function formGroup(id, labelText, inputEl) {
  const g = document.createElement('div');
  g.className = 'form-group';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = labelText;

  // set id on wrapper
  inputEl.id = id;
  // set id on the actual field if present
  const inner = inputEl.querySelector?.('input, select, textarea');
  if (inner) inner.id = id;

  g.append(lab, inputEl);
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

function bindStepPensions(root, store){
  const salarySelf = () => Number(store.grossIncome || store.salary || 0);
  const salaryPartner = () => Number(store.grossIncomePartner || 0);

  // Self selectors (existing)
  const userPctEl = root.querySelector('#userContribPct');
  const empPctEl  = root.querySelector('#employerContribPct');
  const userMoEl  = root.querySelector('#userContribPerMonth');
  const userYrEl  = root.querySelector('#userContribPerYear');
  const empMoEl   = root.querySelector('#employerContribPerMonth');
  const empYrEl   = root.querySelector('#employerContribPerYear');

  // NEW: pot fields
  const potSelfEl    = root.querySelector('#currentPensionValue');
  const potPartnerEl = root.querySelector('#currentPensionValuePartner');

  // Partner selectors (optional, present only if hasPartner)
  const userPctPartnerEl = root.querySelector('#userContribPctPartner');
  const empPctPartnerEl  = root.querySelector('#employerContribPctPartner');
  const userMoPartnerEl  = root.querySelector('#userContribPerMonthPartner');
  const userYrPartnerEl  = root.querySelector('#userContribPerYearPartner');
  const empMoPartnerEl   = root.querySelector('#employerContribPerMonthPartner');
  const empYrPartnerEl   = root.querySelector('#employerContribPerYearPartner');

  try {
    if (userPctEl)        percentInput(userPctEl, { clamp: true });
    if (empPctEl)         percentInput(empPctEl,  { clamp: true });
    if (userPctPartnerEl) percentInput(userPctPartnerEl, { clamp: true });
    if (empPctPartnerEl)  percentInput(empPctPartnerEl,  { clamp: true });
  } catch(e) { /* no-op */ }

  const fmt = (n) => (!isFinite(n) || n === 0)
    ? '—'
    : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  const euroFromPct = (annualSalary, pct) => {
    const p = Number(pct) || 0;
    const yearly = (Number(annualSalary) || 0) * (p / 100);
    const monthly = yearly / 12;
    return { monthly, yearly };
  };

  // ---- Seed current pots from store & persist on change ----
  if (potSelfEl) {
    if (store.currentPensionValueSelf != null) potSelfEl.value = store.currentPensionValueSelf;
    potSelfEl.addEventListener('input', () => {
      setStore({ currentPensionValueSelf: numFromInput(potSelfEl) || 0 });
    });
  }
  if (potPartnerEl) {
    if (store.currentPensionValuePartner != null) potPartnerEl.value = store.currentPensionValuePartner;
    potPartnerEl.addEventListener('input', () => {
      setStore({ currentPensionValuePartner: numFromInput(potPartnerEl) || 0 });
    });
  }

  // ---- Self % → € bindings ----
  function renderUserSelf(){
    if (!userPctEl) return;
    const { monthly, yearly } = euroFromPct(salarySelf(), userPctEl.value);
    if (userMoEl) userMoEl.textContent = fmt(monthly);
    if (userYrEl) userYrEl.textContent = fmt(yearly);
    setStore({
      personalPctSelf: Number(userPctEl.value) || 0,
      // UI convenience (€/mo)
      personalContribSelf: monthly,
      // 🔑 Source of truth for math (€/yr)
      personalContribSelfAnnual: yearly
    });
  }
  function renderEmployerSelf(){
    if (!empPctEl) return;
    const { monthly, yearly } = euroFromPct(salarySelf(), empPctEl.value);
    if (empMoEl) empMoEl.textContent = fmt(monthly);
    if (empYrEl) empYrEl.textContent = fmt(yearly);
    setStore({
      employerPctSelf: Number(empPctEl.value) || 0,
      employerContribSelf: monthly,
      employerContribSelfAnnual: yearly
    });
  }

  // ---- Partner % → € bindings ----
  function renderUserPartner(){
    if (!userPctPartnerEl) return;
    const { monthly, yearly } = euroFromPct(salaryPartner(), userPctPartnerEl.value);
    if (userMoPartnerEl) userMoPartnerEl.textContent = fmt(monthly);
    if (userYrPartnerEl) userYrPartnerEl.textContent = fmt(yearly);
    setStore({
      personalPctPartner: Number(userPctPartnerEl.value) || 0,
      personalContribPartner: monthly,
      personalContribPartnerAnnual: yearly
    });
  }
  function renderEmployerPartner(){
    if (!empPctPartnerEl) return;
    const { monthly, yearly } = euroFromPct(salaryPartner(), empPctPartnerEl.value);
    if (empMoPartnerEl) empMoPartnerEl.textContent = fmt(monthly);
    if (empYrPartnerEl) empYrPartnerEl.textContent = fmt(yearly);
    setStore({
      employerPctPartner: Number(empPctPartnerEl.value) || 0,
      employerContribPartner: monthly,
      employerContribPartnerAnnual: yearly
    });
  }

  // Wire listeners
  if (userPctEl)        userPctEl.addEventListener('input', renderUserSelf);
  if (empPctEl)         empPctEl.addEventListener('input',  renderEmployerSelf);
  if (userPctPartnerEl) userPctPartnerEl.addEventListener('input', renderUserPartner);
  if (empPctPartnerEl)  empPctPartnerEl.addEventListener('input',  renderEmployerPartner);

  // Re-render on salary updates (bind once)
  if (!_salaryEvtBound) {
    document.addEventListener('fm-salary-updated', () => {
      renderUserSelf(); renderEmployerSelf(); renderUserPartner(); renderEmployerPartner();
    });
    _salaryEvtBound = true;
  }

  // Seed from store
  if (userPctEl && store.personalPctSelf != null) userPctEl.value = store.personalPctSelf;
  if (empPctEl  && store.employerPctSelf != null) empPctEl.value  = store.employerPctSelf;
  if (userPctPartnerEl && store.personalPctPartner != null) userPctPartnerEl.value = store.personalPctPartner;
  if (empPctPartnerEl  && store.employerPctPartner != null) empPctPartnerEl.value  = store.employerPctPartner;

  // Initial paint
  renderUserSelf(); renderEmployerSelf(); renderUserPartner(); renderEmployerPartner();
}

function renderStepPensions(cont){
  const tmpl = document.getElementById('tpl-step-pensions');
  if (!tmpl) return;
  cont.innerHTML = '';
  const frag = tmpl.content.cloneNode(true);

  // If a partner exists, append a mirror of the user blocks with Partner IDs
  if (fullMontyStore.hasPartner) {
    const step = document.createElement('section');
    step.className = 'wizard-step';
    step.setAttribute('data-step', '4-partner');

    step.innerHTML = `
      <h2 class="step-title">Partner – Pensions &amp; entitlements</h2>

      <!-- Partner current pension value -->
      <label for="currentPensionValuePartner" class="fm-label">Current pension value (partner)</label>
      <div id="currentPensionValuePartnerWrap" class="input-wrap prefix">
        <span>€</span>
        <input id="currentPensionValuePartner" name="currentPensionValuePartner" type="number" inputmode="decimal" placeholder="e.g. 20000" />
      </div>

      <!-- ===== Partner (employee) ===== -->
      <div class="contrib-group contrib-group--user card-like">
        <div class="contrib-head">
          <h3 class="contrib-title">Partner contribution</h3>
          <p class="contrib-sub">Enter % of salary — we calculate the € automatically.</p>
        </div>

        <label for="userContribPctPartner" class="fm-label">% of salary (partner)</label>
        <div class="input-row">
          <div id="userContribPctPartnerWrap" class="input-wrap suffix">
            <input id="userContribPctPartner" name="userContribPctPartner" type="number" inputmode="decimal" placeholder="e.g. 5" />
            <span>%</span>
          </div>

          <div class="result-chip" aria-live="polite" id="userContribEuroChipPartner" title="Auto-calculated from partner %">
            <div class="result-main">
              <span class="result-label">€ / mo</span>
              <span class="result-value" id="userContribPerMonthPartner">—</span>
            </div>
            <div class="result-sub">
              <span class="sub-label">€ / yr</span>
              <span class="sub-value" id="userContribPerYearPartner">—</span>
            </div>
          </div>
        </div>

        <div id="userPctCapNotePartner" class="cap-note" aria-live="polite" style="display:none;"></div>
      </div>

      <!-- ===== Employer (partner) ===== -->
      <div class="contrib-group contrib-group--employer card-like">
        <div class="contrib-head">
          <h3 class="contrib-title">Partner’s employer contribution</h3>
          <p class="contrib-sub">Enter % of salary — we calculate the € automatically.</p>
        </div>

        <label for="employerContribPctPartner" class="fm-label">% of salary (employer for partner)</label>
        <div class="input-row">
          <div id="employerContribPctPartnerWrap" class="input-wrap suffix">
            <input id="employerContribPctPartner" name="employerContribPctPartner" type="number" inputmode="decimal" placeholder="e.g. 5" />
            <span>%</span>
          </div>

          <div class="result-chip" aria-live="polite" id="employerContribEuroChipPartner" title="Auto-calculated from employer % (partner)">
            <div class="result-main">
              <span class="result-label">€ / mo</span>
              <span class="result-value" id="employerContribPerMonthPartner">—</span>
            </div>
            <div class="result-sub">
              <span class="sub-label">€ / yr</span>
              <span class="sub-value" id="employerContribPerYearPartner">—</span>
            </div>
          </div>
        </div>
      </div>
    `;

    frag.appendChild(step);
  }

  cont.appendChild(frag);
  bindStepPensions(cont, fullMontyStore);
}
renderStepPensions.validate = () => ({ ok: true, errors: {} });

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
  if (window.__destroyFmWizardUX) window.__destroyFmWizardUX();
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
        document.dispatchEvent(new CustomEvent('fm-salary-updated'));
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
      gross.querySelector('input').addEventListener('input', () => {
        setStore({ grossIncome: numFromInput(gross.querySelector('input')) });
        document.dispatchEvent(new CustomEvent('fm-salary-updated'));
      });
      form.appendChild(formGroup('grossIncome', 'Your gross annual income', gross));

      if (fullMontyStore.hasPartner) {
        const gp = currencyInput({ id: 'grossIncomePartner', value: fullMontyStore.grossIncomePartner ?? '' });
        gp.querySelector('input').addEventListener('input', () => {
          setStore({ grossIncomePartner: numFromInput(gp.querySelector('input')) });
          document.dispatchEvent(new CustomEvent('fm-salary-updated'));
        });
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
    render: renderStepPensions,
    validate: renderStepPensions.validate
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
  // ----- Household combined income for retirement target -----
  const combinedIncome =
    (Number(fullMontyStore.grossIncome) || 0) +
    (fullMontyStore.hasPartner ? (Number(fullMontyStore.grossIncomePartner) || 0) : 0);

  const annSelfPersonal = Number(fullMontyStore.personalContribSelfAnnual || 0)
    || Number(fullMontyStore.personalContribSelf || 0) * 12;
  const annSelfEmployer = Number(fullMontyStore.employerContribSelfAnnual || 0)
    || Number(fullMontyStore.employerContribSelf || 0) * 12;
  const annPartPersonal = Number(fullMontyStore.personalContribPartnerAnnual || 0)
    || Number(fullMontyStore.personalContribPartner || 0) * 12;
  const annPartEmployer = Number(fullMontyStore.employerContribPartnerAnnual || 0)
    || Number(fullMontyStore.employerContribPartner || 0) * 12;

  const pensionArgs = {
    // Self
    salary: Math.min(fullMontyStore.grossIncome || 0, MAX_SALARY_CAP),
    currentValue: fullMontyStore.currentPensionValueSelf || 0,
    personalPct: fullMontyStore.personalPctSelf,
    employerPct: fullMontyStore.employerPctSelf,
    dob: fullMontyStore.dobSelf,
    retireAge: Math.max(50, Math.min(70, fullMontyStore.retireAge || 0)),
    growth: fullMontyStore.pensionGrowthRate || 0.05,
    pensionRisk: fullMontyStore.pensionRisk,
    sftAwareness: fullMontyStore.sftAwareness,

    // 🔑 Annual source of truth (these are €/yr)
    personalContrib: annSelfPersonal,
    employerContrib: annSelfEmployer,
    personalContribAnnual: annSelfPersonal,
    employerContribAnnual: annSelfEmployer,

    // Partner (new; optional)
    hasPartner: !!fullMontyStore.hasPartner,
    salaryPartner: Math.min(fullMontyStore.grossIncomePartner || 0, MAX_SALARY_CAP),
    currentValuePartner: fullMontyStore.currentPensionValuePartner || 0,
    personalPctPartner: fullMontyStore.personalPctPartner,
    employerPctPartner: fullMontyStore.employerPctPartner,
    dobPartner: fullMontyStore.dobPartner,

    // Partner annuals (handy if projector reads them later)
    personalContribPartnerAnnual: annPartPersonal,
    employerContribPartnerAnnual: annPartEmployer,

    // (optional hint to the projector)
    contributionUnit: 'annual'
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
    // IMPORTANT: the FY calculator should target % of HOUSEHOLD income
    grossIncome: combinedIncome,
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

    // Partner toggles & DB
    hasPartner: !!fullMontyStore.hasPartner,
    statePensionPartner: !!fullMontyStore.statePensionPartner,
    hasDbPartner: !!fullMontyStore.hasDbPartner,
    dbPensionPartner: fullMontyStore.dbPensionPartner || 0,
    dbStartAgePartner: fullMontyStore.dbStartAgePartner || null,

    // NEW: partner DC inputs
    currentPensionValueSelf: fullMontyStore.currentPensionValueSelf || 0,
    personalContribSelf: fullMontyStore.personalContribSelf || 0,
    employerContribSelf: fullMontyStore.employerContribSelf || 0,

    currentPensionValuePartner: fullMontyStore.currentPensionValuePartner || 0,
    personalContribPartner: fullMontyStore.personalContribPartner || 0,
    employerContribPartner: fullMontyStore.employerContribPartner || 0
  };
  document.dispatchEvent(new CustomEvent('fm-run-fy', { detail: fyArgs }));

  document.dispatchEvent(new CustomEvent('fm:wizard:final-submit', {
    detail: { rawFy: fyArgs, rawPension: pensionArgs }
  }));

  closeModal();
}

// ====== STATE & UTILITIES ======
let baselineSnapshot = null;   // captured first time results render
let baselinePersonalAnnual = 0;

// Track if user has changed contributions via the hero in this session.
// We use this to decide when to show the “Return to original” button.
let _heroContribNudged = false;
// Controls
let btnAdd100 = null;
let btnRemove100 = null;
let btnEarlier = null;
let btnLater = null;
let btnRevertContrib = null;
let updateHeroContribMeter = null;
let applyHeroAddBtnState = null;

// Bottom sheet
const sheet         = document.getElementById('sheetTaxRelief');
const sheetBackdrop = sheet?.querySelector('.sheet__backdrop');
const sheetClose    = sheet?.querySelector('[data-sheet-close]');
const sheetGoToMax  = document.getElementById('sheetGoToMax');
const sheetSeeLimit = document.getElementById('sheetSeeLimit');

// Anchors
const elMaxToggle       = document.getElementById('maxContribToggle');
const elTaxTable        = document.getElementById('maxTableSection');
const actionStack = [];        // { type: 'contrib'|'age', delta: number }

// Tap counters (since baseline). Keys: 'contrib+100','contrib-100','age+1','age-1'
const nudgeCounts = { 'contrib+100':0, 'contrib-100':0, 'age+1':0, 'age-1':0 };

const store = fullMontyStore;

// Allow the hero to nudge contributions / retirement age via the Wizard.
window.fmApplyNudge = function fmApplyNudge({ contribDelta = 0, ageDelta = 0 } = {}) {
  try {
    if (contribDelta) {
      // Use the safe path (handles % → € conversion correctly)
      increaseMonthlyContributionBy(contribDelta);
      // Mark that the hero has modified contributions in this session
      _heroContribNudged = true;
    }

    if (ageDelta) {
      const key = 'retireAge';
      const minAge = 50, maxAge = 75;
      const cur = Number(store[key] || 65);
      setStore({ [key]: Math.max(minAge, Math.min(maxAge, cur + ageDelta)) });
      actionStack.push({ type: 'age', delta: ageDelta });
      if (ageDelta > 0) nudgeCounts['age+1'] += ageDelta; else nudgeCounts['age-1'] += -ageDelta;
    }

    // Recompute is already invoked inside increaseMonthlyContributionBy;
    // for age-only changes we still need it:
    if (!contribDelta) recalcAll();
    refreshContribUX();
  } catch (e) {
    console.error('[Wizard] fmApplyNudge failed:', e);
  }
};

function recalcAll(){
  if (typeof recomputeAndRefreshUI === 'function') {
    recomputeAndRefreshUI();
  } else if (typeof runAll === 'function') {
    runAll();
  } else if (typeof computeResults === 'function') {
    computeResults(store);
    document.dispatchEvent(new CustomEvent('fm-run-pension', { detail: {} }));
  }
  refreshContribUX();
  updateContributionSummaryUI();
}

function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }

function announce(msg){
  const live = document.getElementById('resultsView');
  if (live) live.setAttribute('aria-label', msg); // quick SR announcement
}

function formatEUR(x){
  try{
    return new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(x)||0);
  }catch(e){ return `€${(Number(x)||0).toLocaleString()}`; }
}


function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
}

function renderSftAssumptionText() {
  const slot = document.getElementById('assumptionSftBody');
  if (!slot) return;

  slot.innerHTML = `
    <p>The SFT is the maximum pension you can build in Ireland before extra tax charges apply. If your pension is above this limit at retirement, the excess is taxed at 40%.</p>
    <p><strong>Current path:</strong> The SFT increases by €200,000 each year, rising from €2.0m in 2025 to €2.8m in 2029. For years after 2029, the Government has said it will link the SFT to wage inflation, but no figures are confirmed. In this tool, we conservatively hold the limit at €2.8m until official guidance is released.</p>
  `;
}

function formatEuro(n) {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `€${Math.round(n).toLocaleString()}`;
  }
}

// Smooth scroll utility
function smoothScrollTo(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getUserAge() {
  const dob = store.dobSelf || store.dob;
  if (!dob) return 0;
  return Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
}

function getUserGrossSalary() {
  return Number(store.grossIncome || store.salary || 0);
}

function getCurrentPersonalContribution() {
  return getCurrentMonthlyContrib() * 12;
}

function setCurrentPersonalContribution(val) {
  setCurrentMonthlyContrib(val / 12);
}

function setCurrentPersonalContributionAnnual(val) {
  setCurrentPersonalContribution(val);
}


const AGE_BANDS = [
  { minAge: 0, maxAge: 29, pct: 15 },
  { minAge: 30, maxAge: 39, pct: 20 },
  { minAge: 40, maxAge: 49, pct: 25 },
  { minAge: 50, maxAge: 54, pct: 30 },
  { minAge: 55, maxAge: 59, pct: 35 },
  { minAge: 60, maxAge: 200, pct: 40 }
];

function getAgeBandForAge(age) {
  return AGE_BANDS.find(b => age >= b.minAge && age <= b.maxAge);
}

// Returns the age-related max personal contribution for tax relief
function getAgeRelatedMaxForUser() {
  const age = getUserAge();
  const salary = getUserGrossSalary();
  const cappedSalary = Math.min(115000, salary || 0);
  const band = getAgeBandForAge(age);
  const pct = band?.pct || 0;
  return Math.round((cappedSalary * pct) / 100);
}

function show(el, on) {
  if (!el) return;
  el.hidden = !on;
}

// Show "Return to original" only after a contribution nudge from the hero
function hasDeviatedFromBaseline(){
  // Only show after the first hero nudge, and when we’re not already at the baseline.
  return _heroContribNudged && (Number(getCurrentPersonalContribution()) !== Number(baselinePersonalAnnual));
}

function updateContributionSummaryUI(){
  if (typeof updateHeroContribMeter === 'function') {
    updateHeroContribMeter();
  }
}

function refreshContribUX() {
  show(btnRevertContrib, hasDeviatedFromBaseline());
  updateContributionSummaryUI();
  if (typeof applyHeroAddBtnState === 'function') {
    applyHeroAddBtnState();
  }
}

function renderLegacyMaxContribToggle() {
  const host = document.getElementById('belowHeroControls');
  if (!host) return;

  // If Results already mounted the official toggle, don't double-render.
  if (host.querySelector('#maxContribsChk')) return;

  // Prefer the official renderer from fullMontyResults.js
  if (typeof window.renderMaxContributionToggle === 'function') {
    const node = window.renderMaxContributionToggle({
      useMaxContributions: !!getUseMaxContributions()
    });
    if (node) {
      host.appendChild(node);
      // Wire it to the global setter owned by Results.js
      const chk = host.querySelector('#maxContribsChk');
      if (chk) {
        chk.checked = !!getUseMaxContributions();
        chk.addEventListener('change', (e) => {
          if (typeof window.setUseMaxContributions === 'function') {
            window.setUseMaxContributions(!!e.target.checked);
          }
        });
      }
    }
    return;
  }

  // Fallback (should rarely be used). Uses simple label.
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'maxcontrib-toggle';
  wrap.innerHTML = `
      <label class="toggle-row" for="useMaxContribSwitch">
        <input id="useMaxContribSwitch" type="checkbox" />
        <span class="toggle-label">Maximise pension contributions</span>
      </label>
      <div class="toggle-note" id="maxToggleNote" aria-live="polite"></div>
    `;
  host.appendChild(wrap);
  const sw = wrap.querySelector('#useMaxContribSwitch');
  const note = wrap.querySelector('#maxToggleNote');
  sw.checked = !!getUseMaxContributions();
  if (sw.checked) {
    note.innerHTML = 'Using your age-band maximum (tax-relievable). <button class="btn-text-mini" id="viewMaxLimits" type="button">View limits</button>';
  }
  wrap.addEventListener('click', (e)=>{
    const btn = e.target.closest('#viewMaxLimits');
    if (!btn) return;
    document.getElementById('maxTableSection')?.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  sw.addEventListener('change', () => {
    if (typeof window.setUseMaxContributions === 'function') {
      window.setUseMaxContributions(sw.checked);
    } else {
      // very old fallback:
      setUseMaxContributions(sw.checked);
    }
    note.innerHTML = sw.checked
      ? 'Using your age-band maximum eligible for tax relief. <button class="btn-text-mini" id="viewMaxLimits" type="button">View limits</button>'
      : '';
  });
}

function openSheet() {
  if (!sheet) return;
  sheet.hidden = false;
  setTimeout(() => sheetClose?.focus(), 0);
}

function closeSheet() {
  if (!sheet) return;
  sheet.hidden = true;
}

sheetBackdrop?.addEventListener('click', closeSheet);
sheetClose?.addEventListener('click', closeSheet);

if (typeof sheetGoToMax !== 'undefined' && sheetGoToMax) {
  sheetGoToMax.textContent = 'Turn on Maximise';
  sheetGoToMax.addEventListener('click', () => {
    if (typeof closeSheet === 'function') closeSheet();
    if (typeof setUseMaxContributions === 'function') {
      setUseMaxContributions(true);
    }
    const sw = document.getElementById('useMaxContribSwitch');
    if (sw) sw.checked = true;
    recalcAll();
    if (elMaxToggle) elMaxToggle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof refreshContribUX === 'function') refreshContribUX();
  });
}

if (typeof sheetSeeLimit !== 'undefined' && sheetSeeLimit) {
  sheetSeeLimit.addEventListener('click', () => {
    if (typeof closeSheet === 'function') closeSheet();
    if (elTaxTable) elTaxTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.renderMaxContributionToggle !== 'function') {
    // Fallback only if Results hasn’t mounted its toggle yet
    renderLegacyMaxContribToggle();
  }
  if (typeof refreshContribUX === 'function') refreshContribUX();
});


// ----- Contribution accessors (align keys if needed) -----
const CONTRIB_KEYS = {
  monthlyEuro: ['personalContribSelf','personalMonthlyContribution','employeeContributionMonthly','contribMonthly'],
  annualEuro:  ['employeeContributionAnnual','contribAnnual'],
  percent:     ['personalPctSelf','employeeContributionPct','personalContributionPct'],
  maxMonthly:  ['maxContribMonthly','maxAllowedMonthlyContribution','taxRelievedMonthlyCap']
};
function firstKey(obj, keys){ return keys.find(k => Object.prototype.hasOwnProperty.call(obj, k)); }

function getCurrentMonthlyContrib(){
  const k = firstKey(store, CONTRIB_KEYS.monthlyEuro);
  let monthly = k ? Number(store[k] || 0) : 0;

  // If no explicit monthly value, derive it from percent of salary
  if (!monthly) {
    const pk = firstKey(store, CONTRIB_KEYS.percent);
    const salary = Number(store.grossIncome || store.salary || 0);
    if (pk && salary > 0) {
      const pct = Number(store[pk] || 0);
      if (isFinite(pct)) monthly = (salary * (pct / 100)) / 12;
    }
  }
  return Math.max(0, Number(monthly) || 0);
}
function setCurrentMonthlyContrib(val){
  const monthly = Math.max(0, Number(val) || 0);

  // Always write a concrete euro/month value
  let key = firstKey(store, CONTRIB_KEYS.monthlyEuro) || 'personalContribSelf';
  const patch = { [key]: monthly };

  // Clear % so the engine doesn't override with a percent-based value
  CONTRIB_KEYS.percent.forEach(pk => { if (pk in store) patch[pk] = null; });

  // 🔁 Keep the annual (source of truth) in sync for self
  patch.personalContribSelfAnnual = monthly * 12;

  setStore(patch);
  return true;
}
function getMaxMonthlyContrib(){
  const k = firstKey(store, CONTRIB_KEYS.maxMonthly);
  if (k) return Number(store[k]||0);
  if (typeof computeMaxTaxRelievedMonthly==='function') return computeMaxTaxRelievedMonthly(store);
  return Infinity;
}
function contributionsAtMax(){
  const cur = getCurrentMonthlyContrib(), max=getMaxMonthlyContrib();
  return (isFinite(max) && cur >= max - 1);
}

// ---------- Recompute + refresh ----------
function recomputeAndRefreshUI(){
  if (typeof runAll === 'function') runAll();
  else if (typeof computeResults==='function') computeResults(store);
  else if (typeof runPensionModel==='function') runPensionModel(store);

  try{ localStorage.setItem('planer_store', JSON.stringify(store)); }catch(e){}

  const view = document.getElementById('resultsView');
  if (view && typeof window.renderResults==='function') window.renderResults(view, store);

  if (typeof renderResultsCharts==='function') renderResultsCharts(store);
  else if (typeof updateCharts==='function') updateCharts(store);
  refreshContribUX();
}

function withBusy(btn, fn){
  if (!btn) return fn();
  btn.disabled = true; btn.classList.add('is-busy');
  Promise.resolve().then(fn).finally(()=>{ btn.disabled=false; btn.classList.remove('is-busy'); });
}

function getUseMaxContributions(){
  return !!store.useMaxContributions;
}

// Central setter for the "Use max contributions" scenario.
// Prefer the official setter from Results.js if present
function setUseMaxContributions(enabled){
  if (typeof window.setUseMaxContributions === 'function' && window.setUseMaxContributions !== setUseMaxContributions) {
    return window.setUseMaxContributions(!!enabled);
  }

  // Local fallback (kept for legacy; normally not used)
  store.useMaxContributions = !!enabled;

  if (typeof window !== 'undefined') {
    window.useMax = store.useMaxContributions;
    if (typeof setMaxToggle === 'function') setMaxToggle(store.useMaxContributions);
    if (typeof onMaxContribsToggleChanged === 'function') onMaxContribsToggleChanged(store.useMaxContributions);
  }

  recomputeAndRefreshUI();
  announce(enabled
    ? 'Maximise pension contributions is on.'
    : 'Maximise pension contributions is off.');
}

// Only publish the fallback if nothing else has registered yet.
if (typeof window.setUseMaxContributions !== 'function') {
  window.setUseMaxContributions = setUseMaxContributions;
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

// ====== ACTION HANDLERS ======
function increaseMonthlyContributionBy(deltaEuro){
  const cur = getCurrentMonthlyContrib();
  const max = getMaxMonthlyContrib();
  let next = cur + deltaEuro;
  if (isFinite(max) && next > max) next = max;
  if (next < 0) next = 0;

  setCurrentMonthlyContrib(next);

  const applied = next - cur;
  if (applied !== 0){
    actionStack.push({ type:'contrib', delta: applied });
    if (applied > 0) nudgeCounts['contrib+100'] += Math.round(applied/100);
    else             nudgeCounts['contrib-100'] += Math.round(Math.abs(applied)/100);
  }
  recomputeAndRefreshUI();
  updateContributionSummaryUI();
  refreshContribUX();
  if (contributionsAtMax()){
    announce('You have reached the maximum tax-relieved contribution for your current age.');
  } else {
    announce(`Contributions increased to ${formatEUR(next)} per month.`);
  }
}

function delayRetirementByYears(years){
  const key='retireAge';
  const minAge=50, maxAge=75;
  const from = Number(store[key] || 65);
  const to   = Math.max(minAge, Math.min(maxAge, from + years));
  if (to === from) return;

  setStore({ [key]: to });
  actionStack.push({ type:'age', delta: (to - from) });
  if (to - from > 0) nudgeCounts['age+1'] += (to - from);
  else               nudgeCounts['age-1'] += (from - to);

  recomputeAndRefreshUI();
  announce(`Retirement age set to ${to}.`);
}

function undoLast(){
  const last = actionStack.pop();
  if (!last) return;

  if (last.type==='contrib'){
    const cur = getCurrentMonthlyContrib();
    const next = Math.max(0, cur - last.delta);
    setCurrentMonthlyContrib(next);
    if (last.delta > 0) nudgeCounts['contrib+100'] -= Math.round(last.delta/100);
    else                nudgeCounts['contrib-100'] -= Math.round(Math.abs(last.delta)/100);
  } else if (last.type==='age'){
    const key='retireAge';
    setStore({ [key]: Number(store[key]||65) - last.delta });
    if (last.delta > 0) nudgeCounts['age+1'] -= last.delta;
    else                nudgeCounts['age-1'] -= -last.delta;
  }
  recomputeAndRefreshUI();
  updateContributionSummaryUI();
  announce('Last change undone.');
}

function restoreBaseline(){
  if (!baselineSnapshot) return;
  const mk = firstKey(store, CONTRIB_KEYS.monthlyEuro);
  const ak = firstKey(store, CONTRIB_KEYS.annualEuro);
  const pk = firstKey(store, CONTRIB_KEYS.percent);
  const patch = {};
  if (mk && baselineSnapshot[mk] !== undefined) patch[mk] = baselineSnapshot[mk];
  if (ak && baselineSnapshot[ak] !== undefined) patch[ak] = baselineSnapshot[ak];
  if (pk && baselineSnapshot[pk] !== undefined) patch[pk] = baselineSnapshot[pk];
  if (baselineSnapshot.retireAge !== undefined) patch.retireAge = baselineSnapshot.retireAge;
  setStore(patch);

  actionStack.length = 0;
  Object.keys(nudgeCounts).forEach(key => nudgeCounts[key]=0);
  setUseMaxContributions(baselineSnapshot.useMaxContributions);
  recomputeAndRefreshUI();
  updateContributionSummaryUI();
  announce('Inputs restored to your original values.');
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

export function renderResults(mountEl, storeRef = {}) {
  try {
    if (!mountEl) return;

    mountEl.innerHTML = '';

    // Take the true baseline from the Wizard store so we preserve original keys (% vs €) and age.
    if (!baselineSnapshot) {
      baselineSnapshot = deepClone(store); // was storeRef
      baselinePersonalAnnual = Math.round((getCurrentMonthlyContrib?.() || 0) * 12);
      _heroContribNudged = false;          // fresh session state in hero
    }

    const projected = Number(storeRef.projectedPotAtRetirement ?? storeRef.projectedPot ?? 0);
    const required  = Number(storeRef.financialFreedomTarget   ?? storeRef.fyTarget    ?? 0);
    const age       = Number(storeRef.desiredRetirementAge     ?? storeRef.retirementAge ?? storeRef.retireAge ?? 65);
    const retirementYear = Number(storeRef.retirementYear ?? storeRef.year ?? NaN);
    const useMaxOn = !!storeRef.useMaxContributions;
    if (typeof setMaxToggle === 'function') setMaxToggle(useMaxOn);
    if (typeof onMaxContribsToggleChanged === 'function') onMaxContribsToggleChanged(useMaxOn);
    const deficit   = Math.max(required - projected, 0);
    const partnerIncluded = !!(storeRef.partnerDOB || storeRef.partnerIncluded || storeRef.hasPartner);
    const projSelf    = Number(storeRef.projValueSelf ?? storeRef.projectedPotSelf ?? 0);
    const projPartner = Number(storeRef.projValuePartner ?? storeRef.projectedPotPartner ?? 0);

    const recommendMoreContribs = deficit > 0;

    const atMaxContrib = (() => {
      const mk = firstKey(storeRef, CONTRIB_KEYS.monthlyEuro);
      let cur = mk ? Number(storeRef[mk] || 0) : 0;
      const ak = firstKey(storeRef, CONTRIB_KEYS.annualEuro);
      if (!mk && ak) cur = Number(storeRef[ak] || 0) / 12;
      const mxk = firstKey(storeRef, CONTRIB_KEYS.maxMonthly);
      let max = mxk ? Number(storeRef[mxk] || 0) : Infinity;
      if (!mxk && typeof computeMaxTaxRelievedMonthly === 'function') {
        max = computeMaxTaxRelievedMonthly(storeRef);
      }
      return (isFinite(max) && cur >= max - 1);
    })();

    const hero = document.createElement('section');
    hero.className = 'results-hero fullscreen-hero reveal';

    const prefix = document.createElement('p');
    prefix.className = 'hero-headline-text';
    prefix.textContent = 'You are';

    // Big headline number
    const num  = document.createElement('h2');
    num.className = 'hero-number';

    if (deficit > 0) {
      num.textContent = formatEUR(deficit);
      num.classList.add('shortfall');
    } else {
      const surplusValue = required > 0 ? (projected - required) : projected;
      num.textContent = formatEUR(surplusValue);
      num.classList.add('surplus');
    }

    const line = document.createElement('p');
    line.className = 'hero-headline-text';
    line.textContent = deficit ? 'below your retirement needs' : 'above your retirement needs';
    hero.appendChild(prefix);
    hero.appendChild(num);
    hero.appendChild(line);

    const pensionLabel   = partnerIncluded ? 'your combined projected pensions are' : 'your projected pension is';
    const lifestyleLabel = partnerIncluded ? 'your household’s desired lifestyle'   : 'your desired lifestyle';
    const sub = document.createElement('p'); sub.className='hero-sub';
    sub.textContent = `At age ${age}, ${pensionLabel} ${formatEUR(projected)}. To sustain ${lifestyleLabel} in retirement, we estimate you’ll need ${formatEUR(required)}.`;
    hero.appendChild(sub);

    const chips = document.createElement('div'); chips.className='metrics-chips';
    chips.appendChild(makeMetricChip('Your pension', formatEUR(projected)));
    chips.appendChild(makeMetricChip('Required',     formatEUR(required)));
    hero.appendChild(chips);

    // ===== Person-level SFT checks (no naive doubling) =====
    const sftPerPerson = Number.isFinite(retirementYear) ? sftForYear(retirementYear) : null;

    if (sftPerPerson) {
      // Determine who breaches their own SFT
      const selfOver    = projSelf > sftPerPerson;
      const partnerOver = partnerIncluded && (projPartner > sftPerPerson);

      // Helper to format an overage amount as €X
      const overAmt = (val) => formatEUR(Math.max(0, (val - sftPerPerson)));

      if (selfOver || partnerOver) {
        // Build a single chip that names exactly who breaches
        const warn = document.createElement('div');
        warn.className = 'hero-sft-chip';
        warn.setAttribute('role','note');

        if (selfOver && partnerOver) {
          warn.innerHTML = `
            <span class="icon" aria-hidden="true">⚠️</span>
            <b>Both</b> your pension (<b>${overAmt(projSelf)}</b> over) <b>and</b> your partner’s pension (<b>${overAmt(projPartner)}</b> over) are projected to exceed the Standard Fund Threshold (SFT). <button class="link-btn" type="button" id="sftInfoBtn">What’s this?</button>
          `;
        } else if (selfOver) {
          warn.innerHTML = `
            <span class="icon" aria-hidden="true">⚠️</span>
            <b>Your</b> pension is projected to exceed the SFT by <b>${overAmt(projSelf)}</b>. <button class="link-btn" type="button" id="sftInfoBtn">What’s this?</button>
          `;
        } else {
          warn.innerHTML = `
            <span class="icon" aria-hidden="true">⚠️</span>
            <b>Your partner’s</b> pension is projected to exceed the SFT by <b>${overAmt(projPartner)}</b>. <button class="link-btn" type="button" id="sftInfoBtn">What’s this?</button>
          `;
        }

        hero.appendChild(warn);
        warn.querySelector('#sftInfoBtn')?.addEventListener('click', () => {
          document.getElementById('compliance-notices')?.scrollIntoView({ behavior:'smooth', block:'start' });
        });
      }

    }

    const parts = [];
    if (nudgeCounts['contrib+100']>0 || nudgeCounts['contrib-100']>0){
      const net = (nudgeCounts['contrib+100'] - nudgeCounts['contrib-100']) * 100;
      if (net !== 0) parts.push(`${net>0?'+':''}${formatEUR(net)}/mo contributions`);
    }
    if (nudgeCounts['age+1']>0 || nudgeCounts['age-1']>0){
      const netY = nudgeCounts['age+1'] - nudgeCounts['age-1'];
      if (netY !== 0) parts.push(`${netY>0?'+':''}${netY} yr${Math.abs(netY)===1?'':'s'} to retirement age`);
    }
    if (parts.length){
      const cs = document.createElement('p');
      cs.className = 'change-summary';
      cs.textContent = `Changes: ${parts.join(', ')}`;
      hero.appendChild(cs);
    }

    // === Controls + summary ===
    const controls = document.createElement('div');

    // Contribution nudges + meter
    const contribControls = document.createElement('div');

    const contribNudgers = document.createElement('div');
    contribNudgers.id = 'contribNudgers';
    contribNudgers.className = 'cta-stack';

    btnAdd100 = document.createElement('button');
    btnAdd100.id = 'btnAdd100';
    btnAdd100.type = 'button';
    btnAdd100.className = 'pill';
    btnAdd100.textContent = '+ Add €100/mo';
    btnAdd100.setAttribute('data-increment', '+100');

    btnRemove100 = document.createElement('button');
    btnRemove100.id = 'btnRemove100';
    btnRemove100.type = 'button';
    btnRemove100.className = 'pill pill--neutral';
    btnRemove100.textContent = '– Remove €100/mo';
    btnRemove100.setAttribute('data-increment', '-100');

    contribNudgers.append(btnAdd100, btnRemove100);

    // Contribution meter (info chip not a button)
    const contribSummary = document.createElement('div');
    contribSummary.id = 'contribSummary';
    contribSummary.className = 'contrib-meter';
    contribSummary.setAttribute('aria-live','polite');
    const annualNow = Math.round((getCurrentMonthlyContrib?.() || 0) * 12);
    contribSummary.innerHTML = `
      <div class="label">Your contributions</div>
      <div class="value" id="contribSummaryValue">€${annualNow.toLocaleString()} /yr</div>
    `;

    contribControls.append(contribNudgers, contribSummary);

    /* Row 2: Return to original + age-band nudge */
    const row2 = document.createElement('div');
    row2.className = 'controls-row';

    btnRevertContrib = document.createElement('button');
    btnRevertContrib.id = 'btnRevertContrib';
    btnRevertContrib.type = 'button';
    btnRevertContrib.className = 'pill pill--ghost';
    btnRevertContrib.textContent = 'Return to original';
    btnRevertContrib.hidden = true;
    btnRevertContrib.addEventListener('click', () => {
      restoreBaseline();          // restores contribs (€, %), retireAge, and max-toggle
      _heroContribNudged = false; // hide the button again until the next hero change
      refreshContribUX();
    });

    row2.append(btnRevertContrib);

    /* Row 3: Retire earlier/later (equal width) */
    const row3 = document.createElement('div');
    row3.className = 'controls-row';

    btnEarlier = document.createElement('button');
    btnEarlier.id = 'btnRetireEarlier'; btnEarlier.type = 'button';
    btnEarlier.className = 'pill';
    btnEarlier.textContent = '⏪ Retire 1 yr earlier';
    btnEarlier.addEventListener('click', () => window.fmApplyNudge?.({ ageDelta: -1 }));

    btnLater = document.createElement('button');
    btnLater.id = 'btnRetireLater'; btnLater.type = 'button';
    btnLater.className = 'pill';
    btnLater.textContent = '⏩ Retire 1 yr later';
    btnLater.addEventListener('click', () => window.fmApplyNudge?.({ ageDelta: +1 }));

    row3.append(btnEarlier, btnLater);

    controls.append(contribControls, row2, row3);
    hero.appendChild(controls);

    // Safety: remove any old inline "Maximise" pill if it still exists
    const strayMaxBtn = hero.querySelector('#btnMaxInline, .btn-max-inline');
    if (strayMaxBtn) strayMaxBtn.remove();

    // 2) ADD BUTTON STATE + CAP NOTE
    function applyAddBtnState() {
      const atMax = contributionsAtMax?.() || atMaxContrib;

      btnAdd100.disabled = !!atMax;
      btnAdd100.classList.toggle('pill--cta',  recommendMoreContribs && !atMax);
      btnAdd100.classList.toggle('pill--neutral', !recommendMoreContribs || atMax);
      btnAdd100.classList.toggle('pill--disabled', !!atMax);

      // Cap note (simple hint under the Add button)
      let note = contribNudgers.querySelector('.cap-note');
      if (!note) {
        note = document.createElement('div');
        note.className = 'cap-note';
        note.innerHTML = `
      You’ve reached today’s tax-relievable limit.
      <button type="button" class="link-soft" id="goToMaxToggle">Maximise contributions</button>
    `;
        contribNudgers.insertBefore(note, btnRemove100);
        note.addEventListener('click', (e) => {
          const t = e.target;
          if (t && t.id === 'goToMaxToggle') {
            document.getElementById('maxContribToggle')?.scrollIntoView({ behavior:'smooth', block:'start' });
          }
        });
      }
      note.style.display = atMax ? '' : 'none';
    }

    // helper: keep the /yr value live
    function updateContribMeter(){
      const annual = Math.round((getCurrentMonthlyContrib?.() || 0) * 12);
      const v = contribControls.querySelector('#contribSummaryValue');
      if (v) v.textContent = '€' + annual.toLocaleString() + ' /yr';
    }

    // 3) RECOMMENDATION HIGHLIGHTS (delay later if shortfall)
    btnEarlier.classList.add('pill--neutral');
    btnLater.classList.add(recommendMoreContribs ? 'pill--cta' : 'pill--neutral');

    // Wire nudge buttons to refresh the meter & state immediately
    btnAdd100.addEventListener('click', () => {
      window.fmApplyNudge?.({ contribDelta: +100 });
      updateContribMeter(); applyAddBtnState();
    });
    btnRemove100.addEventListener('click', () => {
      window.fmApplyNudge?.({ contribDelta: -100 });
      updateContribMeter(); applyAddBtnState();
    });

    // expose for external refreshes
    updateHeroContribMeter = updateContribMeter;
    applyHeroAddBtnState = applyAddBtnState;

    // Initial state pass
    applyAddBtnState();
    updateContribMeter();

    mountEl.appendChild(hero);
    refreshContribUX();

    renderSftAssumptionText();

    window.dispatchEvent(new CustomEvent('fm:results:ready'));

    const revealHero = () => hero.classList.add('reveal--in');
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(revealHero);
    }
    setTimeout(revealHero, 200);
  } catch (e) {
    console.error('[FM Results] renderResults (hero) failed:', e);
  }
}

window.renderResults = renderResults;
window.dispatchEvent(new Event('fm-renderer-ready'));
// ───────────────────────────────────────────────────────────────
// Public API
// ----------------------------------------------------------------

export function openFullMontyWizard() {
  cur = 0;
  setUIMode('wizard');
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

window.navigateToInputs = openFullMontyWizard;
window.getUseMaxContributions = getUseMaxContributions;
window.getCurrentPersonalContribution = getCurrentPersonalContribution;
window.setCurrentPersonalContributionAnnual = setCurrentPersonalContributionAnnual;
// 🔧 Make the data getters visible to Results.js
window.getFullMontyData = () => getStore();
window.getStore = getStore;

