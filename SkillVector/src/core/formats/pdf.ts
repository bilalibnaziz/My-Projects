// PDF export (one page, or one page per print tile): the flattened image as JPEG (small) or lossless Flate, with an
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
  return buildPdfPages([{ img, width: (img.width * 72) / dpi, height: (img.height * 72) / dpi }], opts.title);
}

/** One page per image, each image filling its page (width/height in points). */
export function buildPdfPages(pages: { img: PdfImage; width: number; height: number }[], title = 'Untitled'): Uint8Array {
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
  const image = (n: number, w: number, h: number, space: string, filter: string, data: Uint8Array, smask?: number) =>
    obj(n, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${space} /BitsPerComponent 8 /Filter /${filter}${smask ? ` /SMask ${smask} 0 R` : ''} /Length ${data.length} >>\nstream\n`);
      push(data);
      push('\nendstream');
    });
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  // Objects: 1 catalog, 2 page tree, then per page: page, contents, image, soft mask (4 numbers each)
  const first = (i: number) => 3 + i * 4;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${first(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach(({ img, width: pw, height: ph }, i) => {
    const n = first(i);
    const content = `q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(3)} ${ph.toFixed(3)}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    image(n + 2, img.width, img.height, 'DeviceRGB', img.filter, img.data, img.alpha ? n + 3 : undefined);
    if (img.alpha) image(n + 3, img.width, img.height, 'DeviceGray', 'FlateDecode', img.alpha);
    else obj(n + 3, 'null');
  });
  const info = first(pages.length);
  obj(info, `<< /Title (${esc(title)}) /Producer (Skill Vector) >>`);
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
