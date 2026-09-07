import { packBits, splitStrips, type MonoBitmap } from './render.js';

/**
 * ESC/POS encoding of raster strips. Only raster commands are used so shaped Hebrew/Arabic text is
 * printed as pixels. Cash-drawer commands (ESC p / DLE DC4) are intentionally never emitted.
 */
export type RasterCommand = 'gs_v_0' | 'esc_star_24';

export interface EscPosOptions {
  raster: RasterCommand;
  cut: boolean;
  feedLines: number;
  maxStripRows?: number;
}

const ESC = 0x1b;
const GS = 0x1d;

export function escposInit(): Uint8Array {
  return new Uint8Array([ESC, 0x40]); // ESC @ initialise
}

export function escposFeed(lines: number): Uint8Array {
  return new Uint8Array([ESC, 0x64, Math.max(0, Math.min(255, lines))]); // ESC d n
}

export function escposCut(): Uint8Array {
  return new Uint8Array([GS, 0x56, 0x42, 0x00]); // GS V B 0 — partial cut with feed
}

/** GS v 0: print raster bit image (normal mode). */
export function encodeGsV0(strip: MonoBitmap): Uint8Array {
  const { bytesPerRow, data } = packBits(strip);
  const xL = bytesPerRow & 0xff;
  const xH = (bytesPerRow >> 8) & 0xff;
  const yL = strip.height & 0xff;
  const yH = (strip.height >> 8) & 0xff;
  const header = new Uint8Array([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  const out = new Uint8Array(header.length + data.length);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
}

/** ESC * m=33 (24-dot double density) fallback for printers without GS v 0. */
export function encodeEscStar24(strip: MonoBitmap): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([ESC, 0x33, 24])); // line spacing 24 dots
  for (let y0 = 0; y0 < strip.height; y0 += 24) {
    const nL = strip.width & 0xff;
    const nH = (strip.width >> 8) & 0xff;
    const head = new Uint8Array([ESC, 0x2a, 33, nL, nH]);
    const body = new Uint8Array(strip.width * 3);
    for (let x = 0; x < strip.width; x++) {
      for (let k = 0; k < 3; k++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const y = y0 + k * 8 + bit;
          if (y < strip.height && strip.pixels[y * strip.width + x]) byte |= 0x80 >> bit;
        }
        body[x * 3 + k] = byte;
      }
    }
    parts.push(head, body, new Uint8Array([0x0a]));
  }
  parts.push(new Uint8Array([ESC, 0x32])); // default line spacing
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface EncodedReceipt {
  /** Ordered packets: init, one per strip, then feed/cut. Each packet can be chunked by the transport. */
  packets: Uint8Array[];
  stripsTotal: number;
}

export function encodeReceipt(bitmap: MonoBitmap, opts: EscPosOptions): EncodedReceipt {
  const strips = splitStrips(bitmap, opts.maxStripRows ?? 256);
  const packets: Uint8Array[] = [escposInit()];
  for (const s of strips) packets.push(opts.raster === 'gs_v_0' ? encodeGsV0(s) : encodeEscStar24(s));
  if (opts.feedLines > 0) packets.push(escposFeed(opts.feedLines));
  if (opts.cut) packets.push(escposCut());
  return { packets, stripsTotal: strips.length };
}

/** Splits a packet into transport-sized chunks (BLE writes are typically 20–512 bytes). */
export function chunk(data: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.subarray(i, Math.min(i + size, data.length)));
  return out;
}

/** Bytes that must never be sent: cash drawer kick (ESC p, DLE DC4 1). Used by tests to assert. */
export function containsForbiddenCommands(data: Uint8Array): boolean {
  for (let i = 0; i + 1 < data.length; i++) {
    if (data[i] === ESC && data[i + 1] === 0x70) return true;
    if (data[i] === 0x10 && data[i + 1] === 0x14 && data[i + 2] === 0x01) return true;
  }
  return false;
}
