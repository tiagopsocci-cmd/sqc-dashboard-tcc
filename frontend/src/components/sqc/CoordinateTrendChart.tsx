import type { CoordinateTrendResponse } from "@/lib/sqc-api";
import Plot from "react-plotly.js";

// Paleta de cores para múltiplos lotes
const PALETTE = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#f97316",
  "#84cc16",
];
const alpha = (hex: string, a: number) => {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

const RED = "#ef4444";
const GREEN = "#10b981";

// Gera elipse a partir de mean ± std * k (eixos alinhados aos eixos cartesianos)
// Para elipse de confiança 95% bivariada normal: k ≈ 2.45
function ellipseFromStats(
  mx: number,
  my: number,
  sx: number,
  sy: number,
  k = 2.45,
  n = 100,
): { ex: number[]; ey: number[] } {
  const ex: number[] = [];
  const ey: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    ex.push(mx + k * sx * Math.cos(t));
    ey.push(my + k * sy * Math.sin(t));
  }
  return { ex, ey };
}

function toleranceCircle(cx: number, cy: number, r: number, n = 120) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    xs.push(cx + r * Math.cos(a));
    ys.push(cy + r * Math.sin(a));
  }
  return { xs, ys };
}

// RECTANGLE (spec 060, research.md R8) — mesma meia-largura `r` nos dois eixos (T_d
// compartilhado pela posição), só a forma do contorno muda.
function toleranceRectangle(cx: number, cy: number, r: number) {
  const xs = [cx - r, cx + r, cx + r, cx - r, cx - r];
  const ys = [cy - r, cy - r, cy + r, cy + r, cy - r];
  return { xs, ys };
}

interface Props {
  data: CoordinateTrendResponse;
  batchLabels?: Record<string, string>;
}

