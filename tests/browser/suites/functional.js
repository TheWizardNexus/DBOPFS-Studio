import { assert, fetchOk } from '../harness.js';

const viewerModule = () => import('/extension/shared/viewer.js');

async function manifest(context) {
  if (!context.manifest) {
    context.manifest = await (await fetchOk('/extension/manifest.json')).json();
  }
  return context.manifest;
}

async function extensionDocuments(context) {
  if (!context.extensionDocuments) {
    context.extensionDocuments = new Map();
    const popupPath = (await manifest(context)).action?.default_popup;
    assert(typeof popupPath === 'string' && popupPath.length > 0,
      'manifest.action.default_popup is missing.');
    for (const pagePath of [popupPath, 'studio/index.html', 'devtools/panel.html']) {
      const source = await (await fetchOk(`/extension/${pagePath}`)).text();
      context.extensionDocuments.set(
        pagePath,
        new DOMParser().parseFromString(source, 'text/html')
      );
    }
  }
  return context.extensionDocuments;
}

async function renderedMarkdown(context) {
  if (!context.renderedMarkdown) {
    const viewer = await viewerModule();
    const target = document.createElement('section');
    viewer.renderMarkdown(target, [
      '# Safe heading',
      '',
      '**Bold**',
      '',
      '- First item',
      '- Second item',
      '',
      '```js',
      'const literal = "<b>not markup</b>";',
      '```'
    ].join('\n'));
    context.renderedMarkdown = target;
  }
  return context.renderedMarkdown;
}

async function renderedJson(context) {
  if (!context.renderedJson) {
    const viewer = await viewerModule();
    const target = document.createElement('section');
    const source = '{"ready":true,"big":9007199254740993,"overflow":1e400,"negativeZero":-0}';
    viewer.renderTextPreview(target, { name: 'data.json', text: source });
    context.renderedJson = target.querySelector('code')?.textContent || '';
  }
  return context.renderedJson;
}

