import { profile, saveProfile } from "./profile.js";
const steps = [
  {id:"dob", q:"What’s your date of birth?", type:"date"},
  {id:"partnerExists", q:"Are you married, in a civil partnership, or sharing finances with a long-term partner?", type:"boolean"},
  {id:"grossIncome", q:"What’s your gross annual income (€)?", type:"number", min:0},
  {id:"incomePercent", q:"Roughly what % of that income would you like in retirement?", type:"number", min:0, max:100, step:0.1},
  {id:"retireAge", q:"At what age would you like to retire?", type:"number", min:18, max:100},
  {id:"statePension", q:"Do you expect to receive the Irish State Pension?", type:"boolean"},
  {id:"partnerStatePension", q:"Will your partner be entitled to the Irish State Pension?", type:"boolean", visIf:p=>p.partnerExists},
  {id:"partnerDob", q:"Partner’s date of birth?", type:"date", visIf:p=>p.partnerStatePension===true},
  {id:"rentalIncome", q:"Annual rental income today (€) — leave blank if none", type:"number", min:0, optional:true},
  {id:"hasDb", q:"Will you receive a Defined-Benefit (DB) pension?", type:"boolean"},
  {id:"dbPension", q:"DB pension annual amount at retirement (€)", type:"number", min:0, visIf:p=>p.hasDb},
  {id:"dbStartAge", q:"DB pension starts at age", type:"number", min:50, max:100, visIf:p=>p.hasDb},
  // growth profile rendered with custom cards in the wizard
  {id:"growthRate", q:"Choose a growth profile", type:"riskCard"}
];

const modal=document.getElementById('wizardModal');
const stepContainer=document.getElementById('wizardStepContainer');
const btnBack=document.getElementById('wizBack');
const btnNext=document.getElementById('wizNext');
const dots=document.getElementById('wizDots');
const progEl=document.getElementById('wizProgress');
let visibleSteps=[];
let cur=0;

function btn(txt){
  const b=document.createElement('button');
  b.textContent=txt;
  return b;
}

function refresh(){
  visibleSteps=steps.filter(s=>!s.visIf||s.visIf(profile));
  steps.forEach(s=>{ if(s.visIf && !s.visIf(profile)) delete profile[s.id]; });
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
    if(step.type==='number'||step.type==='date'){
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
  stepContainer.innerHTML='';
  const q=document.createElement('p');
  q.textContent=step.q;
  stepContainer.appendChild(q);
  stepContainer.appendChild(buildInput(step));
  btnBack.style.display=cur===0?'none':'';
  btnNext.textContent=cur===visibleSteps.length-1?'Submit':'Next';
  dots.innerHTML=visibleSteps.map((_,i)=>`<span class="dot${i===cur?' active':''}"></span>`).join('');
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
  cur++;
  render();
}

function back(){
  cur--;
  render();
}

btnNext.onclick=next;
btnBack.onclick=back;

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
