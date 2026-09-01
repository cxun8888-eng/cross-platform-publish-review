# Review API

## 职责

接受抖音/小红书官方链接或 ID，创建 Celery 任务，通过可替换 Provider 获取详情，并保存作品与不可变指标快照。

## 数据表

参考仓储使用 `publication_review`、`publication_review_snapshot`、`publication_review_fetch_job` 三张 SQLite 表。生产环境建议换为 PostgreSQL 并保留相同唯一约束。

## 对外 API

- `POST /api/v1/review-fetch-jobs`
- `GET /api/v1/review-fetch-jobs/{job_id}`
- `GET /api/v1/publication-reviews`
- `GET /health`

详细 Header、请求体、响应和 curl 示例见 [API 参考](../docs/api-reference.md)。FastAPI 本地 Swagger 地址为 `http://localhost:8000/docs`。

## 对外服务函数

`parse_reference`、`WorkDetailProvider.fetch`、`ReviewRepository.save_snapshot` 与 `ReviewRepository.reserve_job` 是主要复用点。

## 依赖

FastAPI、Celery/Redis、HTTPX、Pydantic；SQLite 仅用于可运行参考。

## 本地启动

项目不会自动读取 `.env`，以下默认 Mock 配置无需环境变量。先安装：

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
```

分别使用三个终端：

```bash
docker run --rm --name publish-review-redis -p 6379:6379 redis:7-alpine
```

```bash
cd backend
. .venv/bin/activate
celery -A app.celery_app.celery_app worker --loglevel=INFO
```

```bash
cd backend
. .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

API 与 Worker 必须从同一目录启动，或显式使用相同的绝对 `REVIEW_DATABASE_PATH`。

## 红线

RedFox Key 只注入 Worker；用户链接只做官方域名解析；API 不接受客户端伪造的 Provider 指标；真实供应商调用不进入普通测试。

示例 `X-Scope-Id` 不是身份认证，Job 查询也没有完整作用域授权。不要把当前 SQLite 参考服务直接暴露到公网。生产化要求见[宿主项目接入指南](../docs/integration-guide.md#9-生产化检查清单)。
