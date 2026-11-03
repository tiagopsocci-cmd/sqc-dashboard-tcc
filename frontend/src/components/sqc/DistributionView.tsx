import { InfoTooltip } from "@/components/sqc/InfoTooltip";
import type { DistributionResponse } from "@/lib/sqc-api";
import { useState } from "react";
import Plot from "react-plotly.js";

const PALETTE = ["#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6", "#ec4899"];
const GREEN = "#22c55e";
const RED = "#ef4444";
const VIOLET = "#7c3aed";

interface BatchDist {
  label: string;
  trackingCode?: string;
  data: DistributionResponse;
}

interface Props {
  batches: BatchDist[];
  unit?: string;
}

type ViewMode = "raw" | "ratio" | "consolidated" | "direction_1" | "direction_2";

export function DistributionView({ batches, unit = "" }: Props) {
  // `null` = usuário ainda não escolheu nada nesta sessão de visualização — distinto de
  // "raw" explícito (clique em "Bruto (PolyWorks)"), senão os dois casos se confundem e o
  // botão "Bruto" nunca consegue ficar selecionado quando isRectangle (ver effectiveView).
  const [view, setView] = useState<ViewMode | null>(null);

  if (batches.length === 0) return null;

  // `batches.length === 0` bails above, so [0] always exists.
  // `batches.length === 0` bails above, so [0] always exists.
  const primary = (batches[0] as BatchDist).data;
  const isMulti = batches.length > 1;
  const showRatio =
    primary.has_bonus &&
    (isMulti
      ? batches.some((b) => b.data.ratio_kde != null)
      : !!(primary.ratio_histogram && primary.ratio_kde));
  const activeRatio = showRatio && view === "ratio";

  // RECTANGLE (spec 060, FR-029) — Consolidado (padrão)/Direção 1/Direção 2, todas
  // utilização não negativa, mais "Bruto (PolyWorks)" para ver a fonte de rastreabilidade.
  // Mutuamente exclusivo com o ratio MMC/LMC legado (CIRCULAR).
  const isRectangle = primary.consolidated != null;
  // Sem escolha explícita do usuário (`view === null`), o padrão é "Consolidado" quando
  // RECTANGLE e "Valores brutos" nos demais casos — depois disso, respeita o que foi clicado,
  // incluindo "Bruto (PolyWorks)" explicitamente.
  const effectiveView: ViewMode = view ?? (isRectangle ? "consolidated" : "raw");
  const activeRectangle = isRectangle && effectiveView !== "raw" && effectiveView !== "ratio";
  const rectangleField = (d: DistributionResponse) =>
    effectiveView === "direction_1"
      ? d.direction_1
      : effectiveView === "direction_2"
        ? d.direction_2
        : d.consolidated;

  // ── Modo ratio normalizado (MMC/LMC) ────────────────────────────────────────
  let refLines: { x: number; label: string; color: string }[];
  let traces: Plotly.Data[];
  let xAxisTitle: string;
  let chartTitle: string;

  if (activeRatio) {
    refLines = [{ x: 1.0, label: "USL (ratio)", color: RED }];
    xAxisTitle = "Ratio (valor / USL efetivo)";

    if (!isMulti) {
      // Single-lote: histograma + curva Weibull no eixo secundário
      const rh = primary.ratio_histogram ?? { bin_edges: [], counts: [] };
      const rk = primary.ratio_kde ?? { x: [], y: [] };
      const binWidth =
        rh.bin_edges.length > 1 ? (rh.bin_edges[1] as number) - (rh.bin_edges[0] as number) : 0.1;
      const binCenters = rh.bin_edges
        .slice(0, -1)
        .map((e, i) => e + ((rh.bin_edges[i + 1] as number) - e) / 2);
      traces = [
        {
          x: binCenters,
          y: rh.counts,
          type: "bar",
          name: "Frequência",
          marker: { color: VIOLET, opacity: 0.4 },
          width: binWidth * 0.9,
        },
        {
          x: rk.x,
          y: rk.y,
          type: "scatter",
          mode: "lines",
          name: "Weibull",
          yaxis: "y2",
          line: { color: VIOLET, width: 2 },
        },
      ];
      chartTitle = "Distribuição do Ratio Normalizado — MMC/LMC (Weibull)";
    } else {
      // Multi-lote: KDEs sobrepostas por lote
      traces = [];
      batches.forEach(({ label, data }, idx) => {
        if (!data.ratio_kde) return;
        const color = PALETTE[idx % PALETTE.length];
        traces.push({
          x: data.ratio_kde.x,
          y: data.ratio_kde.y,
          type: "scatter",
          mode: "lines",
          name: label,
          line: { color, width: 2 },
          fill: "tozeroy",
          fillcolor: `${color}18`,
        } as Plotly.Data);
      });
      chartTitle = "Ratio Normalizado por Lote — MMC/LMC (Weibull)";
    }
  } else if (activeRectangle) {
    // ── Modo RECTANGLE: Consolidado/Direção 1/Direção 2 (utilização não negativa) ──
    const viewLabel =
      effectiveView === "direction_1"
        ? (primary.direction_1_axis ?? "Direção 1")
        : effectiveView === "direction_2"
          ? (primary.direction_2_axis ?? "Direção 2")
          : "Consolidado";
    refLines = [{ x: 1.0, label: "Limite (U=1)", color: RED }];
    xAxisTitle = "Utilização (U = desvio / limite efetivo)";

    if (!isMulti) {
      const series = rectangleField(primary);
      const hist = series?.histogram ?? { bin_edges: [], counts: [] };
      const kde = series?.kde ?? { x: [], y: [] };
      const binWidth =
        hist.bin_edges.length > 1
          ? (hist.bin_edges[1] as number) - (hist.bin_edges[0] as number)
          : 0.1;
      const binCenters = hist.bin_edges
        .slice(0, -1)
        .map((e, i) => e + ((hist.bin_edges[i + 1] as number) - e) / 2);
      traces = [
        {
          x: binCenters,
          y: hist.counts,
          type: "bar",
          name: "Frequência",
          marker: { color: VIOLET, opacity: 0.4 },
          width: binWidth * 0.9,
        },
        {
          x: kde.x,
          y: kde.y,
          type: "scatter",
          mode: "lines",
          name: "Weibull",
          yaxis: "y2",
          line: { color: VIOLET, width: 2 },
        },
      ];
      chartTitle = `Distribuição da Utilização — ${viewLabel} (Weibull)`;
    } else {
      traces = [];
      batches.forEach(({ label, data }, idx) => {
        const series = rectangleField(data);
        if (!series) return;
        const color = PALETTE[idx % PALETTE.length];
        traces.push({
          x: series.kde.x,
          y: series.kde.y,
          type: "scatter",
          mode: "lines",
          name: label,
          line: { color, width: 2 },
          fill: "tozeroy",
          fillcolor: `${color}18`,
        } as Plotly.Data);
      });
      chartTitle = `Utilização por Lote — ${viewLabel} (Weibull)`;
    }
  } else {
    // ── Modo padrão (valores brutos) ───────────────────────────────────────────
    refLines = [
      ...(primary.usl !== null ? [{ x: primary.usl, label: "USL", color: RED }] : []),
      ...(primary.lsl !== null ? [{ x: primary.lsl, label: "LSL", color: RED }] : []),
      { x: primary.nominal, label: "Nom", color: GREEN },
    ];
    traces = [];
    batches.forEach(({ label, data }, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      if (!isMulti) {
        const binWidth =
          data.histogram.bin_edges.length > 1
            ? (data.histogram.bin_edges[1] as number) - (data.histogram.bin_edges[0] as number)
            : 1;
        const binCenters = data.histogram.bin_edges
          .slice(0, -1)
          .map((e, i) => e + ((data.histogram.bin_edges[i + 1] as number) - e) / 2);
        const isWeibull = data.distribution_type === "weibull";
        const curveLabel = isWeibull
          ? `Weibull (k=${data.weibull_k?.toFixed(2)}, λ=${data.weibull_scale?.toFixed(3)})`
          : "KDE (Normal)";
        traces.push({
          x: binCenters,
          y: data.histogram.counts,
          type: "bar",
          name: "Frequência",
          marker: { color: "#71717a", opacity: 0.5 },
          width: binWidth * 0.9,
        });
        traces.push({
          x: data.kde.x,
          y: data.kde.y,
          type: "scatter",
          mode: "lines",
          name: curveLabel,
          yaxis: "y2",
          line: { color: isWeibull ? "#f59e0b" : "#3b82f6", width: 2 },
        });
      } else {
        traces.push({
          x: data.kde.x,
          y: data.kde.y,
          type: "scatter",
          mode: "lines",
          name: label,
          line: { color, width: 2 },
          fill: "tozeroy",
          fillcolor: `${color}18`,
        } as Plotly.Data);
      }
    });
    xAxisTitle = unit ? `Valor medido (${unit})` : "Valor medido";
    chartTitle = isMulti
      ? "Distribuição por Lote (KDE)"
      : primary.distribution_type === "weibull"
        ? "Distribuição — Cota Geométrica (Weibull)"
        : "Distribuição (KDE)";
  }

  const shapes = refLines.map(({ x, color }) => ({
    type: "line" as const,
    x0: x,
    x1: x,
    yref: "paper" as const,
    y0: 0,
    y1: 1,
    line: { color, dash: "dash" as const, width: 1.5 },
  }));

  const annotations = refLines.map(({ x, label, color }) => ({
    x,
    yref: "paper" as const,
    y: 1.04,
    text: label,
    showarrow: false,
    font: { color, size: 11 },
  }));

  const layout: Partial<Plotly.Layout> = {
    title: { text: chartTitle, font: { size: 13 } },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 50, b: 40, l: 50, r: isMulti ? 20 : 50 },
    showlegend: isMulti,
    bargap: 0.05,
    shapes,
    annotations,
    xaxis: { title: { text: xAxisTitle }, gridcolor: "#e4e4e7" },
    yaxis: { title: { text: isMulti ? "Densidade" : "Frequência" }, gridcolor: "#e4e4e7" },
    ...(!isMulti
      ? {
          yaxis2: { overlaying: "y", side: "right", showgrid: false, title: { text: "Densidade" } },
        }
      : {}),
    legend: { orientation: "h", y: -0.15, font: { size: 11 } },
  };

  function formatP(p: number): string {
    return p < 0.001 ? "< 0.001" : p.toFixed(3);
  }

  const hasNormalityTest = (d: DistributionResponse) =>
    d.distribution_type === "normal" && d.is_normal !== null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {showRatio && (
        <div className="mb-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          {(["raw", "ratio"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                effectiveView === v
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {v === "raw" ? "Valores brutos" : "Ratio normalizado"}
            </button>
          ))}
        </div>
      )}
      {isRectangle && (
        <div className="mb-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          {(
            [
              { id: "consolidated" as const, label: "Consolidado" },
              ...(primary.direction_1_axis
                ? [{ id: "direction_1" as const, label: `Direção ${primary.direction_1_axis}` }]
                : []),
              ...(primary.direction_2_axis
                ? [{ id: "direction_2" as const, label: `Direção ${primary.direction_2_axis}` }]
                : []),
              { id: "raw" as const, label: "Bruto (PolyWorks)" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setView(o.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                effectiveView === o.id
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <Plot
        data={traces}
        layout={layout}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: 320 }}
        useResizeHandler
      />

      {/* Lote único — chip inline */}
      {!isMulti && hasNormalityTest(primary) && (
        <div className="mt-2 flex items-center gap-2 px-1 text-xs text-slate-500">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              primary.is_normal ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {primary.is_normal ? "Normal" : "Não-normal"}
          </span>
          <span>
            Shapiro-Wilk: W&nbsp;=&nbsp;{(primary.normality_stat ?? 0).toFixed(3)}&ensp;
            p&nbsp;=&nbsp;
            {formatP(primary.normality_p ?? 0)}&ensp; (n&nbsp;=&nbsp;{primary.n})
          </span>
          <InfoTooltip
            align="right"
            title="Teste de Normalidade (Shapiro-Wilk)"
            what="Verifica se as medições seguem uma distribuição normal (curva em sino). Isso importa porque os índices Cp e Cpk assumem normalidade — se os dados não forem normais, esses índices podem ser imprecisos."
            formula={
              "W: varia de 0 a 1. Quanto mais próximo de 1,\nmais os dados se aproximam de uma curva normal.\n\np-value: probabilidade de observar esses dados\nse eles fossem normais. Abaixo de 0,05 há\nevidência estatística de não-normalidade."
            }
            thresholds={[
              {
                label: "p ≥ 0,05",
                color: "green",
                description:
                  "Sem evidência contra normalidade — distribuição compatível com curva em sino.",
              },
              {
                label: "p < 0,05",
                color: "amber",
                description:
                  "Dados divergem da curva normal — avalie o histograma e interprete Cp/Cpk com cautela.",
              },
            ]}
            note="Em amostras pequenas (n < 20) o teste tem baixo poder detectivo. Sempre avalie o histograma visualmente."
          />
        </div>
      )}

      {/* Multi-lote — tabela de referência (sempre) + normalidade (quando disponível) */}
      {isMulti && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 px-2 text-left font-medium w-10">Ref</th>
                <th className="py-1 px-2 text-left font-medium">Tracking Code</th>
                <th className="py-1 px-2 text-center font-medium">n</th>
                {batches.some(({ data }) => hasNormalityTest(data)) && (
                  <>
                    <th className="py-1 px-2 text-center font-medium">W</th>
                    <th className="py-1 px-2 text-center font-medium">p-value</th>
                    <th className="py-1 px-2 text-center font-medium">
                      <span className="inline-flex items-center gap-1">
                        Shapiro-Wilk
                        <InfoTooltip
                          align="right"
                          title="Teste de Normalidade (Shapiro-Wilk)"
                          what="Verifica se as medições seguem uma distribuição normal (curva em sino). Isso importa porque os índices Cp e Cpk assumem normalidade — se os dados não forem normais, esses índices podem ser imprecisos."
                          formula={
                            "W: varia de 0 a 1. Quanto mais próximo de 1,\nmais os dados se aproximam de uma curva normal.\n\np-value: probabilidade de observar esses dados\nse eles fossem normais. Abaixo de 0,05 há\nevidência estatística de não-normalidade."
                          }
                          thresholds={[
                            {
                              label: "p ≥ 0,05",
                              color: "green",
                              description:
                                "Sem evidência contra normalidade — distribuição compatível com curva em sino.",
                            },
                            {
                              label: "p < 0,05",
                              color: "amber",
                              description:
                                "Dados divergem da curva normal — avalie o histograma e interprete Cp/Cpk com cautela.",
                            },
                          ]}
                          note="Em amostras pequenas (n < 20) o teste tem baixo poder detectivo. Sempre avalie o histograma visualmente."
                        />
                      </span>
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {batches.map(({ label, trackingCode, data }, idx) => {
                const color = PALETTE[idx % PALETTE.length];
                const hasTest = hasNormalityTest(data);
                return (
                  <tr key={label} className="border-t border-slate-50">
                    <td className="py-1 px-2">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold"
                        style={{ background: color }}
                      >
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-1 px-2 font-mono text-slate-700">{trackingCode ?? label}</td>
                    <td className="py-1 px-2 text-center text-slate-500">{data.n}</td>
                    {batches.some(({ data: d }) => hasNormalityTest(d)) && (
                      <>
                        <td className="py-1 px-2 text-center text-slate-500">
                          {hasTest ? (data.normality_stat ?? 0).toFixed(3) : "—"}
                        </td>
                        <td className="py-1 px-2 text-center text-slate-500">
                          {hasTest ? formatP(data.normality_p ?? 0) : "—"}
                        </td>
                        <td className="py-1 px-2 text-center">
                          {hasTest ? (
                            <span
                              className={`rounded px-1.5 py-0.5 font-medium ${data.is_normal ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}
                            >
                              {data.is_normal ? "Normal" : "Não-normal"}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
