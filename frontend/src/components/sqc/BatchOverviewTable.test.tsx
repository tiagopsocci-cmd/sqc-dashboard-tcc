import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchOverviewTable } from "@/components/sqc/BatchOverviewTable";
import type { BatchOverviewResponse, BatchRead, DimRead, NqaSummaryRow } from "@/lib/sqc-api";

const dim: DimRead = {
  id: "dim-1",
  part_id: "part-1",
  dim_code: "DIM-01",
  dim_name: "Dimensão sintética",
  type: "DISTANCE",
  sub_type: null,
  drawing_revision: "A",
  nominal: 10,
  tol_plus: 0.2,
  tol_minus: 0.2,
  is_unilateral: false,
  material_modifier: null,
  dim_rel_1_id: null,
  dim_rel_2_id: null,
  parent_dim_id: null,
  zone_geometry: null,
  children: [],
};

const batch: BatchRead = {
  id: "batch-1",
  tracking_code: "LOTE-SINTETICO-01",
  part_id: "part-1",
  supplier_id: "supplier-1",
  project_status: "IE",
  batch_status: "IN_ANALYSIS",
  rejection_justification: null,
  batch_size: 100,
  inspection_level: "II",
  aql: 0.4,
  inspection_count: 10,
};

const overview: BatchOverviewResponse = {
  batch_id: batch.id,
  tracking_code: batch.tracking_code,
  part_id: batch.part_id,
  drawing_revision: "A",
  dims: [
    {
      dim_id: dim.id,
      dim_code: dim.dim_code,
      dim_name: dim.dim_name,
      dim_type: dim.type,
      is_unilateral: false,
      n: 10,
      mean_tol_pct: 35,
      std_tol_pct: 4,
      n_out: 0,
      n_uncertainty: 0,
      nqa_status: "ACEITO",
      nqa_letter: "F",
      nqa_achieved_aql: 0.4,
      nqa_ac: 0,
      nqa_re: 1,
      status: "ok",
    },
  ],
};

const nqaSummary: NqaSummaryRow[] = [
  {
    dim_id: dim.id,
    dim_code: dim.dim_code,
    result: {
      batch_size: 100,
      inspection_level: "II",
      aql: 0.4,
      letter: "F",
      required_sample_size: 10,
      acceptance_number: 0,
      rejection_number: 1,
      inspected: 10,
      non_conforming: 0,
      status: "ACEITO",
      achieved_aql: 0.4,
      non_evaluable_count: 0,
      diagnostic_incomplete_count: 0,
    },
  },
];

function renderTable(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  function wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <BatchOverviewTable
      data={overview}
      dims={[dim]}
      batch={batch}
      onDimSelect={vi.fn()}
      onBatchChanged={vi.fn()}
    />,
    { wrapper },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("BatchOverviewTable", () => {
  it("carrega o resumo de NQA antes de permitir decidir o lote", async () => {
    const user = userEvent.setup();
    let resolveSummary: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveSummary = resolve;
        }),
    );
    renderTable(fetchMock);

    await user.click(screen.getByRole("button", { name: "Decidir Lote" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/sqc/batches/batch-1/nqa-summary");
    expect(screen.getByRole("button", { name: "Aprovar Lote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reprovar Lote" })).toBeDisabled();

    resolveSummary?.(
      new Response(JSON.stringify(nqaSummary), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await screen.findByText("DIM-01: 0.4")).toBeVisible();
    expect(screen.getByRole("button", { name: "Aprovar Lote" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reprovar Lote" })).toBeEnabled();
  });

  it("bloqueia a decisão quando o resumo de NQA falha", async () => {
    const user = userEvent.setup();
    renderTable(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "Falha sintética" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Decidir Lote" }));

    expect(
      await screen.findByText(
        "Não foi possível carregar o resumo de NQA. Tente novamente antes de decidir.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Aprovar Lote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reprovar Lote" })).toBeDisabled();
  });
});
