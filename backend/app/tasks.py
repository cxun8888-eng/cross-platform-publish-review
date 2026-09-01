import asyncio

from app.celery_app import celery_app
from app.domain import parse_reference
from app.providers.mock import MockWorkDetailProvider
from app.providers.redfox import RedFoxWorkDetailProvider
from app.repository import ReviewRepository
from app.settings import Settings


@celery_app.task(name="publication_review.fetch", autoretry_for=(TimeoutError,), retry_backoff=True, max_retries=2)
def fetch_review(scope_id: str, platform: str, value: str) -> dict[str, object]:
    """Worker 查询供应商并直接持久化快照，避免前端二次保存丢数据。"""
    if platform not in {"douyin", "xiaohongshu"}:
        raise ValueError("不支持的平台")
    settings = Settings.from_env()
    settings.validate_worker()
    reference = parse_reference(platform, value)  # type: ignore[arg-type]
    provider = RedFoxWorkDetailProvider(settings) if settings.provider == "redfox" else MockWorkDetailProvider()
    detail = asyncio.run(provider.fetch(reference))
    return ReviewRepository(settings.database_path).save_snapshot(scope_id, detail)
