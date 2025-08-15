import { projectPension } from './shared/projectPension.js';

// Listens for fm-run-pension and emits fm-pension-output
// so the Full Monty results page can render projections.
document.addEventListener('fm-run-pension', (e) => {
  try {
    const args = e.detail || {};
    const out = projectPension(args);
    document.dispatchEvent(new CustomEvent('fm-pension-output', { detail: out }));
  } catch (err) {
    console.error('[pensionProjection] failed to project', err);
    const balances = [{ age: 0, value: 0 }];
    document.dispatchEvent(new CustomEvent('fm-pension-output', {
      detail: {
        balances,
        projValue: 0,
        retirementYear: new Date().getFullYear(),
        contribsBase: [0],
        growthBase: [0],
        showMax: false
      }
    }));
  }
});

