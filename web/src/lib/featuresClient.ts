export const features = {
  // Viral growth (optional)
  referrals: process.env.NEXT_PUBLIC_ENABLE_REFERRALS === "true",

  // Retention helpers (optional)
  templates: process.env.NEXT_PUBLIC_ENABLE_TEMPLATES === "true",
  savedPairs: process.env.NEXT_PUBLIC_ENABLE_SAVED_PAIRS === "true",
  myClips: process.env.NEXT_PUBLIC_ENABLE_MY_CLIPS === "true",

  // Platform pages (optional)
  agentPages: process.env.NEXT_PUBLIC_ENABLE_AGENT_PAGES === "true",
} as const;

