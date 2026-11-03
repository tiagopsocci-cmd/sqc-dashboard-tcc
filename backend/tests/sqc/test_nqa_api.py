from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from .factories import make_batch, make_dim, make_inspection, make_part

pytestmark = pytest.mark.postgres


async def test_nqa_counts_distinct_parts_and_any_nonconforming_reading(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part)
    batch = await make_batch(db_session, part)
    await make_inspection(db_session, batch, dim, part_number=1, measured_value=10.1)
    await make_inspection(db_session, batch, dim, part_number=1, measured_value=10.8)
    await make_inspection(db_session, batch, dim, part_number=2, measured_value=9.9)
    await make_inspection(db_session, batch, dim, part_number=2, measured_value=10.2)

    response = await api_client.get(f"/api/sqc/batches/{batch.id}/dims/{dim.id}/nqa")

    assert response.status_code == 200
    payload = response.json()
    assert payload["inspected"] == 2
    assert payload["non_conforming"] == 1


async def test_nqa_excludes_fully_ignored_part_and_respects_cavity(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part)
    batch = await make_batch(db_session, part)
    await make_inspection(
        db_session,
        batch,
        dim,
        part_number=1,
        measured_value=10.8,
        cavity=1,
        ignored=True,
    )
    await make_inspection(db_session, batch, dim, part_number=2, measured_value=10.8, cavity=1)
    await make_inspection(db_session, batch, dim, part_number=2, measured_value=10.1, cavity=2)

    cavity_one = await api_client.get(
        f"/api/sqc/batches/{batch.id}/dims/{dim.id}/nqa",
        params={"cavity": 1},
    )
    cavity_two = await api_client.get(
        f"/api/sqc/batches/{batch.id}/dims/{dim.id}/nqa",
        params={"cavity": 2},
    )
    global_view = await api_client.get(f"/api/sqc/batches/{batch.id}/dims/{dim.id}/nqa")

    assert cavity_one.status_code == cavity_two.status_code == global_view.status_code == 200
    assert cavity_one.json()["inspected"] == 1
    assert cavity_one.json()["non_conforming"] == 1
    assert cavity_two.json()["inspected"] == 1
    assert cavity_two.json()["non_conforming"] == 0
    assert global_view.json()["inspected"] == 1
    assert global_view.json()["non_conforming"] == 1


async def test_none_and_zero_tol_minus_are_equivalent_in_overview_and_heatmap(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    dim_none = await make_dim(db_session, part, code="UNI-NONE", tol_minus=None)
    dim_zero = await make_dim(db_session, part, code="UNI-ZERO", tol_minus=0.0)
    batch = await make_batch(db_session, part)
    for part_number, measured_value in enumerate((9.8, 10.1, 10.6), start=1):
        await make_inspection(
            db_session,
            batch,
            dim_none,
            part_number=part_number,
            measured_value=measured_value,
        )
        await make_inspection(
            db_session,
            batch,
            dim_zero,
            part_number=part_number,
            measured_value=measured_value,
        )

    overview = await api_client.get(f"/api/sqc/batches/{batch.id}/overview")
    heatmap = await api_client.get(
        f"/api/sqc/parts/{part.id}/heatmap",
        params={"batch_ids": str(batch.id)},
    )
    assert overview.status_code == heatmap.status_code == 200

    overview_by_code = {row["dim_code"]: row for row in overview.json()["dims"]}
    none_overview = overview_by_code["UNI-NONE"]
    zero_overview = overview_by_code["UNI-ZERO"]
    assert none_overview["is_unilateral"] is zero_overview["is_unilateral"] is True
    for field in ("n", "mean_tol_pct", "std_tol_pct", "n_out", "status", "nqa_status"):
        assert zero_overview[field] == none_overview[field]

    heatmap_by_code = {row["dim_code"]: row for row in heatmap.json()["dims"]}
    none_cell = heatmap_by_code["UNI-NONE"]["cells"][0]
    zero_cell = heatmap_by_code["UNI-ZERO"]["cells"][0]
    for field in (
        "n",
        "mean_tol_pct",
        "std_tol_pct",
        "n_out",
        "n_uncertainty",
        "nqa_ac",
        "nqa_re",
        "status",
    ):
        assert zero_cell[field] == none_cell[field]


async def test_nqa_is_consistent_with_overview_and_heatmap(
    db_session: AsyncSession,
    api_client: AsyncClient,
) -> None:
    part = await make_part(db_session)
    dim = await make_dim(db_session, part)
    batch = await make_batch(db_session, part)
    await make_inspection(db_session, batch, dim, part_number=1, measured_value=10.8)
    await make_inspection(db_session, batch, dim, part_number=1, measured_value=10.9)
    await make_inspection(db_session, batch, dim, part_number=2, measured_value=10.1)

    nqa = await api_client.get(f"/api/sqc/batches/{batch.id}/dims/{dim.id}/nqa")
    overview = await api_client.get(f"/api/sqc/batches/{batch.id}/overview")
    heatmap = await api_client.get(
        f"/api/sqc/parts/{part.id}/heatmap",
        params={"batch_ids": str(batch.id)},
    )

    assert nqa.status_code == overview.status_code == heatmap.status_code == 200
    nqa_payload = nqa.json()
    overview_row = next(row for row in overview.json()["dims"] if row["dim_id"] == str(dim.id))
    heatmap_row = next(row for row in heatmap.json()["dims"] if row["dim_id"] == str(dim.id))
    heatmap_cell = heatmap_row["cells"][0]

    assert nqa_payload["inspected"] == 2
    assert nqa_payload["non_conforming"] == 1
    assert overview_row["n"] == 3
    assert overview_row["n_out"] == nqa_payload["non_conforming"]
    assert heatmap_cell["n"] == 3
    assert heatmap_cell["n_out"] == nqa_payload["non_conforming"]
    assert overview_row["nqa_ac"] == nqa_payload["acceptance_number"]
    assert overview_row["nqa_re"] == nqa_payload["rejection_number"]
    assert heatmap_cell["nqa_ac"] == nqa_payload["acceptance_number"]
    assert heatmap_cell["nqa_re"] == nqa_payload["rejection_number"]
