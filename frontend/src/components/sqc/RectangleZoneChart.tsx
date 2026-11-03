import type { CoordinateData, CoordinatePoint, DirectionResult } from "@/lib/sqc-api";
import { useState } from "react";
import Plot from "react-plotly.js";
import { toleranceRectangle } from "./CoordinateScatterChart";

const GREEN = "#10b981";
const BLUE = "#3b82f6";
const YELLOW = "#f59e0b";
const RED = "#ef4444";
const ZINC = "#71717a";

interface Props {
  data: CoordinateData;
  /** Seleção de peça sincronizada com outras visualizações (FR-025) — se omitida, o
   * componente mantém seleção local (uso standalone). */
  selectedPartNumber?: number | null;
  onSelectPartNumber?: (partNumber: number) => void;
}

interface PieceStatus {
  label: string;
  color: string;
  symbol: "circle" | "diamond" | "x" | "circle-open";
}

// Estados distinguidos por símbolo + cor (nunca só cor), FR-023.
function pieceStatus(p: CoordinatePoint): PieceStatus {
  if (p.conforming == null) {
    return { label: "Não avaliável", color: ZINC, symbol: "circle-open" };
  }
  if (!p.conforming) {
    return { label: "Não conforme", color: RED, symbol: "x" };
  }
  const anyBonus = (p.directions ?? []).some((d) => d.bonus > 0);
  return anyBonus
    ? { label: "Conforme com bônus", color: YELLOW, symbol: "diamond" }
    : { label: "Conforme na base", color: BLUE, symbol: "circle" };
}

