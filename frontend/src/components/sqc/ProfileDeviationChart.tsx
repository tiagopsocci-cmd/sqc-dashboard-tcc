import type { TolOverride } from "@/components/sqc/DimInfoBar";
import type { DimRead, InspectionsDetailResponse } from "@/lib/sqc-api";
import { useCallback, useEffect, useRef, useState } from "react";
import Plot from "react-plotly.js";
import {
  type PinnedChartPoint,
  PinnedPointCard,
  hasRangeslider,
  sampleAxis,
  useIntegerSampleAxis,
} from "./ChartInteraction";

export interface ProfileChildOverride {
  maxTol?: number;
  minTol?: number;
}

const AMBER = "#f59e0b";
const AMBER_FILL = "rgba(245, 158, 11, 0.7)";
const RED = "#ef4444";
const BLUE = "#3b82f6";
const ZINC_LINE = "#71717a";

interface Props {
  data: InspectionsDetailResponse;
  dim: DimRead;
  tolOverride?: TolOverride | null;
  profileChildOverride?: ProfileChildOverride | null;
  onProfileChildOverride?: (o: ProfileChildOverride | null) => void;
}

function EditableSpecChip({
  label,
  value,
  originalValue,
  prefix,
  color,
  onChange,
}: {
  label: string;
  value: number;
  originalValue: number;
  prefix: string;
  color: string;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const isChanged = Math.abs(value - originalValue) > 1e-9;

  const commit = useCallback(() => {
    const n = Number.parseFloat(draft);
    if (!Number.isNaN(n) && n >= 0) onChange(n);
    setEditing(false);
  }, [draft, onChange]);

  if (editing) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-zinc-400">{label}</span>
        <input
          ref={ref}
          type="number"
          step="0.001"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-800 outline-none focus:ring-1 focus:ring-amber-400"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value.toFixed(3));
        setEditing(true);
      }}
      title={
        isChanged
          ? `Original: ${prefix}${originalValue.toFixed(3)} — clique para editar`
          : "Clique para simular tolerância"
      }
      className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border transition-colors cursor-pointer
        ${isChanged ? "border-amber-300 bg-amber-50" : "border-transparent hover:border-zinc-300 hover:bg-zinc-100"}`}
    >
      <span className="text-zinc-400">{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: isChanged ? "#b45309" : color }}>
        {prefix}
        {value.toFixed(3)}
      </span>
      <svg
        viewBox="0 0 12 12"
        className={`w-2.5 h-2.5 flex-shrink-0 ${isChanged ? "text-amber-400" : "text-zinc-300"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <title>Editar</title>
        <path d="M8.5 1.5 10.5 3.5 4 10 1.5 10.5 2 8z" />
      </svg>
    </button>
  );
}

