import type { DimRead, HeatmapCell, PartHeatmapResponse } from "@/lib/sqc-api";
import { useState } from "react";

// Cor de fundo baseada no status do backend + gradiente suave dentro de "ok"
function cellBgColor(cell: HeatmapCell | undefined, opacity = 1): string {
  if (!cell || cell.status === "no_data") return `rgba(161,161,170,${opacity * 0.3})`;
  if (cell.status === "critical") return `rgba(239,68,68,${opacity})`;
  if (cell.status === "warning") return `rgba(251,191,36,${opacity})`;
  // ok: gradiente verde proporcional ao uso da tolerância (0→75%)
  const pct = Math.min(cell.mean_tol_pct ?? 0, 75);
  const t = pct / 75;
  const r = Math.round(16 + t * (251 - 16));
  const g = Math.round(185 + t * (191 - 185));
  const b = Math.round(129 + t * (36 - 129));
  return `rgba(${r},${g},${b},${opacity})`;
}

function cellTextColor(cell: HeatmapCell | undefined): string {
  if (!cell || cell.status === "no_data") return "text-slate-300";
  if (cell.status === "critical") return "text-red-800";
  if (cell.status === "warning") return "text-amber-900";
  return "text-emerald-900";
}

interface Props {
  data: PartHeatmapResponse;
  dims: DimRead[];
  onDimSelect: (dimId: string, dim: DimRead) => void;
}

