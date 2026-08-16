import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { createStaticServer } from './static-server.mjs';
import {
  extensionRoot,
  isMainModule,
  projectRoot,
  relativePath
} from './project.mjs';
import { findChromium } from './test-browser.mjs';
import {
  createStoreAssetManifest,
  validateStoreAssets
} from './validate-store-assets.mjs';

const storeRoot = path.join(projectRoot, 'store-assets');
const fixedTimestamp = Date.parse('2026-08-15T18:00:00.000Z');
const screenshotNames = Object.freeze([
  '01-dashboard-1280x800.png',
  '02-connect-to-site-1280x800.png',
  '03-json-inspector-1280x800.png',
  '04-markdown-preview-1280x800.png',
  '05-pdf-workflow-1280x800.png'
]);

function outputPath(...parts) {
  return path.join(storeRoot, ...parts);
}

async function ensureParent(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeOutput(filePath, bytes) {
  await ensureParent(filePath);
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

async function copyAsset(source, destination) {
  await writeOutput(destination, await readFile(source));
}

async function asDataUrl(filePath) {
  return `data:image/png;base64,${(await readFile(filePath)).toString('base64')}`;
}

function bytesAsDataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function setCanvas(page, width, height, html, options = {}) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return undefined;
      return new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', reject, { once: true });
      });
    }));
  });
  await settle(page);
  const bytes = await page.screenshot({
    type: 'png',
    omitBackground: options.omitBackground ?? false,
    captureBeyondViewport: false
  });
  await writeOutput(options.path, bytes);
}

async function capturePng(page, filePath) {
  const bytes = await page.screenshot({ type: 'png', captureBeyondViewport: false });
  await writeOutput(filePath, bytes);
}

