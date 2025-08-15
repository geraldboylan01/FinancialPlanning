// pensionProjection.js
import { MAX_SALARY_CAP } from './shared/assumptions.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const yrDiff = (d, ref = new Date()) => (ref - d) / (1000*60*60*24*365.25);

const AGE_BANDS = [
  { max: 29,  pct: 0.15 },
  { max: 39,  pct: 0.20 },
  { max: 49,  pct: 0.25 },
  { max: 54,  pct: 0.30 },
  { max: 59,  pct: 0.35 },
  { max: 120, pct: 0.40 }
];
const maxPctForAge = (age) => AGE_BANDS.find(b => age <= b.max).pct;

// Listens for fm-run-pension and emits fm-pension-output so
// the Full Monty results page can render projections.
document.addEventListener('fm-run-pension', (e) => {
  const d = e.detail || {};
  const now = new Date();
  const dob = d.dob ? new Date(d.dob) : null;
  const curAge = dob ? yrDiff(dob, now) : 40;
  const retireAge = clamp(+d.retireAge || 65, 50, 75);
  const years = Math.max(0, Math.round(retireAge - curAge));
  const startAge = Math.round(curAge);
  const retirementYear = now.getFullYear() + Math.ceil(Math.max(0, retireAge - curAge));

  const salaryRaw = Math.max(0, +d.salary || 0);
  const salaryCapped = Math.min(salaryRaw, MAX_SALARY_CAP);

  const growth = Number.isFinite(+d.growth) ? +d.growth : 0.05;

  const personalAbs = Math.max(0, +d.personalContrib || 0);
  const employerAbs = Math.max(0, +d.employerContrib || 0);
  const personalPct = Math.max(0, +d.personalPct || 0) / 100;
  const employerPct = Math.max(0, +d.employerPct || 0) / 100;

  const basePersonal = personalAbs || salaryCapped * personalPct;
  const baseEmployer = employerAbs || salaryRaw * employerPct;

  let bal = Math.max(0, +d.currentValue || 0);

  const balances = [];
  const contribsBase = [];
  const growthBase = [];

  // base scenario
  for (let i = 0; i <= years; i++) {
    const age = Math.round(curAge + i);
    balances.push({ age, value: Math.round(bal) });
    if (i < years) {
      const contrib = Math.max(0, basePersonal + baseEmployer);
      const grow = Math.max(0, bal * growth);
      contribsBase.push(Math.round(contrib));
      growthBase.push(Math.round(grow));
      bal = bal + contrib + grow;
    }
  }
  const projValue = balances.at(-1)?.value || 0;

  // max scenario
  let maxBal = Math.max(0, +d.currentValue || 0);
  const maxBalances = [];
  const contribsMax = [];
  const growthMax = [];

  for (let i = 0; i <= years; i++) {
    const age = Math.round(curAge + i);
    maxBalances.push({ age, value: Math.round(maxBal) });
    if (i < years) {
      const personalMax = maxPctForAge(curAge + i + 1) * salaryCapped;
      const contrib = Math.max(0, personalMax + baseEmployer);
      const grow = Math.max(0, maxBal * growth);
      contribsMax.push(Math.round(contrib));
      growthMax.push(Math.round(grow));
      maxBal = maxBal + contrib + grow;
    }
  }

  const payload = {
    balances,                 // base [{age, value}]
    projValue,                // base value at retirement
    retirementYear,
    contribsBase,
    growthBase,
    // max scenario (for toggle)
    maxBalances,
    contribsMax,
    growthMax,
    // remember growth for drawdown sim
    growth,
    showMax: false
  };

  document.dispatchEvent(new CustomEvent('fm-pension-output', { detail: payload }));
});

