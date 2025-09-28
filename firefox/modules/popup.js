document.addEventListener("DOMContentLoaded", function () {
  // 默认的bypass列表
  const defaultBypassList = [
    "127.0.0.1/8",
    "192.168.1.0/24",
    "::1",
    "localhost",
    ".net.nz",
  ];

  // 这个插件默认的浏览器存储的数据格式
  let initialSettings = {
    bypassList: [],
    httpPort: "8080",
    httpProxy: "example.com",
    httpsPort: "",
    httpsProxy: "",
    proxyEnabled: false,
    socksHost: "",
    socksPort: "",
    useForHttps: false,
  };

  /** ================== Step 1 ================== */
  // 得到插件的全部 HTML Element
  const noProxyToggle = document.getElementById("no-proxy-checkbox");
  const manualProxyToggle = document.getElementById("manual-proxy-checkbox");

  const proxyConfiguration = document.getElementById("proxy-configuration");
  const proxyPanel = document.getElementById("proxy-panel");

  const httpProxyInput = document.getElementById("http-proxy");
  const httpPortInput = document.getElementById("http-port");
  const httpsProxyInput = document.getElementById("https-proxy");
  const httpsPortInput = document.getElementById("https-port");
  const bypassListInput = document.getElementById("bypass-list");
  const useForHttpsCheckbox = document.getElementById("use-for-https");
  const applyButton = document.getElementById("apply-button");
  const cancelButton = document.getElementById("cancel-button");

  /** ================== Step 2 ================== */
  // 给插件的HTML Element注入监听事件 观察变化
  // 2.1 不使用代理和使用手动代理的互斥行为
  noProxyToggle.addEventListener("change", () => {
    if (noProxyToggle.checked) manualProxyToggle.checked = false;
    else manualProxyToggle.checked = true;
    // 主动触发一次使用手动代理的行为促使它去修改样式
    manualProxyToggle.dispatchEvent(new Event("change"));
  });

  manualProxyToggle.addEventListener("change", () => {
    if (manualProxyToggle.checked) {
      proxyConfiguration.classList.remove("disabled");
      proxyPanel.classList.remove("not-allowed");
      noProxyToggle.checked = false;
    } else {
      proxyConfiguration.classList.add("disabled");
      proxyPanel.classList.add("not-allowed");
      noProxyToggle.checked = true;
    }
  });

  // 2.2 HTTP 和 HTTPS 如果是共享状态的话需要同步更新数据
  httpProxyInput.addEventListener("input", () => {
    if (useForHttpsCheckbox.checked)
      httpsProxyInput.value = httpProxyInput.value;
  });

  httpPortInput.addEventListener("input", () => {
    if (useForHttpsCheckbox.checked) httpsPortInput.value = httpPortInput.value;
  });

  useForHttpsCheckbox.addEventListener("change", () => {
    if (useForHttpsCheckbox.checked) {
      httpsProxyInput.classList.add("disabled", "not-allowed");
      httpsPortInput.classList.add("disabled", "not-allowed");
      httpsProxyInput.value = httpProxyInput.value;
      httpsPortInput.value = httpPortInput.value;
    } else {
      httpsProxyInput.classList.remove("disabled", "not-allowed");
      httpsPortInput.classList.remove("disabled", "not-allowed");
    }
  });

  // 2.3 从 HTML Element 上拿出状态写入存储 并且需要立即生效设置
  applyButton.addEventListener("click", async () => {
    // 获取用户输入并将其分割为数组，同时移除多余的空格
    const bypassList = bypassListInput.value
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);

    // 将默认的bypassList加入用户输入的bypassList
    const finalBypassList = [...new Set([...defaultBypassList, ...bypassList])];

    const mode = manualProxyToggle.checked ? "manual" : "none";
    const httpHost = httpProxyInput.value.trim();

    const httpPort = Number(httpPortInput.value || 0);
    const useForHttps = useForHttpsCheckbox.checked;
    const httpsHost = useForHttps ? httpHost : httpsProxyInput.value.trim();
    const httpsPort = useForHttps
      ? httpPort
      : Number(httpsPortInput.value || 0);
    const payload = {
      mode,
      httpHost: httpHost,
      httpPort: httpPort,
      useForHttps: useForHttps,
      httpsHost: httpsHost,
      httpsPort: httpsPort,
      bypassList: finalBypassList,
    };
    await browser.storage.sync.set(payload);
    browser.runtime.sendMessage({ type: "proxy:update", payload });
    window.close();
  });

  // 2.4 取消设置需要回退回存储中记录的状态
  cancelButton.addEventListener("click", () => {
    // 恢复到初始设置
    if (initialSettings.proxyEnabled)
      manualProxyToggle.checked = initialSettings.proxyEnabled;
    if (initialSettings.httpProxy)
      httpProxyInput.value = initialSettings.httpProxy;
    if (initialSettings.httpPort)
      httpPortInput.value = initialSettings.httpPort;
    if (initialSettings.httpsProxy)
      httpsProxyInput.value = initialSettings.httpsProxy;
    if (initialSettings.httpsPort)
      httpsPortInput.value = initialSettings.httpsPort;

    const userBypassList = initialSettings.bypassList
      ? initialSettings.bypassList
      : [];
    const combinedBypassList = [
      ...new Set([...defaultBypassList, ...userBypassList]),
    ];
    bypassListInput.value = combinedBypassList.join(", ");

    if (initialSettings.useForHttps !== undefined)
      useForHttpsCheckbox.checked = initialSettings.useForHttps;

    // 关闭 popup
    window.close();
  });

  /** ================== Step 3 ================== */
  // 入口函数 插件初始化的操作
  browser.storage.sync.get(
    [
      "proxyEnabled",
      "httpProxy",
      "httpPort",
      "httpsProxy",
      "httpsPort",
      "socksHost",
      "socksPort",
      "bypassList",
      "useForHttps",
    ],
    function (result) {
      initialSettings = result;
      // 互斥的两个开关选项
      if (result.proxyEnabled) manualProxyToggle.checked = true;
      manualProxyToggle.dispatchEvent(new Event("change"));

      if (result.httpProxy) httpProxyInput.value = result.httpProxy;
      if (result.httpPort) httpPortInput.value = result.httpPort;
      if (result.httpsProxy) httpsProxyInput.value = result.httpsProxy;
      if (result.httpsPort) httpsPortInput.value = result.httpsPort;

      // 合并不显示默认去掉的bypassList
      const userBypassList = result.bypassList ? result.bypassList : [];
      const combinedBypassList = userBypassList.filter(
        (item) => !defaultBypassList.includes(item)
      );

      bypassListInput.value = combinedBypassList.join(", ");

      if (result.useForHttps) useForHttpsCheckbox.checked = result.useForHttps;
      useForHttpsCheckbox.dispatchEvent(new Event("change"));
    }
  );
});
