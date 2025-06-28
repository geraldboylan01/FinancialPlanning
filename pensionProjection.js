import { drawBanner, getBannerHeight } from './pdfWarningHelpers.js';
const MAX_SALARY_CAP = 115000;
const AGE_BANDS = [
  { max: 29,  pct: 0.15 },
  { max: 39,  pct: 0.20 },
  { max: 49,  pct: 0.25 },
  { max: 54,  pct: 0.30 },
  { max: 59,  pct: 0.35 },
  { max: 120, pct: 0.40 }
];

  // ─── Standard Fund Threshold schedule ──────────────────────────
function sftForYear(year) {
  if (year < 2026) return 2000000;
  if (year <= 2029) return 2000000 + 200000 * (year - 2025);
  return 2800000;
}

let growthChart = null;
let contribChart = null;
let contribsBase = [], growthBase = [];
let contribsMax  = [], growthMax  = [];
let balances = [],       // base scenario data
    currentPv,           // starting value
    curAge,              // current age
    yearsToRet,
    salaryCapped,
    personalUsed,
    employerCalc,
    gRate,
    retireAge;
  let sftLimitGlobal = 0;   // holds the SFT that applies to the retirement year
let latestRun = null;

const ASSUMPTIONS_TABLE = [
  ['Max reckonable salary', '€115,000'],
  ['Personal contribution limit', '15%–40% of salary based on age'],
  ['Employer contributions', 'No limit beyond salary'],
  ['Investment growth', '4 %–7 % depending on chosen profile'],
  ['Projection period', 'From today to retirement age'],
  ['Revenue rules modelled', 'No tax or compulsory withdrawals'],
  ['Standard Fund Threshold', 'Compared to retirement-year limit']
];

const LABEL_MAP = {
  salary: 'Gross salary (€)',
  currentValue: 'Current pension value (€)',
  personalContrib: 'Your annual pension contribution (€)',
  personalPct: 'Personal contribution (%)',
  employerContrib: 'Employer contribution (€)',
  employerPct: 'Employer contribution (%)',
  dob: 'Your date of birth',
  retireAge: 'Retirement age',
  growth: 'Growth rate selected'
};

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.querySelector('#assumptions-table tbody');
  if (tbody) {
    ASSUMPTIONS_TABLE.forEach(r => {
      const tr=document.createElement('tr');
      r.forEach(c=>{ const td=document.createElement('td'); td.textContent=c; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
  }

  function exclusify(euroId, pctId) {
    const euro = document.getElementById(euroId);
    const pct  = document.getElementById(pctId);

    const handleEuro = () => {
      if (euro.value !== '') {
        pct.value = '';
        pct.disabled = true;
      } else {
        pct.disabled = false;
      }
    };

    const handlePct = () => {
      if (pct.value !== '') {
        euro.value = '';
        euro.disabled = true;
      } else {
        euro.disabled = false;
      }
    };

    euro.addEventListener('input', handleEuro);
    pct.addEventListener('input', handlePct);
    handleEuro();
    handlePct();
  }

  exclusify('personalContrib', 'personalPct');
  exclusify('employerContrib', 'employerPct');
});


// Helpers
function ageInYears(date, ref) {
  return (ref - date) / (1000*60*60*24*365.25);
}
function maxPersonalPct(age) {
  return AGE_BANDS.find(b => age <= b.max).pct;
}
function maxPersonalByAge(age, capSalary) {
  return maxPersonalPct(Math.floor(age)) * capSalary;
}

// Injects the checkbox under the chart once
function ensureMaxToggleExists() {
  if (document.getElementById('maxToggle')) return;
  const div = document.createElement('div');
  div.className = 'form-group';
  div.style.marginTop = '1rem';
  div.innerHTML = `
    <label>
      <input type="checkbox" id="maxToggle">
      Show max-contribution scenario
    </label>
  `;
  document.querySelector('#chart-container')
          .insertAdjacentElement('afterend', div);
  document.getElementById('maxToggle')
          .addEventListener('change', drawChart);
}
  function showSFTWarning(projectedValue, sftLimit, year) {
  const modal   = document.getElementById('sftModal');
  const message = document.getElementById('sftMessage');
  message.innerHTML = `
    Your projected pension value is <strong>€${projectedValue.toLocaleString()}</strong>,
    which exceeds the Standard Fund Threshold for ${year} (<strong>€${sftLimit.toLocaleString()}</strong>).
  `;
  modal.style.display = 'flex';
}

// Close handlers (runs once)
document.getElementById('sftClose').onclick = () =>
  document.getElementById('sftModal').style.display = 'none';

window.onclick = e => {
  if (e.target.id === 'sftModal')
    document.getElementById('sftModal').style.display = 'none';
};
  window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('sftModal').style.display = 'none';
  }
});



