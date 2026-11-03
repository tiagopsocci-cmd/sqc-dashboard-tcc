import type { APIRequestContext, Locator, Page } from "@playwright/test";

export const routes = {
  dashboard: "/sqc",
  import: "/sqc/import",
  engineering: "/sqc/engenharia",
  instruments: "/sqc/instruments",
} as const;

export const synthetic = {
  partPattern: /DEMO[- _]/i,
  supplierPattern: /Aurora|Boreal/i,
  suppliers: ["Aurora", "Boreal"] as const,
  partCode: "DEMO-AURORA-100",
  dimensionCode: "D-BIL",
} as const;

export interface PartRecord {
  id: string;
  part_code: string;
  description: string;
}

export interface DimRecord {
  id: string;
  dim_code: string;
  nominal: number;
}

export interface BatchRecord {
  id: string;
  tracking_code: string;
  part_id: string;
  supplier_id: string;
  project_status: "EVB" | "PVB" | "IE";
  batch_status: "APPROVED" | "IN_ANALYSIS" | "REJECTED";
  inspection_count: number;
}

export interface InspectionRecord {
  id: string;
  part_number: number;
  cavity: number | null;
  measured_value: number;
  is_ignored: boolean;
  ignored_reason: string | null;
}

export interface InspectionsResponse {
  rows: InspectionRecord[];
}

export interface ImportResult {
  imported: number;
  rejected: number;
  errors: Array<{ reason: string }>;
}

export function byTestIdOrRole(
  page: Page,
  testId: string,
  role: "button" | "link" | "heading" | "tab" | "row",
  name: RegExp,
): Locator {
  return page.getByTestId(testId).or(page.getByRole(role, { name })).first();
}

export function fieldByLabel(page: Page, label: RegExp, testId: string): Locator {
  return page.getByTestId(testId).or(page.getByLabel(label)).first();
}

export function visibleText(page: Page, pattern: RegExp): Locator {
  return page.getByText(pattern).filter({ visible: true }).first();
}

export async function getSyntheticPart(request: APIRequestContext): Promise<PartRecord> {
  const response = await request.get("/api/sqc/parts");
  if (!response.ok())
    throw new Error(`Falha ao listar peças sintéticas: HTTP ${response.status()}`);
  const parts = (await response.json()) as PartRecord[];
  const part = parts.find((item) => item.part_code === synthetic.partCode);
  if (!part) throw new Error(`Peça sintética ${synthetic.partCode} não encontrada`);
  return part;
}

export async function getSyntheticDim(
  request: APIRequestContext,
  partId: string,
  dimCode = synthetic.dimensionCode,
): Promise<DimRecord> {
  const response = await request.get(`/api/sqc/parts/${partId}/dims`);
  if (!response.ok())
    throw new Error(`Falha ao listar dimensões sintéticas: HTTP ${response.status()}`);
  const dims = (await response.json()) as DimRecord[];
  const dim = dims.find((item) => item.dim_code === dimCode);
  if (!dim) throw new Error(`Dimensão sintética ${dimCode} não encontrada`);
  return dim;
}
