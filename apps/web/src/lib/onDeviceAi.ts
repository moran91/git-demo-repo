/**
 * One configuration for every in-browser model (studio background, object selection, object
 * removal). Models and the ONNX runtime are served by Qareeb itself (public/models, public/ort; see
 * scripts/fetch-models.mjs), so photos never leave the device.
 *
 * ONNX Runtime reads its settings once, at the first session, so they are set here exactly once:
 * whichever feature the owner opens first, the next one finds the same runtime.
 */
type Transformers = typeof import('@huggingface/transformers');

let gpuUsable: Promise<boolean> | null = null;
/**
 * A real WebGPU adapter that can run fp16 models, on a desktop: not just `navigator.gpu` (present on
 * machines whose GPU is blocklisted), not an adapter without `shader-f16` (phones, Safari, older GPUs
 * throw "does not support fp16"), and never a phone, where the large GPU model exhausts memory (seen
 * on a Galaxy S21 Ultra).
 */
export function hasUsableGpu(): Promise<boolean> {
  gpuUsable ??= (async () => {
    const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    if (ua.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      return !!adapter && adapter.features.has('shader-f16');
    } catch {
      return false;
    }
  })();
  return gpuUsable;
}

let configured: Promise<Transformers> | null = null;
export function transformers(): Promise<Transformers> {
  configured ??= (async () => {
    const gpu = await hasUsableGpu();
    const t = await import('@huggingface/transformers');
    t.env.allowRemoteModels = false;
    t.env.allowLocalModels = true;
    t.env.localModelPath = '/models/';
    // The library's own Cache API copy can fail to write (ERR_CACHE_WRITE_FAILURE), which aborts the
    // download mid-stream; the browser's HTTP cache already keeps these files (max-age 30 days).
    t.env.useBrowserCache = false;
    if (t.env.backends.onnx.wasm) {
      // Absolute URL on purpose: Vite's dev server rewrites root-relative dynamic imports of /public files.
      t.env.backends.onnx.wasm.wasmPaths = new URL('/ort/', location.href).href;
      // Without a GPU, run the CPU backend in a worker so the page and its progress stay responsive.
      // The GPU backend cannot be proxied, so a GPU device keeps it off for every model.
      t.env.backends.onnx.wasm.proxy = !gpu;
    }
    return t;
  })();
  configured.catch(() => { configured = null; });
  return configured;
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Eases a percentage towards `to` over `expectedMs` for work that reports no progress of its own. */
export function easeProgress(from: number, to: number, expectedMs: number, onValue: (pct: number) => void): () => void {
  const start = performance.now();
  const timer = window.setInterval(() => {
    const k = 1 - Math.exp(-(performance.now() - start) / (expectedMs * 0.6));
    onValue(from + (to - from) * k);
  }, 120);
  return () => window.clearInterval(timer);
}