function baseDocument(body, css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head>` +
    `<body>${body}</body></html>`;
}

async function renderEdgeLogo(page, markSvg) {
  const css = `
    *{box-sizing:border-box}
    html,body{width:300px;height:300px;margin:0;overflow:hidden;background:transparent}
    body{display:grid;place-items:center}
    .mark{width:232px;height:232px;filter:drop-shadow(0 16px 24px rgba(3,8,17,.34))}
    .mark svg{display:block;width:100%;height:100%}
  `;
  await setCanvas(
    page,
    300,
    300,
    baseDocument(`<div class="mark">${markSvg}</div>`, css),
    { path: outputPath('edge', 'logo', 'extension-logo-300x300.png'), omitBackground: true }
  );
}

async function renderOperaPromo(page, markSvg) {
  const css = `
    *{box-sizing:border-box}
    html,body{width:300px;height:188px;margin:0;overflow:hidden}
    body{position:relative;display:grid;place-items:center;background:
      radial-gradient(circle at 16% 8%,rgba(74,190,178,.23),transparent 42%),
      radial-gradient(circle at 90% 92%,rgba(171,148,255,.19),transparent 44%),
      linear-gradient(135deg,#030811 0%,#07111e 56%,#111526 100%);color:#f4ecd7}
    body:before{content:"";position:absolute;inset:0;background-image:
      linear-gradient(rgba(174,184,204,.045) 1px,transparent 1px),
      linear-gradient(90deg,rgba(174,184,204,.045) 1px,transparent 1px);
      background-size:24px 24px;mask-image:linear-gradient(to bottom,black,transparent)}
    .orbit{position:absolute;width:260px;height:104px;border:1px solid rgba(74,190,178,.4);
      border-radius:50%;transform:rotate(-15deg)}
    .orbit:after{content:"";position:absolute;right:18px;top:12px;width:7px;height:7px;
      border-radius:50%;background:#d7a84d;box-shadow:0 0 14px rgba(215,168,77,.8)}
    .brand{position:relative;z-index:1;display:flex;align-items:center;gap:17px;padding:20px 22px;
      border:1px solid rgba(215,168,77,.22);border-radius:19px;background:rgba(3,8,17,.68);
      box-shadow:0 18px 40px rgba(0,0,0,.36)}
    .mark{width:70px;height:70px;flex:none}.mark svg{display:block;width:100%;height:100%}
    h1{margin:0;font:400 31px/1 Georgia,"Times New Roman",serif;letter-spacing:-.5px}
    .studio{margin:7px 0 0;color:#d7a84d;font:700 11px/1 "Segoe UI",Arial,sans-serif;
      letter-spacing:6px}
    .purpose{margin:12px 0 0;color:#aeb8cc;font:600 10px/1.2 "Segoe UI",Arial,sans-serif;
      letter-spacing:1px;text-transform:uppercase}
  `;
  const body = `<div class="orbit" aria-hidden="true"></div><section class="brand">` +
    `<div class="mark">${markSvg}</div><div><h1>DBOPFS</h1><p class="studio">STUDIO</p>` +
    `<p class="purpose">OPFS data workspace</p></div></section>`;
  await setCanvas(
    page,
    300,
    188,
    baseDocument(body, css),
    { path: outputPath('opera', 'promo', 'promotional-image-300x188.png') }
  );
}

async function renderSmallPromo(page, markSvg) {
  const css = `
    *{box-sizing:border-box}
    html,body{width:440px;height:280px;margin:0;overflow:hidden}
    body{position:relative;display:grid;place-items:center;background:
      radial-gradient(circle at 18% 10%,rgba(74,190,178,.22),transparent 40%),
      radial-gradient(circle at 88% 88%,rgba(171,148,255,.18),transparent 42%),
      linear-gradient(135deg,#030811 0%,#07111e 55%,#111526 100%);color:#f4ecd7}
    body:before{content:"";position:absolute;inset:0;background-image:
      linear-gradient(rgba(174,184,204,.045) 1px,transparent 1px),
      linear-gradient(90deg,rgba(174,184,204,.045) 1px,transparent 1px);
      background-size:28px 28px;mask-image:linear-gradient(to bottom,black,transparent)}
    .orbit{position:absolute;width:350px;height:142px;border:1px solid rgba(74,190,178,.42);
      border-radius:50%;transform:rotate(-16deg)}
    .orbit:after{content:"";position:absolute;right:25px;top:17px;width:9px;height:9px;
      border-radius:50%;background:#d7a84d;box-shadow:0 0 18px rgba(215,168,77,.8)}
    .brand{position:relative;z-index:1;display:flex;align-items:center;gap:24px;padding:24px 30px;
      border:1px solid rgba(215,168,77,.22);border-radius:24px;
      background:rgba(3,8,17,.66);box-shadow:0 22px 52px rgba(0,0,0,.35)}
    .mark{width:104px;height:104px;flex:none}.mark svg{display:block;width:100%;height:100%}
    h1{margin:0;font:400 44px/1 Georgia,"Times New Roman",serif;letter-spacing:-1px}
    p{margin:10px 0 0;color:#d7a84d;font:700 17px/1.1 "Segoe UI",Arial,sans-serif;letter-spacing:8px}
  `;
  const body = `<div class="orbit" aria-hidden="true"></div><section class="brand">` +
    `<div class="mark">${markSvg}</div><div><h1>DBOPFS</h1><p>STUDIO</p></div></section>`;
  await setCanvas(
    page,
    440,
    280,
    baseDocument(body, css),
    { path: outputPath('chrome', 'promo', 'small-promo-440x280.png') }
  );
}

async function renderLargePromo(page, markSvg, dashboardDataUrl) {
  const css = `
    *{box-sizing:border-box}
    html,body{width:1400px;height:560px;margin:0;overflow:hidden}
    body{position:relative;background:
      radial-gradient(circle at 8% 0%,rgba(74,190,178,.2),transparent 36%),
      radial-gradient(circle at 92% 100%,rgba(171,148,255,.16),transparent 40%),
      linear-gradient(135deg,#030811 0%,#060d19 50%,#111526 100%);color:#f4ecd7;
      font-family:"Segoe UI",Arial,sans-serif}
    body:before{content:"";position:absolute;inset:0;background-image:
      linear-gradient(rgba(174,184,204,.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(174,184,204,.04) 1px,transparent 1px);background-size:44px 44px}
    .flare{position:absolute;left:-120px;bottom:-210px;width:680px;height:420px;border-radius:50%;
      border:2px solid rgba(76,51,88,.5);transform:rotate(13deg)}
    .layout{position:absolute;inset:0;display:grid;grid-template-columns:520px 1fr;align-items:center;gap:62px;padding:58px 68px}
    .copy{position:relative;z-index:1}.identity{display:flex;align-items:center;gap:20px;margin-bottom:30px}
    .mark{width:82px;height:82px;flex:none}.mark svg{display:block;width:100%;height:100%}
    .kicker{margin:0;color:#d7a84d;font-size:15px;font-weight:700;letter-spacing:4px;text-transform:uppercase}
    h1{margin:6px 0 0;font:400 66px/1 Georgia,"Times New Roman",serif;letter-spacing:-2px}
    h1 span{display:block;margin-top:9px;color:#d7a84d;font:300 31px/1 "Segoe UI",Arial,sans-serif;letter-spacing:13px;text-transform:uppercase}
    .tagline{max-width:450px;margin:0;color:#edf1fa;font-size:30px;line-height:1.25}
    .privacy{margin:18px 0 0;color:#94a4ba;font-size:16px;letter-spacing:.3px}
    .window{position:relative;border:1px solid rgba(174,184,204,.4);border-radius:18px;padding:9px;background:#151c2d;
      box-shadow:0 34px 70px rgba(0,0,0,.52);transform:translateY(4px)}
    .window:before{content:"";position:absolute;left:24px;top:-28px;width:9px;height:9px;border-radius:50%;
      background:#f08080;box-shadow:22px 0 #e9b85f,44px 0 #61c990}
    .window img{display:block;width:710px;height:auto;border-radius:10px}
  `;
  const body = `<div class="flare" aria-hidden="true"></div><main class="layout"><section class="copy">` +
    `<div class="identity"><div class="mark">${markSvg}</div><div><p class="kicker">Browser-native data workspace</p>` +
    `<h1>DBOPFS <span>Studio</span></h1></div></div><p class="tagline">Your browser data, made legible.</p>` +
    `<p class="privacy">Explore and manage DBOPFS data locally.</p></section>` +
    `<section class="window"><img src="${dashboardDataUrl}" alt=""></section></main>`;
  await setCanvas(
    page,
    1400,
    560,
    baseDocument(body, css),
    { path: outputPath('chrome', 'promo', 'marquee-promo-1400x560.png') }
  );
}

async function renderConnectionScreenshot(page, markSvg, surfaces) {
  const css = `
    *{box-sizing:border-box}
    html,body{width:1280px;height:800px;margin:0;overflow:hidden}
    body{position:relative;background:
      radial-gradient(circle at 8% 0%,rgba(74,190,178,.2),transparent 34%),
      radial-gradient(circle at 94% 100%,rgba(171,148,255,.17),transparent 38%),
      linear-gradient(135deg,#030811 0%,#07111d 54%,#111526 100%);color:#edf1fa;
      font-family:"Segoe UI",Arial,sans-serif}
    body:before{content:"";position:absolute;inset:0;background-image:
      linear-gradient(rgba(174,184,204,.045) 1px,transparent 1px),
      linear-gradient(90deg,rgba(174,184,204,.045) 1px,transparent 1px);background-size:40px 40px}
    main{position:relative;height:100%;padding:48px 62px}
    header{display:flex;align-items:center;gap:18px}.mark{width:62px;height:62px}.mark svg{width:100%;height:100%;display:block}
    .brand{font:400 29px/1 Georgia,"Times New Roman",serif;color:#f4ecd7}.brand span{display:block;margin-top:6px;
      color:#d7a84d;font:700 10px/1 "Segoe UI",Arial,sans-serif;letter-spacing:5px}
    .intro{position:absolute;left:62px;top:145px;width:280px}.eyebrow{margin:0 0 12px;color:#d7a84d;font-size:12px;
      font-weight:800;letter-spacing:3px;text-transform:uppercase}.intro h1{margin:0;color:#f4ecd7;
      font:400 47px/1.05 Georgia,"Times New Roman",serif;letter-spacing:-1px}.intro p:last-child{margin:20px 0 0;
      color:#aeb8cc;font-size:17px;line-height:1.55}
    .routes{position:absolute;left:384px;right:62px;top:80px;bottom:64px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
    .route{position:relative;display:flex;flex-direction:column;align-items:center;border:1px solid rgba(174,184,204,.27);
      border-radius:22px;padding:24px 22px;background:rgba(3,8,17,.7);box-shadow:0 25px 55px rgba(0,0,0,.3)}
    .route-label{align-self:flex-start;margin:0 0 8px;color:#d7a84d;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase}
    .route h2{align-self:flex-start;margin:0 0 20px;color:#f4ecd7;font:400 25px/1.1 Georgia,"Times New Roman",serif}
    .route img{display:block;max-width:100%;border:1px solid #3b455e;border-radius:12px;box-shadow:0 18px 38px rgba(0,0,0,.35)}
    .popup img{width:350px}.devtools img{width:460px}
    .route-note{margin:auto 4px 0;color:#94a4ba;font-size:13px;line-height:1.45;text-align:center}
    .connector{position:absolute;left:338px;top:385px;width:44px;height:1px;background:linear-gradient(90deg,#4abeb2,#d7a84d)}
    .connector:after{content:"";position:absolute;right:-1px;top:-4px;width:9px;height:9px;border-radius:50%;background:#d7a84d}
  `;
  const body = `<main><header><div class="mark">${markSvg}</div><div class="brand">DBOPFS <span>STUDIO</span></div></header>` +
    `<section class="intro"><p class="eyebrow">Choose the target</p><h1>Connect Studio to the site you’re debugging.</h1>` +
    `<p>Use the toolbar for the current site or the dedicated DBOPFS Studio launcher in DevTools for the inspected site.</p></section>` +
    `<span class="connector" aria-hidden="true"></span><section class="routes">` +
    `<article class="route popup"><p class="route-label">Toolbar · current site</p><h2>Open Studio</h2>` +
    `<img src="${bytesAsDataUrl(surfaces.popup)}" alt=""><p class="route-note">Connects to the active HTTP(S) tab.</p></article>` +
    `<article class="route devtools"><p class="route-label">DevTools · inspected site</p><h2>Open Studio window</h2>` +
    `<img src="${bytesAsDataUrl(surfaces.devtools)}" alt=""><p class="route-note">Stays bound to the page inspected by DevTools.</p></article>` +
    `</section></main>`;
  await setCanvas(
    page,
    1280,
    800,
    baseDocument(body, css),
    { path: outputPath('chrome', 'screenshots', screenshotNames[1]) }
  );
}

async function captureSurface(browser, origin, kind) {
  const page = await browser.newPage();
  const isPopup = kind === 'popup';
  await page.evaluateOnNewDocument((surface) => {
    const tab = { id: 17, url: 'https://app.example/dashboard' };
    const chromeStub = globalThis.chrome || {};
    chromeStub.runtime = { id: 'store-capture', sendMessage: async () => ({ ok: true }) };
    chromeStub.tabs = {
      get: async () => tab,
      query: async () => [tab]
    };
    if (surface === 'devtools') {
      chromeStub.devtools = { inspectedWindow: { tabId: tab.id } };
    }
    globalThis.chrome = chromeStub;
  }, kind);

  try {
    const width = isPopup ? 350 : 460;
    const initialHeight = isPopup ? 360 : 480;
    await page.setViewport({ width, height: initialHeight, deviceScaleFactor: 1 });
    const pageName = isPopup ? 'popup/index.html' : 'devtools/panel.html';
    await page.goto(`${origin}/${pageName}`, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.waitForFunction(() => document.querySelector('#site-title')?.textContent === 'https://app.example');
    const height = await page.evaluate(() => Math.ceil(document.body.scrollHeight));
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await settle(page);
    return await page.screenshot({ type: 'png', captureBeyondViewport: false });
  } finally {
    await page.close();
  }
}

async function captureConnectionSurfaces(browser, origin) {
  const [popup, devtools] = await Promise.all([
    captureSurface(browser, origin, 'popup'),
    captureSurface(browser, origin, 'devtools')
  ]);
  return { devtools, popup };
}

async function renderOperaScreenshot(page, sourcePath, destinationPath) {
  const dataUrl = await asDataUrl(sourcePath);
  const css = `
    *{box-sizing:border-box}
    html,body{width:612px;height:408px;margin:0;overflow:hidden;background:#fff}
    body{display:grid;place-items:center}
    img{display:block;width:588px;height:367.5px;object-fit:cover;outline:1px solid #c9ced8;
      box-shadow:0 8px 22px rgba(21,28,45,.18)}
  `;
  await setCanvas(
    page,
    612,
    408,
    baseDocument(`<img src="${dataUrl}" alt="">`, css),
    { path: destinationPath }
  );
}

async function clickRecord(page, recordName) {
  await page.evaluate((name) => {
    const row = document.querySelector(`[data-record="${CSS.escape(name)}"]`);
    if (!row) throw new Error(`Record row not found: ${name}`);
    row.click();
  }, recordName);
  await page.waitForFunction(
    (name) => document.querySelector('#inspector-name')?.textContent === name &&
      !document.querySelector('#inspector-content')?.hidden,
    {},
    recordName
  );
  await settle(page);
}

async function captureStudioScreenshots(browser, origin) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.evaluateOnNewDocument((timestamp) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...arguments_) {
        super(...(arguments_.length ? arguments_ : [timestamp]));
      }
      static now() { return timestamp; }
    }
    Object.defineProperty(globalThis, 'Date', { configurable: true, value: FixedDate });
  }, fixedTimestamp);
  await page.emulateTimezone('America/Chicago');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  try {
    await page.goto(`${origin}/studio/index.html?demo=1`, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.waitForFunction(() => document.querySelector('#status-connection')?.textContent === 'Connected');
    await settle(page);

    const screenshotDirectory = outputPath('chrome', 'screenshots');
    await mkdir(screenshotDirectory, { recursive: true });
    await capturePng(page, path.join(screenshotDirectory, screenshotNames[0]));

    await page.click('#browse-button');
    await page.waitForSelector('#explorer-view.is-active');
    await settle(page);

    await clickRecord(page, 'field-notes.json');
    await capturePng(page, path.join(screenshotDirectory, screenshotNames[2]));

    await clickRecord(page, 'readme.md');
    await capturePng(page, path.join(screenshotDirectory, screenshotNames[3]));

    await clickRecord(page, 'constellation-map.pdf');
    await page.waitForSelector('#open-native:not([hidden])');
    await settle(page);
    await capturePng(page, path.join(screenshotDirectory, screenshotNames[4]));

    if (errors.length) {
      throw new Error(`Studio raised errors while rendering store screenshots:\n- ${errors.join('\n- ')}`);
    }
  } finally {
    await page.close();
  }
}

async function copySharedAssets() {
  for (const name of screenshotNames) {
    await copyAsset(
      outputPath('chrome', 'screenshots', name),
      outputPath('edge', 'screenshots', name)
    );
  }
  await copyAsset(
    outputPath('chrome', 'promo', 'small-promo-440x280.png'),
    outputPath('edge', 'promo', 'small-promo-440x280.png')
  );
  await copyAsset(
    outputPath('chrome', 'promo', 'marquee-promo-1400x560.png'),
    outputPath('edge', 'promo', 'large-promo-1400x560.png')
  );
}

async function copyStoreIcons() {
  await copyAsset(
    path.join(extensionRoot, 'assets', 'icons', 'icon-128.png'),
    outputPath('chrome', 'icon', 'store-icon-128x128.png')
  );
  await copyAsset(
    path.join(projectRoot, 'assets', 'opera-store-icon-64x64.png'),
    outputPath('opera', 'icons', 'icon-64x64.png')
  );
}

export async function renderStoreAssets() {
  const executablePath = await findChromium();
  const server = await createStaticServer({ root: extensionRoot });
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      pipe: true,
      args: ['--force-color-profile=srgb', '--lang=en-US']
    });
    const connectionSurfaces = await captureConnectionSurfaces(browser, server.origin);
    await captureStudioScreenshots(browser, server.origin);
    const canvas = await browser.newPage();
    try {
      const markSvg = await readFile(
        path.join(extensionRoot, 'assets', 'icons', 'mark.svg'),
        'utf8'
      );
      const dashboardPath = outputPath('chrome', 'screenshots', screenshotNames[0]);
      await renderEdgeLogo(canvas, markSvg);
      await renderConnectionScreenshot(canvas, markSvg, connectionSurfaces);
      await renderSmallPromo(canvas, markSvg);
      await renderOperaPromo(canvas, markSvg);
      await renderLargePromo(canvas, markSvg, await asDataUrl(dashboardPath));
      await renderOperaScreenshot(
        canvas,
        dashboardPath,
        outputPath('opera', 'screenshots', '01-dashboard-612x408.png')
      );
      await renderOperaScreenshot(
        canvas,
        outputPath('chrome', 'screenshots', screenshotNames[2]),
        outputPath('opera', 'screenshots', '02-json-inspector-612x408.png')
      );
    } finally {
      await canvas.close();
    }
    await copySharedAssets();
    await copyStoreIcons();
  } finally {
    await browser?.close();
    await server.close();
  }

  const assetManifest = await createStoreAssetManifest();
  await writeOutput(
    outputPath('asset-manifest.json'),
    `${JSON.stringify(assetManifest, null, 2)}\n`
  );
  return validateStoreAssets();
}

if (isMainModule(import.meta.url)) {
  renderStoreAssets()
    .then((result) => {
      console.log(`Rendered and validated ${result.files} store images in ${relativePath(result.root)}.`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
