"use client";

import { useEffect, useState } from "react";

type Options = {
  saturationBoost?: number;
  lighten?: number;
};

export function useDominantColor(imageUrl?: string, options?: Options): string | null {
  const { saturationBoost = 1.8, lighten = 0 } = options ?? {};
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) { setColor(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = 40;
        canvas.height = 40;
        ctx.drawImage(img, 0, 0, 40, 40);
        const data = ctx.getImageData(0, 0, 40, 40).data;
        const buckets: Record<string, { r: number; g: number; b: number; count: number }> = {};
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          if (r + g + b < 45 || r + g + b > 700) continue;
          const key = `${(r >> 5) << 5},${(g >> 5) << 5},${(b >> 5) << 5}`;
          if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0 };
          buckets[key].r += r;
          buckets[key].g += g;
          buckets[key].b += b;
          buckets[key].count++;
        }
        let best = { r: 60, g: 60, b: 80, count: 0 };
        for (const b of Object.values(buckets)) {
          if (b.count > best.count) best = b;
        }
        if (best.count > 0) {
          let rr = Math.round(best.r / best.count);
          let gg = Math.round(best.g / best.count);
          let bb = Math.round(best.b / best.count);
          const avg = (rr + gg + bb) / 3;
          rr = Math.min(255, Math.max(0, Math.round(avg + (rr - avg) * saturationBoost)));
          gg = Math.min(255, Math.max(0, Math.round(avg + (gg - avg) * saturationBoost)));
          bb = Math.min(255, Math.max(0, Math.round(avg + (bb - avg) * saturationBoost)));
          if (lighten > 0) {
            rr = Math.round(rr + (255 - rr) * lighten);
            gg = Math.round(gg + (255 - gg) * lighten);
            bb = Math.round(bb + (255 - bb) * lighten);
          }
          setColor(`${rr}, ${gg}, ${bb}`);
        }
      } catch {
        // CORS or canvas error
      }
    };
    img.onerror = () => setColor(null);
    img.src = imageUrl;
  }, [imageUrl, saturationBoost, lighten]);

  return color;
}
