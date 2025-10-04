// fullMontyPdf.js
// Requires jsPDF (global window.jspdf.jsPDF or dynamic import) and (optionally) jspdf-autotable

let jsPDFCtor = null;
try {
  const m = await import('jspdf');
  jsPDFCtor = m.jsPDF || m.default || window.jspdf?.jsPDF;
} catch(_) {
  jsPDFCtor = window.jspdf?.jsPDF;
}
if (!jsPDFCtor) throw new Error('jsPDF not found — ensure jspdf is loaded.');

const BG_DARK      = '#1a1a1a';
const ACCENT_GREEN = '#00ff88';
const ACCENT_CYAN  = '#0099ff';
const COVER_GOLD   = '#BBA26F';

function hexToRgb(hex){ const h = hex.replace('#',''); const n = parseInt(h,16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 }; }

function wrapText(doc, text, maxWidth){
  if (!text) return [];
  return doc.splitTextToSize(text, maxWidth);
}
function drawBg(doc){
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFillColor(BG_DARK);
  doc.rect(0,0,W,H,'F');
}
function centerText(doc, str, y, size=24, color='#FFFFFF', weight='bold'){
  const W = doc.internal.pageSize.getWidth();
  const {r,g,b} = hexToRgb(color);
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setTextColor(r,g,b);
  doc.text(str, W/2, y, {align:'center'});
}
function blockTitle(doc, text, x, y, color='#FFFFFF'){
  const {r,g,b} = hexToRgb(color);
  doc.setTextColor(r,g,b);
  doc.setFont('helvetica','bold');
  doc.setFontSize(14);
  doc.text(text, x, y);
}
function drawCard(doc, x, y, w, h, borderHex='#2a2a2a'){
  const {r,g,b} = hexToRgb(borderHex);
  doc.setDrawColor(r,g,b);
  doc.setFillColor(20,20,20);
  doc.roundedRect(x, y, w, h, 10, 10, 'FD');
}
function placeChartImage(doc, dataURL, x, y, w, h){
  if (!dataURL) return;
  try { doc.addImage(dataURL, 'PNG', x, y, w, h); } catch(_) {}
}
function euro(n){
  if (n === null || n === undefined || Number.isNaN(n)) return '€–';
  return '€' + Intl.NumberFormat('en-IE',{maximumFractionDigits:0}).format(Math.round(n));
}
async function nextFrame(){
  await new Promise(r => requestAnimationFrame(()=>r()));
  await new Promise(r => requestAnimationFrame(()=>r()));
}
function safeCanvasToDataURL(id){
  const el = document.getElementById(id);
  try { return el ? el.toDataURL('image/png', 1.0) : null; } catch { return null; }
}
async function imageToDataURL(url){
  return new Promise((resolve,reject)=>{
    const img = new Image(); img.crossOrigin='anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img,0,0);
      try { resolve(c.toDataURL('image/png')); } catch(e){ reject(e); }
    };
    img.onerror = reject; img.src = url;
  });
}
async function getFaviconDataURL(){
  const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  if (link?.href) { try { return await imageToDataURL(link.href); } catch(_) {} }
  return null;
}

// Rebuild charts if app exposes a hook; otherwise just wait a frame
async function rebuildCharts(){
  if (typeof window.fmRebuildCharts === 'function') {
    await window.fmRebuildCharts();
  } else {
    await nextFrame();
  }
}

// Export charts for a given mode without hiding the app
async function exportChartsForMode(mode /* 'current' | 'max' */){
  const prevUseMax = window.__USE_MAX__ || false;
  const targetUseMax = (mode === 'max');

  if (prevUseMax !== targetUseMax) {
    window.__USE_MAX__ = targetUseMax;
    document.documentElement.setAttribute('data-use-max', targetUseMax ? '1' : '0');
    await rebuildCharts();
    await nextFrame();
  }

  const imgs = {
    growth:   safeCanvasToDataURL('growthChart'),
    contrib:  safeCanvasToDataURL('contribChart'),
    balance:  safeCanvasToDataURL('ddBalanceChart'),
    cashflow: safeCanvasToDataURL('ddCashflowChart'),
  };

  // restore previous mode
  if (prevUseMax !== targetUseMax) {
    window.__USE_MAX__ = prevUseMax;
    document.documentElement.setAttribute('data-use-max', prevUseMax ? '1' : '0');
    await rebuildCharts();
    await nextFrame();
  }
  return imgs;
}

