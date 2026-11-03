import type { CoordinateData, CoordinatePoint } from "@/lib/sqc-api";
import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import {
  type PinnedChartPoint,
  PinnedPointCard,
  sampleAxis,
  useIntegerSampleAxis,
} from "./ChartInteraction";

const BLUE = "#3b82f6";
const BLUE_FILL = "rgba(59,130,246,0.15)";
const RED = "#ef4444";
const YELLOW = "#f59e0b";
const ZINC = "#71717a";
const GREEN = "#10b981";

type Axis = "x" | "y" | "z";
const AXES: Axis[] = ["x", "y", "z"];

interface Props {
  data: CoordinateData;
}

// Gera pontos de um círculo de tolerância
export function toleranceCircle(cx: number, cy: number, r: number, n = 120) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const angle = (2 * Math.PI * i) / n;
    xs.push(cx + r * Math.cos(angle));
    ys.push(cy + r * Math.sin(angle));
  }
  return { xs, ys };
}

// Gera o contorno de um retângulo de tolerância (RECTANGLE, spec 060) — meia-largura
// independente por eixo, já que o bônus MMC/LMC é independente por direção (FR-009).
export function toleranceRectangle(cx: number, halfWidthX: number, cy: number, halfWidthY: number) {
  const xs = [cx - halfWidthX, cx + halfWidthX, cx + halfWidthX, cx - halfWidthX, cx - halfWidthX];
  const ys = [cy - halfWidthY, cy - halfWidthY, cy + halfWidthY, cy + halfWidthY, cy - halfWidthY];
  return { xs, ys };
}

// Calcula elipse de confiança (95%) via PCA dos pontos do par de eixos
function confidenceEllipse(
  xs: number[],
  ys: number[],
  stdMultiplier = 2.45,
  n = 100,
): { ex: number[]; ey: number[] } | null {
  if (xs.length < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const dxs = xs.map((x) => x - mx);
  const dys = ys.map((y) => y - my);
  const n_ = xs.length;
  const cxx = dxs.reduce((a, b, i) => a + b * (dxs[i] ?? 0), 0) / (n_ - 1);
  const cyy = dys.reduce((a, b, i) => a + b * (dys[i] ?? 0), 0) / (n_ - 1);
  const cxy = dxs.reduce((a, b, i) => a + b * (dys[i] ?? 0), 0) / (n_ - 1);

  // eigenvalues da matriz 2×2
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (trace / 2) ** 2 - det));
  const l1 = trace / 2 + disc;
  const l2 = trace / 2 - disc;
  if (l1 <= 0 || l2 <= 0) return null;

  const a = stdMultiplier * Math.sqrt(l1);
  const b_ = stdMultiplier * Math.sqrt(l2);
  const theta = Math.atan2(cxy, l1 - cyy);

  const ex: number[] = [];
  const ey: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const px = a * Math.cos(t);
    const py = b_ * Math.sin(t);
    ex.push(mx + px * Math.cos(theta) - py * Math.sin(theta));
    ey.push(my + px * Math.sin(theta) + py * Math.cos(theta));
  }
  return { ex, ey };
}

function axisValue(p: CoordinatePoint, axis: Axis): number | null {
  return p[axis] ?? null;
}

function axisLabel(axis: Axis): string {
  return axis.toUpperCase();
}

function axisNominal(data: CoordinateData, axis: Axis): number {
  return (axis === "x" ? data.nominal_x : axis === "y" ? data.nominal_y : data.nominal_z) ?? 0;
}

function axisUsl(data: CoordinateData, axis: Axis): number | null {
  return axis === "x" ? data.usl_x : axis === "y" ? data.usl_y : data.usl_z;
}

function axisLsl(data: CoordinateData, axis: Axis): number | null {
  return axis === "x" ? data.lsl_x : axis === "y" ? data.lsl_y : data.lsl_z;
}

