chrome.devtools.panels.create(
  'DBOPFS Studio',
  'assets/icons/icon-32.png',
  `devtools/panel.html?tab=${chrome.devtools.inspectedWindow.tabId}`
);
