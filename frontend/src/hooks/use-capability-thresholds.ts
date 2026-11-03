import { useQuery } from "@tanstack/react-query";

export type CapabilityThresholds = {
  default_minimum: number;
  warning_minimum: number;
  tolerance_warning_pct: number;
  tolerance_limit_pct: number;
  dppm_good_max: number;
  dppm_warning_max: number;
};

export function useCapabilityThresholds() {
  return useQuery({
    queryKey: ["sqc", "capability-thresholds"],
    queryFn: async () => {
      const response = await fetch("/api/sqc/capability-thresholds");
      if (!response.ok) throw new Error(`capability_thresholds_${response.status}`);
      return (await response.json()) as CapabilityThresholds;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
