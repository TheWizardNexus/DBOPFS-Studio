import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {
  isMainModule,
  projectRoot,
  relativePath,
  walkFiles
} from './project.mjs';
import { findChromium } from './test-browser.mjs';

const storeRoot = path.join(projectRoot, 'store-assets');
const manifestPath = path.join(storeRoot, 'asset-manifest.json');

export const STORE_SOURCE_REFERENCES = Object.freeze([
  'scripts/render-store-assets.mjs',
  'extension/assets/icons/mark.svg',
  'extension/assets/icons/icon-16.png',
  'extension/assets/icons/icon-48.png',
  'extension/assets/icons/icon-128.png',
  'extension/popup/index.html',
  'extension/popup/popup.css',
  'extension/popup/popup.js',
  'extension/devtools/panel.html',
  'extension/devtools/panel.css',
  'extension/devtools/panel.js',
  'extension/shared/format.js',
  'extension/shared/viewer.js',
  'extension/studio/index.html',
  'extension/studio/app.js',
  'extension/studio/styles/base.css',
  'extension/studio/styles/components.css',
  'extension/studio/styles/print.css',
  'extension/studio/styles/shell.css',
  'extension/studio/styles/tokens.css'
]);

export const STORE_ASSET_SPECS = Object.freeze({
  'chrome/icon/store-icon-128x128.png': [128, 128],
  'chrome/promo/small-promo-440x280.png': [440, 280],
  'chrome/promo/marquee-promo-1400x560.png': [1400, 560],
  'chrome/screenshots/01-dashboard-1280x800.png': [1280, 800],
  'chrome/screenshots/02-connect-to-site-1280x800.png': [1280, 800],
  'chrome/screenshots/03-json-inspector-1280x800.png': [1280, 800],
  'chrome/screenshots/04-markdown-preview-1280x800.png': [1280, 800],
  'chrome/screenshots/05-pdf-workflow-1280x800.png': [1280, 800],
  'edge/logo/extension-logo-300x300.png': [300, 300],
  'edge/promo/small-promo-440x280.png': [440, 280],
  'edge/promo/large-promo-1400x560.png': [1400, 560],
  'edge/screenshots/01-dashboard-1280x800.png': [1280, 800],
  'edge/screenshots/02-connect-to-site-1280x800.png': [1280, 800],
  'edge/screenshots/03-json-inspector-1280x800.png': [1280, 800],
  'edge/screenshots/04-markdown-preview-1280x800.png': [1280, 800],
  'edge/screenshots/05-pdf-workflow-1280x800.png': [1280, 800],
  'opera/icons/icon-16x16.png': [16, 16],
  'opera/icons/icon-48x48.png': [48, 48],
  'opera/icons/icon-128x128.png': [128, 128],
  'opera/screenshots/01-dashboard-612x408.png': [612, 408],
  'opera/screenshots/02-json-inspector-612x408.png': [612, 408]
});

const matchingPairs = Object.freeze([
  ['chrome/icon/store-icon-128x128.png', '../extension/assets/icons/icon-128.png'],
  ['edge/promo/small-promo-440x280.png', 'chrome/promo/small-promo-440x280.png'],
  ['edge/promo/large-promo-1400x560.png', 'chrome/promo/marquee-promo-1400x560.png'],
  ['edge/screenshots/01-dashboard-1280x800.png', 'chrome/screenshots/01-dashboard-1280x800.png'],
  ['edge/screenshots/02-connect-to-site-1280x800.png', 'chrome/screenshots/02-connect-to-site-1280x800.png'],
  ['edge/screenshots/03-json-inspector-1280x800.png', 'chrome/screenshots/03-json-inspector-1280x800.png'],
  ['edge/screenshots/04-markdown-preview-1280x800.png', 'chrome/screenshots/04-markdown-preview-1280x800.png'],
  ['edge/screenshots/05-pdf-workflow-1280x800.png', 'chrome/screenshots/05-pdf-workflow-1280x800.png'],
  ['opera/icons/icon-16x16.png', '../extension/assets/icons/icon-16.png'],
  ['opera/icons/icon-48x48.png', '../extension/assets/icons/icon-48.png']
]);

