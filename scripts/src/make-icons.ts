/** Generates PWA icons (PNG) and favicon (SVG) from the brand mark. Run: node --experimental-strip-types scripts/src/make-icons.ts */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(import.meta.dirname, '../../apps/web/public/icons');
fs.mkdirSync(out, { recursive: true });

function draw(size: number, maskable: boolean) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const pad = maskable ? size * 0.1 : 0;
  const r = maskable ? 0 : size * 0.28;
  ctx.fillStyle = '#20583B';
  if (maskable) ctx.fillRect(0, 0, size, size);
  else {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, r);
    ctx.fill();
  }
  const s = size - pad * 2;
  const x = (v: number) => pad + (v / 32) * s;
  ctx.fillStyle = '#FFFEFA';
  ctx.beginPath();
  ctx.moveTo(x(9), x(23));
  ctx.bezierCurveTo(x(9), x(15), x(14), x(10), x(23), x(10));
  ctx.bezierCurveTo(x(22), x(18), x(18), x(23), x(10), x(23));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#20583B';
  ctx.lineWidth = Math.max(1, (1.6 / 32) * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x(10), x(22));
  ctx.quadraticCurveTo(x(15), x(15), x(20), x(13));
  ctx.stroke();
  return c.toBuffer('image/png');
}
fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512, false));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, true));
fs.writeFileSync(path.join(out, 'badge-72.png'), draw(72, true));
fs.writeFileSync(path.join(out, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#20583B"/><path d="M9 23c0-8 5-13 14-13-1 8-5 13-13 13z" fill="#FFFEFA"/><path d="M10 22c3-4 6-7 10-9" stroke="#20583B" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`);
console.log('icons written to', out);
