import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import type { DimRead, ProfileTrendResponse } from "@/lib/sqc-api";

interface Props {
  data: ProfileTrendResponse;
  dim?: DimRead;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(3);
}

function fmtSigma(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(4);
}

function fmtCap(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function MarginCell({ margin }: { margin: number | null }) {
  if (margin === null) return <td className="px-3 py-2 text-center text-zinc-400">—</td>;
  const ok = margin >= 0;
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums font-medium ${ok ? "text-emerald-600" : "text-red-600"}`}
    >
      {fmt(margin)}
      {!ok && <span className="ml-1 text-xs">⚠</span>}
    </td>
  );
}

function CapCell({
  v,
  minimum,
  warningMinimum,
}: {
  v: number | null | undefined;
  minimum: number | undefined;
  warningMinimum: number | undefined;
}) {
  if (v == null) return <td className="px-3 py-2 text-center text-zinc-400">—</td>;
  const ok = minimum != null && v >= minimum;
  const warn = minimum != null && warningMinimum != null && v >= warningMinimum && v < minimum;
  const bad = warningMinimum != null && v < warningMinimum;
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums font-semibold
      ${ok ? "text-emerald-600" : warn ? "text-amber-600" : bad ? "text-red-600" : "text-zinc-700"}`}
    >
      {fmtCap(v)}
    </td>
  );
}

