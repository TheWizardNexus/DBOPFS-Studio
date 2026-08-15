const title = document.querySelector('#site-title');
const status = document.querySelector('#site-status');
const openButton = document.querySelector('#open-studio-window');
const parameter = Number(new URLSearchParams(location.search).get('tab'));
const inspectedTabId = Number.isInteger(parameter) && parameter > 0
  ? parameter
  : chrome.devtools?.inspectedWindow?.tabId;

function isInspectable(url) {
  return /^https?:\/\//.test(url || '');
}

async function initialize() {
  if (!Number.isInteger(inspectedTabId)) {
    throw new Error('DevTools did not provide an inspected tab.');
  }
  const tab = await chrome.tabs.get(inspectedTabId);
  if (!isInspectable(tab?.url)) {
    title.textContent = 'This page is protected';
    status.textContent = 'Open DevTools on an HTTP or HTTPS page to inspect its DBOPFS data.';
    openButton.disabled = true;
    return;
  }
  title.textContent = new URL(tab.url).origin;
  status.textContent = 'Ready to open DBOPFS Studio in a dedicated window for this inspected page.';
}

openButton.addEventListener('click', async () => {
  openButton.disabled = true;
  status.textContent = 'Opening the Studio window…';
  try {
    const response = await chrome.runtime.sendMessage({
      channel: 'dbopfs-studio:background',
      action: 'openStudioWindow',
      tabId: inspectedTabId
    });
    if (!response?.ok) throw new Error(response?.error || 'The Studio window did not open.');
    status.textContent = 'Studio is open and connected to this inspected page.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    openButton.disabled = false;
  }
});

initialize().catch((error) => {
  title.textContent = 'Unable to inspect this tab';
  status.textContent = error.message;
  openButton.disabled = true;
});
