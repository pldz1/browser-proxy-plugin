/** =========================
 *  Background: proxy router
 *  ========================= */

/** 默认 bypass 规则（可按需增减） */
const DEFAULT_BYPASS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "127.0.0.0/8", // 更规范的写法
  "192.168.1.0/24",
  "net.nz", // 兼容 .net.nz：会被规范化
];

/** 内存态配置（由 popup 同步过来） */
let state = {
  proxyEnabled: false,
  httpProxy: "",
  httpPort: 0,
  httpsProxy: "",
  httpsPort: 0,
  useForHttps: true,
  bypassList: [], // 规范化后的字符串数组（全小写、无前导点）
};

/** ——启动：从 storage 载入（sync）—— */
browser.storage.sync
  .get(null)
  .then((cfg) => hydrateFromStorage(cfg))
  .catch((e) => console.warn("storage.sync.get error:", e));

/** ——监听来自 popup 的设置更新—— */
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "proxy:update") {
    hydrateFromStorage(msg.payload || {});
  }
});

/** 小工具：规范化字符串：去空格、去尾点、转小写 */
function normStr(s) {
  return String(s || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

/** 解析并规范化 bypass 列表；支持数组或逗号/换行分隔字符串
 *  - 去空、去重
 *  - 去前导点（.google.com -> google.com）
 *  - 合并默认规则
 */
function normalizeBypassList(input) {
  let items = [];
  if (Array.isArray(input)) {
    items = input;
  } else if (typeof input === "string") {
    items = input.split(/[,\n]/);
  } else if (input == null) {
    items = [];
  } else {
    items = [String(input)];
  }

  const cleaned = items
    .map((s) => normStr(s))
    .map((s) => s.replace(/^\.+/, "")) // 去掉任何数量的前导点：.google.com => google.com
    .filter(Boolean);

  // 默认值同样规范化一次（防止大小写/点写法差异）
  const normDefault = DEFAULT_BYPASS.map((s) => normStr(s).replace(/^\.+/, ""));

  const merged = [...new Set([...normDefault, ...cleaned])];
  return merged;
}

/** 把 storage 中的配置灌入到内存态（带健壮性处理） */
function hydrateFromStorage(cfg) {
  try {
    state.proxyEnabled = cfg.proxyEnabled || false;

    state.httpProxy = normStr(cfg.httpProxy);
    state.httpPort = Number(cfg.httpPort || 0) | 0;

    state.useForHttps = !!cfg.useForHttps;
    state.httpsProxy = normStr(cfg.httpsProxy);
    state.httpsPort = Number(cfg.httpsPort || 0) | 0;

    state.bypassList = normalizeBypassList(cfg.bypassList);

    // 端口合法性
    if (!(state.httpPort > 0 && state.httpPort < 65536)) state.httpPort = 0;
    if (!(state.httpsPort > 0 && state.httpsPort < 65536)) state.httpsPort = 0;

    // 调试可打开
    // console.debug("hydrated state:", JSON.parse(JSON.stringify(state)));
  } catch (e) {
    console.warn("hydrateFromStorage error:", e);
  }
}

/** IPv4 字符串 -> uint32（非法返回 null） */
function ipv4ToInt(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  const a = (+m[1] & 255) << 24;
  const b = (+m[2] & 255) << 16;
  const c = (+m[3] & 255) << 8;
  const d = (+m[4] & 255) << 0;
  return (a | b | c | d) >>> 0;
}

function isIpInCidr(ip, base, mask) {
  const ipN = ipv4ToInt(ip);
  const baseN = ipv4ToInt(base);
  if (ipN == null || baseN == null) return false;
  const m = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  return (ipN & m) === (baseN & m);
}

/** 判断 URL 是否命中 bypass 规则 */
function isBypassed(url) {
  let host = "";
  try {
    const u = new URL(url);
    host = (u.hostname || "").toLowerCase();
  } catch {
    return false;
  }

  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1";

  const ipv4 = ipv4ToInt(host) != null ? host : null;

  for (const rule of state.bypassList) {
    if (!rule) continue;

    // 1) localhost/环回（单点）
    if (rule === "localhost" || rule === "127.0.0.1" || rule === "::1") {
      if (isLoopback) return true;
      continue;
    }

    // 2) CIDR（仅 IPv4）
    if (rule.includes("/")) {
      const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(rule);
      if (m && ipv4 && isIpInCidr(ipv4, m[1], Number(m[2]))) return true;
      continue;
    }

    // 3) 通配 *.example.com
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1); // ".example.com"
      if (host.endsWith(suffix)) return true;
      continue;
    }

    // 4) 等值匹配（裸域/主机名/IP）
    if (host === rule) return true;

    // 5) 裸域的“自身或子域”匹配（example.com 命中 foo.example.com）
    if (host.endsWith("." + rule)) return true;
  }

  return false;
}

/** 请求路由：直连 or 代理（可扩展故障转移数组） */
browser.proxy.onRequest.addListener(
  (details) => {
    try {
      if (state.proxyEnabled === false || isBypassed(details.url)) {
        return [{ type: "direct" }];
      }

      const u = new URL(details.url);
      const isHttps = u.protocol === "https:";

      // Firefox：HTTP/HTTPS 都用 type: "http"（HTTPS 走 CONNECT）
      const target =
        isHttps && !state.useForHttps
          ? { host: state.httpsProxy, port: state.httpsPort, type: "http" }
          : { host: state.httpProxy, port: state.httpPort, type: "http" };

      if (target.host && target.port) {
        // 失败回退直连（如不需要可移除第二项）
        return [target, { type: "direct" }];
      }

      return [{ type: "direct" }];
    } catch (e) {
      console.warn("onRequest error:", e);
      return [{ type: "direct" }];
    }
  },
  { urls: ["<all_urls>"] }
);

/** 错误日志 */
browser.proxy.onError.addListener((err) => {
  console.warn("proxy error:", err);
});
