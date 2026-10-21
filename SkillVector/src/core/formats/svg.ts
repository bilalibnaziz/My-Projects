// SVG export that stays editable where it can: shape layers become <path>s, text layers become
// <text> with styled <tspan>s, groups become <g>s. Layers that need pixels (photos, effects,
// masks, clipping, adjustments underneath) are embedded as PNG <image>s so the result still
// looks like the document.

import type { Doc, Layer, PathAnchor, ShapeProps } from '../types';
import { flattenAnchors, variableStrokeOutline } from '../strokeProfile';
import { hasFx } from '../types';
import { alphaBounds, createCanvas, ctx2d } from '../canvas';
import { renderDocument, shapePath } from '../render';
import { filletedRings, hasPathCorners } from '../shapeGeometry';
import { patternSvg } from '../patterns';
import { childrenOf } from '../groups';
import { layoutText } from '../text';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

const CSS_BLENDS = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

/** Records Canvas 2D path calls as SVG path data. */
class PathRecorder {
  d: string[] = [];
  beginPath() {}
  moveTo(x: number, y: number) {
    this.d.push(`M${n(x)} ${n(y)}`);
  }
  lineTo(x: number, y: number) {
    this.d.push(`L${n(x)} ${n(y)}`);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.d.push(`C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(x)} ${n(y)}`);
  }
  closePath() {
    this.d.push('Z');
  }
  rect(x: number, y: number, w: number, h: number) {
    this.d.push(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    const R = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2);
    this.d.push(`M${n(x + R)} ${n(y)}H${n(x + w - R)}A${n(R)} ${n(R)} 0 0 1 ${n(x + w)} ${n(y + R)}V${n(y + h - R)}A${n(R)} ${n(R)} 0 0 1 ${n(x + w - R)} ${n(y + h)}H${n(x + R)}A${n(R)} ${n(R)} 0 0 1 ${n(x)} ${n(y + h - R)}V${n(y + R)}A${n(R)} ${n(R)} 0 0 1 ${n(x + R)} ${n(y)}Z`);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    this.d.push(`M${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}Z`);
  }
}

function attrs(l: Layer): string {
  let a = '';
  if (l.opacity < 1) a += ` opacity="${n(l.opacity)}"`;
  if (l.blend !== 'normal') {
    const css = l.blend === 'lighter' ? 'plus-lighter' : l.blend;
    if (CSS_BLENDS.has(l.blend) || l.blend === 'lighter') a += ` style="mix-blend-mode:${css}"`;
  }
  return a;
}

/** Pixels of layers rendered on their own, cropped, as an <image>. */
function imageOf(doc: Doc, layers: Layer[], extra = ''): string {
  const c = createCanvas(doc.width, doc.height);
  renderDocument({ ...doc, layers }, c);
  const b = alphaBounds(c);
  if (!b) return '';
  const crop = createCanvas(b.width, b.height);
  ctx2d(crop).drawImage(c, -b.x, -b.y);
  return `<image x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" href="${crop.toDataURL('image/png')}"${extra}/>`;
}

/** A live rotation as an SVG transform about the layer's centre. */
const rotateAttr = (l: Layer) => (l.rotation ? ` transform="rotate(${n(l.rotation)} ${n(l.x + l.width / 2)} ${n(l.y + l.height / 2)})"` : '');

const plainVector = (l: Layer) => !hasFx(l) && !l.mask && !l.clip && (l.fill ?? 1) === 1;

let defId = 0;

/** `<stop>`s, with any alpha in #rrggbbaa moved to stop-opacity for older viewers. */
const stopsSvg = (stops: { offset: number; color: string }[]) =>
  stops.map((st) => `<stop offset="${n(Math.max(0, Math.min(1, st.offset)))}" stop-color="${st.color.slice(0, 7)}"${st.color.length === 9 ? ` stop-opacity="${n(parseInt(st.color.slice(7), 16) / 255)}"` : ''}/>`).join('');

