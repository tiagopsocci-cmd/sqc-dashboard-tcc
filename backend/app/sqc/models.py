import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Double,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ProjectStatus(enum.StrEnum):
    EVB = "EVB"
    PVB = "PVB"
    IE = "IE"


class BatchStatus(enum.StrEnum):
    APPROVED = "APPROVED"
    IN_ANALYSIS = "IN_ANALYSIS"
    REJECTED = "REJECTED"


class DimType(enum.StrEnum):
    DISTANCE = "DISTANCE"
    DIAMETER = "DIAMETER"
    SLAB = "SLAB"
    ANGLE = "ANGLE"
    POSITION = "POSITION"
    FLATNESS = "FLATNESS"
    CYLINDRICITY = "CYLINDRICITY"
    ROUNDNESS = "ROUNDNESS"
    STRAIGHTNESS = "STRAIGHTNESS"
    PARALLELISM = "PARALLELISM"
    PERPENDICULARITY = "PERPENDICULARITY"
    ANGULARITY = "ANGULARITY"
    CONCENTRICITY = "CONCENTRICITY"
    SYMMETRY = "SYMMETRY"
    PROFILE_SURFACE = "PROFILE_SURFACE"
    PROFILE_LINE = "PROFILE_LINE"
    RUNOUT_CIRCULAR = "RUNOUT_CIRCULAR"
    RUNOUT_TOTAL = "RUNOUT_TOTAL"


class DimSubType(enum.StrEnum):
    HOLE = "HOLE"
    SHAFT = "SHAFT"
    SLOT = "SLOT"
    WIDTH = "WIDTH"
    NONE = "NONE"


class MaterialModifier(enum.StrEnum):
    M = "M"
    L = "L"


class ZoneGeometry(enum.StrEnum):
    CIRCULAR = "CIRCULAR"
    RECTANGLE = "RECTANGLE"
    LINE = "LINE"


class DimAxis(enum.StrEnum):
    X = "X"
    Y = "Y"
    Z = "Z"


class Instrument(Base):
    __tablename__ = "sqc_instruments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    uncertainty: Mapped[float] = mapped_column(Double(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Part(Base):
    __tablename__ = "sqc_parts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    part_code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    material: Mapped[str | None] = mapped_column(String(100), nullable=True)
    process: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    dims: Mapped[list["Dim"]] = relationship(
        "Dim", back_populates="part", foreign_keys="Dim.part_id"
    )
    batches: Mapped[list["SqcBatch"]] = relationship("SqcBatch", back_populates="part")


