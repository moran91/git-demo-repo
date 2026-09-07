import { describe, expect, it, beforeAll } from 'vitest';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { buildOrderReceipt, buildTestReceipt } from '../src/receipt/model.js';
import { renderReceipt, splitStrips, toPBM, type CanvasFactory } from '../src/receipt/render.js';
import { encodeReceipt, containsForbiddenCommands, chunk } from '../src/receipt/escpos.js';
import { PRINTER_PROFILES } from '../src/receipt/profiles.js';
import { deliveryOrder } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../../assets/fonts');
const outDir = path.resolve(here, '../../../docs/print-fixtures');

const factory: CanvasFactory = (w, h) => createCanvas(w, h) as unknown as ReturnType<CanvasFactory>;

beforeAll(() => {
  for (const f of fs.readdirSync(fontsDir).filter((f) => f.endsWith('.ttf'))) GlobalFonts.registerFromPath(path.join(fontsDir, f));
  fs.mkdirSync(outDir, { recursive: true });
});

describe('receipt model', () => {
  it('places the house description before conventional address fields on delivery tickets', () => {
    const m = buildOrderReceipt(deliveryOrder, { template: 'order_ticket', locale: 'he', paperWidthMm: 58, printableDots: 384 });
    const boxIdx = m.blocks.findIndex((b) => b.kind === 'box');
    const cityIdx = m.blocks.findIndex((b) => b.kind === 'text' && b.text.includes('בית ג׳ן'));
    expect(boxIdx).toBeGreaterThan(0);
    expect(cityIdx).toBeGreaterThan(boxIdx);
    expect(m.blocks.some((b) => b.kind === 'text' && b.text === 'משלוח')).toBe(true);
    expect(m.blocks.some((b) => b.kind === 'text' && b.text.includes('ממתינה לאישור'))).toBe(true);
  });
  it('omits home address for pickup and labels rejected orders', () => {
    const m = buildOrderReceipt({ ...deliveryOrder, mode: 'pickup', status: 'rejected', address: undefined }, { template: 'order_ticket', locale: 'en', paperWidthMm: 80, printableDots: 576 });
    expect(m.blocks.some((b) => b.kind === 'box' && b.title === 'How to find the house')).toBe(false);
    expect(m.blocks.some((b) => b.kind === 'text' && b.text.startsWith('REJECTED'))).toBe(true);
    expect(m.blocks.some((b) => b.kind === 'text' && b.text.includes('Cash on'))).toBe(false);
  });
  it('shows Cash received only when a record exists', () => {
    const a = buildOrderReceipt({ ...deliveryOrder, status: 'accepted' }, { template: 'customer_copy', locale: 'ar', paperWidthMm: 58, printableDots: 384 });
    expect(a.blocks.some((b) => b.kind === 'row' && b.start === 'تم استلام النقد')).toBe(false);
    const b = buildOrderReceipt({ ...deliveryOrder, status: 'accepted' }, { template: 'customer_copy', locale: 'ar', paperWidthMm: 58, printableDots: 384, cashReceivedAgorot: 10225 });
    expect(b.blocks.some((x) => x.kind === 'row' && x.start === 'تم استلام النقد')).toBe(true);
  });
  it('labels copies and revisions', () => {
    const m = buildOrderReceipt({ ...deliveryOrder, revision: 1 }, { template: 'order_ticket', locale: 'he', paperWidthMm: 58, printableDots: 384, isCopy: true });
    expect(m.labels).toMatchObject({ copy: true, revised: true });
    expect(m.blocks.filter((b) => b.kind === 'text' && b.text.startsWith('***')).length).toBe(2);
  });
});

