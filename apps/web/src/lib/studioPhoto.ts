/**
 * On-device "studio background" for a product photo, Morano style. Everything runs in the browser:
 * the segmentation model and the ONNX runtime are served by Qareeb itself (public/models, public/ort;
 * see scripts/fetch-models.mjs), so the photo never leaves the device.
 *
 * Recolour, don't cut: the mask is used softly. The backdrop becomes the Morano cream but keeps the
 * photo's own shading in a band around the dish (the real contact shadow), with its texture blurred
 * away; further out it is clean cream. The dish is only colour-graded, never cut out, so there are no
 * holes and no pasted edges. On a dark backdrop, whose shading means nothing, a soft shadow is drawn.
 */
import { easeProgress, hasUsableGpu, nextFrame, transformers } from './onDeviceAi';

export type StudioStage = 'download' | 'prepare' | 'detect' | 'paint' | 'done';
export interface StudioProgress { pct: number; stage: StudioStage }
/** `before` is the untouched photo in the same square framing as `blob`, for a pixel-aligned compare. */
export interface StudioResult { blob: Blob; before: Blob; ms: number; device: string }
type OnProgress = (p: StudioProgress) => void;

const OUT = 1200;
const CREAM: [number, number, number] = [245, 235, 224];
const MODELS = {
  // BiRefNet-lite is the better cut-out but needs a GPU; on the CPU it runs out of memory.
  birefnet: { id: 'onnx-community/BiRefNet_lite-ONNX', dtype: 'fp16' as const, device: 'webgpu' as const, seconds: 3 },
  ormbg: { id: 'onnx-community/ormbg-ONNX', dtype: 'q8' as const, device: 'wasm' as const, seconds: 12 },
};

type CutOut = { data: Uint8ClampedArray; width: number; height: number; channels: number };
type Segmenter = (input: unknown) => Promise<CutOut | CutOut[]>;
interface Loaded { run: Segmenter; model: keyof typeof MODELS }

let loading: Promise<Loaded> | null = null;
const downloadListeners = new Set<(fraction: number) => void>();

