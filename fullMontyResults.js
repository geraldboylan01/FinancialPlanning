// fullMontyResults.js
import { fyRequiredPot } from './shared/fyRequiredPot.js';
import { sftForYear } from './shared/assumptions.js';

let lastPensionOutput = null; // { balances, projValue, retirementYear, contribsBase, growthBase, (optional) maxBalances, contribsMax, growthMax, sftLimit }
let lastFYOutput = null;      // { requiredPot, retirementYear, alwaysSurplus, sftWarningStripped }
let growthChart = null;
let contribChart = null;

const $ = (s)=>document.querySelector(s);
const euro = (n)=>'€' + (Math.round(n||0)).toLocaleString();

console.debug('[FM Results] loaded');

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

function drawCharts() {
  if (!lastPensionOutput || !lastFYOutput) return;
  const g = $('#growthChart'), c = $('#contribChart');
  if (!g || !c) { console.warn('[FM Results] canvases not found'); return; }

  const { balances, projValue, retirementYear, contribsBase, growthBase, maxBalances, contribsMax, growthMax, sftLimit, showMax } = lastPensionOutput;
  const fy = lastFYOutput;
  const labels = balances.map(b => `Age ${b.age}`);
  const datasets = [
    {
      label: 'Your Projection',
      data: balances.map(b => b.value),
      borderColor: '#00ff88',
      backgroundColor: 'rgba(0,255,136,0.15)',
      fill: true,
      tension: 0.25
    }
  ];
  if (showMax && maxBalances) {
    datasets.push({
      label: 'Max Contribution',
      data: maxBalances.map(b => b.value),
      borderColor: '#0099ff',
      fill: false,
      tension: 0.25
    });
  }
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
              const val = lastPensionOutput?.balances?.[idx]?.value || 0;
              const gap = lastFYOutput?.requiredPot ? (val - lastFYOutput.requiredPot) : 0;
              return `Gap vs FY: ${euro(gap)}`;
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

  renderKPIs({ projValue, balances }, fy.requiredPot);
}

function tryRender() {
  if (lastPensionOutput && lastFYOutput) drawCharts();
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
  lastFYOutput = fy;
  tryRender();
});
