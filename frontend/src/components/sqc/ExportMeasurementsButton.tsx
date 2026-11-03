import { type ExportFormat, downloadBlob, sqcApi } from "@/lib/sqc-api";
import { useState } from "react";

interface Props {
  batchIds: string[];
  dimId: string;
  cavity?: number | null;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "txt", label: "Texto (.txt)" },
];

export function ExportMeasurementsButton({ batchIds, dimId, cavity }: Props) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (batchIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const { blob, filename } = await sqcApi.exportMeasurements(batchIds, dimId, cavity, format);
      downloadBlob(blob, filename);
    } catch (e) {
      const err = e as { status?: number; error?: string };
      setError(
        err.status === 404
          ? "Nenhuma medição encontrada para esta dimensão/seleção de lotes."
          : (err.error ?? "Erro ao exportar medições."),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          disabled={loading}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 shadow-sm"
        >
          {FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading || batchIds.length === 0}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "Exportando…"
            : `Exportar${batchIds.length > 1 ? ` (${batchIds.length} lotes)` : ""}`}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
