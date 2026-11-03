// ── Types (inline até gen-api rodar) ──────────────────────────────────────────

export interface InstrumentRead {
  id: string;
  code: string;
  name: string;
  uncertainty: number;
}

export interface InstrumentCreate {
  code: string;
  name: string;
  uncertainty: number;
}

export interface InstrumentUpdate {
  name?: string;
  uncertainty?: number;
}

export interface PartRead {
  id: string;
  part_code: string;
  description: string;
  material: string | null;
  process: string | null;
}

export interface PartCreate {
  part_code: string;
  description: string;
  material?: string;
  process?: string;
}

export type ProjectStatus = "EVB" | "PVB" | "IE";
export type BatchStatus = "APPROVED" | "IN_ANALYSIS" | "REJECTED";

export interface BatchRead {
  id: string;
  tracking_code: string;
  part_id: string;
  supplier_id: string;
  project_status: ProjectStatus;
  batch_status: BatchStatus;
  rejection_justification: string | null;
  batch_size: number | null;
  inspection_level: string;
  aql: number;
  inspection_count: number;
}

export interface NqaResult {
  batch_size: number | null;
  inspection_level: string;
  aql: number;
  letter: string;
  required_sample_size: number;
  acceptance_number: number;
  rejection_number: number;
  inspected: number;
  non_conforming: number;
  status: "ACEITO" | "REJEITADO" | "AMOSTRA_INSUFICIENTE";
  achieved_aql: number | null;
  // RECTANGLE (spec 060) — sempre 0 para CIRCULAR
  non_evaluable_count: number;
  diagnostic_incomplete_count: number;
}

// ── RECTANGLE per-axis breakdown (spec 060) ────────────────────────────────────

export interface DirectionResult {
  axis: "X" | "Y" | "Z";
  related_size_dim_code: string | null;
  measured_size: number | null;
  related_size_nominal: number | null;
  related_size_tol_plus: number | null;
  related_size_tol_minus: number | null;
  related_size_deviation: number | null;
  material_condition: "MMC" | "LMC" | null;
  bonus: number;
  nominal: number;
  measured: number;
  deviation: number;
  base_limit: number;
  effective_limit: number;
  ratio_signed: number;
  utilization: number;
}

export interface BatchCreate {
  tracking_code: string;
  part_id: string;
  supplier_id: string;
  project_status: ProjectStatus;
  batch_size?: number;
  inspection_level?: string;
  aql?: number;
}

export interface BatchUpdate {
  batch_size?: number | null;
  supplier_id?: string;
  project_status?: ProjectStatus;
  inspection_level?: string;
  aql?: number;
}

export interface BatchDecisionRequest {
  outcome: "APPROVED" | "REJECTED";
  justification?: string | null;
}

export interface NqaSummaryRow {
  dim_id: string;
  dim_code: string;
  result: NqaResult;
}

export interface DimRead {
  id: string;
  part_id: string;
  dim_code: string;
  dim_name: string | null;
  type: string;
  sub_type: string | null;
  drawing_revision: string | null;
  nominal: number;
  tol_plus: number;
  tol_minus: number | null;
  is_unilateral: boolean;
  material_modifier: "M" | "L" | null;
  dim_rel_1_id: string | null;
  dim_rel_2_id: string | null;
  parent_dim_id: string | null;
  zone_geometry: "CIRCULAR" | "RECTANGLE" | "LINE" | null;
  children: DimRead[];
}

// ── Directional Axis Relations (RECTANGLE positions, spec 060) ─────────────────

export type DimAxisValue = "X" | "Y" | "Z";

export interface DimAxisRelation {
  id: string;
  axis: DimAxisValue;
  coordinate_dim_id: string;
  coordinate_dim_code: string;
  related_size_dim_id: string | null;
  related_size_dim_code: string | null;
}

export interface DimAxisRelationCreate {
  axis: DimAxisValue;
  coordinate_dim_id: string;
  related_size_dim_id?: string | null;
}

export interface DimAxisRelationUpdate {
  axis?: DimAxisValue;
  coordinate_dim_id?: string;
  related_size_dim_id?: string | null;
}

