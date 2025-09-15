// fullMontyResults.js
import { fyRequiredPot } from './shared/fyRequiredPot.js';
import { sftForYear, CPI, STATE_PENSION, SP_START, MAX_SALARY_CAP } from './shared/assumptions.js';
import { buildWarningsHTML } from './shared/warnings.js';

const AGE_BANDS = [
  { max: 29,  pct: 0.15 },
  { max: 39,  pct: 0.20 },
  { max: 49,  pct: 0.25 },
  { max: 54,  pct: 0.30 },
  { max: 59,  pct: 0.35 },
  { max: 120, pct: 0.40 }
];

let lastPensionOutput = null;
let lastFYOutput = null;
let lastWizard = {};
let useMax = false;

// --- Restore-to-original visibility control (simple, single button) ---
let _userHasAdjusted = false; // set true only by tweak actions (not by Max toggle)

// Prefer the hero-injected restore button (inside #resultsView)
function getRestoreBtn() {
  return document.querySelector('#resultsView #btnRestoreOriginal')
      || document.getElementById('btnRestoreOriginal');
}

function setRestoreVisible(show) {
  const btn = getRestoreBtn();
  if (!btn) return;
  if (show) {
    btn.hidden = false;
    btn.setAttribute('aria-hidden', 'false');
    btn.style.display = ''; // allow CSS to lay it out
    btn.tabIndex = 0;
  } else {
    btn.hidden = true;
    btn.setAttribute('aria-hidden', 'true');
    btn.style.display = 'none'; // belt & braces
    btn.tabIndex = -1;
  }
}

function updateRestoreVisibility() {
  // Show ONLY if user tweaked AND Max toggle is OFF
  const show = !!_userHasAdjusted && !useMax;
  setRestoreVisible(show);
}

function markAdjustedByTweaks() {
  _userHasAdjusted = true;
  updateRestoreVisibility();
}

function clearAdjustedState() {
  _userHasAdjusted = false;
  updateRestoreVisibility();
}

function bindRestoreButtonClick(){
  // Ensure hidden to start (if it exists at this moment)
  setRestoreVisible(false);

  // Delegated handler so we don't care when the hero button is injected
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('#btnRestoreOriginal') : null;
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    // Reset tweak state (back to baseline)
    resetHeroNudges();
    clearAdjustedState();

    // Optional project-wide reset hook (if present)
    if (typeof window.resetContributionEdits === 'function') {
      try { window.resetContributionEdits(); } catch {}
    }

    // Immediately hide the button (we're now at baseline)
    setRestoreVisible(false);
  }, { passive: false });
}

// --- Hero nudge state (session-scoped) ---
let heroNetSteps = 0;         // +1 per "+100" tap, -1 per "remove"
let heroBaseMonthly = null;   // derived from results on first mount
let heroCapMonthly  = null;   // age-band cap monthly
const HERO_KEY = () => `FM_HERO_STEPS_${(window.FullMonty?.sessionId || 'default')}`;

function saveHeroState(){
  try { sessionStorage.setItem(HERO_KEY(), JSON.stringify({ heroNetSteps })); } catch {}
}
function loadHeroState(){
  try {
    const s = JSON.parse(sessionStorage.getItem(HERO_KEY())||'{}');
    heroNetSteps = Number.isFinite(+s.heroNetSteps) ? +s.heroNetSteps : 0;
  } catch { heroNetSteps = 0; }
}

function currentAgeFromBalances(){
  const b = lastPensionOutput?.balances;
  return Array.isArray(b) && b.length ? b[0].age : null;
}

function deriveHeroBaseMonthly(){
  // Use first year of base contributions (FM flow currently personal-only)
  const base = lastPensionOutput?.contribsBase;
  heroBaseMonthly = (Array.isArray(base) && base.length) ? Math.round((base[0]||0)/12) : 0;
}

function computeMonthlyCap(){
  const dob = lastWizard?.dob ? new Date(lastWizard.dob) : null;
  const ageNow = dob ? Math.floor(yrDiff(dob, new Date())) : (currentAgeFromBalances() || 0);
  const pct = maxPctForAge(ageNow);
  const capAnnual = Math.min(+lastWizard?.salary || 0, MAX_SALARY_CAP) * pct;
  heroCapMonthly = Math.round(capAnnual/12);
}

function heroNetMonthly(){
  if (heroBaseMonthly == null) deriveHeroBaseMonthly();
  return Math.max(0, (heroBaseMonthly || 0) + heroNetSteps * 100);
}

let _heroRenderScheduled = false;
function haveAllResults(){ return !!(lastPensionOutput && lastFYOutput); }

function scheduleHeroRender(){
  if (!haveAllResults()) return;
  if (_heroRenderScheduled) return;
  _heroRenderScheduled = true;
  requestAnimationFrame(() => {
    _heroRenderScheduled = false;
    renderHeroNowOrQueue();
  });
}

let growthChart = null;
let contribChart = null;
let ddBalanceChart = null;
let retirementIncomeChart = null;

const fmtEuro = n => '€' + (Math.round(n||0)).toLocaleString();
const yrDiff = (d, ref = new Date()) => (ref - d) / (1000*60*60*24*365.25);
const maxPctForAge = age => AGE_BANDS.find(b => age <= b.max)?.pct ?? 0.15;

// ===== Color constants (dark-theme friendly, colorblind-aware) =====
const COLORS = {
  pensionCurrent: { fill: 'rgba(0,230,118,0.95)', border: '#00E676' }, // green
  pensionMax:     { fill: 'rgba(47,128,255,0.95)', border: '#2F80FF' }, // blue
  otherIncome:    { fill: 'rgba(178,107,255,0.95)', border: '#B26BFF' }, // violet
  needLine:       '#FFFFFF'
};

