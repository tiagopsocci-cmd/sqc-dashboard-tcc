import type { ControlChartResponse, IChartSeries, TrendResponse } from "@/lib/sqc-api";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import {
  ChartLegend,
  type ChartLegendItem,
  type PinnedChartPoint,
  PinnedPointCard,
  hasRangeslider,
  sampleAxis,
  useIntegerSampleAxis,
} from "./ChartInteraction";
import { InfoTooltip } from "./InfoTooltip";

function ChartHeader({ title, tooltip }: { title: ReactNode; tooltip: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-1 mb-1">
      <span className="text-sm font-medium text-slate-700">{title}</span>
      {tooltip}
    </div>
  );
}

const ZINC = "#71717a";
const RED = "#ef4444";
const BLUE = "#3b82f6";
const AMBER = "#f59e0b";
const GREEN = "#22c55e";

interface Props {
  // Lote único: resposta do endpoint de control-chart
  data?: ControlChartResponse;
  // Multi-lote: dados de tendência com mean por lote → X-bar chart
  trendData?: TrendResponse;
  unit?: string;
}

type ChartSelection = "consolidated" | "raw" | "direction_1" | "direction_2";

// RECTANGLE (spec 060, FR-027) — seletor de direção; "Consolidado" (utilização normalizada,
// max(U_d1,U_d2)) é o padrão quando há modificador de material, "Bruto" é o valor próprio do
// PolyWorks (sem bônus, não comparável entre peças — mesma dualidade da Distribuição), e as
// direções são diagnóstico adicional.
function DirectionSelector({
  value,
  onChange,
  hasRaw,
  direction1Axis,
  direction2Axis,
}: {
  value: ChartSelection;
  onChange: (v: ChartSelection) => void;
  hasRaw: boolean;
  direction1Axis: string | null;
  direction2Axis: string | null;
}) {
  const options: { id: ChartSelection; label: string }[] = [
    { id: "consolidated", label: "Consolidado" },
    ...(hasRaw ? [{ id: "raw" as const, label: "Bruto (PolyWorks)" }] : []),
    ...(direction1Axis ? [{ id: "direction_1" as const, label: `Direção ${direction1Axis}` }] : []),
    ...(direction2Axis ? [{ id: "direction_2" as const, label: `Direção ${direction2Axis}` }] : []),
  ];
  return (
    <div className="flex gap-1 px-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.id
              ? "bg-slate-800 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ControlChart({ data, trendData, unit = "" }: Props) {
  const [selection, setSelection] = useState<ChartSelection>("consolidated");

  if (trendData) return <XbarMultiBatch trend={trendData} unit={unit} />;
  if (!data) return null;

  if (data.insufficient_data) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500">
        Dados insuficientes para gerar carta de controle.
      </div>
    );
  }

  const hasRaw = data.i_chart_raw != null;
  const hasDirections = data.i_chart_direction_1 != null || data.i_chart_direction_2 != null;
  const hasSelector = hasRaw || hasDirections;

  const consolidatedChart = data.i_chart ? (
    <IChart series={data.i_chart} unit={unit} />
  ) : data.xbar && data.r_chart ? (
    <XbarRChart data={data} unit={unit} />
  ) : null;

  const chart =
    selection === "raw" && data.i_chart_raw ? (
      <IChart series={data.i_chart_raw} unit={unit} />
    ) : selection === "direction_1" && data.i_chart_direction_1 ? (
      <IChart series={data.i_chart_direction_1} unit={unit} />
    ) : selection === "direction_2" && data.i_chart_direction_2 ? (
      <IChart series={data.i_chart_direction_2} unit={unit} />
    ) : (
      (consolidatedChart ??
      (data.i_chart_raw ? (
        <IChart series={data.i_chart_raw} unit={unit} />
      ) : data.i_chart_direction_1 ? (
        <IChart series={data.i_chart_direction_1} unit={unit} />
      ) : data.i_chart_direction_2 ? (
        <IChart series={data.i_chart_direction_2} unit={unit} />
      ) : null))
    );

  if (!hasSelector) return consolidatedChart;

  return (
    <div className="space-y-2">
      <DirectionSelector
        value={selection}
        onChange={setSelection}
        hasRaw={hasRaw}
        direction1Axis={data.direction_1_axis}
        direction2Axis={data.direction_2_axis}
      />
      {chart}
    </div>
  );
}

