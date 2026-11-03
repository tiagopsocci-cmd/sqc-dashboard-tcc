import { expect, test } from "@playwright/test";

import { routes } from "./contracts.js";
import { createScenario, getBatch, getInspections, selectScenarioOnDashboard } from "./helpers.js";

const tinyPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "ascii",
);

test("@decision persiste decisão e bloqueia import/ignore/restore/upload com 409", async ({
  page,
}) => {
  const scenario = await createScenario(page.request, {
    prefix: "E2E-DECISION",
    measurements: [49.88, 49.96, 50.04, 50.12],
    cavities: [1, 2, 1, 2],
  });
  const inspectionsBefore = await getInspections(page.request, scenario);
  const restoreTarget = inspectionsBefore[0];
  const ignoreTarget = inspectionsBefore[1];

  const preIgnore = await page.request.patch(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections/${restoreTarget.id}/ignore`,
    { data: { ignored: true, reason: "Preparação sintética para testar restauração bloqueada" } },
  );
  expect(preIgnore.ok(), await preIgnore.text()).toBeTruthy();

  await page.goto(routes.dashboard);
  await selectScenarioOnDashboard(page, scenario);
  await page.getByRole("button", { name: /decidir lote/i }).click();
  await expect(page.getByText(/sugest[aã]o por dimens[aã]o|NQA/i).first()).toBeVisible();

  const decisionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/sqc/batches/${scenario.batch.id}/decision`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^aprovar lote$/i }).click();
  expect((await decisionResponse).ok()).toBeTruthy();
  await expect(page.getByText(/^aprovado$/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /editar lote|decidir lote/i })).toHaveCount(0);

  await expect
    .poll(async () => (await getBatch(page.request, scenario.batch.id)).batch_status)
    .toBe("APPROVED");

  const importResponse = await page.request.post(
    `/api/sqc/batches/${scenario.batch.id}/import-measurements`,
    {
      multipart: {
        file: {
          name: `${scenario.token}-pos-decisao.csv`,
          mimeType: "text/csv",
          buffer: scenario.csvBytes,
        },
      },
    },
  );
  expect(importResponse.status()).toBe(409);

  const ignoreResponse = await page.request.patch(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections/${ignoreTarget.id}/ignore`,
    { data: { ignored: true, reason: "Tentativa sintética pós-decisão" } },
  );
  expect(ignoreResponse.status()).toBe(409);

  const restoreResponse = await page.request.patch(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections/${restoreTarget.id}/ignore`,
    { data: { ignored: false, reason: null } },
  );
  expect(restoreResponse.status()).toBe(409);

  const uploadResponse = await page.request.post(
    `/api/sqc/batches/${scenario.batch.id}/reports/upload`,
    {
      multipart: {
        files: {
          name: `Part ${scenario.partNumbers[0]}.pdf`,
          mimeType: "application/pdf",
          buffer: tinyPdf,
        },
      },
    },
  );
  expect(uploadResponse.status()).toBe(409);

  const after = await getInspections(page.request, scenario);
  const restoredStillIgnored = after.find((row) => row.id === restoreTarget.id);
  const ignoredStillActive = after.find((row) => row.id === ignoreTarget.id);
  expect(restoredStillIgnored).toMatchObject({
    measured_value: restoreTarget.measured_value,
    part_number: restoreTarget.part_number,
    is_ignored: true,
  });
  expect(ignoredStillActive).toEqual(ignoreTarget);

  const reports = await page.request.get(`/api/sqc/batches/${scenario.batch.id}/reports`);
  expect(reports.ok()).toBeTruthy();
  expect(await reports.json()).toEqual([]);
});
