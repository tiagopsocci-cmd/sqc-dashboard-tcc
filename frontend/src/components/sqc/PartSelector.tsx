import { sqcApi } from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";

interface Props {
  selectedPartId?: string;
  onPartChange: (partId: string) => void;
}

export function PartSelector({ selectedPartId, onPartChange }: Props) {
  const { data: parts = [], isLoading } = useQuery({
    queryKey: ["sqc", "parts"],
    queryFn: () => sqcApi.listParts(),
  });

  if (isLoading) return <div className="h-9 w-48 animate-pulse rounded bg-slate-200" />;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="part-selector" className="text-xs font-medium text-slate-500">
        Peça
      </label>
      <select
        id="part-selector"
        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        value={selectedPartId ?? ""}
        onChange={(e) => {
          if (e.target.value) onPartChange(e.target.value);
        }}
      >
        <option value="">Selecione uma peça…</option>
        {parts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.part_code}
            {p.description ? ` — ${p.description}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
