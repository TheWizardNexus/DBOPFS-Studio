import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {
  assert as testAssert,
  combineTestResults,
  createExtensionHarness,
  printTestSummary
} from '../tests/extension/harness.mjs';
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

function printResultDetails(result) {
  for (const detail of result.details) {
    const marker = detail.status === 'passed' ? 'PASS' : 'FAIL';
    const error = typeof detail.error === 'string'
      ? detail.error
      : detail.error?.message;
    console.log(
      `${marker} [${detail.suite || 'Browser'}] ${detail.description}` +
      `${error ? ` — ${error}` : ''}`
    );
  }
}

async function exercisePageBridge(worker, origin, harness) {
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

  await harness.runCase(
    'Integration',
    'extension.smoke.bridge-raw-round-trip',
    'installed page bridge preserves a raw OPFS record',
    () => testAssert(
      result.raw.text === 'raw coverage',
      'The installed page bridge changed raw OPFS contents.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.bridge-invalid-utf8-mode',
    'invalid UTF-8 is returned as base64 by the installed bridge',
    () => testAssert(
      result.invalidUtf8.encoding === 'base64',
      'A text-looking record with invalid UTF-8 was not returned as base64.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.bridge-invalid-utf8-bytes',
    'installed bridge preserves invalid UTF-8 bytes exactly',
    () => testAssert(
      result.invalidUtf8.base64 === '/wBh',
      'Invalid UTF-8 bytes changed during the installed bridge round trip.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.bridge-bom-mode',
    'UTF-8 BOM content remains editable text through the installed bridge',
    () => testAssert(
      result.bom.encoding === 'text',
      'UTF-8 BOM content did not remain editable text.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.bridge-bom-preserved',
    'installed bridge preserves the UTF-8 byte-order mark exactly',
    () => testAssert(
      result.bom.text === '\uFEFFconst x=1;',
      'The installed bridge changed UTF-8 BOM content.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.bridge-unicode-mode',
    'multibyte UTF-8 remains editable text through the installed bridge',
    () => testAssert(
      result.unicode.encoding === 'text',
      'Multibyte UTF-8 did not remain editable text.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.bridge-unicode-preserved',
    'installed bridge preserves multibyte UTF-8 text exactly',
    () => testAssert(
      result.unicode.text === 'café · 漢字 · 🧙',
      'Valid multibyte UTF-8 text was not preserved exactly.'
    )
  );
  await harness.runCase(
    'Integration',
    'extension.smoke.bridge-apps-listing',
    'installed raw OPFS listing includes the DBOPFS applications directory',
    () => testAssert(
      result.rootEntries.some((entry) => entry.name === 'apps'),
      'Raw OPFS listing omitted the DBOPFS applications directory.'
    )
  );
  await harness.runCase(
    'Integration',
    'extension.smoke.bridge-raw-listing',
    'installed raw OPFS listing includes a root-level record',
    () => testAssert(
      result.rootEntries.some((entry) => entry.name === 'coverage.txt'),
      'Raw OPFS listing omitted the root-level record.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.bridge-export-metadata',
    'installed export payload includes its DBOPFS format marker',
    () => testAssert(
      result.exportText.includes('dbopfs-studio-export'),
      'DBOPFS export metadata is incomplete.'
    )
  );
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.bridge-typed-connect-response',
    'typed installed connect request returns success',
    () => testAssert(
      result.connected?.ok,
      'A typed DBOPFS connect request failed.'
    ),
    'inspect the typed installed connect result'
  );
  await harness.runCase(
    'Integration',
    'extension.smoke.bridge-typed-connect-application',
    'typed installed connect returns the requested application identifier',
    () => testAssert(
      result.connected?.result?.applicationId === 'browser-coverage',
      'A typed DBOPFS connect returned the wrong application ID.'
    )
  );
}

async function smokeTestLoadedExtension(
  browser,
  coverageEnabled,
  origin,
  distractorOrigin,
  harness
) {
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
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.runtime-id',
    'installed extension runtime exposes its Chromium extension ID',
    () => testAssert(Boolean(runtime.id), 'Chrome did not expose the installed extension ID.'),
    'exercise the installed extension runtime'
  );
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.runtime-mv3',
    'installed extension runtime reports Manifest V3',
    () => testAssert(
      runtime.manifest.manifest_version === 3,
      'Chrome did not load DBOPFS Studio as a Manifest V3 extension.'
    ),
    'exercise the installed Manifest V3 runtime'
  );
  await exercisePageBridge(worker, origin, harness);
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
  await harness.runRequiredCase(
    'Regression',
    'extension.smoke.devtools-origin',
    'installed DevTools launcher remains bound to its inspected origin',
    () => devtoolsPanel.waitForFunction(
      (pageOrigin) => document.querySelector('#site-title')?.textContent === pageOrigin,
      { timeout: 10_000 },
      origin
    ),
    'launch the inspected origin from DevTools'
  );
  await distractor.bringToFront();
  const standaloneUrl = `chrome-extension://${runtime.id}/studio/index.html?tab=${inspectedTabId}`;
  let standaloneTarget;
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.devtools-window-open',
    'installed DevTools launcher opens its standalone Studio window',
    async () => {
      const standaloneTargetPromise = browser.waitForTarget(
        (target) => target.url() === standaloneUrl,
        { timeout: 15_000 }
      );
      await devtoolsPanel.evaluate(() => document.querySelector('#open-studio-window')?.click());
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
    },
    'inspect the DevTools-opened Studio window'
  );
  const standaloneStudio = await standaloneTarget.asPage();
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.devtools-window-connected',
    'installed DevTools launcher opens a connected Studio window',
    () => standaloneStudio.waitForFunction(
      () => document.querySelector('#status-connection')?.textContent === 'Connected',
      { timeout: 15_000 }
    ),
    'inspect the connected DevTools Studio window'
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.devtools-window-origin',
    'DevTools-opened Studio preserves the inspected origin binding',
    () => standaloneStudio.waitForFunction(
      (pageOrigin) => document.querySelector('#origin-label')?.textContent === pageOrigin,
      { timeout: 15_000 },
      origin
    )
  );
  await harness.runCase(
    'Integration',
    'extension.smoke.devtools-window-application',
    'DevTools-opened Studio discovers the inspected DBOPFS application',
    () => standaloneStudio.waitForSelector('[data-open-app="browser-coverage"]', {
      visible: true,
      timeout: 15_000
    })
  );
  const reuseResponse = await devtoolsPanel.evaluate(async (tabId) => chrome.runtime.sendMessage({
    channel: 'dbopfs-studio:background',
    action: 'openStudioWindow',
    tabId
  }), inspectedTabId);
  await harness.runCase(
    'Functional',
    'extension.smoke.devtools-window-reuse',
    'a repeated DevTools launch request returns success',
    () => testAssert(
      reuseResponse?.ok,
      `The DevTools Studio window could not be reused: ${reuseResponse?.error}`
    )
  );
  const standaloneCount = browser.targets()
    .filter((target) => target.type() === 'page' && target.url() === standaloneUrl)
    .length;
  await harness.runCase(
    'Regression',
    'extension.smoke.devtools-window-singleton',
    'reopening Studio from DevTools does not duplicate its window',
    () => testAssert(
      standaloneCount === 1,
      `The DevTools launcher created ${standaloneCount} Studio windows.`
    )
  );
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
  await harness.runCase(
    'Functional',
    'extension.smoke.popup-title',
    'installed extension popup renders its DBOPFS title',
    () => testAssert(
      popupTitle.includes('DBOPFS'),
      'The installed extension popup did not render its DBOPFS title.'
    )
  );
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
  await studio.click('.product');
  await studio.evaluate(() => document.querySelector('[data-open-app]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.record-rows-visible',
    'installed Studio renders record rows for a populated table',
    () => studio.waitForSelector('#record-rows tr', { visible: true, timeout: 10_000 }),
    'inspect a populated Studio record table'
  );
  const emptyState = await studio.evaluate(() => {
    const element = document.querySelector('#records-empty');
    return { display: getComputedStyle(element).display, hidden: element.hidden };
  });
  await harness.runCase(
    'Regression',
    'extension.smoke.records-empty-hidden',
    'installed Studio marks the records empty state hidden when rows exist',
    () => testAssert(
      emptyState.hidden,
      `The records empty state was not marked hidden: ${JSON.stringify(emptyState)}`
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.records-empty-layout',
    'installed Studio removes the records empty state from layout when rows exist',
    () => testAssert(
      emptyState.display === 'none',
      `The records empty state remained in layout: ${JSON.stringify(emptyState)}`
    )
  );
  await studio.evaluate(() => document.querySelector('#record-rows tr')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.record-inspector',
    'installed Studio opens the selected record inspector',
    async () => {
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
        throw new Error(`Studio record inspector did not open: ${JSON.stringify(state)}`, {
          cause: error
        });
      }
    },
    'edit the selected Studio record'
  );
  await studio.evaluate(() => {
    const editor = document.querySelector('#record-editor');
    editor.value = `${editor.value}\n`;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await studio.click('#save-record');
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.record-save-status',
    'installed Studio clears its unsaved status after saving a record',
    () => studio.waitForFunction(
      () => document.querySelector('#editor-status')?.textContent !== 'Unsaved changes',
      { timeout: 10_000 }
    ),
    'close the saved Studio record'
  );
  await studio.click('#close-inspector');
  await studio.click('[data-view="activity"]');
  await studio.click('#clear-activity');
  await studio.click('#help-button');
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.about-dialog',
    'installed Studio opens its About dialog',
    () => studio.waitForFunction(
      () => document.querySelector('#about-dialog')?.open === true,
      { timeout: 10_000 }
    ),
    'close the Studio About dialog'
  );
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
  await harness.runCase(
    'Regression',
    'extension.smoke.record-race-selection',
    'a stale record read does not replace the latest inspector selection',
    () => testAssert(
      racedRecordState.inspector === 'readme.md',
      `A stale record read replaced the inspector selection: ${JSON.stringify(racedRecordState)}`
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.record-race-source',
    'a stale record read does not replace the latest inspector source',
    () => testAssert(
      racedRecordState.source?.startsWith('# readme.md'),
      `A stale record read replaced the inspector source: ${JSON.stringify(racedRecordState)}`
    )
  );
  await studio.evaluate(() => document.querySelector('[data-record="constellation-map.pdf"]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.pdf-inspector-open',
    'installed Studio opens its PDF inspector',
    () => studio.waitForFunction(
      () => document.querySelector('#inspector-content')?.hidden === false,
      { timeout: 10_000 }
    ),
    'inspect the installed PDF viewer state'
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.pdf-source-hidden',
    'installed PDF viewing hides the source editor',
    () => studio.waitForFunction(
      () => document.querySelector('#record-source')?.hidden === true,
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.pdf-save-hidden',
    'installed PDF viewing hides the save control',
    () => studio.waitForFunction(
      () => document.querySelector('#save-record')?.hidden === true,
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.pdf-native-open-visible',
    'installed PDF viewing exposes the native-open control',
    () => studio.waitForFunction(
      () => document.querySelector('#open-native')?.hidden === false,
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.pdf-native-label',
    'installed PDF native-open control identifies the PDF viewer',
    () => studio.waitForFunction(
      () => /PDF viewer/i.test(document.querySelector('#open-native')?.textContent || ''),
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.pdf-preview-label',
    'installed PDF preview identifies PDF content',
    () => studio.waitForFunction(
      () => /PDF/i.test(document.querySelector('#preview')?.textContent || ''),
      { timeout: 10_000 }
    )
  );
  await studio.click('#print-record');
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.pdf-print-count',
    'installed PDF print action opens one native target',
    () => studio.waitForFunction(
      () => globalThis.__DBOPFS_NATIVE_OPENS__?.length === 1,
      { timeout: 10_000 }
    ),
    'inspect the installed PDF print target'
  );
  const nativeOpen = await studio.evaluate(() => globalThis.__DBOPFS_NATIVE_OPENS__[0]);
  await harness.runCase(
    'Integration',
    'extension.smoke.pdf-print-blob',
    'installed PDF print action opens a Blob URL',
    () => testAssert(
      String(nativeOpen[0]).startsWith('blob:'),
      `PDF printing did not open a Blob URL: ${JSON.stringify(nativeOpen)}`
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.pdf-print-target',
    'installed PDF print action targets a new tab',
    () => testAssert(
      nativeOpen[1] === '_blank',
      `PDF printing used the wrong target: ${JSON.stringify(nativeOpen)}`
    )
  );

  await studio.evaluate(() => document.querySelector('[data-record="readme.md"]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.markdown-rendered-mode',
    'installed Markdown record opens in rendered mode',
    () => studio.waitForFunction(
      () => document.querySelector('#viewer-mode')?.textContent === 'Rendered',
      { timeout: 10_000 }
    ),
    'inspect the installed Markdown rendering state'
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-preview-visible',
    'installed Markdown rendered preview is visible',
    () => studio.waitForFunction(
      () => document.querySelector('#preview')?.hidden === false,
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-heading',
    'installed Markdown preview renders the record heading',
    () => studio.waitForFunction(
      () => document.querySelector('#preview h1')?.textContent === 'readme.md',
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-content',
    'installed Markdown preview renders its DBOPFS content',
    () => studio.waitForFunction(
      () => document.querySelector('#preview')?.textContent?.includes('DBOPFS'),
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-source-hidden',
    'installed Markdown rendered mode hides the source editor',
    () => studio.waitForFunction(
      () => document.querySelector('#record-source')?.hidden === true,
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-viewer-selected',
    'installed Markdown rendered-mode control exposes selected state',
    () => studio.waitForFunction(
      () => document.querySelector('#viewer-mode')?.getAttribute('aria-selected') === 'true',
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.markdown-object-url',
    'installed record switching revokes the previous native-view object URL',
    async () => testAssert(
      await studio.evaluate(() => (globalThis.__DBOPFS_REVOKED_URLS__?.length || 0) >= 1),
      'Studio did not revoke the previous native-view object URL.'
    )
  );
  const renderedSource = await studio.$eval('#record-editor', (element) => element.value);
  await studio.click('#source-mode');
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.markdown-source-preview-hidden',
    'installed Markdown source mode hides the rendered preview',
    () => studio.waitForFunction(
      () => document.querySelector('#preview')?.hidden === true,
      { timeout: 10_000 }
    ),
    'inspect installed Markdown source mode'
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-source-editor-visible',
    'installed Markdown source mode exposes the editor',
    () => studio.waitForFunction(
      () => document.querySelector('#record-source')?.hidden === false,
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.markdown-source-preserved',
    'installed Markdown source remains exact across rendered and source modes',
    async () => testAssert(
      await studio.$eval('#record-editor', (element) => element.value) === renderedSource,
      'Markdown view switching changed its source.'
    )
  );
  await studio.focus('#source-mode');
  await studio.keyboard.press('ArrowLeft');
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.markdown-keyboard-selected',
    'ArrowLeft returns selection to installed rendered Markdown mode',
    () => studio.waitForFunction(
      () => document.querySelector('#viewer-mode')?.getAttribute('aria-selected') === 'true',
      { timeout: 10_000 }
    ),
    'inspect the keyboard-selected Markdown preview'
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.markdown-keyboard-preview',
    'ArrowLeft restores the installed rendered Markdown preview',
    () => studio.waitForFunction(
      () => document.querySelector('#preview')?.hidden === false,
      { timeout: 10_000 }
    )
  );

  await studio.evaluate(() => document.querySelector('[data-record="worker.js"]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.javascript-beautified-mode',
    'installed JavaScript record opens in beautified mode',
    () => studio.waitForFunction(
      () => document.querySelector('#viewer-mode')?.textContent === 'Beautified',
      { timeout: 10_000 }
    ),
    'inspect the installed JavaScript preview'
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.javascript-source-immutable',
    'installed JavaScript preview preserves the editor source',
    async () => testAssert(
      await studio.$eval('#record-editor', (element) => element.value) ===
        'export function orbit(items){return items.map((item)=>({name:item.name,active:true}));}',
      'JavaScript preview changed its source.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.javascript-multiline',
    'installed JavaScript preview renders a multiline layout',
    () => studio.waitForFunction(
      () => document.querySelector('#preview code')?.textContent?.includes('\n'),
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.javascript-transformed',
    'installed JavaScript preview differs from compact source',
    async () => testAssert(
      await studio.$eval('#preview code', (element) => element.textContent) !==
        await studio.$eval('#record-editor', (element) => element.value),
      'JavaScript preview was not transformed.'
    )
  );

  await studio.click('[data-app="arcane-library"][data-table="images"]');
  await studio.waitForSelector('[data-record="pixel.png"]', { visible: true, timeout: 10_000 });
  await studio.evaluate(() => document.querySelector('[data-record="pixel.png"]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.image-object-url',
    'installed image preview uses a Blob URL',
    () => studio.waitForSelector('#preview img[src^="blob:"]', {
      visible: true,
      timeout: 10_000
    }),
    'decode the installed image preview'
  );
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.image-decode',
    'installed image preview decodes successfully',
    () => studio.$eval('#preview img', (image) => image.decode()),
    'inspect the decoded installed image'
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.image-png-type',
    'installed image preview preserves PNG content type',
    async () => {
      const type = await studio.$eval('#preview img', async (image) =>
        (await (await fetch(image.src)).blob()).type
      );
      testAssert(type === 'image/png', 'Image content type changed.');
    }
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.image-width',
    'installed image preview reports its natural width',
    async () => testAssert(
      await studio.$eval('#preview img', (image) => image.naturalWidth) === 1,
      'Image natural width changed.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.image-height',
    'installed image preview reports its natural height',
    async () => testAssert(
      await studio.$eval('#preview img', (image) => image.naturalHeight) === 1,
      'Image natural height changed.'
    )
  );
  await studio.evaluate(() => document.querySelector('[data-record="sample.mp3"]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.audio-controls',
    'installed audio preview exposes playback controls',
    () => studio.waitForFunction(
      () => document.querySelector('#preview audio')?.controls === true,
      { timeout: 10_000 }
    ),
    'inspect the installed audio preview'
  );
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.audio-object-url',
    'installed audio preview uses a Blob URL',
    () => studio.waitForFunction(
      () => document.querySelector('#preview audio')?.src.startsWith('blob:'),
      { timeout: 10_000 }
    ),
    'load installed audio metadata'
  );
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.audio-metadata',
    'installed audio preview loads media metadata',
    () => studio.waitForFunction(
      () => document.querySelector('#preview audio')?.readyState >= 1,
      { timeout: 10_000 }
    ),
    'inspect loaded audio metadata'
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.audio-no-error',
    'installed audio preview reports no media error',
    async () => testAssert(
      await studio.$eval('#preview audio', (media) => media.error) === null,
      'Audio preview reported a media error.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.audio-mpeg-type',
    'installed audio preview preserves MPEG content type',
    async () => {
      const type = await studio.$eval('#preview audio', async (media) =>
        (await (await fetch(media.src)).blob()).type
      );
      testAssert(type === 'audio/mpeg', 'Audio content type changed.');
    }
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.audio-duration',
    'installed audio preview reports a positive duration',
    async () => testAssert(
      await studio.$eval('#preview audio', (media) => media.duration) > 0,
      'Audio duration is invalid.'
    )
  );
  await studio.evaluate(() => document.querySelector('[data-record="sample.mp4"]')?.click());
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.video-controls',
    'installed video preview exposes playback controls',
    () => studio.waitForFunction(
      () => document.querySelector('#preview video')?.controls === true,
      { timeout: 10_000 }
    ),
    'inspect the installed video preview'
  );
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.video-object-url',
    'installed video preview uses a Blob URL',
    () => studio.waitForFunction(
      () => document.querySelector('#preview video')?.src.startsWith('blob:'),
      { timeout: 10_000 }
    ),
    'load installed video metadata'
  );
  await harness.runRequiredCase(
    'Integration',
    'extension.smoke.video-metadata',
    'installed video preview loads media metadata',
    () => studio.waitForFunction(
      () => document.querySelector('#preview video')?.readyState >= 1,
      { timeout: 10_000 }
    ),
    'inspect loaded video metadata'
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.video-no-error',
    'installed video preview reports no media error',
    async () => testAssert(
      await studio.$eval('#preview video', (media) => media.error) === null,
      'Video preview reported a media error.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.video-mp4-type',
    'installed video preview preserves MP4 content type',
    async () => {
      const type = await studio.$eval('#preview video', async (media) =>
        (await (await fetch(media.src)).blob()).type
      );
      testAssert(type === 'video/mp4', 'Video content type changed.');
    }
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.video-duration',
    'installed video preview reports a positive duration',
    async () => testAssert(
      await studio.$eval('#preview video', (media) => media.duration) > 0,
      'Video duration is invalid.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.video-width',
    'installed video preview reports its intrinsic width',
    async () => testAssert(
      await studio.$eval('#preview video', (media) => media.videoWidth) === 16,
      'Video intrinsic width changed.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.video-height',
    'installed video preview reports its intrinsic height',
    async () => testAssert(
      await studio.$eval('#preview video', (media) => media.videoHeight) === 16,
      'Video intrinsic height changed.'
    )
  );

  const studioState = await studio.evaluate(() => ({
    module: document.querySelector('#profile-module')?.textContent,
    title: document.title,
    usage: document.querySelector('#usage-value')?.textContent
  }));
  await harness.runCase(
    'Functional',
    'extension.smoke.dashboard-title',
    'installed Studio dashboard title identifies DBOPFS',
    () => testAssert(
      studioState.title.includes('DBOPFS'),
      'The installed Studio dashboard title did not identify DBOPFS.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.dashboard-module',
    'installed Studio dashboard identifies its DBOPFS module',
    () => testAssert(
      studioState.module?.includes('DBOPFS'),
      'The installed Studio dashboard did not identify its DBOPFS module.'
    )
  );
  await harness.runCase(
    'Integration',
    'extension.smoke.dashboard-usage',
    'installed Studio dashboard renders measured storage usage',
    () => testAssert(
      studioState.usage && studioState.usage !== '—',
      'The installed Studio dashboard did not render storage usage.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.dashboard-errors',
    'installed Studio dashboard raises no uncaught page errors',
    () => testAssert(
      errors.length === 0,
      `The installed Studio page raised errors:\n- ${errors.join('\n- ')}`
    )
  );
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
  await harness.runRequiredCase(
    'Functional',
    'extension.smoke.print-heading',
    'installed print view renders the record heading',
    () => printPage.waitForFunction(
      () => document.querySelector('#print-content h1')?.textContent ===
        'Printable DBOPFS Studio record',
      { timeout: 10_000 }
    ),
    'inspect the installed print view'
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.print-emphasis',
    'installed print view renders emphasized record text',
    () => printPage.waitForFunction(
      () => document.querySelector('#print-content strong')?.textContent === 'Rendered safely.',
      { timeout: 10_000 }
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.print-no-script',
    'installed print view creates no script element',
    async () => testAssert(
      await printPage.$$eval('#print-content script', (elements) => elements.length) === 0,
      'The print view retained an unsafe script.'
    )
  );
  await harness.runCase(
    'Regression',
    'extension.smoke.print-no-unsafe-link',
    'installed print view removes the JavaScript link',
    async () => testAssert(
      await printPage.$$eval('#print-content a', (elements) => elements.length) === 0,
      'The print view retained an unsafe link.'
    )
  );
  await harness.runCase(
    'Functional',
    'extension.smoke.print-invocation',
    'installed print view invokes the browser print command',
    () => printPage.waitForFunction(
      () => globalThis.__DBOPFS_PRINT_CALLED__ === true,
      { timeout: 10_000 }
    )
  );
  const consumedPrintPayload = await worker.evaluate(async (id) =>
    (await chrome.storage.session.get(`print:${id}`))[`print:${id}`], printId);
  await harness.runCase(
    'Regression',
    'extension.smoke.print-payload-consumed',
    'installed print view removes its one-time session payload',
    () => testAssert(
      consumedPrintPayload === undefined,
      'The print view did not remove its one-time session payload.'
    )
  );
  if (coverageEnabled) {
    coverageEntries.push(...await printPage.coverage.stopJSCoverage());
  }
  await printPage.close();

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
  const extensionHarness = createExtensionHarness();
  let browserResult;
  let combinedResult;
  let extensionResult;
  let resultPrinted = false;

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
    browserResult = await page.evaluate(() => globalThis.__DBOPFS_TEST_RESULTS__);

    coverageEntries.push(...await smokeTestLoadedExtension(
      browser,
      coverageEnabled,
      running.origin,
      distractor.origin,
      extensionHarness
    ));
    extensionResult = extensionHarness.report();
    combinedResult = combineTestResults(browserResult, extensionResult);
    if (coverageStarted) {
      coverageEntries.push(...await page.coverage.stopJSCoverage());
      coverageStarted = false;
    }
    if (coverageEnabled) {
      await writeCoverage(coverageEntries, running.origin, threshold);
    }

    printResultDetails(combinedResult);
    printTestSummary(combinedResult, 'BROWSER');
    resultPrinted = true;
    if (pageErrors.length) {
      throw new Error(`Uncaught browser errors:\n- ${pageErrors.join('\n- ')}`);
    }
    if (combinedResult.failed) {
      throw new Error(
        `${combinedResult.failed} of ${combinedResult.total} browser tests failed.`
      );
    }
    console.log(
      `${combinedResult.passed} browser tests passed in ${path.basename(executablePath)}.`
    );
    return combinedResult;
  } catch (error) {
    if (!extensionResult) {
      extensionResult = extensionHarness.report();
    }
    if (!combinedResult && browserResult) {
      try {
        combinedResult = combineTestResults(browserResult, extensionResult);
      } catch {
        combinedResult = null;
      }
    }
    const failureResult = combinedResult || extensionResult;
    if (!resultPrinted) {
      printResultDetails(failureResult);
      printTestSummary(failureResult, combinedResult ? 'BROWSER PARTIAL' : 'INSTALLED PARTIAL');
    }
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.testResult = failureResult;
    throw failure;
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
