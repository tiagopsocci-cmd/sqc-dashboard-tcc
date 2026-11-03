import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailsTable } from "@/components/sqc/DetailsTable";
import type {
  DimRead,
  InspectionRow,
  InspectionsDetailResponse,
  StatisticsResponse,
} from "@/lib/sqc-api";

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

const baseRow: InspectionRow = {
  id: "inspection-1",
  part_number: 1,
  cavity: 2,
  operator: "Operador sintético",
  date_time: "2026-10-28T12:00:00Z",
  instrument: "synthetic-gauge",
  measured_value: 10.05,
  deviation: 0.05,
  tolerance_used_pct: 25,
  bonus: 0,
  point_max: null,
  point_min: null,
  coord_x: null,
  coord_y: null,
  coord_z: null,
  uncertainty: null,
  uncertainty_zone: null,
  zone_geometry: null,
  directions: null,
  consolidated_utilization: null,
  critical_axis: null,
  conforming: true,
  is_ignored: false,
  ignored_reason: null,
  is_outlier_suggested: false,
  outlier_reason: null,
};

const emptyStatistics: StatisticsResponse = {
  batch_id: "batch-1",
  dim_id: "dim-1",
  n: 1,
  is_unilateral: false,
  usl: 10.2,
  lsl: 9.8,
  nominal: 10,
  mean: 10.05,
  std_sample: null,
  std_global: null,
  max: 10.05,
  min: 10.05,
  range: 0,
  cp: null,
  cpk: null,
  pp: null,
  ppk: null,
  cpu: null,
  cpl: null,
  ppu: null,
  ppl: null,
  insufficient_sample: true,
  degenerate: false,
  dppm: null,
  k_index: null,
  cpm: null,
  mean_tolerance_pct: 25,
  std_tolerance_pct: null,
  has_bonus: false,
  bonus_missing_rel: false,
  tolerance_overridden: false,
  n_uncertainty_at_risk: 0,
  n_uncertainty_recoverable: 0,
  critical_axis: null,
  non_evaluable_count: 0,
  capability_direction_1: null,
  capability_direction_2: null,
  capability_methodology: "raw_measurements",
  capability_basis: {
    methodology: "raw_measurements",
    n: 1,
    usl: 10.2,
    lsl: 9.8,
    nominal: 10,
    mean: 10.05,
    std_short: null,
    std_long: null,
  },
};

function response(row: InspectionRow = baseRow): InspectionsDetailResponse {
  return {
    dim_code: dim.dim_code,
    dim_name: dim.dim_name,
    has_children: false,
    rows: [row],
  };
}

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  client.setQueryData(["instruments"], []);
  client.setQueryData(["sqc", "capability-thresholds"], {
    default_minimum: 1.33,
    warning_minimum: 1,
    tolerance_warning_pct: 75,
    tolerance_limit_pct: 100,
    dppm_good_max: 64,
    dppm_warning_max: 6210,
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe("DetailsTable", () => {
  it("permite desconsiderar uma medição em lote editável", async () => {
    const user = userEvent.setup();
    const onInspectionIgnoreChange = vi.fn();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            is_ignored: true,
            ignored_reason: "Medição sintética inválida",
            statistics: emptyStatistics,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DetailsTable
        data={response()}
        dim={dim}
        batchId="batch-1"
        dimId={dim.id}
        editable
        onInspectionIgnoreChange={onInspectionIgnoreChange}
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Desconsiderar" }));
    await user.type(
      screen.getByPlaceholderText("Motivo da desconsideração"),
      "Medição sintética inválida",
    );
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sqc/batches/batch-1/dims/dim-1/inspections/inspection-1/ignore",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ ignored: true, reason: "Medição sintética inválida" }),
      }),
    );
    expect(await screen.findByRole("button", { name: "Desconsiderada — restaurar" })).toBeVisible();
    expect(onInspectionIgnoreChange).toHaveBeenCalledWith(emptyStatistics);
  });

  it("mantém a situação auditável, mas sem ações, em lote somente leitura", () => {
    render(
      <DetailsTable
        data={response({
          ...baseRow,
          is_ignored: true,
          ignored_reason: "Medição sintética inválida",
        })}
        dim={dim}
        batchId="batch-1"
        dimId={dim.id}
        editable={false}
      />,
      { wrapper },
    );

    expect(screen.getByRole("columnheader", { name: /Situação/ })).toBeVisible();
    expect(screen.getByText("Desconsiderada")).toHaveAttribute(
      "title",
      "Medição sintética inválida",
    );
    expect(
      screen.queryByRole("button", { name: /Desconsiderar|restaurar/ }),
    ).not.toBeInTheDocument();
  });

  it("exibe a coluna PDF mesmo quando nenhum relatório está disponível", () => {
    render(
      <DetailsTable data={response()} dim={dim} reportParts={new Set()} onOpenReport={vi.fn()} />,
      { wrapper },
    );

    expect(screen.getByRole("columnheader", { name: /PDF/ })).toBeVisible();
    const unavailableReport = screen.getByTitle("Relatório não disponível");
    expect(unavailableReport).toBeVisible();
    expect(unavailableReport.closest("button")).toBeNull();
  });
});
