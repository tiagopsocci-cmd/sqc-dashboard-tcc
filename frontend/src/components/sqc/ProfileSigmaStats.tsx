import type { TolOverride } from "@/components/sqc/DimInfoBar";
import { InfoTooltip } from "@/components/sqc/InfoTooltip";
import type { ProfileChildOverride } from "@/components/sqc/ProfileDeviationChart";
import { useCapabilityThresholds } from "@/hooks/use-capability-thresholds";
import type {
  DimRead,
  InspectionsDetailResponse,
  ProfileDistributionResponse,
} from "@/lib/sqc-api";

interface SigmaSide {
  label: string;
  n: number;
  mean: number;
  sigma: number;
  meanPlus3s: number;
  meanMinus3s: number;
  tolLimit: number | null;
  margin: number | null;
  sign: "pos" | "neg";
  cp: number | null;
  cpk: number | null;
  isNormal: boolean | null;
  normalityP: number | null;
}

interface Props {
  data: InspectionsDetailResponse;
  dim: DimRead;
  tolOverride?: TolOverride | null;
  profileChildOverride?: ProfileChildOverride | null;
  distData?: ProfileDistributionResponse | null;
}

function calcStd(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
}

function calcMean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function fmt(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(3);
}

function fmtCap(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function SideCard({
  s,
  minimum,
  warningMinimum,
}: {
  s: SigmaSide;
  minimum: number | undefined;
  warningMinimum: number | undefined;
}) {
  const marginOk = s.margin !== null && s.margin >= 0;
  const marginWarn = s.margin !== null && s.margin < 0;
  const cpkOk = s.cpk != null && minimum != null && s.cpk >= minimum;
  const cpkWarn =
    s.cpk != null &&
    minimum != null &&
    warningMinimum != null &&
    s.cpk >= warningMinimum &&
    s.cpk < minimum;
  const cpkBad = s.cpk != null && warningMinimum != null && s.cpk < warningMinimum;

  return (
    <div
      className={`rounded-lg border p-4 space-y-3
      ${marginWarn ? "border-red-200 bg-red-50/50" : "border-zinc-200 bg-white"}`}
    >
      {/* Header: label + badge normalidade */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-semibold text-zinc-700">{s.label}</span>
        <div className="flex items-center gap-1.5">
          {s.isNormal != null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
              ${s.isNormal ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
            >
              {s.isNormal ? "Normal" : "Não-normal"}
              {s.normalityP != null && (
                <span className="opacity-70">(p={s.normalityP.toFixed(3)})</span>
              )}
            </span>
          )}
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
            note="Sensível ao tamanho amostral — com n < 8 o teste tem baixa potência."
            align="right"
          />
          <span className="text-xs text-zinc-400">{s.n} peças</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        <span className="text-zinc-500">Média</span>
        <span className="tabular-nums font-medium text-zinc-800">{fmt(s.mean)}</span>

        <span className="text-zinc-500">σ (desvio padrão)</span>
        <span className="tabular-nums font-medium text-zinc-800">{s.sigma.toFixed(4)}</span>

        <span className="text-zinc-400 col-span-2 border-t border-zinc-100 pt-1 mt-0.5">
          Limites simulados (±3σ)
        </span>

        <span className="text-zinc-500">Média + 3σ</span>
        <span
          className={`tabular-nums font-semibold ${
            s.sign === "pos" && s.tolLimit !== null && s.meanPlus3s > s.tolLimit
              ? "text-red-600"
              : "text-zinc-800"
          }`}
        >
          {fmt(s.meanPlus3s)}
        </span>

        <span className="text-zinc-500">Média − 3σ</span>
        <span
          className={`tabular-nums font-semibold ${
            s.sign === "neg" && s.tolLimit !== null && s.meanMinus3s < s.tolLimit
              ? "text-red-600"
              : "text-zinc-800"
          }`}
        >
          {fmt(s.meanMinus3s)}
        </span>

        {s.tolLimit !== null && (
          <>
            <span className="text-zinc-400 col-span-2 border-t border-zinc-100 pt-1 mt-0.5">
              Tolerância
            </span>
            <span className="text-zinc-500">Limite</span>
            <span className="tabular-nums text-zinc-600">{fmt(s.tolLimit)}</span>

            <span className="text-zinc-500">Margem (3σ)</span>
            <span
              className={`tabular-nums font-semibold ${
                marginOk ? "text-emerald-600" : marginWarn ? "text-red-600" : "text-zinc-500"
              }`}
            >
              {s.margin !== null ? fmt(s.margin) : "—"}
              {marginOk && <span className="ml-1 text-zinc-400 font-normal">(OK)</span>}
              {marginWarn && <span className="ml-1 font-normal">(⚠ excede)</span>}
            </span>
          </>
        )}

        {(s.cp != null || s.cpk != null) && (
          <>
            <span className="text-zinc-400 col-span-2 border-t border-zinc-100 pt-1 mt-0.5">
              Capabilidade bilateral
            </span>
            <span className="text-zinc-500">Cp</span>
            <span className="tabular-nums font-medium text-zinc-800">{fmtCap(s.cp)}</span>
            <span className="text-zinc-500">Cpk</span>
            <span
              className={`tabular-nums font-semibold ${
                cpkOk
                  ? "text-emerald-600"
                  : cpkWarn
                    ? "text-amber-600"
                    : cpkBad
                      ? "text-red-600"
                      : "text-zinc-800"
              }`}
            >
              {fmtCap(s.cpk)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function ProfileSigmaStats({ data, dim, profileChildOverride, distData }: Props) {
  const thresholds = useCapabilityThresholds();
  const minimum = thresholds.data?.default_minimum;
  const warningMinimum = thresholds.data?.warning_minimum;
  const rows = data.rows.filter((r) => r.point_max != null || r.point_min != null);
  if (rows.length === 0) return null;

  const maxVals = rows.map((r) => r.point_max).filter((v): v is number => v != null);
  const minVals = rows.map((r) => r.point_min).filter((v): v is number => v != null);

  if (maxVals.length === 0 && minVals.length === 0) return null;

  // Tolerâncias com suporte a override dos filhos
  const maxChild = dim.children.find((c) => c.dim_code.toUpperCase().includes("MAX"));
  const minChild = dim.children.find((c) => c.dim_code.toUpperCase().includes("MIN"));

  const origMaxTol = maxChild?.tol_plus ?? dim.tol_plus;
  const origMinTol =
    minChild?.tol_minus != null && minChild.tol_minus !== 0 ? Math.abs(minChild.tol_minus) : null;

  const effMaxTol =
    profileChildOverride?.maxTol !== undefined ? profileChildOverride.maxTol : origMaxTol;
  const effMinTol =
    profileChildOverride?.minTol !== undefined ? profileChildOverride.minTol : origMinTol;

  // USL e LSL bilaterais — mesmos usados no backend e no ProfileDeviationChart
  const usl = maxChild ? maxChild.nominal + effMaxTol : effMaxTol;
  const lsl =
    minChild && effMinTol != null
      ? minChild.nominal - effMinTol
      : effMinTol != null
        ? -effMinTol
        : null;

  const sides: SigmaSide[] = [];

  if (maxVals.length >= 2) {
    const m = calcMean(maxVals);
    const s = calcStd(maxVals);
    const p3 = m + 3 * s;
    const cap = { cp: distData?.pos?.cp ?? null, cpk: distData?.pos?.cpk ?? null };
    sides.push({
      label: "Desvios Positivos (MAX)",
      n: maxVals.length,
      mean: m,
      sigma: s,
      meanPlus3s: p3,
      meanMinus3s: m - 3 * s,
      tolLimit: usl,
      margin: usl !== null ? usl - p3 : null,
      sign: "pos",
      ...cap,
      isNormal: distData?.pos?.is_normal ?? null,
      normalityP: distData?.pos?.normality_p ?? null,
    });
  }

  if (minVals.length >= 2) {
    const m = calcMean(minVals);
    const s = calcStd(minVals);
    const m3 = m - 3 * s;
    const cap = { cp: distData?.neg?.cp ?? null, cpk: distData?.neg?.cpk ?? null };
    sides.push({
      label: "Desvios Negativos (MIN)",
      n: minVals.length,
      mean: m,
      sigma: s,
      meanPlus3s: m + 3 * s,
      meanMinus3s: m3,
      tolLimit: lsl,
      margin: lsl !== null ? m3 - lsl : null,
      sign: "neg",
      ...cap,
      isNormal: distData?.neg?.is_normal ?? null,
      normalityP: distData?.neg?.normality_p ?? null,
    });
  }

  if (sides.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-zinc-700">Análise de Variação por Sinal</span>
        <span className="text-xs text-zinc-400">média ± 3σ · Cp/Cpk bilateral</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sides.map((s) => (
          <SideCard key={s.label} s={s} minimum={minimum} warningMinimum={warningMinimum} />
        ))}
      </div>
    </div>
  );
}
