export const RISK_OPTIONS = {
  low:      { label: 'Low risk',      mix: '≈ 30% stocks / 70% bonds', rate: 0.04 },
  balanced: { label: 'Balanced',      mix: '≈ 50% stocks / 50% bonds', rate: 0.05 },
  high:     { label: 'High risk',     mix: '≈ 70% stocks / 30% bonds', rate: 0.06 },
  veryHigh: { label: 'Very-high',     mix: '100% stocks',              rate: 0.07 }
};

export function renderStepPensionRisk(container, store, setStore, nextBtn){
  container.innerHTML = '';
  // Keep the existing step text above this container; we’re only injecting the cards below it.
  const grid = document.createElement('div');
  grid.className = 'risk-grid';
  grid.setAttribute('role','radiogroup');

  const error = document.createElement('div');
  error.className = 'error';
  error.style.display = 'none';

  let selectedKey = store?.pensionRiskKey || localStorage.getItem('fm.pensionRiskKey') || null;

  function select(key){
    selectedKey = key;
    const opt = RISK_OPTIONS[key];
    setStore?.({ pensionRisk: opt.label, pensionRiskKey: key, pensionGrowthRate: opt.rate });
    try{
      localStorage.setItem('fm.pensionRiskKey', key);
      localStorage.setItem('fm.pensionGrowthRate', String(opt.rate));
    }catch(e){}
    grid.querySelectorAll('.risk-card').forEach(c=>{
      c.classList.toggle('selected', c.dataset.key===key);
      c.setAttribute('aria-checked', c.dataset.key===key ? 'true' : 'false');
    });
    if(nextBtn) nextBtn.disabled = false;
    error.style.display = 'none';
  }

  Object.entries(RISK_OPTIONS).forEach(([key,opt])=>{
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'risk-card';
    card.dataset.key = key;
    card.setAttribute('role','radio');
    card.setAttribute('aria-checked', 'false');
    card.innerHTML =
      `<span class="risk-title">${opt.label}</span>`+
      `<span class="risk-mix">${opt.mix}</span>`+
      `<span class="risk-rate">≈ ${(opt.rate*100).toFixed(0)}% p.a.</span>`;
    card.addEventListener('click', ()=>select(key));
    card.addEventListener('keydown', e=>{
      const cards = Array.from(grid.querySelectorAll('.risk-card'));
      let idx = cards.indexOf(card);
      if(['ArrowRight','ArrowDown'].includes(e.key)){ idx = (idx+1)%cards.length; cards[idx].focus(); e.preventDefault(); }
      if(['ArrowLeft','ArrowUp'].includes(e.key)){ idx = (idx-1+cards.length)%cards.length; cards[idx].focus(); e.preventDefault(); }
      if(['Enter',' '].includes(e.key)){ select(key); e.preventDefault(); }
    });
    grid.appendChild(card);
  });

  if(selectedKey){ select(selectedKey); }
  else if(nextBtn) { nextBtn.disabled = true; }

  container.appendChild(grid);
  container.appendChild(error);

  // Hook a per-step validator the wizard can call before advancing
  renderStepPensionRisk.validate = () => {
    const ok = !!selectedKey;
    if(!ok){
      error.textContent = 'Please select a growth profile to continue.';
      error.style.display = 'block';
    }
    return { ok, errors:{} };
  };
}
