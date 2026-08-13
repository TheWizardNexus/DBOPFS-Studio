import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { extensionRoot, isMainModule, relativePath } from './project.mjs';
import { findChromium } from './test-browser.mjs';

const iconSizes = [16, 32, 48, 128];

export async function renderIcons() {
  const sourcePath = path.join(extensionRoot, 'assets', 'icons', 'mark.svg');
  const outputDirectory = path.dirname(sourcePath);
  const svg = await readFile(sourcePath, 'utf8');
  const executablePath = await findChromium();
  await mkdir(outputDirectory, { recursive: true });

  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true });
  const outputs = [];
  try {
    const page = await browser.newPage();
    for (const size of iconSizes) {
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent(
        `<!doctype html><html><head><style>` +
        `html,body{background:transparent;margin:0;overflow:hidden;width:100%;height:100%}` +
        `svg{display:block;width:100%;height:100%}` +
        `</style></head><body>${svg}</body></html>`,
        { waitUntil: 'load' }
      );
      const outputPath = path.join(outputDirectory, `icon-${size}.png`);
      await page.screenshot({
        path: outputPath,
        type: 'png',
        omitBackground: true,
        captureBeyondViewport: false
      });
      outputs.push(outputPath);
    }
  } finally {
    await browser.close();
  }

  return outputs;
}

if (isMainModule(import.meta.url)) {
  renderIcons()
    .then((outputs) => {
      for (const output of outputs) {
        console.log(`Rendered ${relativePath(output)}.`);
      }
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
