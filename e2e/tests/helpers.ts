import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Locator, type Page, expect } from "@playwright/test";

import {
  type BatchRecord,
  type DimRecord,
  type ImportResult,
  type InspectionRecord,
  type InspectionsResponse,
  type PartRecord,
  getSyntheticDim,
  getSyntheticPart,
  synthetic,
} from "./contracts.js";

export interface Scenario {
  token: string;
  part: PartRecord;
  dim: DimRecord;
  batch: BatchRecord;
  csv: string;
  csvBytes: Buffer;
  partNumbers: number[];
  cavities: number[];
}

interface CreateScenarioOptions {
  prefix: string;
  supplier?: string;
  measurements?: number[];
  cavities?: number[];
  importMeasurements?: boolean;
}

let sequence = 0;

function uniqueToken(prefix: string): string {
  sequence += 1;
  const worker = process.env.TEST_WORKER_INDEX ?? "0";
  return `${prefix}-${Date.now().toString(36)}-${worker}-${sequence}-${randomUUID().slice(0, 6)}`
    .replace(/[^A-Za-z0-9-]/g, "-")
    .slice(0, 46);
}

function uniquePartNumbers(count: number): number[] {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0);
  const base = 10_000_000 + (Date.now() % 10_000_000) * 10 + worker * 1_000 + sequence * 10;
  return Array.from({ length: count }, (_, index) => base + index);
}

function measurementCsv(
  dimCode: string,
  partNumbers: number[],
  measurements: number[],
  cavities: number[],
  token: string,
): string {
  const header = `part,operator,instrument,measurement date,cavity,${dimCode}`;
  const rows = partNumbers.map(
    (partNumber, index) =>
      `${partNumber},Operador E2E,CMM-DEMO,2026-10-28 10:${String(index).padStart(2, "0")}:00,${cavities[index]},${measurements[index]}`,
  );
  return [header, ...rows].join("\n");
}

export async function createScenario(
  request: APIRequestContext,
  options: CreateScenarioOptions,
): Promise<Scenario> {
  const token = uniqueToken(options.prefix);
  const part = await getSyntheticPart(request);
  const dim = await getSyntheticDim(request, part.id);
  const measurements = options.measurements ?? [49.91, 49.97, 50.03, 50.09];
  const cavities = options.cavities ?? measurements.map((_, index) => (index % 2) + 1);
  expect(cavities).toHaveLength(measurements.length);
  const partNumbers = uniquePartNumbers(measurements.length);
  const csv = measurementCsv(dim.dim_code, partNumbers, measurements, cavities, token);
  const csvBytes = Buffer.from(csv, "utf8");

  const createResponse = await request.post("/api/sqc/batches", {
    data: {
      tracking_code: token,
      part_id: part.id,
      supplier_id: options.supplier ?? `Fornecedor ${token}`,
      project_status: "IE",
      batch_size: Math.max(20, measurements.length),
      inspection_level: "I",
      aql: 2.5,
    },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const batch = (await createResponse.json()) as BatchRecord;

  if (options.importMeasurements !== false) {
    const result = await importCsv(request, batch.id, csvBytes, `${token}.csv`);
    expect(result.imported).toBe(measurements.length);
    expect(result.rejected).toBe(0);
  }

  return { token, part, dim, batch, csv, csvBytes, partNumbers, cavities };
}

export async function importCsv(
  request: APIRequestContext,
  batchId: string,
  bytes: Buffer,
  name: string,
): Promise<ImportResult> {
  const response = await request.post(`/api/sqc/batches/${batchId}/import-measurements`, {
    multipart: { file: { name, mimeType: "text/csv", buffer: bytes } },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as ImportResult;
}

export async function listBatches(
  request: APIRequestContext,
  partId?: string,
): Promise<BatchRecord[]> {
  const response = await request.get(
    partId ? `/api/sqc/batches?part_id=${encodeURIComponent(partId)}` : "/api/sqc/batches",
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as BatchRecord[];
}

export async function getBatch(request: APIRequestContext, batchId: string): Promise<BatchRecord> {
  const batches = await listBatches(request);
  const batch = batches.find((item) => item.id === batchId);
  expect(batch, `lote sintético ${batchId} deve continuar persistido`).toBeTruthy();
  return batch as BatchRecord;
}

export async function getInspections(
  request: APIRequestContext,
  scenario: Pick<Scenario, "batch" | "dim">,
  cavity?: number,
): Promise<InspectionRecord[]> {
  const query = new URLSearchParams({ include_children: "false" });
  if (cavity !== undefined) query.set("cavity", String(cavity));
  const response = await request.get(
    `/api/sqc/batches/${scenario.batch.id}/dims/${scenario.dim.id}/inspections?${query}`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as InspectionsResponse).rows;
}

export async function chooseFirstOption(locator: Locator, preferred?: RegExp): Promise<void> {
  await expect(locator).toBeVisible();
  if (preferred) {
    const options = locator.locator("option").filter({ hasText: preferred });
    expect(
      await options.count(),
      "a opção sintética esperada deve estar disponível",
    ).toBeGreaterThan(0);
    await locator.selectOption(await options.first().getAttribute("value"));
    return;
  }

  const options = await locator.locator("option").allTextContents();
  const usable = options.findIndex((text, optionIndex) => optionIndex > 0 && text.trim());
  expect(usable, "deve existir ao menos uma opção selecionável").toBeGreaterThan(0);
  await locator.selectOption({ index: usable });
}

export async function selectScenarioOnDashboard(
  page: Page,
  scenario: Scenario,
  options: { dim?: boolean; comparisonBatchIds?: string[] } = {},
): Promise<void> {
  const part = page.getByLabel(/peça/i).first();
  await chooseFirstOption(part, new RegExp(scenario.part.part_code, "i"));

  if (options.comparisonBatchIds) {
    const batches = page.getByRole("button", { name: /^lotes$/i }).first();
    await batches.click();
    for (const batchId of options.comparisonBatchIds) {
      await page.locator(`#batch-check-${batchId}`).check();
    }
    await batches.click();
  } else {
    const batch = page.getByRole("button", { name: /^lote$/i }).first();
    await batch.click();
    await page.getByRole("button", { name: new RegExp(scenario.token, "i") }).click();
  }

  if (options.dim) {
    await page.getByLabel(/dimens[aã]o/i).selectOption(scenario.dim.id);
  }
}

export async function expectNoLoginRedirect(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/(?:login|sign-in|oauth|callback)/i);
  await expect(page.getByRole("button", { name: /entrar|login|acessar com/i })).toHaveCount(0);
}

export function supplierName(suffix: string): string {
  const supplier = synthetic.suppliers.find((name) => name === suffix);
  return supplier ?? suffix;
}
