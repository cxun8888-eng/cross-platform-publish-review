from __future__ import annotations

import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from app.domain import WorkDetail


class ReviewRepository:
    """SQLite 参考仓储；宿主项目可替换为 PostgreSQL 实现而不改 Provider。"""

    def __init__(self, path: str) -> None:
        self._path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)

    def initialize(self) -> None:
        with sqlite3.connect(self._path) as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS publication_review (
              id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, platform TEXT NOT NULL,
              work_id TEXT NOT NULL, detail_json TEXT NOT NULL, latest_captured_at TEXT NOT NULL,
              UNIQUE(scope_id, platform, work_id)
            );
            CREATE TABLE IF NOT EXISTS publication_review_snapshot (
              review_id TEXT NOT NULL, captured_at TEXT NOT NULL, metrics_json TEXT NOT NULL,
              PRIMARY KEY(review_id, captured_at),
              FOREIGN KEY(review_id) REFERENCES publication_review(id)
            );
            CREATE TABLE IF NOT EXISTS publication_review_fetch_job (
              job_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
              request_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(scope_id, idempotency_key)
            );
            """)

    def reserve_job(self, scope_id: str, idempotency_key: str, request_hash: str, job_id: str) -> tuple[str, bool]:
        """原子保留幂等键；同键不同请求会明确冲突。"""
        self.initialize()
        with sqlite3.connect(self._path) as db:
            try:
                db.execute("INSERT INTO publication_review_fetch_job(job_id, scope_id, idempotency_key, request_hash) VALUES (?, ?, ?, ?)", (job_id, scope_id, idempotency_key, request_hash))
                db.commit()
                return job_id, True
            except sqlite3.IntegrityError:
                row = db.execute("SELECT job_id, request_hash FROM publication_review_fetch_job WHERE scope_id=? AND idempotency_key=?", (scope_id, idempotency_key)).fetchone()
                if not row or row[1] != request_hash:
                    raise ValueError("同一 Idempotency-Key 不能用于不同请求") from None
                return str(row[0]), False

    def save_snapshot(self, scope_id: str, detail: WorkDetail) -> dict[str, object]:
        self.initialize()
        with sqlite3.connect(self._path) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT id, latest_captured_at FROM publication_review WHERE scope_id=? AND platform=? AND work_id=?", (scope_id, detail.platform, detail.work_id)).fetchone()
            review_id = str(row["id"]) if row else str(uuid4())
            if not row:
                db.execute("INSERT INTO publication_review VALUES (?, ?, ?, ?, ?, ?)", (review_id, scope_id, detail.platform, detail.work_id, json.dumps(detail.to_dict(), ensure_ascii=False), detail.captured_at))
            elif detail.captured_at >= str(row["latest_captured_at"]):
                db.execute("UPDATE publication_review SET detail_json=?, latest_captured_at=? WHERE id=?", (json.dumps(detail.to_dict(), ensure_ascii=False), detail.captured_at, review_id))
            db.execute("INSERT OR IGNORE INTO publication_review_snapshot VALUES (?, ?, ?)", (review_id, detail.captured_at, json.dumps(detail.metrics, ensure_ascii=False)))
            db.commit()
        return {"id": review_id, "scope_id": scope_id, **detail.to_dict()}

    def list(self, scope_id: str) -> list[dict[str, object]]:
        self.initialize()
        with sqlite3.connect(self._path) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT id, detail_json FROM publication_review WHERE scope_id=? ORDER BY latest_captured_at DESC", (scope_id,)).fetchall()
        return [{"id": row["id"], "scope_id": scope_id, **json.loads(row["detail_json"])} for row in rows]
