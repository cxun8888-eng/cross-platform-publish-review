import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const source = await readFile(resolve(root, "src/background/service-worker.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const sender = { tab: { id: 7, url: "https://creator.xiaohongshu.com/publish" } };
const message = { type: "XHS_TRUSTED_CLICK", target: "coordinate", x: 120, y: 240 };

function createWorker({ hasPermission = true, attachError = null, commandError = null, commandHandler = null } = {}) {
  let listener;
  const calls = { attach: 0, detach: 0, commands: [] };
  const chrome = {
    runtime: {
      onMessage: {
        addListener(value) {
          listener = value;
        },
      },
    },
    permissions: {
      contains: async () => hasPermission,
    },
    debugger: {
      attach: async () => {
        calls.attach += 1;
        if (attachError) throw attachError;
      },
      sendCommand: async (_target, method, params) => {
        calls.commands.push({ method, params });
        if (commandError) throw commandError;
        if (commandHandler) return commandHandler(method, params);
        return {};
      },
      detach: async () => {
        calls.detach += 1;
      },
    },
    storage: {
      local: { get: async () => ({}), set: async () => undefined },
      session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    },
    tabs: { update: async () => undefined },
  };
  vm.runInNewContext(compiled, { chrome, URL, TextEncoder, btoa });
  assert.equal(typeof listener, "function");
  const send = (payload = message, messageSender = sender) => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => reject(new Error("Service Worker 未返回响应")), 1000);
    const keepChannelOpen = listener(payload, messageSender, (response) => {
      clearTimeout(timer);
      resolveResponse(response);
    });
    assert.equal(keepChannelOpen, true);
  });
  return { calls, send };
}

const finalMessage = { type: "XHS_TRUSTED_CLICK", target: "final-publish" };
const finalButton = (backendNodeId) => ({
  localName: "button",
  attributes: ["class", "bg-red"],
  backendNodeId,
  children: [{ nodeValue: "发布" }],
});

test("缺少安装权限时返回稳定错误且不连接调试器", async () => {
  const worker = createWorker({ hasPermission: false });
  const response = await worker.send();
  assert.equal(response.ok, false);
  assert.equal(response.error, "扩展缺少安装时调试权限，请重新加载或重新启用 PublishLoop");
  assert.equal(response.code, "DEBUGGER_PERMISSION_MISSING");
  assert.equal(worker.calls.attach, 0);
  assert.equal(worker.calls.detach, 0);
});

test("调试器被占用时返回连接错误且不错误 detach", async () => {
  const worker = createWorker({ attachError: new Error("Another debugger is already attached") });
  const response = await worker.send();
  assert.equal(response.code, "DEBUGGER_ATTACH_FAILED");
  assert.equal(worker.calls.attach, 1);
  assert.equal(worker.calls.detach, 0);
});

test("点击命令失败时返回执行错误并释放调试会话", async () => {
  const worker = createWorker({ commandError: new Error("CDP command failed") });
  const response = await worker.send();
  assert.equal(response.code, "TRUSTED_CLICK_FAILED");
  assert.equal(worker.calls.attach, 1);
  assert.equal(worker.calls.detach, 1);
});

test("可信点击成功时发送完整鼠标事件并释放调试会话", async () => {
  const worker = createWorker();
  const response = await worker.send();
  assert.equal(response.ok, true);
  assert.equal(response.data, null);
  assert.equal(worker.calls.attach, 1);
  assert.equal(worker.calls.detach, 1);
  assert.deepEqual(worker.calls.commands.map(({ method }) => method), [
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
  ]);
  assert.deepEqual(worker.calls.commands.map(({ params }) => params.type), [
    "mouseMoved",
    "mousePressed",
    "mouseReleased",
  ]);
});

test("非官方页面消息在连接调试器前被拒绝", async () => {
  const worker = createWorker();
  const response = await worker.send(message, { tab: { id: 9, url: "https://evil.example/publish" } });
  assert.equal(response.ok, false);
  assert.equal(worker.calls.attach, 0);
  assert.equal(worker.calls.detach, 0);
});

test("最终发布目标不存在时停止并释放调试会话", async () => {
  const worker = createWorker({
    commandHandler: (method) => method === "DOM.getDocument" ? { root: { children: [] } } : {},
  });
  const response = await worker.send(finalMessage);
  assert.equal(response.code, "TRUSTED_CLICK_TARGET_NOT_FOUND");
  assert.equal(worker.calls.commands.some(({ method }) => method === "Input.dispatchMouseEvent"), false);
  assert.equal(worker.calls.detach, 1);
});

test("最终发布目标不唯一时停止且不发送点击", async () => {
  const worker = createWorker({
    commandHandler: (method) => method === "DOM.getDocument"
      ? { root: { children: [finalButton(21), finalButton(22)] } }
      : {},
  });
  const response = await worker.send(finalMessage);
  assert.equal(response.code, "TRUSTED_CLICK_TARGET_AMBIGUOUS");
  assert.equal(worker.calls.commands.some(({ method }) => method === "Input.dispatchMouseEvent"), false);
  assert.equal(worker.calls.detach, 1);
});

test("最终发布按钮位置无效时停止并释放调试会话", async () => {
  const worker = createWorker({
    commandHandler: (method) => {
      if (method === "DOM.getDocument") return { root: { children: [finalButton(31)] } };
      if (method === "DOM.getBoxModel") return { model: { content: [0, 0, 10, 0] } };
      return {};
    },
  });
  const response = await worker.send(finalMessage);
  assert.equal(response.code, "TRUSTED_CLICK_INVALID_TARGET");
  assert.equal(worker.calls.commands.some(({ method }) => method === "Input.dispatchMouseEvent"), false);
  assert.equal(worker.calls.detach, 1);
});

test("最终发布按钮唯一时按中心坐标点击并释放调试会话", async () => {
  const worker = createWorker({
    commandHandler: (method) => {
      if (method === "DOM.getDocument") return { root: { shadowRoots: [{ children: [finalButton(41)] }] } };
      if (method === "DOM.getBoxModel") return { model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } };
      return {};
    },
  });
  const response = await worker.send(finalMessage);
  const inputCommands = worker.calls.commands.filter(({ method }) => method === "Input.dispatchMouseEvent");
  assert.equal(response.ok, true);
  assert.equal(inputCommands.length, 3);
  assert.deepEqual(inputCommands.map(({ params }) => [params.x, params.y]), [[60, 40], [60, 40], [60, 40]]);
  assert.equal(worker.calls.detach, 1);
});
