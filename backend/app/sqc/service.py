"""Queries async SQLAlchemy para o domínio SQC."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.sqc import nqa as nqa_calc
from app.sqc.models import (
    BatchStatus,
    Dim,
    DimAxis,
    DimAxisRelation,
    DimHistory,
    DimSubType,
    Inspection,
    InspectionIgnoreHistory,
    Instrument,
    MaterialModifier,
    Part,
    ProjectStatus,
    SqcBatch,
    ZoneGeometry,
)
from app.sqc.schemas import (
    BatchCreate,
    BatchUpdate,
    DimAxisRelationCreate,
    DimAxisRelationUpdate,
    DimCreate,
    DimUpdate,
    InstrumentCreate,
    InstrumentUpdate,
    PartCreate,
    PartUpdate,
)
from app.sqc.schemas import (
    ImportError as ImportRowError,
)

# ── Instruments ────────────────────────────────────────────────────────────────


async def list_instruments(session: AsyncSession) -> list[Instrument]:
    result = await session.execute(select(Instrument).order_by(Instrument.code))
    return list(result.scalars().all())


async def get_instrument(session: AsyncSession, instrument_id: uuid.UUID) -> Instrument | None:
    return await session.get(Instrument, instrument_id)


async def get_instrument_by_code(session: AsyncSession, code: str) -> Instrument | None:
    result = await session.execute(
        select(Instrument).where(func.lower(Instrument.code) == code.lower())
    )
    return result.scalar_one_or_none()


async def create_instrument(session: AsyncSession, data: InstrumentCreate) -> Instrument:
    inst = Instrument(
        id=uuid.uuid4(),
        code=data.code,
        name=data.name,
        uncertainty=data.uncertainty,
        created_at=datetime.now(UTC),
    )
    session.add(inst)
    await session.flush()
    return inst


async def update_instrument(
    session: AsyncSession,
    instrument: Instrument,
    data: InstrumentUpdate,
) -> Instrument:
    for field in data.model_fields_set:
        setattr(instrument, field, getattr(data, field))
    session.add(instrument)
    await session.flush()
    return instrument


async def delete_instrument(session: AsyncSession, instrument: Instrument) -> None:
    await session.delete(instrument)
    await session.flush()


async def get_instrument_uncertainty_map(session: AsyncSession) -> dict[str, float]:
    """Retorna {code.lower(): uncertainty} para lookup rápido por código do instrumento."""
    result = await session.execute(select(Instrument))
    return {i.code.lower(): i.uncertainty for i in result.scalars().all()}


# ── Parts ──────────────────────────────────────────────────────────────────────


async def create_part(session: AsyncSession, data: PartCreate) -> Part:
    part = Part(
        id=uuid.uuid4(),
        part_code=data.part_code,
        description=data.description,
        material=data.material,
        process=data.process,
        created_at=datetime.now(UTC),
    )
    session.add(part)
    await session.flush()
    return part


async def list_parts(session: AsyncSession) -> list[Part]:
    result = await session.execute(select(Part).order_by(Part.part_code))
    return list(result.scalars().all())


async def get_part(session: AsyncSession, part_id: uuid.UUID) -> Part | None:
    return await session.get(Part, part_id)


async def update_part(
    session: AsyncSession,
    part: Part,
    data: PartUpdate,
) -> Part:
    for field in data.model_fields_set:
        setattr(part, field, getattr(data, field))
    session.add(part)
    await session.flush()
    return part


# ── Dims ───────────────────────────────────────────────────────────────────────


async def record_dim_history(
    session: AsyncSession,
    *,
    part_id: uuid.UUID,
    dim_id: uuid.UUID | None,
    dim_code: str,
    changes: list[tuple[str, object, object]],
    action: str,
    actor_email: str,
) -> None:
    """Grava uma linha de sqc_dim_history por tupla (field, old_value, new_value) em `changes`.

    Valores são stringificados; None permanece None (criação sem old_value, deleção sem
    new_value). Chamado explicitamente pelos callers de create_dim/update_dim/delete_dim, dentro
    da mesma transação da escrita principal — nunca em background, nunca best-effort.
    """
    now = datetime.now(UTC)
    for field, old_value, new_value in changes:
        session.add(
            DimHistory(
                id=uuid.uuid4(),
                part_id=part_id,
                dim_id=dim_id,
                dim_code=dim_code,
                field=field,
                old_value=None if old_value is None else str(old_value),
                new_value=None if new_value is None else str(new_value),
                action=action,
                actor_email=actor_email,
                created_at=now,
            )
        )


async def create_dim(
    session: AsyncSession,
    part_id: uuid.UUID,
    data: DimCreate,
    actor_email: str,
    action: str = "create_manual",
) -> Dim:
    dim = Dim(
        id=uuid.uuid4(),
        part_id=part_id,
        drawing_revision=data.drawing_revision,
        dim_code=data.dim_code,
        dim_name=data.dim_name,
        type=data.type,
        sub_type=data.sub_type,
        nominal=data.nominal,
        tol_plus=data.tol_plus,
        tol_minus=data.tol_minus,
        material_modifier=data.material_modifier,
        dim_rel_1_id=data.dim_rel_1_id,
        dim_rel_2_id=data.dim_rel_2_id,
        parent_dim_id=data.parent_dim_id,
        zone_geometry=data.zone_geometry,
    )
    session.add(dim)
    await session.flush()

    history_fields = (
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
    changes: list[tuple[str, object, object]] = [
        (field, None, value)
        for field in history_fields
        if (value := getattr(dim, field)) is not None
    ]
    await record_dim_history(
        session,
        part_id=part_id,
        dim_id=dim.id,
        dim_code=dim.dim_code,
        changes=changes,
        action=action,
        actor_email=actor_email,
    )
    await session.flush()
    return dim


async def list_dims_for_part(
    session: AsyncSession,
    part_id: uuid.UUID,
    include_children: bool = False,
) -> list[Dim]:
    stmt = (
        select(Dim)
        .where(Dim.part_id == part_id)
        .options(selectinload(Dim.children))
        .order_by(Dim.dim_code)
    )
    result = await session.execute(stmt)
    dims = list(result.scalars().all())
    if not include_children:
        return [d for d in dims if d.parent_dim_id is None]
    return dims


async def get_dim(session: AsyncSession, dim_id: uuid.UUID) -> Dim | None:
    return await session.get(Dim, dim_id)


async def update_dim(
    session: AsyncSession,
    dim: Dim,
    data: DimUpdate,
    actor_email: str,
    action: str = "update_manual",
) -> Dim:
    changes: list[tuple[str, object, object]] = []
    for field in data.model_fields_set:
        old_value = getattr(dim, field)
        new_value = getattr(data, field)
        if old_value != new_value:
            changes.append((field, old_value, new_value))
        setattr(dim, field, new_value)
    session.add(dim)
    await session.flush()

    # Inspection.deviation é denormalizado (measured_value - nominal calculado no import) —
    # se o nominal mudou, todas as medições já importadas para esta dim (em qualquer lote,
    # inclusive arquivados) ficam com o desvio antigo até serem recomputadas aqui.
    if any(field == "nominal" for field, _, _ in changes):
        await session.execute(
            update(Inspection)
            .where(Inspection.dim_id == dim.id)
            .values(deviation=Inspection.measured_value - dim.nominal)
        )

    if changes:
        await record_dim_history(
            session,
            part_id=dim.part_id,
            dim_id=dim.id,
            dim_code=dim.dim_code,
            changes=changes,
            action=action,
            actor_email=actor_email,
        )
        await session.flush()
    return dim


async def check_dim_delete_conflict(session: AsyncSession, dim: Dim) -> dict | None:
    """Verifica se `dim` pode ser removida com segurança.

    Retorna None se não há bloqueio, ou um dict estruturado (para o 409 do router) se houver
    medições ou outras dims referenciando esta. Duas checagens porque os dois modos de falha
    (RESTRICT em Inspection.dim_id, SET NULL nas FKs de referência entre dims) exigem mensagens
    e dados diferentes — nenhum dos dois deve virar erro raw nem cascata silenciosa.
    """
    insp_count = await session.scalar(
        select(func.count()).select_from(Inspection).where(Inspection.dim_id == dim.id)
    )
    if insp_count:
        return {"reason": "has_inspections", "count": insp_count}

    referencing = await session.execute(
        select(Dim.dim_code).where(
            (Dim.parent_dim_id == dim.id)
            | (Dim.dim_rel_1_id == dim.id)
            | (Dim.dim_rel_2_id == dim.id)
        )
    )
    dim_codes = [code for (code,) in referencing]

    # sqc_dim_axis_relations: dim.id pode estar referenciado como coordinate_dim_id ou
    # related_size_dim_id de uma posição RECTANGLE — reporta a(s) posição(ões) dependente(s),
    # nunca a linha de relação em si (FR-039).
    axis_referencing = await session.execute(
        select(Dim.dim_code)
        .join(
            DimAxisRelation,
            (DimAxisRelation.coordinate_dim_id == dim.id)
            | (DimAxisRelation.related_size_dim_id == dim.id),
        )
        .where(Dim.id == DimAxisRelation.position_dim_id)
        .distinct()
    )
    dim_codes.extend(code for (code,) in axis_referencing if code not in dim_codes)

    if dim_codes:
        return {"reason": "referenced_by", "dim_codes": dim_codes}

    return None


async def delete_dim(session: AsyncSession, dim: Dim, actor_email: str) -> None:
    """Remove `dim` e grava uma linha de histórico. Chame check_dim_delete_conflict antes —
    esta função não repete as checagens de segurança."""
    await record_dim_history(
        session,
        part_id=dim.part_id,
        dim_id=dim.id,
        dim_code=dim.dim_code,
        changes=[("__deleted__", dim.dim_code, None)],
        action="delete",
        actor_email=actor_email,
    )
    # Flush the history INSERT before the DELETE — without an ORM relationship linking
    # DimHistory.dim_id to Dim, SQLAlchemy's unit-of-work has no dependency to order by and
    # may otherwise emit the DELETE first, violating the FK.
    await session.flush()
    await session.delete(dim)
    await session.flush()


async def get_dims_map_for_part(
    session: AsyncSession,
    part_id: uuid.UUID,
) -> dict[str, tuple[uuid.UUID, float]]:
    """Retorna {dim_code: (dim_id, nominal)} para lookup no importer (sem filhos)."""
    dims = await list_dims_for_part(session, part_id)
    return {d.dim_code: (d.id, d.nominal) for d in dims}


async def get_dims_map_full(
    session: AsyncSession,
    part_id: uuid.UUID,
) -> dict[str, Dim]:
    """Retorna {dim_code: Dim} incluindo dimensões filhas — para import de medições."""
    result = await session.execute(select(Dim).where(Dim.part_id == part_id).order_by(Dim.dim_code))
    return {d.dim_code: d for d in result.scalars().all()}


async def get_dim_by_code(
    session: AsyncSession,
    part_id: uuid.UUID,
    dim_code: str,
) -> Dim | None:
    result = await session.execute(
        select(Dim).where(Dim.part_id == part_id, Dim.dim_code == dim_code)
    )
    return result.scalar_one_or_none()


# ── Directional Axis Relations (RECTANGLE positions) ────────────────────────────


class AxisRelationValidationError(ValueError):
    """422 — payload da relação é inválido (eixo duplicado, coordenada fora da posição,
    sub_type incompatível com a natureza interno/externo já estabelecida)."""


class AxisRelationLimitError(ValueError):
    """409 — a posição já tem duas relações; uma terceira nunca é permitida (FR-002)."""


_INTERNAL_SUB_TYPES = {DimSubType.HOLE, DimSubType.SLOT}


def _relation_internal_nature(rel_dim: Dim) -> bool | None:
    if rel_dim.sub_type is None or rel_dim.sub_type == DimSubType.NONE:
        return None
    return rel_dim.sub_type in _INTERNAL_SUB_TYPES


async def list_axis_relations(
    session: AsyncSession, position_dim_id: uuid.UUID
) -> list[DimAxisRelation]:
    result = await session.execute(
        select(DimAxisRelation)
        .where(DimAxisRelation.position_dim_id == position_dim_id)
        .order_by(DimAxisRelation.created_at)
    )
    return list(result.scalars().all())


async def get_axis_relation(
    session: AsyncSession, relation_id: uuid.UUID
) -> DimAxisRelation | None:
    return await session.get(DimAxisRelation, relation_id)


async def _validate_axis_relation(
    session: AsyncSession,
    position: Dim,
    axis,
    coordinate_dim_id: uuid.UUID,
    related_size_dim_id: uuid.UUID | None,
    existing: list[DimAxisRelation],
    exclude_relation_id: uuid.UUID | None = None,
) -> None:
    others = [r for r in existing if r.id != exclude_relation_id]

    if any(r.axis == axis for r in others):
        raise AxisRelationValidationError(f"eixo {axis.value} já está em uso nesta posição")

    if any(r.coordinate_dim_id == coordinate_dim_id for r in others):
        raise AxisRelationValidationError(
            "esta dimensão de coordenada já está associada a outro eixo desta posição"
        )

    coordinate_dim = await get_dim(session, coordinate_dim_id)
    if (
        coordinate_dim is None
        or coordinate_dim.parent_dim_id != position.id
        or coordinate_dim.part_id != position.part_id
    ):
        raise AxisRelationValidationError(
            "coordinate_dim_id deve ser uma dimensão filha existente desta posição, na mesma peça"
        )

    if related_size_dim_id is not None:
        related_size_dim = await get_dim(session, related_size_dim_id)
        if related_size_dim is None or related_size_dim.part_id != position.part_id:
            raise AxisRelationValidationError(
                "related_size_dim_id deve ser uma dimensão existente da mesma peça"
            )
        if position.material_modifier is not None:
            new_nature = _relation_internal_nature(related_size_dim)
            if new_nature is None:
                raise AxisRelationValidationError(
                    f"sub_type de {related_size_dim.dim_code} não permite classificar "
                    "interno/externo, exigido quando a posição tem material_modifier"
                )
            for other in others:
                if other.related_size_dim_id is None:
                    continue
                other_dim = await get_dim(session, other.related_size_dim_id)
                if other_dim is None:
                    continue
                other_nature = _relation_internal_nature(other_dim)
                if other_nature is not None and other_nature != new_nature:
                    raise AxisRelationValidationError(
                        f"related_size_dim_id de {related_size_dim.dim_code} é "
                        f"{'interno' if new_nature else 'externo'}, mas a posição já usa "
                        f"dimensões {'internas' if other_nature else 'externas'} "
                        "(natureza deve ser consistente entre as relações, FR-007)"
                    )


async def create_axis_relation(
    session: AsyncSession,
    position: Dim,
    data: DimAxisRelationCreate,
    actor_email: str,
) -> DimAxisRelation:
    existing = await list_axis_relations(session, position.id)
    if len(existing) >= 2:
        raise AxisRelationLimitError("posição RECTANGLE já possui as duas relações permitidas")

    await _validate_axis_relation(
        session,
        position,
        data.axis,
        data.coordinate_dim_id,
        data.related_size_dim_id,
        existing,
    )

    relation = DimAxisRelation(
        id=uuid.uuid4(),
        position_dim_id=position.id,
        axis=data.axis,
        coordinate_dim_id=data.coordinate_dim_id,
        related_size_dim_id=data.related_size_dim_id,
        created_at=datetime.now(UTC),
    )
    session.add(relation)
    await session.flush()

    await record_dim_history(
        session,
        part_id=position.part_id,
        dim_id=position.id,
        dim_code=position.dim_code,
        changes=[
            (f"relation_{data.axis.value.lower()}_created", None, str(data.coordinate_dim_id))
        ],
        action="create_relation",
        actor_email=actor_email,
    )
    await session.flush()
    return relation


async def update_axis_relation(
    session: AsyncSession,
    position: Dim,
    relation: DimAxisRelation,
    data: DimAxisRelationUpdate,
    actor_email: str,
) -> DimAxisRelation:
    """Edita axis/coordinate_dim_id/related_size_dim_id em uma relação já existente, mesmo com
    resultados de peça já associados (FR-040) — sem recomputar nada persistido, a próxima
    leitura de análise já reflete a mudança (research.md R5). Cada campo alterado gera uma
    linha em sqc_dim_history prefixada pelo eixo atual, para distinguir múltiplas relações
    da mesma posição num único log de auditoria (FR-041)."""
    existing = await list_axis_relations(session, position.id)

    new_axis = data.axis if data.axis is not None else relation.axis
    new_coord = (
        data.coordinate_dim_id if data.coordinate_dim_id is not None else relation.coordinate_dim_id
    )
    new_related = (
        data.related_size_dim_id
        if "related_size_dim_id" in data.model_fields_set
        else relation.related_size_dim_id
    )

    await _validate_axis_relation(
        session,
        position,
        new_axis,
        new_coord,
        new_related,
        existing,
        exclude_relation_id=relation.id,
    )

    prefix = f"relation_{relation.axis.value.lower()}"
    changes: list[tuple[str, object, object]] = []
    if new_axis != relation.axis:
        changes.append((f"{prefix}_axis", relation.axis.value, new_axis.value))
        relation.axis = new_axis
    if new_coord != relation.coordinate_dim_id:
        changes.append((f"{prefix}_coordinate_dim_id", relation.coordinate_dim_id, new_coord))
        relation.coordinate_dim_id = new_coord
    if new_related != relation.related_size_dim_id:
        changes.append((f"{prefix}_related_size_dim_id", relation.related_size_dim_id, new_related))
        relation.related_size_dim_id = new_related

    session.add(relation)
    await session.flush()

    if changes:
        await record_dim_history(
            session,
            part_id=position.part_id,
            dim_id=position.id,
            dim_code=position.dim_code,
            changes=changes,
            action="update_relation",
            actor_email=actor_email,
        )
        await session.flush()
    return relation


async def delete_axis_relation(
    session: AsyncSession,
    position: Dim,
    relation: DimAxisRelation,
    actor_email: str,
) -> None:
    await record_dim_history(
        session,
        part_id=position.part_id,
        dim_id=position.id,
        dim_code=position.dim_code,
        changes=[
            (
                f"relation_{relation.axis.value.lower()}_deleted",
                str(relation.coordinate_dim_id),
                None,
            )
        ],
        action="delete_relation",
        actor_email=actor_email,
    )
    await session.flush()
    await session.delete(relation)
    await session.flush()


# ── Batches ────────────────────────────────────────────────────────────────────


async def create_batch(session: AsyncSession, data: BatchCreate) -> SqcBatch:
    batch = SqcBatch(
        id=uuid.uuid4(),
        tracking_code=data.tracking_code,
        part_id=data.part_id,
        supplier_id=data.supplier_id,
        project_status=data.project_status,
        batch_status=BatchStatus.IN_ANALYSIS,
        batch_size=data.batch_size,
        inspection_level=data.inspection_level,
        aql=data.aql,
        created_at=datetime.now(UTC),
    )
    session.add(batch)
    await session.flush()
    return batch


async def list_batches(
    session: AsyncSession,
    part_id: uuid.UUID | None = None,
    supplier_id: str | None = None,
    project_status: ProjectStatus | None = None,
) -> list[tuple[SqcBatch, int]]:
    """Retorna lista de (SqcBatch, inspection_count)."""
    count_subq = (
        select(Inspection.batch_id, func.count(Inspection.id).label("cnt"))
        .group_by(Inspection.batch_id)
        .subquery()
    )
    stmt = (
        select(SqcBatch, func.coalesce(count_subq.c.cnt, 0).label("inspection_count"))
        .outerjoin(count_subq, SqcBatch.id == count_subq.c.batch_id)
        .where(SqcBatch.deleted_at.is_(None))
        .order_by(SqcBatch.created_at.desc())
    )
    if part_id:
        stmt = stmt.where(SqcBatch.part_id == part_id)
    if supplier_id:
        stmt = stmt.where(SqcBatch.supplier_id == supplier_id)
    if project_status:
        stmt = stmt.where(SqcBatch.project_status == project_status)

    result = await session.execute(stmt)
    return [(row.SqcBatch, row.inspection_count) for row in result]


async def get_batch(session: AsyncSession, batch_id: uuid.UUID) -> SqcBatch | None:
    return await session.get(SqcBatch, batch_id)


async def drawing_revision_is_locked(
    session: AsyncSession,
    part_id: uuid.UUID,
    drawing_revision: str,
) -> bool:
    """Uma revisão usada por dimensão de lote decidido torna seu PDF imutável."""
    return bool(
        await session.scalar(
            select(func.count())
            .select_from(SqcBatch)
            .join(Dim, Dim.part_id == SqcBatch.part_id)
            .where(
                SqcBatch.part_id == part_id,
                SqcBatch.batch_status != BatchStatus.IN_ANALYSIS,
                Dim.drawing_revision == drawing_revision,
            )
        )
    )


async def get_batch_for_update(session: AsyncSession, batch_id: uuid.UUID) -> SqcBatch | None:
    """The batch under its row lock, re-read from the database (351 A-0227).

    Every route that decides a batch, edits it or adds measurements to it takes this lock
    BEFORE it checks ``check_batch_editable``: two requests in the same window used to both
    read IN_ANALYSIS and both write, the second decision replacing the first. The second
    request now waits for the first one's commit, re-reads its status and answers 409."""
    return await session.get(SqcBatch, batch_id, with_for_update=True, populate_existing=True)


