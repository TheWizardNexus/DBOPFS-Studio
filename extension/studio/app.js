import { fileKind, formatBytes, formatDate, nativeMimeForFile, safeFilename } from '../shared/format.js';
import { renderTextPreview, textViewKind } from '../shared/viewer.js';

const CHANNEL = 'dbopfs-studio';
const DEMO_MP3_BASE64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxLEAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxMQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
const DEMO_MP4_BASE64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMNbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAfQAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAfQAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAH0AAAAAAABAAAAAAGvbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAIABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABWm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARpzdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMAQPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAmUAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAQAAIAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACZQAAAAEAAAAUc3RjbwAAAAAAAAABAAADPQAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAwAAAACGZyZWUAAAJtbWRhdAAAAlMGBf//T9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0xIGRlYmxvY2s9MDowOjAgYW5hbHlzZT0wOjAgbWU9ZGlhIHN1Ym1lPTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMiBtaXhlZF9yZWY9MCBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTAgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9MCB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MiBzY2VuZWN1dD0wIGludHJhX3JlZnJlc2g9MCByYz1jcmYgbWJ0cmVlPTAgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MACAAAAACmWIhDomKAAJAuA=';
const state = {
  tabId: null,
  connected: false,
  snapshot: null,
  selectedApp: null,
  selectedTable: null,
  selectedRecord: null,
  recordData: null,
  recordReadVersion: 0,
  recordViewMode: 'source',
  originalText: '',
  filter: '',
  activity: []
};

const elements = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map((element) => [element.id, element]));
const demoMode = new URLSearchParams(location.search).has('demo') || !globalThis.chrome?.runtime?.id;

function svgIcon(type) {
  if (type === 'app') return '<svg aria-hidden="true" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"></ellipse><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"></path><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path></svg>';
  return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3z"></path></svg>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function createDemoSnapshot() {
  const now = Date.now();
  return {
    origin: 'https://studio.demo.local',
    module: { name: 'DBOPFS', version: '1.0.0', ready: true },
    storage: { usage: 1842387, quota: 268435456, persisted: true, opfs: true },
    applications: [
      { id: 'arcane-library', tableCount: 4, recordCount: 12, size: 1283400, tables: [
        { name: 'documents', recordCount: 4, size: 931240, records: [
          { name: 'field-notes.json', size: 842, type: 'application/json', lastModified: now - 480000 },
          { name: 'constellation-map.pdf', size: 928104, type: 'application/pdf', lastModified: now - 86400000 },
          { name: 'readme.md', size: 2294, type: 'text/markdown', lastModified: now - 120000 },
          { name: 'worker.js', size: 194, type: 'text/javascript', lastModified: now - 90000 }
        ] },
        { name: 'users', recordCount: 2, size: 1280, records: [{ name: 'alex.json', size: 640, type: 'application/json', lastModified: now - 3600000 }] },
        { name: 'images', recordCount: 3, size: 302140, records: [
          { name: 'pixel.png', size: 68, type: 'image/png', lastModified: now - 70000 },
          { name: 'sample.mp3', size: 16, type: 'audio/mpeg', lastModified: now - 60000 },
          { name: 'sample.mp4', size: 24, type: 'video/mp4', lastModified: now - 50000 }
        ] },
        { name: 'memory', recordCount: 3, size: 4840, records: [] }
      ] },
      { id: 'dbopfs-playground', tableCount: 2, recordCount: 6, size: 558902, tables: [
        { name: 'notes', recordCount: 4, size: 8320, records: [{ name: 'welcome.txt', size: 128, type: 'text/plain', lastModified: now - 250000 }] },
        { name: 'reports', recordCount: 2, size: 550582, records: [] }
      ] }
    ]
  };
}