function buildAxisScatter(data: CoordinateData, axisA: Axis, axisB: Axis) {
  const pts = data.points.filter((p) => axisValue(p, axisA) != null && axisValue(p, axisB) != null);
  const as = pts.map((p) => axisValue(p, axisA) ?? 0);
  const bs = pts.map((p) => axisValue(p, axisB) ?? 0);
  const nomA = axisNominal(data, axisA);
  const nomB = axisNominal(data, axisB);
  const tol = data.tol_radius;

  const traces: Plotly.Data[] = [];

  // Círculo de tolerância
  const { xs: cx, ys: cy } = toleranceCircle(nomA, nomB, tol);
  traces.push({
    x: cx,
    y: cy,
    mode: "lines",
    name: `Tolerância (r=${tol.toFixed(3)})`,
    line: { color: RED, dash: "dash", width: 1.5 },
    hoverinfo: "skip",
  });

  // Elipse de confiança 95%
  const ellipse = confidenceEllipse(as, bs);
  if (ellipse) {
    traces.push({
      x: ellipse.ex,
      y: ellipse.ey,
      mode: "lines",
      name: "Elipse 95% confiança",
      line: { color: BLUE, width: 1.5 },
      fill: "toself",
      fillcolor: BLUE_FILL,
      hoverinfo: "skip",
    });
  }

  // Ponto nominal
  traces.push({
    x: [nomA],
    y: [nomB],
    mode: "markers",
    name: "Nominal",
    marker: { color: GREEN, size: 10, symbol: "cross", line: { width: 2, color: GREEN } },
    hovertemplate: `<b>Nominal</b><br>${axisLabel(axisA)}: ${nomA.toFixed(3)}<br>${axisLabel(axisB)}: ${nomB.toFixed(3)}<extra></extra>`,
  });

  // Classificação por ponto: dentro do círculo / aprovado com bônus / não conforme
  const dist = pts.map((_p, i) => {
    const a = as[i] ?? 0;
    const b = bs[i] ?? 0;
    return Math.sqrt((a - nomA) ** 2 + (b - nomB) ** 2);
  });
  const status = pts.map((p, i) => {
    const d = dist[i] ?? 0;
    if (d <= tol) return "ok";
    if (p.bonus > 0 && d <= tol + p.bonus) return "bonus";
    return "nok";
  });

  const pointColor = status.map((s) => (s === "ok" ? BLUE : s === "bonus" ? YELLOW : RED));

  traces.push({
    x: as,
    y: bs,
    mode: "markers",
    name: "Peças",
    marker: { color: pointColor, size: 7, opacity: 0.8 },
    customdata: pts.map((p, i) => {
      const s = status[i];
      const note =
        s === "ok"
          ? ""
          : s === "bonus"
            ? `<br><span style='color:${YELLOW}'>✓ Aprovado com bônus (${p.bonus.toFixed(3)})</span>`
            : "<br><span style='color:#ef4444'>⚠ Não conforme</span>";
      return [p.part_number, (as[i] ?? 0).toFixed(3), (bs[i] ?? 0).toFixed(3), note];
    }),
    hovertemplate: `<b>Peça %{customdata[0]}</b><br>${axisLabel(axisA)}: %{customdata[1]}<br>${axisLabel(axisB)}: %{customdata[2]}%{customdata[3]}<extra></extra>`,
  });

  // Legenda de cores (traces invisíveis apenas para a legenda aparecer)
  const hasBonus = status.some((s) => s === "bonus");
  const hasNok = status.some((s) => s === "nok");
  const nOk = status.filter((s) => s === "ok").length;
  const nBonus = status.filter((s) => s === "bonus").length;
  const nNok = status.filter((s) => s === "nok").length;
  traces.push({
    x: [null],
    y: [null],
    type: "scatter",
    mode: "markers",
    name: `Conforme (${nOk})`,
    marker: { color: BLUE, size: 7 },
    showlegend: true,
  } as Plotly.Data);
  if (hasBonus) {
    traces.push({
      x: [null],
      y: [null],
      type: "scatter",
      mode: "markers",
      name: `Aprovado c/ bônus (${nBonus})`,
      marker: { color: YELLOW, size: 7 },
      showlegend: true,
    } as Plotly.Data);
  }
  if (hasNok) {
    traces.push({
      x: [null],
      y: [null],
      type: "scatter",
      mode: "markers",
      name: `Não conforme (${nNok})`,
      marker: { color: RED, size: 7, symbol: "x" },
      showlegend: true,
    } as Plotly.Data);
  }

  return { traces, nomA, nomB, allA: as, allB: bs, tol };
}

function buildAxisLine(data: CoordinateData, axis: Axis) {
  const pts = data.points.filter((p) => axisValue(p, axis) != null);
  const vals = pts.map((p) => axisValue(p, axis) ?? 0);
  const usl = axisUsl(data, axis);
  const lsl = axisLsl(data, axis);
  const nom = axisNominal(data, axis);

  const out = vals.map((v) => (usl != null && v > usl) || (lsl != null && v < lsl));

  const traces: Plotly.Data[] = [
    {
      x: pts.map((p) => p.part_number),
      y: vals,
      customdata: pts.map((p) => [p.part_number, axisValue(p, axis) ?? 0]),
      mode: "lines+markers",
      name: `Coord ${axisLabel(axis)}`,
      line: { color: ZINC, width: 1.5 },
      marker: { color: out.map((o) => (o ? RED : ZINC)), size: 6 },
      hovertemplate: `<b>Peça %{x}</b><br>${axisLabel(axis)}: %{y:.3f}<extra></extra>`,
    },
  ];

  return { traces, nom, usl, lsl };
}

