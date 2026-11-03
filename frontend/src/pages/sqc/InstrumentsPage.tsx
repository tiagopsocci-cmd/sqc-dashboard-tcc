import { type InstrumentRead, sqcApi } from "@/lib/sqc-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface FormState {
  code: string;
  name: string;
  uncertainty: string;
}

const EMPTY: FormState = { code: "", name: "", uncertainty: "" };

export function InstrumentsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; uncertainty: string }>({
    name: "",
    uncertainty: "",
  });
  const [error, setError] = useState<string | null>(null);

  const { data: instruments = [], isLoading } = useQuery({
    queryKey: ["instruments"],
    queryFn: sqcApi.listInstruments,
  });

  const create = useMutation({
    mutationFn: sqcApi.createInstrument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instruments"] });
      setForm(EMPTY);
      setError(null);
    },
    onError: (e: { error?: string }) => setError(e.error ?? "Erro ao criar instrumento"),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; uncertainty?: number } }) =>
      sqcApi.updateInstrument(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instruments"] });
      setEditingId(null);
    },
    onError: (e: { error?: string }) => setError(e.error ?? "Erro ao atualizar instrumento"),
  });

  const remove = useMutation({
    mutationFn: sqcApi.deleteInstrument,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instruments"] }),
    onError: (e: { error?: string }) => setError(e.error ?? "Erro ao excluir instrumento"),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const unc = Number.parseFloat(form.uncertainty);
    if (!form.code.trim() || !form.name.trim() || Number.isNaN(unc) || unc <= 0) {
      setError("Preencha todos os campos. Incerteza deve ser um número positivo.");
      return;
    }
    setError(null);
    create.mutate({ code: form.code.trim(), name: form.name.trim(), uncertainty: unc });
  }

  function startEdit(inst: InstrumentRead) {
    setEditingId(inst.id);
    setEditForm({ name: inst.name, uncertainty: String(inst.uncertainty) });
    setError(null);
  }

  function handleUpdate(id: string) {
    const unc = Number.parseFloat(editForm.uncertainty);
    if (!editForm.name.trim() || Number.isNaN(unc) || unc <= 0) {
      setError("Nome e incerteza são obrigatórios. Incerteza deve ser positiva.");
      return;
    }
    setError(null);
    update.mutate({ id, data: { name: editForm.name.trim(), uncertainty: unc } });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Instrumentos de Medição</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre os instrumentos e suas incertezas (±U mm). O código deve coincidir (sem diferença
          de maiúsculas) com o valor da coluna{" "}
          <code className="bg-slate-100 px-1 rounded text-xs">instrument</code> no Excel de
          importação.
        </p>
      </div>

      {/* Formulário de criação */}
      <form
        onSubmit={handleCreate}
        className="rounded-lg border border-slate-200 bg-white p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold text-slate-700">Novo instrumento</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="inst-code" className="text-xs font-medium text-slate-500">
              Código
            </label>
            <input
              id="inst-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="ex: CMM-ZEISS-01"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="inst-name" className="text-xs font-medium text-slate-500">
              Nome
            </label>
            <input
              id="inst-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ex: CMM Zeiss Contura"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="inst-uncertainty" className="text-xs font-medium text-slate-500">
              Incerteza (mm)
            </label>
            <input
              id="inst-uncertainty"
              type="number"
              step="0.0001"
              min="0"
              value={form.uncertainty}
              onChange={(e) => setForm((f) => ({ ...f, uncertainty: e.target.value }))}
              placeholder="ex: 0.005"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {create.isPending ? "Salvando…" : "Adicionar"}
        </button>
      </form>

      {/* Tabela */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando…</div>
        ) : instruments.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Nenhum instrumento cadastrado ainda.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Código
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Nome
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">
                  Incerteza ±U (mm)
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instruments.map((inst) =>
                editingId === inst.id ? (
                  <tr key={inst.id} className="bg-amber-50">
                    <td className="px-4 py-2 text-slate-500 text-xs">{inst.code}</td>
                    <td className="px-4 py-2">
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={editForm.uncertainty}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, uncertainty: e.target.value }))
                        }
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </td>
                    <td className="px-4 py-2 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleUpdate(inst.id)}
                        className="text-xs text-emerald-600 hover:underline font-medium"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-slate-400 hover:underline"
                      >
                        Cancelar
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={inst.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{inst.code}</td>
                    <td className="px-4 py-2.5 text-slate-800">{inst.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">
                      ±{inst.uncertainty.toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => startEdit(inst)}
                        className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Excluir "${inst.name}"?`)) remove.mutate(inst.id);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 hover:underline"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
