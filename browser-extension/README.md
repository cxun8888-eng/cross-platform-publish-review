# Browser Extension

Chrome / Edge Manifest V3 发布桥接扩展。读取 `publish_review_draft` fragment，在抖音、小红书、微博官方页面显示助手，并在用户确认后辅助唯一、可见、可用的页面动作。

`storage` 保存应用 Origin、回调路径和短期回流状态；官方域名 host permissions 仅用于内容脚本；可选 `debugger` 仅在用户触发增强点击时申请并立即 detach。扩展不申请 Cookie、任意站点或网络拦截权限。

```bash
npm install
npm run build
npm test
```

加载目录是本目录，manifest 会引用生成的 `dist/`。
