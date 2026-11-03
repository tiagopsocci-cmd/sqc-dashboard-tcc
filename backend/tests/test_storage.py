from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from app.core import storage
from app.core.config import Settings


@pytest.fixture
def isolated_storage(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    settings = Settings(
        database_url="postgresql+asyncpg://sqc:sqc@localhost/sqc",
        storage_root=tmp_path / "objects",
        max_pdf_bytes=256,
    )
    monkeypatch.setattr(storage, "get_settings", lambda: settings)
    return settings.storage_root


@pytest.mark.asyncio
async def test_pdf_roundtrip_and_same_origin_url(isolated_storage: Path) -> None:
    content = b"%PDF-1.4\nsynthetic\n%%EOF\n"
    await storage.put_object("sqc/drawings/demo.pdf", content, "application/pdf")

    assert await storage.get_object("sqc/drawings/demo.pdf") == content
    assert await storage.presigned_get_url("sqc/drawings/demo.pdf") == (
        "/api/files/sqc/drawings/demo.pdf"
    )
    temporary_files = await asyncio.to_thread(lambda: list(isolated_storage.rglob("*.tmp")))
    assert not temporary_files


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "key",
    ["../escape.pdf", "/absolute.pdf", "sqc/../escape.pdf", r"sqc\escape.pdf", ""],
)
async def test_rejects_unsafe_keys(isolated_storage: Path, key: str) -> None:
    with pytest.raises(storage.StorageValidationError):
        await storage.put_object(key, b"%PDF-1.4\n%%EOF", "application/pdf")


@pytest.mark.asyncio
async def test_rejects_non_pdf_and_oversized_pdf(isolated_storage: Path) -> None:
    with pytest.raises(storage.StorageValidationError, match="only PDF"):
        await storage.put_object("sqc/not-pdf.pdf", b"not a pdf", "text/plain")
    with pytest.raises(storage.StorageValidationError, match="not a PDF"):
        await storage.put_object("sqc/not-pdf.pdf", b"not a pdf", "application/pdf")
    with pytest.raises(storage.StorageValidationError, match="size limit"):
        await storage.put_object("sqc/large.pdf", b"%PDF-" + b"x" * 300, "application/pdf")


def _create_storage_symlink(storage_root: Path, outside: Path) -> None:
    storage_root.mkdir(parents=True)
    outside.mkdir()
    (storage_root / "sqc").symlink_to(outside, target_is_directory=True)


@pytest.mark.asyncio
async def test_rejects_symlink_components(isolated_storage: Path, tmp_path: Path) -> None:
    if not hasattr(os, "symlink"):
        pytest.skip("symbolic links unavailable")
    outside = tmp_path / "outside"
    try:
        await asyncio.to_thread(_create_storage_symlink, isolated_storage, outside)
    except OSError:
        pytest.skip("symbolic links are not permitted on this host")

    with pytest.raises(storage.StorageValidationError, match="symbolic link"):
        await storage.put_object("sqc/escape.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")
    assert not (outside / "escape.pdf").exists()
