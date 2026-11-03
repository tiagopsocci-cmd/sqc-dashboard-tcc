from __future__ import annotations

import hashlib
import uuid
from collections import Counter

import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.config import get_settings
from app.core.db import get_session
from app.core.logging import get_logger
from app.sqc import export as sqc_export
from app.sqc import nqa as nqa_calc
from app.sqc import service
from app.sqc import statistics as stats
from app.sqc.deps import CurrentUser, SqcEngineer, SqcWriter
from app.sqc.importer import parse_csv, parse_dims_csv, parse_measurements
from app.sqc.models import (
    Dim,
    DimAxis,
    DimAxisRelation,
    DimHistory,
    DimSubType,
    DimType,
    Inspection,
    MaterialModifier,
    ProjectStatus,
    SqcBatch,
    ZoneGeometry,
)
from app.sqc.schemas import (
    BatchBoxplot,
    BatchContext,
    BatchCreate,
    BatchDecisionRequest,
    BatchOverviewResponse,
    BatchRead,
    BatchUpdate,
    CapabilityBasis,
    CapabilityThresholds,
    ControlChartResponse,
    ControlChartSeries,
    CoordinateBatchStats,
    CoordinateData,
    CoordinatePoint,
    CoordinateTrendResponse,
    DimAxisRelationCreate,
    DimAxisRelationRead,
    DimAxisRelationUpdate,
    DimCreate,
    DimImportChange,
    DimImportPreview,
    DimImportPreviewRow,
    DimImportResult,
    DimOverviewRow,
    DimPreviewRow,
    DimRead,
    DimUpdate,
    DirectionCapability,
    DirectionResultSchema,
    DistributionResponse,
    DistributionSeries,
    DrawingUploadResponse,
    ExportFormat,
    ExportMeasurementsRequest,
    GroupedStatisticsRequest,
    GroupedStatisticsResponse,
    HeatmapCell,
    HeatmapDimRow,
    HistogramData,
    IChartSeries,
    ImportResult,
    InspectionIgnoreRequest,
    InspectionIgnoreResponse,
    InspectionRow,
    InspectionsDetailResponse,
    InstrumentCreate,
    InstrumentRead,
    InstrumentUpdate,
    KDEData,
    MeasurementPreview,
    MeasurementPreviewRow,
    NqaSummaryRow,
    PartCreate,
    PartHeatmapResponse,
    PartRead,
    PartUpdate,
    ProfileBatchStats,
    ProfileDistributionResponse,
    ProfileTrendResponse,
    StatisticsResponse,
    SuggestToleranceRequest,
    SuggestToleranceResponse,
    TrendResponse,
)
from app.sqc.schemas import (
    ControlChartPoint as ControlChartPointSchema,
)
from app.sqc.schemas import (
    IChartPoint as IChartPointSchema,
)
from app.sqc.schemas import (
    NqaResult as NqaResultSchema,
)
from app.sqc.schemas import (
    ProfileSideStats as ProfileSideStatsSchema,
)
from app.sqc.statistics import tolerance_used_pct

router = APIRouter(prefix="/api/sqc", tags=["sqc"])


@router.get("/capability-thresholds", response_model=CapabilityThresholds)
async def capability_thresholds(_: CurrentUser) -> CapabilityThresholds:
    return CapabilityThresholds(
        default_minimum=1.33,
        warning_minimum=1.0,
        tolerance_warning_pct=80.0,
        tolerance_limit_pct=100.0,
        dppm_good_max=1_000.0,
        dppm_warning_max=10_000.0,
    )


# ── Uncertainty helper ─────────────────────────────────────────────────────────


def _unc_zone(
    measured: float,
    eff_usl: float,
    eff_lsl: float | None,
    unc: float,
) -> str | None:
    """Classifica uma medição em relação à zona de incerteza do instrumento."""
    if unc <= 0:
        return None
    above_usl = measured > eff_usl
    near_usl = abs(measured - eff_usl) < unc
    if not above_usl and near_usl:
        return "approved_at_risk"
    if above_usl and near_usl:
        return "rejected_recoverable"
    if eff_lsl is not None:
        below_lsl = measured < eff_lsl
        near_lsl = abs(measured - eff_lsl) < unc
        if not below_lsl and near_lsl:
            return "approved_at_risk"
        if below_lsl and near_lsl:
            return "rejected_recoverable"
    return None


def _direction_to_schema(d: service.DirectionResult) -> DirectionResultSchema:
    return DirectionResultSchema(
        axis=d.axis.value,
        related_size_dim_code=d.related_size_dim_code,
        measured_size=d.measured_size,
        related_size_nominal=d.related_size_nominal,
        related_size_tol_plus=d.related_size_tol_plus,
        related_size_tol_minus=d.related_size_tol_minus,
        related_size_deviation=d.related_size_deviation,
        material_condition=d.material_condition,
        bonus=d.bonus,
        nominal=d.nominal,
        measured=d.measured,
        deviation=d.deviation,
        base_limit=d.base_limit,
        effective_limit=d.effective_limit,
        ratio_signed=d.ratio_signed,
        utilization=d.utilization,
    )


# ── Instruments ────────────────────────────────────────────────────────────────


