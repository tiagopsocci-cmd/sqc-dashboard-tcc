import type { DimRead, SuggestToleranceResponse } from "@/lib/sqc-api";
import { sqcApi } from "@/lib/sqc-api";
import { useState } from "react";

export interface GroupedTolOverride {
  tolPlus: number;
  tolMinus: number | null;
  nominal: number;
}

interface Props {
  dim: DimRead;
  override: GroupedTolOverride | null;
  onChange: (override: GroupedTolOverride | null) => void;
  batchIds: string[];
  dimId: string;
  cavity?: number | null;
  unit?: string;
}

function NumField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(3));
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-400">{label}</span>
      <input
        type="number"
        step="0.001"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number.parseFloat(draft);
          if (!Number.isNaN(n)) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-24 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
      />
    </label>
  );
}

/** Painel interativo de capabilidade agrupada (melhoria SQC, bidirecional):
 * a) edita Nominal/Tol+/Tol− e recalcula Cp/Cpk/Pp/Ppk em tempo real (via override na query pai);
 * b) informa um Cpk meta e recebe a tolerância sugerida pelo solver reverso do backend, com opção
 * de aplicar o resultado de volta na simulação. */
export function GroupedToleranceBar({
  dim,
  override,
  onChange,
  batchIds,
  dimId,
  cavity,
  unit = "",
}: Props) {
  const effTolPlus = override?.tolPlus ?? dim.tol_plus;
  const effTolMinus = override ? override.tolMinus : dim.tol_minus;
  const effNominal = override?.nominal ?? dim.nominal;
  const isOverridden = override != null;

  const [targetCpk, setTargetCpk] = useState("1.33");
  const [suggestion, setSuggestion] = useState<SuggestToleranceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setOverride(patch: Partial<GroupedTolOverride>) {
    onChange({
      tolPlus: patch.tolPlus ?? effTolPlus,
      tolMinus: "tolMinus" in patch ? (patch.tolMinus ?? null) : effTolMinus,
      nominal: patch.nominal ?? effNominal,
    });
  }

  async function handleSuggest() {
    const cpk = Number.parseFloat(targetCpk);
    if (Number.isNaN(cpk) || cpk <= 0) return;
    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const result = await sqcApi.suggestGroupedTolerance(batchIds, dimId, cpk, cavity);
      setSuggestion(result);
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Erro ao calcular sugestão de tolerância.");
    } finally {
      setLoading(false);
    }
  }

  function applySuggestion() {
    if (!suggestion) return;
    onChange({
      tolPlus: suggestion.tol_plus,
      tolMinus: suggestion.tol_minus,
      nominal: effNominal,
    });
    setSuggestion(null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Simulação de tolerância
        </p>
        <NumField
          key={`nominal-${effNominal}`}
          label="Nominal"
          value={effNominal}
          onCommit={(v) => setOverride({ nominal: v })}
        />
        <NumField
          key={`tolplus-${effTolPlus}`}
          label="Tol+"
          value={effTolPlus}
          onCommit={(v) => setOverride({ tolPlus: v })}
        />
        {dim.tol_minus != null && dim.tol_minus !== 0 && (
          <NumField
            key={`tolminus-${effTolMinus}`}
            label="Tol−"
            value={Math.abs(effTolMinus ?? dim.tol_minus ?? 0)}
            onCommit={(v) => setOverride({ tolMinus: Math.abs(v) })}
          />
        )}
        {isOverridden && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
          >
            × Restaurar original
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Meta de Cpk
        </p>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400">Cpk alvo</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={targetCpk}
            onChange={(e) => setTargetCpk(e.target.value)}
            className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={loading || batchIds.length < 2}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Calculando…" : "Sugerir tolerância"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
        {suggestion && (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
            {!suggestion.achievable && (
              <span className="text-amber-700">Amostra insuficiente — estimativa aproximada.</span>
            )}
            <span>
              Tol+ {suggestion.tol_plus.toFixed(3)}
              {unit}
              {suggestion.tol_minus != null && ` / Tol− ${suggestion.tol_minus.toFixed(3)}${unit}`}
            </span>
            <button
              type="button"
              onClick={applySuggestion}
              className="rounded-md border border-blue-300 bg-blue-100 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-200 transition-colors"
            >
              Aplicar na simulação
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
