/** Small ASCII-only PDF fixture with real xref offsets; no external tools or models. */
export function textPdf(pages: string[][]): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((lines, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const escaped = lines.map(line => line.replace(/[\\()]/g, '\\$&'));
    const stream = `BT /F1 10 Tf 30 750 Td 12 TL ${escaped.map(line => `(${line}) Tj T*`).join(' ')} ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  if ([...output].some(char => char.charCodeAt(0) > 127)) throw new Error('PDF test fixture accepts ASCII only');
  return new TextEncoder().encode(output);
}
