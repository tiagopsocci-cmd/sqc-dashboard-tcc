import type { DimRead } from "@/lib/sqc-api";
import { dimUnitSuffix } from "@/lib/sqc-dim-unit";
import { useCallback, useRef, useState } from "react";

export interface TolOverride {
  plus: number;
  minus: number | null;
}

interface Props {
  dim: DimRead;
  tolOverride?: TolOverride | null;
  onTolChange?: (override: TolOverride | null) => void;
}

const DIM_TYPE_LABEL: Record<string, string> = {
  DISTANCE: "Distância",
  DIAMETER: "Diâmetro",
  SLAB: "Slab",
  ANGLE: "Ângulo",
  POSITION: "Posição",
  FLATNESS: "Planicidade",
  CYLINDRICITY: "Cilindricidade",
  ROUNDNESS: "Redondeza",
  STRAIGHTNESS: "Retilineidade",
  PARALLELISM: "Paralelismo",
  PERPENDICULARITY: "Perpendicularidade",
  ANGULARITY: "Angularidade",
  CONCENTRICITY: "Concentricidade",
  SYMMETRY: "Simetria",
  PROFILE_SURFACE: "Perfil de Superfície",
  PROFILE_LINE: "Perfil de Linha",
  RUNOUT_CIRCULAR: "Batimento Circular",
  RUNOUT_TOTAL: "Batimento Total",
};

const SUB_TYPE_LABEL: Record<string, string> = {
  HOLE: "Furo",
  SHAFT: "Eixo",
  SLOT: "Rasgo",
  WIDTH: "Largura",
  NONE: "—",
};

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold tabular-nums ${accent ? "text-blue-600" : "text-slate-800"}`}>
        {value}
      </span>
    </span>
  );
}

function EditableChip({
  label,
  value,
  originalValue,
  onChange,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value: number;
  originalValue: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const isChanged = Math.abs(value - originalValue) > 1e-9;

  const commit = useCallback(() => {
    const n = Number.parseFloat(draft);
    if (!Number.isNaN(n) && n > 0) {
      onChange(n);
    }
    setEditing(false);
  }, [draft, onChange]);

  if (editing) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-slate-400">{label}</span>
        <input
          ref={ref}
          type="number"
          step="0.001"
          min="0.001"
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
          className="w-24 rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-800 outline-none focus:ring-1 focus:ring-amber-400"
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
          : "Clique para simular uma tolerância alternativa"
      }
      className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border transition-colors cursor-pointer
        ${
          isChanged
            ? "border-amber-300 bg-amber-50"
            : "border-transparent hover:border-slate-300 hover:bg-slate-100"
        }`}
    >
      <span className="text-slate-400">{label}</span>
      <span
        className={`font-semibold tabular-nums ${isChanged ? "text-amber-700" : "text-slate-800"}`}
      >
        {prefix}
        {value.toFixed(3)}
        {suffix}
      </span>
      <svg
        viewBox="0 0 12 12"
        className={`w-2.5 h-2.5 flex-shrink-0 ${isChanged ? "text-amber-400" : "text-slate-300"}`}
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