function formatEUR(x){
  try { return new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(x); }
  catch(e){ return '€'+Math.round(+x||0).toLocaleString('en-IE'); }
}

function updateContributionSummaryUI(){
  const el = document.getElementById('contribSummaryVal');
  if (!el) return;

  // Prefer the wizard’s getter (returns €/yr). Fallback: compute locally.
  let annual = 0;
  if (typeof window.getCurrentPersonalContribution === 'function') {
    annual = Number(window.getCurrentPersonalContribution() || 0);
  } else if (typeof getCurrentMonthlyContrib === 'function') {
    annual = Number(getCurrentMonthlyContrib() || 0) * 12;
  }

  el.textContent = formatEUR(annual);
}

function ensureNoticesMount(){
  let el = document.getElementById('compliance-notices');
  if (el) return el;
  const postGrid = document.querySelector('#phase-post .phase-grid');
  if (!postGrid) return null;
  el = document.createElement('section');
  el.id = 'compliance-notices';
  el.className = 'notices-section';
  el.setAttribute('aria-label','Important notices');
  postGrid.insertAdjacentElement('afterend', el);
  return el;
}

function removeLegacySFTStatic() {
  // Prefer explicit IDs/classes if present
  document.querySelectorAll('#sftArticle, #sftAssumptions, .sft-static, .sft-assumptions-static')
    .forEach(el => el.remove());

  // Fallback: text-based removal for headings not inside our cards
  const heads = Array.from(document.querySelectorAll('h1,h2,h3'));
  heads
    .filter(h => /standard fund threshold/i.test(h.textContent) || /sft assumptions/i.test(h.textContent))
    .filter(h => !h.closest('.notice-card'))
    .map(h => h.closest('section') || h.parentElement)
    .forEach(el => {
      if (!el) return;
      if (el.id === 'compliance-notices' || el.closest('#compliance-notices')) return;
      el.remove();
    });
}

function projectedAtRetirementValue(){
  if (!lastPensionOutput) return null;
  if (useMax && Array.isArray(lastPensionOutput.maxBalances) && lastPensionOutput.maxBalances.length){
    return lastPensionOutput.maxBalances.at(-1)?.value ?? null;
  }
  if (Array.isArray(lastPensionOutput.balances) && lastPensionOutput.balances.length){
    return lastPensionOutput.balances.at(-1)?.value ?? null;
  }
  return lastPensionOutput.projValue ?? null;
}

function buildHeroPayload(){
  const projected = projectedAtRetirementValue();
  const fyReq     = lastFYOutput?.requiredPot;

  if (projected == null || fyReq == null) return null;

  return {
    projectedPotAtRetirement: projected,
    projectedPot: projected,
    fyTarget: fyReq,
    desiredRetirementAge: lastWizard?.retireAge,
    retirementAge: lastWizard?.retireAge,
    retirementYear: lastPensionOutput?.retirementYear ?? null,
    partnerIncluded: !!lastFYOutput?._inputs?.hasPartner,
    partnerDOB: lastFYOutput?._inputs?.partnerDob || null,
    useMaxContributions: !!useMax
  };
}

function renderHeroNowOrQueue(){
  const payload = buildHeroPayload();
  if (!payload) return;
  const mount = document.getElementById('resultsView');
  if (typeof window.renderResults === 'function'){
    window.renderResults(mount, payload);
    if (typeof window.setUIMode === 'function') {
      window.setUIMode('results');
    }
  } else {
    window.__pendingHeroPayload = payload;
  }
}

window.addEventListener('fm-renderer-ready', renderHeroNowOrQueue);
window.addEventListener('fm-renderer-ready', mountBelowHeroToggle);
window.addEventListener('fm-renderer-ready', () => {
  // On renderer readiness, we are at baseline → keep it hidden
  clearAdjustedState();  // hides button
  // If the renderer injected a fresh button node, ensure it's hidden now
  setRestoreVisible(false);
});
window.addEventListener('fm-renderer-ready', () => {
  deriveHeroBaseMonthly(); computeMonthlyCap(); updateTapBadges(); if (typeof refreshContribUX === 'function') refreshContribUX();
});

function renderComplianceNotices(container){
  const el = ensureNoticesMount() || container || document.getElementById('compliance-notices');
  if (!el) return;

  const projAtRet = projectedAtRetirementValue();
  const retireAge = lastWizard?.retireAge ?? null;
  const retirementYr = lastPensionOutput?.retirementYear ?? null;

  const sftLimit = (lastPensionOutput?.sftLimit != null)
    ? lastPensionOutput.sftLimit
    : (retirementYr != null ? sftForYear(retirementYr) : null);

  const fmWarnings = buildWarningsHTML(
    {
      retireAge,
      retirementYear: retirementYr,
      projectedValue: projAtRet,
      sftLimit
    },
    { variant: 'fullmonty' }
  );

  el.innerHTML = '';
  el.insertAdjacentHTML('beforeend', fmWarnings);
  document.querySelectorAll('.warning-block strong').forEach(s=>{
    if (s.textContent.trim() === 'Standard Fund Threshold (SFT) Assumptions') {
      s.closest('.warning-block')?.remove();
    }
  });

  // Ensure old static SFT sections are removed
  removeLegacySFTStatic();
}