function extractPotAtRetAgeFromChart(){
  const ch = window.fmCharts?.growth;
  if (!ch) return null;
  const ds = ch.data?.datasets?.[0];
  const labels = ch.data?.labels || [];
  const lastIdx = labels.length ? labels.length - 1 : -1;
  if (lastIdx < 0) return null;
  const val = Array.isArray(ds?.data) ? ds.data[lastIdx] : null;
  return (typeof val === 'number') ? val : null;
}
function extractDepleteAgeFromBalanceChart(){
  const ch = window.fmCharts?.balance;
  if (!ch) return null;
  const ds = ch.data?.datasets?.[0];
  const labels = ch.data?.labels || [];
  if (!Array.isArray(ds?.data)) return null;
  for (let i=0;i<ds.data.length;i++){
    if (typeof ds.data[i] === 'number' && ds.data[i] <= 0) {
      return labels?.[i] ?? null;
    }
  }
  return null;
}
function extractYear1IncomeCoverage(){
  const ch = window.fmCharts?.cashflow;
  if (!ch) return null;
  const dsIncome = ch.data?.datasets?.find(d=>/income/i.test(d.label)) || ch.data?.datasets?.[0];
  const dsNeed   = ch.data?.datasets?.find(d=>/need|requirement/i.test(d.label));
  const inc = Array.isArray(dsIncome?.data) ? dsIncome.data[0] : null;
  const ned = Array.isArray(dsNeed?.data)   ? dsNeed.data[0]   : null;
  if (typeof inc === 'number' && typeof ned === 'number' && ned > 0){
    return Math.round((inc / ned) * 100);
  }
  return null;
}

export async function buildFullMontyPDF(run){
  try {
    await _buildFullMontyPDF(run);
  } catch (err) {
    console.error('[PDF] Failed to generate:', err);
    throw err; // caller shows alert
  }
}

