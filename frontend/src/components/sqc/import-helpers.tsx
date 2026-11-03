import { useRef } from "react";

// ── Formato de arquivo ───────────────────────────────────────────────────────────

/** .xlsx e .xlsm (Excel com macro) são lidos pelo mesmo parser, com seleção de aba. */
export function isExcelWithSheets(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xlsm");
}

// ── Badge ──────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  new: "bg-emerald-100 text-emerald-700",
  exists: "bg-slate-100 text-slate-500",
  updated: "bg-amber-100 text-amber-700",
  found: "bg-emerald-100 text-emerald-700",
  not_found: "bg-red-100 text-red-600",
};

const STATUS_LABEL: Record<string, string> = {
  new: "Nova",
  exists: "Já existe",
  updated: "Atualizada",
  found: "Encontrada",
  not_found: "Não cadastrada",
};

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? "bg-slate-100 text-slate-500"}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── SectionCard ────────────────────────────────────────────────────────────────

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-[200px]">
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── FileInput ──────────────────────────────────────────────────────────────────

export function FileInput({
  accept,
  label,
  onChange,
  file,
}: {
  accept: string;
  label: string;
  onChange: (f: File) => void;
  file: File | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-500">{label}</p>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-100 transition-colors"
        onClick={() => ref.current?.click()}
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1v9M4.5 5.5 8 2l3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M1 11v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span className="truncate">{file ? file.name : "Clique para selecionar o arquivo"}</span>
        <input
          ref={ref}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onChange(e.target.files[0]);
          }}
        />
      </button>
    </div>
  );
}
