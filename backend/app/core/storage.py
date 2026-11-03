"""Secure local object storage used by drawings and measurement reports."""

from __future__ import annotations

import asyncio
import os
import secrets
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from app.core.config import get_settings


class StorageValidationError(ValueError):
    pass


def _root() -> Path:
    configured = get_settings().storage_root.expanduser().absolute()
    if configured.is_symlink():
        raise StorageValidationError("storage root must not be a symbolic link")
    configured.mkdir(parents=True, exist_ok=True)
    root = configured.resolve(strict=True)
    if configured.is_symlink() or not root.is_dir():
        raise StorageValidationError("invalid storage root")
    return root


def _parts(key: str) -> tuple[str, ...]:
    if not key or "\\" in key or "\x00" in key:
        raise StorageValidationError("invalid storage key")
    path = PurePosixPath(key)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise StorageValidationError("invalid storage key")
    return path.parts


def _safe_path(key: str, *, create_parents: bool = False) -> Path:
    root = _root()
    parts = _parts(key)
    current = root
    for part in parts[:-1]:
        current = current / part
        if current.exists() or current.is_symlink():
            if current.is_symlink() or not current.is_dir():
                raise StorageValidationError("storage path crosses a symbolic link")
        elif create_parents:
            current.mkdir()
        else:
            return current / parts[-1]
    target = current / parts[-1]
    if target.is_symlink():
        raise StorageValidationError("symbolic-link objects are not allowed")
    try:
        target.resolve(strict=False).relative_to(root)
    except ValueError as exc:
        raise StorageValidationError("storage path escapes its root") from exc
    return target


def validate_pdf(content: bytes, content_type: str = "application/pdf") -> None:
    if content_type != "application/pdf":
        raise StorageValidationError("only PDF files are supported")
    if len(content) > get_settings().max_pdf_bytes:
        raise StorageValidationError("PDF exceeds the configured size limit")
    if not content.startswith(b"%PDF-"):
        raise StorageValidationError("file content is not a PDF")


def _put_sync(key: str, content: bytes, content_type: str) -> None:
    validate_pdf(content, content_type)
    target = _safe_path(key, create_parents=True)
    parent = target.parent
    temp = parent / f".{target.name}.{secrets.token_hex(8)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temp, flags, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        # Revalidate after writing so a replaced parent symlink is never followed.
        if _safe_path(key, create_parents=False).parent != parent:
            raise StorageValidationError("storage path changed during write")
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


async def put_object(key: str, content: bytes, content_type: str) -> None:
    await asyncio.to_thread(_put_sync, key, content, content_type)


def _delete_sync(key: str) -> None:
    path = _safe_path(key)
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise StorageValidationError("invalid stored object")
        path.unlink()


async def delete_object(key: str) -> None:
    await asyncio.to_thread(_delete_sync, key)


def _get_sync(key: str) -> bytes | None:
    path = _safe_path(key)
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file():
        raise StorageValidationError("invalid stored object")
    if path.stat().st_size > get_settings().max_pdf_bytes:
        raise StorageValidationError("stored PDF exceeds the configured size limit")
    data = path.read_bytes()
    validate_pdf(data, "application/pdf")
    return data


async def get_object(key: str) -> bytes | None:
    return await asyncio.to_thread(_get_sync, key)


def _list_sync(prefix: str) -> list[str]:
    prefix_parts = _parts(prefix.rstrip("/"))
    base_key = "/".join(prefix_parts)
    base = _safe_path(f"{base_key}/placeholder").parent
    if not base.exists():
        return []
    if base.is_symlink() or not base.is_dir():
        raise StorageValidationError("invalid storage prefix")
    root = _root()
    result: list[str] = []
    for entry in base.iterdir():
        if entry.is_symlink():
            continue
        if entry.is_file():
            result.append(entry.relative_to(root).as_posix())
    return sorted(result)


async def list_keys(prefix: str) -> list[str]:
    return await asyncio.to_thread(_list_sync, prefix)


async def presigned_get_url(key: str) -> str:
    _parts(key)
    return f"/api/files/{quote(key, safe='/')}"
