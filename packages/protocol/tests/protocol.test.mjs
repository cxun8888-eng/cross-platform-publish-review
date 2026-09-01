import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftHandoffUrl, parsePublicationReceipt } from "../dist/index.js";

test("草稿只写入 URL fragment 并清理标签", () => {
  const url = new URL(buildDraftHandoffUrl({ source: "demo", platform: "douyin", returnTarget: "wizard", title: " 标题 ", content: "正文", tags: ["#旅行", "旅行"] }));
  assert.equal(url.origin, "https://creator.douyin.com");
  assert.equal(url.searchParams.has("publish_review_draft"), false);
  assert.match(url.hash, /^#publish_review_draft=/);
});

test("解析有效发布回执并拒绝未知版本", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const receipt = parsePublicationReceipt(`#publication_receipt=${encode({ version: 1, platform: "weibo", outcome: "triggered", returnMode: "workspace", completedAt: "2026-09-01T00:00:00.000Z" })}`);
  assert.equal(receipt.platform, "weibo");
  assert.throws(() => parsePublicationReceipt(`#publication_receipt=${encode({ version: 2 })}`), /不受支持/);
});
