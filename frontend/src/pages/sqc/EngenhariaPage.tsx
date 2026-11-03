import { PartSelector } from "@/components/sqc/PartSelector";
import { Badge, Field, FileInput, SectionCard } from "@/components/sqc/import-helpers";
import {
  type DeleteDimConflict,
  type DimImportPreview,
  type DimImportResult,
  type DimPreviewRow,
  type DimRead,
  type PartRead,
  sqcApi,
} from "@/lib/sqc-api";
import { dimUnitSuffix } from "@/lib/sqc-dim-unit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

// ── Cadastro de Peça ───────────────────────────────────────────────────────────

function PartSection() {
  const [form, setForm] = useState({ part_code: "", description: "", material: "", process: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PartRead | null>(null);
  const qc = useQueryClient();

  async function handleCreate() {
    if (!form.part_code.trim() || !form.description.trim()) return;
    setLoading(true);
    setError(null);
    setCreated(null);
    try {
      const part = await sqcApi.createPart({
        part_code: form.part_code.trim().toUpperCase(),
        description: form.description.trim(),
        material: form.material.trim() || undefined,
        process: form.process.trim() || undefined,
      });
      setCreated(part);
      setForm({ part_code: "", description: "", material: "", process: "" });
      qc.invalidateQueries({ queryKey: ["sqc", "parts"] });
    } catch (e: unknown) {
      const msg = (e as { error?: string })?.error ?? "";
      if (msg.includes("already exists")) {
        setError(`Peça "${form.part_code.toUpperCase()}" já está cadastrada.`);
      } else {
        setError(msg || "Erro ao cadastrar peça.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Cadastro de Peça">
      <p className="text-sm text-slate-500">
        Cadastre uma nova peça antes de importar as dimensões. O código da peça deve ser único e
        corresponder ao código usado nos arquivos de medição.
      </p>

      <div className="flex flex-wrap gap-4">
        <Field label="Código da peça *">
          <input
            className="input-base uppercase"
            placeholder="ex: ABC-1234"
            value={form.part_code}
            onChange={(e) => setForm((f) => ({ ...f, part_code: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </Field>

        <Field label="Descrição *">
          <input
            className="input-base"
            placeholder="ex: Suporte traseiro direito"
            style={{ minWidth: 280 }}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </Field>

        <Field label="Material">
          <input
            className="input-base"
            placeholder="ex: Alumínio 6061"
            value={form.material}
            onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
          />
        </Field>

        <Field label="Processo">
          <input
            className="input-base"
            placeholder="ex: Usinagem CNC"
            value={form.process}
            onChange={(e) => setForm((f) => ({ ...f, process: e.target.value }))}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={!form.part_code.trim() || !form.description.trim() || loading}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Cadastrando…" : "Cadastrar Peça"}
      </button>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {created && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-semibold">{created.part_code}</span> cadastrada com sucesso. Agora
          você pode importar as dimensões abaixo.
        </div>
      )}
    </SectionCard>
  );
}

// ── Importação de Dimensões ────────────────────────────────────────────────────

const IMPORT_PREVIEW_STATUS_BADGE: Record<string, string> = {
  new: "bg-emerald-100 text-emerald-700",
  unchanged: "bg-slate-100 text-slate-500",
  overwritten: "bg-red-100 text-red-700",
};

const IMPORT_PREVIEW_STATUS_LABEL: Record<string, string> = {
  new: "Nova",
  unchanged: "Sem alteração",
  overwritten: "Será sobrescrita",
};

function DimsSection() {
  const [partId, setPartId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DimImportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [result, setResult] = useState<DimImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: existingDims = [] } = useQuery({
    queryKey: ["sqc", "dims", partId],
    queryFn: () => sqcApi.listDims(partId as string),
    enabled: !!partId,
  });

  const latestRevision = existingDims.reduce<string | null>(
    (latest, d) =>
      d.drawing_revision && d.drawing_revision > (latest ?? "") ? d.drawing_revision : latest,
    null,
  );

  function resetFileState() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function handleFileSelected(f: File) {
    if (!partId) return;
    setFile(f);
    setResult(null);
    setError(null);
    setPreviewLoading(true);
    try {
      const p = await sqcApi.previewImportDims(partId, f);
      setPreview(p);
    } catch (e: unknown) {
      setError((e as { error?: string })?.error ?? "Erro ao gerar preview do arquivo.");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirm() {
    if (!partId || !file) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await sqcApi.importDims(partId, file);
      setResult(res);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["sqc", "dims"] });
    } catch (e: unknown) {
      setError((e as { error?: string })?.error ?? "Erro ao importar dimensões.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <SectionCard title="Cadastro de Dimensões">
      <p className="text-sm text-slate-500">
        Faça o upload do CSV de dimensões para cadastrar ou atualizar as cotas de uma peça. Revise
        as alterações antes de confirmar — nada é gravado até você clicar em "Confirmar Importação".
      </p>
      <p className="text-xs text-slate-400">
        Colunas opcionais para posições com geometria (features 060/061):{" "}
        <span className="font-mono">position_geometry</span> (CIRCULAR/RECTANGLE/LINE, na linha da
        posição), <span className="font-mono">coordinate_axis</span> (X/Y/Z, na linha da cota filha
        de coordenada, só para RECTANGLE) e <span className="font-mono">related_size_dim_code</span>{" "}
        (opcional, na mesma linha, quando houver bônus MMC/LMC — não aplicável a LINE).
      </p>

      {partId && existingDims.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Esta peça já tem <span className="font-semibold">{existingDims.length}</span>{" "}
          dimensão(ões) cadastrada(s)
          {latestRevision && (
            <>
              , última revisão de desenho <span className="font-semibold">{latestRevision}</span>
            </>
          )}
          . Confirme que o arquivo selecionado é o correto para esta peça.
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-end">
        <PartSelector
          selectedPartId={partId ?? undefined}
          onPartChange={(id) => {
            setPartId(id);
            resetFileState();
          }}
        />
        <div className="flex-1 min-w-[280px]">
          <FileInput
            accept=".csv"
            label="Arquivo CSV de dimensões"
            file={file}
            onChange={handleFileSelected}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {previewLoading && <p className="text-sm text-slate-500">Gerando preview…</p>}

      {preview && !result && (
        <div className="space-y-3">
          {preview.errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 space-y-0.5">
              <p className="font-medium">Avisos ({preview.errors.length})</p>
              {preview.errors.map((e, i) => (
                <p key={String(i) + e} className="text-xs">
                  {e}
                </p>
              ))}
            </div>
          )}

          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Código</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Relação direcional</th>
                  <th className="px-3 py-2 text-left font-medium">Alterações</th>
                  <th className="px-3 py-2 text-left font-medium">Erros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((row) => (
                  <tr
                    key={row.dim_code}
                    className={`hover:bg-slate-50 ${row.errors.length > 0 ? "bg-red-50/40" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono">{row.dim_code}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${IMPORT_PREVIEW_STATUS_BADGE[row.status]}`}
                      >
                        {IMPORT_PREVIEW_STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.coordinate_axis ? (
                        <span>
                          {row.coordinate_axis} → {row.related_size_dim_code ?? "sem bônus"}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.changes.length === 0 ? (
                        "—"
                      ) : (
                        <div className="space-y-0.5">
                          {row.changes.map((c) => (
                            <div key={c.field}>
                              <span className="text-slate-400">{c.field}:</span>{" "}
                              <span className="text-red-500">{c.current ?? "—"}</span> →{" "}
                              <span className="text-emerald-600">{c.incoming ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-red-700">
                      {row.errors.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {row.errors.map((e) => (
                            <div key={e}>{e}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={
                confirming ||
                preview.errors.length > 0 ||
                preview.rows.some((row) => row.errors.length > 0)
              }
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {confirming ? "Importando…" : "Confirmar Importação"}
            </button>
            <button
              type="button"
              onClick={resetFileState}
              disabled={confirming}
              className="rounded border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <span className="text-sm text-slate-500">
            {result.created} criadas · {result.updated} atualizadas · {result.skipped} sem alteração
          </span>
          {result.errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 space-y-0.5">
              <p className="font-medium">Avisos ({result.errors.length})</p>
              {result.errors.map((e, i) => (
                <p key={String(i) + e} className="text-xs">
                  {e}
                </p>
              ))}
            </div>
          )}
          {result.preview.length > 0 && (
            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Código</th>
                    <th className="px-3 py-2 text-left font-medium">Nome</th>
                    <th className="px-3 py-2 text-left font-medium">Revisão</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.preview.map((row: DimPreviewRow) => (
                    <tr key={row.dim_code} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono">{row.dim_code}</td>
                      <td className="px-3 py-2 text-slate-600">{row.dim_name ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.drawing_revision ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── Upload de Desenho Técnico ──────────────────────────────────────────────────

function DrawingSection() {
  const [partId, setPartId] = useState<string | null>(null);
  const [revision, setRevision] = useState("1.1");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleUpload() {
    if (!partId || !file || !revision.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await sqcApi.uploadDrawing(partId, revision.trim(), file);
      setSuccess(`Desenho enviado com sucesso: ${res.filename}`);
      setFile(null);
    } catch (e: unknown) {
      setError((e as { error?: string })?.error ?? "Erro ao enviar desenho.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Desenho Técnico (PDF)">
      <p className="text-sm text-slate-500">
        Associe o PDF do desenho técnico a uma peça e revisão. O arquivo ficará disponível no
        Dashboard na aba "Desenho".
      </p>

      <div className="flex flex-wrap gap-4 items-end">
        <PartSelector selectedPartId={partId ?? undefined} onPartChange={setPartId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="drawing-revision" className="text-xs font-medium text-slate-500">
            Revisão do desenho
          </label>
          <input
            id="drawing-revision"
            type="text"
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
            placeholder="ex: 1.1"
            className="input-base w-28"
          />
        </div>
      </div>

      <FileInput accept=".pdf" label="Arquivo PDF" file={file} onChange={setFile} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}

      <button
        type="button"
        onClick={handleUpload}
        disabled={!partId || !file || !revision.trim() || loading}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
      >
        {loading ? "Enviando…" : "Enviar Desenho"}
      </button>
    </SectionCard>
  );
}

// ── helpers da tabela de dimensões ────────────────────────────────────────────

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

type DimDraft = {
  dim_name: string;
  drawing_revision: string;
  nominal: string;
  tol_plus: string;
  tol_minus: string;
};

function dimToDraft(dim: DimRead): DimDraft {
  return {
    dim_name: dim.dim_name ?? "",
    drawing_revision: dim.drawing_revision ?? "",
    nominal: String(dim.nominal),
    tol_plus: String(dim.tol_plus),
    tol_minus: dim.tol_minus != null ? String(dim.tol_minus) : "",
  };
}

function TolDisplay({ dim }: { dim: DimRead }) {
  const unit = dimUnitSuffix(dim.type);
  const mod = dim.material_modifier ? (
    <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-violet-700 font-medium">
      {dim.material_modifier === "M" ? "MMC" : "LMC"}
    </span>
  ) : null;
  if (dim.type === "POSITION") {
    return (
      <span className="tabular-nums text-emerald-700">
        ⌀{dim.tol_plus}
        {unit}
        {mod}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      <span className="text-emerald-600">
        +{dim.tol_plus}
        {unit}
      </span>
      {" / "}
      {dim.tol_minus != null ? (
        <span className="text-amber-600">
          −{dim.tol_minus}
          {unit}
        </span>
      ) : (
        <span className="text-slate-300">unilateral</span>
      )}
      {mod}
    </span>
  );
}

// Linha de edição compartilhada (pai ou filho)
function DimEditRow({
  dim,
  indent,
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
}: {
  dim: DimRead;
  partId: string;
  indent: boolean;
  draft: DimDraft;
  setDraft: (d: DimDraft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <tr className={indent ? "bg-blue-50/40" : "bg-slate-50"}>
      {/* sem toggle de filhos ao editar */}
      <td className="px-2 py-2 w-5" />
      <td className="px-3 py-2 font-mono text-xs text-slate-500" colSpan={2}>
        {indent && <span className="text-slate-300 mr-1">└</span>}
        {dim.dim_code}
      </td>
      <td className="px-3 py-2">
        <input
          className="input-base h-7 text-xs"
          value={draft.dim_name}
          onChange={(e) => setDraft({ ...draft, dim_name: e.target.value })}
          placeholder="nome opcional"
        />
      </td>
      <td className="px-3 py-2 text-xs text-slate-400">{DIM_TYPE_LABEL[dim.type] ?? dim.type}</td>
      <td className="px-3 py-2">
        <input
          className="input-base h-7 text-xs text-right w-20"
          value={draft.nominal}
          onChange={(e) => setDraft({ ...draft, nominal: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="input-base h-7 text-xs text-right w-20"
          value={draft.tol_plus}
          onChange={(e) => setDraft({ ...draft, tol_plus: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="input-base h-7 text-xs text-right w-20"
          value={draft.tol_minus}
          onChange={(e) => setDraft({ ...draft, tol_minus: e.target.value })}
          placeholder="unilateral"
        />
      </td>
      <td className="px-3 py-2">
        <input
          className="input-base h-7 text-xs w-16"
          value={draft.drawing_revision}
          onChange={(e) => setDraft({ ...draft, drawing_revision: e.target.value })}
          placeholder="rev."
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5 justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {saving ? "…" : "Salvar"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Tabela de dimensões de uma peça ───────────────────────────────────────────

/** Rótulo traduzido da geometria de uma posição — sempre visível no pai, tanto RECTANGLE
 * quanto CIRCULAR (antes só RECTANGLE tinha algum indicativo). Os detalhes de cada relação
 * direcional (eixo → dimensão de tamanho) ficam nas linhas filhas, via
 * `ChildAxisRelationBadge` — é lá que cada relação faz sentido individualmente. */
function GeometryBadge({ dim }: { dim: DimRead }) {
  if (dim.type !== "POSITION" || !dim.zone_geometry) return null;
  const label =
    dim.zone_geometry === "RECTANGLE"
      ? "Retângulo"
      : dim.zone_geometry === "LINE"
        ? "Linha"
        : "Circular";
  return (
    <span className="ml-1.5 rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-medium text-indigo-600">
      {label}
    </span>
  );
}

/** Aviso de posição RECTANGLE sem nenhuma relação direcional configurada ainda — bloqueia o
 * cálculo direcional por completo, então continua no pai (é sobre a posição como um todo). */
function RectangleRelationsWarning({ partId, dim }: { partId: string; dim: DimRead }) {
  const { data: relations = [] } = useQuery({
    queryKey: ["sqc", "dim-axis-relations", partId, dim.id],
    queryFn: () => sqcApi.getAxisRelations(partId, dim.id),
  });
  if (relations.length > 0) return null;
  return (
    <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-normal text-amber-600">
      sem relações
    </span>
  );
}

/** Relação direcional (eixo → dimensão de tamanho) desta cota filha específica, quando o pai
 * é uma posição RECTANGLE — reaproveita o mesmo cache de `useQuery` de `RectangleRelationsWarning`
 * (mesma queryKey), então não duplica a chamada de rede. */
function ChildAxisRelationBadge({
  partId,
  parentDim,
  child,
}: {
  partId: string;
  parentDim: DimRead;
  child: DimRead;
}) {
  const { data: relations = [] } = useQuery({
    queryKey: ["sqc", "dim-axis-relations", partId, parentDim.id],
    queryFn: () => sqcApi.getAxisRelations(partId, parentDim.id),
  });
  const relation = relations.find((r) => r.coordinate_dim_code === child.dim_code);
  if (!relation) return null;
  return (
    <span className="ml-1.5 rounded bg-indigo-50 px-1 py-0.5 text-[10px] font-normal text-indigo-600">
      {relation.axis}→{relation.related_size_dim_code ?? "sem bônus"}
    </span>
  );
}

function DimsTable({ partId }: { partId: string }) {
  const qc = useQueryClient();
  const { data: dims = [], isLoading } = useQuery({
    queryKey: ["sqc", "dims", partId],
    queryFn: () => sqcApi.listDims(partId),
  });

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DimDraft>(
    dimToDraft({
      dim_name: null,
      drawing_revision: null,
      nominal: 0,
      tol_plus: 0,
      tol_minus: null,
    } as DimRead),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function formatDeleteConflict(conflict: DeleteDimConflict): string {
    if (conflict.reason === "has_inspections") {
      return `Não é possível excluir: existem ${conflict.count} medição(ões) associadas a esta dimensão.`;
    }
    return `Não é possível excluir: esta dimensão é referenciada por ${conflict.dim_codes.join(", ")}.`;
  }

  async function confirmDelete(dim: DimRead) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await sqcApi.deleteDim(partId, dim.id);
      qc.invalidateQueries({ queryKey: ["sqc", "dims", partId] });
      setConfirmDeleteId(null);
    } catch (e: unknown) {
      const err = e as { error?: DeleteDimConflict | string };
      if (err.error && typeof err.error === "object" && "reason" in err.error) {
        setDeleteError(formatDeleteConflict(err.error));
      } else {
        setDeleteError((err.error as string) ?? "Erro ao excluir dimensão.");
      }
    } finally {
      setDeleting(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startEdit(dim: DimRead) {
    setEditingId(dim.id);
    setSaveError(null);
    setDraft(dimToDraft(dim));
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError(null);
  }

  async function saveEdit(dim: DimRead) {
    const nominal = Number.parseFloat(draft.nominal);
    const tol_plus = Number.parseFloat(draft.tol_plus);
    const tol_minus = draft.tol_minus.trim() === "" ? null : Number.parseFloat(draft.tol_minus);

    if (Number.isNaN(nominal) || Number.isNaN(tol_plus)) {
      setSaveError("Nominal e Tol+ devem ser números válidos.");
      return;
    }
    if (tol_plus < 0) {
      setSaveError("Tol+ deve ser ≥ 0.");
      return;
    }
    if (tol_minus !== null && Number.isNaN(tol_minus)) {
      setSaveError("Tol− inválido.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await sqcApi.updateDim(partId, dim.id, {
        dim_name: draft.dim_name.trim() || null,
        drawing_revision: draft.drawing_revision.trim() || null,
        nominal,
        tol_plus,
        tol_minus,
      });
      qc.invalidateQueries({ queryKey: ["sqc", "dims", partId] });
      setEditingId(null);
    } catch (e: unknown) {
      setSaveError((e as { error?: string })?.error ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded bg-slate-100 mx-6 mb-4" />;
  }
  if (dims.length === 0) {
    return <p className="px-6 pb-4 text-xs text-slate-400 italic">Nenhuma dimensão cadastrada.</p>;
  }

  return (
    <div className="border-t border-slate-100 overflow-x-auto">
      {saveError && (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {saveError}
        </div>
      )}
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-400 border-b border-slate-100">
          <tr>
            <th className="w-5 px-2 py-2" />
            <th className="px-3 py-2 text-left font-medium" colSpan={2}>
              Código
            </th>
            <th className="px-3 py-2 text-left font-medium">Nome</th>
            <th className="px-3 py-2 text-left font-medium">Tipo</th>
            <th className="px-3 py-2 text-right font-medium">Nominal</th>
            <th className="px-3 py-2 text-right font-medium">Tolerâncias</th>
            <th className="px-3 py-2 text-right font-medium" colSpan={2}>
              Rev.
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {dims.map((dim) => {
            const hasChildren = dim.children.length > 0;
            const isExpanded = expandedIds.has(dim.id);
            const isEditing = editingId === dim.id;

            return (
              <>
                {/* ── Linha do pai ── */}
                {isEditing ? (
                  <DimEditRow
                    key={dim.id}
                    dim={dim}
                    partId={partId}
                    indent={false}
                    draft={draft}
                    setDraft={setDraft}
                    saving={saving}
                    onSave={() => saveEdit(dim)}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <tr key={dim.id} className="hover:bg-slate-50">
                    <td className="px-2 py-2 text-center w-5">
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(dim.id)}
                          className="text-slate-400 hover:text-slate-700 transition-colors"
                          title={isExpanded ? "Recolher filhas" : "Ver filhas"}
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono font-medium" colSpan={2}>
                      {dim.dim_code}
                      {dim.sub_type && dim.sub_type !== "NONE" && (
                        <span className="ml-1.5 text-slate-400 font-normal text-[10px]">
                          {dim.sub_type}
                        </span>
                      )}
                      <GeometryBadge dim={dim} />
                      {dim.zone_geometry === "RECTANGLE" && (
                        <RectangleRelationsWarning partId={partId} dim={dim} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {dim.dim_name ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {DIM_TYPE_LABEL[dim.type] ?? dim.type}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {dim.nominal}
                      {dimUnitSuffix(dim.type)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TolDisplay dim={dim} />
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                      {dim.drawing_revision ?? <span className="text-slate-200">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => startEdit(dim)}
                          className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDeleteId(dim.id);
                          }}
                          className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {confirmDeleteId === dim.id && (
                  <tr key={`${dim.id}-confirm`} className="bg-red-50/60">
                    <td colSpan={9} className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-red-700">
                          Excluir a dimensão <span className="font-mono">{dim.dim_code}</span>? Esta
                          ação não pode ser desfeita.
                        </span>
                        <button
                          type="button"
                          onClick={() => confirmDelete(dim)}
                          disabled={deleting}
                          className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
                        >
                          {deleting ? "…" : "Confirmar Exclusão"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deleting}
                          className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          Cancelar
                        </button>
                        {deleteError && <span className="text-xs text-red-700">{deleteError}</span>}
                      </div>
                    </td>
                  </tr>
                )}

                {/* ── Linhas das filhas (expandidas) ── */}
                {isExpanded &&
                  !isEditing &&
                  dim.children.map((child) => {
                    const isEditingChild = editingId === child.id;
                    return isEditingChild ? (
                      <DimEditRow
                        key={child.id}
                        dim={child}
                        partId={partId}
                        indent={true}
                        draft={draft}
                        setDraft={setDraft}
                        saving={saving}
                        onSave={() => saveEdit(child)}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <tr key={child.id} className="bg-blue-50/30 hover:bg-blue-50/60">
                        <td className="px-2 py-1.5 w-5" />
                        <td className="px-2 py-1.5 text-slate-300 w-4">└</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">
                          {child.dim_code}
                          {child.sub_type && child.sub_type !== "NONE" && (
                            <span className="ml-1.5 text-slate-400 font-normal text-[10px]">
                              {child.sub_type}
                            </span>
                          )}
                          {dim.zone_geometry === "RECTANGLE" && (
                            <ChildAxisRelationBadge partId={partId} parentDim={dim} child={child} />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {child.dim_name ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-slate-400">
                          {DIM_TYPE_LABEL[child.type] ?? child.type}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                          {child.nominal}
                          {dimUnitSuffix(child.type)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <TolDisplay dim={child} />
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">
                          {child.drawing_revision ?? <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              type="button"
                              onClick={() => startEdit(child)}
                              className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setConfirmDeleteId(child.id);
                              }}
                              className="rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-50 hover:text-red-700 transition-colors"
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {isExpanded &&
                  !isEditing &&
                  dim.children
                    .filter((child) => confirmDeleteId === child.id)
                    .map((child) => (
                      <tr key={`${child.id}-confirm`} className="bg-red-50/60">
                        <td colSpan={9} className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-red-700">
                              Excluir a dimensão <span className="font-mono">{child.dim_code}</span>
                              ? Esta ação não pode ser desfeita.
                            </span>
                            <button
                              type="button"
                              onClick={() => confirmDelete(child)}
                              disabled={deleting}
                              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
                            >
                              {deleting ? "…" : "Confirmar Exclusão"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={deleting}
                              className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              Cancelar
                            </button>
                            {deleteError && (
                              <span className="text-xs text-red-700">{deleteError}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Tabela de peças cadastradas ────────────────────────────────────────────────

function PartsViewSection() {
  const qc = useQueryClient();
  const { data: parts = [], isLoading } = useQuery({
    queryKey: ["sqc", "parts"],
    queryFn: () => sqcApi.listParts(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ description: "", material: "", process: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function startEdit(part: PartRead) {
    setEditingId(part.id);
    setSaveError(null);
    setDraft({
      description: part.description,
      material: part.material ?? "",
      process: part.process ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError(null);
  }

  async function saveEdit(part: PartRead) {
    if (!draft.description.trim()) {
      setSaveError("Descrição não pode ser vazia.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await sqcApi.updatePart(part.id, {
        description: draft.description.trim(),
        material: draft.material.trim() || undefined,
        process: draft.process.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: ["sqc", "parts"] });
      setEditingId(null);
    } catch (e: unknown) {
      setSaveError((e as { error?: string })?.error ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Peças Cadastradas">
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      )}

      {!isLoading && parts.length === 0 && (
        <p className="text-sm text-slate-400 italic">Nenhuma peça cadastrada ainda.</p>
      )}

      {!isLoading && parts.length > 0 && (
        <>
          {saveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {saveError}
            </div>
          )}
          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Código</th>
                  <th className="px-3 py-2 text-left font-medium">Descrição</th>
                  <th className="px-3 py-2 text-left font-medium">Material</th>
                  <th className="px-3 py-2 text-left font-medium">Processo</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parts.map((part) => (
                  <>
                    {editingId === part.id ? (
                      <tr key={part.id} className="bg-slate-50">
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 font-mono text-slate-500">{part.part_code}</td>
                        <td className="px-3 py-2">
                          <input
                            className="input-base h-8 text-sm"
                            value={draft.description}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, description: e.target.value }))
                            }
                            style={{ minWidth: 200 }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-base h-8 text-sm"
                            value={draft.material}
                            onChange={(e) => setDraft((d) => ({ ...d, material: e.target.value }))}
                            placeholder="—"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="input-base h-8 text-sm"
                            value={draft.process}
                            onChange={(e) => setDraft((d) => ({ ...d, process: e.target.value }))}
                            placeholder="—"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => saveEdit(part)}
                              disabled={saving}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                            >
                              {saving ? "…" : "Salvar"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={part.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expandedId === part.id ? null : part.id)}
                            className="text-slate-400 hover:text-slate-700 transition-colors"
                            title={expandedId === part.id ? "Recolher dimensões" : "Ver dimensões"}
                          >
                            {expandedId === part.id ? "▼" : "▶"}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono font-medium">{part.part_code}</td>
                        <td className="px-3 py-2 text-slate-700">{part.description}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {part.material ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {part.process ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => startEdit(part)}
                            className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    )}

                    {/* Dimensões expandidas */}
                    {expandedId === part.id && editingId !== part.id && (
                      <tr key={`${part.id}-dims`}>
                        <td colSpan={6} className="bg-slate-50 px-4 pb-3">
                          <div className="ml-4 rounded-lg border border-slate-200 bg-white overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                              <span className="text-xs font-medium text-slate-500">
                                Dimensões de {part.part_code}
                              </span>
                            </div>
                            <DimsTable partId={part.id} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────────

export function EngenhariaPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Gestão de Engenharia</h1>
        <p className="text-sm text-slate-500">
          Cadastre peças, importe dimensões e associe desenhos técnicos.
        </p>
      </div>

      <PartsViewSection />
      <PartSection />
      <DimsSection />
      <DrawingSection />
    </div>
  );
}