export interface CapabilityBasis {
  methodology: "raw_measurements" | "bonus_normalized_ratio" | "rectangle_consolidated_ratio";
  n: number;
  usl: number;
  lsl: number | null;
  nominal: number;
  mean: number | null;
  std_short: number | null;
  std_long: number | null;
}

export interface StatisticsResponse {
  batch_id: string;
  dim_id: string;
  n: number;
  is_unilateral: boolean;
  usl: number;
  lsl: number | null;
  nominal: number;
  mean: number | null;
  std_sample: number | null;
  std_global: number | null;
  max: number | null;
  min: number | null;
  range: number | null;
  cp: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
  cpu: number | null;
  cpl: number | null;
  ppu: number | null;
  ppl: number | null;
  insufficient_sample: boolean;
  degenerate: boolean;
  dppm: number | null;
  k_index: number | null;
  cpm: number | null;
  mean_tolerance_pct: number | null;
  std_tolerance_pct: number | null;
  has_bonus: boolean;
  bonus_missing_rel: boolean;
  tolerance_overridden: boolean;
  n_uncertainty_at_risk: number;
  n_uncertainty_recoverable: number;
  // RECTANGLE (spec 060) — null/0 para CIRCULAR
  critical_axis: "X" | "Y" | "Z" | "both" | null;
  non_evaluable_count: number;
  capability_direction_1: DirectionCapability | null;
  capability_direction_2: DirectionCapability | null;
  capability_methodology:
    | "raw_measurements"
    | "bonus_normalized_ratio"
    | "rectangle_consolidated_ratio";
  capability_basis: CapabilityBasis;
}

export interface DirectionCapability {
  axis: "X" | "Y" | "Z";
  methodology: string;
  n: number;
  mean: number | null;
  std_sample: number | null;
  cp: number | null;
  cpk: number | null;
  cpu: number | null;
  cpl: number | null;
  dppm: number | null;
  insufficient_sample: boolean;
}

export interface ControlChartPoint {
  part_number: number;
  value: number;
  out_of_control: boolean;
}

export interface ControlChartSeries {
  points: ControlChartPoint[];
  center_line: number;
  ucl: number;
  lcl: number;
}

export interface IChartPoint {
  index: number;
  measured_value: number;
  out_of_control: boolean;
  bonus: number;
  effective_usl: number | null;
  effective_lsl: number | null;
  uncertainty_zone: "approved_at_risk" | "rejected_recoverable" | null;
}

export interface IChartSeries {
  points: IChartPoint[];
  mean: number;
  std: number;
  ucl: number;
  lcl: number;
  usl: number | null;
  lsl: number | null;
  nominal: number;
  has_bonus: boolean;
}

export interface ControlChartResponse {
  subgroup_size: number;
  xbar?: ControlChartSeries;
  r_chart?: ControlChartSeries;
  i_chart?: IChartSeries;
  insufficient_data: boolean;
  // RECTANGLE (spec 060) — null para CIRCULAR
  i_chart_direction_1: IChartSeries | null;
  i_chart_direction_2: IChartSeries | null;
  direction_1_axis: "X" | "Y" | "Z" | null;
  direction_2_axis: "X" | "Y" | "Z" | null;
  // RECTANGLE + modificador — bruto do PolyWorks ao lado do `i_chart` consolidado
  i_chart_raw?: IChartSeries | null;
}

export interface DistributionSeries {
  histogram: { bin_edges: number[]; counts: number[] };
  kde: { x: number[]; y: number[] };
  n: number;
  weibull_k: number | null;
  weibull_scale: number | null;
}

