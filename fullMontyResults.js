// fullMontyResults.js
import { fyRequiredPot } from './shared/fyRequiredPot.js';
import { sftForYear, CPI, STATE_PENSION, SP_START, MAX_SALARY_CAP } from './shared/assumptions.js';
import { setUIMode } from './uiMode.js';

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
  } else {
    window.__pendingHeroPayload = payload;
  }
}

window.addEventListener('fm-renderer-ready', renderHeroNowOrQueue);

function renderComplianceNotices(container){
  container = ensureNoticesMount() || container || document.getElementById('compliance-notices');
  if (!container || !lastPensionOutput) return;

  const valueAtRet   = projectedAtRetirementValue();
  const retireAge    = lastWizard?.retireAge ?? null;
  const retirementYr = lastPensionOutput?.retirementYear ?? null;

  // Year-aware SFT: prefer lastPensionOutput.sftLimit if present, else compute from year
  const sftLimit = (lastPensionOutput?.sftLimit != null)
    ? lastPensionOutput.sftLimit
    : (retirementYr != null ? sftForYear(retirementYr) : null);

  // --- SFT severity vs projected pension at retirement
  let sftLevel = 'warn';
  if (valueAtRet != null && sftLimit != null){
    const r = valueAtRet / sftLimit;
    sftLevel = r >= 1 ? 'danger' : (r >= 0.8 ? 'warn' : 'ok');
  }

  // --- Age severity (unchanged)
  let ageLevel='ok';
  if (retireAge != null){
    if (retireAge < 50 || retireAge >= 75) ageLevel='danger';
    else if ((retireAge >= 50 && retireAge < 60) || (retireAge >= 70 && retireAge < 75)) ageLevel='warn';
  }

  // Pull legacy blocks for body copy (keep as-is)
  const wb = lastPensionOutput?.warningBlocks || [];
  const findWB = (pred) => wb.find(w => pred((w.title||'').toLowerCase()));
  const ageWB = findWB(t => t.includes('retiring before age 50') || t.includes('retiring between age 50') || t.includes('over 70') || t.includes('75 and over'));
  const assWB = findWB(t => t.includes('standard fund threshold (sft) assumptions'));

  // “pension”-worded meta, year-aware
  const scenario = useMax ? 'Max contributions' : 'Base case';
  const sftMeta = (valueAtRet!=null && sftLimit!=null)
    ? `Projected (${scenario}) pension at retirement: <b>${formatEUR(valueAtRet)}</b> vs SFT for <b>${retirementYr ?? 'year n/a'}</b>: <b>${formatEUR(sftLimit)}</b>.`
    : (sftLimit!=null
        ? `SFT for <b>${retirementYr ?? 'year n/a'}</b> is <b>${formatEUR(sftLimit)}</b>; projection not available yet.`
        : 'No SFT comparison available.');

  const sftTail = (sftLevel==='danger')
    ? ' Your projected pension exceeds the configured limit at retirement.'
    : (sftLevel==='warn' ? ' Your projected pension is getting close to the limit.' : '');

  const sftCard = `
    <div class="notice-card ${sftLevel==='danger'?'danger':(sftLevel==='warn'?'warn':'')}">
      <div class="title">Standard Fund Threshold</div>
      <div class="meta">
        ${sftMeta}${sftTail}
        <br><br>
        <em>Reference:</em> SFT increases by <b>€200k p.a.</b> from <b>€2.0m</b> in <b>2025</b> to <b>€2.8m</b> in <b>2029</b>. For <b>2030+</b>, we conservatively hold the SFT at <b>€2.8m</b> pending official guidance.
      </div>
    </div>
  `;

  const ageBody = ageWB ? ageWB.body : (
    retireAge==null
      ? 'No retirement age selected.'
      : (retireAge < 50
          ? 'Pensions generally cannot be accessed before age 50 except in rare cases (ill-health).'
          : (retireAge < 60
              ? 'Access before the usual retirement age is limited and condition-dependent.'
              : (retireAge < 75
                  ? 'Many schemes must be drawn by age 70; PRSAs may defer to 75.'
                  : 'All pensions must be accessed by age 75; automatic vesting applies.')))
  );

  const ageCard = (ageLevel==='ok' && !ageWB) ? '' : `
    <div class="notice-card ${ageLevel==='danger'?'danger':(ageLevel==='warn'?'warn':'')}">
      <div class="title">Retirement age selection</div>
      <div class="meta">${ageBody}</div>
    </div>
  `;

  const assumpCard = (retirementYr>=2030) ? `
    <div class="notice-card warn">
      <div class="title">SFT assumptions notice</div>
      <div class="meta">
        ${assWB ? assWB.body :
          'Official SFT values are confirmed to 2029 (+€200k per year to €2.8m). For 2030+ we hold the SFT at €2.8m pending guidance.'}
      </div>
    </div>
  ` : '';

  const mandatoryCard = `
    <div class="notice-card warn">
      <div class="title">Mandatory withdrawals (ARF / vested PRSA)</div>
      <div class="meta">
        Minimum annual drawdowns apply in retirement under Revenue’s imputed-distribution rules. Our charts do <b>not</b> model these minimum withdrawals.
      </div>
    </div>
  `;

  container.innerHTML = `
    <div class="notice-cards">
      ${sftCard}
      ${ageCard}
      ${assumpCard}
      ${mandatoryCard}
    </div>
  `;

  // Remove legacy static SFT sections so only the new cards remain
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

const $ = (s)=>document.querySelector(s);

console.debug('[FM Results] loaded');

document.addEventListener('DOMContentLoaded', () => {
  setUIMode('results');
  const chk = document.querySelector('#maxContribsChk');
  if (chk) {
    useMax = chk.checked;
    chk.addEventListener('change', (e) => {
      setUseMaxContributions(e.target.checked);
    });
    if (typeof setMaxToggle === 'function') setMaxToggle(chk.checked);
    if (typeof onMaxContribsToggleChanged === 'function') onMaxContribsToggleChanged(chk.checked);
  }
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
  txt.textContent = 'Use max pension contributions';
  lab.appendChild(txt);
  const knob = document.createElement('span');
  knob.className = 'knob';
  track.appendChild(lab);
  track.appendChild(knob);
  label.appendChild(track);
  wrap.appendChild(label);

  const note = document.createElement('div');
  note.id = 'maxToggleNote';
  note.className = 'toggle-note';
  note.setAttribute('aria-live','polite');
  note.textContent = chk.checked
    ? 'Max contributions applied — see the detailed age-band limits below.'
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
      label: showMax ? 'Max Contribution' : 'Your Projection',
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
            label: showMax ? 'Balance (Max contribs)' : 'Balance (Projected pension)',
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
  let earlyWarning = '';
  if (retireAge != null){
    if (retireAge < 50){
      earlyWarning = `
<div class="warning-block danger">
⛔ <strong>Retiring Before Age 50</strong><br><br>
Under Irish Revenue rules, pensions cannot be accessed before age 50, except in rare cases such as ill-health retirement.<br>
These projections are illustrative only — professional guidance is strongly recommended.
</div>`;
    }
    else if (retireAge < 60){
      earlyWarning = `
<div class="warning-block">
⚠️ <strong>Retiring Between Age 50–59</strong><br><br>
Access to pension benefits before the usual retirement age is only possible in limited cases.<br><br>
Typical Normal Retirement Ages (NRAs) are:<br>
60–70 for most occupational pensions and Personal Retirement Bonds (PRBs)<br>
60–75 for PRSAs<br><br>
Early access (from age 50) may be possible only if certain Revenue conditions are met — e.g.:<br>
You’ve left employment linked to the pension<br>
You’re a proprietary director who fully severs ties with the sponsoring company<br><br>
Please seek professional advice before relying on projections assuming early access.
</div>`;
    }
    else if (retireAge < 70){
      earlyWarning = '';
    }
    else if (retireAge < 75){
      earlyWarning = `
<div class="warning-block">
⚠️ <strong>Retirement Age Over 70 (Occupational Pensions &amp; PRBs)</strong><br><br>
Most occupational pensions and Personal Retirement Bonds (PRBs) must be drawn down by age 70 under Irish Revenue rules.<br>
If your selected retirement age is over 70, please be aware this may not be allowed for those pension types.<br><br>
Note: The exception to this is PRSAs, which can remain unretired until age 75.<br><br>
Please seek professional advice to ensure your retirement plan complies with pension access rules.
</div>`;
    }
    else {
      earlyWarning = `
<div class="warning-block danger">
⛔ <strong>Retirement Age 75 and Over</strong><br><br>
Under Irish Revenue rules, all pensions — including PRSAs — must be accessed by age 75.<br>
If benefits are not drawn down by this age, the pension is automatically deemed to vest, and the full value may be treated as taxable income.<br>
These projections are illustrative only — professional guidance is strongly recommended.
</div>`;
    }
  }

  let sftAssumpWarning = '';
  if (retirementYear >= 2030) {
    sftAssumpWarning = `
      <div class="warning-block">
        ⚠️ <strong>Standard Fund Threshold (SFT) Assumptions</strong><br><br>
        This pension projection tool uses the Standard Fund Threshold (SFT) figures as published by the Irish Government for each year up to and including 2029. These are the most recent years for which official, fixed SFT values have been confirmed.<br><br>
        While the Government has indicated that the SFT will increase in line with wage inflation beyond 2029, no definitive figures or formulae have been published to date. As a result, this tool does not project future increases to the SFT beyond 2029, as doing so would require speculative or unreliable assumptions.<br><br>
        Users should be aware that actual SFT limits post-2029 may differ significantly depending on future policy decisions and economic conditions. We recommend consulting a qualified financial advisor for guidance specific to your circumstances.
      </div>`;
  }

  const mandatoryWarning = `
  <div class="warning-block">
    ⚠️ <strong>Mandatory Withdrawals (ARF / vested PRSA)</strong><br><br>
    Revenue’s imputed distribution rules require minimum annual drawdowns from ARFs and vested PRSAs. Rates increase with age and may vary with overall ARF/vested PRSA size. Our charts do not model these minimum withdrawals; actual net income and fund paths may differ.
  </div>
`;

  const warningsHTML = (earlyWarning || '') + (sftAssumpWarning || '') + mandatoryWarning;
  const cw = document.getElementById('calcWarnings');
  if (cw) cw.innerHTML = warningsHTML;

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
  try { renderComplianceNotices(document.getElementById('compliance-notices')); } catch (e) { console.error('[FM Results] notices error:', e); }

  // DO NOT call renderHeroNowOrQueue here directly
  scheduleHeroRender();
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
  try { renderComplianceNotices(document.getElementById('compliance-notices')); } catch (e) { console.error('[FM Results] notices error:', e); }

  // Only render hero when both datasets present
  scheduleHeroRender();
});
