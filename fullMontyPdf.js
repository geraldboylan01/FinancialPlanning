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

function drawBg(doc){
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFillColor(BG_DARK);
  doc.rect(0,0,W,H,'F');
}

// Paragraph writer with controlled line-height & spacing. Returns next Y.
function writeParagraph(doc, text, x, y, maxW, opts={}) {
  const {
    size=11, color='#E0E0E0', weight='normal',
    lineHeight=14,  // px per line
    after=10        // gap after paragraph
  } = opts;
  const {r,g,b} = hexToRgb(color);
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setTextColor(r,g,b);
  const lines = Array.isArray(text) ? text : doc.splitTextToSize(String(text || ''), maxW);
  lines.forEach((ln, i) => doc.text(ln, x, y + i*lineHeight));
  return y + (lines.length * lineHeight) + after;
}

// Multi-line title that wraps within a column. Returns next Y after title.
function writeTitle(doc, title, x, y, maxW, opts={}) {
  const { color='#FFFFFF', size=14, weight='bold', after=12, lineHeight=16 } = opts;
  return writeParagraph(doc, title, x, y, maxW, { color, size, weight, lineHeight, after });
}

// Centered single-line text
function centerText(doc, str, y, size=24, color='#FFFFFF', weight='bold'){
  const W = doc.internal.pageSize.getWidth();
  const {r,g,b} = hexToRgb(color);
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setTextColor(r,g,b);
  doc.text(str, W/2, y, {align:'center'});
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

function fmtEuro(n) {
  return (typeof n === 'number' && isFinite(n))
    ? new Intl.NumberFormat('en-IE',{ style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(Math.round(n))
    : '—';
}

function euro(n){
  if (n === null || n === undefined || Number.isNaN(n)) return '€–';
  return '€' + Intl.NumberFormat('en-IE', {maximumFractionDigits:0}).format(Math.round(n));
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

/**
 * Build the narrative summary paragraphs.
 * @param {object} p - snapshot payload from buildPdfRunSnapshotSafely()
 * Returns: string[] paragraphs (each one a separate paragraph in the PDF).
 */
function buildNarrativeSummary(p) {
  const P = [];
  const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : null;

  const ffnCombined     = num(p.ffnCombined);
  const potAtRetCurrent = num(p.potAtRetCurrent);
  const potAtRetMax     = num(p.potAtRetMax);
  const growthRatePct   = num(p.growthRatePct);
  const sftLimit        = num(p.sftLimit);
  const hasPartner      = !!p.hasPartner;
  const ageUser         = num(p.ageUser);
  const retAge          = num(p.retAge);
  const riskProfile     = p.riskProfile || null;

  // Is max scenario sufficient to reach FFN?
  const maxReachesFFN = (potAtRetMax != null && ffnCombined != null && potAtRetMax >= ffnCombined);
  // Treat 7% as “most aggressive” (your top risk rate)
  const isAtTopRisk = (growthRatePct != null && growthRatePct >= 7.0) || (/very\s*high/i.test(String(riskProfile || '')));

  const hasFFN = (ffnCombined != null && ffnCombined > 0);
  const curPct = (hasFFN && potAtRetCurrent != null) ? potAtRetCurrent / ffnCombined : null;
  const maxPct = (hasFFN && potAtRetMax     != null) ? potAtRetMax     / ffnCombined : null;

  const below    = (v,t)=> (v!=null && t!=null ? v <  t : false);
  const atLeast  = (v,t)=> (v!=null && t!=null ? v >= t : false);
  const nearSFT  = (v)=> (sftLimit!=null && v!=null && v >= 0.9 * sftLimit);
  const overSFT  = (v)=> (sftLimit!=null && v!=null && v >= sftLimit);

  // 1) Opening facts
  if (growthRatePct != null && hasFFN) {
    P.push(`With a projected growth rate of ${growthRatePct.toFixed(1)}% p.a., your Financial Freedom Number is ${fmtEuro(ffnCombined)}.`);
  }
  if (retAge != null && potAtRetCurrent != null && hasFFN) {
    const pct = curPct != null ? Math.round(curPct * 100) : null;
    P.push(`On current contributions, your projected pot at age ${retAge} is ${fmtEuro(potAtRetCurrent)}${pct!=null ? ` (${pct}% of FFN)` : ''}.`);
  }
  if (potAtRetMax != null && hasFFN) {
    const pct = maxPct != null ? Math.round(maxPct * 100) : null;
    P.push(`If you maximise contributions within Revenue limits, your projected pot is ${fmtEuro(potAtRetMax)}${pct!=null ? ` (${pct}% of FFN)` : ''}.`);
  }

  // 2) Core outcome logic
  if (below(potAtRetCurrent, ffnCombined) && below(potAtRetMax, ffnCombined)) {
    P.push(`Neither the current nor the maximised contribution path is projected to fully reach your FFN. To close the gap, you’ll likely need a coordinated plan across both pension and non-pension assets (e.g., taxable investments, property, or other savings).`);
  }
  if (below(potAtRetCurrent, ffnCombined) && atLeast(potAtRetMax, ffnCombined)) {
    P.push(`At current contribution levels there is a shortfall versus your FFN; however, maximising contributions is projected to reach or exceed the target, showing the impact of consistent higher savings and time in the market.`);
  }
  if (atLeast(potAtRetCurrent, ffnCombined) && atLeast(potAtRetMax, ffnCombined)) {
    P.push(`Your pension is on track to meet or exceed your FFN under both scenarios. Staying the course should keep you well-positioned, while maximising contributions provides additional resilience against inflation and market variability.`);
  }
  if (curPct != null && curPct >= 0.95 && atLeast(potAtRetMax, ffnCombined)) {
    P.push(`You’re very close to fully funded under current contributions. Even modest increases or gradual step-ups as income grows could bridge the remaining gap.`);
  }

  // 3) SFT awareness (always evaluate, independent of FFN outcome)
  if (overSFT(potAtRetCurrent) || overSFT(potAtRetMax)) {
    P.push(`Your projected fund is at or above the Standard Fund Threshold (SFT: ${fmtEuro(sftLimit)}). From here, additional savings may be more efficient in non-pension vehicles. Consider balancing future contributions between pension and diversified non-pension investments.`);
  } else if (nearSFT(potAtRetCurrent) || nearSFT(potAtRetMax)) {
    P.push(`Your pension is approaching the SFT (${fmtEuro(sftLimit)}). Keep an eye on total pension values and consider complementing pensions with non-pension investments to manage future tax exposure.`);
  }
  if (hasFFN && sftLimit != null && ffnCombined >= 1.2 * sftLimit) {
    P.push(`Because your FFN is substantially above the SFT, a purely pension-based route may not be the most efficient path. A coordinated strategy across pension and non-pension assets is likely required to reach the target efficiently.`);
  }

  // 4) Salary & contribution assumptions (clear for both paths)
  P.push(
    `Assumptions on salary and contributions: we hold your salary constant. ` +
    `In the current-contribution path, your contribution rate is held constant. ` +
    `In the maximised path, we assume you contribute the Revenue age-band maximum on today’s salary, ` +
    `with the percentage stepping up only when you enter a higher age band.`
  );

  // 5) Risk-profile nudge (only if max contributions still don't reach FFN and you’re not already at the top risk rate)
  if (!maxReachesFFN && riskProfile && !isAtTopRisk) {
    P.push(
      `You may wish to review your investment risk profile. ` +
      `A higher-risk allocation can raise long-term return potential, but it must align with your risk appetite and time horizon, ` +
      `and investment values can go down as well as up.`
    );
  }

  // 6) Partner micro-phrase
  if (hasPartner) {
    P.push(`Where a partner is included, coordinating contributions and drawdown across two pensions can reduce individual funding pressure and increase flexibility at retirement.`);
  }

  // 7) Young saver micro-phrase
  if (ageUser != null && ageUser < 35) {
    P.push(`Because you’re earlier in your career, compounding works strongly in your favour — even small contribution increases now can translate into significant gains over time.`);
  }

  // 8) Irish retirement-age rules (final wording agreed)
  if (retAge != null && retAge < 60) {
    P.push(`As your target retirement age is under 60, please note that in Ireland pensions can normally only be accessed earlier if you have left the employment linked to the scheme or meet specific early-retirement criteria. These projections assume you are eligible to do so, but individual circumstances may differ.`);
  }
  if (retAge != null && retAge > 70 && retAge < 75) {
    P.push(`For retirements after age 70, occupational pensions generally must be drawn down by age 70, whereas PRSAs can be deferred beyond that age. These figures therefore assume continued deferral for illustration purposes.`);
  }
  if (retAge != null && retAge >= 75) {
    P.push(`All Irish pension funds are deemed vested by age 75, so projections beyond this point are illustrative only and not a realistic representation of benefit timing.`);
  }

  // 9) Disclaimer
  P.push(`These results are illustrative and do not constitute tax or financial advice. Please consider personalised guidance before making decisions.`);

  return P;
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
  const M = 56;
  const colGap = 22;
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

  // ---------- Page 2: BEFORE RET — COMPARISON (Current vs Max) ----------
  doc.addPage(); drawBg(doc);
  centerText(doc, 'Financial Freedom Number', M + 10, 12, COVER_GOLD, 'bold');
  centerText(doc, (ffn ? euro(ffn) : '—'), M + 34, 26, '#FFFFFF', 'bold');

  const cardTop = 90, cardH = 330;

  // LEFT CARD (Current)
  drawCard(doc, M, cardTop, colW, cardH);
  let y = writeTitle(doc, `Current contributions — Pot @ ${retAge}`, M+16, cardTop+24, colW-32);
  if (potAtRetCurrent != null){
    y = writeParagraph(doc, euro(potAtRetCurrent), M+16, y, colW-32, { size:18, color:'#FFFFFF', weight:'bold', after:4 });
    if (ffn){
      const gap = Math.round(potAtRetCurrent - ffn);
      const gapTxt = (gap >= 0 ? 'Surplus ' : 'Gap ') + euro(Math.abs(gap));
      const gapCol = (gap >= 0) ? ACCENT_GREEN : '#ff5b5b';
      y = writeParagraph(doc, gapTxt, M+16, y, colW-32, { size:12, color:gapCol, after:8 });
    }
  }
  placeChartImage(doc, currentImgs.growth, M+16, y, colW-32, 160);
  y += 160 + 10;
  y = writeParagraph(doc, `If you keep contributing as you are, your pot at age ${retAge} reaches ${euro(potAtRetCurrent)}.`, M+16, y, colW-32, { size:11 });

  // RIGHT CARD (Max)
  const rx = M + colW + colGap;
  drawCard(doc, rx, cardTop, colW, cardH);
  let yR = writeTitle(doc, `Max contributions — Pot @ ${retAge}`, rx+16, cardTop+24, colW-32);
  if (potAtRetMax != null){
    yR = writeParagraph(doc, euro(potAtRetMax), rx+16, yR, colW-32, { size:18, color:'#FFFFFF', weight:'bold', after:4 });
    if (ffn){
      const gap = Math.round(potAtRetMax - ffn);
      const gapTxt = (gap >= 0 ? 'Surplus ' : 'Gap ') + euro(Math.abs(gap));
      const gapCol = (gap >= 0) ? ACCENT_GREEN : '#ff5b5b';
      yR = writeParagraph(doc, gapTxt, rx+16, yR, colW-32, { size:12, color:gapCol, after:8 });
    }
  }
  placeChartImage(doc, maxImgs.growth, rx+16, yR, colW-32, 160);
  yR += 160 + 10;
  // NEW: explicit subtext for max scenario
  yR = writeParagraph(
    doc,
    (potAtRetMax != null)
      ? `At the maximum allowed contributions each year, your pot at age ${retAge} could reach ${euro(potAtRetMax)}.`
      : `At the maximum allowed contributions each year, your pot at age ${retAge} could reach a higher level (see chart).`,
    rx+16, yR, colW-32, { size:11 }
  );

  // Explainer under both cards
  const expl = `Max contributions are the age-related Revenue limits applied to your pensionable salary (capped at €115,000). See Page 6 for the full reference table.`;
  writeParagraph(doc, expl, M, cardTop + cardH + 24, W - 2*M, { size:11, color:'#D2D2D2', after:0 });

  // === Narrative Summary ===
  const narrative = buildNarrativeSummary(run || {});
  if (narrative.length) {
    const startNarrativePage = (title = 'Narrative Summary') => {
      doc.addPage();
      drawBg(doc);
      return writeTitle(doc, title, M, M, W - 2*M, { size:14 });
    };

    let yNarr = startNarrativePage();
    narrative.forEach((para, idx) => {
      if (yNarr + 80 > H - M) {
        yNarr = startNarrativePage('Narrative Summary (cont.)');
      }
      yNarr = writeParagraph(doc, para, M, yNarr, W - 2*M, { size:11, lineHeight:16, after:12 });
    });
  }

  // ---------- Page 3: BEFORE RET — STORY (Current) ----------
  doc.addPage(); drawBg(doc);
  let topY = writeTitle(doc, 'Before retirement — Building your pension', M, M, W-2*M, { size:14 });

  const colW3 = (W - 2*M - colGap) / 2;

  // Left chart + copy
  let yL = writeTitle(doc, 'Will my pension reach my Financial Freedom Target?', M, topY, colW3);
  placeChartImage(doc, currentImgs.growth, M, yL, colW3, 220);
  yL += 220 + 12;
  yL = writeParagraph(doc,
    (ffn && potAtRetCurrent!=null)
      ? `At age ${retAge}, projected pot is ${euro(potAtRetCurrent)} vs FFN ${euro(ffn)}.`
      : `Projected pot vs FFN at your target age.`,
    M, yL, colW3, { size:11, color:'#FFFFFF', weight:'bold', after:6 }
  );
  yL = writeParagraph(doc,
    'This line shows how your pension could grow over time if you keep contributing as you are. The purple dotted line is your Financial Freedom Target — the amount needed to support your estimated income requirement in retirement all the way to age 100. The red line is the government’s pension cap (Standard Fund Threshold). If your curve rises above the purple line, you’re on track for financial freedom. If it rises above the red line, you may face extra tax rules.',
    M, yL, colW3, { size:11 }
  );

  // Right chart + copy
  const rightX = M + colW3 + colGap;
  let yR3 = writeTitle(doc, 'How much comes from me vs. my money working for me?', rightX, topY, colW3);
  placeChartImage(doc, currentImgs.contrib, rightX, yR3, colW3, 220);
  yR3 += 220 + 12;
  yR3 = writeParagraph(doc, 'Over time, compounding (growth) becomes the main driver of increases.', rightX, yR3, colW3, { size:11, color:'#FFFFFF', weight:'bold', after:6 });
  writeParagraph(doc,
    'The green bars are the contributions you make each year. The orange bars show how your money grows once invested. This highlights the power of compounding — your money earning money — which becomes a major driver of your pension’s long-term growth.',
    rightX, yR3, colW3, { size:11 }
  );

  // ---------- Page 4: Compare (During Retirement) ----------
  doc.addPage(); drawBg(doc);
  centerText(doc, 'Financial Freedom Number', M + 10, 12, COVER_GOLD, 'bold');
  centerText(doc, (ffn ? euro(ffn) : '—'), M + 34, 26, '#FFFFFF', 'bold');

  const cardTop4 = 90, cardH4 = 330;

  // Current contributions card
  drawCard(doc, M, cardTop4, colW, cardH4);
  let yCur = writeTitle(doc, 'Current contributions — Drawdown', M + 16, cardTop4 + 24, colW - 32);
  const depTxt = (depleteAgeCurrent ? `Depletes at age ${depleteAgeCurrent}` : 'Sustains to age 100');
  yCur = writeParagraph(doc, depTxt, M + 16, yCur, colW - 32, { size:14, color:'#FFFFFF', weight:'bold', after:12 });
  placeChartImage(doc, currentImgs.balance, M + 16, yCur, colW - 32, 188);
  yCur += 188 + 12;
  writeParagraph(doc, 'Projected pension balance throughout retirement while funding your target gross income.', M + 16, yCur, colW - 32, { size:11 });

  // Max contributions card
  const rightX4 = M + colW + colGap;
  drawCard(doc, rightX4, cardTop4, colW, cardH4);
  let yMax = writeTitle(doc, 'Max contributions — Drawdown', rightX4 + 16, cardTop4 + 24, colW - 32);
  placeChartImage(doc, maxImgs.balance, rightX4 + 16, yMax, colW - 32, 188);
  yMax += 188 + 12;
  writeParagraph(doc, 'With max contributions, projected balance under the same post-retirement assumptions.', rightX4 + 16, yMax, colW - 32, { size:11 });

  // ---------- Page 5: DURING RET — STORY (Current) ----------
  doc.addPage(); drawBg(doc);
  topY = writeTitle(doc, 'During retirement — Staying funded to age 100', M, M, W-2*M, { size:14 });

  const colW5 = (W - 2*M - colGap) / 2;

  // Left
  let yL5 = writeTitle(doc, 'Will my pension last to age 100?', M, topY, colW5);
  placeChartImage(doc, currentImgs.balance, M, yL5, colW5, 220);
  yL5 += 220 + 12;
  yL5 = writeParagraph(doc,
    depleteAgeCurrent ? `Under these assumptions, projected depletion at age ${depleteAgeCurrent}.`
                      : `Withdrawals are sustained to age 100 under these assumptions.`,
    M, yL5, colW5, { size:11, color:'#FFFFFF', weight:'bold', after:6 }
  );
  writeParagraph(doc,
    'This chart shows your projected pension balance throughout retirement. The purple dotted line starts at your Financial Freedom Target and shows how that target would gradually deplete over time. The green curve shows your pension at retirement if you keep contributing as you are, and how long it might last.',
    M, yL5, colW5, { size:11 }
  );

  // Right
  let yR5 = writeTitle(doc, 'Will my income cover my lifestyle in retirement?', rightX, topY, colW5);
  placeChartImage(doc, currentImgs.cashflow, rightX, yR5, colW5, 220);
  yR5 += 220 + 12;
  const y1 = run?.year1GrossIncome ?? null;
  const cov = coveragePctYear1 ?? null;
  yR5 = writeParagraph(doc,
    (typeof y1==='number' && typeof cov==='number')
      ? `At retirement, projected gross income is ${euro(y1)}; initial coverage is ${cov}%.`
      : `Projected gross income vs your inflation-linked requirement.`,
    rightX, yR5, colW5, { size:11, color:'#FFFFFF', weight:'bold', after:6 }
  );
  writeParagraph(doc,
    'This chart shows the income you could draw from your pension each year, along with any other retirement income sources (such as State Pension or rental income). The line above represents your estimated income requirement in retirement, which gradually rises due to inflation. The aim is for your combined income sources to meet or exceed this requirement each year.',
    rightX, yR5, colW5, { size:11 }
  );

  // ---------- Page 6: Inputs & Assumptions ----------
  doc.addPage(); drawBg(doc);

  let yA = writeTitle(doc, 'Inputs & Assumptions', M, M, W-2*M, { size:14 });

  // Left column (Inputs)
  const colW6 = (W - 2*M - colGap) / 2;
  yA = writeTitle(doc, 'Inputs (no names)', M, yA, colW6);
  const inputsLines = [
    `Has partner: ${run?.hasPartner ? 'Yes' : 'No'}`,
    (run?.ageUser    ? `Your age: ${run.ageUser}` : null),
    (run?.agePartner ? `Partner age: ${run.agePartner}` : null),
    `Desired retirement age: ${retAge}`,
    (typeof potAtRetCurrent === 'number' ? `Projected pot @ ${retAge} (current): ${euro(potAtRetCurrent)}` : null),
    (typeof potAtRetMax === 'number'     ? `Projected pot @ ${retAge} (max): ${euro(potAtRetMax)}` : null),
    (typeof ffn === 'number'             ? `Financial Freedom Number (FFN): ${euro(ffn)}` : null),
  ].filter(Boolean);
  yA = writeParagraph(doc, inputsLines, M, yA, colW6, { size:11 });

  // Right column (Assumptions)
  let yB = writeTitle(doc, 'Assumptions', M + colW6 + colGap, M + 14, colW6);
  const CPIv = (typeof window?.CPI === 'number') ? window.CPI : 0.02;
  yB = writeParagraph(doc, [
    `Inflation (CPI): ${(CPIv*100).toFixed(1)}%`,
    `Retirement income is shown in gross terms (before personal taxes).`,
    `Max pensionable salary used in limits: €115,000.`
  ], M + colW6 + colGap, yB, colW6, { size:11 });

  // Max-contribution reference table
  yB = writeTitle(doc, 'Age-related personal max contributions', M + colW6 + colGap, yB, colW6, { size:12 });

  const BANDS = [
    { label:'Up to 29', min:0, max:29, pct:15 },
    { label:'30–39',    min:30, max:39, pct:20 },
    { label:'40–49',    min:40, max:49, pct:25 },
    { label:'50–54',    min:50, max:54, pct:30 },
    { label:'55–59',    min:55, max:59, pct:35 },
    { label:'60+',      min:60, max:200, pct:40 },
  ];

  const cap = 115000;
  const salary = Math.min(Number(window?.lastWizard?.salary || window?.inputs?.grossIncome || 0) || 0, cap);
  const rowLH = 14;

  writeParagraph(doc, `Example at pensionable salary €${salary.toLocaleString()} (capped):`, M + colW6 + colGap, yB, colW6, { size:10, color:'#CCCCCC', after:6 }); yB += 0;

  (function drawSimpleTable(){
    const x = M + colW6 + colGap;
    const wBand = 90, wPct = 40, wEuro = colW6 - (wBand + wPct + 14);
    // header
    yB = writeParagraph(doc, ['Age band', 'Max %', '€/yr (example)'], x, yB, colW6, { size:10, color:'#AAAAAA', lineHeight:rowLH, after:6 });
    // rows
    BANDS.forEach(b => {
      const euroVal = Math.round(salary * (b.pct/100));
      // three columns in one line using precise x’s
      doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(224);
      doc.text(b.label, x, yB);
      doc.text(`${b.pct}%`, x + wBand + 8, yB);
      doc.text(`€${euroVal.toLocaleString()}`, x + wBand + 8 + wPct + 8, yB);
      yB += rowLH;
    });
    yB += 8;
  })();
  writeParagraph(doc, 'Note: Table shows personal age-related limits. Employer contributions are not subject to this €115,000 cap.', M + colW6 + colGap, yB, colW6, { size:10, color:'#CCCCCC' });

  // ---------- Save ----------
  doc.save('Planeir_Full-Monty_Report.pdf');
}