// Public: update retirement income chart colors for max-toggle
function setRetirementIncomeColorsForToggle(isMaxOn) {
  const chart = retirementIncomeChart; // your Chart.js instance
  if (!chart) return;

  const n = chart.data.labels.length;

  const pension = chart.data.datasets.find(d =>
    d.key === 'pension_withdrawals' || /Pension withdrawals/i.test(d.label)
  );
  const other = chart.data.datasets.find(d =>
    d.key === 'other_income' || /Other income/i.test(d.label)
  );

  if (pension) {
    const c = isMaxOn ? COLORS.pensionMax : COLORS.pensionCurrent;
    const fill = Array(n).fill(c.fill);
    const border = Array(n).fill(c.border);
    pension.backgroundColor = fill;
    pension.borderColor = border;
    pension.hoverBackgroundColor = fill;
    pension.hoverBorderColor = border;
  }

  if (other) {
    const fill = Array(n).fill(COLORS.otherIncome.fill);
    const border = Array(n).fill(COLORS.otherIncome.border);
    other.backgroundColor = fill;
    other.borderColor = border;
    other.hoverBackgroundColor = fill;
    other.hoverBorderColor = border;
  }

  chart.update(); // full re-render so styles apply immediately
}
window.setRetirementIncomeColorsForToggle = setRetirementIncomeColorsForToggle;

function onMaxContribsToggleChanged(isOn){
  setRetirementIncomeColorsForToggle(isOn);
  if (typeof updateAssumptionChip === 'function') updateAssumptionChip(isOn);

  const note = document.getElementById('maxToggleNote');
  if (note){
    note.innerHTML = isOn
      ? 'Using your age-band maximum eligible for tax relief. <button class="btn-text-mini" id="viewMaxLimits" type="button">View limits</button>'
      : '';
  }
}
window.onMaxContribsToggleChanged = onMaxContribsToggleChanged;

function ensureMaxScenario() {
  if (!lastPensionOutput || lastPensionOutput.maxBalances) return; // already present

  // Need wizard inputs + a starting balance & timeline
  const salaryRaw   = +lastWizard.salary || +lastWizard.grossIncome || 0;
  const capSalary   = Math.min(salaryRaw, MAX_SALARY_CAP);
  const growth      = Number.isFinite(+lastWizard.growthRate) ? +lastWizard.growthRate
                     : (Number.isFinite(+lastPensionOutput.growth) ? +lastPensionOutput.growth : 0.05);

  // Derive ages/years from existing base series
  const base = lastPensionOutput.balances || [];
  if (!base.length) return;

  const startAge   = base[0].age;
  const endAge     = base.at(-1).age;
  const yearsToRet = Math.max(0, Math.round(endAge - startAge));
  let maxBal       = base[0].value;

  const maxBalances = [{ age: startAge, value: Math.round(maxBal) }];
  const contribsMax = [0];
  const growthMax   = [0];

  for (let y = 1; y <= yearsToRet; y++) {
    const ageNext     = startAge + y;
    const personalMax = maxPctForAge(ageNext) * capSalary;
    const before      = maxBal;
    // If you later add employer in FM, add it here:
    const employer = 0; // Full-Monty flow doesn’t capture employer yet
    maxBal = maxBal * (1 + growth) + personalMax + employer;

    contribsMax.push(Math.round(personalMax + employer));
    growthMax.push(Math.round(maxBal - before - (personalMax + employer)));
    maxBalances.push({ age: ageNext, value: Math.round(maxBal) });
  }

  lastPensionOutput.maxBalances = maxBalances;
  lastPensionOutput.contribsMax = contribsMax;
  lastPensionOutput.growthMax   = growthMax;
}

function setUseMaxContributions(on){
  useMax = !!on;

  if (useMax) ensureMaxScenario();

  try { window.onMaxContribsToggleChanged?.(useMax); } catch {}
  try { window.setMaxToggle?.(useMax); } catch {}
  try { updateAssumptionChip?.(useMax); } catch {}

  document.body.setAttribute('data-scenario', useMax ? 'max' : 'current');

  try { drawCharts(); } catch (e) { console.error('[FM Results] redraw after toggle failed', e); }
  try { scheduleHeroRender(); } catch {}

  // Reset hero nudges whenever scenario flips
  resetHeroNudges();

  // IMPORTANT: Maximise toggle should NOT show the restore.
  if (useMax) {
    setRestoreVisible(false);
  } else {
    updateRestoreVisibility();
  }
}
window.setUseMaxContributions = setUseMaxContributions;

function findHeroButtons(){
  // Prefer explicit data attributes if present
  const addBtn = document.querySelector('#resultsView [data-increment="+200"], #resultsView #btnAdd200') ||
                 Array.from(document.querySelectorAll('#resultsView button, #resultsView [role="button"]'))
                      .find(b => /add\s*€?\s*200/i.test(b.textContent||''));
  const remBtn = document.querySelector('#resultsView [data-increment="-200"], #resultsView #btnRemove200') ||
                 Array.from(document.querySelectorAll('#resultsView button, #resultsView [role="button"]'))
                      .find(b => /(remove|−|-)\s*€?\s*200/i.test(b.textContent||''));
  return { addBtn, remBtn };
}

function ensureBadge(el){
  if (!el) return null;
  let b = el.querySelector('.tap-badge');
  if (!b){
    b = document.createElement('span');
    b.className = 'tap-badge hidden';
    el.appendChild(b);
  }
  return b;
}

function updateTapBadges(){
  const { addBtn, remBtn } = findHeroButtons();
  const pos = heroNetSteps > 0;
  const neg = heroNetSteps < 0;

  const addBadge = ensureBadge(addBtn);
  const remBadge = ensureBadge(remBtn);

  if (addBadge){
    addBadge.textContent = `×${Math.abs(heroNetSteps)}`;
    addBadge.classList.toggle('hidden', !pos);
  }
  if (remBadge){
    remBadge.textContent = `×${Math.abs(heroNetSteps)}`;
    remBadge.classList.toggle('hidden', !neg);
  }
}

function applyStep(delta){
  // If Max is on, switch it off (the hero nudges are for "current" path)
  if (useMax) window.setUseMaxContributions?.(false);

  heroNetSteps = (heroNetSteps || 0) + (delta > 0 ? 1 : -1);
  saveHeroState();
  updateTapBadges();
  if (typeof refreshContribUX === 'function') refreshContribUX();
  // The hero buttons' own handlers will already trigger the recalcs.

  // Mark as user-driven tweak (shows restore unless Max is ON)
  markAdjustedByTweaks();
}

