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
    id:'primaryHome', title:'Let’s start with your main home', tooltip:'Your main residence',
    store:'lifestyle.primaryHome',
    fields:[
      {id:'ownsHome', label:'Do you own your primary home?', type:'select', options:['Yes','No']},
      {id:'homeValue', label:'Market value (€)', type:'number', showIf:d=>d.ownsHome==='Yes'},
      {id:'homeMortgage', label:'Outstanding mortgage (€)', type:'number', optional:true, showIf:d=>d.ownsHome==='Yes'},
      {id:'rentRoom', label:'Renting a room?', type:'select', options:['No','Yes occasional','Yes regular'], showIf:d=>d.ownsHome==='Yes'},
      {id:'optionalNotice', type:'note', text:'The following details are optional.', showIf:d=>d.ownsHome==='Yes'},
      {id:'rentalIncome', label:'Annual rental income (€ gross)', type:'number', optional:true, showIf:d=>d.ownsHome==='Yes' && d.rentRoom && d.rentRoom!=='No'},
      {id:'repayment', label:'Annual mortgage repayment (€)', type:'number', optional:true, group:'repayRate', showIf:d=>d.ownsHome==='Yes', help:'Enter either this or the interest rate'},
      {id:'interestRate', label:'Interest rate (%)', type:'number', optional:true, group:'repayRate', showIf:d=>d.ownsHome==='Yes', help:'Enter either this or the annual repayment'},
      {id:'yearsLeft', label:'Years remaining on mortgage', type:'number', optional:true, group:'yearsEnd', showIf:d=>d.ownsHome==='Yes', help:'Provide either this or the end year'},
      {id:'endYear', label:'Year mortgage ends', type:'number', optional:true, group:'yearsEnd', showIf:d=>d.ownsHome==='Yes', help:'Provide either this or years remaining'}
    ]
  },
  {
    id:'holidayHome', title:'Lifestyle – Holiday Home', tooltip:'Additional properties',
    store:'lifestyle.holidayHomes[]', repeat:true, addLabel:'Add holiday home',
    fields:[
      {id:'nick', label:'Nickname / location', type:'text'},
      {id:'value', label:'Market value (€)', type:'number'},
      {id:'mortgage', label:'Mortgage (€)', type:'number', optional:true},
      {id:'rented', label:'Is it rented?', type:'select', options:['No','Yes']},
      {id:'rentalIncome', label:'Annual rental income (€ gross)', type:'number', optional:true, showIf:d=>d.rented==='Yes'},
      {id:'repayment', label:'Annual mortgage repayment (€)', type:'number', optional:true, group:'repayRate', help:'Enter either this or the interest rate'},
      {id:'interestRate', label:'Interest rate (%)', type:'number', optional:true, group:'repayRate', help:'Enter either this or the annual repayment'},
      {id:'yearsLeft', label:'Years remaining on mortgage', type:'number', optional:true, group:'yearsEnd', help:'Provide either this or the end year'},
      {id:'endYear', label:'Year mortgage ends', type:'number', optional:true, group:'yearsEnd', help:'Provide either this or years remaining'}
    ]
  },
  {
    id:'cash', title:'How much cash do you keep in everyday accounts?', tooltip:'Instant access cash',
    store:'liquidity',
    fields:[
      {id:'cash', label:'Cash in current account (€)', type:'number', optional:true},
      {id:'cashSavings', label:'Cash savings (€)', type:'number', optional:true}
    ]
  },
  {
    id:'liquidityFunds', title:'Do you have any low-risk funds like money-markets or bond portfolios?', tooltip:'Money-market and bonds',
    store:'liquidity',
    fields:[
      {id:'mmf', label:'Money-market funds (€)', type:'number'},
      {id:'bonds', label:'100 % bond portfolios (€)', type:'number'},
      {id:'other', label:'Other instantly-available assets (€)', type:'number', optional:true}
    ]
  },
  {
    id:'pensions', title:'Do you have existing pensions?', tooltip:'Personal and company pensions',
    store:'longevity.pensions[]', repeat:true, addLabel:'Add pension',
    fields:[
      {id:'type', label:'Pension type', type:'select', options:['Occupational Pension','Personal Retirement Bond (PRB)','Personal Retirement Savings Account (PRSA)','Defined Benefit (DB)','Approved Retirement Fund (ARF)']},
      {id:'value', label:d=>d.type==='Defined Benefit (DB)'?'Expected annual pension income (€)':'Current value (€)', type:'number', showIf:d=>!!d.type},
      {id:'retAge', label:'Scheme retirement age', type:'number', optional:true, showIf:d=>d.type==='Defined Benefit (DB)'}
    ]
  },
  {
    id:'diversified', title:'Do you hold any diversified investment accounts?', tooltip:'Diversified means funds or portfolios spread across many stocks and/or bonds, not a single share.',
    store:'longevity.diversified[]', repeat:true, addLabel:'Add account',
    fields:[
      {id:'nick', label:'Account nickname', type:'text'},
      {id:'style', label:'Style', type:'select', options:['Mostly stocks, some bonds','50/50 stocks & bonds','Mostly bonds, some stocks','100 % diversified equities']},
      {id:'value', label:'Current value (€)', type:'number'},
      {id:'platform', label:'Platform', type:'text', optional:true}
    ]
  },
  {
    id:'investmentProps', title:'Do you own rental or investment property?', tooltip:'Rental properties',
    store:'legacy.investmentProps[]', repeat:true, addLabel:'Add investment property',
    fields:[
      {id:'nick', label:'Nickname', type:'text'},
      {id:'value', label:'Market value (€)', type:'number'},
      {id:'mortgage', label:'Mortgage (€)', type:'number', optional:true},
      {id:'rented', label:'Is it rented?', type:'select', options:['No','Yes']},
      {id:'rentalIncome', label:'Annual rental income (€ gross)', type:'number', optional:true, showIf:d=>d.rented==='Yes'},
      {id:'repayment', label:'Annual mortgage repayment (€)', type:'number', optional:true, group:'repayRate', help:'Enter either this or the interest rate'},
      {id:'interestRate', label:'Interest rate (%)', type:'number', optional:true, group:'repayRate', help:'Enter either this or the annual repayment'},
      {id:'yearsLeft', label:'Years remaining on mortgage', type:'number', optional:true, group:'yearsEnd', help:'Provide either this or the end year'},
      {id:'endYear', label:'Year mortgage ends', type:'number', optional:true, group:'yearsEnd', help:'Provide either this or years remaining'}
    ]
  },
  {
    id:'privateStocks', title:'Private businesses and direct stock holdings', tooltip:'Businesses and RSUs',
    store:'legacy',
    fields:[
      {id:'privateBiz', type:'repeat', store:'privateBiz[]', label:'family business or private partnership', addLabel:'Add family business or private partnership',
        fields:[
          {id:'name', label:'Business/Partnership name', type:'text'},
          {id:'stake', label:'Your % stake', type:'number'},
          {id:'value', label:'Market value of your stake (€)', type:'number'}
        ]},
      {id:'singleStocks', type:'repeat', store:'singleStocks[]', label:'direct stock', addLabel:'Add direct stocks',
        fields:[
          {id:'ticker', label:'Stock name', type:'text'},
          {id:'value', label:'Current market value (€)', type:'number'}
        ]}
    ]
  },
  {
    id:'collectibles', title:'Any valuable collectibles or alternative assets?', tooltip:'Other assets',
    store:'legacy.collectibles[]', repeat:true, addLabel:'Add collectible',
    fields:[
      {id:'assetType', label:'Asset type', type:'select', options:['Art','Watches','Classic car','Other']},
      {id:'desc', label:'Description', type:'text'},
      {id:'value', label:'Value (€)', type:'number'}
    ]
  },
  {
    id:'otherLiabilities', title:'Any other loans or debts?', tooltip:'Outstanding debts',
    store:'liabilities[]', repeat:true, addLabel:'Add liability',
    fields:[
      {id:'desc', label:'Description', type:'text'},
      {id:'amount', label:'Amount owed (€)', type:'number'},
      {id:'repayment', label:'Annual repayment (€)', type:'number', optional:true, group:'repayRate', help:'Enter either this or the interest rate'},
      {id:'interestRate', label:'Interest rate (%)', type:'number', optional:true, group:'repayRate', help:'Enter either this or the annual repayment'},
      {id:'yearsLeft', label:'Years remaining', type:'number', optional:true, group:'yearsEnd', help:'Provide either this or the end year'},
      {id:'endYear', label:'Year loan ends', type:'number', optional:true, group:'yearsEnd', help:'Provide either this or years remaining'}
    ]
  }
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
  if(!field.optional && field.type!=='number') inp.required=true;
  return inp;
}

