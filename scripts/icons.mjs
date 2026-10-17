// Keep the original PNG for the brand; zoom its upper body into square toolbar icons.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension/icons');
const source = await readFile(path.join(directory, 'penguin.png'));
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const result = await page.evaluate(
      async ({ bytes, size }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        );
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const crop = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, 0, 0, crop, crop, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { bytes: [...source], size },
    );
    await writeFile(path.join(directory, `icon-${size}.png`), Buffer.from(result, 'base64'));
  }
  console.log('Penguin icons generated from the original PNG.');
} finally {
  await browser.close();
}
