const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const amount = bytes / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${UNITS[index]}`;
}

export function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function fileKind(name = '', mime = '') {
  mime = String(mime).toLowerCase().split(';', 1)[0].trim();
  const extension = name.toLowerCase().split('.').pop();
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'].includes(extension)) return 'image';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(extension)) return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) return 'video';
  if (mime.includes('json') || extension === 'json') return 'json';
  if (mime.startsWith('text/') || ['txt', 'md', 'markdown', 'csv', 'js', 'mjs', 'cjs', 'css', 'html', 'xml', 'svg', 'jsonl', 'ndjson'].includes(extension)) return 'text';
  return 'binary';
}

export function mimeForFile(name = '', mime = '') {
  const normalizedMime = String(mime).toLowerCase().split(';', 1)[0].trim();
  if (normalizedMime && normalizedMime !== 'application/octet-stream') return normalizedMime;
  const extension = name.toLowerCase().split('.').pop();
  return ({
    pdf: 'application/pdf', json: 'application/json', jsonl: 'application/x-ndjson', ndjson: 'application/x-ndjson',
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', css: 'text/css',
    html: 'text/html', htm: 'text/html', xml: 'application/xml', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg'
  })[extension] || 'application/octet-stream';
}

const NATIVE_MIME_TYPES = Object.freeze({
  image: new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon', 'image/avif']),
  audio: new Set(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/webm']),
  video: new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'])
});

export function nativeMimeForFile(kind, name = '', mime = '') {
  if (kind === 'pdf') return 'application/pdf';
  const approved = NATIVE_MIME_TYPES[kind];
  if (!approved) return 'application/octet-stream';
  const supplied = String(mime).toLowerCase().split(';', 1)[0].trim();
  const inferred = mimeForFile(name);
  if (approved.has(supplied)) return supplied;
  if (approved.has(inferred)) return inferred;
  return 'application/octet-stream';
}

export function safeFilename(name = 'download') {
  return String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 180) || 'download';
}
