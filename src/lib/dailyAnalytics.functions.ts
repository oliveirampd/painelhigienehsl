import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  DailyHistoryRecord,
  DailyOperationsAnalytics,
} from "@/lib/dailyAnalytics.server";

export type {
  DailyCoveragePoint,
  DailyHistoryRecord,
  DailyOperationsAnalytics,
  DailyShiftClosure,
  DailyStaffProductivity,
} from "@/lib/dailyAnalytics.server";

export const getDailyBedHistory = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        bed: z.string().trim().regex(/^\d{2,4}$/),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<DailyHistoryRecord[]> => {
    const { loadDailyBedHistory } = await import("@/lib/dailyAnalytics.server");
    return loadDailyBedHistory(data.bed);
  });

export const getDailyOperationsAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<DailyOperationsAnalytics> => {
    const { loadDailyOperationsAnalytics } = await import("@/lib/dailyAnalytics.server");
    return loadDailyOperationsAnalytics();
  },
);