function shapeSvg(l: Layer): string {
  const s = l.shape!;
  const rec = new PathRecorder();
  shapePath(rec as unknown as CanvasRenderingContext2D, s, l.x, l.y, l.width, l.height);
  const isLine = s.shape === 'line' || s.shape === 'arrow' || (s.shape === 'path' && !s.closed);
  let defs = '';
  let fill = !isLine && s.fillEnabled ? s.fill : 'none';
  // Gradients (fill and stroke) as userSpaceOnUse definitions over the layer box
  const gradRef = (gr: ShapeProps['gradient']): string | null => {
    if (!gr || gr.stops.length < 2) return null;
    const id = `grad${++defId}`;
    const X = (v: number) => n(l.x + v * l.width);
    const Y = (v: number) => n(l.y + v * l.height);
    defs += gr.type === 'radial'
      ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${X(gr.x0)}" cy="${Y(gr.y0)}" r="${n(Math.hypot((gr.x1 - gr.x0) * l.width, (gr.y1 - gr.y0) * l.height))}">${stopsSvg(gr.stops)}</radialGradient>`
      : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${X(gr.x0)}" y1="${Y(gr.y0)}" x2="${X(gr.x1)}" y2="${Y(gr.y1)}">${stopsSvg(gr.stops)}</linearGradient>`;
    return `url(#${id})`;
  };
  if (fill !== 'none' && s.pattern) {
    const id = `pat${++defId}`;
    defs += patternSvg(id, s.pattern, l.x, l.y, n);
    fill = `url(#${id})`;
  } else if (fill !== 'none') fill = gradRef(s.gradient) ?? fill;
  const strokePaint = gradRef(s.strokeGradient) ?? s.stroke;
  const cap = s.strokeCap ?? 'round';
  const join = s.strokeJoin ?? 'round';
  const dash = s.strokeDash && s.strokeDash.length ? ` stroke-dasharray="${s.strokeDash.join(' ')}"` : '';
  const fo = s.fillOpacity ?? 1, so = s.strokeOpacity ?? 1;
  const fillOp = fill !== 'none' && fo < 1 ? ` fill-opacity="${n(fo)}"` : '';
  const strokeOp = so < 1 ? ` stroke-opacity="${n(so)}"` : '';
  const fillRule = s.compoundPoints && s.compoundPoints.length > 1 ? ` fill-rule="evenodd"` : '';
  const stroke = s.strokeWidth > 0 || isLine ? ` stroke="${strokePaint}" stroke-width="${n(Math.max(1, s.strokeWidth))}" stroke-linejoin="${join}" stroke-linecap="${cap}"${dash}${strokeOp}` : '';
  const d = rec.d.join('');
  if (fill !== 'none' && s.mesh?.length) {
    // Mesh points: radial colour spots clipped to the shape, under the stroke
    const clip = `clip${++defId}`;
    const diag = Math.hypot(l.width, l.height);
    let spots = '';
    for (const m of s.mesh) {
      const id = `mesh${++defId}`;
      const cx = l.x + m.x * l.width, cy = l.y + m.y * l.height, r = Math.max(1, (m.spread ?? 0.45) * diag);
      defs += `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"><stop offset="0" stop-color="${m.color.slice(0, 7)}"/><stop offset="1" stop-color="${m.color.slice(0, 7)}" stop-opacity="0"/></radialGradient>`;
      spots += `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(r * 2)}" height="${n(r * 2)}" fill="url(#${id})"/>`;
    }
    defs += `<clipPath id="${clip}"><path d="${d}"${fillRule ? ' clip-rule="evenodd"' : ''}/></clipPath>`;
    return `<g${attrs(l)}${rotateAttr(l)}><title>${esc(l.name)}</title><defs>${defs}</defs><path d="${d}" fill="${fill}"${fillRule}${fillOp}/><g clip-path="url(#${clip})"${fo < 1 ? ` opacity="${n(fo)}"` : ''}>${spots}</g>${stroke ? `<path d="${d}" fill="none"${stroke}/>` : ''}</g>`;
  }
  // Variable width, or a stroke aligned inside / outside: the stroke is its own element
  const align = isLine ? 'center' : s.strokeAlign ?? 'center';
  if (stroke && ((s.widthPoints?.length && s.shape === 'path') || align !== 'center')) {
    let strokeEl: string;
    if (s.widthPoints?.length && s.shape === 'path') {
      const subs = s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []];
      const at = (a: PathAnchor): PathAnchor => ({ x: l.x + a.x * l.width, y: l.y + a.y * l.height, ix: l.x + a.ix * l.width, iy: l.y + a.iy * l.height, ox: l.x + a.ox * l.width, oy: l.y + a.oy * l.height });
      const docSubs = hasPathCorners(s) ? filletedRings(s, l.x, l.y, l.width, l.height) : subs.map((sub) => sub.map(at));
      const od = docSubs
        .flatMap((sub) => variableStrokeOutline(flattenAnchors(sub, !!s.closed), !!s.closed, s.strokeWidth, s.widthPoints, cap))
        .map((ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('') + 'Z')
        .join('');
      strokeEl = `<path d="${od}" fill="${strokePaint}" fill-rule="evenodd"${so < 1 ? ` fill-opacity="${n(so)}"` : ''}/>`;
    } else {
      const wide = ` stroke="${strokePaint}" stroke-width="${n(Math.max(1, s.strokeWidth) * 2)}" stroke-linejoin="${join}" stroke-linecap="${cap}"${dash}${strokeOp}`;
      const id = `${align}${++defId}`;
      if (align === 'inside') {
        defs += `<clipPath id="${id}"><path d="${d}"${fillRule ? ' clip-rule="evenodd"' : ''}/></clipPath>`;
        strokeEl = `<path d="${d}" fill="none"${wide} clip-path="url(#${id})"/>`;
      } else {
        const r = Math.max(1, s.strokeWidth) * 2;
        defs += `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(l.x - r)}" y="${n(l.y - r)}" width="${n(l.width + r * 2)}" height="${n(l.height + r * 2)}"><rect x="${n(l.x - r)}" y="${n(l.y - r)}" width="${n(l.width + r * 2)}" height="${n(l.height + r * 2)}" fill="#fff"/><path d="${d}" fill="#000"${fillRule}/></mask>`;
        strokeEl = `<path d="${d}" fill="none"${wide} mask="url(#${id})"/>`;
      }
    }
    return `<g${attrs(l)}${rotateAttr(l)}><title>${esc(l.name)}</title>${defs ? `<defs>${defs}</defs>` : ''}${fill !== 'none' ? `<path d="${d}" fill="${fill}"${fillRule}${fillOp}/>` : ''}${strokeEl}</g>`;
  }
  return `${defs ? `<defs>${defs}</defs>` : ''}<path d="${d}" fill="${fill}"${fillRule}${fillOp}${stroke}${attrs(l)}${rotateAttr(l)}><title>${esc(l.name)}</title></path>`;
}

