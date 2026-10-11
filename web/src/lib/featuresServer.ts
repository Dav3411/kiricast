export const serverFeatures = {
  referrals: process.env.ENABLE_REFERRALS === "true",
  freeFirstClipAb: process.env.ENABLE_FREE_FIRST_CLIP_AB === "true",
} as const;

