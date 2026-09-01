# Cross-platform Publish Review

一个可运行、可拆解的“多平台辅助发布 + 作品复盘”参考实现。

宿主应用不使用 iframe 嵌入第三方发布页，而是通过浏览器扩展把公开文案交接到抖音、小红书、微博官方页面；用户完成素材选择、账号检查与平台校验后，扩展将最小化回执带回宿主应用。抖音、小红书还可通过服务端 Provider 按作品链接创建复盘快照。

> 当前版本 `0.1.0`，定位是源码级参考实现，不是浏览器商店发行版或托管服务。项目不保证平台最终发布成功，也不绕过验证码、风控或二次确认。

## 先从哪里开始

| 你是谁 | 推荐入口 |
| --- | --- |
| 第一次体验 | [从零跑通一次发布与复盘](docs/getting-started.md) |
| 插件使用者 | [浏览器扩展安装与配置](docs/browser-extension-guide.md) → [端到端操作指南](docs/user-guide.md) |
| 宿主项目开发者 | [宿主项目接入指南](docs/integration-guide.md) → [API 参考](docs/api-reference.md) |
| 架构/安全评审 | [技术原理详解](docs/technical-deep-dive.md) → [安全模型](docs/security-model.md) |
| 平台适配维护者 | [平台适配指南](docs/platform-adapters.md) → [兼容性记录](docs/compatibility.md) |
| 遇到问题 | [故障排查](docs/troubleshooting.md) |

## 能力矩阵

| 平台 | 文案辅助填充 | 用户确认后触发 | 回执 | 手动链接复盘 |
| --- | --- | --- | --- | --- |
| 抖音 | 图文 | 支持 | 尽力获取公开链接/可见指标 | Mock / RedFox Provider |
| 小红书 | 图文笔记 | 支持 | 尽力获取公开链接/可见指标 | Mock / RedFox Provider |
| 微博 | 标题并入正文 | 支持 | 仅 `triggered`，不代表发布成功 | 暂不支持 |

当前面向 Chrome / Edge Manifest V3。Firefox、Safari、自动读取/上传本地文件、绕过平台校验均不在范围内。

## 技术全景

```text
宿主应用 Draft
  │
  │ #publish_review_draft=<base64url(JSON)>
  ▼
浏览器扩展运行在官方发布页
  │ 校验来源 → 清理 fragment → 辅助填充
  │ 用户选择素材、核对并明确确认
  ▼
抖音 / 小红书 / 微博官方页面
  │
  │ #publication_receipt=<base64url(JSON)>
  ▼
宿主回调页 / 作品复盘 UI
  │
  │ 官方作品链接或 ID
  ▼
FastAPI 202 Job → Celery Worker → Mock/RedFox Provider
  │
  └→ 作品最新详情 + 不可变指标快照
```

RedFox 只是一种服务端作品数据 Provider，不参与发布。没有 RedFox Key 时，发布桥接仍可使用，Mock Provider 也能跑通复盘链路。

详细时序、状态机、数据表和信任边界见[技术原理详解](docs/technical-deep-dive.md)。

## 10 分钟最短体验

### 1. 克隆并构建

```bash
git clone https://github.com/cxun8888-eng/cross-platform-publish-review.git
cd cross-platform-publish-review
npm install
npm run build
```

`dist/` 不提交 Git，必须先构建。

### 2. 加载扩展

1. 打开 `chrome://extensions/` 或 `edge://extensions/`；
2. 开启开发者模式；
3. 选择“加载已解压的扩展程序”；
4. 选择 `cross-platform-publish-review/browser-extension/`。

加载的是 `browser-extension/` 根目录，不是 `browser-extension/dist/`，因为 manifest 位于根目录并引用生成的 dist 文件。

加载成功后，扩展卡片应显示“多平台发布与作品复盘助手”。如果仍显示“文数智旅”或“旅策”，说明浏览器加载的是原项目旧目录；请先移除旧扩展，再重新选择本仓库的 `browser-extension/`。

### 3. 启动 Demo

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory web-demo
```

打开 `http://localhost:4173`。在扩展弹窗保存：

```text
应用地址：http://localhost:4173
回调路径：/index.html
```

然后从 Demo 点击平台卡片。使用前请先在同一浏览器 Profile 登录对应官方平台；素材必须由用户在系统文件窗口中选择。

这一步不需要后端。复盘 API、Redis、Celery 和 RedFox 配置请继续阅读[完整快速开始](docs/getting-started.md)。

## 目录结构

```text
browser-extension/   Chrome / Edge 发布桥接扩展
packages/protocol/   草稿交接与发布回执 TypeScript 契约
backend/             FastAPI + Celery + Provider + SQLite 参考仓储
web-demo/            无框架宿主应用演示
docs/                使用、技术、接入和安全文档
```

关键代码入口：

- `packages/protocol/src/index.ts`：交接 URL 和回执解析；
- `browser-extension/src/content/creator-content.ts`：抖音/小红书状态机；
- `browser-extension/src/content/weibo-content.ts`：微博状态机；
- `browser-extension/src/background/service-worker.ts`：可信点击、来源校验和同标签回流；
- `backend/app/routes/reviews.py`：异步复盘 API；
- `backend/app/providers/`：Mock/RedFox Provider；
- `backend/app/repository.py`：幂等任务与快照。

