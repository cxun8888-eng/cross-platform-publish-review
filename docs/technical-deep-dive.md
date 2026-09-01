# 技术原理详解

## 1. 解决的问题

创作者平台通常不允许业务系统用 iframe 直接嵌入其发布页：

- CSP 与 `X-Frame-Options` 会阻止跨站嵌入；
- 平台登录态、验证码和风控必须留在官方页面；
- 文件选择器不能由远端业务系统代替用户读取本地文件；
- 平台 DOM 不是稳定 API，服务端直发也常需要额外开放平台资质。

本项目把问题拆为两条相互独立的链路：

1. **发布桥接**：宿主应用与官方页面之间传递公开草稿和最小化回执；
2. **作品复盘**：服务端按公开作品链接异步查询、归一化并保存指标快照。

RedFox 只出现在第二条链路中。即使完全不配置 RedFox，发布桥接仍可工作。

## 2. 组件与代码入口

| 组件 | 职责 | 主要代码 |
| --- | --- | --- |
| Protocol | 定义草稿与回执，处理 base64url | `packages/protocol/src/index.ts` |
| Web Demo | 展示宿主应用如何发起与接收 | `web-demo/app.js` |
| Content Script | 读取草稿、适配 DOM、显示助手 | `browser-extension/src/content/*.ts` |
| Service Worker | 校验消息来源、可信点击、回流 | `browser-extension/src/background/service-worker.ts` |
| FastAPI | 创建任务、查询状态、列出复盘 | `backend/app/routes/reviews.py` |
| Celery Worker | 调 Provider 并直接保存快照 | `backend/app/tasks.py` |
| Provider | Mock 或 RedFox 数据源适配 | `backend/app/providers/` |
| Repository | 幂等 Job、作品和快照存储 | `backend/app/repository.py` |

## 3. 发布交接时序

```text
Host Web                  Official page / Content script       Service Worker
   │                                  │                              │
   │ buildDraftHandoffUrl()           │                              │
   │── navigate with #draft ─────────>│                              │
   │                                  │ validate version/source/host │
   │                                  │ clear fragment               │
   │                                  │ cache in sessionStorage      │
   │                                  │ fill title/body/tags         │
   │                                  │ open file picker for user ──>│ trusted click if required
   │                                  │ user reviews and confirms    │
   │                                  │ register pending receipt ───>│ 10-minute tab state
   │                                  │ platform handles publish     │
   │                                  │ resolve URL/visible metrics  │
   │                                  │ complete receipt ───────────>│ validate sender host
   │<──── current tab callback + #publication_receipt ──────────────│
   │ parsePublicationReceipt()        │                              │
   │ history.replaceState()           │                              │
```

### 为什么使用 fragment

`#...` 不属于 HTTP request target，浏览器导航到平台时不会把草稿 fragment 发送给平台服务器。因此它比 query string 更适合传递游客可见的公开文案。

它不是加密：浏览器历史、当前页面脚本或其他高权限扩展仍可能观察地址栏。项目采取的缓解措施是：

- 只允许标题、正文和标签，不放账号、预算、租户或 Key；
- 内容脚本读取后立即清除地址栏；
- 当前标签的会话副本最多保留 10 分钟；
- 生产接入应继续限制 payload 长度和内容分类。

### 草稿契约

```json
{
  "version": 1,
  "source": "publish-review-demo",
  "platform": "douyin",
  "returnTarget": "workspace",
  "title": "标题",
  "content": "正文",
  "tags": ["旅行", "周末"]
}
```

协议包输出限制：标题 200 字、正文 10,000 字、去重标签最多 30 个。当前内容脚本再次截断标签到 20 个、正文到 20,000 字。调用方应遵守协议包更严格的限制。

当前公开扩展硬校验 `source === "publish-review-demo"`。这是固定的可信来源标识，不是动态租户字段。

### 回执契约

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 是 | 当前为 `1` |
| `platform` | 是 | `douyin` / `xiaohongshu` / `weibo` |
| `outcome` | 是 | `triggered` 或 `resolved` |
| `returnMode` | 是 | `workspace` 或 `wizard` |
| `completedAt` | 是 | ISO 8601 时间 |
| `workUrl` | 否 | 已验证并规范化的官方作品 URL |
| `title` | 否 | 看板匹配到的作品标题 |
| `metrics` | 否 | 页面可见指标白名单 |

`triggered` 只表示动作已触发；`resolved` 表示找到了可接受的链接或指标，二者都不能替代平台的最终成功状态。

## 4. 扩展内部设计

### Shadow DOM 隔离

助手 UI 挂载在 closed Shadow DOM 中，减少平台全局 CSS 对助手的影响，也避免助手样式污染平台。它不是安全沙箱，安全仍依赖 host 校验和消息校验。

### SPA 与状态恢复

抖音、小红书和微博都是 SPA。内容脚本通过 `MutationObserver` 重新识别编辑器和页面阶段；草稿写入 `sessionStorage`，所以平台内部路由切换或一次刷新后仍能恢复。

小红书首次进入发布页可能主动刷新一次，用 session key 防止刷新循环。

### 最终动作的不变量

平台适配器必须同时满足：

