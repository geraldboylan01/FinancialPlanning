// fullMontyResults.js
import { fyRequiredPot } from './shared/fyRequiredPot.js';
import { sftForYear, CPI, STATE_PENSION, SP_START, MAX_SALARY_CAP } from './shared/assumptions.js';
import { buildWarningsHTML } from './shared/warnings.js';
import { buildFullMontyPDF } from './fullMontyPdf.js';

// ===== PDF SNAPSHOT UTILITIES =====
window.latestRun = window.latestRun || null;

/**
 * Try to read a number from a DOM node's text (e.g. "65" or "Age 65")
 */
function numFromText(el) {
  if (!el || !el.textContent) return null;
  const m = el.textContent.replace(/[^\d.]/g, '');
  return m ? Number(m) : null;
}

function safeAgeFromDob(dob) {
  if (!dob) return null;
  const dt = new Date(dob);
  if (Number.isNaN(dt.getTime())) return null;
  const years = (Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.floor(years);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Build a minimal snapshot for the PDF, pulling from your existing globals/state if present,
 * then falling back to DOM where possible. All fields are optional; the PDF builder is null-safe.
 */
async function buildPdfRunSnapshotSafely() {
  try {
    const desiredRetAge = firstFiniteNumber(
      typeof lastWizard?.retireAge === 'number' ? lastWizard.retireAge : null,
      typeof window.retAge === 'number' ? window.retAge : null,
      numFromText(document.getElementById('chipRetAgeB'))
    ) ?? 65;

    const ffnCombined = firstFiniteNumber(
      typeof lastFYOutput?.requiredPot === 'number' ? lastFYOutput.requiredPot : null,
      typeof window.lastFYOutput?.requiredPot === 'number' ? window.lastFYOutput.requiredPot : null,
      typeof window.fy?.requiredPot === 'number' ? window.fy.requiredPot : null
    );

    const projectedPotValue =
      typeof projectedAtRetirementValue === 'function' ? projectedAtRetirementValue() : null;

    const potAtRetCurrent = firstFiniteNumber(
      projectedPotValue,
      typeof lastPensionOutput?.projValue === 'number' ? lastPensionOutput.projValue : null,
      typeof window.lastPensionOutput?.combined?.potAtRet === 'number'
        ? window.lastPensionOutput.combined.potAtRet
        : null
    );

    const potAtRetMax = firstFiniteNumber(
      typeof lastPensionOutput?.maxBalances?.at === 'function' && lastPensionOutput.maxBalances.length
        ? lastPensionOutput.maxBalances.at(-1)?.value ?? null
        : null,
      typeof lastPensionOutput?.projValueMax === 'number' ? lastPensionOutput.projValueMax : null,
      typeof window.lastPensionOutputMax?.combined?.potAtRet === 'number'
        ? window.lastPensionOutputMax.combined.potAtRet
        : null
    );

    const year1GrossIncome = firstFiniteNumber(
      typeof window.ddOutputs?.year1Gross === 'number' ? window.ddOutputs.year1Gross : null,
      typeof window.postRetirement?.year1Gross === 'number' ? window.postRetirement.year1Gross : null
    );

    const hasPartner = !!(lastWizard?.hasPartner || window.inputs?.partnerIncluded || window.hasPartner);
    const ageUser = firstFiniteNumber(
      typeof lastWizard?.age === 'number' ? lastWizard.age : null,
      safeAgeFromDob(lastWizard?.dob),
      typeof window.inputs?.ageUser === 'number' ? window.inputs.ageUser : null,
      typeof window.ageUser === 'number' ? window.ageUser : null
    );
    const agePartner = firstFiniteNumber(
      typeof lastWizard?.partner?.age === 'number' ? lastWizard.partner.age : null,
      safeAgeFromDob(lastWizard?.partner?.dob),
      typeof window.inputs?.agePartner === 'number' ? window.inputs.agePartner : null,
      typeof window.agePartner === 'number' ? window.agePartner : null
    );

    return {
      // Existing
      desiredRetAge,
      ffnCombined,
      potAtRetCurrent,
      potAtRetMax,
      year1GrossIncome,
      hasPartner,
      ageUser,
      agePartner,

      // NEW — for narrative logic
      // Growth: prefer wizard’s selected pensionGrowthRate, then lastWizard.growthRate, then projector’s growth, else 5%
      growthRatePct:
        (Number.isFinite(+lastWizard?.pensionGrowthRate) ? +lastWizard.pensionGrowthRate
        : Number.isFinite(+lastWizard?.growthRate) ? +lastWizard.growthRate
        : Number.isFinite(+lastPensionOutput?.growth) ? +lastPensionOutput.growth
        : 0.05) * 100,

      // SFT at retirement year if provided by projector, else compute
      sftLimit:
        (typeof lastPensionOutput?.sftLimit === 'number')
          ? lastPensionOutput.sftLimit
          : (Number.isFinite(+lastPensionOutput?.retirementYear) ? sftForYear(lastPensionOutput.retirementYear) : null),

      // Risk profile (string label), if present
      riskProfile:
        lastFYOutput?._inputs?.pensionRisk
        ?? lastWizard?.pensionRisk
        ?? null,

      // Echo retirement age (alias)
      retAge: desiredRetAge
    };
  } catch (e) {
    console.warn('[PDF] Snapshot fallback failed:', e);
    return {}; // still safe for the PDF builder
  }
}

/**
 * Update the global latestRun whenever results are (re)computed.
 * Call this at the end of your main compute/render pipeline.
 */
async function updateLatestRunSnapshot() {
  window.latestRun = await buildPdfRunSnapshotSafely();
}

// --- PDF Export Support ---
window.fmCharts = window.fmCharts || {};
window.fmState = window.fmState || {};

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

// --- Restore-to-original: disabled (we don't show or mount this anymore) ---
function getRestoreBtn() { return null; }
function ensureHeroRestoreExists() { return null; }
function setRestoreVisible(_show) {}
function updateRestoreVisibility() {}
function bindRestoreButtonClick() {}
function restoreToBaseline() {}

let _userHasAdjusted = false; // set true only by tweak actions (not by Max toggle)
let _baselineInitialised = false;

// --- Baseline snapshot (per session; keep latest and final) ---
const BASELINE_KEY = () => `FM_BASELINE_${(window.FullMonty?.sessionId || 'default')}`;

// ---- Baseline lock (prevents overwrite after first final submit) ----
const BASELINE_LOCKED = () => `${BASELINE_KEY()}_LOCKED`;

function isBaselineLocked(){
  try { return sessionStorage.getItem(BASELINE_LOCKED()) === '1'; }
  catch { return false; }
}
function lockBaseline(){
  try { sessionStorage.setItem(BASELINE_LOCKED(), '1'); } catch {}
}

function jsonSafeClone(x) {
  return JSON.parse(JSON.stringify(x, (_k, v) => {
    if (v === undefined) return undefined;
    if (v === Infinity) return 1e9;
    if (v === -Infinity) return -1e9;
    return v;
  }));
}

function loadBaseline(){
  try { return JSON.parse(sessionStorage.getItem(BASELINE_KEY()) || '{}'); }
  catch { return {}; }
}
function saveBaseline(next){
  try { sessionStorage.setItem(BASELINE_KEY(), JSON.stringify(next)); } catch {}
}
function mergeAndSave(partial){
  const cur = loadBaseline();
  saveBaseline({ ...cur, ...partial });
}

// Record the **latest** FY payload seen
function saveBaselineFYLatest(rawDetail){
  if (!rawDetail) return;
  if (isBaselineLocked()) return;         // 🔒 do not overwrite baseline
  if (_userHasAdjusted) return;           // don’t redefine baseline after tweaks
  mergeAndSave({ rawFy: jsonSafeClone(rawDetail), tsFy: Date.now() });
}

// Record the **latest** Pension payload seen
function saveBaselinePensionLatest(rawDetail){
  if (!rawDetail) return;
  if (isBaselineLocked()) return;         // 🔒 do not overwrite baseline
  if (_userHasAdjusted) return;           // don’t redefine baseline after tweaks
  mergeAndSave({ rawPension: jsonSafeClone(rawDetail), tsPension: Date.now() });
}

// Record a **final** pair on submit (preferred for restore)
function saveFinalSnapshots({ rawFyFinal, rawPensionFinal }){
  const cur = loadBaseline();
  mergeAndSave({
    rawFyFinal: rawFyFinal ? jsonSafeClone(rawFyFinal) : cur.rawFyFinal,
    rawPensionFinal: rawPensionFinal ? jsonSafeClone(rawPensionFinal) : cur.rawPensionFinal,
    tsFinal: Date.now()
  });
}

if (typeof window !== 'undefined') {
  try {
    const existing = window._userHasAdjusted;
    Object.defineProperty(window, '_userHasAdjusted', {
      configurable: true,
      enumerable: false,
      get() { return _userHasAdjusted; },
      set(value) { _userHasAdjusted = !!value; /* no UI */ }
    });
    const initial = (existing === undefined) ? _userHasAdjusted : !!existing;
    window._userHasAdjusted = initial;
  } catch (err) {
    try {
      window._userHasAdjusted = _userHasAdjusted;
    } catch {}
  }
}

function markAdjustedByTweaks() {
  ensureHeroRestoreExists();
  try {
    window._userHasAdjusted = true;
  } catch {
    _userHasAdjusted = true;
    updateRestoreVisibility();
  }
}

(function observeResultsView() {
  const root = document.getElementById('resultsView');
  if (!root) return;
  const mo = new MutationObserver(() => {
    // If the actions row is replaced, make sure our button is in there again
    ensureHeroRestoreExists();
    updateRestoreVisibility();
  });
  mo.observe(root, { childList: true, subtree: true });
})();

function clearAdjustedState() {
  try {
    window._userHasAdjusted = false;
  } catch {
    _userHasAdjusted = false;
    updateRestoreVisibility();
  }
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

// Is this a partner scenario?
function isPartnerScenario(wiz = lastWizard) {
  return !!(
    wiz?.partner?.enabled ||
    wiz?.partner?.present ||
    wiz?.hasPartner ||
    wiz?.includePartner ||
    (wiz?.partner && typeof wiz.partner === 'object' && Object.keys(wiz.partner).length > 0)
  );
}

// Show/hide controls when partner is present
function toggleHeroControlsForPartner() {
  const altInputs = lastFYOutput?._inputs;
  const hide = isPartnerScenario() || (altInputs ? isPartnerScenario(altInputs) : false);

  // €100 nudgers
  const nudgers = document.getElementById('contribNudgers');
  if (nudgers) nudgers.hidden = hide;

  // “Your contributions” summary
  const contribSummary = document.getElementById('contribSummary');
  if (contribSummary) contribSummary.hidden = hide;
}

// === Partner-aware “Max personal contributions by age band” renderer ==========

(function attachPartnerAwareMaxTable(){
  const MAX_CAP = 115000; // per-person Revenue cap for personal contributions
  const BANDS = [
    { label: 'Up to 29',  min:   0, max: 29, pct: 15 },
    { label: '30 – 39',   min:  30, max: 39, pct: 20 },
    { label: '40 – 49',   min:  40, max: 49, pct: 25 },
    { label: '50 – 54',   min:  50, max: 54, pct: 30 },
    { label: '55 – 59',   min:  55, max: 59, pct: 35 },
    { label: '60 +',      min:  60, max: 200, pct: 40 }
  ];

  function fmtEUR(n){
    try { return new Intl.NumberFormat('en-IE', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(Number(n)||0); }
    catch { return '€' + Math.round(Number(n)||0).toLocaleString(); }
  }
  const yearsFrom = (dobStr) => {
    if (!dobStr) return null;
    const diff = Date.now() - new Date(dobStr).getTime();
    return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  };
  const bandForAge = (age) => {
    if (age == null) return null;
    return BANDS.find(b => age >= b.min && age <= b.max) || null;
  };
  const salaryCapped = (raw) => Math.max(0, Math.min(Number(raw)||0, MAX_CAP));
  const perBandMaxEuro = (salary, pct) => Math.round(salaryCapped(salary) * (pct/100));

  /**
   * Renders the table into #taxReliefLimits, legend into #maxLegend, note into #maxNote.
   * @param {object} store – Full Monty store (needs: dobSelf, dobPartner, hasPartner, grossIncome, grossIncomePartner)
   */
  window.renderMaxContributionTable = function renderMaxContributionTable(store){
    const table = document.getElementById('taxReliefLimits');
    const legend = document.getElementById('maxLegend');
    const note = document.getElementById('maxNote');
    if (!table) return;

    const hasPartner = !!store?.hasPartner;

    // Per-person data
    const selfAge     = yearsFrom(store?.dobSelf || store?.dob);
    const partnerAge  = hasPartner ? yearsFrom(store?.dobPartner) : null;
    const selfBand    = bandForAge(selfAge);
    const partnerBand = hasPartner ? bandForAge(partnerAge) : null;

    const selfSalary     = Number(store?.grossIncome || store?.salary || 0);
    const partnerSalary  = Number(store?.grossIncomePartner || 0);

    // Build THEAD
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.innerHTML = `
      <th>Age band</th>
      <th>Max&nbsp;%</th>
      <th>You (€/yr)</th>
      ${hasPartner ? `<th class="partner-col">Partner (€/yr)</th>` : `<th class="partner-col" hidden>Partner (€/yr)</th>`}
    `;
    thead.appendChild(headRow);

    // Build TBODY
    const tbody = document.createElement('tbody');
    BANDS.forEach(b => {
      const tr = document.createElement('tr');

      // cells
      const tdBand = document.createElement('td');   tdBand.textContent = b.label;
      const tdPct  = document.createElement('td');   tdPct.textContent  = `${b.pct} %`;

      // Self €
      const selfMax = perBandMaxEuro(selfSalary, b.pct);
      const tdSelf  = document.createElement('td');
      tdSelf.className = 'max-euro self-euro';
      tdSelf.textContent = fmtEUR(selfMax);
      // highlight the exact cell for user's band
      if (selfBand && selfBand.label === b.label) {
        tdSelf.classList.add('is-highlight-self');
        tdSelf.setAttribute('data-hl', 'self');
      }

      // Partner €
      const tdPartner = document.createElement('td');
      tdPartner.className = 'partner-col max-euro partner-euro';
      if (hasPartner) {
        const partnerMax = perBandMaxEuro(partnerSalary, b.pct);
        tdPartner.textContent = fmtEUR(partnerMax);
        // highlight the exact cell for partner's band
        if (partnerBand && partnerBand.label === b.label) {
          tdPartner.classList.add('is-highlight-partner');
          tdPartner.setAttribute('data-hl', 'partner');
        }
      } else {
        tdPartner.setAttribute('hidden', 'true');
      }

      tr.append(tdBand, tdPct, tdSelf, tdPartner);
      tbody.appendChild(tr);
    });

    // (Re)mount table
    table.innerHTML = '';
    table.appendChild(thead);
    table.appendChild(tbody);

    // Legend
    if (legend) {
      legend.innerHTML = hasPartner
        ? `<span class="badge hl-self">You</span> <span class="badge hl-partner">Partner</span>`
        : '';
    }

    // Note copy
    if (note) {
      if (!hasPartner) {
        const ageTxt = (selfAge != null) ? `Your current age (${selfAge})` : 'Your current age';
        note.innerHTML = `${ageTxt} is indicated. Personal limits are calculated on a max reckonable salary of €115,000; employer contributions are <strong>not</strong> subject to this cap.`;
      } else {
        const you   = (selfAge != null)    ? `your current age (${selfAge})` : 'your current age';
        const them  = (partnerAge != null) ? `your partner’s age (${partnerAge})` : 'your partner’s age';
        note.innerHTML = `Note: ${you} and ${them} are indicated. Personal limits are calculated <em>separately for each person</em> on a max reckonable salary of €115,000; employer contributions are <strong>not</strong> subject to this cap.`;
      }
    }
  };
})();

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
  const el = document.getElementById('contribSummaryValue');
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

  const baseSelf    = Number(lastPensionOutput?.projValueSelf ?? 0);
  const basePartner = Number(lastPensionOutput?.projValuePartner ?? 0);
  const maxSelf     = Number(lastPensionOutput?.projValueSelfMax ?? baseSelf);
  const maxPartner  = Number(lastPensionOutput?.projValuePartnerMax ?? basePartner);
  const useMaxNow   = !!useMax;
  const effSelf     = useMaxNow ? maxSelf : baseSelf;
  const effPartner  = useMaxNow ? maxPartner : basePartner;

  return {
    projectedPotAtRetirement: projected,
    projectedPot: projected,
    fyTarget: fyReq,
    desiredRetirementAge: lastWizard?.retireAge,
    retirementAge: lastWizard?.retireAge,
    retirementYear: lastPensionOutput?.retirementYear ?? null,
    partnerIncluded: !!lastFYOutput?._inputs?.hasPartner,
    partnerDOB: lastFYOutput?._inputs?.partnerDob || null,
    useMaxContributions: useMaxNow,
    projValueSelf: effSelf,
    projValuePartner: effPartner,
    projValueSelfBase: baseSelf,
    projValuePartnerBase: basePartner,
    projValueSelfMax: maxSelf,
    projValuePartnerMax: maxPartner
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
    toggleHeroControlsForPartner();
  } else {
    window.__pendingHeroPayload = payload;
  }
}

window.addEventListener('fm-renderer-ready', renderHeroNowOrQueue);
window.addEventListener('fm-renderer-ready', mountBelowHeroToggle);
window.addEventListener('fm-renderer-ready', toggleHeroControlsForPartner);
window.addEventListener('fm-renderer-ready', () => {
  // Ensure the hero has the correct restore button
  ensureHeroRestoreExists();

  // Only on the first render should we consider ourselves at baseline.
  if (!_baselineInitialised) {
    clearAdjustedState();    // hides button once, for initial baseline only
    _baselineInitialised = true;
  } else {
    // On subsequent re-renders (e.g., after +1 yr), KEEP the user-adjusted state
    updateRestoreVisibility();
  }
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

async function setUseMaxContributions(on){
  useMax = !!on;

  try { window.__USE_MAX__ = useMax; } catch {}
  try { window.fmState.useMax = useMax; } catch {}
  try { document.documentElement.setAttribute('data-use-max', useMax ? '1' : '0'); } catch {}

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

  try {
    await updateLatestRunSnapshot();
  } catch (err) {
    console.warn('[PDF] Snapshot update failed after max toggle:', err);
  }
}
window.setUseMaxContributions = setUseMaxContributions;

function findHeroButtons(){ return { addBtn: null, remBtn: null }; }
function ensureBadge(_el){ return null; }
function updateTapBadges(){ /* no badges without add/remove */ }

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
function bindHeroTapDelegation(){ /* removed add/remove €100 listeners */ }

function bindYearAdjustmentDelegation(){
  // Use capture so stopPropagation in inner handlers can't block us.
  document.addEventListener('click', (e) => {
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
  }, true); // ← capture phase
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
        tooltip: {}
      },
      scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>'€'+v.toLocaleString() } } }
    }
  });
  window.fmCharts.growth = growthChart;

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
  window.fmCharts.contrib = contribChart;

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
  const firstBalanceAge = lastPensionOutput?.balances?.[0]?.age;
  const retireAgeCandidate = Number.isFinite(+d.retireAge)
    ? +d.retireAge
    : (Number.isFinite(+firstBalanceAge)
        ? +firstBalanceAge
        : null);
  if (!Number.isFinite(retireAgeCandidate)) {
    console.warn('[FM Results] Unable to determine retirement age for drawdown charts.');
    return;
  }
  const retireAge = retireAgeCandidate;
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
  window.fmCharts.balance = ddBalanceChart;

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
  window.fmCharts.cashflow = retirementIncomeChart;
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

