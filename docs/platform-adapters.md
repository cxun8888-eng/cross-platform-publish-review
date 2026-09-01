# 平台适配器开发与维护

平台 DOM 不是稳定 API。适配器的第一目标不是“尽量点中”，而是“无法确定时安全停止”。

## 当前平台矩阵

| 平台 | 入口 | 草稿处理 | 素材 | 最终动作 | 回执 |
| --- | --- | --- | --- | --- | --- |
| 抖音 | 图文上传页 | 标题、正文、标签 | 用户手动选择 | 助手二次确认 | 尽力 `resolved` |
| 小红书 | 发布笔记页 | 标题、正文、话题 | 用户手动选择 | 必要时 CDP 访问 closed Shadow DOM | 尽力 `resolved` |
| 微博 | 首页/可见编辑器 | 标题并入正文、话题合并 | 用户手动选择 | 唯一精确“发送”按钮 | 仅 `triggered` |

## 当前代码结构

- `creator-content.ts`：抖音与小红书页面识别、状态机、助手 UI、成功页/看板解析；
- `weibo-content.ts`：微博编辑器、素材入口、正文校验和发送状态机；
- `service-worker.ts`：官方 Host 校验、可选可信点击、回盘状态与回调；
- `manifest.json`：精确 host permissions 和注入时机。

后续建议拆出统一接口：

```ts
interface PublisherAdapter {
  matchesPage(): boolean;
  fillDraft(draft: Draft): FillResult;
  openAssetPicker(): Promise<ActionResult>;
  findUniqueFinalAction(): HTMLElement | null;
  resolveReceipt(): Promise<PublicationReceipt | null>;
  scrapeMetrics(): Record<string, number> | null;
}
```

## 状态机不变量

每个平台状态名可以不同，但必须遵守：

```text
draft-detected
  → editor-ready
  → asset-picker-opened
  → content-filled
  → awaiting-user-confirmation
  → action-triggered
  → receipt-resolving / manual-return
```

禁止从 `draft-detected` 直接跳到最终动作。

## DOM 目标选择规则

1. 先限制官方 Host 和页面类型；
2. 优先稳定语义属性、role、placeholder，再考虑 class；
3. 过滤不可见、禁用、零尺寸元素；
4. 最终按钮必须唯一；
5. 候选多于一个时停止，不能选择第一个；
6. 触发前再次读取正文，检查用户修改或编辑器丢失；
7. MutationObserver 回调必须幂等，不能重复打开文件窗口或重复发布。

## 素材选择

扩展只允许打开系统文件选择器。不得：

- 扫描本地路径；
- 读取文件内容后静默上传；
- 保存用户文件；
- 在没有用户手势时反复弹窗。

普通 DOM click 无效时，可以在官方 Host 校验和用户手势之后请求可选 `debugger` 权限；失败必须降级到平台原生按钮。

## 回执解析

### 公开作品 URL

- 只接受 HTTPS；
- 只接受平台官方域名；
- 拒绝用户名、密码和自定义端口；
- ID 必须符合平台格式；
- 规范化为固定公开 URL。

### 看板指标

- 先按本次草稿标题锁定作品行；
- 标题未匹配时不能选择第一行；
- 不能把账号总览指标卡当作作品数据；
- 支持“万/亿”等单位时要测试边界；
- 只接受有限、非负数值；
- `0` 是有效值，缺失才是 `null`。

## 平台改版后的处理流程

1. 使用测试账号复现，不要用生产账号反复试点；
2. 确认失败状态和手动路径仍可用；
3. 保存脱敏的最小 DOM fixture，不提交真实账号页面；
4. 修改最小选择器范围；
5. 增加失败前的唯一性和可见性断言；
6. 运行 TypeScript build 与扩展契约测试；
7. 分别人工回归素材选择、文案填充、用户确认、平台校验和回流；
8. 更新[兼容性记录](compatibility.md)的浏览器版本与验证日期。

## 新增平台

至少同步：

- 协议的 `PublishPlatform` 和目标地址；
- manifest 精确 Host；
- content script 与注入时机；
- Service Worker 的发送者 Host 校验；
- 平台状态机；
- 回执语义（只能 `triggered` 还是可以 `resolved`）；
- 作品 URL 解析与 Provider；
- 权限、隐私、能力矩阵和测试。

禁止用 `<all_urls>` 或任意回调 URL 缩短开发时间。

## 测试证据

最低测试集合：

- 草稿版本、Source、平台不匹配时拒绝；
- fragment 读取后清理；
- 会话 TTL 与刷新恢复；
- 非官方消息来源拒绝；
- 最终按钮不唯一、不可见、禁用时停止；
- 用户修改正文后不自动触发；
- 作品 URL allowlist；
- 指标零值、负值、单位与上限；
- 标题不匹配时不回退第一行；
- manifest 不含 `<all_urls>`、Cookie 或 RedFox；
- `debugger` 保持可选并在操作后 detach。

真实账号 smoke test 仍然必需，自动化 fixture 不能证明平台当前页面没有改版。
