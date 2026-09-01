import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

test("微博内容脚本读取发布应用交接并校验微博平台", async () => {
  const source = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.match(source, /publish_review_draft/);
  assert.match(source, /parsed\.source !== "publish-review-demo"/);
  assert.match(source, /parsed\.platform !== "weibo"/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /handoffTtlMs/);
  assert.match(source, /parsed\.returnTarget === "wizard" \? "wizard"/);
});

test("微博内容脚本把标题和话题合并到正文", async () => {
  const source = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.match(source, /buildWeiboBody/);
  assert.match(source, /标题置于正文开头/);
  assert.match(source, /topics && !content\.includes\(topics\)/);
  assert.match(source, /setText\(body, bodyText\)/);
});

test("微博只有用户确认且发送按钮唯一可用时才触发发布", async () => {
  const source = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.match(source, /确认并发布/);
  assert.match(source, /findFinalWeiboSendButtons/);
  assert.match(source, /sendButtons\.length !== 1/);
  assert.match(source, /pendingHandoff \? "loading" : "idle"/);
  assert.match(source, /normalizeBodyText\(readText\(currentBody\)\) !== expectedBodyAfterImport/);
  assert.match(source, /\.click\(\)/);
  assert.doesNotMatch(source, /document\.cookie|chrome\.cookies|账号密码/);
  assert.doesNotMatch(source, /立即发送/);
});

test("微博编辑器就绪后自动尝试打开唯一的图片选择入口", async () => {
  const source = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.match(source, /awaiting-image/);
  assert.match(source, /span\.woo-pop-ctrl/);
  assert.match(source, /input\[type='file'\]/);
  assert.match(source, /findWeiboImageButtons/);
  assert.match(source, /openWeiboImagePicker/);
  assert.match(source, /WEIBO_TRUSTED_CLICK/);
  assert.match(source, /requestTrustedWeiboClick/);
  assert.match(source, /attemptAutoOpenImagePicker/);
  assert.match(source, /自动点击微博“图片”入口/);
  assert.match(source, /选择图片/);
  assert.match(source, /不会读取或自动选择本地文件/);
});

test("微博正文选择器覆盖官方分享输入框并排除搜索框", async () => {
  const source = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.match(source, /有什么新鲜事/);
  assert.match(source, /分享给大家/);
  assert.match(source, /搜索\|搜一搜\|评论/);
  assert.match(source, /contenteditable='true'/);
});

test("微博使用当前标签右侧助手并只承诺返回发布清单", async () => {
  const source = await readFile(resolve(root, "src/content/weibo-content.ts"), "utf8");
  assert.match(source, /weiboAssistantFrame/);
  assert.match(source, /PublishLoop/);
  assert.match(source, /publish-review-panel-dock/);
  assert.match(source, /收起 PublishLoop/);
  assert.match(source, /RETURN_TO_SAAS/);
  assert.match(source, /data-publication-complete/);
  assert.match(source, /publicationComplete: returnButton\.hasAttribute/);
  assert.match(source, /发布清单/);
  assert.doesNotMatch(source, /OPEN_SAAS_REVIEW/);
  assert.doesNotMatch(source, /发布成功/);
});
