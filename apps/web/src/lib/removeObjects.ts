/**
 * On-device object removal for product photos.
 * - Select: tap a point and SlimSAM (Apache-2.0) returns the object under it. The image embedding is
 *   computed once per photo, so further taps on the same photo answer quickly.
 * - Remove: MI-GAN (MIT), a mobile inpainting model, fills the marked area from its surroundings.
 * Both run through the shared on-device runtime (onDeviceAi.ts); nothing leaves the device.
 */
import { transformers } from './onDeviceAi';

const SAM_ID = 'Xenova/slimsam-77-uniform';
const MIGAN_URL = '/models/migan/migan_pipeline_v2.onnx';

type SamParts = {
  model: { get_image_embeddings(inputs: unknown): Promise<Record<string, unknown>>; (inputs: unknown): Promise<{ pred_masks: unknown; iou_scores: { data: Float32Array } }> };
  processor: {
    (image: unknown, opts?: unknown): Promise<Record<string, unknown> & { original_sizes: unknown; reshaped_input_sizes: unknown }>;
    post_process_masks(masks: unknown, original: unknown, reshaped: unknown): Promise<Array<{ data: Uint8Array | boolean[]; dims: number[] }>>;
  };
};

let sam: Promise<SamParts> | null = null;
function loadSam(): Promise<SamParts> {
  sam ??= (async () => {
    const t = await transformers();
    const [model, processor] = await Promise.all([
      t.SamModel.from_pretrained(SAM_ID, { dtype: 'q8', device: 'wasm' }),
      t.AutoProcessor.from_pretrained(SAM_ID),
    ]);
    return { model, processor } as unknown as SamParts;
  })();
  sam.catch(() => { sam = null; });
  return sam;
}

type Embedded = { raw: unknown; embeddings: Record<string, unknown> };
/** The in-flight or finished embedding of the last photo: a tap during preparation waits for it
 *  instead of starting a second, competing encoder run. */
let embedded: { blob: Blob; done: Promise<Embedded> } | null = null;

function embed(image: Blob): Promise<Embedded> {
  if (embedded?.blob === image) return embedded.done;
  const done = (async () => {
    const t = await transformers();
    const { model, processor } = await loadSam();
    const raw = await t.RawImage.fromBlob(image);
    const inputs = await processor(raw);
    return { raw, embeddings: await model.get_image_embeddings(inputs) };
  })();
  embedded = { blob: image, done };
  done.catch(() => { if (embedded?.done === done) embedded = null; });
  return done;
}

/**
 * Starts the slow part (the photo's embedding, ~1–20 s depending on the device) as soon as the owner
 * opens remove mode, so the first tap only runs the fast decoder.
 */
export function prepareSelection(image: Blob) {
  void embed(image).catch(() => undefined);
}

/**
 * The object at (x, y), in image pixels, as a mask the size of the image (1 = object). Of SlimSAM's
 * three proposals it takes the best-scored one that contains the tapped point (or the best overall).
 */
export async function selectObjectAt(image: Blob, x: number, y: number): Promise<{ mask: Uint8Array; width: number; height: number }> {
  const { model, processor } = await loadSam();
  const { raw, embeddings } = await embed(image);
  // The processor maps the point from image pixels to the model's resized space (and returns the
  // sizes needed to map the masks back).
  const inputs = await processor(raw, { input_points: [[[x, y]]], input_labels: [[1]] });
  const out = await model({ ...embeddings, input_points: inputs.input_points, input_labels: inputs.input_labels });
  const [masks] = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const dims = masks!.dims; // [1, 3, H, W]
  const height = dims[dims.length - 2]!, width = dims[dims.length - 1]!;
  const size = width * height;
  const data = masks!.data as ArrayLike<number | boolean>;
  const scores = out.iou_scores.data;
  const at = Math.min(height - 1, Math.max(0, Math.round(y))) * width + Math.min(width - 1, Math.max(0, Math.round(x)));
  let best = -1;
  for (let i = 0; i < scores.length; i++) {
    if (!data[i * size + at]) continue;
    if (best < 0 || scores[i]! > scores[best]!) best = i;
  }
  // SAM sometimes leaves the tapped pixel just outside every proposal (edges, thin parts): then the
  // best-scored proposal is still the object the owner meant.
  if (best < 0) for (let i = 0; i < scores.length; i++) if (best < 0 || scores[i]! > scores[best]!) best = i;
  const mask = new Uint8Array(size);
  for (let i = 0; i < size; i++) mask[i] = data[best * size + i] ? 1 : 0;
  return { mask, width, height };
}

