import { PartSelector } from "@/components/sqc/PartSelector";
import {
  Badge,
  Field,
  FileInput,
  SectionCard,
  isExcelWithSheets,
} from "@/components/sqc/import-helpers";
import {
  type BatchCreate,
  type BatchRead,
  type ImportResult,
  type MeasurementPreview,
  type MeasurementPreviewRow,
  sqcApi,
} from "@/lib/sqc-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

// ── Constantes ─────────────────────────────────────────────────────────────────

const PROJECT_STATUS_OPTIONS = [
  { value: "EVB", label: "EVB — Engineering Validation Build" },
  { value: "PVB", label: "PVB — Process Validation Build" },
  { value: "IE", label: "IE — Inspeção de Entrada" },
] as const;

const INSPECTION_LEVEL_OPTIONS = [
  { value: "I", label: "I — Nível Reduzido" },
  { value: "II", label: "II — Nível Normal" },
  { value: "III", label: "III — Nível Rigoroso" },
] as const;

const AQL_OPTIONS = [0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1.0, 1.5, 2.5, 4.0, 6.5];

type Step = "form" | "upload" | "preview" | "done";
type Mode = "novo" | "existente";

// ── BatchSection ───────────────────────────────────────────────────────────────

function BatchSection() {
  const [mode, setMode] = useState<Mode>("novo");
  const [step, setStep] = useState<Step>("form");

  // Estado compartilhado
  const [partId, setPartId] = useState<string | null>(null);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);

  // Modo "novo" — formulário
  const [form, setForm] = useState<Omit<BatchCreate, "part_id">>({
    tracking_code: "",
    supplier_id: "",
    project_status: "IE",
    inspection_level: "I",
    aql: 0.4,
  });
  const [batchSize, setBatchSize] = useState<string>("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  // Modo "existente" — seletor
  const [selectedExistingId, setSelectedExistingId] = useState<string>("");

  const { data: existingBatches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ["sqc", "batches", partId],
    queryFn: () => sqcApi.listBatches({ part_id: partId ?? undefined }),
    enabled: mode === "existente" && !!partId,
  });

  const { data: instruments = [] } = useQuery({
    queryKey: ["instruments"],
    queryFn: sqcApi.listInstruments,
    staleTime: 5 * 60_000,
  });

  const instrumentNameByCode = Object.fromEntries(
    instruments.map((i) => [i.code.toLowerCase(), i.name]),
  );

  function instrumentLabel(code: string | null | undefined): string {
    if (!code) return "—";
    return instrumentNameByCode[code.toLowerCase()] ?? code;
  }

  // Passo 2 — upload
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [preview, setPreview] = useState<MeasurementPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Passo 3 — confirmar
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const qc = useQueryClient();

  // ── Handlers ────────────────────────────────────────────────────────────────

  function switchMode(m: Mode) {
    setMode(m);
    setStep("form");
    setPartId(null);
    setCreatedBatchId(null);
    setSelectedExistingId("");
    setFormError(null);
    setDuplicateWarning(false);
    resetUpload();
  }

  function resetUpload() {
    setFile(null);
    setSheets([]);
    setSelectedSheet("");
    setPreview(null);
    setPreviewError(null);
    setImportResult(null);
    setImportError(null);
  }

  async function handleCreateBatch(force = false) {
    if (!partId || !form.tracking_code || !form.supplier_id) return;
    if (!force && duplicateWarning) {
      setDuplicateWarning(true);
      return;
    }
    setFormLoading(true);
    setFormError(null);
    setDuplicateWarning(false);
    try {
      const payload: BatchCreate = {
        ...form,
        part_id: partId,
        batch_size: batchSize ? Number.parseInt(batchSize) : undefined,
      };
      const batch = await sqcApi.createBatch(payload);
      setCreatedBatchId(batch.id);
      qc.invalidateQueries({ queryKey: ["sqc", "batches"] });
      setStep("upload");
    } catch (e: unknown) {
      const msg = (e as { error?: string })?.error ?? "";
      if (msg.includes("already exists") || msg.includes("tracking_code")) {
        setDuplicateWarning(true);
      } else {
        setFormError(msg || "Erro ao criar lote.");
      }
    } finally {
      setFormLoading(false);
    }
  }

  async function handleUseExistingFromDuplicate() {
    setFormLoading(true);
    setFormError(null);
    setDuplicateWarning(false);
    try {
      const batches = await sqcApi.listBatches({ part_id: partId ?? undefined });
      const existing = batches.find((b) => b.tracking_code === form.tracking_code);
      if (!existing) {
        setFormError("Lote não encontrado.");
        return;
      }
      setCreatedBatchId(existing.id);
      setStep("upload");
    } catch {
      setFormError("Erro ao buscar lote existente.");
    } finally {
      setFormLoading(false);
    }
  }

  function handleUseExistingBatch() {
    if (!selectedExistingId) return;
    setCreatedBatchId(selectedExistingId);
    setStep("upload");
  }

  async function handleFileChange(f: File) {
    setFile(f);
    setPreview(null);
    setPreviewError(null);
    setSelectedSheet("");
    if (!createdBatchId) return;
    if (isExcelWithSheets(f.name)) {
      setPreviewLoading(true);
      try {
        const prev = await sqcApi.previewMeasurements(createdBatchId, f);
        setSheets(prev.sheets);
        if (prev.sheets.length <= 1) {
          setPreview(prev);
          setStep("preview");
        }
      } catch (e: unknown) {
        setPreviewError((e as { error?: string })?.error ?? "Erro ao ler arquivo.");
      } finally {
        setPreviewLoading(false);
      }
    }
  }

  async function handleSheetSelect(sheet: string) {
    setSelectedSheet(sheet);
    if (!createdBatchId || !file) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const prev = await sqcApi.previewMeasurements(createdBatchId, file, sheet);
      setPreview(prev);
      setStep("preview");
    } catch (e: unknown) {
      setPreviewError((e as { error?: string })?.error ?? "Erro ao ler aba.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handlePreviewForCsv() {
    if (!createdBatchId || !file) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const prev = await sqcApi.previewMeasurements(createdBatchId, file);
      setPreview(prev);
      setStep("preview");
    } catch (e: unknown) {
      setPreviewError((e as { error?: string })?.error ?? "Erro ao ler arquivo.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirmImport() {
    if (!createdBatchId || !file) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const res = await sqcApi.importMeasurements(createdBatchId, file, selectedSheet || undefined);
      setImportResult(res);
      qc.invalidateQueries({ queryKey: ["sqc", "batches"] });
      setStep("done");
    } catch (e: unknown) {
      setImportError((e as { error?: string })?.error ?? "Erro ao importar medições.");
    } finally {
      setImportLoading(false);
    }
  }

  const isXlsx = !!file && isExcelWithSheets(file.name);
  const canPreviewCsv = !!file && !isXlsx && step === "upload";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SectionCard title="Importar Medições">
      {/* Toggle de modo — só visível no passo "form" */}
      {step === "form" && (
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          <button
            type="button"
            onClick={() => switchMode("novo")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              mode === "novo"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Criar novo lote
          </button>
          <button
            type="button"
            onClick={() => switchMode("existente")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              mode === "existente"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Adicionar a lote existente
          </button>
        </div>
      )}

      {/* ── MODO EXISTENTE — seletor de lote ──────────────────────────────── */}
      {mode === "existente" && step === "form" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Selecione a peça e o lote em que deseja adicionar medições.
          </p>

          <div className="flex flex-wrap gap-4 items-end">
            <PartSelector
              selectedPartId={partId ?? undefined}
              onPartChange={(id) => {
                setPartId(id);
                setSelectedExistingId("");
              }}
            />

            <Field label="Lote">
              {batchesLoading ? (
                <div className="h-9 w-64 animate-pulse rounded bg-slate-200" />
              ) : (
                <select
                  className="input-base w-64"
                  value={selectedExistingId}
                  disabled={!partId}
                  onChange={(e) => setSelectedExistingId(e.target.value)}
                >
                  <option value="">
                    {!partId
                      ? "Selecione uma peça primeiro"
                      : existingBatches.length === 0
                        ? "Nenhum lote encontrado"
                        : "Selecione um lote…"}
                  </option>
                  {existingBatches.map((b: BatchRead) => (
                    <option key={b.id} value={b.id}>
                      {b.tracking_code} — {b.supplier_id} ({b.project_status})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <button
            type="button"
            onClick={handleUseExistingBatch}
            disabled={!selectedExistingId}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Continuar para upload →
          </button>
        </div>
      )}

      {/* ── MODO NOVO — indicador de passos ───────────────────────────────── */}
      {mode === "novo" && (
        <div className="flex items-center gap-2 text-xs">
          {(["form", "upload", "preview", "done"] as Step[]).map((s, i) => {
            const labels: Record<Step, string> = {
              form: "1. Dados do lote",
              upload: "2. Upload",
              preview: "3. Confirmar",
              done: "4. Concluído",
            };
            const active = step === s;
            const past = ["form", "upload", "preview", "done"].indexOf(step) > i;
            return (
              <span key={s} className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    active
                      ? "bg-slate-900 text-white"
                      : past
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {labels[s]}
                </span>
                {i < 3 && <span className="text-slate-300">→</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* ── PASSO 1 (modo novo) — Formulário ─────────────────────────────── */}
      {mode === "novo" && step === "form" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <PartSelector selectedPartId={partId ?? undefined} onPartChange={setPartId} />

            <Field label="Tracking code / NF">
              <input
                className="input-base"
                placeholder="ex: 20260518-S0004150-0000019106"
                value={form.tracking_code}
                onChange={(e) => setForm((f) => ({ ...f, tracking_code: e.target.value }))}
              />
            </Field>

            <Field label="Fornecedor">
              <input
                className="input-base"
                placeholder="Nome do fornecedor"
                value={form.supplier_id}
                onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
              />
            </Field>

            <Field label="Status do projeto">
              <select
                className="input-base"
                value={form.project_status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    project_status: e.target.value as BatchCreate["project_status"],
                  }))
                }
              >
                {PROJECT_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Tamanho do lote (opcional)">
              <input
                className="input-base"
                type="number"
                min={1}
                placeholder="Deixe vazio se não souber"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
            </Field>

            <Field label="Nível de inspeção">
              <select
                className="input-base"
                value={form.inspection_level}
                onChange={(e) => setForm((f) => ({ ...f, inspection_level: e.target.value }))}
              >
                {INSPECTION_LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="AQL">
              <select
                className="input-base"
                value={form.aql}
                onChange={(e) => setForm((f) => ({ ...f, aql: Number.parseFloat(e.target.value) }))}
              >
                {AQL_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

          {duplicateWarning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
              <p className="text-sm font-medium text-amber-800">
                Já existe um lote com o tracking code <strong>{form.tracking_code}</strong>.
              </p>
              <p className="text-sm text-amber-700">O que deseja fazer?</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleUseExistingFromDuplicate}
                  disabled={formLoading}
                  className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-40 transition-colors"
                >
                  Usar lote existente e continuar upload
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicateWarning(false)}
                  className="rounded-md border border-amber-300 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  Alterar o tracking code
                </button>
              </div>
            </div>
          )}

          {!duplicateWarning && (
            <button
              type="button"
              onClick={() => handleCreateBatch(false)}
              disabled={!partId || !form.tracking_code || !form.supplier_id || formLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {formLoading ? "Criando lote…" : "Criar Lote e Continuar →"}
            </button>
          )}
        </div>
      )}

      {/* ── PASSO 2 — Upload (compartilhado entre os dois modos) ─────────── */}
      {(step === "upload" || step === "preview") && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {mode === "existente"
              ? "Lote selecionado. Escolha o arquivo de medições exportado do PolyWorks."
              : "Lote criado com sucesso. Selecione o arquivo de medições exportado do PolyWorks."}
          </p>

          <FileInput
            accept=".csv,.xlsx,.xlsm"
            label="Arquivo de medições (.csv, .xlsx ou .xlsm — com ou sem macro)"
            file={file}
            onChange={handleFileChange}
          />

          {isXlsx && sheets.length > 1 && step === "upload" && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500">Selecione a aba do lote</p>
              <select
                className="input-base"
                value={selectedSheet}
                onChange={(e) => handleSheetSelect(e.target.value)}
              >
                <option value="">Escolha uma aba…</option>
                {sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {canPreviewCsv && (
            <button
              type="button"
              onClick={handlePreviewForCsv}
              disabled={previewLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {previewLoading ? "Lendo arquivo…" : "Visualizar Preview →"}
            </button>
          )}

          {previewLoading && <div className="h-8 w-48 animate-pulse rounded bg-slate-100" />}
          {previewError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {previewError}
            </div>
          )}
        </div>
      )}

      {/* ── PASSO 3 — Preview + Confirmar ────────────────────────────────── */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-xs">
            {[
              ["Operador", preview.operator ?? "—"],
              ["Instrumento", instrumentLabel(preview.instrument)],
              ["Fixture", preview.fixture ?? "—"],
              ["Work Order", preview.work_order ?? "—"],
              [
                "Início",
                preview.date_start ? new Date(preview.date_start).toLocaleString("pt-BR") : "—",
              ],
              ["Fim", preview.date_end ? new Date(preview.date_end).toLocaleString("pt-BR") : "—"],
              ["Peças", String(preview.total_parts)],
              ["Dimensões encontradas", `${preview.found_dims} / ${preview.total_dims}`],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="text-slate-400 w-36 shrink-0">{label}:</span>
                <span className="font-medium text-slate-700">{value}</span>
              </div>
            ))}
          </div>

          {preview.missing_dims > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {preview.missing_dims} dimensão(ões) não cadastrada(s). Corrija o arquivo ou o
              cadastro antes de importar; nenhuma medição será gravada.
            </div>
          )}

          {preview.errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              <p className="font-medium">O arquivo contém erros:</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {(preview.duplicate_pairs ?? 0) > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
              Este mesmo arquivo já foi importado no lote. Nenhuma medição será adicionada
              novamente.
            </div>
          )}

          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Dimensão</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-center font-medium">Peças</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((row: MeasurementPreviewRow) => (
                  <tr key={row.dim_code} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">{row.dim_code}</td>
                    <td className="px-3 py-2 text-slate-500">{row.dim_type ?? "—"}</td>
                    <td className="px-3 py-2 text-center">{row.part_count}</td>
                    <td className="px-3 py-2">
                      <Badge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={
                importLoading ||
                preview.found_dims === 0 ||
                preview.missing_dims > 0 ||
                preview.errors.length > 0 ||
                (preview.duplicate_pairs ?? 0) > 0
              }
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {importLoading ? "Importando…" : "Confirmar Importação"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("upload");
                setPreview(null);
                setFile(null);
              }}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

          {importError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {importError}
            </div>
          )}
        </div>
      )}

      {/* ── PASSO 4 — Concluído ───────────────────────────────────────────── */}
      {step === "done" && importResult && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
            <p className="text-sm font-semibold text-emerald-800">Importação concluída!</p>
            <p className="mt-1 text-sm text-emerald-700">
              {importResult.imported} medições importadas · {importResult.rejected} ignoradas
            </p>
          </div>

          {importResult.errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 space-y-0.5">
              <p className="font-medium">Avisos ({importResult.errors.length})</p>
              {importResult.errors.slice(0, 10).map((e) => (
                <p key={e.reason} className="text-xs">
                  {e.reason}
                </p>
              ))}
              {importResult.errors.length > 10 && (
                <p className="text-xs">… e mais {importResult.errors.length - 10} avisos.</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <a
              href="/sqc"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Ir para o Dashboard →
            </a>
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setCreatedBatchId(null);
                resetUpload();
                if (mode === "novo") {
                  setForm({
                    tracking_code: "",
                    supplier_id: "",
                    project_status: "IE",
                    inspection_level: "I",
                    aql: 0.4,
                  });
                  setBatchSize("");
                  setPartId(null);
                } else {
                  setSelectedExistingId("");
                }
              }}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Importar outro lote
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Upload de Relatórios PolyWorks ────────────────────────────────────────────

function ReportsSection() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [partId, setPartId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ saved: number[]; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: batchesRaw = [] } = useQuery({
    queryKey: ["sqc", "batches", partId],
    queryFn: () => sqcApi.listBatches({ part_id: partId ?? undefined }),
    enabled: !!partId,
  });
  // Ordena pelo prefixo YYYYMMDD do tracking_code (decrescente = mais recente primeiro)
  const batches = [...batchesRaw].sort((a, b) => b.tracking_code.localeCompare(a.tracking_code));
  const selectedBatch = batches.find((batch) => batch.id === batchId);
  const isReadOnly = selectedBatch != null && selectedBatch.batch_status !== "IN_ANALYSIS";

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
    setResult(null);
    setError(null);
  }

  async function handleUpload() {
    if (!batchId || files.length === 0 || isReadOnly) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await sqcApi.uploadReports(batchId, files);
      setResult(res);
      setFiles([]);
    } catch (e: unknown) {
      const apiError = e as { status?: number; error?: string };
      setError(
        apiError.status === 409
          ? "O lote foi decidido durante a operação. Nenhum relatório foi alterado."
          : (apiError.error ?? "Erro ao fazer upload."),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Relatórios PolyWorks (PDF)">
      <p className="text-sm text-slate-500">
        Suba os relatórios em PDF gerados pelo PolyWorks. Você pode selecionar{" "}
        <strong>vários PDFs de uma vez</strong> ou enviar um único <strong>arquivo .zip</strong>. Os
        arquivos devem se chamar{" "}
        <code className="bg-slate-100 px-1 rounded text-xs">Part 1.pdf</code>,{" "}
        <code className="bg-slate-100 px-1 rounded text-xs">Part 2.pdf</code>, etc.
      </p>

      <div className="flex flex-wrap gap-4 items-end">
        <Field label="Peça">
          <PartSelector
            selectedPartId={partId ?? undefined}
            onPartChange={(id) => {
              setPartId(id);
              setBatchId(null);
            }}
          />
        </Field>

        {partId && (
          <Field label="Lote">
            <select
              value={batchId ?? ""}
              onChange={(e) => setBatchId(e.target.value || null)}
              className="input-base"
            >
              <option value="">Selecione o lote…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.tracking_code} —{" "}
                  {b.batch_status === "IN_ANALYSIS" ? "Em análise" : "Somente leitura"}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {batchId && (
        <div className="space-y-3">
          {isReadOnly && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Este lote já foi decidido. Os relatórios permanecem disponíveis para leitura, mas
              novos uploads e substituições estão bloqueados.
            </p>
          )}
          <div>
            <label htmlFor="report-files" className="text-xs font-medium text-slate-500 block mb-1">
              Arquivos — selecione vários PDFs ou um ZIP
            </label>
            <input
              id="report-files"
              type="file"
              multiple
              accept=".pdf,.zip"
              disabled={isReadOnly}
              onChange={handleFiles}
              className="block text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {files.map((f) => (
                  <p key={f.name} className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span className="text-slate-300">›</span> {f.name}
                  </p>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleUpload}
            disabled={files.length === 0 || loading || isReadOnly}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {loading ? "Enviando…" : "Enviar Relatórios"}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {result && (
            <div className="space-y-2">
              {result.saved.length > 0 && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                  {result.saved.length} relatório{result.saved.length > 1 ? "s" : ""} importado
                  {result.saved.length > 1 ? "s" : ""}: Peças {result.saved.join(", ")}
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 space-y-0.5">
                  <p className="font-medium">Avisos ({result.errors.length})</p>
                  {result.errors.map((e) => (
                    <p key={e} className="text-xs">
                      {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────────

export function ImportPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Importar Lote</h1>
        <p className="text-sm text-slate-500">
          Crie um novo lote e importe as medições do PolyWorks.
        </p>
      </div>

      <BatchSection />
      <ReportsSection />
    </div>
  );
}
