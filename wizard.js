import { profile, saveProfile } from "./profile.js";
import { animate, addKeyboardNav, computeLabels } from './wizardCore.js';
const steps = [
  {id:"dob", q:"What is your date of birth?", type:"date"},
  {id:"partnerExists", q:"Do you share your finances with a spouse or long-term partner (married, civil-partnered, or co-habiting)?", type:"boolean"},
  {id:"grossIncome", q:"What is your personal gross annual income (before tax), in euros?", type:"number", min:0},
  {id:"incomePercent", q:"Approximately what percentage of your current income would you like to receive each year after you retire?", type:"number", min:0, max:100, step:0.1},
  {id:"retireAge", q:"At what age do you plan to start drawing your pension?", type:"number", min:18, max:100},
  {id:"statePension", q:"Do you expect to qualify for the Irish State Pension?", type:"boolean"},
  {id:"partnerStatePension", q:"Will your partner qualify for the Irish State Pension?", type:"boolean", visIf:p=>p.partnerExists},
  {id:"partnerDob", q:"What is your partner’s date of birth?", type:"date", visIf:p=>p.partnerStatePension===true},
  {id:"rentalIncome", q:"How much rental income do you currently collect each year, in euros? (leave blank if none)", type:"number", min:0, optional:true},
  {id:"hasDb", q:"Do you expect to receive income from a Defined-Benefit (DB) pension scheme?", type:"boolean"},
  {id:"dbPension", q:"What annual amount do you expect to receive from that DB pension at retirement, in euros?", type:"number", min:0, visIf:p=>p.hasDb},
  {id:"dbStartAge", q:"At what age will your DB pension payments begin?", type:"number", min:50, max:100, visIf:p=>p.hasDb},
  // growth profile rendered with custom cards in the wizard
  {id:"growthRate", q:"Select an investment-growth (risk) profile for your pension.", type:"riskCard"}
];

const modal=document.getElementById('wizardModal');
const stepContainer=document.getElementById('wizardStepContainer');
const btnBack=document.getElementById('wizBack');
const btnNext=document.getElementById('wizNext');
const dots=document.getElementById('wizDots');
const progEl=document.getElementById('wizProgress');
const progFill = document.getElementById('wizProgressFill');
let visibleSteps=[];
let cur=0;
const STEP_LABELS = computeLabels(steps);

// utility to jump directly to a step -------------------------------
function gotoStep(i){
  // optional: validate steps before i here if you want to enforce order
  animate(stepContainer, i>cur?'next':'back');
  cur=i;
  render();
}

function btn(txt){
  const b=document.createElement('button');
  b.textContent=txt;
  return b;
}

function refresh(){
  visibleSteps=steps.filter(s=>!s.visIf||s.visIf(profile));
  steps.forEach(s=>{ if(s.visIf && !s.visIf(profile)) delete profile[s.id]; });
}

/* builds an <input type=number> wrapped with € or % */
function unitBox({ id, value = '', min, max, step, unit = '€', side = 'prefix' }) {
  const wrap = document.createElement('div');
  wrap.className = `input-wrap ${side}`;

  const inp  = document.createElement('input');
  inp.type   = 'number';
  inp.id     = id;
  if (min  != null) inp.min  = min;
  if (max  != null) inp.max  = max;
  if (step != null) inp.step = step;
  inp.value = value;
  wrap.appendChild(inp);

  const span = document.createElement('span');
  span.className   = 'unit';
  span.textContent = unit;
  wrap.appendChild(span);

  return wrap;
}

function buildInput(step){
  let input;
  if(step.type==='boolean'){
    const ctr=document.createElement('div');
    const id=step.id;
    const yes=btn('Yes'), no=btn('No');
    yes.onclick=()=>{ profile[id]=true;  saveProfile(); next(); };
    no.onclick =()=>{ profile[id]=false; saveProfile(); next(); };
    ctr.append(yes,no);
    btnNext.style.visibility='hidden';
    input=ctr;
  }else if(step.type==='riskCard'){
    const opts = [
      {val:0.04, title:'Low risk',    desc:'≈ 30 % stocks / 70 % bonds<br>≈ 4 % p.a.'},
      {val:0.05, title:'Balanced',    desc:'≈ 50 % stocks / 50 % bonds<br>≈ 5 % p.a.'},
      {val:0.06, title:'High risk',   desc:'≈ 70 % stocks / 30 % bonds<br>≈ 6 % p.a.'},
      {val:0.07, title:'Very-high',   desc:'100 % stocks<br>≈ 7 % p.a.'}
    ];
    const wrap=document.createElement('div');
    wrap.className='risk-options';
    opts.forEach(o=>{
      const card=document.createElement('div');
      card.className='risk-card';
      card.innerHTML=`<span class="risk-title">${o.title}</span>`+
                     `<span class="risk-desc">${o.desc}</span>`;
      card.onclick=()=>{
        wrap.querySelectorAll('.risk-card.selected').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
        profile.growthRate=o.val;
        saveProfile();
        btnNext.disabled=false;
      };
      if(profile.growthRate===o.val) card.classList.add('selected');
      wrap.appendChild(card);
    });
    btnNext.style.visibility='visible';
    btnNext.disabled=!profile.growthRate;
    input=wrap;
  }else{
    btnNext.style.visibility='visible';
    if(step.id==='incomePercent'){
      input = unitBox({
        id:'wizInput',
        value:profile[step.id]??'',
        min:step.min, max:step.max, step:step.step,
        unit:'%', side:'suffix'
      });
    }else if(['salary','currentValue','grossIncome','rentalIncome','dbPension',
              'personalContrib','employerContrib'].includes(step.id)){
      input = unitBox({
        id:'wizInput',
        value:profile[step.id]??'',
        min:step.min, max:step.max, step:step.step,
        unit:'€', side:'prefix'
      });
    }else if(step.type==='number'||step.type==='date'){
      input=document.createElement('input');
      input.type=step.type;
      if(step.min!=null) input.min=step.min;
      if(step.max!=null) input.max=step.max;
      if(step.step!=null) input.step=step.step;
      input.value=profile[step.id]??'';
    }else if(step.type==='choice'){
      input=document.createElement('select');
      step.choices.forEach(c=>{
        const opt=document.createElement('option');
        opt.value=c.value;opt.textContent=c.label;input.appendChild(opt);
      });
      input.value=profile[step.id]??step.choices[0].value;
    }
  }
  input.id='wizInput';
  return input;
}