function renderRepeat(container, field, values){
  container.dataset.repeat = field.id;
  container.innerHTML='';
  values.forEach((val, idx)=>{
    const block=el('div',{className:'repeat-block'});
    const remove=el('span',{className:'remove-link',textContent:'Remove'});
    remove.onclick=()=>{ values.splice(idx,1); renderStep(currentStep); };
    block.appendChild(remove);
    field.fields.forEach(f=>{
      if(f.showIf && !f.showIf(val)) return;
      const inputId=`${field.id}-${idx}-${f.id}`;
      const labelTxt=typeof f.label==='function'?f.label(val):f.label;
      block.appendChild(el('label',{htmlFor:inputId,textContent:labelTxt}));
      const inp=createInput(f,inputId,val[f.id]);
      block.appendChild(inp);
    });
    container.appendChild(block);
  });
  const label=field.addLabel||('Add another');
  const add=el('button',{type:'button',textContent:label});
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

  btnBack.style.display=i===0?'none':'inline-block';
  btnNext.textContent='Next';

  const data=ensurePath(personalBalanceSheet, step.store);

  if(step.repeat){
    renderRepeat(container, step, data);
  }else{
    const groups={};
    step.fields.forEach(field=>{
      if(field.type==='repeat'){
        const arr=ensurePath(data, field.store);
        const wrap=el('div');
        renderRepeat(wrap, field, arr);
        container.appendChild(wrap);
      }else if(field.type==='note'){
        if(field.showIf && !field.showIf(data)) return;
        const note=el('p',{className:'optional-info',textContent:field.text});
        container.appendChild(note);
      }else{
        if(field.showIf && !field.showIf(data)) return;
        const id=field.id;
        const labelTxt=typeof field.label==='function'?field.label(data):field.label;
        let parent=container;
        if(field.group){
          if(!groups[field.group]){
            groups[field.group]=el('div',{className:'either-or'});
            container.appendChild(groups[field.group]);
          }
          parent=groups[field.group];
        }
        const wrap=field.group?el('div',{className:'either-field'}):el('div');
        wrap.appendChild(el('label',{htmlFor:id,textContent:labelTxt}));
        const inp=createInput(field,id,data[id]);
        wrap.appendChild(inp);
        if(field.help) wrap.appendChild(el('small',{textContent:field.help}));
        parent.appendChild(wrap);
      }
    });
  }

  btnNext.disabled=!validateStep();
  container.querySelectorAll('input,select').forEach(el=>{
    el.addEventListener('input',()=>{btnNext.disabled=!validateStep();});
    el.addEventListener('change',()=>{saveStepValues(); renderStep(currentStep);});
  });
}