export interface DistributionResponse {
  histogram: { bin_edges: number[]; counts: number[] };
  kde: { x: number[]; y: number[] };
  usl: number;
  lsl: number | null;
  nominal: number;
  n: number;
  distribution_type: "normal" | "weibull" | "none";
  weibull_k: number | null;
  weibull_scale: number | null;
  normality_stat: number | null;
  normality_p: number | null;
  is_normal: boolean | null;
  has_bonus: boolean;
  ratio_histogram: { bin_edges: number[]; counts: number[] } | null;
  ratio_kde: { x: number[]; y: number[] } | null;
  // RECTANGLE (spec 060) — null para CIRCULAR
  consolidated: DistributionSeries | null;
  direction_1: DistributionSeries | null;
  direction_2: DistributionSeries | null;
  direction_1_axis: "X" | "Y" | "Z" | null;
  direction_2_axis: "X" | "Y" | "Z" | null;
}

export interface InspectionRow {
  id: string;
  part_number: number;
  cavity: number | null;
  operator: string | null;
  date_time: string;
  instrument: string | null;
  measured_value: number;
  deviation: number;
  tolerance_used_pct: number;
  bonus: number;
  point_max: number | null;
  point_min: number | null;
  coord_x: number | null;
  coord_y: number | null;
  coord_z: number | null;
  uncertainty: number | null;
  uncertainty_zone: "approved_at_risk" | "rejected_recoverable" | null;
  // RECTANGLE (spec 060) — null para CIRCULAR e para peças sem dado direcional
  zone_geometry: "RECTANGLE" | null;
  directions: DirectionResult[] | null;
  consolidated_utilization: number | null;
  critical_axis: "X" | "Y" | "Z" | "both" | null;
  conforming: boolean | null;
  // spec 252 (FR-006) — estado de desconsideração da amostra
  is_ignored: boolean;
  ignored_reason: string | null;
  // Sugestão automática de outlier (z-score modificado) — apenas sinaliza, nunca filtra
  is_outlier_suggested: boolean;
  outlier_reason: string | null;
}

// ── spec 252 — Estatísticas agrupadas, export e ignore ────────────────────────

export interface BatchContext {
  batch_id: string;
  tracking_code: string;
  batch_status: BatchStatus;
  n: number;
  n_ignored: number;
  revision_mismatch: boolean;
}

export interface GroupedStatisticsResponse {
  dim_id: string;
  is_unilateral: boolean;
  usl: number;
  lsl: number | null;
  nominal: number;
  n: number;
  mean: number | null;
  std_pooled: number | null;
  std_global: number | null;
  cp: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
  cpu: number | null;
  cpl: number | null;
  insufficient_sample: boolean;
  degenerate: boolean;
  has_bonus: boolean;
  bonus_missing_rel: boolean;
  tolerance_overridden: boolean;
  capability_methodology:
    | "raw_measurements"
    | "bonus_normalized_ratio"
    | "rectangle_consolidated_ratio";
  capability_basis: CapabilityBasis;
  batches: BatchContext[];
}

export interface SuggestToleranceResponse {
  usl: number;
  lsl: number | null;
  tol_plus: number;
  tol_minus: number | null;
  achievable: boolean;
  current_mean: number | null;
  current_std_pooled: number | null;
  insufficient_sample: boolean;
}

export type ExportFormat = "csv" | "xlsx" | "txt";

export interface InspectionIgnoreResponse {
  inspection_id: string;
  is_ignored: boolean;
  ignored_reason: string | null;
  statistics: StatisticsResponse;
}

export interface InspectionsDetailResponse {
  dim_code: string;
  dim_name: string | null;
  has_children: boolean;
  rows: InspectionRow[];
}

export interface BatchBoxplot {
  batch_id: string;
  tracking_code: string;
  date: string;
  n: number;
  mean: number;
  q1: number;
  median: number;
  q3: number;
  whisker_low: number;
  whisker_high: number;
  outliers: number[];
}

export interface TrendResponse {
  dim_code: string;
  batches: BatchBoxplot[];
  usl: number;
  lsl: number | null;
  is_unilateral: boolean;
}

export interface ProfileSideStats {
  n: number;
  mean: number;
  std: number;
  cp: number | null;
  cpk: number | null;
  cpu: number | null;
  cpl: number | null;
  normality_stat: number | null;
  normality_p: number | null;
  is_normal: boolean | null;
  histogram: { bin_edges: number[]; counts: number[] };
}