// Delegate clicks from the hero container (handles re-renders)
function bindHeroTapDelegation(){
  const root = document.getElementById('resultsView');
  if (!root) return;

  root.addEventListener('click', (e)=>{
    const btn = e.target && e.target.closest ? e.target.closest('button,[role="button"]') : null;
    if (!btn) return;

    // Prefer explicit data attributes if available on your buttons (e.g., data-increment="+100")
    const incAttr = btn.getAttribute('data-increment'); // "+100", "-200", etc.
    if (incAttr) {
      const v = parseInt(incAttr.trim().replace(/[^\-\d]/g,''), 10);
      if (Number.isFinite(v)) {
        applyStep(v);
        return;
      }
    }

    // Fallback: text match for add/reduce 100/200 (labels vary)
    const txt = (btn.textContent || '').toLowerCase();
    if (/\b(add|\+)\b.*(100|200)/.test(txt)) {
      applyStep(+100);
      return;
    }
    if (/\b(remove|reduce|−|-)\b.*(100|200)/.test(txt)) {
      applyStep(-100);
      return;
    }
  });
}

function bindYearAdjustmentDelegation(){
  const root = document.getElementById('resultsView');
  if (!root) return;

  root.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button,[role="button"]') : null;
    if (!btn) return;

    // If your renderer provides these data hooks, we catch them first:
    if (btn.matches('[data-action="delay-year"], [data-action="retire-later"], [data-year-delta="-1"], [data-year-delta="+1"], [data-role="retire-delay"], [data-role="retire-forward"]')) {
      markAdjustedByTweaks();
      return;
    }

    // Fallback text patterns (“Delay”, “Fast-forward”, “Retire later/sooner”, “±1 year”)
    const t = (btn.textContent || '').toLowerCase();
    if (/\b(delay|retire later|push back|\+1\s*year)\b/.test(t)) {
      markAdjustedByTweaks();
      return;
    }
    if (/\b(fast\s*forward|retire sooner|-1\s*year|bring forward)\b/.test(t)) {
      markAdjustedByTweaks();
      return;
    }
  });
}

function resetHeroNudges(){
  heroNetSteps = 0; saveHeroState(); updateTapBadges(); if (typeof refreshContribUX === 'function') refreshContribUX();
}

const $ = (s)=>document.querySelector(s);

console.debug('[FM Results] loaded');

function mountBelowHeroToggle(){
  const host = document.getElementById('belowHeroControls');
  if (!host || host.dataset.mounted === '1') return;

  // Build the original skinny toggle (this factory already exists in your file)
  const node = window.renderMaxContributionToggle
    ? window.renderMaxContributionToggle({ useMaxContributions: useMax })
    : null;

  if (!node) return;

  host.appendChild(node);
  host.dataset.mounted = '1';

  // Wire change event to the controller
  const chk = host.querySelector('#maxContribsChk');
  if (chk){
    chk.checked = !!useMax;
    chk.addEventListener('change', (e)=> setUseMaxContributions(e.target.checked));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Ensure the Max toggle gets mounted into #belowHeroControls
  mountBelowHeroToggle();

  // Reflect any initial Max state if checkbox exists (injected into #belowHeroControls)
  const chk = document.querySelector('#maxContribsChk');
  if (chk) {
    setUseMaxContributions(chk.checked);
  }

  loadHeroState();

  // Delegate clicks for add/reduce buttons rendered into #resultsView
  bindHeroTapDelegation();

  // Detect “Delay / Fast-forward” retirement year tweaks (in #resultsView)
  bindYearAdjustmentDelegation();

  bindRestoreButtonClick();    // bind once to the single button
  clearAdjustedState();        // hide restore on initial mount

  // Finish initial UI refreshes
  setTimeout(() => {
    deriveHeroBaseMonthly();
    computeMonthlyCap();
    updateTapBadges();
    if (typeof refreshContribUX === 'function') refreshContribUX();
    clearAdjustedState();
  }, 0);
});

function renderMaxContributionToggle(storeRef){
  const wrap = document.createElement('div');

  const label = document.createElement('label');
  label.className = 'toggle max-toggle toggle--max';
  label.id = 'maxContribsToggle';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.id = 'maxContribsChk';
  chk.checked = !!storeRef.useMaxContributions;
  useMax = !!storeRef.useMaxContributions;
  label.appendChild(chk);

  const track = document.createElement('span');
  track.className = 'track';
  const lab = document.createElement('span');
  lab.className = 'label';
  const txt = document.createElement('span');
  txt.className = 'toggle-text';
  // ✨ Simpler, friendlier label:
  txt.textContent = 'Maximise pension contributions';
  lab.appendChild(txt);
  const knob = document.createElement('span');
  knob.className = 'knob';
  track.appendChild(lab);
  track.appendChild(knob);
  label.appendChild(track);
  wrap.appendChild(label);

  // Slim “on” confirmation. Hidden when off.
  const note = document.createElement('div');
  note.id = 'maxToggleNote';
  note.className = 'toggle-note';
  note.setAttribute('aria-live','polite');
  note.textContent = chk.checked
    ? 'Using your age-band maximum (tax-relievable).'
    : '';
  wrap.appendChild(note);

  chk.addEventListener('change', (e) => {
    setUseMaxContributions(e.target.checked);
  });

  return wrap;
}
window.renderMaxContributionToggle = renderMaxContributionToggle;

function activeProjection() {
  if (!lastPensionOutput) return {};
  const show = useMax && lastPensionOutput.maxBalances;
  const labels = show ? lastPensionOutput.maxBalances : lastPensionOutput.balances || [];
  const valueAtRet = labels.at(-1)?.value || 0;
  return {
    show: !!show,
    labelsAges: labels.map(b => b.age),
    balances: labels.map(b => b.value),
    valueAtRet
  };
}