export default {
  name: 'Functional',
  cases: [
    {
      id: 'functional.manifest.mv3',
      description: 'extension manifest declares Manifest V3',
      run: async (context) => {
        const value = await manifest(context);
        assert(value.manifest_version === 3, 'Expected manifest_version 3.');
      }
    },
    {
      id: 'functional.manifest.name',
      description: 'extension manifest name identifies DBOPFS',
      run: async (context) => {
        const value = await manifest(context);
        assert(typeof value.name === 'string' && /DBOPFS/i.test(value.name),
          'The extension name must identify DBOPFS.');
      }
    },
    {
      id: 'functional.manifest.version',
      description: 'extension manifest includes a package version',
      run: async (context) => {
        const value = await manifest(context);
        assert(typeof value.version === 'string' && value.version.length > 0,
          'The extension version is missing.');
      }
    },
    {
      id: 'functional.manifest.popup-entry',
      description: 'manifest popup entry resolves to a packaged document',
      run: async (context) => {
        const value = await manifest(context);
        const popupPath = value.action?.default_popup;
        assert(typeof popupPath === 'string' && popupPath.length > 0,
          'manifest.action.default_popup is missing.');
        await fetchOk(`/extension/${popupPath}`);
      }
    },
    {
      id: 'functional.documents.language',
      description: 'extension documents declare English content',
      run: async (context) => {
        for (const [pagePath, documentNode] of await extensionDocuments(context)) {
          assert(documentNode.documentElement.lang === 'en', `${pagePath} needs lang="en".`);
        }
      }
    },
    {
      id: 'functional.documents.titles',
      description: 'extension document titles identify DBOPFS',
      run: async (context) => {
        for (const [pagePath, documentNode] of await extensionDocuments(context)) {
          assert(documentNode.title.trim().includes('DBOPFS'),
            `${pagePath} needs a DBOPFS title.`);
        }
      }
    },
    {
      id: 'functional.documents.unique-ids',
      description: 'extension documents use unique element identifiers',
      run: async (context) => {
        for (const [pagePath, documentNode] of await extensionDocuments(context)) {
          const ids = Array.from(documentNode.querySelectorAll('[id]'), (element) => element.id);
          assert(ids.length === new Set(ids).size, `${pagePath} contains duplicate element IDs.`);
        }
      }
    },
    {
      id: 'functional.documents.named-buttons',
      description: 'extension document buttons have accessible names',
      run: async (context) => {
        for (const [pagePath, documentNode] of await extensionDocuments(context)) {
          for (const button of documentNode.querySelectorAll('button')) {
            assert(Boolean(button.textContent.trim() || button.getAttribute('aria-label')),
              `${pagePath} contains an unnamed button.`);
          }
        }
      }
    },
    {
      id: 'functional.documents.image-text',
      description: 'extension document images provide alternative text',
      run: async (context) => {
        for (const [pagePath, documentNode] of await extensionDocuments(context)) {
          for (const image of documentNode.querySelectorAll('img')) {
            assert(image.hasAttribute('alt'), `${pagePath} contains an image without alt text.`);
          }
        }
      }
    },
    {
      id: 'functional.viewer.markdown-heading',
      description: 'Markdown viewer renders a heading',
      run: async (context) => {
        const target = await renderedMarkdown(context);
        assert(target.querySelector('h1')?.textContent === 'Safe heading',
          'Markdown heading rendering failed.');
      }
    },
    {
      id: 'functional.viewer.markdown-emphasis',
      description: 'Markdown viewer renders strong emphasis',
      run: async (context) => {
        const target = await renderedMarkdown(context);
        assert(target.querySelector('strong')?.textContent === 'Bold',
          'Markdown emphasis rendering failed.');
      }
    },
    {
      id: 'functional.viewer.markdown-list',
      description: 'Markdown viewer renders list items',
      run: async (context) => {
        const target = await renderedMarkdown(context);
        assert(target.querySelectorAll('li').length === 2,
          'Markdown list rendering failed.');
      }
    },
    {
      id: 'functional.viewer.markdown-code',
      description: 'Markdown viewer renders fenced code as text',
      run: async (context) => {
        const target = await renderedMarkdown(context);
        assert(target.querySelector('pre code')?.textContent.includes('not markup'),
          'Markdown fenced code rendering failed.');
      }
    },
    {
      id: 'functional.viewer.javascript-preview',
      description: 'JavaScript preview displays formatted source without mutating it',
      run: async () => {
        const viewer = await viewerModule();
        const source = 'const label="orbit";export function run(){return label;}';
        const formatted = viewer.beautifyJavaScript(source);
        const target = document.createElement('section');
        viewer.renderTextPreview(target, {
          name: 'worker.js',
          mime: 'text/javascript',
          text: source
        });
        assert(target.querySelector('code')?.textContent === formatted &&
          source.startsWith('const label='),
        'The JavaScript preview changed or bypassed its source fixture.');
      }
    },
    {
      id: 'functional.viewer.json-preview',
      description: 'JSON preview adds readable object indentation',
      run: async (context) => {
        assert((await renderedJson(context)).includes('\n  "ready": true,\n'),
          'The JSON preview did not add readable indentation.');
      }
    },
    {
      id: 'functional.viewer.json-large-integer',
      description: 'JSON preview preserves a large integer token',
      run: async (context) => {
        assert((await renderedJson(context)).includes('9007199254740993'),
          'The JSON preview changed a large integer token.');
      }
    },
    {
      id: 'functional.viewer.json-exponent',
      description: 'JSON preview preserves an exponent token',
      run: async (context) => {
        assert((await renderedJson(context)).includes('1e400'),
          'The JSON preview changed an exponent token.');
      }
    },
    {
      id: 'functional.viewer.json-negative-zero',
      description: 'JSON preview preserves a negative-zero token',
      run: async (context) => {
        assert((await renderedJson(context)).includes('-0'),
          'The JSON preview changed a negative-zero token.');
      }
    }
  ]
};
