import { MAX_SALARY_CAP, sftForYear } from './assumptions.js';

const AGE_BANDS = [
  { max: 29, pct: 0.15 },
  { max: 39, pct: 0.20 },
  { max: 49, pct: 0.25 },
  { max: 54, pct: 0.30 },
  { max: 59, pct: 0.35 },
  { max: 120, pct: 0.40 }
];

function ageInYears(date, ref = new Date()) {
  return (ref - date) / (1000 * 60 * 60 * 24 * 365.25);
}

function maxPersonalPct(age) {
  return AGE_BANDS.find(b => age <= b.max).pct;
}

function maxPersonalByAge(age, capSalary) {
  return maxPersonalPct(Math.floor(age)) * capSalary;
}

export function projectPension(args = {}) {
  const salaryRaw = +args.salary || 0;
  const salaryCapped = Math.min(salaryRaw, MAX_SALARY_CAP);
  const currentPv = +args.currentValue || 0;
  const personalRaw = +args.personalContrib || 0;
  const personalPct = (+args.personalPct || 0) / 100;
  const employerRaw = +args.employerContrib || 0;
  const employerPct = (+args.employerPct || 0) / 100;
  const employerCalc = employerRaw > 0 ? employerRaw : salaryRaw * employerPct;
  const dob = args.dob ? new Date(args.dob) : new Date();
  const curAge = ageInYears(dob, new Date());
  const personalCalc = personalRaw > 0 ? personalRaw : salaryCapped * personalPct;
  const limitValue = maxPersonalPct(Math.floor(curAge)) * salaryCapped;
  const personalUsed = Math.min(personalCalc, limitValue);
  const retireAge = +args.retireAge;
  const gRate = +args.growth || 0.05;
  const yearsToRet = Math.ceil(retireAge - curAge);

  const balances = [];
  let bal = currentPv;
  balances.push({ age: Math.floor(curAge), value: Math.round(bal) });
  const contribsBase = [0];
  const growthBase = [0];
  for (let y = 1; y <= yearsToRet; y++) {
    const before = bal;
    bal = bal * (1 + gRate) + personalUsed + employerCalc;
    contribsBase.push(Math.round(personalUsed + employerCalc));
    growthBase.push(Math.round(bal - before - (personalUsed + employerCalc)));
    balances.push({ age: Math.floor(curAge) + y, value: Math.round(bal) });
  }

  let maxBalances = [];
  let maxBal = currentPv;
  maxBalances.push({ age: Math.floor(curAge), value: Math.round(maxBal) });
  const contribsMax = [0];
  const growthMax = [0];
  for (let y = 1; y <= yearsToRet; y++) {
    const ageNext = curAge + y;
    const personalMax = maxPersonalByAge(ageNext, salaryCapped);
    const before = maxBal;
    maxBal = maxBal * (1 + gRate) + personalMax + employerCalc;
    contribsMax.push(Math.round(personalMax + employerCalc));
    growthMax.push(Math.round(maxBal - before - (personalMax + employerCalc)));
    maxBalances.push({ age: Math.floor(ageNext), value: Math.round(maxBal) });
  }

  const projValue = balances.at(-1).value;
  const retirementYear = new Date().getFullYear() + Math.ceil(yearsToRet);
  const sftLimit = sftForYear(retirementYear);

  return {
    balances,
    projValue,
    retirementYear,
    contribsBase,
    growthBase,
    maxBalances,
    contribsMax,
    growthMax,
    sftLimit,
    showMax: !!args.showMax
  };
}

