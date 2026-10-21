// Single-page PDF export: the flattened image as JPEG (small) or lossless Flate, with an
// alpha soft mask when the document has transparency. Page size follows the chosen DPI.

export interface PdfImage {
  width: number;
  height: number;
  /** JPEG bytes (DCTDecode) or zlib-deflated RGB bytes (FlateDecode). */
  data: Uint8Array;
  filter: 'DCTDecode' | 'FlateDecode';
  /** Optional zlib-deflated 8-bit alpha. */
  alpha?: Uint8Array;
}

export function buildPdf(img: PdfImage, opts: { dpi?: number; title?: string } = {}): Uint8Array {
  const dpi = opts.dpi ?? 72;
  const pw = (img.width * 72) / dpi;
  const ph = (img.height * 72) / dpi;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(u);
    pos += u.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const content = `q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} 0 0 cm /Im0 Do Q`;
  const hasAlpha = !!img.alpha;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(3)} ${ph.toFixed(3)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(5, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter}${hasAlpha ? ' /SMask 6 0 R' : ''} /Length ${img.data.length} >>\nstream\n`);
    push(img.data);
    push('\nendstream');
  });
  if (hasAlpha) {
    obj(6, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.alpha!.length} >>\nstream\n`);
      push(img.alpha!);
      push('\nendstream');
    });
  }
  const info = hasAlpha ? 7 : 6;
  obj(info, `<< /Title (${esc(opts.title ?? 'Untitled')}) /Producer (Skill Photo) >>`);
  const xref = pos;
  const count = info + 1;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** zlib-deflate (what PDF's FlateDecode expects) via the browser's CompressionStream. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