/** The GPU model when the device can run it; any failure there falls back to the CPU model, which runs everywhere. */
function loadSegmenter(): Promise<Loaded> {
  loading ??= (async () => {
    if (await hasUsableGpu()) {
      try {
        return await createSegmenter('birefnet');
      } catch (e) {
        console.warn('studio background: GPU model unavailable, using the CPU model', e);
      }
    }
    try {
      return await createSegmenter('ormbg');
    } catch (e) {
      // One retry: a dropped connection mid-download should not cost the owner the feature.
      console.warn('studio background: CPU model load failed, retrying once', e);
      return createSegmenter('ormbg');
    }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** After the GPU model failed mid-run (driver loss, out of memory): switch to the CPU model for good. */
function fallBackToCpu(): Promise<Loaded> {
  loading = createSegmenter('ormbg');
  loading.catch(() => { loading = null; });
  return loading;
}

async function createSegmenter(model: keyof typeof MODELS): Promise<Loaded> {
  const t = await transformers();
  const files = new Map<string, { loaded: number; total: number }>();
  const { id, dtype, device } = MODELS[model];
  const run = (await t.pipeline('background-removal', id, {
    dtype,
    device,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      for (const l of downloadListeners) l(total ? loaded / total : 0);
    },
  })) as unknown as Segmenter;
  return { run, model };
}

/** Start downloading and compiling the model before the owner asks for a studio version. */
export function warmUpStudioPhoto() {
  void loadSegmenter().catch(() => undefined);
}


/** Throws with a short reason when no studio version can be made. */
export async function makeStudioPhoto(file: Blob, onProgress: OnProgress = () => undefined): Promise<StudioResult> {
  const started = performance.now();
  let pct = 0;
  const report = (stage: StudioStage, value: number) => { pct = Math.max(pct, Math.min(100, value)); onProgress({ pct: Math.round(pct), stage }); };

  // 0–55: model download (first use only), 55–60: compile.
  const onDownload = (f: number) => report('download', 55 * f);
  downloadListeners.add(onDownload);
  report('prepare', 2);
  let loaded: Loaded;
  try {
    loaded = await loadSegmenter();
  } finally {
    downloadListeners.delete(onDownload);
  }
  report('prepare', 60);

  // 60–88: the model run reports nothing, so ease towards 88% over its typical duration.
  const t = await transformers();
  const raw = await t.RawImage.fromBlob(await downscale(file, 1280));
  const stopEase = easeProgress(60, 88, MODELS[loaded.model].seconds * 1000, (v) => report('detect', v));
  let cut: CutOut | undefined;
  try {
    let res: CutOut | CutOut[];
    try {
      res = await loaded.run(raw);
    } catch (e) {
      if (loaded.model === 'ormbg') throw e;
      console.warn('studio background: GPU run failed, retrying on the CPU', e);
      loaded = await fallBackToCpu();
      res = await loaded.run(raw);
    }
    cut = Array.isArray(res) ? res[0] : res;
  } finally {
    stopEase();
  }
  if (!cut || cut.channels !== 4) throw new Error(`segmentation returned ${cut ? `${cut.channels} channels` : 'nothing'}`);
  report('paint', 88);
  await nextFrame();

  const painted = await paintStudio(cut, (f) => report('paint', 88 + 11 * f));
  if (!painted) throw new Error('no dish found in the photo');
  const [blob, before] = await Promise.all([encode(painted.canvas, 0.9), encode(painted.before, 0.8)]);
  if (!blob || !before) throw new Error('could not encode the result');
  report('done', 100);
  return { blob, before, ms: Math.round(performance.now() - started), device: `${loaded.model} on ${MODELS[loaded.model].device}` };
}

/** Long edge capped (phone memory); the model works at 1024 px and the output is 1200 px square. */
async function downscale(file: Blob, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (k === 1) return file;
    const c = layer(Math.round(bitmap.width * k), Math.round(bitmap.height * k));
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    return (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.95))) ?? file;
  } finally {
    bitmap.close();
  }
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
  // Safari cannot encode WebP; it returns PNG or null, so fall back to JPEG.
  return webp && webp.type === 'image/webp' ? webp : new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
}

// ---------------------------------------------------------------------------------------------
// Painting

/** Separable box blur (3 passes ≈ gaussian) on a single-channel float image, in place. */
function blur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length);
  const d = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / d;
        acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        src[y * w + x] = acc / d;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
      }
    }
  }
}

const smoothstep = (a: number, b: number, v: number) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

