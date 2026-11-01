import { createServerFn } from "@tanstack/react-start";
import type { DailyResult } from "@/lib/daily.server";

export type { DailyBedEvent, DailyKind, DailyStatus } from "@/lib/daily.server";

export const getDailyBeds = createServerFn({ method: "GET" }).handler(
  async (): Promise<DailyResult> => {
    const { loadDailyBedEvents } = await import("@/lib/daily.server");
    return loadDailyBedEvents();
  },
);
