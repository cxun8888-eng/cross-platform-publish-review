from app.domain import WorkDetail, WorkReference, now_iso


class MockWorkDetailProvider:
    """无需密钥的可重复演示 Provider。"""

    async def fetch(self, reference: WorkReference) -> WorkDetail:
        seed = sum(ord(char) for char in reference.work_id)
        likes = 80 + seed % 900
        return WorkDetail(
            platform=reference.platform,
            work_id=reference.work_id,
            work_url=reference.work_url,
            title="示例作品：城市里的慢旅行",
            content="这是由 Mock Provider 返回的虚构内容。",
            cover_url=None,
            published_at=None,
            captured_at=now_iso(),
            metrics={"likes": likes, "comments": likes // 12, "collects": likes // 7, "shares": likes // 20},
        )