// Build other-income (SP, Rent, DB) at a given age using FY inputs
function incomeAtAgeBuilder({
  includeSP, includePartnerSP,
  partnerDob, rentAtRet, hasDbSelf, dbAnnualSelf, dbStartAgeSelf,
  hasDbPartner, dbAnnualPartner, dbStartAgePartner
}) {
  return (age, partnerAge, tFromRet) => {
    const infl = Math.pow(1 + CPI, tFromRet);
    const rent = rentAtRet * infl;
    const dbSelf    = (hasDbSelf    && age         >= (dbStartAgeSelf ?? Infinity))    ? (dbAnnualSelf    * infl) : 0;
    const dbPartner = (hasDbPartner && partnerAge  >= (dbStartAgePartner ?? Infinity)) ? (dbAnnualPartner * infl) : 0;

    let sp = 0;
    if (includeSP        && age        >= SP_START) sp += STATE_PENSION;
    if (includePartnerSP && partnerAge >= SP_START) sp += STATE_PENSION;

    return { rent, db: dbSelf + dbPartner, sp, otherTotal: rent + dbSelf + dbPartner + sp };
  };
}

// Core drawdown simulator (retirement → age 100)
function simulateDrawdown({
  startPot, retireAge, endAge,
  spendAtRet, rentAtRet,
  includeSP, includePartnerSP, partnerAgeAtRet,
  hasDbSelf, dbAnnualSelf, dbStartAgeSelf,
  hasDbPartner, dbAnnualPartner, dbStartAgePartner,
  growthRate
}) {
  const years = Math.max(0, Math.round(endAge - retireAge));
  const ages = Array.from({length: years + 1}, (_, i) => retireAge + i);

  const balances = [];
  const pensionDraw = [];
  const otherInc = [];
  const reqLine = [];

  let bal = startPot;
  const incomeAtAge = incomeAtAgeBuilder({
    includeSP, includePartnerSP, rentAtRet,
    hasDbSelf, dbAnnualSelf, dbStartAgeSelf,
    hasDbPartner, dbAnnualPartner, dbStartAgePartner
  });

  for (let i = 0; i <= years; i++) {
    const age = retireAge + i;
    const t = i;
    const partnerAge = partnerAgeAtRet != null ? (partnerAgeAtRet + t) : -Infinity;
    const infl = Math.pow(1 + CPI, t);

    const spend = spendAtRet * infl;
    const { otherTotal } = incomeAtAge(age, partnerAge, t);
    const draw = Math.max(0, spend - Math.min(otherTotal, spend));

    balances.push(Math.max(0, Math.round(bal)));
    reqLine.push(Math.round(spend));
    pensionDraw.push(Math.round(draw));
    otherInc.push(Math.round(Math.min(otherTotal, spend)));

    // grow then withdraw
    bal = bal * (1 + growthRate) - draw;
    if (bal < 0) bal = 0;
  }

  // depletion age (first age after start where closing balance hits 0)
  let depleteAge = null;
  for (let i = 1; i < balances.length; i++) {
    if (balances[i] === 0) { depleteAge = ages[i]; break; }
  }

  return { ages, balances, pensionDraw, otherInc, reqLine, depleteAge };
}