async def get_inspection_count(session: AsyncSession, batch_id: uuid.UUID) -> int:
    return (
        await session.scalar(
            select(func.count()).select_from(Inspection).where(Inspection.batch_id == batch_id)
        )
        or 0
    )


def check_batch_editable(batch: SqcBatch) -> dict | None:
    """Verifica se `batch` ainda pode ser editado ou decidido.

    Retorna None se não há bloqueio, ou um dict estruturado (para o 409 do router) se o lote
    já tiver uma decisão registrada (aprovado/reprovado) — a mesma trava vale tanto para editar
    campos (Story 2) quanto para registrar uma nova decisão (Story 1)."""
    if batch.batch_status != BatchStatus.IN_ANALYSIS:
        return {"reason": "already_decided", "batch_status": batch.batch_status.value}
    return None


async def update_batch(session: AsyncSession, batch: SqcBatch, data: BatchUpdate) -> SqcBatch:
    for field in data.model_fields_set:
        setattr(batch, field, getattr(data, field))
    session.add(batch)
    await session.flush()
    return batch


async def check_batch_decidable(session: AsyncSession, batch: SqcBatch) -> dict | None:
    """Adiciona, à trava de `check_batch_editable`, o bloqueio de decidir um lote sem
    nenhuma medição registrada ainda (Story 1 / FR-004). Ter medições abaixo do tamanho
    de amostra exigido pelo NQA não bloqueia — só a ausência total de medições bloqueia.

    Também bloqueia (FR-017, spec 060) enquanto houver, em qualquer posição RECTANGLE da
    peça, alguma peça não avaliável (sem resultado principal confiável) neste lote."""
    conflict = check_batch_editable(batch)
    if conflict is not None:
        return conflict
    total_count, active_count = (
        await session.execute(
            select(
                func.count(Inspection.id),
                func.count(Inspection.id).filter(Inspection.is_ignored.is_(False)),
            ).where(Inspection.batch_id == batch.id)
        )
    ).one()
    if not total_count:
        return {"reason": "no_measurements"}
    if not active_count:
        return {"reason": "all_measurements_ignored"}
    non_evaluable = await get_batch_non_evaluable_summary(session, batch)
    if non_evaluable:
        return {"reason": "non_evaluable_pieces", "details": non_evaluable}
    return None