@router.get("/instruments", response_model=list[InstrumentRead])
async def list_instruments(
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[InstrumentRead]:
    instruments = await service.list_instruments(session)
    return [InstrumentRead.model_validate(i) for i in instruments]


@router.post("/instruments", response_model=InstrumentRead, status_code=status.HTTP_201_CREATED)
async def create_instrument(
    data: InstrumentCreate,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> InstrumentRead:
    try:
        async with session.begin_nested():
            inst = await service.create_instrument(session, data)
        return InstrumentRead.model_validate(inst)
    except IntegrityError:
        raise HTTPException(status_code=409, detail="código de instrumento já existe") from None


@router.patch("/instruments/{instrument_id}", response_model=InstrumentRead)
async def update_instrument(
    instrument_id: uuid.UUID,
    data: InstrumentUpdate,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> InstrumentRead:
    inst = await service.get_instrument(session, instrument_id)
    if not inst:
        raise HTTPException(status_code=404, detail="instrumento não encontrado")
    inst = await service.update_instrument(session, inst, data)
    await session.flush()
    return InstrumentRead.model_validate(inst)


@router.delete("/instruments/{instrument_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instrument(
    instrument_id: uuid.UUID,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    inst = await service.get_instrument(session, instrument_id)
    if not inst:
        raise HTTPException(status_code=404, detail="instrumento não encontrado")
    await service.delete_instrument(session, inst)
    await session.flush()


# ── Parts ──────────────────────────────────────────────────────────────────────


@router.get("/parts", response_model=list[PartRead])
async def list_parts(
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[PartRead]:
    parts = await service.list_parts(session)
    return [PartRead.model_validate(p) for p in parts]


@router.post("/parts", response_model=PartRead, status_code=status.HTTP_201_CREATED)
async def create_part(
    data: PartCreate,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> PartRead:
    try:
        async with session.begin_nested():
            part = await service.create_part(session, data)
        return PartRead.model_validate(part)
    except IntegrityError:
        raise HTTPException(status_code=409, detail="código de peça já existe") from None


@router.patch("/parts/{part_id}", response_model=PartRead)
async def update_part(
    part_id: uuid.UUID,
    data: PartUpdate,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> PartRead:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")
    part = await service.update_part(session, part, data)
    await session.flush()
    return PartRead.model_validate(part)


# ── Dims ───────────────────────────────────────────────────────────────────────


@router.get("/parts/{part_id}/dims", response_model=list[DimRead])
async def list_dims(
    part_id: uuid.UUID,
    _: CurrentUser,
    include_children: bool = Query(default=False),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[DimRead]:
    dims = await service.list_dims_for_part(session, part_id, include_children)
    return [DimRead.model_validate(d) for d in dims]


@router.post("/parts/{part_id}/dims", response_model=DimRead, status_code=status.HTTP_201_CREATED)
async def create_dim(
    part_id: uuid.UUID,
    data: DimCreate,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DimRead:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")
    try:
        async with session.begin_nested():
            dim = await service.create_dim(session, part_id, data, actor_email=user.email)
        await session.refresh(dim, attribute_names=["children"])
        return DimRead.model_validate(dim)
    except IntegrityError:
        raise HTTPException(
            status_code=409, detail="código de dimensão já existe para esta peça"
        ) from None


@router.patch("/parts/{part_id}/dims/{dim_id}", response_model=DimRead)
async def update_dim(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    data: DimUpdate,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DimRead:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")
    dim = await service.get_dim(session, dim_id)
    if not dim or dim.part_id != part_id:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")
    dim = await service.update_dim(session, dim, data, actor_email=user.email)
    await session.flush()
    await session.refresh(dim, attribute_names=["children"])
    for child in dim.children:
        await session.refresh(child, attribute_names=["children"])
    return DimRead.model_validate(dim)


@router.delete("/parts/{part_id}/dims/{dim_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dim(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")
    dim = await service.get_dim(session, dim_id)
    if not dim or dim.part_id != part_id:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    conflict = await service.check_dim_delete_conflict(session, dim)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)

    await service.delete_dim(session, dim, actor_email=user.email)


# ── Directional Axis Relations (RECTANGLE positions) ────────────────────────────


async def _get_rectangle_position_or_404(
    session: AsyncSession, part_id: uuid.UUID, dim_id: uuid.UUID
) -> Dim:
    dim = await service.get_dim(session, dim_id)
    if (
        not dim
        or dim.part_id != part_id
        or dim.type != DimType.POSITION
        or dim.zone_geometry != ZoneGeometry.RECTANGLE
    ):
        raise HTTPException(status_code=404, detail="posição RECTANGLE não encontrada nesta peça")
    return dim


def _relation_to_read(relation, coord_code: str, related_code: str | None) -> DimAxisRelationRead:
    return DimAxisRelationRead(
        id=relation.id,
        axis=relation.axis,
        coordinate_dim_id=relation.coordinate_dim_id,
        coordinate_dim_code=coord_code,
        related_size_dim_id=relation.related_size_dim_id,
        related_size_dim_code=related_code,
    )


async def _to_relation_read(session: AsyncSession, relation) -> DimAxisRelationRead:
    coord = await service.get_dim(session, relation.coordinate_dim_id)
    related = (
        await service.get_dim(session, relation.related_size_dim_id)
        if relation.related_size_dim_id
        else None
    )
    return _relation_to_read(
        relation,
        coord.dim_code if coord else "",
        related.dim_code if related else None,
    )


@router.get("/parts/{part_id}/dims/{dim_id}/relations", response_model=list[DimAxisRelationRead])
async def list_axis_relations(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[DimAxisRelationRead]:
    position = await _get_rectangle_position_or_404(session, part_id, dim_id)
    relations = await service.list_axis_relations(session, position.id)
    return [await _to_relation_read(session, r) for r in relations]


@router.post(
    "/parts/{part_id}/dims/{dim_id}/relations",
    response_model=DimAxisRelationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_axis_relation(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    data: DimAxisRelationCreate,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DimAxisRelationRead:
    position = await _get_rectangle_position_or_404(session, part_id, dim_id)
    try:
        async with session.begin_nested():
            relation = await service.create_axis_relation(
                session, position, data, actor_email=user.email
            )
    except service.AxisRelationLimitError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except service.AxisRelationValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return await _to_relation_read(session, relation)


@router.patch(
    "/parts/{part_id}/dims/{dim_id}/relations/{relation_id}",
    response_model=DimAxisRelationRead,
)
async def update_axis_relation(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    relation_id: uuid.UUID,
    data: DimAxisRelationUpdate,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DimAxisRelationRead:
    position = await _get_rectangle_position_or_404(session, part_id, dim_id)
    relation = await service.get_axis_relation(session, relation_id)
    if not relation or relation.position_dim_id != position.id:
        raise HTTPException(status_code=404, detail="relação não encontrada")
    try:
        async with session.begin_nested():
            relation = await service.update_axis_relation(
                session, position, relation, data, actor_email=user.email
            )
    except service.AxisRelationValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return await _to_relation_read(session, relation)


@router.delete(
    "/parts/{part_id}/dims/{dim_id}/relations/{relation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_axis_relation(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    relation_id: uuid.UUID,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    position = await _get_rectangle_position_or_404(session, part_id, dim_id)
    relation = await service.get_axis_relation(session, relation_id)
    if not relation or relation.position_dim_id != position.id:
        raise HTTPException(status_code=404, detail="relação não encontrada")
    await service.delete_axis_relation(session, position, relation, actor_email=user.email)


# ── Batches ────────────────────────────────────────────────────────────────────


@router.get("/batches", response_model=list[BatchRead])
async def list_batches(
    _: CurrentUser,
    part_id: uuid.UUID | None = Query(default=None),
    supplier_id: str | None = Query(default=None),
    project_status: ProjectStatus | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[BatchRead]:
    rows = await service.list_batches(session, part_id, supplier_id, project_status)
    result = []
    for batch, count in rows:
        br = BatchRead.model_validate(batch)
        br.inspection_count = count
        result.append(br)
    return result


@router.post("/batches", response_model=BatchRead, status_code=status.HTTP_201_CREATED)
async def create_batch(
    data: BatchCreate,
    _: SqcWriter,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> BatchRead:
    part = await service.get_part(session, data.part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")
    try:
        async with session.begin_nested():
            batch = await service.create_batch(session, data)
        br = BatchRead.model_validate(batch)
        br.inspection_count = 0
        return br
    except IntegrityError:
        raise HTTPException(status_code=409, detail="tracking code já existe") from None


@router.patch("/batches/{batch_id}", response_model=BatchRead)
async def update_batch(
    batch_id: uuid.UUID,
    data: BatchUpdate,
    _: SqcWriter,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> BatchRead:
    batch = await service.get_batch_for_update(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    conflict = service.check_batch_editable(batch)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)
    batch = await service.update_batch(session, batch, data)
    br = BatchRead.model_validate(batch)
    br.inspection_count = await service.get_inspection_count(session, batch.id)
    return br


@router.post("/batches/{batch_id}/decision", response_model=BatchRead)
async def decide_batch(
    batch_id: uuid.UUID,
    data: BatchDecisionRequest,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> BatchRead:
    batch = await service.get_batch_for_update(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    conflict = await service.check_batch_decidable(session, batch)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)
    batch = await service.decide_batch(session, batch, data.outcome, data.justification)
    br = BatchRead.model_validate(batch)
    br.inspection_count = await service.get_inspection_count(session, batch.id)
    return br


@router.get("/batches/{batch_id}/nqa-summary", response_model=list[NqaSummaryRow])
async def get_nqa_summary(
    batch_id: uuid.UUID,
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[NqaSummaryRow]:
    batch = await service.get_batch(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    rows = await service.get_nqa_summary_for_batch(session, batch)
    return [
        NqaSummaryRow(
            dim_id=dim.id,
            dim_code=dim.dim_code,
            result=NqaResultSchema(
                batch_size=result.batch_size,
                inspection_level=result.inspection_level,
                aql=result.aql,
                letter=result.letter,
                required_sample_size=result.required_sample_size,
                acceptance_number=result.acceptance_number,
                rejection_number=result.rejection_number,
                inspected=result.inspected,
                non_conforming=result.non_conforming,
                status=result.status,
                achieved_aql=result.achieved_aql,
                non_evaluable_count=result.non_evaluable_count,
                diagnostic_incomplete_count=result.diagnostic_incomplete_count,
            ),
        )
        for dim, result in rows
    ]


# ── Import CSV ─────────────────────────────────────────────────────────────────


@router.post("/batches/{batch_id}/import", response_model=ImportResult)
async def import_csv(
    batch_id: uuid.UUID,
    file: UploadFile,
    _: SqcWriter,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> ImportResult:
    batch = await service.get_batch_for_update(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    conflict = service.check_batch_editable(batch)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)

    dims_map = await service.get_dims_map_for_part(session, batch.part_id)
    content = await file.read()
    valid_rows, result = parse_csv(content, dims_map)
    if result.errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "arquivo inválido; nenhuma medição foi importada",
                "errors": [error.model_dump() for error in result.errors],
            },
        )

    source_import_digest = hashlib.sha256(content).hexdigest()
    for row in valid_rows:
        row["source_import_digest"] = source_import_digest
    valid_rows, duplicates = service.screen_reimported_measurements(
        valid_rows,
        await service.existing_import_measurement_keys(session, batch_id, source_import_digest),
        {dim_id: code for code, (dim_id, _nominal) in dims_map.items()},
    )
    if duplicates:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "arquivo já importado; nenhuma medição foi adicionada",
                "errors": [error.model_dump() for error in duplicates],
            },
        )

    await service.import_inspections(session, batch_id, valid_rows)
    await session.flush()
    return ImportResult(imported=len(valid_rows), rejected=0, errors=[])


# ── Import Dimensões ───────────────────────────────────────────────────────────


_DIM_DIFF_FIELDS = ("nominal", "tol_plus", "tol_minus", "dim_name", "drawing_revision")
_REF_IMPORT_FIELDS = (
    ("parent_dim_id", "parent_dim_code"),
    ("dim_rel_1_id", "dim_rel_1_code"),
    ("dim_rel_2_id", "dim_rel_2_code"),
)


async def _list_dim_import_relations(
    session: AsyncSession, dims: dict[str, Dim]
) -> list[DimAxisRelation]:
    dim_ids = [dim.id for dim in dims.values()]
    if not dim_ids:
        return []
    result = await session.execute(
        select(DimAxisRelation).where(DimAxisRelation.position_dim_id.in_(dim_ids))
    )
    return list(result.scalars().all())


def _relation_preview_changes(
    row: dict,
    existing: dict[str, Dim],
    relations: list[DimAxisRelation],
) -> list[DimImportChange]:
    axis_str = row.get("coordinate_axis")
    parent_code = row.get("parent_dim_code")
    coordinate = existing.get(row["dim_code"])
    position = existing.get(parent_code) if parent_code else None
    if not axis_str or coordinate is None or position is None:
        return []

    relation = next(
        (item for item in relations if item.coordinate_dim_id == coordinate.id),
        None,
    )
    id_to_code = {dim.id: code for code, dim in existing.items()}
    current_axis = relation.axis.value if relation else None
    current_related = (
        id_to_code.get(relation.related_size_dim_id)
        if relation is not None and relation.related_size_dim_id is not None
        else None
    )
    incoming_related = row.get("related_size_dim_code")
    changes: list[DimImportChange] = []
    if current_axis != axis_str:
        changes.append(
            DimImportChange(field="coordinate_axis", current=current_axis, incoming=axis_str)
        )
    if current_related != incoming_related:
        changes.append(
            DimImportChange(
                field="related_size_dim_code",
                current=current_related,
                incoming=incoming_related,
            )
        )
    return changes


def _dim_import_diff(
    dim: Dim,
    row: dict,
    resolved_ids: dict[str, uuid.UUID] | None = None,
) -> dict[str, object]:
    diff: dict[str, object] = {
        field: row.get(field) for field in _DIM_DIFF_FIELDS if getattr(dim, field) != row.get(field)
    }
    if resolved_ids is not None:
        for attr, code_field in _REF_IMPORT_FIELDS:
            incoming_code = row.get(code_field)
            if not incoming_code:
                continue
            incoming_id = resolved_ids.get(incoming_code)
            if getattr(dim, attr) != incoming_id:
                diff[attr] = incoming_id
    return diff


async def _apply_dim_import(
    session: AsyncSession,
    *,
    part_id: uuid.UUID,
    dim_rows: list[dict],
    existing: dict[str, Dim],
    actor_email: str,
) -> DimImportResult:
    """Aplica um plano já validado; o chamador controla a transação externa."""
    preview: list[DimPreviewRow] = []
    created = skipped = updated = 0
    existing_relations = await _list_dim_import_relations(session, existing)

    planned_ids = {code: dim.id for code, dim in existing.items()}
    for row in dim_rows:
        planned_ids.setdefault(row["dim_code"], uuid.uuid4())

    created_codes: set[str] = set()
    for row in dim_rows:
        code = row["dim_code"]
        if code in existing:
            dim = existing[code]
            field_updates = _dim_import_diff(dim, row, planned_ids)
            relation_updates = _relation_preview_changes(row, existing, existing_relations)
            if not field_updates and not relation_updates:
                preview.append(
                    DimPreviewRow(
                        dim_code=code,
                        dim_name=row["dim_name"],
                        drawing_revision=row["drawing_revision"],
                        status="exists",
                    )
                )
                skipped += 1
                continue

            update_data = DimUpdate.model_validate(field_updates)
            await service.update_dim(
                session,
                dim,
                update_data,
                actor_email=actor_email,
                action="update_import",
            )
            preview.append(
                DimPreviewRow(
                    dim_code=code,
                    dim_name=row["dim_name"],
                    drawing_revision=row["drawing_revision"],
                    status="updated",
                )
            )
            updated += 1
            continue

        dim_type = DimType(row["type"])
        sub_type = DimSubType(row["sub_type"]) if row.get("sub_type") else None
        mat_mod = (
            MaterialModifier(row["material_modifier"]) if row.get("material_modifier") else None
        )
        zone_geom = ZoneGeometry(row["position_geometry"]) if row.get("position_geometry") else None
        new_dim = Dim(
            id=planned_ids[code],
            part_id=part_id,
            dim_code=code,
            dim_name=row["dim_name"],
            drawing_revision=row["drawing_revision"],
            type=dim_type,
            sub_type=sub_type,
            nominal=row["nominal"],
            tol_plus=row["tol_plus"],
            tol_minus=row["tol_minus"],
            material_modifier=mat_mod,
            parent_dim_id=(
                planned_ids.get(row["parent_dim_code"]) if row.get("parent_dim_code") else None
            ),
            dim_rel_1_id=(
                planned_ids.get(row["dim_rel_1_code"]) if row.get("dim_rel_1_code") else None
            ),
            dim_rel_2_id=(
                planned_ids.get(row["dim_rel_2_code"]) if row.get("dim_rel_2_code") else None
            ),
            zone_geometry=zone_geom,
        )
        session.add(new_dim)
        await session.flush()
        created_codes.add(code)

        initial_fields = (
            "drawing_revision",
            "dim_code",
            "dim_name",
            "type",
            "sub_type",
            "nominal",
            "tol_plus",
            "tol_minus",
            "material_modifier",
            "dim_rel_1_id",
            "dim_rel_2_id",
            "parent_dim_id",
            "zone_geometry",
        )
        await service.record_dim_history(
            session,
            part_id=part_id,
            dim_id=new_dim.id,
            dim_code=new_dim.dim_code,
            changes=[
                (field, None, value)
                for field in initial_fields
                if (value := getattr(new_dim, field)) is not None
            ],
            action="create_import",
            actor_email=actor_email,
        )
        preview.append(
            DimPreviewRow(
                dim_code=code,
                dim_name=row["dim_name"],
                drawing_revision=row["drawing_revision"],
                status="new",
            )
        )
        created += 1

    await session.flush()
    all_dims_after = await service.get_dims_map_full(session, part_id)
    relations = await _list_dim_import_relations(session, all_dims_after)
    relation_by_coordinate = {relation.coordinate_dim_id: relation for relation in relations}
    dim_by_id = {dim.id: dim for dim in all_dims_after.values()}
    # Trocas de eixo precisam remover primeiro as relações afetadas; caso contrário,
    # uma troca X↔Y viola a unicidade durante o primeiro UPDATE, antes do segundo.
    for row in dim_rows:
        axis_str = row.get("coordinate_axis")
        parent_code = row.get("parent_dim_code")
        if not axis_str or not parent_code:
            continue
        coordinate_dim = all_dims_after[row["dim_code"]]
        relation = relation_by_coordinate.get(coordinate_dim.id)
        desired_position = all_dims_after.get(parent_code)
        if relation is None or (
            relation.axis == DimAxis(axis_str)
            and desired_position is not None
            and relation.position_dim_id == desired_position.id
        ):
            continue
        current_position = dim_by_id[relation.position_dim_id]
        await service.delete_axis_relation(session, current_position, relation, actor_email)
        relation_by_coordinate.pop(coordinate_dim.id)

    for row in dim_rows:
        axis_str = row.get("coordinate_axis")
        parent_code = row.get("parent_dim_code")
        if not axis_str or not parent_code:
            continue
        position = all_dims_after.get(parent_code)
        coordinate_dim = all_dims_after[row["dim_code"]]
        if position is None or position.zone_geometry != ZoneGeometry.RECTANGLE:
            continue
        axis = DimAxis(axis_str)
        related_code = row.get("related_size_dim_code")
        related_id = all_dims_after[related_code].id if related_code else None
        relation = relation_by_coordinate.get(coordinate_dim.id)
        if relation is None:
            relation = await service.create_axis_relation(
                session,
                position,
                DimAxisRelationCreate(
                    axis=axis,
                    coordinate_dim_id=coordinate_dim.id,
                    related_size_dim_id=related_id,
                ),
                actor_email,
            )
            relation_by_coordinate[coordinate_dim.id] = relation
            continue
        if relation.axis == axis and relation.related_size_dim_id == related_id:
            continue
        await service.update_axis_relation(
            session,
            position,
            relation,
            DimAxisRelationUpdate(axis=axis, related_size_dim_id=related_id),
            actor_email,
        )

    await session.flush()
    return DimImportResult(
        created=created,
        skipped=skipped,
        updated=updated,
        errors=[],
        preview=preview,
    )


@router.post("/parts/{part_id}/import-dims", response_model=DimImportResult)
async def import_dims(
    part_id: uuid.UUID,
    file: UploadFile,
    user: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DimImportResult:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")

    content = await file.read()
    dim_rows, errors = parse_dims_csv(content)
    existing = await service.get_dims_map_full(session, part_id)
    existing_relations = await _list_dim_import_relations(session, existing)
    row_errors = _validate_dim_import_rows(dim_rows, existing, existing_relations)
    errors.extend(
        f"{code}: {error}" for code, code_errors in row_errors.items() for error in code_errors
    )
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    try:
        async with session.begin_nested():
            return await _apply_dim_import(
                session,
                part_id=part_id,
                dim_rows=dim_rows,
                existing=existing,
                actor_email=user.email,
            )
    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="importação concorrente criou uma dimensão ou relação com o mesmo código/eixo",
        ) from None


# ── Import Dimensões — Preview (somente leitura) ───────────────────────────────


@router.post("/parts/{part_id}/import-dims-preview", response_model=DimImportPreview)
async def import_dims_preview(
    part_id: uuid.UUID,
    file: UploadFile,
    _: SqcEngineer,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DimImportPreview:
    """Classifica cada linha do CSV (new/unchanged/overwritten) sem persistir nada — permite
    revisar o que vai mudar antes de confirmar via o import-dims existente."""
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")

    content = await file.read()
    dim_rows, errors = parse_dims_csv(content)

    existing = await service.get_dims_map_full(session, part_id)
    existing_relations = await _list_dim_import_relations(session, existing)
    row_errors = _validate_dim_import_rows(dim_rows, existing, existing_relations)
    resolved_ids = {code: dim.id for code, dim in existing.items()}
    for row in dim_rows:
        resolved_ids.setdefault(row["dim_code"], uuid.uuid4())
    rows: list[DimImportPreviewRow] = []

    for row in dim_rows:
        code = row["dim_code"]
        dim = existing.get(code)
        axis_str = row.get("coordinate_axis")
        try:
            axis = DimAxis(axis_str) if axis_str else None
        except ValueError:
            axis = None
        related_code = row.get("related_size_dim_code")
        if dim is None:
            rows.append(
                DimImportPreviewRow(
                    dim_code=code,
                    status="new",
                    coordinate_axis=axis,
                    related_size_dim_code=related_code,
                    changes=[],
                    errors=row_errors.get(code, []),
                )
            )
            continue

        changes = [
            DimImportChange(
                field=field,
                current=None if (current := getattr(dim, field)) is None else str(current),
                incoming=None if incoming is None else str(incoming),
            )
            for field, incoming in _dim_import_diff(dim, row, resolved_ids).items()
        ]
        changes.extend(_relation_preview_changes(row, existing, existing_relations))
        rows.append(
            DimImportPreviewRow(
                dim_code=code,
                status="overwritten" if changes else "unchanged",
                coordinate_axis=axis,
                related_size_dim_code=related_code,
                changes=changes,
                errors=row_errors.get(code, []),
            )
        )

    return DimImportPreview(rows=rows, errors=errors)


def _validate_dim_import_rows(
    dim_rows: list[dict],
    existing: dict[str, Dim],
    existing_relations: list[DimAxisRelation],
) -> dict[str, list[str]]:
    """Sinaliza, sem persistir nada, problemas de geometria/eixo/relação RECTANGLE que o
    import de fato rejeitaria ou ignoraria (US2/FR-034) — eixo duplicado, referência cruzada
    de peça (código não resolvido nesta peça) e componente novo sem coordinate_axis. Também
    sinaliza uma posição LINE nova com material_modifier preenchido (feature 061, FR-004) —
    esse combo é rejeitado (sem criar a dim) na confirmação do import."""
    by_code = {row["dim_code"]: row for row in dim_rows}

    errors_by_code: dict[str, list[str]] = {}
    valid_codes = set(existing) | set(by_code)
    for row in dim_rows:
        code = row["dim_code"]
        for field in ("parent_dim_code", "dim_rel_1_code", "dim_rel_2_code"):
            ref_code = row.get(field)
            if ref_code and ref_code not in valid_codes:
                errors_by_code.setdefault(code, []).append(
                    f"{field} '{ref_code}' não encontrado nesta peça"
                )

        if code in existing:
            continue  # enums/geometria são create-only; referências ainda são validadas acima

        for field, enum_type in (
            ("type", DimType),
            ("sub_type", DimSubType),
            ("material_modifier", MaterialModifier),
            ("position_geometry", ZoneGeometry),
        ):
            value = row.get(field)
            if not value:
                continue
            try:
                enum_type(value)
            except ValueError:
                errors_by_code.setdefault(code, []).append(f"{field} '{value}' inválido")

        position_geometry = row.get("position_geometry")
        if row.get("type") == DimType.POSITION.value and not position_geometry:
            errors_by_code.setdefault(code, []).append(
                "position_geometry é obrigatório quando type=POSITION"
            )
        elif row.get("type") != DimType.POSITION.value and position_geometry:
            errors_by_code.setdefault(code, []).append(
                "position_geometry só é aplicável quando type=POSITION"
            )
        if position_geometry == ZoneGeometry.LINE.value and row.get("material_modifier"):
            errors_by_code.setdefault(code, []).append(
                "material_modifier não é aplicável a uma posição LINE"
            )

    def _resolve_geometry(code: str | None) -> str | None:
        if not code:
            return None
        existing_dim = existing.get(code)
        if existing_dim is not None:
            return existing_dim.zone_geometry.value if existing_dim.zone_geometry else None
        row = by_code.get(code)
        return row.get("position_geometry") if row else None

    def _resolve_type(code: str | None) -> str | None:
        if not code:
            return None
        if code in existing:
            return existing[code].type.value
        row = by_code.get(code)
        return row.get("type") if row else None

    id_to_code = {dim.id: code for code, dim in existing.items()}
    axis_usage: dict[tuple[str, str], str] = {}  # (parent_code, axis) -> coordinate code
    relation_counts: Counter[str] = Counter()
    persisted_by_coordinate: dict[str, tuple[str, DimAxisRelation]] = {}
    for relation in existing_relations:
        parent_code = id_to_code.get(relation.position_dim_id)
        coordinate_code = id_to_code.get(relation.coordinate_dim_id)
        if parent_code is None or coordinate_code is None:
            continue
        axis_usage[(parent_code, relation.axis.value)] = coordinate_code
        relation_counts[parent_code] += 1
        persisted_by_coordinate[coordinate_code] = (parent_code, relation)

    # Remove do estado persistido as relações explicitamente reenviadas: elas serão
    # recolocadas abaixo com o eixo desejado, permitindo inclusive uma troca X↔Y atômica.
    for row in dim_rows:
        parent_code = row.get("parent_dim_code")
        axis_str = row.get("coordinate_axis")
        if not parent_code or not axis_str:
            continue
        persisted = persisted_by_coordinate.get(row["dim_code"])
        if persisted is None:
            continue
        persisted_parent_code, relation = persisted
        axis_usage.pop((persisted_parent_code, relation.axis.value), None)
        relation_counts[persisted_parent_code] -= 1

    for row in dim_rows:
        code = row["dim_code"]
        parent_code = row.get("parent_dim_code")
        axis_str = row.get("coordinate_axis")
        if not parent_code:
            continue
        if (
            _resolve_type(parent_code) != "POSITION"
            or _resolve_geometry(parent_code) != "RECTANGLE"
        ):
            continue

        if not axis_str:
            if code not in existing:
                errors_by_code.setdefault(code, []).append(
                    "coordinate_axis é obrigatório para um novo componente de coordenada "
                    "de uma posição RECTANGLE"
                )
            continue

        try:
            DimAxis(axis_str)
        except ValueError:
            errors_by_code.setdefault(code, []).append(f"coordinate_axis '{axis_str}' inválido")
            continue

        relation_counts[parent_code] += 1
        if relation_counts[parent_code] > 2:
            errors_by_code.setdefault(code, []).append(
                "posição RECTANGLE aceita no máximo duas relações direcionais"
            )

        key = (parent_code, axis_str)
        if key in axis_usage and axis_usage[key] != code:
            errors_by_code.setdefault(code, []).append(
                f"eixo {axis_str} já utilizado por {axis_usage[key]} nesta posição"
            )
        else:
            axis_usage[key] = code

        related_code = row.get("related_size_dim_code")
        if related_code and related_code not in existing and related_code not in by_code:
            errors_by_code.setdefault(code, []).append(
                f"related_size_dim_code '{related_code}' não encontrado nesta peça"
            )
        elif related_code:
            related = existing.get(related_code)
            related_row = by_code.get(related_code)
            related_sub_type = (
                related.sub_type.value
                if related is not None and related.sub_type is not None
                else (related_row or {}).get("sub_type")
            )
            parent = existing.get(parent_code)
            parent_row = by_code.get(parent_code)
            modifier = (
                parent.material_modifier.value
                if parent is not None and parent.material_modifier is not None
                else (parent_row or {}).get("material_modifier")
            )
            if modifier and related_sub_type not in {
                DimSubType.HOLE.value,
                DimSubType.SLOT.value,
                DimSubType.SHAFT.value,
                DimSubType.WIDTH.value,
            }:
                errors_by_code.setdefault(code, []).append(
                    f"sub_type de {related_code} não permite classificar interno/externo, "
                    "exigido quando a posição tem material_modifier"
                )

    parent_codes: set[str] = {
        code for row in dim_rows if isinstance((code := row.get("parent_dim_code")), str) and code
    }
    for parent_code in parent_codes:
        parent = existing.get(parent_code)
        parent_row = by_code.get(parent_code)
        modifier = (
            parent.material_modifier.value
            if parent is not None and parent.material_modifier is not None
            else (parent_row or {}).get("material_modifier")
        )
        if not modifier:
            continue
        natures: dict[bool, str] = {}
        for row in dim_rows:
            if row.get("parent_dim_code") != parent_code:
                continue
            related_code = row.get("related_size_dim_code")
            if not isinstance(related_code, str) or not related_code:
                continue
            related = existing.get(related_code)
            related_row = by_code.get(related_code)
            sub_type = (
                related.sub_type.value
                if related is not None and related.sub_type is not None
                else (related_row or {}).get("sub_type")
            )
            if sub_type in {DimSubType.HOLE.value, DimSubType.SLOT.value}:
                natures[True] = related_code
            elif sub_type in {DimSubType.SHAFT.value, DimSubType.WIDTH.value}:
                natures[False] = related_code
        if len(natures) > 1:
            errors_by_code.setdefault(parent_code, []).append(
                "related_size_dim_code deve ter natureza interno/externo consistente "
                "entre as relações"
            )

    return errors_by_code


# ── Import Medições — Preview ──────────────────────────────────────────────────


@router.post("/batches/{batch_id}/import-preview", response_model=MeasurementPreview)
async def import_measurements_preview(
    batch_id: uuid.UUID,
    file: UploadFile,
    _: SqcWriter,
    sheet_name: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> MeasurementPreview:
    batch = await service.get_batch(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")

    content = await file.read()
    filename = file.filename or ""
    records, parse_errors, sheets = _parse_measurements_or_400(content, filename, sheet_name)

    dims_full = await service.get_dims_map_full(session, batch.part_id)
    source_import_digest = hashlib.sha256(content).hexdigest()
    candidates = [
        {
            "dim_id": dims_full[row["dim_code"]].id,
            "source_row": row["source_row"],
        }
        for row in records
        if row["dim_code"] in dims_full
    ]
    kept, _duplicates = service.screen_reimported_measurements(
        candidates,
        await service.existing_import_measurement_keys(session, batch_id, source_import_digest),
        {dim.id: code for code, dim in dims_full.items()},
    )
    duplicate_pairs = len(candidates) - len(kept)

    # Agregar por dim_code
    from collections import defaultdict

    counts: dict[str, set[int]] = defaultdict(set)
    for rec in records:
        counts[rec["dim_code"]].add(rec["part_number"])

    list(counts.keys()) if counts else [r["dim_code"] for r in records[:1]]
    # Pegar dim_codes da primeira linha de records para ter a lista completa
    seen_codes: list[str] = []
    for rec in records:
        if rec["dim_code"] not in seen_codes:
            seen_codes.append(rec["dim_code"])

    preview_rows = [
        MeasurementPreviewRow(
            dim_code=code,
            dim_type=dims_full[code].type.value if code in dims_full else None,
            part_count=len(counts[code]),
            status="found" if code in dims_full else "not_found",
        )
        for code in seen_codes
    ]

    # Metadados (primeiro registro não-nulo)
    operator = next((r["operator"] for r in records if r["operator"]), None)
    instrument = next((r["instrument"] for r in records if r["instrument"]), None)
    fixture = next((r["fixture"] for r in records if r["fixture"]), None)
    work_order = next((r["work_order"] for r in records if r["work_order"]), None)

    dates = [r["date_time"] for r in records if r.get("date_time")]
    date_start = min(dates).isoformat() if dates else None
    date_end = max(dates).isoformat() if dates else None

    parts_set = {r["part_number"] for r in records}
    found = sum(1 for r in preview_rows if r.status == "found")

    return MeasurementPreview(
        rows=preview_rows,
        sheets=sheets,
        operator=operator,
        instrument=instrument,
        fixture=fixture,
        work_order=work_order,
        date_start=date_start,
        date_end=date_end,
        total_parts=len(parts_set),
        total_dims=len(preview_rows),
        found_dims=found,
        missing_dims=len(preview_rows) - found,
        duplicate_pairs=duplicate_pairs,
        errors=parse_errors,
    )


# ── Import Medições — Confirmar ────────────────────────────────────────────────


@router.post("/batches/{batch_id}/import-measurements", response_model=ImportResult)
async def import_measurements(
    batch_id: uuid.UUID,
    file: UploadFile,
    _: SqcWriter,
    sheet_name: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> ImportResult:
    batch = await service.get_batch_for_update(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    conflict = service.check_batch_editable(batch)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)

    content = await file.read()
    filename = file.filename or ""
    records, parse_errors, _sheets = _parse_measurements_or_400(content, filename, sheet_name)

    dims_full = await service.get_dims_map_full(session, batch.part_id)

    from app.sqc.schemas import ImportError as ImportErrorSchema

    valid: list[dict] = []
    import_errors: list[ImportErrorSchema] = [
        ImportErrorSchema(row=0, dim_code="", reason=message) for message in parse_errors
    ]

    for rec in records:
        code = rec["dim_code"]
        if code not in dims_full:
            import_errors.append(
                ImportErrorSchema(
                    row=rec["source_row"],
                    dim_code=code,
                    reason="dim_code não encontrado nas dimensões da peça",
                )
            )
            continue
        dim = dims_full[code]

        valid.append(
            {
                "dim_id": dim.id,
                "part_number": rec["part_number"],
                "measured_value": rec["measured_value"],
                "deviation": rec["measured_value"] - dim.nominal,
                "date_time": rec["date_time"],
                "operator": rec["operator"],
                "instrument": rec["instrument"],
                "fixture": rec["fixture"],
                "work_order": rec["work_order"],
                "cavity": rec.get("cavity"),
                "source_row": rec["source_row"],
            }
        )

    if import_errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "arquivo inválido; nenhuma medição foi importada",
                "errors": [error.model_dump() for error in import_errors],
            },
        )

    source_import_digest = hashlib.sha256(content).hexdigest()
    for row in valid:
        row["source_import_digest"] = source_import_digest
    valid, duplicates = service.screen_reimported_measurements(
        valid,
        await service.existing_import_measurement_keys(session, batch_id, source_import_digest),
        {dim.id: code for code, dim in dims_full.items()},
    )
    if duplicates:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "arquivo já importado; nenhuma medição foi adicionada",
                "errors": [error.model_dump() for error in duplicates],
            },
        )

    await service.import_inspections(session, batch_id, valid)
    await session.flush()

    return ImportResult(imported=len(valid), rejected=0, errors=[])


# ── Drawing (PDF) — secure local storage ────────────────────────────────────────


def _safe_component(value: str) -> str:
    """Map user/database labels to a single storage filename component."""
    import re

    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-")
    return safe[:100] or "document"


def _safe_rev(revision: str) -> str:
    return _safe_component(revision)


def _drawing_key(part_code: str, revision: str) -> str:
    return f"sqc/drawings/{_safe_component(part_code)}_{_safe_rev(revision)}.pdf"


def _report_key(batch_id: uuid.UUID, part_number: int) -> str:
    return f"sqc/reports/{batch_id}/Part {part_number}.pdf"


_log = get_logger("sqc.uploads")


def _parse_measurements_or_400(
    content: bytes, filename: str, sheet_name: str | None
) -> tuple[list[dict], list[str], list[str]]:
    """Wrap `parse_measurements` so a corrupted/invalid file (e.g. a broken
    .xlsx/.xlsm archive) surfaces as a clear 400 instead of an unhandled 500 —
    see 048-sqc-xlsm-import FR-008."""
    try:
        return parse_measurements(content, filename, sheet_name)
    except Exception as exc:
        _log.error(
            "sqc_measurement_parse_failed",
            filename=filename,
            error=str(exc),
            error_type=type(exc).__name__,
        )
        raise HTTPException(
            status_code=400,
            detail="Não foi possível ler o arquivo de medições — verifique se o formato "
            "e o conteúdo do arquivo são válidos.",
        ) from exc


async def _put_object_or_502(key: str, content: bytes, content_type: str) -> None:
    try:
        await storage.put_object(key, content, content_type)
    except storage.StorageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        error_type = type(exc).__name__
        _log.error("sqc_upload_storage_failed", key=key, error=str(exc), error_type=error_type)
        raise HTTPException(
            status_code=502,
            detail="Falha ao salvar arquivo no armazenamento local.",
        ) from exc


@router.post("/parts/{part_id}/drawing", response_model=DrawingUploadResponse)
async def upload_drawing(
    part_id: uuid.UUID,
    _: SqcEngineer,
    file: UploadFile,
    drawing_revision: str = Form(...),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DrawingUploadResponse:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")
    if await service.drawing_revision_is_locked(session, part_id, drawing_revision):
        raise HTTPException(
            status_code=409,
            detail={"reason": "drawing_revision_used_by_decided_batch"},
        )

    key = _drawing_key(part.part_code, drawing_revision)
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="envie um arquivo PDF")
    content = await file.read()
    await _put_object_or_502(key, content, "application/pdf")
    filename = f"{part.part_code}_{_safe_rev(drawing_revision)}.pdf"
    url = await storage.presigned_get_url(key)
    return DrawingUploadResponse(url=url, filename=filename)


@router.get("/parts/{part_id}/drawing", response_model=DrawingUploadResponse)
async def get_drawing(
    part_id: uuid.UUID,
    _: CurrentUser,
    revision: str = Query(...),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DrawingUploadResponse:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")

    key = _drawing_key(part.part_code, revision)
    if await storage.get_object(key) is None:
        raise HTTPException(status_code=404, detail="desenho não encontrado")
    filename = f"{part.part_code}_{_safe_rev(revision)}.pdf"
    url = await storage.presigned_get_url(key)
    return DrawingUploadResponse(url=url, filename=filename)


# ── Measurement reports (PDF per part) — secure local storage ─────────────────


@router.post("/batches/{batch_id}/reports/upload", response_model=dict)
async def upload_reports(
    batch_id: uuid.UUID,
    _: SqcWriter,
    files: list[UploadFile],
    session: AsyncSession = Depends(get_session, scope="function"),
) -> dict:
    """Aceita PDFs individuais (Part N.pdf) ou um único arquivo .zip contendo os PDFs."""
    import io
    import re
    import zipfile

    batch = await service.get_batch_for_update(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    conflict = service.check_batch_editable(batch)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)

    staged: dict[int, bytes] = {}
    errors: list[str] = []

    def _stage(part_number: int, pdf: bytes, source_name: str) -> None:
        if part_number in staged:
            errors.append(f"{source_name}: Part {part_number}.pdf duplicado no envio")
            return
        try:
            storage.validate_pdf(pdf)
        except storage.StorageValidationError as exc:
            errors.append(f"{source_name}: PDF inválido ({exc})")
            return
        staged[part_number] = pdf

    for file in files:
        content = await file.read()
        name = file.filename or ""

        if name.lower().endswith(".zip"):
            if len(content) > get_settings().max_zip_bytes:
                errors.append(f"{name}: arquivo ZIP excede o limite configurado")
                continue
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    total_uncompressed = sum(info.file_size for info in zf.infolist())
                    if total_uncompressed > get_settings().max_zip_bytes:
                        errors.append(f"{name}: conteúdo ZIP excede o limite configurado")
                        continue
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        base = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
                        m = re.fullmatch(r"Part\s+(\d+)\.pdf", base, re.IGNORECASE)
                        if not m:
                            errors.append(
                                f"{name}: entrada '{info.filename}' inválida "
                                "(esperado 'Part N.pdf')"
                            )
                            continue
                        with zf.open(info) as src:
                            pdf = src.read(get_settings().max_pdf_bytes + 1)
                        _stage(int(m.group(1)), pdf, name)
            except zipfile.BadZipFile as exc:
                errors.append(f"{name}: arquivo ZIP inválido ({exc})")
        elif name.lower().endswith(".pdf"):
            m = re.fullmatch(r"Part\s+(\d+)\.pdf", name, re.IGNORECASE)
            if not m:
                errors.append(f"{name}: nome inválido (esperado 'Part N.pdf')")
            else:
                _stage(int(m.group(1)), content, name)
        else:
            errors.append(f"{name}: tipo não suportado (envie .pdf ou .zip)")

    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})

    previous = {pn: await storage.get_object(_report_key(batch_id, pn)) for pn in staged}
    written: list[int] = []
    try:
        for pn, pdf in staged.items():
            await _put_object_or_502(_report_key(batch_id, pn), pdf, "application/pdf")
            written.append(pn)
    except HTTPException:
        for pn in written:
            old = previous[pn]
            if old is None:
                await storage.delete_object(_report_key(batch_id, pn))
            else:
                await storage.put_object(_report_key(batch_id, pn), old, "application/pdf")
        raise

    return {"saved": sorted(staged), "errors": []}


@router.get("/batches/{batch_id}/reports", response_model=list[int])
async def list_reports(
    batch_id: uuid.UUID,
    _: CurrentUser,
) -> list[int]:
    """Retorna lista de part_numbers que têm PDF disponível."""
    import re

    prefix = f"sqc/reports/{batch_id}/"
    result: list[int] = []
    for key in await storage.list_keys(prefix):
        base = key.rsplit("/", 1)[-1]
        m = re.fullmatch(r"Part\s+(\d+)\.pdf", base, re.IGNORECASE)
        if m:
            result.append(int(m.group(1)))
    return sorted(result)


@router.get("/batches/{batch_id}/reports/{part_number}")
async def get_report(
    batch_id: uuid.UUID,
    part_number: int,
    _: CurrentUser,
) -> object:
    from fastapi.responses import Response

    data = await storage.get_object(_report_key(batch_id, part_number))
    if data is None:
        raise HTTPException(status_code=404, detail="relatório não encontrado")
    filename = f"Part {part_number}.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ── Cavidades ─────────────────────────────────────────────────────────────────


@router.get("/batches/{batch_id}/cavities", response_model=list[int])
async def list_batch_cavities(
    batch_id: uuid.UUID,
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[int]:
    from sqlalchemy import distinct as sa_distinct

    from app.sqc.models import Inspection as InspectionModel

    stmt = select(sa_distinct(InspectionModel.cavity)).where(
        InspectionModel.batch_id == batch_id,
        InspectionModel.cavity.is_not(None),
    )
    result = await session.execute(stmt)
    return sorted(v for (v,) in result if v is not None)


# ── Statistics ─────────────────────────────────────────────────────────────────


@router.get("/batches/{batch_id}/dims/{dim_id}/statistics", response_model=StatisticsResponse)
async def get_statistics(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    tol_plus_override: float | None = Query(default=None, gt=0),
    tol_minus_override: float | None = Query(default=None, ge=0),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> StatisticsResponse:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")
    return await _compute_statistics(
        session,
        dim,
        batch_id,
        dim_id,
        tol_plus_override=tol_plus_override,
        tol_minus_override=tol_minus_override,
        cavity=cavity,
    )


async def _compute_statistics(
    session: AsyncSession,
    dim: Dim,
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    *,
    tol_plus_override: float | None = None,
    tol_minus_override: float | None = None,
    cavity: int | None = None,
) -> StatisticsResponse:
    """Corpo de `get_statistics`, fatorado para reuso pelo PATCH de ignore (spec 252, T019/
    contracts/api-sqc-252.md §3) — mesmo código, chamado internamente em vez de duplicado."""
    eff_tol_plus = tol_plus_override if tol_plus_override is not None else dim.tol_plus
    eff_tol_minus = tol_minus_override if tol_minus_override is not None else dim.tol_minus
    tolerance_overridden = tol_plus_override is not None or tol_minus_override is not None

    subgroups = await service.get_inspections_grouped_by_part(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
    )
    result = stats.calculate_capability_with_subgroups(
        subgroups, eff_tol_plus, eff_tol_minus, dim.nominal
    )

    # Calcular % de tolerância usada por inspeção (inclui bônus MMC/LMC se aplicável)
    inspections = await service.get_inspections_for_dim(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
    )
    bonus_map = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)
    eff_usl = dim.nominal + eff_tol_plus
    tol_pcts = [
        stats.tolerance_used_pct(
            i.deviation,
            *stats.effective_tolerances(
                eff_tol_plus,
                eff_tol_minus,
                bonus_map.get((i.part_number, i.cavity), 0.0),
            ),
        )
        for i in inspections
        if abs(i.deviation) < 1e9  # excluir inf
    ]
    mean_tol_pct = sum(tol_pcts) / len(tol_pcts) if tol_pcts else None
    std_tol_pct = (
        (sum((t - mean_tol_pct) ** 2 for t in tol_pcts) / (len(tol_pcts) - 1)) ** 0.5
        if len(tol_pcts) >= 2 and mean_tol_pct is not None
        else None
    )

    # Ajustar índices de capabilidade para dims com modificador de material (MMC/LMC).
    # RECTANGLE nunca preenche `dim_rel_1_id` (usa a tabela de relações por eixo) — sem essa
    # exclusão, toda posição RECTANGLE+modificador cairia aqui e teria o Cpu zerado, mesmo
    # com as relações corretamente configuradas (mesma classe de bug dos itens 2/6/8 — o
    # bloco RECTANGLE abaixo, que já busca `pieces`, decide o Cpu real nesse caso).
    is_rectangle = dim.zone_geometry == ZoneGeometry.RECTANGLE
    has_modifier = dim.material_modifier is not None
    bonus_missing_rel = has_modifier and dim.dim_rel_1_id is None and not is_rectangle
    has_bonus = has_modifier and bool(bonus_map) and not is_rectangle
    capability_result = result

    if has_bonus:
        pairs = [
            (i.measured_value, eff_usl + bonus_map.get((i.part_number, i.cavity), 0.0))
            for i in inspections
        ]
        bonus_result = stats.calculate_capability_with_bonus(pairs)
        capability_result = bonus_result
        result.cp = bonus_result.cp
        result.cpk = bonus_result.cpk
        result.pp = bonus_result.pp
        result.ppk = bonus_result.ppk
        result.cpu = bonus_result.cpu
        result.cpl = bonus_result.cpl
        result.dppm = bonus_result.dppm
        result.insufficient_sample = bonus_result.insufficient_sample
        result.degenerate = bonus_result.degenerate
    elif bonus_missing_rel:
        result.cpu = result.cpk = None
        result.cp = None
        result.dppm = None

    # Contagem de peças nas zonas de incerteza
    unc_map = await service.get_instrument_uncertainty_map(session)
    n_at_risk = n_recoverable = 0
    for i in inspections:
        unc = unc_map.get((i.instrument or "").lower(), 0.0)
        zone = _unc_zone(
            i.measured_value,
            eff_usl + bonus_map.get((i.part_number, i.cavity), 0.0),
            (dim.nominal - abs(eff_tol_minus) - bonus_map.get((i.part_number, i.cavity), 0.0))
            if eff_tol_minus
            else None,
            unc,
        )
        if zone == "approved_at_risk":
            n_at_risk += 1
        elif zone == "rejected_recoverable":
            n_recoverable += 1

    # RECTANGLE (spec 060, T060): direção crítica majoritária + contagem de não avaliáveis,
    # para a comparação de cavidades/capabilidade (CavityCompareTable/CapabilityCompareTable).
    # Capabilidade por direção em si é T068 (US7) — aqui só os dois campos informativos.
    critical_axis: str | None = None
    non_evaluable_count = 0
    capability_direction_1: DirectionCapability | None = None
    capability_direction_2: DirectionCapability | None = None
    if dim.zone_geometry == ZoneGeometry.RECTANGLE:
        non_evaluable, _diagnostic_incomplete = await service.get_rectangle_evaluability(
            session, batch_id, dim, cavity=cavity
        )
        non_evaluable_count = len(non_evaluable)
        pieces = await service.get_rectangle_consolidated(
            session, batch_id, dim, cavity=cavity, tol_plus_override=tol_plus_override
        )
        axis_counts = Counter(p.critical_axis for p in pieces if p.critical_axis is not None)
        if axis_counts:
            critical_axis = axis_counts.most_common(1)[0][0]

        relations = await service.list_axis_relations(session, dim_id)

        # RECTANGLE + modificador (FR-015): mesma fonte já usada em Visão Geral/Heatmap — o
        # Cpu real vem do consolidado direcional (ratio já normalizado a limite=1.0), nunca do
        # valor bruto do ferramenta de medição. `has_bonus`/`bonus_missing_rel` pilotam os mesmos banners
        # de StatCards.tsx, agora corretos também para RECTANGLE (antes sempre caíam no bloco
        # acima e zeravam o Cpu incondicionalmente).
        if dim.material_modifier is not None:
            if not relations:
                bonus_missing_rel = True
                result.cpu = result.cpk = None
                result.cp = None
                result.dppm = None
            else:
                consolidated_pairs = [
                    (p.consolidated_utilization, 1.0)
                    for p in pieces
                    if p.consolidated_utilization is not None
                ]
                has_bonus = bool(consolidated_pairs)
                if consolidated_pairs:
                    consolidated_result = stats.calculate_capability_with_bonus(consolidated_pairs)
                    capability_result = consolidated_result
                    result.cp = consolidated_result.cp
                    result.cpk = consolidated_result.cpk
                    result.pp = consolidated_result.pp
                    result.ppk = consolidated_result.ppk
                    result.cpu = consolidated_result.cpu
                    result.cpl = consolidated_result.cpl
                    result.dppm = consolidated_result.dppm
                    result.insufficient_sample = consolidated_result.insufficient_sample
                    result.degenerate = consolidated_result.degenerate
                else:
                    result.cpu = result.cpk = None
                    result.dppm = None
                result.cp = None

        # T068 (US7, FR-026): capabilidade independente por direção, via ratio normalizado
        # (measured / effective_usl), nunca confundida com Cp/Cpk clássico.
        def _direction_capability(axis: DimAxis) -> DirectionCapability | None:
            entries = [d for p in pieces for d in p.directions if d.axis == axis]
            if not entries:
                return None
            pairs = [(d.measured, d.nominal + d.effective_limit) for d in entries]
            r = stats.calculate_capability_with_bonus(pairs)
            return DirectionCapability(
                axis=axis.value,
                n=r.n,
                mean=r.mean,
                std_sample=r.std_sample,
                cp=r.cp,
                cpk=r.cpk,
                cpu=r.cpu,
                cpl=r.cpl,
                dppm=r.dppm,
                insufficient_sample=r.insufficient_sample,
            )

        if len(relations) >= 1:
            capability_direction_1 = _direction_capability(relations[0].axis)
        if len(relations) >= 2:
            capability_direction_2 = _direction_capability(relations[1].axis)

    return StatisticsResponse(
        batch_id=batch_id,
        dim_id=dim_id,
        n=result.n,
        is_unilateral=result.is_unilateral,
        usl=result.usl,
        lsl=result.lsl,
        nominal=result.nominal,
        mean=result.mean,
        std_sample=result.std_sample,
        std_long=result.std_long,
        std_short=result.std_short,
        max=result.max,
        min=result.min,
        range=result.range,
        cp=result.cp,
        cpk=result.cpk,
        pp=result.pp,
        ppk=result.ppk,
        cpu=result.cpu,
        cpl=result.cpl,
        insufficient_sample=result.insufficient_sample,
        degenerate=result.degenerate,
        dppm=result.dppm,
        k_index=result.k_index,
        cpm=result.cpm,
        mean_tolerance_pct=mean_tol_pct,
        std_tolerance_pct=std_tol_pct,
        has_bonus=has_bonus,
        bonus_missing_rel=bonus_missing_rel,
        tolerance_overridden=tolerance_overridden,
        n_uncertainty_at_risk=n_at_risk,
        n_uncertainty_recoverable=n_recoverable,
        critical_axis=critical_axis,
        non_evaluable_count=non_evaluable_count,
        capability_direction_1=capability_direction_1,
        capability_direction_2=capability_direction_2,
        capability_methodology=(
            "rectangle_consolidated_ratio"
            if is_rectangle and has_bonus
            else ("bonus_normalized_ratio" if has_bonus else "raw_measurements")
        ),
        capability_basis=CapabilityBasis(
            methodology=(
                "rectangle_consolidated_ratio"
                if is_rectangle and has_bonus
                else ("bonus_normalized_ratio" if has_bonus else "raw_measurements")
            ),
            n=capability_result.n,
            usl=capability_result.usl,
            lsl=capability_result.lsl,
            nominal=capability_result.nominal,
            mean=capability_result.mean,
            std_short=capability_result.std_short,
            std_long=capability_result.std_long,
        ),
    )


# ── Grouped Capability / Export / Ignore (spec 252) ─────────────────────────────


async def _validate_grouped_batches(
    session: AsyncSession, batch_ids: list[uuid.UUID]
) -> list[SqcBatch]:
    """Resolve `batch_ids` to existing, non-archived `SqcBatch` rows sharing one `part_id`.

    Shared by the grouped-statistics and export-measurements endpoints
    (contracts/api-sqc-252.md §1 passos 2-3, §2 passo 2 — "reused validation helper").
    """
    result = await session.execute(select(SqcBatch).where(SqcBatch.id.in_(batch_ids)))
    found = {b.id: b for b in result.scalars().all()}

    invalid = [
        str(batch_id)
        for batch_id in batch_ids
        if batch_id not in found or found[batch_id].deleted_at is not None
    ]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"lote(s) inexistente(s) ou arquivado(s): {', '.join(invalid)}",
        )

    batches = [found[batch_id] for batch_id in dict.fromkeys(batch_ids)]
    part_ids = {b.part_id for b in batches}
    if len(part_ids) > 1:
        mismatched = [str(b.id) for b in batches if b.part_id != batches[0].part_id]
        raise HTTPException(
            status_code=422,
            detail=f"lotes selecionados pertencem a peças diferentes: {', '.join(mismatched)}",
        )
    return batches


async def _resolve_bonus_map(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim: Dim,
    cavity: int | None = None,
) -> dict[tuple[int, int | None], float]:
    """Resolve bônus por unidade para geometrias com um único limite efetivo.

    RECTANGLE é deliberadamente excluído: seus limites e bônus são direcionais e devem ser
    consumidos por ``get_rectangle_consolidated`` sem reduzir os eixos a um bônus artificial.
    """
    if dim.zone_geometry == ZoneGeometry.RECTANGLE:
        return {}
    return await service.get_bonus_map(session, batch_id, dim, cavity=cavity)


async def _batch_revision_mismatch(
    session: AsyncSession,
    dim_id: uuid.UUID,
    earliest_date_time: object | None,
) -> bool:
    """FR-014/research.md R5: sinaliza se a tolerância/nominal da dim mudou depois da
    primeira medição deste lote para esta dim."""
    if earliest_date_time is None:
        return False
    stmt = (
        select(DimHistory.id)
        .where(
            DimHistory.dim_id == dim_id,
            DimHistory.field.in_(["tol_plus", "tol_minus", "nominal"]),
            DimHistory.created_at > earliest_date_time,
        )
        .limit(1)
    )
    return (await session.scalar(stmt)) is not None


@router.post("/batches/grouped-statistics", response_model=GroupedStatisticsResponse)
async def get_grouped_statistics(
    data: GroupedStatisticsRequest,
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> GroupedStatisticsResponse:
    dim = await service.get_dim(session, data.dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    batches = await _validate_grouped_batches(session, data.batch_ids)
    if dim.part_id != batches[0].part_id:
        raise HTTPException(
            status_code=404,
            detail="dimensão não encontrada para a peça dos lotes selecionados",
        )

    eff_tol_plus = data.tol_plus_override if data.tol_plus_override is not None else dim.tol_plus
    eff_tol_minus = (
        data.tol_minus_override if data.tol_minus_override is not None else dim.tol_minus
    )
    eff_nominal = data.nominal_override if data.nominal_override is not None else dim.nominal
    tolerance_overridden = (
        data.tol_plus_override is not None
        or data.tol_minus_override is not None
        or data.nominal_override is not None
    )

    has_modifier = dim.material_modifier is not None
    is_rectangle = dim.zone_geometry == ZoneGeometry.RECTANGLE
    has_rel = (
        bool(await service.list_axis_relations(session, dim.id))
        if is_rectangle
        else dim.dim_rel_1_id is not None
    )

    raw_batches: dict[object, list[float]] = {}
    ratio_batches: dict[object, list[float]] = {}
    batch_contexts: list[BatchContext] = []
    any_bonus_resolved = False

    for batch in batches:
        all_inspections = await service.get_inspections_for_dim(
            session, batch.id, dim.id, cavity=data.cavity, exclude_ignored=False
        )
        valid_inspections = [i for i in all_inspections if not i.is_ignored]

        raw_batches[batch.id] = [i.measured_value for i in valid_inspections]

        if has_modifier and has_rel:
            if is_rectangle:
                pieces = await service.get_rectangle_consolidated(
                    session,
                    batch.id,
                    dim,
                    cavity=data.cavity,
                    tol_plus_override=data.tol_plus_override,
                )
                ratios = [
                    piece.consolidated_utilization
                    for piece in pieces
                    if piece.consolidated_utilization is not None
                ]
            else:
                bonus_map = await _resolve_bonus_map(session, batch.id, dim, cavity=data.cavity)
                eff_usl = eff_nominal + eff_tol_plus
                ratios = stats.ratios_from_bonus_pairs(
                    [
                        (
                            inspection.measured_value,
                            eff_usl
                            + bonus_map.get((inspection.part_number, inspection.cavity), 0.0),
                        )
                        for inspection in valid_inspections
                    ]
                )
            if ratios:
                any_bonus_resolved = True
            ratio_batches[batch.id] = ratios

        earliest = min((i.date_time for i in all_inspections), default=None)
        revision_mismatch = await _batch_revision_mismatch(session, dim.id, earliest)

        batch_contexts.append(
            BatchContext(
                batch_id=batch.id,
                tracking_code=batch.tracking_code,
                batch_status=batch.batch_status.value,
                n=len(valid_inspections),
                n_ignored=len(all_inspections) - len(valid_inspections),
                revision_mismatch=revision_mismatch,
            )
        )

    result = stats.calculate_grouped_capability(
        raw_batches, eff_tol_plus, eff_tol_minus, eff_nominal
    )
    capability_result = result

    has_bonus = has_modifier and has_rel and any_bonus_resolved
    bonus_missing_rel = has_modifier and not has_rel

    if has_bonus:
        bonus_result = stats.calculate_grouped_capability(
            ratio_batches, tol_plus=1.0, tol_minus=None, nominal=0.0
        )
        capability_result = bonus_result
        result.cp = bonus_result.cp
        result.cpk = bonus_result.cpk
        result.pp = bonus_result.pp
        result.ppk = bonus_result.ppk
        result.cpu = bonus_result.cpu
        result.cpl = bonus_result.cpl
        result.insufficient_sample = bonus_result.insufficient_sample
        result.degenerate = bonus_result.degenerate
    elif bonus_missing_rel:
        result.cp = None
        result.cpu = None
        result.cpk = None

    return GroupedStatisticsResponse(
        dim_id=dim.id,
        is_unilateral=result.is_unilateral,
        usl=result.usl,
        lsl=result.lsl,
        nominal=result.nominal,
        n=result.n,
        mean=result.mean,
        std_pooled=result.std_short,
        std_global=result.std_long,
        cp=result.cp,
        cpk=result.cpk,
        pp=result.pp,
        ppk=result.ppk,
        cpu=result.cpu,
        cpl=result.cpl,
        insufficient_sample=result.insufficient_sample,
        degenerate=result.degenerate,
        has_bonus=has_bonus,
        bonus_missing_rel=bonus_missing_rel,
        tolerance_overridden=tolerance_overridden,
        capability_methodology=(
            "rectangle_consolidated_ratio"
            if is_rectangle and has_bonus
            else ("bonus_normalized_ratio" if has_bonus else "raw_measurements")
        ),
        capability_basis=CapabilityBasis(
            methodology=(
                "rectangle_consolidated_ratio"
                if is_rectangle and has_bonus
                else ("bonus_normalized_ratio" if has_bonus else "raw_measurements")
            ),
            n=capability_result.n,
            usl=capability_result.usl,
            lsl=capability_result.lsl,
            nominal=capability_result.nominal,
            mean=capability_result.mean,
            std_short=capability_result.std_short,
            std_long=capability_result.std_long,
        ),
        batches=batch_contexts,
    )


@router.post(
    "/batches/grouped-statistics/suggest-tolerance", response_model=SuggestToleranceResponse
)
async def suggest_grouped_tolerance(
    data: SuggestToleranceRequest,
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> SuggestToleranceResponse:
    """Resolve tolerância para atingir `target_cpk`, dado mean/sigma pooled medidos sobre os
    lotes selecionados (exclui amostras ignoradas). Suporta tolerância unilateral (USL
    assimétrico, sem LSL) e dims com bônus MMC/LMC (solver numérico em espaço de ratio via
    `solve_bonus_tolerance_for_target_cpk`, já que o bônus desloca o USL efetivo por peça e
    não permite forma fechada)."""
    dim = await service.get_dim(session, data.dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    batches = await _validate_grouped_batches(session, data.batch_ids)
    if dim.part_id != batches[0].part_id:
        raise HTTPException(
            status_code=404,
            detail="dimensão não encontrada para a peça dos lotes selecionados",
        )

    has_modifier = dim.material_modifier is not None
    is_rectangle = dim.zone_geometry == ZoneGeometry.RECTANGLE
    has_rel = (
        bool(await service.list_axis_relations(session, dim.id))
        if is_rectangle
        else dim.dim_rel_1_id is not None
    )
    has_bonus_support = has_modifier and has_rel
    if is_rectangle and has_bonus_support:
        raise HTTPException(
            status_code=422,
            detail=(
                "sugestão automática de tolerância não é aplicável a RECTANGLE; "
                "os limites e bônus são direcionais"
            ),
        )

    raw_batches: dict[object, list[float]] = {}
    bonus_pairs: list[tuple[float, float]] = []
    for batch in batches:
        all_inspections = await service.get_inspections_for_dim(
            session, batch.id, dim.id, cavity=data.cavity, exclude_ignored=True
        )
        raw_batches[batch.id] = [i.measured_value for i in all_inspections]

        if has_bonus_support:
            bonus_map = await _resolve_bonus_map(session, batch.id, dim, cavity=data.cavity)
            bonus_pairs.extend(
                (i.measured_value, bonus_map.get((i.part_number, i.cavity), 0.0))
                for i in all_inspections
            )

    result = stats.calculate_grouped_capability(
        raw_batches, dim.tol_plus, dim.tol_minus, dim.nominal
    )

    if (
        result.insufficient_sample
        or result.degenerate
        or result.mean is None
        or result.std_short is None
    ):
        return SuggestToleranceResponse(
            usl=dim.nominal + dim.tol_plus,
            lsl=(dim.nominal - abs(dim.tol_minus)) if dim.tol_minus else None,
            tol_plus=dim.tol_plus,
            tol_minus=dim.tol_minus,
            achievable=False,
            current_mean=result.mean,
            current_std_pooled=result.std_short,
            insufficient_sample=result.insufficient_sample,
        )

    if has_bonus_support and bonus_pairs:
        suggestion = stats.solve_bonus_tolerance_for_target_cpk(
            target_cpk=data.target_cpk,
            pairs=bonus_pairs,
            nominal=dim.nominal,
            current_tol_plus=dim.tol_plus,
        )
    else:
        suggestion = stats.solve_tolerance_for_target_cpk(
            target_cpk=data.target_cpk,
            mean=result.mean,
            sigma=result.std_short,
            nominal=dim.nominal,
            is_unilateral=result.is_unilateral,
        )

    return SuggestToleranceResponse(
        usl=suggestion.usl,
        lsl=suggestion.lsl,
        tol_plus=suggestion.tol_plus,
        tol_minus=suggestion.tol_minus,
        achievable=suggestion.achievable,
        current_mean=result.mean,
        current_std_pooled=result.std_short,
        insufficient_sample=result.insufficient_sample,
    )


@router.post("/batches/export-measurements")
async def export_measurements(
    data: ExportMeasurementsRequest,
    _: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> Response:
    dim = await service.get_dim(session, data.dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    batches = await _validate_grouped_batches(session, data.batch_ids)
    if dim.part_id != batches[0].part_id:
        raise HTTPException(
            status_code=404,
            detail="dimensão não encontrada para a peça dos lotes selecionados",
        )

    rows: list[list[object]] = []
    for batch in batches:
        inspections = await service.get_inspections_for_dim(
            session, batch.id, dim.id, cavity=data.cavity, exclude_ignored=False
        )
        if not inspections:
            continue
        bonus_map = await _resolve_bonus_map(session, batch.id, dim, cavity=data.cavity)
        rectangle_by_unit = (
            {
                (piece.part_number, piece.cavity): piece
                for piece in await service.get_rectangle_consolidated(
                    session, batch.id, dim, cavity=data.cavity
                )
            }
            if dim.zone_geometry == ZoneGeometry.RECTANGLE
            else {}
        )
        for i in inspections:
            bonus = bonus_map.get((i.part_number, i.cavity), 0.0)
            rectangle_piece = rectangle_by_unit.get((i.part_number, i.cavity))
            tol_pct = (
                rectangle_piece.consolidated_utilization * 100
                if rectangle_piece is not None
                and rectangle_piece.consolidated_utilization is not None
                else tolerance_used_pct(
                    i.deviation,
                    *stats.effective_tolerances(dim.tol_plus, dim.tol_minus, bonus),
                )
            )
            rows.append(
                [
                    batch.tracking_code,
                    i.part_number,
                    i.cavity,
                    i.operator,
                    i.date_time.isoformat(),
                    i.instrument,
                    i.measured_value,
                    i.deviation,
                    bonus,
                    tol_pct,
                    i.is_ignored,
                    i.ignored_reason,
                ]
            )

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="nenhuma medição encontrada para esta dimensão/seleção de lotes",
        )

    filename_base = f"sqc_{dim.dim_code}_measurements"
    if data.format == ExportFormat.XLSX:
        content: str | bytes = sqc_export.measurements_xlsx(rows)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{filename_base}.xlsx"
    elif data.format == ExportFormat.TXT:
        content = sqc_export.measurements_txt(rows)
        media_type = "text/plain; charset=utf-8"
        filename = f"{filename_base}.txt"
    else:
        content = sqc_export.measurements_csv(rows)
        media_type = "text/csv; charset=utf-8"
        filename = f"{filename_base}.csv"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch(
    "/batches/{batch_id}/dims/{dim_id}/inspections/{inspection_id}/ignore",
    response_model=InspectionIgnoreResponse,
)
async def patch_inspection_ignore(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    inspection_id: uuid.UUID,
    data: InspectionIgnoreRequest,
    user: CurrentUser,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> InspectionIgnoreResponse:
    inspection = await session.get(Inspection, inspection_id)
    if not inspection or inspection.batch_id != batch_id or inspection.dim_id != dim_id:
        raise HTTPException(status_code=404, detail="medição não encontrada")

    batch = await service.get_batch_for_update(session, inspection.batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    conflict = service.check_batch_editable(batch)
    if conflict is not None:
        raise HTTPException(status_code=409, detail=conflict)

    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    inspection = await service.set_inspection_ignored(
        session,
        inspection,
        ignored=data.ignored,
        reason=data.reason,
        actor_email=user.email,
    )

    statistics = await _compute_statistics(session, dim, batch_id, dim_id)

    return InspectionIgnoreResponse(
        inspection_id=inspection.id,
        is_ignored=inspection.is_ignored,
        ignored_reason=inspection.ignored_reason,
        statistics=statistics,
    )


# ── NQA ────────────────────────────────────────────────────────────────────────


@router.get("/batches/{batch_id}/dims/{dim_id}/nqa", response_model=NqaResultSchema)
async def get_nqa(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    tol_plus_override: float | None = Query(default=None, gt=0),
    tol_minus_override: float | None = Query(default=None, ge=0),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> NqaResultSchema:
    batch = await service.get_batch(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")
    dim = await service.get_dim(session, dim_id)
    if not dim or dim.part_id != batch.part_id:
        raise HTTPException(status_code=404, detail="dimensão não encontrada neste lote")

    evaluation = await service.evaluate_dim_nqa(
        session,
        batch_id,
        dim,
        cavity=cavity,
        tol_plus_override=tol_plus_override,
        tol_minus_override=tol_minus_override,
    )
    result = service.calculate_dim_nqa(batch, evaluation)
    return NqaResultSchema(
        batch_size=result.batch_size,
        inspection_level=result.inspection_level,
        aql=result.aql,
        letter=result.letter,
        required_sample_size=result.required_sample_size,
        acceptance_number=result.acceptance_number,
        rejection_number=result.rejection_number,
        inspected=result.inspected,
        non_conforming=result.non_conforming,
        status=result.status,
        achieved_aql=result.achieved_aql,
        non_evaluable_count=result.non_evaluable_count,
        diagnostic_incomplete_count=result.diagnostic_incomplete_count,
    )


# ── helpers overview ──────────────────────────────────────────────────────────


def _overview_status(
    mean_tol: float | None,
    std_tol: float | None,
    n_out: int,
    nqa_ac: int = 0,
    nqa_re: int = 1,
    n_uncertainty: int = 0,
) -> str:
    if mean_tol is None:
        return "no_data"
    # NC override baseado em Ac/Re da NQA
    if n_out >= nqa_re:
        return "critical"
    if n_out > 0:  # NC presente mas dentro do Ac (só ocorre quando Ac=1, ex: n=125)
        return "warning"
    # Sem NC: score composto mean + 1.5*sigma estima o pior caso tipico do lote
    score = mean_tol + 1.5 * std_tol if std_tol is not None else mean_tol
    if mean_tol > 100 or score > 100:
        return "critical"
    if n_uncertainty > 0 or mean_tol >= 75 or score >= 80:
        return "warning"
    return "ok"


_STATUS_ORDER = {"critical": 0, "warning": 1, "ok": 2, "no_data": 3}


async def _fetch_overview_stats(
    session: AsyncSession,
    batch_ids_list: list[uuid.UUID],
    part_id: uuid.UUID,
    cavity: int | None = None,
) -> dict[tuple[uuid.UUID, uuid.UUID], dict]:
    """
    Uma única query que agrega n, desvios e n_out por (batch_id, dim_id).
    Ignora dims filhas (parent_dim_id IS NOT NULL) — calculadas via bônus separado.
    Retorna {(batch_id, dim_id): {n, deviations: list[float], n_out}}.
    """

    batch_ids_str = ", ".join(f"'{b}'" for b in batch_ids_list)
    cavity_filter = "AND i.cavity = :cavity" if cavity is not None else ""

    sql = text(f"""
        SELECT
            i.batch_id,
            i.dim_id,
            COUNT(*)                                        AS n,
            ARRAY_AGG(i.deviation ORDER BY i.part_number)  AS deviations,
            SUM(CASE
                WHEN d.type = 'POSITION' AND i.measured_value > d.nominal + d.tol_plus THEN 1
                WHEN d.type != 'POSITION' AND i.measured_value > d.nominal + d.tol_plus THEN 1
                WHEN d.type != 'POSITION' AND d.tol_minus IS NOT NULL
                     AND i.measured_value < d.nominal - ABS(d.tol_minus) THEN 1
                ELSE 0
            END)                                            AS n_out
        FROM sqc_inspections i
        JOIN sqc_dims d ON d.id = i.dim_id
        WHERE i.batch_id IN ({batch_ids_str})
          AND d.part_id = :part_id
          AND d.parent_dim_id IS NULL
          AND i.is_ignored = false
          {cavity_filter}
        GROUP BY i.batch_id, i.dim_id
    """)

    result = await session.execute(sql, {"part_id": str(part_id), "cavity": cavity})
    out: dict[tuple[uuid.UUID, uuid.UUID], dict] = {}
    for row in result:
        out[(row.batch_id, row.dim_id)] = {
            "n": row.n,
            "deviations": row.deviations or [],
            "n_out": int(row.n_out or 0),
        }
    return out


async def _fetch_uncertainty_stats(
    session: AsyncSession,
    batch_ids_list: list[uuid.UUID],
    part_id: uuid.UUID,
    cavity: int | None = None,
) -> dict[tuple[uuid.UUID, uuid.UUID], int]:
    """
    Conta peças na zona de incerteza por (batch_id, dim_id) via JOIN com instruments.
    Retorna {} quando não há instrumentos cadastrados.
    """
    batch_ids_str = ", ".join(f"'{b}'" for b in batch_ids_list)
    cavity_filter = "AND i.cavity = :cavity" if cavity is not None else ""

    sql = text(f"""
        SELECT
            i.batch_id,
            i.dim_id,
            COUNT(*) AS n_uncertainty
        FROM sqc_inspections i
        JOIN sqc_dims d ON d.id = i.dim_id
        JOIN sqc_instruments inst ON LOWER(i.instrument) = LOWER(inst.code)
        WHERE i.batch_id IN ({batch_ids_str})
          AND d.part_id = :part_id
          AND d.parent_dim_id IS NULL
          AND d.material_modifier IS NULL
          AND i.is_ignored = false
          {cavity_filter}
          AND (
              ABS(i.measured_value - (d.nominal + d.tol_plus)) < inst.uncertainty
              OR (
                  d.tol_minus IS NOT NULL AND ABS(d.tol_minus) > 0
                  AND ABS(i.measured_value - (d.nominal - ABS(d.tol_minus))) < inst.uncertainty
              )
          )
        GROUP BY i.batch_id, i.dim_id
    """)

    result = await session.execute(sql, {"part_id": str(part_id), "cavity": cavity})
    return {(row.batch_id, row.dim_id): int(row.n_uncertainty) for row in result}


# ── SqcBatch Overview (semáforo por dim) ─────────────────────────────────────────


@router.get("/batches/{batch_id}/overview", response_model=BatchOverviewResponse)
async def get_batch_overview(
    batch_id: uuid.UUID,
    _: CurrentUser,
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> BatchOverviewResponse:
    batch = await service.get_batch(session, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="lote não encontrado")

    dims = await service.list_dims_for_part(session, batch.part_id)
    agg = await _fetch_overview_stats(session, [batch_id], batch.part_id, cavity=cavity)
    unc_map = await service.get_instrument_uncertainty_map(session)

    rows: list[DimOverviewRow] = []
    for dim in dims:
        key = (batch_id, dim.id)
        data = agg.get(key)
        nqa_evaluation = await service.evaluate_dim_nqa(session, batch_id, dim, cavity=cavity)
        nqa_r = service.calculate_dim_nqa(batch, nqa_evaluation)

        # RECTANGLE + modificador (FR-015/FR-021): a fonte principal deixa de ser o valor
        # próprio do ferramenta de medição (agregado em `agg` via SQL) e passa a ser o consolidado
        # max(U_d1,U_d2) por peça — mesma linha única, mesmas colunas (FR-020), sem novo
        # campo. RECTANGLE sem modificador segue no caminho abaixo, inalterado (FR-016).
        if dim.zone_geometry == ZoneGeometry.RECTANGLE and dim.material_modifier is not None:
            pieces = await service.get_rectangle_consolidated(session, batch_id, dim, cavity=cavity)
            evaluable = [p for p in pieces if p.conforming is not None]
            n = len(evaluable)
            if n == 0:
                rows.append(
                    DimOverviewRow(
                        dim_id=dim.id,
                        dim_code=dim.dim_code,
                        dim_name=dim.dim_name,
                        dim_type=dim.type.value,
                        is_unilateral=dim.is_unilateral,
                        n=0,
                        mean_tol_pct=None,
                        std_tol_pct=None,
                        n_out=0,
                        status="no_data",
                        nqa_ac=None,
                        nqa_re=None,
                        nqa_status=None,
                        nqa_letter=None,
                        nqa_achieved_aql=None,
                    )
                )
                continue

            # consolidated_utilization is set whenever conforming is (get_rectangle_consolidated
            # invariant) — the `is not None` filter here is only to satisfy pyright.
            tol_pcts = [
                p.consolidated_utilization * 100
                for p in evaluable
                if p.consolidated_utilization is not None
            ]
            n_out = nqa_evaluation.non_conforming
            mean_tol = sum(tol_pcts) / len(tol_pcts)
            std_tol = (
                (sum((t - mean_tol) ** 2 for t in tol_pcts) / (len(tol_pcts) - 1)) ** 0.5
                if len(tol_pcts) >= 2
                else None
            )

            status = _overview_status(
                mean_tol,
                std_tol,
                n_out,
                nqa_ac=nqa_r.acceptance_number,
                nqa_re=nqa_r.rejection_number,
            )
            rows.append(
                DimOverviewRow(
                    dim_id=dim.id,
                    dim_code=dim.dim_code,
                    dim_name=dim.dim_name,
                    dim_type=dim.type.value,
                    is_unilateral=dim.is_unilateral,
                    n=n,
                    mean_tol_pct=mean_tol,
                    std_tol_pct=std_tol,
                    n_out=n_out,
                    status=status,
                    nqa_ac=nqa_r.acceptance_number,
                    nqa_re=nqa_r.rejection_number,
                    nqa_status=nqa_r.status,
                    nqa_letter=nqa_r.letter,
                    nqa_achieved_aql=nqa_r.achieved_aql,
                )
            )
            continue

        if not data or data["n"] == 0:
            rows.append(
                DimOverviewRow(
                    dim_id=dim.id,
                    dim_code=dim.dim_code,
                    dim_name=dim.dim_name,
                    dim_type=dim.type.value,
                    is_unilateral=dim.is_unilateral,
                    n=0,
                    mean_tol_pct=None,
                    std_tol_pct=None,
                    n_out=0,
                    status="no_data",
                    nqa_ac=None,
                    nqa_re=None,
                    nqa_status=None,
                    nqa_letter=None,
                    nqa_achieved_aql=None,
                )
            )
            continue

        n = data["n"]
        deviations = [d for d in data["deviations"] if abs(d) < 1e9]

        # Dims com modificador de material: recalcular n_out e % tol com bônus
        if dim.material_modifier is not None and dim.dim_rel_1_id is not None:
            inspections = await service.get_inspections_for_dim(
                session, batch_id, dim.id, cavity=cavity, exclude_ignored=True
            )
            bonus_map = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)
            tol_pcts = [
                stats.tolerance_used_pct(
                    i.deviation,
                    *stats.effective_tolerances(
                        dim.tol_plus,
                        dim.tol_minus,
                        bonus_map.get((i.part_number, i.cavity), 0.0),
                    ),
                )
                for i in inspections
                if abs(i.deviation) < 1e9
            ]
            n_out = 0
            for i in inspections:
                bonus = bonus_map.get((i.part_number, i.cavity), 0.0)
                lsl_eff = dim.lsl_with_bonus(bonus)
                if i.measured_value > dim.usl_with_bonus(bonus) or (
                    lsl_eff is not None and i.measured_value < lsl_eff
                ):
                    n_out += 1
        else:
            n_out = data["n_out"]
            tol_pcts = [
                stats.tolerance_used_pct(
                    dev, *stats.effective_tolerances(dim.tol_plus, dim.tol_minus)
                )
                for dev in deviations
            ]

        mean_tol = sum(tol_pcts) / len(tol_pcts) if tol_pcts else None
        std_tol = (
            (sum((t - mean_tol) ** 2 for t in tol_pcts) / (len(tol_pcts) - 1)) ** 0.5
            if len(tol_pcts) >= 2 and mean_tol is not None
            else None
        )

        # NQA usa unidades distintas por peça; ``n`` e estatísticas descritivas seguem por leitura.
        n_out = nqa_evaluation.non_conforming

        # Contagem de incerteza para esta dim (busca leve só se há instrumentos cadastrados)
        n_unc = 0
        if unc_map:
            insp_for_unc = await service.get_inspections_for_dim(
                session, batch_id, dim.id, cavity=cavity, exclude_ignored=True
            )
            bmap_for_unc = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)
            for i in insp_for_unc:
                unc = unc_map.get((i.instrument or "").lower(), 0.0)
                if unc > 0 and _unc_zone(
                    i.measured_value,
                    dim.usl_with_bonus(bmap_for_unc.get((i.part_number, i.cavity), 0.0)),
                    dim.lsl_with_bonus(bmap_for_unc.get((i.part_number, i.cavity), 0.0)),
                    unc,
                ):
                    n_unc += 1

        status = _overview_status(
            mean_tol,
            std_tol,
            n_out,
            nqa_ac=nqa_r.acceptance_number,
            nqa_re=nqa_r.rejection_number,
            n_uncertainty=n_unc,
        )

        rows.append(
            DimOverviewRow(
                dim_id=dim.id,
                dim_code=dim.dim_code,
                dim_name=dim.dim_name,
                dim_type=dim.type.value,
                is_unilateral=dim.is_unilateral,
                n=n,
                mean_tol_pct=mean_tol,
                std_tol_pct=std_tol,
                n_out=n_out,
                status=status,
                nqa_ac=nqa_r.acceptance_number,
                nqa_re=nqa_r.rejection_number,
                nqa_status=nqa_r.status,
                nqa_letter=nqa_r.letter,
                nqa_achieved_aql=nqa_r.achieved_aql,
                n_uncertainty=n_unc,
            )
        )

    rows.sort(key=lambda r: _STATUS_ORDER.get(r.status, 4))

    measured_revisions = [
        dim.drawing_revision
        for dim in dims
        if dim.drawing_revision and (agg.get((batch_id, dim.id)) or {}).get("n", 0) > 0
    ]
    if not measured_revisions:
        measured_revisions = [dim.drawing_revision for dim in dims if dim.drawing_revision]
    drawing_revision = service.most_advanced_drawing_revision(measured_revisions)

    return BatchOverviewResponse(
        batch_id=batch_id,
        tracking_code=batch.tracking_code,
        part_id=batch.part_id,
        dims=rows,
        drawing_revision=drawing_revision,
    )


# ── Part Heatmap (visão multi-lote) ───────────────────────────────────────────


@router.get("/parts/{part_id}/heatmap", response_model=PartHeatmapResponse)
async def get_part_heatmap(
    part_id: uuid.UUID,
    _: CurrentUser,
    batch_ids: str | None = Query(default=None),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> PartHeatmapResponse:
    part = await service.get_part(session, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="peça não encontrada")

    parsed_ids = [uuid.UUID(b) for b in batch_ids.split(",") if b.strip()] if batch_ids else None

    stmt = select(SqcBatch).where(SqcBatch.part_id == part_id, SqcBatch.deleted_at.is_(None))
    if parsed_ids:
        stmt = stmt.where(SqcBatch.id.in_(parsed_ids))
    batches = list((await session.execute(stmt)).scalars().all())
    batches.sort(
        key=lambda b: b.tracking_code[:8] if len(b.tracking_code) >= 8 else b.tracking_code
    )
    if not batches:
        raise HTTPException(status_code=404, detail="nenhum lote encontrado")

    dims = await service.list_dims_for_part(session, part_id)
    batch_id_list = [b.id for b in batches]
    agg = await _fetch_overview_stats(session, batch_id_list, part_id, cavity=cavity)
    unc_agg = await _fetch_uncertainty_stats(session, batch_id_list, part_id, cavity=cavity)
    unc_map = await service.get_instrument_uncertainty_map(session)
    batch_labels = {str(b.id): b.tracking_code for b in batches}

    dim_rows: list[HeatmapDimRow] = []
    for dim in dims:
        cells: list[HeatmapCell] = []
        for batch in batches:
            key = (batch.id, dim.id)
            data = agg.get(key)
            nqa_evaluation = await service.evaluate_dim_nqa(session, batch.id, dim, cavity=cavity)
            nqa_r = service.calculate_dim_nqa(batch, nqa_evaluation)

            # RECTANGLE + modificador (FR-015/FR-021/FR-030): mesma fonte consolidada usada
            # em get_batch_overview, uma célula por lote (sem célula extra por direção).
            if dim.zone_geometry == ZoneGeometry.RECTANGLE and dim.material_modifier is not None:
                pieces = await service.get_rectangle_consolidated(
                    session, batch.id, dim, cavity=cavity
                )
                evaluable = [p for p in pieces if p.conforming is not None]
                n = len(evaluable)
                if n == 0:
                    letter0 = nqa_calc.get_letter_from_inspected(0)
                    _rn0, ac0, re0 = nqa_calc._resolve_plan(letter0, batch.aql)
                    cells.append(
                        HeatmapCell(
                            batch_id=batch.id,
                            tracking_code=batch.tracking_code,
                            n=0,
                            mean_tol_pct=None,
                            std_tol_pct=None,
                            n_out=0,
                            n_uncertainty=0,
                            nqa_ac=ac0,
                            nqa_re=re0,
                            status="no_data",
                        )
                    )
                    continue

                tol_pcts = [
                    p.consolidated_utilization * 100
                    for p in evaluable
                    if p.consolidated_utilization is not None
                ]
                n_out = nqa_evaluation.non_conforming
                mean_tol = sum(tol_pcts) / len(tol_pcts)
                std_tol = (
                    (sum((t - mean_tol) ** 2 for t in tol_pcts) / (len(tol_pcts) - 1)) ** 0.5
                    if len(tol_pcts) >= 2
                    else None
                )
                nqa_ac = nqa_r.acceptance_number
                nqa_re = nqa_r.rejection_number

                cells.append(
                    HeatmapCell(
                        batch_id=batch.id,
                        tracking_code=batch.tracking_code,
                        n=n,
                        mean_tol_pct=mean_tol,
                        std_tol_pct=std_tol,
                        n_out=n_out,
                        n_uncertainty=0,
                        nqa_ac=nqa_ac,
                        nqa_re=nqa_re,
                        status=_overview_status(mean_tol, std_tol, n_out, nqa_ac, nqa_re, 0),
                    )
                )
                continue

            if not data or data["n"] == 0:
                # Calcular Ac/Re mesmo sem dados para consistência do schema
                letter0 = nqa_calc.get_letter_from_inspected(0)
                _rn0, ac0, re0 = nqa_calc._resolve_plan(letter0, batch.aql)
                cells.append(
                    HeatmapCell(
                        batch_id=batch.id,
                        tracking_code=batch.tracking_code,
                        n=0,
                        mean_tol_pct=None,
                        std_tol_pct=None,
                        n_out=0,
                        n_uncertainty=0,
                        nqa_ac=ac0,
                        nqa_re=re0,
                        status="no_data",
                    )
                )
                continue

            n = data["n"]
            deviations = [d for d in data["deviations"] if abs(d) < 1e9]

            if dim.material_modifier is not None and dim.dim_rel_1_id is not None:
                inspections = await service.get_inspections_for_dim(
                    session, batch.id, dim.id, cavity=cavity, exclude_ignored=True
                )
                bonus_map = await service.get_bonus_map(session, batch.id, dim, cavity=cavity)
                tol_pcts = [
                    stats.tolerance_used_pct(
                        i.deviation,
                        *stats.effective_tolerances(
                            dim.tol_plus,
                            dim.tol_minus,
                            bonus_map.get((i.part_number, i.cavity), 0.0),
                        ),
                    )
                    for i in inspections
                    if abs(i.deviation) < 1e9
                ]
                n_out = 0
                n_uncertainty = 0
                for i in inspections:
                    bonus = bonus_map.get((i.part_number, i.cavity), 0.0)
                    eff_usl = dim.usl_with_bonus(bonus)
                    lsl_eff = dim.lsl_with_bonus(bonus)
                    if i.measured_value > eff_usl or (
                        lsl_eff is not None and i.measured_value < lsl_eff
                    ):
                        n_out += 1
                    if unc_map:
                        unc = unc_map.get((i.instrument or "").lower(), 0.0)
                        if unc > 0 and _unc_zone(i.measured_value, eff_usl, lsl_eff, unc):
                            n_uncertainty += 1
            else:
                tol_pcts = [
                    stats.tolerance_used_pct(
                        dev, *stats.effective_tolerances(dim.tol_plus, dim.tol_minus)
                    )
                    for dev in deviations
                ]
                n_out = data["n_out"]
                n_uncertainty = unc_agg.get(key, 0)

            mean_tol = sum(tol_pcts) / len(tol_pcts) if tol_pcts else None
            std_tol = (
                (sum((t - mean_tol) ** 2 for t in tol_pcts) / (len(tol_pcts) - 1)) ** 0.5
                if len(tol_pcts) >= 2 and mean_tol is not None
                else None
            )

            # NQA usa unidades distintas por peça; ``n`` e estatísticas descritivas seguem por leitura.
            n_out = nqa_evaluation.non_conforming
            nqa_ac = nqa_r.acceptance_number
            nqa_re = nqa_r.rejection_number

            cells.append(
                HeatmapCell(
                    batch_id=batch.id,
                    tracking_code=batch.tracking_code,
                    n=n,
                    mean_tol_pct=mean_tol,
                    std_tol_pct=std_tol,
                    n_out=n_out,
                    n_uncertainty=n_uncertainty,
                    nqa_ac=nqa_ac,
                    nqa_re=nqa_re,
                    status=_overview_status(
                        mean_tol, std_tol, n_out, nqa_ac, nqa_re, n_uncertainty
                    ),
                )
            )

        dim_rows.append(
            HeatmapDimRow(
                dim_id=dim.id,
                dim_code=dim.dim_code,
                dim_name=dim.dim_name,
                dim_type=dim.type.value,
                cells=cells,
            )
        )

    dim_rows.sort(key=lambda r: r.dim_code)

    return PartHeatmapResponse(
        part_id=part_id,
        batch_labels=batch_labels,
        dims=dim_rows,
    )


# ── Control Chart ──────────────────────────────────────────────────────────────


@router.get("/batches/{batch_id}/dims/{dim_id}/control-chart", response_model=ControlChartResponse)
async def get_control_chart(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    tol_plus_override: float | None = Query(default=None, gt=0),
    tol_minus_override: float | None = Query(default=None, ge=0),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> ControlChartResponse:
    dim_for_unilateral = await service.get_dim(session, dim_id)

    # RECTANGLE (spec 060, FR-027): duas cartas I direcionais adicionais, sempre calculadas
    # como diagnóstico — mesmo sem modificador (FR-016) — nunca substituem xbar/r_chart nem
    # o i_chart de topo, que continuam vindo do valor próprio da posição, inalterados.
    direction_1_i_chart: IChartSeries | None = None
    direction_2_i_chart: IChartSeries | None = None
    direction_1_axis: str | None = None
    direction_2_axis: str | None = None
    if (
        dim_for_unilateral is not None
        and dim_for_unilateral.zone_geometry == ZoneGeometry.RECTANGLE
    ):
        pieces = await service.get_rectangle_consolidated(
            session,
            batch_id,
            dim_for_unilateral,
            cavity=cavity,
            tol_plus_override=tol_plus_override,
        )
        relations = await service.list_axis_relations(session, dim_id)

        def _axis_i_chart(axis: DimAxis) -> IChartSeries | None:
            entries = sorted(
                ((p.part_number, d) for p in pieces for d in p.directions if d.axis == axis),
                key=lambda e: e[0],
            )
            if len(entries) < 2:
                return None
            values = [d.measured for _, d in entries]
            nominal = entries[0][1].nominal
            base_limit = entries[0][1].base_limit
            ic = stats.calculate_i_chart(
                values, nominal + base_limit, nominal - base_limit, nominal, is_unilateral=False
            )
            points = [
                IChartPointSchema(
                    index=idx,
                    measured_value=ic.points[idx - 1].measured_value,
                    out_of_control=d.utilization > 1.0,
                    bonus=d.bonus,
                    effective_usl=nominal + d.effective_limit,
                    effective_lsl=nominal - d.effective_limit,
                )
                for idx, (_pn, d) in enumerate(entries, start=1)
            ]
            return IChartSeries(
                points=points,
                mean=ic.mean,
                std=ic.std,
                ucl=ic.ucl,
                lcl=ic.lcl,
                usl=ic.usl,
                lsl=ic.lsl,
                nominal=ic.nominal,
                has_bonus=any(d.bonus > 0 for _, d in entries),
            )

        if len(relations) >= 1:
            direction_1_axis = relations[0].axis.value
            direction_1_i_chart = _axis_i_chart(relations[0].axis)
        if len(relations) >= 2:
            direction_2_axis = relations[1].axis.value
            direction_2_i_chart = _axis_i_chart(relations[1].axis)

        # RECTANGLE + modificador (FR-015): mesma fonte já usada em Overview/Capability/
        # Distribuição — o "Consolidado" precisa vir da utilização direcional (max(U_d1,U_d2),
        # já normalizada a limite=1.0), nunca do valor bruto do ferramenta de medição (que sequer é
        # comparável entre peças com bônus diferentes). Mantemos também `i_chart_raw` com o
        # valor bruto do ferramenta de medição (sem bônus, não comparável entre peças) — a mesma dualidade
        # já oferecida na Distribuição ("Bruto (ferramenta de medição)" vs. consolidado) — para consulta e
        # como diagnóstico, nunca comparado ou usado como fonte de conformidade aqui.
        if dim_for_unilateral.material_modifier is not None:
            entries = sorted(
                (
                    (p.part_number, p.consolidated_utilization)
                    for p in pieces
                    if p.consolidated_utilization is not None
                ),
                key=lambda e: e[0],
            )
            consolidated_i_chart: IChartSeries | None = None
            if len(entries) >= 2:
                utilizations = [u for _, u in entries]
                ic = stats.calculate_i_chart(utilizations, 1.0, None, 0.0, is_unilateral=True)
                consolidated_i_chart = IChartSeries(
                    points=[
                        IChartPointSchema(
                            index=idx,
                            measured_value=ic.points[idx - 1].measured_value,
                            out_of_control=u > 1.0,
                        )
                        for idx, (_pn, u) in enumerate(entries, start=1)
                    ],
                    mean=ic.mean,
                    std=ic.std,
                    ucl=ic.ucl,
                    lcl=ic.lcl,
                    usl=ic.usl,
                    lsl=ic.lsl,
                    nominal=ic.nominal,
                    has_bonus=False,
                )

            raw_i_chart: IChartSeries | None = None
            raw_inspections = await service.get_inspections_for_dim(
                session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
            )
            if len(raw_inspections) >= 2:
                raw_values = [i.measured_value for i in raw_inspections]
                eff_tol_plus = (
                    tol_plus_override
                    if tol_plus_override is not None
                    else dim_for_unilateral.tol_plus
                )
                eff_tol_minus = (
                    tol_minus_override
                    if tol_minus_override is not None
                    else dim_for_unilateral.tol_minus
                )
                raw_usl = dim_for_unilateral.nominal + eff_tol_plus
                raw_lsl = dim_for_unilateral.nominal - abs(eff_tol_minus) if eff_tol_minus else None
                raw_ic = stats.calculate_i_chart(
                    raw_values,
                    raw_usl,
                    raw_lsl,
                    dim_for_unilateral.nominal,
                    is_unilateral=dim_for_unilateral.is_unilateral,
                )
                raw_i_chart = IChartSeries(
                    points=[
                        IChartPointSchema(
                            index=p.index,
                            measured_value=p.measured_value,
                            out_of_control=p.out_of_control,
                        )
                        for p in raw_ic.points
                    ],
                    mean=raw_ic.mean,
                    std=raw_ic.std,
                    ucl=raw_ic.ucl,
                    lcl=raw_ic.lcl,
                    usl=raw_ic.usl,
                    lsl=raw_ic.lsl,
                    nominal=raw_ic.nominal,
                    has_bonus=False,
                )

            # `insufficient_data` só é verdadeiro quando NENHUMA das cartas (consolidada, bruta
            # ou por direção) tem dado — antes disso, ter só o consolidado incompleto escondia
            # também as cartas por direção, mesmo quando estas tinham dado de sobra.
            no_data = (
                consolidated_i_chart is None
                and raw_i_chart is None
                and direction_1_i_chart is None
                and direction_2_i_chart is None
            )
            return ControlChartResponse(
                subgroup_size=1,
                insufficient_data=no_data,
                i_chart=consolidated_i_chart,
                i_chart_raw=raw_i_chart,
                i_chart_direction_1=direction_1_i_chart,
                i_chart_direction_2=direction_2_i_chart,
                direction_1_axis=direction_1_axis,
                direction_2_axis=direction_2_axis,
            )

    subgroups = await service.get_inspections_grouped_by_part(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
    )
    result = stats.calculate_control_chart(
        subgroups, is_unilateral=dim_for_unilateral.is_unilateral if dim_for_unilateral else False
    )

    if result.insufficient_data:
        # Fallback: I-Chart (Gráfico de Valores Individuais) para lote único
        dim = dim_for_unilateral
        inspections = await service.get_inspections_for_dim(
            session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
        )
        values = [i.measured_value for i in inspections]
        if not values or dim is None:
            return ControlChartResponse(
                subgroup_size=0,
                insufficient_data=direction_1_i_chart is None and direction_2_i_chart is None,
                i_chart_direction_1=direction_1_i_chart,
                i_chart_direction_2=direction_2_i_chart,
                direction_1_axis=direction_1_axis,
                direction_2_axis=direction_2_axis,
            )

        eff_tol_plus = tol_plus_override if tol_plus_override is not None else dim.tol_plus
        eff_tol_minus = tol_minus_override if tol_minus_override is not None else dim.tol_minus
        eff_usl_base = dim.nominal + eff_tol_plus
        eff_lsl_base = (dim.nominal - abs(eff_tol_minus)) if eff_tol_minus else None

        ic = stats.calculate_i_chart(
            values, eff_usl_base, eff_lsl_base, dim.nominal, is_unilateral=dim.is_unilateral
        )

        # Calcular bônus de tolerância (MMC/LMC) via helper centralizado
        has_bonus = dim.material_modifier is not None and dim.dim_rel_1_id is not None
        bonus_map = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)
        unc_map = await service.get_instrument_uncertainty_map(session)

        i_points = []
        for p in ic.points:
            insp_obj = inspections[p.index - 1] if p.index - 1 < len(inspections) else None
            bonus = bonus_map.get((insp_obj.part_number, insp_obj.cavity), 0.0) if insp_obj else 0.0
            if has_bonus and bonus > 0:
                pt_usl = eff_usl_base + bonus
                pt_lsl = (eff_lsl_base - bonus) if eff_lsl_base is not None else None
                oc = p.measured_value > pt_usl or (pt_lsl is not None and p.measured_value < pt_lsl)
            else:
                pt_usl = None
                pt_lsl = None
                oc = p.out_of_control
            unc = unc_map.get((insp_obj.instrument or "").lower(), 0.0) if insp_obj else 0.0
            eff_usl_pt = pt_usl or eff_usl_base
            eff_lsl_pt = pt_lsl if pt_lsl is not None else eff_lsl_base
            i_points.append(
                IChartPointSchema(
                    index=p.index,
                    measured_value=p.measured_value,
                    out_of_control=oc,
                    bonus=bonus,
                    effective_usl=pt_usl,
                    effective_lsl=pt_lsl,
                    uncertainty_zone=_unc_zone(p.measured_value, eff_usl_pt, eff_lsl_pt, unc),
                )
            )

        return ControlChartResponse(
            subgroup_size=1,
            insufficient_data=False,
            i_chart=IChartSeries(
                points=i_points,
                mean=ic.mean,
                std=ic.std,
                ucl=ic.ucl,
                lcl=ic.lcl,
                usl=ic.usl,
                lsl=ic.lsl,
                nominal=ic.nominal,
                has_bonus=has_bonus and bool(bonus_map),
            ),
            i_chart_direction_1=direction_1_i_chart,
            i_chart_direction_2=direction_2_i_chart,
            direction_1_axis=direction_1_axis,
            direction_2_axis=direction_2_axis,
        )

    def _to_schema(series: stats.ControlChartSeries) -> ControlChartSeries:
        return ControlChartSeries(
            points=[
                ControlChartPointSchema(
                    part_number=p.part_number, value=p.value, out_of_control=p.out_of_control
                )
                for p in series.points
            ],
            center_line=series.center_line,
            ucl=series.ucl,
            lcl=series.lcl,
        )

    return ControlChartResponse(
        subgroup_size=result.subgroup_size,
        xbar=_to_schema(result.xbar),
        r_chart=_to_schema(result.r_chart),
        insufficient_data=result.insufficient_data,
        i_chart_direction_1=direction_1_i_chart,
        i_chart_direction_2=direction_2_i_chart,
        direction_1_axis=direction_1_axis,
        direction_2_axis=direction_2_axis,
    )


# ── Distribution ───────────────────────────────────────────────────────────────


@router.get("/batches/{batch_id}/dims/{dim_id}/distribution", response_model=DistributionResponse)
async def get_distribution(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    tol_plus_override: float | None = Query(default=None, gt=0),
    tol_minus_override: float | None = Query(default=None, ge=0),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DistributionResponse:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    eff_tol_plus = tol_plus_override if tol_plus_override is not None else dim.tol_plus
    eff_tol_minus = tol_minus_override if tol_minus_override is not None else dim.tol_minus
    eff_usl = dim.nominal + eff_tol_plus
    eff_lsl = (dim.nominal - abs(eff_tol_minus)) if eff_tol_minus else None

    inspections = await service.get_inspections_for_dim(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
    )
    values = [i.measured_value for i in inspections]

    # RECTANGLE (spec 060, FR-029): consolidado/direção 1/direção 2 usam a utilização não
    # negativa de get_rectangle_consolidated() — independente de haver ou não valor próprio
    # do ferramenta de medição para esta posição (com modificador, o ferramenta de medição é só rastreabilidade,
    # FR-015, e pode nem ter sido importado).
    pieces: list[service.RectangleConsolidatedPiece] = []
    if dim.zone_geometry == ZoneGeometry.RECTANGLE:
        pieces = await service.get_rectangle_consolidated(
            session, batch_id, dim, cavity=cavity, tol_plus_override=tol_plus_override
        )

    if not values and not pieces:
        raise HTTPException(
            status_code=422, detail="nenhuma medição encontrada para esta dim/batch"
        )

    from app.sqc.models import DimType

    # ANGLE (a direct angular measurement) and any other future non-geometric
    # type must NOT be added here — they use the normal-distribution path below,
    # like DISTANCE/DIAMETER/SLAB. Only GD&T geometric characteristics belong
    # in this set. Note ANGULARITY (a GD&T characteristic) is distinct from
    # ANGLE and correctly stays here.
    geometric_types = {
        DimType.POSITION,
        DimType.FLATNESS,
        DimType.CYLINDRICITY,
        DimType.ROUNDNESS,
        DimType.STRAIGHTNESS,
        DimType.PARALLELISM,
        DimType.PERPENDICULARITY,
        DimType.ANGULARITY,
        DimType.CONCENTRICITY,
        DimType.SYMMETRY,
        DimType.PROFILE_SURFACE,
        DimType.PROFILE_LINE,
        DimType.RUNOUT_CIRCULAR,
        DimType.RUNOUT_TOTAL,
    }
    is_geometric = dim.type in geometric_types

    if values:
        result = (
            stats.calculate_distribution_weibull(values, eff_usl, eff_lsl, dim.nominal)
            if is_geometric
            else stats.calculate_distribution(values, eff_usl, eff_lsl, dim.nominal)
        )
        top_histogram = HistogramData(
            bin_edges=result.histogram.bin_edges, counts=result.histogram.counts
        )
        top_kde = KDEData(x=result.kde.x, y=result.kde.y)
        top_usl, top_lsl, top_nominal, top_n = result.usl, result.lsl, result.nominal, result.n
        distribution_type = result.distribution_type
        weibull_k, weibull_scale = result.weibull_k, result.weibull_scale
        normality_stat, normality_p, is_normal = (
            result.normality_stat,
            result.normality_p,
            result.is_normal,
        )

        # Distribuição do ratio normalizado para dims com modificador de material
        bonus_map = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)
        has_bonus = bool(bonus_map) and dim.material_modifier is not None
        ratio_histogram: HistogramData | None = None
        ratio_kde: KDEData | None = None

        if has_bonus:
            inspections_for_ratio = await service.get_inspections_for_dim(
                session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
            )
            ratios = [
                i.measured_value / (eff_usl + bonus_map.get((i.part_number, i.cavity), 0.0))
                for i in inspections_for_ratio
                if (eff_usl + bonus_map.get((i.part_number, i.cavity), 0.0)) > 0
            ]
            if len(ratios) >= 3:
                ratio_result = stats.calculate_distribution_weibull(ratios, 1.0, None, 0.0)
                ratio_histogram = HistogramData(
                    bin_edges=ratio_result.histogram.bin_edges,
                    counts=ratio_result.histogram.counts,
                )
                ratio_kde = KDEData(x=ratio_result.kde.x, y=ratio_result.kde.y)
    else:
        # RECTANGLE com modificador e sem nenhum valor próprio do ferramenta de medição importado —
        # os campos de topo (rastreabilidade) ficam vazios; consolidated/direction_* abaixo
        # são a distribuição real.
        top_histogram = HistogramData(bin_edges=[], counts=[])
        top_kde = KDEData(x=[], y=[])
        top_usl, top_lsl, top_nominal, top_n = eff_usl, eff_lsl, dim.nominal, 0
        distribution_type = "none"
        weibull_k = weibull_scale = normality_stat = normality_p = is_normal = None
        has_bonus = False
        ratio_histogram = ratio_kde = None

    def _utilization_series(utilizations: list[float]) -> DistributionSeries | None:
        if len(utilizations) < 3:
            return None
        r = stats.calculate_distribution_weibull(utilizations, 1.0, None, 0.0)
        return DistributionSeries(
            histogram=HistogramData(bin_edges=r.histogram.bin_edges, counts=r.histogram.counts),
            kde=KDEData(x=r.kde.x, y=r.kde.y),
            n=r.n,
            weibull_k=r.weibull_k,
            weibull_scale=r.weibull_scale,
        )

    consolidated_series = direction_1_series = direction_2_series = None
    direction_1_axis = direction_2_axis = None
    if pieces:
        evaluable = [p for p in pieces if p.conforming is not None]
        consolidated_series = _utilization_series(
            [
                p.consolidated_utilization
                for p in evaluable
                if p.consolidated_utilization is not None
            ]
        )
        relations = await service.list_axis_relations(session, dim_id)
        if len(relations) >= 1:
            direction_1_axis = relations[0].axis.value
            direction_1_series = _utilization_series(
                [d.utilization for p in pieces for d in p.directions if d.axis == relations[0].axis]
            )
        if len(relations) >= 2:
            direction_2_axis = relations[1].axis.value
            direction_2_series = _utilization_series(
                [d.utilization for p in pieces for d in p.directions if d.axis == relations[1].axis]
            )

    return DistributionResponse(
        histogram=top_histogram,
        kde=top_kde,
        usl=top_usl,
        lsl=top_lsl,
        nominal=top_nominal,
        n=top_n,
        distribution_type=distribution_type,
        weibull_k=weibull_k,
        weibull_scale=weibull_scale,
        normality_stat=normality_stat,
        normality_p=normality_p,
        is_normal=is_normal,
        has_bonus=has_bonus,
        ratio_histogram=ratio_histogram,
        ratio_kde=ratio_kde,
        consolidated=consolidated_series,
        direction_1=direction_1_series,
        direction_2=direction_2_series,
        direction_1_axis=direction_1_axis,
        direction_2_axis=direction_2_axis,
    )


# ── Inspections Detail ─────────────────────────────────────────────────────────


@router.get(
    "/batches/{batch_id}/dims/{dim_id}/inspections", response_model=InspectionsDetailResponse
)
async def get_inspections_detail(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    include_children: bool = Query(default=True),
    tol_plus_override: float | None = Query(default=None, gt=0),
    tol_minus_override: float | None = Query(default=None, ge=0),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> InspectionsDetailResponse:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    eff_tol_plus = tol_plus_override if tol_plus_override is not None else dim.tol_plus
    eff_tol_minus = tol_minus_override if tol_minus_override is not None else dim.tol_minus
    eff_usl = dim.nominal + eff_tol_plus

    if include_children:
        main_insp, children_data = await service.get_inspections_with_children(
            session, batch_id, dim_id, cavity=cavity
        )
    else:
        main_insp = await service.get_inspections_for_dim(session, batch_id, dim_id, cavity=cavity)
        children_data = {}

    has_children = bool(children_data)
    bonus_map = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)
    unc_map = await service.get_instrument_uncertainty_map(session)

    # Sugestão automática de outlier (z-score modificado) — calculada só sobre amostras não
    # ignoradas, na mesma ordem de `main_insp`, para casar 1:1 com `InspectionRow` abaixo.
    outlier_suggestions = stats.detect_outlier_suggestions(
        [i.measured_value for i in main_insp if not i.is_ignored]
    )
    outlier_by_inspection_id = {
        i.id: s
        for i, s in zip(
            (i for i in main_insp if not i.is_ignored), outlier_suggestions, strict=True
        )
    }

    # RECTANGLE (spec 060, FR-024): per-piece per-axis breakdown for the Details
    # row-expansion, keyed by part_number — None for pieces without any directional data.
    rectangle_by_unit: dict[tuple[int, int | None], service.RectangleConsolidatedPiece] = {}
    if dim.zone_geometry == ZoneGeometry.RECTANGLE:
        rectangle_by_unit = {
            (p.part_number, p.cavity): p
            for p in await service.get_rectangle_consolidated(
                session, batch_id, dim, cavity=cavity, tol_plus_override=tol_plus_override
            )
        }

    def _row_tolerance_used_pct(i: Inspection) -> float:
        # RECTANGLE + modificador (FR-016): a conformidade real é dada pelo consolidado
        # direcional (max(U_d1,U_d2)), não pelo valor bruto do ferramenta de medição — a linha principal
        # dos Detalhes precisa refletir a mesma fonte já usada na Visão Geral/Heatmap, senão
        # a % aqui diverge da % mostrada na expansão por direção (mesma peça, dois números).
        piece = rectangle_by_unit.get((i.part_number, i.cavity))
        if (
            dim.zone_geometry == ZoneGeometry.RECTANGLE
            and dim.material_modifier is not None
            and piece is not None
            and piece.consolidated_utilization is not None
        ):
            return piece.consolidated_utilization * 100
        return tolerance_used_pct(
            i.deviation,
            *stats.effective_tolerances(
                eff_tol_plus,
                eff_tol_minus,
                bonus_map.get((i.part_number, i.cavity), 0.0),
            ),
        )

    def _latest_child_value(i: Inspection, key: str) -> float | None:
        values = children_data.get((i.part_number, i.cavity), {}).get(key, [])
        return values[-1] if values else None

    rows = [
        InspectionRow(
            id=i.id,
            part_number=i.part_number,
            cavity=i.cavity,
            operator=i.operator,
            date_time=i.date_time,
            instrument=i.instrument,
            measured_value=i.measured_value,
            deviation=i.deviation,
            tolerance_used_pct=_row_tolerance_used_pct(i),
            bonus=bonus_map.get((i.part_number, i.cavity), 0.0),
            point_max=_latest_child_value(i, "max"),
            point_min=_latest_child_value(i, "min"),
            coord_x=_latest_child_value(i, "x"),
            coord_y=_latest_child_value(i, "y"),
            coord_z=_latest_child_value(i, "z"),
            uncertainty=(unc := unc_map.get((i.instrument or "").lower(), 0.0)) or None,
            uncertainty_zone=_unc_zone(
                i.measured_value,
                eff_usl + bonus_map.get((i.part_number, i.cavity), 0.0),
                (dim.nominal - abs(eff_tol_minus) - bonus_map.get((i.part_number, i.cavity), 0.0))
                if eff_tol_minus
                else None,
                unc,
            ),
            zone_geometry=("RECTANGLE" if (i.part_number, i.cavity) in rectangle_by_unit else None),
            directions=(
                [
                    _direction_to_schema(d)
                    for d in rectangle_by_unit[(i.part_number, i.cavity)].directions
                ]
                if (i.part_number, i.cavity) in rectangle_by_unit
                else None
            ),
            consolidated_utilization=(
                rectangle_by_unit[(i.part_number, i.cavity)].consolidated_utilization
                if (i.part_number, i.cavity) in rectangle_by_unit
                else None
            ),
            critical_axis=(
                rectangle_by_unit[(i.part_number, i.cavity)].critical_axis
                if (i.part_number, i.cavity) in rectangle_by_unit
                else None
            ),
            conforming=(
                rectangle_by_unit[(i.part_number, i.cavity)].conforming
                if (i.part_number, i.cavity) in rectangle_by_unit
                else None
            ),
            is_ignored=i.is_ignored,
            ignored_reason=i.ignored_reason,
            is_outlier_suggested=(
                outlier_by_inspection_id[i.id].is_outlier
                if i.id in outlier_by_inspection_id
                else False
            ),
            outlier_reason=(
                f"z-score modificado = {outlier_by_inspection_id[i.id].modified_zscore:.2f} "
                f"(limiar ±{stats.MODIFIED_ZSCORE_THRESHOLD})"
                if i.id in outlier_by_inspection_id and outlier_by_inspection_id[i.id].is_outlier
                else None
            ),
        )
        for i in main_insp
    ]

    return InspectionsDetailResponse(
        dim_code=dim.dim_code,
        dim_name=dim.dim_name,
        has_children=has_children,
        rows=rows,
    )


# ── Profile Distribution ───────────────────────────────────────────────────────


@router.get(
    "/batches/{batch_id}/dims/{dim_id}/profile-distribution",
    response_model=ProfileDistributionResponse,
)
async def get_profile_distribution(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> ProfileDistributionResponse:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    pos_tol, neg_tol = await service.get_profile_children_limits(session, dim_id)
    if pos_tol is None:
        raise HTTPException(status_code=422, detail="dim sem filhos MAX/MIN de perfil configurados")

    _inspections, children_data = await service.get_inspections_with_children(
        session,
        batch_id,
        dim_id,
        cavity=cavity,
        exclude_ignored=True,
    )

    max_vals = [
        value for child_values in children_data.values() for value in child_values.get("max", [])
    ]
    min_vals = [
        value for child_values in children_data.values() for value in child_values.get("min", [])
    ]

    def _side(vals: list[float]) -> ProfileSideStatsSchema | None:
        if len(vals) < 3 or pos_tol is None:
            return None
        lsl = neg_tol if neg_tol is not None else -pos_tol
        r = stats.calculate_profile_side_stats(vals, usl=pos_tol, lsl=lsl)
        return ProfileSideStatsSchema(
            n=r.n,
            mean=r.mean,
            std=r.std,
            cp=r.cp,
            cpk=r.cpk,
            cpu=r.cpu,
            cpl=r.cpl,
            normality_stat=r.normality_stat,
            normality_p=r.normality_p,
            is_normal=r.is_normal,
            histogram=HistogramData(
                bin_edges=r.histogram.bin_edges,
                counts=r.histogram.counts,
            ),
        )

    return ProfileDistributionResponse(
        pos=_side(max_vals),
        neg=_side(min_vals),
        usl=pos_tol,
        lsl=neg_tol,
    )


# ── Trend ──────────────────────────────────────────────────────────────────────


@router.get("/parts/{part_id}/dims/{dim_id}/profile-trend", response_model=ProfileTrendResponse)
async def get_profile_trend(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    batch_ids: str | None = Query(default=None, description="UUIDs separados por vírgula"),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> ProfileTrendResponse:
    import numpy as np

    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    parsed_batch_ids: list[uuid.UUID] | None = None
    if batch_ids:
        try:
            parsed_batch_ids = [uuid.UUID(b.strip()) for b in batch_ids.split(",")]
        except ValueError:
            raise HTTPException(status_code=400, detail="batch_ids inválidos") from None

    batch_data = await service.get_profile_trend_by_batch(
        session, part_id, dim_id, parsed_batch_ids, cavity=cavity
    )

    # Limites de tolerância dos filhos — buscados uma única vez
    pos_tol, neg_tol = await service.get_profile_children_limits(session, dim_id)
    lsl_for_cap = neg_tol if neg_tol is not None else ((-pos_tol) if pos_tol else None)

    result_batches = []
    for batch, max_vals, min_vals in batch_data:
        n = max(len(max_vals), len(min_vals))
        if n == 0:
            continue

        def _stats(
            vals: list[float],
        ) -> tuple[float | None, float | None, float | None, float | None]:
            if not vals:
                return None, None, None, None
            arr = np.array(vals, dtype=float)
            std = float(np.std(arr, ddof=1)) if len(arr) >= 2 else 0.0
            return (
                float(np.mean(arr)),
                std,
                float(np.percentile(arr, 5)),
                float(np.percentile(arr, 95)),
            )

        mean_max, std_max, p5_max, p95_max = _stats(max_vals)
        mean_min, std_min, p5_min, p95_min = _stats(min_vals)

        # Cp/Cpk e normalidade por lado
        cp_pos = cpk_pos = is_normal_pos = None
        cp_neg = cpk_neg = is_normal_neg = None
        if pos_tol is not None and lsl_for_cap is not None:
            if len(max_vals) >= 3:
                r = stats.calculate_profile_side_stats(max_vals, usl=pos_tol, lsl=lsl_for_cap)
                cp_pos, cpk_pos, is_normal_pos = r.cp, r.cpk, r.is_normal
            if len(min_vals) >= 3:
                r = stats.calculate_profile_side_stats(min_vals, usl=pos_tol, lsl=lsl_for_cap)
                cp_neg, cpk_neg, is_normal_neg = r.cp, r.cpk, r.is_normal

        result_batches.append(
            ProfileBatchStats(
                batch_id=batch.id,
                tracking_code=batch.tracking_code,
                n=n,
                mean_max=mean_max,
                std_max=std_max,
                p5_max=p5_max,
                p95_max=p95_max,
                mean_min=mean_min,
                std_min=std_min,
                p5_min=p5_min,
                p95_min=p95_min,
                cp_pos=cp_pos,
                cpk_pos=cpk_pos,
                is_normal_pos=is_normal_pos,
                cp_neg=cp_neg,
                cpk_neg=cpk_neg,
                is_normal_neg=is_normal_neg,
            )
        )

    def _sort_key(b: ProfileBatchStats) -> str:
        return b.tracking_code[:8] if len(b.tracking_code) >= 8 else b.tracking_code

    result_batches.sort(key=_sort_key)

    return ProfileTrendResponse(
        dim_code=dim.dim_code,
        batches=result_batches,
        usl=pos_tol if pos_tol is not None else dim.usl,
        lsl=lsl_for_cap,
    )


# ── Coordinates — lote único ───────────────────────────────────────────────────


@router.get("/batches/{batch_id}/dims/{dim_id}/coordinates", response_model=CoordinateData)
async def get_coordinates(
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    tol_plus_override: float | None = Query(default=None, gt=0),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> CoordinateData:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    # RECTANGLE (spec 060, contracts/api-sqc-060.md §3): fonte é a relação direcional
    # explícita (DimAxisRelation), nunca a inferência por sufixo _X/_Y/_Z usada abaixo
    # para CIRCULAR/legado (FR-033).
    if dim.zone_geometry == ZoneGeometry.RECTANGLE:
        pieces = await service.get_rectangle_consolidated(
            session, batch_id, dim, cavity=cavity, tol_plus_override=tol_plus_override
        )
        axis_nominal: dict[str, float] = {}
        points: list[CoordinatePoint] = []
        for piece in pieces:
            directions_schema = [_direction_to_schema(d) for d in piece.directions]
            axis_values: dict[str, float] = {}
            for d in piece.directions:
                axis_key = d.axis.value.lower()
                axis_nominal.setdefault(axis_key, d.nominal)
                axis_values[axis_key] = d.measured
            points.append(
                CoordinatePoint(
                    part_number=piece.part_number,
                    cavity=piece.cavity,
                    x=axis_values.get("x"),
                    y=axis_values.get("y"),
                    z=axis_values.get("z"),
                    directions=directions_schema,
                    consolidated_utilization=piece.consolidated_utilization,
                    critical_axis=piece.critical_axis,
                    conforming=piece.conforming,
                )
            )
        eff_tol_plus_rect = tol_plus_override if tol_plus_override is not None else dim.tol_plus
        return CoordinateData(
            dim_code=dim.dim_code,
            points=points,
            tol_radius=eff_tol_plus_rect / 2,
            has_bonus=dim.material_modifier is not None,
            zone_geometry="RECTANGLE",
            nominal_x=axis_nominal.get("x"),
            nominal_y=axis_nominal.get("y"),
            nominal_z=axis_nominal.get("z"),
            usl_x=None,
            lsl_x=None,
            usl_y=None,
            lsl_y=None,
            usl_z=None,
            lsl_z=None,
        )

    eff_tol_plus = tol_plus_override if tol_plus_override is not None else dim.tol_plus
    eff_tol_radius = eff_tol_plus / 2 if dim.type == DimType.POSITION else eff_tol_plus

    coord_map = await service.get_coordinate_data(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=True
    )
    children = await service.get_coordinate_children(session, dim_id)
    bonus_map = await service.get_bonus_map(session, batch_id, dim, cavity=cavity)

    def _child_bounds(axis: str) -> tuple[float | None, float | None, float | None]:
        c = children.get(axis)
        if c is None:
            return None, None, None
        return c.nominal, c.usl, c.lsl

    nom_x, usl_x, lsl_x = _child_bounds("x")
    nom_y, usl_y, lsl_y = _child_bounds("y")
    nom_z, usl_z, lsl_z = _child_bounds("z")

    points = [
        CoordinatePoint(
            part_number=pn,
            cavity=point_cavity,
            x=vals.get("x"),
            y=vals.get("y"),
            z=vals.get("z"),
            bonus=bonus_map.get((pn, point_cavity), 0.0),
        )
        for (pn, point_cavity), vals in sorted(
            coord_map.items(),
            key=lambda item: (item[0][0], -1 if item[0][1] is None else item[0][1]),
        )
    ]

    return CoordinateData(
        dim_code=dim.dim_code,
        points=points,
        tol_radius=eff_tol_radius,
        has_bonus=bool(bonus_map),
        nominal_x=nom_x,
        nominal_y=nom_y,
        nominal_z=nom_z,
        usl_x=usl_x,
        lsl_x=lsl_x,
        usl_y=usl_y,
        lsl_y=lsl_y,
        usl_z=usl_z,
        lsl_z=lsl_z,
    )


# ── Coordinates — tendência por lote ──────────────────────────────────────────


@router.get(
    "/parts/{part_id}/dims/{dim_id}/coordinate-trend", response_model=CoordinateTrendResponse
)
async def get_coordinate_trend(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    batch_ids: str | None = Query(default=None),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> CoordinateTrendResponse:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    parsed_ids = [uuid.UUID(b) for b in batch_ids.split(",") if b.strip()] if batch_ids else None

    stmt = (
        select(SqcBatch)
        .where(SqcBatch.part_id == part_id, SqcBatch.deleted_at.is_(None))
        .order_by(SqcBatch.created_at)
    )
    if parsed_ids:
        stmt = stmt.where(SqcBatch.id.in_(parsed_ids))
    batches_result = await session.execute(stmt)
    batches = list(batches_result.scalars().all())

    children = await service.get_coordinate_children(session, dim_id)

    def _batch_stats(
        vals: list[float],
    ) -> tuple[float | None, float | None, float | None, float | None]:
        if not vals:
            return None, None, None, None
        arr = np.array(vals, dtype=float)
        return (
            float(np.mean(arr)),
            float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0,
            float(np.percentile(arr, 5)),
            float(np.percentile(arr, 95)),
        )

    result_batches = []
    for batch in batches:
        coord_map = await service.get_coordinate_data(
            session, batch.id, dim_id, cavity=cavity, exclude_ignored=True
        )
        if not coord_map:
            continue
        xs = [v["x"] for v in coord_map.values() if "x" in v]
        ys = [v["y"] for v in coord_map.values() if "y" in v]
        zs = [v["z"] for v in coord_map.values() if "z" in v]
        n = max(len(xs), len(ys), len(zs))

        mx, sx, p5x, p95x = _batch_stats(xs)
        my, sy, p5y, p95y = _batch_stats(ys)
        mz, sz, p5z, p95z = _batch_stats(zs)

        result_batches.append(
            CoordinateBatchStats(
                batch_id=batch.id,
                tracking_code=batch.tracking_code,
                n=n,
                mean_x=mx,
                mean_y=my,
                mean_z=mz,
                std_x=sx,
                std_y=sy,
                std_z=sz,
                p5_x=p5x,
                p95_x=p95x,
                p5_y=p5y,
                p95_y=p95y,
                p5_z=p5z,
                p95_z=p95z,
            )
        )

    nom_x = children["x"].nominal if "x" in children else None
    nom_y = children["y"].nominal if "y" in children else None
    nom_z = children["z"].nominal if "z" in children else None

    return CoordinateTrendResponse(
        dim_code=dim.dim_code,
        batches=result_batches,
        tol_radius=dim._tol_radius,
        nominal_x=nom_x,
        nominal_y=nom_y,
        nominal_z=nom_z,
        zone_geometry=dim.zone_geometry.value if dim.zone_geometry else None,
    )


@router.get("/parts/{part_id}/dims/{dim_id}/trend", response_model=TrendResponse)
async def get_trend(
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    _: CurrentUser,
    batch_ids: str | None = Query(default=None, description="UUIDs separados por vírgula"),
    supplier_id: str | None = Query(default=None),
    cavity: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> TrendResponse:
    dim = await service.get_dim(session, dim_id)
    if not dim:
        raise HTTPException(status_code=404, detail="dimensão não encontrada")

    parsed_batch_ids: list[uuid.UUID] | None = None
    if batch_ids:
        try:
            parsed_batch_ids = [uuid.UUID(b.strip()) for b in batch_ids.split(",")]
        except ValueError:
            raise HTTPException(status_code=400, detail="batch_ids inválidos") from None

    batch_values = await service.get_inspections_by_batch_for_trend(
        session, part_id, dim_id, parsed_batch_ids, supplier_id, cavity=cavity
    )

    boxplots = []
    for batch, values in batch_values:
        if not values:
            continue
        bp = stats.calculate_boxplot(values)
        boxplots.append(
            BatchBoxplot(
                batch_id=batch.id,
                tracking_code=batch.tracking_code,
                date=batch.created_at,
                n=len(values),
                mean=sum(values) / len(values),
                q1=bp.q1,
                median=bp.median,
                q3=bp.q3,
                whisker_low=bp.whisker_low,
                whisker_high=bp.whisker_high,
                outliers=bp.outliers,
            )
        )

    # Ordenar pelo prefixo YYYYMMDD do tracking_code (formato: YYYYMMDD-SUPPLIER-INVOICE)
    def _sort_key(b: BatchBoxplot) -> str:
        return b.tracking_code[:8] if len(b.tracking_code) >= 8 else b.tracking_code

    boxplots.sort(key=_sort_key)

    return TrendResponse(
        dim_code=dim.dim_code,
        batches=boxplots,
        usl=dim.usl,
        lsl=dim.lsl,
        is_unilateral=dim.is_unilateral,
    )