export interface ProfileDistributionResponse {
  pos: ProfileSideStats | null;
  neg: ProfileSideStats | null;
  usl: number;
  lsl: number | null;
}

export interface ProfileBatchStats {
  batch_id: string;
  tracking_code: string;
  n: number;
  mean_max: number | null;
  std_max: number | null;
  p5_max: number | null;
  p95_max: number | null;
  mean_min: number | null;
  std_min: number | null;
  p5_min: number | null;
  p95_min: number | null;
  cp_pos: number | null;
  cpk_pos: number | null;
  is_normal_pos: boolean | null;
  cp_neg: number | null;
  cpk_neg: number | null;
  is_normal_neg: boolean | null;
}

export interface ProfileTrendResponse {
  dim_code: string;
  batches: ProfileBatchStats[];
  usl: number;
  lsl: number | null;
}

// ── Batch Overview ─────────────────────────────────────────────────────────────

export interface DimOverviewRow {
  dim_id: string;
  dim_code: string;
  dim_name: string | null;
  dim_type: string;
  is_unilateral: boolean;
  n: number;
  mean_tol_pct: number | null;
  std_tol_pct: number | null;
  n_out: number;
  status: "ok" | "warning" | "critical" | "no_data";
  nqa_ac: number | null;
  nqa_re: number | null;
  nqa_status: string | null;
  nqa_letter: string | null;
  nqa_achieved_aql: number | null;
  n_uncertainty: number;
}

export interface BatchOverviewResponse {
  batch_id: string;
  tracking_code: string;
  part_id: string;
  dims: DimOverviewRow[];
  drawing_revision: string | null;
}

// ── Part Heatmap ───────────────────────────────────────────────────────────────

export interface HeatmapCell {
  batch_id: string;
  tracking_code: string;
  n: number;
  mean_tol_pct: number | null;
  std_tol_pct: number | null;
  n_out: number;
  n_uncertainty: number;
  nqa_ac: number;
  nqa_re: number;
  status: "ok" | "warning" | "critical" | "no_data";
}

export interface HeatmapDimRow {
  dim_id: string;
  dim_code: string;
  dim_name: string | null;
  dim_type: string;
  cells: HeatmapCell[];
}

export interface PartHeatmapResponse {
  part_id: string;
  batch_labels: Record<string, string>;
  dims: HeatmapDimRow[];
}

// ── Coordinates ────────────────────────────────────────────────────────────────

export interface CoordinatePoint {
  part_number: number;
  x: number | null;
  y: number | null;
  z: number | null;
  bonus: number;
  // RECTANGLE (spec 060) — `bonus` acima não se aplica; ver `directions[]`
  directions: DirectionResult[] | null;
  consolidated_utilization: number | null;
  critical_axis: "X" | "Y" | "Z" | "both" | null;
  conforming: boolean | null;
}

export interface CoordinateData {
  dim_code: string;
  points: CoordinatePoint[];
  tol_radius: number;
  has_bonus: boolean;
  nominal_x: number | null;
  nominal_y: number | null;
  nominal_z: number | null;
  usl_x: number | null;
  lsl_x: number | null;
  usl_y: number | null;
  lsl_y: number | null;
  usl_z: number | null;
  lsl_z: number | null;
  zone_geometry: "RECTANGLE" | null;
}

export interface CoordinateBatchStats {
  batch_id: string;
  tracking_code: string;
  n: number;
  mean_x: number | null;
  mean_y: number | null;
  mean_z: number | null;
  std_x: number | null;
  std_y: number | null;
  std_z: number | null;
  p5_x: number | null;
  p95_x: number | null;
  p5_y: number | null;
  p95_y: number | null;
  p5_z: number | null;
  p95_z: number | null;
}

export interface CoordinateTrendResponse {
  dim_code: string;
  batches: CoordinateBatchStats[];
  tol_radius: number;
  nominal_x: number | null;
  nominal_y: number | null;
  nominal_z: number | null;
  zone_geometry: "RECTANGLE" | null;
}

// ── Import Results ─────────────────────────────────────────────────────────────