export function DimInfoBar({ dim, tolOverride, onTolChange }: Props) {
  const unit = dimUnitSuffix(dim.type);
  const effPlus = tolOverride?.plus ?? dim.tol_plus;
  const effMinus = tolOverride != null ? tolOverride.minus : dim.tol_minus;

  // RECTANGLE tem a mesma largura total T por direção (T_d = tol_plus), então o meio-limite
  // numérico é idêntico ao raio circular — mas não é um USL/LSL de uma única dimensão, é a
  // meia-largura da zona base compartilhada pelas duas direções (spec 060). Rotulado à parte
  // para não sugerir um limite unidimensional que não existe nessa geometria.
  const isRectangle = dim.type === "POSITION" && dim.zone_geometry === "RECTANGLE";
  const tolRadius = dim.type === "POSITION" ? effPlus / 2 : effPlus;
  const usl = dim.nominal + tolRadius;
  const lsl = effMinus != null && effMinus !== 0 ? dim.nominal - Math.abs(effMinus) : null;

  const plusChanged = tolOverride != null && Math.abs(effPlus - dim.tol_plus) > 1e-9;
  const minusChanged =
    tolOverride != null &&
    effMinus != null &&
    dim.tol_minus != null &&
    Math.abs(Math.abs(effMinus) - Math.abs(dim.tol_minus)) > 1e-9;
  const isOverridden = plusChanged || minusChanged;

  const handlePlusChange = (v: number) => {
    // Normaliza tol_minus para não-negativo — pode vir negativo do banco
    const minusVal = effMinus != null ? Math.abs(effMinus) : null;
    onTolChange?.({ plus: v, minus: minusVal });
  };

  const handleMinusChange = (v: number) => {
    onTolChange?.({ plus: effPlus, minus: Math.abs(v) });
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border px-4 py-2 transition-colors
      ${isOverridden ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-slate-50"}`}
    >
      {/* Identificação */}
      <span className="font-semibold text-sm text-slate-800">{dim.dim_code}</span>
      {dim.dim_name && <span className="text-sm text-slate-500">{dim.dim_name}</span>}
      <span className="h-4 w-px bg-slate-300" />

      {/* Nominal — sempre read-only */}
      <Chip label="Nominal" value={`${dim.nominal.toFixed(3)}${unit}`} accent />

      {/* Tolerâncias — editáveis quando onTolChange disponível */}
      {onTolChange ? (
        <>
          <EditableChip
            label="Tol+"
            value={effPlus}
            originalValue={dim.tol_plus}
            onChange={handlePlusChange}
            prefix="+"
            suffix={unit}
          />
          {dim.tol_minus != null && dim.tol_minus !== 0 && (
            <EditableChip
              label="Tol−"
              value={Math.abs(effMinus ?? dim.tol_minus)}
              originalValue={Math.abs(dim.tol_minus)}
              onChange={handleMinusChange}
              prefix="−"
              suffix={unit}
            />
          )}
        </>
      ) : (
        <>
          <Chip label="Tol+" value={`+${dim.tol_plus.toFixed(3)}${unit}`} />
          <Chip
            label="Tol−"
            value={
              dim.tol_minus != null && dim.tol_minus !== 0
                ? `−${Math.abs(dim.tol_minus).toFixed(3)}${unit}`
                : "unilateral"
            }
          />
        </>
      )}

      {/* USL/LSL computados das tolerâncias efetivas — RECTANGLE usa "Zona base (±)" em vez
          de USL/LSL, já que não há um único limite unidimensional nessa geometria */}
      {isRectangle ? (
        <Chip label="Zona base (±)" value={`${tolRadius.toFixed(3)}${unit}`} />
      ) : (
        <>
          <Chip label="USL" value={`${usl.toFixed(3)}${unit}`} />
          {lsl !== null && <Chip label="LSL" value={`${lsl.toFixed(3)}${unit}`} />}
        </>
      )}

      <span className="h-4 w-px bg-slate-300" />
      <Chip label="Tipo" value={DIM_TYPE_LABEL[dim.type] ?? dim.type} />
      {dim.sub_type && dim.sub_type !== "NONE" && (
        <Chip label="Sub-tipo" value={SUB_TYPE_LABEL[dim.sub_type] ?? dim.sub_type} />
      )}
      {dim.type === "POSITION" && dim.zone_geometry && (
        <Chip
          label="Geometria"
          value={
            dim.zone_geometry === "RECTANGLE"
              ? "Retangular"
              : dim.zone_geometry === "LINE"
                ? "Linha"
                : "Circular"
          }
        />
      )}

      {/* Aviso e botão reset quando override ativo */}
      {isOverridden && (
        <>
          <span className="text-xs text-amber-600 font-medium">Simulação ativa</span>
          <button
            type="button"
            onClick={() => onTolChange?.(null)}
            className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
          >
            × Restaurar original
          </button>
        </>
      )}
    </div>
  );
}
