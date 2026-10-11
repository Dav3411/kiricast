/** Database row shape for agents table (server-side). */
export type AgentRow = {
  id: string;
  user_id: string | null;
  name: string;
  concept?: string | null;
  personality?: string | null;
  speaking_style?: string | null;
  appearance?: string | null;
  rate: string | null;
  pitch: string | null;
  intro_line: string | null;
  image_key?: string | null;
  is_public?: boolean | null;
  elevenlabs_voice_id?: string | null;
  intro_mp3?: string | null;
  subscriber_count?: number | null;
  created_at?: string | null;
  dominant_color?: string | null;
  language?: string | null;
};
