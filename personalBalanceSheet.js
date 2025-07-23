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
      {id:'optionalNotice', type:'note', text:'The following details are optional.'},
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
      {id:'nick', label:'Nickname', type:'text'},
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
      {id:'optionalNotice', type:'note', text:'The following details are optional.'},
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

// Parse numeric inputs robustly by stripping commas or spaces
function parseNum(val){
  if(typeof val==='string') val=val.replace(/[,\s]/g,'');
  return +val || 0;
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
    const groups={};
    field.fields.forEach(f=>{
      if(f.showIf && !f.showIf(val)) return;
      if(f.type==='note'){
        const note=el('p',{className:'optional-info',textContent:f.text});
        block.appendChild(note);
        return;
      }
      const inputId=`${field.id}-${idx}-${f.id}`;
      const labelTxt=typeof f.label==='function'?f.label(val):f.label;
      let parent=block;
      if(f.group){
        if(!groups[f.group]){
          groups[f.group]=el('div',{className:'either-or'});
          block.appendChild(groups[f.group]);
        }
        parent=groups[f.group];
      }
      const wrap=f.group?el('div',{className:'either-field'}):el('div');
      wrap.appendChild(el('label',{htmlFor:inputId,textContent:labelTxt}));
      const inp=createInput(f,inputId,val[f.id]);
      wrap.appendChild(inp);
      if(f.help) wrap.appendChild(el('small',{textContent:f.help}));
      parent.appendChild(wrap);
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
  // Display the step title only; remove tooltip "?" icon
  titleEl.textContent = step.title;
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
      obj[f.id]=f.type==='number'? parseNum(inp.value) : inp.value;
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
        dest[field.id]=field.type==='number'? parseNum(inp.value) : inp.value;
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
const row  = (label, val) => (+val ? {label, val:+val} : null);

// Helper: sum an array of numbers
const sumVals = arr => arr.reduce((t, v) => t + (+v || 0), 0);

let assetsChart = null;

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

  const mortgages  =
    (+pick(data, ['lifestyle', 'primaryHome', 'homeMortgage']) || 0) +
    sumVals((data.lifestyle.holidayHomes || []).map(h => +h.mortgage || 0)) +
    sumVals((data.legacy.investmentProps || []).map(p => +p.mortgage || 0));

  const liabs      = mortgages +
    sumVals((data.liabilities || []).map(l => +l.amount || 0));

  return { lifestyle, liquidity, longevity, legacy, liabs };
}

function renderAssetsChart(t){
  const ctx = document.getElementById('assetsChart').getContext('2d');
  const labels = ['Lifestyle','Liquidity','Longevity','Legacy'];
  const values = [t.lifestyle,t.liquidity,t.longevity,t.legacy];
  const style = getComputedStyle(document.documentElement);
  const colours = ['--accent-1','--accent-2','--accent-3','--accent-4']
    .map(c => style.getPropertyValue(c).trim());

  const filtered = values.map((v,i)=>v>0?i:null).filter(i=>i!==null);
  const data = {
    labels: filtered.map(i=>labels[i]),
    datasets:[{
      data: filtered.map(i=>values[i]),
      backgroundColor: filtered.map(i=>colours[i]),
      borderWidth:0
    }]
  };

  const total = values.reduce((a,b)=>a+b,0);

  const centerText = {
    id:'centerText',
    afterDatasetsDraw(chart){
      const {ctx, chartArea:{width,height}} = chart;
      ctx.save();
      ctx.font = '600 1.2rem Inter';
      ctx.textAlign='center';
      ctx.fillStyle='#fff';
      ctx.fillText('Gross Assets', width/2, height/2 - 6);
      ctx.font='700 1.4rem Inter';
      ctx.fillText(`€${total.toLocaleString()}`, width/2, height/2 + 18);
      ctx.restore();
    }
  };

  const arcLabels = {
    id:'arcLabels',
    afterDatasetDraw(chart,args){
      const {ctx} = chart;
      const meta = chart.getDatasetMeta(args.index);
      meta.data.forEach((arc,i)=>{
        const value = chart.data.datasets[args.index].data[i];
        const pct = ((value/total)*100).toFixed(0)+'%';
        const pos = arc.tooltipPosition();
        ctx.save();
        ctx.fillStyle='#fff';
        ctx.font='600 0.75rem Inter';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(pct,pos.x,pos.y);
        ctx.restore();
      });
    }
  };

  const options = {
    cutout:'55%',
    responsive:true,
    maintainAspectRatio:false,
    animation:{animateRotate:true,duration:900,easing:'easeOutQuart'},
    plugins:{legend:{display:false}}
  };

  if(assetsChart){
    assetsChart.data=data;
    assetsChart.options=options;
    assetsChart.update();
  }else{
    assetsChart = new Chart(ctx,{type:'doughnut',data,options,plugins:[centerText,arcLabels]});
  }
}

// Build the four cards + totals and swap views
function renderBalanceSheet(data) {
  const sheet   = document.getElementById('balanceSheet');
  const grid    = sheet.querySelector('.bs-grid');
  const totals  = {
    net   : sheet.querySelector('#netAssets'),
    assets: sheet.querySelector('#totAssets'),
    liabs : sheet.querySelector('#totLiabs')
  };

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
    row('Primary home', pick(data,['lifestyle','primaryHome','homeValue'])),
    ... (data.lifestyle.holidayHomes||[])
         .map(h=>row(`${h.nick} holiday home`, h.value))
  ].filter(Boolean);

  // -------------------------------- liquidity rows
  const liquidityRows = [
    row('Cash',       pick(data,['liquidity','cash'])),
    row('Savings',    pick(data,['liquidity','cashSavings'])),
    row('M-market',   pick(data,['liquidity','mmf'])),
    row('Bond funds', pick(data,['liquidity','bonds'])),
    row('Other',      pick(data,['liquidity','other']))
  ].filter(Boolean);

  // -------------------------------- longevity rows
  const longevityRows = [
    ... (data.longevity.pensions||[])
         .map(p => row(`${(p.nick || p.type || 'Pension')} pension`, p.value)),
    ... (data.longevity.diversified||[])
         .map(d=>row(`${d.nick} investments`, d.value))
  ].filter(Boolean);

  // -------------------------------- legacy rows
  const legacyRows = [
    ... (data.legacy.investmentProps||[])
         .map(p=>row(`${p.nick} inv. property`, p.value)),
    ... (data.legacy.privateBiz||[])
         .map(b=>row(b.name || 'Private biz', b.value)),
    row('Stocks',        sumVals((data.legacy.singleStocks||[]).map(s=>+s.value||0))),
    row('Collectibles',  sumVals((data.legacy.collectibles||[]).map(c=>+c.value||0)))
  ].filter(Boolean);

  // -------------------------------- render everything
  grid.innerHTML = `
    ${card('lifestyle','Lifestyle',  lifestyleRows)}
    ${card('liquidity','Liquidity',  liquidityRows)}
    ${card('longevity','Longevity',  longevityRows)}
    ${card('legacy',   'Legacy',     legacyRows)}
  `;

  totals.net.textContent   = `Net assets ${format(netAssets)}`;
  totals.assets.textContent = format(totalAssets);
  totals.liabs.textContent  = format(t.liabs);

  renderAssetsChart(t);

  // -------------------------------- swap views
  document.getElementById('wizardModal').classList.add('hidden');
  sheet.classList.remove('hidden');
}

// ------------------------------- hook into final “Submit” --------------------
function onSubmit(){
  saveStepValues();      // capture final page values
  renderBalanceSheet(personalBalanceSheet);
}

// Allow editing details from the results view
document.getElementById('editDetails').addEventListener('click', () => {
  document.getElementById('balanceSheet').classList.add('hidden');
  modal.classList.remove('hidden');
  renderStep(0);
});

// Capture chart image for PDF
function captureChart() {
  if (!assetsChart) return null;
  const canvas = assetsChart.canvas;
  return {
    img: canvas.toDataURL('image/png', 1.0),
    w: canvas.clientWidth,
    h: canvas.clientHeight
  };
}

function fmtEuro(n) {
  return '€' + (+n).toLocaleString();
}

function generatePDF() {
  const totals = computeTotals(personalBalanceSheet);
  const totalAssets = totals.lifestyle + totals.liquidity + totals.longevity + totals.legacy;
  const netAssets = totalAssets - totals.liabs;

  const chart = captureChart();

  const BG_DARK = '#1a1a1a';
  const ACCENT_CYAN = '#0099ff';
  const COVER_GOLD = '#BBA26F';

  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const pageBG = () => { doc.setFillColor(BG_DARK); doc.rect(0,0,pageW,pageH,'F'); };
  const addFooter = n => {
    doc.setFontSize(9).setTextColor(120);
    const t = `Page ${n}`;
    doc.text(t, pageW - doc.getTextWidth(t) - 40, pageH - 30);
  };

  /* ----- COVER ----- */
  pageBG();
  doc.setFont('times','bold').setFontSize(48).setTextColor(COVER_GOLD)
     .text('Planéir', pageW/2, 90, {align:'center'});
  const logoW = 220, logoY = 130;
  doc.addImage('./favicon.png','PNG',(pageW-logoW)/2,logoY,logoW,0,'','FAST');
  const subY = logoY + logoW + 40;
  doc.setFontSize(32).setFont(undefined,'bold').setTextColor(COVER_GOLD);
  doc.text('Personal Balance Sheet', pageW/2, subY, {align:'center'});
  doc.setFont('times','normal');
  addFooter(1);
  doc.addPage();

  /* ----- HOW IT WORKS ----- */
  pageBG();
  const boxMargin = 30;
  const boxX = boxMargin;
  const boxW = pageW - boxMargin*2;
  const boxY = 80;
  const heading = 'How this tool works';
  const body =
    '•  We organise your assets into Lifestyle, Liquidity, Longevity and Legacy.' +
    '\n\n•  Lifestyle covers property for your own use.' +
    '\n\n•  Liquidity is cash or near-cash for emergencies—typically 3–6 months of expenses when working, or 1–2 years when retired.' +
    '\n\n•  Longevity represents long-term investments aimed at reaching your F*ck You Money target.' +
    '\n\n•  Legacy includes assets you plan to pass on. Reviewing this split helps judge if you are setting aside enough for Liquidity and Longevity.';

  doc.setFontSize(16).setFont(undefined,'bold');
  const headingH = 22;
  doc.setFontSize(14);
  const wrapped = doc.splitTextToSize(body, boxW - 48);
  const lineH = 18;
  const bodyH = wrapped.length * lineH;
  const boxH = 32 + headingH + 14 + bodyH + 24;

  doc.setFillColor('#222').setDrawColor(ACCENT_CYAN).setLineWidth(2)
     .roundedRect(boxX, boxY, boxW, boxH, 14,14,'FD');

  let cursorY = boxY + 32;
  doc.setFontSize(16).setFont(undefined,'bold').setTextColor(ACCENT_CYAN);
  doc.text(heading, boxX + 24, cursorY);
  cursorY += headingH + 14;
  doc.setFontSize(14).setFont(undefined,'normal').setTextColor('#fff');
  doc.text(wrapped, boxX + 24, cursorY, {lineHeightFactor:1.3});

  addFooter(2);
  doc.addPage();

  /* ----- RESULTS ----- */
  pageBG();
  let y = 60;
  doc.setFontSize(18).setFont(undefined,'bold').setTextColor(ACCENT_CYAN);
  doc.text('Results', 50, y);
  y += 22;

  const totRows = [
    ['Gross assets', fmtEuro(totalAssets)],
    ['Total liabilities', fmtEuro(totals.liabs)],
    ['Net assets', fmtEuro(netAssets)]
  ];

  doc.autoTable({
    startY: y,
    margin: {left:40,right:40},
    body: totRows,
    head: [['Metric','Value']],
    headStyles:{fillColor:ACCENT_CYAN,textColor:'#000'},
    bodyStyles:{fillColor:'#2a2a2a',textColor:'#fff'},
    alternateRowStyles:{fillColor:'#242424',textColor:'#fff'}
  });

  y = doc.lastAutoTable.finalY + 12;
  const catRows = [
    ['Lifestyle', fmtEuro(totals.lifestyle)],
    ['Liquidity', fmtEuro(totals.liquidity)],
    ['Longevity', fmtEuro(totals.longevity)],
    ['Legacy', fmtEuro(totals.legacy)]
  ];

  doc.autoTable({
    startY: y,
    margin: {left:40,right:40},
    head: [['Category','Value']],
    body: catRows,
    headStyles:{fillColor:ACCENT_CYAN,textColor:'#000'},
    bodyStyles:{fillColor:'#2a2a2a',textColor:'#fff'},
    alternateRowStyles:{fillColor:'#242424',textColor:'#fff'}
  });

  y = doc.lastAutoTable.finalY + 20;
  if (chart) {
    const ratio = chart.h / chart.w;
    const imgW = pageW - 80;
    doc.addImage(chart.img, 'PNG', 40, y, imgW, imgW * ratio, '', 'FAST');
    y += imgW * ratio + 12;
  }

  addFooter(3);

  doc.save('planéir_report.pdf');
  const pdfUrl = doc.output('bloburl');
  import('./consentModal.js').then(m=>m.showConsent(pdfUrl));
}

document.getElementById('downloadPdf').addEventListener('click', generatePDF);
// end of Personal Balance Sheet script