export interface ImportResult {
  imported: number;
  rejected: number;
  errors: { row: number; dim_code: string; reason: string }[];
}

// ── Import Dims ────────────────────────────────────────────────────────────────

export interface DimPreviewRow {
  dim_code: string;
  dim_name: string | null;
  drawing_revision: string | null;
  status: "new" | "exists" | "updated";
}

export interface DimImportResult {
  created: number;
  skipped: number;
  updated: number;
  errors: string[];
  preview: DimPreviewRow[];
}

// ── Import Dims — Preview ──────────────────────────────────────────────────────

export interface DimImportChange {
  field: string;
  current: string | null;
  incoming: string | null;
}

export interface DimImportPreviewRow {
  dim_code: string;
  status: "new" | "unchanged" | "overwritten";
  coordinate_axis: DimAxisValue | null;
  related_size_dim_code: string | null;
  changes: DimImportChange[];
  errors: string[];
}

export interface DimImportPreview {
  rows: DimImportPreviewRow[];
  errors: string[];
}

// ── Delete Dim conflict ────────────────────────────────────────────────────────

export type DeleteDimConflict =
  | { reason: "has_inspections"; count: number }
  | { reason: "referenced_by"; dim_codes: string[] };

// ── Import Measurements ────────────────────────────────────────────────────────

export interface MeasurementPreviewRow {
  dim_code: string;
  dim_type: string | null;
  part_count: number;
  status: "found" | "not_found";
}

export interface MeasurementPreview {
  rows: MeasurementPreviewRow[];
  sheets: string[];
  operator: string | null;
  instrument: string | null;
  fixture: string | null;
  work_order: string | null;
  date_start: string | null;
  date_end: string | null;
  total_parts: number;
  total_dims: number;
  found_dims: number;
  missing_dims: number;
  duplicate_pairs?: number;
  errors: string[];
}

// ── API Functions ──────────────────────────────────────────────────────────────

export interface SqcApiError {
  status: number;
  error: string;
}

function detailMessage(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        typeof item === "object" && item !== null && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : null,
      )
      .filter((message): message is string => Boolean(message));
    return messages.length ? messages.join("; ") : null;
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }
  return null;
}

/** Mantém a forma `{ status, error }` consumida pelas telas e sempre inclui contexto HTTP. */
async function parseApiError(res: Response): Promise<SqcApiError> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  const fallback = `Erro ${res.status}: ${res.statusText || "falha na requisição"}`;
  return { status: res.status, error: detailMessage(body?.detail) ?? fallback };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw await parseApiError(res);
  return res.json() as Promise<T>;
}

