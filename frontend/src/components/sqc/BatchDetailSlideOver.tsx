import { CavitySelector } from "@/components/sqc/CavitySelector";
import { ControlChart } from "@/components/sqc/ControlChart";
import { CoordinateScatterChart } from "@/components/sqc/CoordinateScatterChart";
import { DetailsTable } from "@/components/sqc/DetailsTable";
import { DimInfoBar, type TolOverride } from "@/components/sqc/DimInfoBar";
import { DistributionView } from "@/components/sqc/DistributionView";
import { NqaCard } from "@/components/sqc/NqaCard";
import {
  type ProfileChildOverride,
  ProfileDeviationChart,
} from "@/components/sqc/ProfileDeviationChart";
import { ProfileDistributionChart } from "@/components/sqc/ProfileDistributionChart";
import { ProfileSigmaStats } from "@/components/sqc/ProfileSigmaStats";
import { RectangleZoneChart } from "@/components/sqc/RectangleZoneChart";
import { StatCards } from "@/components/sqc/StatCards";
import { type SingleTabId, getSingleTabs, isRectanglePosition } from "@/components/sqc/sqc-tabs";
import { type DimRead, sqcApi } from "@/lib/sqc-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type ActiveTab = SingleTabId;

interface Props {
  batchId: string;
  partId: string;
  dimId: string;
  dim: DimRead;
  trackingCode: string;
  onClose: () => void;
}

function Skeleton() {
  return <div className="h-40 animate-pulse rounded-lg bg-slate-100" />;
}

function Err({ msg }: { msg: string }) {
  return <p className="text-sm text-red-500 py-4">{msg}</p>;
}

