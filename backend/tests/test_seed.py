"""PostgreSQL regressions for the additive synthetic-demo seed."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from app.core import storage
from app.sqc.models import (
    BatchStatus,
    Dim,
    DimHistory,
    Inspection,
    InspectionIgnoreHistory,
    Part,
    SqcBatch,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.postgres]


@pytest.fixture
async def seeded_demo(
    db_connection: AsyncConnection,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    from app import seed as seed_module

    storage_root = tmp_path / "seed-storage"
    session_factory = async_sessionmaker(
        bind=db_connection,
        class_=AsyncSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    monkeypatch.setattr(storage, "_root", lambda: _storage_root(storage_root))
    monkeypatch.setattr(seed_module, "SessionFactory", session_factory)
    return seed_module, session_factory


def _storage_root(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


async def _counts(session: AsyncSession) -> dict[str, int]:
    models = {
        "parts": Part,
        "dimensions": Dim,
        "batches": SqcBatch,
        "inspections": Inspection,
        "dim_history": DimHistory,
        "ignore_history": InspectionIgnoreHistory,
    }
    return {
        name: await session.scalar(select(func.count()).select_from(model)) or 0
        for name, model in models.items()
    }


async def test_reapplication_is_insert_only_and_preserves_existing_state(seeded_demo) -> None:
    seed_module, session_factory = seeded_demo
    # 30 X-bar + 7 unilateral + 24 MMC/LMC + 24 positional + 20 + 20 NQA + 8 short.
    assert len(seed_module._inspection_rows()) == 30 + 7 + 24 + 24 + 20 + 20 + 8 == 133
    first = await seed_module.seed()

    ignored_id = seed_module._id(
        f"inspection:{seed_module.BATCH_XBAR}:{seed_module.D_UNILATERAL}:1:1"
    )
    extra_part_id = seed_module._id("test:extra-part")
    async with session_factory.begin() as session:
        batch = await session.get(SqcBatch, seed_module.BATCH_XBAR)
        dim = await session.get(Dim, seed_module.D_BILATERAL)
        ignored = await session.get(Inspection, ignored_id)
        assert batch is not None and dim is not None and ignored is not None

        batch.batch_status = BatchStatus.REJECTED
        batch.rejection_justification = "Decisão sintética preservada"
        dim.dim_name = "Dimensão editada pelo teste"
        dim.nominal = 50.125
        ignored.is_ignored = False
        ignored.ignored_reason = "Estado de ignore editado pelo teste"
        session.add(
            Part(
                id=extra_part_id,
                part_code="SYN-EXTRA-PRESERVED",
                description="Dado sintético adicional",
                material=None,
                process=None,
                created_at=seed_module._BASE_TIME,
            )
        )

    pdf_key = "sqc/drawings/DEMO-AURORA-100_A.pdf"
    custom_pdf = b"%PDF-1.4\n% preserved synthetic bytes\n%%EOF\n"
    storage._safe_path(pdf_key).write_bytes(custom_pdf)
    async with session_factory() as session:
        counts_before = await _counts(session)

    second = await seed_module.seed()

    assert first == {
        "instruments": 2,
        "parts": 2,
        "dimensions": 12,
        "axis_relations": 2,
        "batches": 4,
        "dim_history": 12,
        "inspections": 133,
        "ignore_history": 3,
        "pdf_files": 5,
    }
    assert second == {name: 0 for name in first}
    async with session_factory() as session:
        assert await _counts(session) == counts_before
        batch = await session.get(SqcBatch, seed_module.BATCH_XBAR)
        dim = await session.get(Dim, seed_module.D_BILATERAL)
        ignored = await session.get(Inspection, ignored_id)
        assert batch is not None and dim is not None and ignored is not None
        assert batch.batch_status is BatchStatus.REJECTED
        assert batch.rejection_justification == "Decisão sintética preservada"
        assert dim.dim_name == "Dimensão editada pelo teste"
        assert dim.nominal == 50.125
        assert ignored.is_ignored is False
        assert ignored.ignored_reason == "Estado de ignore editado pelo teste"
        assert await session.get(Part, extra_part_id) is not None
    assert await storage.get_object(pdf_key) == custom_pdf


async def test_recreates_only_missing_database_and_pdf_fixtures(seeded_demo) -> None:
    seed_module, session_factory = seeded_demo
    await seed_module.seed()

    missing_history_id = seed_module._id("ignore-history:temporary-unignore")
    async with session_factory.begin() as session:
        missing_history = await session.get(InspectionIgnoreHistory, missing_history_id)
        assert missing_history is not None
        await session.delete(missing_history)

    missing_pdf_key = f"sqc/reports/{seed_module.BATCH_NQA_SHORT}/Part 1.pdf"
    storage._safe_path(missing_pdf_key).unlink()
    preserved_pdf_key = "sqc/drawings/DEMO-BOREAL-200_A.pdf"
    preserved_pdf = b"%PDF-1.4\n% existing synthetic bytes\n%%EOF\n"
    storage._safe_path(preserved_pdf_key).write_bytes(preserved_pdf)

    reapplied = await seed_module.seed()

    assert reapplied == {
        "instruments": 0,
        "parts": 0,
        "dimensions": 0,
        "axis_relations": 0,
        "batches": 0,
        "dim_history": 0,
        "inspections": 0,
        "ignore_history": 1,
        "pdf_files": 1,
    }
    async with session_factory() as session:
        assert await session.get(InspectionIgnoreHistory, missing_history_id) is not None
    assert await storage.get_object(missing_pdf_key) == seed_module._pdf(
        "Synthetic inspection report - Boreal part 1"
    )
    assert await storage.get_object(preserved_pdf_key) == preserved_pdf
