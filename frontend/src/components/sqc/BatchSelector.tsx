import { sqcApi } from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

interface Props {
  onBatchChange: (batchId: string, partId: string) => void;
  selectedBatchId?: string;
  partId?: string;
}

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === "IE"
      ? "bg-blue-100 text-blue-700"
      : status === "EVB"
        ? "bg-amber-100 text-amber-700"
        : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${colors}`}>
      {status}
    </span>
  );
}

export function BatchSelector({ onBatchChange, selectedBatchId, partId }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["sqc", "batches"],
    queryFn: () => sqcApi.listBatches(),
  });

  const visible = (partId ? batches.filter((b) => b.part_id === partId) : batches).sort((a, b) =>
    a.tracking_code.localeCompare(b.tracking_code),
  );

  const selected = visible.find((b) => b.id === selectedBatchId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (isLoading) return <div className="h-9 w-56 animate-pulse rounded bg-slate-200" />;

  const isEmpty = partId && visible.length === 0;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <label htmlFor="batch-selector-btn" className="text-xs font-medium text-slate-500">
        Lote
      </label>
      <button
        id="batch-selector-btn"
        type="button"
        disabled={!!isEmpty}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 min-w-[320px] items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${
          isEmpty ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <StatusBadge status={selected.project_status} />
            <span className="truncate text-slate-800">{selected.tracking_code}</span>
          </span>
        ) : (
          <span className="truncate text-slate-400">
            {isEmpty ? "Nenhum lote para esta peça" : "Selecione um lote…"}
          </span>
        )}
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
          <div className="max-h-72 overflow-y-auto">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-50 border-b border-slate-100"
            >
              Selecione um lote…
            </button>
            {visible.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onBatchChange(b.id, b.part_id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 text-left ${
                  b.id === selectedBatchId ? "bg-slate-50" : ""
                }`}
              >
                <StatusBadge status={b.project_status} />
                <span className="truncate text-slate-700">{b.tracking_code}</span>
                {b.id === selectedBatchId && (
                  <svg
                    className="ml-auto h-4 w-4 shrink-0 text-slate-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <title>Selecionado</title>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
