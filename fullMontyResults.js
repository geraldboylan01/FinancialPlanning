// fullMontyResults.js
import { fyRequiredPot } from './shared/fyRequiredPot.js';
import { sftForYear, CPI, STATE_PENSION, SP_START } from './shared/assumptions.js';

let lastPensionOutput = null; // { balances, projValue, retirementYear, contribsBase, growthBase, (optional) maxBalances, contribsMax, growthMax, sftLimit }
let lastFYOutput = null;      // { requiredPot, retirementYear, alwaysSurplus, sftWarningStripped }
let growthChart = null;
let contribChart = null;

// NEW
let ddBalanceChart = null;
let ddCashflowChart = null;

let useMax = false; // UI state for “Max contribs” toggle

const $ = (s)=>document.querySelector(s);
const euro = (n)=>'€' + (Math.round(n||0)).toLocaleString();

console.debug('[FM Results] loaded');

// Toggle behaviour
document.getElementById('maxContribToggle')?.addEventListener('change', (e) => {
  useMax = !!e.target.checked;
  if (lastPensionOutput) {
    lastPensionOutput.showMax = useMax;
    tryRender();
  }
});

// Sticky “Change My Inputs”
document.getElementById('editPlanBtn')?.addEventListener('click', () => {
  document.getElementById('fullMontyModal')?.classList.add('is-open');
  document.body.classList.add('modal-open');
});

