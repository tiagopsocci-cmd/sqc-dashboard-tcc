import { expect, test } from "@playwright/test";

import { routes, synthetic } from "./contracts.js";
import { expectNoLoginRedirect } from "./helpers.js";

test("@smoke abre sem login e redireciona para o painel", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sqc(?:[/?#]|$)/);
  await expectNoLoginRedirect(page);
  await expect(
    page.getByRole("heading", { name: /SQC|controle estatístico/i }).first(),
  ).toBeVisible();
});

for (const [name, path, heading] of [
  ["painel", routes.dashboard, /SQC|controle estatístico|análise/i],
  ["importação", routes.import, /import/i],
  ["engenharia", routes.engineering, /engenharia/i],
  ["instrumentos", routes.instruments, /instrumentos/i],
] as const) {
  test(`@routes abre rota de ${name}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.ok(), `${path} deve ser servido pelo proxy com fallback SPA`).toBeTruthy();
    await expectNoLoginRedirect(page);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  });
}

test("@seed mostra conteúdo inequivocamente sintético", async ({ page }) => {
  await page.goto(routes.dashboard);
  const part = page.getByLabel(/peça/i).first();
  await expect(part).toBeVisible();
  await expect(
    part.locator("option").filter({ hasText: synthetic.partPattern }).first(),
  ).toBeAttached();

  const response = await page.request.get("/api/sqc/parts");
  expect(response.ok()).toBeTruthy();
  const parts = (await response.json()) as Array<{ part_code: string; description: string }>;
  expect(parts.length).toBeGreaterThan(0);
  expect(
    parts.some((item) => synthetic.partPattern.test(`${item.part_code} ${item.description}`)),
  ).toBe(true);
});
