import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import Plot from "react-plotly.js";

interface BatchTolData {
  trackingCode: string;
  mean: number;
  std: number;
}

interface Props {
  batches: BatchTolData[];
}

export function ToleranceBarChart({ batches }: Props) {
  const thresholds = useCapabilityThresholds();
  if (batches.length === 0) return null;

  const warning = thresholds.data?.tolerance_warning_pct;
  const limit = thresholds.data?.tolerance_limit_pct;
  const labels = batches.map((b) => b.trackingCode);
  const means = batches.map((b) => b.mean);
  const stds = batches.map((b) => b.std);
  const colors = means.map((mean) =>
    limit != null && mean > limit
      ? "#ef4444"
      : warning != null && mean > warning
        ? "#f59e0b"
        : "#22c55e",
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <Plot
        data={[
          {
            type: "bar",
            x: labels,
            y: means,
            error_y: { type: "data", array: stds, visible: true, color: "#71717a", thickness: 1.5 },
            marker: { color: colors, opacity: 0.85 },
            name: "% Tol. Média",
            hovertemplate: "%{x}<br>Média: %{y:.1f}%<extra></extra>",
          } as Plotly.Data,
          // Linha de 100%
          {
            type: "scatter",
            mode: "lines",
            x: [labels[0], labels[labels.length - 1]],
            y: [limit ?? 0, limit ?? 0],
            line: { color: "#ef4444", dash: "dash", width: 1.5 },
            name: `${limit ?? "—"}% tolerância`,
          } as Plotly.Data,
          // Linha de 80%
          {
            type: "scatter",
            mode: "lines",
            x: [labels[0], labels[labels.length - 1]],
            y: [warning ?? 0, warning ?? 0],
            line: { color: "#f59e0b", dash: "dot", width: 1 },
            name: `${warning ?? "—"}% (alerta)`,
          } as Plotly.Data,
        ]}
        layout={{
          title: { text: "% Tolerância Usada por Lote (média ± σ)", font: { size: 13 } },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 40, b: 70, l: 55, r: 20 },
          xaxis: { tickangle: -25, gridcolor: "#e4e4e7" },
          yaxis: {
            title: { text: "% Tolerância" },
            gridcolor: "#e4e4e7",
            range: [0, Math.max(120, ...means.map((m, i) => m + (stds[i] ?? 0) + 10))],
          },
          showlegend: true,
          legend: { orientation: "h", y: -0.3, font: { size: 11 } },
          bargap: 0.35,
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: 340 }}
        useResizeHandler
      />
    </div>
  );
}