function drawCharts() {
  try {
    if (!lastPensionOutput || !lastFYOutput) return;
    setMaxToggle(useMax);
    const g = $('#growthChart'), c = $('#contribChart');
    if (!g || !c) { console.warn('[FM Results] canvases not found'); return; }

  const { retirementYear, contribsBase, growthBase, contribsMax, growthMax, sftLimit } = lastPensionOutput;
  const fy = lastFYOutput;

  const ap = activeProjection();
  const labels = ap.labelsAges.map(a => `Age ${a}`);
  const showMax = ap.show;

  const datasets = [
    {
      label: showMax ? 'Maximised contributions' : 'Your Projection',
      data: ap.balances,
      borderColor: showMax ? '#0099ff' : '#00ff88',
      backgroundColor: showMax ? 'rgba(0,153,255,0.10)' : 'rgba(0,255,136,0.15)',
      fill: true,
      tension: 0.25
    }
  ];

  if (fy.requiredPot && fy.requiredPot > 0) {
    datasets.push({
      label: `Required pension (${fmtEuro(fy.requiredPot)})`,
      data: labels.map(() => fy.requiredPot),
      borderColor: '#c000ff',
      borderDash: [6,6],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      order: 0
    });
  }
  const sft = sftLimit ?? sftForYear(retirementYear);
  datasets.push({
    label: `SFT (${fmtEuro(sft)})`,
    data: labels.map(() => sft),
    borderColor: '#ff4d4d',
    borderDash: [8,4],
    borderWidth: 2,
    pointRadius: 0,
    fill: false,
    order: 0
  });

  if (growthChart) growthChart.destroy();
  growthChart = new Chart(g, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation:false, responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ position:'bottom', labels:{ color:'#ccc', font:{ size:12 }, padding:8 } },
        title:{ display:true, text:'Projected Pension Value', color:'#fff', font:{ size:16, weight:'bold' } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const val = ap.balances?.[idx] || 0;
              const gap = fy.requiredPot ? (val - fy.requiredPot) : 0;
              return `Gap vs FY: ${fmtEuro(gap)}`;
            }
          }
        }
      },
      scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>'€'+v.toLocaleString() } } }
    }
  });

  const dataC = showMax && contribsMax ? contribsMax : contribsBase;
  const dataG = showMax && growthMax   ? growthMax   : growthBase;

  if (contribChart) contribChart.destroy();
  contribChart = new Chart(c, {
    type: 'bar',
    data: {
      labels,
      datasets: [
          { label:'Contributions', data:dataC, backgroundColor: showMax ? '#0099ff' : '#00ff88', stack:'s1' },
        { label:'Investment growth', data:dataG, backgroundColor:'#ff9933', stack:'s1' }
      ]
    },
    options: {
      animation:false, responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ position:'bottom', labels:{ color:'#ccc', font:{ size:12 }, padding:8 } },
        title:{ display:true, text:'Annual Contributions & Investment Growth', color:'#fff', font:{ size:16, weight:'bold' } }
      },
      scales: {
        x:{ stacked:true },
        y:{ stacked:true, beginAtZero:true, ticks:{ callback:v=>'€'+v.toLocaleString() } }
      }
    }
  });

  // ---------- Retirement-phase (drawdown) charts ----------
  const balCan = document.querySelector('#ddBalanceChart');
  const cflCan = document.querySelector('#ddCashflowChart');
  if (!balCan || !cflCan) return;

  const d = lastFYOutput._inputs || {}; // we stash this below in the FY handler
  const now = new Date();
  const curAge = d.dob ? yrDiff(new Date(d.dob), now) : null;
  const yrsToRet = Math.max(0, (d.retireAge ?? 0) - (curAge ?? 0));
  const spendBase = (d.grossIncome || 0) * ((d.incomePercent || 0) / 100);
  const spendAtRet = spendBase * Math.pow(1 + CPI, yrsToRet);
  const rentAtRet  = (d.rentalIncomeNow || d.rentalIncome || 0) * Math.pow(1 + CPI, yrsToRet);
  const partnerCurAge = d.partnerDob ? yrDiff(new Date(d.partnerDob), now) : null;
  const partnerAgeAtRet = (partnerCurAge != null) ? (partnerCurAge + yrsToRet) : null;

  // Sim paths: Required pension vs projected accumulation
  const retireAge = +d.retireAge || (lastPensionOutput?.balances?.[0]?.age ?? 65);
  const endAge = 100;
  const growthRate = Number.isFinite(+d.growthRate) ? +d.growthRate : (lastPensionOutput?.growth ?? 0.05);

  const simFY = simulateDrawdown({
    startPot: Math.max(0, lastFYOutput.requiredPot || 0),
    retireAge, endAge,
    spendAtRet, rentAtRet,
    includeSP: !!d.statePensionSelf || !!d.statePension,
    includePartnerSP: !!d.statePensionPartner || !!d.partnerStatePension,
    partnerAgeAtRet,
    hasDbSelf: !!d.hasDbSelf || !!d.hasDb,
    dbAnnualSelf: d.dbPensionSelf ?? d.dbPension ?? 0,
    dbStartAgeSelf: d.dbStartAgeSelf ?? d.dbStartAge ?? Infinity,
    hasDbPartner: !!d.hasDbPartner,
    dbAnnualPartner: d.dbPensionPartner ?? 0,
    dbStartAgePartner: d.dbStartAgePartner ?? Infinity,
    growthRate
  });

  const projectedPotCur = lastPensionOutput.projValue;
  const simCur = simulateDrawdown({
    startPot: Math.max(0, projectedPotCur),
    retireAge, endAge,
    spendAtRet, rentAtRet,
    includeSP: !!d.statePensionSelf || !!d.statePension,
    includePartnerSP: !!d.statePensionPartner || !!d.partnerStatePension,
    partnerAgeAtRet,
    hasDbSelf: !!d.hasDbSelf || !!d.hasDb,
    dbAnnualSelf: d.dbPensionSelf ?? d.dbPension ?? 0,
    dbStartAgeSelf: d.dbStartAgeSelf ?? d.dbStartAge ?? Infinity,
    hasDbPartner: !!d.hasDbPartner,
    dbAnnualPartner: d.dbPensionPartner ?? 0,
    dbStartAgePartner: d.dbStartAgePartner ?? Infinity,
    growthRate
  });

  let simMax = null;
  if (lastPensionOutput.maxBalances) {
    const projectedPotMax = lastPensionOutput.maxBalances.at(-1).value;
    simMax = simulateDrawdown({
      startPot: Math.max(0, projectedPotMax),
      retireAge, endAge,
      spendAtRet, rentAtRet,
      includeSP: !!d.statePensionSelf || !!d.statePension,
      includePartnerSP: !!d.statePensionPartner || !!d.partnerStatePension,
      partnerAgeAtRet,
      hasDbSelf: !!d.hasDbSelf || !!d.hasDb,
      dbAnnualSelf: d.dbPensionSelf ?? d.dbPension ?? 0,
      dbStartAgeSelf: d.dbStartAgeSelf ?? d.dbStartAge ?? Infinity,
      hasDbPartner: !!d.hasDbPartner,
      dbAnnualPartner: d.dbPensionPartner ?? 0,
      dbStartAgePartner: d.dbStartAgePartner ?? Infinity,
      growthRate
    });
  }

  const simProj = useMax && simMax ? simMax : simCur;

  const depletionIndex = simProj.depleteAge
    ? simProj.ages.findIndex(a => a === simProj.depleteAge)
    : -1;

  const depletionDataset = (depletionIndex > 0) ? {
    type: 'line',
    label: `Projected pension depletes @ age ${simProj.depleteAge}`,
    data: simProj.ages.map((_, i) => i === depletionIndex ? simProj.balances[i] : null),
    borderColor: '#ff4d4d',
    backgroundColor: '#ff4d4d',
    pointRadius: 6,
    pointHoverRadius: 7,
    showLine: false
  } : null;

  // Balance chart (two lines)
  if (ddBalanceChart) ddBalanceChart.destroy();
  ddBalanceChart = new Chart(balCan, {
    type: 'line',
    data: {
      labels: simProj.ages.map(a => `Age ${a}`),
      datasets: [
          {
            label: showMax ? 'Balance (Maximised)' : 'Balance (Projected pension)',
            data: simProj.balances,
            borderColor: showMax ? '#0099ff' : '#00ff88',
            backgroundColor: showMax ? 'rgba(0,153,255,0.10)' : 'rgba(0,255,136,0.10)',
            fill: true,
            tension: 0.28
          },
        {
          label: 'Balance (Required pension)',
          data: simFY.balances,
          borderColor: '#c000ff',
          borderDash: [6,6],
          fill: false,
          tension: 0.28
        },
        ...(depletionDataset ? [depletionDataset] : [])
      ]
    },
    options: {
      animation:false, responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ position:'bottom', labels:{ color:'#ccc', font:{ size:12 }, padding:8 } },
        title:{ display:true, text:`Projected Balance in Retirement (Age ${retireAge}–100)`, color:'#fff', font:{ size:16, weight:'bold' } },
        tooltip:{ callbacks:{ label:(ctx)=> '€' + (+ctx.parsed.y||0).toLocaleString() } }
      },
      scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>'€'+v.toLocaleString() } } }
    }
  });

  // Cashflow chart (stacked bars + need line)
  if (retirementIncomeChart) retirementIncomeChart.destroy();
  retirementIncomeChart = new Chart(cflCan, {
    type: 'bar',
    data: {
      labels: simProj.ages.map(a => `Age ${a}`),
      datasets: [
        {
          key: 'pension_withdrawals',
          label: 'Pension withdrawals',
          type: 'bar',
          stack: 'income',
          data: simProj.pensionDraw,
          backgroundColor: COLORS.pensionCurrent.fill,
          borderColor: COLORS.pensionCurrent.border,
          borderWidth: 1
        },
        {
          key: 'other_income',
          label: 'Other income (SP / Rent / DB)',
          type: 'bar',
          stack: 'income',
          data: simProj.otherInc,
          backgroundColor: COLORS.otherIncome.fill,
          borderColor: COLORS.otherIncome.border,
          borderWidth: 1
        },
        {
          key: 'total_need',
          label: 'Total income need',
          type: 'line',
          data: simProj.reqLine,
          borderColor: COLORS.needLine,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: false,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      animation:false, responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ position:'bottom', labels:{ color:'#ccc', font:{ size:12 }, padding:8 } },
        title:{ display:true, text:'Annual Retirement Income: Needs & Sources', color:'#fff', font:{ size:16, weight:'bold' } }
      },
      scales: {
        x:{ stacked:true },
        y:{ stacked:true, beginAtZero:true, ticks:{ callback:v=>'€'+v.toLocaleString() } }
      }
    }
  });
  setRetirementIncomeColorsForToggle(useMax);

    if (typeof updateRetirementBalanceConditions === 'function') {
      updateRetirementBalanceConditions({
        depletionAgeCurrent: simCur.depleteAge ?? null,
        depletionAgeMax: simMax?.depleteAge ?? null
      });
    }

    renderComplianceNotices(document.getElementById('compliance-notices'));

    // Optional: console flag for depletion
    if (simProj.depleteAge) {
      console.warn(`[Drawdown] Projected pension depletes at age ${simProj.depleteAge}.`);
    }
  } catch (err) {
    console.error('[FM Results] drawCharts failed:', err);
  }
}

