import { InfoTooltip } from "@/components/sqc/InfoTooltip";
import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import type { ProfileDistributionResponse, ProfileSideStats } from "@/lib/sqc-api";
import Plot from "react-plotly.js";

interface Props {
  data: ProfileDistributionResponse;
}

function normalPdf(x: number, mean: number, std: number): number {
  if (std <= 0) return 0;
  const z = (x - mean) / std;
  return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
}

function linspace(start: number, end: number, n: number): number[] {
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function fmt(v: number | null | undefined, dec = 3): string {
  if (v == null) return "—";
  return v.toFixed(dec);
}

function fmtCap(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

interface SidePanelProps {
  side: ProfileSideStats;
  label: string;
  barColor: string;
  barBorder: string;
  usl: number;
  lsl: number | null;
  minimum: number | undefined;
  warningMinimum: number | undefined;
}

function SidePanel({
  side,
  label,
  barColor,
  barBorder,
  usl,
  lsl,
  minimum,
  warningMinimum,
}: SidePanelProps) {
  const { histogram, mean, std, n } = side;
  const edges = histogram.bin_edges;
  const counts = histogram.counts;

  if (edges.length < 2) return null;

  // `edges.length < 2` above guarantees both ends exist.
  const binWidth = ((edges.at(-1) as number) - (edges[0] as number)) / counts.length;

  // Domínio da curva: cobre todos os dados e ambos os limites
  const xMin = Math.min(edges[0] as number, lsl ?? mean - 4 * std, usl) - binWidth;
  const xMax = Math.max(edges.at(-1) as number, usl, lsl ?? mean + 4 * std) + binWidth;
  const curveX = linspace(xMin, xMax, 300);
  const curveY = curveX.map((x) => normalPdf(x, mean, std) * n * binWidth);

  // edges.length === counts.length + 1, so i and i+1 are always in range for edges.
  const barX = counts.map((_, i) => ((edges.at(i) ?? 0) + (edges.at(i + 1) ?? 0)) / 2);

  const normalOk = side.is_normal === true;
  const normalBad = side.is_normal === false;
  const cpkOk = side.cpk != null && minimum != null && side.cpk >= minimum;
  const cpkWarn =
    side.cpk != null &&
    minimum != null &&
    warningMinimum != null &&
    side.cpk >= warningMinimum &&
    side.cpk < minimum;
  const cpkBad = side.cpk != null && warningMinimum != null && side.cpk < warningMinimum;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-700">{label}</span>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
            ${
              normalOk
                ? "bg-emerald-100 text-emerald-700"
                : normalBad
                  ? "bg-amber-100 text-amber-700"
                  : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {normalOk ? "Normal" : normalBad ? "Não-normal" : "—"}
            {side.normality_p != null && (
              <span className="opacity-70">(p={side.normality_p.toFixed(3)})</span>
            )}
          </span>
          <InfoTooltip
            title="Teste de Shapiro-Wilk"
            what="Verifica se os dados seguem distribuição normal. H₀: os dados são normais. Se o p-valor for maior que 0,05, não há evidência suficiente para rejeitar a normalidade."
            formula={"W = (Σ aᵢ x₍ᵢ₎)² / Σ (xᵢ − x̄)²\n\np-valor > 0,05 → não rejeita H₀ (normal)"}
            thresholds={[
              {
                label: "p > 0,05",
                color: "green",
                description: "Dados consistentes com distribuição normal",
              },
              {
                label: "p ≤ 0,05",
                color: "red",
                description: "Evidência de não-normalidade — interpretar Cp/Cpk com cautela",
              },
            ]}
            note="Sensível ao tamanho amostral — com n < 8 o teste tem baixa potência para detectar não-normalidade."
            align="right"
          />
        </div>
      </div>

      <Plot
        data={[
          {
            x: barX,
            y: counts,
            type: "bar",
            name: "Frequência",
            marker: { color: barColor, line: { color: barBorder, width: 0.5 } },
            width: Array(counts.length).fill(binWidth * 0.9),
            hovertemplate: "Valor: %{x:.4f}<br>Frequência: %{y}<extra></extra>",
          },
          {
            x: curveX,
            y: curveY,
            type: "scatter",
            mode: "lines",
            name: "Curva Normal",
            line: { color: "#71717a", width: 2 },
            hoverinfo: "skip",
          },
        ]}
        layout={{
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          margin: { t: 24, b: 40, l: 45, r: 20 },
          showlegend: false,
          bargap: 0,
          shapes: [
            // USL — vermelho tracejado
            {
              type: "line",
              xref: "x",
              x0: usl,
              x1: usl,
              yref: "paper",
              y0: 0,
              y1: 1,
              line: { color: "#ef4444", dash: "dash", width: 1.5 },
            },
            // LSL — azul tracejado (se existir)
            ...(lsl != null
              ? [
                  {
                    type: "line" as const,
                    xref: "x" as const,
                    x0: lsl,
                    x1: lsl,
                    yref: "paper" as const,
                    y0: 0,
                    y1: 1,
                    line: { color: "#3b82f6", dash: "dash" as const, width: 1.5 },
                  },
                ]
              : []),
          ],
          annotations: [
            {
              xref: "x",
              x: usl,
              yref: "paper",
              y: 1.04,
              text: `USL ${fmt(usl)}`,
              showarrow: false,
              font: { color: "#ef4444", size: 10 },
              xanchor: "center",
            },
            ...(lsl != null
              ? [
                  {
                    xref: "x" as const,
                    x: lsl,
                    yref: "paper" as const,
                    y: 1.04,
                    text: `LSL ${fmt(lsl)}`,
                    showarrow: false,
                    font: { color: "#3b82f6", size: 10 },
                    xanchor: "center" as const,
                  },
                ]
              : []),
          ],
          xaxis: { gridcolor: "#e4e4e7", zeroline: false, title: { text: "Desvio" } },
          yaxis: { gridcolor: "#e4e4e7", zeroline: false, title: { text: "n" } },
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: 240 }}
        useResizeHandler
      />

      {/* Tabela de índices */}
      <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-xs border-t border-zinc-100 pt-2">
        <div className="text-zinc-400">n</div>
        <div className="text-zinc-400">Média</div>
        <div className="text-zinc-400">σ</div>
        <div className="text-zinc-400" />

        <div className="tabular-nums font-medium">{n}</div>
        <div className="tabular-nums font-medium">{fmt(mean)}</div>
        <div className="tabular-nums font-medium">{fmt(std, 4)}</div>
        <div />

        <div className="text-zinc-400 mt-1">Cp</div>
        <div className="text-zinc-400 mt-1">Cpk</div>
        <div className="text-zinc-400 mt-1" />
        <div className="text-zinc-400 mt-1" />

        <div className="tabular-nums font-medium">{fmtCap(side.cp)}</div>
        <div
          className={`tabular-nums font-semibold
          ${cpkOk ? "text-emerald-600" : cpkWarn ? "text-amber-600" : cpkBad ? "text-red-600" : ""}`}
        >
          {fmtCap(side.cpk)}
        </div>
        <div />
        <div />
      </div>
    </div>
  );
}

export function ProfileDistributionChart({ data }: Props) {
  const thresholds = useCapabilityThresholds();
  const minimum = thresholds.data?.default_minimum;
  const warningMinimum = thresholds.data?.warning_minimum;
  const { pos, neg, usl, lsl } = data;
  if (!pos && !neg) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-zinc-700">Distribuição por Sinal</span>
        <span className="text-xs text-zinc-400">
          histograma + curva normal ajustada · Cp/Cpk bilateral
        </span>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-5 border-t-2 border-dashed border-red-500" />
            USL {fmt(usl)}
          </span>
          {lsl != null && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-5 border-t-2 border-dashed border-blue-500" />
              LSL {fmt(lsl)}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pos && (
          <SidePanel
            side={pos}
            label="Desvios Positivos (MAX)"
            barColor="rgba(245,158,11,0.55)"
            barBorder="#f59e0b"
            usl={usl}
            lsl={lsl}
            minimum={minimum}
            warningMinimum={warningMinimum}
          />
        )}
        {neg && (
          <SidePanel
            side={neg}
            label="Desvios Negativos (MIN)"
            barColor="rgba(59,130,246,0.55)"
            barBorder="#3b82f6"
            usl={usl}
            lsl={lsl}
            minimum={minimum}
            warningMinimum={warningMinimum}
          />
        )}
      </div>
    </div>
  );
}