describe('raster rendering + ESC/POS (simulator)', () => {
  const cases = [
    { locale: 'he', paper: 58, dots: 384 },
    { locale: 'ar', paper: 58, dots: 384 },
    { locale: 'en', paper: 80, dots: 576 },
    { locale: 'he', paper: 80, dots: 576 },
  ] as const;
  for (const c of cases) {
    it(`renders ${c.locale} ${c.paper}mm ticket within printable width and writes a fixture`, () => {
      const model = buildOrderReceipt(deliveryOrder, { template: 'order_ticket', locale: c.locale, paperWidthMm: c.paper, printableDots: c.dots, simulation: true, now: new Date('2026-09-07T11:40:00Z') });
      const bmp = renderReceipt(model, factory);
      expect(bmp.width).toBe(c.dots);
      expect(bmp.height).toBeGreaterThan(400);
      // Some ink must be present, and none in the last column (nothing clipped at the edge).
      let ink = 0;
      let edge = 0;
      for (let y = 0; y < bmp.height; y++) {
        for (let x = 0; x < bmp.width; x++) if (bmp.pixels[y * bmp.width + x]) ink++;
        if (bmp.pixels[y * bmp.width + bmp.width - 1]) edge++;
        if (bmp.pixels[y * bmp.width]) edge++;
      }
      expect(ink).toBeGreaterThan(5000);
      expect(edge).toBe(0);
      fs.writeFileSync(path.join(outDir, `ticket-${c.locale}-${c.paper}mm.pbm`), toPBM(bmp));
      const pngCanvas = createCanvas(bmp.width, bmp.height);
      const ctx = pngCanvas.getContext('2d');
      const img = ctx.createImageData(bmp.width, bmp.height);
      for (let i = 0; i < bmp.width * bmp.height; i++) {
        const v = bmp.pixels[i] ? 0 : 255;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      fs.writeFileSync(path.join(outDir, `ticket-${c.locale}-${c.paper}mm.png`), pngCanvas.toBuffer('image/png'));
    });
  }
  it('renders the multilingual test receipt and splits into bounded strips', () => {
    const model = buildTestReceipt({ locale: 'he', paperWidthMm: 58, printableDots: 384, businessName: 'קריב · قريب · Qareeb', branchPhone: '+972501234567', simulation: true, now: new Date('2026-09-07T11:40:00Z') });
    const bmp = renderReceipt(model, factory);
    const strips = splitStrips(bmp, 128);
    expect(strips.length).toBe(Math.ceil(bmp.height / 128));
    expect(strips.every((s) => s.height <= 128)).toBe(true);
    const pngCanvas = createCanvas(bmp.width, bmp.height);
    const ctx = pngCanvas.getContext('2d');
    const img = ctx.createImageData(bmp.width, bmp.height);
    for (let i = 0; i < bmp.width * bmp.height; i++) {
      const v = bmp.pixels[i] ? 0 : 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    fs.writeFileSync(path.join(outDir, 'test-receipt-58mm.png'), pngCanvas.toBuffer('image/png'));
  });
  it('encodes GS v 0 packets with correct headers, never emits cash drawer commands, and chunks for BLE', () => {
    const model = buildOrderReceipt(deliveryOrder, { template: 'order_ticket', locale: 'ar', paperWidthMm: 80, printableDots: 576 });
    const bmp = renderReceipt(model, factory);
    const enc = encodeReceipt(bmp, { raster: 'gs_v_0', cut: true, feedLines: 3, maxStripRows: 200 });
    expect(enc.packets[0]).toEqual(new Uint8Array([0x1b, 0x40]));
    const first = enc.packets[1]!;
    expect(Array.from(first.subarray(0, 4))).toEqual([0x1d, 0x76, 0x30, 0x00]);
    expect(first[4]! | (first[5]! << 8)).toBe(72); // 576 / 8 bytes per row
    expect(enc.stripsTotal).toBe(Math.ceil(bmp.height / 200));
    const all = enc.packets.reduce((a, p) => a + p.length, 0);
    expect(all).toBeGreaterThan(1000);
    for (const p of enc.packets) expect(containsForbiddenCommands(p)).toBe(false);
    const chunks = chunk(first, 100);
    expect(chunks.length).toBe(Math.ceil(first.length / 100));
    expect(chunks.reduce((a, c) => a + c.length, 0)).toBe(first.length);
    const esc = encodeReceipt(bmp, { raster: 'esc_star_24', cut: false, feedLines: 0 });
    expect(esc.packets[1]![0]).toBe(0x1b);
  });
  it('profiles are documented and none claim verification without hardware', () => {
    for (const p of PRINTER_PROFILES) {
      expect(p.notes.length).toBeGreaterThan(10);
      if (p.transports.includes('web_bluetooth_ble')) expect(p.ble?.serviceUuid).toMatch(/^[0-9a-f-]{36}$/);
      if (p.id !== 'os_print_dialog') expect(p.verified).toBe(false);
    }
  });
});