function renderMaxTable(wiz){
  const sect = document.querySelector('#maxTableSection');
  if (!sect) return;

  const dobStr = wiz?.dob;
  const salaryRaw = +wiz?.salary || 0;

  sect.innerHTML = `
    <h3>Maximum personal pension contributions by age band</h3>
    <p class="max-note" id="maxTableHelp"></p>
  `;

  const help = sect.querySelector('#maxTableHelp');

  if (!dobStr || !salaryRaw){
    help.textContent = 'We couldn’t determine your age and/or salary. Edit inputs to see a personalised breakdown.';
    return;
  }

  const dob = new Date(dobStr);
  const ageNow = Math.floor(yrDiff(dob, new Date()));
  const capBase = Math.min(salaryRaw, MAX_SALARY_CAP);

  const rows = AGE_BANDS.map((band, idx) => {
    const bandLabel =
      idx === 0 ? 'Up to 29'
      : idx === 1 ? '30 – 39'
      : idx === 2 ? '40 – 49'
      : idx === 3 ? '50 – 54'
      : idx === 4 ? '55 – 59'
      : '60 +';
    const pct = band.pct;
    const euro = Math.round(pct * capBase);
    const inBand = ageNow <= band.max && (idx === 0 || ageNow > AGE_BANDS[idx-1].max);
    return `
      <tr class="${inBand ? 'highlight' : ''}">
        <td>${bandLabel}</td>
        <td>${(pct*100).toFixed(0)} %</td>
        <td>${fmtEuro(euro)}</td>
      </tr>`;
  }).join('');

  const table = document.createElement('div');
  table.innerHTML = `
    <div class="table-scroll">
      <table class="max-table" role="table">
        <thead>
          <tr>
            <th>Age band</th>
            <th>Max %</th>
            <th>Max € (on ${fmtEuro(capBase)})</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="max-note">
      <strong>Note:</strong> Your current age (${ageNow}) is highlighted.
      Personal limits are calculated on a max reckonable salary of €115,000;
      employer contributions are <strong>not</strong> subject to this cap.
    </p>
  `;
  sect.appendChild(table);
}

// Listen for inputs from the wizard
document.addEventListener('fm-run-pension', (e) => {
  const d = e.detail || {};
  if (d.dob) lastWizard.dob = d.dob;
  if (d.salary != null) lastWizard.salary = +d.salary;
  if (d.retireAge != null) {
    lastWizard.retireAge = +d.retireAge;
    updateRetirementAgeChips(+d.retireAge);
  }
  if (d.growth != null) lastWizard.growthRate = +d.growth;
});

