from __future__ import annotations

import asyncio
import io
import uuid
import zipfile
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core import storage
from app.sqc import service
from app.sqc.models import (
    BatchStatus,
    Dim,
    DimAxis,
    DimAxisRelation,
    DimHistory,
    DimSubType,
    DimType,
    Inspection,
    InspectionIgnoreHistory,
    MaterialModifier,
    ZoneGeometry,
)

from .factories import make_batch, make_dim, make_inspection, make_part

pytestmark = pytest.mark.postgres


def _dims_csv(*rows: str) -> bytes:
    header = (
        "dim_code,nominal,tol_plus,tol_minus,type,sub_type,drawing_revision,dim_name,"
        "parent_dim_code,dim_rel_1_code,dim_rel_2_code,material_modifier,"
        "position_geometry,coordinate_axis,related_size_dim_code\n"
    )
    return (header + "\n".join(rows) + "\n").encode()


async def test_import_dims_preview_is_read_only_and_confirm_is_exact_diff(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    existing = await make_dim(db_session, part, code="D-OLD", nominal=10.0)
    await make_inspection(
        db_session, await make_batch(db_session, part), existing, part_number=1, measured_value=10.2
    )
    csv = _dims_csv(
        "D-OLD,11,0.5,0.5,DISTANCE,NONE,B,Atualizada,,,,,,",
        "D-NEW,5,0.2,0,DISTANCE,NONE,A,Nova,,,,,,",
    )

    before_dims = await db_session.scalar(select(func.count()).select_from(Dim))
    before_history = await db_session.scalar(select(func.count()).select_from(DimHistory))
    preview = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims-preview",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert preview.status_code == 200
    assert {row["dim_code"]: row["status"] for row in preview.json()["rows"]} == {
        "D-OLD": "overwritten",
        "D-NEW": "new",
    }
    assert await db_session.scalar(select(func.count()).select_from(Dim)) == before_dims
    assert await db_session.scalar(select(func.count()).select_from(DimHistory)) == before_history

    confirmed = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["created"] == 1
    assert confirmed.json()["updated"] == 1
    await db_session.refresh(existing)
    inspection = await db_session.scalar(select(Inspection).where(Inspection.dim_id == existing.id))
    assert existing.nominal == 11.0
    assert inspection is not None and inspection.deviation == pytest.approx(-0.8)
    history = (
        (
            await db_session.execute(
                select(DimHistory).where(
                    DimHistory.dim_id == existing.id,
                    DimHistory.action == "update_import",
                )
            )
        )
        .scalars()
        .all()
    )
    assert {(row.field, row.old_value, row.new_value) for row in history} == {
        ("nominal", "10.0", "11.0"),
        ("dim_name", "Dimensão sintética", "Atualizada"),
        ("drawing_revision", "A", "B"),
    }

    repeated = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert repeated.status_code == 200
    assert repeated.json()["created"] == repeated.json()["updated"] == 0
    assert repeated.json()["skipped"] == 2


async def test_import_dims_preview_and_confirm_apply_exact_relation_diff(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    position = await make_dim(
        db_session,
        part,
        code="POS",
        nominal=0,
        tol_plus=1,
        tol_minus=0,
        dim_type=DimType.POSITION,
        zone_geometry=ZoneGeometry.RECTANGLE,
    )
    coordinate = await make_dim(
        db_session, part, code="POS_X", nominal=0, parent_dim_id=position.id
    )
    old_size = await make_dim(db_session, part, code="SIZE-OLD", sub_type=DimSubType.HOLE)
    new_size = await make_dim(db_session, part, code="SIZE-NEW", sub_type=DimSubType.HOLE)
    relation = DimAxisRelation(
        id=uuid.uuid4(),
        position_dim_id=position.id,
        axis=DimAxis.X,
        coordinate_dim_id=coordinate.id,
        related_size_dim_id=old_size.id,
        created_at=datetime.now(UTC),
    )
    db_session.add(relation)
    await db_session.flush()
    csv = _dims_csv("POS_X,0,0.5,0.5,DISTANCE,NONE,A,Dimensão sintética,POS,,,,,Y,SIZE-NEW")

    preview = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims-preview",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert preview.status_code == 200
    row = preview.json()["rows"][0]
    assert row["status"] == "overwritten"
    assert row["coordinate_axis"] == "Y"
    assert row["related_size_dim_code"] == "SIZE-NEW"
    assert {
        (change["field"], change["current"], change["incoming"]) for change in row["changes"]
    } == {
        ("coordinate_axis", "X", "Y"),
        ("related_size_dim_code", "SIZE-OLD", "SIZE-NEW"),
    }

    confirmed = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["updated"] == 1
    relations = await service.list_axis_relations(db_session, position.id)
    assert len(relations) == 1
    assert relations[0].axis == DimAxis.Y
    assert relations[0].coordinate_dim_id == coordinate.id
    assert relations[0].related_size_dim_id == new_size.id

    repeated = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims-preview",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert repeated.status_code == 200
    assert repeated.json()["rows"][0]["status"] == "unchanged"
    assert repeated.json()["rows"][0]["changes"] == []


async def test_import_dims_rejects_persisted_axis_conflict_before_writing(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    position = await make_dim(
        db_session,
        part,
        code="POS",
        nominal=0,
        tol_plus=1,
        tol_minus=0,
        dim_type=DimType.POSITION,
        zone_geometry=ZoneGeometry.RECTANGLE,
    )
    coordinate = await make_dim(
        db_session, part, code="POS_X", nominal=0, parent_dim_id=position.id
    )
    other_coordinate = await make_dim(
        db_session, part, code="POS_Y", nominal=0, parent_dim_id=position.id
    )
    db_session.add(
        DimAxisRelation(
            id=uuid.uuid4(),
            position_dim_id=position.id,
            axis=DimAxis.X,
            coordinate_dim_id=coordinate.id,
            related_size_dim_id=None,
            created_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    before_history = await db_session.scalar(select(func.count()).select_from(DimHistory))
    csv = _dims_csv("POS_Y,0,0.5,0.5,DISTANCE,NONE,A,Dimensão sintética,POS,,,,,X,")

    preview = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims-preview",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert preview.status_code == 200
    assert any(
        "eixo X já utilizado por POS_X" in error for error in preview.json()["rows"][0]["errors"]
    )

    confirmed = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert confirmed.status_code == 422
    assert await db_session.scalar(select(func.count()).select_from(DimHistory)) == before_history
    await db_session.refresh(other_coordinate)
    assert other_coordinate.parent_dim_id == position.id


async def test_import_dims_rejects_duplicate_and_late_relation_error_atomically(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    before_dims = await db_session.scalar(select(func.count()).select_from(Dim))
    before_history = await db_session.scalar(select(func.count()).select_from(DimHistory))
    csv = _dims_csv(
        "P,0,1,0,POSITION,NONE,A,Posição,,,,M,RECTANGLE,,",
        "PX,0,1,0,DISTANCE,NONE,A,X,P,,,,,X,SIZE",
        "PY,0,1,0,DISTANCE,NONE,A,Y,P,,,,,Y,SIZE",
        "SIZE,10,1,1,DISTANCE,NONE,A,Tamanho,,,,,,",
    )

    response = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims",
        files={"file": ("dims.csv", csv, "text/csv")},
    )
    assert response.status_code == 422
    assert "sub_type" in str(response.json())
    assert await db_session.scalar(select(func.count()).select_from(Dim)) == before_dims
    assert await db_session.scalar(select(func.count()).select_from(DimHistory)) == before_history

    duplicate = _dims_csv(
        "DUP,1,1,1,DISTANCE,NONE,A,Um,,,,,,",
        "DUP,2,1,1,DISTANCE,NONE,A,Dois,,,,,,",
    )
    response = await api_client.post(
        f"/api/sqc/parts/{part.id}/import-dims",
        files={"file": ("dims.csv", duplicate, "text/csv")},
    )
    assert response.status_code == 422
    assert "duplicado" in str(response.json())
    assert await db_session.scalar(select(func.count()).select_from(Dim)) == before_dims


async def test_measurement_import_preserves_repetitions_is_atomic_and_idempotent(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part, code="D-REP", nominal=10.0)
    batch = await make_batch(db_session, part)
    repeated_csv = (
        b"part,measurement date,cavity,D-REP\n"
        b"1,2026-10-28 10:00:00,1,10.1\n"
        b"1,2026-10-28 10:01:00,1,10.2\n"
    )

    preview = await api_client.post(
        f"/api/sqc/batches/{batch.id}/import-preview",
        files={"file": ("repeticoes.csv", repeated_csv, "text/csv")},
    )
    assert preview.status_code == 200
    assert preview.json()["duplicate_pairs"] == 0
    assert preview.json()["errors"] == []

    imported = await api_client.post(
        f"/api/sqc/batches/{batch.id}/import-measurements",
        files={"file": ("repeticoes.csv", repeated_csv, "text/csv")},
    )
    assert imported.status_code == 200
    assert imported.json() == {"imported": 2, "rejected": 0, "errors": []}
    rows = (
        (
            await db_session.execute(
                select(Inspection)
                .where(Inspection.batch_id == batch.id, Inspection.dim_id == dim.id)
                .order_by(Inspection.source_row)
            )
        )
        .scalars()
        .all()
    )
    assert [(row.part_number, row.cavity, row.measured_value) for row in rows] == [
        (1, 1, 10.1),
        (1, 1, 10.2),
    ]

    retry = await api_client.post(
        f"/api/sqc/batches/{batch.id}/import-measurements",
        files={"file": ("mesmos-bytes-outro-nome.csv", repeated_csv, "text/csv")},
    )
    assert retry.status_code == 409
    assert await db_session.scalar(
        select(func.count()).select_from(Inspection).where(Inspection.batch_id == batch.id)
    ) == len(rows)

    invalid_csv = (
        b"part,measurement date,cavity,D-REP\n"
        b"2,2026-10-28 10:02:00,1,10.3\n"
        b"3,2026-10-28 10:03:00,cavidade-invalida,10.4\n"
    )
    invalid = await api_client.post(
        f"/api/sqc/batches/{batch.id}/import-measurements",
        files={"file": ("invalido.csv", invalid_csv, "text/csv")},
    )
    assert invalid.status_code == 422
    assert await db_session.scalar(
        select(func.count()).select_from(Inspection).where(Inspection.batch_id == batch.id)
    ) == len(rows)


async def test_import_identity_constraint_serializes_concurrent_writers(
    postgres_url: str,
) -> None:
    engine = create_async_engine(postgres_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as setup_session:
        part = await make_part(setup_session)
        dim = await make_dim(setup_session, part, code="D-CONCURRENT", nominal=10.0)
        batch = await make_batch(setup_session, part)
        await setup_session.commit()
        part_id = part.id
        dim_id = dim.id
        batch_id = batch.id

    ready = asyncio.Event()
    release = asyncio.Event()
    ready_count = 0
    ready_lock = asyncio.Lock()

    async def insert_same_identity(measured_value: float) -> bool:
        nonlocal ready_count
        async with factory() as session:
            session.add(
                Inspection(
                    id=uuid.uuid4(),
                    batch_id=batch_id,
                    dim_id=dim_id,
                    part_number=1,
                    operator="Operador Sintético",
                    date_time=datetime(2026, 1, 1, tzinfo=UTC),
                    instrument="SYN-INST",
                    fixture=None,
                    work_order=None,
                    cavity=1,
                    measured_value=measured_value,
                    deviation=measured_value - 10.0,
                    point_max=None,
                    point_min=None,
                    source_import_digest="a" * 64,
                    source_row=2,
                    is_ignored=False,
                    ignored_reason=None,
                )
            )
            async with ready_lock:
                ready_count += 1
                if ready_count == 2:
                    ready.set()
            await release.wait()
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                return False
            return True

    first = asyncio.create_task(insert_same_identity(10.1))
    second = asyncio.create_task(insert_same_identity(10.2))
    await ready.wait()
    release.set()
    outcomes = await asyncio.gather(first, second)

    try:
        assert sorted(outcomes) == [False, True]
        async with factory() as verification_session:
            assert (
                await verification_session.scalar(
                    select(func.count())
                    .select_from(Inspection)
                    .where(
                        Inspection.batch_id == batch_id,
                        Inspection.dim_id == dim_id,
                        Inspection.source_import_digest == "a" * 64,
                        Inspection.source_row == 2,
                    )
                )
                == 1
            )
    finally:
        async with factory() as cleanup_session:
            await cleanup_session.execute(delete(Inspection).where(Inspection.batch_id == batch_id))
            await cleanup_session.execute(delete(type(batch)).where(type(batch).id == batch_id))
            await cleanup_session.execute(delete(Dim).where(Dim.id == dim_id))
            await cleanup_session.execute(delete(type(part)).where(type(part).id == part_id))
            await cleanup_session.commit()
        await engine.dispose()


async def test_patch_rejects_null_for_required_fields(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part)
    batch = await make_batch(db_session, part)

    requests = [
        (f"/api/sqc/parts/{part.id}", {"description": None}),
        (f"/api/sqc/parts/{part.id}/dims/{dim.id}", {"nominal": None}),
        (f"/api/sqc/parts/{part.id}/dims/{dim.id}", {"tol_plus": None}),
        (f"/api/sqc/batches/{batch.id}", {"supplier_id": None}),
        (f"/api/sqc/batches/{batch.id}", {"project_status": None}),
        (f"/api/sqc/batches/{batch.id}", {"inspection_level": None}),
        (f"/api/sqc/batches/{batch.id}", {"aql": None}),
    ]
    for path, payload in requests:
        response = await api_client.patch(path, json=payload)
        assert response.status_code == 422, (path, payload, response.text)

    await db_session.refresh(part)
    await db_session.refresh(dim)
    await db_session.refresh(batch)
    assert part.description == "Peça sintética de teste"
    assert dim.nominal == 10.0
    assert dim.tol_plus == 0.5
    assert batch.supplier_id == "Fornecedor Sintético"


async def test_capability_basis_keeps_bonus_indices_in_normalized_space(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    size = await make_dim(
        db_session,
        part,
        code="SIZE-BASIS",
        nominal=10,
        tol_plus=1,
        tol_minus=1,
        sub_type=DimSubType.HOLE,
    )
    position = await make_dim(
        db_session,
        part,
        code="POS-BASIS",
        nominal=0,
        tol_plus=1,
        tol_minus=0,
        dim_type=DimType.POSITION,
        material_modifier=MaterialModifier.M,
        dim_rel_1_id=size.id,
        zone_geometry=ZoneGeometry.CIRCULAR,
    )
    batches = [await make_batch(db_session, part), await make_batch(db_session, part)]
    part_number = 0
    for batch_index, batch in enumerate(batches):
        for offset in range(3):
            part_number += 1
            await make_inspection(
                db_session,
                batch,
                size,
                part_number=part_number,
                measured_value=9.2 + 0.1 * offset,
            )
            await make_inspection(
                db_session,
                batch,
                position,
                part_number=part_number,
                measured_value=0.4 + 0.05 * (batch_index + offset),
            )

    single = await api_client.get(f"/api/sqc/batches/{batches[0].id}/dims/{position.id}/statistics")
    assert single.status_code == 200
    single_payload = single.json()
    assert single_payload["capability_methodology"] == "bonus_normalized_ratio"
    assert single_payload["capability_basis"]["methodology"] == "bonus_normalized_ratio"
    assert single_payload["capability_basis"]["usl"] == pytest.approx(1.0)
    assert single_payload["capability_basis"]["mean"] != pytest.approx(single_payload["mean"])

    grouped = await api_client.post(
        "/api/sqc/batches/grouped-statistics",
        json={
            "batch_ids": [str(batch.id) for batch in batches],
            "dim_id": str(position.id),
        },
    )
    assert grouped.status_code == 200
    grouped_payload = grouped.json()
    basis = grouped_payload["capability_basis"]
    assert grouped_payload["capability_methodology"] == "bonus_normalized_ratio"
    assert basis["methodology"] == "bonus_normalized_ratio"
    assert basis["usl"] == pytest.approx(1.0)
    assert basis["mean"] != pytest.approx(grouped_payload["mean"])
    assert grouped_payload["cpu"] == pytest.approx(
        (basis["usl"] - basis["mean"]) / (3 * basis["std_short"])
    )
    assert grouped_payload["ppk"] == pytest.approx(
        (basis["usl"] - basis["mean"]) / (3 * basis["std_long"])
    )


async def test_bonus_and_rectangle_components_never_cross_cavities(
    db_session: AsyncSession,
) -> None:
    part = await make_part(db_session)
    size = await make_dim(
        db_session,
        part,
        code="SIZE",
        nominal=10,
        tol_plus=1,
        tol_minus=1,
        sub_type=DimSubType.HOLE,
    )
    position = await make_dim(
        db_session,
        part,
        code="POS",
        nominal=0,
        tol_plus=1,
        tol_minus=0,
        dim_type=DimType.POSITION,
        material_modifier=MaterialModifier.M,
        dim_rel_1_id=size.id,
        zone_geometry=ZoneGeometry.RECTANGLE,
    )
    x = await make_dim(db_session, part, code="POS_X", nominal=0, parent_dim_id=position.id)
    y = await make_dim(db_session, part, code="POS_Y", nominal=0, parent_dim_id=position.id)
    db_session.add_all(
        [
            DimAxisRelation(
                id=uuid.uuid4(),
                position_dim_id=position.id,
                axis=DimAxis.X,
                coordinate_dim_id=x.id,
                related_size_dim_id=size.id,
                created_at=datetime.now(UTC),
            ),
            DimAxisRelation(
                id=uuid.uuid4(),
                position_dim_id=position.id,
                axis=DimAxis.Y,
                coordinate_dim_id=y.id,
                related_size_dim_id=size.id,
                created_at=datetime.now(UTC),
            ),
        ]
    )
    batch = await make_batch(db_session, part)
    await make_inspection(db_session, batch, size, part_number=1, cavity=2, measured_value=10.5)
    await make_inspection(db_session, batch, x, part_number=1, cavity=1, measured_value=0.2)
    await make_inspection(db_session, batch, y, part_number=1, cavity=2, measured_value=0.2)

    bonus = await service.get_bonus_map(db_session, batch.id, position)
    assert bonus == {(1, 2): pytest.approx(1.5)}
    pieces = await service.get_rectangle_consolidated(db_session, batch.id, position)
    assert {(p.part_number, p.cavity, p.conforming) for p in pieces} == {
        (1, 1, None),
        (1, 2, None),
    }

    await make_inspection(db_session, batch, size, part_number=2, cavity=1, measured_value=10.5)
    await make_inspection(db_session, batch, size, part_number=2, cavity=1, measured_value=9.2)
    await make_inspection(db_session, batch, x, part_number=2, cavity=1, measured_value=0.2)
    await make_inspection(db_session, batch, x, part_number=2, cavity=1, measured_value=1.2)
    await make_inspection(db_session, batch, y, part_number=2, cavity=1, measured_value=0.1)

    axis_bonus = await service.get_axis_bonus_map(
        db_session,
        batch.id,
        (await service.list_axis_relations(db_session, position.id))[0],
        position.material_modifier,
    )
    assert axis_bonus[(2, 1)] == pytest.approx(0.2)
    repeated_piece = next(
        piece
        for piece in await service.get_rectangle_consolidated(db_session, batch.id, position)
        if piece.part_number == 2 and piece.cavity == 1
    )
    assert repeated_piece.conforming is False
    x_direction = next(
        direction for direction in repeated_piece.directions if direction.axis == DimAxis.X
    )
    assert x_direction.measured == pytest.approx(1.2)
    assert x_direction.measured_size == pytest.approx(9.2)


async def test_profile_distribution_preserves_repetitions_and_cavity_filter(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    profile = await make_dim(
        db_session,
        part,
        code="PROF",
        nominal=0,
        tol_plus=1,
        tol_minus=1,
        dim_type=DimType.PROFILE_SURFACE,
    )
    max_dim = await make_dim(
        db_session,
        part,
        code="PROF_MAX",
        nominal=0,
        tol_plus=1,
        tol_minus=1,
        parent_dim_id=profile.id,
    )
    min_dim = await make_dim(
        db_session,
        part,
        code="PROF_MIN",
        nominal=0,
        tol_plus=1,
        tol_minus=1,
        parent_dim_id=profile.id,
    )
    batch = await make_batch(db_session, part)
    for value in (0.1, 0.2, 0.3):
        await make_inspection(
            db_session, batch, max_dim, part_number=1, cavity=1, measured_value=value
        )
        await make_inspection(
            db_session, batch, min_dim, part_number=1, cavity=1, measured_value=-value
        )
    await make_inspection(db_session, batch, max_dim, part_number=1, cavity=2, measured_value=0.9)
    await make_inspection(db_session, batch, min_dim, part_number=1, cavity=2, measured_value=-0.9)

    response = await api_client.get(
        f"/api/sqc/batches/{batch.id}/dims/{profile.id}/profile-distribution?cavity=1"
    )
    assert response.status_code == 200
    assert response.json()["pos"]["n"] == 3
    assert response.json()["neg"]["n"] == 3
    assert response.json()["pos"]["mean"] == pytest.approx(0.2)
    assert response.json()["usl"] == pytest.approx(1.0)
    assert response.json()["lsl"] == pytest.approx(-1.0)


@pytest.mark.parametrize("status", [BatchStatus.APPROVED, BatchStatus.REJECTED])
async def test_decided_batch_blocks_ignore_and_reports_preserving_bytes_and_history(
    db_session: AsyncSession,
    api_client: AsyncClient,
    status: BatchStatus,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part)
    batch = await make_batch(db_session, part, status=status)
    inspection = await make_inspection(db_session, batch, dim, part_number=1, measured_value=10.1)
    original = b"%PDF-1.4\n% original synthetic report\n%%EOF\n"
    await storage.put_object(f"sqc/reports/{batch.id}/Part 1.pdf", original, "application/pdf")
    before_history = await db_session.scalar(
        select(func.count()).select_from(InspectionIgnoreHistory)
    )

    ignored = await api_client.patch(
        f"/api/sqc/batches/{batch.id}/dims/{dim.id}/inspections/{inspection.id}/ignore",
        json={"ignored": True, "reason": "Teste"},
    )
    report = await api_client.post(
        f"/api/sqc/batches/{batch.id}/reports/upload",
        files={"files": ("Part 1.pdf", b"%PDF-1.4\nnew\n%%EOF\n", "application/pdf")},
    )
    assert ignored.status_code == report.status_code == 409
    await db_session.refresh(inspection)
    assert inspection.is_ignored is False
    assert (
        await db_session.scalar(select(func.count()).select_from(InspectionIgnoreHistory))
        == before_history
    )
    assert await storage.get_object(f"sqc/reports/{batch.id}/Part 1.pdf") == original


async def test_drawing_lock_and_zip_validation_preserve_original_bytes(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session, code=f"SYN-DRAW-{uuid.uuid4().hex[:6]}")
    await make_dim(db_session, part, drawing_revision="A")
    await make_batch(db_session, part, status=BatchStatus.APPROVED)
    drawing_key = f"sqc/drawings/{part.part_code}_A.pdf"
    original_drawing = b"%PDF-1.4\n% original synthetic drawing\n%%EOF\n"
    await storage.put_object(drawing_key, original_drawing, "application/pdf")

    drawing = await api_client.post(
        f"/api/sqc/parts/{part.id}/drawing",
        data={"drawing_revision": "A"},
        files={"file": ("drawing.pdf", b"%PDF-1.4\nnew\n%%EOF\n", "application/pdf")},
    )
    assert drawing.status_code == 409
    assert await storage.get_object(drawing_key) == original_drawing

    editable = await make_batch(db_session, part)
    report_key = f"sqc/reports/{editable.id}/Part 1.pdf"
    original_report = b"%PDF-1.4\n% original synthetic report\n%%EOF\n"
    await storage.put_object(report_key, original_report, "application/pdf")
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("Part 1.pdf", b"%PDF-1.4\nreplacement\n%%EOF\n")
        archive.writestr("Part 2.pdf", b"not a pdf")
    response = await api_client.post(
        f"/api/sqc/batches/{editable.id}/reports/upload",
        files={"files": ("reports.zip", payload.getvalue(), "application/zip")},
    )
    assert response.status_code == 400
    assert await storage.get_object(report_key) == original_report
    assert await storage.get_object(f"sqc/reports/{editable.id}/Part 2.pdf") is None


async def test_decision_gate_distinguishes_empty_from_all_ignored(
    db_session: AsyncSession,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part)
    empty = await make_batch(db_session, part)
    assert await service.check_batch_decidable(db_session, empty) == {"reason": "no_measurements"}

    ignored = await make_batch(db_session, part)
    await make_inspection(
        db_session,
        ignored,
        dim,
        part_number=1,
        measured_value=10.0,
        ignored=True,
    )
    assert await service.check_batch_decidable(db_session, ignored) == {
        "reason": "all_measurements_ignored"
    }
