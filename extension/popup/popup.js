const title = document.querySelector('#site-title');
const status = document.querySelector('#site-status');
const openButton = document.querySelector('#open-studio');
let activeTabId = null;

function isInspectable(url) {
  return /^https?:\/\//.test(url || '');
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  if (!tab || !isInspectable(tab.url)) {
    title.textContent = 'This page is protected';
    status.textContent = 'Open an HTTP or HTTPS site to inspect its DBOPFS data.';
    openButton.disabled = true;
    return;
  }

  const url = new URL(tab.url);
  title.textContent = url.origin;
  status.textContent = 'Ready to inspect DBOPFS applications and their origin-private files.';
}

openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  await chrome.runtime.sendMessage({
    channel: 'dbopfs-studio:background',
    action: 'openStudio',
    tabId: activeTabId
  });
  window.close();
});

initialize().catch((error) => {
  title.textContent = 'Unable to inspect this tab';
  status.textContent = error.message;
  openButton.disabled = true;
});