async def decide_batch(
    session: AsyncSession,
    batch: SqcBatch,
    outcome: str,
    justification: str | None,
) -> SqcBatch:
    batch.batch_status = BatchStatus(outcome)
    batch.rejection_justification = justification
    session.add(batch)
    await session.flush()
    return batch


@dataclass(frozen=True, slots=True)
class DimNqaEvaluation:
    inspected: int
    non_conforming: int
    non_evaluable_count: int = 0
    diagnostic_incomplete_count: int = 0


async def evaluate_dim_nqa(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim: Dim,
    *,
    cavity: int | None = None,
    tol_plus_override: float | None = None,
    tol_minus_override: float | None = None,
) -> DimNqaEvaluation:
    """Avalia NQA por unidade amostral, identificada por ``part_number``."""
    inspections = await get_inspections_for_dim(
        session,
        batch_id,
        dim.id,
        cavity=cavity,
        exclude_ignored=True,
    )
    non_evaluable_count = 0
    diagnostic_incomplete_count = 0
    if dim.zone_geometry == ZoneGeometry.RECTANGLE:
        non_evaluable, diagnostic_incomplete = await get_rectangle_evaluability(
            session, batch_id, dim, cavity=cavity
        )
        non_evaluable_count = len(non_evaluable)
        diagnostic_incomplete_count = len(diagnostic_incomplete)

    if dim.zone_geometry == ZoneGeometry.RECTANGLE and dim.material_modifier is not None:
        pieces = await get_rectangle_consolidated(
            session,
            batch_id,
            dim,
            cavity=cavity,
            tol_plus_override=tol_plus_override,
        )
        evaluable = [piece for piece in pieces if piece.conforming is not None]
        rectangle_by_part: dict[int, list[RectangleConsolidatedPiece]] = {}
        for piece in evaluable:
            rectangle_by_part.setdefault(piece.part_number, []).append(piece)
        return DimNqaEvaluation(
            inspected=len(rectangle_by_part),
            non_conforming=sum(
                1
                for part_pieces in rectangle_by_part.values()
                if any(not piece.conforming for piece in part_pieces)
            ),
            non_evaluable_count=non_evaluable_count,
            diagnostic_incomplete_count=diagnostic_incomplete_count,
        )

    eff_tol_plus = tol_plus_override if tol_plus_override is not None else dim.tol_plus
    eff_tol_minus = tol_minus_override if tol_minus_override is not None else dim.tol_minus
    eff_usl = dim.nominal + eff_tol_plus
    eff_lsl = dim.nominal - abs(eff_tol_minus) if eff_tol_minus not in (None, 0.0) else None
    bonus_map = await get_bonus_map(session, batch_id, dim, cavity=cavity)

    by_part: dict[int, list[Inspection]] = {}
    for inspection in inspections:
        by_part.setdefault(inspection.part_number, []).append(inspection)

    non_conforming = 0
    for readings in by_part.values():
        if any(
            reading.measured_value
            > eff_usl + bonus_map.get((reading.part_number, reading.cavity), 0.0)
            or (
                eff_lsl is not None
                and reading.measured_value
                < eff_lsl - bonus_map.get((reading.part_number, reading.cavity), 0.0)
            )
            for reading in readings
        ):
            non_conforming += 1

    return DimNqaEvaluation(
        inspected=len(by_part),
        non_conforming=non_conforming,
        non_evaluable_count=non_evaluable_count,
        diagnostic_incomplete_count=diagnostic_incomplete_count,
    )


