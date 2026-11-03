import type { TrendResponse } from "@/lib/sqc-api";
import Plot from "react-plotly.js";

const BLUE = "#3b82f6";
const BLUE_BAND = "rgba(59, 130, 246, 0.15)";
const BLUE_IQR = "rgba(59, 130, 246, 0.30)";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const ZINC = "#71717a";

interface Props {
  data: TrendResponse;
  unit?: string;
}

export function TrendView({ data, unit = "" }: Props) {
  if (data.batches.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500">
        Nenhum lote com medições disponível para o Trend View.
      </div>
    );
  }

  const shortLabels = data.batches.map((_, i) => `L${i + 1}`);
  const medians = data.batches.map((b) => b.median);
  const means = data.batches.map((b) => b.mean);
  const q1s = data.batches.map((b) => b.q1);
  const q3s = data.batches.map((b) => b.q3);
  const whiskerLows = data.batches.map((b) => b.whisker_low);
  const whiskerHighs = data.batches.map((b) => b.whisker_high);

  // Outliers flatten: cada ponto recebe o label curto do lote correspondente
  const outlierX: string[] = [];
  const outlierY: number[] = [];
  for (const [i, b] of data.batches.entries()) {
    for (const v of b.outliers) {
      // shortLabels and data.batches both derive from data.batches (same length) — i is in range.
      outlierX.push(shortLabels[i] ?? `L${i + 1}`);
      outlierY.push(v);
    }
  }

  const hoverMedian = data.batches.map(
    (b, i) =>
      `<b>${shortLabels[i]} — ${b.tracking_code}</b><br>` +
      `Mediana: ${b.median.toFixed(3)}${unit}<br>` +
      `Média: ${b.mean.toFixed(3)}${unit}<br>` +
      `Q1: ${b.q1.toFixed(3)}${unit} | Q3: ${b.q3.toFixed(3)}${unit}<br>` +
      `Whisker: ${b.whisker_low.toFixed(3)}${unit} – ${b.whisker_high.toFixed(3)}${unit}<br>` +
      `n: ${b.n}`,
  );

  const traces: Plotly.Data[] = [
    // ── Faixa external (whisker_low → whisker_high) ───────────────────────────
    {
      x: shortLabels,
      y: whiskerLows,
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: shortLabels,
      y: whiskerHighs,
      mode: "lines",
      fill: "tonexty",
      fillcolor: BLUE_BAND,
      line: { color: ZINC, width: 1, dash: "dot" },
      name: "Amplitude (whiskers)",
      hoverinfo: "skip",
    },

    // ── Banda IQR (Q1 → Q3) ──────────────────────────────────────────────────
    {
      x: shortLabels,
      y: q1s,
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: shortLabels,
      y: q3s,
      mode: "lines",
      fill: "tonexty",
      fillcolor: BLUE_IQR,
      line: { width: 0 },
      name: "IQR (Q1–Q3)",
      hoverinfo: "skip",
    },

    // ── Linha da média ────────────────────────────────────────────────────────
    {
      x: shortLabels,
      y: means,
      mode: "lines+markers",
      name: "Média (x̄)",
      line: { color: AMBER, width: 1.5, dash: "dot" },
      marker: { color: AMBER, size: 5, symbol: "diamond" },
      hovertemplate: `Média: %{y:.3f}${unit}<extra></extra>`,
    },

    // ── Linha da mediana ──────────────────────────────────────────────────────
    {
      x: shortLabels,
      y: medians,
      mode: "lines+markers",
      name: "Mediana",
      line: { color: BLUE, width: 2.5 },
      marker: { color: BLUE, size: 7 },
      customdata: hoverMedian,
      hovertemplate: "%{customdata}<extra></extra>",
    },

    // ── Outliers ──────────────────────────────────────────────────────────────
    ...(outlierX.length > 0
      ? [
          {
            x: outlierX,
            y: outlierY,
            mode: "markers" as const,
            name: "Outliers",
            marker: { color: RED, size: 6, symbol: "circle-open" as const, line: { width: 1.5 } },
            hovertemplate: `%{x}<br>Outlier: %{y:.3f}${unit}<extra></extra>`,
          },
        ]
      : []),
  ];

  // ── Eixo Y dinâmico ───────────────────────────────────────────────────────
  const allY = [
    ...whiskerLows,
    ...whiskerHighs,
    ...outlierY,
    data.usl,
    ...(data.lsl != null ? [data.lsl] : []),
  ].filter((v): v is number => v != null);
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const margin = (yMax - yMin) * 0.12 || 0.05;

  // ── Shapes e anotações USL/LSL ────────────────────────────────────────────
  const limitShapes = [{ y: data.usl }, ...(data.lsl != null ? [{ y: data.lsl }] : [])].map(
    ({ y }) => ({
      type: "line" as const,
      xref: "paper" as const,
      x0: 0,
      x1: 1,
      y0: y,
      y1: y,
      line: { color: RED, dash: "dash" as const, width: 1.5 },
    }),
  );

  const limitAnnotations = [
    { y: data.usl, label: "USL" },
    ...(data.lsl != null ? [{ y: data.lsl, label: "LSL" }] : []),
  ].map(({ y, label }) => ({
    xref: "paper" as const,
    x: 1.01,
    yref: "y" as const,
    y,
    text: label,
    showarrow: false,
    font: { color: RED, size: 11 },
    xanchor: "left" as const,
  }));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-0">
      {data.batches.length === 1 && (
        <p className="mb-2 text-xs text-zinc-400">
          Apenas 1 lote selecionado. Adicione mais lotes para comparar tendências.
        </p>
      )}
      <Plot
        data={traces}
        layout={{
          title: { text: `Tendência por Lote — ${data.dim_code}`, font: { size: 13 } },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 40, b: 80, l: 60, r: 60 },
          showlegend: true,
          legend: { orientation: "h", y: -0.25, font: { size: 11 } },
          shapes: limitShapes,
          annotations: limitAnnotations,
          xaxis: {
            title: { text: "Lote" },
            gridcolor: "#e4e4e7",
            type: "category",
          },
          yaxis: {
            title: { text: unit ? `Valor medido (${unit})` : "Valor medido" },
            gridcolor: "#e4e4e7",
            range: [yMin - margin, yMax + margin],
          },
          hovermode: "closest",
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: 420 }}
        useResizeHandler
      />

      {/* Tabela de referência dos lotes */}
      <div className="border-t border-zinc-100 pt-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-400">
              <th className="py-1 px-2 text-left font-medium w-10">Ref</th>
              <th className="py-1 px-2 text-left font-medium">Tracking Code</th>
              <th className="py-1 px-2 text-center font-medium">Peças</th>
              <th className="py-1 px-2 text-center font-medium">Mediana</th>
              <th className="py-1 px-2 text-center font-medium">Média</th>
            </tr>
          </thead>
          <tbody>
            {data.batches.map((b, i) => (
              <tr key={b.batch_id} className="border-t border-zinc-50">
                <td className="py-1 px-2">
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold"
                    style={{ background: BLUE }}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="py-1 px-2 font-mono text-zinc-700">{b.tracking_code}</td>
                <td className="py-1 px-2 text-center text-zinc-500">{b.n}</td>
                <td className="py-1 px-2 text-center text-zinc-600 font-mono">
                  {b.median.toFixed(4)}
                  {unit}
                </td>
                <td className="py-1 px-2 text-center text-zinc-600 font-mono">
                  {b.mean.toFixed(4)}
                  {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
