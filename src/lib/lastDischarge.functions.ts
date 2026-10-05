import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LastCompletedDischarge } from "@/lib/lastDischarge.server";

export type { LastCompletedDischarge } from "@/lib/lastDischarge.server";

export const getLastCompletedDischarge = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        unit: z.string().trim().min(1).max(160),
        bedNumber: z.string().trim().min(1).max(80),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<LastCompletedDischarge | null> => {
    const { loadLastCompletedDischarge } = await import("@/lib/lastDischarge.server");
    return loadLastCompletedDischarge(data.unit, data.bedNumber);
  });

