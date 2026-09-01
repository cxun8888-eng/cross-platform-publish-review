# 故障排查

## 扩展无法加载

### 提示找不到 manifest

加载目录选错。应选择：

```text
cross-platform-publish-review/browser-extension/
```

不是 `browser-extension/dist/`。

### 提示找不到 `dist/*.js`

先在仓库根目录构建：

```bash
npm install
npm run build
```

然后在扩展管理页点击“重新加载”。

### 扩展卡片仍显示原项目名称

GitHub 代码更新不会替换浏览器中已加载的旧目录。如果扩展卡片仍显示“文数智旅”或“旅策”，请：

1. 在扩展管理页移除旧扩展；
2. 确认本仓库已执行 `npm run build`；
3. 重新选择 `cross-platform-publish-review/browser-extension/`；
4. 确认新卡片名称为“PublishLoop｜多平台发布与作品复盘助手”。

## 官方页面没有出现助手

依次检查：

1. 扩展是否启用；
2. 当前 URL 是否属于 manifest 声明的官方域名；
3. 是否从 Demo/宿主按钮进入，而不是手动打开空白发布页；
4. payload 是否使用 `version: 1`、正确平台和 `source: "publish-review-demo"`；
5. 地址栏 fragment 是否曾包含 `publish_review_draft`；
6. 是否在 10 分钟有效期内；
7. 扩展更新后是否重新加载并刷新平台标签。

打开扩展管理页的“错误”与 Service Worker 检查窗口，查看是否有运行错误。不要在 Issue 中粘贴账号数据或完整草稿。

## 扩展设置无法保存

- 远程地址必须是 HTTPS；
- HTTP 只允许 `localhost` 或 `127.0.0.1`；
- 应用地址不能包含用户名/密码；
- 回调路径必须以单个 `/` 开头；
- 回调路径不能写完整外站 URL。

本地 Demo 正确值：

```text
应用地址：http://localhost:4173
回调路径：/index.html
```

## 文件选择器没有打开

1. 确认是在助手按钮的直接用户操作之后；
2. 允许浏览器按需申请的 `debugger` 权限；
3. 关闭该平台标签页的 DevTools，避免占用 CDP；
4. 暂停其他可能调试同一标签的扩展；
5. 使用平台原生“上传图片/图文”入口手动继续。

扩展不会自动选择本地文件。文件窗口打开后必须由用户操作。

## 文案没有填入或填错位置

- 等平台编辑器完全渲染后重试；
- 确认进入的是图文发布而不是视频发布；
- 小红书首次进入可能刷新一次，这是预期行为；
- 平台 DOM 或按钮文案可能已经变化；
- 如果检测到多个候选编辑器/按钮，扩展可能主动停止。

不要为了临时通过而删除“唯一目标”检查。请按[平台适配指南](platform-adapters.md)更新选择器和测试。

## 点击确认后没有发布

`确认并发布` 仍受平台状态影响：

- 素材未完成处理；
- 标题/正文超平台限制；
- 账号需要验证码或风控确认；
- 平台按钮不可用；
- DevTools 占用调试连接；
- 平台 DOM 已更新。

使用平台原生按钮检查页面给出的错误。扩展不会绕过验证码、风控和二次确认。

## 没有自动返回宿主应用

1. 检查扩展应用 Origin 与回调路径；
2. 抖音/小红书最多约 60 秒尝试识别成功页、作品链接和指标；
3. 页面标题与本次草稿无法匹配时，为避免误关联可能不自动回流；
4. 尝试助手中的手动返回按钮；
5. 微博只返回触发状态，不做作品 URL 解析；
6. 回调页面应正确读取并清理 `publication_receipt`。

## 回调页收到回执但 UI 没变化

- 确认回调代码只在浏览器执行；
- 给 `parsePublicationReceipt` 加异常捕获；
- 不要在解析前清理 `location.hash`；
- 解析后再用 `history.replaceState` 清理；
- `returnMode` 是 `workspace/wizard`，不是回调 URL。

## API 健康但任务一直 `pending`

`/health` 不检查 Redis 和 Worker。检查：

1. Redis 是否监听 `localhost:6379`；
2. Worker 是否已启动并显示 `publication_review.fetch`；
3. API 与 Worker 的 `CELERY_BROKER_URL` 是否一致；
4. API 与 Worker 的 `CELERY_RESULT_BACKEND` 是否一致；
5. Worker 日志是否收到对应 task ID；
6. 防火墙、Docker 网络或端口映射是否正确。

Celery 对未知任务也可能保持 `pending`，所以必须同时看 Worker 日志。

## API 返回 CORS 错误

将 Demo Origin 显式加入 API 进程：

```bash
export REVIEW_ALLOWED_ORIGINS=http://localhost:4173
```

多个 Origin 用逗号分隔。CORS 不是认证，不要用 `*` 替代身份验证。

## API 和 Worker 看到不同的复盘数据

相对路径 `./data/reviews.sqlite3` 取决于进程工作目录。API 与 Worker 必须：

- 从同一个 `backend/` 目录启动；或
- 使用同一个绝对 `REVIEW_DATABASE_PATH`。

如果进程位于不同容器，必须挂载共享文件；生产环境建议直接使用 PostgreSQL。

## 幂等请求返回 `409`

同一个 `Idempotency-Key` 已用于另一平台或作品。为新业务操作生成新 Key；不要通过清库来掩盖调用方复用错误。

## RedFox Worker 启动失败

当前配置要求：

```text
REVIEW_PROVIDER=redfox
REDFOX_ENABLED=true
REDFOX_API_KEY 非空
抖音 Endpoint 为 HTTPS
小红书 Endpoint 为 HTTPS
超时在 1–60 秒
```

即使只测试一个平台，目前也要同时配置两个 Endpoint。环境变量只给 Worker，修改后重启 Worker。

## RedFox 返回 401/403、429、5xx 或超时

- 401/403：确认 Key 有效、环境变量没有多余空格；
- 429：减少刷新频率并遵守供应商配额；
- 5xx/超时：检查供应商状态、固定 Endpoint 和网络；
- 不要在日志、Issue 或截图中公开 Key；
- 当前参考任务的重试分类并不完整，生产化前应补充 HTTPX 异常映射和有界重试。

## 小红书短链接无法识别

后端不会跟随用户输入 URL 的重定向，因此某些 `xhslink.com` 短链接无法直接得到作品 ID。请在浏览器打开短链接后，复制最终的 `xiaohongshu.com/explore/...` 官方地址或直接填写作品 ID。

## 如何报告平台适配失效

Issue 中请提供：

- 平台和页面类型；
- 浏览器版本、扩展 commit；
- 失败发生在哪个状态；
- 已脱敏的 DOM 结构或最小合成 fixture；
- 是否存在多个同名按钮；
- 手动操作是否能完成。

不要提交平台 Cookie、账号昵称、真实作品数据、截图中的个人信息或供应商响应原文。
