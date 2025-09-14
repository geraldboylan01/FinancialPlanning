export const MIN_WD_TITLE = 'Mandatory withdrawals (ARF / vested PRSA)';

export function getMinWithdrawalsHTML({ variant = 'block' } = {}) {
  const body = `
    Irish Revenue rules require minimum annual withdrawals from Approved Retirement Funds (ARFs) and vested PRSAs once you reach retirement.<br><br>
    Our charts do <strong>not</strong> model these withdrawals directly. However, a prudent investor who does not need to spend the full amount would typically reinvest the excess into assets of similar risk. While the tax treatment of reinvested funds may differ, this approach means the projections shown here still provide a realistic picture of long-term retirement outcomes.
  `;

  if (variant === 'fullmonty') {
    return `
      <div class="notice-card warn" data-warning="min-withdrawals">
        <div class="title">${MIN_WD_TITLE}</div>
        <div class="meta">${body}</div>
      </div>
    `;
  }

  return `
    <div class="warning-block" data-warning="min-withdrawals">
      ⚠️ <strong>${MIN_WD_TITLE}</strong><br><br>
      ${body}
    </div>
  `;
}
