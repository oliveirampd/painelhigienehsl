/** Shared scope for TV and historical bed activity. Codes refer to units/floors. */
export const EXCLUDED_UNITS = ["3D", "3C", "12C", "5B", "9C", "13C"] as const;

function normalizeOperationalPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Stable identity used by the TV sync and the one-row-per-bed snapshot. */
export function operationalBedKey(unit: string, bed: string): string {
  return `${normalizeOperationalPart(unit)}|${normalizeOperationalPart(bed)}`;
}

function normalizeOperationalText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Rotina específica do Listo usada pelos boxes de UTI que funcionam como alta. */
export function isTerminalBoxRoutine(
  routeName: string | null | undefined,
  inspectionName: string | null | undefined,
): boolean {
  const text = normalizeOperationalText(`${routeName ?? ""} ${inspectionName ?? ""}`).toLowerCase();
  return text.includes("limpeza terminal box");
}

/** Box operacional, não área comum cujo nome apenas contém a palavra "box". */
export function isTerminalBoxLocation(locationName: string | null | undefined): boolean {
  return /^box(?:\s|$)/i.test((locationName ?? "").trim());
}

/**
 * Exceção exclusiva do Terminal: boxes de UTI do 3º andar nos blocos C, D e E.
 * Leitos dessas unidades continuam sujeitos às exclusões normais.
 */
export function isTerminalUtiBoxUnit(unit: string): boolean {
  const text = normalizeOperationalText(unit);
  if (!/(^|\s)UTI(\s|$)/.test(text)) return false;

  // Formatos curtos que às vezes aparecem em integrações: "UTI 3C" / "3D UTI".
  if (/(^|\s)0*3\s*[CDE](\s|$)/.test(text)) return true;
  if (/(^|\s)[CDE]\s*0*3(\s|$)/.test(text)) return true;

  const block = text.match(/BLOCO\s+([A-Z])/)?.[1];
  const floor =
    text.match(/BLOCO\s+[A-Z][^\d]*0*(\d+)/)?.[1] ??
    text.match(/0*(\d+)\s*ANDAR/)?.[1];

  return !!block && ["C", "D", "E"].includes(block) && Number(floor) === 3;
}

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