/** Type on a path: one <textPath> along the layer's path. */
function pathTextSvg(l: Layer): string {
  const t = l.text!;
  const pts = t.path!.points;
  const id = `tp${++defId}`;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${n(l.x + p.x)} ${n(l.y + p.y)}`).join('') + (t.path!.closed ? 'Z' : '');
  const anchor = t.align === 'center' ? ' text-anchor="middle" startOffset="50%"' : t.align === 'right' ? ' text-anchor="end" startOffset="100%"' : '';
  const outline = t.stroke > 0 ? ` stroke="${t.strokeColor}" stroke-width="${n(t.stroke * 2)}" stroke-linejoin="round" paint-order="stroke"` : '';
  const text = t.caps ? t.text.toUpperCase() : t.text;
  return `<g${attrs(l)}${rotateAttr(l)}><title>${esc(l.name)}</title><defs><path id="${id}" d="${d}"/></defs><text font-family="${esc(t.font)}, system-ui, sans-serif" font-size="${n(t.size)}" font-weight="${t.weight}"${t.italic ? ' font-style="italic"' : ''} fill="${t.color}"${t.tracking ? ` letter-spacing="${n(t.tracking)}"` : ''}${outline}><textPath href="#${id}" xlink:href="#${id}"${anchor}>${esc(text.replace(/\n/g, ' '))}</textPath></text></g>`;
}

function textSvg(l: Layer): string {
  const t = l.text!;
  if (t.path && !t.vertical) return pathTextSvg(l);
  const L = layoutText(t);
  let out = `<g${attrs(l)}${rotateAttr(l)}><title>${esc(l.name)}</title>`;
  if (t.box) {
    const bp = t.boxPad ?? 0;
    out += `<rect x="${n(l.x - bp)}" y="${n(l.y - bp)}" width="${n(L.width + bp * 2)}" height="${n(L.height + bp * 2)}" rx="${n(t.boxRadius ?? 0)}" fill="${t.boxColor ?? '#000000'}"/>`;
  }
  const outline = t.stroke > 0 ? ` stroke="${t.strokeColor}" stroke-width="${n(t.stroke * 2)}" stroke-linejoin="round" paint-order="stroke"` : '';
  out += `<text xml:space="preserve"${t.tracking ? ` letter-spacing="${n(t.tracking)}"` : ''}${outline}>`;
  for (const line of L.lines) {
    for (const seg of line.segments) {
      const s = seg.style;
      const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
      out += `<tspan x="${n(l.x + seg.x)}" y="${n(l.y + line.baseline)}" font-family="${esc(s.font)}, system-ui, sans-serif" font-size="${n(s.size)}" font-weight="${s.weight}"${s.italic ? ' font-style="italic"' : ''} fill="${s.color}"${deco ? ` text-decoration="${deco}"` : ''}>${esc(seg.text)}</tspan>`;
    }
  }
  return `${out}</text></g>`;
}

export function docToSvg(doc: Doc): string {
  const top = childrenOf(doc.layers, undefined);
  // Adjustment layers recolour everything under them: flatten up to the topmost one
  let start = 0;
  let body = '';
  const lastAdj = top.map((l) => l.kind === 'adjustment').lastIndexOf(true);
  if (lastAdj >= 0) {
    const ids = new Set(top.slice(0, lastAdj + 1).map((l) => l.id));
    const keep = doc.layers.filter((l) => {
      let p: Layer | undefined = l;
      while (p?.parent) p = doc.layers.find((x) => x.id === p!.parent);
      return p && ids.has(p.id);
    });
    body += imageOf(doc, keep);
    start = lastAdj + 1;
  }

  const emit = (list: Layer[]): string => {
    let s = '';
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      // A clipping stack is drawn as one picture
      let j = i + 1;
      while (j < list.length && list[j].clip) j++;
      if (!l.visible) {
        i = j - 1;
        continue;
      }
      if (j > i + 1) {
        const stack = list.slice(i, j);
        s += imageOf(doc, doc.layers.filter((x) => stack.some((y) => y.id === x.id) || isInside(doc, x, stack)).map((x) => (stack.includes(x) ? { ...x, parent: undefined } : x)));
        i = j - 1;
        continue;
      }
      if (l.kind === 'group') {
        const kids = childrenOf(doc.layers, l.id);
        if (plainVector(l) && !kids.some((k) => k.kind === 'adjustment')) s += `<g id="${esc(l.name)}"${attrs(l)}>${emit(kids)}</g>`;
        else s += imageOf(doc, [...doc.layers.filter((x) => isInside(doc, x, [l])), { ...l, parent: undefined, opacity: 1, blend: 'normal' }], attrs(l));
      } else if (l.kind === 'shape' && l.shape && plainVector(l)) s += shapeSvg(l);
      else if (l.kind === 'text' && l.text && plainVector(l) && (!l.text.warp || l.text.warp.style === 'none' || !l.text.warp.bend) && !l.text.shadow && !l.text.vertical) s += textSvg(l);
      else if (l.kind !== 'adjustment') {
        // Pixels (with mask and styles), drawn at full strength; opacity / blend go on the element
        s += imageOf(doc, [{ ...l, parent: undefined, opacity: 1, blend: 'normal' }], attrs(l));
      }
    }
    return s;
  };
  body += emit(top.slice(start));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n<title>${esc(doc.title)}</title>\n${body}\n</svg>\n`;
}

function isInside(doc: Doc, l: Layer, groups: Layer[]): boolean {
  let p = l.parent;
  for (let k = 0; p && k < 64; k++) {
    if (groups.some((g) => g.id === p)) return true;
    p = doc.layers.find((x) => x.id === p)?.parent;
  }
  return false;
}
