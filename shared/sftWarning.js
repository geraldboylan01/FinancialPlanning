// shared/sftWarning.js
export const SFT_WARNING_TITLE = 'Standard Fund Threshold (SFT)';

/**
 * Unified SFT notice, with the *original two paragraphs* restored.
 * - variant: 'fullmonty' -> notice-card markup; 'block' (default) -> warning-block markup
 */
export function getSftWarningHTML({
  retirementYear = null,
  sftLimit = null,
  variant = 'block'
} = {}) {
  const fmt = n => '€' + Number(n || 0).toLocaleString();

  // === the three parts you lost in the PR ===
  const definitionHTML = `
    <p>
      The Standard Fund Threshold (SFT) is the cap on pension savings in Ireland.
      Any amount above it when your pension is “crystallised” (typically retirement)
      is taxed at <b>40%</b>.
    </p>
  `;

  const compareLineHTML =
    (retirementYear != null && sftLimit != null)
      ? `<p>We’re comparing against the Revenue SFT for <b>${retirementYear}</b>: <b>${fmt(sftLimit)}</b> based on today’s rules.</p>`
      : '';

  const pathNoteHTML = `
    <p class="dim">
      <em>Reference:</em> The Irish Government has legislated that the
      <b>Standard Fund Threshold (SFT)</b> will increase by <b>€200,000 each year</b> —
      rising from <b>€2.0m in 2025</b> to <b>€2.8m in 2029</b>.<br><br>
      Beyond 2029, the Government has said the SFT will be linked to wage inflation,
      but they have not published how this will be calculated or what figures will apply,
      and future Budgets could change the rules.<br><br>
      To avoid giving a misleading picture, this tool takes a <b>conservative approach</b>
      and assumes the SFT stays fixed at <b>€2.8m from 2030 onward</b>, until official
      guidance is released.
    </p>
  `;

  if (variant === 'fullmonty') {
    // Card used on Full Monty results
    return `
      <div class="notice-card warn" data-warning="sft-standard">
        <div class="title">${SFT_WARNING_TITLE}</div>
        <div class="meta">
          ${definitionHTML}
          ${compareLineHTML}
          ${pathNoteHTML}
        </div>
      </div>
    `;
  }

  // Default: compact warning block (used by standalone tools + PDFs)
  return `
    <div class="warning-block" data-warning="sft-standard">
      ⚠️ <strong>${SFT_WARNING_TITLE}</strong><br><br>
      ${definitionHTML}
      ${compareLineHTML}
      ${pathNoteHTML}
    </div>
  `;
}
