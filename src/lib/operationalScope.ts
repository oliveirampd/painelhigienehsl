/** Shared scope for TV and historical bed activity. Codes refer to units/floors. */
export const EXCLUDED_UNITS = ["3D", "3C", "12C", "5B", "9C", "13C"] as const;

export function isExcludedUnit(unit: string): boolean {
  const text = unit
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const block = text.match(/BLOCO\s+([A-Z])/)?.[1];
  const floor =
    text.match(/BLOCO\s+[A-Z][^\d]*0*(\d+)/)?.[1] ?? text.match(/0*(\d+)\s*[º°O]?\s*ANDAR/)?.[1];
  if (
    block &&
    floor &&
    EXCLUDED_UNITS.includes(`${Number(floor)}${block}` as (typeof EXCLUDED_UNITS)[number])
  )
    return true;
  return EXCLUDED_UNITS.some((code) =>
    new RegExp(`(^|[^A-Z0-9])0*${code}([^A-Z0-9]|$)`).test(text),
  );
}