function render(){
  refresh();
  if(cur<0) cur=0;
  if(cur>=visibleSteps.length){ finalize(); return; }
  const step=visibleSteps[cur];
  const totalVisible=visibleSteps.length;
  const visibleIndex=cur;
  progEl.textContent=`Step ${visibleIndex+1} of ${totalVisible}`;
  const pc=(cur+1)/visibleSteps.length*100;
  progFill.style.width=pc+'%';
  stepContainer.innerHTML='';
  const q=document.createElement('p');
  q.textContent=step.q;
  stepContainer.appendChild(q);
  stepContainer.appendChild(buildInput(step));
  const focusable=stepContainer.querySelector('input,button,select,textarea,[tabindex]:not([tabindex="-1"])');
  if(focusable) focusable.focus();
  btnBack.style.display=cur===0?'none':'';
  btnNext.textContent=cur===visibleSteps.length-1?'Submit':'Next';
  dots.innerHTML = visibleSteps.map((_, i) =>
    `<button
      class="wizDot${i === cur ? ' active' : ''}"
      data-idx="${i}"
      title="${STEP_LABELS[visibleSteps[i].id]}"
      aria-label="Jump to step ${i + 1}">
    </button>`
  ).join('');
  dots.querySelectorAll('button.wizDot').forEach(btn => {
    btn.addEventListener('click', e => {
      gotoStep(+e.currentTarget.dataset.idx);
    });
  });
}

function getValue(step){
  const el=document.getElementById('wizInput');
  if(step.type==='boolean') return profile[step.id]??null;
  if(step.type==='riskCard') return profile[step.id];
  if(step.type==='number') return el.value?+el.value:'';
  return el.value;
}

function valid(step,val){
  if(step.optional && (val===null||val==='')) return true;
  if(step.type==='number'){
    if(val===''||isNaN(val)) return false;
    if(step.min!=null && val<step.min) return false;
    if(step.max!=null && val>step.max) return false;
  }else if(step.type==='date'){
    if(!val) return false;
  }else if(step.type==='boolean'){
    if(val===null) return false;
  }
  return true;
}

function next(){
  refresh();
  const step=visibleSteps[cur];
  const val = step.type==='boolean' ? profile[step.id] : getValue(step);
  if(!valid(step,val)) return;
  if(step.type==='pair'){
    step.fields.forEach(f=>{ profile[f.id]=val[f.id]; });
    saveProfile();
  }else if(step.type!=='riskCard'){
    profile[step.id]=val; saveProfile();
  }
  animate(stepContainer,'next');
  cur++;
  render();
}

function back(){
  animate(stepContainer,'back');
  cur--;
  render();
}

btnNext.onclick=next;
btnBack.onclick=back;
addKeyboardNav(modal,{back,next,close:()=>modal.classList.add('hidden'),getCur:()=>cur,getTotal:()=>visibleSteps.length});

function copyToForm(){
  steps.forEach(s=>{
    if(s.type==='riskCard'){
      const val=profile[s.id];
      if(val==null) return;
      const field=document.querySelector(`input[name="${s.id}"][value="${val}"]`);
      if(field) field.checked=true;
      return;
    }
    const field=document.getElementById(s.id);
    if(!field) return;
    const val=profile[s.id];
    if(field.type==='checkbox') field.checked=!!val;
    else if(field.type==='radio'){ if(String(field.value)===String(val)) field.checked=true; }
    else field.value=val??'';
  });
}

function finalize(){
  modal.classList.add('hidden');
  copyToForm();
  document.getElementById('fyf-form').requestSubmit();
}

export const wizard={open(id){refresh();cur=id?visibleSteps.findIndex(s=>s.id===id):0;if(cur<0)cur=0;modal.classList.remove('hidden');render();}};
window.wizard=wizard;

document.addEventListener('DOMContentLoaded',()=>wizard.open());