function NormalCell({ isNormal, p }: { isNormal: boolean | null | undefined; p?: number | null }) {
  if (isNormal == null) return <td className="px-3 py-2 text-center text-zinc-400">—</td>;
  return (
    <td className="px-3 py-2 text-center">
      <span
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium
        ${isNormal ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
      >
        {isNormal ? "✓" : "✗"}
        {p != null && <span className="ml-1 opacity-70">{p.toFixed(3)}</span>}
      </span>
    </td>
  );
}

export function ProfileSigmaTable({ data, dim }: Props) {
  const thresholds = useCapabilityThresholds();
  const minimum = thresholds.data?.default_minimum;
  const warningMinimum = thresholds.data?.warning_minimum;
  if (!data.batches.length) return null;

  const hasMaxData = data.batches.some((b) => b.mean_max != null);
  const hasMinData = data.batches.some((b) => b.mean_min != null);
  const hasCapData = data.batches.some((b) => b.cp_pos != null || b.cp_neg != null);

  if (!hasMaxData && !hasMinData) return null;

  const maxChild = dim?.children.find((c) => c.dim_code.toUpperCase().includes("MAX"));
  const minChild = dim?.children.find((c) => c.dim_code.toUpperCase().includes("MIN"));

  const tolMax = maxChild ? maxChild.nominal + maxChild.tol_plus : dim ? dim.tol_plus : null;
  const tolMin =
    minChild && minChild.tol_minus != null && minChild.tol_minus !== 0
      ? minChild.nominal - Math.abs(minChild.tol_minus)
      : null;

  // colspan: Média + σ + M±3σ + (Margem?) + (Cp + Cpk + Normal?)?
  const maxCols = (tolMax !== null ? 4 : 3) + (hasCapData ? 3 : 0);
  const minCols = (tolMin !== null ? 4 : 3) + (hasCapData ? 3 : 0);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100">
        <span className="text-sm font-semibold text-zinc-700">
          Variação por Sinal — Comparação de Lotes
        </span>
        <span className="ml-2 text-xs text-zinc-400">média ± 3σ · Cp/Cpk · normalidade</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-100 text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-zinc-500 uppercase" rowSpan={2}>
                Lote
              </th>
              <th
                className="px-3 py-2 text-center font-semibold text-zinc-500 uppercase"
                rowSpan={2}
              >
                N
              </th>
              {hasMaxData && (
                <th
                  colSpan={maxCols}
                  className="px-3 py-1.5 text-center font-semibold text-amber-800 uppercase border-l border-amber-200 bg-amber-50/60"
                >
                  Desvios Positivos (MAX)
                </th>
              )}
              {hasMinData && (
                <th
                  colSpan={minCols}
                  className="px-3 py-1.5 text-center font-semibold text-blue-800 uppercase border-l border-blue-200 bg-blue-50/60"
                >
                  Desvios Negativos (MIN)
                </th>
              )}
            </tr>
            <tr>
              {hasMaxData && (
                <>
                  <th className="px-3 py-1.5 text-right font-semibold text-zinc-400 border-l border-zinc-200">
                    Média
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">σ</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">M+3σ</th>
                  {tolMax !== null && (
                    <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">Margem</th>
                  )}
                  {hasCapData && (
                    <>
                      <th className="px-3 py-1.5 text-right font-semibold text-zinc-400 border-l border-zinc-100">
                        Cp
                      </th>
                      <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">Cpk</th>
                      <th className="px-3 py-1.5 text-center font-semibold text-zinc-400">
                        Normal?
                      </th>
                    </>
                  )}
                </>
              )}
              {hasMinData && (
                <>
                  <th className="px-3 py-1.5 text-right font-semibold text-zinc-400 border-l border-zinc-200">
                    Média
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">σ</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">M−3σ</th>
                  {tolMin !== null && (
                    <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">Margem</th>
                  )}
                  {hasCapData && (
                    <>
                      <th className="px-3 py-1.5 text-right font-semibold text-zinc-400 border-l border-zinc-100">
                        Cp
                      </th>
                      <th className="px-3 py-1.5 text-right font-semibold text-zinc-400">Cpk</th>
                      <th className="px-3 py-1.5 text-center font-semibold text-zinc-400">
                        Normal?
                      </th>
                    </>
                  )}
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {data.batches.map((b) => {
              const m3pos =
                b.mean_max != null && b.std_max != null ? b.mean_max + 3 * b.std_max : null;
              const m3neg =
                b.mean_min != null && b.std_min != null ? b.mean_min - 3 * b.std_min : null;
              const marginPos = m3pos != null && tolMax != null ? tolMax - m3pos : null;
              const marginNeg = m3neg != null && tolMin != null ? m3neg - tolMin : null;

              return (
                <tr key={b.batch_id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-3 py-2 font-medium text-zinc-700">{b.tracking_code}</td>
                  <td className="px-3 py-2 text-center text-zinc-500">{b.n}</td>
                  {hasMaxData && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600 border-l border-zinc-200">
                        {fmt(b.mean_max)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {fmtSigma(b.std_max)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-semibold ${marginPos !== null && marginPos < 0 ? "text-red-600" : "text-zinc-800"}`}
                      >
                        {fmt(m3pos)}
                      </td>
                      {tolMax !== null && <MarginCell margin={marginPos} />}
                      {hasCapData && (
                        <>
                          <CapCell v={b.cp_pos} minimum={minimum} warningMinimum={warningMinimum} />
                          <CapCell
                            v={b.cpk_pos}
                            minimum={minimum}
                            warningMinimum={warningMinimum}
                          />
                          <NormalCell isNormal={b.is_normal_pos} />
                        </>
                      )}
                    </>
                  )}
                  {hasMinData && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-600 border-l border-zinc-200">
                        {fmt(b.mean_min)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {fmtSigma(b.std_min)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-semibold ${marginNeg !== null && marginNeg < 0 ? "text-red-600" : "text-zinc-800"}`}
                      >
                        {fmt(m3neg)}
                      </td>
                      {tolMin !== null && <MarginCell margin={marginNeg} />}
                      {hasCapData && (
                        <>
                          <CapCell v={b.cp_neg} minimum={minimum} warningMinimum={warningMinimum} />
                          <CapCell
                            v={b.cpk_neg}
                            minimum={minimum}
                            warningMinimum={warningMinimum}
                          />
                          <NormalCell isNormal={b.is_normal_neg} />
                        </>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          {(tolMax !== null || tolMin !== null) && (
            <tfoot className="bg-zinc-50 border-t border-zinc-200">
              <tr>
                <td className="px-3 py-2 text-xs font-semibold text-zinc-500" colSpan={2}>
                  Limite de tolerância
                </td>
                {hasMaxData && (
                  <>
                    <td className="px-3 py-2 border-l border-zinc-200" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold text-amber-700">
                      {fmt(tolMax)}
                    </td>
                    {tolMax !== null && <td className="px-3 py-2" />}
                    {hasCapData && (
                      <>
                        <td />
                        <td />
                        <td />
                      </>
                    )}
                  </>
                )}
                {hasMinData && (
                  <>
                    <td className="px-3 py-2 border-l border-zinc-200" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold text-blue-700">
                      {fmt(tolMin)}
                    </td>
                    {tolMin !== null && <td className="px-3 py-2" />}
                    {hasCapData && (
                      <>
                        <td />
                        <td />
                        <td />
                      </>
                    )}
                  </>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
