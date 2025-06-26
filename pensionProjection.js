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

let ageWarning = '';
if (retireAge >= 75) {
  ageWarning = `
    <div class="warning-block danger">
      ⛔ Retirement Age 75 and Over<br>
      Under Irish Revenue rules, all pensions — including PRSAs — must be accessed by age 75.<br>
      If benefits are not drawn down by this age, the pension is automatically deemed to vest, and the full value may be treated as taxable income.<br>
      These projections are illustrative only — professional guidance is strongly recommended.
    </div>`;
} else if (retireAge >= 70) {
  ageWarning = `
    <div class="warning-block">
      ⚠️ Retirement Age Over 70 (Occupational Pensions &amp; PRBs)<br>
      Most occupational pensions and Personal Retirement Bonds (PRBs) must be drawn down by age 70 under Irish Revenue rules.<br>
      If your selected retirement age is over 70, please be aware this may not be allowed for those pension types.<br><br>
      Note: The exception to this is PRSAs, which can remain unretired until age 75.<br><br>
      Please seek professional advice to ensure your retirement plan complies with pension access rules.
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
` + ageWarning;

document.getElementById('results').innerHTML = resultsHTML;

if (projValue > sftLimit) {
  showSFTWarning(projValue, sftLimit, retirementYear);
}

    

    // Inject toggle and draw
    ensureMaxToggleExists();
    drawChart();

    document.getElementById('console').textContent = '';
  } catch (err) {
    document.getElementById('console').textContent = err;
    if (growthChart) growthChart.destroy();
    if (contribChart) contribChart.destroy();
  }
});