function clearErrors(){
  container.querySelectorAll('.error').forEach(e=>e.remove());
}

function validateStep(show){
  clearErrors();
  for(const el of container.querySelectorAll('input,select')){
    if(el.type==='number'){
      if(el.required && el.value===''){ if(show){displayError(el);} return false; }
      if(el.value!=='' && +el.value<0){ if(show){displayError(el);} return false; }
    }
    if(!el.checkValidity()){ if(show){displayError(el);} return false; }
  }
  return true;
}

function displayError(el){
  const p=el.parentNode;
  const msg=el.closest('.error')?null:document.createElement('p');
  if(msg){ msg.className='error'; msg.textContent='Please complete or correct the highlighted field.'; el.after(msg); }
  el.focus();
}

function saveRepeatValues(arr, field){
  arr.length=0;
  const blocks=container.querySelectorAll(`[data-repeat='${field.id}'] .repeat-block`);
  blocks.forEach((block,idx)=>{
    const obj={};
    field.fields.forEach(f=>{
      const inp=block.querySelector(`#${field.id}-${idx}-${f.id}`);
      if(!inp) return;
      obj[f.id]=f.type==='number'? +(inp.value||0) : inp.value;
    });
    arr.push(obj);
  });
}

function saveStepValues(){
  const step=wizardSteps[currentStep];
  if(step.id==='welcome') return;
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


btnNext.addEventListener('click',()=>{
  if(!validateStep(true)) return;
  saveStepValues();
  if(currentStep===totalSteps-1){ onSubmit(); return; }
  renderStep(currentStep+1);
});

btnBack.addEventListener('click',()=>{ if(currentStep>0){ saveStepValues(); renderStep(currentStep-1); } });

modal.classList.remove('hidden');
renderStep(0);

/* --------------------------------------------------------------------------- */
/*                            NEW BALANCE-SHEET CODE                           */
/* --------------------------------------------------------------------------- */

// Helper: safely reach deep values
const pick = (obj, path) => path.reduce((o, k) =>
  (o && o[k] !== undefined ? o[k] : 0), obj);

// Helper: sum an array of numbers
const sumVals = arr => arr.reduce((t, v) => t + (+v || 0), 0);

// Compute subtotal per asset category + liabilities
function computeTotals(data) {
  const lifestyle =
    (+pick(data, ['lifestyle', 'primaryHome', 'homeValue']) || 0) +
    sumVals((data.lifestyle.holidayHomes || []).map(h => +h.value || 0));

  const liquidity = ['cash', 'cashSavings', 'mmf', 'bonds', 'other']
    .map(k => +pick(data, ['liquidity', k]) || 0)
    .reduce((a, b) => a + b, 0);

  const pensions   = sumVals((data.longevity.pensions || []).map(p => +p.value || 0));
  const diversified= sumVals((data.longevity.diversified || []).map(d => +d.value || 0));
  const longevity  = pensions + diversified;

  const invProps   = sumVals((data.legacy.investmentProps || []).map(p => +p.value || 0));
  const privBiz    = sumVals((data.legacy.privateBiz || []).map(b => +b.value || 0));
  const stocks     = sumVals((data.legacy.singleStocks || []).map(s => +s.value || 0));
  const collect    = sumVals((data.legacy.collectibles || []).map(c => +c.value || 0));
  const legacy     = invProps + privBiz + stocks + collect;

  const liabs      = sumVals((data.liabilities || []).map(l => +l.amount || 0));

  return { lifestyle, liquidity, longevity, legacy, liabs };
}

// Build the four cards + totals and swap views
function renderBalanceSheet(data) {
  const sheet   = document.getElementById('balanceSheet');
  const grid    = sheet.querySelector('.bs-grid');
  const totals  = { assets: sheet.querySelector('#totAssets'),
                    liabs : sheet.querySelector('#totLiabs'),
                    net   : sheet.querySelector('#totNetAssets') };

  // -------------------------------- subtotals
  const t           = computeTotals(data);
  const totalAssets = t.lifestyle + t.liquidity + t.longevity + t.legacy;
  const netAssets   = totalAssets - t.liabs;

  // -------------------------------- helpers to build HTML blocks
  const format = n => `€${(+n).toLocaleString()}`;

  const card = (cls, title, rows) => `
    <div class="bs-card card-${cls}">
      <h3>${title}</h3>
      <ul>
        ${rows.map(r => `<li><span>${r.label}</span><span>${format(r.val)}</span></li>`).join('')}
        <li class="subtotal"><span>Sub-total</span><span>${format(t[cls])}</span></li>
      </ul>
    </div>`;

  // -------------------------------- lifestyle rows
  const lifestyleRows = [
    { label:'Primary home', val: pick(data,['lifestyle','primaryHome','homeValue']) },
    ... (data.lifestyle.holidayHomes||[]).map((h,i)=>({ label:`Holiday home ${i+1}`, val:h.value }))
  ];

  // -------------------------------- liquidity rows
  const liquidityRows = [
    {label:'Cash',        val: pick(data,['liquidity','cash'])},
    {label:'Savings',     val: pick(data,['liquidity','cashSavings'])},
    {label:'M-market',    val: pick(data,['liquidity','mmf'])},
    {label:'Bond funds',  val: pick(data,['liquidity','bonds'])},
    {label:'Other',       val: pick(data,['liquidity','other'])}
  ];

  // -------------------------------- longevity rows
  const longevityRows = [
    {label:'Pensions',     val: sumVals((data.longevity.pensions||[]).map(p=>+p.value||0))},
    {label:'Diversified',  val: sumVals((data.longevity.diversified||[]).map(d=>+d.value||0))}
  ];

  // -------------------------------- legacy rows
  const legacyRows = [
    {label:'Inv. property',val: sumVals((data.legacy.investmentProps||[]).map(p=>+p.value||0))},
    {label:'Private biz',  val: sumVals((data.legacy.privateBiz||[]).map(b=>+b.value||0))},
    {label:'Stocks',       val: sumVals((data.legacy.singleStocks||[]).map(s=>+s.value||0))},
    {label:'Collectibles', val: sumVals((data.legacy.collectibles||[]).map(c=>+c.value||0))}
  ];

  // -------------------------------- render everything
  grid.innerHTML = `
    ${card('lifestyle','Lifestyle',  lifestyleRows)}
    ${card('liquidity','Liquidity',  liquidityRows)}
    ${card('longevity','Longevity',  longevityRows)}
    ${card('legacy',   'Legacy',     legacyRows)}
  `;

  totals.assets.textContent = format(totalAssets);
  totals.liabs .textContent = format(t.liabs);
  totals.net   .textContent = format(netAssets);

  // -------------------------------- swap views
  document.getElementById('wizardModal').classList.add('hidden');
  sheet.classList.remove('hidden');
}

// ------------------------------- hook into final “Submit” --------------------
function onSubmit(){
  saveStepValues();      // capture final page values
  renderBalanceSheet(personalBalanceSheet);
}
// end of Personal Balance Sheet script
