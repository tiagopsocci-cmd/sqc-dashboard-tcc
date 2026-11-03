import type { BatchOverviewResponse, BatchRead, DimRead, ProjectStatus } from "@/lib/sqc-api";
import { sqcApi } from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const STATUS_DOT: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-400",
  ok: "bg-emerald-500",
  no_data: "bg-slate-300",
};

const NQA_BADGE: Record<string, string> = {
  ACEITO: "bg-emerald-50 text-emerald-700",
  REJEITADO: "bg-red-50 text-red-700",
  AMOSTRA_INSUFICIENTE: "bg-amber-50 text-amber-700",
};

const BATCH_STATUS_BADGE: Record<string, string> = {
  IN_ANALYSIS: "bg-slate-100 text-slate-600",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
};

const BATCH_STATUS_LABEL: Record<string, string> = {
  IN_ANALYSIS: "Em Análise",
  APPROVED: "Aprovado",
  REJECTED: "Reprovado",
};

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
  PROFILE_SURFACE: "Perfil Sup.",
  PROFILE_LINE: "Perfil Linha",
  RUNOUT_CIRCULAR: "Batimento Circ.",
  RUNOUT_TOTAL: "Batimento Total",
};

interface Props {
  data: BatchOverviewResponse;
  dims: DimRead[];
  batch?: BatchRead;
  onDimSelect: (dimId: string, dim: DimRead) => void;
  onBatchChanged?: () => void;
}

type SortKey = "status" | "dim_code" | "mean_tol_pct" | "n_out";

function TolBar({ mean, std }: { mean: number; std: number | null }) {
  const capped = Math.min(mean, 120);
  const stdMark = std != null ? Math.min(mean + 2 * std, 120) : null;
  const barColor = mean > 100 ? "bg-red-500" : mean >= 75 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div className="relative h-2.5 w-24 rounded-md bg-slate-100 overflow-visible">
      {/* Barra principal */}
      <div
        className={`absolute left-0 top-0 h-full rounded-md ${barColor}`}
        style={{ width: `${(capped / 120) * 100}%` }}
      />
      {/* Marcador média+2σ */}
      {stdMark != null && stdMark > mean && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-slate-500 rounded"
          style={{ left: `${(stdMark / 120) * 100}%` }}
        />
      )}
      {/* Linha de 100% */}
      <div
        className="absolute top-0 h-full w-px bg-slate-400 opacity-60"
        style={{ left: `${(100 / 120) * 100}%` }}
      />
    </div>
  );
}

