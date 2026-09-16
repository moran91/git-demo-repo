/**
 * Local promo-image generator for combos.
 *
 * Everything runs in the owner's browser: the item photos are fetched and composed on a canvas with
 * the brand palette, the combo price sticker and the title; only the final image is uploaded when
 * the owner saves. No server-side image service exists and no model is downloaded.
 */
export interface PromoSource {
  /** Object URL / https URL of the item photo, or undefined when the item has no photo. */
  url?: string;
  /** Loaded when `url` fails (the original upload while the resized variant does not exist yet). */
  fallbackUrl?: string;
  label: string;
  quantity: number;
}

export interface PromoOptions {
  width?: number;
  height?: number;
  title: string;
  /** Text of the round sticker at the start corner (the combo price). */
  stickerText: string;
  /** Text of the pill above the title (the "Combo" label). */
  badgeText: string;
  onProgress?: (stage: 'compose') => void;
  dir?: 'rtl' | 'ltr';
}

export interface PromoResult {
  blob: Blob;
  dataUrl: string;
}

const SURFACE = '#FFFEFA';
const GREEN = '#20583B';
const DEEP = '#143324';
const ACCENT = '#B5522A';
const SOFT = '#EDF2E4';
const FONT = '"Noto Sans Hebrew", "Noto Sans Arabic", "Noto Sans", sans-serif';
/** Most photos that fit on a 16:9 card and still read at thumbnail size. */
const MAX_TILES = 8;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('image_load_failed'));
    img.src = url;
  });
  return img;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  // arcTo with a radius larger than half the box paints outside it; clamp so "pill" radii are safe.
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Rect = { x: number; y: number; w: number; h: number };
type Tile = { src: CanvasImageSource | null; sw: number; sh: number; label: string; quantity: number };

/**
 * Full-bleed mosaic: 1 photo fills the frame, 2 split it, 3 is one tall photo beside two stacked,
 * 4+ is two rows with the extra tile on top. Photos are cropped to the cells, never letter-boxed.
 */
function mosaic(n: number, W: number, H: number, gap: number): Rect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) { const w = (W - gap) / 2; return [{ x: 0, y: 0, w, h: H }, { x: w + gap, y: 0, w, h: H }]; }
  if (n === 3) {
    const w0 = Math.round(W * 0.58);
    const w1 = W - w0 - gap;
    const h = (H - gap) / 2;
    return [{ x: 0, y: 0, w: w0, h: H }, { x: w0 + gap, y: 0, w: w1, h }, { x: w0 + gap, y: h + gap, w: w1, h }];
  }
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  const h = (H - gap) / 2;
  const row = (count: number, y: number) => { const w = (W - gap * (count - 1)) / count; return Array.from({ length: count }, (_, i) => ({ x: i * (w + gap), y, w, h })); };
  return [...row(top, 0), ...row(bottom, h + gap)];
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, r: Rect) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const scale = Math.max(r.w / sw, r.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(src, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Ellipsis-truncates `text` to `maxW` in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Greedy word wrap to at most `maxLines` lines; the last line is ellipsised when text remains. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const cand = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(cand).width <= maxW || !cur) { cur = cand; continue; }
    lines.push(cur);
    cur = w;
    if (lines.length === maxLines - 1) { lines.push(fit(ctx, [cur, ...words.slice(i + 1)].join(' '), maxW)); return lines; }
  }
  if (cur) lines.push(fit(ctx, cur, maxW));
  return lines;
}

/** Rounded sticker with the combo price, tilted like a price tag, with a soft shadow and an inner ring. */
function drawSticker(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number, text: string, rtl: boolean) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((rtl ? 8 : -8) * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = d * 0.18;
  ctx.shadowOffsetY = d * 0.06;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(0, 0, d / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = Math.max(2, d * 0.018);
  ctx.setLineDash([d * 0.05, d * 0.035]);
  ctx.beginPath();
  ctx.arc(0, 0, d / 2 - d * 0.075, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';
  let size = Math.round(d * 0.36);
  ctx.font = `600 ${size}px "Noto Sans", sans-serif`;
  while (ctx.measureText(text).width > d * 0.78 && size > 12) { size -= 2; ctx.font = `600 ${size}px "Noto Sans", sans-serif`; }
  ctx.fillText(text, 0, d * 0.02);
  ctx.restore();
}

function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, fill: string, color: string, rtl: boolean): number {
  ctx.font = `600 ${size}px ${FONT}`;
  const padX = size * 0.7;
  const w = ctx.measureText(text).width + padX * 2;
  const h = size * 1.7;
  const px = rtl ? x - w : x;
  ctx.fillStyle = fill;
  roundRect(ctx, px, y, w, h, 999);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + w / 2, y + h / 2);
  return w;
}

/**
 * Makes sure the brand web fonts are usable on the canvas before any text is measured. Canvas text
 * does not trigger font loading, so a weight the page has not shown yet would silently fall back.
 */