async function paintStudio(cut: CutOut, step: (fraction: number) => void): Promise<{ canvas: HTMLCanvasElement; before: HTMLCanvasElement } | null> {
  const W = cut.width, H = cut.height, N = W * H, px = cut.data;
  const big = Math.max(W, H);

  // Soft mask; anything the subject encloses (a dark bowl's inside, a tray's middle) stays subject.
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) m[i] = smoothstep(0.1, 0.9, px[i * 4 + 3]! / 255);
  const outside = new Uint8Array(N);
  const stack: number[] = [];
  const seed = (i: number) => { if (!outside[i] && m[i]! < 0.5) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i - x) / W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (y > 0) seed(i - W);
    if (y < H - 1) seed(i + W);
  }
  let subject = 0;
  for (let i = 0; i < N; i++) {
    if (!outside[i] && m[i]! < 0.5) m[i] = 1;
    if (m[i]! > 0.5) subject++;
  }
  if (subject / N < 0.02) return null;
  step(0.15);
  await nextFrame();

  // Background shading and colour, estimated from background pixels only (normalised convolution).
  const bgw = new Float32Array(N), lum = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const w = (1 - m[i]!) ** 2;
    const r = px[i * 4]! / 255, g = px[i * 4 + 1]! / 255, b = px[i * 4 + 2]! / 255;
    bgw[i] = w;
    lum[i] = w * (0.299 * r + 0.587 * g + 0.114 * b);
    cr[i] = w * r; cg[i] = w * g; cb[i] = w * b;
  }
  const wS = bgw.slice(), wC = bgw.slice();
  const rShade = Math.max(4, Math.round(big * 0.012)); // keeps the contact shadow, drops texture
  const rColor = Math.max(8, Math.round(big * 0.04));
  blur(lum, W, H, rShade); blur(wS, W, H, rShade);
  step(0.35);
  await nextFrame();
  blur(cr, W, H, rColor); blur(cg, W, H, rColor); blur(cb, W, H, rColor); blur(wC, W, H, rColor);
  step(0.55);
  await nextFrame();

  const shade = new Float32Array(N);
  const bgVals: number[] = [];
  for (let i = 0; i < N; i++) {
    shade[i] = wS[i]! > 1e-4 ? lum[i]! / wS[i]! : 0;
    if (m[i]! < 0.05 && i % 7 === 0) bgVals.push(shade[i]!);
  }
  bgVals.sort((a, b) => a - b);
  const bgRef = bgVals.length ? bgVals[Math.floor(bgVals.length * 0.75)]! : 1;
  const bgMedian = bgVals.length ? bgVals[Math.floor(bgVals.length * 0.5)]! : 1;
  const near = m.slice();
  blur(near, W, H, Math.max(6, Math.round(big * 0.035)));
  let drop: Float32Array | null = null;
  if (bgMedian < 0.3) {
    drop = new Float32Array(N);
    const shift = Math.round(H * 0.02);
    for (let y = shift; y < H; y++) for (let x = 0; x < W; x++) drop[y * W + x] = m[(y - shift) * W + x]!;
    blur(drop, W, H, Math.max(6, Math.round(big * 0.025)));
  }
  step(0.7);
  await nextFrame();

  // Grade the dish gently towards the Morano brightness and warmth.
  let fl = 0, fn = 0;
  for (let i = 0; i < N; i += 3) if (m[i]! > 0.8) { fl += 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!; fn++; }
  const gain = Math.min(1.25, Math.max(0.9, 0.52 / Math.max(0.05, fn ? fl / fn / 255 : 0.5)));
  const curve = (v: number) => { v = Math.min(1, Math.max(0, v)); return v + 0.48 * v * (1 - v) * (v - 0.5); };
  const img = new ImageData(W, H);
  const o = img.data;
  for (let i = 0; i < N; i++) {
    const a = m[i]!;
    let r = px[i * 4]! / 255, g = px[i * 4 + 1]! / 255, b = px[i * 4 + 2]! / 255;
    if (a > 0.02 && a < 0.98 && wC[i]! > 1e-4) {
      // Remove the old backdrop colour that bled into the soft edge.
      r = Math.min(1, Math.max(0, (r - (1 - a) * (cr[i]! / wC[i]!)) / a));
      g = Math.min(1, Math.max(0, (g - (1 - a) * (cg[i]! / wC[i]!)) / a));
      b = Math.min(1, Math.max(0, (b - (1 - a) * (cb[i]! / wC[i]!)) / a));
    }
    r *= gain * 1.03; g *= gain; b *= gain * 0.96;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = curve(l + (r - l) * 1.1); g = curve(l + (g - l) * 1.1); b = curve(l + (b - l) * 1.1);
    let k: number;
    if (drop) k = 1 - 0.32 * Math.min(1, drop[i]! * 1.4);
    else k = 1 - Math.min(1, near[i]! * 2.5) * (1 - Math.min(1, Math.max(0.72, bgRef > 0 ? shade[i]! / bgRef : 1)));
    o[i * 4] = Math.round(255 * (a * r + (1 - a) * (CREAM[0] / 255) * k));
    o[i * 4 + 1] = Math.round(255 * (a * g + (1 - a) * (CREAM[1] / 255) * k));
    o[i * 4 + 2] = Math.round(255 * (a * b + (1 - a) * (CREAM[2] / 255) * k * 0.985));
    o[i * 4 + 3] = 255;
  }
  step(0.85);
  await nextFrame();

  // Frame: square, dish ~80% of it, cream beyond the photo's own edges (feathered, no seam).
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]! > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const side = Math.max(x1 - x0, y1 - y0) / 0.8;
  const scale = OUT / side;
  const dx = OUT / 2 - ((x0 + x1) / 2) * scale;
  const dy = OUT / 2 - ((y0 + y1) / 2 - (y1 - y0) * 0.03) * scale;
  const graded = layer(W, H);
  graded.getContext('2d')!.putImageData(img, 0, 0);
  const f = big * 0.06;
  const feather = layer(W, H);
  const fctx = feather.getContext('2d')!;
  fctx.fillStyle = '#000';
  fctx.fillRect(0, 0, W, H);
  fctx.globalCompositeOperation = 'destination-out'; // touches only the strips it draws
  for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of [[0, 0, f, 0, 0, 0, f, H], [W, 0, W - f, 0, W - f, 0, f, H], [0, 0, 0, f, 0, 0, W, f], [0, H, 0, H - f, 0, H - f, W, f]] as const) {
    const gr = fctx.createLinearGradient(gx0, gy0, gx1, gy1);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = gr;
    fctx.fillRect(rx, ry, rw, rh);
  }
  const gctx = graded.getContext('2d')!;
  gctx.globalCompositeOperation = 'destination-in';
  gctx.drawImage(feather, 0, 0);

  const canvas = layer(OUT, OUT);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${CREAM.join(',')})`;
  ctx.fillRect(0, 0, OUT, OUT);
  ctx.drawImage(graded, dx, dy, W * scale, H * scale);

  // Morano light on the backdrop only: warm key from the upper left, soft falloff to the corners.
  const light = layer(OUT, OUT);
  const lctx = light.getContext('2d')!;
  const gr = lctx.createRadialGradient(OUT * 0.38, OUT * 0.3, OUT * 0.05, OUT * 0.5, OUT * 0.5, OUT * 0.78);
  gr.addColorStop(0, 'rgba(255,250,243,0.55)');
  gr.addColorStop(0.6, 'rgba(250,242,233,0.1)');
  gr.addColorStop(1, 'rgba(210,190,170,0.35)');
  lctx.fillStyle = gr;
  lctx.fillRect(0, 0, OUT, OUT);
  const dish = layer(W, H);
  const dishData = new ImageData(W, H);
  for (let i = 0; i < N; i++) dishData.data[i * 4 + 3] = Math.round(255 * m[i]!);
  dish.getContext('2d')!.putImageData(dishData, 0, 0);
  lctx.globalCompositeOperation = 'destination-out';
  lctx.drawImage(dish, dx, dy, W * scale, H * scale);
  ctx.drawImage(light, 0, 0);
  // A touch of local contrast: the frame overlaid on itself.
  ctx.globalAlpha = 0.25;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(canvas, 0, 0);

  // The untouched photo in the same framing (opaque copy of the model's input).
  const plain = new ImageData(new Uint8ClampedArray(px), W, H);
  for (let i = 3; i < plain.data.length; i += 4) plain.data[i] = 255;
  const src = layer(W, H);
  src.getContext('2d')!.putImageData(plain, 0, 0);
  const before = layer(OUT, OUT);
  const bctx = before.getContext('2d')!;
  bctx.fillStyle = `rgb(${CREAM.join(',')})`;
  bctx.fillRect(0, 0, OUT, OUT);
  bctx.drawImage(src, dx, dy, W * scale, H * scale);
  step(1);
  return { canvas, before };
}

function layer(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
