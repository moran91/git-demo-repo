/**
 * Square photo edits for the product editor: crop (pan + zoom), quarter turns, straightening and light
 * (brightness, warmth, saturation). The preview applies the same numbers with CSS transforms/filters;
 * `renderEdit` produces the final 1200 px square with canvas, so what the owner saw is what is saved.
 */
export interface PhotoEdit {
  /** 1 = the photo just covers the square frame (after rotation); up to MAX_ZOOM. */
  zoom: number;
  /** Pan, as a fraction of the frame size, applied before rotation is undone (screen space). */
  x: number;
  y: number;
  /** Quarter turns clockwise, 0–3. */
  turns: number;
  /** Straightening, degrees, -15..15. */
  angle: number;
  /** -1..1 each; 0 = unchanged. */
  brightness: number;
  warmth: number;
  saturation: number;
}

export const MAX_ZOOM = 4;
export const MAX_ANGLE = 15;
export const OUT_SIZE = 1200;
export const NO_EDIT: PhotoEdit = { zoom: 1, x: 0, y: 0, turns: 0, angle: 0, brightness: 0, warmth: 0, saturation: 0 };

export const isUnchanged = (e: PhotoEdit) =>
  e.zoom === 1 && e.x === 0 && e.y === 0 && e.turns === 0 && e.angle === 0 && e.brightness === 0 && e.warmth === 0 && e.saturation === 0;

/**
 * Scale (in frame units per image pixel) at which the rotated photo exactly covers the square frame.
 * For a frame F and an image w×h turned by θ, every frame corner must stay inside the image.
 */
export function coverScale(w: number, h: number, turns: number, angle: number) {
  const [iw, ih] = turns % 2 ? [h, w] : [w, h];
  const t = (Math.abs(angle) * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  // Frame square of side 1 rotated by θ has half-extents (c+s)/2 on both axes of the image.
  return Math.max((c + s) / iw, (c + s) / ih);
}

/**
 * Keeps the pan inside the range where the photo still covers the frame, exactly: the pan is moved
 * into the photo's own (rotated) axes, clamped there to a box, and rotated back. The frame is the
 * unit square; its corners reach `ext` along each photo axis.
 */
export function clampPan(e: PhotoEdit, w: number, h: number): PhotoEdit {
  const th = ((e.turns * 90 + e.angle) * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const scale = coverScale(w, h, e.turns, e.angle) * e.zoom;
  const ext = 0.5 * (Math.abs(c) + Math.abs(s));
  const mu = Math.max(0, (w * scale) / 2 - ext);
  const mv = Math.max(0, (h * scale) / 2 - ext);
  // Screen → photo axes (inverse of CSS rotate(θ), y pointing down), clamp, and back.
  const qu = Math.min(mu, Math.max(-mu, c * e.x + s * e.y));
  const qv = Math.min(mv, Math.max(-mv, -s * e.x + c * e.y));
  return { ...e, x: c * qu - s * qv, y: s * qu + c * qv };
}

/** CSS filter for the preview; warmth is applied separately (see `warmthTint`). */
export function cssFilter(e: PhotoEdit) {
  return `brightness(${(1 + e.brightness * 0.5).toFixed(3)}) saturate(${(1 + e.saturation * 0.8).toFixed(3)})`;
}

/** Warmth as a soft-light colour layer: amber when positive, cool blue when negative. */
export function warmthTint(e: PhotoEdit): { color: string; opacity: number } {
  return { color: e.warmth >= 0 ? '#ff9a3c' : '#4c8dff', opacity: Math.min(0.45, Math.abs(e.warmth) * 0.45) };
}

/** The transform the preview <img> uses inside a frame of `frame` CSS pixels. */
export function cssTransform(e: PhotoEdit, w: number, h: number, frame: number) {
  const s = coverScale(w, h, e.turns, e.angle) * e.zoom * frame;
  return `translate(-50%, -50%) translate(${e.x * frame}px, ${e.y * frame}px) rotate(${e.turns * 90 + e.angle}deg) scale(${s})`;
}

/** Final square, OUT_SIZE px, rendered exactly like the preview. */
export async function renderEdit(source: Blob, e: PhotoEdit): Promise<Blob> {
  const bmp = await createImageBitmap(source);
  try {
    const F = OUT_SIZE;
    const c = document.createElement('canvas');
    c.width = c.height = F;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#F5EBE0';
    ctx.fillRect(0, 0, F, F);
    const s = coverScale(bmp.width, bmp.height, e.turns, e.angle) * e.zoom * F;
    ctx.save();
    ctx.translate(F / 2 + e.x * F, F / 2 + e.y * F);
    ctx.rotate(((e.turns * 90 + e.angle) * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    ctx.restore();
    if (e.brightness !== 0 || e.saturation !== 0) applyLight(ctx, F, e);
    if (e.warmth !== 0) {
      const tint = warmthTint(e);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = tint.opacity;
      ctx.fillStyle = tint.color;
      ctx.fillRect(0, 0, F, F);
    }
    const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9));
    const out = webp && webp.type === 'image/webp' ? webp : await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    if (!out) throw new Error('could not encode the photo');
    return out;
  } finally {
    bmp.close();
  }
}

/**
 * brightness() then saturate(), with the exact matrices CSS uses, so the saved file matches the
 * preview. Done per pixel because `ctx.filter` is ignored by older Safari.
 */
function applyLight(ctx: CanvasRenderingContext2D, size: number, e: PhotoEdit) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const k = 1 + e.brightness * 0.5;
  const s = 1 + e.saturation * 0.8;
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ] as const;
  for (let i = 0; i < d.length; i += 4) {
    const r = Math.min(255, d[i]! * k), g = Math.min(255, d[i + 1]! * k), b = Math.min(255, d[i + 2]! * k);
    d[i] = m[0] * r + m[1] * g + m[2] * b;
    d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * One-tap light: brightness towards a well-exposed mean, a little more saturation for flat photos,
 * warmth against a cold cast. Measured on a small copy of the photo.
 */
export async function autoLight(source: Blob): Promise<Pick<PhotoEdit, 'brightness' | 'warmth' | 'saturation'>> {
  const bmp = await createImageBitmap(source, { resizeWidth: 96, resizeQuality: 'low' });
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, sat = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i]! / 255, G = d[i + 1]! / 255, B = d[i + 2]! / 255;
      r += R; g += G; b += B;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      sat += mx === 0 ? 0 : (mx - mn) / mx;
    }
    r /= n; g /= n; b /= n; sat /= n;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const round = (v: number) => Math.round(v * 20) / 20;
    return {
      brightness: round(Math.min(0.6, Math.max(-0.4, (0.55 - lum) * 1.6))),
      saturation: round(Math.min(0.4, Math.max(0, (0.35 - sat) * 1.2))),
      warmth: round(Math.min(0.4, Math.max(-0.2, (b - r) * 2.5 + 0.1))),
    };
  } finally {
    bmp.close();
  }
}
