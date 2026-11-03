import { type GroupedTolOverride, GroupedToleranceBar } from "@/components/sqc/GroupedToleranceBar";
import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import type { DimRead, GroupedStatisticsResponse } from "@/lib/sqc-api";

interface Props {
  data: GroupedStatisticsResponse;
  unit?: string;
  dim?: DimRead;
  batchIds?: string[];
  cavity?: number | null;
  tolOverride?: GroupedTolOverride | null;
  onTolOverrideChange?: (override: GroupedTolOverride | null) => void;
}

function fmt(v: number | null | undefined, decimals = 3, unit = ""): string {
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "∞";
  return `${v.toFixed(decimals)}${unit}`;
}

function Card({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 ${warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
    >
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

const BATCH_STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprovado",
  IN_ANALYSIS: "Em análise",
  REJECTED: "Reprovado",
};

/** Exibe os índices de capabilidade calculados de forma agrupada (pooled) sobre múltiplos
 * lotes (spec 252, FR-001..FR-005) — distinto da CapabilityCompareTable, que mostra um Cp/Cpk
 * independente por lote lado a lado. Aqui n/mean/std são combinados num único resultado. */
export function GroupedStatisticsView({
  data,
  unit = "",
  dim,
  batchIds,
  cavity,
  tolOverride,
  onTolOverrideChange,
}: Props) {
  const thresholds = useCapabilityThresholds();
  const minimum = thresholds.data?.default_minimum;
  const cpkWarn = minimum != null && (data.cpk ?? data.cpu ?? 0) < minimum;

  return (
    <div className="space-y-4">
      {dim && batchIds && onTolOverrideChange && (
        <GroupedToleranceBar
          dim={dim}
          override={tolOverride ?? null}
          onChange={onTolOverrideChange}
          batchIds={batchIds}
          dimId={dim.id}
          cavity={cavity}
          unit={unit}
        />
      )}
      {data.tolerance_overridden && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Simulação ativa — índices recalculados com tolerância/nominal alternativos.
        </div>
      )}
      {data.insufficient_sample && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Amostra insuficiente (n={data.n}) — resultados podem não ser estatisticamente confiáveis.
        </div>
      )}
      {data.degenerate && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Desvio padrão = 0 — todas as medições são idênticas. Índices de capabilidade
          indeterminados.
        </div>
      )}
      {data.is_unilateral && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          Tolerância unilateral — exibindo apenas Cpu.
        </div>
      )}
      {data.has_bonus && (
        <div className="rounded-md border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-700">
          Tolerância MMC/LMC — índices calculados via ratio normalizado (valor / limite efetivo por
          peça). Média e desvios descritivos abaixo permanecem em unidades físicas.
        </div>
      )}
      {data.bonus_missing_rel && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Dimensão de tamanho relacionada não configurada — Cpu indisponível.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Índices de Capabilidade Agrupados ({data.batches.length} lotes)
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {data.is_unilateral ? (
            <Card
              label="Cpu"
              value={fmt(data.cpu)}
              warn={minimum != null && (data.cpu ?? 0) < minimum}
            />
          ) : (
            <>
              <Card label="Cp" value={fmt(data.cp)} />
              <Card label="Cpk" value={fmt(data.cpk)} warn={cpkWarn} />
            </>
          )}
          <Card label={data.has_bonus ? "Pp (ratio)" : "Pp"} value={fmt(data.pp)} />
          <Card label={data.has_bonus ? "Ppk (ratio)" : "Ppk"} value={fmt(data.ppk)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="n total" value={String(data.n)} />
        <Card label="Média" value={fmt(data.mean, 3, unit)} />
        <Card label="σ Within bruto" value={fmt(data.std_pooled, 3, unit)} />
        <Card label="σ Overall bruto" value={fmt(data.std_global, 3, unit)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-2 text-left font-medium text-slate-500">Lote</th>
              <th className="px-4 py-2 text-center font-medium text-slate-500">Status</th>
              <th className="px-4 py-2 text-center font-medium text-slate-500">n válido</th>
              <th className="px-4 py-2 text-center font-medium text-slate-500">n ignorado</th>
              <th className="px-4 py-2 text-center font-medium text-slate-500">Revisão</th>
            </tr>
          </thead>
          <tbody>
            {data.batches.map((b) => (
              <tr key={b.batch_id} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{b.tracking_code}</td>
                <td className="px-4 py-2 text-center text-xs text-slate-600">
                  {BATCH_STATUS_LABEL[b.batch_status] ?? b.batch_status}
                </td>
                <td className="px-4 py-2 text-center tabular-nums">{b.n}</td>
                <td className="px-4 py-2 text-center tabular-nums text-slate-500">{b.n_ignored}</td>
                <td className="px-4 py-2 text-center">
                  {b.revision_mismatch ? (
                    <span
                      className="text-amber-600"
                      title="Revisão de desenho diverge dos demais lotes selecionados"
                    >
                      ⚠ Divergente
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
