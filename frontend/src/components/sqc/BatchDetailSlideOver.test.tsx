import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="plot" />,
}));

import { BatchDetailSlideOver } from "@/components/sqc/BatchDetailSlideOver";
import type { DimRead } from "@/lib/sqc-api";

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

const inspection = {
  id: "inspection-1",
  part_number: 1,
  cavity: 2,
  operator: "Operador sintético",
  date_time: "2026-10-28T12:00:00Z",
  instrument: null,
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

function batch(status: "IN_ANALYSIS" | "APPROVED") {
  return {
    id: "batch-1",
    tracking_code: "LOTE-SINTETICO-01",
    part_id: "part-1",
    supplier_id: "supplier-1",
    project_status: "IE",
    batch_status: status,
    rejection_justification: null,
    batch_size: 100,
    inspection_level: "II",
    aql: 0.4,
    inspection_count: 1,
  };
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function apiResponse(url: string, status: "IN_ANALYSIS" | "APPROVED") {
  if (url === "/api/sqc/batches/batch-1/cavities") return json([1, 2]);
  if (url === "/api/sqc/batches?part_id=part-1") return json([batch(status)]);
  if (url === "/api/sqc/instruments") return json([]);
  if (url === "/api/sqc/capability-thresholds") {
    return json({
      default_minimum: 1.33,
      warning_minimum: 1,
      tolerance_warning_pct: 75,
      tolerance_limit_pct: 100,
      dppm_good_max: 64,
      dppm_warning_max: 6210,
    });
  }
  if (url === "/api/sqc/batches/batch-1/reports") return json([]);
  if (url.startsWith("/api/sqc/batches/batch-1/dims/dim-1/inspections")) {
    return json({
      dim_code: dim.dim_code,
      dim_name: dim.dim_name,
      has_children: false,
      rows: [inspection],
    });
  }
  if (url.startsWith("/api/sqc/batches/batch-1/dims/dim-1/statistics")) {
    return json({
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
    });
  }
  if (url.startsWith("/api/sqc/batches/batch-1/dims/dim-1/nqa")) {
    return json({
      batch_size: 100,
      inspection_level: "II",
      aql: 0.4,
      letter: "F",
      required_sample_size: 10,
      acceptance_number: 0,
      rejection_number: 1,
      inspected: 1,
      non_conforming: 0,
      status: "AMOSTRA_INSUFICIENTE",
      achieved_aql: null,
      non_evaluable_count: 0,
      diagnostic_incomplete_count: 0,
    });
  }
  return json([]);
}

function renderSlideOver(status: "IN_ANALYSIS" | "APPROVED") {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => apiResponse(String(input), status));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  function wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return {
    fetchMock,
    ...render(
      <BatchDetailSlideOver
        batchId="batch-1"
        partId="part-1"
        dimId="dim-1"
        dim={dim}
        trackingCode="LOTE-SINTETICO-01"
        onClose={vi.fn()}
      />,
      { wrapper },
    ),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("BatchDetailSlideOver", () => {
  it("propaga a cavidade selecionada para estatísticas e NQA", async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderSlideOver("IN_ANALYSIS");

    await user.click(await screen.findByRole("button", { name: "Cav. 2" }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls).toContain("/api/sqc/batches/batch-1/dims/dim-1/statistics?cavity=2");
      expect(urls).toContain("/api/sqc/batches/batch-1/dims/dim-1/nqa?cavity=2");
    });
  });

  it.each([
    ["IN_ANALYSIS", true],
    ["APPROVED", false],
  ] as const)("respeita edição de medições para lote %s", async (status, editable) => {
    const user = userEvent.setup();
    renderSlideOver(status);

    await user.click(screen.getByRole("button", { name: "Detalhes" }));
    const table = await screen.findByRole("table");

    if (editable) {
      expect(within(table).getByRole("button", { name: "Desconsiderar" })).toBeVisible();
      expect(within(table).getByRole("columnheader", { name: /Desconsiderar/ })).toBeVisible();
    } else {
      expect(within(table).getByRole("columnheader", { name: /Situação/ })).toBeVisible();
      expect(within(table).getByText("Válida")).toBeVisible();
      expect(
        within(table).queryByRole("button", { name: "Desconsiderar" }),
      ).not.toBeInTheDocument();
    }
  });

  it("mantém a coluna de relatórios quando a lista do lote está vazia", async () => {
    const user = userEvent.setup();
    renderSlideOver("APPROVED");

    await user.click(screen.getByRole("button", { name: "Detalhes" }));

    await waitFor(() => {
      expect(screen.getByTitle("Relatório não disponível")).toBeVisible();
    });
    expect(screen.getByRole("columnheader", { name: /PDF/ })).toBeVisible();
  });
});
