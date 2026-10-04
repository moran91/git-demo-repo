// Downloads the on-device photo models into public/models so Qareeb serves them itself (no third-party
// request at runtime). Run once before `vite build`; the files are gitignored because of their size.
import { mkdir, writeFile, stat, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const MODELS = {
  'onnx-community/BiRefNet_lite-ONNX': ['config.json', 'preprocessor_config.json', 'onnx/model_fp16.onnx'],
  'onnx-community/ormbg-ONNX': ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx'],
  // Object selection (tap) and removal in the photo editor.
  'Xenova/slimsam-77-uniform': ['config.json', 'preprocessor_config.json', 'onnx/vision_encoder_quantized.onnx', 'onnx/prompt_encoder_mask_decoder_quantized.onnx'],
};
// Files whose repo layout differs from where the app loads them: [repo, file, destination under models/].
const EXTRA = [['andraniksargsyan/migan', 'migan_pipeline_v2.onnx', 'migan/migan_pipeline_v2.onnx']];
for (const [repo, files] of Object.entries(MODELS)) {
  for (const f of files) {
    const dest = join(root, repo, f);
    if (await stat(dest).then((s) => s.size > 0, () => false)) continue;
    const res = await fetch(`https://huggingface.co/${repo}/resolve/main/${f}`);
    if (!res.ok) throw new Error(`${repo}/${f}: ${res.status}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log('fetched', repo, f);
  }
}

for (const [repo, file, to] of EXTRA) {
  const dest = join(root, to);
  if (await stat(dest).then((s) => s.size > 0, () => false)) continue;
  const res = await fetch(`https://huggingface.co/${repo}/resolve/main/${file}`);
  if (!res.ok) throw new Error(`${repo}/${file}: ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', repo, file);
}

// ONNX Runtime's wasm backend, also served by Qareeb instead of the jsDelivr default.
const ortSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'node_modules', 'onnxruntime-web', 'dist');
const ortDest = join(root, '..', 'ort');
await mkdir(ortDest, { recursive: true });
for (const f of await readdir(ortSrc)) {
  if (/^ort-wasm-simd-threaded\..*(wasm|mjs)$/.test(f)) await copyFile(join(ortSrc, f), join(ortDest, f));
}
console.log('ort runtime copied');
