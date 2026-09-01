(() => {
  type Platform = "douyin" | "xiaohongshu" | "weibo";
  type ReturnMode = "workspace" | "wizard";
  type Sender = { tab?: { id?: number; url?: string } };
  type Message = {
    type?: string;
    platform?: Platform;
    returnTarget?: ReturnMode;
    workUrl?: string;
    beforeUrl?: string;
    title?: string;
    dashboardTitle?: string;
    dashboardMetrics?: unknown;
    x?: number;
    y?: number;
    target?: "coordinate" | "final-publish";
  };

  const CONFIG_KEYS = {
    appBaseUrl: "publish_review_app_base_url",
    callbackPath: "publish_review_callback_path",
  } as const;
  const DEFAULT_APP_URL = "http://localhost:4173";
  const DEFAULT_CALLBACK_PATH = "/index.html";
  const PENDING_PREFIX = "publish_review_pending_receipt:";
  const PENDING_TTL_MS = 10 * 60 * 1000;

  function encodeBase64Url(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function normalizeAppBase(value: unknown): string {
    const url = new URL(typeof value === "string" && value.trim() ? value.trim() : DEFAULT_APP_URL);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password) {
      throw new Error("应用地址必须使用 HTTPS；本地开发可使用 localhost HTTP");
    }
    return url.origin;
  }

  function normalizeCallbackPath(value: unknown): string {
    const path = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_CALLBACK_PATH;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("回调路径无效");
    return path;
  }

  async function getConfig() {
    const values = await chrome.storage.local.get([CONFIG_KEYS.appBaseUrl, CONFIG_KEYS.callbackPath]);
    return {
      appBaseUrl: normalizeAppBase(values[CONFIG_KEYS.appBaseUrl]),
      callbackPath: normalizeCallbackPath(values[CONFIG_KEYS.callbackPath]),
    };
  }

  function platformFromSender(sender: Sender): Platform | null {
    try {
      const host = new URL(sender.tab?.url || "").hostname.toLowerCase();
      if (host === "creator.douyin.com") return "douyin";
      if (host === "creator.xiaohongshu.com") return "xiaohongshu";
      if (host === "weibo.com" || host === "www.weibo.com") return "weibo";
    } catch {
      return null;
    }
    return null;
  }

  function normalizeMetrics(value: unknown): Record<string, number> | null {
    if (!value || typeof value !== "object") return null;
    const allowed = new Set([
      "impressions", "reads", "views", "likes", "comments", "collects", "shares", "follows",
      "completionRate", "avgWatchDurationSeconds", "bounceRate", "twoSecondExitRate", "coverClickRate",
    ]);
    const metrics: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (allowed.has(key) && typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1_000_000_000_000) metrics[key] = raw;
    }
    return Object.keys(metrics).length ? metrics : null;
  }

  function normalizeWorkUrl(platform: Exclude<Platform, "weibo">, value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    let url: URL;
    try { url = new URL(value.trim()); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const hosts = platform === "douyin"
      ? new Set(["www.douyin.com", "m.douyin.com", "www.iesdouyin.com"])
      : new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com"]);
    if (!hosts.has(host)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = platform === "douyin"
      ? ((["video", "note"].includes(parts[0])) ? parts[1] : url.searchParams.get("modal_id") || url.searchParams.get("video_id"))
      : (parts[0] === "discovery" && parts[1] === "item" ? parts[2] : (["explore", "item"].includes(parts[0]) ? parts[1] : url.searchParams.get("note_id")));
    const valid = platform === "douyin" ? /^\d{8,}$/.test(candidate || "") : /^[A-Za-z0-9_-]{8,128}$/.test(candidate || "");
    if (!valid) return null;
    return platform === "douyin" ? `https://www.douyin.com/video/${candidate}` : `https://www.xiaohongshu.com/explore/${candidate}`;
  }

  async function returnToApp(sender: Sender, platform: Platform, outcome: "triggered" | "resolved", message: Message) {
    const tabId = sender.tab?.id;
    if (!tabId || platformFromSender(sender) !== platform) throw new Error("消息不是来自受支持的官方发布页");
    const config = await getConfig();
    const callback = new URL(config.callbackPath, config.appBaseUrl);
    const workUrl = platform === "weibo" ? null : normalizeWorkUrl(platform, message.workUrl);
    const metrics = normalizeMetrics(message.dashboardMetrics);
    const receipt = {
      version: 1,
      platform,
      outcome,
      returnMode: message.returnTarget === "wizard" ? "wizard" : "workspace",
      completedAt: new Date().toISOString(),
      ...(workUrl ? { workUrl } : {}),
      ...(metrics ? { metrics } : {}),
      ...(typeof message.dashboardTitle === "string" && message.dashboardTitle.trim() ? { title: message.dashboardTitle.trim().slice(0, 200) } : {}),
    };
    callback.hash = `publication_receipt=${encodeURIComponent(encodeBase64Url(JSON.stringify(receipt)))}`;
    await chrome.storage.session.remove(`${PENDING_PREFIX}${tabId}`);
    await chrome.tabs.update(tabId, { url: callback.toString() });
  }

  async function registerPending(sender: Sender, platform: Exclude<Platform, "weibo">, message: Message) {
    const tabId = sender.tab?.id;
    if (!tabId || platformFromSender(sender) !== platform) throw new Error("无法识别官方发布页");
    await chrome.storage.session.set({
      [`${PENDING_PREFIX}${tabId}`]: {
        platform,
        beforeUrl: normalizeWorkUrl(platform, message.beforeUrl),
        title: typeof message.title === "string" ? message.title.trim().slice(0, 200) : "",
        returnTarget: message.returnTarget === "wizard" ? "wizard" : "workspace",
        createdAt: Date.now(),
      },
    });
  }

  async function consumePending(sender: Sender, platform: Exclude<Platform, "weibo">, message: Message): Promise<boolean> {
    const tabId = sender.tab?.id;
    if (!tabId || platformFromSender(sender) !== platform) return false;
    const key = `${PENDING_PREFIX}${tabId}`;
    const stored = (await chrome.storage.session.get(key))[key] as { platform?: Platform; beforeUrl?: string | null; title?: string; returnTarget?: ReturnMode; createdAt?: number } | undefined;
    if (!stored || stored.platform !== platform || typeof stored.createdAt !== "number") return false;
    if (Date.now() - stored.createdAt > PENDING_TTL_MS) { await chrome.storage.session.remove(key); return false; }
    const workUrl = normalizeWorkUrl(platform, message.workUrl);
    const metrics = normalizeMetrics(message.dashboardMetrics);
    if ((!workUrl && !metrics) || (workUrl && workUrl === stored.beforeUrl)) return false;
    await returnToApp(sender, platform, "resolved", {
      ...message,
      workUrl: workUrl || undefined,
      dashboardMetrics: metrics,
      dashboardTitle: message.dashboardTitle || stored.title,
      returnTarget: stored.returnTarget,
    });
    return true;
  }

  type CdpNode = { nodeName?: string; localName?: string; nodeValue?: string; attributes?: string[]; children?: CdpNode[]; shadowRoots?: CdpNode[]; backendNodeId?: number };
  const nodeText = (node: CdpNode): string => [node.nodeValue || "", ...(node.children || []).map(nodeText), ...(node.shadowRoots || []).map(nodeText)].join("").replace(/\s+/g, "").trim();
  function nodeClass(node: CdpNode): string {
    const attrs = node.attributes || [];
    for (let index = 0; index < attrs.length; index += 2) if (attrs[index] === "class") return attrs[index + 1] || "";
    return "";
  }
  function findFinalButton(node: CdpNode): CdpNode | null {
    const name = (node.localName || node.nodeName || "").toLowerCase();
    if (name === "button" && nodeText(node) === "发布" && /(?:^|\s)bg-red(?:\s|$)/.test(nodeClass(node))) return node;
    for (const child of [...(node.shadowRoots || []), ...(node.children || [])]) {
      const found = findFinalButton(child);
      if (found) return found;
    }
    return null;
  }

  async function dispatchTrustedClick(sender: Sender, message: Message) {
    const tabId = sender.tab?.id;
    if (!tabId || !platformFromSender(sender)) throw new Error("只允许在受支持的官方发布页执行受信任点击");
    if (!(await chrome.permissions.contains({ permissions: ["debugger"] }))) {
      const granted = await chrome.permissions.request({ permissions: ["debugger"] });
      if (!granted) throw new Error("未获得调试权限，请使用平台页面按钮手动继续");
    }
    const target = { tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      let point = { x: Number(message.x), y: Number(message.y) };
      if (message.target === "final-publish") {
        const document = await chrome.debugger.sendCommand(target, "DOM.getDocument", { depth: -1, pierce: true }) as { root?: CdpNode };
        const button = document.root ? findFinalButton(document.root) : null;
        if (!button?.backendNodeId) throw new Error("无法唯一定位最终发布按钮");
        const box = await chrome.debugger.sendCommand(target, "DOM.getBoxModel", { backendNodeId: button.backendNodeId }) as { model?: { content?: number[] } };
        const content = box.model?.content || [];
        if (content.length < 8) throw new Error("无法读取最终发布按钮位置");
        point = { x: (content[0] + content[2] + content[4] + content[6]) / 4, y: (content[1] + content[3] + content[5] + content[7]) / 4 };
      }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > 10000 || point.y > 10000) throw new Error("受信任点击坐标无效");
      for (const [type, buttons] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]] as const) {
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
      }
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => undefined);
    }
  }

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = raw as Message & { appBaseUrl?: string; callbackPath?: string };
    void (async () => {
      try {
        if (["XHS_TRUSTED_CLICK", "DOUYIN_TRUSTED_CLICK", "WEIBO_TRUSTED_CLICK"].includes(message.type || "")) await dispatchTrustedClick(sender as Sender, message);
        else if (message.type === "REGISTER_REVIEW_HANDOFF" && (message.platform === "douyin" || message.platform === "xiaohongshu")) await registerPending(sender as Sender, message.platform, message);
        else if (message.type === "COMPLETE_REVIEW_HANDOFF" && (message.platform === "douyin" || message.platform === "xiaohongshu")) {
          sendResponse({ ok: true, data: { completed: await consumePending(sender as Sender, message.platform, message) } }); return;
        } else if (message.type === "OPEN_SAAS_REVIEW" && (message.platform === "douyin" || message.platform === "xiaohongshu")) await returnToApp(sender as Sender, message.platform, "resolved", message);
        else if (message.type === "RETURN_TO_SAAS") {
          const platform = platformFromSender(sender as Sender);
          if (!platform) throw new Error("无法识别发布平台");
          await returnToApp(sender as Sender, platform, "triggered", message);
        } else if (message.type === "GET_APP_CONFIG") { sendResponse({ ok: true, data: await getConfig() }); return; }
        else if (message.type === "SET_APP_CONFIG") {
          const appBaseUrl = normalizeAppBase(message.appBaseUrl);
          const callbackPath = normalizeCallbackPath(message.callbackPath);
          await chrome.storage.local.set({ [CONFIG_KEYS.appBaseUrl]: appBaseUrl, [CONFIG_KEYS.callbackPath]: callbackPath });
          sendResponse({ ok: true, data: { appBaseUrl, callbackPath } }); return;
        } else throw new Error("未知或不受支持的消息");
        sendResponse({ ok: true, data: null });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "请求失败" });
      }
    })();
    return true;
  });
})();
