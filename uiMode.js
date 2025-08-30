export function setUIMode(mode){
  // mode: 'wizard' | 'results'
  document.body.classList.toggle('is-results', mode === 'results');
  document.body.classList.toggle('is-wizard', mode === 'wizard');
}

export function applyModeFromLocation(){
  const h = (location.hash || '').toLowerCase();
  if(h.includes('result')) setUIMode('results');
  else setUIMode('wizard');
}

window.addEventListener('hashchange', applyModeFromLocation);
document.addEventListener('DOMContentLoaded', applyModeFromLocation);
