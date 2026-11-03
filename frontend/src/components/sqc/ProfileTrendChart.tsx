import type { DimRead, ProfileTrendResponse } from "@/lib/sqc-api";
import Plot from "react-plotly.js";

const AMBER = "#f59e0b";
const AMBER_BAND = "rgba(245, 158, 11, 0.15)";
const BLUE = "#3b82f6";
const BLUE_BAND = "rgba(59, 130, 246, 0.15)";

interface Props {
  data: ProfileTrendResponse;
  dim?: DimRead;
}

export function ProfileTrendChart({ data, dim }: Props) {
  if (data.batches.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500">
        Nenhum lote com dados de perfil disponível.
      </div>
    );
  }

  // Tolerâncias por direção derivadas das dims filhas
  const maxChild = dim?.children.find((c) => c.dim_code.toUpperCase().includes("MAX"));
  const minChild = dim?.children.find((c) => c.dim_code.toUpperCase().includes("MIN"));
  const posTol = maxChild ? maxChild.nominal + maxChild.tol_plus : data.usl;
  const negTol =
    minChild && minChild.tol_minus != null && minChild.tol_minus !== 0
      ? minChild.nominal - Math.abs(minChild.tol_minus)
      : data.lsl;

  const shortLabels = data.batches.map((_, i) => `L${i + 1}`);
  const meanMax = data.batches.map((b) => b.mean_max);
  const p5Max = data.batches.map((b) => b.p5_max);
  const p95Max = data.batches.map((b) => b.p95_max);
  const meanMin = data.batches.map((b) => b.mean_min);
  const p5Min = data.batches.map((b) => b.p5_min);
  const p95Min = data.batches.map((b) => b.p95_min);

  const traces: Plotly.Data[] = [
    // ── Banda spread Desvio + (p5 → p95) ─────────────────────────────────────
    {
      x: shortLabels,
      y: p5Max,
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: shortLabels,
      y: p95Max,
      mode: "lines",
      fill: "tonexty",
      fillcolor: AMBER_BAND,
      line: { color: AMBER, width: 1, dash: "dot" },
      name: "Spread + (p5–p95)",
      hoverinfo: "skip",
    },

    // ── Linha média Desvio + ──────────────────────────────────────────────────
    {
      x: shortLabels,
      y: meanMax,
      mode: "lines+markers",
      name: "Média Desvio +",
      line: { color: AMBER, width: 2.5 },
      marker: { color: AMBER, size: 7, symbol: "triangle-up" },
      customdata: data.batches.map((b, i) => `L${i + 1} — ${b.tracking_code}`),
      hovertemplate: "<b>%{customdata}</b><br>Desvio + médio: %{y:.3f}<extra></extra>",
    },

    // ── Banda spread Desvio − (p5 → p95) ─────────────────────────────────────
    {
      x: shortLabels,
      y: p5Min,
      mode: "lines",
      line: { width: 0 },
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: shortLabels,
      y: p95Min,
      mode: "lines",
      fill: "tonexty",
      fillcolor: BLUE_BAND,
      line: { color: BLUE, width: 1, dash: "dot" },
      name: "Spread − (p5–p95)",
      hoverinfo: "skip",
    },

    // ── Linha média Desvio − ──────────────────────────────────────────────────
    {
      x: shortLabels,
      y: meanMin,
      mode: "lines+markers",
      name: "Média Desvio −",
      line: { color: BLUE, width: 2.5 },
      marker: { color: BLUE, size: 7, symbol: "triangle-down" },
      customdata: data.batches.map((b, i) => `L${i + 1} — ${b.tracking_code}`),
      hovertemplate: "<b>%{customdata}</b><br>Desvio − médio: %{y:.3f}<extra></extra>",
    },
  ];

  // ── Eixo Y dinâmico ───────────────────────────────────────────────────────
  const allY = [
    ...p5Max.filter((v): v is number => v != null),
    ...p95Max.filter((v): v is number => v != null),
    ...p5Min.filter((v): v is number => v != null),
    ...p95Min.filter((v): v is number => v != null),
    posTol,
    ...(negTol != null ? [negTol] : []),
  ];
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const margin = (yMax - yMin) * 0.12 || 0.05;

  const shapes = [
    // Linha zero
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 0,
      line: { color: "#71717a", width: 1 },
    },
    // Tolerância positiva (amber — mesma cor da série)
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      y0: posTol,
      y1: posTol,
      line: { color: AMBER, dash: "dash", width: 1.5 },
    },
    // Tolerância negativa (azul — mesma cor da série)
    ...(negTol != null
      ? [
          {
            type: "line" as const,
            xref: "paper" as const,
            x0: 0,
            x1: 1,
            y0: negTol,
            y1: negTol,
            line: { color: BLUE, dash: "dash" as const, width: 1.5 },
          },
        ]
      : []),
  ] as Partial<Plotly.Shape>[];

  const annotations: Partial<Plotly.Annotations>[] = [
    {
      xref: "paper",
      x: 1.01,
      yref: "y",
      y: posTol,
      text: `+${posTol.toFixed(3)}`,
      showarrow: false,
      font: { color: AMBER, size: 11 },
      xanchor: "left",
    },
    ...(negTol != null
      ? [
          {
            xref: "paper" as const,
            x: 1.01,
            yref: "y" as const,
            y: negTol,
            text: negTol.toFixed(3),
            showarrow: false,
            font: { color: BLUE, size: 11 },
            xanchor: "left" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-0">
      {data.batches.length === 1 && (
        <p className="mb-2 text-xs text-zinc-400">
          Apenas 1 lote selecionado. Adicione mais lotes para comparar tendências.
        </p>
      )}
      <div className="mb-2 flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: AMBER }} />
          Desvio máximo
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: BLUE }} />
          Desvio mínimo
        </span>
      </div>
      <Plot
        data={traces}
        layout={{
          title: { text: `Tendência de Perfil por Lote — ${data.dim_code}`, font: { size: 13 } },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 40, b: 80, l: 60, r: 60 },
          showlegend: true,
          legend: { orientation: "h", y: -0.25, font: { size: 11 } },
          shapes,
          annotations,
          xaxis: {
            title: { text: "Lote" },
            gridcolor: "#e4e4e7",
            type: "category",
          },
          yaxis: {
            title: { text: "Desvio" },
            gridcolor: "#e4e4e7",
            range: [yMin - margin, yMax + margin],
            zeroline: false,
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
            </tr>
          </thead>
          <tbody>
            {data.batches.map((b, i) => (
              <tr key={b.batch_id} className="border-t border-zinc-50">
                <td className="py-1 px-2">
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-bold"
                    style={{ background: AMBER }}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="py-1 px-2 font-mono text-zinc-700">{b.tracking_code}</td>
                <td className="py-1 px-2 text-center text-zinc-500">{b.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
