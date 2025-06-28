import { drawBanner, getBannerHeight } from './pdfWarningHelpers.js';
const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
const CPI = 0.023;
const STATE_PENSION = 15044;
const SP_START = 66;
let balanceChart = null;
let cashflowChart = null;
let latestRun = null;
const ASSUMPTIONS_TABLE_CONSTANT = [
['Inflation (CPI)', '2.3 % per year, fixed'],
['Portfolio growth', '4 %–7 % depending on chosen risk profile'],
['Spending target', '% of gross salary, uprated by CPI'],
['Defined-Benefit pension', 'Stays flat until first payment, then increases with CPI'],
['Rental income', 'Inflates from today with CPI'],
['State Pension (Contributory)', '€15,044 p.a. from age 66, no indexation'],
['Projection horizon', 'From retirement age to age 100'],
['Withdrawal order', 'SPC / Rent / DB first, pension pot covers any shortfall'],
['Revenue rules modelled', 'No tax and no compulsory ARF withdrawals'],
['Standard Fund Threshold', 'Compared to Revenue limits for the retirement year']
];

const LABEL_MAP = {
grossIncome: 'Gross income (€)',
incomePercent: '% of income needed',
statePension: 'User gets State Pension',
partnerStatePension: 'Partner gets State Pension',
partnerExists: 'Partner / spouse?',
dob: 'Your date of birth',
partnerDob: 'Partner DOB',
retireAge: 'Retirement age',
growthRate: 'Growth rate selected',
rentalIncome: 'Current rental income (€)',
hasDb: 'Defined-Benefit pension?',
dbPension: 'DB pension at retirement (€)',
dbStartAge: 'DB pension start age'
};

// ─────────── Modal close handlers ───────────
document.getElementById('sftClose').onclick = () =>
document.getElementById('sftModal').style.display = 'none';
window.onclick = e => {
if (e.target.id === 'sftModal')
  document.getElementById('sftModal').style.display = 'none';
};

// ─── Standard Fund Threshold schedule ────────────────
function sftForYear(year) {
if (year < 2026) return 2000000;
if (year <= 2029) return 2000000 + 200000 * (year - 2025);
return 2800000; // 2030 onward
}

function yrDiff(d, ref) {
return (ref - d) / (1000 * 60 * 60 * 24 * 365.25);
}

