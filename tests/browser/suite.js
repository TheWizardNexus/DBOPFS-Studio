import VanillaTest from '/node_modules/vanilla-test/index.js';

const test = new VanillaTest();
const details = [];
let manifest;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function check(description, operation) {
  test.expects(description);
  try {
    await operation();
    test.pass();
    details.push({ description, status: 'passed' });
  } catch (error) {
    test.fail();
    details.push({
      description,
      error: error instanceof Error ? error.message : String(error),
      status: 'failed'
    });
  } finally {
    test.done();
  }
}

async function fetchOk(url) {
  const response = await fetch(url, { cache: 'no-store' });
  assert(response.ok, `${url} returned HTTP ${response.status}.`);
  return response;
}

async function run() {
  await check('Chromium exposes the Origin Private File System API', async () => {
    assert(typeof navigator.storage?.getDirectory === 'function',
      'navigator.storage.getDirectory is unavailable.');
  });

  await check('OPFS supports a write, read, and delete round trip', async () => {
    const root = await navigator.storage.getDirectory();
    const directoryName = `dbopfs-studio-test-${crypto.randomUUID()}`;
    try {
      const directory = await root.getDirectoryHandle(directoryName, { create: true });
      const handle = await directory.getFileHandle('round-trip.txt', { create: true });
      const writable = await handle.createWritable();
      await writable.write('DBOPFS Studio');
      await writable.close();
      const file = await handle.getFile();
      assert(await file.text() === 'DBOPFS Studio', 'The OPFS round-trip changed file content.');
    } finally {
      await root.removeEntry(directoryName, { recursive: true });
    }
  });

  await check('The extension manifest is a packaged Manifest V3 document', async () => {
    manifest = await (await fetchOk('/extension/manifest.json')).json();
    assert(manifest.manifest_version === 3, 'Expected manifest_version 3.');
    assert(typeof manifest.name === 'string' && /DBOPFS/i.test(manifest.name),
      'The extension name must identify DBOPFS.');
    assert(typeof manifest.version === 'string', 'The extension version is missing.');
  });

  await check('The extension popup is present and has an accessible title', async () => {
    const popupPath = manifest?.action?.default_popup;
    assert(typeof popupPath === 'string' && popupPath.length > 0,
      'manifest.action.default_popup is missing.');
    const source = await (await fetchOk(`/extension/${popupPath}`)).text();
    const documentNode = new DOMParser().parseFromString(source, 'text/html');
    assert(documentNode.documentElement.lang, 'The popup document needs a language declaration.');
    assert(documentNode.title.trim(), 'The popup document needs a title.');
  });

  await check('The DBOPFS protocol module loads as native browser JavaScript', async () => {
    const protocol = await import('/extension/shared/dbopfs-protocol.js');
    assert(Object.keys(protocol).length > 0, 'The DBOPFS protocol module has no exports.');
  });

  await check('The DBOPFS protocol validates identifiers, paths, and request envelopes', async () => {
    const protocol = await import('/extension/shared/dbopfs-protocol.js');
    assert(protocol.assertApplicationId('dbopfs-studio') === 'dbopfs-studio',
      'A canonical DBOPFS application ID was rejected.');
    assert(protocol.assertEntryName('record.json') === 'record.json',
      'A safe record name was rejected.');
    assert(protocol.normalizeRawPath('/apps/demo/notes').join('/') === 'apps/demo/notes',
      'A raw OPFS path was not normalized.');
    assert(protocol.clampByteLimit('1024') === 1024, 'A valid byte limit was not normalized.');
    const request = protocol.createRequest(
      protocol.DBOPFS_STUDIO_OPERATIONS.SCAN,
      { includeRecords: true },
      'browser-test-request'
    );
    assert(protocol.assertRequest(request) === request, 'A valid request envelope was rejected.');
    const response = protocol.createSuccessResponse(request, { applications: [] });
    assert(protocol.assertResponse(response, request) === response,
      'A valid response envelope was rejected.');
    assert(protocol.isProtocolMessage(response), 'The protocol response was not recognized.');
    const failed = protocol.createErrorResponse(request, Object.assign(new Error('No access'), {
      code: 'DENIED'
    }));
    const responseError = protocol.responseError(failed);
    assert(responseError.code === 'DENIED' && responseError.message === 'No access',
      'A protocol error lost its code or message.');
    let rejectedUnsafeName = false;
    try {
      protocol.assertEntryName('../escape');
    } catch (error) {
      rejectedUnsafeName = error.code === 'INVALID_ENTRY_NAME';
    }
    assert(rejectedUnsafeName, 'An unsafe OPFS entry name was accepted.');
  });

  await check('The DBOPFS Studio client module loads as native browser JavaScript', async () => {
    const client = await import('/extension/shared/dbopfs-client.js');
    assert(typeof client.DBOPFSStudioClient === 'function',
      'DBOPFSStudioClient must be exported.');
  });

  await check('The DBOPFS Studio client sends typed requests through Chromium tabs', async () => {
    const protocol = await import('/extension/shared/dbopfs-protocol.js');
    const { DBOPFSStudioClient } = await import('/extension/shared/dbopfs-client.js');
    const requests = [];
    const chromeApi = {
      runtime: {},
      tabs: {
        query(_filter, callback) {
          const tabs = [{ id: 41 }];
          callback(tabs);
          return Promise.resolve(tabs);
        },
        sendMessage(tabId, request, callback) {
          requests.push({ request, tabId });
          const response = protocol.createSuccessResponse(request, {
            operation: request.operation,
            payload: request.payload
          });
          callback(response);
          return Promise.resolve(response);
        }
      }
    };
    const client = new DBOPFSStudioClient({ chromeApi, timeout: 2_000 });
    const scan = await client.scan({ includeRecords: false });
    const record = await client.readRecord('notes', 'entry.json', {
      applicationId: 'dbopfs-studio'
    });
    assert(requests.every(({ tabId }) => tabId === 41), 'The client used the wrong tab ID.');
    assert(scan.operation === protocol.DBOPFS_STUDIO_OPERATIONS.SCAN,
      'The client sent the wrong scan operation.');
    assert(record.payload.tableName === 'notes' && record.payload.fileName === 'entry.json',
      'The client did not preserve the record address.');
  });

  await check('Formatting helpers classify files and produce safe labels', async () => {
    const format = await import('/extension/shared/format.js');
    assert(format.formatBytes(1536) === '1.5 KB', 'Byte formatting is incorrect.');
    assert(format.formatBytes(-1) === '—', 'Invalid byte counts need a placeholder.');
    assert(format.formatDate('not-a-date') === 'Unknown', 'Invalid dates need a placeholder.');
    assert(format.fileKind('report.pdf') === 'pdf', 'PDF classification failed.');
    assert(format.fileKind('image.webp', 'image/webp') === 'image', 'Image classification failed.');
    assert(format.fileKind('data.json', 'application/json') === 'json', 'JSON classification failed.');
    assert(format.mimeForFile('document.pdf') === 'application/pdf', 'PDF MIME inference failed.');
    assert(format.mimeForFile('photo.png') === 'image/png', 'Image MIME inference failed.');
    assert(format.mimeForFile('unknown.bin') === 'application/octet-stream', 'Binary MIME fallback failed.');
    assert(format.safeFilename('unsafe:name?.json') === 'unsafe-name-.json',
      'Unsafe download characters were not replaced.');
  });

  await check('Extension documents provide basic accessible structure', async () => {
    for (const pagePath of ['popup/index.html', 'studio/index.html']) {
      const source = await (await fetchOk(`/extension/${pagePath}`)).text();
      const documentNode = new DOMParser().parseFromString(source, 'text/html');
      assert(documentNode.documentElement.lang === 'en', `${pagePath} needs lang="en".`);
      assert(documentNode.title.trim().includes('DBOPFS'), `${pagePath} needs a DBOPFS title.`);
      const ids = Array.from(documentNode.querySelectorAll('[id]'), (element) => element.id);
      assert(ids.length === new Set(ids).size, `${pagePath} contains duplicate element IDs.`);
      for (const button of documentNode.querySelectorAll('button')) {
        assert(Boolean(button.textContent.trim() || button.getAttribute('aria-label')),
          `${pagePath} contains an unnamed button.`);
      }
      for (const image of documentNode.querySelectorAll('img')) {
        assert(image.hasAttribute('alt'), `${pagePath} contains an image without alt text.`);
      }
    }
  });

  const report = test.report(false);
  const result = {
    complete: true,
    details,
    failed: report.failed.length,
    passed: report.passed.length,
    total: report.passed.length + report.failed.length
  };
  globalThis.__DBOPFS_TEST_RESULTS__ = result;
  render(result);
}

function render(result) {
  const summary = document.querySelector('#summary');
  summary.className = result.failed ? 'fail' : 'pass';
  summary.textContent = `${result.passed}/${result.total} tests passed.`;
  const list = document.querySelector('#results');
  list.replaceChildren(...result.details.map((detail) => {
    const item = document.createElement('li');
    item.className = detail.status === 'passed' ? 'pass' : 'fail';
    item.textContent = detail.error
      ? `${detail.description}: ${detail.error}`
      : detail.description;
    return item;
  }));
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  globalThis.__DBOPFS_TEST_RESULTS__ = {
    complete: true,
    details: [{ description: 'Browser test harness', error: message, status: 'failed' }],
    failed: 1,
    passed: 0,
    total: 1
  };
  render(globalThis.__DBOPFS_TEST_RESULTS__);
});
