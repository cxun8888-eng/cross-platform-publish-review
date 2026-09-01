# 作品复盘 API 参考

默认地址：`http://localhost:8000`。交互式文档：`http://localhost:8000/docs`。

## 公共请求头

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type: application/json` | POST 必填 | JSON 请求体 |
| `X-Scope-Id` | 否 | 默认 `demo`；仅为参考隔离，不是认证 |
| `Idempotency-Key` | 创建任务必填 | 1–128 字符，同一作用域内唯一 |

生产环境必须从认证身份推导 scope，删除客户端直接指定作用域的能力。

## 健康检查

```http
GET /health
```

```json
{"status":"healthy"}
```

健康检查只证明 FastAPI 进程存在，不证明 Redis、Celery Worker 或 Provider 可用。

## 创建复盘任务

```http
POST /api/v1/review-fetch-jobs
```

请求：

```bash
curl -X POST http://localhost:8000/api/v1/review-fetch-jobs \
  -H 'Content-Type: application/json' \
  -H 'X-Scope-Id: demo' \
  -H 'Idempotency-Key: first-douyin-review' \
  -d '{"platform":"douyin","value":"12345678"}'
```

字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `platform` | string | `douyin` 或 `xiaohongshu` |
| `value` | string | 8–2048 字符，官方作品链接或作品 ID |

首次创建返回 `202`：

```json
{"job_id":"0123456789abcdef0123456789abcdef","status":"pending"}
```

同一幂等键和同一作品再次请求：

```json
{"job_id":"0123456789abcdef0123456789abcdef","status":"replayed"}
```

同一作用域中，同一个幂等键用于不同作品会返回 `409`。

## 查询任务

```http
GET /api/v1/review-fetch-jobs/{job_id}
```

```bash
curl http://localhost:8000/api/v1/review-fetch-jobs/0123456789abcdef0123456789abcdef
```

常见状态来自 Celery：

| 状态 | 含义 |
| --- | --- |
| `pending` | 尚未被 Worker 接收，或结果后端没有该任务 |
| `started` | Worker 正在处理 |
| `retry` | 可重试错误后等待重试 |
| `success` | 查询与快照保存完成 |
| `failure` | 任务终止，响应只返回通用错误，不泄露 Key 或供应商原文 |

成功示例：

```json
{
  "job_id": "0123456789abcdef0123456789abcdef",
  "status": "success",
  "review": {
    "id": "f27c27f1-5d4d-45d9-a40c-253fa25738b5",
    "scope_id": "demo",
    "platform": "douyin",
    "work_id": "12345678",
    "work_url": "https://www.douyin.com/video/12345678",
    "title": "示例作品：城市里的慢旅行",
    "content": "这是由 Mock Provider 返回的虚构内容。",
    "cover_url": null,
    "published_at": null,
    "captured_at": "2026-09-01T02:00:00+00:00",
    "metrics": {"likes": 432, "comments": 36, "collects": 61, "shares": 21}
  }
}
```

Web Demo 每秒查询一次，最多约 30 秒。生产环境应改成事件推送或更低频的状态对账。

## 列出作品复盘

```http
GET /api/v1/publication-reviews
```

```bash
curl http://localhost:8000/api/v1/publication-reviews \
  -H 'X-Scope-Id: demo'
```

响应：

```json
{"items":[]}
```

列表按最新采集时间倒序。当前 API 没有分页、搜索、单条详情或删除接口。

## 输入链接规则

后端不会请求用户粘贴的 URL，只解析并规范化作品 ID：

| 平台 | 允许域名 | ID |
| --- | --- | --- |
| 抖音 | `www.douyin.com`、`m.douyin.com`、`www.iesdouyin.com` | 至少 8 位数字 |
| 小红书 | `xiaohongshu.com`、`www.xiaohongshu.com`、`xhslink.com`、`www.xhslink.com` | 8–128 位字母、数字、`_`、`-` |

只接受 HTTPS，不接受 URL 用户信息、自定义端口或非官方域名。

## 环境变量

项目不会自动读取 `.env` 文件，必须由 Shell、容器或进程管理器注入。

| 变量 | 默认值 | 进程 | 说明 |
| --- | --- | --- | --- |
| `REVIEW_PROVIDER` | `mock` | Worker | `mock` 或 `redfox` |
| `REDFOX_ENABLED` | `false` | Worker | RedFox 总开关 |
| `REDFOX_API_KEY` | 空 | Worker | 部署者自己的 Key |
| `REDFOX_DOUYIN_WORK_DETAIL_URL` | 空 | Worker | 固定 HTTPS Endpoint |
| `REDFOX_XIAOHONGSHU_WORK_DETAIL_URL` | 空 | Worker | 固定 HTTPS Endpoint |
| `REDFOX_TIMEOUT_SECONDS` | `30` | Worker | 1–60 秒 |
| `REVIEW_DATABASE_PATH` | `./data/reviews.sqlite3` | API + Worker | 二者必须指向同一数据库 |
| `CELERY_BROKER_URL` | `redis://localhost:6379/0` | API + Worker | Redis broker |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | API + Worker | 任务结果 |
| `REVIEW_ALLOWED_ORIGINS` | `http://localhost:4173` | API | 逗号分隔的 CORS Origin |

RedFox Key 不应注入 API 进程。API 只需要 broker、result backend、数据库和 CORS 配置。

## 当前错误行为

- Pydantic 请求体错误通常返回 `422`；
- 幂等键冲突返回 `409`；
- 非 32 位小写十六进制 Job ID 返回 `404`；
- Worker 失败时任务接口返回通用 `failure`；
- v0.1.0 尚未把所有领域链接校验异常统一转换成稳定的 4xx 错误码，生产接入前应补充统一异常映射。