export const sqcApi = {
  listInstruments: () => fetchJson<InstrumentRead[]>("/api/sqc/instruments"),

  createInstrument: (data: InstrumentCreate): Promise<InstrumentRead> =>
    fetch("/api/sqc/instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json();
    }),

  updateInstrument: (id: string, data: InstrumentUpdate): Promise<InstrumentRead> =>
    fetch(`/api/sqc/instruments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json();
    }),

  deleteInstrument: (id: string): Promise<void> =>
    fetch(`/api/sqc/instruments/${id}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
    }),

  listParts: () => fetchJson<PartRead[]>("/api/sqc/parts"),

  createPart: (data: PartCreate) =>
    fetch("/api/sqc/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<PartRead>;
    }),

  listBatches: (params?: { part_id?: string; supplier_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.part_id) qs.set("part_id", params.part_id);
    if (params?.supplier_id) qs.set("supplier_id", params.supplier_id);
    return fetchJson<BatchRead[]>(`/api/sqc/batches?${qs}`);
  },

  listDims: (partId: string, includeChildren = false) =>
    fetchJson<DimRead[]>(`/api/sqc/parts/${partId}/dims?include_children=${includeChildren}`),

  getStatistics: (
    batchId: string,
    dimId: string,
    tolPlusOverride?: number,
    tolMinusOverride?: number,
    cavity?: number,
  ) => {
    const qs = new URLSearchParams();
    if (tolPlusOverride !== undefined) qs.set("tol_plus_override", String(tolPlusOverride));
    if (tolMinusOverride !== undefined) qs.set("tol_minus_override", String(tolMinusOverride));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<StatisticsResponse>(
      `/api/sqc/batches/${batchId}/dims/${dimId}/statistics${query}`,
    );
  },

  getControlChart: (
    batchId: string,
    dimId: string,
    tolPlusOverride?: number,
    tolMinusOverride?: number,
    cavity?: number,
  ) => {
    const qs = new URLSearchParams();
    if (tolPlusOverride !== undefined) qs.set("tol_plus_override", String(tolPlusOverride));
    if (tolMinusOverride !== undefined) qs.set("tol_minus_override", String(tolMinusOverride));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<ControlChartResponse>(
      `/api/sqc/batches/${batchId}/dims/${dimId}/control-chart${query}`,
    );
  },

  getDistribution: (
    batchId: string,
    dimId: string,
    tolPlusOverride?: number,
    tolMinusOverride?: number,
    cavity?: number,
  ) => {
    const qs = new URLSearchParams();
    if (tolPlusOverride !== undefined) qs.set("tol_plus_override", String(tolPlusOverride));
    if (tolMinusOverride !== undefined) qs.set("tol_minus_override", String(tolMinusOverride));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<DistributionResponse>(
      `/api/sqc/batches/${batchId}/dims/${dimId}/distribution${query}`,
    );
  },

  getInspections: (
    batchId: string,
    dimId: string,
    includeChildren = true,
    tolPlusOverride?: number,
    tolMinusOverride?: number,
    cavity?: number,
  ) => {
    const qs = new URLSearchParams({ include_children: String(includeChildren) });
    if (tolPlusOverride !== undefined) qs.set("tol_plus_override", String(tolPlusOverride));
    if (tolMinusOverride !== undefined) qs.set("tol_minus_override", String(tolMinusOverride));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    return fetchJson<InspectionsDetailResponse>(
      `/api/sqc/batches/${batchId}/dims/${dimId}/inspections?${qs}`,
    );
  },

  getNqa: (
    batchId: string,
    dimId: string,
    tolPlusOverride?: number,
    tolMinusOverride?: number,
    cavity?: number,
  ) => {
    const qs = new URLSearchParams();
    if (tolPlusOverride !== undefined) qs.set("tol_plus_override", String(tolPlusOverride));
    if (tolMinusOverride !== undefined) qs.set("tol_minus_override", String(tolMinusOverride));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<NqaResult>(`/api/sqc/batches/${batchId}/dims/${dimId}/nqa${query}`);
  },

  getTrend: (partId: string, dimId: string, batchIds?: string[], cavity?: number) => {
    const qs = new URLSearchParams();
    if (batchIds?.length) qs.set("batch_ids", batchIds.join(","));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    return fetchJson<TrendResponse>(`/api/sqc/parts/${partId}/dims/${dimId}/trend?${qs}`);
  },

  getDrawingUrl: (partId: string, revision: string) =>
    fetchJson<{ url: string; filename: string }>(
      `/api/sqc/parts/${partId}/drawing?revision=${encodeURIComponent(revision)}`,
    ),

  uploadDrawing: async (partId: string, revision: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("drawing_revision", revision);
    const res = await fetch(`/api/sqc/parts/${partId}/drawing`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw await parseApiError(res);
    return res.json() as Promise<{ url: string; filename: string }>;
  },

  getBatchOverview: (batchId: string, cavity?: number) => {
    const qs = new URLSearchParams();
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<BatchOverviewResponse>(`/api/sqc/batches/${batchId}/overview${query}`);
  },

  getPartHeatmap: (partId: string, batchIds: string[], cavity?: number) => {
    const qs = new URLSearchParams();
    if (batchIds.length) qs.set("batch_ids", batchIds.join(","));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    return fetchJson<PartHeatmapResponse>(`/api/sqc/parts/${partId}/heatmap?${qs}`);
  },

  getCoordinates: (batchId: string, dimId: string, tolPlusOverride?: number, cavity?: number) => {
    const qs = new URLSearchParams();
    if (tolPlusOverride !== undefined) qs.set("tol_plus_override", String(tolPlusOverride));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<CoordinateData>(
      `/api/sqc/batches/${batchId}/dims/${dimId}/coordinates${query}`,
    );
  },

  getCoordinateTrend: (partId: string, dimId: string, batchIds?: string[], cavity?: number) => {
    const qs = new URLSearchParams();
    if (batchIds?.length) qs.set("batch_ids", batchIds.join(","));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    return fetchJson<CoordinateTrendResponse>(
      `/api/sqc/parts/${partId}/dims/${dimId}/coordinate-trend?${qs}`,
    );
  },

  getProfileDistribution: (batchId: string, dimId: string, cavity?: number) => {
    const qs = new URLSearchParams();
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    const query = qs.toString() ? `?${qs}` : "";
    return fetchJson<ProfileDistributionResponse>(
      `/api/sqc/batches/${batchId}/dims/${dimId}/profile-distribution${query}`,
    );
  },

  getProfileTrend: (partId: string, dimId: string, batchIds?: string[], cavity?: number) => {
    const qs = new URLSearchParams();
    if (batchIds?.length) qs.set("batch_ids", batchIds.join(","));
    if (cavity !== undefined) qs.set("cavity", String(cavity));
    return fetchJson<ProfileTrendResponse>(
      `/api/sqc/parts/${partId}/dims/${dimId}/profile-trend?${qs}`,
    );
  },

  createBatch: (data: BatchCreate) =>
    fetch("/api/sqc/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<BatchRead>;
    }),

  updateBatch: (batchId: string, data: BatchUpdate): Promise<BatchRead> =>
    fetch(`/api/sqc/batches/${batchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<BatchRead>;
    }),

  decideBatch: (batchId: string, data: BatchDecisionRequest): Promise<BatchRead> =>
    fetch(`/api/sqc/batches/${batchId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<BatchRead>;
    }),

  getNqaSummary: (batchId: string): Promise<NqaSummaryRow[]> =>
    fetch(`/api/sqc/batches/${batchId}/nqa-summary`).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<NqaSummaryRow[]>;
    }),

  updatePart: (
    partId: string,
    data: Partial<Pick<PartRead, "description" | "material" | "process">>,
  ): Promise<PartRead> =>
    fetch(`/api/sqc/parts/${partId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<PartRead>;
    }),

  updateDim: (
    partId: string,
    dimId: string,
    data: Partial<{
      dim_name: string | null;
      drawing_revision: string | null;
      nominal: number;
      tol_plus: number;
      tol_minus: number | null;
    }>,
  ): Promise<DimRead> =>
    fetch(`/api/sqc/parts/${partId}/dims/${dimId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<DimRead>;
    }),

  importDims: (partId: string, file: File): Promise<DimImportResult> => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/sqc/parts/${partId}/import-dims`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
      return res.json() as Promise<DimImportResult>;
    });
  },

  previewImportDims: (partId: string, file: File): Promise<DimImportPreview> => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/sqc/parts/${partId}/import-dims-preview`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<DimImportPreview>;
    });
  },

  deleteDim: (partId: string, dimId: string): Promise<void> =>
    fetch(`/api/sqc/parts/${partId}/dims/${dimId}`, {
      method: "DELETE",
    }).then(async (res) => {
      if (!res.ok) {
        throw await parseApiError(res);
      }
    }),

  getAxisRelations: (partId: string, dimId: string): Promise<DimAxisRelation[]> =>
    fetchJson<DimAxisRelation[]>(`/api/sqc/parts/${partId}/dims/${dimId}/relations`),

  createAxisRelation: (
    partId: string,
    dimId: string,
    data: DimAxisRelationCreate,
  ): Promise<DimAxisRelation> =>
    fetch(`/api/sqc/parts/${partId}/dims/${dimId}/relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<DimAxisRelation>;
    }),

  updateAxisRelation: (
    partId: string,
    dimId: string,
    relationId: string,
    data: DimAxisRelationUpdate,
  ): Promise<DimAxisRelation> =>
    fetch(`/api/sqc/parts/${partId}/dims/${dimId}/relations/${relationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<DimAxisRelation>;
    }),

  deleteAxisRelation: (partId: string, dimId: string, relationId: string): Promise<void> =>
    fetch(`/api/sqc/parts/${partId}/dims/${dimId}/relations/${relationId}`, {
      method: "DELETE",
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
    }),

  previewMeasurements: (
    batchId: string,
    file: File,
    sheetName?: string,
  ): Promise<MeasurementPreview> => {
    const form = new FormData();
    form.append("file", file);
    const qs = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
    return fetch(`/api/sqc/batches/${batchId}/import-preview${qs}`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<MeasurementPreview>;
    });
  },

  getCavities: (batchId: string) => fetchJson<number[]>(`/api/sqc/batches/${batchId}/cavities`),

  listReports: (batchId: string) => fetchJson<number[]>(`/api/sqc/batches/${batchId}/reports`),

  getReportUrl: (batchId: string, partNumber: number) =>
    `/api/sqc/batches/${batchId}/reports/${partNumber}`,

  uploadReports: (
    batchId: string,
    files: File[],
  ): Promise<{ saved: number[]; errors: string[] }> => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return fetch(`/api/sqc/batches/${batchId}/reports/upload`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json();
    });
  },

  importMeasurements: (batchId: string, file: File, sheetName?: string): Promise<ImportResult> => {
    const form = new FormData();
    form.append("file", file);
    const qs = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
    return fetch(`/api/sqc/batches/${batchId}/import-measurements${qs}`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<ImportResult>;
    });
  },

  // ── spec 252 — Estatísticas agrupadas, export e ignore ───────────────────────

  getGroupedStatistics: (
    batchIds: string[],
    dimId: string,
    cavity?: number | null,
    tolPlusOverride?: number | null,
    tolMinusOverride?: number | null,
    nominalOverride?: number | null,
  ): Promise<GroupedStatisticsResponse> =>
    fetch("/api/sqc/batches/grouped-statistics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_ids: batchIds,
        dim_id: dimId,
        cavity: cavity ?? null,
        tol_plus_override: tolPlusOverride ?? null,
        tol_minus_override: tolMinusOverride ?? null,
        nominal_override: nominalOverride ?? null,
      }),
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<GroupedStatisticsResponse>;
    }),

  suggestGroupedTolerance: (
    batchIds: string[],
    dimId: string,
    targetCpk: number,
    cavity?: number | null,
  ): Promise<SuggestToleranceResponse> =>
    fetch("/api/sqc/batches/grouped-statistics/suggest-tolerance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_ids: batchIds,
        dim_id: dimId,
        cavity: cavity ?? null,
        target_cpk: targetCpk,
      }),
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<SuggestToleranceResponse>;
    }),

  /** Dispara o export. 404 => "nada para exportar" (FR-013), repassado como erro visível
   * em vez de um arquivo vazio. Extrai o filename do Content-Disposition para o download. */
  exportMeasurements: (
    batchIds: string[],
    dimId: string,
    cavity?: number | null,
    format: ExportFormat = "csv",
  ): Promise<{ blob: Blob; filename: string }> =>
    fetch("/api/sqc/batches/export-measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_ids: batchIds,
        dim_id: dimId,
        cavity: cavity ?? null,
        format,
      }),
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const filename = match?.[1] ?? `medicoes.${format}`;
      const blob = await res.blob();
      return { blob, filename };
    }),

  setInspectionIgnored: (
    batchId: string,
    dimId: string,
    inspectionId: string,
    ignored: boolean,
    reason?: string | null,
  ): Promise<InspectionIgnoreResponse> =>
    fetch(`/api/sqc/batches/${batchId}/dims/${dimId}/inspections/${inspectionId}/ignore`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignored, reason: reason ?? null }),
    }).then(async (res) => {
      if (!res.ok) throw await parseApiError(res);
      return res.json() as Promise<InspectionIgnoreResponse>;
    }),
};

/** Dispara o download de um Blob no browser via link <a> temporário. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
