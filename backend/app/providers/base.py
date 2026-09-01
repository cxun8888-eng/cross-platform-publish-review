from typing import Protocol

from app.domain import WorkDetail, WorkReference


class WorkDetailProvider(Protocol):
    """供应商端口；领域层不依赖任何具体数据商。"""

    async def fetch(self, reference: WorkReference) -> WorkDetail: ...
