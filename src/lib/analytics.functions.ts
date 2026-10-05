import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DischargeTimeline, OperationsAnalytics } from "@/lib/listoAnalytics.server";

export type {
  DischargeTimeline,
  OperationsAnalytics,
  ShiftSummary,
} from "@/lib/listoAnalytics.server";

export const getOperationsAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperationsAnalytics> => {
    const { loadOperationsAnalytics } = await import("@/lib/listoAnalytics.server");
    return loadOperationsAnalytics();
  },
);

export const getDischargeTimeline = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ answerId: z.number().int().positive() }).parse(data),
  )
  .handler(async ({ data }): Promise<DischargeTimeline | null> => {
    const { loadDischargeTimeline } = await import("@/lib/listoAnalytics.server");
    return loadDischargeTimeline(data.answerId);
  });