document.addEventListener('DOMContentLoaded', () => {
document.getElementById('partnerStatePension').addEventListener('change', e => {
  document.getElementById('partner-dob-group').style.display = e.target.checked ? 'block' : 'none';
});

document.getElementById('hasDb').addEventListener('change', e => {
  document.getElementById('db-group').style.display = e.target.checked ? 'block' : 'none';
});

const tbody = document.querySelector('#assumptions-table tbody');
if (tbody) {
  ASSUMPTIONS_TABLE_CONSTANT.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(cell => {
const td = document.createElement('td');
td.textContent = cell;
tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

document.getElementById('fyf-form').addEventListener('submit', calc);
document.getElementById('downloadPdf').addEventListener('click', generatePDF);
});

     function calc(e) {
e.preventDefault();
try {
  // FIX: reset any previous SFT state
  document.getElementById('sftMessage').innerHTML = '';
  document.getElementById('sftModal').style.display = 'none';
  let sftWarningHTML = '';
  const gross = +document.getElementById('grossIncome').value || 0;
  const pctNeed = (+document.getElementById('incomePercent').value || 0) / 100;
  const includeSP = document.getElementById('statePension').checked;
  const includePartnerSP = document.getElementById('partnerStatePension').checked;
  const dob = new Date(document.getElementById('dob').value);
  const partnerDobStr = document.getElementById('partnerDob').value;
  const partnerDob = partnerDobStr ? new Date(partnerDobStr) : null;
  const retireAge = +document.getElementById('retireAge').value || 0;

  // ← Read the selected growth-rate card
  const gRate = +document.querySelector('input[name="growthRate"]:checked').value;

 const rentalToday = +document.getElementById('rentalIncome').value || 0;
 const hasDb = document.getElementById('hasDb').checked;
 const dbAnnual = hasDb ? (+document.getElementById('dbPension').value || 0) : 0;
 const dbStartAge = hasDb
   ? (+document.getElementById('dbStartAge').value || retireAge)
   : Infinity;

  if (!gross || !pctNeed || !dob || !retireAge)
    throw new Error('Fill all required numeric fields.');
  if (hasDb && (!dbAnnual || !document.getElementById('dbStartAge').value))
    throw new Error('Enter both the DB pension amount and the age it begins.');
  if (includePartnerSP && partnerDobStr === "")
    throw new Error('Enter partner DOB');

  const now = new Date();
  const curAge = yrDiff(dob, now);
  // ─── Validate retirement age ──────────────────────────────
  if (retireAge <= curAge) {
    const msg = 'Retirement age must be greater than your current age. ' +
        'Please enter a future age.';
    document.getElementById('console').textContent = msg;  // red error strip
    setHTML('results', '');          // clear any previous output
    return;                          // abort the projection early
  }
  const yrsToRet = retireAge - curAge;
  const yrsRet = 100 - retireAge;
  const partnerCurAge = partnerDob ? yrDiff(partnerDob, now) : null;
  const partnerAgeAtRet = partnerDob ? partnerCurAge + yrsToRet : null;

  const spendBase = gross * pctNeed;
  const spendAtRet = spendBase * Math.pow(1 + CPI, yrsToRet);
  const rentAtRet = rentalToday * Math.pow(1 + CPI, yrsToRet);

  // ─── Calculate required capital ─────────────────────────
  let reqCap = 0;
  let alwaysSurplus = true;
  for (let t = 0; t < yrsRet; t++) {
    const age = retireAge + t;
    const partnerAge = partnerDob ? partnerAgeAtRet + t : null;
    const infl = Math.pow(1 + CPI, t);
    const spend = spendAtRet * infl;
    const rent = rentAtRet * infl;
    const db = (hasDb && age >= dbStartAge) ? dbAnnual * infl : 0;
    let sp = 0;
    if (includeSP && age >= SP_START) sp += STATE_PENSION;
    if (includePartnerSP && partnerAge && partnerAge >= SP_START) sp += STATE_PENSION;
    const net = spend - sp - rent - db;
    if (net > 0) {
alwaysSurplus = false;
reqCap += net / Math.pow(1 + gRate, t + 1);
}

  }
  reqCap = Math.max(0, Math.round(reqCap / 1000) * 1000);

  // ─── SFT check ───────────────────────────────────────────
  const retirementYear = now.getFullYear() + Math.ceil(yrsToRet);
  const sftLimitSingle = sftForYear(retirementYear);
  const sftLimitCombined = includePartnerSP ? sftLimitSingle * 2 : sftLimitSingle;

  if (reqCap > sftLimitCombined) {
    const msg = includePartnerSP
? `The amount you and your partner require (€${reqCap.toLocaleString()}) is above the combined Standard Fund Threshold for ${retirementYear} (2 × €${sftLimitSingle.toLocaleString()} = €${sftLimitCombined.toLocaleString()}).<br><br>Note: the maximum that can be held in a single pension tax-efficiently in ${retirementYear} is €${sftLimitSingle.toLocaleString()}.`
: `The amount you require (€${reqCap.toLocaleString()}) is above the Standard Fund Threshold for ${retirementYear} (€${sftLimitSingle.toLocaleString()}).<br><br>This is the maximum that can be held in one pension tax-efficiently for that year.`;


    sftWarningHTML = msg;
    setHTML('sftMessage', msg);
    document.getElementById('sftModal').style.display = 'flex';
  }

  // FIX: save the warning for the PDF now
  const sftWarningStripped = sftWarningHTML
.replace(/<br\s*\/?>/gi, ' ')
.replace(/<\/?[^>]+>/g, '');

  // ─── Results copy (plural-aware) ─────────────────────────
  let resultHTML = '';
  if (alwaysSurplus || reqCap === 0) {
    resultHTML = `
<h2>Congratulations!</h2>
<p>Your projected income exceeds spending every year—you don't need extra pension capital.</p>
<img src="https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif" style="max-width:200px">
    `;
  } else {
    // Decide which wording to use
    const whoNeeds = includePartnerSP ? 'You and your partner' : 'You';

    resultHTML = `
<h2>Result</h2>
<p>${whoNeeds} will need about <strong>€${reqCap.toLocaleString()}</strong> invested in pension accounts at retirement.</p>
    `;
  }

  let earlyWarning = '';

  if (retireAge < 50) {
    earlyWarning = `
<div class="warning-block danger">
⛔ <strong>Retiring Before Age 50</strong><br><br>
Under Irish Revenue rules, pensions cannot be accessed before age 50, except in rare cases such as ill-health retirement.<br>
These projections are illustrative only — professional guidance is strongly recommended.
</div>`;
  }
  else if (retireAge < 60) {
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
  else if (retireAge < 70) {
    // Ages 60–69: no warning block needed
    earlyWarning = '';
  }
  else if (retireAge < 75) {
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

  latestRun = gatherData(reqCap, retirementYear, sftWarningStripped);
  const rows = Object.entries(latestRun.inputs)
    .map(([k,v])=>{
const label = LABEL_MAP[k] ?? k;
let val = v;
if (typeof v === 'boolean') val = fmtBool(v);
else if (k.toLowerCase().includes('income') || k==='dbPension') val = fmtEuro(+v||0);
return `<tr><td>${label}</td><td>${val}</td><td><span class="edit" onclick="wizard.open('${k}')">✏️</span></td></tr>`;
    }).join('');
  const tableHTML = `<table class="assumptions-table"><tbody>${rows}</tbody></table>`;
  setHTML('results', resultHTML + earlyWarning + tableHTML);


  // ─── Build cash-flow & balance arrays ───────────────────────────────
  let bal            = reqCap;        // pot size on the day you retire
  const balances     = [];
  const reqLine      = [];
  const pensionDraw  = [];
  const otherInc     = [];

  /*  Loop from t = 0  (retirement year) up to and including
t = yrsRet (age 100).  PUSH the values before we grow/draw
so the first dot is the starting balance.                         */
  for (let t = 0; t <= yrsRet; t++) {
    const age  = retireAge + t;
    const infl = Math.pow(1 + CPI, t);

    const spend = spendAtRet * infl;
    const rent  = rentAtRet  * infl;
    const db    = (hasDb && age >= dbStartAge) ? dbAnnual * infl : 0;

    let sp = 0;
    if (includeSP && age >= SP_START) sp += STATE_PENSION;
    if (includePartnerSP &&
partnerDob &&
(partnerAgeAtRet + t) >= SP_START) sp += STATE_PENSION;

    const otherIncomeSeg  = Math.min(sp + rent + db, spend);
    const pensionWithdraw = Math.max(0, spend - otherIncomeSeg);

    /* 1️⃣  Push data for THIS YEAR *before* altering the pot.
  That makes balances[0] equal to reqCap and keeps
  all arrays the same length for the charts.                    */
    balances.push({ age, value: Math.max(0, Math.round(bal)) });
    reqLine.push(Math.round(spend));
    pensionDraw.push(Math.round(pensionWithdraw));
    otherInc.push(Math.round(otherIncomeSeg));

    /* 2️⃣  Grow the pot, then subtract this year’s withdrawal,
  leaving the closing balance ready for the next iteration.     */
    bal = bal * (1 + gRate) - pensionWithdraw;
  }

  // ─── (Insert mobile‐detection flag) ─────────
const isMobile = window.innerWidth < 480;

  
  // ─── Balance chart ───────────────────────────────────────
  if (balanceChart !== null) balanceChart.destroy();
balanceChart = new Chart(document.getElementById('balanceChart'), {
type: 'line',
data: {
  labels: balances.map(d => `Age ${d.age}`),
  datasets: [{
    label: 'Pension Balance (€)',
    data: balances.map(d => d.value),
    borderColor: '#00cc99',
    backgroundColor: 'rgba(0,204,153,0.1)',
    fill: true,
    tension: 0.3
  }]
},
options: {
  animation: false,
  responsive: true,
  maintainAspectRatio: false,    // ← ADDED: let .chart-wrapper dictate height
  plugins: {
    legend: { display: false },
    title: {
display: true,
text: 'Projected Pension Account Value Over Retirement',
color: '#fff',
font: {
size: isMobile ? 14 : 18,  // ← ADJUST font size on mobile vs desktop
weight: 'bold'
},
padding: {
top: isMobile ? 8 : 12,     // ← smaller padding on mobile
bottom: isMobile ? 4 : 6
}
    }
  },
  scales: {
    x: {
ticks: {
color: '#fff',
autoSkip: true,          // ← only show a subset of ticks
maxTicksLimit: 8,        // ← never more than 8 labels
maxRotation: 45,         // ← allow slanted text if needed
minRotation: 30
}
    },
    y: {
beginAtZero: true,
ticks: {
callback: v => '€' + v.toLocaleString(),
color: '#fff'
}
    }
  }
}
});

setHTML(
'balance-caption',
'This chart shows the estimated value of your pension pot over time, assuming withdrawals to fund retirement income.'
);

/* ─── Cash-flow chart (income vs. withdrawals) ───────────── */
if (cashflowChart !== null) cashflowChart.destroy();

cashflowChart = new Chart(document.getElementById('cashflowChart'), {
type: 'bar',
data: {
  labels: balances.map(d => `Age ${d.age}`),
  datasets: [
    {
label: 'Pension withdrawals',
data: pensionDraw,
backgroundColor: '#00ff88'
    },
    {
label: 'Other income (State Pension / rent / DB)',
data: otherInc,
backgroundColor: '#0099ff'
    },
    {
type: 'line',
label: 'Total income need',
data: reqLine,
borderColor: '#ffffff',
borderWidth: 2,
pointRadius: 0,
fill: false
    }
  ]
},
options: {
  animation: false,
  responsive: true,
  maintainAspectRatio: false,    // ← ADDED
  plugins: {
    legend: {
position: 'top',
labels: {
color: '#fff',
font: {
  size: isMobile ? 10 : 12   // ← shrink legend font on mobile
}
}
    },
    title: {
display: true,
text: 'Annual Retirement Income Needs and Sources',
color: '#fff',
font: {
size: isMobile ? 14 : 18,    // ← shrink title font on mobile
weight: 'bold'
},
padding: {
top: isMobile ? 8 : 12,
bottom: isMobile ? 4 : 6
}
    }
  },
  scales: {
    x: {
stacked: true,
ticks: {
color: '#fff',
autoSkip: true,          // ← only show a subset of x‐labels
maxTicksLimit: 8,
maxRotation: 45,
minRotation: 30
}
    },
    y: {
stacked: true,
beginAtZero: true,
ticks: {
callback: v => '€' + v.toLocaleString(),
color: '#fff'
}
    }
  }
}
});

 
setHTML(
 'cashflow-caption',
'The bars show how your annual income needs are met from different sources after retirement.<br>Green = pension withdrawals; Blue = State-pension / rent / DB; White line = total income need.'
);

  function captureCharts () {
    const balCan = balanceChart.canvas,
  cflCan = cashflowChart.canvas;

    latestRun.chartImgs = {
balance : balCan.toDataURL('image/png',1.0),
cashflow: cflCan.toDataURL('image/png',1.0)
    };
/* record real CSS pixel-size so PDF layout knows heights */
latestRun.chartDims = {
balance : {
  w: balCan.clientWidth,
  h: balCan.clientHeight
},
cashflow: {
  w: cflCan.clientWidth,
  h: cflCan.clientHeight
}
};
  }

  captureCharts();

  /* ─── capture warnings for PDF ─── */
  latestRun.warningBlocks = [...document.querySelectorAll(
    '#results .warning-block, #postCalcContent .warning-block'
  )].map(el => {
    // --- extract title -----------------------------------------------------
    const strong = el.querySelector('strong');
    const headText = strong
? strong.innerText.trim()
: el.innerText.split('\n')[0].trim();

    // --- clone element so we can delete the <strong> headline --------------
    const clone = el.cloneNode(true);
    if (strong) clone.removeChild(clone.querySelector('strong'));
    else {
// strip the first text line + following <br>
clone.innerHTML = clone.innerHTML.replace(/^[\s\S]*?<br\s*\/?>/, '');
    }

    // remove the leading emoji + any whitespace that might precede content
    const bodyHTML = clone.innerHTML
.replace(/^[\s\uFEFF\u200B]*(⚠️|⛔)/, '') // emoji at very start
.trim();

    return {
title  : headText.replace(/^\s*⚠️|⛔\s*/, '').trim(),
body   : bodyHTML,                // headline-free HTML with <li> intact
danger : el.classList.contains('danger')
    };
  });
  const mandatoryWarn = latestRun.warningBlocks.find(
    w => w.title.startsWith('Important Notice')
  );
  const otherWarns = latestRun.warningBlocks.filter(w => w !== mandatoryWarn);
  latestRun.mandatoryWarn = mandatoryWarn;
  latestRun.otherWarns    = otherWarns;
  /* ──────────────────────────────── */

  document.getElementById('postCalcContent').style.display = 'block';

  document.getElementById('console').textContent = '';
} catch (err) {
  document.getElementById('console').textContent = err.message;
  setHTML('results', '');
  if (balanceChart)    balanceChart.destroy();
  if (cashflowChart) cashflowChart.destroy();
}
}

function gatherData(requiredPot, retirementYear, sftText) {
const grossIncome = +document.getElementById('grossIncome').value || 0;
const rentalIncome = +document.getElementById('rentalIncome').value || 0;
const dbPension = +document.getElementById('dbPension').value || 0;
const inputs = {
  grossIncome,
  incomePercent: +document.getElementById('incomePercent').value || 0,
  statePension: document.getElementById('statePension').checked,
  partnerStatePension: document.getElementById('partnerStatePension').checked,
  partnerExists: document.getElementById('partnerExists').value === 'true',
  dob: document.getElementById('dob').value,
  partnerDob: document.getElementById('partnerDob').value,
  retireAge: +document.getElementById('retireAge').value || 0,
  growthRate: +document.querySelector('input[name="growthRate"]:checked').value,
  rentalIncome,
  hasDb: document.getElementById('hasDb').checked,
  dbPension,
  dbStartAge: +document.getElementById('dbStartAge').value || 0
};

const outputs = {
  requiredPot: requiredPot,
  retirementYear: retirementYear,
  sftMessage: sftText
};

return { inputs, outputs, assumptions: ASSUMPTIONS_TABLE_CONSTANT };
}

const fmtBool = b => b ? 'Yes' : 'No';
const fmtEuro = n => '€' + n.toLocaleString();

function generatePDF() {
if (!latestRun) return;

// ── Colour & size constants ──────────────────────────────
const BG_DARK      = '#1a1a1a';
const ACCENT_GREEN = '#00ff88';
const ACCENT_CYAN  = '#0099ff';
const COVER_GOLD   = '#BBA26F';

// 1️⃣  Create the jsPDF instance *first*
const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });

// 2️⃣  Use built-in fonts – no custom embedding needed

const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();


/* helpers */
const pageBG = () => {
  doc.setFillColor(BG_DARK);
  doc.rect(0, 0, pageW, pageH, 'F');
};
const addFooter = n => {
  doc.setFontSize(9).setTextColor(120);
  const t = `Page ${n}`;
  doc.text(t, pageW - doc.getTextWidth(t) - 40, pageH - 30);
};

// ─── Generic banner placement helper ──────────────────────────
function placeBanner (doc, warn) {
  const hLeft  = getBannerHeight(doc, warn, colW);
  const hRight = hLeft;           // width is identical (colW)
  const footerY = pageH - 40;

  // 1️⃣  Try the left column
  if (leftY + hLeft <= footerY) {
    drawBanner(doc, warn, 40, leftY, colW);
    leftY += hLeft + 18;
    return;
  }
  // 2️⃣  Try the right column
  if (rightY + hRight <= footerY) {
    drawBanner(doc, warn, chartX, rightY, colW);
    rightY += hRight + 18;
    return;
  }
  // 3️⃣  Need a fresh page
  addFooter(pageNo++);
  doc.addPage();  pageBG();
  leftY = rightY = 60;          // reset top margins
  drawBanner(doc, warn, 40, leftY, colW);
  leftY += hLeft + 18;
}


/* ───────────────── COVER ───────────────── */
pageBG();

  doc.setFont("times", "bold")
     .setFontSize(48)
     .setTextColor(COVER_GOLD)
     .text('Planéir', pageW / 2, 90, { align: 'center' });

const logoW = 220;
const logoY = 130;
doc.addImage('./favicon.png', 'PNG',
     (pageW - logoW) / 2, logoY, logoW, 0, '', 'FAST');

/* subtitle */
const subY = logoY + logoW + 40;   // 40 pt gap under favicon
doc.setFontSize(32).setFont(undefined, 'bold').setTextColor(COVER_GOLD);
doc.text('F*ck You Money Calculator', pageW / 2, subY, { align: 'center' });
doc.setFont('times', 'normal');   // switch back to regular weight

addFooter(1);
doc.addPage();

/* ───────────── ASSUMPTIONS PAGE ─────────── */
pageBG();
let y = 60;
doc.setFontSize(18).setFont(undefined, 'bold').setTextColor(ACCENT_CYAN);
doc.text('Assumptions', 50, y);
y += 14;

doc.autoTable({
  startY: y,
  margin: { left: 40, right: 40 },
  head: [['Assumption', 'Value']],
  body: latestRun.assumptions,
  headStyles:    { fillColor: ACCENT_CYAN, textColor: '#000' },
  bodyStyles:    { fillColor: '#2a2a2a', textColor: '#fff' },
  alternateRowStyles: { fillColor: '#242424', textColor: '#fff' }
});

/***** BEGIN: dynamic call-out height *****/
const boxMargin = 30;
const boxX      = boxMargin;
const boxW      = pageW - boxMargin * 2;
const boxY      = doc.lastAutoTable.finalY + 35;

/* copy to display */
const heading = 'What does this calculator actually do?';
const body =
  "•  It starts with the income you enjoy today and the share of that income you’d like to keep when you stop working.\n\n" +
  "•  It then works out how big your pension pot must be to fund that lifestyle all the way to age 100.\n\n" +
  "•  The maths reflects the investment growth rate you’re comfortable with and any other retirement income – such as State Pension, rental income or a defined-benefit plan.";

/* layout calculations */
doc.setFontSize(16).setFont(undefined,'bold');
const headingHeight = 22;                       // ≈16 pt font + spacing
doc.setFontSize(14);
const wrapped       = doc.splitTextToSize(body, boxW - 48);
const lineHeight    = 18;
const bodyHeight    = wrapped.length * lineHeight;
const boxH          = 32               // top padding
    + headingHeight
    + 14               // gap below heading
    + bodyHeight
    + 24;              // bottom padding

/* 1️⃣ draw panel FIRST */
doc.setFillColor('#222222')
   .setDrawColor(ACCENT_CYAN)
   .setLineWidth(2)
   .roundedRect(boxX, boxY, boxW, boxH, 14, 14, 'FD');

/* 2️⃣ now put text on top */
let cursorY = boxY + 32;                              // top padding
doc.setFontSize(16).setFont(undefined,'bold').setTextColor(ACCENT_CYAN);
doc.text(heading, boxX + 24, cursorY);
cursorY += headingHeight + 14;                        // heading + gap

doc.setFontSize(14).setFont(undefined,'normal').setTextColor('#ffffff');
doc.text(wrapped, boxX + 24, cursorY, { lineHeightFactor: 1.3 });
/***** END: dynamic call-out height *****/

addFooter(2);
doc.addPage();
pageBG();                 // <— new line: keeps dark background

/* ───────────── PAGE 3 + (unchanged) ───────── */
/*  keep the existing logic that builds inputs/results tables,
    embeds balance & cash-flow charts,
    shows SFT warning, then calls doc.save()           */

/* Left column: inputs */
let y3 = 60;
doc.setFontSize(18).setFont(undefined, 'bold').setTextColor(ACCENT_CYAN);
doc.text('Inputs & results', 50, y3);
y3 += 22;

const columnGap = 20;
const colW      = (pageW - 40 * 2 - columnGap) / 2;

doc.autoTable({
  startY: y3,
  margin: { left: 40, right: 40 + colW + columnGap },
  head: [['Input', 'Value']],
  body: Object.entries(latestRun.inputs)
    .map(([k, v]) => [LABEL_MAP[k] ?? k, String(v || '—')]),
  headStyles: { fillColor: ACCENT_CYAN, textColor: '#000' },
  bodyStyles: { fillColor: '#2a2a2a', textColor: '#fff' },
  alternateRowStyles: { fillColor: '#242424', textColor: '#fff' },
  columnStyles: { 0: { cellWidth: colW * 0.4 } }
});

let tableEnd = doc.lastAutoTable.finalY + 12;
const metrics = [
  ['Required pot (€)', '€' + latestRun.outputs.requiredPot.toLocaleString()],
  ['Retirement year', latestRun.outputs.retirementYear]
];
if (latestRun.outputs.sftMessage)
  metrics.push(['SFT warning', latestRun.outputs.sftMessage]);

doc.autoTable({
  startY: tableEnd,
  margin: { left: 40, right: 40 + colW + columnGap },
  head: [['Metric', 'Value']],
  body: metrics,
  headStyles: { fillColor: ACCENT_CYAN, textColor: '#000' },
  bodyStyles: { fillColor: '#2a2a2a', textColor: '#fff' },
  alternateRowStyles: { fillColor: '#242424', textColor: '#fff' },
  columnStyles: { 0: { cellWidth: colW * 0.4 } }
});

let leftY = doc.lastAutoTable.finalY + 16;

/* charts – right column */
const chartX  = 40 + colW + columnGap;
let   chartY  = y3;
  const chartW   = colW;                                    // fixed width
  const balR     = latestRun.chartDims.balance .h /
   latestRun.chartDims.balance .w;
  const cflR     = latestRun.chartDims.cashflow.h /
   latestRun.chartDims.cashflow.w;

doc.addImage(
    latestRun.chartImgs.balance,
    'PNG', chartX, chartY,
    chartW, chartW * balR, '', 'FAST');
  chartY += chartW * balR + 12;               // ← real height!

doc.addImage(
    latestRun.chartImgs.cashflow,
    'PNG', chartX, chartY,
    chartW, chartW * cflR, '', 'FAST');
  chartY += chartW * cflR + 12;               // ← real height!

let rightY  = chartY + 12;          // starts under both charts
let pageNo  = 3;                    // we’re still on page 3

// Build a single array in display order (mandatory first if present)
const allWarns = [];
if (latestRun.mandatoryWarn) allWarns.push(latestRun.mandatoryWarn);
allWarns.push(...latestRun.otherWarns);

allWarns.forEach(w => placeBanner(doc, w));

addFooter(pageNo);

doc.save('planéir_report.pdf');
const pdfUrl = doc.output('bloburl');
import('./consentModal.js').then(m=>m.showConsent(pdfUrl));
}

