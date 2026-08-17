import { assert } from '../harness.js';

const protocolModule = () => import('/extension/shared/dbopfs-protocol.js');
const clientModule = () => import('/extension/shared/dbopfs-client.js');
const formatModule = () => import('/extension/shared/format.js');
const viewerModule = () => import('/extension/shared/viewer.js');

async function successResponseFixture(context) {
  if (!context.unitSuccessResponse) {
    const protocol = await protocolModule();
    const request = protocol.createRequest(
      protocol.DBOPFS_STUDIO_OPERATIONS.SCAN,
      {},
      'unit-success-response'
    );
    context.unitSuccessResponse = {
      protocol,
      request,
      response: protocol.createSuccessResponse(request, { applications: [] })
    };
  }
  return context.unitSuccessResponse;
}

export default {
  name: 'Unit',
  cases: [
    {
      id: 'unit.protocol.exports',
      description: 'protocol module exposes its browser message contract',
      run: async () => {
        const protocol = await protocolModule();
        assert(typeof protocol.createRequest === 'function' &&
          typeof protocol.assertResponse === 'function' &&
          Object.keys(protocol.DBOPFS_STUDIO_OPERATIONS).length > 0,
        'The protocol module is missing a required export.');
      }
    },
    {
      id: 'unit.protocol.application-id',
      description: 'protocol accepts a canonical application identifier',
      run: async () => {
        const protocol = await protocolModule();
        assert(protocol.assertApplicationId('dbopfs-studio') === 'dbopfs-studio',
          'A canonical DBOPFS application ID was rejected.');
      }
    },
    {
      id: 'unit.protocol.entry-name',
      description: 'protocol accepts a safe record name',
      run: async () => {
        const protocol = await protocolModule();
        assert(protocol.assertEntryName('record.json') === 'record.json',
          'A safe record name was rejected.');
      }
    },
    {
      id: 'unit.protocol.raw-path',
      description: 'protocol normalizes a raw OPFS path',
      run: async () => {
        const protocol = await protocolModule();
        assert(protocol.normalizeRawPath('/apps/demo/notes').join('/') === 'apps/demo/notes',
          'A raw OPFS path was not normalized.');
      }
    },
    {
      id: 'unit.protocol.byte-limit',
      description: 'protocol normalizes a valid byte limit',
      run: async () => {
        const protocol = await protocolModule();
        assert(protocol.clampByteLimit('1024') === 1024,
          'A valid byte limit was not normalized.');
      }
    },
    {
      id: 'unit.protocol.request-envelope',
      description: 'protocol creates and validates a request envelope',
      run: async () => {
        const protocol = await protocolModule();
        const request = protocol.createRequest(
          protocol.DBOPFS_STUDIO_OPERATIONS.SCAN,
          { includeRecords: true },
          'unit-request-envelope'
        );
        assert(protocol.assertRequest(request) === request,
          'A valid request envelope was rejected.');
      }
    },
    {
      id: 'unit.protocol.success-response',
      description: 'protocol validates a matching success response',
      run: async (context) => {
        const { protocol, request, response } = await successResponseFixture(context);
        assert(protocol.assertResponse(response, request) === response,
          'A matching success response was rejected.');
      }
    },
    {
      id: 'unit.protocol.message-recognition',
      description: 'protocol recognizes a success response as its own message',
      run: async (context) => {
        const { protocol, response } = await successResponseFixture(context);
        assert(protocol.isProtocolMessage(response),
          'A protocol success response was not recognized.');
      }
    },
    {
      id: 'unit.protocol.error-response',
      description: 'protocol preserves an error code and message',
      run: async () => {
        const protocol = await protocolModule();
        const request = protocol.createRequest(
          protocol.DBOPFS_STUDIO_OPERATIONS.PING,
          {},
          'unit-error-response'
        );
        const response = protocol.createErrorResponse(
          request,
          Object.assign(new Error('No access'), { code: 'DENIED' })
        );
        const error = protocol.responseError(response);
        assert(error.code === 'DENIED' && error.message === 'No access',
          'A protocol error lost its code or message.');
      }
    },
    {
      id: 'unit.client.export',
      description: 'Studio client module exports its client constructor',
      run: async () => {
        const client = await clientModule();
        assert(typeof client.DBOPFSStudioClient === 'function',
          'DBOPFSStudioClient must be exported.');
      }
    },
    {
      id: 'unit.format.bytes',
      description: 'format helper renders a fractional kibibyte label',
      run: async () => {
        const format = await formatModule();
        assert(format.formatBytes(1536) === '1.5 KB', 'Byte formatting is incorrect.');
      }
    },
    {
      id: 'unit.format.invalid-bytes',
      description: 'format helper uses a placeholder for an invalid byte count',
      run: async () => {
        const format = await formatModule();
        assert(format.formatBytes(-1) === '—', 'Invalid byte counts need a placeholder.');
      }
    },
    {
      id: 'unit.format.date',
      description: 'format helper labels an invalid date as unknown',
      run: async () => {
        const format = await formatModule();
        assert(format.formatDate('not-a-date') === 'Unknown',
          'Invalid dates need an Unknown placeholder.');
      }
    },
    {
      id: 'unit.format.file-kind-pdf',
      description: 'format helper classifies a PDF file',
      run: async () => {
        const format = await formatModule();
        assert(format.fileKind('report.pdf') === 'pdf', 'PDF classification failed.');
      }
    },
    {
      id: 'unit.format.file-kind-image',
      description: 'format helper classifies an image MIME type',
      run: async () => {
        const format = await formatModule();
        assert(format.fileKind('image.webp', 'image/webp') === 'image',
          'Image classification failed.');
      }
    },
    {
      id: 'unit.format.file-kind-audio',
      description: 'format helper classifies an audio file',
      run: async () => {
        const format = await formatModule();
        assert(format.fileKind('recording.mp3') === 'audio', 'Audio classification failed.');
      }
    },
    {
      id: 'unit.format.file-kind-video',
      description: 'format helper classifies a video file',
      run: async () => {
        const format = await formatModule();
        assert(format.fileKind('recording.mp4') === 'video', 'Video classification failed.');
      }
    },
    {
      id: 'unit.format.file-kind-json',
      description: 'format helper classifies a JSON MIME type',
      run: async () => {
        const format = await formatModule();
        assert(format.fileKind('data.json', 'application/json') === 'json',
          'JSON classification failed.');
      }
    },
    {
      id: 'unit.format.mime-pdf',
      description: 'format helper infers the PDF download MIME type',
      run: async () => {
        const format = await formatModule();
        assert(format.mimeForFile('document.pdf') === 'application/pdf',
          'PDF MIME inference failed.');
      }
    },
    {
      id: 'unit.format.mime-image',
      description: 'format helper infers a PNG download MIME type',
      run: async () => {
        const format = await formatModule();
        assert(format.mimeForFile('photo.png') === 'image/png',
          'Image MIME inference failed.');
      }
    },
    {
      id: 'unit.format.mime-javascript',
      description: 'format helper lets a CJS extension replace a generic MIME type',
      run: async () => {
        const format = await formatModule();
        assert(format.mimeForFile('module.cjs', 'APPLICATION/OCTET-STREAM') === 'text/javascript',
          'A generic MIME prevented safe extension inference.');
      }
    },
    {
      id: 'unit.format.mime-fallback',
      description: 'format helper falls back to binary for an unknown file',
      run: async () => {
        const format = await formatModule();
        assert(format.mimeForFile('unknown.bin') === 'application/octet-stream',
          'Binary MIME fallback failed.');
      }
    },
    {
      id: 'unit.format.native-audio',
      description: 'format helper infers an audio MIME type for native viewing',
      run: async () => {
        const format = await formatModule();
        assert(format.nativeMimeForFile('audio', 'recording.mp3') === 'audio/mpeg',
          'Audio native MIME inference failed.');
      }
    },
    {
      id: 'unit.format.native-video',
      description: 'format helper infers a video MIME type for native viewing',
      run: async () => {
        const format = await formatModule();
        assert(format.nativeMimeForFile('video', 'recording.mp4') === 'video/mp4',
          'Video native MIME inference failed.');
      }
    },
    {
      id: 'unit.format.filename',
      description: 'format helper replaces unsafe download filename characters',
      run: async () => {
        const format = await formatModule();
        assert(format.safeFilename('unsafe:name?.json') === 'unsafe-name-.json',
          'Unsafe download characters were not replaced.');
      }
    },
    {
      id: 'unit.viewer.kind-markdown',
      description: 'viewer helper classifies Markdown text',
      run: async () => {
        const viewer = await viewerModule();
        assert(viewer.textViewKind('README.md', 'text/plain') === 'markdown',
          'Markdown extension detection failed.');
      }
    },
    {
      id: 'unit.viewer.kind-javascript',
      description: 'viewer helper classifies JavaScript text',
      run: async () => {
        const viewer = await viewerModule();
        assert(viewer.textViewKind('worker.cjs') === 'javascript',
          'JavaScript extension detection failed.');
      }
    },
    {
      id: 'unit.viewer.kind-json',
      description: 'viewer helper classifies a JSON-compatible MIME type',
      run: async () => {
        const viewer = await viewerModule();
        assert(viewer.textViewKind('payload', 'application/problem+json') === 'json',
          'JSON MIME detection failed.');
      }
    },
    {
      id: 'unit.viewer.javascript-format',
      description: 'viewer helper formats ordinary JavaScript for display',
      run: async () => {
        const viewer = await viewerModule();
        const source = 'const label="orbit";export function run(value){if(value){return label;}}';
        const formatted = viewer.beautifyJavaScript(source);
        assert(formatted !== source && formatted.includes('\n'),
          'JavaScript was not formatted for display.');
      }
    },
    {
      id: 'unit.viewer.javascript-idempotence',
      description: 'viewer helper keeps formatted JavaScript deterministic',
      run: async () => {
        const viewer = await viewerModule();
        const formatted = viewer.beautifyJavaScript(
          'const label="orbit";export function run(){return label;}'
        );
        assert(viewer.beautifyJavaScript(formatted) === formatted,
          'JavaScript display formatting is not deterministic.');
      }
    }
  ]
};
