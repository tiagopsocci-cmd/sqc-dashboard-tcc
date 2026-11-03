import type { TolOverride } from "@/components/sqc/DimInfoBar";
import { InspectionIgnoreToggle } from "@/components/sqc/InspectionIgnoreToggle";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import {
  type DimRead,
  type InspectionRow,
  type InspectionsDetailResponse,
  type StatisticsResponse,
  sqcApi,
} from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";
import { ListFilter } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

interface Props {
  data: InspectionsDetailResponse;
  dim?: DimRead;
  tolOverride?: TolOverride | null;
  reportParts?: Set<number>;
  onOpenReport?: (partNumber: number) => void;
  /** Seleção de peça sincronizada com outras visualizações (FR-025) — quando presente, a
   * linha correspondente é auto-expandida; manualmente expandir uma linha também notifica. */
  selectedPartNumber?: number | null;
  onSelectPartNumber?: (partNumber: number) => void;
  /** Lote/dimensão da consulta atual — necessários para o PATCH de ignore (spec 252, FR-006).
   * Quando omitidos, a coluna de desconsideração não é exibida. */
  batchId?: string;
  dimId?: string;
  /** Somente lotes em análise permitem desconsiderar ou restaurar medições. */
  editable?: boolean;
  /** Chamado com a `statistics` recalculada embutida na resposta do PATCH, para o chamador
   * atualizar o restante da tela sem reload manual (SC-003). */
  onInspectionIgnoreChange?: (statistics: StatisticsResponse) => void;
}

type ColumnKind = "numeric-range" | "value-checklist";

interface ColumnDef {
  id: string;
  label: string;
  kind: ColumnKind;
  getValue: (row: InspectionRow) => number | string | null;
}

type ColumnFilterValue = { excluded: Set<string> } | { min: number | null; max: number | null };

interface SortState {
  columnId: string | null;
  direction: "asc" | "desc";
}

const NO_VALUE_LABEL = "—";

