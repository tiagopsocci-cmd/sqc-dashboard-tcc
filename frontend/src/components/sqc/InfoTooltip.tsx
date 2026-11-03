interface ThresholdItem {
  label: string;
  color: "green" | "amber" | "red";
  description: string;
}

interface Props {
  title: string;
  what: string;
  formula: string;
  thresholds?: ThresholdItem[];
  note?: string;
  align?: "left" | "center" | "right";
}

const BADGE = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100  text-amber-700",
  red: "bg-red-100    text-red-700",
} as const;

const DOT = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
} as const;

// Posição horizontal do container da tooltip
const POPOVER_H: Record<"left" | "center" | "right", string> = {
  left: "left-0",
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};

// Posição da setinha
const ARROW_H: Record<"left" | "center" | "right", string> = {
  left: "left-3",
  center: "left-1/2 -translate-x-1/2",
  right: "right-3",
};

export function InfoTooltip({ title, what, formula, thresholds, note, align = "center" }: Props) {
  return (
    <div className="group relative inline-flex items-center">
      {/* Ícone ⓘ */}
      <button
        type="button"
        className="flex items-center justify-center w-4 h-4 rounded-full
                   text-zinc-400 hover:text-blue-500 hover:bg-blue-50
                   transition-colors duration-150 focus:outline-none"
        aria-label={`Informações sobre ${title}`}
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" aria-hidden="true">
          <title>Informação</title>
          <circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 7v5M8 5.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {/* Tooltip — aparece ABAIXO do ícone para nunca sair pelo topo */}
      <div
        className={`
          invisible group-hover:visible opacity-0 group-hover:opacity-100
          absolute top-full mt-2 z-50
          w-72 rounded-xl border border-zinc-200 bg-white shadow-xl
          transition-all duration-150 pointer-events-none text-left
          ${POPOVER_H[align]}
        `}
      >
        {/* Setinha acima */}
        <div
          className={`absolute bottom-full mb-px border-[5px] border-transparent border-b-white ${ARROW_H[align]}`}
        />

        <div className="p-4 space-y-3">
          <p className="font-semibold text-zinc-900 text-sm">{title}</p>
          <p className="text-xs text-zinc-600 leading-relaxed">{what}</p>

          <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2">
            <p className="text-[10px] text-zinc-400 mb-1 font-semibold uppercase tracking-wider">
              Fórmula
            </p>
            <code className="text-xs font-mono text-zinc-700 leading-relaxed whitespace-pre-wrap break-words">
              {formula}
            </code>
          </div>

          {thresholds && thresholds.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
                Como interpretar
              </p>
              {thresholds.map((t) => (
                <div key={t.label} className="flex items-start gap-2">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.color]}`} />
                  <div className="min-w-0">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold mr-1 ${BADGE[t.color]}`}
                    >
                      {t.label}
                    </span>
                    <span className="text-xs text-zinc-500">{t.description}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {note && (
            <p className="text-xs text-zinc-400 italic border-t border-zinc-100 pt-2">{note}</p>
          )}
        </div>
      </div>
    </div>
  );
}
