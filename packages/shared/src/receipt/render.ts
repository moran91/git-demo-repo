import type { ReceiptBlock, ReceiptDir, ReceiptModel, ReceiptTextSize } from './model.js';

/**
 * Canvas abstraction so the same layout code runs in browsers (HTMLCanvasElement/OffscreenCanvas)
 * and Node tests (@napi-rs/canvas). Only the subset of the 2D API we use is declared.
 */
export interface Ctx2DLike {
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
  textAlign: 'start' | 'end' | 'left' | 'right' | 'center';
  direction?: 'ltr' | 'rtl' | 'inherit';
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  setLineDash?(segments: number[]): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number>; width: number; height: number };
}
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2DLike | null;
}
export type CanvasFactory = (width: number, height: number) => CanvasLike;

export interface MonoBitmap {
  width: number;
  height: number;
  /** One byte per pixel: 1 = black, 0 = white. Row-major. */
  pixels: Uint8Array;
}

export interface RenderOptions {
  /** Font family stack containing Hebrew, Arabic and Latin faces. */
  fontFamily?: string;
  /** Scale factor: 1 for ~203dpi printers. */
  scale?: number;
  /** Maximum strip height in rows for chunked ESC/POS transmission. */
  maxStripHeight?: number;
}

const SIZE_PX: Record<ReceiptTextSize, number> = { sm: 20, md: 24, lg: 30, xl: 40 };
const LINE_HEIGHT = 1.35;
const PADDING_X = 8;

function fontFor(size: ReceiptTextSize, bold: boolean | undefined, family: string, scale: number): string {
  return `${bold ? '600' : '400'} ${Math.round(SIZE_PX[size] * scale)}px ${family}`;
}

/** Word-wraps text to a maximum pixel width using the context's current font. */
export function wrapText(ctx: Ctx2DLike, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        // Break very long words by characters.
        if (ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of Array.from(word)) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

interface Placed {
  draw: (ctx: Ctx2DLike) => void;
  height: number;
}

/** First-strong-character direction detection (Hebrew, Arabic, Syriac, Thaana ranges → rtl). */
export function detectDir(text: string, fallback: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) return 'rtl';
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x00c0 && c <= 0x024f)) return 'ltr';
  }
  return fallback;
}

function baseDir(text: string, dir: ReceiptDir | undefined, fallback: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  if (dir === 'ltr' || dir === 'rtl') return dir;
  return detectDir(text, fallback);
}

/**
 * Lays out the receipt model into a monochrome bitmap. Text is shaped by the canvas engine
 * (browser or Skia), which handles Arabic joining and bidi — no raw Unicode is sent to printers.
 */