export function ProfileDeviationChart({
  data,
  dim,
  profileChildOverride,
  onProfileChildOverride,
}: Props) {
  const [pinned, setPinned] = useState<PinnedChartPoint | null>(null);
  const rows = data.rows.filter((r) => r.point_max != null || r.point_min != null);

  const dataKey = rows.map((r) => `${r.part_number}:${r.point_max}:${r.point_min}`).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when plotted values change
  useEffect(() => setPinned(null), [dataKey]);

  const { dtick, onRelayout } = useIntegerSampleAxis(dataKey);

  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-500">
        Nenhuma medição de pontos extremos disponível.
      </div>
    );
  }

  const parts = rows.map((r) => String(r.part_number));
  const showRangeslider = hasRangeslider(rows.length);
  const maxVals = rows.map((r) => r.point_max ?? 0);
  const minVals = rows.map((r) => r.point_min ?? 0);

  const maxChild = dim.children.find((c) => c.dim_code.toUpperCase().includes("MAX"));
  const minChild = dim.children.find((c) => c.dim_code.toUpperCase().includes("MIN"));

  // Tolerâncias originais dos filhos
  const origMaxTol = maxChild?.tol_plus ?? dim.tol_plus;
  const origMinTol =
    minChild?.tol_minus != null && minChild.tol_minus !== 0 ? Math.abs(minChild.tol_minus) : null;

  // Tolerâncias efetivas (com override dos filhos)
  const effMaxTol =
    profileChildOverride?.maxTol !== undefined ? profileChildOverride.maxTol : origMaxTol;
  const effMinTol =
    profileChildOverride?.minTol !== undefined ? profileChildOverride.minTol : origMinTol;

  // Spec limits
  const posTol = maxChild ? maxChild.nominal + effMaxTol : effMaxTol;
  const negTol =
    minChild && effMinTol != null
      ? minChild.nominal - effMinTol
      : effMinTol != null
        ? -effMinTol
        : null;

  const maxOverridden =
    profileChildOverride?.maxTol !== undefined && Math.abs(effMaxTol - origMaxTol) > 1e-9;
  const minOverridden =
    profileChildOverride?.minTol !== undefined &&
    origMinTol != null &&
    Math.abs(profileChildOverride.minTol - origMinTol) > 1e-9;
  const isChildOverridden = maxOverridden || minOverridden;

  const barColors = rows.map((_, i) => {
    const maxValue = maxVals[i] ?? 0;
    const minValue = minVals[i] ?? 0;
    const outMax = maxValue > posTol;
    const outMin = negTol != null && minValue < negTol;
    return outMax || outMin ? RED : AMBER_FILL;
  });

  const allY = [...maxVals, ...minVals, posTol, ...(negTol != null ? [negTol] : [])];
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const margin = (yMax - yMin) * 0.15 || 0.05;

  const shapes = [
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 0,
      line: { color: ZINC_LINE, width: 1 },
    },
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      y0: posTol,
      y1: posTol,
      line: {
        color: isChildOverridden ? AMBER : AMBER,
        dash: "dash",
        width: isChildOverridden ? 2 : 1.5,
      },
    },
    ...(negTol != null
      ? [
          {
            type: "line" as const,
            xref: "paper" as const,
            x0: 0,
            x1: 1,
            y0: negTol,
            y1: negTol,
            line: {
              color: isChildOverridden ? AMBER : BLUE,
              dash: "dash" as const,
              width: isChildOverridden ? 2 : 1.5,
            },
          },
        ]
      : []),
  ] as Partial<Plotly.Shape>[];

  const annotations: Partial<Plotly.Annotations>[] = [
    {
      xref: "paper",
      x: 1.01,
      yref: "y",
      y: posTol,
      text: `+${posTol.toFixed(3)}`,
      showarrow: false,
      font: { color: isChildOverridden ? AMBER : AMBER, size: 11 },
      xanchor: "left",
    },
    ...(negTol != null
      ? [
          {
            xref: "paper" as const,
            x: 1.01,
            yref: "y" as const,
            y: negTol,
            text: negTol.toFixed(3),
            showarrow: false,
            font: { color: isChildOverridden ? AMBER : BLUE, size: 11 },
            xanchor: "left" as const,
          },
        ]
      : []),
  ];

  return (
    <div
      className={`rounded-lg border bg-white p-3 transition-colors
      ${isChildOverridden ? "border-amber-300" : "border-zinc-200"}`}
    >
      {/* Barra de controle de tolerância dos filhos */}
      {onProfileChildOverride && (maxChild || minChild) && (
        <div
          className={`mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1.5 text-xs
          ${isChildOverridden ? "border-amber-200 bg-amber-50/60" : "border-zinc-200 bg-zinc-50"}`}
        >
          <span className="text-zinc-400 font-medium">Simular tolerâncias:</span>

          {maxChild && (
            <EditableSpecChip
              label="Tol MAX"
              value={effMaxTol}
              originalValue={origMaxTol}
              prefix="+"
              color={AMBER}
              onChange={(v) =>
                onProfileChildOverride({
                  ...profileChildOverride,
                  maxTol: v,
                })
              }
            />
          )}

          {minChild && origMinTol != null && (
            <EditableSpecChip
              label="Tol MIN"
              value={effMinTol ?? origMinTol}
              originalValue={origMinTol}
              prefix="−"
              color={BLUE}
              onChange={(v) =>
                onProfileChildOverride({
                  ...profileChildOverride,
                  minTol: v,
                })
              }
            />
          )}

          {isChildOverridden && (
            <>
              <span className="text-amber-600 font-medium">Simulação ativa</span>
              <button
                type="button"
                onClick={() => onProfileChildOverride(null)}
                className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
              >
                × Restaurar original
              </button>
            </>
          )}
        </div>
      )}

      <div className="mb-2 flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: AMBER_FILL }} />
          Dentro da tolerância (amplitude mín → máx)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: RED }} />
          Fora da tolerância
        </span>
      </div>

      <Plot
        data={[
          {
            x: parts,
            y: rows.map((_, i) => (maxVals[i] ?? 0) - (minVals[i] ?? 0)),
            base: minVals,
            type: "bar",
            name: "Amplitude (mín → máx)",
            marker: { color: barColors },
            customdata: rows.map((r, i) => [
              r.part_number,
              maxVals[i],
              minVals[i],
              (maxVals[i] ?? 0) - (minVals[i] ?? 0),
            ]),
            hovertemplate:
              "<b>Peça %{customdata[0]}</b><br>Máx: %{customdata[1]:.3f}<br>Mín: %{customdata[2]:.3f}<br>Amplitude: %{customdata[3]:.3f}<extra></extra>",
          } as Partial<Plotly.PlotData>,
        ]}
        layout={{
          title: { text: `Desvios de Perfil por Peça — ${data.dim_code}`, font: { size: 13 } },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
          barmode: "overlay",
          margin: { t: 40, b: showRangeslider ? 80 : 60, l: 60, r: 60 },
          showlegend: false,
          shapes,
          annotations,
          xaxis: {
            title: { text: "Número da peça" },
            gridcolor: "#e4e4e7",
            ...sampleAxis(rows.length, dtick),
          },
          yaxis: {
            title: { text: "Desvio" },
            gridcolor: "#e4e4e7",
            range: [yMin - margin, yMax + margin],
            zeroline: false,
          },
          hovermode: "closest",
        }}
        config={{ displayModeBar: false }}
        style={{ width: "100%", height: showRangeslider ? 440 : 420 }}
        useResizeHandler
        onRelayout={onRelayout}
        onClick={(event) => {
          const point = event.points[0];
          if (!point || point.curveNumber !== 0) return;
          const values = point.customdata as unknown as
            | [number, number, number, number]
            | undefined;
          if (!values) return;
          setPinned({
            sampleNumber: values[0],
            details: `Máx: ${values[1].toFixed(3)} · Mín: ${values[2].toFixed(3)} · Amplitude: ${values[3].toFixed(3)}`,
          });
        }}
      />
      {pinned && <PinnedPointCard point={pinned} onClose={() => setPinned(null)} />}
    </div>
  );
}
