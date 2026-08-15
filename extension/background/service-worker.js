const STUDIO_PATH = 'studio/index.html';
const STUDIO_TARGET_PREFIX = 'studioTarget';

function studioUrl(tabId) {
  const url = new URL(chrome.runtime.getURL(STUDIO_PATH));
  if (Number.isInteger(tabId)) {
    url.searchParams.set('tab', String(tabId));
  }
  return url.href;
}

async function hasStudioContext(targetUrl, tabId, windowId) {
  if (typeof chrome.runtime.getContexts !== 'function') return false;
  try {
    const contexts = await chrome.runtime.getContexts({});
    return contexts.some((context) => context.documentUrl === targetUrl &&
      context.tabId === tabId && context.windowId === windowId);
  } catch {
    return false;
  }
}

async function findStudioTarget(targetUrl, windowType) {
  const storageKey = `${STUDIO_TARGET_PREFIX}:${windowType}:${targetUrl}`;
  const stored = (await chrome.storage.session.get(storageKey))[storageKey];
  if (!Number.isInteger(stored?.tabId) || !Number.isInteger(stored?.windowId)) return null;
  try {
    const [tab, browserWindow] = await Promise.all([
      chrome.tabs.get(stored.tabId),
      chrome.windows.get(stored.windowId)
    ]);
    if (tab.windowId === browserWindow.id && browserWindow.type === windowType &&
        await hasStudioContext(targetUrl, tab.id, browserWindow.id)) {
      return { browserWindow, tab };
    }
  } catch {
    // The remembered tab or window was closed between launches.
  }
  await chrome.storage.session.remove(storageKey);
  return null;
}

async function rememberStudioTarget(targetUrl, windowType, tab, browserWindow) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(browserWindow?.id)) return;
  const storageKey = `${STUDIO_TARGET_PREFIX}:${windowType}:${targetUrl}`;
  await chrome.storage.session.set({
    [storageKey]: {
      tabId: tab.id,
      windowId: browserWindow.id
    }
  });
}

async function focusStudioTarget(target) {
  await chrome.tabs.update(target.tab.id, { active: true });
  await chrome.windows.update(target.browserWindow.id, { focused: true });
  return target.tab;
}

async function openStudio(tabId) {
  const targetUrl = studioUrl(tabId);
  const matching = await findStudioTarget(targetUrl, 'normal');
  if (matching) return focusStudioTarget(matching);
  const tab = await chrome.tabs.create({ url: targetUrl });
  const browserWindow = await chrome.windows.get(tab.windowId);
  await rememberStudioTarget(targetUrl, 'normal', tab, browserWindow);
  return tab;
}

async function openStudioWindow(tabId) {
  const targetUrl = studioUrl(tabId);
  const matching = await findStudioTarget(targetUrl, 'popup');
  if (matching) return focusStudioTarget(matching);
  const created = await chrome.windows.create({
    focused: true,
    height: 860,
    type: 'popup',
    url: targetUrl,
    width: 1320
  });
  const [tab] = created.tabs?.length
    ? created.tabs
    : await chrome.tabs.query({ windowId: created.id, active: true });
  await rememberStudioTarget(targetUrl, 'popup', tab, created);
  return tab || { id: null, windowId: created.id };
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

  if (message.action === 'openStudioWindow') {
    openStudioWindow(Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id)
      .then((tab) => sendResponse({ ok: true, tabId: tab.id, windowId: tab.windowId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
