// pdfWarningHelpers.js
// Centralised helpers for warning banners in jsPDF
const THEME = {
  fill: '#444',
  border: { normal: '#ffa500', danger: '#ff5c5c' },
  text: '#ffffff',
  fonts: { title: { size: 12, weight: 'bold' }, body: { size: 9, weight: 'normal' } },
  padding: { top: 14, bottom: 14, side: 12, gap: 10 },
  radius: 8,
  borderWidth: 2,
  lineHeight: 1.3
};

function htmlToPlain(str) {
  return str
    .replace(/<\/?li[^>]*>/gi, m => (m.startsWith('</') ? '' : '\n• '))
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u00A0\s]{2,}/g, ' ')
    .trim();
}

export function getBannerHeight(doc, warning, width) {
  const { fonts, padding, lineHeight } = THEME;
  const innerW = width - padding.side * 2;

  doc.setFont(undefined, fonts.title.weight).setFontSize(fonts.title.size);
  const titleLines = doc.splitTextToSize(warning.title, innerW);

  doc.setFont(undefined, fonts.body.weight).setFontSize(fonts.body.size);
  const bodyLines = doc.splitTextToSize(htmlToPlain(warning.body), innerW);

  return (
    padding.top +
    titleLines.length * fonts.title.size +
    padding.gap +
    bodyLines.length * fonts.body.size * lineHeight +
    padding.bottom
  );
}

export function drawBanner(doc, warning, x, y, width) {
  const { fill, border, text, fonts, padding, radius, borderWidth, lineHeight } = THEME;
  const accent = warning.danger ? border.danger : border.normal;
  const innerW = width - padding.side * 2;

  // Wrap title and body
  doc.setFont(undefined, fonts.title.weight).setFontSize(fonts.title.size);
  const titleLines = doc.splitTextToSize(warning.title, innerW);

  doc.setFont(undefined, fonts.body.weight).setFontSize(fonts.body.size);
  const bodyLines = doc.splitTextToSize(htmlToPlain(warning.body), innerW);

  // Height calculation
  const bodyH = bodyLines.length * fonts.body.size * lineHeight;
  const titleH = titleLines.length * fonts.title.size;
  const h = padding.top + titleH + padding.gap + bodyH + padding.bottom;

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
  doc.text(bodyLines, x + padding.side, cy, { lineHeightFactor: lineHeight, align: 'left' });

  return h;
}
