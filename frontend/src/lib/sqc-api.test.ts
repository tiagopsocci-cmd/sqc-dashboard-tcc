import { afterEach, describe, expect, it, vi } from "vitest";

import { sqcApi } from "@/lib/sqc-api";

afterEach(() => vi.unstubAllGlobals());

describe("sqcApi", () => {
  it("usa somente a API SQC de mesma origem, sem credenciais de autenticação", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sqcApi.listParts();

    expect(fetchMock).toHaveBeenCalledWith("/api/sqc/parts", {
      headers: { Accept: "application/json" },
    });
  });

  it("mantém mensagem útil em erro textual não JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("falha", { status: 502, statusText: "Bad Gateway" })),
    );

    await expect(sqcApi.listParts()).rejects.toEqual({
      status: 502,
      error: "Erro 502: Bad Gateway",
    });
  });

  it("normaliza detalhes estruturados de validação", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: [{ msg: "Código obrigatório" }] }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(sqcApi.listParts()).rejects.toEqual({
      status: 422,
      error: "Código obrigatório",
    });
  });

  it("propaga cavidade para NQA visual", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sqcApi.getNqa("lote", "dim", 0.5, 0.4, 2);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sqc/batches/lote/dims/dim/nqa?tol_plus_override=0.5&tol_minus_override=0.4&cavity=2",
      { headers: { Accept: "application/json" } },
    );
  });

  it("propaga cavidade para distribuição de perfil", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sqcApi.getProfileDistribution("lote", "dim", 3);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sqc/batches/lote/dims/dim/profile-distribution?cavity=3",
      { headers: { Accept: "application/json" } },
    );
  });
});
