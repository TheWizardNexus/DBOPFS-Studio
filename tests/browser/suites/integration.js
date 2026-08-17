import { assert, fetchOk } from '../harness.js';

async function exerciseClient(operation) {
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
  const result = await operation(client);
  return { protocol, requests, result };
}

async function scanExercise(context) {
  if (!context.integrationScanExercise) {
    context.integrationScanExercise = await exerciseClient(
      (client) => client.scan({ includeRecords: false })
    );
  }
  return context.integrationScanExercise;
}

export default {
  name: 'Integration',
  cases: [
    {
      id: 'integration.opfs.round-trip',
      description: 'real OPFS completes a write, read, and delete round trip',
      run: async () => {
        const root = await navigator.storage.getDirectory();
        const directoryName = `dbopfs-studio-test-${crypto.randomUUID()}`;
        try {
          const directory = await root.getDirectoryHandle(directoryName, { create: true });
          const handle = await directory.getFileHandle('round-trip.txt', { create: true });
          const writable = await handle.createWritable();
          await writable.write('DBOPFS Studio');
          await writable.close();
          assert(await (await handle.getFile()).text() === 'DBOPFS Studio',
            'The OPFS round trip changed file content.');
        } finally {
          await root.removeEntry(directoryName, { recursive: true });
        }
      }
    },
    {
      id: 'integration.vendor.package-metadata',
      description: 'bundled DBOPFS package metadata is available to Studio tests',
      run: async () => {
        const metadata = await (await fetchOk('/extension/vendor/dbopfs/package.json')).json();
        assert(metadata.name === 'dbopfs' && typeof metadata.version === 'string',
          'The bundled DBOPFS package metadata is incomplete.');
      }
    },
    {
      id: 'integration.manifest.web-resources',
      description: 'manifest web-accessible DBOPFS bridge modules are packaged',
      run: async () => {
        const manifest = await (await fetchOk('/extension/manifest.json')).json();
        const resources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources) || [];
        const required = [
          'agent/dbopfs-page-agent.js',
          'shared/dbopfs-protocol.js',
          'vendor/dbopfs/arcane/modules/DBOPFSStudio.js',
          'vendor/dbopfs/arcane/modules/DBOPFSWorker.js'
        ];
        assert(required.every((resource) => resources.includes(resource)),
          'A required DBOPFS bridge module is not web accessible.');
        await Promise.all(required.map((resource) => fetchOk(`/extension/${resource}`)));
      }
    },
    {
      id: 'integration.client.scan',
      description: 'Studio client routes a request through the active Chromium tab',
      run: async (context) => {
        const { requests } = await scanExercise(context);
        assert(requests.length === 1 && requests[0].tabId === 41,
          'The client used the wrong active tab.');
      }
    },
    {
      id: 'integration.client.scan-operation',
      description: 'Studio client emits the typed scan operation',
      run: async (context) => {
        const { protocol, result } = await scanExercise(context);
        assert(result.operation === protocol.DBOPFS_STUDIO_OPERATIONS.SCAN,
          'The client sent the wrong scan operation.');
      }
    },
    {
      id: 'integration.client.read-record',
      description: 'Studio client preserves a record address in a typed request',
      run: async () => {
        const { result } = await exerciseClient((client) => client.readRecord(
          'notes',
          'entry.json',
          { applicationId: 'dbopfs-studio' }
        ));
        assert(result.payload.applicationId === 'dbopfs-studio' &&
          result.payload.tableName === 'notes' &&
          result.payload.fileName === 'entry.json',
        'The client did not preserve the record address.');
      }
    },
    {
      id: 'integration.client.raw-write',
      description: 'Studio client preserves a raw OPFS write path and payload',
      run: async () => {
        const { result } = await exerciseClient(
          (client) => client.rawWrite(['exports', 'record.json'], '{"ready":true}')
        );
        assert(result.payload.path.join('/') === 'exports/record.json' &&
          result.payload.data === '{"ready":true}',
        'The client changed a raw OPFS write request.');
      }
    }
  ]
};