function renderKPIs({ projValue, balances }, fyRequired) {
  const ageAtRet = balances?.at(-1)?.age ?? '';
  const gap = Math.round((projValue||0) - (fyRequired||0));
  const cls = gap >= 0 ? 'ok' : (gap < -0.15*(fyRequired||1) ? 'danger' : 'warn');
  const root = $('#kpis');
  if (!root) return;
  root.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Projected pot @ ${ageAtRet}</div>
      <div class="kpi-val">${euro(projValue)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">FY Target</div>
      <div class="kpi-val">${fyRequired ? euro(fyRequired) : 'No extra pot needed'}</div>
    </div>
    <div class="kpi-card ${cls}">
      <div class="kpi-label">${gap>=0?'Surplus vs FY':'Shortfall vs FY'}</div>
      <div class="kpi-val">${euro(Math.abs(gap))}</div>
    </div>
  `;
}

// Current age helper (same approach FY uses)
function yrDiff(d, refDate = new Date()) {
  return (refDate - d) / (1000 * 60 * 60 * 24 * 365.25);
}

function activeProjection() {
  if (!lastPensionOutput) return {};
  const show = !!(useMax || lastPensionOutput.showMax);
  const labels = (show ? lastPensionOutput.maxBalances : lastPensionOutput.balances) || [];
  const valueAtRet = labels.at(-1)?.value || 0;
  return {
    show,
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

function renderSummary() {
  if (!lastFYOutput || !lastPensionOutput) return;
  const root = document.getElementById('resultsSummary');
  if (!root) return;

  const ap = activeProjection();
  const fy = lastFYOutput.requiredPot || 0;
  const gap = ap.valueAtRet - fy;
  const cls = gap >= 0 ? 'ok' : (gap < -0.15*(fy||1) ? 'danger' : 'warn');

  const msg = gap >= 0
    ? `You’re on track. Projected pot is ${euro(ap.valueAtRet)} — about ${euro(Math.abs(gap))} above your FY target.`
    : `Possible shortfall. Projected pot is ${euro(ap.valueAtRet)} — about ${euro(Math.abs(gap))} below your FY target.`;

  const actions = gap >= 0
    ? `<button class="action-btn" id="actExplore">Explore “what-if”</button>`
    : `<button class="action-btn" id="actContrib">Add €200/mo</button>
       <button class="action-btn" id="actDelay">Delay retirement 1 yr</button>`;

  root.className = `summary-row ${cls}`;
  root.innerHTML = `
    <div class="headline">${msg}</div>
    <div class="actions">${actions}</div>
  `;

  document.getElementById('actContrib')?.addEventListener('click', () => {
    document.getElementById('fullMontyModal')?.classList.add('is-open');
    document.body.classList.add('modal-open');
  });
  document.getElementById('actDelay')?.addEventListener('click', () => {
    document.getElementById('fullMontyModal')?.classList.add('is-open');
    document.body.classList.add('modal-open');
  });
}

function ensureCaptions() {
  const captions = [
    { selector: '#growthChart', text: 'Higher curve = more freedom later. Dotted lines show targets/limits.' },
    { selector: '#contribChart', text: 'Green is money you add. Orange is growth from investing.' },
    { selector: '#ddBalanceChart', text: 'Aim to stay above €0 until age 100. Purple shows FY pot for comparison.' },
    { selector: '#ddCashflowChart', text: 'Bars show income sources (green + blue). White line is what you plan to spend.' }
  ];
  for (const c of captions) {
    const card = document.querySelector(c.selector)?.closest('.chart-card');
    if (!card) continue;
    if (!card.querySelector('.caption')) {
      const div = document.createElement('div');
      div.className = 'caption';
      div.textContent = c.text;
      card.appendChild(div);
    }
  }
}

function drawCharts() {
  if (!lastPensionOutput || !lastFYOutput) return;
  const g = $('#growthChart'), c = $('#contribChart');
  if (!g || !c) { console.warn('[FM Results] canvases not found'); return; }

  const { retirementYear, contribsBase, growthBase, contribsMax, growthMax, sftLimit } = lastPensionOutput;
  const fy = lastFYOutput;

  const ap = activeProjection();
  const labels = ap.labelsAges.map(a => `Age ${a}`);

  const datasets = [
    {
      label: useMax ? 'Max Contribution' : 'Your Projection',
      data: ap.balances,
      borderColor: useMax ? '#0099ff' : '#00ff88',
      backgroundColor: useMax ? 'rgba(0,153,255,0.10)' : 'rgba(0,255,136,0.15)',
      fill: true,
      tension: 0.25
    }
  ];

  if (fy.requiredPot && fy.requiredPot > 0) {
    datasets.push({
      label: `FY Target (${euro(fy.requiredPot)})`,
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
    label: `SFT (${euro(sft)})`,
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
              return `Gap vs FY: ${euro(gap)}`;
            }
          }
        }
      },
      scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>'€'+v.toLocaleString() } } }
    }
  });

  const dataC = useMax ? contribsMax : contribsBase;
  const dataG = useMax ? growthMax   : growthBase;

  if (contribChart) contribChart.destroy();
  contribChart = new Chart(c, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Contributions', data:dataC, backgroundColor: useMax ? '#0099ff' : '#00ff88', stack:'s1' },
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

  renderKPIs({ projValue: ap.valueAtRet, balances: (useMax ? lastPensionOutput.maxBalances : lastPensionOutput.balances) }, fy.requiredPot);

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

  // Sim paths: FY pot (requiredPot) vs projected accumulation pot
  const retireAge = +d.retireAge || (lastPensionOutput?.balances?.[0]?.age ?? 65);
  const endAge = 100;
  const growthRate = Number.isFinite(+d.growthRate) ? +d.growthRate : (lastPensionOutput?.growth ?? 0.05);

  const startPotProj = ap.valueAtRet;

  const simFY = simulateDrawdown({
    startPot: Math.max(0, lastFYOutput.requiredPot || 0),
    retireAge, endAge,
    spendAtRet, rentAtRet,
    includeSP: !!d.statePensionSelf || !!d.statePension,           // tolerate either name
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

  const simProj = simulateDrawdown({
    startPot: Math.max(0, startPotProj || 0),
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

  const depletionIndex = simProj.depleteAge
    ? simProj.ages.findIndex(a => a === simProj.depleteAge)
    : -1;

  const depletionDataset = (depletionIndex > 0) ? {
    type: 'line',
    label: `Projected pot depletes @ age ${simProj.depleteAge}`,
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
          label: useMax ? 'Balance (Max contribs)' : 'Balance (Projected pot)',
          data: simProj.balances,
          borderColor: useMax ? '#0099ff' : '#00ff88',
          backgroundColor: useMax ? 'rgba(0,153,255,0.10)' : 'rgba(0,255,136,0.10)',
          fill: true,
          tension: 0.28
        },
        {
          label: 'Balance (FY pot)',
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
  if (ddCashflowChart) ddCashflowChart.destroy();
  ddCashflowChart = new Chart(cflCan, {
    type: 'bar',
    data: {
      labels: simProj.ages.map(a => `Age ${a}`),
      datasets: [
        { label:'Pension withdrawals', data: simProj.pensionDraw, backgroundColor: useMax ? '#0099ff' : '#00ff88', stack:'s1' },
        { label:'Other income (SP / Rent / DB)', data: simProj.otherInc, backgroundColor: '#0099ff', stack:'s1' },
        { type:'line', label:'Total income need', data: simProj.reqLine, borderColor:'#ffffff', borderWidth:2, pointRadius:0, fill:false }
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

  ensureCaptions();
  renderSummary();

  // Optional: console flag for depletion
  if (simProj.depleteAge) {
    console.warn(`[Drawdown] Projected pot depletes at age ${simProj.depleteAge}.`);
  }
}

function tryRender() {
  if (lastPensionOutput && lastFYOutput) {
    lastPensionOutput.showMax = !!useMax;
    drawCharts();
  }
}

// Listen for inputs from the wizard:
// 1) Pension engine should dispatch 'fm-pension-output' with computed arrays.
document.addEventListener('fm-pension-output', (e) => {
  console.debug('[FM Results] got fm-pension-output', e.detail);
  lastPensionOutput = e.detail;
  tryRender();
});

// 2) Wizard emits 'fm-run-fy' with raw args; compute FY immediately.
document.addEventListener('fm-run-fy', (e) => {
  console.debug('[FM Results] got fm-run-fy', e.detail);
  const d = e.detail;
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
  // NEW: stash raw inputs for drawdown simulation
  fy._inputs = { ...d };

  lastFYOutput = fy;
  tryRender();
});
