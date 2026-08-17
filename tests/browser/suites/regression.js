import { assert, expectError, fetchOk } from '../harness.js';

const formatModule = () => import('/extension/shared/format.js');
const viewerModule = () => import('/extension/shared/viewer.js');

async function securityMarkdown(context) {
  if (!context.securityMarkdown) {
    const viewer = await viewerModule();
    const target = document.createElement('section');
    viewer.renderMarkdown(target, [
      '[safe](https://example.com/path) plus [unsafe](javascript:alert(1)).',
      '',
      '![remote secret](https://tracker.example/pixel.png)',
      '',
      '<script>globalThis.compromised = true</script>'
    ].join('\n'));
    context.securityMarkdown = target;
  }
  return context.securityMarkdown;
}

async function formattedTokens(context) {
  if (!context.formattedTokens) {
    const viewer = await viewerModule();
    const source = 'const matcher=/a\\/b+/gi;const label="orbit";/* keep me */export function run(value){if(value){return matcher.test(value)&&label;}}';
    context.formattedTokens = viewer.beautifyJavaScript(source);
  }
  return context.formattedTokens;
}

async function largePreview(context) {
  if (!context.largePreview) {
    const viewer = await viewerModule();
    const source = 'x'.repeat((1024 * 1024) + 1);
    const target = document.createElement('section');
    const result = viewer.renderTextPreview(target, { name: 'large.js', text: source });
    context.largePreview = { result, source, target };
  }
  return context.largePreview;
}

