const PLATFORM_URLS = {
  douyin: "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
  xiaohongshu: "https://creator.xiaohongshu.com/publish",
  weibo: "https://weibo.com/",
};

function encode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)));
}

document.querySelectorAll("[data-platform]").forEach((button) => button.addEventListener("click", () => {
  const platform = button.dataset.platform;
  const url = new URL(PLATFORM_URLS[platform]);
  const payload = {
    version: 1,
    source: "publish-review-demo",
    platform,
    returnTarget: "workspace",
    title: document.querySelector("#title").value.trim(),
    content: document.querySelector("#content").value.trim(),
    tags: document.querySelector("#tags").value.split(",").map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean),
  };
  url.hash = `publish_review_draft=${encodeURIComponent(encode(JSON.stringify(payload)))}`;
  location.href = url.toString();
}));

const receiptValue = new URLSearchParams(location.hash.replace(/^#/, "")).get("publication_receipt");
if (receiptValue) {
  try {
    const receipt = JSON.parse(decode(receiptValue));
    document.querySelector("#receipt").hidden = false;
    document.querySelector("#receipt-json").textContent = JSON.stringify(receipt, null, 2);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    document.querySelector("#receipt").scrollIntoView({ behavior: "smooth" });
  } catch {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

const result = document.querySelector("#review-result");
const show = (state, title, text) => {
  result.className = `result ${state}`;
  const paragraph = result.querySelector("p");
  const strong = document.createElement("strong");
  strong.textContent = title;
  paragraph.replaceChildren(strong, document.createElement("br"), document.createTextNode(text));
};

async function poll(base, jobId) {
  for (let count = 0; count < 30; count += 1) {
    const response = await fetch(`${base}/api/v1/review-fetch-jobs/${jobId}`);
    const job = await response.json();
    if (job.status === "success") return job.review;
    if (job.status === "failure") throw new Error(job.error || "查询失败");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("查询仍在进行，请稍后刷新任务状态");
}

document.querySelector("#lookup").addEventListener("click", async () => {
  const base = document.querySelector("#api-base").value.replace(/\/+$/, "");
  const platform = document.querySelector("#review-platform").value;
  const value = document.querySelector("#work-value").value.trim();
  if (!value) return show("error", "缺少作品链接", "请输入作品官方链接或 ID");
  show("loading", "正在创建异步任务", "Worker 会查询 Provider 并直接保存不可变快照…");
  try {
    const response = await fetch(`${base}/api/v1/review-fetch-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Scope-Id": "demo" },
      body: JSON.stringify({ platform, value }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "创建任务失败");
    const review = await poll(base, body.job_id);
    show("ready", review.title || "作品已入库", `点赞 ${review.metrics.likes ?? "—"} · 评论 ${review.metrics.comments ?? "—"} · 快照 ${review.captured_at}`);
  } catch (error) {
    show("error", "查询未完成", error instanceof Error ? error.message : "未知错误");
  }
});
