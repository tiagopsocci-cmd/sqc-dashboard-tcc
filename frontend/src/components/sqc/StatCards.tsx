import { InfoTooltip } from "@/components/sqc/InfoTooltip";
import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import type { StatisticsResponse } from "@/lib/sqc-api";

interface Props {
  data: StatisticsResponse;
  toleranceOverridden?: boolean;
  unit?: string;
}

function fmt(v: number | null | undefined, decimals = 3, unit = ""): string {
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "∞";
  return `${v.toFixed(decimals)}${unit}`;
}

function MmcBadge() {
  return (
    <span
      className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 align-middle"
      title="Calculado via ratio normalizado — valor / USL efetivo por peça (MMC/LMC)"
    >
      MMC
    </span>
  );
}

function SimBadge() {
  return (
    <span
      className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 align-middle"
      title="Recalculado com a tolerância simulada — não reflete os valores do desenho"
    >
      SIM
    </span>
  );
}

function Card({
  label,
  value,
  warn,
  tooltip,
  mmcBadge,
}: {
  label: string;
  value: string;
  warn?: boolean;
  tooltip?: React.ReactNode;
  mmcBadge?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
    >
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        {mmcBadge && <MmcBadge />}
        {tooltip}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

type Status = "good" | "warning" | "bad" | "neutral";

const STATUS_CARD: Record<Status, string> = {
  good: "border-emerald-200 bg-emerald-50",
  warning: "border-amber-200   bg-amber-50",
  bad: "border-red-200     bg-red-50",
  neutral: "border-slate-200    bg-white",
};
const STATUS_VALUE: Record<Status, string> = {
  good: "text-emerald-700",
  warning: "text-amber-700",
  bad: "text-red-700",
  neutral: "text-slate-900",
};

function MetricCard({
  label,
  value,
  unit,
  subValue,
  status,
  tooltip,
  mmcBadge,
  simBadge,
}: {
  label: string;
  value: string;
  unit?: string;
  subValue?: string;
  status: Status;
  tooltip: React.ReactNode;
  mmcBadge?: boolean;
  simBadge?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${STATUS_CARD[status]}`}>
      <div className="flex items-center gap-1 mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {mmcBadge && <MmcBadge />}
        {simBadge && <SimBadge />}
        {tooltip}
      </div>
      <div className="flex items-baseline gap-4">
        <p className={`text-2xl font-bold tabular-nums ${STATUS_VALUE[status]}`}>
          {value}
          {unit && <span className="text-sm font-normal ml-1 text-slate-500">{unit}</span>}
        </p>
        {subValue && (
          <p className={`text-base font-semibold tabular-nums ${STATUS_VALUE[status]} opacity-75`}>
            {subValue}
          </p>
        )}
      </div>
    </div>
  );
}

function dppmStatus(
  value: number | null,
  goodMaximum: number | undefined,
  warningMaximum: number | undefined,
): Status {
  if (value == null || goodMaximum == null || warningMaximum == null) return "neutral";
  if (value < goodMaximum) return "good";
  if (value < warningMaximum) return "warning";
  return "bad";
}

function fmtDppm(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return "< 1";
  if (v >= 1e6) return "> 1 M";
  return Math.round(v).toLocaleString("pt-BR");
}

function fmtDppmPct(v: number | null): string {
  if (v == null) return "";
  if (v < 1) return "< 0,0001%";
  if (v >= 1e6) return "100%";
  const pct = v / 10_000;
  if (pct < 0.01)
    return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`;
  if (pct < 1)
    return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function StatCards({ data, toleranceOverridden, unit = "" }: Props) {
  const thresholds = useCapabilityThresholds();
  const minimum = thresholds.data?.default_minimum;
  const cpkWarn = minimum != null && (data.cpk ?? data.cpu ?? 0) < minimum;

  return (
    <div className="space-y-3">
      {/* Alertas */}
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
          peça). Estatísticas descritivas permanecem em unidades físicas.
        </div>
      )}
      {data.bonus_missing_rel && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Dimensão de tamanho relacionada não configurada — Cpu indisponível. Configure a dimensão
          de tamanho associada a esta posição para habilitar.
        </div>
      )}

      {/* Linha 1 — Índices de capabilidade (largura total) */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Índices de Capabilidade
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.is_unilateral ? (
            <Card
              label="Cpu"
              value={fmt(data.cpu)}
              warn={minimum != null && (data.cpu ?? 0) < minimum}
              mmcBadge={data.has_bonus}
              tooltip={
                <>
                  {toleranceOverridden && <SimBadge />}
                  <InfoTooltip
                    align="left"
                    title="Cpu — Capacidade Unilateral"
                    what="Mede a capacidade do processo considerando apenas o limite superior. Usa σ Within para estimar a variação natural."
                    formula={"Cpu = (USL − x̄) / (3 × σ Within)"}
                    thresholds={[
                      {
                        color: "green",
                        label: "≥ 1,33",
                        description: "Capaz (requisito padrão automotivo)",
                      },
                      { color: "amber", label: "1,00–1,33", description: "Aceitável, monitorar" },
                      { color: "red", label: "< 1,00", description: "Incapaz" },
                    ]}
                  />
                </>
              }
            />
          ) : (
            <>
              <Card
                label="Cp"
                value={fmt(data.cp)}
                tooltip={
                  <>
                    {toleranceOverridden && <SimBadge />}
                    <InfoTooltip
                      align="left"
                      title="Cp — Capacidade Potencial"
                      what="Compara a largura da tolerância com a variação natural do processo. Assume que o processo está centrado no nominal — não considera descentramento."
                      formula={"Cp = (USL − LSL) / (6 × σ Within)"}
                      thresholds={[
                        { color: "green", label: "≥ 1,33", description: "Capaz" },
                        { color: "amber", label: "1,00–1,33", description: "Marginal" },
                        { color: "red", label: "< 1,00", description: "Incapaz" },
                      ]}
                      note="Cp ≥ Cpk sempre. A diferença entre eles indica o quanto o descentramento está reduzindo a capacidade."
                    />
                  </>
                }
              />
              <Card
                label="Cpk"
                value={fmt(data.cpk)}
                warn={cpkWarn}
                tooltip={
                  <>
                    {toleranceOverridden && <SimBadge />}
                    <InfoTooltip
                      align="right"
                      title="Cpk — Capacidade Real"
                      what="Como o Cp, mas considera onde a média está dentro da tolerância. Se o processo está descentrado, o Cpk é menor que o Cp."
                      formula={
                        "Cpk = min(Cpu, Cpl)\n\nCpu = (USL − x̄) / (3·σ Within)\nCpl = (x̄ − LSL) / (3·σ Within)"
                      }
                      thresholds={[
                        { color: "green", label: "≥ 1,33", description: "Capaz e centrado" },
                        { color: "amber", label: "1,00–1,33", description: "Aceitável" },
                        { color: "red", label: "< 1,00", description: "Incapaz" },
                      ]}
                    />
                  </>
                }
              />
            </>
          )}
        </div>
      </div>

      {/* Linha 2 — σ Within + DPPM + n */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* σ Within */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              {data.has_bonus ? "σ da capability (ratio)" : "σ Within"}
            </p>
            <InfoTooltip
              align="left"
              title="σ Within — Desvio Padrão (curto prazo)"
              what="Desvio padrão estimado da variação natural do processo. Base de cálculo dos índices Cp e Cpk."
              formula={"σ Within = R̄ / d₂  (com subgrupos)\nσ Within = s  (sem subgrupos)"}
            />
          </div>
          <p className="text-2xl font-semibold tabular-nums text-slate-900">
            {data.has_bonus
              ? fmt(data.capability_basis.std_short, 4)
              : fmt(data.std_sample, 3, unit)}
          </p>
        </div>

        {/* DPPM */}
        {!data.degenerate ? (
          <MetricCard
            label="DPPM — Defeitos por Milhão"
            mmcBadge={data.has_bonus}
            simBadge={toleranceOverridden}
            value={fmtDppm(data.dppm)}
            unit="ppm"
            subValue={fmtDppmPct(data.dppm)}
            status={dppmStatus(
              data.dppm,
              thresholds.data?.dppm_good_max,
              thresholds.data?.dppm_warning_max,
            )}
            tooltip={
              <InfoTooltip
                align="left"
                title="DPPM — Defeitos por Milhão"
                what="Estima quantas peças defeituosas seriam produzidas em cada 1 milhão, com base na distância entre a média e os limites de especificação."
                formula={
                  "DPPM = [Φ(−(USL−x̄)/σ) + Φ(−(x̄−LSL)/σ)] × 1.000.000\n\nΦ = distribuição normal acumulada"
                }
                thresholds={[
                  {
                    color: "green",
                    label: "< 1.000",
                    description: `Processo capaz (Cpk ≥ ${minimum?.toFixed(2) ?? "—"})`,
                  },
                  {
                    color: "amber",
                    label: "1.000 – 10.000",
                    description: "Atenção (Cpk entre 1,0 e 1,33)",
                  },
                  { color: "red", label: "> 10.000", description: "Processo incapaz (Cpk < 1,0)" },
                ]}
                note="Assume distribuição normal. Para cotas geométricas (Weibull), o valor é uma estimativa aproximada."
              />
            }
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              DPPM — Defeitos por Milhão
            </p>
            <p className="text-2xl font-bold text-slate-400">—</p>
          </div>
        )}

        {/* n */}
        <Card label="n (amostras)" value={String(data.n)} />
      </div>

      {/* Linha 3 — Estatísticas descritivas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Média (x̄)" value={fmt(data.mean, 3, unit)} />
        <Card label="Máximo" value={fmt(data.max, 3, unit)} />
        <Card label="Mínimo" value={fmt(data.min, 3, unit)} />
        <Card label="Amplitude" value={fmt(data.range, 3, unit)} />
      </div>

      {/* Alertas de incerteza */}
      {(data.n_uncertainty_at_risk > 0 || data.n_uncertainty_recoverable > 0) && (
        <div className="space-y-2">
          {data.n_uncertainty_at_risk > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <span className="mt-0.5 shrink-0 font-bold">⚠</span>
              <span>
                <span className="font-semibold">{data.n_uncertainty_at_risk}</span> peça
                {data.n_uncertainty_at_risk > 1 ? "s aprovadas" : " aprovada"} dentro da faixa de
                incerteza do instrumento — o resultado pode variar entre aprovado e reprovado.
              </span>
            </div>
          )}
          {data.n_uncertainty_recoverable > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
              <span className="mt-0.5 shrink-0 font-bold">ℹ</span>
              <span>
                <span className="font-semibold">{data.n_uncertainty_recoverable}</span> peça
                {data.n_uncertainty_recoverable > 1 ? "s reprovadas" : " reprovada"} dentro da faixa
                de incerteza — uma nova medição poderia resultar em aprovação.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