export function renderReceipt(model: ReceiptModel, createCanvas: CanvasFactory, opts: RenderOptions = {}): MonoBitmap {
  const scale = opts.scale ?? 1;
  const family = opts.fontFamily ?? '"Noto Sans Hebrew", "Noto Sans Arabic", "Noto Sans", sans-serif';
  const width = model.printableDots;
  const contentWidth = width - PADDING_X * 2;
  const rtl = model.dir === 'rtl';

  // Pass 1: measure with a scratch canvas.
  const scratch = createCanvas(width, 64);
  const mctx = scratch.getContext('2d');
  if (!mctx) throw new Error('canvas 2d context unavailable');
  const placed: Placed[] = [];
  let y = 8;

  const textLines = (ctx: Ctx2DLike, text: string, size: ReceiptTextSize, bold: boolean | undefined, maxW: number) => {
    ctx.font = fontFor(size, bold, family, scale);
    return wrapText(ctx, text, maxW);
  };

  const drawTextBlock = (b: Extract<ReceiptBlock, { kind: 'text' }>) => {
    const size = b.size ?? 'md';
    const lines = textLines(mctx, b.text, size, b.bold, contentWidth);
    const lh = Math.round(SIZE_PX[size] * scale * LINE_HEIGHT);
    const align = b.align ?? 'start';
    const dir = b.dir ?? (rtl ? 'rtl' : 'ltr');
    const top = y;
    placed.push({
      height: lh * lines.length,
      draw: (ctx) => {
        ctx.font = fontFor(size, b.bold, family, scale);
        ctx.textBaseline = 'top';
        lines.forEach((ln, i) => {
          if (ctx.direction !== undefined) ctx.direction = baseDir(ln, dir, rtl ? 'rtl' : 'ltr');
          const txt = ln;
          let x: number;
          if (align === 'center') {
            ctx.textAlign = 'center';
            x = width / 2;
          } else if ((align === 'start') !== rtl) {
            ctx.textAlign = 'left';
            x = PADDING_X;
          } else {
            ctx.textAlign = 'right';
            x = width - PADDING_X;
          }
          ctx.fillText(txt, x, top + i * lh + Math.round(lh * 0.12));
        });
      },
    });
    y += lh * lines.length;
  };

  for (const b of model.blocks) {
    switch (b.kind) {
      case 'text':
        drawTextBlock(b);
        break;
      case 'spacer':
        y += Math.round((b.px ?? 8) * scale);
        placed.push({ height: 0, draw: () => undefined });
        break;
      case 'rule': {
        const top = y;
        placed.push({
          height: 0,
          draw: (ctx) => {
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            if (ctx.setLineDash) ctx.setLineDash(b.style === 'dashed' ? [6, 4] : []);
            ctx.beginPath();
            ctx.moveTo(PADDING_X, top + 6);
            ctx.lineTo(width - PADDING_X, top + 6);
            ctx.stroke();
            if (ctx.setLineDash) ctx.setLineDash([]);
          },
        });
        y += 14;
        break;
      }
      case 'row': {
        const size = b.size ?? 'md';
        mctx.font = fontFor(size, b.bold, family, scale);
        const endW = b.end ? mctx.measureText(b.end).width : 0;
        const gap = 12;
        const startMax = Math.max(60, contentWidth - endW - gap);
        const lines = wrapText(mctx, b.start, startMax);
        const lh = Math.round(SIZE_PX[size] * scale * LINE_HEIGHT);
        const top = y;
        placed.push({
          height: lh * lines.length,
          draw: (ctx) => {
            ctx.font = fontFor(size, b.bold, family, scale);
            ctx.textBaseline = 'top';
            lines.forEach((ln, i) => {
              if (ctx.direction !== undefined) ctx.direction = baseDir(ln, undefined, rtl ? 'rtl' : 'ltr');
              ctx.textAlign = rtl ? 'right' : 'left';
              ctx.fillText(ln, rtl ? width - PADDING_X : PADDING_X, top + i * lh + Math.round(lh * 0.12));
            });
            if (b.end) {
              if (ctx.direction !== undefined) ctx.direction = baseDir(b.end, b.endDir ?? 'ltr', 'ltr');
              ctx.textAlign = rtl ? 'left' : 'right';
              ctx.fillText(b.end, rtl ? PADDING_X : width - PADDING_X, top + Math.round(lh * 0.12));
            }
          },
        });
        y += lh * lines.length;
        break;
      }
      case 'box': {
        const size = b.size ?? 'md';
        const inner = contentWidth - 20;
        const titleLines = b.title ? textLines(mctx, b.title, 'sm', true, inner) : [];
        const bodyLines = b.lines.flatMap((l) => textLines(mctx, l, size, b.bold, inner));
        const lhT = Math.round(SIZE_PX.sm * scale * LINE_HEIGHT);
        const lhB = Math.round(SIZE_PX[size] * scale * LINE_HEIGHT);
        const h = 10 + titleLines.length * lhT + bodyLines.length * lhB + 10;
        const top = y;
        placed.push({
          height: h,
          draw: (ctx) => {
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            if (ctx.setLineDash) ctx.setLineDash([]);
            ctx.strokeRect(PADDING_X + 1, top + 1, contentWidth - 2, h - 2);
            ctx.textBaseline = 'top';
            let yy = top + 8;
            ctx.font = fontFor('sm', true, family, scale);
            const place = (ln: string) => {
              const d = baseDir(ln, undefined, rtl ? 'rtl' : 'ltr');
              if (ctx.direction !== undefined) ctx.direction = d;
              ctx.textAlign = d === 'rtl' ? 'right' : 'left';
              return d === 'rtl' ? width - PADDING_X - 10 : PADDING_X + 10;
            };
            for (const ln of titleLines) {
              ctx.fillText(ln, place(ln), yy + Math.round(lhT * 0.12));
              yy += lhT;
            }
            ctx.font = fontFor(size, b.bold, family, scale);
            for (const ln of bodyLines) {
              ctx.fillText(ln, place(ln), yy + Math.round(lhB * 0.12));
              yy += lhB;
            }
          },
        });
        y += h + 6;
        break;
      }
    }
  }
  const height = Math.max(8, y + 16);

  // Pass 2: draw.
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  for (const p of placed) p.draw(ctx);

  // Threshold to 1-bit.
  const img = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = img.data[i * 4] ?? 255;
    const g = img.data[i * 4 + 1] ?? 255;
    const bl = img.data[i * 4 + 2] ?? 255;
    const a = img.data[i * 4 + 3] ?? 255;
    const lum = (r * 299 + g * 587 + bl * 114) / 1000;
    pixels[i] = a > 127 && lum < 160 ? 1 : 0;
  }
  return { width, height, pixels };
}

/** Splits a tall bitmap into bounded strips so long receipts are transmitted in chunks. */
export function splitStrips(bitmap: MonoBitmap, maxRows = 256): MonoBitmap[] {
  const out: MonoBitmap[] = [];
  for (let y0 = 0; y0 < bitmap.height; y0 += maxRows) {
    const h = Math.min(maxRows, bitmap.height - y0);
    out.push({ width: bitmap.width, height: h, pixels: bitmap.pixels.subarray(y0 * bitmap.width, (y0 + h) * bitmap.width) });
  }
  return out;
}

/** Packs a mono bitmap to 1 bit per pixel, MSB first, rows padded to whole bytes. */
export function packBits(bitmap: MonoBitmap): { bytesPerRow: number; data: Uint8Array } {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const data = new Uint8Array(bytesPerRow * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.pixels[y * bitmap.width + x]) {
        data[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return { bytesPerRow, data };
}

/** Renders a bitmap to a PBM (P4) buffer for simulator artefacts / snapshot tests. */
export function toPBM(bitmap: MonoBitmap): Uint8Array {
  const header = new TextEncoder().encode(`P4\n${bitmap.width} ${bitmap.height}\n`);
  const packed = packBits(bitmap).data;
  const out = new Uint8Array(header.length + packed.length);
  out.set(header, 0);
  out.set(packed, header.length);
  return out;
}
