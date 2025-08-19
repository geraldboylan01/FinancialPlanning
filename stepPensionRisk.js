// stepPensionRisk.js
// A11y-first radio-card selector with slick mobile/desktop UX.
// Keeps your existing API + localStorage keys.

const RISK_OPTIONS = {
  low: {
    label: 'Low risk',
    mix: '≈ 30% stocks / 70% bonds',
    rate: 0.04,
    level: 2, // fills 2/5 on the meter
    blurb: 'Lower volatility; slower expected growth.'
  },
  balanced: {
    label: 'Balanced',
    mix: '≈ 50% stocks / 50% bonds',
    rate: 0.05,
    level: 3,
    blurb: 'Balanced mix of growth and stability.'
  },
  high: {
    label: 'High risk',
    mix: '≈ 70% stocks / 30% bonds',
    rate: 0.06,
    level: 4,
    blurb: 'Higher expected growth with larger swings.'
  },
  veryHigh: {
    label: 'Very-high',
    mix: '100% stocks',
    rate: 0.07,
    level: 5,
    blurb: 'Maximum growth potential; highest volatility.'
  }
};

function pct(n){ return (n * 100).toFixed(0) + '%'; }

export function renderStepPensionRisk(container, store, setStore, nextBtn){
  const AUTO_ADVANCE = false; // set true if you want to auto-advance after a pick
  const savedKey  = store?.pensionRiskKey || localStorage.getItem('fm.pensionRiskKey');
  const hasSaved  = savedKey && RISK_OPTIONS[savedKey];

  container.innerHTML = '';

  // —— Wrapper
  const wrap = document.createElement('div');
  wrap.className = 'risk-step';

  // —— Header / helper
  const head = document.createElement('div');
  head.className = 'risk-head';
  head.innerHTML = `
    <h3 class="risk-title">Choose your pension growth profile</h3>
    <p class="risk-sub">
      This sets a long-term growth assumption for projections (not a guarantee).
      You can change it later.
    </p>
  `;
  wrap.appendChild(head);

  // —— Cards (radiogroup)
  const grid = document.createElement('div');
  grid.className = 'risk-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Select a pension risk profile');

  // roving tabindex helpers
  const createCard = (key, opt, isFirst) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'risk-card';
    card.dataset.key = key;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.tabIndex = isFirst ? 0 : -1;
    card.innerHTML = `
      <div class="rc-head">
        <div class="rc-label">${opt.label}</div>
        <div class="rc-mix">${opt.mix}</div>
      </div>
      <div class="rc-body">
        <div class="rc-rate">
          <span class="rc-rate-num">${pct(opt.rate)}</span>
          <span class="rc-rate-sub">assumed annual growth</span>
        </div>
        <div class="rc-meter" aria-hidden="true" data-level="${opt.level}">
          <i></i><i></i><i></i><i></i><i></i>
        </div>
        <p class="rc-blurb">${opt.blurb}</p>
      </div>
      <div class="rc-cta" aria-hidden="true">Select</div>
    `;

    // Press ripple / tactile feedback (simple)
    card.addEventListener('pointerdown', () => card.classList.add('pressed'));
    card.addEventListener('pointerup',   () => card.classList.remove('pressed'));
    card.addEventListener('pointercancel', () => card.classList.remove('pressed'));
    card.addEventListener('pointerleave',  () => card.classList.remove('pressed'));

    // Selection
    card.addEventListener('click', () => select(key, true));

    // Keyboard: Space/Enter select; arrows move focus
    card.addEventListener('keydown', (e) => {
      const cards = Array.from(grid.querySelectorAll('.risk-card'));
      const idx = cards.indexOf(card);
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        select(key, true);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = cards[(idx + 1) % cards.length];
        next.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = cards[(idx - 1 + cards.length) % cards.length];
        prev.focus();
      }
    });

    return card;
  };

  Object.entries(RISK_OPTIONS).forEach(([key, opt], i) => {
    grid.appendChild(createCard(key, opt, i === 0));
  });

  wrap.appendChild(grid);

  // —— Footer / note
  const foot = document.createElement('div');
  foot.className = 'risk-foot';
  foot.innerHTML = `
    <div class="risk-note">
      <strong>Note:</strong> These rates are planning assumptions for illustration.
      Real-world returns vary and can be negative in some years.
    </div>
  `;
  wrap.appendChild(foot);

  container.appendChild(wrap);

  // Initial state
  if (nextBtn) nextBtn.disabled = !hasSaved;
  if (hasSaved) select(savedKey, false);

  function select(key, userInitiated){
    // Visually mark
    grid.querySelectorAll('.risk-card').forEach((c) => {
      const isSel = c.dataset.key === key;
      c.classList.toggle('selected', isSel);
      c.setAttribute('aria-checked', String(isSel));
      c.tabIndex = isSel ? 0 : -1;
    });

    // Persist + push to store
    const sel = RISK_OPTIONS[key];
    setStore({
      pensionRisk: sel.label,
      pensionRiskKey: key,
      pensionGrowthRate: sel.rate
    });
    localStorage.setItem('fm.pensionRiskKey', key);
    localStorage.setItem('fm.pensionRiskLabel', sel.label);
    localStorage.setItem('fm.pensionGrowthRate', String(sel.rate));

    if (nextBtn) nextBtn.disabled = false;
    if (AUTO_ADVANCE && userInitiated && nextBtn) {
      // brief affordance before moving on
      setTimeout(() => nextBtn.click(), 140);
    }
  }
}

export function validateRiskSelection(){
  const key = localStorage.getItem('fm.pensionRiskKey');
  const rate = parseFloat(localStorage.getItem('fm.pensionGrowthRate'));
  const ok = !!key && Number.isFinite(rate);
  return ok ? { ok: true } : { ok: false, message: 'Please choose a risk profile.' };
}

// Keep compatibility with your wizard:
export const renderStepPensionRiskValidate = validateRiskSelection;
export const validate = validateRiskSelection;
export default { renderStepPensionRisk, validateRiskSelection };
renderStepPensionRisk.validate = validateRiskSelection;