type OrtSession = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Uint8Array; dims: readonly number[] }>> };
let migan: Promise<{ session: OrtSession; Tensor: new (type: string, data: Uint8Array, dims: number[]) => unknown }> | null = null;
function loadMigan() {
  migan ??= (async () => {
    await transformers(); // configures the shared ONNX runtime (paths, worker) before its first session
    const ort = (await import('onnxruntime-web')) as unknown as { InferenceSession: { create(url: string, opts?: unknown): Promise<OrtSession> }; Tensor: new (type: string, data: Uint8Array, dims: number[]) => unknown };
    const session = await ort.InferenceSession.create(new URL(MIGAN_URL, location.href).href, { executionProviders: ['wasm'] });
    return { session, Tensor: ort.Tensor };
  })();
  migan.catch(() => { migan = null; });
  return migan;
}

export function warmUpRemoval() {
  void loadMigan().catch(() => undefined);
}

/**
 * Removes the marked area (mask: 1 = remove, image-sized) and returns the filled photo. The mask is
 * grown by a few pixels first so the object's edge and its shadow do not survive as a halo.
 */
export async function removeArea(image: Blob, mask: Uint8Array, width: number, height: number): Promise<Blob> {
  const { session, Tensor } = await loadMigan();
  const bmp = await createImageBitmap(image);
  try {
    if (bmp.width !== width || bmp.height !== height) throw new Error(`mask ${width}x${height} does not match photo ${bmp.width}x${bmp.height}`);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height);
    const n = width * height;
    const chw = new Uint8Array(3 * n);
    for (let i = 0; i < n; i++) {
      chw[i] = rgba.data[i * 4]!;
      chw[n + i] = rgba.data[i * 4 + 1]!;
      chw[2 * n + i] = rgba.data[i * 4 + 2]!;
    }
    // ~1.5% of the photo: enough to take the object's rim and contact shadow, which SAM leaves out.
    const grown = dilate(mask, width, height, Math.max(5, Math.round(Math.max(width, height) * 0.015)));
    const keep = new Uint8Array(n);
    for (let i = 0; i < n; i++) keep[i] = grown[i] ? 0 : 255; // MI-GAN: 0 = fill, 255 = keep
    const out = await session.run({
      image: new Tensor('uint8', chw, [1, 3, height, width]),
      mask: new Tensor('uint8', keep, [1, 1, height, width]),
    });
    const res = out.result!.data;
    for (let i = 0; i < n; i++) {
      if (!grown[i]) continue; // untouched pixels stay byte-identical
      rgba.data[i * 4] = res[i]!;
      rgba.data[i * 4 + 1] = res[n + i]!;
      rgba.data[i * 4 + 2] = res[2 * n + i]!;
    }
    ctx.putImageData(rgba, 0, 0);
    const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.92));
    const blob = webp && webp.type === 'image/webp' ? webp : await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('could not encode the photo');
    return blob;
  } finally {
    bmp.close();
  }
}

/** Square dilation by `r` pixels (two separable passes of a running max). */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) { if (src[y * w + x]) last = x; tmp[y * w + x] = x - last <= r ? 1 : 0; }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; out[y * w + x] = y - last <= r ? 1 : 0; }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}