def calculate_dim_nqa(batch: SqcBatch, evaluation: DimNqaEvaluation) -> nqa_calc.NqaResult:
    if batch.batch_size is not None:
        result = nqa_calc.calculate_nqa(
            batch_size=batch.batch_size,
            inspection_level=batch.inspection_level,
            aql=batch.aql,
            inspected=evaluation.inspected,
            non_conforming=evaluation.non_conforming,
        )
    else:
        letter = nqa_calc.get_letter_from_inspected(evaluation.inspected)
        required_n, ac, re = nqa_calc._resolve_plan(letter, batch.aql)
        result = nqa_calc.NqaResult(
            batch_size=None,
            inspection_level=batch.inspection_level,
            aql=batch.aql,
            letter=letter,
            required_sample_size=required_n,
            acceptance_number=ac,
            rejection_number=re,
            inspected=evaluation.inspected,
            non_conforming=evaluation.non_conforming,
            status=(
                "AMOSTRA_INSUFICIENTE"
                if evaluation.inspected == 0
                else ("ACEITO" if evaluation.non_conforming <= ac else "REJEITADO")
            ),
            achieved_aql=nqa_calc.calculate_achieved_aql(
                evaluation.inspected, evaluation.non_conforming
            ),
        )
    result.non_evaluable_count = evaluation.non_evaluable_count
    result.diagnostic_incomplete_count = evaluation.diagnostic_incomplete_count
    return result


