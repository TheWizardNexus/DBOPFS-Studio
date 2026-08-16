import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { extensionRoot, isMainModule, relativePath } from './project.mjs';
import { findChromium } from './test-browser.mjs';

const iconSizes = [16, 32, 48, 128];

async function writeIcon(filePath, bytes) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await writeFile(filePath, bytes);
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 7) throw error;
      await delay(50 * (attempt + 1));
    }
  }
}

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
      const padding = size === 128 ? 16 : 0;
      const artworkSize = size - (padding * 2);
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent(
        `<!doctype html><html><head><style>` +
        `html,body{background:transparent;margin:0;overflow:hidden;width:100%;height:100%}` +
        `body{display:grid;place-items:center}` +
        `svg{display:block;width:${artworkSize}px;height:${artworkSize}px}` +
        `</style></head><body>${svg}</body></html>`,
        { waitUntil: 'load' }
      );
      const outputPath = path.join(outputDirectory, `icon-${size}.png`);
      const bytes = await page.screenshot({
        type: 'png',
        omitBackground: true,
        captureBeyondViewport: false
      });
      await writeIcon(outputPath, bytes);
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