// Draws the chart (base + optional max line) and appends explanatory note
function drawChart() {
  const showMax   = document.getElementById('maxToggle')?.checked;
  const datasets  = [];
  const labels    = balances.map(b => `Age ${b.age}`);

  /* ─── 1. BASE-LINE DATASET ───────────────────────────── */
  datasets.push({
    label: 'Your Projection',
    data:  balances.map(b => b.value),
    borderColor: '#00ff88',
    backgroundColor: 'rgba(0,255,136,0.15)',
    fill: true,
    tension: 0.25
  });

  /* ─── 2. OPTIONAL MAX-CONTRIB DATASET ────────────────── */
  let maxBalances = [];
  contribsMax = [];
  growthMax   = [];
  if (showMax) {
    let maxBal = currentPv;

    // 1️⃣ starting value
    maxBalances.push({
      age: Math.floor(curAge),
      value: Math.round(maxBal)
    });
    contribsMax.push(0);
    growthMax.push(0);

    // 2️⃣ annual growth + max contrib
    for (let y = 1; y <= yearsToRet; y++) {
      const balBefore = maxBal;
      const ageNext     = curAge + y;
      const personalMax = maxPersonalByAge(ageNext, salaryCapped);
      maxBal = maxBal * (1 + gRate) + personalMax + employerCalc;
      contribsMax.push(Math.round(personalMax + employerCalc));
      growthMax.push(Math.round(maxBal - balBefore - (personalMax + employerCalc)));
      maxBalances.push({
        age: Math.floor(ageNext),
        value: Math.round(maxBal)
      });
    }

    datasets.push({
      label: 'Max Contribution',
      data: maxBalances.map(b => b.value),
      borderColor: '#0099ff',
      fill: false,
      tension: 0.25
    });
  }

  /* ─── 3. ADD RED SFT LINE IF NEEDED ──────────────────── */
  const baseCrosses = balances.some(b => b.value >= sftLimitGlobal);
  const maxCrosses  = showMax && maxBalances.some(b => b.value >= sftLimitGlobal);

  if (baseCrosses || maxCrosses) {
    datasets.push({
      label: `SFT (€${sftLimitGlobal.toLocaleString()})`,
      data:  labels.map(() => sftLimitGlobal),
      borderColor: '#ff4d4d',
      borderDash: [8, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0,
      order: 0
    });
  }

  /* ─── 4. RENDER / RERENDER THE CHART ─────────────────── */
  if (growthChart) growthChart.destroy();
  growthChart = new Chart(document.getElementById('growthChart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#ccc',
            font: { size: 12 },
            padding: 8
          }
        },
        title: {
          display: true,
          text: 'Projected Pension Value',
          color: '#fff',
          font: { size: 16, weight: 'bold' },
          padding: { top: 10, bottom: 6 }
        }
      },
      scales: {
        y: {
          beginAtZero: true,         // ← ensures the Y-axis always starts at 0
          ticks: { callback: v => '€' + v.toLocaleString() }
        }
      }   // ← closes `scales`
    }     // ← closes `options`
  });    // ← closes `new Chart(...)`

  drawContribChart(showMax);

  /* ─── 5. BUILD / SHOW THE MAX-BANDS TABLE & NOTES ────── */
  // First clear any previous injects
  const results = document.getElementById('results');
  results.querySelectorAll(
    '.max-note, .age-table, .salary-cap-note'
  ).forEach(el => el.remove());

  if (showMax) {
    // Build the HTML exactly as before
    const bandLabels = [
      'Up&nbsp;to&nbsp;29', '30&nbsp;–&nbsp;39', '40&nbsp;–&nbsp;49',
      '50&nbsp;–&nbsp;54', '55&nbsp;–&nbsp;59', '60&nbsp;+'
    ];
    const currentAge = Math.floor(curAge);
    const bandIndex  = AGE_BANDS.findIndex(b => currentAge <= b.max);
    const rowsHtml   = AGE_BANDS.map((band, i) => `
      <tr class="${i === bandIndex ? 'highlight' : ''}">
        <td>${bandLabels[i]}</td>
        <td>${(band.pct * 100).toFixed(0)} %</td>
        <td>€${(band.pct * salaryCapped).toLocaleString()}</td>
      </tr>`).join('');

    const maxValue = maxBalances.at(-1)?.value ?? currentPv;
    const extraHTML = `
      <p class="max-note">
        <em>Max-contribution value at ${retireAge}:
        <strong>€${maxValue.toLocaleString()}</strong></em>
      </p>

      <div class="table-scroll">
        <table class="age-table">
          <thead>
            <tr><th>Age&nbsp;band</th><th>Max&nbsp;%</th>
                <th>Max&nbsp;€ (on&nbsp;€${salaryCapped.toLocaleString()})</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      <p class="salary-cap-note">
        <strong>Note:</strong> Your current age (${currentAge}) is highlighted.
        Personal limits are calculated on a max reckonable salary of €115,000;
        employer contributions are <strong>not</strong> subject to this cap.
      </p>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = extraHTML;
    results.append(wrapper);
  }
}


function drawContribChart(showMax) {
  const labels = balances.map(b => `Age ${b.age}`);
  const dataC  = showMax ? contribsMax  : contribsBase;
  const dataG  = showMax ? growthMax    : growthBase;
  const colourContrib = showMax ? '#0099ff' : '#00ff88';

  if (contribChart) contribChart.destroy();

  contribChart = new Chart(document.getElementById('contribChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Contributions',
          data: dataC,
          backgroundColor: colourContrib,
          stack: 'stack1'
        },
        {
          label: 'Investment growth',
          data: dataG,
          backgroundColor: '#ff9933',
          stack: 'stack1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#ccc',
            font: { size: 12 },
            padding: 8
          }
        },
        title: {
          display: true,
          text: 'Annual Contributions & Investment Growth',
          color: '#fff',
          font: { size: 16, weight: 'bold' },
          padding: { top: 10, bottom: 6 }
        }
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { callback: v => '€' + v.toLocaleString() }
        }
      }
    }
  });
}

// Form handler
document.getElementById('proj-form').addEventListener('submit', e => {
  e.preventDefault();
  try {
    // Inputs
    const salaryRaw  = +document.getElementById('salary').value;
    salaryCapped    = Math.min(salaryRaw, MAX_SALARY_CAP);
    currentPv       = +document.getElementById('currentValue').value;
    const personalRaw = +document.getElementById('personalContrib').value || 0;
const personalPct = (+document.getElementById('personalPct').value || 0) / 100;

const employerRaw = +document.getElementById('employerContrib').value || 0;
const employerPct = (+document.getElementById('employerPct').value || 0) / 100;
employerCalc      = employerRaw > 0 ? employerRaw : salaryRaw * employerPct;

    retireAge       = +document.getElementById('retireAge').value;
    gRate           = +document.querySelector('input[name="growth"]:checked').value;
    const dob       = new Date(document.getElementById('dob').value);

    if (!salaryRaw || !currentPv || isNaN(dob)) {
      throw 'Please fill salary, DOB and current value';
    }

    // Personal contributions capped by age band
    curAge  = ageInYears(dob, new Date());
    const personalCalc = personalRaw > 0
      ? personalRaw
      : salaryCapped * personalPct;
    const limitValue   = maxPersonalPct(Math.floor(curAge)) * salaryCapped;
    personalUsed       = Math.min(personalCalc, limitValue);

    // ─── Build balances (base scenario) ─────────────────────────────
    const yearsToRetInt = Math.ceil(retireAge - curAge);   // integer!
    yearsToRet = yearsToRetInt;     // keep global in sync

    balances = [];
    let bal = currentPv;

    // 1️⃣ push the pot *at submission time*
    balances.push({
      age: Math.floor(curAge),
      value: Math.round(bal)
    });

    contribsBase   = [0];   // no contribution before projection starts
    growthBase     = [0];

    // 2️⃣ now grow + contribute for each full year up to retirement
      for (let y = 1; y <= yearsToRetInt; y++) {
        const balBefore = bal;
        bal = bal * (1 + gRate) + personalUsed + employerCalc;
        contribsBase.push(Math.round(personalUsed + employerCalc));
        growthBase.push(Math.round(bal - balBefore - (personalUsed + employerCalc)));
        balances.push({
          age: Math.floor(curAge) + y,
          value: Math.round(bal)
        });
      }

    // Show base results
    const projValue      = balances.at(-1).value;
const retirementYear = new Date().getFullYear() + Math.ceil(yearsToRet);
const sftLimit       = sftForYear(retirementYear);
sftLimitGlobal = sftLimit;

  let sftAssumpWarning = '';
  if (retirementYear >= 2030) {
    sftAssumpWarning = `
      <div class="warning-block">
        ⚠️ <strong>Important Warning – Standard Fund Threshold (SFT) Assumptions</strong><br><br>
        This pension projection tool uses the Standard Fund Threshold (SFT) figures as published by the Irish Government for each year up to and including 2029. These are the most recent years for which official, fixed SFT values have been confirmed.<br><br>
        While the Government has indicated that the SFT will increase in line with wage inflation beyond 2029, no definitive figures or formulae have been published to date. As a result, this tool does not project future increases to the SFT beyond 2029, as doing so would require speculative or unreliable assumptions.<br><br>
        Users should be aware that actual SFT limits post-2029 may differ significantly depending on future policy decisions and economic conditions. We recommend consulting a qualified financial advisor for guidance specific to your circumstances.
      </div>`;
  }

let ageWarning = '';
if (retireAge < 50) {
  ageWarning = `
    <div class="warning-block danger">
      ⛔ <strong>Retiring Before Age 50</strong><br><br>
      Under Irish Revenue rules, pensions cannot be accessed before age 50, except in rare cases such as ill-health retirement.<br>
      These projections are illustrative only — professional guidance is strongly recommended.
    </div>`;
} else if (retireAge < 60) {
  ageWarning = `
    <div class="warning-block">
      ⚠️ <strong>Retiring Between Age 50–59</strong><br><br>
      Access to pension benefits before the usual retirement age is only possible in limited cases.<br><br>
      Typical Normal Retirement Ages (NRAs) are:<br>
      60–70 for most occupational pensions<br>
      60–75 for PRSAs and Personal Retirement Bonds (PRBs)<br><br>
      Early access (from age 50) may be possible only if certain Revenue conditions are met — e.g.:<br>
      You’ve left employment linked to the pension<br>
      You’re a proprietary director who fully severs ties with the sponsoring company<br><br>
      Please seek professional advice before relying on projections assuming early access.
    </div>`;
} else if (retireAge < 70) {
  // Ages 60–69: no warning block needed
  ageWarning = '';
} else if (retireAge < 75) {
  ageWarning = `
    <div class="warning-block">
      ⚠️ <strong>Retirement Age Over 70 (Occupational Pensions &amp; PRBs)</strong><br><br>
      Most occupational pensions and Personal Retirement Bonds (PRBs) must be drawn down by age 70 under Irish Revenue rules.<br>
      If your selected retirement age is over 70, please be aware this may not be allowed for those pension types.<br><br>
      Note: The exception to this is PRSAs, which can remain unretired until age 75.<br><br>
      Please seek professional advice to ensure your retirement plan complies with pension access rules.
    </div>`;
} else {
  ageWarning = `
    <div class="warning-block danger">
      ⛔ <strong>Retirement Age 75 and Over</strong><br><br>
      Under Irish Revenue rules, all pensions — including PRSAs — must be accessed by age 75.<br>
      If benefits are not drawn down by this age, the pension is automatically deemed to vest, and the full value may be treated as taxable income.<br>
      These projections are illustrative only — professional guidance is strongly recommended.
    </div>`;
}

const resultsHTML = `
  <p>
    Max personal contribution allowed (age ${Math.floor(curAge)}):
    <strong>€${limitValue.toLocaleString()}</strong>
  </p>
  <p>
    Using <strong>€${personalUsed.toLocaleString()}</strong> personal +
    <strong>€${employerCalc.toLocaleString()}</strong> employer each year.
  </p>
  <h2>
    Projected value at age ${retireAge}:<br>
    <strong>€${projValue.toLocaleString()}</strong>
  </h2>
` + ageWarning + sftAssumpWarning;

let sftWarningHTML = '';
if (projValue > sftLimit) {
  sftWarningHTML = `Your projected pension value is <strong>€${projValue.toLocaleString()}</strong>, which exceeds the Standard Fund Threshold for ${retirementYear} (<strong>€${sftLimit.toLocaleString()}</strong>).`;
  showSFTWarning(projValue, sftLimit, retirementYear);
}

    

    // Inject toggle and draw
    ensureMaxToggleExists();
    drawChart();

    function captureCharts () {
      const gCan = growthChart.canvas,
            cCan = contribChart.canvas;
      latestRun.chartImgs = {
        growth : gCan.toDataURL('image/png',1.0),
        contrib: cCan.toDataURL('image/png',1.0)
      };
      latestRun.chartDims = {
        growth : { w: gCan.clientWidth, h: gCan.clientHeight },
        contrib: { w: cCan.clientWidth, h: cCan.clientHeight }
      };
    }

    function gatherData(value, year, sftText) {
      const inputs = {
        salary: +document.getElementById('salary').value || 0,
        currentValue: +document.getElementById('currentValue').value || 0,
        personalContrib: +document.getElementById('personalContrib').value || 0,
        personalPct: +document.getElementById('personalPct').value || 0,
        employerContrib: +document.getElementById('employerContrib').value || 0,
        employerPct: +document.getElementById('employerPct').value || 0,
        dob: document.getElementById('dob').value,
        retireAge: +document.getElementById('retireAge').value || 0,
        growth: +document.querySelector('input[name="growth"]:checked').value
      };
      const outputs = {
        projectedValue: value,
        retirementYear: year,
        sftMessage: sftText
      };
      return { inputs, outputs, assumptions: ASSUMPTIONS_TABLE };
    }

    const sftPlain = sftWarningHTML
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+>/g, '');
    latestRun = gatherData(projValue, retirementYear, sftPlain);
    captureCharts();

    const stepMap = {
      personalContrib: 'personalPair',
      personalPct: 'personalPair',
      employerContrib: 'employerPair',
      employerPct: 'employerPair'
    };

    const rows = Object.entries(latestRun.inputs)
      .map(([k,v])=>{
        const label = LABEL_MAP[k] ?? k;
        let val = v;
        if (k === 'salary' || k === 'currentValue' ||
            k === 'personalContrib' || k === 'employerContrib') {
          val = fmtEuro(+v || 0);
        } else if (k === 'growth') {
          val = (+(v) * 100).toFixed(0) + ' %';
        } else if (k === 'personalPct' || k === 'employerPct') {
          val = (+v).toFixed(1).replace(/\.0$/, '') + ' %';
        }
        const step = stepMap[k] ?? k;
        return `<tr><td>${label}</td><td>${val}</td>`+
               `<td><span class="edit" onclick="wizard.open('${step}')">✏️</span></td></tr>`;
      }).join('');
    const tableHTML = `<h3>Inputs</h3><table class="assumptions-table"><tbody>${rows}</tbody></table>`;
    document.getElementById('results').innerHTML = tableHTML + resultsHTML;

    latestRun.warningBlocks = [...document.querySelectorAll('#results .warning-block, #postCalcContent .warning-block')].map(el => {
      const strong = el.querySelector('strong');
      const headText = strong ? strong.innerText.trim() : el.innerText.split('\n')[0].trim();
      const clone = el.cloneNode(true);
      if (strong) clone.removeChild(clone.querySelector('strong')); else clone.innerHTML = clone.innerHTML.replace(/^[\s\S]*?<br\s*\/?>/, '');
      const bodyHTML = clone.innerHTML.replace(/^[\s\uFEFF\u200B]*(⚠️|⛔)/, '').trim();
      return { title: headText.replace(/^\s*⚠️|⛔\s*/, '').trim(), body: bodyHTML, danger: el.classList.contains('danger') };
    });
    const mandatoryWarn = latestRun.warningBlocks.find(w => w.title.startsWith('Important Notice'));
    latestRun.mandatoryWarn = mandatoryWarn;
    latestRun.otherWarns = latestRun.warningBlocks.filter(w => w !== mandatoryWarn);

    document.getElementById('postCalcContent').style.display = 'block';

    document.getElementById('console').textContent = '';
  } catch (err) {
    document.getElementById('console').textContent = err;
    if (growthChart) growthChart.destroy();
    if (contribChart) contribChart.destroy();
  }
});

document.getElementById('downloadPdf').addEventListener('click', generatePDF);

function fmtEuro(n) { return '€' + n.toLocaleString(); }

function generatePDF() {
  if (!latestRun) return;

  const BG_DARK = '#1a1a1a';
  const ACCENT_GREEN = '#00ff88';
  const ACCENT_CYAN = '#0099ff';
  const COVER_GOLD = '#BBA26F';

  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const pageBG = () => { doc.setFillColor(BG_DARK); doc.rect(0,0,pageW,pageH,'F'); };
  const addFooter = n => {
    doc.setFontSize(9).setTextColor(120);
    const t = `Page ${n}`;
    doc.text(t, pageW - doc.getTextWidth(t) - 40, pageH - 30);
  };

  function placeBanner(doc,warn) {
    const hLeft = getBannerHeight(doc,warn,colW);
    const hRight = hLeft;
    const footerY = pageH - 40;
    if (leftY + hLeft <= footerY) {
      drawBanner(doc,warn,40,leftY,colW); leftY += hLeft + 18; return; }
    if (rightY + hRight <= footerY) {
      drawBanner(doc,warn,chartX,rightY,colW); rightY += hRight + 18; return; }
    addFooter(pageNo++); doc.addPage(); pageBG();
    leftY = rightY = 60; drawBanner(doc,warn,40,leftY,colW); leftY += hLeft + 18;
  }

  /* COVER */
  pageBG();
  doc.setFont('times','bold').setFontSize(48).setTextColor(COVER_GOLD)
     .text('Planéir', pageW/2, 90, {align:'center'});
  const logoW = 220; const logoY = 130;
  doc.addImage('./favicon.png','PNG',(pageW-logoW)/2, logoY, logoW,0,'','FAST');
  const subY = logoY + logoW + 40;
  doc.setFontSize(32).setFont(undefined,'bold').setTextColor(COVER_GOLD);
  doc.text('Pension Growth Projection', pageW/2, subY, {align:'center'});
  doc.setFont('times','normal');
  addFooter(1); doc.addPage();

  /* ASSUMPTIONS PAGE */
  pageBG();
  let y = 60;
  doc.setFontSize(18).setFont(undefined,'bold').setTextColor(ACCENT_CYAN);
  doc.text('Assumptions',50,y); y+=14;
  doc.autoTable({ startY:y, margin:{left:40,right:40}, head:[['Assumption','Value']],
    body: ASSUMPTIONS_TABLE,
    headStyles:{ fillColor:ACCENT_CYAN, textColor:'#000' },
    bodyStyles:{ fillColor:'#2a2a2a', textColor:'#fff' },
    alternateRowStyles:{ fillColor:'#242424', textColor:'#fff' }
  });

  const boxMargin=30, boxX=boxMargin, boxW=pageW-boxMargin*2, boxY=doc.lastAutoTable.finalY+35;
  const heading='How this projection works';
  const body="•  Starts with your current pension value and planned contributions."+
    "\n\n•  Applies your chosen growth rate each year."+
    "\n\n•  Alerts you if the projected value breaches the Standard Fund Threshold.";
  doc.setFontSize(16).setFont(undefined,'bold'); const headingHeight=22;
  doc.setFontSize(14); const wrapped=doc.splitTextToSize(body, boxW-48);
  const lineHeight=18; const bodyHeight=wrapped.length*lineHeight;
  const boxH=32+headingHeight+14+bodyHeight+24;
  doc.setFillColor('#222').setDrawColor(ACCENT_CYAN).setLineWidth(2)
     .roundedRect(boxX,boxY,boxW,boxH,14,14,'FD');
  let cy=boxY+32;
  doc.setFontSize(16).setFont(undefined,'bold').setTextColor(ACCENT_CYAN);
  doc.text(heading, boxX+24, cy); cy+=headingHeight+14;
  doc.setFontSize(14).setFont(undefined,'normal').setTextColor('#fff');
  doc.text(wrapped, boxX+24, cy, {lineHeightFactor:1.3});
  addFooter(2); doc.addPage(); pageBG();

  /* PAGE 3 */
  let y3=60; doc.setFontSize(18).setFont(undefined,'bold').setTextColor(ACCENT_CYAN);
  doc.text('Inputs & results',50,y3); y3+=22;
  const columnGap=20; const colW=(pageW-40*2-columnGap)/2;
  doc.autoTable({ startY:y3, margin:{left:40,right:40+colW+columnGap}, head:[['Input','Value']],
    body:Object.entries(latestRun.inputs).map(([k,v])=>[LABEL_MAP[k]??k,String(v||'—')]),
    headStyles:{ fillColor:ACCENT_CYAN, textColor:'#000' },
    bodyStyles:{ fillColor:'#2a2a2a', textColor:'#fff' },
    alternateRowStyles:{ fillColor:'#242424', textColor:'#fff' },
    columnStyles:{0:{cellWidth:colW*0.4}}
  });
  let tableEnd=doc.lastAutoTable.finalY+12;
  const metrics=[
    ['Projected value (€)', fmtEuro(latestRun.outputs.projectedValue)],
    ['Retirement year', latestRun.outputs.retirementYear]
  ];
  if(latestRun.outputs.sftMessage) metrics.push(['SFT warning', latestRun.outputs.sftMessage]);
  doc.autoTable({ startY:tableEnd, margin:{left:40,right:40+colW+columnGap}, head:[['Metric','Value']],
    body:metrics,
    headStyles:{ fillColor:ACCENT_CYAN, textColor:'#000' },
    bodyStyles:{ fillColor:'#2a2a2a', textColor:'#fff' },
    alternateRowStyles:{ fillColor:'#242424', textColor:'#fff' },
    columnStyles:{0:{cellWidth:colW*0.4}}
  });

  let leftY=doc.lastAutoTable.finalY+16;
  const chartX=40+colW+columnGap; let chartY=y3; const chartW=colW;
  const gR=latestRun.chartDims.growth.h/latestRun.chartDims.growth.w;
  const cR=latestRun.chartDims.contrib.h/latestRun.chartDims.contrib.w;
  doc.addImage(latestRun.chartImgs.growth,'PNG',chartX,chartY,chartW,chartW*gR,'','FAST'); chartY+=chartW*gR+12;
  doc.addImage(latestRun.chartImgs.contrib,'PNG',chartX,chartY,chartW,chartW*cR,'','FAST'); chartY+=chartW*cR+12;

  let rightY=chartY+12; let pageNo=3;
  const allWarns=[]; if(latestRun.mandatoryWarn) allWarns.push(latestRun.mandatoryWarn); allWarns.push(...latestRun.otherWarns);
  allWarns.forEach(w=>placeBanner(doc,w));
  addFooter(pageNo);
  doc.save('planéir_report.pdf');
  const pdfUrl=doc.output('bloburl');
  import('./consentModal.js').then(m=>m.showConsent(pdfUrl));
}

