// Shared helpers for wizard components
export function computeLabels(steps){
  return Object.fromEntries(
    steps.map(s=>[s.id, s.q.replace(/<br.*?>/g,'').replace(/&[^;]+;/g,'').trim()])
  );
}

export function animate(stepContainer,dir){
  stepContainer.classList.remove('anim-left','anim-right');
  void stepContainer.offsetWidth;
  stepContainer.classList.add(dir==='next'?'anim-right':'anim-left');
}

export function addKeyboardNav(modal,{back,next,close,getCur,getTotal}){
  function handler(e){
    if(!modal.classList.contains('is-open')) return;
    if(['ArrowLeft','ArrowRight','Escape'].includes(e.key)) e.preventDefault();
    if(e.key==='ArrowLeft' && getCur()>0) back();
    else if(e.key==='ArrowRight' && getCur()<getTotal()-1) next();
    else if(e.key==='Escape') close();
  }
  window.addEventListener('keydown',handler);
}
