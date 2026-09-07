import { encodeReceipt, getProfile, renderReceipt, type MonoBitmap, type ReceiptModel, type CanvasFactory } from '@qareeb/shared';

/** Browser canvas factory for the shared raster renderer (fonts are self-hosted and preloaded). */
export const browserCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c as unknown as ReturnType<CanvasFactory>;
};

export async function ensureFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  await Promise.all(['400 16px "Noto Sans"', '600 16px "Noto Sans"', '400 16px "Noto Sans Hebrew"', '600 16px "Noto Sans Hebrew"', '400 16px "Noto Sans Arabic"', '600 16px "Noto Sans Arabic"'].map((f) => document.fonts.load(f).catch(() => undefined)));
}

export async function renderModel(model: ReceiptModel): Promise<MonoBitmap> {
  await ensureFonts();
  return renderReceipt(model, browserCanvas);
}

export function bitmapToDataUrl(bmp: MonoBitmap): string {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(bmp.width, bmp.height);
  for (let i = 0; i < bmp.width * bmp.height; i++) {
    const v = bmp.pixels[i] ? 0 : 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function encodeForProfile(bmp: MonoBitmap, profileId: string, cut: boolean, feedLines: number) {
  const profile = getProfile(profileId);
  return encodeReceipt(bmp, { raster: profile?.raster ?? 'gs_v_0', cut: cut && (profile?.cutSupported ?? false), feedLines, maxStripRows: profile?.maxStripRows ?? 128 });
}
