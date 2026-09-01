from dataclasses import dataclass
import os


def _enabled(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """运行配置；真实供应商密钥只允许由 Worker 进程读取。"""

    provider: str = "mock"
    redfox_enabled: bool = False
    redfox_api_key: str = ""
    redfox_douyin_url: str = ""
    redfox_xiaohongshu_url: str = ""
    redfox_timeout_seconds: float = 30.0
    database_path: str = "./data/reviews.sqlite3"
    broker_url: str = "redis://localhost:6379/0"
    result_backend: str = "redis://localhost:6379/1"
    allowed_origins: tuple[str, ...] = ("http://localhost:4173",)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            provider=os.getenv("REVIEW_PROVIDER", "mock").strip().lower(),
            redfox_enabled=_enabled("REDFOX_ENABLED"),
            redfox_api_key=os.getenv("REDFOX_API_KEY", ""),
            redfox_douyin_url=os.getenv("REDFOX_DOUYIN_WORK_DETAIL_URL", ""),
            redfox_xiaohongshu_url=os.getenv("REDFOX_XIAOHONGSHU_WORK_DETAIL_URL", ""),
            redfox_timeout_seconds=float(os.getenv("REDFOX_TIMEOUT_SECONDS", "30")),
            database_path=os.getenv("REVIEW_DATABASE_PATH", "./data/reviews.sqlite3"),
            broker_url=os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
            result_backend=os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1"),
            allowed_origins=tuple(origin.strip() for origin in os.getenv("REVIEW_ALLOWED_ORIGINS", "http://localhost:4173").split(",") if origin.strip()),
        )

    def validate_worker(self) -> None:
        if self.provider not in {"mock", "redfox"}:
            raise RuntimeError("REVIEW_PROVIDER 仅支持 mock 或 redfox")
        if self.provider == "redfox":
            if not self.redfox_enabled or not self.redfox_api_key.strip():
                raise RuntimeError("RedFox Provider 默认关闭；启用时必须在 Worker 环境配置 API Key")
            if not self.redfox_douyin_url or not self.redfox_xiaohongshu_url:
                raise RuntimeError("RedFox Provider 地址必须由部署者配置")
        if not 1 <= self.redfox_timeout_seconds <= 60:
            raise RuntimeError("REDFOX_TIMEOUT_SECONDS 必须在 1 到 60 之间")
