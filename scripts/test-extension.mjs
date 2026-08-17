import puppeteer from 'puppeteer-core';
import {
  assert as testAssert,
  createExtensionHarness,
  printTestSummary
} from '../tests/extension/harness.mjs';
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
  const harness = createExtensionHarness();
  let browser;
  let harnessResult;
  let resultPrinted = false;

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
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.empty-origin-scan-response',
      'installed bridge returns a successful scan for an untouched origin',
      () => testAssert(
        emptyScan?.ok,
        `An empty origin scan failed: ${JSON.stringify(emptyScan)}`
      ),
      'inspect the untouched-origin scan result'
    );
    await harness.runCase(
      'Functional',
      'extension.e2e.empty-origin-zero-applications',
      'installed scan reports zero applications for an untouched origin',
      () => testAssert(
        emptyScan.data?.applications?.length === 0,
        `An empty origin returned unexpected DBOPFS data: ${JSON.stringify(emptyScan)}`
      )
    );
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.empty-origin-agent-ready',
      'installed page agent announces readiness on an untouched origin',
      () => emptyPage.waitForFunction(
        () => document.documentElement.dataset.dbopfsStudioAgent === 'ready',
        { timeout: 20_000 }
      ),
      'inspect untouched-origin storage after agent readiness'
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.empty-origin-nonmutation',
      'read-only installed scan does not create an applications directory',
      async () => {
        const emptyRootEntries = await emptyPage.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          const names = [];
          for await (const [name] of root.entries()) {
            names.push(name);
          }
          return names;
        });
        testAssert(
          !emptyRootEntries.includes('apps'),
          'Scanning an empty origin created an apps directory.'
        );
      }
    );
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
    await harness.runRequiredCase(
      'Regression',
      'extension.e2e.strict-csp-scan-response',
      "installed bridge scans a script-src-none origin successfully",
      () => testAssert(
        strictScan?.ok,
        `Strict-CSP page scan failed: ${JSON.stringify(strictScan)}`
      ),
      'inspect the strict-CSP scan result'
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.strict-csp-primary-layer',
      'strict-CSP scan identifies DBOPFS as the primary data layer',
      () => testAssert(
        strictScan.data?.module?.primaryDataLayer === true,
        `Strict-CSP scan reported the wrong data layer: ${JSON.stringify(strictScan)}`
      )
    );
    const strictCreate = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'createApplication',
      data: { applicationId: 'strict-csp-app' }
    }), strictTabId);
    await harness.runRequiredCase(
      'Regression',
      'extension.e2e.strict-csp-create',
      'installed bridge creates an application under script-src-none',
      () => testAssert(
        strictCreate?.ok,
        `Strict-CSP application creation failed: ${JSON.stringify(strictCreate)}`
      ),
      'write the strict-CSP fixture record'
    );
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
    await harness.runRequiredCase(
      'Regression',
      'extension.e2e.strict-csp-write',
      'installed bridge writes a record under script-src-none',
      () => testAssert(
        strictWrite?.ok,
        `Strict-CSP record write failed: ${JSON.stringify(strictWrite)}`
      ),
      'read the strict-CSP fixture record'
    );
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
    await harness.runRequiredCase(
      'Regression',
      'extension.e2e.strict-csp-read-response',
      'installed bridge reads a record under script-src-none',
      () => testAssert(
        strictRead?.ok,
        `Strict-CSP record read failed: ${JSON.stringify(strictRead)}`
      ),
      'inspect the strict-CSP record payload'
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.strict-csp-round-trip',
      'strict-CSP record round trip preserves its exact text',
      () => testAssert(
        strictRead.data?.text === '{"csp":"strict"}',
        `Strict-CSP DBOPFS text changed: ${JSON.stringify(strictRead)}`
      )
    );
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
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.fixture-scan-response',
      'installed bridge returns a successful seeded-origin scan',
      () => testAssert(scan?.ok, 'The seeded-origin scan failed.'),
      'inspect the seeded-origin scan result'
    );
    await harness.runCase(
      'Integration',
      'extension.e2e.fixture-primary-layer',
      'seeded-origin scan identifies DBOPFS as the primary data layer',
      () => testAssert(
        scan.data?.module?.primaryDataLayer === true,
        'The page agent did not report DBOPFS as its primary data layer.'
      )
    );
    const createdApplication = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      protocol: 'dbopfs-studio',
      version: 1,
      type: 'request',
      requestId: 'create-integration-application',
      operation: 'create',
      payload: { applicationId: 'created-by-studio', kind: 'application' }
    }), fixtureTabId);
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.create-response',
      'typed installed create request returns success',
      () => testAssert(
        createdApplication?.ok,
        `Creating a DBOPFS application failed: ${JSON.stringify(createdApplication)}`
      ),
      'inspect the typed create response'
    );
    await harness.runCase(
      'Integration',
      'extension.e2e.create-confirmation',
      'typed installed create reports a newly created application',
      () => testAssert(
        createdApplication.result?.created === true,
        'The typed create response did not confirm creation.'
      )
    );
    await harness.runCase(
      'Integration',
      'extension.e2e.create-primary-layer',
      'typed installed create reports the DBOPFS primary data layer',
      () => testAssert(
        createdApplication.result?.module?.primaryDataLayer === true,
        'The typed create response reported the wrong data layer.'
      )
    );
    const scanAfterCreate = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'scan',
      data: { includeRecords: false }
    }), fixtureTabId);
    await harness.runCase(
      'Integration',
      'extension.e2e.create-discoverable',
      'a newly created application appears in the next installed scan',
      () => testAssert(
        scanAfterCreate?.data?.applications?.some((app) => app.id === 'created-by-studio'),
        'A newly created DBOPFS application was missing from the next scan.'
      )
    );

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
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.record-write-response',
      'installed record write returns success',
      () => testAssert(
        directWrite?.ok,
        `The DBOPFS bridge write failed: ${JSON.stringify(directWrite)}`
      ),
      'read the installed bridge fixture record'
    );
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
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.record-read-response',
      'installed record read returns success',
      () => testAssert(
        directRead?.ok,
        `The DBOPFS bridge read failed: ${JSON.stringify(directRead)}`
      ),
      'inspect the installed bridge record payload'
    );
    await harness.runCase(
      'Integration',
      'extension.e2e.record-round-trip',
      'installed record round trip preserves exact JSON text',
      () => testAssert(
        directRead.data?.text === directRecord,
        `The DBOPFS bridge changed record text: ${JSON.stringify(directRead)}`
      )
    );
    const expectedLastModified = directRead?.data?.lastModified;
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.record-revision-token',
      'installed record read returns a numeric revision token',
      () => testAssert(
        Number.isFinite(expectedLastModified),
        'The installed concurrency fixture did not provide a numeric revision token.'
      ),
      'exercise installed optimistic concurrency'
    );
    const invalidUtf8Write = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'writeRecord',
      data: {
        applicationId: 'dbopfs-studio-fixture',
        table: 'notes',
        record: 'invalid-utf8.js',
        base64: '/wBh'
      }
    }), fixtureTabId);
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.record-base64-write',
      'installed bridge accepts a base64 record write',
      () => testAssert(
        invalidUtf8Write?.ok,
        `Writing the invalid UTF-8 fixture failed: ${JSON.stringify(invalidUtf8Write)}`
      ),
      'inspect the invalid UTF-8 fixture in Studio'
    );
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
        expectedLastModified
      });
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.concurrency-current-write',
      'installed bridge accepts a write at the current revision',
      () => testAssert(
        optimisticWrite?.ok,
        `The current-revision write failed: ${JSON.stringify(optimisticWrite)}`
      ),
      'submit the deliberately stale installed write'
    );
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
        expectedLastModified
      });
    await harness.runRequiredCase(
      'Regression',
      'extension.e2e.concurrency-stale-rejected',
      'installed bridge rejects a stale record revision',
      () => testAssert(
        staleWrite?.ok === false,
        `The stale write was accepted: ${JSON.stringify(staleWrite)}`
      ),
      'inspect the stale-write error code'
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.concurrency-record-changed-code',
      'stale installed write returns the RECORD_CHANGED code',
      () => testAssert(
        staleWrite.error?.code === 'RECORD_CHANGED',
        `The stale write returned the wrong error: ${JSON.stringify(staleWrite)}`
      )
    );
    const exported = await worker.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, {
      channel: 'dbopfs-studio',
      version: 1,
      action: 'export',
      data: { applicationId: 'dbopfs-studio-fixture', pretty: false }
    }), fixtureTabId);
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.export-response',
      'installed application export returns success',
      () => testAssert(
        exported?.ok,
        `The DBOPFS export failed: ${JSON.stringify(exported)}`
      ),
      'inspect the installed export descriptor'
    );
    await harness.runCase(
      'Functional',
      'extension.e2e.export-text-encoding',
      'installed export descriptor declares text encoding',
      () => testAssert(exported.data?.encoding === 'text', 'Export encoding is not text.')
    );
    await harness.runCase(
      'Functional',
      'extension.e2e.export-json-type',
      'installed export descriptor declares JSON content',
      () => testAssert(
        exported.data?.type === 'application/json',
        'Export content type is not JSON.'
      )
    );
    await harness.runCase(
      'Functional',
      'extension.e2e.export-filename',
      'installed export descriptor uses the application JSON filename',
      () => testAssert(
        exported.data?.fileName === 'dbopfs-studio-fixture-dbopfs.json',
        'Export filename does not identify the application.'
      )
    );
    await harness.runCase(
      'Integration',
      'extension.e2e.export-includes-record',
      'installed export payload includes the written record',
      () => testAssert(
        exported.data?.text.includes('direct.json'),
        'Export payload omitted the written record.'
      )
    );

    let popup;
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.popup-opens',
      'Chrome opens the installed extension popup',
      async () => {
        const popupTargetPromise = browser.waitForTarget(
          (target) => target.type() === 'page' &&
            target.url() === `chrome-extension://${extensionId}/popup/index.html`,
          { timeout: 15_000 }
        );
        await worker.evaluate(() => chrome.action.openPopup());
        popup = await (await popupTargetPromise).asPage();
      },
      'inspect the installed extension popup'
    );
    capturePageErrors(popup, 'popup', errors);
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.popup-bound-origin',
      'installed popup displays the inspected origin',
      () => popup.waitForFunction(
        (origin) => document.querySelector('#site-title')?.textContent === origin,
        { timeout: 10_000 },
        running.origin
      ),
      'inspect the popup Studio launcher'
    );
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.popup-studio-enabled',
      'installed popup enables its Studio launcher',
      () => popup.waitForFunction(
        () => document.querySelector('#open-studio')?.disabled === false,
        { timeout: 10_000 }
      ),
      'launch Studio from the installed popup'
    );

    let studio;
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.popup-opens-studio',
      'installed popup opens a Studio window for its bound tab',
      async () => {
        const studioTargetPromise = browser.waitForTarget(
          (target) => target.type() === 'page' &&
            target.url().startsWith(`chrome-extension://${extensionId}/studio/index.html?tab=`),
          { timeout: 15_000 }
        );
        await popup.click('#open-studio');
        studio = await (await studioTargetPromise).asPage();
      },
      'inspect the popup-opened Studio window'
    );
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
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.studio-fixture-table',
      'installed Studio renders the seeded notes table',
      () => studio.waitForSelector(
        '[data-app="dbopfs-studio-fixture"][data-table="notes"]',
        { visible: true, timeout: 10_000 }
      ),
      'open the installed Studio fixture table'
    );
    await studio.click('[data-app="dbopfs-studio-fixture"][data-table="notes"]');
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.studio-fixture-record',
      'installed Studio renders the seeded integration record',
      () => studio.waitForSelector('[data-record="integration.json"]', {
        visible: true,
        timeout: 10_000
      }),
      'open the installed Studio fixture record'
    );
    await studio.click('[data-record="integration.json"]');
    await harness.runRequiredCase(
      'Functional',
      'extension.e2e.studio-seeded-editor',
      'installed Studio loads the seeded record into its editor',
      () => studio.waitForFunction(
        () => document.querySelector('#record-editor')?.value.includes('seeded'),
        { timeout: 10_000 }
      ),
      'inspect the installed Studio editor mode'
    );
    await harness.runCase(
      'Functional',
      'extension.e2e.studio-formatted-mode',
      'installed Studio opens seeded JSON in formatted mode',
      () => studio.waitForFunction(
        () => document.querySelector('#viewer-mode')?.textContent === 'Formatted',
        { timeout: 10_000 }
      )
    );
    await studio.click('#source-mode');

    const updatedText = JSON.stringify({ source: 'extension integration', status: 'updated' }, null, 2);
    await studio.evaluate((value) => {
      const editor = document.querySelector('#record-editor');
      editor.value = value;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }, updatedText);
    await studio.click('#save-record');
    await harness.runRequiredCase(
      'Integration',
      'extension.e2e.studio-saved-status',
      'Studio save persists the updated status through DBOPFS',
      () => fixture.waitForFunction(
        async () => {
          const value = await globalThis.__DBOPFS_FIXTURE__.database.get(
            'notes',
            'integration.json',
            true
          );
          return value?.status === 'updated';
        },
        { polling: 100, timeout: 15_000 }
      ),
      'inspect the other persisted Studio field'
    );
    await harness.runCase(
      'Integration',
      'extension.e2e.studio-saved-source',
      'Studio save persists the updated source through DBOPFS',
      () => fixture.waitForFunction(
        async () => {
          const value = await globalThis.__DBOPFS_FIXTURE__.database.get(
            'notes',
            'integration.json',
            true
          );
          return value?.source === 'extension integration';
        },
        { polling: 100, timeout: 15_000 }
      )
    );
    await studio.evaluate(() => document.querySelector('[data-record="invalid-utf8.js"]')?.click());
    await harness.runRequiredCase(
      'Regression',
      'extension.e2e.binary-selected-name',
      'installed Studio selects the invalid-UTF8 record by name',
      () => studio.waitForFunction(
        () => document.querySelector('#inspector-name')?.textContent === 'invalid-utf8.js',
        { timeout: 10_000 }
      ),
      'inspect the installed invalid-UTF8 viewer state'
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.binary-native-card',
      'invalid UTF-8 routes to the installed native-file card',
      () => studio.waitForSelector('#preview .native-file-card', { timeout: 10_000 })
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.binary-source-hidden',
      'invalid UTF-8 keeps the installed source editor hidden',
      () => studio.waitForFunction(
        () => document.querySelector('#record-source')?.hidden === true,
        { timeout: 10_000 }
      )
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.binary-save-hidden',
      'invalid UTF-8 keeps the installed save control hidden',
      () => studio.waitForFunction(
        () => document.querySelector('#save-record')?.hidden === true,
        { timeout: 10_000 }
      )
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.binary-native-open-visible',
      'invalid UTF-8 exposes the installed native-open control',
      () => studio.waitForFunction(
        () => document.querySelector('#open-native')?.hidden === false,
        { timeout: 10_000 }
      )
    );
    await harness.runCase(
      'Regression',
      'extension.e2e.no-browser-errors',
      'installed end-to-end pages emit no uncaught or console errors',
      () => testAssert(
        errors.length === 0,
        `Browser errors occurred:\n- ${errors.join('\n- ')}`
      )
    );
    harnessResult = harness.report();
    printTestSummary(harnessResult, 'INSTALLED E2E');
    resultPrinted = true;
    return harnessResult;
  } catch (error) {
    if (!harnessResult) {
      harnessResult = harness.report();
    }
    if (!resultPrinted) {
      printTestSummary(harnessResult, 'INSTALLED E2E PARTIAL');
    }
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.testResult = harnessResult;
    throw failure;
  } finally {
    await browser?.close();
    await running.close();
    await emptyOrigin.close();
    await strictCspOrigin.close();
  }
}

if (isMainModule(import.meta.url)) {
  testInstalledExtension()
    .then((result) => {
      if (result.failed) {
        throw new Error(`${result.failed} of ${result.total} installed tests failed.`);
      }
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
