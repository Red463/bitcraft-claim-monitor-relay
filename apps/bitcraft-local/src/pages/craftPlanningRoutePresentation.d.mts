export type AcquisitionRouteMetrics = {
  status: "available" | "unavailable";
  basis?: "node" | "progress" | "craft";
  expectedPerUnit?: number;
  exactUnits?: number;
  plannedUnits?: number;
  totalProgress?: number | null;
  progressPerExpectedItem?: number | null;
  totalActions?: number | null;
};

export type AcquisitionRouteReviewPresentation = {
  label: string;
  yield: string;
  probability: "guaranteed" | "expected" | "unavailable";
};

export type AcquisitionRouteReviewTechnicalDetail = {
  label: string;
  value: string;
  code?: boolean;
};

export function acquisitionRouteKind(route: Record<string, unknown>): "Gathering" | "Gathering byproduct" | "Prospecting" | "Crafting" | "Craft byproduct" | "Logistics";
export function acquisitionRouteLabel(route: Record<string, unknown>, output?: Record<string, unknown>): string;
export function acquisitionRouteReviewItemName(item: Record<string, unknown>): string;
export function acquisitionRouteReviewPresentation(route: Record<string, unknown>, output?: Record<string, unknown>): AcquisitionRouteReviewPresentation;
export function acquisitionRouteReviewTechnicalDetails(route: Record<string, unknown>, output?: Record<string, unknown>): AcquisitionRouteReviewTechnicalDetail[];
export function acquisitionRouteReviewTechnicalFacts(route: Record<string, unknown>, output?: Record<string, unknown>): AcquisitionRouteReviewTechnicalDetail[];
export function acquisitionRouteMetrics(route: Record<string, unknown>, options?: { missingQuantity?: number; multiplier?: number }): AcquisitionRouteMetrics;
export function formatProbabilityRate(value: unknown): string;
