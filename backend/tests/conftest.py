"""Infraestrutura segura para regressões que exigem PostgreSQL real."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlsplit

import pytest
import pytest_asyncio
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from alembic import command

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def _validated_test_database_url() -> str:
    if not _TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL é obrigatório para testes PostgreSQL")
    parsed = urlsplit(_TEST_DATABASE_URL)
    database_name = parsed.path.removeprefix("/").lower()
    if parsed.scheme != "postgresql+asyncpg":
        pytest.fail("TEST_DATABASE_URL deve usar postgresql+asyncpg")
    if "test" not in database_name:
        pytest.fail("TEST_DATABASE_URL deve apontar para um banco explicitamente de teste")
    return _TEST_DATABASE_URL


@pytest.fixture(scope="session")
def postgres_url() -> str:
    return _validated_test_database_url()


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Pula somente integrações PostgreSQL quando o banco dedicado não foi configurado."""
    if _TEST_DATABASE_URL:
        return
    skip_postgres = pytest.mark.skip(
        reason="TEST_DATABASE_URL é obrigatório para testes PostgreSQL"
    )
    for item in items:
        if item.get_closest_marker("postgres") is not None:
            item.add_marker(skip_postgres)


@pytest.fixture(scope="session", autouse=True)
def migrated_postgres(request: pytest.FixtureRequest) -> None:
    postgres_items = [
        item for item in request.session.items if item.get_closest_marker("postgres") is not None
    ]
    if postgres_items and _TEST_DATABASE_URL:
        database_url = _validated_test_database_url()
        os.environ["DATABASE_URL"] = database_url
        from app.core.config import get_settings

        get_settings.cache_clear()
        config = Config(str(_BACKEND_ROOT / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", database_url)
        command.upgrade(config, "head")


@pytest_asyncio.fixture
async def db_connection(postgres_url: str) -> AsyncIterator[AsyncConnection]:
    engine = create_async_engine(postgres_url, poolclass=NullPool)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(
        bind=db_connection,
        class_=AsyncSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def api_client(
    db_session: AsyncSession,
    tmp_path: Path,
) -> AsyncIterator[AsyncClient]:
    from app.core.config import get_settings
    from app.core.db import get_session
    from app.main import app

    os.environ["STORAGE_ROOT"] = str(tmp_path / "storage")
    get_settings.cache_clear()

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = override_get_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        get_settings.cache_clear()
