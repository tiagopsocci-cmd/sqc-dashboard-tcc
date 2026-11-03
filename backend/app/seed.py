"""Deterministic synthetic demo dataset for the standalone SQC application."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.db import SessionFactory
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
    Instrument,
    MaterialModifier,
    Part,
    ProjectStatus,
    SqcBatch,
    ZoneGeometry,
)

ACTOR = "demo@localhost.invalid"
_NAMESPACE = uuid.UUID("922e9483-5438-4bb9-8e57-1820aab008c6")
_BASE_TIME = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)


def _id(label: str) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, label)


PART_AURORA = _id("part:aurora")
PART_BOREAL = _id("part:boreal")

D_BILATERAL = _id("dim:aurora:bilateral")
D_UNILATERAL = _id("dim:aurora:unilateral")
D_SIZE_MMC = _id("dim:aurora:size-mmc")
D_POS_MMC = _id("dim:aurora:position-mmc")
D_SIZE_LMC = _id("dim:aurora:size-lmc")
D_POS_LMC = _id("dim:aurora:position-lmc")
D_RECT_X = _id("dim:aurora:rectangle-x")
D_RECT_Y = _id("dim:aurora:rectangle-y")
D_RECT = _id("dim:aurora:rectangle")
D_LINE = _id("dim:aurora:line")
D_BOREAL_SLAB = _id("dim:boreal:slab")
D_BOREAL_PROFILE = _id("dim:boreal:profile")

BATCH_XBAR = _id("batch:aurora:xbar")
BATCH_NQA_OK = _id("batch:aurora:nqa-ok")
BATCH_REJECTED = _id("batch:aurora:rejected")
BATCH_NQA_SHORT = _id("batch:boreal:nqa-short")


def _pdf(title: str) -> bytes:
    """Build a small, valid PDF without timestamps or external dependencies."""
    safe_title = title.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 18 Tf 72 720 Td ({safe_title}) Tj ET\n".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    result = bytearray(b"%PDF-1.4\n% synthetic demo\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(result))
        result.extend(f"{number} 0 obj\n".encode("ascii"))
        result.extend(obj)
        result.extend(b"\nendobj\n")
    xref_offset = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    result.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(result)


async def _insert_missing(
    session: AsyncSession,
    model: Any,
    rows: list[dict[str, Any]],
) -> int:
    """Insert absent fixtures without changing any row already present."""
    if not rows:
        return 0
    statement = pg_insert(model.__table__).values(rows).on_conflict_do_nothing().returning(model.id)
    result = await session.execute(statement)
    return len(result.scalars().all())


def _dim(
    dim_id: uuid.UUID,
    part_id: uuid.UUID,
    code: str,
    name: str,
    dim_type: DimType,
    nominal: float,
    tol_plus: float,
    tol_minus: float | None,
    *,
    sub_type: DimSubType | None = None,
    modifier: MaterialModifier | None = None,
    related: uuid.UUID | None = None,
    geometry: ZoneGeometry | None = None,
) -> dict[str, Any]:
    return {
        "id": dim_id,
        "part_id": part_id,
        "drawing_revision": "A",
        "dim_code": code,
        "dim_name": name,
        "type": dim_type,
        "sub_type": sub_type,
        "nominal": nominal,
        "tol_plus": tol_plus,
        "tol_minus": tol_minus,
        "material_modifier": modifier,
        "dim_rel_1_id": related,
        "dim_rel_2_id": None,
        "parent_dim_id": None,
        "zone_geometry": geometry,
    }


def _inspection(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    part_number: int,
    measured: float,
    nominal: float,
    *,
    repeat: int = 1,
    ignored: bool = False,
    ignored_reason: str | None = None,
    cavity: int | None = 1,
) -> dict[str, Any]:
    label = f"inspection:{batch_id}:{dim_id}:{part_number}:{repeat}"
    return {
        "id": _id(label),
        "batch_id": batch_id,
        "dim_id": dim_id,
        "part_number": part_number,
        "operator": "Operador Sintético",
        "date_time": _BASE_TIME + timedelta(minutes=part_number * 5 + repeat),
        "instrument": "CMM-DEMO",
        "fixture": "Dispositivo Demo",
        "work_order": f"WO-DEMO-{str(batch_id)[:8]}",
        "cavity": cavity,
        "measured_value": measured,
        "deviation": measured - nominal,
        "point_max": None,
        "point_min": None,
        "is_ignored": ignored,
        "ignored_reason": ignored_reason,
    }


def _inspection_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    # Ten subgroups of size three. Subgroup 10 is intentionally shifted so the
    # X-bar chart has a visible out-of-control anomaly.
    for part_number in range(1, 11):
        center = 50.82 if part_number == 10 else 50.0 + ((part_number % 3) - 1) * 0.015
        for repeat, offset in enumerate((-0.03, 0.0, 0.03), start=1):
            rows.append(
                _inspection(
                    BATCH_XBAR,
                    D_BILATERAL,
                    part_number,
                    center + offset,
                    50.0,
                    repeat=repeat,
                )
            )

    # One ignored extreme remains in the audit trail but is excluded from analytics.
    rows.append(
        _inspection(
            BATCH_XBAR,
            D_UNILATERAL,
            1,
            0.95,
            0.0,
            ignored=True,
            ignored_reason="Leitura sintética instável para demonstração",
        )
    )
    for part_number, value in enumerate((0.08, 0.10, 0.11, 0.09, 0.12, 0.10), start=2):
        rows.append(_inspection(BATCH_XBAR, D_UNILATERAL, part_number, value, 0.0))

    # Circular MMC and LMC examples. Related-size measurements produce different
    # effective tolerance bonuses per piece.
    for part_number in range(1, 7):
        size_mmc = 9.82 + 0.025 * part_number
        pos_mmc = 0.21 + 0.025 * (part_number % 3)
        size_lmc = 19.82 + 0.04 * part_number
        pos_lmc = 0.27 + 0.03 * (part_number % 2)
        rows.extend(
            [
                _inspection(BATCH_XBAR, D_SIZE_MMC, part_number, size_mmc, 10.0),
                _inspection(BATCH_XBAR, D_POS_MMC, part_number, pos_mmc, 0.0),
                _inspection(BATCH_XBAR, D_SIZE_LMC, part_number, size_lmc, 20.0),
                _inspection(BATCH_XBAR, D_POS_LMC, part_number, pos_lmc, 0.0),
            ]
        )

    # RECTANGLE uses directional coordinate relations; LINE is represented by its
    # own scalar result. Values are all synthetic and dimensionally coherent.
    for part_number in range(1, 7):
        x = 0.10 + 0.02 * (part_number % 3)
        y = 0.12 + 0.015 * (part_number % 2)
        rows.extend(
            [
                _inspection(BATCH_XBAR, D_RECT_X, part_number, x, 0.0),
                _inspection(BATCH_XBAR, D_RECT_Y, part_number, y, 0.0),
                _inspection(BATCH_XBAR, D_RECT, part_number, max(x, y), 0.0),
                _inspection(BATCH_XBAR, D_LINE, part_number, 0.08 + 0.01 * part_number, 0.0),
            ]
        )

    # Complete ISO 2859-1/NQA sample: lot 100, level II, AQL 2.5 -> n=20,
    # Ac=1/Re=2. Exactly one nonconforming result remains accepted.
    for part_number in range(1, 21):
        value = 51.25 if part_number == 20 else 50.0 + ((part_number % 5) - 2) * 0.04
        rows.append(_inspection(BATCH_NQA_OK, D_BILATERAL, part_number, value, 50.0))

    # Complete rejected NQA sample with two nonconforming pieces.
    for part_number in range(1, 21):
        value = 51.30 if part_number in {19, 20} else 49.98 + (part_number % 4) * 0.02
        rows.append(_inspection(BATCH_REJECTED, D_BILATERAL, part_number, value, 50.0))

    # Intentionally short NQA sample (8 of required 20).
    for part_number in range(1, 9):
        value = 24.0 + ((part_number % 3) - 1) * 0.03
        rows.append(_inspection(BATCH_NQA_SHORT, D_BOREAL_SLAB, part_number, value, 24.0))

    return rows


async def _seed_database(session: AsyncSession) -> dict[str, int]:
    instruments = [
        {
            "id": _id("instrument:cmm-demo"),
            "code": "CMM-DEMO",
            "name": "Máquina de medição sintética",
            "uncertainty": 0.008,
            "created_at": _BASE_TIME,
        },
        {
            "id": _id("instrument:caliper-demo"),
            "code": "PAQ-DEMO",
            "name": "Paquímetro sintético",
            "uncertainty": 0.02,
            "created_at": _BASE_TIME,
        },
    ]
    parts = [
        {
            "id": PART_AURORA,
            "part_code": "DEMO-AURORA-100",
            "description": "Componente demonstrativo Aurora",
            "material": "Liga sintética A",
            "process": "Usinagem demonstrativa",
            "created_at": _BASE_TIME,
        },
        {
            "id": PART_BOREAL,
            "part_code": "DEMO-BOREAL-200",
            "description": "Componente demonstrativo Boreal",
            "material": "Polímero sintético B",
            "process": "Moldagem demonstrativa",
            "created_at": _BASE_TIME,
        },
    ]
    base_dims = [
        _dim(D_BILATERAL, PART_AURORA, "D-BIL", "Largura bilateral", DimType.DISTANCE, 50, 1, 1),
        _dim(
            D_UNILATERAL,
            PART_AURORA,
            "D-UNI",
            "Planicidade unilateral",
            DimType.FLATNESS,
            0,
            0.30,
            None,
        ),
        _dim(
            D_SIZE_MMC,
            PART_AURORA,
            "D-SIZE-M",
            "Diâmetro relacionado MMC",
            DimType.DIAMETER,
            10,
            0.20,
            0.20,
            sub_type=DimSubType.HOLE,
        ),
        _dim(
            D_SIZE_LMC,
            PART_AURORA,
            "D-SIZE-L",
            "Diâmetro relacionado LMC",
            DimType.DIAMETER,
            20,
            0.20,
            0.20,
            sub_type=DimSubType.SHAFT,
        ),
        _dim(D_RECT_X, PART_AURORA, "D-RECT-X", "Coordenada X", DimType.DISTANCE, 0, 0.30, 0.30),
        _dim(D_RECT_Y, PART_AURORA, "D-RECT-Y", "Coordenada Y", DimType.DISTANCE, 0, 0.30, 0.30),
        _dim(D_BOREAL_SLAB, PART_BOREAL, "D-SLAB", "Espessura Slab", DimType.SLAB, 24, 0.30, 0.30),
        _dim(
            D_BOREAL_PROFILE,
            PART_BOREAL,
            "D-PROFILE",
            "Perfil de superfície",
            DimType.PROFILE_SURFACE,
            0,
            0.40,
            None,
        ),
    ]
    position_dims = [
        _dim(
            D_POS_MMC,
            PART_AURORA,
            "D-POS-M",
            "Posição circular MMC",
            DimType.POSITION,
            0,
            0.40,
            None,
            modifier=MaterialModifier.M,
            related=D_SIZE_MMC,
            geometry=ZoneGeometry.CIRCULAR,
        ),
        _dim(
            D_POS_LMC,
            PART_AURORA,
            "D-POS-L",
            "Posição circular LMC",
            DimType.POSITION,
            0,
            0.50,
            None,
            modifier=MaterialModifier.L,
            related=D_SIZE_LMC,
            geometry=ZoneGeometry.CIRCULAR,
        ),
        _dim(
            D_RECT,
            PART_AURORA,
            "D-RECT",
            "Posição retangular",
            DimType.POSITION,
            0,
            0.60,
            None,
            geometry=ZoneGeometry.RECTANGLE,
        ),
        _dim(
            D_LINE,
            PART_AURORA,
            "D-LINE",
            "Posição linear",
            DimType.POSITION,
            0,
            0.25,
            None,
            geometry=ZoneGeometry.LINE,
        ),
    ]
    relations = [
        {
            "id": _id("relation:rectangle:x"),
            "position_dim_id": D_RECT,
            "axis": DimAxis.X,
            "coordinate_dim_id": D_RECT_X,
            "related_size_dim_id": None,
            "created_at": _BASE_TIME,
        },
        {
            "id": _id("relation:rectangle:y"),
            "position_dim_id": D_RECT,
            "axis": DimAxis.Y,
            "coordinate_dim_id": D_RECT_Y,
            "related_size_dim_id": None,
            "created_at": _BASE_TIME,
        },
    ]
    batches = [
        {
            "id": BATCH_XBAR,
            "tracking_code": "DEMO-AUR-XBAR-001",
            "part_id": PART_AURORA,
            "supplier_id": "Aurora",
            "project_status": ProjectStatus.EVB,
            "batch_status": BatchStatus.IN_ANALYSIS,
            "rejection_justification": None,
            "batch_size": 120,
            "inspection_level": "II",
            "aql": 2.5,
            "created_at": _BASE_TIME,
            "deleted_at": None,
        },
        {
            "id": BATCH_NQA_OK,
            "tracking_code": "DEMO-AUR-NQA-002",
            "part_id": PART_AURORA,
            "supplier_id": "Aurora",
            "project_status": ProjectStatus.PVB,
            "batch_status": BatchStatus.APPROVED,
            "rejection_justification": None,
            "batch_size": 100,
            "inspection_level": "II",
            "aql": 2.5,
            "created_at": _BASE_TIME + timedelta(days=1),
            "deleted_at": None,
        },
        {
            "id": BATCH_REJECTED,
            "tracking_code": "DEMO-BOR-REJ-003",
            "part_id": PART_AURORA,
            "supplier_id": "Boreal",
            "project_status": ProjectStatus.IE,
            "batch_status": BatchStatus.REJECTED,
            "rejection_justification": "Amostra sintética acima do número de rejeição",
            "batch_size": 100,
            "inspection_level": "II",
            "aql": 2.5,
            "created_at": _BASE_TIME + timedelta(days=2),
            "deleted_at": None,
        },
        {
            "id": BATCH_NQA_SHORT,
            "tracking_code": "DEMO-BOR-SHORT-004",
            "part_id": PART_BOREAL,
            "supplier_id": "Boreal",
            "project_status": ProjectStatus.EVB,
            "batch_status": BatchStatus.IN_ANALYSIS,
            "rejection_justification": None,
            "batch_size": 100,
            "inspection_level": "II",
            "aql": 2.5,
            "created_at": _BASE_TIME + timedelta(days=3),
            "deleted_at": None,
        },
    ]
    inspections = _inspection_rows()

    dim_histories = [
        {
            "id": _id(f"dim-history:{dim['id']}"),
            "part_id": dim["part_id"],
            "dim_id": dim["id"],
            "dim_code": dim["dim_code"],
            "field": "dim_code",
            "old_value": None,
            "new_value": dim["dim_code"],
            "action": "seed_demo",
            "actor_email": ACTOR,
            "created_at": _BASE_TIME,
        }
        for dim in [*base_dims, *position_dims]
    ]

    ignored = next(row for row in inspections if row["is_ignored"])
    unignored = next(
        row
        for row in inspections
        if row["batch_id"] == BATCH_XBAR
        and row["dim_id"] == D_UNILATERAL
        and row["part_number"] == 2
    )
    ignore_histories = [
        {
            "id": _id("ignore-history:permanent"),
            "inspection_id": ignored["id"],
            "batch_id": ignored["batch_id"],
            "dim_id": ignored["dim_id"],
            "part_number": ignored["part_number"],
            "action": "ignore",
            "reason": ignored["ignored_reason"],
            "actor_email": ACTOR,
            "created_at": _BASE_TIME + timedelta(hours=1),
        },
        {
            "id": _id("ignore-history:temporary-ignore"),
            "inspection_id": unignored["id"],
            "batch_id": unignored["batch_id"],
            "dim_id": unignored["dim_id"],
            "part_number": unignored["part_number"],
            "action": "ignore",
            "reason": "Revisão sintética temporária",
            "actor_email": ACTOR,
            "created_at": _BASE_TIME + timedelta(hours=2),
        },
        {
            "id": _id("ignore-history:temporary-unignore"),
            "inspection_id": unignored["id"],
            "batch_id": unignored["batch_id"],
            "dim_id": unignored["dim_id"],
            "part_number": unignored["part_number"],
            "action": "unignore",
            "reason": None,
            "actor_email": ACTOR,
            "created_at": _BASE_TIME + timedelta(hours=3),
        },
    ]

    inserted = {
        "instruments": await _insert_missing(session, Instrument, instruments),
        "parts": await _insert_missing(session, Part, parts),
        "dimensions": await _insert_missing(session, Dim, base_dims),
    }
    inserted["dimensions"] += await _insert_missing(session, Dim, position_dims)
    inserted["axis_relations"] = await _insert_missing(session, DimAxisRelation, relations)
    inserted["batches"] = await _insert_missing(session, SqcBatch, batches)
    inserted["dim_history"] = await _insert_missing(session, DimHistory, dim_histories)
    inserted["inspections"] = await _insert_missing(session, Inspection, inspections)
    inserted["ignore_history"] = await _insert_missing(
        session, InspectionIgnoreHistory, ignore_histories
    )
    return inserted


async def _seed_files() -> int:
    """Create absent PDF fixtures and return how many files were created this run."""
    files = {
        "sqc/drawings/DEMO-AURORA-100_A.pdf": _pdf("Synthetic drawing - Aurora"),
        "sqc/drawings/DEMO-BOREAL-200_A.pdf": _pdf("Synthetic drawing - Boreal"),
        f"sqc/reports/{BATCH_XBAR}/Part 1.pdf": _pdf("Synthetic inspection report - Aurora part 1"),
        f"sqc/reports/{BATCH_NQA_OK}/Part 20.pdf": _pdf("Synthetic inspection report - Aurora NQA"),
        f"sqc/reports/{BATCH_NQA_SHORT}/Part 1.pdf": _pdf(
            "Synthetic inspection report - Boreal part 1"
        ),
    }
    created = 0
    for key, content in files.items():
        if await storage.get_object(key) is not None:
            continue
        await storage.put_object(key, content, "application/pdf")
        created += 1
    return created


async def seed() -> dict[str, int]:
    """Add missing demo fixtures and report inserts/created PDFs for this invocation."""
    async with SessionFactory() as session:
        async with session.begin():
            counts = await _seed_database(session)
    counts["pdf_files"] = await _seed_files()
    return counts


async def _main() -> None:
    counts = await seed()
    summary = ", ".join(f"{name}={value}" for name, value in counts.items())
    print(f"synthetic-demo seed complete: {summary}")


if __name__ == "__main__":
    asyncio.run(_main())