export function BatchHeatmapChart({ data, dims, onDimSelect }: Props) {
  const [filter, setFilter] = useState<"all" | "critical" | "warning">("all");

  const dimMap = Object.fromEntries(dims.map((d) => [d.id, d]));

  const batchOrder = Object.keys(data.batch_labels);
  const shortLabel = (bid: string) => {
    const idx = batchOrder.indexOf(bid);
    return idx >= 0 ? `L${idx + 1}` : "—";
  };
  void shortLabel;

  const STATUS_RANK: Record<string, number> = { critical: 0, warning: 1, ok: 2, no_data: 3 };
  const filteredDims = data.dims.filter((row) => {
    const worst = Math.min(...row.cells.map((c) => STATUS_RANK[c.status] ?? 4));
    if (filter === "all") return true;
    if (filter === "critical") return worst === 0;
    if (filter === "warning") return worst <= 1;
    return true;
  });

  const counts = {
    critical: data.dims.filter((r) => r.cells.some((c) => c.status === "critical")).length,
    warning: data.dims.filter(
      (r) =>
        !r.cells.some((c) => c.status === "critical") &&
        r.cells.some((c) => c.status === "warning"),
    ).length,
  };

  if (batchOrder.length === 0 || data.dims.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200 text-sm text-slate-400">
        Nenhum dado disponível.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Cabeçalho */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Visão Geral — Comparação de Lotes
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">% tolerância usada por dimensão e lote</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {(["all", "critical", "warning"] as const).map((f) => {
            const labels = {
              all: `Todas (${data.dims.length})`,
              critical: `Crítico (${counts.critical})`,
              warning: `Atenção (${counts.warning})`,
            };
            const colors = {
              all: "bg-slate-100 text-slate-600",
              critical: "bg-red-50 text-red-700",
              warning: "bg-amber-50 text-amber-700",
            };
            return (
              <button
                type="button"
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-0.5 font-medium transition-all ${
                  filter === f
                    ? `${colors[f]} ring-1 ring-current`
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                {labels[f]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legenda de lotes */}
      <div className="px-5 pt-3 pb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 border-b border-slate-50">
        {batchOrder.map((bid, i) => (
          <span key={bid} className="flex items-center gap-1">
            <span className="font-semibold text-slate-700">L{i + 1}</span>
            <span className="text-slate-400">{data.batch_labels[bid]}</span>
          </span>
        ))}
      </div>

      {/* Heatmap */}
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left font-medium text-slate-400 sticky left-0 bg-slate-50 min-w-[180px]">
                Dimensão
              </th>
              {batchOrder.map((bid, i) => (
                <th
                  key={bid}
                  className="px-2 py-2 text-center font-medium text-slate-500 min-w-[80px]"
                >
                  L{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredDims.map((row) => {
              const dim = dimMap[row.dim_id];
              return (
                <tr
                  key={row.dim_id}
                  className="border-t border-slate-50 hover:brightness-95 cursor-pointer"
                  tabIndex={0}
                  onClick={() => dim && onDimSelect(row.dim_id, dim)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (dim) onDimSelect(row.dim_id, dim);
                    }
                  }}
                >
                  {/* Nome da dim */}
                  <td className="px-3 py-2 sticky left-0 bg-white">
                    <span className="font-mono text-slate-800">{row.dim_code}</span>
                    {row.dim_name && (
                      <span className="ml-1.5 text-slate-400 text-[11px]">{row.dim_name}</span>
                    )}
                  </td>

                  {/* Células do heatmap */}
                  {batchOrder.map((bid) => {
                    const cell = row.cells.find((c) => String(c.batch_id) === bid);
                    const pct = cell?.mean_tol_pct ?? null;
                    return (
                      <td
                        key={bid}
                        className="px-1 py-1 text-center"
                        title={
                          cell
                            ? `${row.dim_code} — ${data.batch_labels[bid]}\n% Tol: ${pct?.toFixed(1) ?? "—"}%${cell.std_tol_pct != null ? ` ±${cell.std_tol_pct.toFixed(1)}%` : ""}\nNC: ${cell.n_out} (Ac=${cell.nqa_ac} Re=${cell.nqa_re})${cell.n_uncertainty > 0 ? `\nZona incerteza: ${cell.n_uncertainty}` : ""}`
                            : "Sem dados"
                        }
                      >
                        {/* Wrapper relativo para posicionar o badge NC */}
                        <div className="relative inline-block mx-auto">
                          <div
                            className="rounded flex flex-col items-center justify-center h-10 w-20"
                            style={{ background: cellBgColor(cell, 0.85) }}
                          >
                            <span
                              className={`text-xs font-semibold leading-tight ${cellTextColor(cell)}`}
                            >
                              {pct != null ? `${pct.toFixed(0)}%` : "—"}
                            </span>
                            {cell?.std_tol_pct != null && (
                              <span
                                className={`text-[10px] leading-tight opacity-75 ${cellTextColor(cell)}`}
                              >
                                ±{cell.std_tol_pct.toFixed(0)}%
                              </span>
                            )}
                            {/* Badge de incerteza — canto inferior direito dentro da célula */}
                            {cell && cell.n_uncertainty > 0 && (
                              <span
                                className="absolute bottom-0.5 right-1 text-[8px] font-bold text-amber-700 leading-none"
                                title={`${cell.n_uncertainty} peça(s) na zona de incerteza`}
                              >
                                U
                              </span>
                            )}
                          </div>

                          {/* Badge NC — canto superior direito, fora da célula */}
                          {cell && cell.n_out > 0 && (
                            <span
                              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 z-10 leading-none"
                              title={`${cell.n_out} peça(s) não conforme(s) — Ac=${cell.nqa_ac} Re=${cell.nqa_re}`}
                            >
                              {cell.n_out}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredDims.length === 0 && (
          <div className="flex h-16 items-center justify-center text-sm text-slate-400">
            Nenhuma dimensão com o filtro selecionado.
          </div>
        )}
      </div>

      {/* Escala */}
      <div className="px-5 py-3 border-t border-slate-50 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span>Escala:</span>
        {[0, 25, 50, 75].map((v) => (
          <span key={v} className="flex items-center gap-1">
            <span
              className="inline-block w-4 h-4 rounded"
              style={{ background: cellBgColor({ status: "ok", mean_tol_pct: v } as HeatmapCell) }}
            />
            {v}%
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-4 h-4 rounded"
            style={{ background: cellBgColor({ status: "warning" } as HeatmapCell) }}
          />
          Atenção
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-4 h-4 rounded"
            style={{ background: cellBgColor({ status: "critical" } as HeatmapCell) }}
          />
          Crítico
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5">
            2
          </span>
          NC (badge = quantidade)
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <span className="text-[9px] font-bold text-amber-700">U</span>
          zona de incerteza
        </span>
      </div>
    </div>
  );
}
