// pensionProjection.js
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const yrDiff = (d, ref = new Date()) => (ref - d) / (1000*60*60*24*365.25);

// Listens for fm-run-pension and emits fm-pension-output so
// the Full Monty results page can render projections.
document.addEventListener('fm-run-pension', (e) => {
  const d = e.detail || {};
  const now = new Date();
  const dob = d.dob ? new Date(d.dob) : null;
  const curAge = dob ? yrDiff(dob, now) : 40;
  const retireAge = clamp(+d.retireAge || 65, 50, 70);
  const years = Math.max(0, Math.round(retireAge - curAge));
  const startAge = Math.round(curAge);
  const retirementYear = now.getFullYear() + Math.ceil(Math.max(0, retireAge - curAge));

  const salary = Math.max(0, +d.salary || 0);
  const growth = Number.isFinite(+d.growth) ? +d.growth : 0.05;

  const personalAbs = Math.max(0, +d.personalContrib || 0);
  const employerAbs = Math.max(0, +d.employerContrib || 0);
  const personalPct = Math.max(0, +d.personalPct || 0);
  const employerPct = Math.max(0, +d.employerPct || 0);

  const annualContrib =
    personalAbs + employerAbs + (personalPct/100)*salary + (employerPct/100)*salary;

  let bal = Math.max(0, +d.currentValue || 0);

  const balances = [];
  const contribsBase = [];
  const growthBase = [];

  for (let i = 0; i <= years; i++) {
    const age = Math.round(curAge + i);
    balances.push({ age, value: Math.round(bal) });

    if (i < years) {
      const contrib = Math.max(0, annualContrib);
      const grow = Math.max(0, bal * growth);

      contribsBase.push(Math.round(contrib));
      growthBase.push(Math.round(grow));

      bal = bal + contrib + grow;
    }
  }

  const projValue = balances.at(-1)?.value || 0;

  const payload = {
    balances,                 // [{age, value}, …]
    projValue,                // value at retirement
    retirementYear,
    contribsBase,
    growthBase,
    // Optional/neutral defaults used by results JS:
    showMax: false,
    sftLimit: undefined,
    growth
  };

  document.dispatchEvent(new CustomEvent('fm-pension-output', { detail: payload }));
});

