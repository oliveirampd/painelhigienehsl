import { HOSPITAL_BEDS, bedFloor, type BedRef } from "@/lib/beds";

export const DAILY_EXCLUDED_FLOORS: ReadonlyArray<{ block: string; floor: number }> = [
  { block: "C", floor: 12 },
  { block: "C", floor: 13 },
];

export const DAILY_CONCURRENT_EXCLUDED_UNITS = ["5B", "5C", "9C", "3C", "3D"] as const;
const concurrentExcluded = new Set<string>(DAILY_CONCURRENT_EXCLUDED_UNITS);

export const ACTIVE_DAILY_BEDS: BedRef[] = HOSPITAL_BEDS.filter(
  (bed) =>
    !DAILY_EXCLUDED_FLOORS.some(
      (excluded) => excluded.block === bed.b && excluded.floor === bedFloor(bed.n),
    ),
);

export function dailyBedUnit(bedCode: string, block?: string): string {
  const bed = block ? { n: bedCode, b: block } : HOSPITAL_BEDS.find((item) => item.n === bedCode);
  return bed ? `${bedFloor(bedCode)}${bed.b}` : "";
}

export function isDailyConcurrentEligibleBed(bedCode: string, block?: string): boolean {
  const unit = dailyBedUnit(bedCode, block);
  return !!unit && !concurrentExcluded.has(unit);
}