async function ensureFonts(sample: string) {
  try {
    await Promise.all([`600 40px "Noto Sans Hebrew"`, `600 40px "Noto Sans Arabic"`, `600 40px "Noto Sans"`, `500 40px "Noto Sans"`].map((f) => document.fonts.load(f, sample)));
  } catch { /* fall back to whatever the browser has */ }
}

/**
 * Composes the promo image (16:9): the item photos fill the whole frame as a mosaic untouched
 * (no colour wash), with a short neutral scrim plus text shadows so the white title and the item
 * list read on any picture, and the tilted price sticker at the start corner.
 */
export async function composePromo(sources: PromoSource[], opts: PromoOptions): Promise<PromoResult> {
  const W = opts.width ?? 1600;
  const H = opts.height ?? 900;
  const rtl = opts.dir === 'rtl';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  await ensureFonts(`${opts.title} ${opts.badgeText} ${opts.stickerText} ${sources.map((s) => s.label).join(' ')}`);
  ctx.imageSmoothingQuality = 'high';

  opts.onProgress?.('compose');
  const tiles: Tile[] = [];
  for (const s of sources.slice(0, MAX_TILES)) {
    if (!s.url) { tiles.push({ src: null, sw: 1, sh: 1, label: s.label, quantity: s.quantity }); continue; }
    try {
      const img = await loadImage(s.url).catch((e) => (s.fallbackUrl ? loadImage(s.fallbackUrl) : Promise.reject(e)));
      tiles.push({ src: img, sw: img.naturalWidth, sh: img.naturalHeight, label: s.label, quantity: s.quantity });
    } catch {
      tiles.push({ src: null, sw: 1, sh: 1, label: s.label, quantity: s.quantity });
    }
  }
  if (tiles.length === 0) tiles.push({ src: null, sw: 1, sh: 1, label: opts.title, quantity: 1 });
  const pad = Math.round(W * 0.04);
  const chipSize = Math.round(H * 0.034);
  ctx.direction = rtl ? 'rtl' : 'ltr';

  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, W, H);

  const chips: Array<{ x: number; y: number; text: string }> = [];
  const rects = mosaic(tiles.length, W, H, 6);
  tiles.forEach((tile, i) => {
    const r = rects[i]!;
    if (tile.src) drawCover(ctx, tile.src, tile.sw, tile.sh, r);
    else {
      ctx.fillStyle = SOFT;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = GREEN;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(Math.min(r.h * 0.11, r.w * 0.08))}px ${FONT}`;
      ctx.fillText(fit(ctx, tile.label, r.w * 0.8), r.x + r.w / 2, r.y + r.h / 2);
    }
    if (tile.quantity > 1) chips.push({ x: rtl ? r.x + 18 : r.x + r.w - 18, y: r.y + 18, text: `×${tile.quantity}` });
  });
  // A short, neutral scrim under the text block only (never a coloured band): the photos keep
  // their own colours and the white text still reads on a bright picture.
  const scrimTop = H * 0.62;
  const g = ctx.createLinearGradient(0, scrimTop, 0, H);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(0.5, 'rgba(0, 0, 0, 0.22)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, scrimTop, W, H - scrimTop);

  // Quantity chips (only where more than one of an item is included), on the corner opposite the
  // sticker: `ch.x` is the chip's left edge in RTL layouts and its right edge in LTR ones.
  for (const ch of chips) {
    ctx.direction = 'ltr';
    drawPill(ctx, ch.x, ch.y, ch.text, chipSize, 'rgba(255, 254, 250, 0.94)', DEEP, !rtl);
  }
  ctx.direction = rtl ? 'rtl' : 'ltr';

  // Price sticker at the top start corner.
  const d = Math.round(H * 0.24);
  drawSticker(ctx, rtl ? W - pad - d / 2 : pad + d / 2, pad + d / 2, d, opts.stickerText, rtl);
  ctx.direction = rtl ? 'rtl' : 'ltr';

  // Bottom text block: badge pill, title, item list — laid out upward from the bottom edge.
  const tx = rtl ? W - pad : pad;
  const maxW = W - pad * 2;
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.textBaseline = 'alphabetic';
  let y = H - pad;
  const itemsSize = Math.round(H * 0.038);
  ctx.font = `500 ${itemsSize}px ${FONT}`;
  const items = tiles.map((tl) => (tl.quantity > 1 ? `${tl.quantity}× ${tl.label}` : tl.label)).filter((s) => s.trim()).join('  ·  ');
  if (items) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillText(fit(ctx, items, maxW), tx, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    y -= itemsSize * 1.5;
  }
  const titleSize = Math.round(H * 0.085);
  ctx.font = `600 ${titleSize}px ${FONT}`;
  const lines = wrap(ctx, opts.title, maxW, 2);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 3;
  for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i]!, tx, y); y -= titleSize * 1.18; }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const pillSize = Math.round(H * 0.04);
  drawPill(ctx, tx, y - pillSize * 1.7 + titleSize * 0.18, opts.badgeText, pillSize, ACCENT, '#fff', rtl);

  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode_failed'))), 'image/jpeg', 0.88));
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.8) };
}
