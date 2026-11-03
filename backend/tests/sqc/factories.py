"""Factories mínimas e determinísticas para regressões SQC."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.sqc.models import (
    BatchStatus,
    Dim,
    DimSubType,
    DimType,
    Inspection,
    MaterialModifier,
    Part,
    ProjectStatus,
    SqcBatch,
    ZoneGeometry,
)

_NOW = datetime(2026, 1, 1, tzinfo=UTC)


async def make_part(session: AsyncSession, *, code: str | None = None) -> Part:
    suffix = uuid.uuid4().hex[:8]
    part = Part(
        id=uuid.uuid4(),
        part_code=code or f"SYN-{suffix}",
        description="Peça sintética de teste",
        material="Material sintético",
        process="Processo sintético",
        created_at=_NOW,
    )
    session.add(part)
    await session.flush()
    return part


async def make_dim(
    session: AsyncSession,
    part: Part,
    *,
    code: str | None = None,
    nominal: float = 10.0,
    tol_plus: float = 0.5,
    tol_minus: float | None = 0.5,
    dim_type: DimType = DimType.DISTANCE,
    sub_type: DimSubType | None = DimSubType.NONE,
    material_modifier: MaterialModifier | None = None,
    dim_rel_1_id: uuid.UUID | None = None,
    parent_dim_id: uuid.UUID | None = None,
    zone_geometry: ZoneGeometry | None = None,
    drawing_revision: str | None = "A",
) -> Dim:
    suffix = uuid.uuid4().hex[:8]
    dim = Dim(
        id=uuid.uuid4(),
        part_id=part.id,
        drawing_revision=drawing_revision,
        dim_code=code or f"D-{suffix}",
        dim_name="Dimensão sintética",
        type=dim_type,
        sub_type=sub_type,
        nominal=nominal,
        tol_plus=tol_plus,
        tol_minus=tol_minus,
        material_modifier=material_modifier,
        dim_rel_1_id=dim_rel_1_id,
        dim_rel_2_id=None,
        parent_dim_id=parent_dim_id,
        zone_geometry=zone_geometry,
    )
    session.add(dim)
    await session.flush()
    return dim


async def make_batch(
    session: AsyncSession,
    part: Part,
    *,
    status: BatchStatus = BatchStatus.IN_ANALYSIS,
    batch_size: int | None = None,
) -> SqcBatch:
    suffix = uuid.uuid4().hex[:8]
    batch = SqcBatch(
        id=uuid.uuid4(),
        tracking_code=f"SYN-{suffix}",
        part_id=part.id,
        supplier_id="Fornecedor Sintético",
        project_status=ProjectStatus.IE,
        batch_status=status,
        rejection_justification=None,
        batch_size=batch_size,
        inspection_level="II",
        aql=2.5,
        created_at=_NOW,
        deleted_at=None,
    )
    session.add(batch)
    await session.flush()
    return batch


async def make_inspection(
    session: AsyncSession,
    batch: SqcBatch,
    dim: Dim,
    *,
    part_number: int,
    measured_value: float,
    cavity: int | None = None,
    ignored: bool = False,
) -> Inspection:
    inspection = Inspection(
        id=uuid.uuid4(),
        batch_id=batch.id,
        dim_id=dim.id,
        part_number=part_number,
        operator="Operador Sintético",
        date_time=_NOW,
        instrument="SYN-INST",
        fixture=None,
        work_order=None,
        cavity=cavity,
        measured_value=measured_value,
        deviation=measured_value - dim.nominal,
        point_max=None,
        point_min=None,
        is_ignored=ignored,
        ignored_reason="Ignorada no teste" if ignored else None,
    )
    session.add(inspection)
    await session.flush()
    return inspection