window.fmRebuildCharts = async function fmRebuildCharts(){
  const prev = useMax;
  const override = (typeof window !== 'undefined' && typeof window.__USE_MAX__ === 'boolean')
    ? !!window.__USE_MAX__
    : prev;

  if (override !== useMax) {
    useMax = override;
  }

  try { document.body.setAttribute('data-scenario', useMax ? 'max' : 'current'); } catch {}

  try {
    await Promise.resolve(drawCharts());
  } catch (e) {
    console.warn('fmRebuildCharts fallback:', e);
  } finally {
    try { window.__USE_MAX__ = useMax; } catch {}
    try { window.fmState.useMax = useMax; } catch {}
  }

  try {
    await updateLatestRunSnapshot();
  } catch (err) {
    console.warn('[PDF] Snapshot update failed after rebuild:', err);
  }
};

// Listen for inputs from the wizard
document.addEventListener('fm-run-pension', (e) => {
  const d = e.detail || {};
  saveBaselinePensionLatest(d);
  const prevAge = Number.isFinite(+lastWizard?.retireAge) ? +lastWizard.retireAge : null;
  if (d.dob) lastWizard.dob = d.dob;
  if (d.salary != null) lastWizard.salary = +d.salary;
  if (Number.isFinite(+d.retireAge)) {
    const nextAge = +d.retireAge;
    lastWizard.retireAge = nextAge;
    updateRetirementAgeChips(nextAge);
    if (prevAge != null && nextAge !== prevAge) {
      markAdjustedByTweaks();
    }
  }
  if (d.growth != null) lastWizard.growthRate = +d.growth;
  if ('hasPartner' in d) {
    lastWizard.hasPartner = !!d.hasPartner;
    lastWizard.includePartner = !!(d.includePartner ?? d.hasPartner);
    if (d.hasPartner) {
      lastWizard.partner = {
        ...(lastWizard.partner || {}),
        enabled: true,
        present: true,
        dob: d.dobPartner || lastWizard.partner?.dob,
        salary: d.salaryPartner ?? lastWizard.partner?.salary
      };
    } else {
      delete lastWizard.partner;
    }
  }
  toggleHeroControlsForPartner();
});

