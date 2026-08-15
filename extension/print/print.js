import { renderTextPreview } from '../shared/viewer.js';

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function initialize() {
  const id = new URLSearchParams(location.search).get('id');
  const key = `print:${id}`;
  const payload = (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.remove(key);
  if (!payload) throw new Error('This print record is no longer available.');

  document.querySelector('#record-name').textContent = payload.name;
  document.querySelector('#record-path').textContent = payload.path;
  const content = document.querySelector('#print-content');

  if (payload.kind === 'image' && payload.base64) {
    const url = URL.createObjectURL(new Blob([decodeBase64(payload.base64)], { type: payload.type || 'image/png' }));
    const image = document.createElement('img');
    image.alt = payload.name;
    image.src = url;
    await image.decode();
    content.append(image);
  } else if (typeof payload.text === 'string') {
    renderTextPreview(content, {
      name: payload.name,
      mime: payload.type,
      text: payload.text
    });
  } else {
    const message = document.createElement('p');
    message.className = 'message';
    message.textContent = 'This file type does not have a printable Studio preview. Open it in the browser first.';
    content.append(message);
  }

  document.title = `${payload.name} — DBOPFS Studio`;
  requestAnimationFrame(() => window.print());
}

initialize().catch((error) => {
  document.querySelector('#print-content').textContent = error.message;
});
