import { createServerFn } from "@tanstack/react-start";
import type { TerminalGeralEvent } from "@/lib/terminalGeral.server";

export type { TerminalGeralEvent, TerminalGeralStatus, BlockGroup } from "@/lib/terminalGeral.server";

export const getTerminalGeral = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ events: TerminalGeralEvent[]; at: string }> => {
    const { loadTerminalGeralEvents } = await import("@/lib/terminalGeral.server");
    const events = await loadTerminalGeralEvents();
    return { events, at: new Date().toISOString() };
  },
);
