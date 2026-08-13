chrome.devtools.panels.create(
  'DBOPFS Studio',
  'assets/icons/icon-32.png',
  `studio/index.html?devtools=1&tab=${chrome.devtools.inspectedWindow.tabId}`
);