async def get_nqa_summary_for_batch(
    session: AsyncSession, batch: SqcBatch
) -> list[tuple[Dim, nqa_calc.NqaResult]]:
    """Retorna o NQA por dimensão, contando unidades distintas por ``part_number``."""
    dims = await list_dims_for_part(session, batch.part_id)
    rows: list[tuple[Dim, nqa_calc.NqaResult]] = []
    for dim in dims:
        evaluation = await evaluate_dim_nqa(session, batch.id, dim)
        if evaluation.inspected == 0 and evaluation.non_evaluable_count == 0:
            continue
        rows.append((dim, calculate_dim_nqa(batch, evaluation)))
    return rows


# ── Inspections ────────────────────────────────────────────────────────────────


async def existing_import_measurement_keys(
    session: AsyncSession,
    batch_id: uuid.UUID,
    source_import_digest: str,
) -> set[tuple[int, uuid.UUID]]:
    """Linhas de um mesmo arquivo já aplicadas ao lote.

    A identidade de importação é ``(digest do arquivo, linha de origem, dimensão)``. Ela torna a
    repetição do mesmo upload idempotente sem confundir repetições metrológicas legítimas, que
    podem compartilhar dimensão, peça e cavidade.
    """
    result = await session.execute(
        select(Inspection.source_row, Inspection.dim_id).where(
            Inspection.batch_id == batch_id,
            Inspection.source_import_digest == source_import_digest,
            Inspection.source_row.is_not(None),
        )
    )
    return {(source_row, dim_id) for source_row, dim_id in result.all() if source_row is not None}


def screen_reimported_measurements(
    rows: list[dict],
    existing: set[tuple[int, uuid.UUID]],
    code_by_dim: dict[uuid.UUID, str],
) -> tuple[list[dict], list[ImportRowError]]:
    """Rejeita apenas linhas já importadas do mesmo arquivo; preserva todas as repetições."""
    kept: list[dict] = []
    errors: list[ImportRowError] = []
    for row in rows:
        source_row = row.get("source_row")
        key = (source_row, row["dim_id"])
        if source_row is None or key not in existing:
            kept.append(row)
            continue
        errors.append(
            ImportRowError(
                row=source_row,
                dim_code=code_by_dim.get(row["dim_id"], ""),
                reason="linha deste arquivo já importada neste lote",
            )
        )
    return kept, errors


async def import_inspections(
    session: AsyncSession,
    batch_id: uuid.UUID,
    rows: list[dict],
) -> None:
    """Persiste lista de dicionários de medição (já validados pelo importer)."""
    for row in rows:
        inspection = Inspection(
            id=uuid.uuid4(),
            batch_id=batch_id,
            **row,
        )
        session.add(inspection)
    await session.flush()


async def record_inspection_ignore_history(
    session: AsyncSession,
    *,
    inspection: Inspection,
    action: str,
    reason: str | None,
    actor_email: str,
) -> None:
    """Grava uma linha de sqc_inspection_ignore_history por ação de marcar/desmarcar.

    Análogo direto de record_dim_history (data-model.md §6): uma linha por ação, nunca
    atualizada nem removida — "nada é perdido silenciosamente" mesmo sob ações concorrentes
    (contracts/api-sqc-252.md §3, "Concurrency").
    """
    session.add(
        InspectionIgnoreHistory(
            id=uuid.uuid4(),
            inspection_id=inspection.id,
            batch_id=inspection.batch_id,
            dim_id=inspection.dim_id,
            part_number=inspection.part_number,
            action=action,
            reason=reason,
            actor_email=actor_email,
            created_at=datetime.now(UTC),
        )
    )


async def set_inspection_ignored(
    session: AsyncSession,
    inspection: Inspection,
    *,
    ignored: bool,
    reason: str | None,
    actor_email: str,
) -> Inspection:
    """Marca/desmarca `inspection` como desconsiderada (FR-007/FR-008/FR-009).

    Mesma estrutura de update_dim + record_dim_history: diffa, aplica, flush, grava
    histórico, flush. O valor medido original nunca é alterado (Constitution Principle VII)
    — apenas is_ignored/ignored_reason mudam.
    """
    if ignored and not (reason or "").strip():
        raise ValueError("reason is required when ignored=True")

    new_reason = reason if ignored else None
    inspection.is_ignored = ignored
    inspection.ignored_reason = new_reason
    session.add(inspection)
    await session.flush()

    await record_inspection_ignore_history(
        session,
        inspection=inspection,
        action="ignore" if ignored else "unignore",
        reason=new_reason,
        actor_email=actor_email,
    )
    await session.flush()
    return inspection


def _compute_bonus(
    measured_value: float,
    rel_dim: Dim,
    modifier: MaterialModifier,
) -> float:
    """Bônus MMC/LMC para uma única medição do dim relacionado (`rel_dim`).

    Lógica de sinal extraída, sem alteração de comportamento, de get_bonus_map — usada
    tanto pelo caminho legado CIRCULAR (via dim_rel_1_id) quanto pelo novo caminho
    RECTANGLE por eixo (via DimAxisRelation.related_size_dim_id), garantindo que os dois
    nunca dupliquem essa fórmula (research.md R4)."""
    is_internal = rel_dim.sub_type in {DimSubType.HOLE, DimSubType.SLOT}

    if modifier == MaterialModifier.M:
        mmc = (
            (rel_dim.nominal - abs(rel_dim.tol_minus or 0))
            if is_internal
            else (rel_dim.nominal + rel_dim.tol_plus)
        )
        b = (measured_value - mmc) if is_internal else (mmc - measured_value)
    else:  # LMC
        lmc = (
            (rel_dim.nominal + rel_dim.tol_plus)
            if is_internal
            else (rel_dim.nominal - abs(rel_dim.tol_minus or 0))
        )
        b = (lmc - measured_value) if is_internal else (measured_value - lmc)
    return max(0.0, b)


