const THEME = {
  fill: '#444',
  border: { normal: '#ffa500', danger: '#ff5c5c' },   // unified colours
  text: '#ffffff',
  fonts: {
    title: { size: 12, weight: 'bold' },
    body : { size:  9, weight: 'normal' }
  },
  padding: { top: 14, bottom: 14, side: 12, gap: 10 },
  radius: 8,
  borderWidth: 2,
  lineHeight: 1.15,   // slightly tighter line spacing

  // Use a safe ASCII dash for list bullets to guarantee PDF-reader support.
  bullet: '- '
};

/* -------------------------------------------------------------------------- *
 * htmlToPlain()
 * • Converts HTML fragments into plain text for jsPDF.
 * • Keeps list structure by prefixing every <li> with THEME.bullet.
 * • Collapses &nbsp; / whitespace so jsPDF doesn’t insert odd spacers.
 * -------------------------------------------------------------------------- */
function htmlToPlain(html) {
  const { bullet } = THEME;
  return html
    // 1. Opening <li> ⇒ newline + dash  |  closing </li> ⇒ nothing
    .replace(/<\/?li[^>]*>/gi,
             m => (m.startsWith('</') ? '' : '\n' + bullet))

    // 2. <br> tags ⇒ newline
    .replace(/<br\s*\/?>(\s*)/gi, '\n')

    // 3. Unicode bullet produced by element.innerText() ⇒ newline + dash
    .replace(/(?:^|\n)\s*[•\u2022]\s*/g, '\n' + bullet)

    // 3-bis. Collapse multiple blank lines caused by <br><br> before <ul>
    .replace(/\n{2,}/g, '\n')

    // 4. Any other tag ⇒ single space (keeps words apart)
    .replace(/<[^>]+>/g, ' ')

    // 5. Collapse multiple ordinary or non-breaking spaces
    //    (leave new-lines intact so each bullet starts on its own line)
    .replace(/[ \u00A0]{2,}/g, ' ')
    .trim();
}

// Split text on hard new-lines first, then ask jsPDF to wrap each sub-line.
// Guarantees that every "\n" becomes a real line break in the final banner.
function wrapLines(doc, text, maxWidth) {
  return text
    .split('\n')
    .flatMap(t => doc.splitTextToSize(t.trim(), maxWidth));
}

/* ---------- size helper --------------------------------------------------- */
export function getBannerHeight(doc, warning, width) {
  const { fonts, padding, lineHeight } = THEME;
  const innerW = width - padding.side * 2;

  doc.setFont(undefined, fonts.title.weight).setFontSize(fonts.title.size);
  const titleLines = wrapLines(doc, warning.title, innerW);

  doc.setFont(undefined, fonts.body.weight).setFontSize(fonts.body.size);
  const bodyLines  = wrapLines(doc, htmlToPlain(warning.body), innerW);

  return (
    padding.top +
    titleLines.length * fonts.title.size +
    padding.gap +
    bodyLines.length  * fonts.body.size  * lineHeight +
    padding.bottom
  );
}

/* ---------- draw helper ---------------------------------------------------- */
export function drawBanner(doc, warning, x, y, width) {
  const {
    fill, border, text,
    fonts, padding, radius, borderWidth, lineHeight
  } = THEME;

  const accent  = warning.danger ? border.danger : border.normal;
  const innerW  = width - padding.side * 2;

  // Prepare wrapped lines
  doc.setFont(undefined, fonts.title.weight).setFontSize(fonts.title.size);
  const titleLines = wrapLines(doc, warning.title, innerW);

  doc.setFont(undefined, fonts.body.weight).setFontSize(fonts.body.size);
  const bodyLines  = wrapLines(doc, htmlToPlain(warning.body), innerW);

  // Geometry
  const titleH = titleLines.length * fonts.title.size;
  const bodyH  = bodyLines.length  * fonts.body.size * lineHeight;
  const h      = padding.top + titleH + padding.gap + bodyH + padding.bottom;

  // Panel
  doc.setFillColor(fill).setDrawColor(accent).setLineWidth(borderWidth);
  doc.roundedRect(x, y, width, h, radius, radius, 'FD');

  // Text
  let cy = y + padding.top;
  doc.setTextColor(text);

  doc.setFont(undefined, fonts.title.weight).setFontSize(fonts.title.size);
  doc.text(titleLines, x + padding.side, cy);
  cy += titleH + padding.gap;

  doc.setFont(undefined, fonts.body.weight).setFontSize(fonts.body.size);
  doc.text(bodyLines, x + padding.side, cy, {
    lineHeightFactor: lineHeight,
    align: 'left'
  });

  return h;
}
