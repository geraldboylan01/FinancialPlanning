export const CPI = 0.023;                     // Inflation
export const STATE_PENSION = 15044;           // € p.a.
export const SP_START = 66;                   // State Pension start age
export const MAX_SALARY_CAP = 115000;         // Revenue cap for personal % calc

export function sftForYear(year) {
  if (year < 2026) return 2000000;
  if (year <= 2029) return 2000000 + 200000 * (year - 2025);
  return 2800000; // assumed fixed post-2029
}