async def get_bonus_map(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim: Dim,
    cavity: int | None = None,
) -> dict[tuple[int, int | None], float]:
    """Retorna bônus por unidade física ``(part_number, cavity)``.

    A cavidade faz parte da identidade mesmo quando nenhum filtro é solicitado; medições de
    cavidades distintas nunca podem compartilhar bônus só porque reutilizam ``part_number``.
    """
    if dim.material_modifier is None or dim.dim_rel_1_id is None:
        return {}

    rel_dim = await get_dim(session, dim.dim_rel_1_id)
    if rel_dim is None:
        return {}

    rel_inspections = await get_inspections_for_dim(
        session,
        batch_id,
        dim.dim_rel_1_id,
        cavity=cavity,
        exclude_ignored=True,
    )
    if not rel_inspections:
        return {}

    bonus_by_unit: dict[tuple[int, int | None], float] = {}
    for inspection in rel_inspections:
        unit = (inspection.part_number, inspection.cavity)
        bonus = _compute_bonus(inspection.measured_value, rel_dim, dim.material_modifier)
        bonus_by_unit[unit] = min(bonus_by_unit.get(unit, bonus), bonus)
    return bonus_by_unit


async def get_axis_bonus_map(
    session: AsyncSession,
    batch_id: uuid.UUID,
    relation: DimAxisRelation,
    modifier: MaterialModifier | None,
    cavity: int | None = None,
) -> dict[tuple[int, int | None], float]:
    """Análogo a `get_bonus_map`, mas para uma relação direcional RECTANGLE em vez do
    `dim_rel_1_id` legado de uma posição CIRCULAR — mesma `_compute_bonus()` compartilhada
    (research.md R4). Retorna dict vazio sem modificador ou sem `related_size_dim_id`."""
    if modifier is None or relation.related_size_dim_id is None:
        return {}

    rel_dim = await get_dim(session, relation.related_size_dim_id)
    if rel_dim is None:
        return {}

    rel_inspections = await get_inspections_for_dim(
        session, batch_id, relation.related_size_dim_id, cavity=cavity, exclude_ignored=True
    )
    if not rel_inspections:
        return {}

    bonus_by_unit: dict[tuple[int, int | None], float] = {}
    for inspection in rel_inspections:
        unit = (inspection.part_number, inspection.cavity)
        bonus = _compute_bonus(inspection.measured_value, rel_dim, modifier)
        bonus_by_unit[unit] = min(bonus_by_unit.get(unit, bonus), bonus)
    return bonus_by_unit


@dataclass
class DirectionResult:
    """Resultado de uma direção de uma posição RECTANGLE para uma peça — ver
    contracts/api-sqc-060.md §3 e spec.md Calculation Model."""

    axis: DimAxis
    related_size_dim_code: str | None
    measured_size: float | None
    # Tolerância própria da cota de tamanho relacionada — para o raciocínio de bônus ficar
    # completo (nominal/tol+/tol-/desvio do tamanho, não só o bônus já calculado a partir dele).
    # None junto com `measured_size` quando não há relação de tamanho configurada nesta direção.
    related_size_nominal: float | None
    related_size_tol_plus: float | None
    related_size_tol_minus: float | None
    related_size_deviation: float | None
    material_condition: str | None  # "MMC" | "LMC" | None
    bonus: float
    nominal: float
    measured: float
    deviation: float
    base_limit: float
    effective_limit: float
    ratio_signed: float
    utilization: float


@dataclass
class RectangleConsolidatedPiece:
    """Resultado consolidado de uma peça de uma posição RECTANGLE — `directions` tem uma
    entrada por relação com medição presente para esta peça (pode ter menos que o total de
    relações configuradas, quando uma direção está sem dado — diagnóstico incompleto, US4).
    `consolidated_utilization`/`critical_axis`/`conforming` são `None` quando incompleto
    (menos direções com dado do que relações configuradas) — nunca um zero fabricado."""

    part_number: int
    cavity: int | None
    directions: list[DirectionResult]
    consolidated_utilization: float | None
    critical_axis: str | None  # "X" | "Y" | "Z" | "both" | None
    conforming: bool | None


_MATERIAL_CONDITION_LABEL = {MaterialModifier.M: "MMC", MaterialModifier.L: "LMC"}
_CRITICAL_AXIS_TIE_EPSILON = 1e-6


async def get_rectangle_consolidated(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim: Dim,
    cavity: int | None = None,
    tol_plus_override: float | None = None,
) -> list[RectangleConsolidatedPiece]:
    """Calcula, por peça, o resultado direcional de uma posição RECTANGLE: bônus e limite
    efetivo independentes por eixo (`L_d=(T_d+B_d)/2`, `U_d=|Δ_d|/L_d`), consolidado como
    `max(U_d1,U_d2)` com identificação da direção crítica (spec.md Calculation Model).

    `T_d` usa sempre a largura total `T` da posição — `dim.tol_plus`, ou `tol_plus_override`
    quando o chamador está numa simulação de tolerância (não há, hoje, override por direção
    no modelo de dados, apenas `DimAxisRelation`).
    """
    relations = await list_axis_relations(session, dim.id)
    if not relations:
        return []

    total_width = tol_plus_override if tol_plus_override is not None else dim.tol_plus
    modifier = dim.material_modifier
    material_condition = _MATERIAL_CONDITION_LABEL.get(modifier) if modifier else None

    per_axis: dict[DimAxis, dict] = {}
    unit_keys: set[tuple[int, int | None]] = set()
    for relation in relations:
        coordinate_dim = await get_dim(session, relation.coordinate_dim_id)
        related_dim = (
            await get_dim(session, relation.related_size_dim_id)
            if relation.related_size_dim_id
            else None
        )
        bonus_map = await get_axis_bonus_map(session, batch_id, relation, modifier, cavity=cavity)
        coord_inspections: dict[tuple[int, int | None], list[Inspection]] = {}
        for inspection in await get_inspections_for_dim(
            session, batch_id, relation.coordinate_dim_id, cavity=cavity, exclude_ignored=True
        ):
            coord_inspections.setdefault((inspection.part_number, inspection.cavity), []).append(
                inspection
            )
        related_inspections: dict[tuple[int, int | None], list[Inspection]] = {}
        if relation.related_size_dim_id:
            for inspection in await get_inspections_for_dim(
                session,
                batch_id,
                relation.related_size_dim_id,
                cavity=cavity,
                exclude_ignored=True,
            ):
                related_inspections.setdefault(
                    (inspection.part_number, inspection.cavity), []
                ).append(inspection)
        per_axis[relation.axis] = {
            "coordinate_dim": coordinate_dim,
            "related_dim": related_dim,
            "bonus_map": bonus_map,
            "coord_inspections": coord_inspections,
            "related_inspections": related_inspections,
        }
        unit_keys.update(coord_inspections.keys())

    pieces: list[RectangleConsolidatedPiece] = []
    for part_number, unit_cavity in sorted(
        unit_keys, key=lambda unit: (unit[0], -1 if unit[1] is None else unit[1])
    ):
        unit_key = (part_number, unit_cavity)
        directions: list[DirectionResult] = []
        for relation in relations:
            axis_data = per_axis[relation.axis]
            axis_inspections = axis_data["coord_inspections"].get(unit_key, [])
            if not axis_inspections:
                continue
            axis_coordinate_dim = axis_data["coordinate_dim"]
            axis_related_dim = axis_data["related_dim"]
            bonus = axis_data["bonus_map"].get(unit_key, 0.0)
            base_limit = total_width / 2
            effective_limit = (total_width + bonus) / 2
            insp = max(
                axis_inspections,
                key=lambda reading: (
                    abs(reading.deviation / effective_limit) if effective_limit else float("inf")
                ),
            )
            deviation = insp.deviation
            ratio_signed = deviation / effective_limit if effective_limit else 0.0
            related_readings = axis_data["related_inspections"].get(unit_key, [])
            related_insp = (
                min(
                    related_readings,
                    key=lambda reading: _compute_bonus(
                        reading.measured_value, axis_related_dim, modifier
                    ),
                )
                if related_readings and axis_related_dim is not None and modifier is not None
                else (related_readings[0] if related_readings else None)
            )
            directions.append(
                DirectionResult(
                    axis=relation.axis,
                    related_size_dim_code=(axis_related_dim.dim_code if axis_related_dim else None),
                    measured_size=related_insp.measured_value if related_insp else None,
                    related_size_nominal=(axis_related_dim.nominal if axis_related_dim else None),
                    related_size_tol_plus=(axis_related_dim.tol_plus if axis_related_dim else None),
                    related_size_tol_minus=(
                        axis_related_dim.tol_minus if axis_related_dim else None
                    ),
                    related_size_deviation=(related_insp.deviation if related_insp else None),
                    material_condition=material_condition,
                    bonus=bonus,
                    nominal=axis_coordinate_dim.nominal,
                    measured=insp.measured_value,
                    deviation=deviation,
                    base_limit=base_limit,
                    effective_limit=effective_limit,
                    ratio_signed=ratio_signed,
                    utilization=abs(ratio_signed),
                )
            )

        if len(directions) == len(relations) and directions:
            max_utilization = max(d.utilization for d in directions)
            critical = [
                d.axis.value
                for d in directions
                if abs(d.utilization - max_utilization) <= _CRITICAL_AXIS_TIE_EPSILON
            ]
            critical_axis = "both" if len(critical) > 1 else critical[0]
            conforming = all(d.utilization <= 1.0 for d in directions)
            consolidated_utilization = max_utilization
        else:
            critical_axis = None
            conforming = None
            consolidated_utilization = None

        pieces.append(
            RectangleConsolidatedPiece(
                part_number=part_number,
                cavity=unit_cavity,
                directions=directions,
                consolidated_utilization=consolidated_utilization,
                critical_axis=critical_axis,
                conforming=conforming,
            )
        )

    return pieces


