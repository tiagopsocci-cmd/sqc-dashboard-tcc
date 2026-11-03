import { type ReactNode, useCallback, useEffect, useState } from "react";

export interface PinnedChartPoint {
  sampleNumber: number | string;
  value?: number;
  valueLabel?: string;
  details?: ReactNode;
}

export const RANGESLIDER_MIN_POINTS = 20;

export function hasRangeslider(pointCount: number) {
  return pointCount > RANGESLIDER_MIN_POINTS;
}

export function sampleAxis(pointCount: number, dtick?: number) {
  const showRangeslider = hasRangeslider(pointCount);
  const rangesliderConfig = showRangeslider
    ? { rangeslider: { visible: true, thickness: 0.08 } }
    : {};
  if (dtick !== undefined) {
    return { tickmode: "linear" as const, dtick, ...rangesliderConfig };
  }
  return {
    tickmode: "auto" as const,
    nticks: showRangeslider ? 12 : Math.max(1, pointCount),
    ...rangesliderConfig,
  };
}

// Menor step inteiro "redondo" (1, 2, 5, 10, 20, 50…) que cabe ~targetTicks vezes no intervalo.
// Garante dtick >= 1 mesmo com intervalos pequenos, para nunca gerar ticks fracionários
// num eixo que representa amostras/peças (unidades discretas).
function niceIntegerStep(range: number, targetTicks = 10): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rawStep = Math.max(1, range / targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = multiplier * magnitude;
    if (candidate >= rawStep) return Math.max(1, Math.round(candidate));
  }
  return Math.max(1, Math.round(10 * magnitude));
}

/**
 * Mantém o eixo X de amostra/peça em passos inteiros ao dar zoom (via rangeslider ou
 * seleção no gráfico). Sem isso, o tick automático do Plotly escolhe passos fracionários
 * (ex: 0.2) quando o intervalo visível é pequeno, o que não faz sentido para um eixo discreto.
 * `resetKey` deve mudar sempre que os dados plotados mudarem (lote/dimensão/cavidade).
 */
export function useIntegerSampleAxis(resetKey: string | number) {
  const [dtick, setDtick] = useState<number | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset zoom step when plotted values change
  useEffect(() => setDtick(undefined), [resetKey]);

  const onRelayout = useCallback((event: Readonly<Plotly.PlotRelayoutEvent>) => {
    if (event["xaxis.autorange"]) {
      setDtick(undefined);
      return;
    }
    // O rangeslider emite "xaxis.range" como [min, max]; zoom por seleção no gráfico
    // emite "xaxis.range[0]"/"xaxis.range[1]" separados. Os dois precisam ser tratados.
    const rangeTuple = event["xaxis.range"];
    const [x0, x1] =
      Array.isArray(rangeTuple) && rangeTuple.length === 2
        ? rangeTuple
        : [event["xaxis.range[0]"], event["xaxis.range[1]"]];
    if (typeof x0 === "number" && typeof x1 === "number") {
      setDtick(niceIntegerStep(Math.abs(x1 - x0)));
    }
  }, []);

  return { dtick, onRelayout };
}

export interface ChartLegendItem {
  label: string;
  color: string;
  dash?: "solid" | "dash" | "dot" | "dashdot";
}

const DASH_PATTERN: Record<NonNullable<ChartLegendItem["dash"]>, string | undefined> = {
  solid: undefined,
  dash: "5,3",
  dot: "1,2",
  dashdot: "5,2,1,2",
};

// Legenda renderizada em HTML, fora do canvas do Plotly — evita a disputa de espaço
// entre o título do eixo, os ticks e a legenda nativa quando o rangeslider está visível.
export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-600">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="16"
              y2="4"
              stroke={item.color}
              strokeWidth="2"
              strokeDasharray={DASH_PATTERN[item.dash ?? "solid"]}
            />
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function PinnedPointCard({
  point,
  onClose,
}: {
  point: PinnedChartPoint;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <div className="min-w-0">
        <div className="font-semibold">Amostra/peça {point.sampleNumber}</div>
        {point.value !== undefined && (
          <div className="mt-0.5 tabular-nums">
            {point.valueLabel ?? "Valor"}: {point.value.toFixed(4)}
          </div>
        )}
        {point.details && <div className="mt-0.5">{point.details}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded px-1 text-blue-500 hover:bg-blue-100 hover:text-blue-800"
        aria-label="Fechar ponto fixado"
        title="Fechar"
      >
        ×
      </button>
    </div>
  );
}
