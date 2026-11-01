export type TimedDailyEvent = { status: "in_progress" | "completed"; at: string };

/** O último evento observado determina o estado; empate favorece conclusão. */
export function latestDailyEvent<T extends TimedDailyEvent>(previous: T, current: T): T {
  if (current.at > previous.at) return current;
  if (current.at < previous.at) return previous;
  return current.status === "completed" ? current : previous;
}
