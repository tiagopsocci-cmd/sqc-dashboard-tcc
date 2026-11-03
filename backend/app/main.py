from fastapi import FastAPI

from app.core.files import router as files_router
from app.core.logging import configure_logging
from app.sqc.router import router as sqc_router

configure_logging()

app = FastAPI(title="SQC Dashboard API", version="1.0.0")


@app.get("/healthz", tags=["health"])
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(sqc_router)
app.include_router(files_router)
