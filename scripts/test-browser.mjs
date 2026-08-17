import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { createStaticServer } from './static-server.mjs';
import {
  extensionRoot,
  isMainModule,
  projectRoot,
  relativePath,
  walkFiles
} from './project.mjs';

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function executable(filePath) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandPath(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean) : null;
}

export async function findChromium() {
  const requested = readOption('--browser') || process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  const candidates = [requested];

  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    for (const command of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      candidates.push(commandPath(command));
    }
  }

  for (const candidate of candidates.filter(Boolean)) {
    if (await executable(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Chrome, Edge, or Chromium was not found. Set CHROME_PATH or pass --browser <executable>.'
  );
}

function mergeRanges(ranges, textLength) {
  const sorted = ranges
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(textLength, start)),
      end: Math.max(0, Math.min(textLength, end))
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

async function writeCoverage(entries, origin, threshold) {
  const coverageDirectory = path.join(projectRoot, 'coverage');
  const sourceFiles = (await walkFiles(extensionRoot))
    .filter((filePath) => ['.js', '.mjs'].includes(path.extname(filePath).toLowerCase()))
    .filter((filePath) => !relativePath(filePath).startsWith('extension/vendor/'));
  const rangesByPath = new Map();

  for (const entry of entries) {
    let sourceName;
    if (entry.url.startsWith(`${origin}/extension/`)) {
      sourceName = decodeURIComponent(new URL(entry.url).pathname).replace(/^\/+/, '');
    } else if (entry.url.startsWith('chrome-extension://')) {
      sourceName = `extension/${decodeURIComponent(new URL(entry.url).pathname).replace(/^\/+/, '')}`;
    } else {
      continue;
    }
    const ranges = rangesByPath.get(sourceName) || [];
    ranges.push(...entry.ranges);
    rangesByPath.set(sourceName, ranges);
  }

  const files = [];
  let totalBytes = 0;
  let usedBytes = 0;
  for (const filePath of sourceFiles) {
    const sourceName = relativePath(filePath);
    const text = await readFile(filePath, 'utf8');
    const ranges = mergeRanges(rangesByPath.get(sourceName) || [], text.length);
    const used = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    totalBytes += text.length;
    usedBytes += used;
    files.push({
      path: sourceName,
      ranges,
      totalBytes: text.length,
      usedBytes: used
    });
  }

  const percent = totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 100;
  const summary = {
    generatedAt: new Date().toISOString(),
    metric: 'V8 precise JavaScript byte coverage',
    percent,
    threshold,
    totalBytes,
    usedBytes
  };
  await mkdir(coverageDirectory, { recursive: true });
  await writeFile(path.join(coverageDirectory, 'coverage.json'), `${JSON.stringify({ files, summary }, null, 2)}\n`);
  await writeFile(path.join(coverageDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Extension coverage: ${percent}% (${usedBytes}/${totalBytes} JavaScript bytes).`);
  console.log(`Coverage report: ${relativePath(path.join(coverageDirectory, 'coverage.json'))}`);

  if (!files.length) {
    throw new Error('No extension JavaScript files were found for coverage.');
  }
  if (percent < threshold) {
    throw new Error(`Coverage ${percent}% is below the required ${threshold}%.`);
  }
  return summary;
}

async function exercisePageBridge(worker, origin) {
  const result = await worker.evaluate(async (pageOrigin) => {
    const [tab] = await chrome.tabs.query({ url: `${pageOrigin}/tests/browser/index.html` });
    if (!Number.isInteger(tab?.id)) {
      throw new Error('The browser test tab is unavailable to the extension.');
    }
    const sendLegacy = async (action, data = {}) => {
      const response = await chrome.tabs.sendMessage(tab.id, {
        channel: 'dbopfs-studio',
        version: 1,
        action,
        data
      });
      if (!response?.ok) {
        throw new Error(`${action} failed: ${response?.error?.message || 'unknown error'}`);
      }
      return response.data;
    };

    const applicationId = 'browser-coverage';
    const table = 'coverage';
    await sendLegacy('dashboard', { includeRecords: false });
    const createApplicationRequest = {
      protocol: 'dbopfs-studio',
      version: 1,
      type: 'request',
      requestId: 'browser-create-application',
      operation: 'create',
      payload: { applicationId, kind: 'application' }
    };
    const createdApplication = await chrome.tabs.sendMessage(tab.id, createApplicationRequest);
    if (!createdApplication?.ok) {
      throw new Error(
        `create application failed: ${createdApplication?.error?.message || 'unknown error'}`
      );
    }
    await sendLegacy('createTable', { applicationId, table });
    await sendLegacy('createRecord', {
      applicationId,
      table,
      record: 'record.json',
      text: '{"status":"created"}'
    });
    await sendLegacy('writeRecord', {
      applicationId,
      table,
      record: 'record.json',
      text: '{"status":"updated"}'
    });
    await sendLegacy('createRecord', {
      applicationId,
      table,
      record: 'invalid-utf8.js',
      text: ''
    });
    await sendLegacy('writeRecord', {
      applicationId,
      table,
      record: 'invalid-utf8.js',
      base64: '/wBh'
    });
    await sendLegacy('createRecord', {
      applicationId,
      table,
      record: 'bom.js',
      text: ''
    });
    await sendLegacy('writeRecord', {
      applicationId,
      table,
      record: 'bom.js',
      base64: '77u/Y29uc3QgeD0xOw=='
    });
    const unicodeText = 'café · 漢字 · 🧙';
    await sendLegacy('createRecord', {
      applicationId,
      table,
      record: 'unicode.md',
      text: unicodeText
    });
    const record = await sendLegacy('readRecord', {
      applicationId,
      table,
      record: 'record.json'
    });
    const invalidUtf8 = await sendLegacy('readRecord', {
      applicationId,
      table,
      record: 'invalid-utf8.js'
    });
    const bom = await sendLegacy('readRecord', {
      applicationId,
      table,
      record: 'bom.js'
    });
    const unicode = await sendLegacy('readRecord', {
      applicationId,
      table,
      record: 'unicode.md'
    });
    await sendLegacy('rawWrite', { path: ['coverage.txt'], data: 'raw coverage' });
    const raw = await sendLegacy('rawRead', { path: ['coverage.txt'] });
    const root = await sendLegacy('rawList', { path: [] });
    const exported = await sendLegacy('export', { applicationId, pretty: false });
    const scanned = await sendLegacy('scan', { includeRecords: true });
    const typedRequest = {
      protocol: 'dbopfs-studio',
      version: 1,
      type: 'request',
      requestId: 'browser-typed-connect',
      operation: 'connect',
      payload: { applicationId }
    };
    const connected = await chrome.tabs.sendMessage(tab.id, typedRequest);
    await sendLegacy('deleteRecord', { applicationId, table, record: 'record.json' });
    await sendLegacy('deleteRecord', { applicationId, table, record: 'invalid-utf8.js' });
    await sendLegacy('deleteRecord', { applicationId, table, record: 'bom.js' });
    await sendLegacy('deleteRecord', { applicationId, table, record: 'unicode.md' });
    await sendLegacy('deleteTable', { applicationId, table });

    return {
      bom,
      connected,
      exportText: exported.text,
      invalidUtf8,
      raw,
      record,
      rootEntries: root.entries,
      scanned,
      unicode
    };
  }, origin);

  if (result.record.text !== '{"status":"updated"}' || result.raw.text !== 'raw coverage') {
    throw new Error('The installed page bridge changed record or raw OPFS contents.');
  }
  if (result.invalidUtf8.encoding !== 'base64' || result.invalidUtf8.base64 !== '/wBh') {
    throw new Error('A text-looking record with invalid UTF-8 was not preserved byte-for-byte.');
  }
  if (result.bom.encoding !== 'text' || result.bom.text !== '\uFEFFconst x=1;') {
    throw new Error('A UTF-8 BOM was not preserved in editable text.');
  }
  if (result.unicode.encoding !== 'text' || result.unicode.text !== 'café · 漢字 · 🧙') {
    throw new Error('Valid multibyte UTF-8 text was not preserved exactly.');
  }
  if (!result.rootEntries.some((entry) => entry.name === 'apps') ||
      !result.rootEntries.some((entry) => entry.name === 'coverage.txt')) {
    throw new Error('Raw OPFS listing omitted expected DBOPFS or raw entries.');
  }
  if (!result.exportText.includes('dbopfs-studio-export') ||
      result.scanned.module?.primaryDataLayer !== true) {
    throw new Error('DBOPFS scan/export metadata is incomplete.');
  }
  if (!result.connected?.ok || result.connected.result?.applicationId !== 'browser-coverage') {
    throw new Error('A typed DBOPFS connect request failed.');
  }
  console.log('PASS Installed page bridge exercised DBOPFS and raw OPFS operations.');
}

async function smokeTestLoadedExtension(browser, coverageEnabled, origin, distractorOrigin) {
  const errors = [];
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' &&
      target.url().endsWith('/background/service-worker.js'),
    { timeout: 15_000 }
  );
  const worker = await workerTarget.worker();
  const runtime = await worker.evaluate(() => ({
    id: chrome.runtime.id,
    manifest: chrome.runtime.getManifest()
  }));
  if (!runtime.id || runtime.manifest.manifest_version !== 3) {
    throw new Error('Chrome did not load DBOPFS Studio as a Manifest V3 extension.');
  }
  await exercisePageBridge(worker, origin);
  const coverageEntries = [];

  const inspectedTabId = await worker.evaluate(async (pageOrigin) => {
    const [tab] = await chrome.tabs.query({ url: `${pageOrigin}/tests/browser/index.html` });
    return tab?.id;
  }, origin);
  if (!Number.isInteger(inspectedTabId)) {
    throw new Error('The DevTools launcher test could not identify the inspected tab.');
  }
  const distractor = await browser.newPage();
  await distractor.goto(`${distractorOrigin}/tests/fixture/index.html`, {
    waitUntil: 'networkidle0',
    timeout: 30_000
  });
  await distractor.waitForFunction(
    () => globalThis.__DBOPFS_FIXTURE__?.ready === true,
    { timeout: 20_000 }
  );
  await distractor.bringToFront();
  const devtoolsPanel = await browser.newPage();
  if (coverageEnabled) {
    await devtoolsPanel.coverage.startJSCoverage({ resetOnNavigation: false });
  }
  await devtoolsPanel.goto(
    `chrome-extension://${runtime.id}/devtools/panel.html?tab=${inspectedTabId}`,
    { waitUntil: 'networkidle0', timeout: 30_000 }
  );
  await devtoolsPanel.waitForFunction(
    (pageOrigin) => document.querySelector('#site-title')?.textContent === pageOrigin,
    { timeout: 10_000 },
    origin
  );
  await distractor.bringToFront();
  const standaloneUrl = `chrome-extension://${runtime.id}/studio/index.html?tab=${inspectedTabId}`;
  const standaloneTargetPromise = browser.waitForTarget(
    (target) => target.url() === standaloneUrl,
    { timeout: 15_000 }
  );
  await devtoolsPanel.evaluate(() => document.querySelector('#open-studio-window')?.click());
  let standaloneTarget;
  try {
    standaloneTarget = await standaloneTargetPromise;
  } catch (error) {
    const panelState = await devtoolsPanel.evaluate(() => ({
      disabled: document.querySelector('#open-studio-window')?.disabled,
      status: document.querySelector('#site-status')?.textContent
    }));
    const targetUrls = browser.targets().map((target) => target.url());
    throw new Error(
      `The DevTools Studio window did not open: ${JSON.stringify({ panelState, targetUrls })}`,
      { cause: error }
    );
  }
  const standaloneStudio = await standaloneTarget.asPage();
  try {
    await standaloneStudio.waitForFunction(
      (pageOrigin) => document.querySelector('#status-connection')?.textContent === 'Connected' &&
        document.querySelector('#origin-label')?.textContent === pageOrigin &&
        document.querySelector('[data-open-app="browser-coverage"]'),
      { timeout: 15_000 },
      origin
    );
  } catch (error) {
    const studioState = await standaloneStudio.evaluate(() => ({
      applications: Array.from(document.querySelectorAll('[data-open-app]'), (item) => item.dataset.openApp),
      connection: document.querySelector('#status-connection')?.textContent,
      origin: document.querySelector('#origin-label')?.textContent,
      toasts: Array.from(document.querySelectorAll('.toast'), (item) => item.textContent)
    }));
    throw new Error(`The DevTools Studio bound the wrong origin: ${JSON.stringify(studioState)}`, {
      cause: error
    });
  }
  const reuseResponse = await devtoolsPanel.evaluate(async (tabId) => chrome.runtime.sendMessage({
    channel: 'dbopfs-studio:background',
    action: 'openStudioWindow',
    tabId
  }), inspectedTabId);
  if (!reuseResponse?.ok) {
    throw new Error(`The DevTools Studio window could not be reused: ${reuseResponse?.error}`);
  }
  const standaloneCount = browser.targets()
    .filter((target) => target.type() === 'page' && target.url() === standaloneUrl)
    .length;
  if (standaloneCount !== 1) {
    const browserState = await worker.evaluate(async () => ({
      tabs: (await chrome.tabs.query({})).map((tab) => ({
        id: tab.id,
        pendingUrl: tab.pendingUrl,
        url: tab.url,
        windowId: tab.windowId
      })),
      windows: (await chrome.windows.getAll()).map((item) => ({ id: item.id, type: item.type }))
    }));
    throw new Error(
      `The DevTools launcher duplicated its Studio window: ${JSON.stringify({ standaloneCount, browserState })}`
    );
  }
  await standaloneStudio.close();
  if (coverageEnabled) {
    coverageEntries.push(...await devtoolsPanel.coverage.stopJSCoverage());
  }
  await devtoolsPanel.close();
  await distractor.close();

  const popup = await browser.newPage();
  if (coverageEnabled) {
    await popup.coverage.startJSCoverage({ resetOnNavigation: false });
  }
  await popup.goto(`chrome-extension://${runtime.id}/${runtime.manifest.action.default_popup}`, {
    waitUntil: 'networkidle0',
    timeout: 30_000
  });
  const popupTitle = await popup.title();
  if (!popupTitle.includes('DBOPFS')) {
    throw new Error('The installed extension popup did not render its DBOPFS title.');
  }
  if (coverageEnabled) {
    coverageEntries.push(...await popup.coverage.stopJSCoverage());
  }
  await popup.close();

  const studio = await browser.newPage();
  studio.on('pageerror', (error) => errors.push(error.message));
  if (coverageEnabled) {
    await studio.coverage.startJSCoverage({ resetOnNavigation: false });
  }
  await studio.goto(`chrome-extension://${runtime.id}/studio/index.html?demo=1`, {
    waitUntil: 'networkidle0',
    timeout: 30_000
  });
  await studio.waitForFunction(
    () => document.querySelector('#status-connection')?.textContent === 'Connected',
    { timeout: 15_000 }
  );
  const boundStudioUrl = studio.url();
  await studio.click('.product');
  if (studio.url() !== boundStudioUrl) {
    throw new Error('The Studio brand control discarded its bound tab URL.');
  }
  await studio.evaluate(() => document.querySelector('[data-open-app]')?.click());
  await studio.waitForSelector('#record-rows tr');
  const emptyState = await studio.evaluate(() => {
    const element = document.querySelector('#records-empty');
    return { display: getComputedStyle(element).display, hidden: element.hidden };
  });
  if (!emptyState.hidden || emptyState.display !== 'none') {
    throw new Error(`The records empty state remained visible with records: ${JSON.stringify(emptyState)}`);
  }
  await studio.evaluate(() => document.querySelector('#record-rows tr')?.click());
  try {
    await studio.waitForFunction(
      () => document.querySelector('#inspector-content')?.hidden === false,
      { timeout: 10_000 }
    );
  } catch (error) {
    const state = await studio.evaluate(() => ({
      errors: Array.from(document.querySelectorAll('.toast')).map((item) => item.textContent),
      rows: document.querySelectorAll('#record-rows tr').length,
      selected: document.querySelector('#status-selection')?.textContent,
      view: document.querySelector('[data-view-panel].is-active')?.id
    }));
    throw new Error(`Studio record inspector did not open: ${JSON.stringify(state)}`, { cause: error });
  }
  await studio.evaluate(() => {
    const editor = document.querySelector('#record-editor');
    editor.value = `${editor.value}\n`;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await studio.click('#save-record');
  await studio.waitForFunction(
    () => document.querySelector('#editor-status')?.textContent !== 'Unsaved changes',
    { timeout: 10_000 }
  );
  await studio.click('#close-inspector');
  await studio.click('[data-view="activity"]');
  await studio.click('#clear-activity');
  await studio.click('#help-button');
  await studio.waitForFunction(() => document.querySelector('#about-dialog')?.open === true);
  await studio.click('#about-close');

  await studio.evaluate(() => {
    const application = document.querySelector('[data-open-app="arcane-library"]');
    application?.click();
  });
  await studio.waitForSelector('[data-app="arcane-library"][data-table="documents"]', {
    visible: true,
    timeout: 10_000
  });
  await studio.evaluate(() => {
    globalThis.__DBOPFS_NATIVE_OPENS__ = [];
    globalThis.__DBOPFS_REVOKED_URLS__ = [];
    window.open = (...argumentsList) => {
      globalThis.__DBOPFS_NATIVE_OPENS__.push(argumentsList);
      return null;
    };
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      globalThis.__DBOPFS_REVOKED_URLS__.push(url);
      revokeObjectUrl(url);
    };
    document.querySelector('[data-app="arcane-library"][data-table="documents"]')?.click();
  });
  await studio.waitForSelector('[data-record="constellation-map.pdf"]', {
    visible: true,
    timeout: 10_000
  });
  await studio.evaluate(() => {
    document.querySelector('[data-record="constellation-map.pdf"]')?.click();
    document.querySelector('[data-record="readme.md"]')?.click();
  });
  await studio.waitForFunction(
    () => document.querySelector('#inspector-name')?.textContent === 'readme.md' &&
      document.querySelector('#preview h1')?.textContent === 'readme.md',
    { timeout: 10_000 }
  );
  await studio.evaluate(() => new Promise((resolve) => setTimeout(resolve, 140)));
  const racedRecordState = await studio.evaluate(() => ({
    inspector: document.querySelector('#inspector-name')?.textContent,
    source: document.querySelector('#record-editor')?.value
  }));
  if (racedRecordState.inspector !== 'readme.md' ||
      !racedRecordState.source?.startsWith('# readme.md')) {
    throw new Error(`A stale record read replaced the current inspector: ${JSON.stringify(racedRecordState)}`);
  }
  await studio.evaluate(() => document.querySelector('[data-record="constellation-map.pdf"]')?.click());
  try {
    await studio.waitForFunction(
      () => document.querySelector('#inspector-content')?.hidden === false &&
        document.querySelector('#record-source')?.hidden === true &&
        document.querySelector('#save-record')?.hidden === true &&
        document.querySelector('#open-native')?.hidden === false,
      { timeout: 10_000 }
    );
  } catch (error) {
    const state = await studio.evaluate(() => ({
      sourceHidden: document.querySelector('#record-source')?.hidden,
      inspectorHidden: document.querySelector('#inspector-content')?.hidden,
      nativeHidden: document.querySelector('#open-native')?.hidden,
      saveHidden: document.querySelector('#save-record')?.hidden,
      selected: document.querySelector('#inspector-name')?.textContent,
      toasts: Array.from(document.querySelectorAll('.toast'), (item) => item.textContent)
    }));
    throw new Error(`The PDF inspector did not open: ${JSON.stringify(state)}`, { cause: error });
  }
  const pdfState = await studio.evaluate(() => ({
    sourceHidden: document.querySelector('#record-source').hidden,
    nativeHidden: document.querySelector('#open-native').hidden,
    nativeLabel: document.querySelector('#open-native').textContent,
    objectType: document.querySelector('#preview')?.querySelector('.native-file-card') ? 'application/pdf' : '',
    previewText: document.querySelector('#preview').textContent,
    saveHidden: document.querySelector('#save-record').hidden
  }));
  if (!pdfState.sourceHidden || !pdfState.saveHidden || pdfState.nativeHidden ||
      !/PDF viewer/i.test(pdfState.nativeLabel) || !/PDF/i.test(pdfState.previewText)) {
    throw new Error(`The PDF preview did not route to Chromium's native viewer: ${JSON.stringify(pdfState)}`);
  }
  await studio.click('#print-record');
  await studio.waitForFunction(() => globalThis.__DBOPFS_NATIVE_OPENS__?.length === 1);
  const nativeOpen = await studio.evaluate(() => globalThis.__DBOPFS_NATIVE_OPENS__[0]);
  if (!String(nativeOpen[0]).startsWith('blob:') || nativeOpen[1] !== '_blank') {
    throw new Error(`PDF printing did not use the native-open route: ${JSON.stringify(nativeOpen)}`);
  }

  await studio.evaluate(() => document.querySelector('[data-record="readme.md"]')?.click());
  try {
    await studio.waitForFunction(
      () => document.querySelector('#viewer-mode')?.textContent === 'Rendered' &&
        document.querySelector('#preview')?.hidden === false &&
        document.querySelector('#preview h1')?.textContent === 'readme.md',
      { timeout: 10_000 }
    );
  } catch (error) {
    const state = await studio.evaluate(() => ({
      heading: document.querySelector('#preview h1')?.textContent,
      inspector: document.querySelector('#inspector-name')?.textContent,
      preview: document.querySelector('#preview')?.textContent,
      previewHidden: document.querySelector('#preview')?.hidden,
      source: document.querySelector('#record-editor')?.value,
      sourceHidden: document.querySelector('#record-source')?.hidden,
      toasts: Array.from(document.querySelectorAll('.toast'), (item) => item.textContent),
      viewerLabel: document.querySelector('#viewer-mode')?.textContent
    }));
    throw new Error(`The Markdown viewer did not open: ${JSON.stringify(state)}`, { cause: error });
  }
  const markdownState = await studio.evaluate(() => ({
    raw: document.querySelector('#record-editor')?.value,
    rendered: document.querySelector('#preview')?.textContent,
    revoked: globalThis.__DBOPFS_REVOKED_URLS__?.length || 0,
    sourceHidden: document.querySelector('#record-source')?.hidden,
    viewerSelected: document.querySelector('#viewer-mode')?.getAttribute('aria-selected')
  }));
  if (!markdownState.raw?.startsWith('# readme.md') || !markdownState.rendered?.includes('DBOPFS') ||
      !markdownState.sourceHidden || markdownState.viewerSelected !== 'true' || markdownState.revoked < 1) {
    throw new Error(`Markdown did not render without changing its source: ${JSON.stringify(markdownState)}`);
  }
  await studio.click('#source-mode');
  const sourceState = await studio.evaluate(() => ({
    previewHidden: document.querySelector('#preview')?.hidden,
    raw: document.querySelector('#record-editor')?.value,
    sourceHidden: document.querySelector('#record-source')?.hidden
  }));
  if (!sourceState.previewHidden || sourceState.sourceHidden || !sourceState.raw?.startsWith('# readme.md')) {
    throw new Error(`Markdown source mode is unavailable: ${JSON.stringify(sourceState)}`);
  }
  await studio.focus('#source-mode');
  await studio.keyboard.press('ArrowLeft');
  await studio.waitForFunction(
    () => document.querySelector('#viewer-mode')?.getAttribute('aria-selected') === 'true' &&
      document.querySelector('#preview')?.hidden === false,
    { timeout: 10_000 }
  );

  await studio.evaluate(() => document.querySelector('[data-record="worker.js"]')?.click());
  await studio.waitForFunction(
    () => document.querySelector('#viewer-mode')?.textContent === 'Beautified' &&
      document.querySelector('#preview code')?.textContent?.includes('\n'),
    { timeout: 10_000 }
  );
  const javascriptState = await studio.evaluate(() => ({
    formatted: document.querySelector('#preview code')?.textContent,
    raw: document.querySelector('#record-editor')?.value
  }));
  if (javascriptState.raw !== 'export function orbit(items){return items.map((item)=>({name:item.name,active:true}));}' ||
      javascriptState.formatted === javascriptState.raw || !javascriptState.formatted?.includes('\n')) {
    throw new Error(`JavaScript formatting changed or failed to format the source: ${JSON.stringify(javascriptState)}`);
  }

  await studio.click('[data-app="arcane-library"][data-table="images"]');
  await studio.waitForSelector('[data-record="pixel.png"]', { visible: true, timeout: 10_000 });
  await studio.evaluate(() => document.querySelector('[data-record="pixel.png"]')?.click());
  await studio.waitForSelector('#preview img[src^="blob:"]', { visible: true, timeout: 10_000 });
  const imageState = await studio.evaluate(async () => {
    const image = document.querySelector('#preview img');
    await image.decode();
    const blob = await (await fetch(image.src)).blob();
    return { height: image.naturalHeight, type: blob.type, width: image.naturalWidth };
  });
  if (imageState.type !== 'image/png' || imageState.width !== 1 || imageState.height !== 1) {
    throw new Error(`The native image preview did not decode correctly: ${JSON.stringify(imageState)}`);
  }
  await studio.evaluate(() => document.querySelector('[data-record="sample.mp3"]')?.click());
  await studio.waitForFunction(
    () => document.querySelector('#preview audio')?.controls === true &&
      document.querySelector('#preview audio')?.src.startsWith('blob:') &&
      document.querySelector('#preview audio')?.readyState >= 1 &&
      document.querySelector('#preview audio')?.error === null,
    { timeout: 10_000 }
  );
  const audioState = await studio.evaluate(async () => {
    const media = document.querySelector('#preview audio');
    const blob = await (await fetch(media.src)).blob();
    return { duration: media.duration, type: blob.type };
  });
  if (audioState.type !== 'audio/mpeg' || !(audioState.duration > 0)) {
    throw new Error(`The native audio preview did not load metadata: ${JSON.stringify(audioState)}`);
  }
  await studio.evaluate(() => document.querySelector('[data-record="sample.mp4"]')?.click());
  await studio.waitForFunction(
    () => document.querySelector('#preview video')?.controls === true &&
      document.querySelector('#preview video')?.src.startsWith('blob:') &&
      document.querySelector('#preview video')?.readyState >= 1 &&
      document.querySelector('#preview video')?.error === null,
    { timeout: 10_000 }
  );
  const videoState = await studio.evaluate(async () => {
    const media = document.querySelector('#preview video');
    const blob = await (await fetch(media.src)).blob();
    return {
      duration: media.duration,
      height: media.videoHeight,
      type: blob.type,
      width: media.videoWidth
    };
  });
  if (videoState.type !== 'video/mp4' || !(videoState.duration > 0) ||
      videoState.width !== 16 || videoState.height !== 16) {
    throw new Error(`The native video preview did not load metadata: ${JSON.stringify(videoState)}`);
  }

  const studioState = await studio.evaluate(() => ({
    module: document.querySelector('#profile-module')?.textContent,
    title: document.title,
    usage: document.querySelector('#usage-value')?.textContent
  }));
  if (!studioState.title.includes('DBOPFS') || !studioState.module?.includes('DBOPFS')) {
    throw new Error('The installed Studio page did not render its DBOPFS dashboard.');
  }
  if (!studioState.usage || studioState.usage === '—') {
    throw new Error('The installed Studio dashboard did not render storage usage.');
  }
  if (errors.length) {
    throw new Error(`The installed Studio page raised errors:\n- ${errors.join('\n- ')}`);
  }
  if (coverageEnabled) {
    coverageEntries.push(...await studio.coverage.stopJSCoverage());
  }
  await studio.close();

  const printId = 'browser-coverage-print';
  await worker.evaluate(async (id) => chrome.storage.session.set({
    [`print:${id}`]: {
      kind: 'text',
      name: 'coverage.md',
      path: 'apps/browser-coverage/notes/coverage.md',
      text: '# Printable DBOPFS Studio record\n\n**Rendered safely.** [blocked](javascript:alert(1))\n\n<script>globalThis.compromised=true</script>',
      type: 'text/markdown'
    }
  }), printId);
  const printPage = await browser.newPage();
  await printPage.evaluateOnNewDocument(() => {
    window.print = () => {
      globalThis.__DBOPFS_PRINT_CALLED__ = true;
    };
  });
  if (coverageEnabled) {
    await printPage.coverage.startJSCoverage({ resetOnNavigation: false });
  }
  await printPage.goto(`chrome-extension://${runtime.id}/print/index.html?id=${printId}`, {
    waitUntil: 'networkidle0',
    timeout: 30_000
  });
  await printPage.waitForFunction(
    () => document.querySelector('#print-content h1')?.textContent ===
      'Printable DBOPFS Studio record' &&
      document.querySelector('#print-content strong')?.textContent === 'Rendered safely.' &&
      !document.querySelector('#print-content script, #print-content a') &&
      globalThis.__DBOPFS_PRINT_CALLED__ === true,
    { timeout: 10_000 }
  );
  const consumedPrintPayload = await worker.evaluate(async (id) =>
    (await chrome.storage.session.get(`print:${id}`))[`print:${id}`], printId);
  if (consumedPrintPayload !== undefined) {
    throw new Error('The print view did not remove its one-time session payload.');
  }
  if (coverageEnabled) {
    coverageEntries.push(...await printPage.coverage.stopJSCoverage());
  }
  await printPage.close();

  console.log(
    `PASS Chromium loaded extension ${runtime.id} and exercised its popup, Studio dashboard, and print view.`
  );
  return coverageEntries;
}

export async function runBrowserTests(options = {}) {
  const coverageEnabled = options.coverage ?? process.argv.includes('--coverage');
  const threshold = Number(options.threshold ?? readOption('--threshold') ?? 0);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('Coverage threshold must be a number from 0 through 100.');
  }

  const executablePath = await findChromium();
  const running = await createStaticServer({ root: projectRoot, host: '127.0.0.1', port: 0 });
  let distractor;
  let browser;
  let coverageStarted = false;
  let coverageEntries = [];
  const pageErrors = [];

  try {
    distractor = await createStaticServer({ root: projectRoot, host: '127.0.0.1', port: 0 });
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      pipe: true,
      enableExtensions: [extensionRoot],
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []
    });
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.log(`[browser:error] ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    if (coverageEnabled) {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      coverageStarted = true;
    }

    await page.goto(`${running.origin}/tests/browser/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    await page.waitForFunction(
      () => globalThis.__DBOPFS_TEST_RESULTS__?.complete === true,
      { timeout: 30_000 }
    );
    const result = await page.evaluate(() => globalThis.__DBOPFS_TEST_RESULTS__);

    coverageEntries.push(...await smokeTestLoadedExtension(
      browser,
      coverageEnabled,
      running.origin,
      distractor.origin
    ));
    if (coverageStarted) {
      coverageEntries.push(...await page.coverage.stopJSCoverage());
      coverageStarted = false;
    }
    if (coverageEnabled) {
      await writeCoverage(coverageEntries, running.origin, threshold);
    }

    for (const detail of result.details) {
      const marker = detail.status === 'passed' ? 'PASS' : 'FAIL';
      console.log(
        `${marker} [${detail.suite || 'Browser'}] ${detail.description}` +
        `${detail.error ? ` — ${detail.error}` : ''}`
      );
    }
    for (const suite of result.suites || []) {
      console.log(
        `SUITE ${suite.name}: ${suite.passed}/${suite.total} passed` +
        `${suite.failed ? `, ${suite.failed} failed` : ''}`
      );
    }
    console.log(`TOTAL ${result.passed}/${result.total} vanilla-test cases passed.`);
    if (pageErrors.length) {
      throw new Error(`Uncaught browser errors:\n- ${pageErrors.join('\n- ')}`);
    }
    if (result.failed) {
      throw new Error(`${result.failed} of ${result.total} browser tests failed.`);
    }
    console.log(`${result.passed} browser tests passed in ${path.basename(executablePath)}.`);
    return result;
  } finally {
    if (coverageStarted && browser) {
      const pages = await browser.pages();
      await pages.at(-1)?.coverage.stopJSCoverage().catch(() => {});
    }
    await browser?.close();
    await Promise.all([running.close(), distractor?.close()]);
  }
}

if (isMainModule(import.meta.url)) {
  runBrowserTests()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
