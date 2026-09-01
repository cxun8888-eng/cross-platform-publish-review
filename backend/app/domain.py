from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import math
import re
from typing import Literal, Mapping
from urllib.parse import parse_qs, urlparse

Platform = Literal["douyin", "xiaohongshu"]

DOUYIN_ID = re.compile(r"^\d{8,}$")
XHS_ID = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
DOUYIN_HOSTS = {"www.douyin.com", "m.douyin.com", "www.iesdouyin.com"}
XHS_HOSTS = {"xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "www.xhslink.com"}


@dataclass(frozen=True)
class WorkReference:
    platform: Platform
    work_id: str
    work_url: str | None


@dataclass(frozen=True)
class WorkDetail:
    platform: Platform
    work_id: str
    work_url: str | None
    title: str
    content: str
    cover_url: str | None
    published_at: str | None
    captured_at: str
    metrics: dict[str, int | float | None]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def parse_reference(platform: Platform, value: str) -> WorkReference:
    """只接受作品 ID 或平台官方 HTTPS 链接，避免把用户输入变成 SSRF 目标。"""
    raw = value.strip()
    pattern = DOUYIN_ID if platform == "douyin" else XHS_ID
    if pattern.fullmatch(raw):
        url = f"https://www.douyin.com/video/{raw}" if platform == "douyin" else f"https://www.xiaohongshu.com/explore/{raw}"
        return WorkReference(platform=platform, work_id=raw, work_url=url)
    parsed = urlparse(raw)
    hosts = DOUYIN_HOSTS if platform == "douyin" else XHS_HOSTS
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password or parsed.port:
        raise ValueError("请输入作品 ID 或平台官方 HTTPS 链接")
    parts = [part for part in parsed.path.split("/") if part]
    query = parse_qs(parsed.query)
    if platform == "douyin":
        candidate = parts[1] if len(parts) > 1 and parts[0] in {"video", "note"} else (query.get("modal_id") or query.get("video_id") or [None])[0]
    else:
        candidate = parts[2] if len(parts) > 2 and parts[:2] == ["discovery", "item"] else parts[1] if len(parts) > 1 and parts[0] in {"explore", "item"} else (query.get("note_id") or query.get("feed_id") or [None])[0]
    if not isinstance(candidate, str) or not pattern.fullmatch(candidate):
        raise ValueError("无法从官方链接识别作品 ID")
    canonical = f"https://www.douyin.com/video/{candidate}" if platform == "douyin" else f"https://www.xiaohongshu.com/explore/{candidate}"
    return WorkReference(platform=platform, work_id=candidate, work_url=canonical)


def metric(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return value


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
