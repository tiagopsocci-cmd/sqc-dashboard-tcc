"""Standalone SQC baseline containing the final eight-table schema.

Revision ID: 0001_sqc_baseline
Revises: None
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_sqc_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

project_status = postgresql.ENUM("EVB", "PVB", "IE", name="sqc_project_status")
batch_status = postgresql.ENUM("APPROVED", "IN_ANALYSIS", "REJECTED", name="sqc_batch_status")
dim_type = postgresql.ENUM(
    "DISTANCE",
    "DIAMETER",
    "SLAB",
    "ANGLE",
    "POSITION",
    "FLATNESS",
    "CYLINDRICITY",
    "ROUNDNESS",
    "STRAIGHTNESS",
    "PARALLELISM",
    "PERPENDICULARITY",
    "ANGULARITY",
    "CONCENTRICITY",
    "SYMMETRY",
    "PROFILE_SURFACE",
    "PROFILE_LINE",
    "RUNOUT_CIRCULAR",
    "RUNOUT_TOTAL",
    name="sqc_dim_type",
)
dim_sub_type = postgresql.ENUM("HOLE", "SHAFT", "SLOT", "WIDTH", "NONE", name="sqc_dim_sub_type")
material_modifier = postgresql.ENUM("M", "L", name="sqc_material_modifier")
zone_geometry = postgresql.ENUM("CIRCULAR", "RECTANGLE", "LINE", name="sqc_zone_geometry")
dim_axis = postgresql.ENUM("X", "Y", "Z", name="sqc_dim_axis")


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in (
        project_status,
        batch_status,
        dim_type,
        dim_sub_type,
        material_modifier,
        zone_geometry,
        dim_axis,
    ):
        enum_type.create(bind, checkfirst=True)

    op.create_table(
        "sqc_instruments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("uncertainty", sa.Double(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("code", name="uq_sqc_instruments_code"),
    )

    op.create_table(
        "sqc_parts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("part_code", sa.String(50), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("material", sa.String(100), nullable=True),
        sa.Column("process", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("part_code", name="uq_sqc_parts_part_code"),
    )

    op.create_table(
        "sqc_dims",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "part_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_parts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("drawing_revision", sa.String(20), nullable=True),
        sa.Column("dim_code", sa.String(50), nullable=False),
        sa.Column("dim_name", sa.String(255), nullable=True),
        sa.Column("type", postgresql.ENUM(name="sqc_dim_type", create_type=False), nullable=False),
        sa.Column(
            "sub_type",
            postgresql.ENUM(name="sqc_dim_sub_type", create_type=False),
            nullable=True,
        ),
        sa.Column("nominal", sa.Double(), nullable=False),
        sa.Column("tol_plus", sa.Double(), nullable=False),
        sa.Column("tol_minus", sa.Double(), nullable=True),
        sa.Column(
            "material_modifier",
            postgresql.ENUM(name="sqc_material_modifier", create_type=False),
            nullable=True,
        ),
        sa.Column(
            "dim_rel_1_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "dim_rel_2_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "parent_dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "zone_geometry",
            postgresql.ENUM(name="sqc_zone_geometry", create_type=False),
            nullable=True,
        ),
        sa.UniqueConstraint("part_id", "dim_code", name="uq_sqc_dims_part_dim_code"),
    )
    op.create_index("ix_sqc_dims_part_id", "sqc_dims", ["part_id"])
    op.create_index("ix_sqc_dims_parent_dim_id", "sqc_dims", ["parent_dim_id"])

    op.create_table(
        "sqc_dim_axis_relations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "position_dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("axis", postgresql.ENUM(name="sqc_dim_axis", create_type=False), nullable=False),
        sa.Column(
            "coordinate_dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "related_size_dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "position_dim_id", "axis", name="uq_sqc_dim_axis_relations_position_axis"
        ),
        sa.UniqueConstraint(
            "position_dim_id",
            "coordinate_dim_id",
            name="uq_sqc_dim_axis_relations_position_coord",
        ),
    )
    op.create_index(
        "ix_sqc_dim_axis_relations_position_dim_id",
        "sqc_dim_axis_relations",
        ["position_dim_id"],
    )

    op.create_table(
        "sqc_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tracking_code", sa.String(50), nullable=False),
        sa.Column(
            "part_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_parts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("supplier_id", sa.String(100), nullable=False),
        sa.Column(
            "project_status",
            postgresql.ENUM(name="sqc_project_status", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "batch_status",
            postgresql.ENUM(name="sqc_batch_status", create_type=False),
            nullable=False,
            server_default="IN_ANALYSIS",
        ),
        sa.Column("rejection_justification", sa.Text(), nullable=True),
        sa.Column("batch_size", sa.Integer(), nullable=True),
        sa.Column("inspection_level", sa.String(3), nullable=False, server_default="II"),
        sa.Column("aql", sa.Double(), nullable=False, server_default="0.40"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sqc_batches_part_id", "sqc_batches", ["part_id"])
    op.create_index("ix_sqc_batches_deleted_at", "sqc_batches", ["deleted_at"])
    op.create_index(
        "uq_sqc_batches_tracking_code_part_id_active",
        "sqc_batches",
        ["tracking_code", "part_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "sqc_dim_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "part_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_parts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("dim_code", sa.String(50), nullable=False),
        sa.Column("field", sa.String(30), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("actor_email", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sqc_dim_history_part_id", "sqc_dim_history", ["part_id"])
    op.create_index("ix_sqc_dim_history_dim_id", "sqc_dim_history", ["dim_id"])

    op.create_table(
        "sqc_inspections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("part_number", sa.Integer(), nullable=False),
        sa.Column("operator", sa.String(100), nullable=True),
        sa.Column("date_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("instrument", sa.String(100), nullable=True),
        sa.Column("fixture", sa.String(100), nullable=True),
        sa.Column("work_order", sa.String(100), nullable=True),
        sa.Column("cavity", sa.Integer(), nullable=True),
        sa.Column("measured_value", sa.Double(), nullable=False),
        sa.Column("deviation", sa.Double(), nullable=False),
        sa.Column("point_max", sa.Double(), nullable=True),
        sa.Column("point_min", sa.Double(), nullable=True),
        sa.Column("is_ignored", sa.Boolean(), nullable=False),
        sa.Column("ignored_reason", sa.Text(), nullable=True),
    )
    op.create_index("ix_sqc_inspections_batch_id", "sqc_inspections", ["batch_id"])
    op.create_index("ix_sqc_inspections_dim_id", "sqc_inspections", ["dim_id"])
    op.create_index("ix_sqc_inspections_batch_dim", "sqc_inspections", ["batch_id", "dim_id"])

    op.create_table(
        "sqc_inspection_ignore_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "inspection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_inspections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dim_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sqc_dims.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("part_number", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_email", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_sqc_inspection_ignore_history_inspection_id",
        "sqc_inspection_ignore_history",
        ["inspection_id"],
    )
    op.create_index(
        "ix_sqc_inspection_ignore_history_batch_id",
        "sqc_inspection_ignore_history",
        ["batch_id"],
    )
    op.create_index(
        "ix_sqc_inspection_ignore_history_created_at",
        "sqc_inspection_ignore_history",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_table("sqc_inspection_ignore_history")
    op.drop_table("sqc_inspections")
    op.drop_table("sqc_dim_history")
    op.drop_table("sqc_batches")
    op.drop_table("sqc_dim_axis_relations")
    op.drop_table("sqc_dims")
    op.drop_table("sqc_parts")
    op.drop_table("sqc_instruments")

    bind = op.get_bind()
    for enum_type in (
        dim_axis,
        zone_geometry,
        material_modifier,
        dim_sub_type,
        dim_type,
        batch_status,
        project_status,
    ):
        enum_type.drop(bind, checkfirst=True)
