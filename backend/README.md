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

## 对外服务函数

`parse_reference`、`WorkDetailProvider.fetch`、`ReviewRepository.save_snapshot` 与 `ReviewRepository.reserve_job` 是主要复用点。

## 依赖

FastAPI、Celery/Redis、HTTPX、Pydantic；SQLite 仅用于可运行参考。

## 红线

RedFox Key 只注入 Worker；用户链接只做官方域名解析；API 不接受客户端伪造的 Provider 指标；真实供应商调用不进入普通测试。