class Dim(Base):
    __tablename__ = "sqc_dims"
    __table_args__ = (
        UniqueConstraint("part_id", "dim_code", name="uq_sqc_dims_part_dim_code"),
        Index("ix_sqc_dims_part_id", "part_id"),
        Index("ix_sqc_dims_parent_dim_id", "parent_dim_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    part_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_parts.id", ondelete="RESTRICT"), nullable=False
    )
    drawing_revision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    dim_code: Mapped[str] = mapped_column(String(50), nullable=False)
    dim_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type: Mapped[DimType] = mapped_column(
        SAEnum(DimType, name="sqc_dim_type", create_type=False), nullable=False
    )
    sub_type: Mapped[DimSubType | None] = mapped_column(
        SAEnum(DimSubType, name="sqc_dim_sub_type", create_type=False), nullable=True
    )
    nominal: Mapped[float] = mapped_column(Double(), nullable=False)
    tol_plus: Mapped[float] = mapped_column(Double(), nullable=False)
    tol_minus: Mapped[float | None] = mapped_column(Double(), nullable=True)
    material_modifier: Mapped[MaterialModifier | None] = mapped_column(
        SAEnum(MaterialModifier, name="sqc_material_modifier", create_type=False), nullable=True
    )
    dim_rel_1_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="SET NULL"), nullable=True
    )
    dim_rel_2_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="SET NULL"), nullable=True
    )
    parent_dim_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="SET NULL"), nullable=True
    )
    zone_geometry: Mapped[ZoneGeometry | None] = mapped_column(
        SAEnum(ZoneGeometry, name="sqc_zone_geometry", create_type=False), nullable=True
    )

    part: Mapped["Part"] = relationship("Part", back_populates="dims", foreign_keys=[part_id])
    children: Mapped[list["Dim"]] = relationship(
        "Dim", foreign_keys="Dim.parent_dim_id", back_populates="parent"
    )
    parent: Mapped["Dim | None"] = relationship(
        "Dim", foreign_keys=[parent_dim_id], back_populates="children", remote_side="Dim.id"
    )
    inspections: Mapped[list["Inspection"]] = relationship("Inspection", back_populates="dim")
    axis_relations: Mapped[list["DimAxisRelation"]] = relationship(
        "DimAxisRelation",
        foreign_keys="DimAxisRelation.position_dim_id",
        back_populates="position_dim",
    )

    @property
    def is_unilateral(self) -> bool:
        return self.tol_minus is None or self.tol_minus == 0.0

    @property
    def _tol_radius(self) -> float:
        """Tolerância como raio máximo permitido.
        POSITION usa diâmetro de zona → divide por 2. Todos os outros usam direto."""
        if self.type == DimType.POSITION:
            return self.tol_plus / 2
        return self.tol_plus

    @property
    def usl(self) -> float:
        return self.nominal + self.tol_plus

    @property
    def lsl(self) -> float | None:
        if self.is_unilateral:
            return None
        return self.nominal - abs(self.tol_minus)  # type: ignore[arg-type]

    def usl_with_bonus(self, bonus: float = 0.0) -> float:
        """USL efetivo com bônus MMC/LMC."""
        return self.usl + bonus

    def lsl_with_bonus(self, bonus: float = 0.0) -> float | None:
        """LSL efetivo com bônus MMC/LMC. POSITION é sempre unilateral (sem LSL)."""
        if self.lsl is None:
            return None
        return self.lsl - bonus


class DimAxisRelation(Base):
    """Relação direcional explícita (axis, coordinate dim, related size dim) de uma
    posição RECTANGLE — substitui a inferência por sufixo `_X`/`_Y`/`_Z` do dim_code
    para toda dim que possuir uma linha aqui. No máximo duas linhas por posição
    (invariante aplicada em service.py, não em constraint de banco — ver data-model.md)."""

    __tablename__ = "sqc_dim_axis_relations"
    __table_args__ = (
        UniqueConstraint("position_dim_id", "axis", name="uq_sqc_dim_axis_relations_position_axis"),
        UniqueConstraint(
            "position_dim_id",
            "coordinate_dim_id",
            name="uq_sqc_dim_axis_relations_position_coord",
        ),
        Index("ix_sqc_dim_axis_relations_position_dim_id", "position_dim_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    position_dim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="CASCADE"), nullable=False
    )
    axis: Mapped[DimAxis] = mapped_column(
        SAEnum(DimAxis, name="sqc_dim_axis", create_type=False), nullable=False
    )
    coordinate_dim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="RESTRICT"), nullable=False
    )
    related_size_dim_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    position_dim: Mapped["Dim"] = relationship(
        "Dim", foreign_keys=[position_dim_id], back_populates="axis_relations"
    )
    coordinate_dim: Mapped["Dim"] = relationship("Dim", foreign_keys=[coordinate_dim_id])
    related_size_dim: Mapped["Dim | None"] = relationship("Dim", foreign_keys=[related_size_dim_id])


