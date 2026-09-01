from dataclasses import replace

import pytest

from app.domain import WorkDetail
from app.repository import ReviewRepository


def detail(captured_at: str, likes: int) -> WorkDetail:
    return WorkDetail(platform="douyin", work_id="123456789", work_url="https://www.douyin.com/video/123456789", title="示例", content="", cover_url=None, published_at=None, captured_at=captured_at, metrics={"likes": likes})


def test_snapshot_append_and_out_of_order_does_not_replace_latest(tmp_path) -> None:
    repository = ReviewRepository(str(tmp_path / "reviews.sqlite3"))
    repository.save_snapshot("scope-a", detail("2026-09-01T02:00:00+00:00", 20))
    repository.save_snapshot("scope-a", detail("2026-09-01T01:00:00+00:00", 10))
    assert repository.list("scope-a")[0]["metrics"]["likes"] == 20


def test_idempotency_key_conflicts_on_different_request(tmp_path) -> None:
    repository = ReviewRepository(str(tmp_path / "reviews.sqlite3"))
    assert repository.reserve_job("scope", "same-key", "hash-a", "job-a") == ("job-a", True)
    assert repository.reserve_job("scope", "same-key", "hash-a", "job-b") == ("job-a", False)
    with pytest.raises(ValueError):
        repository.reserve_job("scope", "same-key", "hash-b", "job-c")
