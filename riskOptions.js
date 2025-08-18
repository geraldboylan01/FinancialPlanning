export const RISK_OPTIONS = {
  low:      { label: 'Low risk',      mix: '≈ 30% stocks / 70% bonds', rate: 0.04 },
  balanced: { label: 'Balanced',      mix: '≈ 50% stocks / 50% bonds', rate: 0.05 },
  high:     { label: 'High risk',     mix: '≈ 70% stocks / 30% bonds', rate: 0.06 },
  veryHigh: { label: 'Very-high',     mix: '100% stocks',              rate: 0.07 }
};

console.debug('[riskOptions] loaded', RISK_OPTIONS);