async def get_rectangle_evaluability(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim: Dim,
    cavity: int | None = None,
) -> tuple[list[int], list[int]]:
    """Retorna (não_avaliável, diagnóstico_incompleto) — as duas listas de part_number de
    uma posição RECTANGLE neste lote, por FR-017/FR-018.

    Universo considerado: peças com ao menos um dado próprio desta posição (ferramenta de medição e/ou
    alguma coordenada direcional) — uma peça sem nenhum dado para esta posição simplesmente
    não é amostrada aqui (mesmo comportamento hoje aplicado a CIRCULAR), não é "não avaliável".

    Com material_modifier: o consolidado direcional é a fonte principal (FR-015), então
    diagnóstico incompleto (`conforming is None`) já torna a peça não avaliável.
    Sem material_modifier: o ferramenta de medição é a fonte principal (FR-014); só a ausência do próprio
    valor do ferramenta de medição torna a peça não avaliável (FR-017) — diagnóstico incompleto vira apenas
    aviso, nunca bloqueio (FR-018).

    `cavity=None` (o padrão usado por `check_batch_decidable`) considera o lote inteiro —
    a decisão do lote não é uma ação por cavidade. Endpoints que já filtram por cavidade
    (ex.: `get_statistics`) devem repassar o mesmo filtro aqui.
    """
    position_units = {
        (i.part_number, i.cavity)
        for i in await get_inspections_for_dim(
            session, batch_id, dim.id, cavity=cavity, exclude_ignored=True
        )
    }
    consolidated_by_unit = {
        (p.part_number, p.cavity): p
        for p in await get_rectangle_consolidated(session, batch_id, dim, cavity=cavity)
    }
    universe = position_units | set(consolidated_by_unit)

    non_evaluable: list[int] = []
    diagnostic_incomplete: list[int] = []
    for unit_key in sorted(
        universe, key=lambda unit: (unit[0], -1 if unit[1] is None else unit[1])
    ):
        part_number, _unit_cavity = unit_key
        piece = consolidated_by_unit.get(unit_key)
        incomplete = piece is None or piece.conforming is None
        if dim.material_modifier is not None:
            if incomplete:
                non_evaluable.append(part_number)
        elif unit_key not in position_units:
            non_evaluable.append(part_number)
        elif incomplete:
            diagnostic_incomplete.append(part_number)

    return non_evaluable, diagnostic_incomplete


async def get_batch_non_evaluable_summary(
    session: AsyncSession, batch: SqcBatch
) -> dict[str, list[int]]:
    """Retorna {dim_code: [part_numbers não avaliáveis]} para toda posição RECTANGLE da peça
    do lote — usado por check_batch_decidable (FR-017: bloqueia a decisão enquanto houver
    peças sem resultado principal confiável). Dims sem nenhuma peça não avaliável ficam de
    fora do dict (dict vazio = lote liberado por este critério)."""
    dims = await list_dims_for_part(session, batch.part_id)
    summary: dict[str, list[int]] = {}
    for dim in dims:
        if dim.zone_geometry != ZoneGeometry.RECTANGLE:
            continue
        non_evaluable, _ = await get_rectangle_evaluability(session, batch.id, dim)
        if non_evaluable:
            summary[dim.dim_code] = non_evaluable
    return summary


async def get_inspections_for_dim(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    cavity: int | None = None,
    exclude_ignored: bool = False,
) -> list[Inspection]:
    stmt = (
        select(Inspection)
        .where(Inspection.batch_id == batch_id, Inspection.dim_id == dim_id)
        .order_by(Inspection.part_number)
    )
    if cavity is not None:
        stmt = stmt.where(Inspection.cavity == cavity)
    if exclude_ignored:
        stmt = stmt.where(Inspection.is_ignored.is_(False))
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_inspections_grouped_by_part(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    cavity: int | None = None,
    exclude_ignored: bool = False,
) -> dict[int, list[float]]:
    """Retorna {part_number: [measured_values]} para cálculo de cartas de controle."""
    inspections = await get_inspections_for_dim(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=exclude_ignored
    )
    groups: dict[int, list[float]] = {}
    for insp in inspections:
        groups.setdefault(insp.part_number, []).append(insp.measured_value)
    return groups


