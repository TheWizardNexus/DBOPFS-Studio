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
    assert(format.fileKind('recording.mp3') === 'audio', 'Audio classification failed.');
    assert(format.fileKind('recording.mp4') === 'video', 'Video classification failed.');
    assert(format.fileKind('data.json', 'application/json') === 'json', 'JSON classification failed.');
    assert(format.mimeForFile('document.pdf') === 'application/pdf', 'PDF MIME inference failed.');
    assert(format.mimeForFile('photo.png') === 'image/png', 'Image MIME inference failed.');
    assert(format.mimeForFile('module.cjs', 'APPLICATION/OCTET-STREAM') === 'text/javascript',
      'A generic MIME prevented safe extension inference.');
    assert(format.nativeMimeForFile('pdf', 'spoofed.pdf', 'text/html') === 'application/pdf',
      'PDF native viewing trusted a spoofed active MIME.');
    assert(format.nativeMimeForFile('image', 'vector.svg', 'image/svg+xml') === 'application/octet-stream',
      'Active SVG was allowed as a native-view Blob.');
    assert(format.nativeMimeForFile('audio', 'recording.mp3') === 'audio/mpeg',
      'Audio native MIME inference failed.');
    assert(format.nativeMimeForFile('video', 'recording.mp4') === 'video/mp4',
      'Video native MIME inference failed.');
    assert(format.mimeForFile('unknown.bin') === 'application/octet-stream', 'Binary MIME fallback failed.');
    assert(format.safeFilename('unsafe:name?.json') === 'unsafe-name-.json',
      'Unsafe download characters were not replaced.');
  });

  await check('Viewer helpers safely render Markdown and format source without executing it', async () => {
    const viewer = await import('/extension/shared/viewer.js');
    assert(viewer.textViewKind('README.md', 'text/plain') === 'markdown',
      'Markdown extension detection failed.');
    assert(viewer.textViewKind('worker.cjs') === 'javascript',
      'JavaScript extension detection failed.');
    assert(viewer.textViewKind('payload', 'application/problem+json') === 'json',
      'JSON MIME detection failed.');

    const markdown = [
      '# Safe heading',
      '',
      '**Bold** and [safe](https://example.com/path) plus [unsafe](javascript:alert(1)).',
      '',
      '![remote secret](https://tracker.example/pixel.png)',
      '',
      '<script>globalThis.compromised = true</script>',
      '',
      '- First item',
      '- Second item',
      '',
      '```js',
      'const literal = "<b>not markup</b>";',
      '```'
    ].join('\n');
    const markdownTarget = document.createElement('section');
    viewer.renderMarkdown(markdownTarget, markdown);
    assert(markdownTarget.querySelector('h1')?.textContent === 'Safe heading',
      'Markdown heading rendering failed.');
    assert(markdownTarget.querySelector('strong')?.textContent === 'Bold',
      'Markdown emphasis rendering failed.');
    assert(markdownTarget.querySelectorAll('li').length === 2,
      'Markdown list rendering failed.');
    assert(markdownTarget.querySelector('pre code')?.textContent.includes('not markup'),
      'Markdown fenced code rendering failed.');
    assert(!markdownTarget.querySelector('script') && !markdownTarget.querySelector('img'),
      'Markdown created executable or network-loading elements.');
    assert(markdownTarget.textContent.includes('<script>globalThis.compromised'),
      'Raw Markdown HTML was not preserved as inert text.');
    assert(markdownTarget.querySelector('.blocked-markdown-image')?.textContent.includes('remote secret'),
      'Markdown images were not represented as blocked content.');
    const links = markdownTarget.querySelectorAll('a');
    assert(links.length === 1 && links[0].href === 'https://example.com/path' &&
      links[0].rel === 'noopener noreferrer' && links[0].referrerPolicy === 'no-referrer',
    'Markdown link safety attributes are incomplete.');
    assert(!markdownTarget.innerHTML.includes('javascript:'),
      'An unsafe Markdown URL reached the rendered DOM.');

    const rawJavaScript = 'const matcher=/a\\/b+/gi;const label="orbit";/* keep me */export function run(value){if(value){return matcher.test(value)&&label;}}';
    const formattedJavaScript = viewer.beautifyJavaScript(rawJavaScript);
    assert(formattedJavaScript !== rawJavaScript && formattedJavaScript.includes('\n'),
      'JavaScript was not formatted for display.');
    assert(formattedJavaScript.includes('/a\\/b+/gi') &&
      formattedJavaScript.includes('"orbit"') && formattedJavaScript.includes('/* keep me */'),
    'JavaScript formatting changed a regex, string, or comment.');
    assert(viewer.beautifyJavaScript(formattedJavaScript) === formattedJavaScript,
      'JavaScript display formatting is not deterministic.');
    const asiSource = 'function value(){return\n{x:1};}';
    const templateSource = 'const value=`outer ${`inner ${1+2}`}`;';
    const divisionSource = 'const ratio=total/count;';
    const commentSource = 'function value(){return/* keep */1;}';
    const unicodeLineSource = `function value(){return${String.fromCharCode(0x2028)}1;}`;
    assert(viewer.beautifyJavaScript(asiSource) === asiSource,
      'JavaScript formatting changed newline-sensitive automatic semicolon insertion.');
    assert(viewer.beautifyJavaScript(templateSource) === templateSource,
      'JavaScript formatting changed a nested template expression.');
    assert(viewer.beautifyJavaScript(divisionSource) === divisionSource,
      'JavaScript formatting changed an ambiguous slash expression.');
    assert(viewer.beautifyJavaScript(commentSource).includes('return /* keep */ 1;'),
      'JavaScript formatting introduced a line break around a block comment.');
    assert(viewer.beautifyJavaScript(unicodeLineSource) === unicodeLineSource,
      'JavaScript formatting changed a Unicode line-terminator boundary.');
    const javascriptTarget = document.createElement('section');
    viewer.renderTextPreview(javascriptTarget, {
      name: 'worker.js',
      mime: 'text/javascript',
      text: rawJavaScript
    });
    assert(javascriptTarget.querySelector('code')?.textContent === formattedJavaScript,
      'The JavaScript viewer did not use the display formatter.');
    assert(rawJavaScript.startsWith('const matcher='), 'The source fixture was unexpectedly mutated.');

    const jsonTarget = document.createElement('section');
    const exactJson = '{"ready":true,"big":9007199254740993,"overflow":1e400,"negativeZero":-0}';
    viewer.renderTextPreview(jsonTarget, { name: 'data.json', text: exactJson });
    const formattedJson = jsonTarget.querySelector('code')?.textContent || '';
    assert(formattedJson.includes('\n  "ready": true,\n') &&
      formattedJson.includes('9007199254740993') && formattedJson.includes('1e400') &&
      formattedJson.includes('-0'),
      'The JSON viewer did not provide a formatted read-only view.');

    const largeSource = 'x'.repeat((1024 * 1024) + 1);
    const largeTarget = document.createElement('section');
    const largeResult = viewer.renderTextPreview(largeTarget, {
      name: 'large.js',
      text: largeSource
    });
    assert(largeResult.truncated === true && largeTarget.querySelector('.viewer-notice') &&
      largeTarget.querySelector('code')?.textContent.length === 256 * 1024 &&
      largeSource.length === (1024 * 1024) + 1,
    'Large source previews are not bounded without mutating the source.');

    const manyMarkdownLines = Array.from({ length: 5001 }, () => '- bounded').join('\n');
    const boundedMarkdownTarget = document.createElement('section');
    const boundedMarkdownResult = viewer.renderMarkdown(boundedMarkdownTarget, manyMarkdownLines);
    assert(boundedMarkdownResult.truncated === true &&
      boundedMarkdownTarget.querySelector('.viewer-notice') &&
      boundedMarkdownTarget.querySelector('code')?.textContent === manyMarkdownLines,
    'Markdown line limits did not fall back to an inert bounded source view.');
  });

  await check('Extension documents provide basic accessible structure', async () => {
    for (const pagePath of ['popup/index.html', 'studio/index.html', 'devtools/panel.html']) {
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
      if (pagePath === 'studio/index.html') {
        assert(!documentNode.querySelector('a.product[href]'),
          'The Studio brand control must not discard its inspected-tab query binding.');
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