class DemoClient {
  snapshot = createDemoSnapshot();
  async request(action, data = {}) {
    if (action === 'scan') return structuredClone(this.snapshot);
    if (action === 'readRecord') {
      const name = data.record || '';
      if (name === 'constellation-map.pdf') {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      if (name.endsWith('.pdf')) {
        const bytes = new TextEncoder().encode('%PDF-1.4\n% DBOPFS Studio demo PDF\n%%EOF\n');
        return { encoding: 'base64', base64: encodeBase64(bytes), type: 'application/pdf', size: bytes.length, lastModified: Date.now() };
      }
      if (name.endsWith('.png')) {
        const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
        return { encoding: 'base64', base64, type: 'image/png', size: decodeBase64(base64).length, lastModified: Date.now() };
      }
      if (name.endsWith('.mp3')) {
        return { encoding: 'base64', base64: DEMO_MP3_BASE64, type: 'audio/mpeg', size: decodeBase64(DEMO_MP3_BASE64).length, lastModified: Date.now() };
      }
      if (name.endsWith('.mp4')) {
        return { encoding: 'base64', base64: DEMO_MP4_BASE64, type: 'video/mp4', size: decodeBase64(DEMO_MP4_BASE64).length, lastModified: Date.now() };
      }
      let text;
      let type = 'text/plain';
      if (name.endsWith('.json')) {
        text = JSON.stringify({ title: 'Field notes', status: 'durable', tags: ['opfs', 'dbopfs'], updated: new Date().toISOString() });
        type = 'application/json';
      } else if (name.endsWith('.js')) {
        text = 'export function orbit(items){return items.map((item)=>({name:item.name,active:true}));}';
        type = 'text/javascript';
      } else {
        text = `# ${name}\n\nThis record is stored locally through **DBOPFS**.\n\n- Inspect the source\n- Render the viewer`;
        type = name.endsWith('.md') ? 'text/markdown' : 'text/plain';
      }
      return { encoding: 'text', text, type, size: text.length, lastModified: Date.now() };
    }
    if (action === 'writeRecord') return { ok: true };
    if (action === 'deleteRecord') return { ok: true };
    if (action === 'createApplication') return { applicationId: data.applicationId };
    if (action === 'createTable') return { ok: true };
    if (action === 'createRecord') return { ok: true };
    if (action === 'export') {
      const applicationId = data.applicationId || 'dbopfs-demo';
      const text = JSON.stringify({ format: 'dbopfs-studio-export', version: 1, applicationId, value: {} }, null, 2);
      return { applicationId, fileName: `${applicationId}-dbopfs.json`, type: 'application/json', encoding: 'text', text, size: text.length };
    }
    throw new Error(`Demo action not implemented: ${action}`);
  }
}

class ExtensionClient {
  constructor(tabId) { this.tabId = tabId; }
  async request(action, data = {}) {
    const response = await chrome.tabs.sendMessage(this.tabId, { channel: CHANNEL, version: 1, action, data });
    if (!response?.ok) throw new Error(response?.error?.message || response?.error || 'The inspected page did not respond.');
    return response.data;
  }
}

let client;

function setConnected(connected, label) {
  state.connected = connected;
  document.body.classList.toggle('is-disconnected', !connected);
  elements['origin-label'].textContent = label;
  elements['status-connection'].textContent = connected ? 'Connected' : 'Disconnected';
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'error' : ''}`;
  item.textContent = message;
  elements.toasts.append(item);
  setTimeout(() => item.remove(), 4500);
}

function addActivity(action, detail) {
  state.activity.unshift({ action, detail, time: new Date() });
  state.activity = state.activity.slice(0, 50);
  renderActivity();
}

function renderActivity() {
  if (!state.activity.length) {
    elements['activity-list'].innerHTML = '<li><span class="activity-marker"></span><div><strong>No operations yet</strong><p>Refresh, open, or edit a record to begin this session history.</p></div></li>';
    return;
  }
  elements['activity-list'].innerHTML = state.activity.map((item) => `<li><span class="activity-marker"></span><div><strong>${escapeHtml(item.action)}</strong><p>${escapeHtml(item.detail)}</p></div><time>${item.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>`).join('');
}

function getTotals(snapshot) {
  return snapshot.applications.reduce((totals, app) => {
    totals.tables += app.tableCount ?? app.tables?.length ?? 0;
    totals.records += app.recordCount ?? app.tables?.reduce((sum, table) => sum + (table.recordCount ?? table.records?.length ?? 0), 0) ?? 0;
    return totals;
  }, { tables: 0, records: 0 });
}

function renderDashboard() {
  const { storage, applications, origin, module } = state.snapshot;
  const totals = getTotals(state.snapshot);
  elements['usage-value'].textContent = formatBytes(storage.usage);
  elements['quota-value'].textContent = `${formatBytes(storage.quota)} available to origin`;
  elements['apps-value'].textContent = String(applications.length);
  elements['tables-value'].textContent = String(totals.tables);
  elements['records-value'].textContent = String(totals.records);
  elements['records-detail'].textContent = totals.records === 1 ? 'DBOPFS record' : 'DBOPFS records';
  elements['profile-origin'].textContent = origin;
  elements['profile-persistence'].textContent = storage.persisted ? 'Persistent' : 'Best effort';
  elements['profile-opfs'].textContent = storage.opfs ? 'Available' : 'Unavailable';
  elements['profile-module'].textContent = module?.ready ? `${module.name || 'DBOPFS'} ${module.version || ''}`.trim() : 'Unavailable';
  elements['persistence-chip'].textContent = storage.persisted ? 'Persistent storage' : 'Best-effort storage';
  elements['persistence-chip'].classList.toggle('success', storage.persisted);
  const usagePercent = storage.quota ? Math.min((storage.usage / storage.quota) * 100, 100) : 0;
  elements['usage-orbit'].style.transform = `rotate(${Math.round(usagePercent * 3.6)}deg)`;
  elements['application-cards'].innerHTML = applications.length ? applications.map((app) => `
    <button class="application-card" type="button" data-open-app="${escapeHtml(app.id)}">
      <span class="application-card-icon">${escapeHtml(app.id.slice(0, 2).toUpperCase())}</span>
      <span><strong>${escapeHtml(app.id)}</strong><small>${app.tableCount ?? app.tables?.length ?? 0} tables · ${app.recordCount ?? 0} records · ${formatBytes(app.size ?? 0)}</small></span>
      <span aria-hidden="true">→</span>
    </button>`).join('') : '<div class="empty-inline">No DBOPFS application namespaces were found below <code>apps/</code> for this origin.</div>';
  elements['application-cards'].querySelectorAll('[data-open-app]').forEach((button) => button.addEventListener('click', () => selectApplication(button.dataset.openApp)));
}

function renderTree() {
  const applications = state.snapshot?.applications || [];
  elements.tree.innerHTML = applications.length ? applications.map((app) => `
    <div class="tree-group" role="group">
      <button class="tree-item ${state.selectedApp === app.id && !state.selectedTable ? 'is-selected' : ''}" type="button" role="treeitem" data-app="${escapeHtml(app.id)}" aria-expanded="true">${svgIcon('app')}<span>${escapeHtml(app.id)}</span></button>
      <div class="tree-children" role="group">${(app.tables || []).map((table) => `<button class="tree-item ${state.selectedApp === app.id && state.selectedTable === table.name ? 'is-selected' : ''}" type="button" role="treeitem" data-app="${escapeHtml(app.id)}" data-table="${escapeHtml(table.name)}">${svgIcon('table')}<span>${escapeHtml(table.name)}</span></button>`).join('')}</div>
    </div>`).join('') : '<div class="empty-inline">No DBOPFS applications</div>';
  elements.tree.querySelectorAll('[data-app]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.table) selectTable(button.dataset.app, button.dataset.table);
    else selectApplication(button.dataset.app);
  }));
}

function currentApp() { return state.snapshot?.applications.find((app) => app.id === state.selectedApp); }
function currentTable() { return currentApp()?.tables?.find((table) => table.name === state.selectedTable); }
function isEditorDirty() {
  return Boolean(
    state.selectedRecord &&
    state.recordData?.encoding === 'text' &&
    elements['record-editor'].value !== state.originalText
  );
}
function confirmDiscardChanges() { return !isEditorDirty() || window.confirm(`Discard unsaved changes to ${state.selectedRecord}?`); }

function renderBreadcrumbs() {
  const parts = [{ label: state.snapshot?.origin || 'Origin', action: 'dashboard' }];
  if (state.selectedApp) parts.push({ label: 'apps' }, { label: state.selectedApp, action: 'app' });
  if (state.selectedTable) parts.push({ label: state.selectedTable, action: 'table' });
  elements.breadcrumbs.innerHTML = parts.map((part, index) => `${index ? '<span aria-hidden="true">/</span>' : ''}<button type="button" data-crumb="${part.action || ''}">${escapeHtml(part.label)}</button>`).join('');
  elements.breadcrumbs.querySelector('[data-crumb="dashboard"]')?.addEventListener('click', () => showView('dashboard'));
  elements.breadcrumbs.querySelector('[data-crumb="app"]')?.addEventListener('click', () => selectApplication(state.selectedApp));
}

function renderRecords() {
  const table = currentTable();
  let records = table?.records || [];
  if (state.filter) records = records.filter((record) => record.name.toLowerCase().includes(state.filter));
  elements['record-rows'].innerHTML = records.map((record) => {
    const kind = fileKind(record.name, record.type || '');
    return `<tr tabindex="0" data-record="${escapeHtml(record.name)}" class="${state.selectedRecord === record.name ? 'is-selected' : ''}"><td><span class="file-name"><span class="file-type-icon">${kind.slice(0, 3).toUpperCase()}</span>${escapeHtml(record.name)}</span></td><td>${escapeHtml(record.type || kind)}</td><td>${formatBytes(record.size)}</td><td>${formatDate(record.lastModified)}</td><td><button class="row-action" type="button" aria-label="Open ${escapeHtml(record.name)}">›</button></td></tr>`;
  }).join('');
  elements['records-empty'].hidden = records.length > 0;
  elements['records-empty-title'].textContent = table ? 'No records here yet.' : 'No tables here yet.';
  elements['records-empty-copy'].textContent = table ? 'Create a record or import a file into this table.' : 'Create a table to begin storing DBOPFS records.';
  elements['new-record-button'].disabled = !table;
  elements['import-input'].disabled = !table;
  elements['import-label'].classList.toggle('is-disabled', !table);
  elements['record-rows'].querySelectorAll('[data-record]').forEach((row) => {
    row.addEventListener('click', () => openRecord(row.dataset.record));
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') openRecord(row.dataset.record); });
  });
  renderBreadcrumbs();
}

function showView(view) {
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}

function selectApplication(appId) {
  if (!confirmDiscardChanges()) return;
  if (state.selectedRecord) closeInspector(true);
  state.selectedApp = appId;
  state.selectedTable = currentApp()?.tables?.[0]?.name || null;
  state.selectedRecord = null;
  elements['status-selection'].textContent = appId;
  elements['export-app-button'].disabled = false;
  renderTree();
  renderRecords();
  showView('explorer');
}

function selectTable(appId, tableName) {
  if (!confirmDiscardChanges()) return;
  if (state.selectedRecord) closeInspector(true);
  state.selectedApp = appId;
  state.selectedTable = tableName;
  state.selectedRecord = null;
  elements['status-selection'].textContent = `${appId} / ${tableName}`;
  renderTree();
  renderRecords();
  showView('explorer');
}

function recordDescriptor(name) { return currentTable()?.records?.find((record) => record.name === name) || { name }; }

function releaseRecordObjectUrl(recordData = state.recordData) {
  if (recordData?.objectUrl) {
    URL.revokeObjectURL(recordData.objectUrl);
    delete recordData.objectUrl;
  }
}

function makeBlobUrl(data, descriptor, kind) {
  const bytes = data.base64 ? decodeBase64(data.base64) : new TextEncoder().encode(data.text || '');
  const type = nativeMimeForFile(kind, descriptor.name, data.type || descriptor.type || '');
  return {
    type,
    url: URL.createObjectURL(new Blob([bytes], { type }))
  };
}

function openNativeRecord() {
  if (state.recordData?.objectUrl) {
    window.open(state.recordData.objectUrl, '_blank', 'noopener');
  }
}

async function printRecord() {
  if (!state.recordData || !state.selectedRecord) return;
  const kind = fileKind(state.selectedRecord, state.recordData.type || state.recordData.descriptor?.type || '');
  if (kind === 'pdf') {
    openNativeRecord();
    toast('Use the native PDF viewer’s print command.');
    return;
  }

  if (demoMode) {
    window.print();
    return;
  }

  const id = crypto.randomUUID();
  const payload = {
    name: state.selectedRecord,
    path: `apps/${state.selectedApp}/${state.selectedTable}/${state.selectedRecord}`,
    kind,
    type: nativeMimeForFile(kind, state.selectedRecord, state.recordData.type || state.recordData.descriptor?.type || ''),
    viewKind: textViewKind(state.selectedRecord, state.recordData.type || state.recordData.descriptor?.type || ''),
    text: state.recordData.encoding === 'text' ? elements['record-editor'].value : undefined,
    base64: state.recordData.base64
  };
  await chrome.storage.session.set({ [`print:${id}`]: payload });
  window.open(chrome.runtime.getURL(`print/index.html?id=${encodeURIComponent(id)}`), '_blank', 'noopener');
  addActivity('Opened print view', payload.path);
}

function setRecordView(mode) {
  if (state.recordData?.encoding !== 'text') return;
  const nextMode = mode === 'viewer' ? 'viewer' : 'source';
  state.recordViewMode = nextMode;
  const showViewer = nextMode === 'viewer';
  elements.preview.hidden = !showViewer;
  elements['record-source'].hidden = showViewer;
  elements['viewer-mode'].setAttribute('aria-selected', String(showViewer));
  elements['viewer-mode'].tabIndex = showViewer ? 0 : -1;
  elements['source-mode'].setAttribute('aria-selected', String(!showViewer));
  elements['source-mode'].tabIndex = showViewer ? -1 : 0;
  if (showViewer) {
    renderTextPreview(elements.preview, {
      name: state.selectedRecord,
      mime: state.recordData.type || state.recordData.descriptor?.type || '',
      text: elements['record-editor'].value
    });
  }
}

function renderTextRecord(data, descriptor) {
  const text = data.text || '';
  const viewKind = textViewKind(descriptor.name, data.type || descriptor.type || '');
  state.recordData.viewKind = viewKind;
  state.originalText = text;
  state.recordViewMode = ['markdown', 'javascript', 'json'].includes(viewKind) ? 'viewer' : 'source';
  elements['record-mode-bar'].hidden = false;
  elements['viewer-mode'].textContent = ({
    markdown: 'Rendered',
    javascript: 'Beautified',
    json: 'Formatted'
  })[viewKind] || 'Viewer';
  elements['record-editor'].value = text;
  elements['record-editor'].disabled = false;
  elements['save-record'].hidden = false;
  elements['open-native'].hidden = true;
  elements['editor-status'].classList.remove('is-dirty');
  elements['editor-status'].textContent = ({
    markdown: 'Markdown source editing · rendered view is read-only',
    javascript: 'JavaScript source editing · beautified view is read-only',
    json: 'JSON source editing · validation runs before save'
  })[viewKind] || 'Text source editing';
  setRecordView(state.recordViewMode);
}

function mediaElement(kind, url, name) {
  if (kind === 'image') {
    const image = document.createElement('img');
    image.alt = `Preview of ${name}`;
    image.className = 'media-preview';
    image.decoding = 'async';
    image.src = url;
    return image;
  }
  if (kind === 'audio') {
    const audio = document.createElement('audio');
    audio.className = 'media-preview';
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = url;
    audio.setAttribute('aria-label', `Audio preview of ${name}`);
    return audio;
  }
  if (kind === 'video') {
    const video = document.createElement('video');
    video.className = 'media-preview';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    video.setAttribute('aria-label', `Video preview of ${name}`);
    return video;
  }
  return null;
}

function renderBinaryRecord(data, descriptor, kind) {
  const blob = makeBlobUrl(data, descriptor, kind);
  state.recordData.objectUrl = blob.url;
  state.recordData.objectType = blob.type;
  state.originalText = '';
  elements['record-editor'].value = '';
  elements['record-mode-bar'].hidden = true;
  elements['record-source'].hidden = true;
  elements.preview.hidden = false;
  elements['save-record'].hidden = true;
  const media = blob.type === 'application/octet-stream' ? null : mediaElement(kind, blob.url, descriptor.name);
  if (media) {
    elements.preview.append(media);
  } else {
    const card = document.createElement('div');
    card.className = 'native-file-card';
    const title = document.createElement('strong');
    title.textContent = kind === 'pdf' ? 'PDF' : 'Binary file';
    const detail = document.createElement('span');
    detail.textContent = kind === 'pdf'
      ? 'Opens in your Chromium browser’s native PDF viewer'
      : 'Use your browser or operating system to open this file';
    card.append(title, detail);
    elements.preview.append(card);
  }
  elements['open-native'].hidden = false;
  elements['open-native'].textContent = ({
    pdf: 'Open native PDF viewer',
    image: 'Open image in browser',
    audio: 'Open audio in browser',
    video: 'Open video in browser'
  })[kind] || 'Open in browser';
  elements['editor-status'].textContent = 'Binary contents are read-only in Studio';
}

function renderPreview(data, descriptor) {
  const kind = fileKind(descriptor.name, data.type || descriptor.type || '');
  elements.preview.replaceChildren();
  elements.preview.className = 'preview record-viewer';
  elements['open-native'].hidden = true;

  if (data.encoding === 'text') {
    renderTextRecord(data, descriptor);
    return;
  }

  renderBinaryRecord(data, descriptor, kind);
}

async function openRecord(name) {
  if (!state.selectedApp || !state.selectedTable) return;
  if (name !== state.selectedRecord && !confirmDiscardChanges()) return;
  const applicationId = state.selectedApp;
  const tableName = state.selectedTable;
  const readVersion = ++state.recordReadVersion;
  try {
    releaseRecordObjectUrl();
    state.selectedRecord = name;
    state.recordData = null;
    state.originalText = '';
    elements['inspector-empty'].hidden = false;
    elements['inspector-content'].hidden = true;
    elements.inspector.classList.add('is-open');
    renderRecords();
    const descriptor = recordDescriptor(name);
    const data = await client.request('readRecord', { applicationId, table: tableName, record: name, maxBytes: 32 * 1024 * 1024 });
    if (readVersion !== state.recordReadVersion || state.selectedApp !== applicationId ||
        state.selectedTable !== tableName || state.selectedRecord !== name) return;
    state.recordData = { ...data, descriptor };
    elements['inspector-empty'].hidden = true;
    elements['inspector-content'].hidden = false;
    elements.inspector.classList.add('is-open');
    elements['inspector-name'].textContent = name;
    elements['inspector-path'].textContent = `apps/${applicationId}/${tableName}/${name}`;
    elements['inspector-type'].textContent = data.type || descriptor.type || fileKind(name);
    elements['inspector-size'].textContent = formatBytes(data.size ?? descriptor.size);
    elements['inspector-modified'].textContent = formatDate(data.lastModified ?? descriptor.lastModified);
    renderPreview(data, descriptor);
    addActivity('Opened record', `${applicationId}/${tableName}/${name}`);
  } catch (error) {
    if (readVersion !== state.recordReadVersion) return;
    closeInspector(true);
    toast(error.message, 'error');
  }
}

async function refresh() {
  elements['refresh-button'].disabled = true;
  try {
    state.snapshot = await client.request('scan');
    const selectedApplication = state.snapshot.applications.find((app) => app.id === state.selectedApp);
    const selectedTable = selectedApplication?.tables?.find((table) => table.name === state.selectedTable);
    if (state.selectedApp && !selectedApplication) {
      if (state.selectedRecord) closeInspector(true);
      state.selectedApp = null;
      state.selectedTable = null;
    } else if (state.selectedTable && !selectedTable) {
      if (state.selectedRecord) closeInspector(true);
      state.selectedTable = selectedApplication?.tables?.[0]?.name || null;
    } else if (state.selectedRecord &&
        !selectedTable?.records?.some((record) => record.name === state.selectedRecord)) {
      closeInspector(true);
    }
    elements['export-app-button'].disabled = !state.selectedApp;
    setConnected(true, state.snapshot.origin);
    renderDashboard();
    renderTree();
    if (state.selectedTable) renderRecords();
    addActivity('Refreshed storage', state.snapshot.origin);
  } catch (error) {
    setConnected(false, 'Connection unavailable');
    elements['profile-module'].textContent = 'Unavailable';
    toast(`${error.message} Reload the inspected page if the extension was just installed.`, 'error');
  } finally { elements['refresh-button'].disabled = false; }
}

function promptValue({ eyebrow = 'DBOPFS Studio', title, description, label = 'Name', confirm = 'Continue', value = '' }) {
  return new Promise((resolve) => {
    elements['dialog-eyebrow'].textContent = eyebrow;
    elements['dialog-title'].textContent = title;
    elements['dialog-description'].textContent = description;
    elements['dialog-field-label'].childNodes[0].textContent = label;
    elements['dialog-input'].value = value;
    elements['dialog-confirm'].textContent = confirm;
    elements['dialog-error'].textContent = '';
    const close = () => { elements['form-dialog'].removeEventListener('close', close); resolve(elements['form-dialog'].returnValue === 'confirm' ? elements['dialog-input'].value.trim() : null); };
    elements['form-dialog'].addEventListener('close', close);
    elements['form-dialog'].showModal();
    elements['dialog-input'].focus();
  });
}

async function createTable() {
  if (!state.selectedApp) return toast('Choose a DBOPFS application first.', 'error');
  const name = await promptValue({ title: 'Create table', description: `Add a table to ${state.selectedApp}.`, label: 'Table name', confirm: 'Create table' });
  if (!name) return;
  try { await client.request('createTable', { applicationId: state.selectedApp, table: name }); addActivity('Created table', `${state.selectedApp}/${name}`); await refresh(); selectTable(state.selectedApp, name); } catch (error) { toast(error.message, 'error'); }
}

async function createApplication() {
  const applicationId = await promptValue({
    title: 'Create DBOPFS application',
    description: 'Create a canonical application namespace below apps/. Use lowercase letters, numbers, and hyphens.',
    label: 'Application ID',
    confirm: 'Create application'
  });
  if (!applicationId) return;
  try {
    await client.request('createApplication', { applicationId });
    addActivity('Created application', applicationId);
    await refresh();
    selectApplication(applicationId);
  } catch (error) { toast(error.message, 'error'); }
}

async function exportApplication() {
  if (!state.selectedApp) return toast('Choose a DBOPFS application first.', 'error');
  try {
    const exported = await client.request('export', { applicationId: state.selectedApp });
    const blob = new Blob([exported.text || ''], { type: exported.type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFilename(exported.fileName || `${state.selectedApp}-dbopfs.json`);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addActivity('Exported application', state.selectedApp);
    toast(`${state.selectedApp} exported.`);
  } catch (error) { toast(error.message, 'error'); }
}

async function createRecord() {
  if (!state.selectedApp || !state.selectedTable) return toast('Choose a DBOPFS table first.', 'error');
  const name = await promptValue({ title: 'Create record', description: `Add a record to ${state.selectedTable}. Use .json for structured values.`, label: 'File name', confirm: 'Create record' });
  if (!name) return;
  try { await client.request('createRecord', { applicationId: state.selectedApp, table: state.selectedTable, record: name, text: name.endsWith('.json') ? '{}\n' : '' }); addActivity('Created record', `${state.selectedApp}/${state.selectedTable}/${name}`); await refresh(); selectTable(state.selectedApp, state.selectedTable); await openRecord(name); } catch (error) { toast(error.message, 'error'); }
}

async function saveRecord() {
  if (!state.selectedRecord || state.recordData?.encoding !== 'text') {
    return toast('This record is read-only in Studio.', 'error');
  }
  const applicationId = state.selectedApp;
  const tableName = state.selectedTable;
  const recordName = state.selectedRecord;
  const recordData = state.recordData;
  const text = elements['record-editor'].value;
  if (fileKind(recordName, recordData.type || '') === 'json') {
    try { JSON.parse(text); } catch (error) { return toast(`JSON is not valid: ${error.message}`, 'error'); }
  }
  try {
    const result = await client.request('writeRecord', {
      applicationId,
      table: tableName,
      record: recordName,
      text,
      expectedLastModified: recordData.lastModified ?? recordData.descriptor?.lastModified
    });
    if (state.selectedApp === applicationId && state.selectedTable === tableName &&
        state.selectedRecord === recordName && state.recordData === recordData) {
      if (result?.metadata) state.recordData = { ...recordData, ...result.metadata };
      state.originalText = text;
      const dirty = elements['record-editor'].value !== text;
      elements['editor-status'].textContent = dirty ? 'Unsaved changes' : 'Saved through DBOPFS';
      elements['editor-status'].classList.toggle('is-dirty', dirty);
    }
    addActivity('Saved record', `${applicationId}/${tableName}/${recordName}`);
    toast(`${recordName} saved through DBOPFS.`);
    await refresh();
  } catch (error) { toast(error.message, 'error'); }
}

async function deleteRecord() {
  if (!state.selectedRecord) return;
  const confirmation = await promptValue({ eyebrow: 'Destructive action', title: 'Delete record?', description: `Permanently delete ${state.selectedRecord} from ${state.selectedTable}. Type the exact file name to confirm.`, label: 'File name', confirm: 'Delete record' });
  if (confirmation !== state.selectedRecord) return confirmation && toast('The file name did not match.', 'error');
  try { const path = `${state.selectedApp}/${state.selectedTable}/${state.selectedRecord}`; await client.request('deleteRecord', { applicationId: state.selectedApp, table: state.selectedTable, record: state.selectedRecord }); closeInspector(true); addActivity('Deleted record', path); toast('Record deleted.'); await refresh(); } catch (error) { toast(error.message, 'error'); }
}

function closeInspector(force = false) {
  if (!force && !confirmDiscardChanges()) return;
  state.recordReadVersion += 1;
  releaseRecordObjectUrl();
  state.selectedRecord = null; state.recordData = null; state.originalText = '';
  elements['inspector-empty'].hidden = false; elements['inspector-content'].hidden = true; elements.inspector.classList.remove('is-open');
  renderRecords();
}

async function importFiles(files) {
  if (!state.selectedApp || !state.selectedTable) return toast('Choose a DBOPFS table first.', 'error');
  for (const file of files) {
    if (file.size > 16 * 1024 * 1024) { toast(`${file.name} exceeds the 16 MB import limit.`, 'error'); continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try { await client.request('writeRecord', { applicationId: state.selectedApp, table: state.selectedTable, record: file.name, base64: encodeBase64(bytes), type: file.type }); addActivity('Imported record', `${state.selectedApp}/${state.selectedTable}/${file.name}`); } catch (error) { toast(`${file.name}: ${error.message}`, 'error'); }
  }
  await refresh();
}

function wireEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  elements['origin-switcher'].addEventListener('click', () => toast('Studio is connected to the tab shown here. Open Studio from another site to switch origins.'));
  elements['refresh-button'].addEventListener('click', refresh);
  elements['new-app-button'].addEventListener('click', createApplication);
  elements['export-app-button'].addEventListener('click', exportApplication);
  elements['browse-button'].addEventListener('click', () => state.snapshot?.applications[0] ? selectApplication(state.snapshot.applications[0].id) : toast('No DBOPFS applications found.', 'error'));
  elements['new-table-button'].addEventListener('click', createTable);
  elements['new-record-button'].addEventListener('click', createRecord);
  elements['save-record'].addEventListener('click', saveRecord);
  elements['delete-record'].addEventListener('click', deleteRecord);
  elements['close-inspector'].addEventListener('click', () => closeInspector());
  elements['open-native'].addEventListener('click', openNativeRecord);
  elements['print-record'].addEventListener('click', printRecord);
  elements['viewer-mode'].addEventListener('click', () => setRecordView('viewer'));
  elements['source-mode'].addEventListener('click', () => setRecordView('source'));
  elements['record-mode-bar'].addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [elements['viewer-mode'], elements['source-mode']];
    const current = tabs.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
    tabs[next].focus();
  });
  elements['record-editor'].addEventListener('input', () => { const dirty = elements['record-editor'].value !== state.originalText; elements['editor-status'].textContent = dirty ? 'Unsaved changes' : 'No unsaved changes'; elements['editor-status'].classList.toggle('is-dirty', dirty); });
  elements['global-search'].addEventListener('input', () => { state.filter = elements['global-search'].value.trim().toLowerCase(); if (state.selectedTable) renderRecords(); });
  elements['import-input'].addEventListener('change', () => importFiles(Array.from(elements['import-input'].files || [])));
  elements['clear-activity'].addEventListener('click', () => { state.activity = []; renderActivity(); });
  elements['help-button'].addEventListener('click', () => elements['about-dialog'].showModal());
  elements['about-close'].addEventListener('click', () => elements['about-dialog'].close());
  elements['dialog-cancel'].addEventListener('click', () => elements['form-dialog'].close('cancel'));
  elements['dialog-form'].addEventListener('submit', (event) => { event.preventDefault(); if (!elements['dialog-input'].value.trim()) { elements['dialog-error'].textContent = 'Enter a value to continue.'; return; } elements['form-dialog'].close('confirm'); });
  document.addEventListener('keydown', (event) => { if (event.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { event.preventDefault(); elements['global-search'].focus(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.recordData?.encoding === 'text') { event.preventDefault(); saveRecord(); } });
  window.addEventListener('beforeunload', (event) => {
    if (isEditorDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => releaseRecordObjectUrl());
}

async function initialize() {
  wireEvents();
  renderActivity();
  if (demoMode) {
    client = new DemoClient();
    state.tabId = 0;
  } else {
    const params = new URLSearchParams(location.search);
    state.tabId = Number(params.get('tab'));
    if (!Number.isInteger(state.tabId) || state.tabId <= 0) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      state.tabId = tab?.id;
    }
    if (!state.tabId) throw new Error('No inspectable browser tab was selected.');
    client = new ExtensionClient(state.tabId);
  }
  await refresh();
}

initialize().catch((error) => { setConnected(false, 'No origin selected'); toast(error.message, 'error'); });
