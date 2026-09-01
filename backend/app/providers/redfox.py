from collections.abc import Mapping
from urllib.parse import urlparse

import httpx

from app.domain import WorkDetail, WorkReference, metric, now_iso
from app.settings import Settings


class RedFoxWorkDetailProvider:
    """RedFox 手动链接查询适配器；密钥只进入固定 HTTPS 请求头。"""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        settings.validate_worker()
        self._settings = settings
        self._transport = transport

    def _endpoint(self, reference: WorkReference) -> str:
        endpoint = self._settings.redfox_douyin_url if reference.platform == "douyin" else self._settings.redfox_xiaohongshu_url
        parsed = urlparse(endpoint)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise RuntimeError("RedFox 地址必须是无凭据的固定 HTTPS URL")
        return endpoint

    async def fetch(self, reference: WorkReference) -> WorkDetail:
        endpoint = self._endpoint(reference)
        body: dict[str, str] = {"workId": reference.work_id}
        if reference.work_url:
            body["workLink"] = reference.work_url
        async with httpx.AsyncClient(timeout=self._settings.redfox_timeout_seconds, transport=self._transport, trust_env=False, follow_redirects=False) as client:
            response = await client.post(endpoint, headers={"REDFOX_API_KEY": self._settings.redfox_api_key, "Content-Type": "application/json"}, json=body)
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, Mapping) or not isinstance(payload.get("data"), Mapping):
            raise RuntimeError("供应商返回格式无效")
        data = payload["data"]
        def first(*names: str) -> object:
            for name in names:
                if name in data and data[name] is not None:
                    return data[name]
            return None

        fields = {
            "likes": metric(first("likeCount", "workLikedCount")),
            "comments": metric(first("commentCount", "workCommentsCount")),
            "collects": metric(first("collectCount", "workCollectedCount")),
            "shares": metric(first("shareCount", "workSharedCount")),
            "reads": metric(first("readCount", "workReadCount")),
        }
        return WorkDetail(
            platform=reference.platform,
            work_id=str(data.get("workId") or reference.work_id),
            work_url=str(data.get("workUrl") or reference.work_url or "") or None,
            title=str(data.get("title") or data.get("workTitle") or "未命名作品")[:500],
            content=str(data.get("content") or data.get("workDesc") or "")[:10_000],
            cover_url=str(data.get("coverUrl")) if data.get("coverUrl") else None,
            published_at=str(first("publishTime", "workPublishTime")) if first("publishTime", "workPublishTime") is not None else None,
            captured_at=now_iso(),
            metrics=fields,
        )
