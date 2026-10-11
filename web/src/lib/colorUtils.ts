/**
 * Apply saturation boost and lighten to a raw "r, g, b" color string.
 * Same algorithm as useDominantColor hook's post-processing.
 */
export function applyColorTransform(
  raw: string,
  opts?: { saturationBoost?: number; lighten?: number },
): string {
  const { saturationBoost = 1.8, lighten = 0 } = opts ?? {};
  const parts = raw.split(",").map((v) => parseInt(v.trim(), 10));
  let [r, g, b] = parts;
  const avg = (r + g + b) / 3;
  r = Math.min(255, Math.max(0, Math.round(avg + (r - avg) * saturationBoost)));
  g = Math.min(255, Math.max(0, Math.round(avg + (g - avg) * saturationBoost)));
  b = Math.min(255, Math.max(0, Math.round(avg + (b - avg) * saturationBoost)));
  if (lighten > 0) {
    r = Math.round(r + (255 - r) * lighten);
    g = Math.round(g + (255 - g) * lighten);
    b = Math.round(b + (255 - b) * lighten);
  }
  return `${r}, ${g}, ${b}`;
}
