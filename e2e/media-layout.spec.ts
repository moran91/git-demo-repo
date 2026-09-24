import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const styles = ['tokens', 'base', 'extra'].map((name) =>
  readFileSync(new URL(`../apps/web/src/design/${name}.css`, import.meta.url), 'utf8'),
).join('\n');
const photo = (width: number, height: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="green"/></svg>`)}`;
const image = `<div class="img-frame img-frame--wide"><img src="${photo(1600, 900)}" alt="" /></div>`;

async function checkMedia(page: Page) {
  const boxes = await page.locator('.dslide, .deal-art__banner, .plate').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    const image = element.querySelector('img')?.getBoundingClientRect();
    return { kind: element.className, width: box.width, height: box.height, imageWidth: image?.width, imageHeight: image?.height };
  }));
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(0);
    if (box.kind.includes('dslide')) expect(box.height).toBe(box.kind.includes('dslide--band') ? 212 : 164);
    if (box.kind.includes('plate')) {
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.width).toBeGreaterThan(40);
    }
    if (box.kind.includes('deal-art__banner')) {
      expect(Math.abs(box.imageWidth! - box.width)).toBeLessThan(1);
      expect(Math.abs(box.imageHeight! - box.height)).toBeLessThan(1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return boxes;
}

for (const dir of ['rtl', 'ltr']) {
  test(`deal photos keep their dimensions through image loads and relayouts (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Mirrors DealSlide (carousel slide with a banner, slide with plates) and the sheet band, using the actual application CSS.
    // Plate positions come from DealSlide's layout table as --s/--x/--y fractions of the art height.
    const plates = (n: number) => `<div class="plates plates--${n}${n > 3 ? ' plates--many' : ''}">${Array.from({ length: n }, (_, i) => `<span class="plate" style="--s: ${n > 6 ? 0.28 : 0.4}; --x: ${(i % 3) * 0.3}; --y: ${Math.floor(i / 3) * 0.33}"><div class="img-frame img-frame--square"><img src="${photo(400, 400)}" alt="" /></div></span>`).join('')}</div>`;
    await page.setContent(`<html dir="${dir}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body>
      <main class="page stack">
        <section class="deals-c"><div class="dcarousel">
          <button class="dslide dslide--promo"><div class="deal-art__banner">${image}</div>
            <span class="dslide__text"><span class="dslide__kind">Limited time</span><span class="dslide__name">Morano</span><span class="dslide__pill">Until 2.10</span></span></button>
          ${[3, 6, 10].map((n) => `<button class="dslide dslide--combo">${plates(n)}
            <span class="dslide__text"><span class="dslide__kind">Combo</span><span class="dslide__name">Morano combo</span><span class="dslide__pill">₪250</span></span></button>`).join('')}
        </div></section>
        <div class="dialog__body"><div class="deal-band"><div class="dslide dslide--combo dslide--band">${plates(6)}
          <span class="dslide__text"><span class="dslide__name">Combo details</span></span></div></div></div>
      </main></body></html>`);
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((img) => (img as HTMLImageElement).decode())));
    const initial = await checkMedia(page);
    for (let index = 0; index < 12; index++) {
      // Loading an original after a missing variant must not feed intrinsic dimensions back
      // into the flex card. Also trigger the relayouts Safari performs while scrolling.
      await page.locator('img').evaluateAll((images, src) => { for (const img of images) (img as HTMLImageElement).src = src; }, photo(index % 2 ? 900 : 2400, index % 2 ? 1600 : 1200));
      await page.locator('img').evaluateAll((images) => Promise.all(images.map((img) => (img as HTMLImageElement).decode())));
      await page.evaluate((index) => {
        window.scrollTo(0, index % 2 ? 100 : 0);
        document.documentElement.style.setProperty('--topbar-height', `${56 + index % 2}px`);
      }, index);
      expect(await checkMedia(page)).toEqual(initial);
    }
    for (const width of [360, 430, 844, 1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await checkMedia(page);
    }
  });
}