async def get_inspections_with_children(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    cavity: int | None = None,
    exclude_ignored: bool = False,
) -> tuple[list[Inspection], dict[tuple[int, int | None], dict[str, list[float]]]]:
    """Retorna inspeções principais e todas as leituras filhas por unidade física e chave."""
    main_insp = await get_inspections_for_dim(
        session, batch_id, dim_id, cavity=cavity, exclude_ignored=exclude_ignored
    )

    children_stmt = select(Dim).where(Dim.parent_dim_id == dim_id)
    children_result = await session.execute(children_stmt)
    children = list(children_result.scalars().all())

    children_data: dict[tuple[int, int | None], dict[str, list[float]]] = {}
    for child in children:
        child_insp = await get_inspections_for_dim(
            session,
            batch_id,
            child.id,
            cavity=cavity,
            exclude_ignored=exclude_ignored,
        )
        code = child.dim_code.upper()
        if code.endswith("_MAX") or "MAX" in code:
            key = "max"
        elif code.endswith("_MIN") or "MIN" in code:
            key = "min"
        elif code.endswith("_X"):
            key = "x"
        elif code.endswith("_Y"):
            key = "y"
        elif code.endswith("_Z"):
            key = "z"
        else:
            continue
        for ci in child_insp:
            children_data.setdefault((ci.part_number, ci.cavity), {}).setdefault(key, []).append(
                ci.deviation
            )

    return main_insp, children_data


async def get_profile_children_limits(
    session: AsyncSession,
    dim_id: uuid.UUID,
) -> tuple[float | None, float | None]:
    """Retorna (pos_tol, neg_tol) para uma dim PROFILE_SURFACE.

    pos_tol = nominal_max + tol_plus_max  (USL do desvio positivo)
    neg_tol = nominal_min - |tol_minus_min|  (LSL do desvio negativo, valor negativo)
    """
    children_stmt = select(Dim).where(Dim.parent_dim_id == dim_id)
    result = await session.execute(children_stmt)
    children = list(result.scalars().all())

    max_child = next((c for c in children if "MAX" in c.dim_code.upper()), None)
    min_child = next((c for c in children if "MIN" in c.dim_code.upper()), None)

    pos_tol = (max_child.nominal + max_child.tol_plus) if max_child else None
    neg_tol = (min_child.nominal - abs(min_child.tol_minus or 0)) if min_child else None

    return pos_tol, neg_tol


async def get_profile_trend_by_batch(
    session: AsyncSession,
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    batch_ids: list[uuid.UUID] | None = None,
    cavity: int | None = None,
) -> list[tuple[SqcBatch, list[float], list[float]]]:
    """Retorna [(SqcBatch, [desvios _max], [desvios _min])] para o ProfileTrendChart."""
    stmt = (
        select(SqcBatch)
        .where(SqcBatch.part_id == part_id, SqcBatch.deleted_at.is_(None))
        .order_by(SqcBatch.created_at)
    )
    if batch_ids:
        stmt = stmt.where(SqcBatch.id.in_(batch_ids))
    batches_result = await session.execute(stmt)
    batches = list(batches_result.scalars().all())

    # Identificar filhas _max e _min da dim
    children_stmt = select(Dim).where(Dim.parent_dim_id == dim_id)
    children_result = await session.execute(children_stmt)
    children = list(children_result.scalars().all())
    max_child = next((c for c in children if "MAX" in c.dim_code.upper()), None)
    min_child = next((c for c in children if "MIN" in c.dim_code.upper()), None)

    out = []
    for batch in batches:
        max_vals: list[float] = []
        min_vals: list[float] = []
        if max_child:
            insp = await get_inspections_for_dim(
                session, batch.id, max_child.id, cavity=cavity, exclude_ignored=True
            )
            max_vals = [i.deviation for i in insp]
        if min_child:
            insp = await get_inspections_for_dim(
                session, batch.id, min_child.id, cavity=cavity, exclude_ignored=True
            )
            min_vals = [i.deviation for i in insp]
        out.append((batch, max_vals, min_vals))
    return out


async def get_inspections_by_batch_for_trend(
    session: AsyncSession,
    part_id: uuid.UUID,
    dim_id: uuid.UUID,
    batch_ids: list[uuid.UUID] | None = None,
    supplier_id: str | None = None,
    cavity: int | None = None,
) -> list[tuple[SqcBatch, list[float]]]:
    """Retorna [(SqcBatch, [measured_values])] para construção do Trend Boxplot."""
    stmt = (
        select(SqcBatch)
        .where(SqcBatch.part_id == part_id, SqcBatch.deleted_at.is_(None))
        .order_by(SqcBatch.created_at)
    )
    if batch_ids:
        stmt = stmt.where(SqcBatch.id.in_(batch_ids))
    if supplier_id:
        stmt = stmt.where(SqcBatch.supplier_id == supplier_id)

    batches_result = await session.execute(stmt)
    batches = list(batches_result.scalars().all())

    out = []
    for batch in batches:
        inspections = await get_inspections_for_dim(
            session, batch.id, dim_id, cavity=cavity, exclude_ignored=True
        )
        values = [i.measured_value for i in inspections]
        out.append((batch, values))
    return out


async def get_coordinate_data(
    session: AsyncSession,
    batch_id: uuid.UUID,
    dim_id: uuid.UUID,
    cavity: int | None = None,
    exclude_ignored: bool = False,
) -> dict[tuple[int, int | None], dict[str, float]]:
    """Retorna {(part_number, cavity): {axis: measured_value}} para dims filhas X/Y/Z."""
    children_stmt = select(Dim).where(Dim.parent_dim_id == dim_id)
    children_result = await session.execute(children_stmt)
    children = list(children_result.scalars().all())

    data: dict[tuple[int, int | None], dict[str, float]] = {}
    for child in children:
        code_upper = child.dim_code.upper()
        if code_upper.endswith("_X"):
            axis = "x"
        elif code_upper.endswith("_Y"):
            axis = "y"
        elif code_upper.endswith("_Z"):
            axis = "z"
        else:
            continue
        insp = await get_inspections_for_dim(
            session, batch_id, child.id, cavity=cavity, exclude_ignored=exclude_ignored
        )
        for i in insp:
            data.setdefault((i.part_number, i.cavity), {})[axis] = i.measured_value

    return data


async def get_coordinate_children(
    session: AsyncSession,
    dim_id: uuid.UUID,
) -> dict[str, Dim]:
    """Retorna {axis: Dim} para as filhas X/Y/Z de uma posição."""
    children_stmt = select(Dim).where(Dim.parent_dim_id == dim_id)
    result = await session.execute(children_stmt)
    out: dict[str, Dim] = {}
    for child in result.scalars().all():
        code_upper = child.dim_code.upper()
        if code_upper.endswith("_X"):
            out["x"] = child
        elif code_upper.endswith("_Y"):
            out["y"] = child
        elif code_upper.endswith("_Z"):
            out["z"] = child
    return out


def _parse_drawing_revision(revision: str) -> tuple[int, int] | None:
    """Parseia uma revisão no padrão `major.minor` (ex.: "3.2" -> (3, 2))."""
    parts = revision.split(".")
    if len(parts) < 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def most_advanced_drawing_revision(revisions: list[str]) -> str | None:
    """Retorna a revisão mais avançada (maior major, depois maior minor).

    Revisões que não seguem o padrão `major.minor` numérico são ignoradas.
    """
    parsed = [(revision, _parse_drawing_revision(revision)) for revision in revisions]
    valid = [(revision, key) for revision, key in parsed if key is not None]
    if not valid:
        return None
    return max(valid, key=lambda item: item[1])[0]
