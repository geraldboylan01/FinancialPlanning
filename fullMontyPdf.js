// fullMontyPdf.js
// Requires jsPDF (global window.jspdf.jsPDF or import) and (optionally) jspdf-autotable

// ---- Imports (support both global and module environments) ----
let jsPDFCtor = null;
try {
  // if bundled
  const m = await import('jspdf');
  jsPDFCtor = m.jsPDF || m.default || window.jspdf?.jsPDF;
} catch(_) {
  jsPDFCtor = window.jspdf?.jsPDF;
}
if (!jsPDFCtor) throw new Error('jsPDF not found — ensure jspdf is loaded.');

// ---- Brand colours (locked) ----
const BG_DARK      = '#1a1a1a';
const ACCENT_GREEN = '#00ff88';
const ACCENT_CYAN  = '#0099ff';
const COVER_GOLD   = '#BBA26F';

// ---- Utilities ----
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
function euro(n){
  if (n === null || n === undefined || Number.isNaN(n)) return '€–';
  return '€' + Intl.NumberFormat('en-IE', {maximumFractionDigits:0}).format(Math.round(n));
}
function pct(n){
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Intl.NumberFormat('en-IE', {maximumFractionDigits:0}).format(Math.round(n)) + '%';
}
function centerText(doc, str, y, size=24, color='#FFFFFF', weight='bold'){
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  const col = hexToRgb(color);
  doc.setTextColor(col.r, col.g, col.b);
  doc.text(str, W/2, y, {align:'center'});
}
function hexToRgb(hex){
  const h = hex.replace('#','');
  const bigint = parseInt(h, 16);
  return { r:(bigint>>16)&255, g:(bigint>>8)&255, b:bigint&255 };
}
async function imageToDataURL(url){
  // try to capture favicon or other images as dataURL
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try { resolve(c.toDataURL('image/png')); } catch(e){ reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}
async function getFaviconDataURL(){
  const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  if (link?.href) {
    try { return await imageToDataURL(link.href); } catch(_) {}
  }
  return null; // handle missing gracefully
}
function blockTitle(doc, text, x, y, color='#FFFFFF'){
  const {r,g,b} = hexToRgb(color);
  doc.setTextColor(r,g,b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(text, x, y);
}

// Draw a simple "card" background
function drawCard(doc, x, y, w, h, borderHex='#2a2a2a'){
  const {r,g,b} = hexToRgb(borderHex);
  doc.setDrawColor(r,g,b);
  doc.setFillColor(20,20,20);
  doc.roundedRect(x, y, w, h, 10, 10, 'FD');
}

// Mini chart frame (image inside card)
function placeChartImage(doc, dataURL, x, y, w, h){
  if (!dataURL) return;
  doc.addImage(dataURL, 'PNG', x, y, w, h);
}

// Wait two animation frames (allow charts to render)
async function nextFrame(){
  await new Promise(r => requestAnimationFrame(()=>r()));
  await new Promise(r => requestAnimationFrame(()=>r()));
}

// Toggle app between current and max, rebuild charts, capture PNGs, then restore.
async function exportChartsForMode(mode /* 'current' | 'max' */){
  const prevUseMax = window.__USE_MAX__ || false;
  const targetUseMax = (mode === 'max');

  // Try to integrate with your existing flag (common name in your code: useMax)
  window.__USE_MAX__ = targetUseMax;
  document.documentElement.setAttribute('data-use-max', targetUseMax ? '1' : '0');

  // If your code uses a module-level `useMax`, ensure it follows window.__USE_MAX__.
  // Minimal hook: your chart builders should read (window.__USE_MAX__ === true) to render max datasets.

  // Rebuild charts
  if (typeof window.fmRebuildCharts === 'function') {
    await window.fmRebuildCharts();
  } else {
    // fallback: small delay
    await nextFrame();
  }

  // Wait for canvases to update, then grab images
  await nextFrame();
  const imgs = {
    growth:   document.getElementById('growthChart')?.toDataURL('image/png', 1.0) || null,
    contrib:  document.getElementById('contribChart')?.toDataURL('image/png', 1.0) || null,
    balance:  document.getElementById('ddBalanceChart')?.toDataURL('image/png', 1.0) || null,
    cashflow: document.getElementById('ddCashflowChart')?.toDataURL('image/png', 1.0) || null,
  };

  // restore previous mode if changed
  if (prevUseMax !== targetUseMax){
    window.__USE_MAX__ = prevUseMax;
    document.documentElement.setAttribute('data-use-max', prevUseMax ? '1':'0');
    if (typeof window.fmRebuildCharts === 'function') await window.fmRebuildCharts();
    await nextFrame();
  }
  return imgs;
}

// Compute quick story metrics from chart data if available
function extractPotAtRetAgeFromChart(){
  const ch = window.fmCharts.growth;
  if (!ch) return null;
  const ds = ch.data?.datasets?.[0];
  const labels = ch.data?.labels || [];
  // Assume last label is desired retirement age point (adjust if needed)
  const lastIdx = labels.length - 1;
  const val = Array.isArray(ds?.data) ? ds.data[lastIdx] : null;
  return (typeof val === 'number') ? val : null;
}
function extractDepleteAgeFromBalanceChart(){
  const ch = window.fmCharts.balance;
  if (!ch) return null;
  const ds = ch.data?.datasets?.[0];
  const labels = ch.data?.labels || [];
  if (!Array.isArray(ds?.data)) return null;
  let age = null;
  for (let i=0; i<ds.data.length; i++){
    if (ds.data[i] <= 0){ age = labels[i]; break; }
  }
  return age; // may be null (sustains)
}
function extractYear1IncomeCoverage(){
  const ch = window.fmCharts.cashflow;
  if (!ch) return null;
  const dsIncome = ch.data?.datasets?.find(d=>/income/i.test(d.label)) || ch.data?.datasets?.[0];
  const dsNeed   = ch.data?.datasets?.find(d=>/need|requirement/i.test(d.label));
  const inc = Array.isArray(dsIncome?.data) ? dsIncome.data[0] : null;
  const ned = Array.isArray(dsNeed?.data)   ? dsNeed.data[0]   : null;
  if (inc && ned) return Math.round((inc / ned) * 100);
  return null;
}

// Build the PDF
export async function buildFullMontyPDF(run){
  const doc = new jsPDFCtor({ unit:'pt', format:'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;

  // COLLECT DATA
  const faviconDataURL = await getFaviconDataURL();

  // Export CURRENT charts (without mutating UI mode)
  const currentImgs = await exportChartsForMode('current');
  // Export MAX charts (off-screen toggle)
  const maxImgs     = await exportChartsForMode('max');

  // These key figures should come from your existing state/computations:
  // Prefer reading from your state if available; fallback to chart extraction.
  const retAge   = run?.desiredRetAge || run?.retirementAge || 65;
  const ffn      = run?.ffnCombined ?? run?.ffn ?? null;

  const potAtRetCurrent = run?.potAtRetCurrent ?? extractPotAtRetAgeFromChart();
  // For max, we don't have a chart object bound (we grabbed PNGs only). If your code exposes
  // window.fmCharts.growth to reflect 'max' during export, you could also read here.
  // Otherwise, rely on run?.potAtRetMax or leave it null (still shows chart + gap bar).
  const potAtRetMax     = run?.potAtRetMax ?? null;

  // DURING retirement quick metrics from CURRENT charts
  const depleteAgeCurrent = extractDepleteAgeFromBalanceChart();
  const coveragePctYear1  = extractYear1IncomeCoverage();

  // PAGE 1: COVER (no footer here)
  drawBg(doc);
  centerText(doc, 'Planéir', M + 40, 32, '#FFFFFF', 'bold');
  if (faviconDataURL){
    const iconSize = Math.min(W * 0.38, 260);
    doc.addImage(faviconDataURL, 'PNG', (W-iconSize)/2, (H-iconSize)/2 - 30, iconSize, iconSize);
  }
  centerText(doc, 'Full-Monty Report', (H/2) + 160, 22, COVER_GOLD, 'bold');

  // PAGE 2: BEFORE RET — COMPARISON (Current vs Max)
  doc.addPage(); drawBg(doc);
  centerText(doc, 'Financial Freedom Number', M + 10, 12, COVER_GOLD, 'bold');
  centerText(doc, (ffn ? euro(ffn) : '—'), M + 34, 26, '#FFFFFF', 'bold');

  // Cards layout
  const colGap = 22;
  const colW = (W - 2*M - colGap) / 2;
  const cardTop = 90;
  const cardH = 330;

  // LEFT CARD (Current)
  drawCard(doc, M, cardTop, colW, cardH);
  blockTitle(doc, 'Current contributions — Pot @ ' + retAge, M + 16, cardTop + 26, '#FFFFFF');
  // headline number + gap
  const potCurStr = euro(potAtRetCurrent);
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(255,255,255);
  doc.text(potCurStr, M + 16, cardTop + 56);
  if (ffn && potAtRetCurrent != null){
    const gap = Math.round(potAtRetCurrent - ffn);
    const gapTxt = (gap >= 0 ? 'Surplus ' : 'Gap ') + euro(Math.abs(gap));
    const gapCol = (gap >= 0) ? ACCENT_GREEN : '#ff5b5b';
    const {r,g,b} = hexToRgb(gapCol);
    doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(r,g,b);
    doc.text(gapTxt, M + 16, cardTop + 76);
  }
  // mini chart (Projected Pension Value current)
  placeChartImage(doc, currentImgs.growth, M + 16, cardTop + 92, colW - 32, 160);
  // one-liner
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, `If you keep contributing as you are, your pot at age ${retAge} reaches ${potCurStr}.`, colW - 32), M + 16, cardTop + 270);

  // RIGHT CARD (Max)
  drawCard(doc, M + colW + colGap, cardTop, colW, cardH);
  blockTitle(doc, 'Max contributions — Pot @ ' + retAge, M + colW + colGap + 16, cardTop + 26, '#FFFFFF');
  // headline number (if known)
  if (potAtRetMax != null){
    doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(255,255,255);
    doc.text(euro(potAtRetMax), M + colW + colGap + 16, cardTop + 56);
    if (ffn){
      const gap = Math.round(potAtRetMax - ffn);
      const gapTxt = (gap >= 0 ? 'Surplus ' : 'Gap ') + euro(Math.abs(gap));
      const gapCol = (gap >= 0) ? ACCENT_GREEN : '#ff5b5b';
      const {r,g,b} = hexToRgb(gapCol);
      doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(r,g,b);
      doc.text(gapTxt, M + colW + colGap + 16, cardTop + 76);
    }
  }
  // mini chart (Projected Pension Value max)
  placeChartImage(doc, maxImgs.growth, M + colW + colGap + 16, cardTop + 92, colW - 32, 160);
  // one-liner
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, `At the maximum allowed contributions each year, your pot at age ${retAge} could reach the level shown.`, colW - 32), M + colW + colGap + 16, cardTop + 270);

  // Max contributions explainer (under both cards)
  const expl = `Max contributions are the age-related Revenue limits applied to your pensionable salary (capped at €115,000). See Page 6 for the full reference table.`;
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(210);
  doc.text(wrapText(doc, expl, W - 2*M), M, cardTop + cardH + 36);

  // PAGE 3: BEFORE RET — STORY (Current, two full charts + your copy)
  doc.addPage(); drawBg(doc);
  blockTitle(doc, 'Before retirement — Building your pension', M, M, '#FFFFFF');

  // Left: Projected Pension Value (current)
  blockTitle(doc, 'Will my pension reach my Financial Freedom Target?', M, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.growth, M, M + 46, (W - 2*M - colGap)/2, 220);
  // Copy (your tooltip text, tightened)
  let yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  const pvStory = (ffn && potAtRetCurrent != null)
    ? `At age ${retAge}, projected pot is ${euro(potAtRetCurrent)} vs FFN ${euro(ffn)}.`
    : `Projected pot vs FFN at your target age.`;
  doc.text(wrapText(doc, pvStory, (W - 2*M - colGap)/2), M, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  const pvCopy = [
    'This line shows how your pension could grow over time if you keep contributing as you are.',
    'The purple dotted line is your Financial Freedom Target — the amount needed to support your estimated income requirement in retirement all the way to age 100.',
    'The red line is the government’s pension cap (Standard Fund Threshold).',
    'If your curve rises above the purple line, you’re on track for financial freedom. If it rises above the red line, you may face extra tax rules.'
  ].join(' ');
  doc.text(wrapText(doc, pvCopy, (W - 2*M - colGap)/2), M, yTxt + 18);

  // Right: Contributions vs Growth (current)
  const rightX = M + (W - 2*M - colGap)/2 + colGap;
  blockTitle(doc, 'How much comes from me vs. my money working for me?', rightX, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.contrib, rightX, M + 46, (W - 2*M - colGap)/2, 220);
  yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text(wrapText(doc, 'Over time, compounding (growth) becomes the main driver of increases.', (W - 2*M - colGap)/2), rightX, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  const acCopy = [
    'The green bars are the contributions you make each year. The orange bars show how your money grows once invested.',
    'This highlights the power of compounding — your money earning money — which becomes a major driver of your pension’s long-term growth.'
  ].join(' ');
  doc.text(wrapText(doc, acCopy, (W - 2*M - colGap)/2), rightX, yTxt + 18);

  // PAGE 4: DURING RET — COMPARISON (Current vs Max)
  doc.addPage(); drawBg(doc);
  centerText(doc, 'Financial Freedom Number', M + 10, 12, COVER_GOLD, 'bold');
  centerText(doc, (ffn ? euro(ffn) : '—'), M + 34, 26, '#FFFFFF', 'bold');

  // Left card: Current drawdown
  drawCard(doc, M, cardTop, colW, cardH);
  blockTitle(doc, 'Current contributions — Drawdown', M + 16, cardTop + 26, '#FFFFFF');
  // Headline (sustain/deplete)
  const depTxt = (depleteAgeCurrent ? `Depletes at age ${depleteAgeCurrent}` : 'Sustains to age 100');
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(255,255,255);
  doc.text(depTxt, M + 16, cardTop + 52);
  // mini chart: current retirement balance
  placeChartImage(doc, currentImgs.balance, M + 16, cardTop + 64, colW - 32, 188);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'Projected pension balance throughout retirement while funding your target gross income.', colW - 32), M + 16, cardTop + 270);

  // Right card: Max drawdown
  drawCard(doc, M + colW + colGap, cardTop, colW, cardH);
  blockTitle(doc, 'Max contributions — Drawdown', M + colW + colGap + 16, cardTop + 26, '#FFFFFF');
  // mini chart: max retirement balance
  placeChartImage(doc, maxImgs.balance, M + colW + colGap + 16, cardTop + 64, colW - 32, 188);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  doc.text(wrapText(doc, 'With max contributions, projected balance under the same post-retirement assumptions.', colW - 32), M + colW + colGap + 16, cardTop + 270);

  // PAGE 5: DURING RET — STORY (Current, two full charts + your copy)
  doc.addPage(); drawBg(doc);
  blockTitle(doc, 'During retirement — Staying funded to age 100', M, M, '#FFFFFF');

  // Left: Projected Balance in Retirement (current)
  blockTitle(doc, 'Will my pension last to age 100?', M, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.balance, M, M + 46, (W - 2*M - colGap)/2, 220);
  yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  const rbStory = (depleteAgeCurrent ? `Under these assumptions, projected depletion at age ${depleteAgeCurrent}.` : `Withdrawals are sustained to age 100 under these assumptions.`);
  doc.text(wrapText(doc, rbStory, (W - 2*M - colGap)/2), M, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  const rbCopy = [
    'This chart shows your projected pension balance throughout retirement.',
    'The purple dotted line starts at your Financial Freedom Target and shows how that target would gradually deplete over time.',
    'The green curve shows your pension at retirement if you keep contributing as you are, and how long it might last.'
  ].join(' ');
  doc.text(wrapText(doc, rbCopy, (W - 2*M - colGap)/2), M, yTxt + 18);

  // Right: Annual Retirement Income (current)
  blockTitle(doc, 'Will my income cover my lifestyle in retirement?', rightX, M + 30, '#FFFFFF');
  placeChartImage(doc, currentImgs.cashflow, rightX, M + 46, (W - 2*M - colGap)/2, 220);
  yTxt = M + 276;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255);
  const y1 = run?.year1GrossIncome ?? null;
  const cov = coveragePctYear1 ?? null;
  const icStory = (y1 && cov) ? `At retirement, projected gross income is ${euro(y1)}; initial coverage is ${cov}%.` : `Projected gross income vs your inflation-linked requirement.`;
  doc.text(wrapText(doc, icStory, (W - 2*M - colGap)/2), rightX, yTxt);
  doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(220);
  const icCopy = [
    'This chart shows income you could draw each year, with any other retirement income sources.',
    'The line above represents your estimated income requirement in retirement (rises with inflation).',
    'The aim is for combined income sources to meet or exceed this requirement each year.'
  ].join(' ');
  doc.text(wrapText(doc, icCopy, (W - 2*M - colGap)/2), rightX, yTxt + 18);

  // SAVE
  doc.save('Planeir_Full-Monty_Report.pdf');
}

