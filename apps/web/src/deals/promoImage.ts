/**
 * Local promo-image generator for combo deals.
 *
 * Everything runs in the owner's browser: the item photos are fetched, optionally cut out with an
 * on-device segmentation model, composed on a canvas with the brand palette and the discount badge,
 * and only the final image is uploaded when the owner saves. No server-side image service exists.
 *
 * Two stages:
 *  1. `composePromo` — deterministic canvas compositor. Always available.
 *  2. `cutoutWithLocalModel` — optional background removal with `@huggingface/transformers`
 *     (`briaai/RMBG-1.4`, quantized ONNX, runs via WASM in the browser, weights cached by the browser
 *     after a one-time ~44 MB download). It is loaded lazily and any failure falls back to stage 1.
 *     Verified 2026-09-14 in Chromium: ~12 s first load, ~20 s per 1200 px photo.
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
  discountPercent: number;
  title: string;
  badgeText: string;
  /** Try the on-device background-removal model. */
  cutout?: boolean;
  onProgress?: (stage: 'loading' | 'cutout' | 'compose', detail?: string) => void;
  dir?: 'rtl' | 'ltr';
}

export interface PromoResult {
  blob: Blob;
  dataUrl: string;
  cutoutUsed: boolean;
  cutoutError?: string;
}

const BG = '#FAF7F0';
const SURFACE = '#FFFEFA';
const GREEN = '#20583B';
const TEXT = '#193E2D';
const ACCENT = '#924220';
const SOFT = '#EDF2E4';

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

/**
 * The model is loaded once per page and reused: the ~44 MB quantized weights come from the Hugging
 * Face CDN on first use and are then held in the browser's cache storage by transformers.js.
 */
let modelPromise: Promise<{ model: (input: { input: unknown }) => Promise<{ output: { mul: (n: number) => { to: (t: string) => unknown } }[] }>; processor: (img: unknown) => Promise<{ pixel_values: unknown }>; RawImage: typeof import('@huggingface/transformers').RawImage }> | null = null;

async function loadLocalModel(onProgress?: PromoOptions['onProgress']) {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { AutoModel, AutoProcessor, RawImage } = await import('@huggingface/transformers');
      // RMBG-1.4 is not a pipeline-supported architecture; it is driven as a "custom" model exactly as
      // documented by transformers.js. The processor config mirrors the model card (1024², mean 0.5).
      const model = await AutoModel.from_pretrained('briaai/RMBG-1.4', {
        config: { model_type: 'custom' },
        dtype: 'q8',
        progress_callback: (p: { status: string; file?: string; progress?: number }) => {
          if (p.status === 'progress' && p.file?.endsWith('.onnx')) onProgress?.('loading', `${Math.round(p.progress ?? 0)}%`);
        },
      } as never);
      const processor = await AutoProcessor.from_pretrained('briaai/RMBG-1.4', {
        config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255, size: { width: 1024, height: 1024 } },
      } as never);
      return { model: model as never, processor: processor as never, RawImage };
    })();
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

/**
 * Optional on-device cutout. Returns a canvas with transparent background, or null when the model
 * cannot be loaded/run (offline, unsupported browser, model host unreachable).
 */
