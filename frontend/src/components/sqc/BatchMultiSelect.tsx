import { sqcApi } from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

interface Props {
  partId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function BatchMultiSelect({ partId, selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["sqc", "batches"],
    queryFn: () => sqcApi.listBatches(),
  });

  const partBatches = batches
    .filter((b) => b.part_id === partId)
    .sort((a, b) => a.tracking_code.localeCompare(b.tracking_code));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    const orderMap = new Map(partBatches.map((b, i) => [b.id, i]));
    onChange(next.sort((a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0)));
  }

  function toggleAll() {
    if (selectedIds.length === partBatches.length) {
      onChange([]);
    } else {
      onChange(partBatches.map((b) => b.id));
    }
  }

  const noneSelected = selectedIds.length === 0;
  const allSelected = selectedIds.length === partBatches.length && partBatches.length > 0;

  const label = noneSelected
    ? "Selecione lotes…"
    : allSelected
      ? `Todos os lotes (${partBatches.length})`
      : `${selectedIds.length} de ${partBatches.length} lotes`;

  const placeholderStyle = noneSelected ? "text-slate-400" : "text-slate-800";

  if (isLoading) return <div className="h-9 w-56 animate-pulse rounded bg-slate-200" />;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <label htmlFor="batch-multi-select-btn" className="text-xs font-medium text-slate-500">
        Lotes
      </label>
      <button
        id="batch-multi-select-btn"
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 min-w-[320px] items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${placeholderStyle}`}
      >
        <span className="truncate">{label}</span>
        <svg
          className="ml-2 h-4 w-4 shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <title>Seta dropdown</title>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full z-10 mt-1 w-full min-w-[380px] rounded-md border border-slate-200 bg-white shadow-lg">
          {/* Selecionar / limpar todos */}
          <label
            htmlFor="batch-multi-select-all"
            className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <input
              id="batch-multi-select-all"
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-slate-300 accent-slate-800"
            />
            Selecionar todos
          </label>

          <div className="max-h-60 overflow-y-auto">
            {partBatches.length === 0 && (
              <p className="px-3 py-3 text-sm text-slate-400">
                Nenhum lote encontrado para esta peça.
              </p>
            )}
            {partBatches.map((b) => (
              <label
                key={b.id}
                htmlFor={`batch-check-${b.id}`}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"
              >
                <input
                  id={`batch-check-${b.id}`}
                  type="checkbox"
                  checked={selectedIds.includes(b.id)}
                  onChange={() => toggle(b.id)}
                  className="h-4 w-4 rounded border-slate-300 accent-slate-800"
                />
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      b.project_status === "IE"
                        ? "bg-blue-100 text-blue-700"
                        : b.project_status === "EVB"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {b.project_status}
                  </span>
                  <span className="truncate text-sm text-slate-700">{b.tracking_code}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
