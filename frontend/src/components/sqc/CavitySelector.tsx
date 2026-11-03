interface Props {
  cavities: number[];
  value: number | null;
  onChange: (cavity: number | null) => void;
}

export function CavitySelector({ cavities, value, onChange }: Props) {
  if (cavities.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-slate-500 shrink-0">Cavidade:</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`rounded-md px-3 py-0.5 text-xs font-medium transition-colors
          ${
            value === null
              ? "bg-slate-800 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
      >
        Todas
      </button>
      {cavities.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`rounded-md px-3 py-0.5 text-xs font-medium transition-colors
            ${
              value === c
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
        >
          Cav. {c}
        </button>
      ))}
    </div>
  );
}