export async function cutoutWithLocalModel(img: HTMLImageElement, onProgress?: PromoOptions['onProgress']): Promise<HTMLCanvasElement | null> {
  try {
    onProgress?.('loading', 'model');
    const { model, processor, RawImage } = await loadLocalModel(onProgress);
    onProgress?.('cutout');
    const raw = await RawImage.fromURL(img.src);
    const { pixel_values } = await processor(raw);
    const { output } = await model({ input: pixel_values });
    const mask = await RawImage.fromTensor(output[0]!.mul(255).to('uint8') as never).resize(raw.width, raw.height);
    const c = document.createElement('canvas');
    c.width = raw.width;
    c.height = raw.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, raw.width, raw.height);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const m = mask.data;
    for (let i = 0, n = c.width * c.height; i < n; i++) id.data[i * 4 + 3] = m[i] ?? 255;
    ctx.putImageData(id, 0, 0);
    return c;
  } catch {
    return null;
  }
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

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number, radius: number, contain: boolean) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  const scale = contain ? Math.min(w / sw, h / sh) * 0.92 : Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Composes the promo image. Layout adapts to 1–4+ photos; items without photos get a labelled tile. */
export async function composePromo(sources: PromoSource[], opts: PromoOptions): Promise<PromoResult> {
  const W = opts.width ?? 1600;
  const H = opts.height ?? 900;
  const rtl = opts.dir === 'rtl';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  // Background: warm cream with a soft green panel.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, SOFT);
  g.addColorStop(1, BG);
  ctx.fillStyle = g;
  roundRect(ctx, 40, 40, W - 80, H - 80, 48);
  ctx.fill();

  opts.onProgress?.('compose');
  let cutoutUsed = false;
  let cutoutError: string | undefined;
  const tiles: Array<{ src: CanvasImageSource | null; sw: number; sh: number; label: string; quantity: number; cut: boolean }> = [];
  for (const s of sources) {
    if (!s.url) { tiles.push({ src: null, sw: 1, sh: 1, label: s.label, quantity: s.quantity, cut: false }); continue; }
    try {
      const img = await loadImage(s.url).catch((e) => (s.fallbackUrl ? loadImage(s.fallbackUrl) : Promise.reject(e)));
      let src: CanvasImageSource = img;
      let cut = false;
      if (opts.cutout) {
        const c = await cutoutWithLocalModel(img, opts.onProgress);
        if (c) { src = c; cut = true; cutoutUsed = true; } else cutoutError = 'model_unavailable';
      }
      tiles.push({ src, sw: img.naturalWidth, sh: img.naturalHeight, label: s.label, quantity: s.quantity, cut });
    } catch {
      tiles.push({ src: null, sw: 1, sh: 1, label: s.label, quantity: s.quantity, cut: false });
    }
  }

  // Photo area occupies the start 62%, text panel the rest.
  const areaW = Math.round(W * 0.62);
  const areaX = rtl ? W - 60 - areaW : 60;
  const areaY = 60;
  const areaH = H - 120;
  const n = Math.max(1, tiles.length);
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 20;
  const tw = (areaW - gap * (cols - 1)) / cols;
  const th = (areaH - gap * (rows - 1)) / rows;
  ctx.font = `600 ${Math.round(th * 0.12)}px "Noto Sans Hebrew", "Noto Sans Arabic", "Noto Sans", sans-serif`;
  tiles.forEach((tile, i) => {
    const cx = areaX + (i % cols) * (tw + gap);
    const cy = areaY + Math.floor(i / cols) * (th + gap);
    ctx.fillStyle = SURFACE;
    roundRect(ctx, cx, cy, tw, th, 28);
    ctx.fill();
    if (tile.src) drawCover(ctx, tile.src, tile.sw, tile.sh, cx, cy, tw, th, 28, tile.cut);
    else {
      ctx.fillStyle = TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tile.label, cx + tw / 2, cy + th / 2, tw - 40);
    }
    // Quantity chip.
    const chip = `×${tile.quantity}`;
    ctx.font = `600 ${Math.round(th * 0.11)}px "Noto Sans", sans-serif`;
    const cw = ctx.measureText(chip).width + 28;
    const chx = rtl ? cx + 16 : cx + tw - cw - 16;
    ctx.fillStyle = GREEN;
    roundRect(ctx, chx, cy + 16, cw, Math.round(th * 0.16), 999);
    ctx.fill();
    ctx.fillStyle = SURFACE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chip, chx + cw / 2, cy + 16 + Math.round(th * 0.08));
  });

  // Text panel.
  const px = rtl ? 60 : areaX + areaW + 40;
  const pw = W - areaW - 160;
  const align = rtl ? 'right' : 'left';
  const tx = rtl ? px + pw : px;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  // Discount badge.
  ctx.font = `600 ${Math.round(H * 0.16)}px "Noto Sans", sans-serif`;
  const badge = `-${opts.discountPercent}%`;
  const bw = ctx.measureText(badge).width + 60;
  const bh = Math.round(H * 0.21);
  const bx = rtl ? tx - bw : tx;
  ctx.fillStyle = ACCENT;
  roundRect(ctx, bx, 100, bw, bh, 32);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, bx + bw / 2, 100 + bh / 2);
  // Title (wrapped).
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT;
  const titleSize = Math.round(H * 0.075);
  ctx.font = `600 ${titleSize}px "Noto Sans Hebrew", "Noto Sans Arabic", "Noto Sans", sans-serif`;
  const words = opts.title.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(cand).width > pw && cur) { lines.push(cur); cur = w; } else cur = cand;
  }
  if (cur) lines.push(cur);
  let ty = 100 + bh + 40;
  for (const ln of lines.slice(0, 3)) { ctx.fillText(ln, tx, ty); ty += titleSize * 1.3; }
  // Badge text (e.g. "Save 15%") in green.
  ctx.fillStyle = GREEN;
  ctx.font = `500 ${Math.round(H * 0.05)}px "Noto Sans Hebrew", "Noto Sans Arabic", "Noto Sans", sans-serif`;
  ctx.fillText(opts.badgeText, tx, ty + 10);

  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode_failed'))), 'image/jpeg', 0.86));
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.8), cutoutUsed, cutoutError };
}
