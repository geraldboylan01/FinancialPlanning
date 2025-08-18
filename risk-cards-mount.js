export function mountRiskCards(){
  // existing render...
  const cards = document.querySelectorAll('.risk-card');

  // If on a coarse pointer device with no hover (e.g., touch screens), reveal immediately
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches){
    cards.forEach(el => el.classList.add('in'));
    return;
  }

  // If IntersectionObserver missing or iOS Safari, reveal immediately
  const isIOS = document.documentElement.classList.contains('is-ios');
  if (!('IntersectionObserver' in window) || isIOS){
    cards.forEach(el => el.classList.add('in'));
    return;
  }

  // Existing IO logic (keep thresholds lenient)
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if (e.isIntersecting) e.target.classList.add('in');
    });
  }, { rootMargin: '150px 0px', threshold: 0.01 });
  cards.forEach(el => io.observe(el));
}