function inspectPng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) {
    return null;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    interlace: bytes[28]
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceHash(reference, bytes) {
  if (/\.(?:css|html|js|mjs|svg)$/i.test(reference)) {
    return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n')));
  }
  return sha256(bytes);
}

export async function createStoreAssetManifest() {
  const sources = {};
  for (const reference of STORE_SOURCE_REFERENCES) {
    const bytes = await readFile(path.join(projectRoot, reference));
    sources[reference] = sourceHash(reference, bytes);
  }
  const assets = {};
  for (const reference of Object.keys(STORE_ASSET_SPECS)) {
    assets[reference] = sha256(await readFile(path.join(storeRoot, reference)));
  }
  return { schemaVersion: 1, sources, assets };
}

async function decodePngs(files, issues) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: await findChromium(),
      headless: true,
      pipe: true,
      args: ['--force-color-profile=srgb']
    });
    const page = await browser.newPage();
    const results = await page.evaluate(async (items) => {
      const decoded = [];
      for (const item of items) {
        try {
          const image = new Image();
          image.src = `data:image/png;base64,${item.base64}`;
          await image.decode();
          const result = {
            reference: item.reference,
            width: image.naturalWidth,
            height: image.naturalHeight
          };
          if (item.inspectAlpha) {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let minX = canvas.width;
            let minY = canvas.height;
            let maxX = -1;
            let maxY = -1;
            for (let y = 0; y < canvas.height; y += 1) {
              for (let x = 0; x < canvas.width; x += 1) {
                if (pixels[((y * canvas.width) + x) * 4 + 3] > 0) {
                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                  maxX = Math.max(maxX, x);
                  maxY = Math.max(maxY, y);
                }
              }
            }
            result.alphaBounds = [minX, minY, maxX, maxY];
          }
          decoded.push(result);
        } catch (error) {
          decoded.push({ error: error.message, reference: item.reference });
        }
      }
      return decoded;
    }, Array.from(files, ([reference, bytes]) => ({
      base64: bytes.toString('base64'),
      inspectAlpha: [
        'chrome/icon/store-icon-128x128.png',
        'opera/icons/icon-128x128.png'
      ].includes(reference),
      reference
    })));

    for (const result of results) {
      if (result.error) {
        issues.push(`${result.reference} cannot be decoded as PNG: ${result.error}`);
        continue;
      }
      const [expectedWidth, expectedHeight] = STORE_ASSET_SPECS[result.reference];
      if (result.width !== expectedWidth || result.height !== expectedHeight) {
        issues.push(`${result.reference} decodes as ${result.width}x${result.height}.`);
      }
      if (result.reference === 'chrome/icon/store-icon-128x128.png' &&
          JSON.stringify(result.alphaBounds) !== JSON.stringify([16, 16, 111, 111])) {
        issues.push(
          `${result.reference} has alpha bounds ${result.alphaBounds?.join(',')}; ` +
          'expected exact 16px padding around 96px artwork.'
        );
      }
      if (result.reference === 'opera/icons/icon-128x128.png' &&
          JSON.stringify(result.alphaBounds) !== JSON.stringify([8, 8, 119, 119])) {
        issues.push(
          `${result.reference} has alpha bounds ${result.alphaBounds?.join(',')}; ` +
          'expected 112px artwork for Opera field occupancy.'
        );
      }
    }
  } catch (error) {
    issues.push(`Store images could not be decoded in Chromium: ${error.message}`);
  } finally {
    await browser?.close();
  }
}

function resolveComparison(reference) {
  return reference.startsWith('../')
    ? path.resolve(storeRoot, reference)
    : path.join(storeRoot, reference);
}

export async function validateStoreAssets() {
  const issues = [];
  const files = new Map();

  for (const [reference, [expectedWidth, expectedHeight]] of Object.entries(STORE_ASSET_SPECS)) {
    const filePath = path.join(storeRoot, reference);
    let bytes;
    try {
      bytes = await readFile(filePath);
      files.set(reference, bytes);
    } catch {
      issues.push(`${relativePath(filePath)} is missing.`);
      continue;
    }

    const png = inspectPng(bytes);
    if (!png) {
      issues.push(`${relativePath(filePath)} is not a PNG file.`);
      continue;
    }
    if (png.width !== expectedWidth || png.height !== expectedHeight) {
      issues.push(
        `${relativePath(filePath)} is ${png.width}x${png.height}; expected ` +
        `${expectedWidth}x${expectedHeight}.`
      );
    }
    if (png.interlace !== 0) {
      issues.push(`${relativePath(filePath)} must be a non-interlaced PNG.`);
    }
    if (![2, 6].includes(png.colorType) || png.bitDepth !== 8) {
      issues.push(`${relativePath(filePath)} must be an 8-bit RGB or RGBA PNG.`);
    }
  }

  for (const [leftReference, rightReference] of matchingPairs) {
    const left = files.get(leftReference);
    let right;
    try {
      right = rightReference.startsWith('../')
        ? await readFile(resolveComparison(rightReference))
        : files.get(rightReference) || await readFile(resolveComparison(rightReference));
    } catch {
      issues.push(`Comparison source for ${leftReference} is missing: ${rightReference}.`);
      continue;
    }
    if (left && !left.equals(right)) {
      issues.push(`${leftReference} must exactly match ${rightReference}.`);
    }
  }

  try {
    const discoveredPngs = (await walkFiles(storeRoot))
      .filter((filePath) => path.extname(filePath).toLowerCase() === '.png')
      .map((filePath) => path.relative(storeRoot, filePath).split(path.sep).join('/'))
      .sort();
    const expectedPngs = Object.keys(STORE_ASSET_SPECS).sort();
    if (JSON.stringify(discoveredPngs) !== JSON.stringify(expectedPngs)) {
      const unexpected = discoveredPngs.filter((reference) => !expectedPngs.includes(reference));
      const missing = expectedPngs.filter((reference) => !discoveredPngs.includes(reference));
      if (unexpected.length) issues.push(`Unexpected store PNGs: ${unexpected.join(', ')}.`);
      if (missing.length) issues.push(`Missing store PNGs: ${missing.join(', ')}.`);
    }
  } catch (error) {
    issues.push(`Store asset inventory could not be read: ${error.message}`);
  }

  try {
    const savedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const expectedManifest = await createStoreAssetManifest();
    if (JSON.stringify(savedManifest) !== JSON.stringify(expectedManifest)) {
      issues.push(
        `${relativePath(manifestPath)} is stale; regenerate assets with npm run store:assets.`
      );
    }
  } catch (error) {
    issues.push(`${relativePath(manifestPath)} is missing or invalid: ${error.message}`);
  }

  if (files.size === Object.keys(STORE_ASSET_SPECS).length) {
    await decodePngs(files, issues);
  }

  if (issues.length) {
    throw new Error(`Store asset validation failed:\n- ${issues.join('\n- ')}`);
  }

  return { files: files.size, root: storeRoot };
}

if (isMainModule(import.meta.url)) {
  validateStoreAssets()
    .then((result) => {
      console.log(`Validated ${result.files} store images in ${relativePath(result.root)}.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