export function CoordinateScatterChart({ data }: Props) {
  const [pinned, setPinned] = useState<PinnedChartPoint | null>(null);
  const hasAxis: Record<Axis, boolean> = {
    x: data.points.some((p) => p.x != null),
    y: data.points.some((p) => p.y != null),
    z: data.points.some((p) => p.z != null),
  };
  const presentAxes = AXES.filter((axis) => hasAxis[axis]);

  const dataKey = data.points.map((p) => `${p.part_number}:${p.x}:${p.y}:${p.z}`).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when plotted values change
  useEffect(() => setPinned(null), [dataKey]);

  const { dtick, onRelayout } = useIntegerSampleAxis(dataKey);

  if (presentAxes.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500">
        Nenhuma medição de coordenadas disponível.
      </div>
    );
  }

  // 3 eixos: mantém o comportamento atual (dispersão X/Y + linha de tendência Z).
  // 2 eixos: dispersão 2D com o par realmente presente.
  // 1 eixo: linha de tendência única para esse eixo.
  const scatterAxes: [Axis, Axis] | null =
    presentAxes.length === 3
      ? ["x", "y"]
      : presentAxes.length === 2
        ? [presentAxes[0] ?? "x", presentAxes[1] ?? "y"]
        : null;
  const lineAxis: Axis | null =
    presentAxes.length === 3 ? "z" : presentAxes.length === 1 ? (presentAxes[0] ?? null) : null;

  const scatter = scatterAxes ? buildAxisScatter(data, scatterAxes[0], scatterAxes[1]) : null;
  const line = lineAxis ? buildAxisLine(data, lineAxis) : null;

  return (
    <div className="space-y-4">
      {/* Dispersão 2D */}
      {scatter && scatterAxes && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <Plot
            data={scatter.traces}
            layout={{
              title: {
                text: `Dispersão ${axisLabel(scatterAxes[0])}/${axisLabel(scatterAxes[1])} — ${data.dim_code}`,
                font: { size: 13 },
              },
              paper_bgcolor: "transparent",
              plot_bgcolor: "transparent",
              margin: { t: 40, b: 60, l: 60, r: 20 },
              showlegend: true,
              legend: { orientation: "h", y: -0.2, font: { size: 11 } },
              xaxis: {
                title: { text: axisLabel(scatterAxes[0]) },
                gridcolor: "#e4e4e7",
                range: [
                  Math.min(scatter.nomA - scatter.tol * 1.4, ...scatter.allA) - 0.01,
                  Math.max(scatter.nomA + scatter.tol * 1.4, ...scatter.allA) + 0.01,
                ],
                zeroline: false,
                scaleanchor: "y",
                scaleratio: 1,
              },
              yaxis: {
                title: { text: axisLabel(scatterAxes[1]) },
                gridcolor: "#e4e4e7",
                range: [
                  Math.min(scatter.nomB - scatter.tol * 1.4, ...scatter.allB) - 0.01,
                  Math.max(scatter.nomB + scatter.tol * 1.4, ...scatter.allB) + 0.01,
                ],
                zeroline: false,
              },
              hovermode: "closest",
            }}
            config={{ displayModeBar: false }}
            style={{ width: "100%", height: 440 }}
            useResizeHandler
          />
        </div>
      )}

      {/* Linha de eixo único */}
      {line && lineAxis && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <Plot
            data={line.traces}
            layout={{
              title: {
                text: `Coordenada ${axisLabel(lineAxis)} por Peça — ${data.dim_code}`,
                font: { size: 13 },
              },
              paper_bgcolor: "transparent",
              plot_bgcolor: "transparent",
              margin: { t: 40, b: 60, l: 60, r: 60 },
              showlegend: false,
              shapes: [
                // Nominal
                {
                  type: "line",
                  xref: "paper",
                  x0: 0,
                  x1: 1,
                  y0: line.nom,
                  y1: line.nom,
                  line: { color: GREEN, dash: "dot", width: 1.5 },
                },
                // USL
                ...(line.usl != null
                  ? [
                      {
                        type: "line" as const,
                        xref: "paper" as const,
                        x0: 0,
                        x1: 1,
                        y0: line.usl,
                        y1: line.usl,
                        line: { color: RED, dash: "dash" as const, width: 1.5 },
                      },
                    ]
                  : []),
                // LSL
                ...(line.lsl != null
                  ? [
                      {
                        type: "line" as const,
                        xref: "paper" as const,
                        x0: 0,
                        x1: 1,
                        y0: line.lsl,
                        y1: line.lsl,
                        line: { color: RED, dash: "dash" as const, width: 1.5 },
                      },
                    ]
                  : []),
              ],
              xaxis: {
                title: { text: "Número da peça" },
                gridcolor: "#e4e4e7",
                ...sampleAxis(
                  data.points.filter((p) => axisValue(p, lineAxis) != null).length,
                  dtick,
                ),
              },
              yaxis: {
                title: { text: axisLabel(lineAxis) },
                gridcolor: "#e4e4e7",
                zeroline: false,
              },
              hovermode: "closest",
            }}
            config={{ displayModeBar: false }}
            style={{ width: "100%", height: 280 }}
            useResizeHandler
            onRelayout={onRelayout}
            onClick={(event) => {
              const point = event.points[0];
              if (!point || point.curveNumber !== 0) return;
              const values = point.customdata as unknown as [number, number] | undefined;
              if (!values) return;
              setPinned({
                sampleNumber: values[0],
                value: values[1],
                valueLabel: axisLabel(lineAxis),
              });
            }}
          />
          {pinned && <PinnedPointCard point={pinned} onClose={() => setPinned(null)} />}
        </div>
      )}
    </div>
  );
}