export function BatchOverviewTable({ data, dims, batch, onDimSelect, onBatchChanged }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "ok">("all");
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [editDraft, setEditDraft] = useState({
    batch_size: "",
    supplier_id: "",
    project_status: "EVB" as ProjectStatus,
    inspection_level: "II",
    aql: "0.40",
  });
  const [justification, setJustification] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasAnyMeasurements = data.dims.some((d) => d.n > 0);

  const nqaSummaryQuery = useQuery({
    queryKey: ["sqc", "nqa-summary", batch?.id],
    queryFn: () => sqcApi.getNqaSummary(batch?.id ?? ""),
    enabled: deciding && !!batch,
  });

  function startEdit() {
    if (!batch) return;
    setEditDraft({
      batch_size: batch.batch_size?.toString() ?? "",
      supplier_id: batch.supplier_id,
      project_status: batch.project_status,
      inspection_level: batch.inspection_level,
      aql: batch.aql.toString(),
    });
    setActionError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!batch) return;
    setSaving(true);
    setActionError(null);
    try {
      await sqcApi.updateBatch(batch.id, {
        batch_size: editDraft.batch_size.trim() === "" ? null : Number(editDraft.batch_size),
        supplier_id: editDraft.supplier_id,
        project_status: editDraft.project_status,
        inspection_level: editDraft.inspection_level,
        aql: Number(editDraft.aql),
      });
      setEditing(false);
      onBatchChanged?.();
    } catch (e) {
      setActionError((e as { error?: string }).error ?? "Erro ao salvar lote.");
    } finally {
      setSaving(false);
    }
  }

  async function decide(outcome: "APPROVED" | "REJECTED") {
    if (!batch) return;
    setSaving(true);
    setActionError(null);
    try {
      await sqcApi.decideBatch(batch.id, {
        outcome,
        justification: justification.trim() === "" ? null : justification.trim(),
      });
      setDeciding(false);
      setJustification("");
      onBatchChanged?.();
    } catch (e) {
      setActionError((e as { error?: string }).error ?? "Erro ao decidir lote.");
    } finally {
      setSaving(false);
    }
  }

  const dimMap = Object.fromEntries(dims.map((d) => [d.id, d]));

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const STATUS_SORT: Record<string, number> = { critical: 0, warning: 1, ok: 2, no_data: 3 };

  const sorted = [...data.dims]
    .filter((r) => filter === "all" || r.status === filter)
    .sort((a, b) => {
      let v = 0;
      if (sortKey === "status") v = (STATUS_SORT[a.status] ?? 4) - (STATUS_SORT[b.status] ?? 4);
      else if (sortKey === "dim_code") v = a.dim_code.localeCompare(b.dim_code);
      else if (sortKey === "mean_tol_pct") v = (a.mean_tol_pct ?? -1) - (b.mean_tol_pct ?? -1);
      else if (sortKey === "n_out") v = a.n_out - b.n_out;
      return sortAsc ? v : -v;
    });

  const counts = {
    critical: data.dims.filter((d) => d.status === "critical").length,
    warning: data.dims.filter((d) => d.status === "warning").length,
    ok: data.dims.filter((d) => d.status === "ok").length,
  };

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-slate-600 ml-1">{sortAsc ? "↑" : "↓"}</span>;
  }

  function Th({ label, k }: { label: string; k: SortKey }) {
    return (
      <th className="px-3 py-2 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
        <button
          type="button"
          className="cursor-pointer select-none hover:text-slate-600 bg-transparent border-0 p-0 font-medium text-xs text-slate-400"
          onClick={() => handleSort(k)}
        >
          {label}
          <SortIcon k={k} />
        </button>
      </th>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Cabeçalho */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Visão Geral do Lote</h2>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="text-xs text-slate-400">{data.tracking_code}</p>
            {batch && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  BATCH_STATUS_BADGE[batch.batch_status] ?? ""
                }`}
              >
                {BATCH_STATUS_LABEL[batch.batch_status] ?? batch.batch_status}
              </span>
            )}
          </div>
          {batch?.batch_status === "REJECTED" && batch.rejection_justification && (
            <p className="mt-1 text-xs text-red-600">Motivo: {batch.rejection_justification}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {batch && batch.batch_status === "IN_ANALYSIS" && !editing && !deciding && (
            <button
              type="button"
              onClick={startEdit}
              className="rounded-md bg-blue-50 px-2.5 py-0.5 font-medium text-blue-700 hover:bg-blue-100"
            >
              Editar Lote
            </button>
          )}
          {batch &&
            batch.batch_status === "IN_ANALYSIS" &&
            hasAnyMeasurements &&
            !editing &&
            !deciding && (
              <button
                type="button"
                onClick={() => setDeciding(true)}
                className="rounded-md bg-slate-800 px-2.5 py-0.5 font-medium text-white hover:bg-slate-700"
              >
                Decidir Lote
              </button>
            )}
          {(["all", "critical", "warning", "ok"] as const).map((f) => {
            const labels = {
              all: `Todas (${data.dims.length})`,
              critical: `Crítico (${counts.critical})`,
              warning: `Atenção (${counts.warning})`,
              ok: `OK (${counts.ok})`,
            };
            const colors = {
              all: "bg-slate-100 text-slate-600",
              critical: "bg-red-50 text-red-700",
              warning: "bg-amber-50 text-amber-700",
              ok: "bg-emerald-50 text-emerald-700",
            };
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-0.5 font-medium transition-all ${
                  filter === f
                    ? `${colors[f]} ring-1 ring-current`
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                {labels[f]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Editar Lote */}
      {editing && batch && (
        <div className="space-y-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <p className="text-sm font-semibold text-slate-700">Editando lote {data.tracking_code}</p>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Tamanho do lote
              <input
                className="input-base w-28"
                value={editDraft.batch_size}
                onChange={(e) => setEditDraft((d) => ({ ...d, batch_size: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Fornecedor
              <input
                className="input-base w-40"
                value={editDraft.supplier_id}
                onChange={(e) => setEditDraft((d) => ({ ...d, supplier_id: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Status do projeto
              <select
                className="input-base"
                value={editDraft.project_status}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, project_status: e.target.value as ProjectStatus }))
                }
              >
                <option value="EVB">EVB</option>
                <option value="PVB">PVB</option>
                <option value="IE">IE</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Nível
              <select
                className="input-base"
                value={editDraft.inspection_level}
                onChange={(e) => setEditDraft((d) => ({ ...d, inspection_level: e.target.value }))}
              >
                <option value="I">I</option>
                <option value="II">II</option>
                <option value="III">III</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              AQL
              <input
                className="input-base w-20"
                value={editDraft.aql}
                onChange={(e) => setEditDraft((d) => ({ ...d, aql: e.target.value }))}
              />
            </label>
          </div>
          {actionError && <p className="text-xs text-red-600">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* Decidir Lote */}
      {deciding && batch && (
        <div className="space-y-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <p className="text-sm font-semibold text-slate-700">
            Decidir Lote — {data.tracking_code}
          </p>
          <div className="space-y-1">
            <p className="text-xs text-slate-500">Sugestão por dimensão (NQA):</p>
            {nqaSummaryQuery.isLoading ? (
              <p className="text-xs text-slate-400">Carregando…</p>
            ) : nqaSummaryQuery.isError ? (
              <p className="text-xs text-red-600">
                Não foi possível carregar o resumo de NQA. Tente novamente antes de decidir.
              </p>
            ) : nqaSummaryQuery.data && nqaSummaryQuery.data.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {nqaSummaryQuery.data.map((row) => (
                  <span
                    key={row.dim_id}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      NQA_BADGE[row.result.status] ?? ""
                    }`}
                  >
                    {row.dim_code}: {row.result.achieved_aql ?? "—"}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Nenhuma dimensão com medições neste lote.</p>
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Justificativa (obrigatória se reprovar)
            <textarea
              className="input-base"
              rows={2}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </label>
          {actionError && <p className="text-xs text-red-600">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDeciding(false);
                setJustification("");
              }}
              className="rounded px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => decide("REJECTED")}
              disabled={saving || nqaSummaryQuery.isLoading || nqaSummaryQuery.isError}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reprovar Lote
            </button>
            <button
              type="button"
              onClick={() => decide("APPROVED")}
              disabled={saving || nqaSummaryQuery.isLoading || nqaSummaryQuery.isError}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aprovar Lote
            </button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-3 py-2 w-6" />
              <Th label="Dimensão" k="dim_code" />
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">Tipo</th>
              <th className="px-3 py-2 text-center text-xs font-medium text-slate-400">n</th>
              <Th label="% Tolerância" k="mean_tol_pct" />
              <Th label="NC" k="n_out" />
              <th className="px-3 py-2 text-center text-xs font-medium text-slate-400">NQA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {sorted.map((row) => {
              const dim = dimMap[row.dim_id];
              return (
                <tr
                  key={row.dim_id}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => dim && onDimSelect(row.dim_id, dim)}
                  onKeyDown={(e) => e.key === "Enter" && dim && onDimSelect(row.dim_id, dim)}
                  tabIndex={0}
                >
                  {/* Semáforo */}
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[row.status]}`}
                    />
                  </td>

                  {/* Código + nome */}
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-slate-800">{row.dim_code}</span>
                    {row.dim_name && (
                      <span className="ml-2 text-xs text-slate-400">{row.dim_name}</span>
                    )}
                  </td>

                  {/* Tipo */}
                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {DIM_TYPE_LABEL[row.dim_type] ?? row.dim_type}
                  </td>

                  {/* n */}
                  <td className="px-3 py-2.5 text-center text-xs text-slate-500">{row.n}</td>

                  {/* Barra + texto */}
                  <td className="px-3 py-2.5">
                    {row.mean_tol_pct != null ? (
                      <div className="flex items-center gap-2">
                        <TolBar mean={row.mean_tol_pct} std={row.std_tol_pct} />
                        <span className="text-xs text-slate-600 w-24 shrink-0">
                          {row.mean_tol_pct.toFixed(1)}%
                          {row.std_tol_pct != null && (
                            <span className="text-slate-400"> ±{row.std_tol_pct.toFixed(1)}%</span>
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>

                  {/* NC + incerteza */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {row.n_out > 0 ? (
                        <span className="text-xs font-semibold text-red-600">{row.n_out}</span>
                      ) : (
                        <span className="text-xs text-slate-300">0</span>
                      )}
                      {row.n_uncertainty > 0 && (
                        <span
                          title={`${row.n_uncertainty} peça${row.n_uncertainty > 1 ? "s" : ""} na zona de incerteza do instrumento`}
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold cursor-help"
                        >
                          U
                        </span>
                      )}
                    </div>
                  </td>

                  {/* NQA */}
                  <td className="px-3 py-2.5 text-center">
                    {row.nqa_status ? (
                      <div className="inline-flex flex-col items-center gap-0.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${NQA_BADGE[row.nqa_status] ?? ""}`}
                        >
                          {row.nqa_achieved_aql ?? "—"}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Ac {row.nqa_ac} / Re {row.nqa_re}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {sorted.length === 0 && (
          <div className="flex h-20 items-center justify-center text-sm text-slate-400">
            Nenhuma dimensão com o filtro selecionado.
          </div>
        )}
      </div>
    </div>
  );
}
