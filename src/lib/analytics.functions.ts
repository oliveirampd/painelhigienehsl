import { createServerFn } from "@tanstack/react-start";
import type { OperationsAnalytics } from "@/lib/listoAnalytics.server";

export type { OperationsAnalytics, ShiftSummary } from "@/lib/listoAnalytics.server";

export const getOperationsAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperationsAnalytics> => {
    const { loadOperationsAnalytics } = await import("@/lib/listoAnalytics.server");
    return loadOperationsAnalytics();
  },
);