## 文档目录

### 使用者

- [从零跑通一次发布与复盘](docs/getting-started.md)
- [浏览器扩展使用指南](docs/browser-extension-guide.md)
- [端到端使用指南](docs/user-guide.md)
- [故障排查](docs/troubleshooting.md)

### 开发者

- [技术原理详解](docs/technical-deep-dive.md)
- [宿主项目接入指南](docs/integration-guide.md)
- [作品复盘 API 参考](docs/api-reference.md)
- [架构摘要](docs/architecture.md)
- [平台适配指南](docs/platform-adapters.md)
- [兼容性与版本状态](docs/compatibility.md)

### 安全与治理

- [安全模型](docs/security-model.md)
- [隐私说明](PRIVACY.md)
- [安全报告](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [版本记录](CHANGELOG.md)
- [商标声明](TRADEMARKS.md)
- [第三方说明](THIRD_PARTY_NOTICES.md)

## RedFox 配置摘要

仓库默认使用 Mock。真实 RedFox 只向 Celery Worker 注入：

```dotenv
REVIEW_PROVIDER=redfox
REDFOX_ENABLED=true
REDFOX_API_KEY=
REDFOX_DOUYIN_WORK_DETAIL_URL=
REDFOX_XIAOHONGSHU_WORK_DETAIL_URL=
```

项目不会自动加载 `.env`。变量必须由 Shell、容器或进程管理器注入。Key 不能进入 Web、扩展、API 容器、数据库、响应或日志。每个部署者必须使用自己的合法 Key，并确认供应商条款允许其使用场景。

当前实现即使只查询一个平台，也要求同时配置两个 RedFox HTTPS Endpoint。完整说明见 [API 环境变量](docs/api-reference.md#环境变量)。

## 安全边界

- 不读取平台 Cookie、密码或账号凭据；
- 不读取或自动选择本地文件；
- 最终动作必须来自明确用户确认；
- `debugger` 是按需申请的可选权限，一次操作后立即 detach；
- 没有 `<all_urls>`、`cookies` 或 `webRequest` 权限；
- 回调目标来自用户预先保存的 HTTPS Origin + 固定路径，草稿不能覆盖；
- 手动作品链接只做官方域名和 ID 解析，后端不请求用户粘贴的 URL；
- 回执没有签名，只能作为 UI 接力，不能作为可信业务凭证；
- 示例 `X-Scope-Id` 不是认证，SQLite/CORS 也不是生产安全方案。

## 测试

```bash
npm test
cd backend
pytest
```

普通测试不会调用真实 RedFox。自动化测试不能替代官方平台真实账号下的人工回归。

## 常见问题

**为什么加载 `browser-extension/dist/` 会失败？** 该目录没有 manifest。构建后仍要加载 `browser-extension/` 根目录。

**为什么插件进入平台后没有出现？** 最常见原因是没有从宿主按钮携带 fragment 进入、`source` 不是 `publish-review-demo`、扩展更新后未重新加载，或平台 DOM 已变化。参见[故障排查](docs/troubleshooting.md)。

**不用 RedFox 能否发布？** 可以。RedFox 只用于服务端作品详情查询；发布桥接与 Mock 复盘都不需要 Key。

**插件是否会替用户登录或选择图片？** 不会。登录、验证码、本地素材和最终平台校验始终由用户处理。

## 维护与贡献

仓库由 [cxun8888-eng](https://github.com/cxun8888-eng) 维护，欢迎通过 Issue 和 Pull Request 改进协议、平台适配、测试与文档。提交前请阅读[贡献指南](CONTRIBUTING.md)和[兼容性记录](docs/compatibility.md)。安全问题不要公开披露，请使用[私密报告方式](SECURITY.md)。

## 已知限制

- 没有 Chrome/Edge 商店包或 GitHub Release，当前只支持源码构建；
- `@publish-review/protocol` 尚未发布到 npm；
- 公开扩展 v0.1.0 只接受 `source: "publish-review-demo"`；
- 平台 DOM、中文按钮与 Shadow DOM 可能随时变化；
- `triggered` 和 `resolved` 都不等于平台官方成功；
- 微博没有可靠作品回盘；
- SQLite、客户端作用域 Header、任务轮询和简化重试只适合参考；
- 当前 Job 查询接口没有完整作用域授权；
- 生产化前需要 PostgreSQL、鉴权、限流、监控、审计和更完整的任务投递语义。

更多边界见[兼容性记录](docs/compatibility.md)与[技术原理](docs/technical-deep-dive.md#8-当前边界)。

## 法律与许可证

本项目与抖音、小红书、微博、RedFox 及其运营主体没有隶属、合作、赞助或背书关系。平台名称仅用于描述兼容性。使用者必须遵守平台规则、法律与供应商合同。

代码采用 [Apache License 2.0](LICENSE)。该许可证不授予任何第三方商标权，也不改变第三方服务条款。
