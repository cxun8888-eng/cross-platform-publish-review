from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.reviews import router
from app.settings import Settings

app = FastAPI(title="Cross-platform Publish Review API", version="0.1.0")
settings = Settings.from_env()
app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Idempotency-Key", "X-Scope-Id"])
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}
