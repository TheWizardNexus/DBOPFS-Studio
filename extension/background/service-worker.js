const STUDIO_PATH = 'studio/index.html';

function studioUrl(tabId) {
  const url = new URL(chrome.runtime.getURL(STUDIO_PATH));
  if (Number.isInteger(tabId)) {
    url.searchParams.set('tab', String(tabId));
  }
  return url.href;
}

async function openStudio(tabId) {
  const targetUrl = studioUrl(tabId);
  const existing = await chrome.tabs.query({ url: `${chrome.runtime.getURL(STUDIO_PATH)}*` });
  const matching = existing.find((tab) => tab.url === targetUrl);

  if (matching?.id) {
    await chrome.tabs.update(matching.id, { active: true });
    if (matching.windowId) {
      await chrome.windows.update(matching.windowId, { focused: true });
    }
    return matching;
  }

  return chrome.tabs.create({ url: targetUrl });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.channel !== 'dbopfs-studio:background') {
    return false;
  }

  if (message.action === 'openStudio') {
    openStudio(Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id)
      .then((tab) => sendResponse({ ok: true, tabId: tab.id }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
