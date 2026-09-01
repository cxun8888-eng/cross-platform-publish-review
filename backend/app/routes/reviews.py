from hashlib import sha256
from typing import Literal
from uuid import uuid4

from celery.result import AsyncResult
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.celery_app import celery_app
from app.domain import parse_reference
from app.repository import ReviewRepository
from app.settings import Settings
from app.tasks import fetch_review

router = APIRouter(prefix="/api/v1", tags=["publication-review"])


class FetchReviewIn(BaseModel):
    platform: Literal["douyin", "xiaohongshu"]
    value: str = Field(min_length=8, max_length=2048)


@router.post("/review-fetch-jobs", status_code=status.HTTP_202_ACCEPTED)
def create_fetch_job(body: FetchReviewIn, x_scope_id: str = Header(default="demo", max_length=128), idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=128)) -> dict[str, str]:
    reference = parse_reference(body.platform, body.value)
    request_hash = sha256(f"{body.platform}:{reference.work_id}".encode()).hexdigest()
    repository = ReviewRepository(Settings.from_env().database_path)
    try:
        job_id, created = repository.reserve_job(x_scope_id, idempotency_key, request_hash, uuid4().hex)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if created:
        fetch_review.apply_async(args=[x_scope_id, body.platform, body.value], task_id=job_id)
    return {"job_id": job_id, "status": "pending" if created else "replayed"}


@router.get("/review-fetch-jobs/{job_id}")
def get_fetch_job(job_id: str) -> dict[str, object]:
    if len(job_id) != 32 or any(char not in "0123456789abcdef" for char in job_id):
        raise HTTPException(status_code=404, detail="任务不存在")
    result = AsyncResult(job_id, app=celery_app)
    payload: dict[str, object] = {"job_id": job_id, "status": result.state.lower()}
    if result.successful():
        payload["review"] = result.result
    elif result.failed():
        payload["error"] = "查询失败，请检查 Provider 配置或稍后重试"
    return payload


@router.get("/publication-reviews")
def list_reviews(x_scope_id: str = Header(default="demo", max_length=128)) -> dict[str, object]:
    return {"items": ReviewRepository(Settings.from_env().database_path).list(x_scope_id)}
