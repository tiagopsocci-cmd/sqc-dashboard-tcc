import { type Page, expect, test } from "@playwright/test";

import { routes } from "./contracts.js";
import { createScenario, getInspections } from "./helpers.js";

async function prepareExistingBatch(
  page: Page,
  scenario: Awaited<ReturnType<typeof createScenario>>,
) {
  await page.goto(routes.import);
  await page.getByRole("button", { name: /adicionar a lote existente/i }).click();
  await page.getByLabel(/peça/i).first().selectOption(scenario.part.id);
  const batchOption = page.locator(`option[value="${scenario.batch.id}"]`);
  await expect(batchOption).toBeAttached();
  await batchOption.locator("..").selectOption(scenario.batch.id);
  await page.getByRole("button", { name: /continuar para upload/i }).click();
}

async function uploadCsv(page: Page, name: string, body: Buffer | string) {
  const input = page.locator('input[type="file"][accept*=".csv"]');
  await input.setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: typeof body === "string" ? Buffer.from(body, "utf8") : body,
  });
}

test("@import importa bytes exclusivos pela UI e mantém retry idempotente", async ({ page }) => {
  const scenario = await createScenario(page.request, {
    prefix: "E2E-IMPORT",
    importMeasurements: false,
    measurements: [49.9, 50.0, 50.1],
    cavities: [1, 2, 1],
  });
  await prepareExistingBatch(page, scenario);

  await uploadCsv(page, `${scenario.token}.csv`, scenario.csvBytes);
  await page.getByRole("button", { name: /visualizar preview/i }).click();
  await expect(page.getByText(scenario.dim.dim_code, { exact: false }).first()).toBeVisible();

  const confirm = page.getByRole("button", { name: /confirmar importa[cç][aã]o/i });
  await expect(confirm).toBeEnabled();
  const firstImportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/import-measurements") && response.request().method() === "POST",
  );
  await confirm.click();
  const importedResponse = await firstImportResponse;
  expect(importedResponse.ok(), await importedResponse.text()).toBeTruthy();
  expect(await importedResponse.json()).toMatchObject({ imported: 3, rejected: 0 });

  const persistedBeforeRetry = await getInspections(page.request, scenario);
  expect(persistedBeforeRetry.map((row) => row.part_number).sort()).toEqual(
    [...scenario.partNumbers].sort(),
  );

  const retry = await page.request.post(
    `/api/sqc/batches/${scenario.batch.id}/import-measurements`,
    {
      multipart: {
        file: {
          name: `${scenario.token}-retry.csv`,
          mimeType: "text/csv",
          buffer: scenario.csvBytes,
        },
      },
    },
  );
  expect(retry.status()).toBe(409);
  const duplicate = (await retry.json()) as {
    detail: { message: string; errors: Array<{ reason: string }> };
  };
  expect(duplicate.detail.message).toMatch(/já importado/i);
  expect(duplicate.detail.errors).toHaveLength(3);

  const persistedAfterRetry = await getInspections(page.request, scenario);
  expect(persistedAfterRetry).toEqual(persistedBeforeRetry);
});

test("@import informa erro de conteúdo exclusivo inválido sem sucesso falso", async ({ page }) => {
  const scenario = await createScenario(page.request, {
    prefix: "E2E-INVALID",
    importMeasurements: false,
  });
  await prepareExistingBatch(page, scenario);
  const invalidCsv = [
    `part,operator,instrument,measurement date,cavity,${scenario.dim.dim_code}`,
    `${scenario.partNumbers[0]},Operador E2E,CMM-DEMO,2026-10-28 11:00:00,1,valor-invalido`,
  ].join("\n");

  await uploadCsv(page, `${scenario.token}-invalido.csv`, invalidCsv);
  await page.getByRole("button", { name: /visualizar preview/i }).click();

  await expect(page.getByText(/erro|inv[aá]lid|rejeitad/i).first()).toBeVisible();
  await expect(page.getByText(/importa[cç][aã]o conclu[ií]da/i)).toHaveCount(0);
  expect(await getInspections(page.request, scenario)).toHaveLength(0);
});
