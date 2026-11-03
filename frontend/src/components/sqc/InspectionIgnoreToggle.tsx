import { type StatisticsResponse, sqcApi } from "@/lib/sqc-api";
import { useEffect, useRef, useState } from "react";

interface Props {
  batchId: string;
  dimId: string;
  inspectionId: string;
  isIgnored: boolean;
  ignoredReason: string | null;
  onUpdated: (result: {
    isIgnored: boolean;
    ignoredReason: string | null;
    statistics: StatisticsResponse;
  }) => void;
}

/** Marca/desmarca uma amostra como desconsiderada (spec 252, FR-006). Ao marcar, exige
 * motivo (reforçado também pelo backend). Ao confirmar, repassa a `statistics`
 * recalculada embutida na resposta do PATCH para o chamador atualizar a tela sem reload
 * manual (SC-003). */
export function InspectionIgnoreToggle({
  batchId,
  dimId,
  inspectionId,
  isIgnored,
  ignoredReason,
  onUpdated,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      reasonInputRef.current?.focus();
    }
  }, [editing]);

  async function submitIgnore() {
    if (reason.trim() === "") {
      setError("Motivo obrigatório para desconsiderar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await sqcApi.setInspectionIgnored(
        batchId,
        dimId,
        inspectionId,
        true,
        reason.trim(),
      );
      onUpdated({
        isIgnored: res.is_ignored,
        ignoredReason: res.ignored_reason,
        statistics: res.statistics,
      });
      setEditing(false);
      setReason("");
    } catch (e) {
      const apiError = e as { status?: number; error?: string };
      setError(
        apiError.status === 409
          ? "O lote já foi decidido; a medição não foi alterada."
          : (apiError.error ?? "Erro ao desconsiderar amostra."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    setSaving(true);
    setError(null);
    try {
      const res = await sqcApi.setInspectionIgnored(batchId, dimId, inspectionId, false, null);
      onUpdated({
        isIgnored: res.is_ignored,
        ignoredReason: res.ignored_reason,
        statistics: res.statistics,
      });
    } catch (e) {
      const apiError = e as { status?: number; error?: string };
      setError(
        apiError.status === 409
          ? "O lote já foi decidido; a medição não foi alterada."
          : (apiError.error ?? "Erro ao restaurar amostra."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (isIgnored) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={restore}
          disabled={saving}
          title={ignoredReason ?? undefined}
          className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Desconsiderada — restaurar
        </button>
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex flex-col items-start gap-1 min-w-[180px]">
        <input
          ref={reasonInputRef}
          type="text"
          className="input-base text-xs py-0.5"
          placeholder="Motivo da desconsideração"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <span className="text-[10px] text-red-600">{error}</span>}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setReason("");
              setError(null);
            }}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submitIgnore}
            disabled={saving}
            className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="rounded-md px-2 py-0.5 text-[10px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
    >
      Desconsiderar
    </button>
  );
}