export function RectangleZoneChart({ data, selectedPartNumber, onSelectPartNumber }: Props) {
  const points = data.points.filter((p) => (p.directions?.length ?? 0) >= 1);
  const [localSelectedPart, setLocalSelectedPart] = useState<number | null>(null);
  const isControlled = selectedPartNumber !== undefined;
  const selectedPart = isControlled ? selectedPartNumber : localSelectedPart;
  const setSelectedPart = (n: number) => {
    if (onSelectPartNumber) onSelectPartNumber(n);
    if (!isControlled) setLocalSelectedPart(n);
  };

  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500">
        Nenhuma medição direcional disponível.
      </div>
    );
  }

  const effectivePart = selectedPart ?? points[0]?.part_number ?? null;
  const selected = points.find((p) => p.part_number === effectivePart) ?? points[0];
  const directions: DirectionResult[] = selected?.directions ?? [];
  const dA = directions[0];
  const dB = directions[1];

  if (!selected || !dA) {
    return null;
  }

  const status = pieceStatus(selected);
  const axisBLabel = dB?.axis ?? "";
  const axisBNominal = dB?.nominal ?? 0;
  const axisBMeasured = dB?.measured ?? 0;
  const axisBBaseLimit = dB?.base_limit ?? dA.base_limit;
  const axisBEffLimit = dB?.effective_limit ?? dA.effective_limit;

  const base = toleranceRectangle(dA.nominal, dA.base_limit, axisBNominal, axisBBaseLimit);
  const effective = toleranceRectangle(dA.nominal, dA.effective_limit, axisBNominal, axisBEffLimit);

  const traces: Plotly.Data[] = [
    {
      x: base.xs,
      y: base.ys,
      mode: "lines",
      name: "Zona base",
      line: { color: ZINC, dash: "dot", width: 1.5 },
      hoverinfo: "skip",
    },
    {
      x: effective.xs,
      y: effective.ys,
      mode: "lines",
      name: "Zona efetiva (bônus)",
      line: { color: BLUE, dash: "dash", width: 1.5 },
      fill: "toself",
      fillcolor: "rgba(59,130,246,0.08)",
      hoverinfo: "skip",
    },
    {
      x: [dA.nominal],
      y: [axisBNominal],
      mode: "markers",
      name: "Nominal",
      marker: { color: GREEN, size: 10, symbol: "cross", line: { width: 2, color: GREEN } },
      hovertemplate: `<b>Nominal</b><br>${dA.axis}: ${dA.nominal.toFixed(3)}<br>${axisBLabel}: ${axisBNominal.toFixed(3)}<extra></extra>`,
    },
    {
      x: [dA.measured],
      y: [axisBMeasured],
      mode: "markers",
      name: status.label,
      marker: { color: status.color, size: 13, symbol: status.symbol },
      hovertemplate: `<b>Peça ${selected.part_number}</b><br>${dA.axis}: %{x:.3f}<br>${axisBLabel}: %{y:.3f}<br>${status.label}<extra></extra>`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label htmlFor="rectangle-zone-piece" className="text-xs text-slate-500">
          Peça
        </label>
        <select
          id="rectangle-zone-piece"
          value={effectivePart ?? ""}
          onChange={(e) => setSelectedPart(Number(e.target.value))}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {points.map((p) => (
            <option key={p.part_number} value={p.part_number}>
              Peça {p.part_number}
            </option>
          ))}
        </select>
        <span className="text-xs font-medium" style={{ color: status.color }}>
          {status.label}
        </span>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        <Plot
          data={traces}
          layout={{
            title: {
              text: `Zona 2D — ${data.dim_code} (peça ${selected.part_number})`,
              font: { size: 13 },
            },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            margin: { t: 40, b: 60, l: 60, r: 20 },
            showlegend: true,
            legend: { orientation: "h", y: -0.2, font: { size: 11 } },
            xaxis: {
              title: { text: dA.axis },
              gridcolor: "#e4e4e7",
              zeroline: false,
              scaleanchor: "y",
              scaleratio: 1,
            },
            yaxis: {
              title: { text: axisBLabel },
              gridcolor: "#e4e4e7",
              zeroline: false,
            },
            hovermode: "closest",
          }}
          config={{ displayModeBar: false }}
          style={{ width: "100%", height: 440 }}
          useResizeHandler
        />
      </div>

      {/* Painel auditável por direção (FR-024) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {directions.map((d) => (
          <div
            key={d.axis}
            className="space-y-1 rounded-lg border border-zinc-200 bg-white p-3 text-xs"
          >
            <p className="text-sm font-semibold text-slate-800">Direção {d.axis}</p>
            <p>
              <span className="text-slate-400">Dimensão relacionada:</span>{" "}
              {d.related_size_dim_code ?? "—"}
            </p>
            <p>
              <span className="text-slate-400">Tamanho medido:</span>{" "}
              {d.measured_size != null ? d.measured_size.toFixed(3) : "—"}
            </p>
            {d.related_size_nominal != null && (
              <p>
                <span className="text-slate-400">Tolerância do tamanho:</span>{" "}
                {d.related_size_nominal.toFixed(3)}
                {" +"}
                {(d.related_size_tol_plus ?? 0).toFixed(3)}
                {" / -"}
                {(d.related_size_tol_minus ?? 0).toFixed(3)}
                {d.related_size_deviation != null && (
                  <> (desvio: {d.related_size_deviation.toFixed(3)})</>
                )}
              </p>
            )}
            <p>
              <span className="text-slate-400">Condição de material:</span>{" "}
              {d.material_condition ?? "—"}
            </p>
            <p>
              <span className="text-slate-400">Bônus:</span> {d.bonus.toFixed(3)}
            </p>
            <p>
              <span className="text-slate-400">Nominal / Medido:</span> {d.nominal.toFixed(3)} /{" "}
              {d.measured.toFixed(3)}
            </p>
            <p>
              <span className="text-slate-400">Desvio:</span> {d.deviation.toFixed(3)}
            </p>
            <p>
              <span className="text-slate-400">Limite base / efetivo:</span>{" "}
              {d.base_limit.toFixed(3)} / {d.effective_limit.toFixed(3)}
            </p>
            <p>
              <span className="text-slate-400">Utilização:</span> {(d.utilization * 100).toFixed(1)}
              %
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
