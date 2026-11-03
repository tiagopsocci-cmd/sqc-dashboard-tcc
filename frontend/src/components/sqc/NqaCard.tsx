import { sqcApi } from "@/lib/sqc-api";
import { useQuery } from "@tanstack/react-query";

interface Props {
  batchId: string;
  dimId: string;
  tolPlusOverride?: number;
  tolMinusOverride?: number;
  cavity?: number;
}

const STATUS_STYLE = {
  ACEITO: "border-emerald-300 bg-emerald-50 text-emerald-800",
  REJEITADO: "border-red-300 bg-red-50 text-red-800",
  AMOSTRA_INSUFICIENTE: "border-amber-300 bg-amber-50 text-amber-800",
} as const;

export function NqaCard({ batchId, dimId, tolPlusOverride, tolMinusOverride, cavity }: Props) {
  const toleranceOverridden = tolPlusOverride !== undefined || tolMinusOverride !== undefined;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sqc", "nqa", batchId, dimId, tolPlusOverride, tolMinusOverride, cavity],
    queryFn: () => sqcApi.getNqa(batchId, dimId, tolPlusOverride, tolMinusOverride, cavity),
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />;
  if (isError || !data) return null;

  const statusStyle = STATUS_STYLE[data.status] ?? STATUS_STYLE.AMOSTRA_INSUFICIENTE;
  const achievedAqlLabel = data.achieved_aql ?? "—";

  return (
    <div
      className={`rounded-lg border p-4 ${statusStyle} ${toleranceOverridden ? "ring-1 ring-amber-300" : ""}`}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
              NQA / AQL — NBR 5426
            </p>
            {toleranceOverridden && (
              <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700">
                SIM
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xl font-bold">{achievedAqlLabel}</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="opacity-60">Tamanho do lote: </span>
            <strong>{data.batch_size ?? "Não informado"}</strong>
          </span>
          <span>
            <span className="opacity-60">Nível: </span>
            <strong>{data.inspection_level}</strong>
          </span>
          <span>
            <span className="opacity-60">AQL: </span>
            <strong>{data.aql}</strong>
          </span>
          <span>
            <span className="opacity-60">Letra: </span>
            <strong>{data.letter}</strong>
          </span>
          <span>
            <span className="opacity-60">Amostra requerida: </span>
            <strong>{data.required_sample_size}</strong>
          </span>
          <span>
            <span className="opacity-60">Inspecionadas: </span>
            <strong>{data.inspected}</strong>
          </span>
          <span>
            <span className="opacity-60">Não-conformes: </span>
            <strong>{data.non_conforming}</strong>
          </span>
          <span>
            <span className="opacity-60">Ac / Re: </span>
            <strong>
              {data.acceptance_number} / {data.rejection_number}
            </strong>
          </span>
        </div>
      </div>
      {data.batch_size === null && (
        <p className="mt-2 text-xs opacity-60">
          Tamanho do lote não informado — plano de amostragem determinado pelo número de peças
          inspecionadas ({data.inspected}), consultando a Tabela II-A da NBR 5426 (letra{" "}
          {data.letter}).
        </p>
      )}
    </div>
  );
}