export function CoordinateTrendChart({ data }: Props) {
  const hasXY = data.batches.some((b) => b.mean_x != null && b.mean_y != null);
  const hasZ = data.batches.some((b) => b.mean_z != null);

  if (!hasXY && !hasZ) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500">
        Nenhum dado de coordenadas disponível para os lotes selecionados.
      </div>
    );
  }

  const nomX = data.nominal_x ?? 0;
  const nomY = data.nominal_y ?? 0;
  const tol = data.tol_radius;

  const shortLabel = (i: number) => `L${i + 1}`;

  // ── Traces X/Y ────────────────────────────────────────────────────────────
  const xyTraces: Plotly.Data[] = [];

  if (hasXY) {
    // Contorno de tolerância — círculo (CIRCULAR) ou retângulo (RECTANGLE)
    const isRectangle = data.zone_geometry === "RECTANGLE";
    const { xs: cx, ys: cy } = isRectangle
      ? toleranceRectangle(nomX, nomY, tol)
      : toleranceCircle(nomX, nomY, tol);
    xyTraces.push({
      x: cx,
      y: cy,
      mode: "lines",
      name: `Tolerância (${isRectangle ? "±" : "r="}${tol.toFixed(3)})`,
      line: { color: RED, dash: "dash", width: 1.5 },
      hoverinfo: "skip",
    });

    // Ponto nominal
    xyTraces.push({
      x: [nomX],
      y: [nomY],
      mode: "markers",
      name: "Nominal",
      marker: { color: GREEN, size: 12, symbol: "cross", line: { width: 2.5, color: GREEN } },
      hovertemplate: `<b>Nominal</b><br>X: ${nomX.toFixed(3)}<br>Y: ${nomY.toFixed(3)}<extra></extra>`,
    });

    // Elipse por lote + ponto da média
    data.batches.forEach((b, i) => {
      if (b.mean_x == null || b.mean_y == null) return;
      const color = PALETTE[i % PALETTE.length] as string;
      const sx = b.std_x ?? 0;
      const sy = b.std_y ?? 0;
      const lbl = shortLabel(i);
      const fullLabel = `${lbl} — ${b.tracking_code}`;

      // Elipse de confiança
      if (sx > 0 && sy > 0) {
        const { ex, ey } = ellipseFromStats(b.mean_x, b.mean_y, sx, sy);
        xyTraces.push({
          x: ex,
          y: ey,
          mode: "lines",
          name: `${lbl} — elipse 95%`,
          line: { color, width: 1.5 },
          fill: "toself",
          fillcolor: alpha(color, 0.08),
          hoverinfo: "skip",
          legendgroup: lbl,
          showlegend: false,
        });
      }

      // Ponto da média
      xyTraces.push({
        x: [b.mean_x],
        y: [b.mean_y],
        mode: "markers",
        name: lbl,
        marker: { color, size: 10, symbol: "circle", line: { width: 2, color } },
        legendgroup: lbl,
        hovertemplate:
          `<b>${fullLabel}</b><br>Média X: ${b.mean_x.toFixed(3)}<br>Média Y: ${b.mean_y.toFixed(3)}<br>` +
          `σX: ${sx.toFixed(3)} | σY: ${sy.toFixed(3)}<br>n: ${b.n}<extra></extra>`,
      });
    });
  }

  // ── Traces Z (boxplot por lote) ───────────────────────────────────────────
  const zTraces: Plotly.Data[] = [];

  if (hasZ) {
    data.batches.forEach((b, i) => {
      if (b.mean_z == null) return;
      const color = PALETTE[i % PALETTE.length];
      const lbl = shortLabel(i);
      const p5 = b.p5_z ?? b.mean_z;
      const p95 = b.p95_z ?? b.mean_z;
      const std = b.std_z ?? 0;

      // Boxplot sintético a partir dos stats (sem dados brutos)
      zTraces.push({
        type: "box",
        name: lbl,
        q1: [b.mean_z - std],
        median: [b.mean_z],
        q3: [b.mean_z + std],
        lowerfence: [p5],
        upperfence: [p95],
        mean: [b.mean_z],
        marker: { color },
        line: { color },
        boxmean: true,
        hovertemplate: `<b>${lbl} — ${b.tracking_code}</b><br>Média Z: ${b.mean_z.toFixed(3)}<br>p5: ${p5.toFixed(3)} | p95: ${p95.toFixed(3)}<extra></extra>`,
      } as Plotly.Data);
    });
  }

  // ── Ranges X/Y ───────────────────────────────────────────────────────────
  const allMX = data.batches.map((b) => b.mean_x).filter((v): v is number => v != null);
  const allMY = data.batches.map((b) => b.mean_y).filter((v): v is number => v != null);
  const padXY = tol * 1.4;

  return (
    <div className="space-y-4">
      {/* Elipses X/Y */}
      {hasXY && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <Plot
            data={xyTraces}
            layout={{
              title: {
                text: `Elipses de Confiança X/Y por Lote — ${data.dim_code}`,
                font: { size: 13 },
              },
              paper_bgcolor: "transparent",
              plot_bgcolor: "transparent",
              margin: { t: 40, b: 80, l: 60, r: 20 },
              showlegend: true,
              legend: { orientation: "h", y: -0.25, font: { size: 11 } },
              xaxis: {
                title: { text: "X" },
                gridcolor: "#e4e4e7",
                zeroline: false,
                scaleanchor: "y",
                scaleratio: 1,
                range: [
                  Math.min(nomX - padXY, ...allMX) - 0.01,
                  Math.max(nomX + padXY, ...allMX) + 0.01,
                ],
              },
              yaxis: {
                title: { text: "Y" },
                gridcolor: "#e4e4e7",
                zeroline: false,
                range: [
                  Math.min(nomY - padXY, ...allMY) - 0.01,
                  Math.max(nomY + padXY, ...allMY) + 0.01,
                ],
              },
              hovermode: "closest",
            }}
            config={{ displayModeBar: false }}
            style={{ width: "100%", height: 460 }}
            useResizeHandler
          />
          <p className="mt-1 text-xs text-zinc-400">
            Cada elipse representa a dispersão de 95% das peças do lote (p5–p95). O ponto central é
            a média X/Y.
          </p>
        </div>
      )}

      {/* Boxplot Z */}
      {hasZ && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <Plot
            data={zTraces}
            layout={{
              title: { text: `Coordenada Z por Lote — ${data.dim_code}`, font: { size: 13 } },
              paper_bgcolor: "transparent",
              plot_bgcolor: "transparent",
              margin: { t: 40, b: 60, l: 60, r: 20 },
              showlegend: false,
              boxmode: "group",
              xaxis: { gridcolor: "#e4e4e7" },
              yaxis: { title: { text: "Z" }, gridcolor: "#e4e4e7", zeroline: false },
              hovermode: "closest",
            }}
            config={{ displayModeBar: false }}
            style={{ width: "100%", height: 300 }}
            useResizeHandler
          />
        </div>
      )}

      {/* Tabela de referência dos lotes */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="border-b border-zinc-100 pb-1 mb-2">
          <span className="text-xs font-medium text-zinc-500">Referência de lotes</span>
        </div>
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
                    style={{ background: PALETTE[i % PALETTE.length] }}
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
