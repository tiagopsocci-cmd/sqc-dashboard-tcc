import { expect, test } from "@playwright/test";

import { routes, synthetic } from "./contracts.js";
import { createScenario, selectScenarioOnDashboard } from "./helpers.js";

test("@suppliers compara dois fornecedores sintéticos reais criados pelo cenário", async ({
  page,
}) => {
  const aurora = await createScenario(page.request, {
    prefix: "E2E-CMP-A",
    supplier: synthetic.suppliers[0],
    measurements: [49.84, 49.92, 50.0, 50.08],
    cavities: [1, 2, 1, 2],
  });
  const boreal = await createScenario(page.request, {
    prefix: "E2E-CMP-B",
    supplier: synthetic.suppliers[1],
    measurements: [50.12, 50.2, 50.28, 50.36],
    cavities: [1, 2, 1, 2],
  });
  expect(boreal.part.id).toBe(aurora.part.id);
  expect(boreal.dim.id).toBe(aurora.dim.id);
  expect(new Set([aurora.batch.supplier_id, boreal.batch.supplier_id])).toEqual(
    new Set(synthetic.suppliers),
  );

  await page.goto(routes.dashboard);
  await page.getByRole("button", { name: /comparação de lotes/i }).click();
  await selectScenarioOnDashboard(page, aurora, {
    dim: true,
    comparisonBatchIds: [aurora.batch.id, boreal.batch.id],
  });

  await expect(page).toHaveURL(new RegExp(`batches=.*${aurora.batch.id}`));
  const selectedIds = new URL(page.url()).searchParams.get("batches")?.split(",") ?? [];
  expect(new Set(selectedIds)).toEqual(new Set([aurora.batch.id, boreal.batch.id]));
  await expect(page.getByText(/m[eé]dia|desvio|Cpk|capabilidade/i).first()).toBeVisible();

  const groupedResponse = await page.request.post("/api/sqc/batches/grouped-statistics", {
    data: {
      batch_ids: [aurora.batch.id, boreal.batch.id],
      dim_id: aurora.dim.id,
      cavity: null,
    },
  });
  expect(groupedResponse.ok(), await groupedResponse.text()).toBeTruthy();
  const grouped = (await groupedResponse.json()) as {
    n: number;
    batches: Array<{ batch_id: string; tracking_code: string; n: number }>;
  };
  expect(grouped.n).toBe(8);
  expect(new Set(grouped.batches.map((batch) => batch.batch_id))).toEqual(
    new Set([aurora.batch.id, boreal.batch.id]),
  );
  expect(grouped.batches.every((batch) => batch.n === 4)).toBe(true);
});
