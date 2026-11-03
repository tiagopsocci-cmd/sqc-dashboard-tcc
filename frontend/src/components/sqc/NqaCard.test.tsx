import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NqaCard } from "@/components/sqc/NqaCard";

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe("NqaCard", () => {
  it("consulta e apresenta o NQA da cavidade selecionada", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            batch_size: 120,
            inspection_level: "II",
            aql: 0.4,
            letter: "F",
            required_sample_size: 10,
            acceptance_number: 0,
            rejection_number: 1,
            inspected: 6,
            non_conforming: 0,
            status: "AMOSTRA_INSUFICIENTE",
            achieved_aql: null,
            non_evaluable_count: 0,
            diagnostic_incomplete_count: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<NqaCard batchId="batch-1" dimId="dim-1" cavity={3} />, { wrapper });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/sqc/batches/batch-1/dims/dim-1/nqa?cavity=3", {
        headers: { Accept: "application/json" },
      }),
    );
    expect(await screen.findByText("Inspecionadas:")).toBeVisible();
    expect(screen.getByText("6")).toBeVisible();
    expect(screen.getByText("Amostra requerida:")).toBeVisible();
    expect(screen.getByText("10")).toBeVisible();
  });
});
