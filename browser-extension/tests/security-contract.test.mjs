import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

test("扩展使用最小域名权限且调试权限可选", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.optional_permissions, ["debugger"]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
});

test("扩展不包含 RedFox 密钥或原项目品牌", async () => {
  const files = ["manifest.json", "src/popup/popup.html", "src/background/service-worker.ts", "src/content/creator-content.ts", "src/content/weibo-content.ts"];
  const source = (await Promise.all(files.map((file) => readFile(resolve(root, file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /REDFOX_API_KEY|文数智旅|旅策|lvce-formal-plan|wenshu_draft/i);
  assert.match(source, /publish_review_draft/);
});

test("扩展使用独立的中性产品名称", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  const popup = await readFile(resolve(root, "src/popup/popup.html"), "utf8");
  const creator = await readFile(resolve(root, "src/content/creator-content.ts"), "utf8");
  const weibo = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.equal(manifest.name, "PublishLoop｜多平台发布与作品复盘助手");
  assert.equal(manifest.short_name, "PublishLoop");
  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.action.default_title, "打开 PublishLoop");
  assert.match(manifest.description, /宿主应用/);
  assert.match(popup, /PublishLoop/);
  assert.match(popup, /发布回环/);
  assert.match(creator, /PublishLoop/);
  assert.match(weibo, /PublishLoop/);
});

test("最终动作保留用户确认与官方来源校验", async () => {
  const worker = await readFile(resolve(root, "src/background/service-worker.ts"), "utf8");
  const creator = await readFile(resolve(root, "src/content/creator-content.ts"), "utf8");
  assert.match(worker, /platformFromSender/);
  assert.match(worker, /creator\.douyin\.com/);
  assert.match(creator, /确认并发布/);
  assert.doesNotMatch(creator, /document\.cookie|chrome\.cookies/);
});
