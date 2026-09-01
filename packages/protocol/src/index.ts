export type PublishPlatform = "douyin" | "xiaohongshu" | "weibo";
export type ReturnMode = "workspace" | "wizard";

export interface DraftHandoff {
  version: 1;
  source: string;
  platform: PublishPlatform;
  returnTarget: ReturnMode;
  title: string;
  content: string;
  tags: string[];
}

export interface PublicationReceipt {
  version: 1;
  platform: PublishPlatform;
  outcome: "triggered" | "resolved";
  returnMode: ReturnMode;
  completedAt: string;
  workUrl?: string;
  title?: string;
  metrics?: Record<string, number>;
}

const PLATFORM_URLS: Record<PublishPlatform, string> = {
  douyin: "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
  xiaohongshu: "https://creator.xiaohongshu.com/publish",
  weibo: "https://weibo.com/",
};

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeUtf8(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function isPlatform(value: unknown): value is PublishPlatform {
  return value === "douyin" || value === "xiaohongshu" || value === "weibo";
}

/** 生成只存在于浏览器端的草稿交接 URL；fragment 不会发送给平台服务器。 */
export function buildDraftHandoffUrl(input: Omit<DraftHandoff, "version">): string {
  const payload: DraftHandoff = {
    ...input,
    version: 1,
    title: input.title.trim().slice(0, 200),
    content: input.content.trim().slice(0, 10_000),
    tags: [...new Set(input.tags.map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean))].slice(0, 30),
  };
  const url = new URL(PLATFORM_URLS[input.platform]);
  url.hash = `publish_review_draft=${encodeURIComponent(encodeUtf8(JSON.stringify(payload)))}`;
  return url.toString();
}

/** 严格解析扩展回执；宿主应用读取后应立即清理地址栏 fragment。 */
export function parsePublicationReceipt(hash: string): PublicationReceipt | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const encoded = params.get("publication_receipt");
  if (!encoded) return null;
  const value: unknown = JSON.parse(decodeUtf8(encoded));
  if (!value || typeof value !== "object") throw new Error("回执格式无效");
  const receipt = value as Partial<PublicationReceipt>;
  if (receipt.version !== 1 || !isPlatform(receipt.platform) || !["triggered", "resolved"].includes(receipt.outcome || "") || !["workspace", "wizard"].includes(receipt.returnMode || "")) {
    throw new Error("回执契约不受支持");
  }
  if (typeof receipt.completedAt !== "string" || !Number.isFinite(Date.parse(receipt.completedAt))) throw new Error("回执时间无效");
  return receipt as PublicationReceipt;
}
