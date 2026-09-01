import pytest

from app.domain import parse_reference


def test_parse_official_links_and_ids() -> None:
    assert parse_reference("douyin", "1234567890123456789").work_id == "1234567890123456789"
    assert parse_reference("xiaohongshu", "https://www.xiaohongshu.com/explore/abc_DEF-123").work_id == "abc_DEF-123"


@pytest.mark.parametrize("value", ["http://www.douyin.com/video/123456789", "https://evil.example/video/123456789", "https://user@www.douyin.com/video/123456789", "https://www.douyin.com:444/video/123456789"])
def test_rejects_non_official_or_unsafe_links(value: str) -> None:
    with pytest.raises(ValueError):
        parse_reference("douyin", value)
