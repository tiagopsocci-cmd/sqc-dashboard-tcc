import { expect, test } from "@playwright/test";

const parts = [
  {
    id: "part-aurora",
    part_code: "PA-100",
    description: "Componente Aurora",
    material: null,
    process: null,
  },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/sqc/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/sqc/parts" ? parts : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});

test("navega pelas quatro rotas do frontend", async ({ page }) => {
  await page.goto("/sqc");
  await expect(
    page.getByText("Painel de Controle Estatístico da Qualidade", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Controle Estatístico da Qualidade" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Importação" }).click();
  await expect(page).toHaveURL(/\/sqc\/import$/);
  await expect(page.getByRole("heading", { name: "Importar Lote" })).toBeVisible();

  await page.getByRole("link", { name: "Engenharia" }).click();
  await expect(page).toHaveURL(/\/sqc\/engenharia$/);
  await expect(page.getByRole("heading", { name: "Gestão de Engenharia" })).toBeVisible();

  await page.getByRole("link", { name: "Instrumentos" }).click();
  await expect(page).toHaveURL(/\/sqc\/instruments$/);
  await expect(page.getByRole("heading", { name: "Instrumentos de Medição" })).toBeVisible();
});

test("mantém seleção multi-lote na URL", async ({ page }) => {
  await page.goto(
    "/sqc?mode=multi&part=part-aurora&batches=lote-aurora,lote-boreal&dim=dim-01&tab=trend&cavity=2",
  );
  await expect(page.getByRole("button", { name: "Comparação de Lotes" })).toBeVisible();
  await expect(page).toHaveURL(/mode=multi/);
  await expect(page).toHaveURL(/batches=lote-aurora%2Clote-boreal|batches=lote-aurora,lote-boreal/);
  await expect(page).toHaveURL(/cavity=2/);
});