async function _buildFullMontyPDF(run){
  const doc = new jsPDFCtor({ unit:'pt', format:'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56, colGap = 22;
  const colW = (W - 2*M - colGap) / 2;

  // Collect favicon (ok if null)
  const faviconDataURL = await getFaviconDataURL();

  // Export charts without hiding DOM (prevents h1-check.js crash)
  const currentImgs = await exportChartsForMode('current');
  const maxImgs     = await exportChartsForMode('max');

  // Pull state safely
  const retAge = run?.desiredRetAge ?? run?.retirementAge ?? 65;
  const ffn    = (typeof run?.ffnCombined === 'number') ? run.ffnCombined
               : (typeof run?.ffn === 'number') ? run.ffn : null;

  const potAtRetCurrent = (typeof run?.potAtRetCurrent === 'number') ? run.potAtRetCurrent
                           : extractPotAtRetAgeFromChart();
  const potAtRetMax     = (typeof run?.potAtRetMax === 'number') ? run.potAtRetMax : null;

  const depleteAgeCurrent = extractDepleteAgeFromBalanceChart();
  const coveragePctYear1  = extractYear1IncomeCoverage();

  // ---------- Page 1: Cover (no footer) ----------
  drawBg(doc);
  centerText(doc, 'Planéir', M + 40, 32, '#FFFFFF', 'bold');
  if (faviconDataURL){
    const iconSize = Math.min(W * 0.38, 260);
    doc.addImage(faviconDataURL, 'PNG', (W-iconSize)/2, (H-iconSize)/2 - 30, iconSize, iconSize);
  }
  centerText(doc, 'Full-Monty Report', (H/2) + 160, 22, COVER_GOLD, 'bold');

  // ---------- Page 2: Compare (Before Retirement) ----------
  doc.addPage(); drawBg(doc);
  centerText(doc, 'Financial Freedom Number', M + 10, 12, COVER_GOLD, 'bold');
  centerText(doc, (ffn ? euro(ffn) : '—'), M + 34, 26, '#FFFFFF', 'bold');

  const cardTop = 90, cardH = 330;

  // Left card — Current
  drawCard(doc, M, cardTop, colW, cardH);
  blockTitle(doc, 'Current contributions — Pot @ ' + retAge, M + 16, cardTop + 26, '#FFFFFF');
  if (potAtRetCurrent != null){
    doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(255,255,255);
    doc.text(euro(potAtRetCurrent), M + 16, cardTop + 56);
    if (ffn){
      const gap = Math.round(potAtRetCurrent - ffn);
      const {r,g,b} = hexToRgb(gap >= 0 ? ACCENT_GREEN : '#ff5b5b');
      doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(r,g,b);
      doc.text((gap>=0?'Surplus ':'Gap ') + euro(Math.abs(gap)), M + 16, cardTop + 76);
    }
  }
  placeChartImage(doc, currentImgs.growth, M + 16, cardTop + 92, colW - 32, 160);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, `If you keep contributing as you are, your pot at age ${retAge} reaches ${euro(potAtRetCurrent)}.`, colW - 32), M + 16, cardTop + 270);

  // Right card — Max
  drawCard(doc, M + colW + colGap, cardTop, colW, cardH);
  blockTitle(doc, 'Max contributions — Pot @ ' + retAge, M + colW + colGap + 16, cardTop + 26, '#FFFFFF');
  if (potAtRetMax != null){
    doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(255,255,255);
    doc.text(euro(potAtRetMax), M + colW + colGap + 16, cardTop + 56);
    if (ffn){
      const gap = Math.round(potAtRetMax - ffn);
      const {r,g,b} = hexToRgb(gap >= 0 ? ACCENT_GREEN : '#ff5b5b');
      doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(r,g,b);
      doc.text((gap>=0?'Surplus ':'Gap ') + euro(Math.abs(gap)), M + colW + colGap + 16, cardTop + 76);
    }
  }
  placeChartImage(doc, maxImgs.growth, M + colW + colGap + 16, cardTop + 92, colW - 32, 160);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(210);
  doc.text(wrapText(doc, 'Max contributions are the age-related Revenue limits applied to your pensionable salary (capped at €115,000). See Page 6 for the full reference table.', W - 2*M), M, cardTop + cardH + 36);

  // ---------- Page 3: Before Retirement — Story (Current) ----------
  doc.addPage(); drawBg(doc);
  blockTitle(doc, 'Before retirement — Building your pension', M, M, '#FFFFFF');

  blockTitle(doc, 'Will my pension reach my Financial Freedom Target?', M, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.growth, M, M + 46, colW, 220);
  let yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text(wrapText(doc, (ffn && potAtRetCurrent!=null) ? `At age ${retAge}, projected pot is ${euro(potAtRetCurrent)} vs FFN ${euro(ffn)}.` : `Projected pot vs FFN at your target age.`, colW), M, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'This line shows how your pension could grow over time if you keep contributing as you are. The purple dotted line is your Financial Freedom Target — the amount needed to support your estimated income requirement in retirement all the way to age 100. The red line is the government’s pension cap (Standard Fund Threshold). If your curve rises above the purple line, you’re on track for financial freedom. If it rises above the red line, you may face extra tax rules.', colW), M, yTxt + 18);

  const rightX = M + colW + colGap;
  blockTitle(doc, 'How much comes from me vs. my money working for me?', rightX, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.contrib, rightX, M + 46, colW, 220);
  yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text(wrapText(doc, 'Over time, compounding (growth) becomes the main driver of increases.', colW), rightX, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'The green bars are the contributions you make each year. The orange bars show how your money grows once invested. This highlights the power of compounding — your money earning money — which becomes a major driver of your pension’s long-term growth.', colW), rightX, yTxt + 18);

  // ---------- Page 4: Compare (During Retirement) ----------
  doc.addPage(); drawBg(doc);
  centerText(doc, 'Financial Freedom Number', M + 10, 12, COVER_GOLD, 'bold');
  centerText(doc, (ffn ? euro(ffn) : '—'), M + 34, 26, '#FFFFFF', 'bold');

  drawCard(doc, M, 90, colW, 330);
  blockTitle(doc, 'Current contributions — Drawdown', M + 16, 116, '#FFFFFF');
  const depTxt = (depleteAgeCurrent ? `Depletes at age ${depleteAgeCurrent}` : 'Sustains to age 100');
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(255,255,255);
  doc.text(depTxt, M + 16, 142);
  placeChartImage(doc, currentImgs.balance, M + 16, 154, colW - 32, 188);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'Projected pension balance throughout retirement while funding your target gross income.', colW - 32), M + 16, 360);

  drawCard(doc, M + colW + colGap, 90, colW, 330);
  blockTitle(doc, 'Max contributions — Drawdown', M + colW + colGap + 16, 116, '#FFFFFF');
  placeChartImage(doc, maxImgs.balance, M + colW + colGap + 16, 154, colW - 32, 188);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'With max contributions, projected balance under the same post-retirement assumptions.', colW - 32), M + colW + colGap + 16, 360);

  // ---------- Page 5: During Retirement — Story (Current) ----------
  doc.addPage(); drawBg(doc);
  blockTitle(doc, 'During retirement — Staying funded to age 100', M, M, '#FFFFFF');

  blockTitle(doc, 'Will my pension last to age 100?', M, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.balance, M, M + 46, colW, 220);
  yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text(wrapText(doc, depleteAgeCurrent ? `Under these assumptions, projected depletion at age ${depleteAgeCurrent}.` : `Withdrawals are sustained to age 100 under these assumptions.`, colW), M, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'This chart shows your projected pension balance throughout retirement. The purple dotted line starts at your Financial Freedom Target and shows how that target would gradually deplete over time. The green curve shows your pension at retirement if you keep contributing as you are, and how long it might last.', colW), M, yTxt + 18);

  blockTitle(doc, 'Will my income cover my lifestyle in retirement?', rightX, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.cashflow, rightX, M + 46, colW, 220);
  yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  const y1 = run?.year1GrossIncome ?? null;
  const cov = coveragePctYear1 ?? null;
  const icStory = (typeof y1 === 'number' && typeof cov === 'number')
    ? `At retirement, projected gross income is ${euro(y1)}; initial coverage is ${cov}%.`
    : `Projected gross income vs your inflation-linked requirement.`;
  doc.text(wrapText(doc, icStory, colW), rightX, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'This chart shows income you could draw each year, with any other retirement income sources. The line above represents your estimated income requirement in retirement (rises with inflation). The aim is for combined income sources to meet or exceed this requirement each year.', colW), rightX, yTxt + 18);

  // ---------- Save ----------
  doc.save('Planeir_Full-Monty_Report.pdf');
}