document.addEventListener('fm-pension-output', async (e) => {
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

  ensureNoticesMount();
  deriveHeroBaseMonthly(); computeMonthlyCap(); updateTapBadges(); if (typeof refreshContribUX === 'function') refreshContribUX();
  mountBelowHeroToggle();
  try { renderComplianceNotices(document.getElementById('compliance-notices')); } catch (e) { console.error('[FM Results] notices error:', e); }

  // DO NOT call renderHeroNowOrQueue here directly
  scheduleHeroRender();
  // The hero may have just re-rendered; ensure the button exists inside it.
  setTimeout(ensureHeroRestoreExists, 0);
  updateRestoreVisibility();
  toggleHeroControlsForPartner();

  try {
    await updateLatestRunSnapshot();
  } catch (err) {
    console.warn('[PDF] Snapshot update failed after pension output:', err);
  }
});

document.addEventListener('fm-run-fy', async (e) => {
  const d = e.detail || {};
  saveBaselineFYLatest(d);
  const prevAge = Number.isFinite(+lastWizard?.retireAge) ? +lastWizard.retireAge : null;
  lastWizard = { ...lastWizard, dob: d.dob, salary: +d.grossIncome || 0, growthRate: +d.growthRate };
  lastWizard.hasPartner = !!d.hasPartner;
  lastWizard.includePartner = !!(d.includePartner ?? d.hasPartner);
  if (lastWizard.hasPartner) {
    lastWizard.partner = {
      ...(lastWizard.partner || {}),
      enabled: true,
      present: true,
      dob: d.partnerDob || lastWizard.partner?.dob
    };
  } else {
    delete lastWizard.partner;
  }
  const nextAge = Number.isFinite(+d.retireAge) ? +d.retireAge : null;
  if (nextAge != null) {
    lastWizard.retireAge = nextAge;
    updateRetirementAgeChips(nextAge);
    if (prevAge != null && nextAge !== prevAge) {
      markAdjustedByTweaks();
    }
  } else if (prevAge != null) {
    lastWizard.retireAge = prevAge;
  } else {
    delete lastWizard.retireAge;
  }
  const fy = fyRequiredPot({
    grossIncome: d.grossIncome || 0,
    incomePercent: d.incomePercent || 0,
    includeSP: !!d.statePensionSelf,
    includePartnerSP: !!d.statePensionPartner,
    partnerExists: !!d.hasPartner,
    dob: new Date(d.dob),
    partnerDob: d.partnerDob ? new Date(d.partnerDob) : null,
    retireAge: nextAge ?? prevAge,
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

  ensureNoticesMount();
  deriveHeroBaseMonthly(); computeMonthlyCap(); updateTapBadges(); if (typeof refreshContribUX === 'function') refreshContribUX();
  mountBelowHeroToggle();
  try { renderComplianceNotices(document.getElementById('compliance-notices')); } catch (e) { console.error('[FM Results] notices error:', e); }

  // Only render hero when both datasets present
  scheduleHeroRender();
  // The hero may have just re-rendered; ensure the button exists inside it.
  setTimeout(ensureHeroRestoreExists, 0);
  updateRestoreVisibility();
  toggleHeroControlsForPartner();

  try {
    await updateLatestRunSnapshot();
  } catch (err) {
    console.warn('[PDF] Snapshot update failed after FY output:', err);
  }
});

document.addEventListener('fm:wizard:final-submit', (e) => {
  const detail = e.detail || {};
  saveFinalSnapshots({
    rawFyFinal: detail.rawFy || null,
    rawPensionFinal: detail.rawPension || null
  });
  lockBaseline(); // 🔒 freeze baseline now
});

// Wire bottom-sheet CTAs (exists in full-monty.html)
document.addEventListener('DOMContentLoaded', () => {
  const btnOnMax   = document.getElementById('sheetGoToMax');  // primary CTA
  const btnSeeLim  = document.getElementById('sheetSeeLimit'); // secondary CTA
  const elMax      = document.getElementById('maxContribToggle');
  const elLimits   = document.getElementById('maxTableSection');
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

function _currentFMStore(){
  // preferred: live wizard store
  const s = (window.getFullMontyData && window.getFullMontyData())
         || (window.getStore && window.getStore());
  if (s && Object.keys(s).length) return s;
  // fallback: last FY inputs (has dob/grossIncome/partner flags)
  return (lastFYOutput && lastFYOutput._inputs) ? lastFYOutput._inputs : {};
}

window.addEventListener('fm:results:ready', () => {
  try { window.renderMaxContributionTable?.(_currentFMStore()); } catch(e){}
});

document.addEventListener('fm-salary-updated', () => {
  try { window.renderMaxContributionTable?.(_currentFMStore()); } catch(e){}
});

document.addEventListener('DOMContentLoaded', () => {
  try { window.renderMaxContributionTable?.(_currentFMStore()); } catch(e){}
});

// Choose a single activation event to avoid pointerup→click double fires
const ACTIVATE_EVT = ('onpointerup' in window) ? 'pointerup' : 'click';

// Global in-flight guard to prevent duplicate PDF builds from the same tap
let _pdfBuildInFlight = false;

// --- Robust rebind: supports multiple layouts/IDs and late renders, single event only
function rebindGeneratePdfButton() {
  const selectors = '#btnGeneratePDF, [data-action="generate-pdf"], .js-generate-pdf';
  const candidates = Array.from(document.querySelectorAll(selectors));

  // If nothing yet, install a delegated listener once (handles late mounts)
  if (!candidates.length) {
    if (!rebindGeneratePdfButton._delegated) {
      rebindGeneratePdfButton._delegated = true;
      document.addEventListener(ACTIVATE_EVT, onGeneratePdfDelegated, true);
    }
    return;
  }

  // Bind all candidates directly; replace node to drop stale handlers
  candidates.forEach((btn) => {
    if (btn.tagName === 'BUTTON' && btn.type !== 'button') btn.type = 'button'; // avoid form submits
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    // Bind only ONE event (pointerup OR click)
    fresh.addEventListener(ACTIVATE_EVT, handleGeneratePdfTap);
  });
}

function onGeneratePdfDelegated(ev) {
  const btn = ev.target && ev.target.closest
    ? ev.target.closest('#btnGeneratePDF, [data-action="generate-pdf"], .js-generate-pdf')
    : null;
  if (btn) handleGeneratePdfTap(ev);
}

async function handleGeneratePdfTap(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();

  if (_pdfBuildInFlight) return;
  _pdfBuildInFlight = true;

  document.body.classList.add('pdf-exporting');
  try {
    const run = window.latestRun || (await buildPdfRunSnapshotSafely());
    await buildFullMontyPDF(run); // save/open handled entirely in fullMontyPdf.js
  } catch (err) {
    console.error('[PDF] Failed to generate:', err);
    alert('Sorry — something interrupted PDF generation. Please try again.\n(Details in console)');
  } finally {
    document.body.classList.remove('pdf-exporting');
    _pdfBuildInFlight = false;
  }
}

// Bind on DOM ready and after your renderer fires (so re-renders keep the right listener)
document.addEventListener('DOMContentLoaded', rebindGeneratePdfButton);
window.addEventListener('fm-renderer-ready', rebindGeneratePdfButton);

// Keep restore hidden on any re-render of results
