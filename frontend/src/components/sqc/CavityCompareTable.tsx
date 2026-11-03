import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import { sqcApi } from "@/lib/sqc-api";
import { useQueries } from "@tanstack/react-query";

interface Props {
  batchId: string;
  dimId: string;
  cavities: number[];
  isUnilateral?: boolean;
}

function fmt(v: number | null | undefined, d = 3): string {
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "∞";
  return v.toFixed(d);
}

function Cell({ value, warn, mmc }: { value: string; warn?: boolean; mmc?: boolean }) {
  return (
    <td
      className={`px-4 py-2 text-center tabular-nums text-sm font-medium ${warn ? "text-amber-600" : "text-slate-800"}`}
    >
      {value}
      {mmc && (
        <span
          className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 align-middle"
          title="Calculado via ratio normalizado — valor / USL efetivo por peça (MMC/LMC)"
        >
          MMC
        </span>
      )}
    </td>
  );
}

export function CavityCompareTable({ batchId, dimId, cavities, isUnilateral }: Props) {
  const thresholds = useCapabilityThresholds();
  const minimum = thresholds.data?.default_minimum;
  // Query agregada (todas as cavidades) + uma por cavity
  const allQueries = useQueries({
    queries: [null, ...cavities].map((cavity) => ({
      queryKey: ["sqc", "statistics", batchId, dimId, cavity],
      queryFn: () =>
        sqcApi.getStatistics(batchId, dimId, undefined, undefined, cavity ?? undefined),
    })),
  });

  const loading = allQueries.some((q) => q.isLoading);
  if (loading) {
    return (
      <div className="space-y-2">
        {[null, ...cavities].map((c) => (
          <div key={c ?? "all"} className="h-10 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    );
  }

  const unilateral = isUnilateral ?? allQueries.find((q) => q.data)?.data?.is_unilateral ?? false;
  const isRectangle = allQueries.some((q) => q.data?.critical_axis != null);
  const colCount = (unilateral ? 5 : 6) + (isRectangle ? 2 : 0);

  const rows = [null, ...cavities];

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="px-4 py-3 text-left font-medium text-slate-500">Cavity</th>
            <th className="px-4 py-3 text-center font-medium text-slate-500">n</th>
            <th className="px-4 py-3 text-center font-medium text-slate-500">Média</th>
            <th
              className="px-4 py-3 text-center font-medium text-slate-500"
              title={`σ Within — curto prazo, base do ${unilateral ? "Cpu" : "Cp/Cpk"}`}
            >
              σ Within
            </th>
            {unilateral ? (
              <th className="px-4 py-3 text-center font-medium text-slate-500">Cpu</th>
            ) : (
              <>
                <th className="px-4 py-3 text-center font-medium text-slate-500">Cp</th>
                <th className="px-4 py-3 text-center font-medium text-slate-500">Cpk</th>
              </>
            )}
            <th className="px-4 py-3 text-center font-medium text-slate-500">% Tol. Média</th>
            {isRectangle && (
              <>
                <th className="px-4 py-3 text-center font-medium text-slate-500">
                  Direção crítica
                </th>
                <th className="px-4 py-3 text-center font-medium text-slate-500">Não avaliáveis</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((cavity, i) => {
            const d = allQueries[i]?.data;
            const isAll = cavity === null;

            if (!d) {
              return (
                <tr
                  key={cavity ?? "all"}
                  className={`border-b border-slate-100 ${isAll ? "bg-slate-50" : ""}`}
                >
                  <td className="px-4 py-2 text-sm text-slate-500">
                    {isAll ? "Todas" : `Cav. ${cavity}`}
                  </td>
                  <td colSpan={colCount} className="px-4 py-2 text-center text-xs text-red-500">
                    Erro ao carregar
                  </td>
                </tr>
              );
            }

            return (
              <tr
                key={cavity ?? "all"}
                className={`border-b border-slate-100 hover:bg-slate-50 ${isAll ? "bg-slate-50/60" : ""}`}
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {isAll ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-400 text-white text-[10px] font-bold shrink-0">
                        ∑
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0">
                        {cavity}
                      </span>
                    )}
                    <span className="text-xs font-medium text-slate-600">
                      {isAll ? "Todas" : `Cav. ${cavity}`}
                    </span>
                  </div>
                  {d.insufficient_sample && (
                    <span className="ml-8 text-xs text-amber-500" title="Amostra insuficiente">
                      ⚠ Amostra insuficiente
                    </span>
                  )}
                </td>
                <Cell value={String(d.n)} />
                <Cell value={fmt(d.mean, 3)} />
                <Cell value={fmt(d.std_sample, 3)} />
                {unilateral ? (
                  <Cell
                    value={fmt(d.cpu)}
                    warn={minimum != null && (d.cpu ?? 0) < minimum}
                    mmc={d.has_bonus}
                  />
                ) : (
                  <>
                    <Cell value={fmt(d.cp)} mmc={d.has_bonus} />
                    <Cell
                      value={fmt(d.cpk)}
                      warn={minimum != null && (d.cpk ?? 0) < minimum}
                      mmc={d.has_bonus}
                    />
                  </>
                )}
                <Cell
                  value={
                    d.mean_tolerance_pct != null
                      ? `${d.mean_tolerance_pct.toFixed(1)}% ±${(d.std_tolerance_pct ?? 0).toFixed(1)}%`
                      : "—"
                  }
                  warn={(d.mean_tolerance_pct ?? 0) > 80}
                />
                {isRectangle && (
                  <>
                    <Cell
                      value={
                        d.critical_axis == null
                          ? "—"
                          : d.critical_axis === "both"
                            ? "Ambas"
                            : d.critical_axis
                      }
                    />
                    <Cell value={String(d.non_evaluable_count)} warn={d.non_evaluable_count > 0} />
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-slate-400">
        Valores em laranja: {unilateral ? "Cpu" : "Cpk"} &lt; 1,33 ou % Tol. Média &gt; 80%. ⚠ =
        amostra insuficiente (n &lt; 5).
        {allQueries.some((q) => q.data?.has_bonus) && (
          <>
            {" "}
            ·{" "}
            <span className="inline rounded px-1 bg-violet-100 text-violet-700 font-semibold">
              MMC
            </span>{" "}
            = índices calculados via ratio normalizado (valor / USL efetivo por peça).
          </>
        )}
      </p>
    </div>
  );
}
