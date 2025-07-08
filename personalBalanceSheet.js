// Wizard logic for Personal Balance Sheet
const modal = document.getElementById('wizardModal');
const container = document.getElementById('wizardStepContainer');
const btnBack = document.getElementById('wizBack');
const btnNext = document.getElementById('wizNext');
const dots = document.getElementById('wizDots');
const prog = document.getElementById('wizProgress');
const progFill = document.getElementById('wizProgressFill');
const titleEl = document.getElementById('wizTitle');

const defaultData = {
  lifestyle: {
    primaryHome: {},
    holidayHomes: []
  },
  liquidity: {},
  longevity: {
    pensions: [],
    diversified: []
  },
  legacy: {
    investmentProps: [],
    privateBiz: [],
    singleStocks: [],
    collectibles: []
  },
  liabilities: []
};

let personalBalanceSheet = JSON.parse(localStorage.getItem('personalBalanceSheet') || 'null') || {};
function mergeDefaults(def, obj){
  for(const k in def){
    if(obj[k]==null) obj[k] = JSON.parse(JSON.stringify(def[k]));
    else if(typeof def[k]==='object' && !Array.isArray(def[k])) mergeDefaults(def[k], obj[k]);
  }
}
mergeDefaults(defaultData, personalBalanceSheet);

function persist(){
  localStorage.setItem('personalBalanceSheet', JSON.stringify(personalBalanceSheet));
}

function ensurePath(root, path){
  if(!path) return root;
  const parts = path.split('.');
  let cur = root;
  for(const p of parts){
    if(p.endsWith('[]')){
      const key = p.slice(0,-2);
      if(!Array.isArray(cur[key])) cur[key] = [];
      cur = cur[key];
    }else{
      if(!cur[p]) cur[p] = {};
      cur = cur[p];
    }
  }
  return cur;
}

const wizardSteps = [
  { id:'welcome', title:'Welcome', tooltip:'Intro to the wizard', fields:[] },
  {
    id:'primaryHome', title:'Lifestyle – Primary Home', tooltip:'Your main residence',
    store:'lifestyle.primaryHome',
    fields:[
      {id:'ownsHome', label:'Do you own your primary home?', type:'select', options:['Yes','No']},
      {id:'homeValue', label:'Market value (€)', type:'number', showIf:d=>d.ownsHome==='Yes'},
      {id:'homeMortgage', label:'Outstanding mortgage (€)', type:'number', showIf:d=>d.ownsHome==='Yes'},
      {id:'rentRoom', label:'Renting a room?', type:'select', options:['No','Yes occasional','Yes regular'], showIf:d=>d.ownsHome==='Yes'}
    ]
  },
  {
    id:'holidayHome', title:'Lifestyle – Holiday Home', tooltip:'Additional properties',
    store:'lifestyle.holidayHomes[]', repeat:true,
    fields:[
      {id:'nick', label:'Nickname / location', type:'text'},
      {id:'value', label:'Market value (€)', type:'number'},
      {id:'mortgage', label:'Mortgage (€)', type:'number'},
      {id:'rented', label:'Is it rented?', type:'select', options:['No','Short-term','Long-term']}
    ]
  },
  {
    id:'cash', title:'Liquidity – Cash & Deposits', tooltip:'Instant access cash',
    store:'liquidity',
    fields:[{id:'cash', label:'Cash on deposit (€)', type:'number'}]
  },
  {
    id:'liquidityFunds', title:'Liquidity – Low-risk Funds', tooltip:'Money-market and bonds',
    store:'liquidity',
    fields:[
      {id:'mmf', label:'Money-market funds (€)', type:'number'},
      {id:'bonds', label:'100 % bond portfolios (€)', type:'number'},
      {id:'other', label:'Other instantly-available assets (€)', type:'number', optional:true}
    ]
  },
  {
    id:'pensions', title:'Longevity – Pensions', tooltip:'Personal and company pensions',
    store:'longevity.pensions[]', repeat:true,
    fields:[
      {id:'type', label:'Type', type:'select', options:['Employer DC','PRSA','DB','Other']},
      {id:'value', label:'Current value (€)', type:'number'},
      {id:'drawing', label:'Already drawing?', type:'select', options:['No','Yes']}
    ]
  },
  {
    id:'diversified', title:'Longevity – Diversified Accounts', tooltip:'Mixed portfolios',
    store:'longevity.diversified[]', repeat:true,
    fields:[
      {id:'nick', label:'Account nickname', type:'text'},
      {id:'style', label:'Style', type:'select', options:['Mixed stocks-bonds','100 % diversified equity fund']},
      {id:'value', label:'Current value (€)', type:'number'},
      {id:'platform', label:'Platform', type:'text', optional:true}
    ]
  },
  {
    id:'investmentProps', title:'Legacy – Investment Property', tooltip:'Rental properties',
    store:'legacy.investmentProps[]', repeat:true,
    fields:[
      {id:'nick', label:'Nickname', type:'text'},
      {id:'value', label:'Market value (€)', type:'number'},
      {id:'mortgage', label:'Mortgage (€)', type:'number'},
      {id:'rent', label:'Annual rent (€)', type:'number'}
    ]
  },
  {
    id:'privateStocks', title:'Legacy – Private & Single Stocks', tooltip:'Businesses and RSUs',
    store:'legacy',
    fields:[
      {id:'privateBiz', type:'repeat', store:'privateBiz[]', label:'Private Business',
        fields:[
          {id:'name', label:'Business name', type:'text'},
          {id:'stake', label:'Stake %', type:'number'},
          {id:'value', label:'Market value (€)', type:'number'}
        ]},
      {id:'singleStocks', type:'repeat', store:'singleStocks[]', label:'Public Single Stock / RSU',
        fields:[
          {id:'ticker', label:'Ticker', type:'text'},
          {id:'value', label:'Market value (€)', type:'number'}
        ]}
    ]
  },
  {
    id:'collectibles', title:'Legacy – Collectibles & Alternatives', tooltip:'Other assets',
    store:'legacy.collectibles[]', repeat:true,
    fields:[
      {id:'assetType', label:'Asset type', type:'select', options:['Art','Watches','Classic car','Other']},
      {id:'desc', label:'Description', type:'text'},
      {id:'value', label:'Value (€)', type:'number'}
    ]
  },
  {
    id:'otherLiabilities', title:'Liabilities – Other Borrowings', tooltip:'Outstanding debts',
    store:'liabilities[]', repeat:true,
    fields:[
      {id:'desc', label:'Description', type:'text'},
      {id:'amount', label:'Amount owed (€)', type:'number'}
    ]
  },
  { id:'review', title:'Review & Submit', tooltip:'Check totals before sending', fields:[] }
];

