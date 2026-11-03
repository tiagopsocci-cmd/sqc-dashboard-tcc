"""Independent golden checks for the SQC formulas.

Expected values are derived directly from the documented formulas and constants;
the production implementation is called only for the actual result.
"""

from __future__ import annotations

import math

import pytest

from app.sqc import nqa
from app.sqc.statistics import (
    calculate_capability,
    calculate_capability_with_bonus,
    calculate_control_chart,
    calculate_grouped_capability,
    effective_tolerances,
    tolerance_used_pct,
)


def _sample_std(values: list[float]) -> float:
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (len(values) - 1))


def test_bilateral_capability_matches_independent_formula() -> None:
    values = [9.8, 9.9, 10.0, 10.1, 10.2]
    sigma = _sample_std(values)
    expected_cp = 1.0 / (6.0 * sigma)
    expected_cpk = min((10.5 - 10.0) / (3.0 * sigma), (10.0 - 9.5) / (3.0 * sigma))

    result = calculate_capability(values, tol_plus=0.5, tol_minus=0.5, nominal=10.0)

    assert result.mean == pytest.approx(10.0)
    assert result.std_sample == pytest.approx(sigma)
    assert result.cp == pytest.approx(expected_cp)
    assert result.cpk == pytest.approx(expected_cpk)
    assert result.pp == pytest.approx(expected_cp)
    assert result.ppk == pytest.approx(expected_cpk)
    assert result.insufficient_sample is False


@pytest.mark.parametrize("tol_minus", [None, 0.0])
def test_unilateral_capability_has_only_upper_index(tol_minus: float | None) -> None:
    values = [0.08, 0.10, 0.12, 0.09, 0.11]
    mean = sum(values) / len(values)
    sigma = _sample_std(values)
    expected_cpu = (0.30 - mean) / (3.0 * sigma)

    result = calculate_capability(values, tol_plus=0.30, tol_minus=tol_minus, nominal=0.0)

    assert result.is_unilateral is True
    assert result.lsl is None
    assert result.cp is None
    assert result.cpl is None
    assert result.cpu == pytest.approx(expected_cpu)
    assert result.cpk == pytest.approx(expected_cpu)


def test_grouped_capability_uses_pooled_within_batch_sigma() -> None:
    batches = {"A": [9.8, 10.0, 10.2], "B": [10.1, 10.3, 10.5]}
    all_values = batches["A"] + batches["B"]
    overall_mean = sum(all_values) / len(all_values)
    pooled_numerator = sum(
        (len(values) - 1) * _sample_std(values) ** 2 for values in batches.values()
    )
    pooled_denominator = sum(len(values) - 1 for values in batches.values())
    pooled_sigma = math.sqrt(pooled_numerator / pooled_denominator)
    global_sigma = _sample_std(all_values)
    expected_cp = 2.0 / (6.0 * pooled_sigma)
    expected_cpk = min(
        (11.0 - overall_mean) / (3.0 * pooled_sigma),
        (overall_mean - 9.0) / (3.0 * pooled_sigma),
    )
    expected_pp = 2.0 / (6.0 * global_sigma)

    result = calculate_grouped_capability(batches, tol_plus=1.0, tol_minus=1.0, nominal=10.0)

    assert result.std_short == pytest.approx(pooled_sigma)
    assert result.std_long == pytest.approx(global_sigma)
    assert result.cp == pytest.approx(expected_cp)
    assert result.cpk == pytest.approx(expected_cpk)
    assert result.pp == pytest.approx(expected_pp)


def test_xbar_r_chart_and_unilateral_lcl_floor() -> None:
    subgroups = {1: [0.0, 0.2], 2: [0.1, 0.3]}
    # n=2: A2=1.880, D3=0, D4=3.267. xbar_bar=0.15 and Rbar=0.2.
    expected_ucl_xbar = 0.15 + 1.880 * 0.2
    expected_ucl_r = 3.267 * 0.2

    bilateral = calculate_control_chart(subgroups, is_unilateral=False)
    unilateral = calculate_control_chart(subgroups, is_unilateral=True)

    assert bilateral.subgroup_size == 2
    assert bilateral.xbar.center_line == pytest.approx(0.15)
    assert bilateral.xbar.ucl == pytest.approx(expected_ucl_xbar)
    assert bilateral.xbar.lcl == pytest.approx(0.15 - 1.880 * 0.2)
    assert bilateral.r_chart.ucl == pytest.approx(expected_ucl_r)
    assert unilateral.xbar.lcl == 0.0


def test_mmc_and_lmc_bonus_ratios_match_manual_normalization() -> None:
    # Production receives (measured geometric result, per-piece effective USL).
    pairs = [(0.30, 0.40), (0.35, 0.50), (0.40, 0.60), (0.45, 0.70), (0.50, 0.80)]
    ratios = [measured / effective for measured, effective in pairs]
    mean = sum(ratios) / len(ratios)
    sigma = _sample_std(ratios)
    expected_cpu = (1.0 - mean) / (3.0 * sigma)

    result = calculate_capability_with_bonus(pairs)

    assert result.mean == pytest.approx(mean)
    assert result.std_sample == pytest.approx(sigma)
    assert result.cpu == pytest.approx(expected_cpu)
    assert result.cpk == pytest.approx(expected_cpu)


@pytest.mark.parametrize(
    ("tol_minus", "bonus", "deviation", "expected"),
    [
        (0.5, 0.2, -0.35, 50.0),
        (0.5, 0.0, -0.25, 50.0),
        (0.1, 0.2, -0.15, 50.0),
        (None, 0.2, 0.35, 50.0),
        (0.0, 0.2, -0.35, 50.0),
    ],
)
def test_effective_tolerance_expands_correct_side(
    tol_minus: float | None,
    bonus: float,
    deviation: float,
    expected: float,
) -> None:
    effective = effective_tolerances(0.5, tol_minus, bonus)

    assert tolerance_used_pct(deviation, *effective) == pytest.approx(expected)


def test_increasing_bonus_never_increases_tolerance_consumption() -> None:
    without_bonus = tolerance_used_pct(-0.3, *effective_tolerances(0.5, 0.5, 0.0))
    with_bonus = tolerance_used_pct(-0.3, *effective_tolerances(0.5, 0.5, 0.2))

    assert with_bonus < without_bonus


def test_nqa_sufficient_insufficient_and_rejected_golden_cases() -> None:
    # Lot 100, level II -> letter F; AQL 2.5 is a direct F plan: n=20, Ac=1, Re=2.
    accepted = nqa.calculate_nqa(100, "II", 2.5, inspected=20, non_conforming=1)
    insufficient = nqa.calculate_nqa(100, "II", 2.5, inspected=8, non_conforming=0)
    rejected = nqa.calculate_nqa(100, "II", 2.5, inspected=20, non_conforming=2)

    for result in (accepted, insufficient, rejected):
        assert result.letter == "F"
        assert result.required_sample_size == 20
        assert result.acceptance_number == 1
        assert result.rejection_number == 2
    assert accepted.status == "ACEITO"
    assert insufficient.status == "AMOSTRA_INSUFICIENTE"
    assert rejected.status == "REJEITADO"