// ── X-bar Chart entre lotes (multi-lote) ──────────────────────────────────────

function XbarMultiBatch({ trend, unit = "" }: { trend: TrendResponse; unit?: string }) {
  if (trend.batches.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500">
        Selecione ao menos 2 lotes para visualizar a Carta X-bar entre lotes.
      </div>
    );
  }

  const batches = trend.batches;
  const means = batches.map((b) => b.mean);
  const shortLabels = batches.map((_, i) => `L${i + 1}`);

  // Grande média
  const grandMean = means.reduce((a, b) => a + b, 0) / means.length;

  // UCL/LCL via moving range (método AIAG para gráfico de médias individuais)
  const mrs = means.slice(1).map((m, i) => Math.abs(m - (means[i] ?? m)));
  const mrBar = mrs.length > 0 ? mrs.reduce((a, b) => a + b, 0) / mrs.length : 0;
  const d2 = 1.128;
  const sigma =
    mrBar > 0
      ? mrBar / d2
      : means.length >= 2
        ? Math.sqrt(means.reduce((s, m) => s + (m - grandMean) ** 2, 0) / (means.length - 1))
        : 0;
  const ucl = grandMean + 3 * sigma;
  const lcl = grandMean - 3 * sigma;

  const colors = means.map((m) => (m > ucl || m < lcl ? RED : BLUE));

  const hLine = (y: number, name: string, color: string, dash: Plotly.Dash) => ({
    x: [shortLabels[0], shortLabels[shortLabels.length - 1]] as string[],
    y: [y, y] as number[],
    mode: "lines" as const,
    name,
    line: { color, dash, width: 1.5 },
    hoverinfo: "name+y" as const,
  });

  const traces: Plotly.Data[] = [
    {
      x: shortLabels,
      y: means,
      mode: "lines+markers",
      name: "Média do lote",
      line: { color: BLUE, width: 2 },
      marker: { color: colors, size: 8 },
      customdata: batches.map((b) => b.tracking_code),
      hovertemplate: `<b>%{customdata}</b><br>Média: %{y:.4f}${unit}<extra></extra>`,
    },
    hLine(grandMean, `Grande Média (${grandMean.toFixed(3)}${unit})`, GREEN, "solid"),
    hLine(ucl, `UCL (${ucl.toFixed(3)}${unit})`, AMBER, "dash"),
    hLine(lcl, `LCL (${lcl.toFixed(3)}${unit})`, AMBER, "dash"),
  ];

  if (trend.usl !== null)
    traces.push(hLine(trend.usl, `USL (${trend.usl.toFixed(3)}${unit})`, RED, "dashdot"));
  if (trend.lsl !== null)
    traces.push(hLine(trend.lsl, `LSL (${trend.lsl.toFixed(3)}${unit})`, RED, "dashdot"));

  // Carta de Amplitudes Móveis (MR)
  const D4 = 3.267; // fator para n=2
  const uclMR = D4 * mrBar;
  const mrLabels = shortLabels.slice(1).map((l, i) => `${shortLabels[i]}→${l}`);
  const mrColors = mrs.map((r) => (r > uclMR ? RED : ZINC));

  const hLineMR = (y: number, name: string, color: string, dash: Plotly.Dash) => ({
    x: [mrLabels[0], mrLabels[mrLabels.length - 1]] as string[],
    y: [y, y] as number[],
    mode: "lines" as const,
    name,
    line: { color, dash, width: 1.5 },
    hoverinfo: "name+y" as const,
  });

  const mrTraces: Plotly.Data[] = [
    {
      x: mrLabels,
      y: mrs,
      mode: "lines+markers",
      name: "Amplitude móvel",
      line: { color: ZINC, width: 2 },
      marker: { color: mrColors, size: 8 },
      hovertemplate: `<b>%{x}</b><br>MR: %{y:.4f}${unit}<extra></extra>`,
    },
    hLineMR(mrBar, `Amplitude Móvel Média (${mrBar.toFixed(3)}${unit})`, GREEN, "solid"),
    hLineMR(uclMR, `UCL (${uclMR.toFixed(3)}${unit})`, AMBER, "dash"),
    hLineMR(0, `LCL (0.000${unit})`, AMBER, "dash"),
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-0">
      <ChartHeader
        title="Carta X̄ entre Lotes"
        tooltip={
          <InfoTooltip
            title="UCL / LCL — Carta X̄ entre Lotes"
            what="Controla a média de cada lote ao longo do tempo. A variabilidade σ é estimada pela amplitude móvel entre lotes consecutivos (método AIAG para observações individuais)."
            formula={
              "UCL = X̄̄ + 3σ̂\nLCL = X̄̄ − 3σ̂\n\nσ̂ = R̄MR / d₂\nd₂ = 1,128  (amplitude móvel, n = 2)\nFonte: AIAG SPC, 2ª ed."
            }
            thresholds={[
              {
                label: "Dentro",
                color: "green",
                description: "Lote com média dentro dos limites — processo estável.",
              },
              {
                label: "Fora de controle",
                color: "red",
                description: "Média do lote além dos limites — investigar causa especial.",
              },
            ]}
            align="left"
          />
        }
      />
      <Plot
        data={traces}
        layout={{
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 10, b: 60, l: 60, r: 20 },
          xaxis: { title: { text: "Lote" }, gridcolor: "#e4e4e7" },
          yaxis: { gridcolor: "#e4e4e7" },
          legend: { orientation: "h", y: -0.28, font: { size: 11 } },
          showlegend: true,
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: 380 }}
        useResizeHandler
      />

      <ChartHeader
        title="Carta de Amplitudes Móveis (MR)"
        tooltip={
          <InfoTooltip
            title="UCL — Carta MR"
            what="Controla a estabilidade da variância entre lotes consecutivos. A amplitude móvel é a diferença absoluta entre médias de dois lotes adjacentes."
            formula={
              "UCL = D₄ × R̄MR\nLCL = 0  (amplitude não pode ser negativa)\n\nD₄ = 3,267  (n = 2)\nFonte: AIAG SPC, 2ª ed."
            }
            thresholds={[
              {
                label: "Dentro",
                color: "green",
                description: "Variação entre lotes dentro do esperado.",
              },
              {
                label: "Fora de controle",
                color: "red",
                description: "Salto brusco entre dois lotes — investigar.",
              },
            ]}
            align="left"
          />
        }
      />
      <Plot
        data={mrTraces}
        layout={{
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 10, b: 60, l: 60, r: 20 },
          xaxis: { title: { text: "Intervalo entre Lotes" }, gridcolor: "#e4e4e7" },
          yaxis: { gridcolor: "#e4e4e7", rangemode: "tozero" },
          legend: { orientation: "h", y: -0.28, font: { size: 11 } },
          showlegend: true,
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: 300 }}
        useResizeHandler
      />

      {/* Tabela de referência dos lotes */}
      <div className="border-t border-slate-100 pt-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="py-1 px-2 text-left font-medium w-10">Ref</th>
              <th className="py-1 px-2 text-left font-medium">Tracking Code</th>
              <th className="py-1 px-2 text-center font-medium">Status</th>
              <th className="py-1 px-2 text-center font-medium">Peças</th>
              <th className="py-1 px-2 text-center font-medium">Média</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => {
              const mean = means[i] ?? 0;
              const outOfControl = mean > ucl || mean < lcl;
              return (
                <tr key={b.batch_id} className="border-t border-slate-50">
                  <td className="py-1 px-2">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold"
                      style={{ background: outOfControl ? RED : BLUE }}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-1 px-2 font-mono text-slate-700">{b.tracking_code}</td>
                  <td className="py-1 px-2 text-center">
                    {outOfControl ? (
                      <span className="rounded px-1.5 py-0.5 bg-red-100 text-red-700 font-medium">
                        Fora de controle
                      </span>
                    ) : (
                      <span className="rounded px-1.5 py-0.5 bg-emerald-50 text-emerald-700 font-medium">
                        OK
                      </span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-center text-slate-500">{b.n}</td>
                  <td className="py-1 px-2 text-center text-slate-600 font-mono">
                    {(means[i] ?? 0).toFixed(4)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── I-Chart (lote único — valores individuais) ────────────────────────────────

const AMBER_UNC = "#f59e0b"; // aprovada em risco
const BLUE_REC = "#60a5fa"; // reprovada recuperável

function IChart({ series, unit = "" }: { series: IChartSeries; unit?: string }) {
  const [pinned, setPinned] = useState<PinnedChartPoint | null>(null);
  const x = series.points.map((p) => p.index);
  const y = series.points.map((p) => p.measured_value);
  const showRangeslider = hasRangeslider(x.length);
  const colors = series.points.map((p) => {
    if (p.uncertainty_zone === "approved_at_risk") return AMBER_UNC;
    if (p.uncertainty_zone === "rejected_recoverable") return BLUE_REC;
    return p.out_of_control ? RED : BLUE;
  });

  const hasUncertaintyZones = series.points.some((p) => p.uncertainty_zone != null);

  const seriesKey = series.points.map((p) => `${p.index}:${p.measured_value}`).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when plotted values change
  useEffect(() => setPinned(null), [seriesKey]);

  const { dtick, onRelayout } = useIntegerSampleAxis(seriesKey);

  const hLine = (yv: number, name: string, color: string, dash: Plotly.Dash) => ({
    x: [x[0], x[x.length - 1]] as number[],
    y: [yv, yv] as number[],
    mode: "lines" as const,
    name,
    line: { color, dash, width: 1.5 },
    hoverinfo: "name+y" as const,
  });

  const traces: Plotly.Data[] = [
    {
      x,
      y,
      mode: "lines+markers",
      name: "Valor medido",
      line: { color: BLUE, width: 1.5 },
      marker: { color: colors, size: 6 },
      customdata: series.points.map((p) => [p.index, p.measured_value, p.out_of_control]),
      hovertemplate: `<b>Amostra %{customdata[0]}</b><br>Valor: %{customdata[1]:.4f}${unit}<extra></extra>`,
    },
    hLine(series.mean, `Média (${series.mean.toFixed(3)}${unit})`, BLUE, "solid"),
    hLine(series.ucl, `UCL (${series.ucl.toFixed(3)}${unit})`, AMBER, "dash"),
    hLine(series.lcl, `LCL (${series.lcl.toFixed(3)}${unit})`, AMBER, "dash"),
    hLine(series.nominal, `Nominal (${series.nominal.toFixed(3)}${unit})`, GREEN, "dot"),
  ];

  if (series.usl !== null)
    traces.push(hLine(series.usl, `USL nominal (${series.usl.toFixed(3)}${unit})`, RED, "dashdot"));
  if (series.lsl !== null)
    traces.push(hLine(series.lsl, `LSL nominal (${series.lsl.toFixed(3)}${unit})`, RED, "dashdot"));

  // Limites efetivos variáveis (bônus MMC/LMC)
  if (series.has_bonus) {
    const effUsl = series.points.map((p) => p.effective_usl ?? series.usl ?? series.ucl);
    const effLsl = series.points.map((p) => p.effective_lsl ?? series.lsl ?? series.lcl);
    traces.push({
      x,
      y: effUsl,
      mode: "lines",
      name: "USL efetivo (MMC/LMC)",
      line: { color: "#dc2626", dash: "dot", width: 1.5 },
      hovertemplate: "USL efetivo: %{y:.4f}<extra></extra>",
    });
    traces.push({
      x,
      y: effLsl,
      mode: "lines",
      name: "LSL efetivo (MMC/LMC)",
      line: { color: "#dc2626", dash: "dot", width: 1.5 },
      hovertemplate: "LSL efetivo: %{y:.4f}<extra></extra>",
      showlegend: false,
    });
  }

  const legendItems: ChartLegendItem[] = (traces as Partial<Plotly.ScatterData>[])
    .filter((t) => t.showlegend !== false && typeof t.name === "string")
    .map((t) => ({
      label: t.name as string,
      color: t.line?.color as string,
      dash: t.line?.dash as ChartLegendItem["dash"],
    }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      {hasUncertaintyZones && (
        <div className="flex flex-wrap gap-3 text-xs px-1">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: AMBER_UNC }} />
            <span className="text-slate-600">Aprovada em risco (incerteza)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: BLUE_REC }} />
            <span className="text-slate-600">Reprovada recuperável (incerteza)</span>
          </span>
        </div>
      )}
      <ChartHeader
        title="I-Chart — Valores Individuais"
        tooltip={
          <InfoTooltip
            title="UCL / LCL — I-Chart"
            what="Limites calculados com ±3 desvios-padrão amostrais sobre as medições individuais do lote. Pontos além dos limites indicam causa especial de variação."
            formula={
              "UCL = X̄ + 3σ\nLCL = X̄ − 3σ\n\nσ = desvio-padrão amostral (ddof = 1)\nFonte: AIAG SPC, 2ª ed."
            }
            thresholds={[
              {
                label: "Dentro",
                color: "green",
                description: "Ponto entre LCL e UCL — variação comum esperada.",
              },
              {
                label: "Fora de controle",
                color: "red",
                description: "Ponto além dos limites — investigue causa especial.",
              },
            ]}
            align="left"
          />
        }
      />
      <ChartLegend items={legendItems} />
      <Plot
        data={traces}
        layout={{
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 10, b: showRangeslider ? 90 : 50, l: 60, r: 20 },
          xaxis: {
            title: { text: "Nº da Amostra" },
            gridcolor: "#e4e4e7",
            ...sampleAxis(x.length, dtick),
          },
          yaxis: { gridcolor: "#e4e4e7" },
          showlegend: false,
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: showRangeslider ? 400 : 360 }}
        useResizeHandler
        onRelayout={onRelayout}
        onClick={(event) => {
          const point = event.points[0];
          if (!point || point.curveNumber !== 0) return;
          const values = point.customdata as unknown as [number, number, boolean] | undefined;
          if (!values) return;
          setPinned({
            sampleNumber: values[0],
            value: values[1],
            valueLabel: "Valor medido",
            details: values[2] ? "Fora de controle" : "Dentro dos limites",
          });
        }}
      />
      {pinned && <PinnedPointCard point={pinned} onClose={() => setPinned(null)} />}
    </div>
  );
}

// ── Xbar-R Chart (subgrupos dentro do lote) ───────────────────────────────────

function XbarRChart({ data, unit = "" }: { data: ControlChartResponse; unit?: string }) {
  const n = data.subgroup_size;
  const [pinned, setPinned] = useState<PinnedChartPoint | null>(null);

  const dataKey = [data.xbar, data.r_chart]
    .map((series) => series?.points.map((p) => `${p.part_number}:${p.value}`).join(",") ?? "")
    .join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when plotted values change
  useEffect(() => setPinned(null), [dataKey]);

  const xbarAxis = useIntegerSampleAxis(dataKey);
  const rAxis = useIntegerSampleAxis(dataKey);

  const makeChart = (
    series: ControlChartResponse["xbar"],
    title: string,
    tooltip: ReactNode,
    axis: ReturnType<typeof useIntegerSampleAxis>,
  ) => {
    if (!series) return null;
    const x = series.points.map((p) => p.part_number);
    const y = series.points.map((p) => p.value);
    const colors = series.points.map((p) => (p.out_of_control ? RED : ZINC));
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <ChartHeader title={title} tooltip={tooltip} />
        <Plot
          data={[
            {
              x,
              y,
              mode: "lines+markers",
              name: title,
              line: { color: ZINC },
              marker: { color: colors, size: 7 },
              customdata: series.points.map((p) => [p.part_number, p.value, p.out_of_control]),
              hovertemplate: `<b>Peça %{customdata[0]}</b><br>Valor: %{customdata[1]:.4f}${unit}<extra></extra>`,
            },
            {
              x: [x[0] ?? 0, x[x.length - 1] ?? 0],
              y: [series.ucl, series.ucl],
              mode: "lines",
              name: "UCL",
              line: { color: RED, dash: "dash" },
            },
            {
              x: [x[0] ?? 0, x[x.length - 1] ?? 0],
              y: [series.center_line, series.center_line],
              mode: "lines",
              name: "CL",
              line: { color: AMBER, dash: "dot" },
            },
            {
              x: [x[0] ?? 0, x[x.length - 1] ?? 0],
              y: [series.lcl, series.lcl],
              mode: "lines",
              name: "LCL",
              line: { color: RED, dash: "dash" },
            },
          ]}
          layout={{
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            margin: { t: 10, b: 40, l: 50, r: 20 },
            showlegend: false,
            xaxis: {
              title: { text: "Nº da Peça" },
              gridcolor: "#e4e4e7",
              ...sampleAxis(x.length, axis.dtick),
            },
            yaxis: { title: unit ? { text: unit } : undefined, gridcolor: "#e4e4e7" },
          }}
          config={{ displayModeBar: false }}
          style={{ width: "100%", height: 260 }}
          onRelayout={axis.onRelayout}
          onClick={(event) => {
            const point = event.points[0];
            if (!point || point.curveNumber !== 0) return;
            const values = point.customdata as unknown as [number, number, boolean] | undefined;
            if (!values) return;
            setPinned({
              sampleNumber: values[0],
              value: values[1],
              valueLabel: title,
              details: values[2] ? "Fora de controle" : "Dentro dos limites",
            });
          }}
        />
        {pinned && <PinnedPointCard point={pinned} onClose={() => setPinned(null)} />}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {makeChart(
        data.xbar,
        `Carta X̄  (subgrupo n=${n})`,
        <InfoTooltip
          title="UCL / LCL — Carta X̄"
          what="Controla a média dos subgrupos dentro do lote. σ é estimada pela amplitude média dos subgrupos (R̄/d₂), que reflete apenas a variação dentro de cada subgrupo."
          formula={`UCL = X̄̄ + A₂ × R̄\nLCL = X̄̄ − A₂ × R̄\n\nA₂ = constante AIAG para n=${n}\nR̄  = média das amplitudes dos subgrupos\nFonte: AIAG SPC, Tabela A-1`}
          thresholds={[
            {
              label: "Dentro",
              color: "green",
              description: "Média do subgrupo dentro dos limites — processo centrado.",
            },
            {
              label: "Fora de controle",
              color: "red",
              description: "Média além dos limites — desvio de posição a investigar.",
            },
          ]}
          align="left"
        />,
        xbarAxis,
      )}
      {makeChart(
        data.r_chart,
        "Carta R",
        <InfoTooltip
          title="UCL / LCL — Carta R"
          what="Controla a amplitude (variabilidade) dentro de cada subgrupo. Um processo sob controle tem amplitude estável."
          formula={`UCL = D₄ × R̄\nLCL = D₃ × R̄\n\nD₄, D₃ = constantes AIAG para n=${n}\nR̄  = média das amplitudes dos subgrupos\nFonte: AIAG SPC, Tabela A-1`}
          thresholds={[
            {
              label: "Dentro",
              color: "green",
              description: "Amplitude dentro dos limites — variabilidade estável.",
            },
            {
              label: "Fora de controle",
              color: "red",
              description: "Amplitude além do UCL — variabilidade anormal, investigar.",
            },
          ]}
          align="right"
        />,
        rAxis,
      )}
    </div>
  );
}