document.addEventListener('fm-pension-output', (e) => {
  console.debug('[FM Results] got fm-pension-output', e.detail);
  lastPensionOutput = e.detail;

  const retireAge = lastWizard?.retireAge ?? lastPensionOutput?.balances?.at(-1)?.age ?? null;
  const retirementYear = lastPensionOutput?.retirementYear;
  const projValue = projectedAtRetirementValue();
  const sftLimit = lastPensionOutput?.sftLimit ?? (retirementYear ? sftForYear(retirementYear) : null);

  const warningsHTML = buildWarningsHTML(
    {
      retireAge,
      retirementYear,
      projectedValue: projValue,
      sftLimit
    },
    { variant: 'fullmonty' }
  );
  const cw = document.getElementById('calcWarnings');
  if (cw) {
    cw.innerHTML = warningsHTML;
    document.querySelectorAll('.warning-block strong').forEach(s=>{
      if (s.textContent.trim() === 'Standard Fund Threshold (SFT) Assumptions') {
        s.closest('.warning-block')?.remove();
      }
    });
  }

  lastPensionOutput.warningBlocks = [...document.querySelectorAll('#calcWarnings .warning-block')].map(el => {
    const strong = el.querySelector('strong');
    const headText = strong ? strong.innerText.trim() : el.innerText.split('\n')[0].trim();
    const clone = el.cloneNode(true);
    if (strong) clone.removeChild(clone.querySelector('strong'));
    else clone.innerHTML = clone.innerHTML.replace(/^[\s\S]*?<br\s*\/?>/, '');
    const bodyHTML = clone.innerHTML.replace(/^[\s\uFEFF\u200B]*(⚠️|⛔)/, '').trim();
    return { title: headText.replace(/^\s*⚠️|⛔\s*/, '').trim(), body: bodyHTML, danger: el.classList.contains('danger') };
  });

  ensureMaxScenario();

  try { drawCharts(); } catch (e) { console.error('[FM Results] drawCharts error:', e); }
  try { renderMaxTable(lastWizard); } catch (e) { console.error('[FM Results] renderMaxTable error:', e); }

  ensureNoticesMount();
  deriveHeroBaseMonthly(); computeMonthlyCap(); updateTapBadges(); if (typeof refreshContribUX === 'function') refreshContribUX();
  mountBelowHeroToggle();
  try { renderComplianceNotices(document.getElementById('compliance-notices')); } catch (e) { console.error('[FM Results] notices error:', e); }

  // DO NOT call renderHeroNowOrQueue here directly
  scheduleHeroRender();
  updateRestoreVisibility();
});

document.addEventListener('fm-run-fy', (e) => {
  console.debug('[FM Results] got fm-run-fy', e.detail);
  const d = e.detail || {};
  lastWizard = { ...lastWizard, dob: d.dob, salary: +d.grossIncome || 0, retireAge: +d.retireAge, growthRate: +d.growthRate };
  updateRetirementAgeChips(+d.retireAge);
  const fy = fyRequiredPot({
    grossIncome: d.grossIncome || 0,
    incomePercent: d.incomePercent || 0,
    includeSP: !!d.statePensionSelf,
    includePartnerSP: !!d.statePensionPartner,
    partnerExists: !!d.hasPartner,
    dob: new Date(d.dob),
    partnerDob: d.partnerDob ? new Date(d.partnerDob) : null,
    retireAge: +d.retireAge,
    gRate: +d.growthRate,
    rentalToday: d.rentalIncomeNow || 0,
    hasDbSelf: !!d.hasDbSelf,
    dbAnnualSelf: d.dbPensionSelf || 0,
    dbStartAgeSelf: d.dbStartAgeSelf || Infinity,
    hasDbPartner: !!d.hasDbPartner,
    dbAnnualPartner: d.dbPensionPartner || 0,
    dbStartAgePartner: d.dbStartAgePartner || Infinity
  });
  fy._inputs = { ...d };
  lastFYOutput = fy;
  ensureMaxScenario();

  try { drawCharts(); } catch (e) { console.error('[FM Results] drawCharts error:', e); }
  try { renderMaxTable(lastWizard); } catch (e) { console.error('[FM Results] renderMaxTable error:', e); }

  ensureNoticesMount();
  deriveHeroBaseMonthly(); computeMonthlyCap(); updateTapBadges(); if (typeof refreshContribUX === 'function') refreshContribUX();
  mountBelowHeroToggle();
  try { renderComplianceNotices(document.getElementById('compliance-notices')); } catch (e) { console.error('[FM Results] notices error:', e); }

  // Only render hero when both datasets present
  scheduleHeroRender();
  updateRestoreVisibility();
});

// Wire bottom-sheet CTAs (exists in full-monty.html)
document.addEventListener('DOMContentLoaded', () => {
  const btnOnMax   = document.getElementById('sheetGoToMax');  // primary CTA
  const btnSeeLim  = document.getElementById('sheetSeeLimit'); // secondary CTA
  const elMax      = document.getElementById('maxContribToggle');
  const elLimits   = document.getElementById('taxReliefLimits');
  const sheet      = document.getElementById('sheetTaxRelief');

  function closeSheet(){ if (sheet) sheet.hidden = true; }

  if (btnOnMax) {
    // Ensure the button label is correct even if HTML changes later
    btnOnMax.textContent = 'Turn on Maximise';
    btnOnMax.addEventListener('click', () => {
      closeSheet();
      // Turn on the scenario
      setUseMaxContributions(true);

      // Reflect in the UI switch if present
      const sw = document.getElementById('maxContribsChk');
      if (sw) sw.checked = true;

      // Scroll to the panel
      if (elMax) elMax.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (btnSeeLim) {
    btnSeeLim.addEventListener('click', () => {
      closeSheet();
      if (elLimits) elLimits.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
});

// Keep restore hidden on any re-render of results
