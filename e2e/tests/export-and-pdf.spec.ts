import { expect, test } from "@playwright/test";

import { routes } from "./contracts.js";
import { createScenario, getInspections, selectScenarioOnDashboard } from "./helpers.js";

const syntheticPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n% synthetic e2e report\n%%EOF\n",
  "ascii",
);

test("@cavity filtra estado sintético na UI e na API", async ({ page }) => {
  const scenario = await createScenario(page.request, {
    prefix: "E2E-CAVITY",
    measurements: [49.81, 49.91, 50.11, 50.21],
    cavities: [1, 1, 2, 2],
  });
  await page.goto(routes.dashboard);
  await selectScenarioOnDashboard(page, scenario, { dim: true });

  const details = page.getByRole("button", { name: /detalhes/i }).first();
  await details.click();
  const cavityTwoResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections`) &&
      new URL(response.url()).searchParams.get("cavity") === "2",
  );
  await page.getByRole("button", { name: /^cav\. 2$/i }).click();
  expect((await cavityTwoResponse).ok()).toBeTruthy();
  await expect(page).toHaveURL(/cavity=2/);

  for (const partNumber of scenario.partNumbers.slice(0, 2)) {
    await expect(page.getByText(String(partNumber), { exact: true })).toHaveCount(0);
  }
  for (const partNumber of scenario.partNumbers.slice(2)) {
    await expect(page.getByText(String(partNumber), { exact: true }).first()).toBeVisible();
  }

  const filtered = await getInspections(page.request, scenario, 2);
  expect(filtered.map((row) => row.part_number).sort()).toEqual(
    scenario.partNumbers.slice(2).sort(),
  );
  expect(filtered.every((row) => row.cavity === 2)).toBe(true);
});

test("@export baixa somente os bytes sintéticos filtrados em CSV", async ({ page }) => {
  const scenario = await createScenario(page.request, {
    prefix: "E2E-EXPORT",
    measurements: [49.82, 49.94, 50.06, 50.18],
    cavities: [1, 1, 2, 2],
  });
  await page.goto(routes.dashboard);
  await selectScenarioOnDashboard(page, scenario, { dim: true });
  await page
    .getByRole("button", { name: /detalhes/i })
    .first()
    .click();
  await page.getByRole("button", { name: /^cav\. 2$/i }).click();

  let exportPayload: {
    batch_ids: string[];
    dim_id: string;
    cavity: number | null;
    format: string;
  } | null = null;
  const exportResponse = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/sqc/batches/export-measurements") ||
      response.request().method() !== "POST"
    ) {
      return false;
    }
    exportPayload = response.request().postDataJSON();
    return true;
  });
  await page.getByRole("button", { name: /^exportar(?: \(\d+ lotes\))?$/i }).click();
  expect((await exportResponse).ok()).toBeTruthy();
  expect(exportPayload).toEqual({
    batch_ids: [scenario.batch.id],
    dim_id: scenario.dim.id,
    cavity: 2,
    format: "csv",
  });

  const directResponse = await page.request.post("/api/sqc/batches/export-measurements", {
    data: exportPayload,
  });
  expect(directResponse.ok(), await directResponse.text()).toBeTruthy();
  expect(directResponse.headers()["content-type"]).toContain("text/csv");
  expect(directResponse.headers()["content-disposition"]).toMatch(
    /attachment; filename="sqc_.+\.csv"/i,
  );
  const csv = (await directResponse.body()).toString("utf8");
  expect(csv).toMatch(/batch_tracking_code/i);
  expect(csv).toMatch(/measured_value/i);
  expect(csv).toContain(scenario.token);
  for (const partNumber of scenario.partNumbers.slice(2)) expect(csv).toContain(String(partNumber));
  for (const partNumber of scenario.partNumbers.slice(0, 2))
    expect(csv).not.toContain(String(partNumber));
});

test("@pdf faz upload e preserva bytes do relatório sintético", async ({ page }) => {
  const scenario = await createScenario(page.request, {
    prefix: "E2E-PDF",
    measurements: [49.9, 50.0, 50.1],
    cavities: [1, 1, 1],
  });
  const partNumber = scenario.partNumbers[0];
  const upload = await page.request.post(`/api/sqc/batches/${scenario.batch.id}/reports/upload`, {
    multipart: {
      files: {
        name: `Part ${partNumber}.pdf`,
        mimeType: "application/pdf",
        buffer: syntheticPdf,
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  expect(await upload.json()).toEqual({ saved: [partNumber], errors: [] });

  await page.goto(routes.dashboard);
  await selectScenarioOnDashboard(page, scenario, { dim: true });
  await page
    .getByRole("button", { name: /detalhes/i })
    .first()
    .click();
  const openPdf = page
    .getByTestId("open-report-pdf")
    .or(page.getByRole("button", { name: /ver relat[oó]rio PolyWorks/i }))
    .first();
  await expect(openPdf).toBeVisible();
  await openPdf.click();

  const frame = page.locator('iframe[title*="Relatório" i], embed[type="application/pdf"]').first();
  await expect(frame).toBeVisible();
  const src = await frame.getAttribute("src");
  expect(src).toContain(`/api/sqc/batches/${scenario.batch.id}/reports/${partNumber}`);

  const response = await page.request.get(src ?? "");
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(await response.body()).toEqual(syntheticPdf);
});