let currentStep = 0;
const totalSteps = wizardSteps.length;

function el(tag, attrs){
  const e=document.createElement(tag);
  if(attrs) Object.assign(e, attrs);
  return e;
}

function createInput(field,id,value){
  let inp;
  if(field.type==='select'){
    inp=el('select',{id});
    field.options.forEach(o=>inp.appendChild(el('option',{value:o,textContent:o})));
    inp.value=value||'';
  }else{
    inp=el('input',{id,type:field.type==='number'?'number':'text',value:value||''});
    if(field.type==='number') inp.classList.add('currency');
  }
  if(!field.optional) inp.required=true;
  return inp;
}

function renderRepeat(container, field, values){
  container.dataset.repeat = field.id;
  container.innerHTML='';
  values.forEach((val, idx)=>{
    const block=el('div',{className:'repeat-block'});
    field.fields.forEach(f=>{
      const inputId=`${field.id}-${idx}-${f.id}`;
      block.appendChild(el('label',{htmlFor:inputId,textContent:f.label}));
      const inp=createInput(f,inputId,val[f.id]);
      block.appendChild(inp);
    });
    container.appendChild(block);
  });
  const add=el('button',{type:'button',textContent:'Add another'});
  add.onclick=()=>{ values.push({}); renderStep(currentStep); };
  container.appendChild(add);
}

function renderStep(i){
  currentStep=i;
  const step=wizardSteps[i];
  prog.textContent=`Step ${i+1} of ${totalSteps}`;
  progFill.style.width=((i+1)/totalSteps*100)+"%";
  titleEl.innerHTML=`${step.title} <span title="${step.tooltip}" class="tip">?</span>`;
  dots.innerHTML=wizardSteps.map((_,idx)=>`<button class="wizDot${idx===i?' active':''}" data-idx="${idx}"></button>`).join('');
  dots.querySelectorAll('button').forEach(b=>b.onclick=()=>{saveStepValues();renderStep(+b.dataset.idx);});
  container.innerHTML='';
  if(step.id==='welcome'){
    const p=el('p',{textContent:'Welcome to the Personal Balance Sheet wizard.'});
    container.appendChild(p);
    btnBack.style.display='none';
    btnNext.textContent='Start';
    btnNext.disabled=false;
    return;
  }
  if(step.id==='review'){
    buildReview();
    btnBack.style.display='inline-block';
    btnNext.textContent='Submit';
    btnNext.disabled=false;
    return;
  }

  btnBack.style.display=i===0?'none':'inline-block';
  btnNext.textContent='Next';

  const data=ensurePath(personalBalanceSheet, step.store);

  if(step.repeat){
    renderRepeat(container, step, data);
  }else{
    step.fields.forEach(field=>{
      if(field.type==='repeat'){
        const arr=ensurePath(data, field.store);
        const wrap=el('div');
        renderRepeat(wrap, field, arr);
        container.appendChild(wrap);
      }else{
        if(field.showIf && !field.showIf(data)) return;
        const id=field.id;
        container.appendChild(el('label',{htmlFor:id,textContent:field.label}));
        const inp=createInput(field,id,data[id]);
        container.appendChild(inp);
      }
    });
  }

  btnNext.disabled=!validateStep();
  container.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{btnNext.disabled=!validateStep();}));
}