class SqcBatch(Base):
    __tablename__ = "sqc_batches"
    __table_args__ = (
        Index("ix_sqc_batches_part_id", "part_id"),
        # Partial unique index: only currently-active (non-archived) batches must have
        # a distinct tracking_code+part_id. Archiving a batch frees its combination for
        # immediate reuse (sqc_0006_batch_code_reuse) — any number of archived
        # generations can share a code + part, only one active one at a time.
        Index(
            "uq_sqc_batches_tracking_code_part_id_active",
            "tracking_code",
            "part_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tracking_code: Mapped[str] = mapped_column(String(50), nullable=False)
    part_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_parts.id", ondelete="RESTRICT"), nullable=False
    )
    supplier_id: Mapped[str] = mapped_column(String(100), nullable=False)
    project_status: Mapped[ProjectStatus] = mapped_column(
        SAEnum(ProjectStatus, name="sqc_project_status", create_type=False), nullable=False
    )
    batch_status: Mapped[BatchStatus] = mapped_column(
        SAEnum(BatchStatus, name="sqc_batch_status", create_type=False),
        nullable=False,
        default=BatchStatus.IN_ANALYSIS,
    )
    rejection_justification: Mapped[str | None] = mapped_column(Text(), nullable=True)
    batch_size: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    inspection_level: Mapped[str] = mapped_column(String(3), nullable=False, default="II")
    aql: Mapped[float] = mapped_column(Double(), nullable=False, default=0.40)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Admin-only soft-delete/archive (generic admin data-cleanup feature). Archived
    # batches are excluded from lists/charts by default but remain in the DB.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    part: Mapped["Part"] = relationship("Part", back_populates="batches")
    inspections: Mapped[list["Inspection"]] = relationship("Inspection", back_populates="batch")


class DimHistory(Base):
    __tablename__ = "sqc_dim_history"
    __table_args__ = (
        Index("ix_sqc_dim_history_part_id", "part_id"),
        Index("ix_sqc_dim_history_dim_id", "dim_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    part_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_parts.id", ondelete="RESTRICT"), nullable=False
    )
    dim_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="SET NULL"), nullable=True
    )
    dim_code: Mapped[str] = mapped_column(String(50), nullable=False)
    field: Mapped[str] = mapped_column(String(30), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text(), nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text(), nullable=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_email: Mapped[str] = mapped_column(String(320), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Inspection(Base):
    __tablename__ = "sqc_inspections"
    __table_args__ = (
        Index("ix_sqc_inspections_batch_id", "batch_id"),
        Index("ix_sqc_inspections_dim_id", "dim_id"),
        Index("ix_sqc_inspections_batch_dim", "batch_id", "dim_id"),
        UniqueConstraint(
            "batch_id",
            "source_import_digest",
            "source_row",
            "dim_id",
            name="uq_sqc_inspections_import_row_dim",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_batches.id", ondelete="CASCADE"), nullable=False
    )
    dim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="RESTRICT"), nullable=False
    )
    part_number: Mapped[int] = mapped_column(Integer(), nullable=False)
    operator: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    instrument: Mapped[str | None] = mapped_column(String(100), nullable=True)
    fixture: Mapped[str | None] = mapped_column(String(100), nullable=True)
    work_order: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cavity: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    measured_value: Mapped[float] = mapped_column(Double(), nullable=False)
    deviation: Mapped[float] = mapped_column(Double(), nullable=False)
    point_max: Mapped[float | None] = mapped_column(Double(), nullable=True)
    point_min: Mapped[float | None] = mapped_column(Double(), nullable=True)
    source_import_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    is_ignored: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=False)
    ignored_reason: Mapped[str | None] = mapped_column(Text(), nullable=True)

    batch: Mapped["SqcBatch"] = relationship("SqcBatch", back_populates="inspections")
    dim: Mapped["Dim"] = relationship("Dim", back_populates="inspections")


class InspectionIgnoreHistory(Base):
    __tablename__ = "sqc_inspection_ignore_history"
    __table_args__ = (
        Index("ix_sqc_inspection_ignore_history_inspection_id", "inspection_id"),
        Index("ix_sqc_inspection_ignore_history_batch_id", "batch_id"),
        Index("ix_sqc_inspection_ignore_history_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inspection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_inspections.id", ondelete="CASCADE"), nullable=False
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_batches.id", ondelete="CASCADE"), nullable=False
    )
    dim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sqc_dims.id", ondelete="RESTRICT"), nullable=False
    )
    part_number: Mapped[int] = mapped_column(Integer(), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text(), nullable=True)
    actor_email: Mapped[str] = mapped_column(String(320), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    inspection: Mapped["Inspection"] = relationship("Inspection")
