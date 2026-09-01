# 多平台发布与作品复盘助手

面向 Chrome / Edge 的中性 Manifest V3 发布桥接扩展，与任何具体宿主产品品牌解耦。它读取 `publish_review_draft` fragment，在抖音、小红书、微博官方页面显示助手，并在用户确认后辅助唯一、可见、可用的页面动作。

完整说明：

- [安装、权限与平台操作](../docs/browser-extension-guide.md)
- [从零跑通 Demo](../docs/getting-started.md)
- [扩展内部技术原理](../docs/technical-deep-dive.md#4-扩展内部设计)
- [故障排查](../docs/troubleshooting.md)

`storage` 保存应用 Origin、回调路径和短期回流状态；官方域名 host permissions 仅用于内容脚本；可选 `debugger` 仅在用户触发增强点击时申请并立即 detach。扩展不申请 Cookie、任意站点或网络拦截权限。

```bash
npm install
npm run build
npm test
```

加载目录是本目录 `browser-extension/`，不是 `dist/`。manifest 位于本目录并引用构建生成的 `dist/`。

本地 Demo 的弹窗配置：

```text
应用地址：http://localhost:4173
回调路径：/index.html
```

使用前需要在同一浏览器 Profile 登录对应官方平台。扩展不负责登录、验证码或账号风控。
