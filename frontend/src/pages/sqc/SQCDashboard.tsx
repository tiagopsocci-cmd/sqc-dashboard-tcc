import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { BatchDetailSlideOver } from "@/components/sqc/BatchDetailSlideOver";
import { BatchHeatmapChart } from "@/components/sqc/BatchHeatmapChart";
import { BatchMultiSelect } from "@/components/sqc/BatchMultiSelect";
import { BatchOverviewTable } from "@/components/sqc/BatchOverviewTable";
import { BatchSelector } from "@/components/sqc/BatchSelector";
import { CapabilityCompareTable } from "@/components/sqc/CapabilityCompareTable";
import { CavityCompareTable } from "@/components/sqc/CavityCompareTable";
import { CavitySelector } from "@/components/sqc/CavitySelector";
import { ControlChart } from "@/components/sqc/ControlChart";
import { CoordinateScatterChart } from "@/components/sqc/CoordinateScatterChart";
import { CoordinateTrendChart } from "@/components/sqc/CoordinateTrendChart";
import { DetailsTable } from "@/components/sqc/DetailsTable";
import { DimInfoBar, type TolOverride } from "@/components/sqc/DimInfoBar";
import { DimSelector } from "@/components/sqc/DimSelector";
import { DistributionView } from "@/components/sqc/DistributionView";
import { ExportMeasurementsButton } from "@/components/sqc/ExportMeasurementsButton";
import { GroupedStatisticsView } from "@/components/sqc/GroupedStatisticsView";
import type { GroupedTolOverride } from "@/components/sqc/GroupedToleranceBar";
import { NqaCard } from "@/components/sqc/NqaCard";
import { PartSelector } from "@/components/sqc/PartSelector";
import {
  type ProfileChildOverride,
  ProfileDeviationChart,
} from "@/components/sqc/ProfileDeviationChart";
import { ProfileDistributionChart } from "@/components/sqc/ProfileDistributionChart";
import { ProfileSigmaStats } from "@/components/sqc/ProfileSigmaStats";
import { ProfileSigmaTable } from "@/components/sqc/ProfileSigmaTable";
import { ProfileTrendChart } from "@/components/sqc/ProfileTrendChart";
import { RectangleZoneChart } from "@/components/sqc/RectangleZoneChart";
import { StatCards } from "@/components/sqc/StatCards";
import { TrendView } from "@/components/sqc/TrendView";
import {
  type MultiTabId,
  type SingleTabId,
  getMultiTabs,
  getSingleTabs,
  isRectanglePosition,
} from "@/components/sqc/sqc-tabs";
import { type BatchRead, type DimRead, type DistributionResponse, sqcApi } from "@/lib/sqc-api";
import { dimUnitSuffix } from "@/lib/sqc-dim-unit";

type Mode = "single" | "multi";
type SingleTab = SingleTabId;
type MultiTab = MultiTabId;