function PdfIcon({ available, onClick }: { available: boolean; onClick?: () => void }) {
  if (!available) {
    return (
      <span title="Relatório não disponível" className="text-slate-300 cursor-default select-none">
        <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor" aria-hidden="true">
          <title>PDF indisponível</title>
          <path d="M4 0h6l4 4v11a1 1 0 01-1 1H3a1 1 0 01-1-1V1a1 1 0 011-1zm5.5 0v4h3L9.5 0zM5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z" />
        </svg>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ver relatório PolyWorks"
      className="text-red-500 hover:text-red-700 transition-colors cursor-pointer"
    >
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor" aria-hidden="true">
        <title>Ver PDF</title>
        <path d="M4 0h6l4 4v11a1 1 0 01-1 1H3a1 1 0 01-1-1V1a1 1 0 011-1zm5.5 0v4h3L9.5 0zM5 7h6v1H5V7zm0 2h6v1H5V9zm0 2h4v1H5v-1z" />
      </svg>
    </button>
  );
}

function TolBar({
  value,
  warning,
  limit,
}: {
  value: number;
  warning: number | undefined;
  limit: number | undefined;
}) {
  if (!Number.isFinite(value)) return <span className="text-xs text-slate-400">∞%</span>;
  const color =
    limit != null && value > limit
      ? "bg-red-500"
      : warning != null && value > warning
        ? "bg-amber-400"
        : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-2 rounded-md bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-md ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span
        className={`text-xs tabular-nums font-medium ${limit != null && value > limit ? "text-red-600" : warning != null && value > warning ? "text-amber-600" : "text-slate-600"}`}
      >
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

function dev(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(3);
}

function f(v: number): string {
  return v.toFixed(3);
}

/** Valor efetivo (lado +) de tolerância usado para ordenação/filtro da coluna Tolerância. */
function tolEffectivePlus(
  dim: DimRead | undefined,
  bonus: number,
  tolOverride?: TolOverride | null,
): number | null {
  if (!dim) return null;
  const activePlus = tolOverride?.plus ?? dim.tol_plus;
  return activePlus + bonus;
}

function uncertaintyZoneLabel(zone: string | null): string | null {
  if (!zone) return null;
  return zone === "approved_at_risk" ? "Aprovada em risco" : "Reprovada recuperável";
}

/** Célula de tolerância com três variações de exibição. */
function TolCell({
  dim,
  bonus,
  tolOverride,
}: { dim?: DimRead; bonus: number; tolOverride?: TolOverride | null }) {
  if (!dim) return <span className="text-slate-400 text-xs">—</span>;

  const activePlus = tolOverride?.plus ?? dim.tol_plus;
  const activeMinus = tolOverride != null ? tolOverride.minus : dim.tol_minus;
  const isOverridden = !!tolOverride;

  const isUnilateral = activeMinus == null || activeMinus === 0;
  const hasBonus = bonus > 0;

  const cls = isOverridden ? "text-amber-700" : "";

  if (isUnilateral) {
    const effTol = activePlus + bonus;
    return hasBonus ? (
      <span className={`tabular-nums text-xs ${cls}`}>
        {f(effTol)} <span className="text-slate-400">(B: {f(bonus)})</span>
      </span>
    ) : (
      <span className={`tabular-nums text-xs ${cls}`}>{f(activePlus)}</span>
    );
  }

  // Bilateral
  const tolMinus = Math.abs(activeMinus ?? 0);
  const effPlus = activePlus + bonus;
  const effMinus = tolMinus + bonus;

  return hasBonus ? (
    <span className={`tabular-nums text-xs ${cls}`}>
      <span className="text-blue-600">+{f(effPlus)}</span>
      <span className="text-slate-300 mx-1">/</span>
      <span className="text-red-500">−{f(effMinus)}</span>
      <span className="text-slate-400 ml-1">(B: {f(bonus)})</span>
    </span>
  ) : (
    <span className={`tabular-nums text-xs ${cls}`}>
      <span className={isOverridden ? "text-amber-700" : "text-blue-600"}>+{f(activePlus)}</span>
      <span className="text-slate-300 mx-1">/</span>
      <span className={isOverridden ? "text-amber-700" : "text-red-500"}>−{f(tolMinus)}</span>
    </span>
  );
}

/** Expansão auditável por peça (FR-024), exclusiva de posições RECTANGLE — para as demais
 * dims (CIRCULAR, distância, perfil etc.) todo campo que apareceria aqui já tem coluna
 * própria na linha principal (X/Y/Z, Desvio MAX/MIN, bônus dentro de Tolerância), então a
 * expansão não existe para elas. */
function RowExpansionPanel({
  row,
  thresholds,
}: {
  row: InspectionRow;
  thresholds: { tolerance_warning_pct?: number; tolerance_limit_pct?: number } | undefined;
}) {
  if (!row.directions || row.directions.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {row.conforming == null
          ? "Diagnóstico direcional incompleto — peça não avaliável por este critério."
          : row.critical_axis
            ? `Direção crítica: ${row.critical_axis === "both" ? "ambas" : row.critical_axis}`
            : null}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {row.directions.map((d) => {
          const isCritical = row.critical_axis === d.axis || row.critical_axis === "both";
          return (
            <div
              key={d.axis}
              className={`space-y-1.5 rounded border p-2 text-xs ${
                isCritical ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-700">Direção {d.axis}</p>
                {d.related_size_dim_code && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {d.related_size_dim_code}
                    {d.material_condition ? ` · ${d.material_condition}` : ""}
                  </span>
                )}
              </div>
              <TolBar
                value={d.utilization * 100}
                warning={thresholds?.tolerance_warning_pct}
                limit={thresholds?.tolerance_limit_pct}
              />
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
                <p>
                  Nominal/Medido: {d.nominal.toFixed(3)} / {d.measured.toFixed(3)}
                </p>
                <p>Desvio: {dev(d.deviation)}</p>
                <p>Bônus: {d.bonus.toFixed(3)}</p>
                <p>
                  Limite base/efetivo: {d.base_limit.toFixed(3)} / {d.effective_limit.toFixed(3)}
                </p>
                {d.measured_size != null && <p>Tamanho medido: {d.measured_size.toFixed(3)}</p>}
                {d.related_size_nominal != null && (
                  <p className="col-span-2">
                    Tolerância do tamanho: {d.related_size_nominal.toFixed(3)} +
                    {(d.related_size_tol_plus ?? 0).toFixed(3)} / -
                    {(d.related_size_tol_minus ?? 0).toFixed(3)}
                    {d.related_size_deviation != null &&
                      ` (desvio: ${d.related_size_deviation.toFixed(3)})`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DetailsTable({
  data,
  dim,
  tolOverride,
  reportParts,
  onOpenReport,
  selectedPartNumber,
  onSelectPartNumber,
  batchId,
  dimId,
  editable = true,
  onInspectionIgnoreChange,
}: Props) {
  const thresholds = useCapabilityThresholds();
  const { data: instruments = [] } = useQuery({
    queryKey: ["instruments"],
    queryFn: sqcApi.listInstruments,
    staleTime: 5 * 60_000,
  });

  const [sort, setSort] = useState<SortState>({ columnId: null, direction: "asc" });
  const [filters, setFilters] = useState<Record<string, ColumnFilterValue>>({});
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set());
  // Sobrepõe o estado de ignore localmente após um PATCH, até a query pai refazer o fetch —
  // evita esperar um round-trip de refetch para refletir o toggle (SC-003).
  const [ignoreOverrides, setIgnoreOverrides] = useState<
    Record<string, { isIgnored: boolean; ignoredReason: string | null }>
  >({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: limpa overrides locais quando a query pai troca de dados (novo lote/dim)
  useEffect(() => {
    setIgnoreOverrides({});
  }, [data]);

  // Auto-expande a peça sincronizada vinda de outra visualização (ex.: Zona 2D), FR-025.
  useEffect(() => {
    if (selectedPartNumber == null) return;
    setExpandedParts((prev) => {
      if (prev.has(selectedPartNumber)) return prev;
      const next = new Set(prev);
      next.add(selectedPartNumber);
      return next;
    });
  }, [selectedPartNumber]);

  const instrumentNameByCode = Object.fromEntries(
    instruments.map((i) => [i.code.toLowerCase(), i.name]),
  );

  function instrumentLabel(code: string | null | undefined): string {
    if (!code) return "—";
    return instrumentNameByCode[code.toLowerCase()] ?? code;
  }

  function handleSort(columnId: string) {
    setSort((prev) => {
      if (prev.columnId !== columnId) return { columnId, direction: "asc" };
      if (prev.direction === "asc") return { columnId, direction: "desc" };
      return { columnId: null, direction: "asc" };
    });
  }

  function toggleChecklistValue(columnId: string, value: string) {
    setFilters((prev) => {
      const current = prev[columnId];
      const excluded = new Set(current && "excluded" in current ? current.excluded : []);
      if (excluded.has(value)) excluded.delete(value);
      else excluded.add(value);
      if (excluded.size === 0) {
        const rest = { ...prev };
        delete rest[columnId];
        return rest;
      }
      return { ...prev, [columnId]: { excluded } };
    });
  }

  function setChecklistAll(columnId: string, allValues: string[], selectAll: boolean) {
    setFilters((prev) => {
      const rest = { ...prev };
      delete rest[columnId];
      if (selectAll) return rest;
      return { ...rest, [columnId]: { excluded: new Set(allValues) } };
    });
  }

  function setRangeFilter(columnId: string, min: number | null, max: number | null) {
    setFilters((prev) => {
      const rest = { ...prev };
      delete rest[columnId];
      if (min == null && max == null) return rest;
      return { ...rest, [columnId]: { min, max } };
    });
  }

  function clearColumnFilter(columnId: string) {
    setFilters((prev) => {
      const rest = { ...prev };
      delete rest[columnId];
      return rest;
    });
  }

  function clearAllFilters() {
    setFilters({});
  }

  if (data.rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-slate-400">
        Nenhuma medição encontrada.
      </div>
    );
  }

  // Detecta o tipo de filhos com base nos dim_codes das children
  const childCodes = (dim?.children ?? []).map((c) => c.dim_code.toUpperCase());
  const hasCoordChildren = childCodes.some(
    (c) => c.endsWith("_X") || c.endsWith("_Y") || c.endsWith("_Z"),
  );
  const hasProfileChildren = childCodes.some((c) => c.endsWith("_MAX") || c.endsWith("_MIN"));

  // RECTANGLE (spec 060, FR-024): as colunas planas X/Y/Z (inferidas por sufixo) dão lugar à
  // expansão por linha com o detalhamento por eixo (DirectionResult), já que a relação de
  // coordenada de uma posição RECTANGLE não depende de sufixo no dim_code (FR-033).
  const isRectangle = dim?.type === "POSITION" && dim?.zone_geometry === "RECTANGLE";

  // Quais eixos de coordenadas existem
  const hasX =
    !isRectangle &&
    data.has_children &&
    hasCoordChildren &&
    data.rows.some((r) => r.coord_x != null);
  const hasY =
    !isRectangle &&
    data.has_children &&
    hasCoordChildren &&
    data.rows.some((r) => r.coord_y != null);
  const hasZ =
    !isRectangle &&
    data.has_children &&
    hasCoordChildren &&
    data.rows.some((r) => r.coord_z != null);

  const hasCavity = data.rows.some((r) => r.cavity != null);
  const hasUncertainty = data.rows.some((r) => r.uncertainty_zone != null);
  const hasProfile = data.has_children && hasProfileChildren;
  function toggleExpanded(partNumber: number) {
    setExpandedParts((prev) => {
      const next = new Set(prev);
      if (next.has(partNumber)) next.delete(partNumber);
      else next.add(partNumber);
      return next;
    });
    onSelectPartNumber?.(partNumber);
  }

  function UncBadge({ zone, unc }: { zone: string | null; unc: number | null }) {
    if (!zone) return <span className="text-slate-300 text-xs">—</span>;
    const isRisk = zone === "approved_at_risk";
    const label = uncertaintyZoneLabel(zone);
    const uncStr = unc != null ? ` (±${unc.toFixed(4)})` : "";
    return (
      <span
        title={`${label}${uncStr}`}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold cursor-help
          ${isRisk ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}
      >
        {isRisk ? "!" : "?"}
      </span>
    );
  }

  // Colunas na ordem em que são renderizadas — usadas para ordenação e filtro.
  const columns: ColumnDef[] = [];
  if (reportParts !== undefined) {
    columns.push({
      id: "pdf",
      label: "PDF",
      kind: "value-checklist",
      getValue: (row) => (reportParts.has(row.part_number) ? "Disponível" : "Indisponível"),
    });
  }
  columns.push({
    id: "part_number",
    label: "Peça #",
    kind: "numeric-range",
    getValue: (row) => row.part_number,
  });
  if (hasCavity) {
    columns.push({
      id: "cavity",
      label: "Cav.",
      kind: "value-checklist",
      getValue: (row) => row.cavity,
    });
  }
  columns.push({
    id: "nominal",
    label: "Nominal",
    kind: "numeric-range",
    getValue: () => dim?.nominal ?? null,
  });
  columns.push({
    id: "measured_value",
    label: "Medido",
    kind: "numeric-range",
    getValue: (row) => row.measured_value,
  });
  columns.push({
    id: "tolerance",
    label: "Tolerância",
    kind: "numeric-range",
    getValue: (row) => tolEffectivePlus(dim, row.bonus, tolOverride),
  });
  columns.push({
    id: "deviation",
    label: "Desvio",
    kind: "numeric-range",
    getValue: (row) => row.deviation,
  });
  columns.push({
    id: "tolerance_used_pct",
    label: "% Tol.",
    kind: "numeric-range",
    getValue: (row) => row.tolerance_used_pct,
  });
  if (hasProfile) {
    columns.push({
      id: "point_max",
      label: "Desvio MAX",
      kind: "numeric-range",
      getValue: (row) => row.point_max,
    });
    columns.push({
      id: "point_min",
      label: "Desvio MIN",
      kind: "numeric-range",
      getValue: (row) => row.point_min,
    });
  }
  if (hasX) {
    columns.push({
      id: "coord_x",
      label: "X",
      kind: "numeric-range",
      getValue: (row) => row.coord_x,
    });
  }
  if (hasY) {
    columns.push({
      id: "coord_y",
      label: "Y",
      kind: "numeric-range",
      getValue: (row) => row.coord_y,
    });
  }
  if (hasZ) {
    columns.push({
      id: "coord_z",
      label: "Z",
      kind: "numeric-range",
      getValue: (row) => row.coord_z,
    });
  }
  if (hasUncertainty) {
    columns.push({
      id: "uncertainty_zone",
      label: "U",
      kind: "value-checklist",
      getValue: (row) => uncertaintyZoneLabel(row.uncertainty_zone),
    });
  }
  columns.push({
    id: "operator",
    label: "Operador",
    kind: "value-checklist",
    getValue: (row) => row.operator,
  });
  columns.push({
    id: "instrument",
    label: "Instrumento",
    kind: "value-checklist",
    getValue: (row) => instrumentLabel(row.instrument),
  });
  if (batchId && dimId) {
    columns.push({
      id: "is_ignored",
      label: editable ? "Desconsiderar" : "Situação",
      kind: "value-checklist",
      getValue: (row) =>
        (ignoreOverrides[row.id]?.isIgnored ?? row.is_ignored) ? "Desconsiderada" : "Válida",
    });
  }

  const columnById = new Map(columns.map((c) => [c.id, c]));

  function distinctValuesFor(col: ColumnDef): string[] {
    const values = new Set<string>();
    for (const row of data.rows) {
      const v = col.getValue(row);
      values.add(v == null ? NO_VALUE_LABEL : String(v));
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function filterRows(rows: InspectionRow[]): InspectionRow[] {
    const activeColumnIds = Object.keys(filters);
    if (activeColumnIds.length === 0) return rows;
    return rows.filter((row) =>
      activeColumnIds.every((columnId) => {
        const col = columnById.get(columnId);
        const filterValue = filters[columnId];
        if (!col || !filterValue) return true;
        const value = col.getValue(row);
        if ("excluded" in filterValue) {
          if (filterValue.excluded.size === 0) return true;
          return !filterValue.excluded.has(value == null ? NO_VALUE_LABEL : String(value));
        }
        const num = typeof value === "number" ? value : null;
        if (num == null) return true;
        if (filterValue.min != null && num < filterValue.min) return false;
        if (filterValue.max != null && num > filterValue.max) return false;
        return true;
      }),
    );
  }

  function sortRows(rows: InspectionRow[]): InspectionRow[] {
    if (!sort.columnId) return rows;
    const col = columnById.get(sort.columnId);
    if (!col) return rows;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.getValue(a);
      const vb = col.getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  const visibleRows = sortRows(filterRows(data.rows));
  const hasActiveFilters = Object.keys(filters).length > 0;

  function SortIcon({ columnId }: { columnId: string }) {
    if (sort.columnId !== columnId) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-slate-600 ml-1">{sort.direction === "asc" ? "↑" : "↓"}</span>;
  }

  function ColumnFilterControl({ col }: { col: ColumnDef }) {
    const current = filters[col.id];
    const isActive = !!current;

    if (col.kind === "value-checklist") {
      const values = distinctValuesFor(col);
      const excluded = current && "excluded" in current ? current.excluded : new Set<string>();
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-slate-200"
              title={`Filtrar ${col.label}`}
            >
              <ListFilter className={`w-3 h-3 ${isActive ? "text-blue-600" : "text-slate-300"}`} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 normal-case">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:underline"
                onClick={() => setChecklistAll(col.id, values, true)}
              >
                Selecionar tudo
              </button>
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:underline"
                onClick={() => setChecklistAll(col.id, values, false)}
              >
                Limpar
              </button>
            </div>
            <div className="max-h-52 space-y-1.5 overflow-auto">
              {values.map((v, idx) => {
                const inputId = `filter-${col.id}-${idx}`;
                return (
                  <label
                    key={v}
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-xs font-normal text-slate-600"
                  >
                    <Checkbox
                      id={inputId}
                      checked={!excluded.has(v)}
                      onCheckedChange={() => toggleChecklistValue(col.id, v)}
                    />
                    {v}
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    const range = current && "min" in current ? current : { min: null, max: null };
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-slate-200"
            title={`Filtrar ${col.label}`}
          >
            <ListFilter className={`w-3 h-3 ${isActive ? "text-blue-600" : "text-slate-300"}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-48 p-2 normal-case">
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`filter-${col.id}-min`}
              className="flex flex-col gap-1 text-xs font-normal text-slate-500"
            >
              Mínimo
              <Input
                id={`filter-${col.id}-min`}
                type="number"
                className="h-7 text-xs"
                defaultValue={range.min ?? ""}
                onBlur={(e) =>
                  setRangeFilter(
                    col.id,
                    e.target.value === "" ? null : Number(e.target.value),
                    range.max,
                  )
                }
              />
            </label>
            <label
              htmlFor={`filter-${col.id}-max`}
              className="flex flex-col gap-1 text-xs font-normal text-slate-500"
            >
              Máximo
              <Input
                id={`filter-${col.id}-max`}
                type="number"
                className="h-7 text-xs"
                defaultValue={range.max ?? ""}
                onBlur={(e) =>
                  setRangeFilter(
                    col.id,
                    range.min,
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="self-end text-xs font-medium text-blue-600 hover:underline"
              onClick={() => clearColumnFilter(col.id)}
            >
              Limpar
            </button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  function Th({
    col,
    align,
    title,
  }: {
    col: ColumnDef;
    align: "left" | "center" | "right";
    title?: string;
  }) {
    const alignClass =
      align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
    const justifyClass =
      align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
    return (
      <th
        className={`px-3 py-2 ${alignClass} text-xs font-semibold text-slate-500 uppercase`}
        title={title}
      >
        <div className={`flex items-center gap-1 ${justifyClass}`}>
          <button
            type="button"
            className="inline-flex cursor-pointer select-none items-center border-0 bg-transparent p-0 font-semibold text-xs text-slate-500 uppercase hover:text-slate-700"
            onClick={() => handleSort(col.id)}
          >
            {col.label}
            <SortIcon columnId={col.id} />
          </button>
          <ColumnFilterControl col={col} />
        </div>
      </th>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      {hasActiveFilters && (
        <div className="flex items-center justify-end border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
          <button
            type="button"
            className="text-xs font-medium text-blue-600 hover:underline"
            onClick={clearAllFilters}
          >
            Limpar filtros
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {isRectangle && <th className="w-8 px-1 py-2" aria-hidden="true" />}
              {columns.map((col) => {
                switch (col.id) {
                  case "pdf":
                    return <Th key={col.id} col={col} align="center" title="Relatório PolyWorks" />;
                  case "part_number":
                    return <Th key={col.id} col={col} align="left" />;
                  case "cavity":
                    return <Th key={col.id} col={col} align="center" />;
                  case "tolerance_used_pct":
                    return <Th key={col.id} col={col} align="center" />;
                  case "tolerance":
                    return <Th key={col.id} col={col} align="center" />;
                  case "uncertainty_zone":
                    return (
                      <Th
                        key={col.id}
                        col={col}
                        align="center"
                        title="Zona de incerteza do instrumento"
                      />
                    );
                  case "operator":
                  case "instrument":
                    return <Th key={col.id} col={col} align="left" />;
                  case "is_ignored":
                    return <Th key={col.id} col={col} align="center" />;
                  default:
                    return <Th key={col.id} col={col} align="right" />;
                }
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (isRectangle ? 1 : 0)}
                  className="px-3 py-8 text-center text-sm text-slate-400"
                >
                  Nenhuma linha corresponde aos filtros aplicados.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const pctVal = row.tolerance_used_pct;
                const rowWarn = pctVal > 100;
                const expanded = isRectangle && expandedParts.has(row.part_number);
                return (
                  <Fragment key={row.id}>
                    <tr className={rowWarn ? "bg-red-50" : undefined}>
                      {isRectangle && (
                        <td className="px-1 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(row.part_number)}
                            title={expanded ? "Recolher detalhamento" : "Expandir detalhamento"}
                            className="text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            <svg
                              viewBox="0 0 12 12"
                              className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            >
                              <title>{expanded ? "Recolher" : "Expandir"}</title>
                              <path d="M4 2l4 4-4 4" />
                            </svg>
                          </button>
                        </td>
                      )}
                      {reportParts !== undefined && (
                        <td className="px-3 py-2 text-center">
                          <PdfIcon
                            available={reportParts.has(row.part_number)}
                            onClick={
                              reportParts.has(row.part_number)
                                ? () => onOpenReport?.(row.part_number)
                                : undefined
                            }
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 tabular-nums">{row.part_number}</td>
                      {hasCavity && (
                        <td className="px-3 py-2 text-center tabular-nums text-slate-500">
                          {row.cavity ?? "—"}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {dim ? f(dim.nominal) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {row.measured_value.toFixed(3)}
                          {row.is_outlier_suggested && (
                            <span
                              title={row.outlier_reason ?? "Possível outlier (z-score modificado)"}
                              className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 cursor-help"
                            >
                              ⚠ outlier
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <TolCell dim={dim} bonus={row.bonus} tolOverride={tolOverride} />
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${row.deviation >= 0 ? "text-blue-600" : "text-red-600"}`}
                      >
                        {dev(row.deviation)}
                      </td>
                      <td className="px-3 py-2">
                        <TolBar
                          value={pctVal}
                          warning={thresholds.data?.tolerance_warning_pct}
                          limit={thresholds.data?.tolerance_limit_pct}
                        />
                      </td>
                      {hasProfile && (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {row.point_max != null ? dev(row.point_max) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {row.point_min != null ? dev(row.point_min) : "—"}
                          </td>
                        </>
                      )}
                      {hasX && (
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {row.coord_x != null ? dev(row.coord_x) : "—"}
                        </td>
                      )}
                      {hasY && (
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {row.coord_y != null ? dev(row.coord_y) : "—"}
                        </td>
                      )}
                      {hasZ && (
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {row.coord_z != null ? dev(row.coord_z) : "—"}
                        </td>
                      )}
                      {hasUncertainty && (
                        <td className="px-3 py-2 text-center">
                          <UncBadge zone={row.uncertainty_zone} unc={row.uncertainty} />
                        </td>
                      )}
                      <td className="px-3 py-2 text-slate-500">{row.operator ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {instrumentLabel(row.instrument)}
                      </td>
                      {batchId && dimId && (
                        <td className="px-3 py-2 text-center">
                          {editable ? (
                            <InspectionIgnoreToggle
                              batchId={batchId}
                              dimId={dimId}
                              inspectionId={row.id}
                              isIgnored={ignoreOverrides[row.id]?.isIgnored ?? row.is_ignored}
                              ignoredReason={
                                ignoreOverrides[row.id]?.ignoredReason ?? row.ignored_reason
                              }
                              onUpdated={(result) => {
                                setIgnoreOverrides((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    isIgnored: result.isIgnored,
                                    ignoredReason: result.ignoredReason,
                                  },
                                }));
                                onInspectionIgnoreChange?.(result.statistics);
                              }}
                            />
                          ) : (ignoreOverrides[row.id]?.isIgnored ?? row.is_ignored) ? (
                            <span
                              className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                              title={
                                ignoreOverrides[row.id]?.ignoredReason ??
                                row.ignored_reason ??
                                undefined
                              }
                            >
                              Desconsiderada
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Válida</span>
                          )}
                        </td>
                      )}
                    </tr>
                    {/* `expanded` só é true quando isRectangle, condição em que a coluna do
                        chevron sempre existe — por isso o colSpan soma +1 aqui. */}
                    {expanded && (
                      <tr>
                        <td colSpan={columns.length + 1} className="bg-slate-50 px-6 py-3">
                          <RowExpansionPanel row={row} thresholds={thresholds.data} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