export function BatchDetailSlideOver({
  batchId,
  partId,
  dimId,
  dim,
  trackingCode,
  onClose,
}: Props) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>("stats");
  const [tolOverride, setTolOverride] = useState<TolOverride | null>(null);
  const [profileChildOverride, setProfileChildOverride] = useState<ProfileChildOverride | null>(
    null,
  );
  const [selectedCavity, setSelectedCavity] = useState<number | null>(null);
  const [openReportPart, setOpenReportPart] = useState<number | null>(null);
  const [selectedPartNumber, setSelectedPartNumber] = useState<number | null>(null);

  // Detecção de tipo de filhos
  const childCodes = (dim.children ?? []).map((c) => c.dim_code.toUpperCase());
  const hasCoordChildren = childCodes.some(
    (c) => c.endsWith("_X") || c.endsWith("_Y") || c.endsWith("_Z"),
  );
  const hasProfileChildren = childCodes.some((c) => c.endsWith("_MAX") || c.endsWith("_MIN"));
  const isRectangle = isRectanglePosition(dim);

  // Escape key handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Resetar overrides ao mudar de dimensão (via dimId)
  // biome-ignore lint/correctness/useExhaustiveDependencies: dimId é o gatilho intencional do reset
  useEffect(() => {
    setTolOverride(null);
    setProfileChildOverride(null);
    setSelectedCavity(null);
    setOpenReportPart(null);
    setActiveTab("stats");
    setSelectedPartNumber(null);
  }, [dimId]);

  const tolPlus = tolOverride?.plus;
  const tolMinus = tolOverride?.minus != null ? tolOverride.minus : undefined;
  const cavityParam = selectedCavity ?? undefined;

  const cavitiesQuery = useQuery({
    queryKey: ["sqc", "cavities", batchId],
    queryFn: () => sqcApi.getCavities(batchId),
    staleTime: 60_000,
  });
  const availableCavities = cavitiesQuery.data ?? [];

  const batchQuery = useQuery({
    queryKey: ["sqc", "batches", partId],
    queryFn: () => sqcApi.listBatches({ part_id: partId }),
    enabled: !!partId,
  });
  const batch = batchQuery.data?.find((item) => item.id === batchId);

  const statsQuery = useQuery({
    queryKey: ["sqc", "statistics", batchId, dimId, tolOverride, selectedCavity],
    queryFn: () => sqcApi.getStatistics(batchId, dimId, tolPlus, tolMinus, cavityParam),
    enabled: activeTab === "stats",
  });

  const chartQuery = useQuery({
    queryKey: ["sqc", "control-chart", batchId, dimId, tolOverride, selectedCavity],
    queryFn: () => sqcApi.getControlChart(batchId, dimId, tolPlus, tolMinus, cavityParam),
    enabled: activeTab === "charts",
  });

  const distQuery = useQuery({
    queryKey: ["sqc", "distribution", batchId, dimId, tolOverride, selectedCavity],
    queryFn: () => sqcApi.getDistribution(batchId, dimId, tolPlus, tolMinus, cavityParam),
    enabled: activeTab === "distribution",
  });

  const detailsQuery = useQuery({
    queryKey: ["sqc", "inspections", batchId, dimId, tolOverride, selectedCavity],
    queryFn: () => sqcApi.getInspections(batchId, dimId, true, tolPlus, tolMinus, cavityParam),
    enabled: activeTab === "details" || activeTab === "profile",
  });

  const coordinatesQuery = useQuery({
    queryKey: ["sqc", "coordinates", batchId, dimId, tolPlus, selectedCavity],
    queryFn: () => sqcApi.getCoordinates(batchId, dimId, tolPlus, cavityParam),
    enabled:
      (activeTab === "profile" && hasCoordChildren) ||
      (activeTab === "rectangle_zone" && isRectangle),
  });

  const profileDistQuery = useQuery({
    queryKey: ["sqc", "profile-dist", batchId, dimId, selectedCavity],
    queryFn: () => sqcApi.getProfileDistribution(batchId, dimId, cavityParam),
    enabled: activeTab === "profile" && hasProfileChildren,
  });

  const reportsQuery = useQuery({
    queryKey: ["sqc", "reports", batchId],
    queryFn: () => sqcApi.listReports(batchId),
    enabled: activeTab === "details",
  });

  const reportPartsSet = new Set(reportsQuery.data ?? []);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click to close */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* painel */}
      <div className="w-[65vw] max-w-5xl flex flex-col bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Análise do Lote</p>
            <h2 className="text-base font-semibold text-slate-900 font-mono">{trackingCode}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              title="Fechar (Esc)"
              aria-label="Fechar painel"
            >
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" aria-hidden="true">
                <title>Fechar</title>
                <path
                  d="M12 4 4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* DimInfoBar */}
        <div className="px-5 py-2 border-b border-slate-100 flex-shrink-0">
          <DimInfoBar dim={dim} tolOverride={tolOverride} onTolChange={setTolOverride} />
        </div>

        {/* CavitySelector se múltiplas cavidades */}
        {availableCavities.length > 1 && (
          <div className="px-5 py-2 border-b border-slate-100 flex-shrink-0">
            <CavitySelector
              cavities={availableCavities}
              value={selectedCavity}
              onChange={setSelectedCavity}
            />
          </div>
        )}

        {/* abas — "Por Cavity" não é oferecida aqui (painel simplificado, sem CavityCompareTable) */}
        <div className="flex gap-1 px-5 py-2 border-b border-slate-200 flex-shrink-0">
          {getSingleTabs(dim, 0).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                activeTab === t.id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* conteúdo — scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ── Capabilidade ── */}
          {activeTab === "stats" && (
            <>
              {statsQuery.isLoading ? (
                <Skeleton />
              ) : statsQuery.error ? (
                <Err msg="Erro ao carregar estatísticas." />
              ) : statsQuery.data ? (
                <StatCards
                  data={statsQuery.data}
                  toleranceOverridden={statsQuery.data.tolerance_overridden}
                />
              ) : null}
              <NqaCard
                batchId={batchId}
                dimId={dimId}
                tolPlusOverride={tolPlus}
                tolMinusOverride={tolMinus}
                cavity={cavityParam}
              />
            </>
          )}

          {/* ── Carta de Controle ── */}
          {activeTab === "charts" &&
            (chartQuery.isLoading ? (
              <Skeleton />
            ) : chartQuery.error ? (
              <Err msg="Erro ao carregar carta de controle." />
            ) : chartQuery.data ? (
              <ControlChart data={chartQuery.data} />
            ) : null)}

          {/* ── Distribuição ── */}
          {activeTab === "distribution" &&
            (distQuery.isLoading ? (
              <Skeleton />
            ) : distQuery.error ? (
              <Err msg="Erro ao carregar distribuição." />
            ) : distQuery.data ? (
              <DistributionView batches={[{ label: "Lote", data: distQuery.data }]} />
            ) : null)}

          {/* ── Detalhes ── */}
          {activeTab === "details" &&
            (detailsQuery.isLoading ? (
              <Skeleton />
            ) : detailsQuery.error ? (
              <Err msg="Erro ao carregar detalhes." />
            ) : detailsQuery.data ? (
              <div className={openReportPart !== null ? "flex gap-4 items-start" : ""}>
                <div className={openReportPart !== null ? "w-1/2 min-w-0 shrink-0" : "w-full"}>
                  <DetailsTable
                    data={detailsQuery.data}
                    dim={dim}
                    tolOverride={tolOverride}
                    reportParts={reportsQuery.isSuccess ? reportPartsSet : undefined}
                    onOpenReport={setOpenReportPart}
                    selectedPartNumber={selectedPartNumber}
                    onSelectPartNumber={setSelectedPartNumber}
                    batchId={batchId}
                    dimId={dimId}
                    editable={batch?.batch_status === "IN_ANALYSIS"}
                    onInspectionIgnoreChange={(statistics) => {
                      queryClient.setQueryData(
                        ["sqc", "statistics", batchId, dimId, tolOverride, selectedCavity],
                        statistics,
                      );
                      queryClient.invalidateQueries({
                        queryKey: ["sqc", "inspections", batchId, dimId],
                      });
                      queryClient.invalidateQueries({ queryKey: ["sqc", "nqa", batchId, dimId] });
                      queryClient.invalidateQueries({ queryKey: ["sqc", "overview", batchId] });
                      queryClient.invalidateQueries({ queryKey: ["sqc", "heatmap"] });
                      queryClient.invalidateQueries({
                        queryKey: ["sqc", "control-chart", batchId, dimId],
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["sqc", "distribution", batchId, dimId],
                      });
                    }}
                  />
                </div>

                {openReportPart !== null && (
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
                      src={sqcApi.getReportUrl(batchId, openReportPart)}
                      className="w-full border-0"
                      style={{ height: 760 }}
                      title={`Relatório Peça ${openReportPart}`}
                    />
                  </div>
                )}
              </div>
            ) : null)}

          {/* ── Perfil: Coordenadas ── */}
          {activeTab === "profile" &&
            hasCoordChildren &&
            (coordinatesQuery.isLoading ? (
              <Skeleton />
            ) : coordinatesQuery.error ? (
              <Err msg="Erro ao carregar coordenadas." />
            ) : coordinatesQuery.data ? (
              <CoordinateScatterChart data={coordinatesQuery.data} />
            ) : null)}

          {/* ── Perfil: Desvio de Perfil ── */}
          {activeTab === "profile" &&
            hasProfileChildren &&
            (detailsQuery.isLoading ? (
              <Skeleton />
            ) : detailsQuery.error ? (
              <Err msg="Erro ao carregar dados de perfil." />
            ) : detailsQuery.data ? (
              <div className="space-y-4">
                <ProfileDeviationChart
                  data={detailsQuery.data}
                  dim={dim}
                  tolOverride={tolOverride}
                  profileChildOverride={profileChildOverride}
                  onProfileChildOverride={setProfileChildOverride}
                />
                <ProfileSigmaStats
                  data={detailsQuery.data}
                  dim={dim}
                  tolOverride={tolOverride}
                  profileChildOverride={profileChildOverride}
                  distData={profileDistQuery.data ?? null}
                />
                {profileDistQuery.isLoading && <Skeleton />}
                {profileDistQuery.data && <ProfileDistributionChart data={profileDistQuery.data} />}
              </div>
            ) : null)}

          {/* ── Zona 2D (RECTANGLE) ── */}
          {activeTab === "rectangle_zone" &&
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
        </div>
      </div>
    </div>
  );
}
