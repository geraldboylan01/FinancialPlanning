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
  const retirementYear = now.getFullYear() + Math.ceil(Math.max(0, retireAge - curAge));

  const growth = Number.isFinite(+d.growth) ? +d.growth : 0.05;

  // Self inputs
  const salaryRaw = Math.max(0, +d.salary || 0);
  const salaryCapped = Math.min(salaryRaw, MAX_SALARY_CAP);
  const personalAbs = Math.max(0, +d.personalContrib || 0);
  const employerAbs = Math.max(0, +d.employerContrib || 0);
  const personalPct = Math.max(0, +d.personalPct || 0) / 100;
  const employerPct = Math.max(0, +d.employerPct || 0) / 100;
  const basePersonal = personalAbs || salaryCapped * personalPct;
  const baseEmployer = employerAbs || salaryRaw * employerPct;

  // Partner inputs (optional)
  const hasPartner = !!d.hasPartner;
  const partnerDob = hasPartner && d.dobPartner ? new Date(d.dobPartner) : null;
  let curAgePartner = partnerDob ? yrDiff(partnerDob, now) : curAge;
  if (!Number.isFinite(curAgePartner)) curAgePartner = curAge;

  const salaryPartnerRaw = Math.max(0, +d.salaryPartner || 0);
  const salaryPartnerCapped = Math.min(salaryPartnerRaw, MAX_SALARY_CAP);
  const personalAbsPartner = Math.max(0, +d.personalContribPartner || 0);
  const employerAbsPartner = Math.max(0, +d.employerContribPartner || 0);
  const personalPctPartner = Math.max(0, +d.personalPctPartner || 0) / 100;
  const employerPctPartner = Math.max(0, +d.employerPctPartner || 0) / 100;
  const basePersonalPartner = personalAbsPartner || salaryPartnerCapped * personalPctPartner;
  const baseEmployerPartner = employerAbsPartner || salaryPartnerRaw * employerPctPartner;

  // Starting balances
  let balSelf = Math.max(0, +d.currentValue || 0);
  let balPartner = hasPartner ? Math.max(0, +d.currentValuePartner || 0) : 0;
  let maxBalSelf = balSelf;
  let maxBalPartner = hasPartner ? balPartner : 0;

  const balances = [];
  const contribsBase = [];
  const growthBase = [];

  const maxBalances = [];
  const contribsMax = [];
  const growthMax = [];

  for (let i = 0; i <= years; i++) {
    const ageSelf = Math.round(curAge + i);
    const combinedBase = balSelf + (hasPartner ? balPartner : 0);
    const combinedMax = maxBalSelf + (hasPartner ? maxBalPartner : 0);

    balances.push({ age: ageSelf, value: Math.round(combinedBase) });
    maxBalances.push({ age: ageSelf, value: Math.round(combinedMax) });

    if (i < years) {
      const contribSelfBase = Math.max(0, basePersonal + baseEmployer);
      const growthSelfBase = Math.max(0, balSelf * growth);
      const contribPartnerBase = hasPartner ? Math.max(0, basePersonalPartner + baseEmployerPartner) : 0;
      const growthPartnerBase = hasPartner ? Math.max(0, balPartner * growth) : 0;

      contribsBase.push(Math.round(contribSelfBase + contribPartnerBase));
      growthBase.push(Math.round(growthSelfBase + growthPartnerBase));

      balSelf += contribSelfBase + growthSelfBase;
      if (hasPartner) {
        balPartner += contribPartnerBase + growthPartnerBase;
      }

      const personalMaxSelf = Math.max(0, maxPctForAge(curAge + i + 1) * salaryCapped);
      const contribSelfMax = Math.max(0, personalMaxSelf + baseEmployer);
      const growthSelfMax = Math.max(0, maxBalSelf * growth);

      let contribPartnerMax = 0;
      let growthPartnerMax = 0;
      if (hasPartner) {
        const personalMaxPartner = Math.max(0, maxPctForAge(curAgePartner + i + 1) * salaryPartnerCapped);
        contribPartnerMax = Math.max(0, personalMaxPartner + baseEmployerPartner);
        growthPartnerMax = Math.max(0, maxBalPartner * growth);
      }

      contribsMax.push(Math.round(contribSelfMax + contribPartnerMax));
      growthMax.push(Math.round(growthSelfMax + growthPartnerMax));

      maxBalSelf += contribSelfMax + growthSelfMax;
      if (hasPartner) {
        maxBalPartner += contribPartnerMax + growthPartnerMax;
      }
    }
  }

  const projValueSelf = balSelf;
  const projValuePartner = hasPartner ? balPartner : 0;
  const projValueSelfMax = maxBalSelf;
  const projValuePartnerMax = hasPartner ? maxBalPartner : 0;
  const projValueCombined = balances.at(-1)?.value || (projValueSelf + projValuePartner);

  const payload = {
    balances,                 // base [{age, value}]
    projValue: projValueCombined,
    retirementYear,
    contribsBase,
    growthBase,
    // max scenario (for toggle)
    maxBalances,
    contribsMax,
    growthMax,
    // remember growth for drawdown sim
    growth,
    showMax: false,
    // per-person projections for SFT checks
    projValueSelf,
    projValuePartner,
    projValueSelfMax,
    projValuePartnerMax
  };

  document.dispatchEvent(new CustomEvent('fm-pension-output', { detail: payload }));
});

