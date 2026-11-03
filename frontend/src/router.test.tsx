import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="grafico" />,
}));

import { createAppRouter } from "@/router";

const parts = [
  {
    id: "part-aurora",
    part_code: "PA-100",
    description: "Componente de teste",
    material: null,
    process: null,
  },
];

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function apiResponse(url: string, method = "GET") {
  if (url === "/api/sqc/parts") return json(parts);
  if (url === "/api/sqc/instruments") return json([]);
  if (url.startsWith("/api/sqc/batches")) return json([]);
  if (url.startsWith("/api/sqc/parts/part-aurora/dims")) return json([]);
  if (method !== "GET") return json({}, { status: 201 });
  return json([]);
}

async function renderRoute(path: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    apiResponse(String(input), init?.method),
  );
  vi.stubGlobal("fetch", fetchMock);

  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  await act(async () => {
    await router.load();
  });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, fetchMock, client, router };
}

afterEach(() => vi.unstubAllGlobals());

describe("shell e rotas SQC", () => {
  it("renderiza o shell neutro e as quatro rotas fixas", async () => {
    await renderRoute("/sqc");

    expect(
      await screen.findByText("Painel de Controle Estatístico da Qualidade", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Painel SQC/ })).toHaveAttribute("href", "/sqc");
    expect(screen.getByRole("link", { name: /Importação/ })).toHaveAttribute("href", "/sqc/import");
    expect(screen.getByRole("link", { name: /Engenharia/ })).toHaveAttribute(
      "href",
      "/sqc/engenharia",
    );
    expect(screen.getByRole("link", { name: /Instrumentos/ })).toHaveAttribute(
      "href",
      "/sqc/instruments",
    );
  });

  it.each([
    ["/sqc/import", "Importar Lote"],
    ["/sqc/engenharia", "Gestão de Engenharia"],
    ["/sqc/instruments", "Instrumentos de Medição"],
  ])("abre %s sem guarda de autenticação", async (path, heading) => {
    await renderRoute(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("preserva o estado do dashboard na URL", async () => {
    const path =
      "/sqc?mode=multi&part=part-aurora&batches=lote-aurora,lote-boreal&dim=dim-01&tab=trend&cavity=2";
    const { router } = await renderRoute(path);

    expect(router.state.location.search).toMatchObject({
      mode: "multi",
      part: "part-aurora",
      batches: "lote-aurora,lote-boreal",
      dim: "dim-01",
      tab: "trend",
      cavity: 2,
    });
    expect(await screen.findByRole("button", { name: "Comparação de Lotes" })).toBeInTheDocument();
  });
});
