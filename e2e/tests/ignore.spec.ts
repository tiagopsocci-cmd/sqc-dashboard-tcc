import { expect, test } from "@playwright/test";

import { createScenario, getInspections } from "./helpers.js";

const reason = "Motivo sintético exclusivo do cenário E2E";

test("@ignore desconsidera e restaura via API preservando a medição", async ({ request }) => {
  const scenario = await createScenario(request, {
    prefix: "E2E-IGNORE",
    measurements: [49.93, 50.07, 50.11],
    cavities: [1, 1, 2],
  });
  const before = await getInspections(request, scenario);
  const target = before[0];
  expect(target).toBeTruthy();

  const ignoreResponse = await request.patch(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections/${target.id}/ignore`,
    { data: { ignored: true, reason } },
  );
  expect(ignoreResponse.ok(), await ignoreResponse.text()).toBeTruthy();
  expect(await ignoreResponse.json()).toMatchObject({
    inspection_id: target.id,
    is_ignored: true,
    ignored_reason: reason,
  });

  const ignored = (await getInspections(request, scenario)).find((row) => row.id === target.id);
  expect(ignored).toMatchObject({
    measured_value: target.measured_value,
    part_number: target.part_number,
    cavity: target.cavity,
    is_ignored: true,
    ignored_reason: reason,
  });

  const restoreResponse = await request.patch(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections/${target.id}/ignore`,
    { data: { ignored: false, reason: null } },
  );
  expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy();
  expect(await restoreResponse.json()).toMatchObject({
    inspection_id: target.id,
    is_ignored: false,
    ignored_reason: null,
  });

  const restored = (await getInspections(request, scenario)).find((row) => row.id === target.id);
  expect(restored).toEqual(target);
});

test("@ignore exige motivo pela API e não altera bytes lógicos da medição", async ({ request }) => {
  const scenario = await createScenario(request, { prefix: "E2E-IGNORE-INVALID" });
  const before = await getInspections(request, scenario);
  const target = before[0];

  const response = await request.patch(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections/${target.id}/ignore`,
    { data: { ignored: true, reason: "" } },
  );
  expect(response.status()).toBe(422);
  expect(await getInspections(request, scenario)).toEqual(before);
});
