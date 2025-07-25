export function formatDate(date){
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'});
}

export function savePdfBlob(pdf, filename='report.pdf'){
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
