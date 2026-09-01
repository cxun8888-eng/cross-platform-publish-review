(() => {
  type Platform = "douyin" | "xiaohongshu";
  type ReturnTarget = "workspace" | "wizard";
  type Draft = { id: string; title: string; content: string; tags: string[]; returnTarget: ReturnTarget; updated_at?: string; product_name?: string };
  type DashboardMetrics = {
    impressions?: number;
    reads?: number;
    views?: number;
    likes?: number;
    comments?: number;
    collects?: number;
    shares?: number;
    follows?: number;
    completionRate?: number;
    avgWatchDurationSeconds?: number;
    bounceRate?: number;
    twoSecondExitRate?: number;
    coverClickRate?: number;
  };

  const host = location.hostname;
  const platform: Platform | null = host === "creator.douyin.com"
    ? "douyin"
    : host === "creator.xiaohongshu.com"
      ? "xiaohongshu"
      : null;
  if (!platform) return;

  const handoffStorageKey = `publish_review_pending_draft:${platform}`;
  const handoffRefreshKey = `publish_review_handoff_refreshed:${platform}`;
  const handoffTtlMs = 10 * 60 * 1000;

  /**
   * 发布应用“去发布”会把当前这一条游客向文案放进 URL fragment。
   * fragment 不会发送给平台服务器，读取后立即清理，插件也不会读取其它 SaaS 草稿。
   */
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

  const reviewOpenRequested = { value: false };
  const reviewHandoffCompletion = { inFlight: false, completed: false };
  const reviewHandoffPolling = { startedAt: 0, timer: null as number | null };
  const reviewResolutionStorageKey = `publish_review_review_resolution:${platform}`;
  const reviewResolutionState = { startedAt: 0, managementOpened: false, dashboardOpened: false, metricsScraped: false, workTitle: "" };
  const publishedWorkIdPattern = platform === "douyin" ? /^\d{8,}$/ : /^[A-Za-z0-9_-]{8,128}$/;
  const publishedWorkHosts = platform === "douyin"
    ? new Set(["www.douyin.com", "m.douyin.com", "www.iesdouyin.com", "creator.douyin.com"])
    : new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com", "creator.xiaohongshu.com"]);

  const normalizePublishedWorkUrl = (value: string): string | null => {
    let url: URL;
    const candidateValue = value.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/[),.;!?]+$/, "");
    try { url = new URL(candidateValue, location.href); } catch { return null; }
    if (url.protocol !== "https:" || !publishedWorkHosts.has(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = platform === "douyin"
      ? parts[0] === "video" || parts[0] === "note"
        ? parts[1]
        : parts[0] === "share" && parts[1] === "video" ? parts[2] : url.searchParams.get("modal_id") || url.searchParams.get("video_id") || url.searchParams.get("mid")
      : parts[0] === "discovery" && parts[1] === "item"
        ? parts[2]
        : parts[0] === "explore" || parts[0] === "item"
          ? parts[1]
          : url.hostname.toLowerCase().includes("xhslink") && parts.length > 0
            ? parts[parts.length - 1]
            : url.searchParams.get("feed_id") || url.searchParams.get("id") || url.searchParams.get("note_id");
    if (!candidate || !publishedWorkIdPattern.test(candidate)) return null;
    return platform === "douyin"
      ? `https://www.douyin.com/video/${candidate}`
      : `https://www.xiaohongshu.com/explore/${candidate}`;
  };

  const isPublishedResultPage = () => {
    if (location.pathname.includes("/publish/success")) return true;
    return new URL(location.href).searchParams.get("published") === "true";
  };

  const readReviewResolutionState = () => {
    if (reviewResolutionState.startedAt > 0) return;
    try {
      const raw = sessionStorage.getItem(reviewResolutionStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { startedAt?: number; managementOpened?: boolean; dashboardOpened?: boolean; metricsScraped?: boolean; workTitle?: string };
      if (typeof parsed.startedAt !== "number" || Date.now() - parsed.startedAt > 60_000) {
        sessionStorage.removeItem(reviewResolutionStorageKey);
        return;
      }
      reviewResolutionState.startedAt = parsed.startedAt;
      reviewResolutionState.managementOpened = parsed.managementOpened === true;
      reviewResolutionState.dashboardOpened = parsed.dashboardOpened === true;
      reviewResolutionState.metricsScraped = parsed.metricsScraped === true;
      reviewResolutionState.workTitle = typeof parsed.workTitle === "string" ? parsed.workTitle.slice(0, 200) : "";
    } catch {
      // 成功页没有会话存储时，仍可依靠当前页面内的轮询和后台 URL 监听。
    }
  };

  const persistReviewResolutionState = () => {
    try {
      sessionStorage.setItem(reviewResolutionStorageKey, JSON.stringify(reviewResolutionState));
    } catch {
      // 忽略存储失败，不阻断当前页面内的识别流程。
    }
  };

  const beginReviewResolution = (workTitle?: string) => {
    reviewResolutionState.startedAt = Date.now();
    reviewResolutionState.managementOpened = false;
    reviewResolutionState.dashboardOpened = false;
    reviewResolutionState.metricsScraped = false;
    reviewResolutionState.workTitle = typeof workTitle === "string" ? workTitle.trim().slice(0, 200) : "";
    persistReviewResolutionState();
  };

  const clearReviewResolution = () => {
    reviewResolutionState.startedAt = 0;
    reviewResolutionState.managementOpened = false;
    reviewResolutionState.dashboardOpened = false;
    reviewResolutionState.metricsScraped = false;
    reviewResolutionState.workTitle = "";
    try { sessionStorage.removeItem(reviewResolutionStorageKey); } catch { /* 忽略清理失败 */ }
  };

  const isReviewResolutionActive = () => {
    if (isPublishedResultPage()) return true;
    readReviewResolutionState();
    return reviewResolutionState.startedAt > 0 && Date.now() - reviewResolutionState.startedAt <= 60_000;
  };

  const findPublishedWorkUrl = (ignoredUrl?: string | null): string | null => {
    const currentParams = new URL(location.href).searchParams;
    const currentId = platform === "douyin"
      ? currentParams.get("video_id") || currentParams.get("aweme_id") || currentParams.get("item_id")
      : currentParams.get("note_id") || currentParams.get("work_id") || currentParams.get("feed_id") || currentParams.get("item_id") || currentParams.get("id");
    const candidates = [
      location.href,
      ...(currentId && publishedWorkIdPattern.test(currentId)
        ? [platform === "douyin" ? `https://www.douyin.com/video/${currentId}` : `https://www.xiaohongshu.com/explore/${currentId}`]
        : []),
      ...Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"), (anchor) => anchor.href),
      ...Array.from(document.querySelectorAll<HTMLElement>("[data-url],[data-href],[data-work-url],[data-note-url]"), (element) => (
        element.dataset.url || element.dataset.href || element.dataset.workUrl || element.dataset.noteUrl || ""
      )),
      ...Array.from(document.querySelectorAll<HTMLElement>("[data-note-id],[data-work-id],[data-item-id],[data-video-id]"), (element) => {
        const id = element.dataset.noteId || element.dataset.workId || element.dataset.itemId || element.dataset.videoId || "";
        return platform === "douyin" ? `https://www.douyin.com/video/${id}` : `https://www.xiaohongshu.com/explore/${id}`;
      }),
      ...(document.body?.innerText.match(/https?:\/\/[^\s"'<>]+/g) || []),
      ...(isReviewResolutionActive()
        ? [
          ...(document.documentElement?.innerHTML.match(/https?:\\?\/\\?\/[^\s"'<>]+/g) || []),
          ...Array.from(document.querySelectorAll<HTMLElement>("[data-id]"), (element) => {
            const id = element.dataset.id || "";
            return platform === "douyin" ? `https://www.douyin.com/video/${id}` : `https://www.xiaohongshu.com/explore/${id}`;
          }),
        ]
        : []),
    ];
    for (const candidate of candidates) {
      const normalized = normalizePublishedWorkUrl(candidate);
      if (normalized && normalized !== ignoredUrl) return normalized;
    }
    return null;
  };

  const compactDashboardText = (value: string) => value.replace(/\s+/g, "").replace(/[：:]/g, ":").trim();

  const parseDashboardNumber = (value: string): number | null => {
    const normalized = compactDashboardText(value).replace(/,/g, "");
    if (!normalized || /^[-—–]+$/.test(normalized)) return null;
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const numberValue = Number(match[0]);
    if (!Number.isFinite(numberValue) || numberValue < 0) return null;
    const unit = normalized.match(/(亿|万)(?:人|次|条)?$/)?.[1];
    const multiplier = unit === "亿" ? 100_000_000 : unit === "万" ? 10_000 : 1;
    return numberValue * multiplier;
  };

  const dashboardMetricKey = (value: string): keyof DashboardMetrics | null => {
    const header = compactDashboardText(value);
    if (/曝光|展现/.test(header)) return "impressions";
    if (platform === "xiaohongshu" && /阅读|观看/.test(header)) return "reads";
    if (/播放量|播放|观看次数|观看量/.test(header)) return "views";
    if (/点赞|获赞/.test(header)) return "likes";
    if (/评论|留言/.test(header)) return "comments";
    if (/收藏/.test(header)) return "collects";
    if (/涨粉|粉丝净增|新增粉丝/.test(header)) return "follows";
    if (/分享|转发/.test(header)) return "shares";
    if (/完播率|完成率/.test(header)) return "completionRate";
    if (/人均观看时长|平均播放时长|平均观看时长/.test(header)) return "avgWatchDurationSeconds";
    if (/2秒跳出率|二秒跳出率/.test(header)) return "twoSecondExitRate";
    if (/封面点击率/.test(header)) return "coverClickRate";
    if (/跳出率|退出率/.test(header)) return "bounceRate";
    return null;
  };

  const visibleDashboardElement = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };

  const dashboardTitleMatches = (rowText: string, expectedTitle: string) => {
    if (!expectedTitle) return false;
    const normalizedRow = compactDashboardText(rowText);
    return normalizedRow.includes(expectedTitle) || (expectedTitle.length >= 8 && normalizedRow.includes(expectedTitle.slice(0, 8)));
  };

  const findDashboardTitleContainer = (): HTMLElement | null => {
    const expectedTitle = compactDashboardText(reviewResolutionState.workTitle);
    if (!expectedTitle) return null;
    const structuredRows = Array.from(document.querySelectorAll<HTMLElement>("table tbody tr,table tr,[role='row']")).filter(visibleDashboardElement);
    const structuredMatch = structuredRows.find((candidate) => dashboardTitleMatches(candidate.innerText || candidate.textContent || "", expectedTitle));
    if (structuredMatch) return structuredMatch;
    const genericMatches = Array.from(document.querySelectorAll<HTMLElement>("a[href],article,li,div,section")).filter((candidate) => {
      if (!visibleDashboardElement(candidate)) return false;
      const text = candidate.innerText || candidate.textContent || "";
      return compactDashboardText(text).length <= 1_200 && dashboardTitleMatches(text, expectedTitle);
    }).sort((left, right) => compactDashboardText(left.innerText || left.textContent || "").length - compactDashboardText(right.innerText || right.textContent || "").length);
    const leaf = genericMatches[0];
    if (!leaf) return null;
    let scope: HTMLElement | null = leaf;
    for (let depth = 0; depth < 5 && scope; depth += 1, scope = scope.parentElement) {
      const text = scope.innerText || scope.textContent || "";
      const lineCount = text.split(/\r?\n+/).filter(Boolean).length;
      if (dashboardTitleMatches(text, expectedTitle) && (lineCount >= 3 || scope.children.length >= 3)) return scope;
    }
    return leaf;
  };

  const dashboardRowCells = (row: HTMLElement) => {
    const cells = Array.from(row.querySelectorAll<HTMLElement>("td,[role='cell']")).filter(visibleDashboardElement);
    if (cells.length > 0) return cells;
    return Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement && visibleDashboardElement(child));
  };

  const scrapeDashboardMetricCards = (): DashboardMetrics => {
    const result: DashboardMetrics = {};
    const cardDefinitions: Array<[RegExp, keyof DashboardMetrics]> = [
      [/总曝光|曝光量/, "impressions"], [/总阅读|阅读量/, "reads"], [/总播放量|播放量/, "views"],
      [/总点赞量|点赞量/, "likes"], [/总评论量|评论量/, "comments"], [/总收藏量|收藏量/, "collects"],
      [/总分享量|分享量/, "shares"], [/粉丝净增|涨粉/, "follows"], [/5秒完播率|完播率/, "completionRate"],
      [/2秒跳出率|二秒跳出率/, "twoSecondExitRate"], [/封面点击率/, "coverClickRate"], [/平均播放时长|人均观看时长/, "avgWatchDurationSeconds"],
    ];
    for (const [pattern, key] of cardDefinitions) {
      const labelElement = Array.from(document.querySelectorAll<HTMLElement>("div,span,p,dt,th")).find((element) => {
        if (!visibleDashboardElement(element)) return false;
        const text = compactDashboardText(element.innerText || element.textContent || "");
        return pattern.test(text) && text.length <= 30;
      });
      if (!labelElement) continue;
      let scope: HTMLElement | null = labelElement;
      for (let depth = 0; depth < 4 && scope; depth += 1, scope = scope.parentElement) {
        const text = compactDashboardText(scope.innerText || scope.textContent || "");
        if (text.length > 180) continue;
        const parsed = parseDashboardNumber(text.replace(pattern, ""));
        if (parsed !== null) {
          result[key] = parsed;
          break;
        }
      }
    }
    return result;
  };

  const isDouyinRecentWorksPage = () => {
    if (platform !== "douyin") return false;
    const text = compactDashboardText(document.body?.innerText || "");
    return /数据中心/.test(text) && /近期作品/.test(text);
  };

  const scrapeDouyinRecentWorksMetrics = (): DashboardMetrics => {
    if (platform !== "douyin") return {};
    const row = findDashboardTitleContainer();
    if (!row) return {};
    const text = compactDashboardText(row.innerText || row.textContent || "");
    const result: DashboardMetrics = {};
    const definitions: Array<[RegExp, keyof DashboardMetrics]> = [
      [/播放(?:量)?[:]?([0-9]+(?:\.\d+)?(?:万|亿)?)/, "views"],
      [/点赞(?:量)?[:]?([0-9]+(?:\.\d+)?(?:万|亿)?)/, "likes"],
      [/评论(?:量)?[:]?([0-9]+(?:\.\d+)?(?:万|亿)?)/, "comments"],
      [/分享(?:量)?[:]?([0-9]+(?:\.\d+)?(?:万|亿)?)/, "shares"],
      [/收藏(?:量)?[:]?([0-9]+(?:\.\d+)?(?:万|亿)?)/, "collects"],
      [/(?:涨粉|粉丝净增)[:]?([0-9]+(?:\.\d+)?(?:万|亿)?)/, "follows"],
    ];
    definitions.forEach(([pattern, key]) => {
      const match = text.match(pattern);
      const parsed = match?.[1] ? parseDashboardNumber(match[1]) : null;
      if (parsed !== null && parsed !== undefined) result[key] = parsed;
    });
    return result;
  };

  const scrapeDashboardMetrics = (): DashboardMetrics | null => {
    if (!document.body) return null;
    const expectedTitle = compactDashboardText(reviewResolutionState.workTitle);
    const tables = Array.from(document.querySelectorAll<HTMLElement>("table")).filter(visibleDashboardElement);
    const rows = tables.flatMap((table) => {
      const headers = Array.from(table.querySelectorAll<HTMLElement>("thead th,[role='columnheader']")).filter(visibleDashboardElement);
      const tableRows = Array.from(table.querySelectorAll<HTMLElement>("tbody tr,table tr,[role='row']")).filter(visibleDashboardElement);
      return tableRows.map((row) => ({ row, headers }));
    });
    const fallbackRows = Array.from(document.querySelectorAll<HTMLElement>("[role='row']")).filter(visibleDashboardElement)
      .map((row) => ({ row, headers: Array.from(document.querySelectorAll<HTMLElement>("[role='columnheader']")).filter(visibleDashboardElement) }));
    const candidates = rows.length > 0 ? rows : fallbackRows;
    const preferred = expectedTitle
      ? candidates.find(({ row }) => dashboardTitleMatches(row.innerText || row.textContent || "", expectedTitle))
      : undefined;
    const result: DashboardMetrics = {};
    // 已知作品标题时禁止退回第一行，否则多作品看板可能把别人的指标关联到本次发布。
    const selected = expectedTitle ? preferred : candidates.find(({ row }) => dashboardRowCells(row).length >= 2);
    if (selected) {
      const cells = dashboardRowCells(selected.row);
      const headers = selected.headers;
      headers.forEach((header, index) => {
        const key = dashboardMetricKey(header.innerText || header.textContent || "");
        const cell = cells[index];
        if (!key || !cell) return;
        const parsed = parseDashboardNumber(cell.innerText || cell.textContent || "");
        if (parsed !== null) result[key] = parsed;
      });
      // 有些平台使用 div 网格，表头和数据行都带 role=cell；上面的表格选择器
      // 已覆盖这种情况。若表头存在合并列，按文本顺序再尝试一次，避免列索引偏移。
      if (Object.keys(result).length === 0 && headers.length > 0) {
        const keyHeaders = headers.map((header) => dashboardMetricKey(header.innerText || header.textContent || ""));
        const numericCells = cells.map((cell) => parseDashboardNumber(cell.innerText || cell.textContent || ""));
        keyHeaders.forEach((key, index) => {
          const parsed = numericCells[index];
          if (key && parsed !== null) result[key] = parsed;
        });
      }
    }
    // 小红书内容分析在部分版本使用普通 div 网格，不提供 table/role=row。
    // 这类页面仍按“标题、发布时间、曝光、观看、点击率、互动……”的可见顺序读取同一行。
    if (platform === "xiaohongshu" && Object.keys(result).length === 0) {
      const titleContainer = findDashboardTitleContainer();
      const rawLines = (titleContainer?.innerText || "").split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
      const publishIndex = rawLines.findIndex((line) => /发布(?:于|时间)/.test(line));
      const tokens = (publishIndex >= 0 ? rawLines.slice(publishIndex + 1) : rawLines.slice(1)).flatMap((line) => line.split(/\s+/).filter(Boolean));
      const orderedKeys: Array<keyof DashboardMetrics> = ["impressions", "reads", "coverClickRate", "likes", "comments", "collects", "follows", "shares", "avgWatchDurationSeconds"];
      orderedKeys.forEach((key, index) => {
        const parsed = parseDashboardNumber(tokens[index] || "");
        if (parsed !== null) result[key] = parsed;
      });
    }
    // 抖音首页的数据中心会在“近期作品”卡片中直接展示本次作品的行数据，
    // 先按标题锁定该行，再从“播放/点赞/评论/分享”等标签旁读取数值。
    if (platform === "douyin" && Object.keys(result).length === 0) {
      Object.assign(result, scrapeDouyinRecentWorksMetrics());
    }
    // 标题未命中时不采集页面级指标卡，避免把账号总览误当成本次作品数据。
    const canUseMetricCards = !expectedTitle || Boolean(findDashboardTitleContainer()) || isPublishedResultPage();
    Object.entries(canUseMetricCards ? scrapeDashboardMetricCards() : {}).forEach(([key, value]) => {
      const metricKey = key as keyof DashboardMetrics;
      if (result[metricKey] === undefined) result[metricKey] = value;
    });
    return Object.keys(result).length > 0 ? result : null;
  };

  const findDashboardWorkUrl = (): string | null => {
    const expectedTitle = compactDashboardText(reviewResolutionState.workTitle);
    if (!expectedTitle) return null;
    const row = findDashboardTitleContainer();
    if (!row) return null;
    const scopes: HTMLElement[] = [row];
    let parent = row.parentElement;
    for (let depth = 0; depth < 4 && parent; depth += 1, parent = parent.parentElement) scopes.push(parent);
    const values = scopes.flatMap((scope) => {
      const scopeId = scope.dataset.noteId || scope.dataset.workId || scope.dataset.itemId || scope.dataset.videoId || scope.dataset.id || "";
      return [
        ...(scope instanceof HTMLAnchorElement ? [scope.href] : []),
        ...(scopeId ? [platform === "douyin" ? `https://www.douyin.com/video/${scopeId}` : `https://www.xiaohongshu.com/explore/${scopeId}`] : []),
        ...Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href]"), (anchor) => anchor.href),
        ...Array.from(scope.querySelectorAll<HTMLElement>("[data-url],[data-href],[data-work-url],[data-note-url]"), (element) => element.dataset.url || element.dataset.href || element.dataset.workUrl || element.dataset.noteUrl || ""),
        ...Array.from(scope.querySelectorAll<HTMLElement>("[data-note-id],[data-work-id],[data-item-id],[data-video-id],[data-id]"), (element) => {
          const id = element.dataset.noteId || element.dataset.workId || element.dataset.itemId || element.dataset.videoId || element.dataset.id || "";
          return platform === "douyin" ? `https://www.douyin.com/video/${id}` : `https://www.xiaohongshu.com/explore/${id}`;
        }),
        ...(scope.innerHTML.match(/https?:\\?\/\\?\/[^\s"'<>]+/g) || []),
      ];
    });
    const direct = values.map((value) => normalizePublishedWorkUrl(value)).find(Boolean);
    if (direct) return direct;
    // 内容分析页有些版本把作品 ID 放在 React 状态 JSON 中，不挂在 DOM 属性上。
    // 只在“本次标题”附近读取 note/work/feed 的 ID，避免从整页其它作品中误选。
    const html = document.documentElement?.innerHTML || "";
    const titleMarkers = [reviewResolutionState.workTitle, reviewResolutionState.workTitle.slice(0, 8)].filter((marker) => marker.length >= 8);
    for (const marker of titleMarkers) {
      const markerIndex = html.indexOf(marker);
      if (markerIndex < 0) continue;
      const nearby = html.slice(Math.max(0, markerIndex - 1200), markerIndex + 1200);
      const publicUrl = nearby.match(/https?:\\?\/\\?(?:www\\.)?xiaohongshu\\.com\\?\/(?:explore|item)\\?\/([A-Za-z0-9_-]{8,128})/i)?.[0];
      const id = nearby.match(/(?:noteId|note_id|feedId|feed_id|workId|work_id)\s*["'=:]+\s*["']?([A-Za-z0-9_-]{8,128})/i)?.[1];
      const normalized = publicUrl ? normalizePublishedWorkUrl(publicUrl) : id ? normalizePublishedWorkUrl(`https://www.xiaohongshu.com/explore/${id}`) : null;
      if (normalized) return normalized;
    }
    return null;
  };

  const isDashboardPage = () => {
    const text = compactDashboardText(document.body?.innerText || "");
    return platform === "xiaohongshu" ? /内容分析|笔记数据/.test(text) : /作品数据|数据总览/.test(text) || isDouyinRecentWorksPage();
  };

  const completeReviewHandoffIfDetected = () => {
    if (reviewHandoffCompletion.inFlight || reviewHandoffCompletion.completed) return;
    const dashboardPage = isDashboardPage();
    const dashboardMetrics = scrapeDashboardMetrics();
    const dashboardTitleContainer = dashboardPage ? findDashboardTitleContainer() : null;
    const workUrl = dashboardPage
      ? findDashboardWorkUrl()
      : platform === "douyin" && !isPublishedResultPage()
        ? null
        : findPublishedWorkUrl();
    // 看板表格不一定暴露公开链接；只要已锁定本次发布标题所在行并拿到指标，
    // 也可以直接进入发布应用展示看板数据，页面会明确标注尚未拿到公开链接。
    const dashboardOnly = dashboardPage && Boolean(dashboardTitleContainer && dashboardMetrics);
    if (!workUrl && !dashboardOnly) return;
    if (dashboardMetrics && !reviewResolutionState.metricsScraped) {
      reviewResolutionState.metricsScraped = true;
      persistReviewResolutionState();
    }
    const resolutionAge = reviewResolutionState.startedAt > 0 ? Date.now() - reviewResolutionState.startedAt : 0;
    // 发布成功页偶尔会先把公开链接渲染出来，再异步加载“笔记数据/作品数据”。
    // 在短暂等待窗口内不抢先打开发布应用，给看板表格留出渲染时间；超时仍走链接兜底。
    if (isReviewResolutionActive() && !dashboardMetrics && resolutionAge > 0 && resolutionAge < 25_000 && (isPublishedResultPage() || reviewResolutionState.managementOpened)) return;
    reviewHandoffCompletion.inFlight = true;
    void chrome.runtime.sendMessage({ type: "COMPLETE_REVIEW_HANDOFF", platform, returnTarget: handoffReturnTarget, workUrl: workUrl || undefined, dashboardMetrics, dashboardTitle: reviewResolutionState.workTitle })
      .then((response) => {
        reviewHandoffCompletion.inFlight = false;
        reviewHandoffCompletion.completed = Boolean(response?.ok && response?.data?.completed);
        if (reviewHandoffCompletion.completed) clearReviewResolution();
      })
      .catch(() => {
        reviewHandoffCompletion.inFlight = false;
      });
  };

  const scheduleReviewHandoffCheck = () => {
    if (reviewHandoffCompletion.completed || reviewHandoffPolling.timer !== null) return;
    if (!reviewHandoffPolling.startedAt) {
      readReviewResolutionState();
      reviewHandoffPolling.startedAt = reviewResolutionState.startedAt || Date.now();
    }
    if (Date.now() - reviewHandoffPolling.startedAt >= 60_000) return;
    reviewHandoffPolling.timer = window.setTimeout(() => {
      reviewHandoffPolling.timer = null;
      completeReviewHandoffIfDetected();
      if (!reviewResolutionState.managementOpened && (isPublishedResultPage() || platform === "douyin") && Date.now() - reviewHandoffPolling.startedAt >= 3_000) {
        // 抖音发布结果有时会落在“内容管理”页；先点击侧边栏“首页”，
        // 再进入首页数据中心里的“近期作品”，不要停留在内容管理列表。
        if (platform === "douyin" && isDouyinRecentWorksPage()) {
          reviewResolutionState.managementOpened = true;
          persistReviewResolutionState();
        } else {
          const managementAction = platform === "xiaohongshu" ? findXhsAction(/^数据看板$/) : (findDouyinAction(/^首页$/) || findDouyinAction(/^数据中心$/));
          if (managementAction) {
            reviewResolutionState.managementOpened = true;
            persistReviewResolutionState();
            if (platform === "xiaohongshu") clickXhsAction(managementAction);
            else managementAction.click();
          }
        }
      }
      if (reviewResolutionState.managementOpened && !reviewResolutionState.dashboardOpened) {
        if (platform === "douyin") {
          const recentWorksAction = findDouyinAction(/^近期作品$/);
          if (recentWorksAction) {
            recentWorksAction.click();
            reviewResolutionState.dashboardOpened = true;
            persistReviewResolutionState();
          } else if (isDouyinRecentWorksPage()) {
            reviewResolutionState.dashboardOpened = true;
            persistReviewResolutionState();
          }
        }
        const dashboardAction = platform === "xiaohongshu" ? (findXhsAction(/^内容分析$/) || findXhsAction(/^笔记数据$/)) : findDouyinAction(/^作品数据$/);
        if (dashboardAction && !reviewResolutionState.dashboardOpened) {
          reviewResolutionState.dashboardOpened = true;
          persistReviewResolutionState();
          if (platform === "xiaohongshu") clickXhsAction(dashboardAction);
          else dashboardAction.click();
        }
      }
      const dashboardMetrics = scrapeDashboardMetrics();
      if (dashboardMetrics && !reviewResolutionState.metricsScraped) {
        reviewResolutionState.metricsScraped = true;
        persistReviewResolutionState();
      }
      // 看板渲染完成后再次尝试，确保带着页面采集到的指标进入发布应用。
      if (reviewResolutionState.metricsScraped) completeReviewHandoffIfDetected();
      if (Date.now() - reviewHandoffPolling.startedAt >= 60_000) clearReviewResolution();
      if (!reviewHandoffCompletion.completed) scheduleReviewHandoffCheck();
    }, 500);
  };

  /** 发布成功页出现公开作品链接后，由后台打开作品复盘并携带该链接。 */
  const openSaasReview = (workUrl?: string) => {
    if (reviewOpenRequested.value) return;
    reviewOpenRequested.value = true;
    void chrome.runtime.sendMessage({ type: "OPEN_SAAS_REVIEW", platform, returnTarget: handoffReturnTarget, workUrl }).catch(() => undefined);
  };

  /**
   * 先由后台记录“本标签页正在等待发布结果”，再触发平台发布。
   * 页面跳转会卸载当前内容脚本，接力状态不能只放在当前页面内存中。
   */
  const registerReviewHandoff = async (beforeUrl?: string | null, title?: string | null) => {
    const response = await chrome.runtime.sendMessage({ type: "REGISTER_REVIEW_HANDOFF", platform, returnTarget: handoffReturnTarget, beforeUrl: beforeUrl || undefined, title: title || undefined });
    if (!response?.ok) throw new Error(response?.error || "无法记录发布结果接力状态");
  };

  const waitForPublishedWorkUrl = (panel: HTMLElement, ignoredUrl?: string | null) => {
    const startedAt = Date.now();
    const poll = () => {
      if (!panel.isConnected) return;
      const workUrl = findPublishedWorkUrl(ignoredUrl);
      if (workUrl) {
        const state = panel.querySelector(".publish-review-state");
        if (isReviewResolutionActive()) {
          if (state) state.textContent = `已识别作品链接，正在读取平台数据看板：${workUrl}`;
          scheduleReviewHandoffCheck();
        } else {
          if (state) state.textContent = `已识别作品链接，正在打开发布应用作品复盘：${workUrl}`;
          openSaasReview(workUrl);
        }
        return;
      }
      if (Date.now() - startedAt >= 60_000) {
        const state = panel.querySelector(".publish-review-state");
        if (state) state.textContent = "若未自动打开发布应用作品复盘请点击此处。";
        return;
      }
      window.setTimeout(poll, 1000);
    };
    poll();
  };

  const readHandoffDraft = (): Draft | null => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return readStoredDraft();
    const encoded = new URLSearchParams(hash).get("publish_review_draft");
    if (!encoded) return readStoredDraft();
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
      const binary = atob(base64);
      const percentEncoded = Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
      const parsed = JSON.parse(decodeURIComponent(percentEncoded)) as Record<string, unknown>;
      const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 20) : [];
      if (
        parsed.version !== 1
        || parsed.source !== "publish-review-demo"
        || parsed.platform !== platform
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
      // 小红书发布页是 SPA，首次打开可能只渲染侧栏；自动刷新一次让平台重新初始化编辑器。
      // 标记写入 sessionStorage，避免刷新后的第二次注入再次 reload 形成循环。
      if (platform === "xiaohongshu") {
        try {
          if (!sessionStorage.getItem(handoffRefreshKey)) {
            sessionStorage.setItem(handoffRefreshKey, "1");
            window.setTimeout(() => window.location.reload(), 0);
          }
        } catch {
          // 浏览器禁用会话存储时不强制刷新，避免打断当前页面的导入。
        }
      }
      return draft;
    } catch {
      return readStoredDraft();
    } finally {
      // 文案是游客向公开内容，仍然不应留在浏览器历史或平台地址栏中。
      history.replaceState(null, document.title, `${location.pathname}${location.search}`);
    }
  };

  let pendingHandoff = readHandoffDraft();
  const handoffReturnTarget: ReturnTarget = pendingHandoff?.returnTarget ?? "workspace";

  const isPublishPage = () => platform === "xiaohongshu"
    ? /\/publish(?:\/|$)/.test(location.pathname)
    : /(?:upload|publish|content)/i.test(location.pathname);

  const root = document.createElement("div");
  root.id = "publish-review-saas-extension-root";
  const shadow = root.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .publish-review-button { position: fixed; z-index: 2147483646; right: 28px; top: 92px; min-width: 190px; border: 0; border-radius: 12px; padding: 14px 20px; background: linear-gradient(135deg,#155eef,#7c3aed); color: white; font: 700 16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing: .01em; box-shadow: 0 8px 26px #1e3a8a55; cursor: pointer; }
    .publish-review-button:hover { filter: brightness(1.06); transform: translateY(-1px); }
    .publish-review-button-attention { animation: publish-review-pulse 1.8s ease-in-out infinite; }
    @keyframes publish-review-pulse { 0%,100% { box-shadow: 0 8px 26px #1e3a8a55; } 50% { box-shadow: 0 8px 30px #2563eb99, 0 0 0 6px #2563eb22; } }
    .publish-review-panel { position: fixed; z-index: 2147483647; right: 24px; top: 146px; width: 420px; max-height: min(680px, 76vh); overflow: auto; border: 2px solid #2563eb; border-radius: 16px; background: #fff; color:#172b4d; box-shadow: 0 16px 46px #172b4d38; font: 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .publish-review-panel-dock { top: 0; right: 0; bottom: 0; width: min(380px, calc(100vw - 24px)); height: 100dvh; max-height: none; border: 0; border-left: 1px solid #dbe4f0; border-radius: 0; background: #f8fafc; box-shadow: -18px 0 48px #0f172a24; }
    .publish-review-panel-onboarding { border-color: #2563eb; }
    .publish-review-panel-attention { width: 460px; border-color: #ef4444; box-shadow: 0 18px 52px #991b1b45; }
    .publish-review-head { display:flex; align-items:center; justify-content:space-between; gap: 12px; padding: 16px 18px; border-bottom:1px solid #eef2f7; font-size: 16px; font-weight:800; }
    .publish-review-head-attention { color: #b42318; background: #fff5f4; border-bottom-color: #fecaca; }
    .publish-review-close { border:0; background:transparent; color:#7b8ba5; cursor:pointer; font-size:18px; }
    .publish-review-state { padding: 20px 18px; color:#71819a; line-height:1.65; }
    .publish-review-state p { margin: 0 0 12px; }
    .publish-review-state p:last-child { margin-bottom: 0; }
    .publish-review-card { padding: 12px 16px; border-bottom:1px solid #f0f3f8; }
    .publish-review-card:last-child { border-bottom:0; }
    .publish-review-title { font-weight:700; margin-bottom:6px; line-height:1.4; }
    .publish-review-meta { color:#8795aa; font-size:12px; margin-bottom:8px; }
    .publish-review-import { border:1px solid #2563eb; border-radius:6px; padding:5px 10px; background:#eff6ff; color:#1d4ed8; cursor:pointer; }
    .publish-review-confirm { margin: 0 16px 16px; border:0; border-radius:8px; padding:9px 14px; background:#2563eb; color:#fff; font-weight:700; cursor:pointer; }
    .publish-review-note { margin: 10px 18px 16px; color:#8a5a00; background:#fff8e7; padding:10px 12px; border-radius:8px; font-size:12px; line-height:1.55; }
    .publish-review-hero { margin: 16px 18px 0; padding: 14px 14px 13px; border-radius: 10px; color: #174ea6; background: #eff6ff; border: 1px solid #bfdbfe; font-weight: 700; line-height: 1.55; }
    .publish-review-hero strong { display: block; margin-bottom: 4px; color: #155eef; font-size: 16px; }
    .publish-review-alert { margin: 16px 18px 4px; padding: 14px 15px; border-radius: 10px; color: #9b1c1c; background: #fff1f0; border: 1px solid #fda29b; font-weight: 700; line-height: 1.6; }
    .publish-review-alert strong { display: block; margin-bottom: 5px; color: #b42318; font-size: 16px; }
    .publish-review-alert p { margin: 0; font-weight: 600; }
    .publish-review-steps { margin: 12px 18px 6px; padding-left: 22px; color: #526581; line-height: 1.7; }
    .publish-review-steps li { margin: 3px 0; }
    .publish-review-checklist { margin: 2px 18px 14px; padding-left: 22px; color: #344054; font-weight: 600; line-height: 1.7; }
    .publish-review-checklist li { margin: 3px 0; }
    .publish-review-dock-head { display: grid; grid-template-columns: 38px minmax(0,1fr) 30px; align-items: center; gap: 10px; padding: 18px 18px 15px; color: #fff; background: #0f172a; }
    .publish-review-brand-mark { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: #2563eb; color: #fff; font-size: 21px; font-weight: 900; }
    .publish-review-brand-title { margin: 0; font-size: 15px; font-weight: 850; letter-spacing: .01em; }
    .publish-review-brand-subtitle { margin: 3px 0 0; color: #a9b8ce; font-size: 11px; font-weight: 600; }
    .publish-review-dock-head .publish-review-close { color: #b9c5d6; width: 30px; height: 30px; border-radius: 9px; font-size: 20px; }
    .publish-review-dock-head .publish-review-close:hover { color: #fff; background: #ffffff14; }
    .publish-review-dock-body { padding: 16px; }
    .publish-review-route-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; color: #64748b; font-size: 11px; font-weight: 700; }
    .publish-review-route-status strong { color: #1d4ed8; font-size: 12px; }
    .publish-review-route-ticket { position: relative; overflow: hidden; margin-bottom: 14px; border: 1px solid #dbe4f0; border-radius: 14px; background: #fff; box-shadow: 0 8px 24px #0f172a0d; }
    .publish-review-route-ticket::before, .publish-review-route-ticket::after { content: ""; position: absolute; top: 63px; width: 16px; height: 16px; border: 1px solid #dbe4f0; border-radius: 50%; background: #f8fafc; }
    .publish-review-route-ticket::before { left: -9px; }
    .publish-review-route-ticket::after { right: -9px; }
    .publish-review-ticket-label { padding: 13px 16px 10px; color: #64748b; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .publish-review-ticket-title { margin: 0; padding: 0 16px 15px; color: #0f172a; font-size: 15px; font-weight: 850; line-height: 1.45; }
    .publish-review-ticket-copy { margin: 0; padding: 13px 16px 15px; border-top: 1px dashed #cbd5e1; color: #64748b; font-size: 12px; line-height: 1.6; }
    .publish-review-flow { margin: 0 0 14px; padding: 5px 14px; border: 1px solid #dbe4f0; border-radius: 14px; background: #fff; list-style: none; }
    .publish-review-flow li { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 10px; align-items: start; padding: 10px 0; border-bottom: 1px solid #eef2f7; color: #475569; font-size: 12px; line-height: 1.5; }
    .publish-review-flow li:last-child { border-bottom: 0; }
    .publish-review-step-dot { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #e2e8f0; color: #64748b; font-size: 10px; font-weight: 900; }
    .publish-review-flow .is-done .publish-review-step-dot { background: #dcfce7; color: #047857; }
    .publish-review-flow .is-active { color: #0f172a; font-weight: 750; }
    .publish-review-flow .is-active .publish-review-step-dot { background: #2563eb; color: #fff; box-shadow: 0 0 0 4px #dbeafe; }
    .publish-review-dock-callout { margin-bottom: 14px; padding: 13px 14px; border-radius: 12px; background: #eff6ff; color: #1e40af; font-size: 12px; font-weight: 650; line-height: 1.6; }
    .publish-review-dock-callout.is-warning { border: 1px solid #fed7aa; background: #fff7ed; color: #9a3412; }
    .publish-review-dock-actions { display: grid; gap: 8px; }
    .publish-review-dock-primary, .publish-review-dock-secondary { width: 100%; min-height: 42px; border-radius: 10px; padding: 9px 12px; font-weight: 800; cursor: pointer; }
    .publish-review-dock-primary { border: 0; background: #0f172a; color: #fff; }
    .publish-review-dock-primary:disabled { cursor: wait; opacity: .65; }
    .publish-review-dock-secondary { border: 1px solid #cbd5e1; background: #fff; color: #475569; }
    .publish-review-dock-footnote { margin: 12px 2px 0; color: #94a3b8; font-size: 10px; line-height: 1.55; }
    @media (max-width: 820px) { .publish-review-panel-dock { top: 12px; right: 12px; bottom: 12px; width: calc(100vw - 24px); height: auto; max-height: calc(100dvh - 24px); border: 1px solid #dbe4f0; border-radius: 16px; } }
  `;
  shadow.append(style);
  document.documentElement.appendChild(root);

  const button = document.createElement("button");
  button.className = platform === "xiaohongshu" ? "publish-review-button publish-review-button-attention" : "publish-review-button";
  button.textContent = "导入当前方案";
  button.style.display = pendingHandoff && isPublishPage() ? "block" : "none";
  shadow.append(button);

  const closePanel = () => {
    shadow.querySelector(".publish-review-panel")?.remove();
    button.style.display = pendingHandoff && isPublishPage() ? "block" : "none";
  };
  const showPanel = (html: string, panelClass = "") => {
    shadow.querySelector(".publish-review-panel")?.remove();
    const panel = document.createElement("section");
    panel.className = `publish-review-panel publish-review-panel-dock${panelClass ? ` ${panelClass}` : ""}`;
    panel.innerHTML = html;
    shadow.append(panel);
    button.style.display = "none";
    panel.querySelector(".publish-review-close")?.addEventListener("click", closePanel);
    panel.querySelector("[data-return-app]")?.addEventListener("click", () => {
      void chrome.runtime.sendMessage({ type: "RETURN_TO_SAAS", returnTarget: handoffReturnTarget }).catch(() => undefined);
    });
    return panel;
  };

  const showPublishedSuccessNotice = () => {
    if (!isPublishedResultPage() || shadow.querySelector(".publish-review-panel")) return;
    const platformLabel = platform === "douyin" ? "抖音" : "小红书";
    const successBody = `
      <ol class="publish-review-flow">
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li>
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>素材与文案已发布</span></li>
        <li class="is-active"><span class="publish-review-step-dot">03</span><span>正在读取作品信息并返回作品复盘</span></li>
      </ol>
      <div class="publish-review-state publish-review-dock-callout">请保持当前页面在前台，助手正在读取${platformLabel}公开可见的作品链接和数据。</div>
      <div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-open-saas-review>若未自动返回，手动进入作品复盘</button></div>
      <p class="publish-review-dock-footnote">系统不会读取或保存${platformLabel}账号凭据。</p>`;
    const panel = showPanel(creatorAssistantFrame("正在回盘", successBody));
    panel.querySelector("[data-open-saas-review]")?.addEventListener("click", () => openSaasReview(findPublishedWorkUrl() || undefined));
    return panel;
  };

  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));

  const creatorAssistantFrame = (status: string, body: string) => {
    const platformLabel = platform === "douyin" ? "抖音" : "小红书";
    return `
    <header class="publish-review-dock-head">
      <span class="publish-review-brand-mark" aria-hidden="true">✦</span>
      <div><p class="publish-review-brand-title">PublishLoop</p><p class="publish-review-brand-subtitle">${platformLabel}官方发布页 · 当前标签协作</p></div>
      <button class="publish-review-close" type="button" aria-label="收起 PublishLoop">×</button>
    </header>
    <div class="publish-review-dock-body">
      <div class="publish-review-route-status"><span>发布应用 → ${platformLabel} → 作品复盘</span><strong>${escapeHtml(status)}</strong></div>
      ${body}
    </div>`;
  };

  const setContentEditableText = (element: HTMLElement, value: string) => {
    element.focus();
    // 小红书编辑器使用 contenteditable/ProseMirror 时，直接写 textContent
    // 不一定会同步编辑器内部状态。优先走浏览器原生输入命令，再用 DOM
    // 写入作为兼容回退；抖音仍沿用原来的事件路径。
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

  const candidates = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.closest("[aria-hidden='true']");
  });

  const findByHint = (hints: RegExp, selectors: string) => candidates(selectors).find((element) => hints.test(`${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-placeholder") || ""}`));
  const textControls = "input,textarea,[contenteditable='true'],[role='textbox']";
  const findTitle = () => (platform === "douyin" && candidates("input[placeholder='添加作品标题']")[0])
    || findByHint(/标题|笔记标题|作品标题|填写标题/i, textControls)
    || candidates("input[type='text'], textarea,[contenteditable='true'],[role='textbox']")[0];
  const findBody = () => {
    if (platform === "douyin") {
      const douyinBody = candidates("[data-zone-container='*'][contenteditable='true'],.editor-kit-container[data-slate-editor='true']")[0];
      if (douyinBody) return douyinBody;
    }
    // 小红书发布页的正文编辑器会随版本切换为 ProseMirror、普通
    // contenteditable 或 textarea，优先按平台常见结构查找，避免把标题输入框当正文。
    if (platform === "xiaohongshu") {
      const title = findTitle();
      const xhsBody = candidates([
        "[contenteditable='true']",
        ".ProseMirror",
        ".ql-editor",
        "textarea[placeholder*='正文']",
        "textarea[placeholder*='描述']",
        "textarea[placeholder*='内容']",
        "[role='textbox']",
      ].join(",")).find((element) => element !== title);
      if (xhsBody) return xhsBody;
    }
    return findByHint(/正文|描述|内容|说点什么|添加文字|填写正文|输入正文/i, textControls)
      || candidates(textControls).find((element) => element !== findTitle());
  };

  const fillDraft = (draft: Draft) => {
    const title = findTitle();
    const body = findBody();
    if (title) setText(title, draft.title);
    // 方案输出阶段已经按平台限制整理好正文和末尾话题，插件不再截断或重排。
    if (body) setText(body, draft.content);
    return { title: Boolean(title), body: Boolean(body), topic: Boolean(body && draft.tags.length > 0) };
  };

  type XhsFlowStage = "idle" | "menu-opened" | "upload-opened" | "asset-picker-opened" | "awaiting-confirmation" | "published";
  let xhsFlowStage: XhsFlowStage = "idle";
  let xhsFilledDraft: Draft | null = null;
  type DouyinFlowStage = "idle" | "asset-picker-opened" | "awaiting-confirmation" | "published";
  let douyinFlowStage: DouyinFlowStage = "idle";
  let douyinFilledDraft: Draft | null = null;
  let douyinAdvanceTimer: number | null = null;
  let xhsLastActionAt = 0;
  let xhsLastActionElement: HTMLElement | null = null;
  let xhsAdvanceTimer: number | null = null;

  const normalizedActionText = (value: string) => value.replace(/\s+/g, "").trim();
  const xhsActionLabels = (element: HTMLElement) => [
    normalizedActionText(element.textContent || ""),
    normalizedActionText(element.getAttribute("aria-label") || ""),
    normalizedActionText(element.getAttribute("title") || ""),
  ].filter(Boolean);
  const findXhsAction = (pattern: RegExp) => candidates("button,[role='button'],[role='menuitem'],[role='tab'],a,li,div,span")
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return !(element as HTMLButtonElement).disabled
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && xhsActionLabels(element).some((label) => pattern.test(label));
    })
    // 小红书会让外层容器和内部文本节点同时拥有相同 textContent；优先点最深层节点，
    // 让 click 事件沿 DOM 冒泡到真正绑定菜单行为的 .btn-wrapper/.creator-tab。
    .sort((left, right) => {
      const depth = (element: HTMLElement) => {
        let current: HTMLElement | null = element;
        let value = 0;
        while (current?.parentElement) {
          value += 1;
          current = current.parentElement;
        }
        return value;
      };
      return depth(right) - depth(left);
    })[0];

  const xhsClickableTarget = (element: HTMLElement) => element.closest<HTMLElement>("button,[role='button'],[role='menuitem'],.btn-wrapper,.creator-tab,a,li") || element;

  const requestTrustedXhsClick = (element: HTMLElement, target: "coordinate" | "final-publish" = "coordinate") => {
    const clickable = xhsClickableTarget(element);
    const rect = clickable.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    // CDP 坐标点击会命中页面最上层元素；发送点击前暂时隐藏右侧助手，
    // 避免全高侧栏覆盖小红书的上传或最终发布按钮。
    const assistantPanel = shadow.querySelector<HTMLElement>(".publish-review-panel");
    const previousDisplay = assistantPanel?.style.display || "";
    if (assistantPanel) assistantPanel.style.display = "none";
    const restoreAssistantPanel = () => {
      if (assistantPanel?.isConnected) assistantPanel.style.display = previousDisplay;
    };
    void chrome.runtime.sendMessage({
      type: "XHS_TRUSTED_CLICK",
      target,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }).then((response) => {
      if (response?.ok) return;
      console.warn("[PublishLoop] 小红书受信任点击失败", response?.error || "未知错误");
      if (String(xhsFlowStage) === "awaiting-confirmation") {
        showPanel(`<div class="publish-review-head"><span>平台未响应</span><button class="publish-review-close">×</button></div><div class="publish-review-state">浏览器调试点击没有执行成功，请关闭小红书标签页的 DevTools、保持页面在前台，然后直接点击页面底部的“发布”按钮。</div>`);
        return;
      }
      if (String(xhsFlowStage) !== "awaiting-confirmation" && String(xhsFlowStage) !== "published") {
        xhsLastActionElement = null;
        xhsFlowStage = "upload-opened";
        showPanel(`<div class="publish-review-head"><span>需要重试上传</span><button class="publish-review-close">×</button></div><div class="publish-review-state">受信任点击没有执行成功。请关闭小红书标签页的 DevTools，保持该标签页在前台后，再点击页面上的“上传图片”；选图后插件仍会继续自动填充。</div>`);
      }
    }).catch((error) => {
      console.warn("[PublishLoop] 小红书受信任点击请求失败", error);
      if (String(xhsFlowStage) === "awaiting-confirmation") {
        showPanel(`<div class="publish-review-head"><span>平台未响应</span><button class="publish-review-close">×</button></div><div class="publish-review-state">浏览器调试点击没有执行成功，请关闭小红书标签页的 DevTools、保持页面在前台，然后直接点击页面底部的“发布”按钮。</div>`);
        return;
      }
      if (String(xhsFlowStage) !== "awaiting-confirmation" && String(xhsFlowStage) !== "published") {
        xhsLastActionElement = null;
        xhsFlowStage = "upload-opened";
      }
    }).finally(restoreAssistantPanel);
    return true;
  };

  const clickXhsAction = (element: HTMLElement, trusted = false) => {
    const clickable = xhsClickableTarget(element);
    const now = Date.now();
    // 防止 MutationObserver 对同一个按钮重复触发，但允许“发布笔记”后
    // 紧接着点击另一个“上传图片”按钮。
    if (clickable === xhsLastActionElement && now - xhsLastActionAt < 700) return false;
    xhsLastActionAt = now;
    xhsLastActionElement = clickable;
    if (trusted) return requestTrustedXhsClick(clickable);
    // 某些版本不是监听 click，而是监听 pointer/mouse 事件；按真实点击顺序
    // 派发一组可冒泡事件，最后再调用 click 作为兼容回退。
    try {
      clickable.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, view: window }));
      clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, view: window }));
      clickable.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, view: window }));
      clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true, view: window }));
    } catch {
      // 老浏览器不支持 PointerEvent 时仍继续调用 click。
    }
    clickable.click();
    return true;
  };

  const finalXhsPublishButtons = () => candidates("button,[role='button'],[role='tab'],a,li,div,span")
    .filter((element) => xhsActionLabels(element).some((label) => label === "发布") && !(element as HTMLButtonElement).disabled)
    // 小红书通常是 button 内嵌 span；只保留最内层节点，避免同一个按钮被算成多个候选。
    .filter((element) => !element.parentElement || !xhsActionLabels(element.parentElement).some((label) => label === "发布"));

  // 最终发布按钮位于小红书的 closed shadow root 内，普通 querySelector 无法穿透；
  // 只能先定位承载该按钮的自定义元素，再通过 composed click 请求平台组件处理。
  const finalXhsPublishHosts = () => candidates("xhs-publish-btn[submit-text='发布']");

  const readEditorText = (element: HTMLElement | undefined) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value.trim()
    : (element?.textContent || "").trim();

  const renderXhsPublishConfirmation = () => {
    xhsFlowStage = "awaiting-confirmation";
    button.style.display = "none";
    const reviewTitle = escapeHtml((xhsFilledDraft?.title || "当前发布应用方案").slice(0, 90));
    const panel = showPanel(creatorAssistantFrame("发布前核对", `
      <article class="publish-review-route-ticket">
        <div class="publish-review-ticket-label">当前发布内容</div>
        <h2 class="publish-review-ticket-title">${reviewTitle}</h2>
        <p class="publish-review-ticket-copy">文案已填入小红书编辑器，请以官方页面中的最终预览为准。</p>
      </article>
      <ol class="publish-review-flow">
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li>
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>图片与文案已准备</span></li>
        <li class="is-active"><span class="publish-review-step-dot">03</span><span>检查标题、正文、图片顺序和账号设置</span></li>
      </ol>
      <div class="publish-review-state publish-review-dock-callout is-warning">确认后将触发小红书官方“发布”按钮。发布过程中请勿重复点击、刷新或关闭当前页面。</div>
      <div class="publish-review-dock-actions">
        <button class="publish-review-dock-primary" data-confirm-publish>确认并发布</button>
        <button class="publish-review-dock-secondary" data-return-app>返回发布应用</button>
      </div>
      <p class="publish-review-dock-footnote">发布应用只接收公开作品信息和页面可见指标，不保存平台账号凭据。</p>`), "publish-review-panel-attention");
    const confirmButton = panel.querySelector<HTMLButtonElement>("[data-confirm-publish]");
    confirmButton?.addEventListener("click", async () => {
      const title = findTitle();
      const body = findBody();
      const publishHosts = finalXhsPublishHosts();
      const publishButtons = publishHosts.length ? publishHosts : finalXhsPublishButtons();
      if (!xhsFilledDraft || !title || !body || !readEditorText(title) || !readEditorText(body)) {
        panel.querySelector(".publish-review-state")!.textContent = "标题或正文还没有准备完成，请检查编辑页后再确认发布。";
        return;
      }
      if (publishButtons.length !== 1) {
        panel.querySelector(".publish-review-state")!.textContent = publishButtons.length === 0
          ? "暂时没有找到可用的最终“发布”按钮，请确认仍在小红书图文编辑页。"
          : "页面上出现了多个“发布”按钮，为避免误发，插件已停止，请手动点击最终发布。";
        return;
      }
      const workUrlBeforePublish = findPublishedWorkUrl();
      const reviewTitle = readEditorText(title) || xhsFilledDraft.title;
      confirmButton.disabled = true;
      try {
        await registerReviewHandoff(workUrlBeforePublish, reviewTitle);
      } catch (error) {
        confirmButton.disabled = false;
        panel.querySelector(".publish-review-state")!.textContent = error instanceof Error
          ? error.message
          : "无法记录发布结果接力状态，请稍后重试。";
        return;
      }
      beginReviewResolution(reviewTitle);
      if (publishHosts.length === 1) {
        requestTrustedXhsClick(publishHosts[0], "final-publish");
      } else {
        publishButtons[0]?.click();
      }
      xhsFlowStage = "published";
      pendingHandoff = null;
      xhsFilledDraft = null;
      clearStoredDraft();
      try {
        sessionStorage.removeItem(handoffRefreshKey);
      } catch {
        // 忽略标记清理失败，不影响小红书处理发布请求。
      }
      reviewOpenRequested.value = false;
      panel.innerHTML = creatorAssistantFrame("正在回盘", `<ol class="publish-review-flow"><li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li><li class="is-done"><span class="publish-review-step-dot">✓</span><span>发布请求已提交</span></li><li class="is-active"><span class="publish-review-step-dot">03</span><span>正在读取作品信息并返回作品复盘</span></li></ol><div class="publish-review-state publish-review-dock-callout">请保持当前页面在前台，助手正在完成作品复盘接力。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-open-saas-review>若未自动返回，手动进入作品复盘</button></div>`);
      panel.querySelector(".publish-review-close")?.addEventListener("click", closePanel);
      panel.querySelector("[data-open-saas-review]")?.addEventListener("click", () => openSaasReview(findPublishedWorkUrl() || undefined));
      waitForPublishedWorkUrl(panel, workUrlBeforePublish);
    });
  };

  const advanceXhsPublishFlow = () => {
    if (platform !== "xiaohongshu" || !pendingHandoff || xhsFlowStage === "awaiting-confirmation" || xhsFlowStage === "published") return;

    const title = findTitle();
    const body = findBody();
    if (title && body && xhsFlowStage === "asset-picker-opened") {
      const result = fillDraft(pendingHandoff);
      if (result.title && result.body) {
        xhsFilledDraft = pendingHandoff;
        renderXhsPublishConfirmation();
        return;
      }
    }

    const publishMenuAction = findXhsAction(/^发布笔记$/);
    if (publishMenuAction && xhsFlowStage === "idle" && clickXhsAction(publishMenuAction)) {
      xhsFlowStage = "menu-opened";
      scheduleXhsAdvance();
      return;
    }

    // 菜单展开后优先点击真实的“上传图片”入口；部分版本会先进入“上传图文”页，
    // 再由下一轮点击页面中央的“上传图片”打开本地文件选择器。
    if (xhsFlowStage === "menu-opened") {
      const directUploadImage = findXhsAction(/^上传图片$/);
      if (directUploadImage && clickXhsAction(directUploadImage, true)) {
        xhsFlowStage = "asset-picker-opened";
        button.textContent = "请选择搭配图片";
        button.setAttribute("aria-label", "请选择搭配图片");
        scheduleXhsAdvance();
        return;
      }
      const uploadTab = findXhsAction(/^上传图文$/);
      if (uploadTab && clickXhsAction(uploadTab)) {
        xhsFlowStage = "upload-opened";
        scheduleXhsAdvance();
        return;
      }
    }

    if (xhsFlowStage === "upload-opened") {
      const uploadImage = findXhsAction(/^上传图片$/);
      if (uploadImage && clickXhsAction(uploadImage, true)) {
        xhsFlowStage = "asset-picker-opened";
        button.textContent = "请选择搭配图片";
        button.setAttribute("aria-label", "请选择搭配图片");
        scheduleXhsAdvance();
      }
    }
  };

  const scheduleXhsAdvance = () => {
    if (platform !== "xiaohongshu" || xhsAdvanceTimer !== null) return;
    xhsAdvanceTimer = window.setTimeout(() => {
      xhsAdvanceTimer = null;
      advanceXhsPublishFlow();
    }, 250);
  };

  const douyinActionLabels = (element: HTMLElement) => [
    normalizedActionText(element.textContent || ""),
    normalizedActionText(element.getAttribute("aria-label") || ""),
    normalizedActionText(element.getAttribute("title") || ""),
  ].filter(Boolean);
  const findDouyinAction = (pattern: RegExp) => candidates("button,[role='button'],[role='tab'],a,div,span")
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return !(element as HTMLButtonElement).disabled
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && douyinActionLabels(element).some((label) => pattern.test(label));
    })
    .sort((left, right) => {
      const depth = (element: HTMLElement) => {
        let current: HTMLElement | null = element;
        let value = 0;
        while (current?.parentElement) {
          value += 1;
          current = current.parentElement;
        }
        return value;
      };
      return depth(right) - depth(left);
    })[0];

  const requestTrustedDouyinClick = (element: HTMLElement) => {
    const clickable = element.closest<HTMLElement>("button,[role='button'],a") || element;
    const rect = clickable.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    void chrome.runtime.sendMessage({
      type: "DOUYIN_TRUSTED_CLICK",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }).then((response) => {
      if (response?.ok) return;
      console.warn("[PublishLoop] 抖音受信任点击失败", response?.error || "未知错误");
      douyinFlowStage = "asset-picker-opened";
      showDouyinOnboardingPanel();
    }).catch((error) => {
      console.warn("[PublishLoop] 抖音受信任点击请求失败", error);
      douyinFlowStage = "asset-picker-opened";
    });
    return true;
  };

  const finalDouyinPublishButtons = () => candidates("button,[role='button'],a,div,span")
    .filter((element) => douyinActionLabels(element).some((label) => label === "发布") && !(element as HTMLButtonElement).disabled)
    .filter((element) => !element.parentElement || !douyinActionLabels(element.parentElement).some((label) => label === "发布"));

  const renderDouyinPublishConfirmation = () => {
    douyinFlowStage = "awaiting-confirmation";
    button.style.display = "none";
    const reviewTitle = escapeHtml((douyinFilledDraft?.title || "当前发布应用方案").slice(0, 90));
    const panel = showPanel(creatorAssistantFrame("发布前核对", `
      <article class="publish-review-route-ticket">
        <div class="publish-review-ticket-label">当前发布内容</div>
        <h2 class="publish-review-ticket-title">${reviewTitle}</h2>
        <p class="publish-review-ticket-copy">文案已填入抖音编辑器，请以官方页面中的最终预览为准。</p>
      </article>
      <ol class="publish-review-flow">
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li>
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>图片与文案已准备</span></li>
        <li class="is-active"><span class="publish-review-step-dot">03</span><span>检查标题、正文、图片顺序和账号设置</span></li>
      </ol>
      <div class="publish-review-state publish-review-dock-callout is-warning">确认后将触发抖音官方“发布”按钮。发布过程中请勿重复点击、刷新或关闭当前页面。</div>
      <div class="publish-review-dock-actions">
        <button class="publish-review-dock-primary" data-confirm-publish>确认并发布</button>
        <button class="publish-review-dock-secondary" data-return-app>返回发布应用</button>
      </div>
      <p class="publish-review-dock-footnote">发布应用只接收公开作品信息和页面可见指标，不保存平台账号凭据。</p>`));
    const confirmButton = panel.querySelector<HTMLButtonElement>("[data-confirm-publish]");
    confirmButton?.addEventListener("click", async () => {
      const title = findTitle();
      const body = findBody();
      const publishButtons = finalDouyinPublishButtons();
      if (!douyinFilledDraft || !title || !body || !readEditorText(title) || !readEditorText(body)) {
        panel.querySelector(".publish-review-state")!.textContent = "标题或正文还没有准备完成，请检查抖音编辑页后再确认发布。";
        return;
      }
      if (publishButtons.length !== 1) {
        panel.querySelector(".publish-review-state")!.textContent = publishButtons.length === 0
          ? "暂时没有找到抖音最终的“发布”按钮，请确认仍在图文编辑页。"
          : "页面上出现了多个“发布”按钮，为避免误发，插件已停止，请手动点击最终发布。";
        return;
      }
      const workUrlBeforePublish = findPublishedWorkUrl();
      const reviewTitle = readEditorText(title) || douyinFilledDraft.title;
      confirmButton.disabled = true;
      try {
        await registerReviewHandoff(workUrlBeforePublish, reviewTitle);
      } catch (error) {
        confirmButton.disabled = false;
        panel.querySelector(".publish-review-state")!.textContent = error instanceof Error
          ? error.message
          : "无法记录发布结果接力状态，请稍后重试。";
        return;
      }
      beginReviewResolution(reviewTitle);
      publishButtons[0]?.click();
      douyinFlowStage = "published";
      pendingHandoff = null;
      douyinFilledDraft = null;
      clearStoredDraft();
      reviewOpenRequested.value = false;
      panel.innerHTML = creatorAssistantFrame("正在回盘", `<ol class="publish-review-flow"><li class="is-done"><span class="publish-review-step-dot">✓</span><span>当前方案已导入</span></li><li class="is-done"><span class="publish-review-step-dot">✓</span><span>发布请求已提交</span></li><li class="is-active"><span class="publish-review-step-dot">03</span><span>正在读取作品信息并返回作品复盘</span></li></ol><div class="publish-review-state publish-review-dock-callout">请保持当前页面在前台，助手正在完成作品复盘接力。</div><div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-open-saas-review>若未自动返回，手动进入作品复盘</button></div>`);
      panel.querySelector(".publish-review-close")?.addEventListener("click", closePanel);
      panel.querySelector("[data-open-saas-review]")?.addEventListener("click", () => openSaasReview(findPublishedWorkUrl() || undefined));
      waitForPublishedWorkUrl(panel, workUrlBeforePublish);
    });
  };

  const advanceDouyinPublishFlow = () => {
    if (platform !== "douyin" || !pendingHandoff || douyinFlowStage === "awaiting-confirmation" || douyinFlowStage === "published") return;
    const title = findTitle();
    const body = findBody();
    if (title && body && douyinFlowStage === "asset-picker-opened") {
      const result = fillDraft(pendingHandoff);
      if (result.title && result.body) {
        douyinFilledDraft = pendingHandoff;
        renderDouyinPublishConfirmation();
        return;
      }
    }
    if (douyinFlowStage === "idle") {
      const uploadAction = findDouyinAction(/^上传图文$/);
      if (uploadAction && requestTrustedDouyinClick(uploadAction)) {
        douyinFlowStage = "asset-picker-opened";
        button.textContent = "请选择搭配图片";
        button.setAttribute("aria-label", "请选择搭配图片");
      }
    }
  };

  const scheduleDouyinAdvance = () => {
    if (platform !== "douyin" || douyinAdvanceTimer !== null) return;
    douyinAdvanceTimer = window.setTimeout(() => {
      douyinAdvanceTimer = null;
      advanceDouyinPublishFlow();
    }, 250);
  };

  const renderDrafts = (panel: HTMLElement, drafts: Draft[]) => {
    const list = panel.querySelector("[data-list]");
    if (!list) return;
    if (!drafts.length) {
      list.innerHTML = `<div class="publish-review-state">没有收到发布应用当前方案。请返回发布应用方案输出，点击“去发布”后再打开此页面。</div>`;
      return;
    }
    list.innerHTML = drafts.map((draft, index) => `<article class="publish-review-card"><div class="publish-review-title">${escapeHtml(draft.title || "未命名草稿")}</div><div class="publish-review-meta">${escapeHtml(draft.product_name || "游客向发布文案")} · ${draft.updated_at ? escapeHtml(new Date(draft.updated_at).toLocaleString()) : "最近更新"}</div><button class="publish-review-import" data-index="${index}">导入这条</button></article>`).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-index]").forEach((importButton) => importButton.addEventListener("click", () => {
      const draft = drafts[Number(importButton.dataset.index)];
      if (!draft) return;
      const result = fillDraft(draft);
      if (!result.title || !result.body) {
        const missingFields = [!result.title ? "标题输入框" : "", !result.body ? "正文编辑器" : ""].filter(Boolean).join("、");
        button.style.display = "block";
        panel.innerHTML = `<div class="publish-review-head"><span>页面还在加载</span><button class="publish-review-close">×</button></div><div class="publish-review-state">暂时未找到${missingFields}。请等待小红书编辑器加载完成后，再点击“导入当前方案”；方案仍会保留，不会丢失。</div>`;
        panel.querySelector(".publish-review-close")?.addEventListener("click", closePanel);
        return;
      }
      pendingHandoff = null;
      clearStoredDraft();
      try {
        sessionStorage.removeItem(handoffRefreshKey);
      } catch {
        // 忽略标记清理失败，不影响平台内手动发布。
      }
      button.style.display = "none";
      panel.innerHTML = `<div class="publish-review-head"><span>导入完成</span><button class="publish-review-close">×</button></div><div class="publish-review-state">${result.title ? "标题" : "未找到标题输入框"}、${result.body ? "正文" : "未找到正文输入框"}、${result.topic ? "话题" : "未找到话题输入框"}已处理。视频请手动选择，插件不会点击最终发布按钮。</div><div class="publish-review-note">请在平台页面检查内容和素材，确认无误后由你手动发布。</div>`;
      panel.querySelector(".publish-review-close")?.addEventListener("click", closePanel);
    }));
  };

  const showXhsOnboardingPanel = () => {
    const currentTitle = escapeHtml((pendingHandoff?.title || "当前发布应用方案").slice(0, 90));
    const currentCopy = escapeHtml((pendingHandoff?.content || "文案已安全带入当前标签").replace(/\s+/g, " ").slice(0, 88));
    showPanel(creatorAssistantFrame("选择素材", `
      <article class="publish-review-route-ticket">
        <div class="publish-review-ticket-label">当前方案</div>
        <h2 class="publish-review-ticket-title">${currentTitle}</h2>
        <p class="publish-review-ticket-copy">${currentCopy}${(pendingHandoff?.content.length || 0) > 88 ? "…" : ""}</p>
      </article>
      <ol class="publish-review-flow">
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>发布应用文案已安全带入当前标签</span></li>
        <li class="is-active"><span class="publish-review-step-dot">02</span><span>在系统文件窗口中选择本次作品图片</span></li>
        <li><span class="publish-review-step-dot">03</span><span>检查文案与平台设置后确认发布</span></li>
      </ol>
      <div class="publish-review-dock-callout">助手只负责打开图片选择窗口和填入文案，不会读取、上传或替你选择本地素材。</div>
      <div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div>
      <p class="publish-review-dock-footnote">请关闭当前标签页的 DevTools，并保持小红书在前台；发布前助手会再次请求确认。</p>`), "publish-review-panel-onboarding");
  };

  const showDouyinOnboardingPanel = () => {
    const currentTitle = escapeHtml((pendingHandoff?.title || "当前发布应用方案").slice(0, 90));
    const currentCopy = escapeHtml((pendingHandoff?.content || "文案已安全带入当前标签").replace(/\s+/g, " ").slice(0, 88));
    showPanel(creatorAssistantFrame("选择素材", `
      <article class="publish-review-route-ticket">
        <div class="publish-review-ticket-label">当前方案</div>
        <h2 class="publish-review-ticket-title">${currentTitle}</h2>
        <p class="publish-review-ticket-copy">${currentCopy}${(pendingHandoff?.content.length || 0) > 88 ? "…" : ""}</p>
      </article>
      <ol class="publish-review-flow">
        <li class="is-done"><span class="publish-review-step-dot">✓</span><span>发布应用文案已安全带入当前标签</span></li>
        <li class="is-active"><span class="publish-review-step-dot">02</span><span>在系统文件窗口中选择本次作品图片</span></li>
        <li><span class="publish-review-step-dot">03</span><span>检查文案与平台设置后确认发布</span></li>
      </ol>
      <div class="publish-review-dock-callout">助手只负责打开图片选择窗口和填入文案，不会读取、上传或替你选择本地素材。</div>
      <div class="publish-review-dock-actions"><button class="publish-review-dock-secondary" data-return-app>返回发布应用</button></div>
      <p class="publish-review-dock-footnote">选图完成后请回到抖音编辑页；发布前助手会再次请求确认。</p>`), "publish-review-panel-onboarding");
  };

  button.addEventListener("click", () => {
    if (platform === "xiaohongshu") {
      if (xhsFlowStage === "awaiting-confirmation") {
        renderXhsPublishConfirmation();
        return;
      }
      // 进入系统文件窗口后，按钮仍会留在页面右侧；同步改成当前动作提示，
      // 避免用户误以为需要再次导入方案或重复触发上传流程。
      button.textContent = "请选择搭配图片";
      button.setAttribute("aria-label", "请选择搭配图片");
      scheduleXhsAdvance();
      showXhsOnboardingPanel();
      return;
    }
    if (platform === "douyin") {
      if (douyinFlowStage === "awaiting-confirmation") {
        renderDouyinPublishConfirmation();
        return;
      }
      button.textContent = "请选择搭配图片";
      button.setAttribute("aria-label", "请选择搭配图片");
      scheduleDouyinAdvance();
      showDouyinOnboardingPanel();
      return;
    }
    const panel = showPanel(`<div class="publish-review-head"><span>导入当前方案</span><button class="publish-review-close">×</button></div><div data-list class="publish-review-state">正在准备当前方案…</div>`);
    const list = panel.querySelector("[data-list]");
    if (!list) return;
    if (!pendingHandoff) {
      list.innerHTML = `<div class="publish-review-state">请返回发布应用方案输出，点击当前方案的“去发布”后再打开此页面。</div>`;
      return;
    }
    list.innerHTML = `<div class="publish-review-state">这是刚刚从发布应用带来的当前方案，只导入这一条内容。</div>`;
    renderDrafts(panel, [pendingHandoff]);
  });

  let previousPath = location.href;
  new MutationObserver(() => {
    if (location.href !== previousPath) {
      previousPath = location.href;
      completeReviewHandoffIfDetected();
      button.style.display = pendingHandoff && isPublishPage() ? "block" : "none";
      // 发布成功后的平台页面通常通过 SPA 路由切换；保留成功提示面板，
      // 让用户在看板识别和返回发布应用期间持续看到接力状态。
      if (!isPublishedResultPage() && xhsFlowStage !== "published" && douyinFlowStage !== "published") {
        closePanel();
      }
      if (isPublishedResultPage()) showPublishedSuccessNotice();
    }
    if (isReviewResolutionActive() || xhsFlowStage === "published" || douyinFlowStage === "published") {
      scheduleReviewHandoffCheck();
    }
      if (platform === "xiaohongshu") scheduleXhsAdvance();
      if (platform === "douyin") scheduleDouyinAdvance();
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (platform === "xiaohongshu") {
    scheduleXhsAdvance();
    // 从发布应用跳转到小红书后立即展示操作提示，不要求用户先寻找右上角按钮。
    // 文件选择窗口仍由用户亲自完成，面板只负责说明流程和接力注意事项。
    if (pendingHandoff && isPublishPage()) {
      window.setTimeout(() => {
        if (!shadow.querySelector(".publish-review-panel") && xhsFlowStage !== "awaiting-confirmation" && xhsFlowStage !== "published") {
          showXhsOnboardingPanel();
        }
      }, 450);
    }
  }
  if (platform === "douyin") {
    scheduleDouyinAdvance();
    if (pendingHandoff && isPublishPage()) {
      window.setTimeout(() => {
        if (!shadow.querySelector(".publish-review-panel") && douyinFlowStage !== "awaiting-confirmation" && douyinFlowStage !== "published") {
          showDouyinOnboardingPanel();
        }
      }, 450);
    }
  }
  // 完整页面跳转会重新注入内容脚本；只要本次发布接力状态仍有效，就恢复成功提示。
  readReviewResolutionState();
  if (reviewResolutionState.startedAt > 0 && Date.now() - reviewResolutionState.startedAt <= 60_000) {
    showPublishedSuccessNotice();
  }
  if (isReviewResolutionActive()) {
    scheduleReviewHandoffCheck();
  }
})();