export function SQCDashboard() {
  const search = useSearch({ strict: false }) as {
    mode: Mode;
    part: string | null;
    batch: string | null;
    batches: string | null;
    dim: string | null;
    tab: string | null;
    cavity: number | null;
  };
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function setSearch(patch: Partial<typeof search>) {
    // The dynamic module-based route tree can't give TanStack Router precise
    // per-route search types, so the reducer's shape has to be asserted here.
    navigate({
      search: (prev: typeof search) => ({ ...prev, ...patch }),
    } as Parameters<typeof navigate>[0]);
  }

  const mode = search.mode ?? "single";
  const singlePartId = search.mode === "single" ? (search.part ?? null) : null;
  const multiPartId = search.mode === "multi" ? (search.part ?? null) : null;
  const primaryBatchId = search.batch ?? null;
  const selectedBatchIds = search.batches ? search.batches.split(",").filter(Boolean) : [];
  const dimId = search.dim ?? null;
  const singleTab = (search.tab as SingleTab | null) ?? "stats";
  const multiTab = (search.tab as MultiTab | null) ?? "trend";
  const selectedCavity = search.cavity ?? null;

  // ── Estado local (não vai para URL) ──────────────────────────────────────
  const [selectedDim, setSelectedDim] = useState<DimRead | null>(null);
  const dimUnit = dimUnitSuffix(selectedDim?.type ?? "");
  const [showDrawing, setShowDrawing] = useState(false);
  const [tolOverride, setTolOverride] = useState<TolOverride | null>(null);
  const [groupedTolOverride, setGroupedTolOverride] = useState<GroupedTolOverride | null>(null);
  const [profileChildOverride, setProfileChildOverride] = useState<ProfileChildOverride | null>(
    null,
  );
  const [openReportPart, setOpenReportPart] = useState<number | null>(null);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  // Seleção de peça sincronizada entre "Zona 2D" e "Detalhes" (FR-025) — limpa ao trocar
  // lote/dimensão; ao trocar cavidade, só permanece se a peça continuar no conjunto filtrado
  // (checado abaixo assim que os dados da cavidade nova chegam).
  const [selectedPartNumber, setSelectedPartNumber] = useState<number | null>(null);

  // Resetar simulações ao trocar de dimensão
  // biome-ignore lint/correctness/useExhaustiveDependencies: dimId é o gatilho intencional do reset
  useEffect(() => {
    setTolOverride(null);
    setProfileChildOverride(null);
    setSelectedPartNumber(null);
    setGroupedTolOverride(null);
  }, [dimId]);
  // Resetar cavidade somente após uma troca real de lote. No primeiro render, a URL é a
  // fonte de verdade e pode trazer uma cavidade válida de um link compartilhado ou de um F5.
  const previousBatchId = useRef(primaryBatchId);
  useEffect(() => {
    if (previousBatchId.current === primaryBatchId) return;
    previousBatchId.current = primaryBatchId;
    navigate({
      search: (prev: typeof search) => ({ ...prev, cavity: null }),
    } as Parameters<typeof navigate>[0]);
    setSelectedPartNumber(null);
  }, [primaryBatchId, navigate]);
  // Resetar painel PDF ao trocar de lote ou dimensão
  // biome-ignore lint/correctness/useExhaustiveDependencies: primaryBatchId e dimId são gatilhos intencionais do reset
  useEffect(() => {
    setOpenReportPart(null);
  }, [primaryBatchId, dimId]);

  // Aliases por modo
  const partId = mode === "single" ? singlePartId : multiPartId;
  const effectiveBatchIds = selectedBatchIds;

  const ready =
    mode === "single" ? !!primaryBatchId && !!dimId : selectedBatchIds.length > 0 && !!dimId;

  // Mapa batchId → tracking_code (alimentado pelo BatchMultiSelect via batches query)
  // será inferido dentro do CapabilityCompareTable via sua própria query

  // ── SINGLE MODE queries ────────────────────────────────────────────────────

  // ── Query cavidades (sempre ativa quando há lote no modo single) ─────────────
  const cavitiesQuery = useQuery({
    queryKey: ["sqc", "cavities", primaryBatchId],
    queryFn: () => sqcApi.getCavities(primaryBatchId ?? ""),
    enabled: mode === "single" && !!primaryBatchId,
    staleTime: 60_000,
  });
  const availableCavities = cavitiesQuery.data ?? [];

  const cavityParam = selectedCavity ?? undefined;

  const statsQuery = useQuery({
    queryKey: ["sqc", "statistics", primaryBatchId, dimId, tolOverride, selectedCavity],
    queryFn: () =>
      sqcApi.getStatistics(
        primaryBatchId ?? "",
        dimId ?? "",
        tolOverride?.plus,
        tolOverride?.minus != null ? tolOverride.minus : undefined,
        cavityParam,
      ),
    enabled: ready && mode === "single" && singleTab === "stats",
  });

  const tolPlus = tolOverride?.plus;
  const tolMinus = tolOverride?.minus != null ? tolOverride.minus : undefined;

  const chartQuery = useQuery({
    queryKey: ["sqc", "control-chart", primaryBatchId, dimId, tolOverride, selectedCavity],
    queryFn: () =>
      sqcApi.getControlChart(primaryBatchId ?? "", dimId ?? "", tolPlus, tolMinus, cavityParam),
    enabled: ready && mode === "single" && singleTab === "charts",
  });

  const distSingleQuery = useQuery({
    queryKey: ["sqc", "distribution", primaryBatchId, dimId, tolOverride, selectedCavity],
    queryFn: () =>
      sqcApi.getDistribution(primaryBatchId ?? "", dimId ?? "", tolPlus, tolMinus, cavityParam),
    enabled: ready && mode === "single" && singleTab === "distribution",
  });

  const detailsQuery = useQuery({
    queryKey: ["sqc", "inspections", primaryBatchId, dimId, tolOverride, selectedCavity],
    queryFn: () =>
      sqcApi.getInspections(
        primaryBatchId ?? "",
        dimId ?? "",
        true,
        tolPlus,
        tolMinus,
        cavityParam,
      ),
    enabled: ready && mode === "single" && (singleTab === "details" || singleTab === "profile"),
  });

  // ── MULTI MODE queries ─────────────────────────────────────────────────────

  const multiCavityQueries = useQueries({
    queries: effectiveBatchIds.map((bid: string) => ({
      queryKey: ["sqc", "cavities", bid],
      queryFn: () => sqcApi.getCavities(bid),
      enabled: mode === "multi" && effectiveBatchIds.length > 0,
      staleTime: 60_000,
    })),
  });
  const multiCavitiesMap: Record<string, number[]> = Object.fromEntries(
    effectiveBatchIds.map((bid: string, i: number) => [bid, multiCavityQueries[i]?.data ?? []]),
  );
  const unionCavities = [...new Set(Object.values(multiCavitiesMap).flat())].sort((a, b) => a - b);

  const trendQuery = useQuery({
    queryKey: ["sqc", "trend", partId, dimId, effectiveBatchIds, selectedCavity],
    queryFn: () => sqcApi.getTrend(partId ?? "", dimId ?? "", effectiveBatchIds, cavityParam),
    enabled:
      !!partId && !!dimId && mode === "multi" && (multiTab === "trend" || multiTab === "xbar"),
  });

  const groupedStatsQuery = useQuery({
    queryKey: [
      "sqc",
      "grouped-statistics",
      dimId,
      effectiveBatchIds,
      selectedCavity,
      groupedTolOverride,
    ],
    queryFn: () =>
      sqcApi.getGroupedStatistics(
        effectiveBatchIds,
        dimId ?? "",
        cavityParam,
        groupedTolOverride?.tolPlus,
        groupedTolOverride?.tolMinus,
        groupedTolOverride?.nominal,
      ),
    enabled:
      !!dimId && mode === "multi" && multiTab === "grouped_stats" && effectiveBatchIds.length >= 2,
  });

  // Helper: detecta tipo de filhos da dim selecionada
  const childCodes = (selectedDim?.children ?? []).map((c) => c.dim_code.toUpperCase());
  const hasCoordChildren = childCodes.some(
    (c) => c.endsWith("_X") || c.endsWith("_Y") || c.endsWith("_Z"),
  );
  const hasProfileChildren = childCodes.some((c) => c.endsWith("_MAX") || c.endsWith("_MIN"));

  const profileTrendQuery = useQuery({
    queryKey: ["sqc", "profile-trend", partId, dimId, effectiveBatchIds, selectedCavity],
    queryFn: () =>
      sqcApi.getProfileTrend(partId ?? "", dimId ?? "", effectiveBatchIds, cavityParam),
    enabled:
      !!partId && !!dimId && mode === "multi" && multiTab === "profile_trend" && hasProfileChildren,
  });

  const overviewQuery = useQuery({
    queryKey: ["sqc", "overview", primaryBatchId, selectedCavity],
    queryFn: () => sqcApi.getBatchOverview(primaryBatchId ?? "", cavityParam),
    enabled: mode === "single" && !!primaryBatchId && !dimId,
  });

  // Lote completo (batch_status, campos editáveis) para o card "Visão Geral do Lote" —
  // BatchOverviewResponse acima só traz o semáforo por dimensão, não o BatchRead inteiro.
  const primaryBatchQuery = useQuery({
    queryKey: ["sqc", "batches", singlePartId],
    queryFn: () => sqcApi.listBatches({ part_id: singlePartId ?? undefined }),
    enabled: mode === "single" && !!singlePartId && !!primaryBatchId,
  });
  const primaryBatch = primaryBatchQuery.data?.find((b) => b.id === primaryBatchId);

  const drawingRevision =
    selectedDim?.drawing_revision ?? overviewQuery.data?.drawing_revision ?? null;
  const drawingQuery = useQuery({
    queryKey: ["sqc", "drawing", partId, drawingRevision],
    queryFn: () => sqcApi.getDrawingUrl(partId ?? "", drawingRevision ?? ""),
    enabled: !!partId && showDrawing && !!drawingRevision,
    retry: false,
  });

  const heatmapQuery = useQuery({
    queryKey: ["sqc", "heatmap", partId, effectiveBatchIds, selectedCavity],
    queryFn: () => sqcApi.getPartHeatmap(partId ?? "", effectiveBatchIds, cavityParam),
    enabled: mode === "multi" && !!partId && effectiveBatchIds.length > 0 && !dimId,
  });

  const allDimsQuery = useQuery({
    queryKey: ["sqc", "dims-all", partId],
    queryFn: () => sqcApi.listDims(partId ?? ""),
    enabled: !!partId && !dimId,
  });

  const isRectangle = isRectanglePosition(selectedDim);

  const coordinatesQuery = useQuery({
    queryKey: ["sqc", "coordinates", primaryBatchId, dimId, tolPlus, selectedCavity],
    queryFn: () => sqcApi.getCoordinates(primaryBatchId ?? "", dimId ?? "", tolPlus, cavityParam),
    enabled:
      ready &&
      mode === "single" &&
      ((singleTab === "profile" && hasCoordChildren) ||
        (singleTab === "rectangle_zone" && isRectangle)),
  });

  const profileDistQuery = useQuery({
    queryKey: ["sqc", "profile-dist", primaryBatchId, dimId, selectedCavity],
    queryFn: () => sqcApi.getProfileDistribution(primaryBatchId ?? "", dimId ?? "", cavityParam),
    enabled: ready && mode === "single" && singleTab === "profile" && hasProfileChildren,
  });

  const reportsQuery = useQuery({
    queryKey: ["sqc", "reports", primaryBatchId],
    queryFn: () => sqcApi.listReports(primaryBatchId ?? ""),
    enabled: mode === "single" && !!primaryBatchId,
    staleTime: 60_000,
  });
  const reportPartsSet = new Set(reportsQuery.data ?? []);

  const coordinateTrendQuery = useQuery({
    queryKey: ["sqc", "coordinate-trend", partId, dimId, effectiveBatchIds, selectedCavity],
    queryFn: () =>
      sqcApi.getCoordinateTrend(partId ?? "", dimId ?? "", effectiveBatchIds, cavityParam),
    enabled:
      !!partId && !!dimId && mode === "multi" && multiTab === "profile_trend" && hasCoordChildren,
  });

  const distMultiQueries = useQueries({
    queries: effectiveBatchIds.map((bid: string) => ({
      queryKey: ["sqc", "distribution", bid, dimId, selectedCavity],
      queryFn: () => sqcApi.getDistribution(bid, dimId ?? "", undefined, undefined, cavityParam),
      enabled: !!dimId && mode === "multi" && multiTab === "dist_compare",
    })),
  });

  // Reutiliza a mesma cache key do BatchMultiSelect para obter tracking codes
  const { data: allBatches = [] } = useQuery({
    queryKey: ["sqc", "batches"],
    queryFn: () => sqcApi.listBatches(),
    enabled: mode === "multi",
    staleTime: 60_000,
  });
  const batchTrackingMap = Object.fromEntries(
    allBatches.map((b: BatchRead) => [b.id, b.tracking_code]),
  );

  // Helpers
  function handleSinglePartChange(newPartId: string) {
    setSearch({ part: newPartId, batch: null, dim: null });
    setSelectedDim(null);
  }

  function handleBatchChange(newBatchId: string, newPartId: string) {
    setSearch({ batch: newBatchId, part: newPartId, dim: null });
    setSelectedDim(null);
  }

  function handleMultiPartChange(newPartId: string) {
    setSearch({ part: newPartId, batches: null, dim: null });
    setSelectedDim(null);
  }

  function handleModeSwitch(next: Mode) {
    setSearch({ mode: next, dim: null, tab: null });
    setSelectedDim(null);
  }

  const distMultiLoading = distMultiQueries.some((q) => q.isLoading);
  const distMultiData = distMultiQueries.every((q) => !!q.data)
    ? distMultiQueries.map((q, i) => {
        const bid = effectiveBatchIds[i];
        return {
          label: `L${i + 1}`,
          trackingCode: (bid != null ? batchTrackingMap[bid] : undefined) ?? bid,
          data: q.data as DistributionResponse,
        };
      })
    : null;

  // Mapa id → tracking_code para CapabilityCompareTable
  const batchLabels = Object.fromEntries(
    (trendQuery.data?.batches ?? []).map((b) => [b.batch_id, b.tracking_code]),
  );

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Controle Estatístico da Qualidade</h1>
            <p className="text-sm text-slate-500">
              Análise de capabilidade, estabilidade e desempenho do processo
            </p>
          </div>

          <div className="flex items-center gap-3">
            {partId && (
              <button
                type="button"
                onClick={() => setShowDrawing((v) => !v)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors ${
                  showDrawing
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Desenho
              </button>
            )}

            {/* Toggle de modo */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1">
              {(["single", "multi"] as Mode[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => handleModeSwitch(m)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    mode === m
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {m === "single" ? "Análise de Lote" : "Comparação de Lotes"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Seletores */}
        <div className="flex flex-wrap gap-4 items-end">
          {mode === "single" ? (
            <>
              <PartSelector
                selectedPartId={singlePartId ?? undefined}
                onPartChange={handleSinglePartChange}
              />
              {singlePartId && (
                <BatchSelector
                  onBatchChange={handleBatchChange}
                  selectedBatchId={primaryBatchId ?? undefined}
                  partId={singlePartId}
                />
              )}
            </>
          ) : (
            <>
              <PartSelector
                selectedPartId={multiPartId ?? undefined}
                onPartChange={handleMultiPartChange}
              />
              {multiPartId && (
                <BatchMultiSelect
                  partId={multiPartId}
                  selectedIds={selectedBatchIds}
                  onChange={(v) => setSearch({ batches: v.length > 0 ? v.join(",") : null })}
                />
              )}
            </>
          )}
          <DimSelector
            partId={partId}
            onDimChange={(id, dim) => {
              setSearch({ dim: id });
              setSelectedDim(dim);
            }}
            onDimClear={() => {
              setSearch({ dim: null });
              setSelectedDim(null);
            }}
            selectedDimId={dimId ?? undefined}
          />
          {mode === "single" && availableCavities.length > 1 && (
            <CavitySelector
              cavities={availableCavities}
              value={selectedCavity}
              onChange={(v) => setSearch({ cavity: v })}
            />
          )}
          {mode === "multi" && unionCavities.length > 0 && (
            <CavitySelector
              cavities={unionCavities}
              value={selectedCavity}
              onChange={(v) => setSearch({ cavity: v })}
            />
          )}
        </div>

        {/* Info bar da dimensão */}
        {selectedDim && (
          <DimInfoBar dim={selectedDim} tolOverride={tolOverride} onTolChange={setTolOverride} />
        )}

        {/* Painel do desenho técnico */}
        {showDrawing && partId && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <span className="text-sm font-semibold text-slate-800">Desenho Técnico</span>
                {drawingRevision && (
                  <span className="ml-2 text-xs text-slate-400">rev. {drawingRevision}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDrawing(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Fechar"
              >
                <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                  <title>Ícone</title>
                  <path
                    d="M12 4 4 12M4 4l8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="w-full" style={{ height: 720 }}>
              {!drawingRevision && (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Nenhum desenho cadastrado para esta peça.{" "}
                  <a href="/sqc/import" className="ml-1 underline hover:text-slate-700">
                    Importar
                  </a>
                </div>
              )}
              {drawingRevision && drawingQuery.isLoading && (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Carregando desenho…
                </div>
              )}
              {drawingRevision && drawingQuery.error && (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Nenhum desenho cadastrado para esta peça (rev. {drawingRevision}).{" "}
                  <a href="/sqc/import" className="ml-1 underline hover:text-slate-700">
                    Importar
                  </a>
                </div>
              )}
              {drawingQuery.data && (
                <iframe
                  src={drawingQuery.data.url}
                  className="w-full h-full border-0"
                  title="Desenho técnico"
                />
              )}
            </div>
          </div>
        )}

        {/* Visão geral quando lote selecionado mas sem dimensão */}
        {mode === "single" &&
          !!primaryBatchId &&
          !dimId &&
          (overviewQuery.isLoading || allDimsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : overviewQuery.data && allDimsQuery.data ? (
            <BatchOverviewTable
              data={overviewQuery.data}
              dims={allDimsQuery.data}
              batch={primaryBatch}
              onDimSelect={(id, dim) => {
                setSearch({ dim: id });
                setSelectedDim(dim);
              }}
              onBatchChanged={() => primaryBatchQuery.refetch()}
            />
          ) : null)}

        {mode === "multi" &&
          effectiveBatchIds.length > 0 &&
          !dimId &&
          (heatmapQuery.isLoading || allDimsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : heatmapQuery.data && allDimsQuery.data ? (
            <BatchHeatmapChart
              data={heatmapQuery.data}
              dims={allDimsQuery.data}
              onDimSelect={(id, dim) => {
                setSearch({ dim: id });
                setSelectedDim(dim);
              }}
            />
          ) : null)}

        {!ready &&
          !(mode === "single" && !!primaryBatchId && !dimId) &&
          !(mode === "multi" && effectiveBatchIds.length > 0 && !dimId) && (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
              {mode === "single"
                ? !singlePartId
                  ? "Selecione uma peça para começar."
                  : !primaryBatchId
                    ? "Selecione um lote."
                    : "Selecione uma dimensão para visualizar os indicadores."
                : selectedBatchIds.length === 0
                  ? "Selecione uma peça, ao menos um lote e uma dimensão para comparar."
                  : "Selecione uma dimensão para visualizar os indicadores."}
            </div>
          )}

        {ready && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-200">
              {(mode === "single"
                ? getSingleTabs(selectedDim, availableCavities.length)
                : getMultiTabs(selectedDim)
              ).map((t) => {
                const active = mode === "single" ? singleTab === t.id : multiTab === t.id;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setSearch({ tab: t.id })}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "border-b-2 border-slate-900 text-slate-900"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Conteúdo — modo SINGLE */}
            {mode === "single" && (
              <div>
                {singleTab === "stats" && (
                  <>
                    {statsQuery.isLoading ? (
                      <Skeleton />
                    ) : statsQuery.error ? (
                      <Err msg="Erro ao carregar estatísticas." />
                    ) : statsQuery.data ? (
                      <StatCards
                        data={statsQuery.data}
                        toleranceOverridden={statsQuery.data.tolerance_overridden}
                        unit={dimUnit}
                      />
                    ) : null}
                    {primaryBatchId && dimId && (
                      <NqaCard
                        batchId={primaryBatchId}
                        dimId={dimId}
                        tolPlusOverride={tolOverride?.plus}
                        tolMinusOverride={
                          tolOverride?.minus != null ? tolOverride.minus : undefined
                        }
                        cavity={cavityParam}
                      />
                    )}
                  </>
                )}
                {singleTab === "charts" &&
                  (chartQuery.isLoading ? (
                    <Skeleton />
                  ) : chartQuery.error ? (
                    <Err msg="Erro ao carregar carta de controle." />
                  ) : chartQuery.data ? (
                    <ControlChart data={chartQuery.data} unit={dimUnit} />
                  ) : null)}
                {singleTab === "distribution" &&
                  (distSingleQuery.isLoading ? (
                    <Skeleton />
                  ) : distSingleQuery.error ? (
                    <Err msg="Erro ao carregar distribuição." />
                  ) : distSingleQuery.data ? (
                    <DistributionView
                      batches={[{ label: "Lote", data: distSingleQuery.data }]}
                      unit={dimUnit}
                    />
                  ) : null)}
                {singleTab === "details" &&
                  (detailsQuery.isLoading ? (
                    <Skeleton />
                  ) : detailsQuery.error ? (
                    <Err msg="Erro ao carregar detalhes." />
                  ) : detailsQuery.data ? (
                    <div className={openReportPart !== null ? "flex gap-4 items-start" : ""}>
                      {/* Tabela — ocupa toda a largura ou metade quando PDF aberto */}
                      <div
                        className={openReportPart !== null ? "w-1/2 min-w-0 shrink-0" : "w-full"}
                      >
                        {primaryBatchId && dimId && (
                          <div className="mb-2 flex justify-end">
                            <ExportMeasurementsButton
                              batchIds={[primaryBatchId]}
                              dimId={dimId}
                              cavity={selectedCavity}
                            />
                          </div>
                        )}
                        <DetailsTable
                          key={`${primaryBatchId}-${selectedDim?.id ?? "none"}`}
                          data={detailsQuery.data}
                          dim={selectedDim ?? undefined}
                          tolOverride={tolOverride}
                          reportParts={reportsQuery.isSuccess ? reportPartsSet : undefined}
                          onOpenReport={setOpenReportPart}
                          selectedPartNumber={selectedPartNumber}
                          onSelectPartNumber={setSelectedPartNumber}
                          batchId={primaryBatchId ?? undefined}
                          dimId={dimId ?? undefined}
                          editable={primaryBatch?.batch_status === "IN_ANALYSIS"}
                          onInspectionIgnoreChange={(statistics) => {
                            queryClient.setQueryData(
                              [
                                "sqc",
                                "statistics",
                                primaryBatchId,
                                dimId,
                                tolOverride,
                                selectedCavity,
                              ],
                              statistics,
                            );
                            queryClient.invalidateQueries({
                              queryKey: ["sqc", "inspections", primaryBatchId, dimId],
                            });
                            queryClient.invalidateQueries({
                              queryKey: ["sqc", "nqa", primaryBatchId, dimId],
                            });
                            queryClient.invalidateQueries({
                              queryKey: ["sqc", "overview", primaryBatchId],
                            });
                            queryClient.invalidateQueries({
                              queryKey: ["sqc", "heatmap"],
                            });
                            queryClient.invalidateQueries({
                              queryKey: ["sqc", "control-chart", primaryBatchId, dimId],
                            });
                            queryClient.invalidateQueries({
                              queryKey: ["sqc", "distribution", primaryBatchId, dimId],
                            });
                          }}
                        />
                      </div>

                      {/* Painel PDF — aparece à direita */}
                      {openReportPart !== null && primaryBatchId && (
                        <div className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white overflow-hidden sticky top-4">
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                            <span className="text-sm font-semibold text-slate-700">
                              Relatório — Peça {openReportPart}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenReportPart(null)}
                              className="text-slate-400 hover:text-slate-700 transition-colors"
                              title="Fechar"
                            >
                              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                                <title>Ícone</title>
                                <path
                                  d="M12 4 4 12M4 4l8 8"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          </div>
                          <iframe
                            src={sqcApi.getReportUrl(primaryBatchId, openReportPart)}
                            className="w-full border-0"
                            style={{ height: 760 }}
                            title={`Relatório Peça ${openReportPart}`}
                          />
                        </div>
                      )}
                    </div>
                  ) : null)}
                {singleTab === "profile" &&
                  hasCoordChildren &&
                  (coordinatesQuery.isLoading ? (
                    <Skeleton />
                  ) : coordinatesQuery.error ? (
                    <Err msg="Erro ao carregar coordenadas." />
                  ) : coordinatesQuery.data ? (
                    <CoordinateScatterChart data={coordinatesQuery.data} />
                  ) : null)}
                {singleTab === "profile" &&
                  hasProfileChildren &&
                  (detailsQuery.isLoading ? (
                    <Skeleton />
                  ) : detailsQuery.error ? (
                    <Err msg="Erro ao carregar dados de perfil." />
                  ) : detailsQuery.data && selectedDim ? (
                    <div className="space-y-4">
                      <ProfileDeviationChart
                        data={detailsQuery.data}
                        dim={selectedDim}
                        tolOverride={tolOverride}
                        profileChildOverride={profileChildOverride}
                        onProfileChildOverride={setProfileChildOverride}
                      />
                      <ProfileSigmaStats
                        data={detailsQuery.data}
                        dim={selectedDim}
                        tolOverride={tolOverride}
                        profileChildOverride={profileChildOverride}
                        distData={profileDistQuery.data ?? null}
                      />
                      {profileDistQuery.isLoading && <Skeleton />}
                      {profileDistQuery.data && (
                        <ProfileDistributionChart data={profileDistQuery.data} />
                      )}
                    </div>
                  ) : null)}
                {singleTab === "rectangle_zone" &&
                  isRectangle &&
                  (coordinatesQuery.isLoading ? (
                    <Skeleton />
                  ) : coordinatesQuery.error ? (
                    <Err msg="Erro ao carregar zona 2D." />
                  ) : coordinatesQuery.data ? (
                    <RectangleZoneChart
                      data={coordinatesQuery.data}
                      selectedPartNumber={selectedPartNumber}
                      onSelectPartNumber={setSelectedPartNumber}
                    />
                  ) : null)}
                {singleTab === "cavity_compare" &&
                  primaryBatchId &&
                  dimId &&
                  availableCavities.length > 1 && (
                    <CavityCompareTable
                      batchId={primaryBatchId}
                      dimId={dimId}
                      cavities={availableCavities}
                      isUnilateral={selectedDim?.is_unilateral}
                    />
                  )}
              </div>
            )}

            {/* Conteúdo — modo MULTI */}
            {mode === "multi" && (
              <div>
                {multiTab === "trend" &&
                  (trendQuery.isLoading ? (
                    <Skeleton />
                  ) : trendQuery.error ? (
                    <Err msg="Erro ao carregar tendência." />
                  ) : trendQuery.data ? (
                    <TrendView data={trendQuery.data} unit={dimUnit} />
                  ) : null)}
                {multiTab === "xbar" &&
                  (trendQuery.isLoading ? (
                    <Skeleton />
                  ) : trendQuery.error ? (
                    <Err msg="Erro ao carregar carta X-bar." />
                  ) : trendQuery.data ? (
                    <ControlChart trendData={trendQuery.data} unit={dimUnit} />
                  ) : null)}
                {multiTab === "dist_compare" &&
                  (distMultiLoading ? (
                    <Skeleton />
                  ) : !distMultiData ? (
                    <Err msg="Erro ao carregar distribuições." />
                  ) : (
                    <DistributionView batches={distMultiData} unit={dimUnit} />
                  ))}
                {multiTab === "capability_compare" && !!dimId && effectiveBatchIds.length > 0 && (
                  <CapabilityCompareTable
                    batchIds={effectiveBatchIds}
                    batchLabels={batchTrackingMap}
                    dimId={dimId}
                    isUnilateral={selectedDim?.is_unilateral}
                    cavity={selectedCavity}
                    batchCavities={multiCavitiesMap}
                    onViewDetail={(bid) => setDetailBatchId(bid)}
                  />
                )}
                {multiTab === "grouped_stats" &&
                  !!dimId &&
                  (effectiveBatchIds.length < 2 ? (
                    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
                      Selecione ao menos 2 lotes para calcular a capabilidade agrupada.
                    </div>
                  ) : groupedStatsQuery.isLoading ? (
                    <Skeleton />
                  ) : groupedStatsQuery.error ? (
                    <Err msg="Erro ao carregar estatísticas agrupadas." />
                  ) : groupedStatsQuery.data ? (
                    <div className="space-y-3">
                      <div className="flex justify-end">
                        <ExportMeasurementsButton
                          batchIds={effectiveBatchIds}
                          dimId={dimId}
                          cavity={selectedCavity}
                        />
                      </div>
                      <GroupedStatisticsView
                        data={groupedStatsQuery.data}
                        unit={dimUnit}
                        dim={selectedDim ?? undefined}
                        batchIds={effectiveBatchIds}
                        cavity={selectedCavity}
                        tolOverride={groupedTolOverride}
                        onTolOverrideChange={setGroupedTolOverride}
                      />
                    </div>
                  ) : null)}
                {multiTab === "profile_trend" &&
                  hasCoordChildren &&
                  (coordinateTrendQuery.isLoading ? (
                    <Skeleton />
                  ) : coordinateTrendQuery.error ? (
                    <Err msg="Erro ao carregar tendência de coordenadas." />
                  ) : coordinateTrendQuery.data ? (
                    <CoordinateTrendChart
                      data={coordinateTrendQuery.data}
                      batchLabels={batchLabels}
                    />
                  ) : null)}
                {multiTab === "profile_trend" &&
                  hasProfileChildren &&
                  (profileTrendQuery.isLoading ? (
                    <Skeleton />
                  ) : profileTrendQuery.error ? (
                    <Err msg="Erro ao carregar tendência de perfil." />
                  ) : profileTrendQuery.data ? (
                    <div className="space-y-4">
                      <ProfileTrendChart
                        data={profileTrendQuery.data}
                        dim={selectedDim ?? undefined}
                      />
                      <ProfileSigmaTable
                        data={profileTrendQuery.data}
                        dim={selectedDim ?? undefined}
                      />
                    </div>
                  ) : null)}
              </div>
            )}
          </div>
        )}
      </div>

      {detailBatchId && selectedDim && dimId && (
        <BatchDetailSlideOver
          batchId={detailBatchId}
          partId={multiPartId ?? ""}
          dimId={dimId}
          dim={selectedDim}
          trackingCode={batchTrackingMap[detailBatchId] ?? detailBatchId}
          onClose={() => setDetailBatchId(null)}
        />
      )}
    </>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {msg}
    </div>
  );
}
