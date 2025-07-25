import { openFullMontyWizard } from './fullMontyWizard.js';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('launchFullMonty');
  if (btn) {
    btn.addEventListener('click', e => {
      e.preventDefault();
      openFullMontyWizard();
    });
  }
});