function validateStep(){
  return Array.from(container.querySelectorAll('input,select')).every(el=>{
    if(el.type==='number'){
      if(el.required && el.value==='') return false;
      if(el.value!=='' && +el.value<0) return false;
    }
    return el.checkValidity();
  });
}

function saveRepeatValues(arr, field){
  arr.length=0;
  const blocks=container.querySelectorAll(`[data-repeat='${field.id}'] .repeat-block`);
  blocks.forEach((block,idx)=>{
    const obj={};
    field.fields.forEach(f=>{
      const inp=block.querySelector(`#${field.id}-${idx}-${f.id}`);
      obj[f.id]=f.type==='number'? +(inp.value||0) : inp.value;
    });
    arr.push(obj);
  });
}

function saveStepValues(){
  const step=wizardSteps[currentStep];
  if(step.id==='welcome' || step.id==='review') return;
  const dest=ensurePath(personalBalanceSheet, step.store);

  if(step.repeat){
    saveRepeatValues(dest, step);
  }else{
    step.fields.forEach(field=>{
      if(field.type==='repeat'){
        const arr=ensurePath(dest, field.store);
        saveRepeatValues(arr, field);
      }else{
        if(field.showIf && !field.showIf(dest)) { delete dest[field.id]; return; }
        const inp=container.querySelector('#'+field.id);
        if(!inp) return;
        dest[field.id]=field.type==='number'? +(inp.value||0) : inp.value;
      }
    });
  }
  persist();
}

function sum(arr){
  return arr.reduce((a,b)=>a+(+b||0),0);
}

function buildReview(){
  const tbl=el('table');
  tbl.innerHTML='<tr><th>Category</th><th>Total Assets</th><th>Linked Liabilities</th><th>Net</th></tr>';
  const ls=personalBalanceSheet.lifestyle;
  const home=ls.primaryHome||{};
  const homeVal=home.ownsHome==='Yes'? +home.homeValue||0:0;
  const homeMort=home.ownsHome==='Yes'? +home.homeMortgage||0:0;
  const hhVal=sum((ls.holidayHomes||[]).map(h=>h.value));
  const hhMort=sum((ls.holidayHomes||[]).map(h=>h.mortgage));
  const lsAssets=homeVal+hhVal;
  const lsLiabs=homeMort+hhMort;

  const lq=personalBalanceSheet.liquidity;
  const lqAssets=sum([lq.cash,lq.mmf,lq.bonds,lq.other]);

  const lg=personalBalanceSheet.longevity;
  const lgAssets=sum((lg.pensions||[]).map(p=>p.value))+sum((lg.diversified||[]).map(d=>d.value));

  const le=personalBalanceSheet.legacy;
  const leAssets=sum((le.investmentProps||[]).map(p=>p.value))+sum((le.privateBiz||[]).map(b=>b.value))+sum((le.singleStocks||[]).map(s=>s.value))+sum((le.collectibles||[]).map(c=>c.value));
  const leLiabs=sum((le.investmentProps||[]).map(p=>p.mortgage));

  const rows=[
    ['Lifestyle',lsAssets,lsLiabs,lsAssets-lsLiabs],
    ['Liquidity',lqAssets,'–',lqAssets],
    ['Longevity',lgAssets,'–',lgAssets],
    ['Legacy',leAssets,leLiabs,leAssets-leLiabs]
  ];
  rows.forEach(r=>{
    const tr=el('tr');
    tr.innerHTML=`<td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td>`;
    tbl.appendChild(tr);
  });
  const otherLiab=sum((personalBalanceSheet.liabilities||[]).map(l=>l.amount));
  const totalAssets=lsAssets+lqAssets+lgAssets+leAssets;
  const totalLiabs=lsLiabs+leLiabs+otherLiab;
  const net=totalAssets-totalLiabs;
  const trNet=el('tr');
  trNet.innerHTML=`<th>Overall Net Worth</th><th></th><th></th><th>${net}</th>`;
  tbl.appendChild(trNet);
  container.appendChild(tbl);
}

btnNext.addEventListener('click',()=>{
  if(!validateStep()) return;
  saveStepValues();
  if(currentStep===totalSteps-1){ onSubmit(); return; }
  renderStep(currentStep+1);
});

btnBack.addEventListener('click',()=>{ if(currentStep>0){ saveStepValues(); renderStep(currentStep-1); } });

document.getElementById('launchBtn')?.addEventListener('click',()=>{ modal.classList.remove('hidden'); renderStep(0); });

function onSubmit(){
  console.log(personalBalanceSheet); // TODO: integrate back-end action
  modal.classList.add('hidden');
}
