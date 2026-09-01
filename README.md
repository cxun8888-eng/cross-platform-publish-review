# Cross-platform Publish Review

可复用的“多平台辅助发布 + 作品复盘”参考实现。宿主应用不嵌入第三方发布页，而是通过浏览器扩展把公开文案交接到抖音、小红书、微博官方页面；用户完成素材选择和平台校验后，扩展将最小化回执带回宿主应用。抖音、小红书还可通过服务端 Provider 按作品链接创建复盘快照。

> 这不是全自动发布工具，不保证平台最终发布成功。验证码、风控、账号设置和最终结果以官方页面为准。

## 能力矩阵

| 平台 | 文案辅助填充 | 用户确认后触发 | 回执 | 手动链接复盘 |
| --- | --- | --- | --- | --- |
| 抖音 | 支持 | 支持 | 尽力获取公开链接/可见指标 | Mock / RedFox Provider |
| 小红书 | 支持 | 支持 | 尽力获取公开链接/可见指标 | Mock / RedFox Provider |
| 微博 | 支持 | 支持 | 仅 `triggered`，不宣称发布成功 | 暂不支持 |

目前面向 Chrome / Edge Manifest V3。Firefox、Safari、自动上传本地文件、绕过平台校验均不在范围内。

## 为什么不是 iframe

```text
宿主应用 Draft
  → URL fragment（公开文案，不进平台服务器日志）
  → 浏览器扩展在官方页面辅助填充
  → 用户选择素材、核对并明确确认
  → 官方页面处理发布
  → fragment 回执返回宿主应用
  → Worker 按作品链接创建复盘快照
```

第三方创作者平台通常通过 CSP、登录态和风控限制嵌入，所以这里使用浏览器级交接。

## 目录

```text
browser-extension/   Chrome / Edge 发布桥接扩展
packages/protocol/   草稿交接与发布回执 TypeScript 契约
backend/             FastAPI + Celery + Provider + 快照仓储
web-demo/            无框架宿主应用演示
docs/                架构、安全和平台适配说明
```

## 快速启动

### 构建协议包和扩展

```bash
npm install
npm run build
npm test
```

在 Chrome/Edge 扩展管理页开启开发者模式，选择“加载已解压的扩展程序”，目录指向 `browser-extension/`。在扩展弹窗配置宿主应用地址和回调路径。

### 启动 Web Demo

```bash
python3 -m http.server 4173 --directory web-demo
```

打开 `http://localhost:4173`。扩展回流时会在当前标签返回 Demo。

### 启动复盘 API（默认 Mock）

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
redis-server
celery -A app.celery_app.celery_app worker --loglevel=INFO
uvicorn app.main:app --reload
```

Mock 模式不需要密钥。API 使用 `202 + Job`；Worker 获取详情后直接写作品记录与不可变快照，前端无需二次提交供应商数据。

## RedFox 手动链接查询

RedFox 只是一种 `WorkDetailProvider`，不参与发布。部署者在 Worker 环境注入：

```dotenv
REVIEW_PROVIDER=redfox
REDFOX_ENABLED=true
REDFOX_API_KEY=
REDFOX_DOUYIN_WORK_DETAIL_URL=
REDFOX_XIAOHONGSHU_WORK_DETAIL_URL=
```

- 默认禁用真实 Provider，仓库中的 Key 永远为空。
- Key 只进入 Worker 到固定 HTTPS 地址的 `REDFOX_API_KEY` 请求头，不进入前端、扩展、数据库、任务结果或日志。
- 每个部署者使用自己的合法 Key，并自行确认 RedFox 条款是否允许其使用场景、缓存与二次展示。
- URL 不提供默认值，避免把未经确认的供应商端点作为公共契约。

## 安全边界

- 不读取 Cookie、密码或平台账号凭据。
- 只打开系统文件选择器，不读取或自动选择本地文件。
- 最终平台动作必须来自用户确认。
- `debugger` 是可选权限，只在用户触发增强点击时申请，一次操作后立即 detach。
- 没有 `<all_urls>`、`cookies` 或 `webRequest` 权限。
- 回调目标只能是用户预先保存的 HTTPS Origin（本地允许 localhost HTTP）和固定路径。
- 服务端只解析官方作品 URL 并提取 ID，不请求用户输入的 URL，避免 SSRF。

详见 [安全模型](docs/security-model.md) 和 [隐私说明](PRIVACY.md)。

## 接入自己的项目

1. 用 `@publish-review/protocol` 生成 `publish_review_draft` fragment。
2. 配置可信应用 Origin 与固定回调路径。
3. 回调页解析 `publication_receipt` 后立即清理 fragment。
4. 把示例 `X-Scope-Id` 换成服务端认证得到的作用域。
5. 生产环境将 SQLite 替换为 PostgreSQL，保留作品唯一约束与不可变快照。
6. 真实数据商只在 Worker 注册，API/Web/扩展不持有 Key。

平台 DOM 和流程会变化。检测不到唯一、可见、可用的目标时扩展会停止，不会猜测点击。详见 [平台适配指南](docs/platform-adapters.md)。

## 测试

```bash
npm test
cd backend && pytest
```

真实 RedFox 查询不进入普通测试。

## 法律与许可证

本项目与抖音、小红书、微博、RedFox 及其运营主体没有隶属、合作、赞助或背书关系。平台名称仅用于描述兼容性。使用者必须遵守平台规则、法律与供应商合同。详见 [TRADEMARKS.md](TRADEMARKS.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

代码采用 [Apache License 2.0](LICENSE)，不授予任何第三方商标权，也不改变第三方服务条款。