export default {
  name: 'Regression',
  cases: [
    {
      id: 'regression.protocol.unsafe-entry',
      description: 'protocol rejects a traversal record name',
      run: async () => {
        const protocol = await import('/extension/shared/dbopfs-protocol.js');
        await expectError(
          () => protocol.assertEntryName('../escape'),
          (error) => error.code === 'INVALID_ENTRY_NAME',
          'An unsafe OPFS entry name was accepted.'
        );
      }
    },
    {
      id: 'regression.protocol.response-correlation',
      description: 'protocol rejects a response for another request',
      run: async () => {
        const protocol = await import('/extension/shared/dbopfs-protocol.js');
        const expected = protocol.createRequest(
          protocol.DBOPFS_STUDIO_OPERATIONS.PING,
          {},
          'regression-expected-response'
        );
        const other = protocol.createRequest(
          protocol.DBOPFS_STUDIO_OPERATIONS.PING,
          {},
          'regression-other-response'
        );
        const response = protocol.createSuccessResponse(other, {});
        await expectError(
          () => protocol.assertResponse(response, expected),
          (error) => error.code === 'INVALID_RESPONSE',
          'A response for another request was accepted.'
        );
      }
    },
    {
      id: 'regression.client.no-active-tab',
      description: 'Studio client reports when Chromium has no active tab',
      run: async () => {
        const { DBOPFSStudioClient } = await import('/extension/shared/dbopfs-client.js');
        const chromeApi = {
          runtime: {},
          tabs: {
            query(_filter, callback) {
              callback([]);
              return Promise.resolve([]);
            }
          }
        };
        const client = new DBOPFSStudioClient({ chromeApi });
        await expectError(
          () => client.resolveTabId(),
          (error) => error.code === 'NO_ACTIVE_TAB',
          'A missing active tab did not produce NO_ACTIVE_TAB.'
        );
      }
    },
    {
      id: 'regression.format.spoofed-pdf',
      description: 'native PDF viewing ignores a spoofed active MIME type',
      run: async () => {
        const format = await formatModule();
        assert(format.nativeMimeForFile('pdf', 'spoofed.pdf', 'text/html') === 'application/pdf',
          'PDF native viewing trusted a spoofed active MIME.');
      }
    },
    {
      id: 'regression.format.active-svg',
      description: 'native image viewing blocks active SVG content',
      run: async () => {
        const format = await formatModule();
        assert(format.nativeMimeForFile('image', 'vector.svg', 'image/svg+xml') ===
          'application/octet-stream',
        'Active SVG was allowed as a native-view Blob.');
      }
    },
    {
      id: 'regression.markdown.active-elements',
      description: 'Markdown viewer creates no script element',
      run: async (context) => {
        const target = await securityMarkdown(context);
        assert(!target.querySelector('script'), 'Markdown created an executable script element.');
      }
    },
    {
      id: 'regression.markdown.raw-html',
      description: 'Markdown viewer preserves raw HTML as inert text',
      run: async (context) => {
        const target = await securityMarkdown(context);
        assert(target.textContent.includes('<script>globalThis.compromised'),
          'Raw Markdown HTML was not preserved as inert text.');
      }
    },
    {
      id: 'regression.markdown.remote-image',
      description: 'Markdown viewer represents a remote image as blocked content',
      run: async (context) => {
        const target = await securityMarkdown(context);
        assert(!target.querySelector('img') &&
          target.querySelector('.blocked-markdown-image')?.textContent.includes('remote secret'),
          'A remote Markdown image was not represented as blocked content.');
      }
    },
    {
      id: 'regression.markdown.safe-link',
      description: 'Markdown viewer adds privacy attributes to a safe link',
      run: async (context) => {
        const target = await securityMarkdown(context);
        const link = target.querySelector('a');
        assert(link?.href === 'https://example.com/path' &&
          link.rel === 'noopener noreferrer' &&
          link.referrerPolicy === 'no-referrer',
        'Markdown link safety attributes are incomplete.');
      }
    },
    {
      id: 'regression.markdown.unsafe-link',
      description: 'Markdown viewer removes a JavaScript URL',
      run: async (context) => {
        const target = await securityMarkdown(context);
        assert(target.querySelectorAll('a').length === 1 &&
          !target.innerHTML.includes('javascript:'),
        'An unsafe Markdown link remained clickable or reached the rendered DOM.');
      }
    },
    {
      id: 'regression.javascript.regex-token',
      description: 'JavaScript formatter preserves a regex token',
      run: async (context) => {
        assert((await formattedTokens(context)).includes('/a\\/b+/gi'),
          'JavaScript formatting changed a regex token.');
      }
    },
    {
      id: 'regression.javascript.string-token',
      description: 'JavaScript formatter preserves a string token',
      run: async (context) => {
        assert((await formattedTokens(context)).includes('"orbit"'),
          'JavaScript formatting changed a string token.');
      }
    },
    {
      id: 'regression.javascript.comment-token',
      description: 'JavaScript formatter preserves a comment token',
      run: async (context) => {
        assert((await formattedTokens(context)).includes('/* keep me */'),
          'JavaScript formatting changed a comment token.');
      }
    },
    {
      id: 'regression.javascript.asi',
      description: 'JavaScript formatter preserves an ASI-sensitive return newline',
      run: async () => {
        const viewer = await viewerModule();
        const source = 'function value(){return\n{x:1};}';
        assert(viewer.beautifyJavaScript(source) === source,
          'JavaScript formatting changed newline-sensitive automatic semicolon insertion.');
      }
    },
    {
      id: 'regression.javascript.template',
      description: 'JavaScript formatter preserves a nested template expression',
      run: async () => {
        const viewer = await viewerModule();
        const source = 'const value=`outer ${`inner ${1+2}`}`;';
        assert(viewer.beautifyJavaScript(source) === source,
          'JavaScript formatting changed a nested template expression.');
      }
    },
    {
      id: 'regression.javascript.division',
      description: 'JavaScript formatter preserves an ambiguous division expression',
      run: async () => {
        const viewer = await viewerModule();
        const source = 'const ratio=total/count;';
        assert(viewer.beautifyJavaScript(source) === source,
          'JavaScript formatting changed an ambiguous slash expression.');
      }
    },
    {
      id: 'regression.javascript.block-comment',
      description: 'JavaScript formatter keeps a return-side block comment inline',
      run: async () => {
        const viewer = await viewerModule();
        const formatted = viewer.beautifyJavaScript('function value(){return/* keep */1;}');
        assert(formatted.includes('return /* keep */ 1;'),
          'JavaScript formatting introduced a line break around a block comment.');
      }
    },
    {
      id: 'regression.javascript.unicode-line',
      description: 'JavaScript formatter preserves a Unicode line terminator boundary',
      run: async () => {
        const viewer = await viewerModule();
        const source = `function value(){return${String.fromCharCode(0x2028)}1;}`;
        assert(viewer.beautifyJavaScript(source) === source,
          'JavaScript formatting changed a Unicode line-terminator boundary.');
      }
    },
    {
      id: 'regression.viewer.large-source',
      description: 'large source preview reports that it was truncated',
      run: async (context) => {
        const { result, target } = await largePreview(context);
        assert(result.truncated === true && target.querySelector('.viewer-notice'),
          'A large source preview did not report truncation.');
      }
    },
    {
      id: 'regression.viewer.large-source-limit',
      description: 'large source preview stops at the display byte limit',
      run: async (context) => {
        const { target } = await largePreview(context);
        assert(target.querySelector('code')?.textContent.length === 256 * 1024,
          'A large source preview exceeded its display limit.');
      }
    },
    {
      id: 'regression.viewer.large-source-immutable',
      description: 'large source preview leaves the source value unchanged',
      run: async (context) => {
        const { source } = await largePreview(context);
        assert(source.length === (1024 * 1024) + 1,
          'A large source preview mutated its source value.');
      }
    },
    {
      id: 'regression.viewer.markdown-line-limit',
      description: 'oversized Markdown falls back to an inert bounded source view',
      run: async () => {
        const viewer = await viewerModule();
        const source = Array.from({ length: 5001 }, () => '- bounded').join('\n');
        const target = document.createElement('section');
        const result = viewer.renderMarkdown(target, source);
        assert(result.truncated === true && target.querySelector('.viewer-notice') &&
          target.querySelector('code')?.textContent === source,
        'Markdown line limits did not fall back to an inert bounded source view.');
      }
    },
    {
      id: 'regression.studio.brand-binding',
      description: 'Studio brand control preserves its inspected-tab query binding',
      run: async () => {
        const source = await (await fetchOk('/extension/studio/index.html')).text();
        const documentNode = new DOMParser().parseFromString(source, 'text/html');
        assert(!documentNode.querySelector('a.product[href]'),
          'The Studio brand control can discard its inspected-tab query binding.');
      }
    }
  ]
};
