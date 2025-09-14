// shared/warnings.js
// Minimal, data-driven warnings registry with HTML emitters.
// Keep .warning-block structure so existing CSS/PDF code continues to work.

import { getSftWarningHTML } from './sftWarning.js';
import { getMinWithdrawalsHTML } from './minWithdrawalsWarning.js';

/** Context contract all tools can provide */
/// ctx = {
///   retireAge: number,
///   retirementYear: number,
///   projectedValue: number,
///   sftLimit: number,            // optional; caller computes if needed
///   employerAnnual?: number,
///   personalAnnual?: number
/// }

export const WARN = {
  AGE_PRE50: 'age-pre50',
  AGE_50_59: 'age-50-59',
  AGE_OVER70: 'age-over70',
  AGE_75_PLUS: 'age-75-plus'
};

// Individual warning generators (return HTML strings)
function agePre50(ctx){
  if (ctx.retireAge >= 50) return '';
  return `
    <div class="warning-block danger" data-warning="${WARN.AGE_PRE50}">
      ⛔ <strong>Retiring Before Age 50</strong><br><br>
      Under Irish Revenue rules, pensions cannot be accessed before age 50 (except rare ill-health cases).
      These projections are illustrative only — professional guidance is recommended.
    </div>
  `;
}
function age50to59(ctx){
  if (ctx.retireAge < 50 || ctx.retireAge >= 60) return '';
  return `
    <div class="warning-block" data-warning="${WARN.AGE_50_59}">
      ⚠️ <strong>Retiring Between Age 50–59</strong><br><br>
      Early access may be possible only in limited cases (e.g. left linked employment; proprietary director fully severs ties).
      Check scheme rules and Revenue conditions before relying on early access assumptions.
    </div>
  `;
}
function ageOver70(ctx){
  if (ctx.retireAge <= 70 || ctx.retireAge >= 75) return '';
  return `
    <div class="warning-block" data-warning="${WARN.AGE_OVER70}">
      ⚠️ <strong>Retirement Age Over 70 (Occ. Pensions & PRBs)</strong><br><br>
      Most occupational pensions and PRBs must be drawn by age 70.
      PRSAs are the exception (can remain unretired until 75).
    </div>
  `;
}
function age75Plus(ctx){
  if (ctx.retireAge < 75) return '';
  return `
    <div class="warning-block danger" data-warning="${WARN.AGE_75_PLUS}">
      ⛔ <strong>Retirement Age 75 and Over</strong><br><br>
      All pensions (including PRSAs) must be accessed by age 75.
      If not, the pension may be deemed to vest and treated as taxable income.
    </div>
  `;
}

// Registry (order matters = render order)
const REGISTRY = [agePre50, age50to59, ageOver70, age75Plus];

/** Build warnings HTML list for a page, based on context */
export function buildWarningsHTML(ctx, { variant = 'block' } = {}) {
  const blocks = [];
  blocks.push(getSftWarningHTML({ ...ctx, variant }));
  blocks.push(getMinWithdrawalsHTML({ variant }));
  REGISTRY.forEach(fn => blocks.push(fn(ctx)));
  return blocks.filter(Boolean).join('');
}
