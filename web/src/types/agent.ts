/** Client-side agent shape — superset of all page variants. */
export type Agent = {
  id: string;
  name: string;
  source?: "preset" | "user" | string;
  concept?: string;
  personality?: string;
  speaking_style?: string;
  appearance?: string;
  rate?: string;
  pitch?: string;
  intro_line?: string;
  intro_mp3_url?: string;
  image_url?: string;
  is_public?: boolean;
  subscriber_count?: number;
  is_subscribed?: boolean;
  created_at?: string;
  /** true when the logged-in user owns this agent */
  mine?: boolean;
  ownerId?: string;
  /** Raw dominant RGB color from avatar, e.g. "164, 120, 80" */
  dominant_color?: string;
  /** Language code (e.g. "en", "ko") the agent was created in */
  language?: string;
};

/** Voice option from ElevenLabs API */
export type VoiceOption = {
  voice_id: string;
  name: string;
  category: string | null;
  gender: string | null;
  accent: string | null;
  age: string | null;
  description: string | null;
  preview_url: string | null;
};

export type JobStatus = "queued" | "processing" | "succeeded" | "failed";

export type CreateJobResponse = {
  jobId?: string;
  error?: string;
};
