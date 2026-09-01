# 浏览器扩展使用指南

## 扩展做什么

`PublishLoop（发布回环）`是 Chrome/Edge Manifest V3 多平台发布与作品复盘助手。它只在以下官方域名运行内容脚本：

- `creator.douyin.com`
- `creator.xiaohongshu.com`
- `weibo.com`
- `www.weibo.com`

扩展接收宿主应用放在 URL fragment 中的一条草稿，在官方页面辅助填充并显示独立确认面板。它不是账号托管工具，也不在后台登录平台。

## 构建与安装

```bash
npm install
npm run build --workspace @publish-review/browser-extension
```

然后在 `chrome://extensions/` 或 `edge://extensions/` 中加载仓库的 `browser-extension/` 目录。

manifest 位于该目录根部，编译产物位于 `browser-extension/dist/`。不要只选择 `dist/`。

## 弹窗配置

### 应用地址

扩展只保留 URL Origin。例如输入：

```text
https://console.example.com/publish?from=extension
```

实际会保存为：

```text
https://console.example.com
```

安全规则：

- 线上地址必须是 HTTPS；
- 本地开发允许 `http://localhost` 和 `http://127.0.0.1`；
- 禁止在 URL 中写用户名或密码；
- 草稿 payload 不能覆盖此配置。

### 回调路径

回调路径必须是同一 Origin 内、以 `/` 开头的绝对路径，例如：

```text
/publish/callback
```

不接受 `//evil.example`、反斜线路径或完整跨站 URL。

## 权限说明

| 权限 | 类型 | 用途 |
| --- | --- | --- |
| `storage` | 安装时授予 | 保存应用 Origin、回调路径和同标签短期回流状态 |
| 官方平台 host permissions | 安装时授予 | 仅在声明的平台页面注入内容脚本 |
| `debugger` | 可选、按需申请 | 普通 DOM 事件无法操作文件入口或 closed Shadow DOM 时发送一次可信鼠标事件 |

扩展不申请：

- `cookies`
- `webRequest`
- `<all_urls>`
- 浏览历史
- 剪贴板

### 为什么会出现调试权限警告

部分平台用 closed Shadow DOM 或只接受浏览器级可信事件。用户点击助手按钮后，扩展才调用 `chrome.permissions.request`。允许后，后台短暂 attach 当前官方页面，完成一次点击后立即 detach。

如果拒绝权限，扩展会提示使用平台原生按钮手动继续。拒绝不会影响文案 fragment 的读取。

如果 DevTools 或其他调试器已经占用标签页，`chrome.debugger.attach` 可能失败。关闭 DevTools 后重试，或者直接手动点击平台按钮。

## 草稿生命周期

1. 宿主应用生成带 `publish_review_draft` 的官方平台 URL；
2. 内容脚本读取并验证 `version`、`source`、`platform`、标题和正文；
3. 地址栏 fragment 立即通过 `history.replaceState` 清除；
4. 草稿写入当前标签的 `sessionStorage`，用于 SPA 切换和刷新恢复；
5. 草稿最多保留 10 分钟；
6. 发布动作触发或超时后清理。

当前公开版内容脚本要求：

```json
{"version":1,"source":"publish-review-demo"}
```

宿主项目接入时必须保持该 `source`，或者在自己的扩展分支中把它改成受控的产品标识并同步测试。

## 平台流程

### 抖音

1. 打开图文发布入口；
2. 助手定位上传图文入口；
3. 用户在系统窗口选择图片；
4. 扩展填入标题、正文和标签；
5. 助手要求用户核对；
6. 用户确认后触发唯一、可见、可用的发布动作；
7. 扩展在成功页或作品看板中尽力匹配本次标题、公开链接和可见指标；
8. 当前标签返回宿主应用。

### 小红书

1. 打开发布笔记页面；
2. 首次进入时可能刷新一次，让平台 SPA 初始化编辑器；
3. 用户手动选择图片；
4. 扩展填充标题、正文和话题；
5. 用户确认后，扩展在需要时使用可选 `debugger` 权限操作 closed Shadow DOM 中的唯一发布按钮；
6. 发布后尽力读取公开作品链接和笔记数据；
7. 当前标签返回宿主应用。

### 微博

1. 扩展寻找“有什么新鲜事”等正文编辑器；
2. 标题和话题合并到正文；
3. 用户手动选择图片；
4. 扩展确认正文没有在导入后发生意外变化；
5. 只有唯一、可见、可用且文本精确为“发送”的按钮存在时才允许确认；
6. 回执结果为 `triggered`，表示按钮已触发，不表示平台确认成功。

微博当前不提供可靠的公开作品自动回盘。

## 更新扩展

拉取新代码后重新构建：

```bash
git pull
npm install
npm run build --workspace @publish-review/browser-extension
```

回到扩展管理页，点击该扩展卡片上的“重新加载”。已打开的平台标签页也建议刷新。

## 卸载与清理

在扩展管理页移除扩展即可清除它的本地存储。平台账号登录态由平台自身管理，扩展没有保存副本。
