import { type DimRead, sqcApi } from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

interface Props {
  partId: string | null;
  onDimChange: (dimId: string, dim: DimRead) => void;
  onDimClear?: () => void;
  selectedDimId?: string;
}

export function DimSelector({ partId, onDimChange, onDimClear, selectedDimId }: Props) {
  const { data: dims, isLoading } = useQuery({
    queryKey: ["sqc", "dims", partId],
    queryFn: () => sqcApi.listDims(partId ?? ""),
    enabled: !!partId,
  });

  // Exibir apenas dims principais (sem parent)
  const mainDims = dims?.filter((d) => d.parent_dim_id === null) ?? [];

  // `selectedDimId` vem da URL e sobrevive a um F5, mas o objeto `DimRead` completo (usado
  // por quem consome esta seleção, ex. `isRectangle`/`zone_geometry`) só existe em estado local
  // do componente pai, preenchido apenas pelo onChange do <select>. Sem isto, um reload da
  // página deixa esse estado `null`/desatualizado até o usuário reselecionar manualmente a dim.
  const lastSyncedRef = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: onDimChange/mainDims recriados a cada render do pai — o guard por ref evita repetir além da 1ª sincronização.
  useEffect(() => {
    if (!selectedDimId || lastSyncedRef.current === selectedDimId) return;
    const dim = mainDims.find((d) => d.id === selectedDimId);
    if (dim) {
      lastSyncedRef.current = selectedDimId;
      onDimChange(dim.id, dim);
    }
  }, [selectedDimId, dims]);

  if (!partId) return null;
  if (isLoading) return <div className="h-9 w-48 animate-pulse rounded bg-slate-200" />;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="dim-selector" className="text-xs font-medium text-slate-500">
        Dimensão
      </label>
      <div className="flex items-center gap-1">
        <select
          id="dim-selector"
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={selectedDimId ?? ""}
          onChange={(e) => {
            const dim = mainDims.find((d) => d.id === e.target.value);
            if (dim) onDimChange(dim.id, dim);
          }}
        >
          <option value="">Selecione uma dimensão…</option>
          {mainDims.map((d) => (
            <option key={d.id} value={d.id}>
              {d.dim_code}
              {d.dim_name ? ` — ${d.dim_name}` : ""}
            </option>
          ))}
        </select>
        {selectedDimId && onDimClear && (
          <button
            type="button"
            onClick={onDimClear}
            title="Limpar dimensão — ver visão geral"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 shadow-sm hover:bg-slate-50 hover:text-slate-600 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
              <title>Limpar seleção</title>
              <path
                d="M12 4 4 12M4 4l8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
