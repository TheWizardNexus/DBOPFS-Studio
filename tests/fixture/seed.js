import DBOPFS from '/extension/vendor/dbopfs/arcane/modules/DBOPFS.js';

const database = new DBOPFS();

try {
  await database.readyPromise;
  await database.set('notes', 'integration.json', {
    source: 'vanilla-test fixture',
    status: 'seeded'
  });
  document.querySelector('#status').textContent = 'DBOPFS fixture ready';
  globalThis.__DBOPFS_FIXTURE__ = { database, ready: true };
} catch (error) {
  document.querySelector('#status').textContent = `Fixture failed: ${error.message}`;
  globalThis.__DBOPFS_FIXTURE__ = {
    error: error instanceof Error ? error.message : String(error),
    ready: false
  };
}
