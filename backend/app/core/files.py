from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.core import storage

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("/{key:path}")
async def download_file(key: str) -> Response:
    try:
        data = await storage.get_object(key)
    except storage.StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if data is None:
        raise HTTPException(status_code=404, detail="arquivo não encontrado")
    filename = key.rsplit("/", 1)[-1]
    safe_filename = filename.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{safe_filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
