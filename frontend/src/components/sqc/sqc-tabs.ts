import type { DimRead } from "@/lib/sqc-api";

// Tab ids shared by SQCDashboard (single-batch) and BatchDetailSlideOver.
export type SingleTabId =
  | "stats"
  | "charts"
  | "distribution"
  | "details"
  | "profile"
  | "rectangle_zone"
  | "cavity_compare";

export type MultiTabId =
  | "trend"
  | "xbar"
  | "dist_compare"
  | "capability_compare"
  | "grouped_stats"
  | "profile_trend";

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

const BASE_SINGLE_TABS: TabDef<SingleTabId>[] = [
  { id: "stats", label: "Capabilidade" },
  { id: "charts", label: "Carta de Controle" },
  { id: "distribution", label: "Distribuição" },
  { id: "details", label: "Detalhes" },
];

const BASE_MULTI_TABS: TabDef<MultiTabId>[] = [
  { id: "trend", label: "Tendência" },
  { id: "xbar", label: "Carta X-bar" },
  { id: "dist_compare", label: "Distribuição" },
  { id: "capability_compare", label: "Capabilidade por Lote" },
  { id: "grouped_stats", label: "Capabilidade Agrupada" },
];

export function isRectanglePosition(dim: DimRead | null | undefined): boolean {
  return dim?.type === "POSITION" && dim?.zone_geometry === "RECTANGLE";
}

export function hasCoordChildren(dim: DimRead | null | undefined): boolean {
  const childCodes = (dim?.children ?? []).map((c) => c.dim_code.toUpperCase());
  return childCodes.some((c) => c.endsWith("_X") || c.endsWith("_Y") || c.endsWith("_Z"));
}

export function hasProfileChildren(dim: DimRead | null | undefined): boolean {
  const childCodes = (dim?.children ?? []).map((c) => c.dim_code.toUpperCase());
  return childCodes.some((c) => c.endsWith("_MAX") || c.endsWith("_MIN"));
}

/**
 * Single-batch tab list. The "Bônus MMC" tab (spec 060) is removed entirely — RECTANGLE
 * positions get "Zona 2D" (RectangleZoneChart) instead of the legacy "Coordenadas"/"Perfil"
 * tab, since the flat X/Y/Z scatter assumes suffix-inferred children (FR-033 forbids that
 * inference for RECTANGLE). CIRCULAR/profile dims are entirely unaffected.
 */
export function getSingleTabs(
  dim: DimRead | null | undefined,
  availableCavitiesCount: number,
): TabDef<SingleTabId>[] {
  const hasAnyChildren = (dim?.children?.length ?? 0) > 0;
  const rectangle = isRectanglePosition(dim);
  return [
    ...BASE_SINGLE_TABS,
    ...(hasAnyChildren && !rectangle
      ? [
          {
            id: "profile" as const,
            label: hasCoordChildren(dim) ? "Coordenadas" : "Perfil",
          },
        ]
      : []),
    ...(rectangle ? [{ id: "rectangle_zone" as const, label: "Zona 2D" }] : []),
    ...(availableCavitiesCount > 1 ? [{ id: "cavity_compare" as const, label: "Por Cavity" }] : []),
  ];
}

export function getMultiTabs(dim: DimRead | null | undefined): TabDef<MultiTabId>[] {
  const hasAnyChildren = (dim?.children?.length ?? 0) > 0;
  return [
    ...BASE_MULTI_TABS,
    ...(hasAnyChildren
      ? [
          {
            id: "profile_trend" as const,
            label: hasCoordChildren(dim) ? "Coordenadas" : "Perfil",
          },
        ]
      : []),
  ];
}
