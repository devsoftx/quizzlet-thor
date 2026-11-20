// Scales for the Progress page charts (src/components/charts.tsx): pure, so they are unit-tested.

/** Round axis steps (1, 2, 5 × 10ⁿ) from 0 to at least `max`; whole numbers only, for counts. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
}

/** Quantizes a share (0–1) into the heat map's five steps; 0 means empty. */
export const heatStep = (share: number | null) =>
  share === null || share <= 0 ? 0 : share <= 0.1 ? 1 : share <= 0.25 ? 2 : share <= 0.5 ? 3 : share <= 0.75 ? 4 : 5;

