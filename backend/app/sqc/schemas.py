import enum
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.sqc.models import (
    BatchStatus,
    DimAxis,
    DimSubType,
    DimType,
    MaterialModifier,
    ProjectStatus,
    ZoneGeometry,
)

# ── Instruments ────────────────────────────────────────────────────────────────


class InstrumentCreate(BaseModel):
    code: str = Field(..., max_length=50)
    name: str = Field(..., max_length=150)
    uncertainty: float = Field(..., gt=0)


class InstrumentUpdate(BaseModel):
    name: str = Field(default="", min_length=1, max_length=150)
    uncertainty: float = Field(default=1.0, gt=0)


class InstrumentRead(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    uncertainty: float

    model_config = {"from_attributes": True}


# ── Parts ──────────────────────────────────────────────────────────────────────


class PartCreate(BaseModel):
    part_code: str = Field(..., max_length=50)
    description: str = Field(..., max_length=255)
    material: str | None = None
    process: str | None = None


class PartRead(BaseModel):
    id: uuid.UUID
    part_code: str
    description: str
    material: str | None
    process: str | None

    model_config = {"from_attributes": True}


# ── Dims ───────────────────────────────────────────────────────────────────────


class DimCreate(BaseModel):
    drawing_revision: str | None = None
    dim_code: str = Field(..., max_length=50)
    dim_name: str | None = None
    type: DimType
    sub_type: DimSubType | None = None
    nominal: float
    tol_plus: float = Field(..., ge=0)
    tol_minus: float | None = None
    material_modifier: MaterialModifier | None = None
    dim_rel_1_id: uuid.UUID | None = None
    dim_rel_2_id: uuid.UUID | None = None
    parent_dim_id: uuid.UUID | None = None
    zone_geometry: ZoneGeometry | None = None

    @model_validator(mode="after")
    def _zone_geometry_only_for_position(self) -> "DimCreate":
        if self.type == DimType.POSITION and self.zone_geometry is None:
            raise ValueError("zone_geometry é obrigatório quando type=POSITION")
        if self.type != DimType.POSITION and self.zone_geometry is not None:
            raise ValueError("zone_geometry só é aplicável quando type=POSITION")
        if self.zone_geometry == ZoneGeometry.LINE and self.material_modifier is not None:
            raise ValueError("material_modifier não é aplicável a uma posição LINE")
        return self


class DimRead(BaseModel):
    id: uuid.UUID
    part_id: uuid.UUID
    drawing_revision: str | None
    dim_code: str
    dim_name: str | None
    type: DimType
    sub_type: DimSubType | None
    nominal: float
    tol_plus: float
    tol_minus: float | None
    material_modifier: MaterialModifier | None
    dim_rel_1_id: uuid.UUID | None = None
    dim_rel_2_id: uuid.UUID | None = None
    parent_dim_id: uuid.UUID | None
    zone_geometry: ZoneGeometry | None = None
    is_unilateral: bool
    children: list["DimRead"] = []

    model_config = {"from_attributes": True}


# ── Directional Axis Relations (RECTANGLE positions) ───────────────────────────


class DimAxisRelationCreate(BaseModel):
    axis: DimAxis
    coordinate_dim_id: uuid.UUID
    related_size_dim_id: uuid.UUID | None = None


class DimAxisRelationUpdate(BaseModel):
    axis: DimAxis | None = None
    coordinate_dim_id: uuid.UUID | None = None
    related_size_dim_id: uuid.UUID | None = None


class DimAxisRelationRead(BaseModel):
    id: uuid.UUID
    axis: DimAxis
    coordinate_dim_id: uuid.UUID
    coordinate_dim_code: str
    related_size_dim_id: uuid.UUID | None
    related_size_dim_code: str | None

    model_config = {"from_attributes": True}


# ── Batches ────────────────────────────────────────────────────────────────────


class BatchCreate(BaseModel):
    tracking_code: str = Field(..., max_length=50)
    part_id: uuid.UUID
    supplier_id: str = Field(..., max_length=100)
    project_status: ProjectStatus
    batch_size: int | None = None
    inspection_level: str = Field(default="II", pattern="^(I|II|III)$")
    aql: float = Field(default=0.40, gt=0)


class BatchRead(BaseModel):
    id: uuid.UUID
    tracking_code: str
    part_id: uuid.UUID
    supplier_id: str
    project_status: ProjectStatus
    batch_status: BatchStatus
    rejection_justification: str | None
    batch_size: int | None
    inspection_level: str
    aql: float
    inspection_count: int = 0

    model_config = {"from_attributes": True}


class NqaResult(BaseModel):
    batch_size: int | None
    inspection_level: str
    aql: float
    letter: str
    required_sample_size: int
    acceptance_number: int
    rejection_number: int
    inspected: int
    non_conforming: int
    status: str
    achieved_aql: float | None = None
    # RECTANGLE (spec 060): peças sem resultado principal confiável (FR-017), excluídas de
    # `inspected`/`non_conforming`, e peças com diagnóstico direcional incompleto mas ainda
    # avaliáveis via ferramenta de medição (FR-018) — sempre 0 para CIRCULAR.
    non_evaluable_count: int = 0
    diagnostic_incomplete_count: int = 0


class BatchDecisionRequest(BaseModel):
    outcome: Literal["APPROVED", "REJECTED"]
    justification: str | None = None

    @model_validator(mode="after")
    def _require_justification_on_reject(self) -> "BatchDecisionRequest":
        if self.outcome == "REJECTED" and not (self.justification or "").strip():
            raise ValueError("justification is required when rejecting a batch")
        return self


class NqaSummaryRow(BaseModel):
    dim_id: uuid.UUID
    dim_code: str
    result: NqaResult


# ── Import CSV ─────────────────────────────────────────────────────────────────


class ImportError(BaseModel):
    row: int
    dim_code: str
    reason: str


class ImportResult(BaseModel):
    imported: int
    rejected: int
    errors: list[ImportError]


# ── Drawing ────────────────────────────────────────────────────────────────────


class DrawingUploadResponse(BaseModel):
    url: str
    filename: str


# ── Import Dimensões ───────────────────────────────────────────────────────────


class DimPreviewRow(BaseModel):
    dim_code: str
    dim_name: str | None
    drawing_revision: str | None
    status: str  # "new" | "exists" | "updated"


class DimImportResult(BaseModel):
    created: int
    skipped: int
    updated: int
    errors: list[str]
    preview: list[DimPreviewRow]


# ── Import Dimensões — Preview (somente leitura) ───────────────────────────────


class DimImportChange(BaseModel):
    field: str
    current: str | None
    incoming: str | None


class DimImportPreviewRow(BaseModel):
    dim_code: str
    status: str  # "new" | "unchanged" | "overwritten"
    coordinate_axis: DimAxis | None = None
    related_size_dim_code: str | None = None
    changes: list[DimImportChange]
    errors: list[str] = []


class DimImportPreview(BaseModel):
    rows: list[DimImportPreviewRow]
    errors: list[str]


# ── Import Medições (preview) ──────────────────────────────────────────────────


class MeasurementPreviewRow(BaseModel):
    dim_code: str
    dim_type: str | None
    part_count: int
    status: str  # "found" | "not_found"


class MeasurementPreview(BaseModel):
    rows: list[MeasurementPreviewRow]
    sheets: list[str]
    operator: str | None
    instrument: str | None
    fixture: str | None
    work_order: str | None
    date_start: str | None
    date_end: str | None
    total_parts: int
    total_dims: int
    found_dims: int
    missing_dims: int
    duplicate_pairs: int = 0
    errors: list[str] = []


# ── Statistics ─────────────────────────────────────────────────────────────────


class CapabilityThresholds(BaseModel):
    default_minimum: float
    warning_minimum: float
    tolerance_warning_pct: float
    tolerance_limit_pct: float
    dppm_good_max: float
    dppm_warning_max: float


class CapabilityBasis(BaseModel):
    methodology: Literal[
        "raw_measurements", "bonus_normalized_ratio", "rectangle_consolidated_ratio"
    ]
    n: int
    usl: float
    lsl: float | None
    nominal: float
    mean: float | None
    std_short: float | None
    std_long: float | None


class DirectionCapability(BaseModel):
    axis: str  # "X" | "Y" | "Z"
    methodology: str = "normalized_ratio"
    n: int
    mean: float | None = None
    std_sample: float | None = None
    cp: float | None = None
    cpk: float | None = None
    cpu: float | None = None
    cpl: float | None = None
    dppm: float | None = None
    insufficient_sample: bool = False


class StatisticsResponse(BaseModel):
    batch_id: uuid.UUID
    dim_id: uuid.UUID
    n: int
    is_unilateral: bool
    usl: float
    lsl: float | None
    nominal: float
    mean: float | None
    std_sample: float | None
    std_long: float | None = None
    std_short: float | None = None
    max: float | None
    min: float | None
    range: float | None
    cp: float | None
    cpk: float | None
    pp: float | None = None
    ppk: float | None = None
    cpu: float | None
    cpl: float | None
    insufficient_sample: bool
    degenerate: bool
    dppm: float | None = None
    k_index: float | None = None
    cpm: float | None = None
    mean_tolerance_pct: float | None = None
    std_tolerance_pct: float | None = None
    has_bonus: bool = False
    bonus_missing_rel: bool = False
    tolerance_overridden: bool = False
    n_uncertainty_at_risk: int = 0
    n_uncertainty_recoverable: int = 0
    # RECTANGLE (spec 060) — direção crítica majoritária entre as peças avaliáveis do lote
    # (informativo; a capabilidade por direção em si é T068/US7) e contagem de não avaliáveis
    # neste recorte (mesmo cavity filter do restante da resposta). None/0 para CIRCULAR.
    critical_axis: str | None = None  # "X" | "Y" | "Z" | "both" | None
    non_evaluable_count: int = 0
    # RECTANGLE (spec 060, FR-026) — capabilidade calculada independentemente por direção,
    # via ratio normalizado (measured/effective_usl); rotulada explicitamente como
    # metodologia normalizada, nunca confundida silenciosamente com Cp/Cpk clássico.
    capability_direction_1: DirectionCapability | None = None
    capability_direction_2: DirectionCapability | None = None
    capability_methodology: str = "raw_measurements"
    capability_basis: CapabilityBasis


# ── Control Chart ──────────────────────────────────────────────────────────────


class ControlChartPoint(BaseModel):
    part_number: int
    value: float
    out_of_control: bool


class ControlChartSeries(BaseModel):
    points: list[ControlChartPoint]
    center_line: float
    ucl: float
    lcl: float


class IChartPoint(BaseModel):
    index: int
    measured_value: float
    out_of_control: bool
    bonus: float = 0.0
    effective_usl: float | None = None
    effective_lsl: float | None = None
    uncertainty_zone: str | None = None


class IChartSeries(BaseModel):
    points: list[IChartPoint]
    mean: float
    std: float
    ucl: float
    lcl: float
    usl: float | None
    lsl: float | None
    nominal: float
    has_bonus: bool = False


class ControlChartResponse(BaseModel):
    subgroup_size: int
    xbar: ControlChartSeries | None = None
    r_chart: ControlChartSeries | None = None
    i_chart: IChartSeries | None = None
    insufficient_data: bool
    # RECTANGLE (spec 060, FR-027) — duas cartas I direcionais adicionais, sempre calculadas
    # (mesmo sem modificador, como diagnóstico per FR-016); None para CIRCULAR ou quando essa
    # direção não tem dado suficiente (<2 peças) neste recorte.
    i_chart_direction_1: IChartSeries | None = None
    i_chart_direction_2: IChartSeries | None = None
    direction_1_axis: str | None = None
    direction_2_axis: str | None = None
    # RECTANGLE + modificador — valor bruto do ferramenta de medição (sem bônus, não comparável entre
    # peças), ao lado do `i_chart` consolidado (utilização normalizada); mesma dualidade já
    # oferecida na Distribuição ("Bruto (ferramenta de medição)"). None fora desse caso.
    i_chart_raw: IChartSeries | None = None


# ── Distribution ───────────────────────────────────────────────────────────────


class HistogramData(BaseModel):
    bin_edges: list[float]
    counts: list[int]


class KDEData(BaseModel):
    x: list[float]
    y: list[float]


class DistributionSeries(BaseModel):
    histogram: HistogramData
    kde: KDEData
    n: int
    weibull_k: float | None = None
    weibull_scale: float | None = None


class DistributionResponse(BaseModel):
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
    has_bonus: bool = False
    ratio_histogram: HistogramData | None = None
    ratio_kde: KDEData | None = None
    # RECTANGLE (spec 060, FR-029) — utilização não negativa (Weibull, usl=1.0 = no limite).
    # `direction_1`/`direction_2` seguem a ordem de criação das relações; None para CIRCULAR
    # ou quando essa direção não tem nenhuma peça avaliável neste recorte.
    consolidated: DistributionSeries | None = None
    direction_1: DistributionSeries | None = None
    direction_2: DistributionSeries | None = None
    direction_1_axis: str | None = None
    direction_2_axis: str | None = None


# ── RECTANGLE per-axis breakdown (spec 060, contracts/api-sqc-060.md §3) ───────


class DirectionResultSchema(BaseModel):
    axis: str  # "X" | "Y" | "Z"
    related_size_dim_code: str | None = None
    measured_size: float | None = None
    related_size_nominal: float | None = None
    related_size_tol_plus: float | None = None
    related_size_tol_minus: float | None = None
    related_size_deviation: float | None = None
    material_condition: str | None = None  # "MMC" | "LMC" | None
    bonus: float
    nominal: float
    measured: float
    deviation: float
    base_limit: float
    effective_limit: float
    ratio_signed: float
    utilization: float


# ── Inspections Detail ─────────────────────────────────────────────────────────


class InspectionRow(BaseModel):
    id: uuid.UUID
    part_number: int
    cavity: int | None = None
    operator: str | None
    date_time: datetime
    instrument: str | None
    measured_value: float
    deviation: float
    tolerance_used_pct: float
    bonus: float = 0.0
    point_max: float | None
    point_min: float | None
    coord_x: float | None = None
    coord_y: float | None = None
    coord_z: float | None = None
    uncertainty: float | None = None
    uncertainty_zone: str | None = None  # "approved_at_risk" | "rejected_recoverable"
    # RECTANGLE (spec 060) — per-axis breakdown for the Details row-expansion (FR-024).
    # None for CIRCULAR and for RECTANGLE pieces without any directional data.
    zone_geometry: str | None = None  # "RECTANGLE" only; None otherwise
    directions: list[DirectionResultSchema] | None = None
    consolidated_utilization: float | None = None
    critical_axis: str | None = None  # "X" | "Y" | "Z" | "both" | None
    conforming: bool | None = None  # None => não avaliável (diagnóstico incompleto)
    # spec 252 (FR-006) — estado de desconsideração da amostra, populado direto da Inspection.
    is_ignored: bool = False
    ignored_reason: str | None = None
    # Sugestão automática de outlier (z-score modificado) — nunca remove/filtra, só sinaliza;
    # a decisão de desconsiderar continua manual via InspectionIgnoreRequest.
    is_outlier_suggested: bool = False
    outlier_reason: str | None = None


class InspectionsDetailResponse(BaseModel):
    dim_code: str
    dim_name: str | None
    has_children: bool
    rows: list[InspectionRow]


# ── Batch Overview (semáforo) ──────────────────────────────────────────────────


class DimOverviewRow(BaseModel):
    dim_id: uuid.UUID
    dim_code: str
    dim_name: str | None
    dim_type: str
    is_unilateral: bool
    n: int
    mean_tol_pct: float | None
    std_tol_pct: float | None
    n_out: int
    status: str  # "ok" | "warning" | "critical" | "no_data"
    # NQA
    nqa_ac: int | None
    nqa_re: int | None
    nqa_status: str | None  # "ACEITO" | "REJEITADO" | "AMOSTRA_INSUFICIENTE"
    nqa_letter: str | None
    nqa_achieved_aql: float | None = None
    # Incerteza
    n_uncertainty: int = 0


class BatchOverviewResponse(BaseModel):
    batch_id: uuid.UUID
    tracking_code: str
    part_id: uuid.UUID
    dims: list[DimOverviewRow]
    drawing_revision: str | None = None


# ── Part Heatmap (multi-lote) ──────────────────────────────────────────────────


class HeatmapCell(BaseModel):
    batch_id: uuid.UUID
    tracking_code: str
    n: int
    mean_tol_pct: float | None
    std_tol_pct: float | None
    n_out: int
    n_uncertainty: int
    nqa_ac: int
    nqa_re: int
    status: str


class HeatmapDimRow(BaseModel):
    dim_id: uuid.UUID
    dim_code: str
    dim_name: str | None
    dim_type: str
    cells: list[HeatmapCell]


class PartHeatmapResponse(BaseModel):
    part_id: uuid.UUID
    batch_labels: dict[str, str]  # batch_id → tracking_code
    dims: list[HeatmapDimRow]


# ── Trend / Boxplot ────────────────────────────────────────────────────────────


class BatchBoxplot(BaseModel):
    batch_id: uuid.UUID
    tracking_code: str
    date: datetime
    n: int
    mean: float
    q1: float
    median: float
    q3: float
    whisker_low: float
    whisker_high: float
    outliers: list[float]


class TrendResponse(BaseModel):
    dim_code: str
    batches: list[BatchBoxplot]
    usl: float
    lsl: float | None
    is_unilateral: bool


# ── Coordinates (X/Y/Z por peça — lote único) ─────────────────────────────────


class CoordinatePoint(BaseModel):
    part_number: int
    cavity: int | None = None
    x: float | None = None
    y: float | None = None
    z: float | None = None
    bonus: float = 0.0
    # RECTANGLE (spec 060) — per-piece per-axis breakdown for RectangleZoneChart (FR-022/023).
    # `bonus` above is unused for RECTANGLE (no single scalar bonus); read `directions[]`.
    directions: list[DirectionResultSchema] | None = None
    consolidated_utilization: float | None = None
    critical_axis: str | None = None  # "X" | "Y" | "Z" | "both" | None
    conforming: bool | None = None  # None => não avaliável


class CoordinateData(BaseModel):
    dim_code: str
    points: list[CoordinatePoint]
    tol_radius: float  # tolerância circular (tol_plus da dim pai) — zona base para RECTANGLE
    has_bonus: bool = False
    zone_geometry: str | None = None  # "RECTANGLE" only; None (implicitly CIRCULAR) otherwise
    nominal_x: float | None
    nominal_y: float | None
    nominal_z: float | None
    usl_x: float | None
    lsl_x: float | None
    usl_y: float | None
    lsl_y: float | None
    usl_z: float | None
    lsl_z: float | None


# ── Coordinate Trend (X/Y/Z por lote — comparação) ────────────────────────────


class CoordinateBatchStats(BaseModel):
    batch_id: uuid.UUID
    tracking_code: str
    n: int
    mean_x: float | None = None
    mean_y: float | None = None
    mean_z: float | None = None
    std_x: float | None = None
    std_y: float | None = None
    std_z: float | None = None
    p5_x: float | None = None
    p95_x: float | None = None
    p5_y: float | None = None
    p95_y: float | None = None
    p5_z: float | None = None
    p95_z: float | None = None


class CoordinateTrendResponse(BaseModel):
    dim_code: str
    batches: list[CoordinateBatchStats]
    tol_radius: float
    nominal_x: float | None
    nominal_y: float | None
    nominal_z: float | None
    # RECTANGLE (spec 060, research.md R8) — só a forma do contorno de tolerância desenhado
    # muda (retângulo em vez de círculo); os campos por eixo acima continuam vindo da mesma
    # fonte (filhos _X/_Y/_Z), inalterada nesta view multi-lote.
    zone_geometry: str | None = None


# ── Updates (PATCH) ───────────────────────────────────────────────────────────


class PartUpdate(BaseModel):
    description: str = Field(default="", min_length=1, max_length=255)
    material: str | None = Field(default=None, max_length=100)
    process: str | None = Field(default=None, max_length=100)


class DimUpdate(BaseModel):
    dim_name: str | None = None
    drawing_revision: str | None = None
    nominal: float = 0.0
    tol_plus: float = Field(default=0.0, ge=0)
    tol_minus: float | None = None
    dim_rel_1_id: uuid.UUID | None = None
    dim_rel_2_id: uuid.UUID | None = None
    parent_dim_id: uuid.UUID | None = None


class BatchUpdate(BaseModel):
    batch_size: int | None = Field(default=None, gt=0)
    supplier_id: str = Field(default="", min_length=1, max_length=100)
    project_status: ProjectStatus = ProjectStatus.IE
    inspection_level: str = Field(default="II", pattern="^(I|II|III)$")
    aql: float = Field(default=0.4, gt=0)


# ── Profile Trend ──────────────────────────────────────────────────────────────


class ProfileSideStats(BaseModel):
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


class ProfileDistributionResponse(BaseModel):
    pos: ProfileSideStats | None
    neg: ProfileSideStats | None
    usl: float
    lsl: float | None


class ProfileBatchStats(BaseModel):
    batch_id: uuid.UUID
    tracking_code: str
    n: int
    mean_max: float | None
    std_max: float | None
    p5_max: float | None
    p95_max: float | None
    mean_min: float | None
    std_min: float | None
    p5_min: float | None
    p95_min: float | None
    cp_pos: float | None = None
    cpk_pos: float | None = None
    is_normal_pos: bool | None = None
    cp_neg: float | None = None
    cpk_neg: float | None = None
    is_normal_neg: bool | None = None


class ProfileTrendResponse(BaseModel):
    dim_code: str
    batches: list[ProfileBatchStats]
    usl: float
    lsl: float | None


# ── Grouped Capability (spec 252) ───────────────────────────────────────────────


class GroupedStatisticsRequest(BaseModel):
    batch_ids: list[uuid.UUID] = Field(..., min_length=2)
    dim_id: uuid.UUID
    cavity: int | None = None
    # Simulação de tolerância (mesmo padrão de tol_plus_override/tol_minus_override do
    # endpoint de lote único) — nominal_override é uma pequena extensão de escopo porque o
    # painel agrupado também precisa reposicionar o nominal ao simular, não só a largura.
    tol_plus_override: float | None = Field(default=None, gt=0)
    tol_minus_override: float | None = Field(default=None, ge=0)
    nominal_override: float | None = None


class BatchContext(BaseModel):
    batch_id: uuid.UUID
    tracking_code: str
    batch_status: str
    n: int
    n_ignored: int
    revision_mismatch: bool


class GroupedStatisticsResponse(BaseModel):
    dim_id: uuid.UUID
    is_unilateral: bool
    usl: float
    lsl: float | None
    nominal: float
    n: int
    mean: float | None
    std_pooled: float | None
    std_global: float | None
    cp: float | None
    cpk: float | None
    pp: float | None
    ppk: float | None
    cpu: float | None
    cpl: float | None
    insufficient_sample: bool
    degenerate: bool
    has_bonus: bool
    bonus_missing_rel: bool
    tolerance_overridden: bool = False
    capability_methodology: str = "raw_measurements"
    capability_basis: CapabilityBasis
    batches: list[BatchContext]


# ── Reverse Capability Solver (grouped tolerance ⇄ target Cpk) ─────────────────


class SuggestToleranceRequest(BaseModel):
    batch_ids: list[uuid.UUID] = Field(..., min_length=2)
    dim_id: uuid.UUID
    cavity: int | None = None
    target_cpk: float = Field(..., gt=0)


class SuggestToleranceResponse(BaseModel):
    usl: float
    lsl: float | None
    tol_plus: float
    tol_minus: float | None
    achievable: bool
    current_mean: float | None
    current_std_pooled: float | None
    insufficient_sample: bool


# ── Export Measurements (spec 252) ──────────────────────────────────────────────


class ExportFormat(enum.StrEnum):
    CSV = "csv"
    XLSX = "xlsx"
    TXT = "txt"


class ExportMeasurementsRequest(BaseModel):
    batch_ids: list[uuid.UUID] = Field(..., min_length=1)
    dim_id: uuid.UUID
    cavity: int | None = None
    format: ExportFormat = ExportFormat.CSV


# ── Inspection Ignore (spec 252) ────────────────────────────────────────────────


class InspectionIgnoreRequest(BaseModel):
    ignored: bool
    reason: str | None = None

    @model_validator(mode="after")
    def _require_reason_on_ignore(self) -> "InspectionIgnoreRequest":
        if self.ignored and not (self.reason or "").strip():
            raise ValueError("motivo obrigatório para desconsiderar uma amostra")
        return self


class InspectionIgnoreResponse(BaseModel):
    inspection_id: uuid.UUID
    is_ignored: bool
    ignored_reason: str | None
    statistics: StatisticsResponse
