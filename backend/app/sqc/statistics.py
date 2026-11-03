"""Cálculos estatísticos SPC/SQC — sem acesso ao banco de dados.

Todas as funções são puras: recebem dados brutos e retornam resultados calculados.
Referência normativa: AIAG SPC 4ª edição.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.stats import gaussian_kde
from scipy.stats import norm as scipy_norm
from scipy.stats import shapiro as scipy_shapiro

# Constantes AIAG SPC Tabela A-1 (indexadas por n=2..10)
_SPC_CONSTANTS: dict[int, dict[str, float]] = {
    2: {"d2": 1.128, "D3": 0.000, "D4": 3.267, "A2": 1.880},
    3: {"d2": 1.693, "D3": 0.000, "D4": 2.574, "A2": 1.023},
    4: {"d2": 2.059, "D3": 0.000, "D4": 2.282, "A2": 0.729},
    5: {"d2": 2.326, "D3": 0.000, "D4": 2.114, "A2": 0.577},
    6: {"d2": 2.534, "D3": 0.000, "D4": 2.004, "A2": 0.483},
    7: {"d2": 2.704, "D3": 0.076, "D4": 1.924, "A2": 0.419},
    8: {"d2": 2.847, "D3": 0.136, "D4": 1.864, "A2": 0.373},
    9: {"d2": 2.970, "D3": 0.184, "D4": 1.816, "A2": 0.337},
    10: {"d2": 3.078, "D3": 0.223, "D4": 1.777, "A2": 0.308},
}

INSUFFICIENT_SAMPLE_THRESHOLD = 5


@dataclass
class CapabilityResult:
    n: int
    is_unilateral: bool
    usl: float
    lsl: float | None
    nominal: float
    mean: float | None = None
    std_sample: float | None = None
    std_long: float | None = None
    std_short: float | None = None
    max: float | None = None
    min: float | None = None
    range: float | None = None
    cp: float | None = None
    cpk: float | None = None
    pp: float | None = None
    ppk: float | None = None
    cpu: float | None = None
    cpl: float | None = None
    insufficient_sample: bool = False
    degenerate: bool = False
    dppm: float | None = None
    k_index: float | None = None
    cpm: float | None = None


def calculate_capability(
    values: list[float],
    tol_plus: float,
    tol_minus: float | None,
    nominal: float,
) -> CapabilityResult:
    """Calcula índices de capabilidade Cp/Cpk/Pp/Ppk para um conjunto de medições."""
    is_unilateral = tol_minus is None or tol_minus == 0.0
    usl = nominal + tol_plus
    lsl = nominal - abs(tol_minus) if tol_minus not in (None, 0.0) else None

    n = len(values)
    result = CapabilityResult(
        n=n,
        is_unilateral=is_unilateral,
        usl=usl,
        lsl=lsl,
        nominal=nominal,
        insufficient_sample=n < INSUFFICIENT_SAMPLE_THRESHOLD,
    )

    if n == 0:
        return result

    arr = np.array(values, dtype=float)
    result.mean = float(np.mean(arr))
    result.max = float(np.max(arr))
    result.min = float(np.min(arr))
    result.range = float(result.max - result.min)

    if n < 2:
        return result

    sigma_long = float(np.std(arr, ddof=1))

    if sigma_long == 0.0:
        result.degenerate = True
        result.std_sample = 0.0
        return result

    # sigma_short via R_bar/d2 — subgrupo = 1 medicao por peca -> usar sigma_long como fallback
    # (sem subgrupos explícitos nesta função; usar a versão com subgrupos para Cp rigoroso)
    result.std_sample = sigma_long
    result.std_long = sigma_long
    result.std_short = sigma_long

    if is_unilateral:
        result.cpu = (usl - result.mean) / (3.0 * result.std_sample)
        result.cpk = result.cpu
        result.ppk = result.cpu
    else:
        assert lsl is not None
        tolerance = usl - lsl
        result.cp = tolerance / (6.0 * result.std_sample)
        result.cpu = (usl - result.mean) / (3.0 * result.std_sample)
        result.cpl = (result.mean - lsl) / (3.0 * result.std_sample)
        result.cpk = min(result.cpu, result.cpl)
        result.pp = tolerance / (6.0 * sigma_long)
        result.ppk = min(
            (usl - result.mean) / (3.0 * sigma_long),
            (result.mean - lsl) / (3.0 * sigma_long),
        )

    # ── DPPM, k, Cpm ──────────────────────────────────────────────────────────
    mean = result.mean
    std = result.std_sample
    if mean is not None and std is not None and std > 0:
        # DPPM: estimativa baseada em sigma_overall (desempenho real do lote)
        if is_unilateral:
            result.dppm = float(scipy_norm.sf((usl - mean) / std) * 1e6)
        else:
            assert lsl is not None
            result.dppm = float(
                (scipy_norm.cdf((lsl - mean) / std) + scipy_norm.sf((usl - mean) / std)) * 1e6
            )

        # k: índice de centralização (0 = centrado no nominal, 1 = média no limite)
        if is_unilateral:
            result.k_index = float(abs(mean - nominal) / tol_plus) if tol_plus != 0 else None
        else:
            assert lsl is not None
            half_tol = (usl - lsl) / 2.0
            result.k_index = float(abs(mean - nominal) / half_tol) if half_tol > 0 else None

        # Cpm: índice de Taguchi — penaliza desvio do nominal independente dos limites
        sigma_from_target = math.sqrt(std**2 + (mean - nominal) ** 2)
        if is_unilateral:
            result.cpm = float((usl - nominal) / (3.0 * sigma_from_target))
        else:
            assert lsl is not None
            result.cpm = float((usl - lsl) / (6.0 * sigma_from_target))

    return result


def calculate_capability_with_subgroups(
    subgroups: dict[int, list[float]],
    tol_plus: float,
    tol_minus: float | None,
    nominal: float,
) -> CapabilityResult:
    """Calcula capabilidade usando R_bar/d2 para sigma_short quando subgrupos estao disponiveis."""
    all_values = [v for vals in subgroups.values() for v in vals]
    result = calculate_capability(all_values, tol_plus, tol_minus, nominal)

    if result.degenerate or result.n < 2:
        return result

    # Calcular R_bar e sigma_short via metodo de amplitude media (AIAG SPC)
    valid_subgroups = {k: v for k, v in subgroups.items() if len(v) >= 2}
    if not valid_subgroups:
        return result

    subgroup_sizes = [len(v) for v in valid_subgroups.values()]
    # Usar a moda do tamanho de subgrupo para selecionar d2
    from statistics import mode as stat_mode

    try:
        n_sub = stat_mode(subgroup_sizes)
    except Exception:
        n_sub = subgroup_sizes[0]

    n_sub = max(2, min(10, n_sub))
    d2 = _SPC_CONSTANTS[n_sub]["d2"]

    ranges = [max(v) - min(v) for v in valid_subgroups.values()]
    r_bar = float(np.mean(ranges))
    sigma_short = r_bar / d2 if d2 > 0 else result.std_sample

    if sigma_short is None or sigma_short == 0.0:
        return result

    result.std_sample = sigma_short
    result.std_short = sigma_short
    mean = result.mean
    assert mean is not None

    usl = result.usl
    lsl = result.lsl

    if result.is_unilateral:
        result.cpu = (usl - mean) / (3.0 * sigma_short)
        result.cpk = result.cpu
    else:
        assert lsl is not None
        tolerance = usl - lsl
        result.cp = tolerance / (6.0 * sigma_short)
        result.cpu = (usl - mean) / (3.0 * sigma_short)
        result.cpl = (mean - lsl) / (3.0 * sigma_short)
        result.cpk = min(result.cpu, result.cpl)

    return result


def ratios_from_bonus_pairs(pairs: list[tuple[float, float]]) -> list[float]:
    """Converte pares (measured_value, effective_usl) em ratios normalizados.

    Peças com effective_usl <= 0 são excluídas — fatorado de `calculate_capability_with_bonus`
    para reuso por `calculate_grouped_capability` (research.md R3: o bônus é resolvido por
    lote/peça antes de qualquer pooling, e o agrupamento consome os ratios já normalizados).
    """
    return [v / u for v, u in pairs if u > 0]


def calculate_capability_with_bonus(
    pairs: list[tuple[float, float]],
) -> CapabilityResult:
    """Capabilidade via ratio normalizado para dims com modificador MMC/LMC.

    Para cada par (measured_value, effective_usl), calcula ratio = value / effective_usl.
    Analisa os ratios com USL_normalizado = 1.0, nominal = 0.0 (unilateral).
    Peças com effective_usl <= 0 são excluídas do fit estatístico.
    """
    ratios = ratios_from_bonus_pairs(pairs)
    return calculate_capability(ratios, tol_plus=1.0, tol_minus=None, nominal=0.0)


def calculate_grouped_capability(
    batches: Mapping[Any, list[float]],
    tol_plus: float,
    tol_minus: float | None,
    nominal: float,
) -> CapabilityResult:
    """Calcula capacidade agrupada entre dois ou mais lotes (spec 252, FR-001/FR-002).

    Cp/Cpk usam **Pooled Standard Deviation** — cada lote é tratado como um subgrupo,
    ponderado pelos seus próprios graus de liberdade (research.md R1):

        sp² = Σ_i [(n_i - 1) · s_i²] / Σ_i (n_i - 1)

    Pp/Ppk usam o desvio padrão amostral (ddof=1) sobre a população combinada de todos os
    lotes — o mesmo `sigma_long` já calculado por `calculate_capability` (research.md R2),
    apenas alimentado com o array multi-lote em vez de um único lote.

    Bônus de tolerância (MMC/LMC) não é tratado aqui: o chamador resolve o bônus por
    lote/peça (via `ratios_from_bonus_pairs`) e passa os ratios já normalizados em `batches`,
    com `tol_plus=1.0`, `tol_minus=None`, `nominal=0.0` — mantendo esta função pura sobre
    `list[float]`, sem acesso a `Inspection`/bônus (research.md R3/R4).

    Lotes com menos de 2 medições válidas são excluídos da soma de pooled-SD (não tratados
    como variância zero). Se nenhum lote tiver 2+ medições válidas, o cálculo de capacidade
    não é confiável — o resultado volta a `insufficient_sample=True` com todos os índices
    nulos, mesmo que o total combinado atenda a `INSUFFICIENT_SAMPLE_THRESHOLD`
    (research.md R1; contracts/api-sqc-252.md §1 passo 7).
    """
    all_values = [v for vals in batches.values() for v in vals]
    result = calculate_capability(all_values, tol_plus, tol_minus, nominal)

    if result.insufficient_sample:
        result.cp = None
        result.cpk = None
        result.cpu = None
        result.cpl = None
        result.pp = None
        result.ppk = None
        return result

    if result.degenerate or result.n < 2:
        return result

    valid_batches = {k: v for k, v in batches.items() if len(v) >= 2}
    if not valid_batches:
        result.insufficient_sample = True
        result.cp = None
        result.cpk = None
        result.cpu = None
        result.cpl = None
        result.pp = None
        result.ppk = None
        return result

    numerator = sum(
        (len(v) - 1) * float(np.var(np.array(v, dtype=float), ddof=1))
        for v in valid_batches.values()
    )
    denominator = sum(len(v) - 1 for v in valid_batches.values())
    sp = math.sqrt(numerator / denominator)

    if sp == 0.0:
        result.degenerate = True
        result.std_short = 0.0
        result.cp = None
        result.cpk = None
        result.cpu = None
        result.cpl = None
        return result

    result.std_short = sp
    mean = result.mean
    assert mean is not None
    usl = result.usl
    lsl = result.lsl

    if result.is_unilateral:
        result.cpu = (usl - mean) / (3.0 * sp)
        result.cpk = result.cpu
    else:
        assert lsl is not None
        tolerance = usl - lsl
        result.cp = tolerance / (6.0 * sp)
        result.cpu = (usl - mean) / (3.0 * sp)
        result.cpl = (mean - lsl) / (3.0 * sp)
        result.cpk = min(result.cpu, result.cpl)

    return result


MODIFIED_ZSCORE_THRESHOLD = 3.5  # Iglewicz & Hoaglin (1993) convention


@dataclass
class OutlierSuggestion:
    index: int
    modified_zscore: float
    is_outlier: bool


def detect_outlier_suggestions(
    values: list[float],
    threshold: float = MODIFIED_ZSCORE_THRESHOLD,
) -> list[OutlierSuggestion]:
    """Sinalização de outlier via z-score modificado (mediana/MAD), robusto a outliers
    múltiplos (NIST/Iglewicz & Hoaglin) — nunca remove ou reordena os dados, apenas
    sinaliza; uma sugestão por posição de `values`. n < INSUFFICIENT_SAMPLE_THRESHOLD ou
    MAD == 0 (sem variabilidade suficiente): todas is_outlier=False.
    """
    n = len(values)
    if n < INSUFFICIENT_SAMPLE_THRESHOLD:
        return [OutlierSuggestion(i, 0.0, False) for i in range(n)]

    arr = np.array(values, dtype=float)
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median)))
    if mad == 0.0:
        return [OutlierSuggestion(i, 0.0, False) for i in range(n)]

    # 0.6745 = Phi^-1(0.75): torna o MAD comparável ao desvio padrão sob normalidade
    scores = 0.6745 * (arr - median) / mad
    return [OutlierSuggestion(i, float(z), abs(z) > threshold) for i, z in enumerate(scores)]


@dataclass
class ToleranceSuggestion:
    usl: float
    lsl: float | None
    tol_plus: float
    tol_minus: float | None
    achievable: bool


def solve_tolerance_for_target_cpk(
    target_cpk: float,
    mean: float,
    sigma: float,
    nominal: float,
    is_unilateral: bool,
) -> ToleranceSuggestion:
    """Resolve uma tolerância simétrica (em torno de `nominal`) que faz o lado mais
    apertado de Cpk (min(Cpu,Cpl)) atingir exatamente `target_cpk`, dado `mean`/`sigma`
    já medidos (convenção pooled/std_short usada por Cp/Cpk, não Pp/Ppk). Quando a média
    está deslocada do nominal, o lado oposto fica com folga extra (Cpk real >= target,
    nunca menos) — resultado padrão para "tolerância simétrica, margem assimétrica".
    `achievable=False` quando sigma<=0 (processo degenerado) ou target_cpk<=0 (entrada
    inválida).
    """
    if sigma <= 0 or target_cpk <= 0:
        return ToleranceSuggestion(
            usl=mean, lsl=None, tol_plus=0.0, tol_minus=None, achievable=False
        )

    if is_unilateral:
        usl = mean + 3.0 * target_cpk * sigma
        return ToleranceSuggestion(
            usl=usl, lsl=None, tol_plus=usl - nominal, tol_minus=None, achievable=True
        )

    offset = mean - nominal
    half_tolerance = 3.0 * target_cpk * sigma + abs(offset)
    usl = nominal + half_tolerance
    lsl = nominal - half_tolerance
    return ToleranceSuggestion(
        usl=usl, lsl=lsl, tol_plus=half_tolerance, tol_minus=half_tolerance, achievable=True
    )


def solve_bonus_tolerance_for_target_cpk(
    target_cpk: float,
    pairs: list[tuple[float, float]],
    nominal: float,
    current_tol_plus: float,
) -> ToleranceSuggestion:
    """Resolve `tol_plus` para dims com bônus MMC/LMC via busca numérica sobre o Cpu em
    espaço de ratio (measured / (nominal + tol_plus + bonus_i)).

    O bônus é resolvido por peça (`pairs` = [(measured_value, bonus), ...]) e não escala
    linearmente com `tol_plus` — diferente do caso unilateral puro em
    `solve_tolerance_for_target_cpk`, não há forma fechada aqui, pois cada peça desloca seu
    próprio denominador por uma quantia distinta. Cpu é monótono não decrescente em
    `tol_plus` (aumentar tol_plus aumenta o USL efetivo de toda peça, nunca diminui), o que
    torna a bisseção segura. Sempre unilateral (convenção já usada por
    `calculate_capability_with_bonus`: tol_plus=1.0, tol_minus=None, nominal=0.0 em espaço
    de ratio).
    """
    if target_cpk <= 0 or not pairs:
        return ToleranceSuggestion(
            usl=nominal + current_tol_plus,
            lsl=None,
            tol_plus=current_tol_plus,
            tol_minus=None,
            achievable=False,
        )

    def cpu_at(tol_plus: float) -> float | None:
        usl_pairs = [(m, nominal + tol_plus + b) for m, b in pairs]
        return calculate_capability_with_bonus(usl_pairs).cpu

    base_cpu = cpu_at(current_tol_plus)
    if base_cpu is None:
        return ToleranceSuggestion(
            usl=nominal + current_tol_plus,
            lsl=None,
            tol_plus=current_tol_plus,
            tol_minus=None,
            achievable=False,
        )

    lo_bound = current_tol_plus
    hi_bound = current_tol_plus
    step = max(abs(current_tol_plus), 1.0)
    found_bracket = False
    for _ in range(100):
        hi_bound += step
        cpu_hi = cpu_at(hi_bound)
        if cpu_hi is not None and cpu_hi >= target_cpk:
            found_bracket = True
            break
        step *= 2.0

    if not found_bracket:
        return ToleranceSuggestion(
            usl=nominal + hi_bound,
            lsl=None,
            tol_plus=hi_bound,
            tol_minus=None,
            achievable=False,
        )

    for _ in range(60):
        mid = (lo_bound + hi_bound) / 2.0
        cpu_mid = cpu_at(mid)
        if cpu_mid is None or cpu_mid < target_cpk:
            lo_bound = mid
        else:
            hi_bound = mid

    tol_plus = hi_bound
    return ToleranceSuggestion(
        usl=nominal + tol_plus, lsl=None, tol_plus=tol_plus, tol_minus=None, achievable=True
    )


@dataclass
class ControlChartPoint:
    part_number: int
    value: float
    out_of_control: bool


@dataclass
class ControlChartSeries:
    points: list[ControlChartPoint]
    center_line: float
    ucl: float
    lcl: float


@dataclass
class ControlChartResult:
    subgroup_size: int
    xbar: ControlChartSeries
    r_chart: ControlChartSeries
    insufficient_data: bool


def calculate_control_chart(
    subgroups: dict[int, list[float]],
    is_unilateral: bool = False,
) -> ControlChartResult:
    """Calcula Cartas X-bar e R conforme AIAG SPC 4ª edição."""
    valid = {k: v for k, v in subgroups.items() if len(v) >= 2}

    if len(valid) < 2:
        # Dados insuficientes — retornar estrutura vazia
        empty_points = [
            ControlChartPoint(pn, float(np.mean(v)), False) for pn, v in sorted(subgroups.items())
        ]
        dummy = ControlChartSeries(points=empty_points, center_line=0, ucl=0, lcl=0)
        return ControlChartResult(
            subgroup_size=0, xbar=dummy, r_chart=dummy, insufficient_data=True
        )

    from statistics import mode as stat_mode

    sizes = [len(v) for v in valid.values()]
    try:
        n_sub = stat_mode(sizes)
    except Exception:
        n_sub = sizes[0]
    n_sub = max(2, min(10, n_sub))
    consts = _SPC_CONSTANTS[n_sub]

    sorted_keys = sorted(valid.keys())
    xbar_values = [float(np.mean(valid[k])) for k in sorted_keys]
    r_values = [float(max(valid[k]) - min(valid[k])) for k in sorted_keys]

    xbar_bar = float(np.mean(xbar_values))
    r_bar = float(np.mean(r_values))

    ucl_xbar = xbar_bar + consts["A2"] * r_bar
    lcl_xbar = xbar_bar - consts["A2"] * r_bar
    if is_unilateral and lcl_xbar < 0:
        lcl_xbar = 0.0
    ucl_r = consts["D4"] * r_bar
    lcl_r = consts["D3"] * r_bar

    xbar_points = [
        ControlChartPoint(pn, v, v > ucl_xbar or v < lcl_xbar)
        for pn, v in zip(sorted_keys, xbar_values, strict=False)
    ]
    r_points = [
        ControlChartPoint(pn, v, v > ucl_r or (lcl_r > 0 and v < lcl_r))
        for pn, v in zip(sorted_keys, r_values, strict=False)
    ]

    return ControlChartResult(
        subgroup_size=n_sub,
        xbar=ControlChartSeries(xbar_points, xbar_bar, ucl_xbar, lcl_xbar),
        r_chart=ControlChartSeries(r_points, r_bar, ucl_r, lcl_r),
        insufficient_data=False,
    )


@dataclass
class HistogramData:
    bin_edges: list[float]
    counts: list[int]


@dataclass
class KDEData:
    x: list[float]
    y: list[float]


@dataclass
class DistributionResult:
    histogram: HistogramData
    kde: KDEData
    usl: float
    lsl: float | None
    nominal: float
    n: int = 0
    distribution_type: str = "normal"
    weibull_k: float | None = None
    weibull_scale: float | None = None
    normality_stat: float | None = None
    normality_p: float | None = None
    is_normal: bool | None = None


def calculate_distribution_weibull(
    values: list[float],
    usl: float,
    lsl: float | None,
    nominal: float,
) -> DistributionResult:
    """Distribuição Weibull para cotas geométricas (sempre positivas, valor alvo = 0)."""
    arr = np.array(values, dtype=float)
    # Garantir valores > 0 (valores de cotas geométricas são magnitudes)
    arr = np.abs(arr)
    arr = arr[arr > 0]
    if len(arr) < 3:
        return calculate_distribution(values, usl, lsl, nominal)

    from scipy.stats import weibull_min

    try:
        k, _loc, scale = weibull_min.fit(arr, floc=0)
    except Exception:
        return calculate_distribution(values, usl, lsl, nominal)

    data_max = float(np.max(arr))
    tol_margin = usl * 0.3
    x_max = max(usl + tol_margin, data_max * 1.2)
    x_range = np.linspace(0, x_max, 200)

    pdf_y = weibull_min.pdf(x_range, k, loc=0, scale=scale)

    counts, bin_edges = np.histogram(arr, bins="auto")
    hist = HistogramData(bin_edges=bin_edges.tolist(), counts=counts.tolist())

    result = DistributionResult(
        histogram=hist,
        kde=KDEData(x=x_range.tolist(), y=pdf_y.tolist()),
        usl=usl,
        lsl=lsl,
        nominal=nominal,
        n=len(arr),
        distribution_type="weibull",
        weibull_k=float(k) if k is not None else None,
        weibull_scale=float(scale) if scale is not None else None,
    )
    return result


def calculate_distribution(
    values: list[float],
    usl: float,
    lsl: float | None,
    nominal: float,
) -> DistributionResult:
    """Calcula histograma + KDE para visualização de distribuição."""
    arr = np.array(values, dtype=float)

    tol_span = usl - (lsl or nominal)
    margin = tol_span * 0.3 if tol_span > 0 else 0
    x_min_tol = (lsl or nominal) - margin
    x_max_tol = usl + margin

    data_min = float(np.min(arr))
    data_max = float(np.max(arr))
    data_span = data_max - data_min
    data_margin = data_span * 0.2 if data_span > 0 else max(abs(data_max) * 0.2, 0.1)

    x_min = min(x_min_tol, data_min - data_margin)
    x_max = max(x_max_tol, data_max + data_margin)

    counts, bin_edges = np.histogram(arr, bins="auto")
    hist = HistogramData(bin_edges=bin_edges.tolist(), counts=counts.tolist())

    kde_x = np.linspace(x_min, x_max, 200)
    try:
        kde_fn = gaussian_kde(arr)
        kde_y = kde_fn(kde_x)
    except Exception:
        kde_y = np.zeros_like(kde_x)

    normality_stat: float | None = None
    normality_p: float | None = None
    is_normal: bool | None = None
    if len(arr) >= 3:
        w_stat, p_val = scipy_shapiro(arr)
        normality_stat = float(w_stat)
        normality_p = float(p_val)
        is_normal = p_val >= 0.05

    return DistributionResult(
        histogram=hist,
        kde=KDEData(x=kde_x.tolist(), y=kde_y.tolist()),
        usl=usl,
        lsl=lsl,
        nominal=nominal,
        n=len(arr),
        normality_stat=normality_stat,
        normality_p=normality_p,
        is_normal=is_normal,
    )


@dataclass
class IChartPoint:
    index: int
    measured_value: float
    out_of_control: bool


@dataclass
class IChartResult:
    points: list[IChartPoint]
    mean: float
    std: float
    ucl: float
    lcl: float
    usl: float | None
    lsl: float | None
    nominal: float


def calculate_i_chart(
    values: list[float],
    usl: float | None,
    lsl: float | None,
    nominal: float,
    is_unilateral: bool = False,
) -> IChartResult:
    """Gráfico de Valores Individuais (I-Chart / Run Chart) — lote único."""
    arr = np.array(values, dtype=float)
    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1)) if len(arr) >= 2 else 0.0
    ucl = mean + 3.0 * std
    lcl = mean - 3.0 * std
    if is_unilateral and lcl < 0:
        lcl = 0.0

    points = [
        IChartPoint(
            index=i + 1,
            measured_value=float(v),
            out_of_control=float(v) > ucl or float(v) < lcl,
        )
        for i, v in enumerate(values)
    ]
    return IChartResult(
        points=points,
        mean=mean,
        std=std,
        ucl=ucl,
        lcl=lcl,
        usl=usl,
        lsl=lsl,
        nominal=nominal,
    )


@dataclass
class BoxplotResult:
    q1: float
    median: float
    q3: float
    whisker_low: float
    whisker_high: float
    outliers: list[float] = field(default_factory=list)


def calculate_boxplot(values: list[float]) -> BoxplotResult:
    """Calcula estatísticas de Boxplot (Q1, mediana, Q3, bigodes, outliers)."""
    arr = np.array(values, dtype=float)
    q1 = float(np.percentile(arr, 25))
    median = float(np.percentile(arr, 50))
    q3 = float(np.percentile(arr, 75))
    iqr = q3 - q1
    whisker_low = float(max(np.min(arr), q1 - 1.5 * iqr))
    whisker_high = float(min(np.max(arr), q3 + 1.5 * iqr))
    outliers = [float(v) for v in arr if v < whisker_low or v > whisker_high]
    return BoxplotResult(q1, median, q3, whisker_low, whisker_high, outliers)


@dataclass
class ProfileSideResult:
    n: int
    mean: float
    std: float
    cp: float | None
    cpk: float | None
    cpu: float | None
    cpl: float | None
    normality_stat: float | None
    normality_p: float | None
    is_normal: bool | None
    histogram: HistogramData
    insufficient_sample: bool = False


def calculate_profile_side_stats(
    values: list[float],
    usl: float,
    lsl: float,
) -> ProfileSideResult:
    """Estatísticas de distribuição para um lado do desvio de perfil (MAX ou MIN).

    Usa os mesmos limites bilaterais (usl=posTol, lsl=negTol) para os dois lados,
    conforme padrão do time de manufatura.
    """
    arr = np.array(values, dtype=float)
    n = len(arr)

    if n == 0:
        return ProfileSideResult(
            n=0,
            mean=0.0,
            std=0.0,
            cp=None,
            cpk=None,
            cpu=None,
            cpl=None,
            normality_stat=None,
            normality_p=None,
            is_normal=None,
            histogram=HistogramData(bin_edges=[], counts=[]),
        )

    mean_val = float(np.mean(arr))
    std_val = float(np.std(arr, ddof=1)) if n >= 2 else 0.0

    # Cp/Cpk via calculate_capability com nominal=0
    # → usl = 0 + tol_plus = usl; lsl = 0 - abs(tol_minus) = lsl
    cap = calculate_capability(values, tol_plus=usl, tol_minus=-lsl, nominal=0.0)

    # Normalidade (Shapiro-Wilk, n >= 3)
    normality_stat: float | None = None
    normality_p: float | None = None
    is_normal: bool | None = None
    if n >= 3:
        w, p = scipy_shapiro(arr)
        normality_stat = float(w)
        normality_p = float(p)
        is_normal = p >= 0.05

    # Histograma
    counts, bin_edges = np.histogram(arr, bins="auto")
    hist = HistogramData(bin_edges=bin_edges.tolist(), counts=counts.tolist())

    return ProfileSideResult(
        n=n,
        mean=mean_val,
        std=std_val,
        cp=cap.cp,
        cpk=cap.cpk,
        cpu=cap.cpu,
        cpl=cap.cpl,
        normality_stat=normality_stat,
        normality_p=normality_p,
        is_normal=is_normal,
        histogram=hist,
    )


def effective_tolerances(
    tol_plus: float,
    tol_minus: float | None,
    bonus: float = 0.0,
) -> tuple[float, float | None]:
    """Expande tolerâncias por bônus sem inventar um lado ausente.

    ``tol_minus`` igual a zero tem a mesma semântica unilateral de ``None`` em todo o
    domínio. O bônus amplia apenas o limite existente; não transforma zero em um LSL.
    """
    if tol_minus is None or tol_minus == 0.0:
        return tol_plus + bonus, None
    return tol_plus + bonus, abs(tol_minus) + bonus


def tolerance_used_pct(
    deviation: float,
    tol_plus: float,
    tol_minus: float | None,
) -> float:
    """Calcula o percentual da tolerância utilizada: |deviation| / tolerance_limit * 100."""
    limit = tol_plus if deviation >= 0 else abs(tol_minus) if tol_minus is not None else tol_plus
    if limit == 0:
        return float("inf")
    return abs(deviation) / limit * 100.0
