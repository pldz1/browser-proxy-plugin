chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    proxyEnabled: "no-proxy",
    proxySettings: {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: "http",
          host: "example.com",
          port: 80,
        },
        // 默认不跳过任何 URL
        bypassList: [],
      },
    },
  });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.proxyEnabled) {
    if (changes.proxyEnabled.newValue !== "no-proxy") {
      // 如果代理启用，设置代理
      if (changes.proxySettings) {
        chrome.proxy.settings.set(
          { value: changes.proxySettings.newValue, scope: "regular" },
          function () {}
        );
      }
    } else {
      // 如果代理被禁用，设置为直连模式
      chrome.proxy.settings.clear({ scope: "regular" }, function () {});
    }
  }

  if (changes.proxySettings && changes.proxyEnabled?.newValue !== "no-proxy") {
    chrome.proxy.settings.set(
      { value: changes.proxySettings.newValue, scope: "regular" },
      function () {}
    );
  }
});
