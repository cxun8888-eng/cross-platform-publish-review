(() => {
  type ReturnTarget = "workspace" | "wizard";
  type Draft = {
    id: string;
    title: string;
    content: string;
    tags: string[];
    returnTarget: ReturnTarget;
    updated_at?: string;
    product_name?: string;
  };
  type WeiboFlowStage = "idle" | "loading" | "awaiting-image" | "awaiting-send" | "sent";

  const host = location.hostname.toLowerCase();
  if (host !== "weibo.com" && !host.endsWith(".weibo.com")) return;

  const handoffStorageKey = "publish_review_pending_draft:weibo";
  const handoffTtlMs = 10 * 60 * 1000;

  const readStoredDraft = (): Draft | null => {
    try {
      const raw = sessionStorage.getItem(handoffStorageKey);
      if (!raw) return null;
      const stored = JSON.parse(raw) as { draft?: Draft; storedAt?: number };
      if (!stored.draft || typeof stored.storedAt !== "number" || Date.now() - stored.storedAt > handoffTtlMs) {
        sessionStorage.removeItem(handoffStorageKey);
        return null;
      }
      return stored.draft;
    } catch {
      return null;
    }
  };

  const saveStoredDraft = (draft: Draft) => {
    try {
      sessionStorage.setItem(handoffStorageKey, JSON.stringify({ draft, storedAt: Date.now() }));
    } catch {
      // 浏览器禁用会话存储时仍可使用当前页面内存中的方案。
    }
  };

  const clearStoredDraft = () => {
    try {
      sessionStorage.removeItem(handoffStorageKey);
    } catch {
      // 忽略存储清理失败，不影响平台内手动发布。
    }
  };

  /**
   * 发布应用“去发布”会把当前这一条游客向文案放进 URL fragment。
   * fragment 不会发送给微博服务器，读取后立即清理；插件也不会读取其它 SaaS 草稿。
   */
  const readHandoffDraft = (): Draft | null => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return readStoredDraft();
    const encoded = new URLSearchParams(hash).get("publish_review_draft");
    if (!encoded || encoded.length > 120_000) return readStoredDraft();
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
      const binary = atob(base64);
      const percentEncoded = Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
      const parsed = JSON.parse(decodeURIComponent(percentEncoded)) as Record<string, unknown>;
      const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 20) : [];
      if (
        parsed.version !== 1
        || parsed.source !== "publish-review-demo"
        || parsed.platform !== "weibo"
        || typeof parsed.title !== "string"
        || typeof parsed.content !== "string"
      ) return null;
      const draft = {
        id: "publish-review-current-draft",
        title: parsed.title.slice(0, 200),
        content: parsed.content.slice(0, 20_000),
        tags,
        returnTarget: parsed.returnTarget === "wizard" ? "wizard" as const : "workspace" as const,
      };
      saveStoredDraft(draft);
      return draft;
    } catch {
      return readStoredDraft();
    } finally {
      // 文案是游客向公开内容，仍然不应留在浏览器历史或微博地址栏中。
      history.replaceState(null, document.title, `${location.pathname}${location.search}`);
    }
  };

  let pendingHandoff = readHandoffDraft();
  const handoffReturnTarget: ReturnTarget = pendingHandoff?.returnTarget ?? "workspace";
  const handoffTitle = pendingHandoff?.title ?? "";
  let flowStage: WeiboFlowStage = pendingHandoff ? "loading" : "idle";
  let expectedBodyAfterImport: string | null = null;

  // 微博首页、个人页和发布页都可能显示微博编辑器；不限制具体 SPA 路由，
  // 由正文选择器判断当前页面是否真的有可填充的编辑框。
  const isPublishPage = () => host === "weibo.com" || host.endsWith(".weibo.com");

  const root = document.createElement("div");
  root.id = "publish-review-saas-weibo-extension-root";
  const shadow = root.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .publish-review-button { position: fixed; z-index: 2147483646; right: 18px; top: 96px; border: 0; border-radius: 999px; padding: 10px 15px; background:#0f172a; color:#fff; font:700 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; box-shadow:0 8px 24px #0f172a38; cursor:pointer; }
    .publish-review-panel { position:fixed; z-index:2147483647; top:0; right:0; bottom:0; width:380px; overflow:auto; border-left:1px solid #dbe4f0; background:#f8fafc; color:#172b4d; box-shadow:-18px 0 48px #0f172a24; font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .publish-review-panel-dock { overscroll-behavior:contain; }
    .publish-review-dock-head { display:grid; grid-template-columns:38px minmax(0,1fr) 30px; align-items:center; gap:10px; padding:18px; color:#fff; background:#0f172a; }
    .publish-review-brand-mark { display:grid; place-items:center; width:38px; height:38px; border-radius:12px; background:#f97316; color:#fff; font-size:21px; font-weight:900; }
    .publish-review-brand-title { margin:0; font-size:15px; font-weight:850; }
    .publish-review-brand-subtitle { margin:3px 0 0; color:#a9b8ce; font-size:11px; font-weight:600; }
    .publish-review-close { border:0; border-radius:9px; background:transparent; color:#b9c5d6; cursor:pointer; font-size:20px; }
    .publish-review-dock-body { padding:16px; }
    .publish-review-route-status { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; color:#64748b; font-size:11px; font-weight:700; }
    .publish-review-route-status strong { color:#ea580c; font-size:12px; }
    .publish-review-route-ticket { position:relative; overflow:hidden; margin-bottom:14px; border:1px solid #dbe4f0; border-radius:14px; background:#fff; box-shadow:0 8px 24px #0f172a0d; }
    .publish-review-ticket-label { padding:13px 16px 10px; color:#64748b; font-size:10px; font-weight:800; letter-spacing:.12em; }
    .publish-review-ticket-title { margin:0; padding:0 16px 15px; color:#0f172a; font-size:15px; font-weight:850; line-height:1.45; }
    .publish-review-ticket-copy { margin:0; padding:13px 16px 15px; border-top:1px dashed #cbd5e1; color:#64748b; font-size:12px; line-height:1.6; }
    .publish-review-flow { margin:0 0 14px; padding:5px 14px; border:1px solid #dbe4f0; border-radius:14px; background:#fff; list-style:none; }
    .publish-review-flow li { display:grid; grid-template-columns:24px minmax(0,1fr); gap:10px; align-items:start; padding:10px 0; border-bottom:1px solid #eef2f7; color:#475569; font-size:12px; line-height:1.5; }
    .publish-review-flow li:last-child { border-bottom:0; }
    .publish-review-step-dot { display:grid; place-items:center; width:22px; height:22px; border-radius:50%; background:#e2e8f0; color:#64748b; font-size:10px; font-weight:900; }
    .publish-review-flow .is-done .publish-review-step-dot { background:#dcfce7; color:#047857; }
    .publish-review-flow .is-active { color:#0f172a; font-weight:750; }
    .publish-review-flow .is-active .publish-review-step-dot { background:#f97316; color:#fff; box-shadow:0 0 0 4px #ffedd5; }
    .publish-review-state { margin-bottom:14px; padding:13px 14px; border-radius:12px; background:#fff7ed; color:#9a3412; font-size:12px; font-weight:650; line-height:1.6; }
    .publish-review-note { margin:10px 2px 0; color:#94a3b8; font-size:10px; line-height:1.55; }
    .publish-review-dock-actions { display:grid; gap:8px; }
    .publish-review-dock-primary,.publish-review-dock-secondary { width:100%; min-height:42px; border-radius:10px; padding:9px 12px; font-weight:800; cursor:pointer; }
    .publish-review-dock-primary { border:0; background:#0f172a; color:#fff; }
    .publish-review-dock-secondary { border:1px solid #cbd5e1; background:#fff; color:#475569; }
    @media (max-width:820px) { .publish-review-panel { top:12px; right:12px; bottom:12px; width:calc(100vw - 24px); border:1px solid #dbe4f0; border-radius:16px; } }
  `;
  shadow.append(style);
  document.documentElement.appendChild(root);

  const button = document.createElement("button");
  button.className = "publish-review-button";
  shadow.append(button);

  const syncButton = () => {
    if (!isPublishPage() || flowStage === "idle") {
      button.style.display = "none";
      return;
    }
    button.textContent = "展开多平台发布与作品复盘助手";
    button.disabled = false;
    button.style.display = "block";
  };
  syncButton();

  const closePanel = () => {
    shadow.querySelector(".publish-review-panel")?.remove();
    syncButton();
  };
  const showPanel = (html: string) => {
    shadow.querySelector(".publish-review-panel")?.remove();
    const panel = document.createElement("section");
    panel.className = "publish-review-panel publish-review-panel-dock";
    panel.innerHTML = html;
    shadow.append(panel);
    button.style.display = "none";
    panel.querySelector(".publish-review-close")?.addEventListener("click", closePanel);
    const returnButton = panel.querySelector<HTMLElement>("[data-return-app]");
    returnButton?.addEventListener("click", () => {
      void chrome.runtime.sendMessage({
        type: "RETURN_TO_SAAS",
        returnTarget: handoffReturnTarget,
        publicationComplete: returnButton.hasAttribute("data-publication-complete"),
        dashboardTitle: handoffTitle || undefined,
      }).catch(() => undefined);
    });
    return panel;
  };

  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
  const weiboAssistantFrame = (status: string, body: string) => `
    <header class="publish-review-dock-head">
      <span class="publish-review-brand-mark" aria-hidden="true">✦</span>
      <div><p class="publish-review-brand-title">多平台发布与作品复盘助手</p><p class="publish-review-brand-subtitle">微博官方发布页 · 当前标签协作</p></div>
      <button class="publish-review-close" type="button" aria-label="收起多平台发布与作品复盘助手">×</button>
    </header>
    <div class="publish-review-dock-body">
      <div class="publish-review-route-status"><span>发布应用 → 微博 → 发布清单</span><strong>${escapeHtml(status)}</strong></div>
      ${body}
    </div>`;
  const currentDraftTicket = () => {
    const title = escapeHtml((pendingHandoff?.title || "当前发布应用方案").slice(0, 90));
    const copy = escapeHtml((pendingHandoff?.content || "文案已安全带入当前标签").replace(/\s+/g, " ").slice(0, 88));
    return `<article class="publish-review-route-ticket"><div class="publish-review-ticket-label">当前方案</div><h2 class="publish-review-ticket-title">${title}</h2><p class="publish-review-ticket-copy">${copy}${(pendingHandoff?.content.length || 0) > 88 ? "…" : ""}</p></article>`;
  };

  let imageInputForSelection: HTMLInputElement | null = null;
  const handleImageSelection = () => {
    if (flowStage !== "awaiting-image" && flowStage !== "awaiting-send") return;
    flowStage = "awaiting-send";
    syncButton();
    const panel = showPanel(weiboAssistantFrame("发布前核对", `${currentDraftTicket()}<ol class="publish-review-flow"><li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li><li class="is-done"><span class="publish-review-step-dot">✓</span><span>图片已交给微博页面处理</span></li><li class="is-active"><span class="publish-review-step-dot">03</span><span>检查正文、图片和账号设置后确认发送</span></li></ol><div class="publish-review-state">助手只会点击唯一、可见且文本精确为“发送”的微博按钮；请以微博页面预览为准。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-primary" data-confirm-send>确认并发布</button><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div>`));
    panel.querySelector("[data-confirm-send]")?.addEventListener("click", confirmAndSend);
  };

  const candidates = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.closest("[aria-hidden='true']");
  });

  const normalizeActionText = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").trim();
  const normalizeBodyText = (value: string | null | undefined) => (value ?? "")
    .replace(/\u200b/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const readText = (element: HTMLElement) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return element.innerText || element.textContent || "";
  };
  const isActionable = (element: HTMLElement) => {
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    const style = getComputedStyle(element);
    return style.pointerEvents !== "none" && style.visibility !== "hidden" && style.display !== "none" && Number.parseFloat(style.opacity || "1") > 0;
  };
  const findFinalWeiboSendButtons = () => {
    const matches = candidates("button,[role='button']")
      .filter((element) => normalizeActionText(element.innerText || element.textContent) === "发送")
      .filter(isActionable);
    return [...new Set(matches)];
  };

  const findWeiboImageButtons = () => {
    const popControls = candidates("span.woo-pop-ctrl")
      .filter((element) => normalizeActionText(element.innerText || element.textContent) === "图片")
      .filter(isActionable);
    if (popControls.length > 0) return [...new Set(popControls)];
    const fallbackControls = candidates("button,[role='button'],label")
      .filter((element) => normalizeActionText(element.innerText || element.textContent) === "图片")
      .filter(isActionable);
    return [...new Set(fallbackControls)];
  };

  type ImagePickerResult = "opened" | "missing-input" | "missing-button" | "ambiguous-button" | "click-failed";

  const requestTrustedWeiboClick = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return Promise.resolve(false);
    const assistantPanel = shadow.querySelector<HTMLElement>(".publish-review-panel");
    const previousDisplay = assistantPanel?.style.display || "";
    if (assistantPanel) assistantPanel.style.display = "none";
    const restoreAssistantPanel = () => {
      if (assistantPanel?.isConnected) assistantPanel.style.display = previousDisplay;
    };
    return chrome.runtime.sendMessage({
      type: "WEIBO_TRUSTED_CLICK",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }).then((response) => {
      if (response?.ok) return true;
      console.warn("[多平台发布复盘] 微博受信任点击失败", response?.error || "未知错误");
      return false;
    }).catch((error: unknown) => {
      console.warn("[多平台发布复盘] 微博受信任点击请求失败", error);
      return false;
    }).finally(restoreAssistantPanel);
  };

  const openWeiboImagePicker = (): ImagePickerResult => {
    const imageInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']"))
      .filter((input) => !input.accept || /image\//i.test(input.accept));
    if (imageInputs.length === 0) return "missing-input";
    const imageInput = imageInputs[0];
    if (imageInputForSelection && imageInputForSelection !== imageInput) {
      imageInputForSelection.removeEventListener("change", handleImageSelection);
    }
    imageInputForSelection = imageInput;
    imageInput.addEventListener("change", handleImageSelection, { once: true });
    const imageButtons = findWeiboImageButtons();
    if (imageButtons.length === 0) return "missing-button";
    if (imageButtons.length > 1) return "ambiguous-button";
    const imageButton = imageButtons[0];
    if (!imageButton) return "click-failed";
    try {
      imageButton.focus();
      void requestTrustedWeiboClick(imageButton).then((trusted) => {
        if (!trusted) {
          // CDP 被 DevTools 占用或权限受限时，保留普通 DOM 点击作为兼容回退。
          try {
            imageButton.click();
          } catch {
            // 失败状态由右侧“选择图片”按钮保留，供用户手势重试。
          }
        }
      });
      return "opened";
    } catch {
      return "click-failed";
    }
  };

  const markImagePickerOpened = () => {
    syncButton();
    const panel = showPanel(weiboAssistantFrame("选择素材", `${currentDraftTicket()}<ol class="publish-review-flow"><li class="is-done"><span class="publish-review-step-dot">✓</span><span>发布应用文案已填入微博编辑器</span></li><li class="is-active"><span class="publish-review-step-dot">02</span><span>在系统文件窗口中选择本次微博图片</span></li><li><span class="publish-review-step-dot">03</span><span>检查内容后确认发送</span></li></ol><div class="publish-review-state">插件已自动点击微博“图片”入口。若文件窗口没有出现，可点击下方按钮重试；助手不会读取或自动选择本地文件。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-primary" data-select-image>重新选择图片</button><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div>`));
    panel.querySelector("[data-select-image]")?.addEventListener("click", requestImagePicker);
  };

  let lastImagePickerAttemptAt = 0;
  let imagePickerOpenedAttempted = false;
  const attemptAutoOpenImagePicker = () => {
    if (flowStage !== "awaiting-image" || imagePickerOpenedAttempted) return;
    const now = Date.now();
    if (now - lastImagePickerAttemptAt < 300) return;
    lastImagePickerAttemptAt = now;
    if (openWeiboImagePicker() === "opened") {
      imagePickerOpenedAttempted = true;
      markImagePickerOpened();
    }
  };

  const findByHint = (hints: RegExp, selectors: string) => candidates(selectors).find((element) => hints.test(`${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-placeholder") || ""}`));
  const textControls = "textarea,input,[contenteditable='true'],[role='textbox']";
  const findTitle = () => findByHint(/标题|话题标题|作品标题/i, "input,textarea,[contenteditable='true'],[role='textbox']");
  const findBody = () => findByHint(/有什么新鲜事|分享给大家|说点什么|正文|内容|发布/i, textControls)
    || candidates("textarea,[contenteditable='true'],[role='textbox']").find((element) => !/搜索|搜一搜|评论/i.test(`${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""}`));

  const setContentEditableText = (element: HTMLElement, value: string) => {
    element.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (document.execCommand("insertText", false, value)) {
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    } catch {
      // 某些浏览器版本会禁用 execCommand，继续使用 DOM 回退。
    }
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const setText = (element: HTMLElement, value: string) => {
    element.focus();
    if (element.isContentEditable) {
      setContentEditableText(element, value);
      return;
    }
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const buildWeiboBody = (draft: Draft, includeTitle: boolean): string => {
    const title = includeTitle ? draft.title.trim() : "";
    const content = draft.content.trim();
    const topics = [...new Set(draft.tags.map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean))].map((tag) => `#${tag}`).join(" ");
    const bodyWithTopics = topics && !content.includes(topics) ? `${content}\n\n${topics}` : content;
    // 微博没有独立标题栏，沿用发布交接弹窗的复制逻辑，将标题置于正文开头。
    return [title, bodyWithTopics].filter(Boolean).join("\n\n");
  };

  const fillDraft = (draft: Draft) => {
    const title = findTitle();
    const body = findBody();
    // 若微博页面出现独立标题框，则标题单独填充；常规微博只有正文框，此时合并标题。
    const bodyText = buildWeiboBody(draft, !title);
    if (title) setText(title, draft.title);
    if (body) setText(body, bodyText);
    return { title: Boolean(title), body: Boolean(body), bodyElement: body, topic: Boolean(body && draft.tags.length > 0) };
  };

  const autoFillPendingDraft = () => {
    if (!pendingHandoff || flowStage !== "loading") return false;
    const result = fillDraft(pendingHandoff);
    if (!result.body || !result.bodyElement) return false;
    expectedBodyAfterImport = normalizeBodyText(readText(result.bodyElement));
    flowStage = "awaiting-image";
    syncButton();
    // 编辑器出现后立即尝试点击微博图片入口；若浏览器拦截原生文件窗口，保留按钮供用户手势重试。
    attemptAutoOpenImagePicker();
    return true;
  };

  const requestImagePicker = () => {
    imagePickerOpenedAttempted = false;
    const result = openWeiboImagePicker();
    if (result === "opened") {
      imagePickerOpenedAttempted = true;
      markImagePickerOpened();
      return;
    }
    const message = result === "missing-input"
      ? "微博图片上传控件尚未加载。请先打开微博发布框后重试。"
      : result === "missing-button"
        ? "暂时没有找到文本为“图片”的微博上传入口。"
        : result === "ambiguous-button"
          ? "页面上检测到多个“图片”入口，为避免误操作，插件没有点击。请关闭其它发布弹窗后重试。"
          : "微博图片入口拒绝了本次点击，请确认发布框处于前台后重试。";
    const panel = showPanel(weiboAssistantFrame("需要重试", `${currentDraftTicket()}<div class="publish-review-state">${escapeHtml(message)}</div><div class="publish-review-dock-actions"><button class="publish-review-dock-primary" data-select-image>重试选择图片</button><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div><p class="publish-review-note">助手不会读取或自动选择本地文件；也可以直接使用微博页面的“图片”按钮。</p>`));
    panel.querySelector("[data-select-image]")?.addEventListener("click", requestImagePicker);
  };

  const confirmAndSend = () => {
    const currentBody = findBody();
    if (!currentBody || !expectedBodyAfterImport || normalizeBodyText(readText(currentBody)) !== expectedBodyAfterImport) {
      showPanel(weiboAssistantFrame("已暂停", `<div class="publish-review-state">微博正文已变化、丢失或编辑器尚未就绪。为避免误发，助手没有点击发送。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div><p class="publish-review-note">如需保留手动修改后的内容，请直接使用微博页面的“发送”按钮。</p>`));
      return;
    }
    const sendButtons = findFinalWeiboSendButtons();
    if (sendButtons.length !== 1) {
      const message = sendButtons.length === 0
        ? "暂时没有找到微博唯一可用的“发送”按钮。请确认发布框已加载完成、内容符合平台要求后重试。"
        : "页面上检测到多个可用的“发送”按钮，为避免误发，插件已停止操作。请关闭其它发布弹窗后重试。";
      showPanel(weiboAssistantFrame("已暂停", `<div class="publish-review-state">${escapeHtml(message)}</div><div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div><p class="publish-review-note">助手只会点击文本精确为“发送”且唯一、可见、可用的微博按钮。</p>`));
      return;
    }
    try {
      flowStage = "sent";
      syncButton();
      sendButtons[0]?.focus();
      sendButtons[0]?.click();
      pendingHandoff = null;
      expectedBodyAfterImport = null;
      clearStoredDraft();
      syncButton();
      showPanel(weiboAssistantFrame("已触发发送", `<ol class="publish-review-flow"><li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li><li class="is-done"><span class="publish-review-step-dot">✓</span><span>图片与正文已核对</span></li><li class="is-active"><span class="publish-review-step-dot">03</span><span>等待微博显示最终发送结果</span></li></ol><div class="publish-review-state">助手已点击微博页面唯一可用的“发送”按钮。请以微博页面结果为准；验证码、平台校验或二次确认仍需由你完成。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-primary" data-return-app data-publication-complete>完成平台校验后返回发布清单</button></div><p class="publish-review-note">微博暂不支持可靠的公开作品回盘，因此这里只返回多渠道发布清单。</p>`));
    } catch {
      flowStage = "awaiting-send";
      syncButton();
      const panel = showPanel(weiboAssistantFrame("发送未触发", `<div class="publish-review-state">微博页面拒绝了本次按钮操作，请检查页面状态后再次确认。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-primary" data-confirm-send>再次确认发送</button><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div>`));
      panel.querySelector("[data-confirm-send]")?.addEventListener("click", confirmAndSend);
    }
  };

  button.addEventListener("click", () => {
    if (flowStage === "awaiting-image") {
      markImagePickerOpened();
      return;
    }
    if (flowStage === "awaiting-send") {
      handleImageSelection();
      return;
    }
    if (flowStage === "sent") {
      showPanel(weiboAssistantFrame("已触发发送", `<div class="publish-review-state">请以微博页面显示的最终结果为准；完成平台校验后返回发布应用发布清单。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-primary" data-return-app data-publication-complete>返回发布应用发布清单</button></div>`));
      return;
    }
    const imported = autoFillPendingDraft();
    if (imported) {
      requestImagePicker();
      return;
    }
    showPanel(weiboAssistantFrame("正在导入", `${currentDraftTicket()}<ol class="publish-review-flow"><li class="is-active"><span class="publish-review-step-dot">01</span><span>等待微博编辑器加载并填入当前文案</span></li><li><span class="publish-review-step-dot">02</span><span>选择本次微博图片</span></li><li><span class="publish-review-step-dot">03</span><span>检查内容后确认发送</span></li></ol><div class="publish-review-state">请保持当前标签在前台，编辑器出现后助手会继续。</div>`));
  });

  let previousPath = location.href;
  const importedOnLoad = autoFillPendingDraft();
  if (!importedOnLoad && pendingHandoff) button.click();
  new MutationObserver(() => {
    autoFillPendingDraft();
    attemptAutoOpenImagePicker();
    if (location.href !== previousPath) {
      previousPath = location.href;
      syncButton();
      closePanel();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