1. 页面属于 manifest 声明的官方 Host；
2. 用户在助手中明确确认；
3. 目标按钮唯一；
4. 目标可见、可用；
5. 导入后的正文没有发生无法解释的变化；
6. 失败时停止并引导手动操作。

### `debugger` 安装权限与短时 CDP 会话

普通 `element.click()` 可能被平台识别为非可信事件，closed Shadow DOM 也无法从普通内容脚本访问。Chrome 不允许把 `debugger` 声明为可选权限，因此扩展在安装时声明该权限。后台收到内容脚本消息后先校验官方 Host，再使用 CDP：

1. attach 当前官方标签；
2. 读取 DOM/box model 或使用已验证坐标；
3. 发送 `mouseMoved`、`mousePressed`、`mouseReleased`；
4. 在 `finally` 中 detach。

消息发送者的标签 URL 会再次做官方 Host 校验。安装权限异常、attach 失败或目标定位失败会返回不同错误码，并降级为平台原生按钮。

### 作品关联防误配

复盘回流优先按本次草稿标题锁定作品行。存在期望标题却没有匹配时，不退回看板第一行，也不把账号总览指标卡当成本次作品指标。公开链接还要经过平台域名、协议、端口和 ID 格式校验。

## 5. 作品复盘时序

```text
Client              FastAPI              SQLite            Celery/Redis          Provider
  │ POST + Idempotency-Key │                  │                    │                  │
  │───────────────────────>│ parse official URL                 │                  │
  │                        │ reserve job ─────>│ UNIQUE(scope,key)  │                  │
  │                        │ enqueue ───────────────────────────>│                  │
  │<──── 202 job_id ───────│                  │                    │                  │
  │                        │                  │       fetch(reference) ─────────────>│
  │                        │                  │       normalized detail <───────────│
  │                        │                  │<──── save work + snapshot           │
  │ GET job_id             │                  │                    │                  │
  │───────────────────────>│ AsyncResult      │                    │                  │
  │<──── success + review ─│                  │                    │                  │
```

### 为什么用异步任务

真实数据商请求可能超过 1 秒、限流或暂时失败。API 只负责校验、幂等保留和入队，返回 `202`。密钥只需要注入 Worker，不需要出现在 Web、扩展或 API 运行环境。

### 幂等键

`publication_review_fetch_job` 对 `(scope_id, idempotency_key)` 建唯一约束，并保存平台与作品 ID 的请求摘要：

- 同键、同请求：返回原 `job_id`，状态为 `replayed`；
- 同键、不同作品：返回 `409`；
- 新键：创建新任务。

### 作品与快照

```text
publication_review
  UNIQUE(scope_id, platform, work_id)
       │ 1
       │
       │ N
publication_review_snapshot
  PRIMARY KEY(review_id, captured_at)
```

刷新同一作品时追加快照。乱序到达的旧快照仍可保存，但不会覆盖 `publication_review` 中的最新详情。

SQLite 是便于阅读和本地运行的参考实现。生产环境应使用 PostgreSQL、显式事务、迁移、鉴权、限流和任务监控。

## 6. Provider 架构

领域层只依赖：

```python
class WorkDetailProvider(Protocol):
    async def fetch(self, reference: WorkReference) -> WorkDetail: ...
```

### Mock Provider

按作品 ID 生成可重复的虚构指标，用来验证端到端链路。不会访问外网。

### RedFox Provider

1. API 接收官方链接并只提取作品 ID；
2. Worker 从进程环境读取 Key 和固定 Endpoint；
3. `httpx` 关闭环境代理继承和重定向；
4. Key 只写入 `REDFOX_API_KEY` 请求头；
5. 原始供应商响应归一化为 `WorkDetail`，不整体落库；
6. 缺失或非法指标保存为 `null`，真实 `0` 保留。

当前 RedFox 配置校验要求抖音和小红书 Endpoint 同时存在，即使本次只查询其中一个平台。

## 7. 信任边界

| 区域 | 可以持有什么 | 不应该持有什么 |
| --- | --- | --- |
| Web/协议包 | 公开草稿、回执 | 平台 Cookie、RedFox Key |
| 浏览器扩展 | 当前草稿、回调配置、页面可见状态 | 密码、Cookie、本地文件内容 |
| FastAPI | 作用域、作品引用、任务 ID | RedFox Key（建议不注入） |
| Worker | Provider Key、规范化结果 | 前端登录凭据 |
| 数据库 | 作品、指标快照、幂等摘要 | Provider Key、完整原始响应 |

示例 `X-Scope-Id` 不是认证。生产系统必须从服务端验证过的 Session/JWT 中得到作用域，不能信任客户端自己填写的 Header。

## 8. 当前边界

- 参考版本为 `0.1.2`，没有浏览器商店包或 GitHub Release；
- 只支持源码构建和开发者模式加载；
- 平台 DOM 变化可能导致选择器失效；
- 微博只有 `triggered` 回执，没有可靠复盘；
- SQLite、无鉴权、轮询 Job 状态只适合本地参考；
- Celery 结果默认保留 24 小时，SQLite 作品和快照默认不自动删除；
- 协议包目前没有发布到 npm；
- 无效官方链接的领域异常尚未统一映射为稳定的 4xx 错误码。

生产化建议见[宿主项目接入指南](integration-guide.md)。
