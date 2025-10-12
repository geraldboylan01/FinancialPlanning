// shared/exportExcel.js
// Builds an .xlsx with:
//   (1) "Assumptions & Inputs" (2-column table)
//   (2) "Results" (year-by-year, both scenarios) with formulas referencing sheet 1.
//
// This file only **reads** from window.getFullMontyData() and the last
// payload sent on 'fm:wizard:final-submit' to avoid tight coupling.

import { STATE_PENSION, SP_START } from './assumptions.js';

let __xlsxReady;
export function ensureXLSX() {
  if (__xlsxReady) return __xlsxReady;
  __xlsxReady = new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.async = true;
    s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX failed to load'));
    s.onerror = () => reject(new Error('Failed to load XLSX'));
    document.head.appendChild(s);
  });
  return __xlsxReady;
}

// Cache the most recent wizard submit payload (so exports match what users see)
let __lastSubmit = null;
window.addEventListener('fm:wizard:final-submit', (e) => {
  try { __lastSubmit = e.detail || null; } catch {}
});

// Utilities
function ymd(d = new Date()) {
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}_${hh}${mi}`;
}
function safeNum(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }
function yearsFromDob(dobStr){
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob)) return null;
  return Math.floor((Date.now() - dob.getTime()) / (365.25*24*3600*1000));
}

/**
 * Build a normalized "assumptions" object from Wizard store + last submit.
 * Only uses fields that exist in fullMontyWizard.js.
 */
function collectAssumptions() {
  const s = (typeof window.getFullMontyData === 'function') ? window.getFullMontyData() : {};
  const sub = __lastSubmit || {};
  const p = (sub.rawPension || {});
  const f = (sub.rawFy || {});

  // Core inputs (from wizard store)
  const hasPartner = !!s.hasPartner;
  const currentAge = yearsFromDob(s.dobSelf);
  const partnerAge = yearsFromDob(s.dobPartner);
  const retirementAge = safeNum(s.retireAge, 65);

  // Income and target
  const salarySelf = safeNum(s.grossIncome);
  const salaryPartner = hasPartner ? safeNum(s.grossIncomePartner) : 0;
  const householdSalary = salarySelf + salaryPartner;
  const targetPct = safeNum(s.incomePercent, 70) / 100;

  // Pension/DC inputs (annuals are source-of-truth in wizard)
  const currentPensionValueSelf = safeNum(s.currentPensionValueSelf);
  const currentPensionValuePartner = safeNum(s.currentPensionValuePartner);
  const personalSelfAnnual = safeNum(s.personalContribSelfAnnual);
  const employerSelfAnnual = safeNum(s.employerContribSelfAnnual);
  const personalPartnerAnnual = safeNum(s.personalContribPartnerAnnual);
  const employerPartnerAnnual = safeNum(s.employerContribPartnerAnnual);

  // Risk/returns & CPI (from wizard store)
  const growth = (typeof s.pensionGrowthRate === 'number') ? s.pensionGrowthRate : 0.05; // decimal
  const cpi = (typeof s.cpiRate === 'number') ? (s.cpiRate/100) : 0.023; // store holds 2.3

  // State pension / DB toggles (from wizard)
  const statePensionSelf = !!s.statePensionSelf;
  const statePensionPartner = !!s.statePensionPartner;
  const hasDbSelf = !!s.hasDbSelf;
  const hasDbPartner = !!s.hasDbPartner;
  const dbPensionSelf = safeNum(s.dbPensionSelf);
  const dbStartAgeSelf = safeNum(s.dbStartAgeSelf, retirementAge);
  const dbPensionPartner = safeNum(s.dbPensionPartner);
  const dbStartAgePartner = safeNum(s.dbStartAgePartner, retirementAge);

  // Other income (simplified)
  const rentalIncomeNow = safeNum(s.rentalIncomeNow);

  // Salary cap used by wizard when dispatching pensionArgs
  const MAX_SALARY_CAP = 115000;

  // Excel-friendly assumptions object
  return {
    generatedAtISO: new Date().toISOString(),
    baseYear: new Date().getFullYear(),
    hasPartner,
    currentAge,
    partnerAge,
    retirementAge,
    salarySelf,
    salaryPartner,
    householdSalary,
    salaryCapUsedSelf: Math.min(salarySelf || 0, MAX_SALARY_CAP),
    salaryCapUsedPartner: Math.min(salaryPartner || 0, MAX_SALARY_CAP),
    targetIncomePctOfSalaryToday: targetPct, // decimal
    currentPensionValueSelf,
    currentPensionValuePartner,
    personalSelfAnnual,
    employerSelfAnnual,
    personalPartnerAnnual,
    employerPartnerAnnual,
    annualGrowth: growth,
    cpi,

    statePensionSelf,
    statePensionPartner,
    statePensionAnnual: STATE_PENSION,
    statePensionStartAge: SP_START,
    hasDbSelf, dbPensionSelf, dbStartAgeSelf,
    hasDbPartner, dbPensionPartner, dbStartAgePartner,

    rentalIncomeNow,

    drawdownYears: 40
  };
}

/**
 * Build the Results sheet rows (Current + Max).
 * We don’t rely on other modules; we emit formulas that reference assumptions,
 * so users can audit. “Max” uses the age-band rule from the wizard constraints.
 */
function buildWorkbook(XLSX) {
  const A = collectAssumptions();

  // ===== Sheet 1: Assumptions & Inputs
  const rowsA = [
    ['Generated At (ISO)', A.generatedAtISO],
    ['Base Year (first projection year)', A.baseYear],
    ['Has Partner', A.hasPartner ? 'Yes' : 'No'],
    ['Current Age (years)', A.currentAge ?? ''],
    ['Partner Age (years)', A.partnerAge ?? ''],
    ['Retirement Age (years)', A.retirementAge],
    ['Salary Today – You (€)', A.salarySelf],
    ['Salary Today – Partner (€)', A.salaryPartner],
    ['Household Salary Today (€)', A.householdSalary],
    ['Salary Cap Used – You (€)', A.salaryCapUsedSelf],
    ['Salary Cap Used – Partner (€)', A.salaryCapUsedPartner],
    ['Target Income % of Salary Today (decimal)', A.targetIncomePctOfSalaryToday],
    ['Current Pension Value – You (€)', A.currentPensionValueSelf],
    ['Current Pension Value – Partner (€)', A.currentPensionValuePartner],
    ['Personal Contributions – You (€/yr)', A.personalSelfAnnual],
    ['Employer Contributions – You (€/yr)', A.employerSelfAnnual],
    ['Personal Contributions – Partner (€/yr)', A.personalPartnerAnnual],
    ['Employer Contributions – Partner (€/yr)', A.employerPartnerAnnual],
    ['Annual Investment Growth (decimal)', A.annualGrowth],
    ['CPI Inflation (decimal)', A.cpi],
    ['State Pension – You (on/off)', A.statePensionSelf ? 'On' : 'Off'],
    ['State Pension – Partner (on/off)', A.statePensionPartner ? 'On' : 'Off'],
    ['State Pension Annual (€/yr)', A.statePensionAnnual],
    ['State Pension Start Age', A.statePensionStartAge],
    ['Has DB – You (on/off)', A.hasDbSelf ? 'On' : 'Off'],
    ['DB Annual – You (€/yr)', A.dbPensionSelf],
    ['DB Start Age – You', A.dbStartAgeSelf],
    ['Has DB – Partner (on/off)', A.hasDbPartner ? 'On' : 'Off'],
    ['DB Annual – Partner (€/yr)', A.dbPensionPartner],
    ['DB Start Age – Partner', A.dbStartAgePartner],
    ['Other Rental Income Today (€/yr)', A.rentalIncomeNow],
    ['Drawdown Horizon (years)', A.drawdownYears],
  ];
  const wb = XLSX.utils.book_new();
  const wsA = XLSX.utils.aoa_to_sheet([['Assumption / Input','Value'], ...rowsA]);
  XLSX.utils.book_append_sheet(wb, wsA, 'Assumptions & Inputs');

  // Map to cell refs (B-column) — keep in sync with the rows above
  // NOTE: rowsA[0] sits on Excel row 2 (row 1 is the header), so the offset is +1, not +2.
  const refB = (idx) => XLSX.utils.encode_cell({ r: 1 + idx, c: 1 });
  const REF = {
    baseYear:               `'Assumptions & Inputs'!${refB(1)}`,
    currentAge:             `'Assumptions & Inputs'!${refB(3)}`,
    partnerAge:             `'Assumptions & Inputs'!${refB(4)}`,
    retirementAge:          `'Assumptions & Inputs'!${refB(5)}`,
    salarySelf:             `'Assumptions & Inputs'!${refB(6)}`,
    salaryPartner:          `'Assumptions & Inputs'!${refB(7)}`,
    householdSalary:        `'Assumptions & Inputs'!${refB(8)}`,
    salaryCapSelf:          `'Assumptions & Inputs'!${refB(9)}`,
    salaryCapPartner:       `'Assumptions & Inputs'!${refB(10)}`,
    targetPct:              `'Assumptions & Inputs'!${refB(11)}`,
    curPotSelf:             `'Assumptions & Inputs'!${refB(12)}`,
    curPotPartner:          `'Assumptions & Inputs'!${refB(13)}`,
    persSelfYr:             `'Assumptions & Inputs'!${refB(14)}`,
    emplSelfYr:             `'Assumptions & Inputs'!${refB(15)}`,
    persPartYr:             `'Assumptions & Inputs'!${refB(16)}`,
    emplPartYr:             `'Assumptions & Inputs'!${refB(17)}`,
    growth:                 `'Assumptions & Inputs'!${refB(18)}`,
    cpi:                    `'Assumptions & Inputs'!${refB(19)}`,
    spSelfOn:               `'Assumptions & Inputs'!${refB(20)}`,
    spPartnerOn:            `'Assumptions & Inputs'!${refB(21)}`,
    spAnnual:               `'Assumptions & Inputs'!${refB(22)}`,
    spStartAge:             `'Assumptions & Inputs'!${refB(23)}`,
    hasDbSelf:              `'Assumptions & Inputs'!${refB(24)}`,
    dbSelfYr:               `'Assumptions & Inputs'!${refB(25)}`,
    dbSelfAge:              `'Assumptions & Inputs'!${refB(26)}`,
    hasDbPartner:           `'Assumptions & Inputs'!${refB(27)}`,
    dbPartnerYr:            `'Assumptions & Inputs'!${refB(28)}`,
    dbPartnerAge:           `'Assumptions & Inputs'!${refB(29)}`,
    rentYr:                 `'Assumptions & Inputs'!${refB(30)}`,
    drawdownYears:          `'Assumptions & Inputs'!${refB(31)}`
  };

  // Helpers reused across sheets
  const RealReturn = `(((1+${REF.growth}))/(1+${REF.cpi})-1)`;
  const TargetIncomeToday = `(${REF.householdSalary}*${REF.targetPct})`;
  const yrsToRet = `MAX(0, ${REF.retirementAge}-${REF.currentAge})`;

  // ===== Sheet 2: Results (UNCHANGED logic, just your existing table)
  const HEAD = [
    'Scenario','Year','Age (You)','Phase (Accumulation / Drawdown)',
    'Salary Used – Household (€)','Personal Contributions – Household (€/yr)',
    'Employer Contributions – Household (€/yr)','Total Contributions – Household (€/yr)',
    'Opening Balance – Household (€)','Investment Return (€/yr)',
    'Other Income Applied (State Pension, DB, Rent) (€/yr)',
    'Target Net Income in Retirement (€/yr)','Withdrawal Taken (€/yr)',
    'Closing Balance – Household (€)',
    'Financial Freedom Target – Required Pension Pot (€)',
    'Gap to Financial Freedom Target (€)'
  ];
  const OPEN_TO_CLOSE_OFFSET = HEAD.indexOf('Closing Balance – Household (€)') - HEAD.indexOf('Opening Balance – Household (€)');
  const aoa = [HEAD];

  function makeRow(i, scenario /* 'Current' | 'Max' */) {
    const YEAR = `(${REF.baseYear}+${i})`;
    const AGE  = `(${REF.currentAge}+${i})`;
    const PHASE = `IF(${AGE}<${REF.retirementAge},"Accumulation","Drawdown")`;
    const AGE_BAND_PCT = `IF(${AGE}<=29,0.15,IF(${AGE}<=39,0.20,IF(${AGE}<=49,0.25,IF(${AGE}<=54,0.30,IF(${AGE}<=59,0.35,0.40)))))`;
    const HOUSEHOLD_SALARY_USED = `(${REF.salaryCapSelf}+${REF.salaryCapPartner})`;
    const PERS_YR_CUR = `(${REF.persSelfYr}+${REF.persPartYr})`;
    const EMPL_YR_CUR = `(${REF.emplSelfYr}+${REF.emplPartYr})`;
    const PERS_YR_MAX = `(${HOUSEHOLD_SALARY_USED}*${AGE_BAND_PCT})`;
    const EMPL_YR_MAX = `(0)`;

    const PERS_YR = (scenario === 'Current')
      ? `IF(${PHASE}="Accumulation",${PERS_YR_CUR},0)`
      : `IF(${PHASE}="Accumulation",${PERS_YR_MAX},0)`;
    const EMPL_YR = (scenario === 'Current')
      ? `IF(${PHASE}="Accumulation",${EMPL_YR_CUR},0)`
      : `IF(${PHASE}="Accumulation",${EMPL_YR_MAX},0)`;
    const TOTAL_CONTRIB = `(${PERS_YR}+${EMPL_YR})`;

    const OPEN =
      (i === 0)
        ? `(${REF.curPotSelf}+${REF.curPotPartner})`
        : `INDIRECT(ADDRESS(ROW()-1, COLUMN()+${OPEN_TO_CLOSE_OFFSET}))`;

    const INV_RET = `(${OPEN}+${TOTAL_CONTRIB})*${REF.growth}`;

    const YEAR_OFF = `(${REF.baseYear}+${i})`;
    const YEARS_FROM_TODAY = `(${YEAR_OFF}-${REF.baseYear})`;
    const SP = `(0)`; // amounts not in store — left editable for the user
    const DB_SELF = `IF(${AGE}>=${REF.dbSelfAge}, IF(${REF.hasDbSelf}="On", ${REF.dbSelfYr}, 0), 0)`;
    const DB_PART = `IF(${AGE}>=${REF.dbPartnerAge}, IF(${REF.hasDbPartner}="On", ${REF.dbPartnerYr}, 0), 0)`;
    const RENT = `IF(${PHASE}="Drawdown", ${REF.rentYr}, 0)`;
    const OTHER_INCOME = `(${SP}+${DB_SELF}+${DB_PART}+${RENT})`;

    const TARGET_NET = `${TargetIncomeToday}*POWER(1+${REF.cpi}, ${YEARS_FROM_TODAY}) - ${OTHER_INCOME}`;
    const WITHDRAWAL = `IF(${PHASE}="Drawdown", MAX(0, MIN(${OPEN}+${TOTAL_CONTRIB}+${INV_RET}, ${TARGET_NET})), 0)`;
    const CLOSE = `(${OPEN}+${TOTAL_CONTRIB}+${INV_RET}-${WITHDRAWAL})`;

    const YEARS_TO_RETIRE = `MAX(0, ${REF.retirementAge}-${AGE})`;
    const REM_YEARS = `IF(${PHASE}="Drawdown", MAX(0, ${REF.drawdownYears} - (${AGE}-${REF.retirementAge})), ${REF.drawdownYears})`;
    const TARGET_REAL = `IF(${PHASE}="Drawdown", (${TARGET_NET}/POWER(1+${REF.cpi}, ${YEARS_FROM_TODAY})), (${TargetIncomeToday}/POWER(1+${REF.cpi}, ${YEARS_TO_RETIRE})))`;
    const REQUIRED = `IF(${PHASE}="Drawdown",
  IF(${RealReturn}=0, ${TARGET_REAL}*${REM_YEARS}, ${TARGET_REAL}*(1-POWER(1/(1+${RealReturn}), ${REM_YEARS}))/(${RealReturn})),
  IF(${RealReturn}=0, ${TARGET_REAL}*${REF.drawdownYears}, ${TARGET_REAL}*(1-POWER(1/(1+${RealReturn}), ${REF.drawdownYears}))/(${RealReturn}))
)`;
    const GAP = `(${CLOSE} - ${REQUIRED})`;

    aoa.push([
      scenario,
      { f: YEAR },
      { f: AGE },
      { f: PHASE },
      { f: HOUSEHOLD_SALARY_USED },
      { f: PERS_YR },
      { f: EMPL_YR },
      { f: TOTAL_CONTRIB },
      { f: OPEN },
      { f: INV_RET },
      { f: OTHER_INCOME },
      { f: TARGET_NET },
      { f: WITHDRAWAL },
      { f: CLOSE },
      { f: REQUIRED },
      { f: GAP }
    ]);
  }

  // Current + Max 60 rows (unchanged)
  for (let i=0; i<60; i++) makeRow(i, 'Current');
  for (let i=0; i<60; i++) makeRow(i, 'Max');

  const wsR = XLSX.utils.aoa_to_sheet(aoa);
  wsR['!cols'] = HEAD.map(h => ({ wch: Math.max(18, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, wsR, 'Results');

  // ===== New Sheet 3: FF Target — Required Pot (from Assumptions)
  (function addFFTargetRequired(){
    // Horizon
    const yrsToRet = `MAX(0, ${REF.retirementAge}-${REF.currentAge})`;
    const yrsRet   = `MAX(0, 100-${REF.retirementAge})`;

    // Income need and other income at retirement
    const SpendAtRet = `(${REF.householdSalary}*${REF.targetPct})*POWER(1+${REF.cpi}, ${yrsToRet})`;
    const RentAtRet  = `(${REF.rentYr})*POWER(1+${REF.cpi}, ${yrsToRet})`;
    const PartnerAgeAtRet = `IFERROR(N(${REF.partnerAge})+${yrsToRet}, 0)`;

    // Friendly header explaining linkage
    const title = [
      ['Financial Freedom Target — Required Pot at Retirement'],
      ['(All inputs reference "Assumptions & Inputs" sheet. Each row is one retirement year t, discounted back to retirement.)'],
      []
    ];

    const header = [
      't (years from retire)',
      'Age',
      'Inflation factor (t)',
      'Gross need (€/yr)',
      'Rent (€/yr)',
      'DB — You (€/yr)',
      'DB — Partner (€/yr)',
      'SP — You (€/yr)',
      'SP — Partner (€/yr)',
      'Net need (€/yr)',
      'Discount factor',
      'PV(net need)'
    ];

    const tRef = `(ROW()-3-3)`; // data table starts at row 4 after 3-title rows → row 4 gives t=0

    const AGE         = `(${REF.retirementAge}+${tRef})`;
    const INFL_T      = `POWER(1+${REF.cpi}, ${tRef})`;
    const NEED_GROSS  = `(${SpendAtRet}*${INFL_T})`;
    const RENT_T      = `(${RentAtRet}*${INFL_T})`;
    const DB_SELF_T   = `IF(${AGE}>=${REF.dbSelfAge}, IF(${REF.hasDbSelf}="On", ${REF.dbSelfYr}*${INFL_T}, 0), 0)`;
    const DB_PART_T   = `IF(${AGE}>=${REF.dbPartnerAge}, IF(${REF.hasDbPartner}="On", ${REF.dbPartnerYr}*${INFL_T}, 0), 0)`;
    const SP_SELF_T   = `IF(${REF.spSelfOn}="On", IF(${AGE}>=${REF.spStartAge}, ${REF.spAnnual}, 0), 0)`;
    const SP_PART_T   = `IF(${REF.spPartnerOn}="On", IF((${PartnerAgeAtRet}+${tRef})>=${REF.spStartAge}, ${REF.spAnnual}, 0), 0)`;
    const NET_NEED    = `MAX(0, ${NEED_GROSS} - (${RENT_T}+${DB_SELF_T}+${DB_PART_T}+${SP_SELF_T}+${SP_PART_T}))`;
    const DF_T        = `1/POWER(1+${REF.growth}, ${tRef}+1)`;
    const PV_T        = `(${NET_NEED}*${DF_T})`;

    // Build rows
    const rows = [...title, header];
    const MAX_ROWS = 60; // covers most retire ages to 100
    for (let i = 0; i < MAX_ROWS; i++) {
      rows.push([
        { f: tRef },         // t
        { f: AGE },          // Age
        { f: INFL_T },       // inflation factor
        { f: NEED_GROSS },   // gross need
        { f: RENT_T },       // rent
        { f: DB_SELF_T },    // DB self (inflated)
        { f: DB_PART_T },    // DB partner (inflated)
        { f: SP_SELF_T },    // SP self
        { f: SP_PART_T },    // SP partner
        { f: NET_NEED },     // net need
        { f: DF_T },         // discount factor
        { f: `IF(${tRef}<${yrsRet}, ${PV_T}, "")` } // PV within horizon only
      ]);
    }

    // Footer with link-back formulas
    rows.push([]);
    rows.push(['Inputs (linked)', '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Base year', { f: REF.baseYear }]);
    rows.push(['Retirement age', { f: REF.retirementAge }]);
    rows.push(['Current age', { f: REF.currentAge }]);
    rows.push(['Target % of salary (decimal)', { f: REF.targetPct }]);
    rows.push(['Salary today — household (€)', { f: REF.householdSalary }]);
    rows.push(['CPI (decimal)', { f: REF.cpi }]);
    rows.push(['Growth (decimal)', { f: REF.growth }]);
    rows.push(['SP toggles: You / Partner', { f: REF.spSelfOn }, { f: REF.spPartnerOn }]);
    rows.push(['SP annual (€/yr)', { f: REF.spAnnual }]);
    rows.push(['SP start age', { f: REF.spStartAge }]);
    rows.push(['DB — You: on?, €/yr, start age', { f: REF.hasDbSelf }, { f: REF.dbSelfYr }, { f: REF.dbSelfAge }]);
    rows.push(['DB — Partner: on?, €/yr, start age', { f: REF.hasDbPartner }, { f: REF.dbPartnerYr }, { f: REF.dbPartnerAge }]);
    rows.push(['Rent today (€/yr)', { f: REF.rentYr }]);

    // Final required pot (rounded like JS)
    rows.push([]);
    rows.push([
      'Required pot @ retirement (sum PV of net need)',
      { f: `ROUND(SUM(L4:INDEX(L:L, 3+1+${MAX_ROWS})), -3)` } // Sum PV column within table; round to nearest €1k
    ]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      {wch:10},{wch:8},{wch:16},{wch:20},{wch:14},{wch:16},
      {wch:18},{wch:14},{wch:18},{wch:18},{wch:16},{wch:16}
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'FF Target — Required Pot');
  })();

  // Common snippets for projections
  const AGE_BAND_PCT_FN = (ageRef) =>
    `IF(${ageRef}<=29,0.15,IF(${ageRef}<=39,0.20,IF(${ageRef}<=49,0.25,IF(${ageRef}<=54,0.30,IF(${ageRef}<=59,0.35,0.40)))))`;

  // ===== New Sheet 4: Projection — Current
  const projCurrent = (function(){
    const header = ['Year','Age','Phase','Opening','Personal (€/yr)','Employer (€/yr)','Total Contrib (€/yr)','Investment (€/yr)','End'];
    const rows = [header];
    const totalRows = (typeof A.currentAge === 'number' && typeof A.retirementAge === 'number')
      ? (Math.max(0, A.retirementAge - A.currentAge) + 1) : 1;

    for (let i=0; i<totalRows; i++) {
      const row = [];
      const YEAR = `(${REF.baseYear}+${i})`;
      const AGE  = `(${REF.currentAge}+${i})`;
      const PHASE = `IF(${AGE}<${REF.retirementAge},"Accumulation","Drawdown")`;
      const PERS = `IF(${PHASE}="Accumulation", (${REF.persSelfYr}+${REF.persPartYr}), 0)`;
      const EMPL = `IF(${PHASE}="Accumulation", (${REF.emplSelfYr}+${REF.emplPartYr}), 0)`;
      const TOTC = `(${PERS}+${EMPL})`;

      const OPEN = (i===0)
        ? `(${REF.curPotSelf}+${REF.curPotPartner})`
        : `INDIRECT(ADDRESS(ROW()-1, 9))`; // previous row col 9 (End)

      const INV  = `(${OPEN}+${TOTC})*${REF.growth}`;
      const END  = `(${OPEN}+${TOTC}+${INV})`;

      rows.push([
        { f: YEAR }, { f: AGE }, { f: PHASE },
        { f: OPEN }, { f: PERS }, { f: EMPL }, { f: TOTC },
        { f: INV },  { f: END }
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:10},{wch:8},{wch:14},{wch:18},{wch:18},{wch:18},{wch:20},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws, 'Projection — Current');
    return { rows: rows.length }; // includes header
  })();

  // ===== New Sheet 5: Projection — Max
  const projMax = (function(){
    const header = ['Year','Age','Phase','Opening','Personal (€/yr)','Employer (€/yr)','Total Contrib (€/yr)','Investment (€/yr)','End'];
    const rows = [header];
    const totalRows = (typeof A.currentAge === 'number' && typeof A.retirementAge === 'number')
      ? (Math.max(0, A.retirementAge - A.currentAge) + 1) : 1;

    for (let i=0; i<totalRows; i++) {
      const YEAR = `(${REF.baseYear}+${i})`;
      const AGE  = `(${REF.currentAge}+${i})`;
      const PHASE = `IF(${AGE}<${REF.retirementAge},"Accumulation","Drawdown")`;
      const PERC = AGE_BAND_PCT_FN(AGE);
      const SALCAP = `(${REF.salaryCapSelf}+${REF.salaryCapPartner})`;
      const PERS = `IF(${PHASE}="Accumulation", ${SALCAP}*${PERC}, 0)`;
      const EMPL = `(0)`;
      const TOTC = `(${PERS}+${EMPL})`;

      const OPEN = (i===0)
        ? `(${REF.curPotSelf}+${REF.curPotPartner})`
        : `INDIRECT(ADDRESS(ROW()-1, 9))`;

      const INV  = `(${OPEN}+${TOTC})*${REF.growth}`;
      const END  = `(${OPEN}+${TOTC}+${INV})`;

      rows.push([
        { f: YEAR }, { f: AGE }, { f: PHASE },
        { f: OPEN }, { f: PERS }, { f: EMPL }, { f: TOTC },
        { f: INV },  { f: END }
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:10},{wch:8},{wch:14},{wch:18},{wch:18},{wch:18},{wch:20},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws, 'Projection — Max');
    return { rows: rows.length }; // includes header
  })();

  // Helper: cell refs to the retirement pot from the two projection sheets
  const projCurEndCell = `'Projection — Current'!${XLSX.utils.encode_cell({ r: projCurrent.rows - 1, c: 8 })}`; // col 8 = End (0-based)
  const projMaxEndCell = `'Projection — Max'!${XLSX.utils.encode_cell({ r: projMax.rows - 1, c: 8 })}`;

  /**
   * Add a drawdown sheet reusing your assumptions and formulas.
   * title: "Drawdown — Current" | "Drawdown — Max"
   * startPotRef: Excel ref to opening pot at retirement (End of projection).
   */
  function addDrawdownSheet(title, startPotRef) {
    // Put the depletion summary on row 1, then table from row 3 for neatness
    const header = ['Year','Age','Opening','Income need (€/yr)','Other income (€/yr)','Withdrawal (€/yr)','Investment (€/yr)','End'];
    const rows   = [[], ['Depletion age:','','','','','','',''], header];

    const total = (typeof A.drawdownYears === 'number') ? A.drawdownYears + 1 : 41;

    for (let t=0; t<total; t++) {
      const YEAR = `(${REF.baseYear}+(${yrsToRet})+${t})`;
      const AGE  = `(${REF.retirementAge}+${t})`;

      const OPEN = (t===0)
        ? `${startPotRef}`
        : `INDIRECT(ADDRESS(ROW()-1, 8))`; // previous row End (col H)

      const YEARS_FROM_TODAY = `(${yrsToRet}+${t})`;
      const DB_SELF = `IF(${AGE}>=${REF.dbSelfAge}, IF(${REF.hasDbSelf}="On", ${REF.dbSelfYr}, 0), 0)`;
      const DB_PART = `IF(${AGE}>=${REF.dbPartnerAge}, IF(${REF.hasDbPartner}="On", ${REF.dbPartnerYr}, 0), 0)`;
      const RENT    = `${REF.rentYr}`;
      const OTHER   = `(${DB_SELF}+${DB_PART}+${RENT})`;
      const NEED    = `${TargetIncomeToday}*POWER(1+${REF.cpi}, ${YEARS_FROM_TODAY}) - ${OTHER}`;

      const INV  = `(${OPEN})*${REF.growth}`;
      const WTH  = `MAX(0, MIN(${OPEN}+${INV}, ${NEED}))`;
      const END  = `(${OPEN}+${INV}-${WTH})`;

      rows.push([{ f: YEAR }, { f: AGE }, { f: OPEN }, { f: NEED }, { f: OTHER }, { f: WTH }, { f: INV }, { f: END }]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Make columns readable
    ws['!cols'] = [
      {wch:10},{wch:8},{wch:18},{wch:22},{wch:20},{wch:18},{wch:18},{wch:18}
    ];

    // Depletion summary (first exact 0 in End column H)
    // Our table starts at row 3 (headers), so adjust the range accordingly.
    ws['B2'] = { f: `IFERROR(INDEX(B:B, MATCH(0, H:H, 0)), "")` };

    XLSX.utils.book_append_sheet(wb, ws, title);
  }

  // Build both drawdown sheets with a shared helper
  addDrawdownSheet('Drawdown — Current', projCurEndCell);
  addDrawdownSheet('Drawdown — Max',     projMaxEndCell);

  return wb;
}



export async function downloadFullMontyExcel() {
  const XLSX = await ensureXLSX();
  const wb = buildWorkbook(XLSX);
  const name = `Planéir_FullMonty_Data_${ymd()}.xlsx`;
  XLSX.writeFile(wb, name, { compression: true });
}
