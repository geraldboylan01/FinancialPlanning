import { CPI, STATE_PENSION, SP_START, sftForYear } from './assumptions.js';

const yrDiff = (d, ref) => (ref - d) / (1000*60*60*24*365.25);

/**
 * Computes the pension pot needed at retirement to fund spending to age 100,
 * mirroring the FY Money calculator logic in a pure function.
 */
export function fyRequiredPot({
  grossIncome,           // number €/yr
  incomePercent,         // 0..100
  includeSP,             // boolean (self)
  includePartnerSP,      // boolean
  partnerExists,         // boolean
  dob,                   // Date
  partnerDob,            // Date|null
  retireAge,             // number
  gRate,                 // 0.04..0.07
  rentalToday,           // €/yr (current)
  hasDbSelf, dbAnnualSelf, dbStartAgeSelf,
  hasDbPartner, dbAnnualPartner, dbStartAgePartner
}) {
  const now = new Date();
  const curAge = yrDiff(dob, now);
  const yrsToRet = retireAge - curAge;
  const yrsRet   = 100 - retireAge;

  const spendBase  = (grossIncome || 0) * (incomePercent / 100);
  const spendAtRet = spendBase * Math.pow(1 + CPI, yrsToRet);
  const rentAtRet  = (rentalToday || 0) * Math.pow(1 + CPI, yrsToRet);

  const partnerCurAge   = partnerDob ? yrDiff(partnerDob, now) : null;
  const partnerAgeAtRet = partnerDob ? partnerCurAge + yrsToRet : null;

  const dbAt = (age) => {
    let v = 0;
    if (hasDbSelf && age >= (dbStartAgeSelf ?? Infinity)) v += (dbAnnualSelf || 0);
    if (partnerExists && hasDbPartner && age >= (dbStartAgePartner ?? Infinity)) v += (dbAnnualPartner || 0);
    return v;
  };

  let reqCap = 0;
  let alwaysSurplus = true;

  for (let t = 0; t < yrsRet; t++) {
    const age  = retireAge + t;
    const infl = Math.pow(1 + CPI, t);
    const spend = spendAtRet * infl;
    const rent  = rentAtRet  * infl;
    const db    = dbAt(age)  * infl;

    let sp = 0;
    if (includeSP && age >= SP_START) sp += STATE_PENSION;
    if (includePartnerSP && partnerAgeAtRet && (partnerAgeAtRet + t) >= SP_START) sp += STATE_PENSION;

    const net = spend - sp - rent - db;
    if (net > 0) {
      alwaysSurplus = false;
      reqCap += net / Math.pow(1 + gRate, t + 1);
    }
  }

  reqCap = Math.max(0, Math.round(reqCap / 1000) * 1000);
  const retirementYear   = now.getFullYear() + Math.ceil(yrsToRet);
  const sftLimitSingle   = sftForYear(retirementYear);
  const sftLimitCombined = includePartnerSP ? sftLimitSingle * 2 : sftLimitSingle;

  let sftWarning = '';
  if (reqCap > sftLimitCombined) {
    sftWarning = includePartnerSP
      ? `Required (€${reqCap.toLocaleString()}) exceeds combined SFT for ${retirementYear} (2 × €${sftLimitSingle.toLocaleString()} = €${sftLimitCombined.toLocaleString()}).`
      : `Required (€${reqCap.toLocaleString()}) exceeds SFT for ${retirementYear} (€${sftLimitSingle.toLocaleString()}).`;
  }

  return { requiredPot: reqCap, retirementYear, alwaysSurplus, sftWarningStripped: sftWarning };
}
