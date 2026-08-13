import puppeteer from 'puppeteer-core';
import { extensionRoot, isMainModule, projectRoot } from './project.mjs';
import { createStaticServer } from './static-server.mjs';
import { findChromium } from './test-browser.mjs';

function capturePageErrors(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`${label} console: ${message.text()}`);
    }
  });
}

export async function testInstalledExtension() {
  const executablePath = await findChromium();
  const running = await createStaticServer({ root: projectRoot, host: '127.0.0.1', port: 0 });
  const emptyOrigin = await createStaticServer({ root: projectRoot, host: '127.0.0.1', port: 0 });
  const strictCspOrigin = await createStaticServer({
    root: projectRoot,
    host: '127.0.0.1',
    port: 0,
    headers: {
      'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'none'; img-src data:"
    }
  });
  const errors = [];
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      pipe: true,
      enableExtensions: [extensionRoot],
      args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []
    });

    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' &&
        target.url().endsWith('/background/service-worker.js'),
      { timeout: 15_000 }
    );
    const worker = await workerTarget.worker();
    const extensionId = await worker.evaluate(() => chrome.runtime.id);

    const emptyPage = await browser.newPage();
    capturePageErrors(emptyPage, 'empty fixture', errors);
    await emptyPage.goto(`${emptyOrigin.origin}/tests/fixture/empty.html`, {
      waitUntil: 'networkidle0',
      timeout: 30_000
    });
    const emptyTabId = await worker.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({ url: `${origin}/*` });
      return tabs[0]?.id;
    }, emptyOrigin.origin);
    if (!Number.isInteger(emptyTabId)) {
      throw new Error('Chrome did not expose the empty fixture tab to DBOPFS Studio.');
    }
    const emptyScan = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'scan',
      data: { includeRecords: true }
    }), emptyTabId);
    if (!emptyScan?.ok || emptyScan.data?.applications?.length !== 0) {
      throw new Error(`An empty origin returned unexpected DBOPFS data: ${JSON.stringify(emptyScan)}`);
    }
    await emptyPage.waitForFunction(
      () => document.documentElement.dataset.dbopfsStudioAgent === 'ready',
      { timeout: 20_000 }
    );
    const emptyRootEntries = await emptyPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const [name] of root.entries()) {
        names.push(name);
      }
      return names;
    });
    if (emptyRootEntries.includes('apps')) {
      throw new Error('Scanning an empty origin created an apps directory.');
    }
    console.log('PASS Read-only scan left an empty origin unchanged.');
    await emptyPage.close();

    const strictPage = await browser.newPage();
    capturePageErrors(strictPage, 'strict CSP fixture', errors);
    await strictPage.goto(`${strictCspOrigin.origin}/tests/fixture/strict-csp.html`, {
      waitUntil: 'networkidle0',
      timeout: 30_000
    });
    const strictTabId = await worker.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({ url: `${origin}/*` });
      return tabs[0]?.id;
    }, strictCspOrigin.origin);
    if (!Number.isInteger(strictTabId)) {
      throw new Error('Chrome did not expose the strict-CSP fixture tab to Studio.');
    }
    const strictScan = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'scan',
      data: { includeRecords: true }
    }), strictTabId);
    if (!strictScan?.ok || strictScan.data?.module?.primaryDataLayer !== true) {
      throw new Error(`Strict-CSP page scan failed: ${JSON.stringify(strictScan)}`);
    }
    const strictCreate = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'createApplication',
      data: { applicationId: 'strict-csp-app' }
    }), strictTabId);
    const strictWrite = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'writeRecord',
      data: {
        applicationId: 'strict-csp-app',
        table: 'notes',
        record: 'csp.json',
        text: '{"csp":"strict"}'
      }
    }), strictTabId);
    const strictRead = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'readRecord',
      data: {
        applicationId: 'strict-csp-app',
        table: 'notes',
        record: 'csp.json'
      }
    }), strictTabId);
    if (!strictCreate?.ok || !strictWrite?.ok || !strictRead?.ok ||
        strictRead.data?.text !== '{"csp":"strict"}') {
      throw new Error(
        `Strict-CSP DBOPFS round trip failed: ${JSON.stringify({ strictCreate, strictWrite, strictRead })}`
      );
    }
    console.log("PASS DBOPFS scan/read/write works under script-src 'none'.");
    await strictPage.close();

    const fixture = await browser.newPage();
    capturePageErrors(fixture, 'fixture', errors);
    await fixture.goto(`${running.origin}/tests/fixture/index.html`, {
      waitUntil: 'networkidle0',
      timeout: 30_000
    });
    await fixture.waitForFunction(
      () => globalThis.__DBOPFS_FIXTURE__?.ready === true,
      { timeout: 20_000 }
    );
    await fixture.bringToFront();
    const fixtureTabId = await worker.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({ url: `${origin}/*` });
      return tabs[0]?.id;
    }, running.origin);
    if (!Number.isInteger(fixtureTabId)) {
      throw new Error('Chrome did not expose the DBOPFS fixture tab to Studio.');
    }

    const scan = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'scan',
      data: { includeRecords: true }
    }), fixtureTabId);
    if (!scan?.ok || scan.data?.module?.primaryDataLayer !== true) {
      throw new Error('The page agent did not report DBOPFS as its primary data layer.');
    }
    const createdApplication = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      protocol: 'dbopfs-studio',
      version: 1,
      type: 'request',
      requestId: 'create-integration-application',
      operation: 'create',
      payload: { applicationId: 'created-by-studio', kind: 'application' }
    }), fixtureTabId);
    if (!createdApplication?.ok || createdApplication.result?.created !== true ||
        createdApplication.result?.module?.primaryDataLayer !== true) {
      throw new Error(`Creating a DBOPFS application failed: ${JSON.stringify(createdApplication)}`);
    }
    const scanAfterCreate = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'scan',
      data: { includeRecords: false }
    }), fixtureTabId);
    if (!scanAfterCreate?.data?.applications?.some((app) => app.id === 'created-by-studio')) {
      throw new Error('A newly created DBOPFS application was missing from the next scan.');
    }
    console.log('PASS Studio created a new DBOPFS application namespace.');

    const directRecord = JSON.stringify({ source: 'direct bridge', status: 'written' });
    const directWrite = await worker.evaluate(async ({ tabId, text }) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'writeRecord',
      data: {
        applicationId: 'dbopfs-studio-fixture',
        table: 'notes',
        record: 'direct.json',
        text
      }
    }), { tabId: fixtureTabId, text: directRecord });
    if (!directWrite?.ok) {
      throw new Error(`The DBOPFS bridge write failed: ${JSON.stringify(directWrite)}`);
    }
    const directRead = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'readRecord',
      data: {
        applicationId: 'dbopfs-studio-fixture',
        table: 'notes',
        record: 'direct.json'
      }
    }), fixtureTabId);
    if (!directRead?.ok || directRead.data?.text !== directRecord) {
      throw new Error(`The DBOPFS bridge read/write round trip failed: ${JSON.stringify(directRead)}`);
    }
    const optimisticText = JSON.stringify({ source: 'direct bridge', status: 'optimistic update' });
    const optimisticWrite = await worker.evaluate(async ({ tabId, text, expectedLastModified }) =>
      chrome.tabs.sendMessage(tabId, {
        channel: 'dbopfs-studio',
        version: 1,
        action: 'writeRecord',
        data: {
          applicationId: 'dbopfs-studio-fixture',
          table: 'notes',
          record: 'direct.json',
          text,
          expectedLastModified
        }
      }), {
        tabId: fixtureTabId,
        text: optimisticText,
        expectedLastModified: directRead.data.lastModified
      });
    const staleWrite = await worker.evaluate(async ({ tabId, expectedLastModified }) =>
      chrome.tabs.sendMessage(tabId, {
        channel: 'dbopfs-studio',
        version: 1,
        action: 'writeRecord',
        data: {
          applicationId: 'dbopfs-studio-fixture',
          table: 'notes',
          record: 'direct.json',
          text: '{"status":"stale overwrite"}',
          expectedLastModified
        }
      }), {
        tabId: fixtureTabId,
        expectedLastModified: directRead.data.lastModified
      });
    if (!optimisticWrite?.ok || staleWrite?.ok !== false ||
        staleWrite.error?.code !== 'RECORD_CHANGED') {
      throw new Error(
        `Optimistic concurrency did not reject a stale write: ${JSON.stringify({ optimisticWrite, staleWrite })}`
      );
    }
    const exported = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'export',
      data: { applicationId: 'dbopfs-studio-fixture', pretty: false }
    }), fixtureTabId);
    if (!exported?.ok || exported.data?.encoding !== 'text' ||
        exported.data?.type !== 'application/json' ||
        exported.data?.fileName !== 'dbopfs-studio-fixture-dbopfs.json' ||
        !exported.data?.text.includes('direct.json')) {
      throw new Error(`The DBOPFS export descriptor was incomplete: ${JSON.stringify(exported)}`);
    }
    console.log('PASS Page bridge read and wrote a record through DBOPFS.');
    console.log('PASS DBOPFS optimistic concurrency rejected a stale record write.');
    console.log('PASS DBOPFS export returned a bounded, downloadable JSON descriptor.');

    const popupTargetPromise = browser.waitForTarget(
      (target) => target.type() === 'page' &&
        target.url() === `chrome-extension://${extensionId}/popup/index.html`,
      { timeout: 15_000 }
    );
    await worker.evaluate(() => chrome.action.openPopup());
    const popupTarget = await popupTargetPromise;
    const popup = await popupTarget.asPage();
    capturePageErrors(popup, 'popup', errors);
    await popup.waitForFunction(
      (origin) => document.querySelector('#site-title')?.textContent === origin &&
        document.querySelector('#open-studio')?.disabled === false,
      { timeout: 10_000 },
      running.origin
    );

    const studioTargetPromise = browser.waitForTarget(
      (target) => target.type() === 'page' &&
        target.url().startsWith(`chrome-extension://${extensionId}/studio/index.html?tab=`),
      { timeout: 15_000 }
    );
    await popup.click('#open-studio');
    const studioTarget = await studioTargetPromise;
    const studio = await studioTarget.asPage();
    capturePageErrors(studio, 'studio', errors);
    await studio.waitForFunction(
      (applicationId) => document.querySelector('#status-connection')?.textContent === 'Connected' &&
        Array.from(document.querySelectorAll('[data-open-app]'))
          .some((element) => element.dataset.openApp === applicationId),
      { timeout: 20_000 },
      'dbopfs-studio-fixture'
    );

    await studio.evaluate(() => {
      document.querySelector('[data-open-app="dbopfs-studio-fixture"]').click();
    });
    await studio.waitForSelector(
      '[data-app="dbopfs-studio-fixture"][data-table="notes"]',
      { visible: true, timeout: 10_000 }
    );
    await studio.click('[data-app="dbopfs-studio-fixture"][data-table="notes"]');
    await studio.waitForSelector('[data-record="integration.json"]', {
      visible: true,
      timeout: 10_000
    });
    await studio.click('[data-record="integration.json"]');
    await studio.waitForFunction(
      () => document.querySelector('#record-editor')?.value.includes('seeded'),
      { timeout: 10_000 }
    );

    const updatedText = JSON.stringify({ source: 'extension integration', status: 'updated' }, null, 2);
    await studio.evaluate((value) => {
      const editor = document.querySelector('#record-editor');
      editor.value = value;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }, updatedText);
    await studio.click('#save-record');
    await fixture.waitForFunction(
      async () => {
        const value = await globalThis.__DBOPFS_FIXTURE__.database.get(
          'notes',
          'integration.json',
          true
        );
        return value?.status === 'updated' && value?.source === 'extension integration';
      },
      { polling: 100, timeout: 15_000 }
    );

    if (errors.length) {
      throw new Error(`Browser errors occurred:\n- ${errors.join('\n- ')}`);
    }
    console.log(
      `PASS Installed extension ${extensionId} discovered, opened, edited, and saved ` +
      'a record through the bundled DBOPFS module.'
    );
    return { extensionId, origin: running.origin };
  } finally {
    await browser?.close();
    await running.close();
    await emptyOrigin.close();
    await strictCspOrigin.close();
  }
}

if (isMainModule(import.meta.url)) {
  testInstalledExtension().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
