import httpx
import pytest

from app.domain import WorkReference
from app.providers.redfox import RedFoxWorkDetailProvider
from app.settings import Settings


@pytest.mark.asyncio
async def test_key_stays_in_header_and_zero_metric_is_preserved() -> None:
    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("REDFOX_API_KEY")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"code": 2000, "data": {"workId": "123456789", "likeCount": 0, "commentCount": 3}})

    settings = Settings(provider="redfox", redfox_enabled=True, redfox_api_key="dummy-redfox-key", redfox_douyin_url="https://provider.example/douyin", redfox_xiaohongshu_url="https://provider.example/xhs")
    provider = RedFoxWorkDetailProvider(settings, transport=httpx.MockTransport(handler))
    result = await provider.fetch(WorkReference(platform="douyin", work_id="123456789", work_url="https://www.douyin.com/video/123456789"))
    assert seen == {"key": "dummy-redfox-key", "url": "https://provider.example/douyin"}
    assert result.metrics["likes"] == 0


def test_redfox_fails_closed_without_key() -> None:
    with pytest.raises(RuntimeError):
        RedFoxWorkDetailProvider(Settings(provider="redfox", redfox_enabled=True, redfox_api_key="", redfox_douyin_url="https://provider.example/douyin", redfox_xiaohongshu_url="https://provider.example/xhs"))
