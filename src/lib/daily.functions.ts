import { createServerFn } from "@tanstack/react-start";
import type { DailyBedEvent } from "@/lib/daily.server";

export type { DailyBedEvent, DailyKind, DailyStatus } from "@/lib/daily.server";

export const getDailyBeds = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ events: DailyBedEvent[]; at: string }> => {
    const { loadDailyBedEvents } = await import("@/lib/daily.server");
    const events = await loadDailyBedEvents();
    return { events, at: new Date().toISOString() };
  },
);
