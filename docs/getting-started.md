# 从零跑通一次发布与复盘

本指南面向第一次使用仓库的人。完成后你将能够：

1. 构建并安装 Chrome/Edge 扩展；
2. 从 Web Demo 把一份草稿带到官方发布页；
3. 在用户确认后返回宿主页面；
4. 使用 Mock Provider 创建一条作品复盘快照。

整个体验不需要 RedFox API Key，也不会真实自动发布任何作品。是否最终提交由你在官方平台页面确认。

## 1. 环境要求

| 软件 | 最低建议版本 | 用途 |
| --- | --- | --- |
| Git | 2.40+ | 克隆仓库 |
| Node.js | 20+ | 构建协议包和扩展 |
| npm | 10+ | 安装 Node 依赖 |
| Chrome / Edge | 102+ | 加载 Manifest V3 扩展 |
| Python | 3.11+ | 运行 Demo 静态服务和复盘 API |
| Redis | 7+ | Celery broker 与结果后端 |

还需要对应平台的测试账号。请先确认账号能正常进入抖音创作者中心、小红书创作服务平台或微博首页。

## 2. 克隆与构建

```bash
git clone https://github.com/cxun8888-eng/cross-platform-publish-review.git
cd cross-platform-publish-review
npm install
npm run build
```

成功后会生成两个未纳入 Git 的目录：

- `packages/protocol/dist/`
- `browser-extension/dist/`

如果 `browser-extension/dist/` 不存在，浏览器会提示 manifest 引用的脚本缺失。

## 3. 安装浏览器扩展

Chrome：

1. 打开 `chrome://extensions/`；
2. 开启右上角“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择仓库中的 `browser-extension/`，不是 `browser-extension/dist/`；
5. 将 PublishLoop 固定到浏览器工具栏。

扩展卡片应显示“PublishLoop｜多平台发布与作品复盘助手”。如果仍显示“文数智旅”或“旅策”，请移除旧扩展并确认重新加载的是本仓库的 `browser-extension/` 根目录。

Edge 将第一步替换为 `edge://extensions/`，其余相同。

更详细的权限解释与更新方式见[浏览器扩展使用指南](browser-extension-guide.md)。

## 4. 启动宿主 Demo

在仓库根目录运行：

```bash
python3 -m http.server 4173 --directory web-demo
```

浏览器打开：

```text
http://localhost:4173
```

不要直接双击 `web-demo/index.html`。`file://` 地址不能作为扩展允许的本地应用 Origin。

## 5. 配置扩展回调

点击浏览器工具栏中的扩展图标，填写：

| 字段 | 本地 Demo 值 | 说明 |
| --- | --- | --- |
| 应用地址 | `http://localhost:4173` | 只保存 Origin，不包含业务路径 |
| 回调路径 | `/index.html` | 发布完成后返回的站内路径 |

点击“保存设置”。本地开发只允许 `localhost` 或 `127.0.0.1` 使用 HTTP；远程应用必须使用 HTTPS。

## 6. 跑通一次辅助发布

1. 回到 Web Demo，修改示例标题、正文和标签；
2. 点击抖音、小红书或微博卡片；
3. 当前标签会进入对应官方页面；
4. 如果平台要求登录，先完成官方登录；
5. 按页面右侧 PublishLoop 的提示手动选择图片；
6. 检查标题、正文、素材、账号和平台设置；
7. 只有确认无误后才点击助手中的“确认并发布”；
8. 完成平台验证码或二次校验；
9. 抖音/小红书会尽力识别公开作品链接和可见指标，然后在当前标签返回 Demo；微博只返回“已触发发送”。

返回 Demo 后，页面底部会显示 `publication_receipt` 的解析结果。页面读取后会立即清理地址栏 fragment。

### 不想真实发布怎么办

可以在第 6 步停止。草稿填充、素材入口和助手状态机已经得到验证；只要不点击最终确认，扩展不会替你提交作品。

## 7. 启动 Mock 作品复盘

复盘链路包含 API、Celery Worker 和 Redis，需要三个终端。

终端 A：启动 Redis。

```bash
docker run --rm --name publish-review-redis -p 6379:6379 redis:7-alpine
```

终端 B：创建 Python 环境并启动 Worker。

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
celery -A app.celery_app.celery_app worker --loglevel=INFO
```

终端 C：使用同一 Python 环境启动 API。

```bash
cd backend
. .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

检查健康状态：

```bash
curl http://localhost:8000/health
```

预期响应：

```json
{"status":"healthy"}
```

## 8. 创建第一条复盘记录

回到 Web Demo 的“手动复盘”区域：

1. 选择抖音或小红书；
2. 输入平台官方作品链接或作品 ID；
3. API 地址保持 `http://localhost:8000`；
4. 点击“创建复盘任务”。

Mock Provider 不访问第三方服务，但仍会严格校验链接：

- 抖音 ID：至少 8 位数字；
- 小红书 ID：8–128 位字母、数字、下划线或连字符；
- 链接必须是仓库允许的官方 HTTPS 域名。

成功后页面会显示虚构的标题、点赞、评论和快照时间，数据保存在 `backend/data/reviews.sqlite3`。

## 9. 验收清单

- [ ] `npm run build` 成功；
- [ ] 扩展管理页没有红色错误；
- [ ] 扩展弹窗能保存应用地址和回调路径；
- [ ] 从 Demo 点击平台后，官方页面出现 PublishLoop；
- [ ] 未点击最终确认时不会提交作品；
- [ ] API `/health` 返回 `healthy`；
- [ ] Redis、Worker、API 同时运行时，复盘任务由 `pending` 进入 `success`；
- [ ] `GET /api/v1/publication-reviews` 能读取保存的记录。

遇到问题请先查看[故障排查](troubleshooting.md)。要接入自己的产品，请继续阅读[宿主项目接入指南](integration-guide.md)。
