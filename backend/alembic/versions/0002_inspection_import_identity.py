"""Add per-file row identity for idempotent measurement imports.

Revision ID: 0002_inspection_import_identity
Revises: 0001_sqc_baseline
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_inspection_import_identity"
down_revision: str | None = "0001_sqc_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sqc_inspections",
        sa.Column("source_import_digest", sa.String(64), nullable=True),
    )
    op.add_column(
        "sqc_inspections",
        sa.Column("source_row", sa.Integer(), nullable=True),
    )
    op.create_unique_constraint(
        "uq_sqc_inspections_import_row_dim",
        "sqc_inspections",
        ["batch_id", "source_import_digest", "source_row", "dim_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_sqc_inspections_import_row_dim",
        "sqc_inspections",
        type_="unique",
    )
    op.drop_column("sqc_inspections", "source_row")
    op.drop_column("sqc_inspections", "source_import_digest")
